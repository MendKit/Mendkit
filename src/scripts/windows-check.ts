/**
 * Run on Windows (the CI runs it on GitHub's Windows machines).
 * Parses every PowerShell script MendKit carries, in the command list and inside the app's code,
 * with PowerShell's own parser, then runs the read-only Windows commands and checks their results map
 * to plain language. Usage: node dist/scripts/windows-check.js
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadCatalog } from '../engine/catalog';
import { Engine } from '../engine/runner';
import { CommandDef } from '../engine/types';
import { winSpaceCategories } from '../engine/wintools';
import { forcesFromRegistry, policyConcerns, regRemoveArgs } from '../engine/browsers';
import { upgradePlan } from '../engine/upgrade';
import { grantAccessCommand, lockedFolders } from '../engine/olddrive';

const root = path.join(__dirname, '..', '..');
const defs = path.join(root, 'definitions');
const fail = (m: string) => {
  console.error(`FAIL: ${m}`);
  process.exitCode = 1;
};

/** PowerShell's parser reports syntax errors without running anything. */
function parse(name: string, script: string): void {
  const file = path.join(os.tmpdir(), `mk-ps-${Date.now()}-${Math.random().toString(36).slice(2)}.ps1`);
  fs.writeFileSync(file, script, 'utf8');
  const check = `$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('${file.replace(/'/g, "''")}', [ref]$null, [ref]$e); if ($e.Count) { $e | ForEach-Object { "$($_.Extent.StartLineNumber): $($_.Message)" }; exit 1 }`;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', check], { encoding: 'utf8' });
  fs.rmSync(file, { force: true });
  if (r.status !== 0) fail(`${name}: ${(r.stdout || r.stderr).trim()}`);
}

/** Scripts written as template strings in the TypeScript sources; ${...} parts become a placeholder string. */
function embeddedScripts(): { name: string; script: string }[] {
  const out: { name: string; script: string }[] = [];
  const dir = path.join(root, 'src', 'main');
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const re = /(?:powershellScript\(|const [A-Z_]+ = )`([\s\S]*?)`[,;)]/g;
    let m: RegExpExecArray | null;
    let n = 0;
    while ((m = re.exec(src))) {
      if (!/\$\w|Get-|ConvertTo-Json|Write-Output/.test(m[1])) continue;
      // Undo template-literal escaping and stand in for interpolations.
      // \${...} is PowerShell's own ${...} syntax; plain ${...} is a TypeScript value, stood in for by 0.
      const script = m[1]
        .replace(/\\\$\{/g, '\u0000')
        .replace(/\$\{[^}]*\}/g, '0')
        .replace(/\u0000/g, '${')
        .replace(/\\`/g, '`')
        .replace(/\\\$/g, '$')
        .replace(/\\\\/g, '\\');
      out.push({ name: `${f} script ${++n}`, script });
    }
    // One-line scripts in plain quotes: powershellScript("...") and powershellJson('...').
    const q = /powershell(?:Script|Json)\((["'])((?:\\.|(?!\1).)*)\1/g;
    while ((m = q.exec(src))) out.push({ name: `${f} script ${++n}`, script: m[2].replace(/\\(["'\\])/g, '$1') });
  }
  return out;
}

async function main() {
  if (process.platform !== 'win32') throw new Error('Run this on Windows');
  const cmds = JSON.parse(fs.readFileSync(path.join(defs, 'commands.win32.json'), 'utf8')) as CommandDef[];
  let parsed = 0;
  for (const c of cmds) {
    if (!/powershell/i.test(c.exec)) continue;
    const i = c.args.findIndex((a) => /^-Command$/i.test(a));
    if (i < 0) continue;
    parse(`command ${c.id}`, c.args.slice(i + 1).join(' '));
    parsed++;
  }
  for (const e of embeddedScripts()) {
    parse(e.name, e.script);
    parsed++;
  }
  const psDir = path.join(defs, 'scripts');
  for (const f of fs.existsSync(psDir) ? fs.readdirSync(psDir).filter((n) => n.endsWith('.ps1')) : []) {
    parse(`definitions/scripts/${f}`, fs.readFileSync(path.join(psDir, f), 'utf8'));
    parsed++;
  }
  // Cleanup commands built in code (Free up space).
  for (const c of winSpaceCategories({ local: process.env.LOCALAPPDATA ?? '', temp: process.env.TEMP ?? '' })) {
    const st = c.step as CommandDef | null;
    if (st && 'exec' in st && /powershell/i.test(st.exec)) {
      parse(`free up space: ${c.id}`, st.args[st.args.indexOf('-Command') + 1]);
      parsed++;
    }
  }
  console.log(`PowerShell: ${parsed} scripts parsed`);

  // Read-only scripts run for real and must print the JSON MendKit expects.
  const space = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(psDir, 'windows-space.ps1')], { encoding: 'utf8', timeout: 600000 });
  try {
    const r = JSON.parse(space.stdout.trim() || 'null');
    const ids = winSpaceCategories({ local: '', temp: '' }).map((c) => c.id).filter((id) => id !== 'component');
    const missing = ids.filter((id) => !(id in (r?.sizes ?? {})));
    if (missing.length || !(Number(r.total) > 0)) throw new Error(`sizes missing for ${missing.join(', ')}`);
    console.log(`free up space: measured ${ids.length} categories, ${Object.entries(r.sizes).map(([k, v]) => `${k} ${Math.round(Number(v) / 1048576)} MB`).join(', ')}`);
  } catch (e) {
    fail(`windows-space.ps1 output: ${(e as Error).message}: ${space.stdout.slice(0, 300)} ${space.stderr.slice(0, 300)}`);
  }
  const startup = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(psDir, 'windows-startup.ps1')], { encoding: 'utf8', timeout: 180000 });
  try {
    const items = JSON.parse(startup.stdout.trim() || 'null');
    if (!Array.isArray(items)) throw new Error('not a list');
    const kinds = [...new Set(items.map((i: any) => i.kind))];
    if (items.some((i: any) => !i.kind || !('enabled' in i) || !i.name)) throw new Error('an item lacks kind, name or enabled');
    console.log(`startup items: ${items.length} found (${kinds.join(', ')})`);
  } catch (e) {
    fail(`windows-startup.ps1 output: ${(e as Error).message}: ${startup.stdout.slice(0, 300)} ${startup.stderr.slice(0, 300)}`);
  }

  // Browser cleanup: a made-up adware policy in this account's registry is found, read and removed.
  try {
    const key = 'HKCU\\SOFTWARE\\Policies\\Google\\Chrome';
    const id = 'abcdefghijklmnopabcdefghijklmnop';
    spawnSync('reg.exe', ['add', key, '/v', 'HomepageLocation', '/t', 'REG_SZ', '/d', 'http://search.example/', '/f']);
    spawnSync('reg.exe', ['add', `${key}\\ExtensionInstallForcelist`, '/v', '1', '/t', 'REG_SZ', '/d', `${id};https://clients2.google.com/service/update2/crx`, '/f']);
    const pol = spawnSync('reg.exe', ['query', 'HKCU\\SOFTWARE\\Policies', '/s'], { encoding: 'utf8' }).stdout;
    const found = forcesFromRegistry('HKCU', pol, '').find((f) => f.browser === 'Google Chrome');
    if (!found || !found.extensionIds.includes(id) || policyConcerns(found.settings).length < 2) throw new Error(`policy not read: ${JSON.stringify(found)} ${pol.slice(0, 400)}`);
    const saveAs = path.join(os.tmpdir(), 'mk-policy.reg');
    const rm = spawnSync('powershell.exe', regRemoveArgs(found.location, saveAs), { encoding: 'utf8' });
    const left = spawnSync('reg.exe', ['query', key], { encoding: 'utf8' });
    if (rm.status !== 0 || left.status === 0 || !fs.existsSync(saveAs)) throw new Error(`policy not removed: ${rm.stdout} ${rm.stderr}`);
    console.log(`browser cleanup: found ${found.settings.length} policy settings, removed them and saved ${fs.statSync(saveAs).size} bytes`);
  } catch (e) {
    fail(`browser policy: ${(e as Error).message}`);
  }

  // Windows 11 upgrade readiness reads real values (the runner is Windows Server, so the plan says "already").
  const up = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(psDir, 'windows-upgrade.ps1')], { encoding: 'utf8', timeout: 180000 });
  try {
    const f = JSON.parse(up.stdout.trim());
    for (const k of ['admin', 'product', 'build', 'cpu', 'ramGb', 'firmware', 'partitionStyle', 'diskGb', 'freeGb', 'verdicts']) if (!(k in f)) throw new Error(`missing ${k}`);
    if (!(f.build > 0) || !f.cpu || !(f.ramGb > 0) || !(f.diskGb > 0)) throw new Error('empty values');
    const plan = upgradePlan({ ...f, build: 19045, verdicts: [].concat(f.verdicts ?? []) });
    console.log(`windows 11 readiness: ${f.product} ${f.build}, ${f.cpu}, TPM ${f.tpm?.version ?? 'unknown'}, Secure Boot ${f.secureBoot}, firmware ${f.firmware}, ${f.partitionStyle}, ${f.freeGb} GB free. As Windows 10: ${plan.state}: ${plan.checks.map((c) => `${c.id} ${c.level}`).join(', ')}`);
  } catch (e) {
    fail(`windows-upgrade.ps1 output: ${(e as Error).message}: ${up.stdout.slice(0, 400)} ${up.stderr.slice(0, 400)}`);
  }

  // Phone helper: with no phone plugged in, the list is empty but must still be valid JSON.
  const phones = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(psDir, 'windows-phone.ps1'), '-List'], { encoding: 'utf8', timeout: 180000 });
  try {
    const j = JSON.parse(phones.stdout.trim() || 'null');
    if (!Array.isArray(j)) throw new Error('not a list');
    console.log(`phones: ${j.length} found`);
  } catch (e) {
    fail(`windows-phone.ps1 -List output: ${(e as Error).message}: ${phones.stdout.slice(0, 300)} ${phones.stderr.slice(0, 300)}`);
  }

  // Old drive: a profile only its old owner may open is locked, and MendKit's command opens it.
  try {
    const home = path.join(os.tmpdir(), 'mk-old', 'Users', 'Ann');
    fs.mkdirSync(path.join(home, 'Documents'), { recursive: true });
    fs.writeFileSync(path.join(home, 'Documents', 'letter.txt'), 'hello');
    spawnSync('icacls.exe', [home, '/inheritance:r', '/grant:r', 'SYSTEM:(OI)(CI)F', '/T', '/C', '/Q']);
    spawnSync('icacls.exe', [home, '/setowner', 'SYSTEM', '/T', '/C', '/Q']);
    const prof = { name: 'Ann', home, platform: 'win32' as const, systemRoot: path.dirname(path.dirname(home)) };
    const before = lockedFolders(prof);
    const sid = /"(S-1-[\d-]+)"/.exec(spawnSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8' }).stdout)?.[1];
    const cmd = grantAccessCommand('win32', home, { user: os.userInfo().username, uid: 0, sid });
    const r = spawnSync(cmd.exec, cmd.args, { encoding: 'utf8', timeout: 300000 });
    const after = lockedFolders(prof);
    const text = fs.readFileSync(path.join(home, 'Documents', 'letter.txt'), 'utf8');
    if (!before.length || after.length || text !== 'hello' || !/ACCESS_GRANTED/.test(r.stdout)) throw new Error(`before ${before.length}, after ${after.length}: ${r.stdout.slice(-400)} ${r.stderr.slice(-300)}`);
    console.log(`old drive access: ${before.length} closed folder(s) opened`);
  } catch (e) {
    fail(`old drive access: ${(e as Error).message}`);
  }

  const cat = loadCatalog(defs, 'win32');
  const readOnly = cmds.filter((c) => !c.admin && !['flush-dns'].includes(c.id) && cat.commands.has(c.id)).map((c) => c.id);
  const eng = new Engine(cat, fs.mkdtempSync(path.join(os.tmpdir(), 'mk-win-')));
  const s = await eng.runCommands('windows-check', 'Read-only checks', readOnly, { elevated: false });
  for (const st of s.steps) {
    console.log(`  ${st.status.padEnd(8)} ${st.name}: ${st.friendly?.message ?? ''}`);
    if (!st.friendly?.message) fail(`${st.command} gave no plain-language result`);
  }

  // Tool installs from an elevated MendKit, the way a technician runs it. Process Explorer only installs per
  // user, which winget refuses from an administrator context unless asked for all users; HWiNFO's catalog
  // entry often points at a download the publisher has replaced.
  for (const id of ['procexp', 'hwinfo']) {
    const r = await eng.runTool(id, 'install', { elevated: true });
    const st = r.steps[0];
    console.log(`  install ${id}: ${st.status}: ${st.friendly?.message ?? ''}`);
    if (st.status !== 'ok' && !(id === 'hwinfo' && /publisher has removed/.test(st.friendly?.message ?? ''))) fail(`installing ${id} failed: ${st.friendly?.message}`);
  }
}
main().catch((e) => fail(String(e?.stack ?? e)));
