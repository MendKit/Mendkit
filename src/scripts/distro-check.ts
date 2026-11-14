/**
 * Run on a real Linux distribution (the CI runs it in Ubuntu, Debian, Fedora, Arch and openSUSE containers).
 * Checks every Linux command parses with this system's own /bin/sh, that the right package manager and
 * commands are picked, and runs the read-only commands so their output is mapped without errors.
 * Usage: node dist/scripts/distro-check.js
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadCatalog } from '../engine/catalog';
import { linuxEol, parseOsRelease } from '../engine/eol';
import { Engine } from '../engine/runner';
import { CommandDef } from '../engine/types';

const defs = path.join(__dirname, '..', '..', 'definitions');
const fail = (m: string) => {
  console.error(`FAIL: ${m}`);
  process.exitCode = 1;
};

async function main() {
  const mac = process.platform === 'darwin';
  const osr = parseOsRelease(fs.existsSync('/etc/os-release') ? fs.readFileSync('/etc/os-release', 'utf8') : '');
  console.log(`System: ${mac ? `macOS ${os.release()} ${os.arch()}` : osr.PRETTY_NAME ?? 'unknown'} (/bin/sh is ${fs.realpathSync('/bin/sh')})`);
  const all = JSON.parse(fs.readFileSync(path.join(defs, mac ? 'commands.darwin.json' : 'commands.linux.json'), 'utf8')) as CommandDef[];
  // 1. Every shell script parses with this distribution's sh (dash on Debian and Ubuntu, bash elsewhere).
  for (const c of all) {
    if (c.exec !== 'sh') continue;
    const r = spawnSync('/bin/sh', ['-n', '-c', c.args[1]], { encoding: 'utf8' });
    if (r.status !== 0) fail(`${c.id} does not parse with /bin/sh: ${r.stderr.trim()}`);
  }
  console.log(`shell syntax: ${all.filter((c) => c.exec === 'sh').length} scripts parsed`);
  // 2. The package manager and commands this distribution gets.
  const cat = loadCatalog(defs, mac ? 'darwin' : 'linux');
  const expect: Record<string, string> = { ubuntu: 'apt', debian: 'apt', linuxmint: 'apt', fedora: 'dnf', arch: 'pacman', 'opensuse-tumbleweed': 'zypper', 'opensuse-leap': 'zypper' };
  const want = expect[(osr.ID ?? '').toLowerCase()];
  if (!mac && want && cat.manager !== want) fail(`expected package manager ${want}, got ${cat.manager}`);
  const foreign = [...cat.commands.keys()].filter((id) => /^(apt|dnf|pacman|zypper)-/.test(id) && !id.startsWith(`${cat.manager}-`));
  if (foreign.length) fail(`commands for another package manager were kept: ${foreign.join(', ')}`);
  console.log(`catalog: manager ${cat.manager}, ${cat.commands.size} commands, ${cat.recipes.length} recipes, ${cat.tools.length} tools`);
  console.log(`end of support: ${JSON.stringify(linuxEol(osr))}`);
  // 3. Read-only commands run and their results map to plain language.
  const readOnly = mac
    ? ['os-info', 'disk-usage', 'security-status', 'launch-items', 'system-extensions', 'space-report', 'apfs-list', 'memory-pressure', 'shutdown-cause', 'thermal', 'battery', 'active-connection', 'recent-crashes', 'full-installers-list', 'os-updates-list']
    : ['os-info', 'disk-usage', 'kernels-list', 'session-type', 'boot-time', 'apt-held', 'snap-updates-list', 'recent-crashes', 'net-adapters', 'release-check', 'battery'];
  const eng = new Engine(cat, fs.mkdtempSync(path.join(os.tmpdir(), 'mk-distro-')));
  const ids = readOnly.filter((id) => cat.commands.has(id) && !cat.commands.get(id)!.admin);
  const s = await eng.runCommands('distro-check', 'Read-only checks', ids, { elevated: false });
  for (const st of s.steps) {
    console.log(`  ${st.status.padEnd(8)} ${st.name}: ${st.friendly?.message ?? ''}`);
    if (!st.friendly?.message) fail(`${st.command} gave no plain-language result`);
  }
}
main().catch((e) => fail(String(e?.stack ?? e)));
