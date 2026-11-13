import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { onPath } from '../engine/catalog';
import { analyse, CrashEvent, parseBugcheckMessage, parseDumpHeader } from '../engine/crash';
import { ActionStep, Engine } from '../engine/runner';
import { CommandDef, RunSummary } from '../engine/types';
import { isProtected, measure, shredPaths, wipeFreeSpace } from '../engine/wipe';
import { isElevated, powershellScript } from './system';

/** Backup image before repair, secure wipe and the crash analyzer. */

const run = (cmd: string, args: string[], timeout = 30000): Promise<{ ok: boolean; out: string }> =>
  new Promise((resolve) => execFile(cmd, args, { windowsHide: true, timeout, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}${stderr}` })));
const arr = (x: any): any[] => (Array.isArray(x) ? x : x === null || x === undefined ? [] : [x]);
const gb = (b: number): string => (b >= 1024 ** 4 ? `${(b / 1024 ** 4).toFixed(1)} TB` : b >= 1024 ** 3 ? `${Math.round(b / 1024 ** 3)} GB` : `${Math.max(1, Math.round(b / 1024 ** 2))} MB`);
const DAYS = 30;

interface ImageTarget {
  id: string;
  label: string;
  freeBytes: number;
  ok: boolean;
  why?: string;
}
interface WipeDrive {
  id: string;
  name: string;
  size: number;
  detail: string;
  /** Mounted parts that must be released before the wipe (Linux). */
  mounts: string[];
}

export function registerBatch4(ctx: { engine: Engine; getWin: () => BrowserWindow | null; logDir: string }): void {
  const { engine } = ctx;
  const win32 = process.platform === 'win32';
  const mac = process.platform === 'darwin';
  const opts = () => ({ elevated: isElevated() });

  // ---------- Backup image before repair ----------
  const imageInfo = async (): Promise<{ supported: boolean; method: string; note: string; usedBytes: number; targets: ImageTarget[] }> => {
    if (win32) {
      const r = await powershellScript(`
$ErrorActionPreference='SilentlyContinue'
$sys=$env:SystemDrive.TrimEnd(':')
$v=Get-Volume -DriveLetter $sys
$t=@(Get-Volume | Where-Object { $_.DriveLetter -and ([string]$_.DriveLetter) -ne $sys -and ([string]$_.DriveType) -in 'Fixed','Removable' } | ForEach-Object { [pscustomobject]@{letter=[string]$_.DriveLetter; label=$_.FileSystemLabel; fs=$_.FileSystem; free=$_.SizeRemaining; kind=[string]$_.DriveType} })
@{used=($v.Size-$v.SizeRemaining); targets=$t} | ConvertTo-Json -Depth 4 -Compress`);
      const used = Number(r?.used) || 0;
      const targets = arr(r?.targets).map((t: any): ImageTarget => {
        const free = Number(t.free) || 0;
        const ntfs = String(t.fs).toUpperCase() === 'NTFS';
        return { id: String(t.letter).slice(0, 1).toUpperCase(), label: `${t.letter}: ${t.label || (t.kind === 'Removable' ? 'Removable drive' : 'Drive')} (${gb(free)} free)`, freeBytes: free, ok: ntfs && free > used * 0.7, why: !ntfs ? `Formatted as ${t.fs || 'unknown'}. Windows needs an NTFS drive for a system image.` : free <= used * 0.7 ? 'Not enough free space.' : undefined };
      });
      return { supported: true, method: 'Windows system image', note: 'Saves a complete image of the Windows drive that can be put back from Windows recovery, even if Windows will not start.', usedBytes: used, targets };
    }
    if (mac) {
      const d = await run('tmutil', ['destinationinfo']);
      const has = d.ok && /Name\s*:/.test(d.out);
      return { supported: has, method: 'Time Machine', note: has ? 'Starts a Time Machine backup to the drive already set up for it and waits for it to finish.' : 'Time Machine has no backup drive set up. Connect a drive and choose it in System Settings > General > Time Machine, then come back.', usedBytes: 0, targets: has ? [{ id: 'tm', label: 'The Time Machine drive', freeBytes: 0, ok: true }] : [] };
    }
    const has = onPath('timeshift');
    return { supported: has, method: 'Timeshift snapshot', note: has ? 'Takes a Timeshift snapshot of the system (not your personal files) that can be rolled back from Timeshift or a live USB.' : 'Install Timeshift from Tools and set it up once, then come back. For a full disk image, use Clonezilla or Rescuezilla from the ISO Library.', usedBytes: 0, targets: has ? [{ id: 'ts', label: 'The Timeshift snapshot location', freeBytes: 0, ok: true }] : [] };
  };
  ipcMain.handle('image-info', imageInfo);
  ipcMain.handle('image-start', async (_e, id: string) => {
    const info = await imageInfo();
    const t = info.targets.find((x) => x.id === String(id) && x.ok);
    if (!t) throw new Error('Choose a drive from the list');
    const base = { description: '', admin: true, heavy: true, timeoutMinutes: 600, typicalMinutes: 60 };
    let def: CommandDef;
    if (win32) {
      def = { ...base, id: 'system-image', name: 'Create a system image', exec: 'wbadmin.exe', args: ['start', 'backup', `-backupTarget:${t.id}:`, `-include:${(process.env.SystemDrive ?? 'C:').slice(0, 2)}`, '-allCritical', '-quiet'], friendly: { title: 'System image', ok: `A complete image of this computer was saved to drive ${t.id}: in the WindowsImageBackup folder.`, problem: 'The system image could not be created.', notes: [{ pattern: 'not enough (disk )?space|insufficient', level: 'problem', message: 'The backup drive does not have enough free space.' }, { pattern: 'access is denied|elevated', level: 'problem', message: 'Run MendKit as administrator to create a system image.' }] } };
    } else if (mac) {
      def = { ...base, admin: false, id: 'system-image', name: 'Time Machine backup', exec: 'tmutil', args: ['startbackup', '--block'], friendly: { title: 'Time Machine backup', ok: 'A Time Machine backup finished.', problem: 'The Time Machine backup did not finish.' } };
    } else {
      def = { ...base, id: 'system-image', name: 'Timeshift snapshot', exec: 'timeshift', args: ['--create', '--comments', 'MendKit before repair', '--scripted'], friendly: { title: 'Timeshift snapshot', ok: 'A Timeshift snapshot named "MendKit before repair" was created.', problem: 'The snapshot could not be created. Open Timeshift once to finish its setup.' } };
    }
    return engine.runSteps('system-image', 'Backup image before repair', 'command', [def], opts());
  });

  // ---------- Secure wipe: chosen files and folders ----------
  let picked: string[] = [];
  let stop = false;
  const pickedInfo = () => picked.map((p) => ({ path: p, ...measure(p), blocked: isProtected(p, [app.getAppPath(), app.getPath('userData')]) }));
  ipcMain.handle('wipe-pick', async (_e, kind: string) => {
    const r = process.env.MENDKIT_TEST_PICK ? { canceled: false, filePaths: [process.env.MENDKIT_TEST_PICK] } : await dialog.showOpenDialog(ctx.getWin()!, { title: kind === 'folder' ? 'Choose a folder to erase' : 'Choose files to erase', properties: kind === 'folder' ? ['openDirectory'] : ['openFile', 'multiSelections'] });
    if (!r.canceled) for (const p of r.filePaths) if (!picked.includes(p)) picked.push(p);
    return pickedInfo();
  });
  ipcMain.handle('wipe-clear', () => {
    picked = [];
    return [];
  });
  ipcMain.handle('wipe-cancel', () => {
    stop = true;
    engine.cancel();
  });
  ipcMain.handle('wipe-files-start', async (_e, confirm: string): Promise<RunSummary> => {
    if (String(confirm) !== 'ERASE') throw new Error('Type ERASE to confirm');
    const info = pickedInfo().filter((i) => !i.blocked);
    if (!info.length) throw new Error('Choose files or a folder first');
    const total = info.reduce((n, i) => n + i.bytes, 0);
    stop = false;
    const step: ActionStep = {
      id: 'secure-erase-files',
      name: 'Erase the chosen files',
      admin: false,
      ok: 'The chosen files were overwritten and deleted.',
      problem: 'Some files could not be erased.',
      action: async (write) => {
        let last = 0;
        const r = await shredPaths(info.map((i) => i.path), (done) => {
          if (Date.now() - last < 1500) return;
          last = Date.now();
          write(`${total ? ((done.bytes / total) * 100).toFixed(1) : 100}%  ${done.files} files erased\n`);
        }, () => stop);
        for (const f of r.failed) write(`Could not erase ${f.file}: ${f.reason}\n`);
        write(`${r.erased} files (${gb(r.bytes)}) overwritten and deleted.\n`);
        return { ok: !r.failed.length && !stop, note: r.failed.length ? `${r.erased} files were erased. ${r.failed.length} could not be erased; the full log lists them.` : `${r.erased} files (${gb(r.bytes)}) were overwritten with random data and deleted.` };
      },
    };
    const s = await engine.runSteps('secure-erase-files', 'Secure erase: files', 'command', [step], opts());
    picked = [];
    return s;
  });

  // ---------- Secure wipe: free space ----------
  const freeTargets = async (): Promise<{ id: string; label: string; dir: string }[]> => {
    if (win32) {
      const r = await powershellScript(`Get-Volume | Where-Object { $_.DriveLetter -and ([string]$_.DriveType) -in 'Fixed','Removable' } | ForEach-Object { [pscustomobject]@{letter=[string]$_.DriveLetter; label=$_.FileSystemLabel; free=$_.SizeRemaining} } | ConvertTo-Json -Compress`);
      return arr(r).map((v: any) => ({ id: String(v.letter).slice(0, 1).toUpperCase(), label: `${v.letter}: ${v.label || 'Drive'} (${gb(Number(v.free) || 0)} free)`, dir: `${String(v.letter).slice(0, 1).toUpperCase()}:\\` }));
    }
    const out = [{ id: 'home', label: 'The drive with your files', dir: os.homedir() }];
    const bases = mac ? ['/Volumes'] : [`/media/${os.userInfo().username}`, `/run/media/${os.userInfo().username}`, '/mnt'];
    for (const b of bases) {
      try {
        for (const n of fs.readdirSync(b)) {
          const dir = path.join(b, n);
          if (fs.statSync(dir).isDirectory() && fs.statSync(dir).dev !== fs.statSync(os.homedir()).dev && fs.statSync(dir).dev !== fs.statSync(b).dev) out.push({ id: dir, label: n, dir });
        }
      } catch {
        /* not present */
      }
    }
    return out.map((t) => {
      try {
        const st = fs.statfsSync(t.dir);
        return { ...t, label: `${t.label} (${gb(st.bavail * st.bsize)} free)` };
      } catch {
        return t;
      }
    });
  };
  ipcMain.handle('wipe-free-targets', async () => (await freeTargets()).map(({ id, label }) => ({ id, label })));
  ipcMain.handle('wipe-free-start', async (_e, id: string): Promise<RunSummary> => {
    const t = (await freeTargets()).find((x) => x.id === String(id));
    if (!t) throw new Error('Choose a drive from the list');
    stop = false;
    if (win32) {
      const def: CommandDef = { id: 'wipe-free-space', name: `Overwrite free space on ${t.id}:`, description: '', exec: 'cipher.exe', args: [`/w:${t.dir}`], admin: false, heavy: true, timeoutMinutes: 2880, typicalMinutes: 60, friendly: { title: 'Free space', ok: `The free space on drive ${t.id}: was overwritten three times. Files deleted earlier can no longer be recovered from it.`, problem: 'The free space could not be overwritten.' } };
      return engine.runSteps('wipe-free-space', 'Secure erase: free space', 'command', [def], opts());
    }
    const step: ActionStep = {
      id: 'wipe-free-space',
      name: 'Overwrite free space',
      admin: false,
      ok: 'The free space was overwritten. Files deleted earlier can no longer be recovered from it.',
      problem: 'The free space could not be overwritten.',
      action: async (write) => {
        let last = 0;
        const max = Number(process.env.MENDKIT_TEST_WIPE_BYTES) || Infinity;
        const r = await wipeFreeSpace(t.dir, (w, total) => {
          if (Date.now() - last < 1500) return;
          last = Date.now();
          write(`${total ? ((w / total) * 100).toFixed(1) : 100}%  ${gb(w)} written\n`);
        }, () => stop, undefined, max);
        write(`${gb(r.written)} of free space overwritten with zeros.\n`);
        return { ok: !stop, note: `${gb(r.written)} of free space was overwritten with zeros.` };
      },
    };
    return engine.runSteps('wipe-free-space', 'Secure erase: free space', 'command', [step], opts());
  });

  // ---------- Secure wipe: a whole drive that is not the system drive ----------
  const wipeDrives = async (): Promise<WipeDrive[]> => {
    if (win32) {
      const r = await powershellScript(`
$ErrorActionPreference='SilentlyContinue'
Get-Disk | ForEach-Object { $d=$_; $l=@(Get-Partition -DiskNumber $d.Number | Where-Object DriveLetter | ForEach-Object { [string]$_.DriveLetter }); [pscustomobject]@{number=$d.Number; name=$d.FriendlyName; size=$d.Size; bus=[string]$d.BusType; boot=[bool]$d.IsBoot; system=[bool]$d.IsSystem; letters=$l} } | ConvertTo-Json -Depth 3 -Compress`);
      const keep = new Set([(process.env.SystemDrive ?? 'C:').slice(0, 1).toUpperCase(), app.getAppPath().slice(0, 1).toUpperCase(), app.getPath('userData').slice(0, 1).toUpperCase(), os.homedir().slice(0, 1).toUpperCase()]);
      return arr(r)
        .filter((d: any) => d && d.boot !== true && d.system !== true && Number.isInteger(d.number) && !arr(d.letters).some((l: any) => keep.has(String(l).toUpperCase())))
        .map((d: any) => ({ id: String(d.number), name: String(d.name || 'Drive'), size: Number(d.size) || 0, detail: `Disk ${d.number}, ${d.bus || 'unknown connection'}${arr(d.letters).length ? `, drive ${arr(d.letters).map((l: any) => `${l}:`).join(' ')}` : ', no drive letter'}`, mounts: [] }));
    }
    if (mac) {
      const r = await run('diskutil', ['list', 'external', 'physical']);
      const out: WipeDrive[] = [];
      for (const block of r.out.split(/\n(?=\/dev\/disk)/)) {
        const m = /^\/dev\/(disk\d+)/.exec(block);
        if (!m) continue;
        const size = /\*([\d.]+) (GB|TB|MB)/.exec(block);
        const bytes = size ? Number(size[1]) * (size[2] === 'TB' ? 1e12 : size[2] === 'GB' ? 1e9 : 1e6) : 0;
        out.push({ id: m[1], name: `External drive ${m[1]}`, size: bytes, detail: `/dev/${m[1]}`, mounts: [] });
      }
      return out;
    }
    const r = await run('lsblk', ['-J', '-b', '-o', 'NAME,PATH,SIZE,TYPE,MOUNTPOINT,RM,HOTPLUG,MODEL,TRAN']);
    let data: any;
    try {
      data = JSON.parse(r.out);
    } catch {
      return [];
    }
    const on = (v: any) => v === true || v === '1' || v === 1;
    const mounts = (d: any): string[] => [d.mountpoint, ...arr(d.children).flatMap(mounts)].filter(Boolean);
    const parts = (d: any): any[] => [d, ...arr(d.children).flatMap(parts)];
    const sys = (m: string) => m === '/' || m === '[SWAP]' || /^\/(boot|home|usr|var|etc|opt|snap)(\/|$)/.test(m);
    return arr(data?.blockdevices)
      .filter((d: any) => d.type === 'disk' && (on(d.rm) || on(d.hotplug) || d.tran === 'usb') && !mounts(d).some(sys) && /^\/dev\/[a-z0-9]+$/.test(String(d.path)))
      .map((d: any) => ({ id: String(d.path), name: String(d.model || 'Removable drive').trim(), size: Number(d.size) || 0, detail: `${d.path}${d.tran ? `, ${d.tran}` : ''}`, mounts: parts(d).filter((p) => p.mountpoint).map((p) => String(p.path)) }));
  };
  ipcMain.handle('wipe-drives', async () => (await wipeDrives()).map((d) => ({ id: d.id, name: d.name, size: gb(d.size), detail: d.detail })));
  ipcMain.handle('wipe-drive-start', async (_e, id: string, confirm: string): Promise<RunSummary> => {
    if (String(confirm) !== 'ERASE') throw new Error('Type ERASE to confirm');
    // The list is read again here, so only a drive that is safe to erase right now can be named.
    const d = (await wipeDrives()).find((x) => x.id === String(id));
    if (!d) throw new Error('That drive is no longer connected, or it is not one MendKit will erase');
    const minutes = Math.max(10, Math.round(d.size / 1024 ** 3 / 2));
    const base = { description: '', admin: true, heavy: true, timeoutMinutes: 4320, typicalMinutes: minutes };
    const ok = `Every part of "${d.name}" (${gb(d.size)}) was overwritten with zeros. Nothing that was on it can be recovered with software.`;
    const steps: CommandDef[] = [];
    if (win32) {
      const script = path.join(app.getPath('temp'), `mendkit-wipe-${Date.now()}.txt`);
      fs.writeFileSync(script, [`select disk ${Number(d.id)}`, 'clean all', 'convert gpt noerr', 'create partition primary', 'format fs=exfat quick label=WIPED', 'assign', 'exit', ''].join('\r\n'));
      steps.push({ ...base, id: 'wipe-drive', name: `Erase ${d.name}`, exec: 'diskpart.exe', args: ['/s', script], friendly: { title: 'Drive erased', ok: `${ok} It was then formatted as an empty exFAT drive named WIPED.`, problem: 'The drive could not be erased.', notes: [{ pattern: 'access is denied|administrator', level: 'problem', message: 'Run MendKit as administrator to erase a drive.' }, { pattern: 'write.protect', level: 'problem', message: 'The drive is write-protected. Check for a lock switch on it.' }] } });
    } else if (mac) {
      steps.push({ ...base, id: 'wipe-unmount', name: 'Release the drive', exec: 'diskutil', args: ['unmountDisk', `/dev/${d.id}`], typicalMinutes: 1, friendly: { title: 'Drive released', ok: 'The drive was released for erasing.', problem: 'The drive is in use and could not be released.' } });
      steps.push({ ...base, id: 'wipe-drive', name: `Erase ${d.name}`, exec: 'diskutil', args: ['secureErase', '0', `/dev/${d.id}`], friendly: { title: 'Drive erased', ok, problem: 'The drive could not be erased.' } });
    } else {
      d.mounts.forEach((m, i) => steps.push({ ...base, id: `wipe-unmount-${i}`, name: `Release ${m}`, exec: 'umount', args: [m], typicalMinutes: 1, friendly: { title: 'Drive released', ok: `${m} was released for erasing.`, problem: `${m} is in use and could not be released.` } }));
      steps.push({ ...base, id: 'wipe-drive', name: `Erase ${d.name}`, exec: 'shred', args: ['-v', '-n', '0', '-z', d.id], friendly: { title: 'Drive erased', ok: `${ok} It is now blank; format it in Disks before using it again.`, problem: 'The drive could not be erased.' } });
    }
    return engine.runSteps('wipe-drive', `Secure erase: ${d.name}`, 'command', steps, opts());
  });
  ipcMain.handle('wipe-open-reset', () => {
    if (!win32) return false;
    spawn('systemreset.exe', ['-factoryreset'], { detached: true, stdio: 'ignore', windowsHide: false }).on('error', () => undefined).unref();
    return true;
  });

  // ---------- Crash analyzer ----------
  const since = () => Date.now() - DAYS * 86400000;
  const crashEvents = async (): Promise<CrashEvent[]> => {
    if (process.env.MENDKIT_TEST_CRASH) return JSON.parse(fs.readFileSync(process.env.MENDKIT_TEST_CRASH, 'utf8'));
    const out: CrashEvent[] = [];
    if (win32) {
      const r = await powershellScript(`
$ErrorActionPreference='SilentlyContinue'
$since=(Get-Date).AddDays(-${DAYS})
$script:out=@()
function AddEv($k,$e,$subj,$detail){ $script:out += [pscustomobject]@{kind=$k; time=$e.TimeCreated.ToUniversalTime().ToString('o'); subject=[string]$subj; detail=[string]$detail} }
Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Microsoft-Windows-WER-SystemErrorReporting'; Id=1001; StartTime=$since} | ForEach-Object { AddEv 'bluescreen' $_ '' $_.Message }
Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Microsoft-Windows-Kernel-Power'; Id=41; StartTime=$since} | ForEach-Object { AddEv 'power-loss' $_ '' '' }
Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='Microsoft-Windows-WHEA-Logger'; StartTime=$since} -MaxEvents 50 | Where-Object { $_.Level -le 3 } | ForEach-Object { AddEv 'hardware-error' $_ '' (($_.Message -split "\`n")[0]) }
Get-WinEvent -FilterHashtable @{LogName='System'; ProviderName='disk','Ntfs','stornvme','storahci'; Level=1,2; StartTime=$since} -MaxEvents 50 | ForEach-Object { AddEv 'disk-error' $_ $_.ProviderName (($_.Message -split "\`n")[0]) }
Get-WinEvent -FilterHashtable @{LogName='Application'; ProviderName='Application Error'; Id=1000; StartTime=$since} -MaxEvents 200 | ForEach-Object { AddEv 'app-crash' $_ $_.Properties[0].Value $_.Properties[3].Value }
Get-WinEvent -FilterHashtable @{LogName='Application'; ProviderName='Application Hang'; Id=1002; StartTime=$since} -MaxEvents 200 | ForEach-Object { AddEv 'app-hang' $_ $_.Properties[0].Value '' }
$dumps=@(Get-ChildItem "$env:SystemRoot\\Minidump\\*.dmp" | Where-Object { $_.LastWriteTime -gt $since } | ForEach-Object { $b=New-Object byte[] 96; $f=[IO.File]::OpenRead($_.FullName); [void]$f.Read($b,0,96); $f.Close(); [pscustomobject]@{time=$_.LastWriteTimeUtc.ToString('o'); head=[Convert]::ToBase64String($b)} })
@{events=$script:out; dumps=$dumps} | ConvertTo-Json -Depth 4 -Compress`, 90000);
      for (const e of arr(r?.events)) {
        const ev: CrashEvent = { time: String(e.time), kind: e.kind, subject: e.subject || undefined, detail: e.detail || undefined };
        if (ev.kind === 'bluescreen') {
          const code = parseBugcheckMessage(ev.detail ?? '');
          if (code !== null) ev.code = code;
          ev.detail = undefined;
        }
        out.push(ev);
      }
      for (const d of arr(r?.dumps)) {
        const h = parseDumpHeader(Buffer.from(String(d.head), 'base64'));
        if (!h) continue;
        const near = out.find((e) => e.kind === 'bluescreen' && Math.abs(Date.parse(e.time) - Date.parse(d.time)) < 15 * 60 * 1000);
        if (near) near.code ??= h.code;
        else out.push({ time: String(d.time), kind: 'bluescreen', code: h.code });
      }
      return out;
    }
    if (mac) {
      for (const dir of ['/Library/Logs/DiagnosticReports', path.join(os.homedir(), 'Library/Logs/DiagnosticReports')]) {
        let names: string[] = [];
        try {
          names = fs.readdirSync(dir);
        } catch {
          continue;
        }
        for (const n of names) {
          const ext = path.extname(n).toLowerCase();
          const kind = ext === '.panic' || /^(kernel|panic)/i.test(n) ? 'kernel-panic' : ext === '.crash' || ext === '.ips' ? 'app-crash' : ext === '.hang' || ext === '.spin' ? 'app-hang' : null;
          if (!kind) continue;
          try {
            const st = fs.statSync(path.join(dir, n));
            if (st.mtimeMs < since()) continue;
            out.push({ time: st.mtime.toISOString(), kind, subject: kind === 'kernel-panic' ? undefined : (/^(.+?)[-_]\d{4}-\d{2}-\d{2}/.exec(n)?.[1] ?? n) });
          } catch {
            /* unreadable */
          }
        }
      }
      return out;
    }
    const j = await run('journalctl', ['-k', `--since=-${DAYS}days`, '--no-pager', '-o', 'short-iso'], 60000);
    const seen = new Set<string>();
    for (const line of j.out.split('\n')) {
      const t = Date.parse(line.slice(0, 24).split(' ')[0]);
      if (!t) continue;
      const text = line.replace(/^\S+ \S+ kernel: /, '');
      let ev: CrashEvent | null = null;
      const oom = /Out of memory: Killed process \d+ \(([^)]+)\)/.exec(line);
      if (/Kernel panic/.test(line) || /Oops:|BUG: unable to handle|general protection fault/.test(line)) ev = { time: '', kind: 'kernel-panic', detail: text.slice(0, 160) };
      else if (oom) ev = { time: '', kind: 'out-of-memory', subject: oom[1] };
      else if (/mce: \[Hardware Error\]|Machine check events logged/.test(line)) ev = { time: '', kind: 'hardware-error', detail: text.slice(0, 160) };
      else if (/I\/O error, dev|critical medium error|ata\d+(\.\d+)?: failed command|Buffer I\/O error/.test(line)) ev = { time: '', kind: 'disk-error', detail: text.slice(0, 160) };
      if (!ev) continue;
      const key = `${ev.kind}${Math.floor(t / 600000)}`; // one record per kind per ten minutes
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...ev, time: new Date(t).toISOString() });
    }
    if (onPath('coredumpctl')) {
      const c = await run('coredumpctl', ['list', `--since=-${DAYS}days`, '--no-pager', '--no-legend'], 30000);
      for (const line of c.out.split('\n')) {
        const tok = line.trim().split(/\s+/);
        const exe = tok.find((x) => x.startsWith('/'));
        const t = Date.parse(`${tok[1]}T${tok[2]}`);
        if (exe && t) out.push({ time: new Date(t).toISOString(), kind: 'app-crash', subject: path.basename(exe), detail: tok.find((x) => /^SIG/.test(x)) });
      }
    }
    return out;
  };
  ipcMain.handle('crash-scan', async () => ({ ...analyse(await crashEvents(), DAYS, process.platform), elevated: isElevated() }));
  ipcMain.handle('crash-memtest', () => {
    if (!win32) return false;
    spawn('mdsched.exe', [], { detached: true, stdio: 'ignore' }).on('error', () => undefined).unref();
    return true;
  });
}
