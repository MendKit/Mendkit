import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { scriptsDir } from './paths';
import { execFile, spawn } from 'child_process';
import { ActionStep, Engine } from '../engine/runner';
import { CommandDef } from '../engine/types';
import { copyPlan, gvfsPhones, iosBackupDirs, listIosBackups, listMedia, PhoneSource } from '../engine/phone';
import { isElevated } from './system';

/**
 * Phone helpers: copy photos and videos off a phone plugged in by USB (Windows through the same Shell as
 * File Explorer, Linux through the desktop's phone mounts, the Mac through Image Capture), and list the
 * iPhone and iPad backups on this computer.
 */
export function registerPhone(ctx: { engine: Engine; getWin: () => BrowserWindow | null }): void {
  const { engine } = ctx;
  const plat = process.platform;
  const home = os.homedir();
  const script = path.join(scriptsDir(), 'windows-phone.ps1');
  const gvfs = process.env.MENDKIT_TEST_GVFS ?? `/run/user/${os.userInfo().uid}/gvfs`;
  let linuxPhones: PhoneSource[] = [];
  let lastFolder = '';

  ipcMain.handle('phone-scan', async () => {
    let devices: { id: string; name: string; kind: string; count: number; bytes: number; locked: boolean }[] = [];
    if (plat === 'win32') {
      const out = await new Promise<string>((resolve) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-List'], { windowsHide: true, timeout: 300000, maxBuffer: 8 * 1024 * 1024 }, (_e, o) => resolve(String(o ?? ''))));
      try {
        const j = JSON.parse(out.trim() || '[]');
        devices = (Array.isArray(j) ? j : [j]).filter(Boolean).map((d: any, i: number) => ({ id: `w${i}`, name: String(d.name), kind: /iphone|ipad|apple/i.test(d.name) ? 'iphone' : 'android', count: Number(d.count) || 0, bytes: Number(d.bytes) || 0, locked: !!d.locked }));
      } catch {
        devices = [];
      }
    } else if (plat === 'linux') {
      linuxPhones = gvfsPhones(gvfs);
      devices = linuxPhones.map((p) => {
        const m = listMedia(p.root, p.folders);
        return { id: p.id, name: p.name, kind: p.kind, count: m.length, bytes: m.reduce((a, b) => a + b.size, 0), locked: false };
      });
    }
    let backups: ReturnType<typeof listIosBackups> = [];
    let backupsReadable = true;
    try {
      backups = listIosBackups(iosBackupDirs(plat, home, process.env));
    } catch {
      backupsReadable = false;
    }
    if (plat === 'darwin') {
      try {
        fs.readdirSync(iosBackupDirs(plat, home, process.env)[0]);
      } catch (e) {
        backupsReadable = (e as NodeJS.ErrnoException).code === 'ENOENT';
      }
    }
    return { platform: plat, devices, backups, backupsReadable, pictures: app.getPath('pictures') };
  });

  ipcMain.handle('phone-pick-dest', async () => {
    const r = process.env.MENDKIT_TEST_PICK
      ? { canceled: false, filePaths: [process.env.MENDKIT_TEST_PICK] }
      : await dialog.showOpenDialog(ctx.getWin()!, { title: 'Choose where to put the photos', defaultPath: app.getPath('pictures'), properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('phone-copy', async (_e, o: { device: string; name: string; dest: string }) => {
    if (!o.dest || !fs.existsSync(o.dest)) throw new Error('Choose where to put the photos.');
    const folder = path.join(o.dest, o.name.replace(/[<>:"/\\|?*]+/g, ' ').trim() || 'Phone');
    lastFolder = folder;
    const notes = [
      { pattern: 'PHONE_GONE', level: 'problem' as const, message: 'The phone was not found. Plug it back in, unlock it, and scan again.' },
      { pattern: 'COPY_DONE copied=0 skipped=(\\d+) failed=0', level: 'good' as const, message: 'Nothing new: all $1 photos and videos were already copied.' },
      { pattern: 'COPY_DONE copied=(\\d+) skipped=(\\d+) failed=0', level: 'good' as const, message: 'Copied $1 new photos and videos ($2 were already there), sorted into a folder for each month.' },
      { pattern: 'COPY_DONE copied=(\\d+) skipped=(\\d+) failed=(\\d+)', level: 'attention' as const, message: 'Copied $1 and skipped $2, but $3 could not be copied. Keep the phone unlocked and plugged in, and run it again: only the missing ones are copied.' },
    ];
    let step: CommandDef | ActionStep;
    if (plat === 'win32') {
      fs.mkdirSync(folder, { recursive: true });
      step = { id: 'phone-copy', name: `Copy photos and videos from ${o.name}`, description: '', exec: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Copy', '-Device', o.name, '-Dest', folder], admin: false, typicalMinutes: 15, friendly: { title: `Copy from ${o.name}`, ok: 'The photos and videos were copied.', problem: 'Some photos and videos could not be copied.', notes } };
    } else {
      const p = linuxPhones.find((x) => x.id === o.device);
      if (!p) throw new Error('Scan again: the phone was not found.');
      step = {
        id: 'phone-copy',
        name: `Copy photos and videos from ${p.name}`,
        admin: false,
        ok: 'The photos and videos were copied.',
        problem: 'Some photos and videos could not be copied.',
        notes,
        action: async (write) => {
          const media = listMedia(p.root, p.folders);
          const plan = copyPlan(media, folder);
          write(`Found ${media.length} photos and videos; ${plan.length} are new.\n`);
          let failed = 0;
          for (const [n, c] of plan.entries()) {
            try {
              fs.mkdirSync(path.dirname(c.to), { recursive: true });
              await fs.promises.copyFile(path.join(p.root, c.from), c.to);
            } catch (err) {
              failed++;
              write(`could not copy ${c.from}: ${(err as Error).message}\n`);
            }
            if ((n + 1) % 25 === 0) write(`Copied ${n + 1 - failed} of ${plan.length}...\n`);
          }
          write(`COPY_DONE copied=${plan.length - failed} skipped=${media.length - plan.length} failed=${failed}\n`);
          return { ok: failed === 0 };
        },
      };
    }
    const summary = await engine.runSteps('phone-copy', 'Copy photos from a phone', 'command', [step], { elevated: isElevated() });
    return { summary, folder };
  });

  ipcMain.handle('phone-open', (_e, what: string) => {
    const go = (file: string, args: string[]) => spawn(file, args, { detached: true, stdio: 'ignore' }).on('error', () => undefined).unref();
    if (what === 'folder' && lastFolder) return shell.openPath(lastFolder);
    if (what === 'imagecapture') return go('open', ['-a', 'Image Capture']);
    if (what === 'finder') return go('open', ['-a', 'Finder']);
    if (what === 'backups') {
      const d = iosBackupDirs(plat, home, process.env).find((x) => fs.existsSync(x));
      return d ? shell.openPath(d) : undefined;
    }
    if (what === 'apple-devices') return shell.openExternal('ms-windows-store://pdp/?productid=9NP83LWLPZ9K');
    if (what === 'files') return plat === 'linux' ? go('xdg-open', [gvfs]) : undefined;
    return undefined;
  });
}
