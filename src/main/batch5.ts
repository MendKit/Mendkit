import { app, BrowserWindow, dialog, ipcMain, net, shell } from 'electron';
import { execFile, spawn } from 'child_process';
import * as dns from 'dns';
import * as fs from 'fs';
// Electron's fs treats .asar archives as folders; the plain one copies them as the files they are.
import * as ofs from 'original-fs';
import * as os from 'os';
import * as path from 'path';
import { onPath } from '../engine/catalog';
import { ActionStep, Engine } from '../engine/runner';
import { RunSummary } from '../engine/types';
import { isElevated, powershellScript } from './system';
import { cacheSummary } from './offline';

/** Portable copy, technician USB, offline detection, the reinstall assistant and scheduled jobs. */

const run = (cmd: string, args: string[], timeout = 30000): Promise<{ ok: boolean; out: string }> =>
  new Promise((resolve) => execFile(cmd, args, { windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}${stderr}` })));
const gb = (b: number): string => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1024 ** 2))} MB`);

/** A portable copy keeps its settings, logs and undo records beside the app instead of in the user's profile. */
export function applyPortableMode(): boolean {
  // Run from source the marker sits in the app folder; in an installed build it sits beside the program file.
  // The single-file Windows portable build unpacks to a temp folder and names its real location in an environment variable.
  const single = process.env.PORTABLE_EXECUTABLE_DIR;
  const root = app.isPackaged ? path.dirname(process.execPath) : app.getAppPath();
  if (!single && !fs.existsSync(path.join(root, 'portable')) && !process.argv.includes('--portable')) return false;
  const data = single ? path.join(single, 'MendKitData') : path.join(path.dirname(root), 'MendKitData');
  try {
    fs.mkdirSync(data, { recursive: true });
    fs.accessSync(data, fs.constants.W_OK);
    app.setPath('userData', data);
    return true;
  } catch {
    return false; // read-only media: fall back to the normal location
  }
}

// ---------- Weekly or monthly jobs through the system's own scheduler ----------
export interface Job {
  /** Short id used in file and task names. */
  id: string;
  label: string;
  args: string[];
  /** Windows day name (MON...) for a weekly job. */
  weekday: 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';
  time: string;
}
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const jobFiles = (j: Job) => ({ plist: path.join(os.homedir(), 'Library', 'LaunchAgents', `com.mendkit.${j.id}.plist`), unitDir: path.join(os.homedir(), '.config', 'systemd', 'user'), unit: `mendkit-${j.id}` });
export const jobsSupported = (): boolean => process.platform === 'win32' || process.platform === 'darwin' || (process.platform === 'linux' && onPath('systemctl'));

export async function jobScheduled(j: Job): Promise<boolean> {
  const f = jobFiles(j);
  if (process.platform === 'win32') return (await run('schtasks.exe', ['/Query', '/TN', j.label])).ok;
  if (process.platform === 'darwin') return fs.existsSync(f.plist);
  return fs.existsSync(path.join(f.unitDir, `${f.unit}.timer`));
}

export async function scheduleJob(j: Job, on: boolean): Promise<void> {
  if (!jobsSupported()) throw new Error('Scheduling is not available on this system');
  const f = jobFiles(j);
  const argv = [process.execPath, ...(app.isPackaged ? [] : [app.getAppPath()]), ...j.args];
  const [hh, mm] = j.time.split(':').map(Number);
  if (process.platform === 'win32') {
    if (!on) {
      await run('schtasks.exe', ['/Delete', '/TN', j.label, '/F']);
      return;
    }
    const tr = argv.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
    const r = await run('schtasks.exe', ['/Create', '/TN', j.label, '/TR', tr, '/SC', 'WEEKLY', '/D', j.weekday, '/ST', j.time, '/F']);
    if (!r.ok) throw new Error(r.out.trim() || 'The scheduled task could not be created');
  } else if (process.platform === 'darwin') {
    await run('launchctl', ['unload', f.plist]);
    fs.rmSync(f.plist, { force: true });
    if (!on) return;
    const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    fs.mkdirSync(path.dirname(f.plist), { recursive: true });
    fs.writeFileSync(f.plist, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>com.mendkit.${j.id}</string>\n<key>ProgramArguments</key><array>${argv.map((a) => `<string>${x(a)}</string>`).join('')}</array>\n<key>StartCalendarInterval</key><dict><key>Weekday</key><integer>${DAYS.indexOf(j.weekday)}</integer><key>Hour</key><integer>${hh}</integer><key>Minute</key><integer>${mm}</integer></dict>\n</dict></plist>\n`);
    const r = await run('launchctl', ['load', '-w', f.plist]);
    if (!r.ok) throw new Error(r.out.trim() || 'The schedule could not be loaded');
  } else {
    await run('systemctl', ['--user', 'disable', '--now', `${f.unit}.timer`]);
    for (const ext of ['service', 'timer']) fs.rmSync(path.join(f.unitDir, `${f.unit}.${ext}`), { force: true });
    if (!on) return;
    fs.mkdirSync(f.unitDir, { recursive: true });
    const q = (s: string) => `"${s.replace(/(["\\$`])/g, '\\$1')}"`;
    const day = j.weekday[0] + j.weekday.slice(1).toLowerCase();
    fs.writeFileSync(path.join(f.unitDir, `${f.unit}.service`), `[Unit]\nDescription=${j.label}\n\n[Service]\nType=oneshot\nExecStart=${argv.map(q).join(' ')}\n`);
    fs.writeFileSync(path.join(f.unitDir, `${f.unit}.timer`), `[Unit]\nDescription=${j.label}\n\n[Timer]\nOnCalendar=${day} *-*-* ${j.time}:00\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n`);
    await run('systemctl', ['--user', 'daemon-reload']);
    const r = await run('systemctl', ['--user', 'enable', '--now', `${f.unit}.timer`]);
    if (!r.ok) throw new Error(r.out.trim() || 'The timer could not be enabled');
  }
}

// ---------- Copying with progress ----------
interface CopyResult {
  files: number;
  bytes: number;
  failed: string[];
}
function treeSize(root: string, skip: (rel: string, name: string) => boolean): number {
  let total = 0;
  const stack = [''];
  while (stack.length) {
    const rel = stack.pop()!;
    let entries: ofs.Dirent[];
    try {
      entries = ofs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (skip(rel, e.name)) continue;
      const r = rel ? path.join(rel, e.name) : e.name;
      if (e.isDirectory()) stack.push(r);
      else if (e.isFile()) total += ofs.statSync(path.join(root, r)).size;
    }
  }
  return total;
}
async function copyTree(src: string, dst: string, skip: (rel: string, name: string) => boolean, onBytes: (n: number) => void, shouldStop: () => boolean): Promise<CopyResult> {
  const out: CopyResult = { files: 0, bytes: 0, failed: [] };
  const stack = [''];
  while (stack.length && !shouldStop()) {
    const rel = stack.pop()!;
    await ofs.promises.mkdir(path.join(dst, rel), { recursive: true });
    for (const e of await ofs.promises.readdir(path.join(src, rel), { withFileTypes: true })) {
      if (shouldStop()) break;
      if (skip(rel, e.name)) continue;
      const r = rel ? path.join(rel, e.name) : e.name;
      try {
        if (e.isDirectory()) stack.push(r);
        else if (e.isSymbolicLink()) {
          await ofs.promises.rm(path.join(dst, r), { force: true });
          await ofs.promises.symlink(await ofs.promises.readlink(path.join(src, r)), path.join(dst, r));
        } else if (e.isFile()) {
          const st = await ofs.promises.stat(path.join(src, r));
          let same = false;
          try {
            const d = await ofs.promises.stat(path.join(dst, r));
            same = d.size === st.size && Math.abs(d.mtimeMs - st.mtimeMs) < 2500;
          } catch {
            /* not there yet */
          }
          if (!same) {
            await ofs.promises.copyFile(path.join(src, r), path.join(dst, r));
            await ofs.promises.utimes(path.join(dst, r), st.atime, st.mtime).catch(() => undefined);
          }
          out.files++;
          out.bytes += st.size;
          onBytes(st.size);
        }
      } catch (err) {
        out.failed.push(`${r}: ${(err as Error).message}`);
        if ((err as NodeJS.ErrnoException).code === 'ENOSPC') return out;
      }
    }
  }
  return out;
}

export function registerBatch5(ctx: { engine: Engine; getWin: () => BrowserWindow | null; portable: boolean }): void {
  const { engine } = ctx;
  const win32 = process.platform === 'win32';
  const mac = process.platform === 'darwin';
  const opts = () => ({ elevated: isElevated() });
  let stop = false;
  ipcMain.handle('usb-cancel', () => {
    stop = true;
    engine.cancel();
  });

  // ---------- Online check ----------
  ipcMain.handle('online', async () => {
    if (process.env.MENDKIT_TEST_OFFLINE) return false;
    if (!net.isOnline()) return false;
    const tryHost = (h: string) => Promise.race([dns.promises.lookup(h).then(() => true, () => false), new Promise<boolean>((r) => setTimeout(() => r(false), 4000))]);
    return (await Promise.all(['github.com', 'microsoft.com'].map(tryHost))).some(Boolean);
  });

  // ---------- Portable copy and technician USB ----------
  // From source: the project folder plus its Electron runtime. Installed: the whole program folder.
  const packaged = app.isPackaged;
  const appRoot = packaged ? path.dirname(process.execPath) : app.getAppPath();
  const electronDist = packaged ? appRoot : path.join(appRoot, 'node_modules', 'electron', 'dist');
  const skipApp = (rel: string, name: string) => name === '.git' || name === '.bin' || name === 'portable' || (rel === '' && (name === 'logs' || name === 'MendKitData')) || /\.(map|md)$/i.test(name) && rel.startsWith('node_modules');
  let usbDir: string | null = null;
  let isoFiles: string[] = [];
  const downloadsIsos = (): string[] => {
    try {
      const out = new Set<string>();
      for (const d of [app.getPath('downloads'), path.join(os.homedir(), 'Downloads')]) {
        try {
          for (const n of fs.readdirSync(d)) if (/\.(iso|img)$/i.test(n)) out.add(path.join(d, n));
        } catch {
          /* no such folder */
        }
      }
      return [...out];
    } catch {
      return [];
    }
  };
  const isoInfo = () => isoFiles.filter((f) => fs.existsSync(f)).map((f) => ({ path: f, name: path.basename(f), size: gb(fs.statSync(f).size) }));
  let appSize: string | null = null;
  ipcMain.handle('usb-info', () => {
    if (!isoFiles.length) isoFiles = downloadsIsos();
    appSize ??= gb(treeSize(appRoot, skipApp));
    const cs = cacheSummary();
    return { cache: { count: cs.count, size: cs.size ? gb(cs.size) : '' }, portable: ctx.portable, canCopyApp: packaged ? !mac && !process.env.PORTABLE_EXECUTABLE_DIR && !process.env.APPIMAGE : fs.existsSync(electronDist) && fs.existsSync(path.join(appRoot, 'dist')), appSize, system: win32 ? 'Windows' : mac ? 'macOS' : 'Linux', isos: isoInfo(), dataDir: app.getPath('userData') };
  });
  ipcMain.handle('usb-add-isos', async () => {
    const r = await dialog.showOpenDialog(ctx.getWin()!, { title: 'Choose ISO files to put on the stick', defaultPath: app.getPath('downloads'), properties: ['openFile', 'multiSelections'], filters: [{ name: 'Disc images', extensions: ['iso', 'img'] }] });
    if (!r.canceled) for (const f of r.filePaths) if (!isoFiles.includes(f)) isoFiles.push(f);
    return isoInfo();
  });
  ipcMain.handle('usb-pick', async () => {
    const r = process.env.MENDKIT_TEST_USB ? { canceled: false, filePaths: [process.env.MENDKIT_TEST_USB] } : await dialog.showOpenDialog(ctx.getWin()!, { title: 'Choose the USB stick or drive', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const dir = r.filePaths[0];
    const inside = path.relative(appRoot, dir);
    if (!inside || (!inside.startsWith('..') && !path.isAbsolute(inside))) throw new Error('Choose a folder outside MendKit\'s own folder');
    usbDir = dir;
    let free = 0;
    try {
      const st = fs.statfsSync(dir);
      free = st.bavail * st.bsize;
    } catch {
      /* unknown */
    }
    let label = path.basename(dir);
    if (win32) {
      const v = await powershellScript(`Get-Volume -DriveLetter '${dir.slice(0, 1).replace(/[^A-Za-z]/g, '')}' | Select-Object FileSystemLabel,FileSystem | ConvertTo-Json -Compress`);
      label = String(v?.FileSystemLabel ?? '');
    }
    return { dir, free: gb(free), freeBytes: free, ventoy: /^ventoy$/i.test(label) };
  });
  ipcMain.handle('usb-build', async (_e, withApp: boolean, isoNames: string[], withCache?: boolean): Promise<RunSummary> => {
    if (!usbDir || !fs.existsSync(usbDir)) throw new Error('Choose the USB stick first');
    const dir = usbDir;
    const want = new Set(Array.isArray(isoNames) ? isoNames.map(String) : []);
    const isos = isoFiles.filter((f) => want.has(f) && fs.existsSync(f));
    if (!withApp && !isos.length) throw new Error('Tick MendKit or at least one ISO file');
    stop = false;
    const steps: ActionStep[] = [];
    const progress = (write: (t: string) => void, total: number) => {
      let done = 0;
      let last = 0;
      return (n: number) => {
        done += n;
        if (Date.now() - last < 1500) return;
        last = Date.now();
        write(`${total ? ((done / total) * 100).toFixed(1) : 100}%  ${gb(done)} copied\n`);
      };
    };
    if (withApp === true) {
      steps.push({
        id: 'usb-portable',
        name: 'Copy portable MendKit',
        admin: false,
        ok: 'A portable copy of MendKit is on the drive.',
        problem: 'MendKit could not be copied to the drive.',
        action: async (write) => {
          if (!fs.existsSync(electronDist)) return { ok: false, note: 'This copy of MendKit has no runtime to take along. Run "npm install" in its folder first.' };
          const base = path.join(dir, 'MendKit');
          const r = await copyTree(appRoot, path.join(base, 'app'), skipApp, progress(write, treeSize(appRoot, skipApp)), () => stop);
          if (stop) return { ok: false, note: 'Cancelled.' };
          fs.writeFileSync(path.join(base, 'app', 'portable'), 'MendKit keeps its data in the MendKitData folder beside this app folder.\n');
          fs.mkdirSync(path.join(base, 'MendKitData'), { recursive: true });
          let starter: string;
          const exe = path.basename(process.execPath);
          if (packaged && win32) {
            starter = 'Start MendKit.cmd';
            fs.writeFileSync(path.join(base, starter), `@echo off\r\ncd /d "%~dp0app"\r\nstart "" "${exe}"\r\n`);
          } else if (packaged && mac) {
            starter = 'Start MendKit.command';
            fs.writeFileSync(path.join(base, starter), `#!/bin/sh\ncd "$(dirname "$0")/app" || exit 1\nexec "./${exe}"\n`, { mode: 0o755 });
          } else if (packaged) {
            starter = 'start-mendkit.sh';
            fs.writeFileSync(path.join(base, starter), `#!/bin/sh\ncd "$(dirname "$0")/app" || exit 1\nexec "./${exe}" "$@"\n`, { mode: 0o755 });
          } else if (win32) {
            starter = 'Start MendKit.cmd';
            fs.writeFileSync(path.join(base, starter), '@echo off\r\ncd /d "%~dp0app"\r\nstart "" "node_modules\\electron\\dist\\electron.exe" .\r\n');
          } else if (mac) {
            starter = 'Start MendKit.command';
            fs.writeFileSync(path.join(base, starter), '#!/bin/sh\ncd "$(dirname "$0")/app" || exit 1\nexec node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .\n', { mode: 0o755 });
          } else {
            starter = 'start-mendkit.sh';
            fs.writeFileSync(path.join(base, starter), '#!/bin/sh\ncd "$(dirname "$0")/app" || exit 1\nexec node_modules/electron/dist/electron . "$@"\n', { mode: 0o755 });
          }
          for (const f of r.failed.slice(0, 20)) write(`Could not copy ${f}\n`);
          write(`${r.files} files (${gb(r.bytes)}) copied to ${base}\n`);
          const sys = win32 ? 'Windows' : mac ? 'macOS' : 'Linux';
          return { ok: !r.failed.length, note: r.failed.length ? `${r.failed.length} files could not be copied${mac ? ' (a Mac copy needs a Mac-formatted drive, not FAT or exFAT)' : ''}. The full log lists them.` : `Open the MendKit folder on the drive and start "${starter}". This copy runs on ${sys} computers, with nothing to install, and keeps its logs on the drive.` };
        },
      });
    }
    const cs = cacheSummary();
    if (withApp === true && withCache === true && cs.count) {
      steps.push({
        id: 'usb-cache',
        name: `Copy ${cs.count} offline installers`,
        admin: false,
        ok: 'The offline installers are on the drive.',
        problem: 'Some offline installers could not be copied.',
        action: async (write) => {
          const dest = path.join(dir, 'MendKit', 'MendKitData', 'tool-cache');
          if (path.resolve(dest).toLowerCase() === path.resolve(cs.dir).toLowerCase()) return { ok: true, note: 'The offline installers are already on this drive.' };
          const r = await copyTree(cs.dir, dest, (_rel, name) => name.endsWith('.partial'), progress(write, cs.size), () => stop);
          for (const f of r.failed.slice(0, 20)) write(`Could not copy ${f}\n`);
          return { ok: !r.failed.length && !stop, note: r.failed.length ? `${r.failed.length} files could not be copied.` : `${cs.count} offline installers (${gb(r.bytes)}) copied. The portable MendKit on the stick installs them when there is no internet.` };
        },
      });
    }
    if (isos.length) {
      const total = isos.reduce((n, f) => n + fs.statSync(f).size, 0);
      steps.push({
        id: 'usb-isos',
        name: `Copy ${isos.length} ISO file${isos.length === 1 ? '' : 's'}`,
        admin: false,
        ok: 'The ISO files are on the drive.',
        problem: 'Some ISO files could not be copied.',
        action: async (write) => {
          const tick = progress(write, total);
          const failed: string[] = [];
          let skipped = 0;
          for (const f of isos) {
            if (stop) break;
            const dst = path.join(dir, path.basename(f));
            try {
              const st = fs.statSync(f);
              if (fs.existsSync(dst) && fs.statSync(dst).size === st.size) {
                skipped++;
                tick(st.size);
                continue;
              }
              write(`Copying ${path.basename(f)} (${gb(st.size)})...\n`);
              await new Promise<void>((resolve, reject) => {
                const rs = fs.createReadStream(f, { highWaterMark: 4 * 1024 * 1024 });
                const ws = fs.createWriteStream(`${dst}.mendkit-part`);
                rs.on('data', (d) => {
                  tick(d.length);
                  if (stop) rs.destroy(new Error('Cancelled'));
                });
                rs.on('error', reject);
                ws.on('error', reject);
                ws.on('finish', resolve);
                rs.pipe(ws);
              });
              fs.renameSync(`${dst}.mendkit-part`, dst);
            } catch (err) {
              fs.rmSync(`${dst}.mendkit-part`, { force: true });
              const code = (err as NodeJS.ErrnoException).code;
              failed.push(`${path.basename(f)}: ${code === 'ENOSPC' ? 'the drive is full' : code === 'EFBIG' ? 'too big for a FAT32 drive (4 GB limit); Ventoy sticks use exFAT' : (err as Error).message}`);
            }
          }
          for (const f of failed) write(`Could not copy ${f}\n`);
          return { ok: !failed.length && !stop, note: failed.length ? `Not copied: ${failed.join('; ')}.` : `${isos.length - skipped} copied${skipped ? `, ${skipped} already there` : ''}. If the stick has Ventoy on it, they appear in its start-up menu.` };
        },
      });
    }
    return engine.runSteps('technician-usb', 'Build a technician USB', 'command', steps, opts());
  });

  // ---------- Reinstall assistant ----------
  let isoPath: string | null = null;
  ipcMain.handle('reinstall-info', async () => {
    const checks: { level: 'good' | 'attention' | 'problem' | 'info'; text: string }[] = [];
    if (win32) {
      const r = await powershellScript(`
$ErrorActionPreference='SilentlyContinue'
$os=Get-CimInstance Win32_OperatingSystem
$cv=Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion'
$bat=Get-CimInstance Win32_Battery | Select-Object -First 1
$bl=Get-BitLockerVolume -MountPoint $env:SystemDrive
@{caption=$os.Caption; build="$($cv.CurrentBuildNumber).$($cv.UBR)"; display=$cv.DisplayVersion; edition=$cv.EditionID; lang=@($os.MUILanguages)[0]; arch=$os.OSArchitecture; free=(Get-Volume -DriveLetter $env:SystemDrive.TrimEnd(':')).SizeRemaining; bitlocker=[string]$bl.ProtectionStatus; battery=$(if($bat){[int]$bat.BatteryStatus}else{0})} | ConvertTo-Json -Compress`);
      const free = Number(r?.free) || 0;
      checks.push(isElevated() ? { level: 'good', text: 'MendKit is running as administrator.' } : { level: 'problem', text: 'Restart MendKit as administrator before starting a repair install.' });
      checks.push(free >= 25 * 1024 ** 3 ? { level: 'good', text: `${gb(free)} free on the Windows drive.` } : { level: 'problem', text: `Only ${gb(free)} free on the Windows drive. A reinstall needs about 25 GB; run a cleanup first.` });
      if (Number(r?.battery) === 1) checks.push({ level: 'problem', text: 'The computer is running on battery. Plug it in first.' });
      if (/^(On|1)$/i.test(String(r?.bitlocker))) checks.push({ level: 'attention', text: 'BitLocker is on. Make sure you have the recovery key (account.microsoft.com/devices/recoverykey) before you start.' });
      checks.push({ level: 'info', text: 'A reinstall keeps files, apps and settings, but make a backup first in case it fails part-way.' });
      return { platform: 'win32', system: `${r?.caption ?? 'Windows'} ${r?.display ?? ''} (build ${r?.build ?? '?'}), ${r?.edition ?? ''} edition, ${r?.lang ?? ''}, ${r?.arch ?? ''}`.replace(/\s+/g, ' '), lang: String(r?.lang ?? ''), checks };
    }
    checks.push({ level: 'info', text: 'Make a backup first. A reinstall is meant to keep your files, but a failing drive or a power cut can still lose them.' });
    return { platform: process.platform, system: `${os.type()} ${os.release()}`, lang: '', checks };
  });
  ipcMain.handle('reinstall-open-recovery', () => {
    if (!win32) return false;
    shell.openExternal('ms-settings:recovery');
    return true;
  });
  ipcMain.handle('reinstall-pick-iso', async () => {
    const r = await dialog.showOpenDialog(ctx.getWin()!, { title: 'Choose the Windows ISO file', defaultPath: app.getPath('downloads'), properties: ['openFile'], filters: [{ name: 'Windows ISO', extensions: ['iso'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    isoPath = r.filePaths[0];
    return { path: isoPath, size: gb(fs.statSync(isoPath).size) };
  });
  ipcMain.handle('reinstall-start', async () => {
    if (!win32) throw new Error('The repair install runs on Windows only');
    if (!isoPath || !fs.existsSync(isoPath)) throw new Error('Choose the Windows ISO file first');
    if (!isElevated()) throw new Error('Restart MendKit as administrator first');
    const r = await powershellScript(`
$ErrorActionPreference='Stop'
$p='${isoPath.replace(/'/g, "''")}'
$img=Get-DiskImage -ImagePath $p
if(-not $img.Attached){ $img=Mount-DiskImage -ImagePath $p -PassThru }
Start-Sleep -Seconds 2
$l=(Get-DiskImage -ImagePath $p | Get-Volume).DriveLetter
@{letter=[string]$l} | ConvertTo-Json -Compress`, 60000);
    const letter = String(r?.letter ?? '').slice(0, 1);
    if (!/^[A-Za-z]$/.test(letter)) throw new Error('Windows could not open that ISO file. Download it again; it may be damaged.');
    const setup = `${letter}:\\setup.exe`;
    if (!fs.existsSync(setup) || !fs.existsSync(`${letter}:\\sources`)) throw new Error('That ISO is not a Windows installation disc (no setup.exe inside).');
    spawn(setup, [], { detached: true, stdio: 'ignore' }).on('error', () => undefined).unref();
    return { letter };
  });

  // ---------- The system's own backup feature ----------
  ipcMain.handle('backup-open-system', async () => {
    if (win32) {
      spawn('control.exe', ['/name', 'Microsoft.FileHistory'], { detached: true, stdio: 'ignore' }).on('error', () => undefined).unref();
      return { ok: true, name: 'File History' };
    }
    if (mac) {
      await run('open', ['x-apple.systempreferences:com.apple.Time-Machine-Settings.extension']);
      return { ok: true, name: 'Time Machine' };
    }
    for (const [bin, name] of [['deja-dup', 'Backups'], ['timeshift-launcher', 'Timeshift'], ['timeshift-gtk', 'Timeshift']]) {
      if (onPath(bin)) {
        spawn(bin, [], { detached: true, stdio: 'ignore' }).on('error', () => undefined).unref();
        return { ok: true, name };
      }
    }
    return { ok: false, name: 'Install Timeshift from Tools, or "Backups" (Deja Dup) from your software center.' };
  });
}
