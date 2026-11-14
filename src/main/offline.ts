import { app, BrowserWindow, dialog, ipcMain, net, shell } from 'electron';
import { ChildProcess, execFile, spawn } from 'child_process';
import * as crypto from 'crypto';
import * as dns from 'dns';
import * as fs from 'fs';
import * as path from 'path';
import { cacheable, CacheEntry, linuxDownloadCommand, LINUX_TYPES, offlineInstallCommand, offlineSupport, parseWingetManifest } from '../engine/offline';
import { ActionStep, Engine } from '../engine/runner';
import { Catalog, CommandDef, RunSummary } from '../engine/types';
import { isElevated } from './system';

/**
 * The offline installer cache (Windows): saves each tool's installer with `winget download`,
 * so it can be installed later on a computer with no internet.
 * The default folder sits in MendKit's data folder, which on a technician USB copy is on the stick.
 */

const META = 'mendkit-cache.json';
const gbmb = (b: number): string => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(b / 1024 ** 2))} MB`);

const settingsFile = () => path.join(app.getPath('userData'), 'offline-cache.json');
export function getCacheDir(): string {
  try {
    const d = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')).dir;
    if (typeof d === 'string' && path.isAbsolute(d)) return d;
  } catch {
    /* default */
  }
  return path.join(app.getPath('userData'), 'tool-cache');
}

export function readCache(dir = getCacheDir()): Map<string, CacheEntry> {
  const out = new Map<string, CacheEntry>();
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    try {
      const e = JSON.parse(fs.readFileSync(path.join(dir, n, META), 'utf8')) as CacheEntry;
      if (e && e.tool === n && typeof e.file === 'string' && !e.file.includes('/') && !e.file.includes('\\') && fs.existsSync(path.join(dir, n, e.file))) out.set(n, e);
    } catch {
      /* not a cache folder */
    }
  }
  return out;
}

/** True when the internet answers within a few seconds. */
export async function quickOnline(): Promise<boolean> {
  if (process.env.MENDKIT_TEST_OFFLINE) return false;
  if (!net.isOnline()) return false;
  return Promise.race([dns.promises.lookup('github.com').then(() => true, () => false), new Promise<boolean>((r) => setTimeout(() => r(false), 3000))]);
}

function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

/** One checksum for a folder of packages: every file name and its own checksum, in order. */
async function hashFolder(folder: string): Promise<string> {
  const h = crypto.createHash('sha256');
  for (const n of fs.readdirSync(folder).sort()) {
    const full = path.join(folder, n);
    if (fs.statSync(full).isFile()) h.update(`${n}:${await sha256(full)}\n`);
  }
  return h.digest('hex');
}
const folderSize = (folder: string) => fs.readdirSync(folder).reduce((n, f) => n + fs.statSync(path.join(folder, f)).size, 0);
const linuxCacheable = (catalog: Catalog, id: string) => {
  const t = catalog.tools.find((x) => x.id === id);
  return !!t && !!catalog.manager && ['apt', 'dnf', 'pacman'].includes(catalog.manager) && !!t.packages[catalog.manager];
};

/**
 * Steps that install the given tools from the cache. Tools that are not cached, or whose cached
 * copy is damaged, get a failing step that says so instead.
 */
export async function offlineInstallSteps(catalog: Catalog, toolIds: string[]): Promise<(CommandDef | ActionStep)[]> {
  const dir = getCacheDir();
  const cache = readCache(dir);
  const steps: (CommandDef | ActionStep)[] = [];
  for (const id of toolIds) {
    const tool = catalog.tools.find((t) => t.id === id);
    if (!tool) continue;
    const e = cache.get(id);
    const fail = (problem: string): ActionStep => ({ id: `install-${id}`, name: `Install ${tool.name}`, admin: false, ok: '', problem, action: async () => ({ ok: false, note: problem }) });
    if (!e) {
      steps.push(fail(`${tool.name} needs the internet: it is not in the offline cache.`));
      continue;
    }
    const folder = path.join(dir, id);
    const isLinux = LINUX_TYPES.includes(e.installerType);
    if ((await (isLinux ? hashFolder(path.join(folder, e.file)) : sha256(path.join(folder, e.file))).catch(() => '')) !== e.sha256) {
      steps.push(fail(`The cached copy of ${tool.name} is damaged. Save it again while online.`));
      continue;
    }
    const support = offlineSupport(e);
    if (support === 'portable') {
      steps.push({ id: `install-${id}`, name: `${tool.name} (runs without installing)`, admin: false, ok: '', problem: '', action: async () => ({ ok: true, note: `${tool.name} does not need installing. Run it straight from ${folder}.` }) });
    } else if (support === 'unsupported') {
      steps.push(fail(`${tool.name}'s installer cannot run silently. Run it by hand from ${folder}.`));
    } else {
      steps.push(offlineInstallCommand(tool, e, folder));
    }
  }
  return steps;
}

export function registerOffline(ctx: { engine: Engine; catalog: Catalog; getWin: () => BrowserWindow | null }): void {
  const { engine, catalog } = ctx;
  const linux = process.platform === 'linux' && ['apt', 'dnf', 'pacman'].includes(String(catalog.manager));
  const supported = (process.platform === 'win32' && catalog.manager === 'winget') || linux || !!process.env.MENDKIT_TEST_CACHE;
  const sizes = new Map<string, number | null>();
  let child: ChildProcess | null = null;
  let stop = false;

  const info = () => {
    const dir = getCacheDir();
    const cache = readCache(dir);
    let free = 0;
    try {
      const st = fs.statfsSync(fs.existsSync(dir) ? dir : path.dirname(dir));
      free = st.bavail * st.bsize;
    } catch {
      /* unknown */
    }
    const entries: Record<string, { version: string; size: number; support: string; downloaded: string }> = {};
    let total = 0;
    for (const [id, e] of cache) {
      entries[id] = { version: e.version, size: e.size, support: offlineSupport(e), downloaded: e.downloaded };
      total += e.size;
    }
    const cachable = linux ? catalog.tools.filter((t) => linuxCacheable(catalog, t.id)).map((t) => t.id) : catalog.tools.filter((t) => cacheable(t.packages.winget)).map((t) => t.id);
    return { supported, linux, dir, isDefault: dir === path.join(app.getPath('userData'), 'tool-cache'), total, totalText: gbmb(total), free, freeText: gbmb(free), entries, cachable, sizes: Object.fromEntries(sizes) };
  };

  /** Linux: downloads each tool's package and the packages it needs (as root), then records it like a Windows entry. */
  const linuxDownload = async (ids: string[]): Promise<RunSummary> => {
    if (!(await quickOnline())) throw new Error('Saving packages needs the internet. Connect, then try again.');
    const dir = getCacheDir();
    fs.mkdirSync(dir, { recursive: true });
    const tools = [...new Set(Array.isArray(ids) ? ids.map(String) : [])].filter((id) => linuxCacheable(catalog, id)).map((id) => catalog.tools.find((t) => t.id === id)!);
    if (!tools.length) throw new Error('Tick at least one tool to save');
    const m = catalog.manager!;
    const steps: (CommandDef | ActionStep)[] = [];
    for (const t of tools) {
      const partial = path.join(dir, `${t.id}.partial`, 'pkgs');
      fs.rmSync(path.dirname(partial), { recursive: true, force: true });
      fs.mkdirSync(path.dirname(partial), { recursive: true });
      const c = linuxDownloadCommand(m, t.packages[m]!, partial)!;
      // The download runs as root; give the files back to this user, keeping the download's own result.
      const owner = `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`;
      const script = `${c[2]}; r=$?; chown -R ${owner} '${path.dirname(partial).replace(/'/g, `'\\''`)}'; exit $r`;
      steps.push({ id: `cache-dl-${t.id}`, name: `Download ${t.name}`, description: '', exec: c[0], args: [c[1], script], admin: true, typicalMinutes: 2, friendly: { title: t.name, ok: `${t.name} was downloaded.`, problem: `${t.name} could not be downloaded.` } });
      steps.push({
        id: `cache-${t.id}`, name: `Save ${t.name}`, admin: false, ok: `${t.name} was saved for offline use.`, problem: `${t.name} could not be saved.`,
        action: async () => {
          try {
            const files = fs.existsSync(partial) ? fs.readdirSync(partial).filter((n) => /\.(deb|rpm|pkg\.tar\.\w+)$/.test(n)) : [];
            if (!files.length) throw new Error('Nothing was downloaded. The log has the package manager\'s message.');
            for (const n of fs.readdirSync(partial)) if (!files.includes(n)) fs.rmSync(path.join(partial, n), { recursive: true, force: true });
            const entry: CacheEntry = { tool: t.id, wingetId: '', version: files.find((n) => n.startsWith(t.packages[m]!))?.replace(/\.(deb|rpm|pkg\.tar\.\w+)$/, '') ?? 'unknown', file: 'pkgs', size: folderSize(partial), sha256: await hashFolder(partial), installerType: `linux-${m}`, downloaded: new Date().toISOString() };
            fs.writeFileSync(path.join(path.dirname(partial), META), JSON.stringify(entry, null, 2));
            const final = path.join(dir, t.id);
            fs.rmSync(final, { recursive: true, force: true });
            fs.renameSync(path.dirname(partial), final);
            return { ok: true, note: `${t.name} saved with ${files.length} package${files.length === 1 ? '' : 's'} (${gbmb(entry.size)}).` };
          } catch (err) {
            fs.rmSync(path.dirname(partial), { recursive: true, force: true });
            return { ok: false, note: (err as Error).message };
          }
        },
      });
    }
    return engine.runSteps('cache-tools', `Save ${tools.length} tool${tools.length === 1 ? '' : 's'} for offline use`, 'tool', steps, { elevated: isElevated() });
  };

  ipcMain.handle('cache-info', info);
  ipcMain.handle('cache-open-dir', () => {
    const dir = getCacheDir();
    fs.mkdirSync(dir, { recursive: true });
    return shell.openPath(dir);
  });
  ipcMain.handle('cache-pick-dir', async (_e, reset: boolean) => {
    if (reset === true) {
      fs.rmSync(settingsFile(), { force: true });
      return info();
    }
    const r = await dialog.showOpenDialog(ctx.getWin()!, { title: 'Choose where to keep offline installers', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return info();
    fs.writeFileSync(settingsFile(), JSON.stringify({ dir: r.filePaths[0] }, null, 2));
    return info();
  });
  ipcMain.handle('cache-remove', (_e, ids: string[]) => {
    const dir = getCacheDir();
    const cache = readCache(dir);
    for (const id of Array.isArray(ids) ? ids.map(String) : []) if (cache.has(id)) fs.rmSync(path.join(dir, id), { recursive: true, force: true });
    return info();
  });
  ipcMain.handle('cache-cancel', () => {
    stop = true;
    if (child?.pid) spawn('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    engine.cancel();
  });

  // Download sizes before saving: winget names each installer's address; the server reports its size.
  ipcMain.handle('cache-sizes', async () => {
    if (!supported) return {};
    const todo = catalog.tools.filter((t) => cacheable(t.packages.winget) && !sizes.has(t.id));
    const show = (id: string) =>
      new Promise<string>((resolve) => execFile('winget.exe', ['show', '--id', id, '-e', '--accept-source-agreements', '--disable-interactivity'], { windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024 }, (_err, out) => resolve(String(out ?? ''))));
    const head = (url: string) =>
      new Promise<number | null>((resolve) => {
        const req = net.request({ method: 'HEAD', url, redirect: 'follow' });
        const t = setTimeout(() => req.abort(), 15000);
        req.on('response', (res) => {
          clearTimeout(t);
          const len = Number([res.headers['content-length']].flat()[0]);
          resolve(res.statusCode < 400 && len > 0 ? len : null);
        });
        req.on('error', () => resolve(null));
        req.on('abort', () => resolve(null));
        req.end();
      });
    const worker = async () => {
      for (let t = todo.shift(); t; t = todo.shift()) {
        const url = /Installer Url:\s*(https:\/\/\S+)/i.exec(await show(t.packages.winget!))?.[1];
        const size = url ? await head(url) : null;
        sizes.set(t.id, size);
        ctx.getWin()?.webContents.send('mendkit:cache-size', { id: t.id, size });
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return Object.fromEntries(sizes);
  });

  ipcMain.handle('cache-download', async (_e, ids: string[]): Promise<RunSummary> => {
    if (!supported) throw new Error('Offline installers are available on Windows and on Linux with apt, dnf or pacman');
    if (linux) return linuxDownload(ids);
    if (!(await quickOnline())) throw new Error('Saving installers needs the internet. Connect, then try again.');
    const dir = getCacheDir();
    fs.mkdirSync(dir, { recursive: true });
    const tools = [...new Set(Array.isArray(ids) ? ids.map(String) : [])].map((id) => catalog.tools.find((t) => t.id === id)).filter((t) => t && cacheable(t.packages.winget));
    if (!tools.length) throw new Error('Tick at least one tool to save');
    stop = false;
    const steps: ActionStep[] = tools.map((tool) => ({
      id: `cache-${tool!.id}`,
      name: `Save ${tool!.name}`,
      admin: false,
      ok: `${tool!.name} was saved for offline use.`,
      problem: `${tool!.name} could not be saved.`,
      action: async (write) => {
        if (stop) return { ok: false, note: 'Cancelled.' };
        const t = tool!;
        const partial = path.join(dir, `${t.id}.partial`);
        fs.rmSync(partial, { recursive: true, force: true });
        fs.mkdirSync(partial, { recursive: true });
        const code = await new Promise<number | null>((resolve) => {
          const p = spawn('winget.exe', ['download', '--id', t.packages.winget!, '--exact', '--download-directory', partial, '--accept-source-agreements', '--accept-package-agreements', '--skip-license', '--skip-dependencies', '--disable-interactivity'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
          child = p;
          p.stdout.on('data', (d) => write(d.toString()));
          p.stderr.on('data', (d) => write(d.toString()));
          p.on('error', (err) => {
            write(`${err.message}\n`);
            resolve(null);
          });
          p.on('close', (c) => resolve(c));
        });
        child = null;
        try {
          if (stop) throw new Error('Cancelled.');
          const files = fs.readdirSync(partial).filter((n) => fs.statSync(path.join(partial, n)).isFile());
          const yaml = files.find((n) => /\.ya?ml$/i.test(n));
          const installer = files.filter((n) => !/\.ya?ml$/i.test(n)).sort((a, b) => fs.statSync(path.join(partial, b)).size - fs.statSync(path.join(partial, a)).size)[0];
          if (code !== 0 || !installer || !yaml) throw new Error(code === null ? 'winget could not be started. Install "App Installer" from the Microsoft Store.' : 'winget did not save an installer. The log has its message. Older winget versions do not have the download command: update "App Installer".');
          const man = parseWingetManifest(fs.readFileSync(path.join(partial, yaml), 'utf8'));
          const hash = await sha256(path.join(partial, installer));
          if (man.sha256 && man.sha256 !== hash) throw new Error('The downloaded file does not match the publisher\'s checksum. It was not kept.');
          const entry: CacheEntry = {
            tool: t.id,
            wingetId: t.packages.winget!,
            version: man.version ?? 'unknown',
            file: installer,
            size: fs.statSync(path.join(partial, installer)).size,
            sha256: hash,
            installerType: man.installerType ?? 'exe',
            silent: man.silent,
            custom: man.custom,
            scope: man.scope,
            downloaded: new Date().toISOString(),
          };
          fs.writeFileSync(path.join(partial, META), JSON.stringify(entry, null, 2));
          const final = path.join(dir, t.id);
          fs.rmSync(final, { recursive: true, force: true });
          fs.renameSync(partial, final);
          const support = offlineSupport(entry);
          return {
            ok: true,
            note: `${t.name} ${entry.version} saved (${gbmb(entry.size)}).${support === 'portable' ? ' It runs straight from the cache folder, without installing.' : support === 'unsupported' ? ' Its installer cannot run silently, so it has to be run by hand from the cache folder.' : ''}`,
          };
        } catch (err) {
          fs.rmSync(partial, { recursive: true, force: true });
          return { ok: false, note: (err as Error).message };
        }
      },
    }));
    return engine.runSteps('cache-tools', `Save ${steps.length} tool${steps.length === 1 ? '' : 's'} for offline use`, 'tool', steps, { elevated: isElevated() });
  });
}

/** Folder size, for copying the cache onto a technician USB. */
export function cacheSummary(): { dir: string; count: number; size: number } {
  const dir = getCacheDir();
  const cache = readCache(dir);
  let size = 0;
  for (const e of cache.values()) size += e.size;
  return { dir, count: cache.size, size };
}
