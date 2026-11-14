import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ActionStep, Engine } from '../engine/runner';
import { CommandDef, RunSummary } from '../engine/types';
import { isElevated } from './system';

/**
 * Mac-only tools that need a choice from the person before anything changes:
 * startup items, free up space, fix an app macOS calls damaged, and check another drive.
 */

const run = (cmd: string, args: string[], timeout = 60000): Promise<{ ok: boolean; out: string }> =>
  new Promise((resolve) => execFile(cmd, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}${stderr}` })));
const plist = async (file: string): Promise<any> => {
  const r = await run('plutil', ['-convert', 'json', '-o', '-', file]);
  try {
    return r.ok ? JSON.parse(r.out) : null;
  } catch {
    return null;
  }
};
const human = (b: number): string => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : b >= 1024 ** 2 ? `${Math.round(b / 1024 ** 2)} MB` : `${Math.max(0, Math.round(b / 1024))} KB`);
const sh = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;
/** Bytes used by a folder (du works on folders the app cannot list one by one). */
const du = async (p: string): Promise<number> => {
  if (!fs.existsSync(p)) return 0;
  const r = await run('du', ['-sk', p], 120000);
  return (parseInt(r.out, 10) || 0) * 1024;
};
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

interface StartupItem {
  id: string;
  file: string;
  label: string;
  program: string;
  scope: 'user' | 'all users' | 'system';
  signer: string;
  running: boolean;
  missing: boolean;
}

interface SpaceItem {
  id: string;
  name: string;
  detail: string;
  bytes: number;
  paths: string[];
  /** Report only: shown with an Open button instead of a tick box. */
  reportOnly?: boolean;
}

export function registerMacTools(ctx: { engine: Engine; getWin: () => BrowserWindow | null }): void {
  const { engine } = ctx;
  const mac = process.platform === 'darwin';
  const home = os.homedir();
  const opts = () => ({ elevated: isElevated() });
  const quarantineFile = path.join(app.getPath('userData'), 'quarantine.json');
  const notMac = () => {
    throw new Error('This tool is for Macs.');
  };

  // ---------- Startup and background items ----------
  let startup: StartupItem[] = [];
  ipcMain.handle('mac-startup-scan', async () => {
    if (!mac) notMac();
    const dirs: [string, StartupItem['scope']][] = [
      [path.join(home, 'Library/LaunchAgents'), 'user'],
      ['/Library/LaunchAgents', 'all users'],
      ['/Library/LaunchDaemons', 'system'],
    ];
    const loaded = (await run('launchctl', ['list'])).out;
    const items: StartupItem[] = [];
    for (const [dir, scope] of dirs) {
      let names: string[] = [];
      try {
        names = fs.readdirSync(dir).filter((n) => n.endsWith('.plist') && !n.startsWith('com.apple.'));
      } catch {
        continue;
      }
      for (const n of names) {
        const file = path.join(dir, n);
        const p = await plist(file);
        const label = String(p?.Label ?? n.replace(/\.plist$/, ''));
        const program = String(p?.Program ?? (Array.isArray(p?.ProgramArguments) ? p.ProgramArguments[0] : '') ?? '');
        let signer = 'Unknown';
        if (program && fs.existsSync(program)) {
          const c = await run('codesign', ['-dv', '--verbose=2', program]);
          const auth = /Authority=(.+)/.exec(c.out);
          signer = auth ? auth[1].replace(/^Developer ID Application: /, '') : /not signed/i.test(c.out) ? 'Not signed' : 'Unknown';
        }
        items.push({
          id: `${items.length}`,
          file,
          label,
          program,
          scope,
          signer,
          running: new RegExp(`\\s${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').test(loaded),
          missing: !!program && !fs.existsSync(program),
        });
      }
    }
    // Login items (the ones listed in System Settings, General, Login Items).
    const li = await run('osascript', ['-e', 'tell application "System Events" to get the name of every login item'], 15000);
    const loginItems = li.ok ? li.out.trim().split(/,\s*/).filter(Boolean) : [];
    startup = items;
    return { items, loginItems };
  });

  ipcMain.handle('mac-startup-remove', async (_e, ids: string[]): Promise<RunSummary> => {
    if (!mac) notMac();
    const pick = startup.filter((s) => ids.includes(s.id));
    if (!pick.length) throw new Error('Nothing was selected.');
    const st = stamp();
    const userDir = path.join(app.getPath('userData'), 'Quarantine', st);
    const sysDir = `/Library/Application Support/MendKit/Quarantine/${st}`;
    const steps: (CommandDef | ActionStep)[] = [];
    const uid = process.getuid ? process.getuid() : 501;
    for (const s of pick) {
      if (s.scope === 'user') {
        steps.push({
          id: `startup-${s.id}`,
          name: `Remove ${s.label}`,
          admin: false,
          ok: `${s.label} will no longer start. It was moved to the MendKit quarantine folder and can be put back from the Undo Center.`,
          problem: `${s.label} could not be removed.`,
          action: async (write) => {
            const b = await run('launchctl', ['bootout', `gui/${uid}`, s.file]);
            write(b.out);
            fs.mkdirSync(userDir, { recursive: true });
            const to = path.join(userDir, path.basename(s.file) + '.quarantined');
            fs.renameSync(s.file, to);
            let list: any[] = [];
            try {
              list = JSON.parse(fs.readFileSync(quarantineFile, 'utf8'));
            } catch {
              /* new list */
            }
            list.push({ id: `${st}-${path.basename(to)}`, tool: `Startup item ${s.label}`, from: s.file, to, when: new Date().toISOString() });
            fs.writeFileSync(quarantineFile, JSON.stringify(list, null, 2));
            write(`moved ${s.file} to ${to}\n`);
            return { ok: true };
          },
        });
      } else {
        const domain = s.scope === 'system' ? 'system' : `gui/${uid}`;
        steps.push({
          id: `startup-${s.id}`,
          name: `Remove ${s.label}`,
          description: '',
          exec: 'sh',
          args: ['-c', `launchctl bootout ${domain} ${sh(s.file)} 2>/dev/null; mkdir -p ${sh(sysDir)} && mv ${sh(s.file)} ${sh(sysDir)}/ && echo moved`],
          admin: true,
          typicalMinutes: 1,
          friendly: { title: s.label, ok: `${s.label} will no longer start. It was moved to ${sysDir} in case it is needed again.`, problem: `${s.label} could not be removed.` },
        });
      }
    }
    return engine.runSteps('mac-startup', 'Remove startup items', 'command', steps, opts());
  });

  ipcMain.handle('mac-login-item-remove', async (_e, name: string) => {
    if (!mac) notMac();
    const r = await run('osascript', ['-e', `tell application "System Events" to delete login item ${JSON.stringify(String(name))}`], 15000);
    if (!r.ok) throw new Error('The login item could not be removed. Remove it in System Settings, General, Login Items.');
    return true;
  });

  // ---------- Free up space ----------
  let space: SpaceItem[] = [];
  ipcMain.handle('mac-space-scan', async () => {
    if (!mac) notMac();
    const L = (p: string) => path.join(home, 'Library', p);
    const items: SpaceItem[] = [];
    const add = async (id: string, name: string, detail: string, paths: string[], reportOnly = false) => {
      const existing = paths.filter((p) => fs.existsSync(p));
      let bytes = 0;
      for (const p of existing) bytes += await du(p);
      if (bytes > 1024 * 1024) items.push({ id, name, detail, bytes, paths: existing, reportOnly });
    };
    await add('caches', 'App caches', 'Temporary files apps rebuild by themselves. Apps may start a little slower the first time.', [L('Caches')]);
    await add('logs', 'Old log files', 'Records apps keep of what they did. Safe to delete.', [L('Logs')]);
    await add('ios-updates', 'iPhone and iPad update files', 'Copies of iOS updates downloaded for devices. They download again if needed.', [L('iTunes/iPhone Software Updates'), L('iTunes/iPad Software Updates'), L('iTunes/iPod Software Updates')]);
    await add('mail-downloads', 'Mail attachments opened before', 'Copies made when attachments were opened from Mail. The emails keep their attachments.', [L('Containers/com.apple.mail/Data/Library/Mail Downloads')]);
    await add('xcode', 'Xcode build files', 'Build leftovers from Xcode. They are rebuilt when needed.', [L('Developer/Xcode/DerivedData'), L('Developer/Xcode/iOS DeviceSupport'), L('Developer/CoreSimulator/Caches')]);
    await add('trash', 'Trash', 'Files already in the Trash.', [path.join(home, '.Trash')]);
    // Each device backup on its own, with the device name and date.
    const bdir = L('Application Support/MobileSync/Backup');
    try {
      for (const b of fs.readdirSync(bdir)) {
        const full = path.join(bdir, b);
        const info = await plist(path.join(full, 'Info.plist'));
        const when = info?.['Last Backup Date'] ? new Date(info['Last Backup Date']).toLocaleDateString() : 'unknown date';
        await add(`backup-${b}`, `Backup of ${info?.['Device Name'] ?? 'an iPhone or iPad'}`, `Made ${when}${info?.['Product Type'] ? ` from ${info['Product Type']}` : ''}. Delete only if the device is backed up to iCloud or no longer used.`, [full]);
      }
    } catch {
      /* no backups, or no Full Disk Access */
    }
    await add('downloads', 'Downloads folder', 'Look through it yourself: MendKit will not delete your downloads.', [path.join(home, 'Downloads')], true);
    // Large files in the home folder, outside Library.
    const big = await run('find', [home, '-xdev', '-type', 'f', '-size', '+1G', '-not', '-path', `${home}/Library/*`, '-not', '-path', `${home}/.Trash/*`], 120000);
    const large = big.out
      .split('\n')
      .filter((l) => l.startsWith('/'))
      .slice(0, 30)
      .map((f) => {
        let size = 0;
        try {
          size = fs.statSync(f).size;
        } catch {
          /* gone */
        }
        return { path: f, size, label: `${f.replace(home, '~')} (${human(size)})` };
      })
      .sort((a, b) => b.size - a.size);
    const df = await run('df', ['-k', '/']);
    const m = /\s(\d+)\s+(\d+)\s+(\d+)\s+\d+%/.exec(df.out.split('\n')[1] ?? '');
    space = items;
    return {
      items: items.map((i) => ({ ...i, size: human(i.bytes) })),
      large,
      free: m ? human(Number(m[3]) * 1024) : null,
      total: m ? human(Number(m[1]) * 1024) : null,
    };
  });

  ipcMain.handle('mac-space-clean', async (_e, ids: string[]): Promise<RunSummary> => {
    if (!mac) notMac();
    const pick = space.filter((s) => ids.includes(s.id) && !s.reportOnly);
    if (!pick.length) throw new Error('Nothing was selected.');
    const steps: ActionStep[] = pick.map((s) => ({
      id: `space-${s.id}`,
      name: `Delete ${s.name}`,
      admin: false,
      ok: `${s.name}: deleted.`,
      problem: `${s.name} could not be deleted. If this is the Trash or a device backup, give MendKit Full Disk Access in System Settings, Privacy & Security.`,
      action: async (write) => {
        const before = (await Promise.all(s.paths.map(du))).reduce((a, b) => a + b, 0);
        let failed = 0;
        for (const p of s.paths) {
          // Backups go as a whole folder; everything else keeps its folder and loses what is inside.
          const targets = s.id.startsWith('backup-') ? [p] : (() => {
            try {
              return fs.readdirSync(p).map((n) => path.join(p, n));
            } catch {
              return [];
            }
          })();
          for (const t of targets) {
            try {
              fs.rmSync(t, { recursive: true, force: true });
            } catch {
              failed++;
            }
          }
        }
        const after = (await Promise.all(s.paths.map(du))).reduce((a, b) => a + b, 0);
        write(`freed ${human(before - after)}${failed ? `, ${failed} items were in use or protected` : ''}\n`);
        return before - after > 0 || !failed ? { ok: true, note: `Freed ${human(Math.max(0, before - after))}` } : { ok: false, note: 'Nothing could be deleted' };
      },
    }));
    return engine.runSteps('mac-space', 'Free up space', 'command', steps, opts());
  });

  ipcMain.handle('mac-reveal', (_e, p: string) => {
    if (typeof p !== 'string' || !p.startsWith(home)) throw new Error('Bad path');
    shell.showItemInFolder(p);
  });

  // ---------- Fix an app macOS calls damaged ----------
  ipcMain.handle('mac-app-pick', async () => {
    if (!mac) notMac();
    const r = process.env.MENDKIT_TEST_PICK
      ? { canceled: false, filePaths: [process.env.MENDKIT_TEST_PICK] }
      : await dialog.showOpenDialog(ctx.getWin()!, { title: 'Choose the app that will not open', defaultPath: '/Applications', properties: ['openFile', 'treatPackageAsDirectory'], filters: [{ name: 'Apps', extensions: ['app'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const p = r.filePaths[0];
    if (!p.endsWith('.app')) throw new Error('Choose an app (a name ending in .app).');
    const q = await run('xattr', ['-p', 'com.apple.quarantine', p]);
    const v = await run('codesign', ['--verify', '--deep', '--strict', p]);
    return { path: p, name: path.basename(p, '.app'), quarantined: q.ok, signedOk: v.ok, signNote: v.out.trim().split('\n').slice(-1)[0] ?? '' };
  });

  ipcMain.handle('mac-app-fix', async (_e, p: string, resign: boolean): Promise<RunSummary> => {
    if (!mac) notMac();
    if (typeof p !== 'string' || !p.endsWith('.app') || !fs.existsSync(p)) throw new Error('That app was not found.');
    let writable = true;
    try {
      fs.accessSync(p, fs.constants.W_OK);
    } catch {
      writable = false;
    }
    const name = path.basename(p, '.app');
    const steps: CommandDef[] = [
      {
        id: 'app-unquarantine',
        name: `Allow ${name} to open`,
        description: '',
        exec: 'xattr',
        args: ['-dr', 'com.apple.quarantine', p],
        admin: !writable,
        typicalMinutes: 1,
        friendly: { title: name, ok: `macOS will no longer block ${name} as downloaded from the internet. Open it again.`, problem: `MendKit could not clear the download flag on ${name}.` },
      },
    ];
    if (resign)
      steps.push({
        id: 'app-resign',
        name: `Re-sign ${name} on this Mac`,
        description: '',
        exec: 'codesign',
        args: ['--force', '--deep', '--sign', '-', p],
        admin: !writable,
        typicalMinutes: 1,
        friendly: { title: `${name} signature`, ok: `${name} was signed for this Mac. Open it again.`, problem: `${name} could not be signed. It may be built for another kind of Mac or truly damaged; download it again from its maker.` },
      });
    return engine.runSteps('mac-app-fix', `Fix ${name}`, 'command', steps, opts());
  });

  // ---------- Check another drive ----------
  ipcMain.handle('mac-volumes', async () => {
    if (!mac) notMac();
    const out: { id: string; label: string }[] = [];
    let names: string[] = [];
    try {
      names = fs.readdirSync('/Volumes');
    } catch {
      return out;
    }
    for (const n of names) {
      const mount = path.join('/Volumes', n);
      if (fs.realpathSync(mount) === '/') continue;
      const info = await plist(await writeTmp(await run('diskutil', ['info', '-plist', mount])));
      if (!info?.DeviceIdentifier) continue;
      out.push({ id: info.DeviceIdentifier, label: `${n} (${info.FilesystemName ?? info.FilesystemType ?? 'unknown format'}, ${human(Number(info.TotalSize) || 0)}${info.Internal ? ', internal' : ''})` });
    }
    return out;
  });

  ipcMain.handle('mac-volume-check', async (_e, id: string, repair: boolean): Promise<RunSummary> => {
    if (!mac) notMac();
    if (!/^disk\d+s\d+$|^disk\d+$/.test(String(id))) throw new Error('Bad drive');
    const def: CommandDef = {
      id: repair ? 'repair-other-volume' : 'verify-other-volume',
      name: `${repair ? 'Repair' : 'Check'} drive ${id}`,
      description: '',
      exec: 'diskutil',
      args: [repair ? 'repairVolume' : 'verifyVolume', id],
      admin: repair,
      heavy: true,
      typicalMinutes: 10,
      timeoutMinutes: 240,
      friendly: {
        title: 'Drive check',
        ok: repair ? 'The drive was checked and repaired where needed.' : 'The drive was checked and no problems were found.',
        problem: repair ? 'The drive could not be repaired. Copy off anything important now; the drive may be failing.' : 'The check found problems or could not finish. Run it again with Repair ticked.',
        notes: [{ pattern: 'appears to be OK', level: 'good', message: 'The drive appears to be OK.' }],
      },
    };
    return engine.runSteps(def.id, def.name, 'command', [def], opts());
  });
}

/** diskutil prints its plist on stdout; plutil wants a file. */
async function writeTmp(r: { ok: boolean; out: string }): Promise<string> {
  const f = path.join(os.tmpdir(), `mendkit-${process.pid}-vol.plist`);
  fs.writeFileSync(f, r.ok ? r.out : '');
  return f;
}
