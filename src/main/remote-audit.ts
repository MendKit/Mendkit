import { app, ipcMain } from 'electron';
import { execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { exePatterns, loadRemoteTools, matchScan, RawScan, RemoteFinding, removalPlan } from '../engine/remote';
import { ActionStep, Engine } from '../engine/runner';
import { CommandDef } from '../engine/types';
import { isElevated } from './system';

/**
 * Remote-access audit and removal.
 * The scan only reads. Removal happens only for the products the person ticked and confirmed,
 * runs each product's own uninstaller, and moves loose program files into a quarantine folder
 * (never deletes them) so they can be put back from the Undo Center.
 */

const encode = (script: string) => Buffer.from(script, 'utf16le').toString('base64');

// Reads installed programs, running programs, services, and searches the usual folders for known program files.
const SCAN = `
$ErrorActionPreference='SilentlyContinue'
$names = Get-Content -LiteralPath $env:MENDKIT_IN -Raw | ConvertFrom-Json
$keys = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
$programs = Get-ItemProperty $keys | Where-Object DisplayName | Select-Object DisplayName, Publisher, UninstallString, QuietUninstallString, InstallLocation, PSChildName
$processes = Get-Process | Where-Object Path | Select-Object Name, Path, Id
$services = Get-CimInstance Win32_Service | Select-Object Name, DisplayName, PathName, State, StartMode
$roots = @($env:ProgramFiles, \${env:ProgramFiles(x86)}, $env:ProgramData, "$env:SystemRoot\\Temp")
Get-ChildItem "$env:SystemDrive\\Users" -Directory | ForEach-Object { foreach ($d in 'AppData\\Local','AppData\\Roaming','Downloads','Desktop','Documents') { $roots += (Join-Path $_.FullName $d) } }
$roots = $roots | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
$files = @(Get-ChildItem -Path $roots -Recurse -Depth 6 -File -Force -Include $names | Select-Object -ExpandProperty FullName)
[pscustomobject]@{ programs=@($programs); processes=@($processes); services=@($services); files=$files } | ConvertTo-Json -Depth 4 -Compress
`;

// One fixed script; what to act on arrives as data in a job file, never as script text.
const ACT = `
$ErrorActionPreference='Continue'
$job = Get-Content -LiteralPath $env:MENDKIT_JOB -Raw | ConvertFrom-Json
if ($job.action -eq 'stop') {
  foreach ($s in $job.services) { Stop-Service -Name $s -Force -ErrorAction SilentlyContinue; Set-Service -Name $s -StartupType Disabled -ErrorAction SilentlyContinue; "Stopped and disabled the service $s" }
  foreach ($p in $job.pids) { $x = Get-Process -Id $p -ErrorAction SilentlyContinue; if ($x) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue; "Closed $($x.Name)" } }
}
if ($job.action -eq 'uninstall') {
  foreach ($u in $job.uninstall) {
    "Uninstalling $($u.name)"
    if ($u.msi) { Start-Process msiexec.exe -ArgumentList '/x', $u.msi, '/qn', '/norestart' -Wait }
    elseif ($u.quiet) { Start-Process cmd.exe -ArgumentList ('/c "' + $u.quiet + '"') -Wait -WindowStyle Hidden }
    elseif ($u.silent) { Start-Process cmd.exe -ArgumentList ('/c "' + $u.command + ' ' + $u.silent + '"') -Wait -WindowStyle Hidden }
    else { "Its uninstaller has opened. Follow its prompts to finish."; Start-Process cmd.exe -ArgumentList ('/c "' + $u.command + '"') -Wait }
  }
}
if ($job.action -eq 'quarantine') {
  New-Item -ItemType Directory -Force -Path $job.dir | Out-Null
  foreach ($f in $job.files) {
    if (Test-Path -LiteralPath $f.from) { Move-Item -LiteralPath $f.from -Destination $f.to -Force -ErrorAction SilentlyContinue; if (Test-Path -LiteralPath $f.to) { "Set aside $($f.from)" } else { "COULD_NOT_MOVE $($f.from)" } }
  }
}
`;

interface Quarantined {
  id: string;
  tool: string;
  from: string;
  to: string;
  when: string;
}

async function scanWindows(patterns: string[]): Promise<RawScan> {
  const input = path.join(app.getPath('temp'), `mendkit-scan-${Date.now()}.json`);
  fs.writeFileSync(input, JSON.stringify(patterns));
  try {
    const out = await new Promise<string>((resolve) =>
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encode(SCAN)], { windowsHide: true, timeout: 15 * 60000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, MENDKIT_IN: input } }, (_e, stdout) => resolve(String(stdout))),
    );
    const d = JSON.parse(out);
    const arr = (x: unknown) => (Array.isArray(x) ? x : x ? [x] : []);
    return { programs: arr(d.programs), processes: arr(d.processes), services: arr(d.services), files: arr(d.files).map(String) };
  } finally {
    fs.rmSync(input, { force: true });
  }
}

/** macOS and Linux: running programs and installed app names only. */
async function scanPosix(): Promise<RawScan> {
  const ps = await new Promise<string>((resolve) => execFile('ps', ['-axo', 'pid=,comm='], { timeout: 20000, maxBuffer: 8 * 1024 * 1024 }, (_e, out) => resolve(String(out))));
  const processes = ps
    .split('\n')
    .map((l) => /^\s*(\d+)\s+(.+)$/.exec(l))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ Name: path.basename(m[2]), Path: m[2], Id: Number(m[1]) }));
  const programs: RawScan['programs'] = [];
  for (const dir of process.platform === 'darwin' ? ['/Applications', path.join(os.homedir(), 'Applications')] : ['/usr/share/applications', path.join(os.homedir(), '.local/share/applications')]) {
    try {
      for (const n of fs.readdirSync(dir)) programs.push({ DisplayName: n.replace(/\.(app|desktop)$/, ''), InstallLocation: path.join(dir, n) });
    } catch {
      /* folder missing */
    }
  }
  if (process.platform !== 'linux') return { programs, processes, services: [], files: [] };
  // Linux: packages (marked with how to remove them), Flatpak apps, systemd services and loose copies in the usual folders.
  const sh = (c: string) => new Promise<string>((resolve) => execFile('sh', ['-c', c], { timeout: 30000, maxBuffer: 16 * 1024 * 1024 }, (_e, out) => resolve(String(out))));
  const pm = (await sh('command -v dpkg-query >/dev/null && echo apt || (command -v rpm >/dev/null && (command -v zypper >/dev/null && echo zypper || echo dnf)) || (command -v pacman >/dev/null && echo pacman)')).trim();
  const list = pm === 'apt' ? "dpkg-query -W -f='${Package}\\n'" : pm === 'pacman' ? 'pacman -Qq' : pm ? "rpm -qa --qf '%{NAME}\\n'" : 'true';
  for (const n of (await sh(list)).split('\n').filter(Boolean)) programs.push({ DisplayName: n, UninstallString: `pkg:${pm}:${n}` });
  for (const l of (await sh('flatpak list --app --columns=application,installation 2>/dev/null')).split('\n').filter(Boolean)) {
    const [id, where] = l.split('\t');
    programs.push({ DisplayName: id, UninstallString: `flatpak:${where === 'user' ? 'user' : 'system'}:${id}` });
  }
  const services: RawScan['services'] = [];
  for (const l of (await sh('systemctl list-unit-files --type=service --no-legend --no-pager 2>/dev/null')).split('\n')) {
    const [name, state] = l.trim().split(/\s+/);
    if (name) services.push({ Name: name, DisplayName: name, PathName: '', State: state, StartMode: state === 'enabled' ? 'Auto' : state });
  }
  const files: string[] = [];
  const roots = ['Downloads', 'Desktop', 'Applications', '.local/bin'].map((d) => path.join(os.homedir(), d)).concat(['/opt']);
  for (const l of (await sh(`find ${roots.map((r) => `'${r}'`).join(' ')} -maxdepth 3 \\( -iname '*.AppImage' -o -iname '*.run' -o -iname '*.deb' -o -iname '*.rpm' -o -iname '*.tar.gz' -o -type d \\) 2>/dev/null`)).split('\n')) if (l) files.push(l);
  return { programs, processes, services, files };
}

function runAct(job: object, write: (t: string) => void): Promise<{ ok: boolean; note?: string }> {
  const file = path.join(app.getPath('temp'), `mendkit-job-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(job));
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encode(ACT)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, MENDKIT_JOB: file } });
    let out = '';
    const onData = (b: Buffer) => {
      const t = b.toString('utf8');
      out += t;
      write(t);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (e) => resolve({ ok: false, note: e.message }));
    child.on('close', (code) => {
      fs.rmSync(file, { force: true });
      if (/COULD_NOT_MOVE/.test(out)) resolve({ ok: false, note: 'Some files were in use and could not be set aside. Restart the computer and scan again.' });
      else resolve(code === 0 ? { ok: true } : { ok: false, note: `Exit code ${code}` });
    });
  });
}

export function registerRemoteAudit(engine: Engine): void {
  const defs = loadRemoteTools(path.join(app.getAppPath(), 'definitions'));
  const quarantineFile = path.join(app.getPath('userData'), 'quarantine.json');
  const quarantined = (): Quarantined[] => {
    try {
      return JSON.parse(fs.readFileSync(quarantineFile, 'utf8'));
    } catch {
      return [];
    }
  };
  let last: RemoteFinding[] = [];

  ipcMain.handle('remote-scan', async () => {
    const raw = process.platform === 'win32' ? await scanWindows(exePatterns(defs)) : await scanPosix();
    last = matchScan(raw, defs);
    return { findings: last, canRemove: process.platform === 'win32' || process.platform === 'linux', elevated: isElevated(), known: defs.length };
  });

  ipcMain.handle('remote-remove', (_e, ids: string[]) => {
    if (process.platform === 'linux') return removeLinux(ids);
    if (process.platform !== 'win32') throw new Error('Removal is built for Windows and Linux so far');
    const want = new Set(Array.isArray(ids) ? ids.map(String) : []);
    // Only products from the scan the person just reviewed can be removed.
    const chosen = last.filter((f) => want.has(f.id) && !f.builtin);
    if (!chosen.length) throw new Error('Tick at least one program to remove');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'MendKit', 'Quarantine', stamp);
    const steps: ActionStep[] = [];
    for (const f of chosen) {
      const plan = removalPlan(f, defs);
      if (plan.pids.length || plan.services.length) {
        steps.push({ id: `stop-${f.id}`, name: `${f.name}: stop it running`, admin: true, ok: 'It is no longer running, and its service will not start again.', problem: 'It could not be stopped.', action: (write) => runAct({ action: 'stop', pids: plan.pids, services: plan.services }, write) });
      }
      if (plan.uninstall.length) {
        steps.push({ id: `uninstall-${f.id}`, name: `${f.name}: uninstall`, admin: true, ok: 'Its uninstaller was run.', problem: 'Its uninstaller did not finish.', action: (write) => runAct({ action: 'uninstall', uninstall: plan.uninstall }, write) });
      }
      if (plan.files.length) {
        const files = plan.files.map((from, i) => ({ from, to: path.join(dir, `${f.id}-${i}-${path.basename(from)}.quarantined`) }));
        steps.push({
          id: `quarantine-${f.id}`,
          name: `${f.name}: set aside ${files.length} loose program file${files.length === 1 ? '' : 's'}`,
          admin: true,
          ok: 'The files were moved to the MendKit quarantine folder. They can be put back from the Undo Center.',
          problem: 'Some files could not be set aside.',
          action: async (write) => {
            const r = await runAct({ action: 'quarantine', dir, files }, write);
            const moved = files.filter((x) => fs.existsSync(x.to));
            if (moved.length) fs.writeFileSync(quarantineFile, JSON.stringify([...quarantined(), ...moved.map((x) => ({ id: `${stamp}-${path.basename(x.to)}`, tool: f.name, from: x.from, to: x.to, when: new Date().toISOString() }))], null, 2));
            return r;
          },
        });
      }
    }
    if (!steps.length) throw new Error('There is nothing MendKit can remove for the ticked programs');
    return engine.runActions('remote-access-removal', 'Remove remote access programs', 'recipe', steps, { elevated: isElevated() });
  });

  /** Linux: stop and disable services, close the programs, remove the package or Flatpak, and set loose copies aside. */
  const removeLinux = (ids: string[]) => {
    const want = new Set(Array.isArray(ids) ? ids.map(String) : []);
    const chosen = last.filter((f) => want.has(f.id) && !f.builtin);
    if (!chosen.length) throw new Error('Tick at least one program to remove');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const q = (x: string) => `'${x.replace(/'/g, `'\\''`)}'`;
    const steps: (CommandDef | ActionStep)[] = [];
    const sysDir = `/var/lib/mendkit/quarantine/${stamp}`;
    for (const f of chosen) {
      const services = f.services.map((x) => x.name).filter((n) => /^[\w@.-]+$/.test(n));
      const pids = f.running.map((r) => r.pid).filter((n) => Number.isInteger(n) && n > 1);
      const pkgs = f.installed.map((i) => /^pkg:(apt|dnf|zypper|pacman):([\w.+-]+)$/.exec(i.uninstall)).filter((m): m is RegExpExecArray => !!m);
      const flats = f.installed.map((i) => /^flatpak:(user|system):([\w.-]+)$/.exec(i.uninstall)).filter((m): m is RegExpExecArray => !!m);
      const cmd = (id: string, name: string, script: string, ok: string, admin = true): CommandDef => ({ id, name, description: '', exec: 'sh', args: ['-c', script], admin, typicalMinutes: 1, friendly: { title: f.name, ok, problem: `${name} did not finish.` } });
      if (services.length || pids.length) steps.push(cmd(`stop-${f.id}`, `${f.name}: stop it running`, `${services.map((n) => `systemctl disable --now ${q(n)} 2>&1`).join('; ')}; ${pids.length ? `kill ${pids.join(' ')} 2>/dev/null` : 'true'}; echo stopped`, 'It is no longer running, and its service will not start again.'));
      for (const m of pkgs) {
        const rm = m[1] === 'apt' ? `DEBIAN_FRONTEND=noninteractive apt-get purge -y ${q(m[2])}` : m[1] === 'dnf' ? `dnf remove -y ${q(m[2])}` : m[1] === 'zypper' ? `zypper --non-interactive remove ${q(m[2])}` : `pacman -Rns --noconfirm ${q(m[2])}`;
        steps.push(cmd(`uninstall-${f.id}-${m[2]}`, `${f.name}: uninstall ${m[2]}`, rm, 'It was uninstalled.'));
      }
      for (const m of flats) steps.push(cmd(`flatpak-${f.id}-${m[2]}`, `${f.name}: uninstall ${m[2]}`, `flatpak uninstall -y --${m[1]} --delete-data ${q(m[2])}`, 'It was uninstalled.', m[1] === 'system'));
      const userFiles = f.files.filter((x) => x.startsWith(os.homedir() + '/'));
      const sysFiles = f.files.filter((x) => !x.startsWith(os.homedir() + '/'));
      if (userFiles.length) {
        const dir = path.join(app.getPath('userData'), 'Quarantine', stamp);
        steps.push({
          id: `quarantine-${f.id}`, name: `${f.name}: set aside ${userFiles.length} loose cop${userFiles.length === 1 ? 'y' : 'ies'}`, admin: false,
          ok: 'Moved to the MendKit quarantine folder. They can be put back from the Undo Center.', problem: 'Some files could not be set aside.',
          action: async (write) => {
            fs.mkdirSync(dir, { recursive: true });
            const moved: Quarantined[] = [];
            for (const [i, from] of userFiles.entries()) {
              if (!fs.existsSync(from)) continue;
              const to = path.join(dir, `${f.id}-${i}-${path.basename(from)}.quarantined`);
              try {
                fs.renameSync(from, to);
                moved.push({ id: `${stamp}-${path.basename(to)}`, tool: f.name, from, to, when: new Date().toISOString() });
                write(`Set aside ${from}\n`);
              } catch {
                write(`COULD_NOT_MOVE ${from}\n`);
              }
            }
            if (moved.length) fs.writeFileSync(quarantineFile, JSON.stringify([...quarantined(), ...moved], null, 2));
            return { ok: true };
          },
        });
      }
      if (sysFiles.length) steps.push(cmd(`quarantine-sys-${f.id}`, `${f.name}: set aside leftovers`, `mkdir -p ${q(sysDir)}; for x in ${sysFiles.map(q).join(' ')}; do [ -e "$x" ] && mv "$x" ${q(sysDir)}/ && echo "Set aside $x"; done; true`, `Leftover files were moved to ${sysDir}.`));
    }
    return engine.runSteps('remote-access-removal', 'Remove remote access programs', 'recipe', steps, { elevated: isElevated() });
  };

  ipcMain.handle('quarantine-list', () => quarantined().filter((q) => fs.existsSync(q.to)));
  ipcMain.handle('quarantine-restore', (_e, id: string) => {
    const list = quarantined();
    const q = list.find((x) => x.id === String(id));
    if (!q) throw new Error('That file is not in the quarantine list');
    try {
      fs.mkdirSync(path.dirname(q.from), { recursive: true });
      fs.renameSync(q.to, q.from);
    } catch {
      throw new Error('The file could not be put back. Restart MendKit as administrator and try again.');
    }
    fs.writeFileSync(quarantineFile, JSON.stringify(list.filter((x) => x.id !== q.id), null, 2));
    return q.from;
  });
}
