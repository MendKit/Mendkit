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
  console.log(`PowerShell: ${parsed} scripts parsed`);

  const cat = loadCatalog(defs, 'win32');
  const readOnly = cmds.filter((c) => !c.admin && !['flush-dns'].includes(c.id) && cat.commands.has(c.id)).map((c) => c.id);
  const eng = new Engine(cat, fs.mkdtempSync(path.join(os.tmpdir(), 'mk-win-')));
  const s = await eng.runCommands('windows-check', 'Read-only checks', readOnly, { elevated: false });
  for (const st of s.steps) {
    console.log(`  ${st.status.padEnd(8)} ${st.name}: ${st.friendly?.message ?? ''}`);
    if (!st.friendly?.message) fail(`${st.command} gave no plain-language result`);
  }
}
main().catch((e) => fail(String(e?.stack ?? e)));
