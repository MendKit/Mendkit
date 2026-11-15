import { app, ipcMain } from 'electron';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { execFile, spawn } from 'child_process';
import { Engine, ActionStep } from '../engine/runner';
import { CommandDef, RunSummary } from '../engine/types';
import {
  backupFile,
  BrowserForce,
  BrowserProfile,
  browserProcesses,
  browserRoots,
  forcesFromFiles,
  forcesFromRegistry,
  listProfileDirs,
  policyConcerns,
  readChromiumProfile,
  readFirefoxProfile,
  regRemoveArgs,
  removeChromiumExtensions,
  removeChromiumNotifications,
  removeFirefoxExtensions,
  resetPage,
} from '../engine/browsers';
import { isElevated } from './system';

/**
 * Browser cleanup on all three systems: unwanted extensions, sites allowed to show notifications
 * (the usual source of fake virus pop-ups), and policies or outside programs that force settings in.
 */

const exec = (file: string, args: string[], timeout = 60000): Promise<{ ok: boolean; out: string }> =>
  new Promise((resolve) => execFile(file, args, { windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 }, (e, out) => resolve({ ok: !e, out: String(out ?? '') })));

/** Firefox keeps site permissions in SQLite; Electron's Node has a built-in reader. */
function sqlite(file: string): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DatabaseSync } = require('node:sqlite');
    return new DatabaseSync(file);
  } catch {
    return null;
  }
}
const firefoxNotifications = (file: string): string[] => {
  if (!fs.existsSync(file)) return [];
  const db = sqlite(file);
  if (!db) return [];
  try {
    return db.prepare("SELECT origin FROM moz_perms WHERE type = 'desktop-notification' AND permission = 1").all().map((r: any) => String(r.origin));
  } catch {
    return [];
  } finally {
    db.close();
  }
};

export async function runningBrowsers(platform = process.platform): Promise<Set<string>> {
  const r = platform === 'win32' ? await exec('tasklist.exe', ['/fo', 'csv', '/nh']) : await exec('ps', ['-A', '-o', 'comm=']);
  const names = new Set(
    r.out
      .split(/\r?\n/)
      .map((l) => (platform === 'win32' ? (/^"([^"]+)"/.exec(l)?.[1] ?? '') : path.basename(l.trim())).toLowerCase())
      .filter(Boolean),
  );
  const running = new Set<string>();
  for (const b of ['Google Chrome', 'Microsoft Edge', 'Brave', 'Vivaldi', 'Chromium', 'Firefox']) {
    if (browserProcesses(b, platform).some((p) => names.has(p.toLowerCase()) || (platform === 'darwin' && [...names].some((n) => n === p.toLowerCase())))) running.add(b);
  }
  return running;
}
const baseName = (b: string) => b.replace(/ \((Snap|Flatpak)\)$/, '');

export function registerBrowsers(ctx: { engine: Engine }): void {
  const { engine } = ctx;
  const home = os.homedir();
  const quarantineFile = path.join(app.getPath('userData'), 'quarantine.json');
  const opts = () => ({ elevated: isElevated() });
  let profiles: BrowserProfile[] = [];
  let forces: BrowserForce[] = [];

  const remember = (tool: string, from: string, to: string) => {
    let list: any[] = [];
    try {
      list = JSON.parse(fs.readFileSync(quarantineFile, 'utf8'));
    } catch {
      /* new list */
    }
    list.push({ id: `${Date.now()}-${list.length}-${path.basename(to)}`, tool, from, to, when: new Date().toISOString() });
    fs.writeFileSync(quarantineFile, JSON.stringify(list, null, 2));
  };
  /** Moves a file or folder aside; falls back to copy and delete when the move crosses drives. */
  const setAside = (from: string, dir: string, tool: string): string => {
    fs.mkdirSync(dir, { recursive: true });
    const to = path.join(dir, `${path.basename(path.dirname(from))}-${path.basename(from)}.quarantined`);
    try {
      fs.renameSync(from, to);
    } catch {
      fs.cpSync(from, to, { recursive: true });
      fs.rmSync(from, { recursive: true, force: true });
    }
    remember(tool, from, to);
    return to;
  };

  ipcMain.handle('browser-scan', async () => {
    const roots = browserRoots(process.platform, home, process.env);
    forces = [];
    if (process.platform === 'win32') {
      for (const hive of ['HKLM', 'HKCU'] as const) {
        const pol = await exec('reg.exe', ['query', `${hive}\\SOFTWARE\\Policies`, '/s']);
        const ext = (await Promise.all(['SOFTWARE\\Google\\Chrome\\Extensions', 'SOFTWARE\\WOW6432Node\\Google\\Chrome\\Extensions', 'SOFTWARE\\Microsoft\\Edge\\Extensions', 'SOFTWARE\\WOW6432Node\\Microsoft\\Edge\\Extensions', 'SOFTWARE\\BraveSoftware\\Brave-Browser\\Extensions'].map((k) => exec('reg.exe', ['query', `${hive}\\${k}`, '/s'])))).map((r) => r.out).join('\n');
        forces.push(...forcesFromRegistry(hive, pol.out, ext));
      }
    } else forces = forcesFromFiles(process.platform, home);
    if (process.platform === 'darwin') {
      const p = await exec('profiles', ['list']);
      if (/profileIdentifier/i.test(p.out))
        forces.push({ id: 'mac-profiles', browser: 'All browsers', kind: 'policy', location: 'System Settings > General > Device Management', where: 'file', settings: p.out.split('\n').filter((l) => /profileIdentifier/.test(l)).map((l) => l.replace(/^.*profileIdentifier:\s*/, '').trim()), extensionIds: [], admin: true, removable: false });
    }
    const forced = new Set(forces.flatMap((f) => f.extensionIds));
    profiles = [];
    for (const r of roots) {
      for (const dir of listProfileDirs(r)) {
        const p = r.kind === 'chromium' ? readChromiumProfile(dir, r.browser, forced) : readFirefoxProfile(dir, r.browser, firefoxNotifications);
        p.id = `p${profiles.length}`;
        profiles.push(p);
      }
    }
    const running = await runningBrowsers();
    return {
      profiles: profiles.map((p) => ({ ...p, running: running.has(baseName(p.browser)), resetPage: resetPage(p.browser) })),
      forces: forces.map((f) => ({ ...f, concerns: policyConcerns(f.settings) })),
      elevated: isElevated(),
      platform: process.platform,
    };
  });

  ipcMain.handle('browser-clean', async (_e, pick: { extensions: { profile: string; id: string }[]; notifications: string[]; forces: string[] }): Promise<RunSummary> => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const qdir = path.join(app.getPath('userData'), 'quarantine', `browser-${stamp}`);
    const steps: (CommandDef | ActionStep)[] = [];
    const byProfile = new Map<string, { ext: string[]; notif: boolean }>();
    for (const x of pick.extensions ?? []) byProfile.set(x.profile, { ext: [...(byProfile.get(x.profile)?.ext ?? []), x.id], notif: byProfile.get(x.profile)?.notif ?? false });
    for (const id of pick.notifications ?? []) byProfile.set(id, { ext: byProfile.get(id)?.ext ?? [], notif: true });

    for (const [pid, what] of byProfile) {
      const p = profiles.find((x) => x.id === pid);
      if (!p) continue;
      const label = `${p.browser} (${p.name})`;
      const names = what.ext.map((id) => p.extensions.find((e) => e.id === id)?.name ?? id);
      steps.push({
        id: `browser-${pid}`,
        name: `Clean ${label}`,
        admin: false,
        ok: [names.length ? `Removed ${names.join(', ')}.` : '', what.notif ? 'Sites can no longer show notifications until you allow them again.' : '', 'The old settings were saved and can be put back from the Undo Center.'].filter(Boolean).join(' '),
        problem: `${label} could not be cleaned.`,
        action: async (write) => {
          if ((await runningBrowsers()).has(baseName(p.browser))) {
            write(`${p.browser} is open. Close every ${p.browser} window, then try again.\n`);
            return { ok: false };
          }
          const tool = `Browser cleanup: ${label}`;
          const saved = path.join(qdir, pid);
          if (p.kind === 'chromium') {
            for (const f of ['Preferences', 'Secure Preferences']) {
              const b = backupFile(path.join(p.dir, f), saved);
              if (b) remember(tool, path.join(p.dir, f), b);
            }
            for (const id of what.ext) {
              const d = path.join(p.dir, 'Extensions', id);
              if (fs.existsSync(d)) write(`set aside ${setAside(d, saved, `${tool}: ${p.extensions.find((e) => e.id === id)?.name ?? id}`)}\n`);
            }
            if (what.ext.length) write(`removed ${removeChromiumExtensions(p.dir, what.ext).join(', ')}\n`);
            if (what.notif) write(`removed ${removeChromiumNotifications(p.dir)} notification permissions\n`);
          } else {
            for (const id of what.ext) {
              for (const f of [path.join(p.dir, 'extensions', `${id}.xpi`), path.join(p.dir, 'extensions', id)]) if (fs.existsSync(f)) write(`set aside ${setAside(f, saved, `${tool}: ${p.extensions.find((e) => e.id === id)?.name ?? id}`)}\n`);
            }
            removeFirefoxExtensions(p.dir, what.ext);
            if (what.notif) {
              const file = path.join(p.dir, 'permissions.sqlite');
              const b = backupFile(file, saved);
              if (b) remember(tool, file, b);
              const db = sqlite(file);
              if (!db) {
                write('The Firefox permissions file could not be opened.\n');
                return { ok: false };
              }
              try {
                const r = db.prepare("DELETE FROM moz_perms WHERE type = 'desktop-notification' AND permission = 1").run();
                write(`removed ${r.changes} notification permissions\n`);
              } finally {
                db.close();
              }
            }
          }
          return { ok: true };
        },
      });
    }

    const pickedForces = forces.filter((f) => (pick.forces ?? []).includes(f.id) && f.removable);
    for (const f of pickedForces) {
      const what = f.kind === 'policy' ? `${f.browser} policy` : `${f.browser} extension installed by another program`;
      if (f.where === 'registry') {
        fs.mkdirSync(qdir, { recursive: true });
        const saveAs = path.join(qdir, `${f.id.replace(/[^\w-]+/g, '_')}.reg`);
        steps.push({
          id: `force-${f.id}`, name: `Remove ${what}`, description: '', admin: f.admin, typicalMinutes: 1,
          exec: 'cmd.exe', args: regRemoveArgs(f.location, saveAs),
          friendly: { title: `Remove ${what}`, ok: `Removed. A copy was saved as ${saveAs}; double-click it to put it back.`, problem: `It could not be removed. If this computer belongs to a workplace or school, it may be managed on purpose.` },
        });
      } else {
        const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
        const to = path.join(qdir, `${path.basename(f.location)}.quarantined`);
        steps.push({
          id: `force-${f.id}`, name: `Remove ${what}`, description: '', admin: f.admin, typicalMinutes: 1,
          exec: 'sh', args: ['-c', `mkdir -p ${q(qdir)} && cp -p ${q(f.location)} ${q(to)} && rm -f ${q(f.location)} && echo "Set aside ${f.location}"`],
          friendly: { title: `Remove ${what}`, ok: `Removed. A copy was saved and can be put back from the Undo Center.`, problem: 'It could not be removed.' },
        });
      }
    }
    if (!steps.length) throw new Error('Nothing was selected.');
    const summary = await engine.runSteps('browser-cleanup', 'Browser cleanup', 'command', steps, opts());
    for (const f of pickedForces) {
      if (f.where !== 'file' || summary.steps.find((s) => s.command === `force-${f.id}`)?.status !== 'ok') continue;
      remember(`Browser cleanup: ${f.browser} ${f.kind === 'policy' ? 'policy' : 'outside extension'}`, f.location, path.join(qdir, `${path.basename(f.location)}.quarantined`));
    }
    return summary;
  });

  /** Opens the browser on its own reset page. Browsers only accept their internal pages when started this way. */
  ipcMain.handle('browser-open-reset', async (_e, pid: string) => {
    const p = profiles.find((x) => x.id === pid);
    if (!p) throw new Error('Scan again first.');
    const url = resetPage(p.browser);
    const b = baseName(p.browser);
    const go = (file: string, args: string[]) => spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: false }).on('error', () => undefined).unref();
    if (process.platform === 'win32') {
      const exe = { 'Google Chrome': 'chrome', 'Microsoft Edge': 'msedge', Brave: 'brave', Vivaldi: 'vivaldi', Firefox: 'firefox' }[b] ?? 'chrome';
      go('cmd.exe', ['/d', '/c', 'start', '""', exe, url]);
    } else if (process.platform === 'darwin') {
      const appName = { 'Google Chrome': 'Google Chrome', 'Microsoft Edge': 'Microsoft Edge', Brave: 'Brave Browser', Vivaldi: 'Vivaldi', Firefox: 'Firefox' }[b] ?? b;
      go('open', ['-a', appName, url]);
    } else {
      const bin = /Snap/.test(p.browser) ? (b === 'Firefox' ? 'firefox' : 'chromium') : /Flatpak/.test(p.browser) ? 'flatpak' : { 'Google Chrome': 'google-chrome', Chromium: 'chromium', 'Microsoft Edge': 'microsoft-edge', Brave: 'brave-browser', Vivaldi: 'vivaldi', Firefox: 'firefox' }[b] ?? 'xdg-open';
      go(bin, bin === 'flatpak' ? ['run', 'org.mozilla.firefox', url] : [url]);
    }
    return url;
  });
}
