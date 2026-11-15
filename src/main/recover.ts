import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile, spawn } from 'child_process';
import { ActionStep, Engine } from '../engine/runner';
import { countRecovered, findPhotorec, linuxVolumes, macVolumes, photorecScan, RecoverVolume, sameVolume, sortRecovered, windowsVolumes } from '../engine/recover';
import { isElevated } from './system';

export { countRecovered };

/**
 * Recover deleted files: first the places a deleted file usually still is (Recycle Bin or Trash,
 * Previous Versions, File History, Time Machine, Timeshift), then a deep scan with PhotoRec.
 */

const exec = (file: string, args: string[], timeout = 120000): Promise<{ ok: boolean; out: string }> =>
  new Promise((resolve) => execFile(file, args, { windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 }, (e, out) => resolve({ ok: !e, out: String(out ?? '') })));
const psFile = (file: string) => exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file]);
const count = (dir: string): number | null => {
  try {
    return fs.readdirSync(dir).filter((f) => !f.startsWith('.')).length;
  } catch {
    return null;
  }
};

export function registerRecover(ctx: { engine: Engine; getWin: () => BrowserWindow | null }): void {
  const { engine } = ctx;
  const plat = process.platform;
  const home = os.homedir();
  const scripts = path.join(app.getAppPath(), 'definitions', 'scripts');
  let volumes: RecoverVolume[] = [];
  let lastFolder = '';

  const listVolumes = async (): Promise<RecoverVolume[]> => {
    if (plat === 'win32') return windowsVolumes((await psFile(path.join(scripts, 'windows-volumes.ps1'))).out.trim(), process.env.SystemDrive ?? 'C:');
    if (plat === 'darwin') {
      const r = await exec('sh', ['-c', 'diskutil list -plist external physical | plutil -convert json -o - -']);
      return macVolumes(r.out);
    }
    // MENDKIT_TEST_LSBLK stands in for lsblk's output, so the screen can be tested against a disk image.
    if (process.env.MENDKIT_TEST_LSBLK) return linuxVolumes(process.env.MENDKIT_TEST_LSBLK);
    return linuxVolumes((await exec('lsblk', ['-J', '-b', '-o', 'NAME,PATH,SIZE,FSTYPE,LABEL,MOUNTPOINT,TYPE,TRAN,RM,HOTPLUG,ROTA'])).out);
  };

  ipcMain.handle('recover-info', async () => {
    const places: { id: string; name: string; detail: string; found: string; open?: string }[] = [];
    if (plat === 'win32') {
      let r: any = {};
      try {
        r = JSON.parse((await psFile(path.join(scripts, 'windows-recover-places.ps1'))).out.trim() || '{}');
      } catch {
        /* nothing */
      }
      const shadows = Array.isArray(r.shadows) ? r.shadows : r.shadows ? [r.shadows] : [];
      places.push({ id: 'bin', name: 'Recycle Bin', detail: 'Files deleted normally go here first. Right-click a file and choose Restore to put it back where it was.', found: `${r.bin ?? 0} item${r.bin === 1 ? '' : 's'}`, open: 'Open the Recycle Bin' });
      places.push({
        id: 'previous',
        name: 'Previous Versions',
        detail: 'Windows keeps copies of files from each restore point. Right-click the folder the file was in, choose Properties, then the Previous Versions tab, pick a date and click Open to copy the file out.',
        found: isElevated() ? (shadows.length ? `${shadows.length} saved cop${shadows.length === 1 ? 'y' : 'ies'}, newest ${new Date(shadows.map((s: any) => s.date).sort().pop()).toLocaleDateString()}` : 'none saved') : 'restart as administrator to check',
        open: 'Open File Explorer',
      });
      places.push({ id: 'filehistory', name: 'File History', detail: 'If File History was turned on, it has hourly copies of the Documents, Pictures, Desktop and other folders on a backup drive. Plug that drive in first.', found: r.fileHistory ? 'set up on this computer' : 'not set up', open: r.fileHistory ? 'Open File History' : undefined });
      if (r.oneDrive) places.push({ id: 'onedrive', name: 'OneDrive recycle bin', detail: 'Files deleted from a OneDrive folder stay in the OneDrive recycle bin online for 30 days (93 days for work and school accounts).', found: 'OneDrive is set up', open: 'Open OneDrive online' });
    } else if (plat === 'darwin') {
      const trash = count(path.join(home, '.Trash'));
      places.push({ id: 'bin', name: 'Trash', detail: 'Files deleted normally go here first. Drag a file out, or Control-click it and choose Put Back.', found: trash === null ? 'needs Full Disk Access to count' : `${trash} item${trash === 1 ? '' : 's'}`, open: 'Open the Trash' });
      const latest = (await exec('tmutil', ['latestbackup'])).out.trim();
      const snaps = (await exec('tmutil', ['listlocalsnapshots', '/'])).out.split('\n').filter((l) => /com\.apple\.TimeMachine/.test(l)).length;
      places.push({
        id: 'timemachine',
        name: 'Time Machine',
        detail: 'Open the folder the file was in, then open Time Machine and go back to a date when the file was there. Select it and click Restore. Plug the backup drive in first; recent copies kept on the Mac itself work without it.',
        found: [latest ? `last backup ${path.basename(latest).replace(/^(\d{4}-\d{2}-\d{2}).*/, '$1')}` : 'no backup drive found', snaps ? `${snaps} recent cop${snaps === 1 ? 'y' : 'ies'} on this Mac` : ''].filter(Boolean).join(', '),
        open: 'Open Time Machine',
      });
      places.push({ id: 'icloud', name: 'iCloud Drive', detail: 'Files deleted from iCloud Drive stay in Recently Deleted on iCloud.com for 30 days. Photos deleted in the Photos app stay in its Recently Deleted album for 30 days.', found: '', open: 'Open iCloud.com' });
    } else {
      const trash = count(path.join(process.env.XDG_DATA_HOME ?? path.join(home, '.local', 'share'), 'Trash', 'files'));
      places.push({ id: 'bin', name: 'Trash', detail: 'Files deleted in the file manager go here first. Right-click a file and choose Restore.', found: `${trash ?? 0} item${trash === 1 ? '' : 's'}`, open: 'Open the Trash' });
      const ts = count('/timeshift/snapshots') ?? count('/run/timeshift/backup/timeshift/snapshots');
      if (ts !== null) places.push({ id: 'timeshift', name: 'Timeshift', detail: 'Timeshift snapshots normally leave out the home folder. If yours include it, open Timeshift, pick a snapshot and click Browse to copy the file out.', found: `${ts} snapshot${ts === 1 ? '' : 's'}`, open: 'Open Timeshift' });
    }
    volumes = await listVolumes();
    return {
      platform: plat,
      elevated: isElevated(),
      photorec: findPhotorec(plat, process.env as Record<string, string>),
      places,
      volumes: volumes.map((v, i) => ({ ...v, id: `v${i}` })),
    };
  });

  ipcMain.handle('recover-open-place', async (_e, id: string) => {
    const go = (file: string, args: string[]) => spawn(file, args, { detached: true, stdio: 'ignore' }).on('error', () => undefined).unref();
    if (id === 'bin') return plat === 'win32' ? go('explorer.exe', ['shell:RecycleBinFolder']) : plat === 'darwin' ? go('open', [path.join(home, '.Trash')]) : go('gio', ['open', 'trash:///']);
    if (id === 'previous') return go('explorer.exe', [home]);
    if (id === 'filehistory') return go('control.exe', ['/name', 'Microsoft.FileHistory']);
    if (id === 'onedrive') return shell.openExternal('https://onedrive.live.com/?view=5');
    if (id === 'timemachine') return go('open', ['-a', 'Time Machine']);
    if (id === 'icloud') return shell.openExternal('https://www.icloud.com/iclouddrive/');
    if (id === 'timeshift') return go('timeshift-launcher', []);
    if (id === 'folder' && lastFolder) return shell.openPath(lastFolder);
    return undefined;
  });

  ipcMain.handle('recover-pick-dest', async () => {
    const r = process.env.MENDKIT_TEST_PICK
      ? { canceled: false, filePaths: [process.env.MENDKIT_TEST_PICK] }
      : await dialog.showOpenDialog(ctx.getWin()!, { title: 'Choose where to save recovered files (on a different drive)', properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('recover-start', async (_e, o: { volume: string; dest: string; groups: string[]; whole: boolean }) => {
    const vol = volumes[Number(String(o.volume).slice(1))];
    if (!vol) throw new Error('Choose the drive to scan again.');
    const pr = findPhotorec(plat, process.env as Record<string, string>);
    if (!pr) throw new Error('PhotoRec is not installed yet. Click Install PhotoRec first.');
    if (!o.dest || !fs.existsSync(o.dest)) throw new Error('Choose where to save the recovered files.');
    const destDevice = plat === 'win32' ? undefined : (await exec('df', ['-P', o.dest])).out.split('\n')[1]?.split(/\s+/)[0];
    if (sameVolume(o.dest, vol, plat, destDevice)) throw new Error('The recovered files must be saved on a different drive from the one being scanned, or they could overwrite the very files being recovered. Plug in a USB drive and choose a folder on it.');
    const groups = (o.groups ?? []).length ? o.groups : ['everything'];
    const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
    const folder = path.join(o.dest, `Recovered files ${stamp}`);
    lastFolder = folder;
    const what = `${vol.label || vol.device}`;
    const scan = photorecScan(plat, pr, vol, folder, groups, !!o.whole, what, os.userInfo());
    const sort: ActionStep = {
      id: 'recover-sort',
      name: 'Sort the recovered files by type',
      admin: false,
      ok: 'The recovered files were sorted into folders by type.',
      problem: 'The recovered files could not be sorted. They are still in the recup_dir folders.',
      notes: [
        { pattern: 'Sorted: nothing', level: 'info', message: 'There was nothing to sort.' },
        { pattern: 'Sorted: (.+)', level: 'good', message: 'Sorted into folders: $1. Recovered files have new names (such as f0012345.jpg); open each folder and look through them.' },
      ],
      action: async (write) => {
        const c = sortRecovered(folder);
        const parts = Object.entries(c).map(([k, v]) => `${k} ${v}`);
        write(`Sorted: ${parts.length ? parts.join(', ') : 'nothing'}\n`);
        return { ok: true };
      },
    };
    const summary = await engine.runSteps('recover-files', 'Recover deleted files', 'command', [scan, sort], { elevated: isElevated() });
    return { summary, folder, found: countSorted(folder) };
  });
}

/** Files in the sorted folders, for the results screen. */
function countSorted(folder: string): number {
  let n = 0;
  try {
    for (const d of fs.readdirSync(folder, { withFileTypes: true })) if (d.isDirectory()) n += fs.readdirSync(path.join(folder, d.name)).length;
  } catch {
    /* none */
  }
  return n;
}
