import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AppDef, AppList, fromWinget } from '../engine/apps';
import { onPath } from '../engine/catalog';
import { toolCheckCommand } from '../engine/runner';
import { PackageManager } from '../engine/types';

const run = (cmd: string, args: string[], timeout = 60000): Promise<{ ok: boolean; out: string }> =>
  new Promise((resolve) => execFile(cmd, args, { windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve({ ok: !err, out: String(stdout) })));

/** Works out which apps are installed on this computer, as a system-neutral list. */
export async function detectApps(table: AppDef[], manager: PackageManager | null, tempDir: string): Promise<AppList | null> {
  if (process.platform === 'win32') {
    const tmp = path.join(tempDir, `mendkit-apps-${Date.now()}.json`);
    await run('winget.exe', ['export', '-o', tmp, '--accept-source-agreements', '--disable-interactivity'], 180000);
    try {
      const winget = JSON.parse(fs.readFileSync(tmp, 'utf8'));
      fs.rmSync(tmp, { force: true });
      return { format: 2, platform: 'win32', winget, ...fromWinget(winget, table) };
    } catch {
      return null;
    }
  }

  if (process.platform === 'darwin') {
    const names = new Set<string>();
    for (const dir of ['/Applications', path.join(os.homedir(), 'Applications')]) {
      try {
        for (const n of fs.readdirSync(dir)) if (n.endsWith('.app')) names.add(n);
      } catch {
        /* folder missing */
      }
    }
    const apps = table.filter((a) => a.macApp && names.has(a.macApp));
    const matched = new Set(apps.map((a) => a.macApp));
    const formulae = onPath('brew') ? new Set((await run('brew', ['list', '--formula', '-1'])).out.split('\n').map((s) => s.trim())) : new Set<string>();
    for (const a of table) if (a.brew && !a.brew.startsWith('cask:') && formulae.has(a.brew) && !apps.includes(a)) apps.push(a);
    const other = [...names].filter((n) => !matched.has(n)).map((n) => n.replace(/\.app$/, '')).sort().slice(0, 300);
    return { format: 2, platform: 'darwin', winget: null, apps: apps.map((a) => a.id), other };
  }

  // Linux: ask the package manager about each known app, and list Flatpak apps.
  const flatpaks = onPath('flatpak') ? (await run('flatpak', ['list', '--app', '--columns=application'])).out.split('\n').map((s) => s.trim()).filter(Boolean) : [];
  const apps: string[] = [];
  const queue = [...table];
  const worker = async () => {
    for (let a = queue.shift(); a; a = queue.shift()) {
      let found = !!a.flatpak && flatpaks.includes(a.flatpak);
      if (!found && manager && manager !== 'flatpak' && a[manager]) {
        const [cmd, ...args] = toolCheckCommand({ id: a.id, name: a.name, job: '', description: '', license: 'free', packages: { [manager]: a[manager] } }, manager);
        found = (await run(cmd, args, 20000)).ok;
      }
      if (found) apps.push(a.id);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  const known = new Set(table.map((a) => a.flatpak).filter(Boolean));
  const order = new Map(table.map((a, i) => [a.id, i]));
  return { format: 2, platform: 'linux', winget: null, apps: apps.sort((x, y) => order.get(x)! - order.get(y)!), other: flatpaks.filter((f) => !known.has(f)) };
}
