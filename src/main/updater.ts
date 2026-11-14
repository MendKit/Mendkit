import { app, BrowserWindow, ipcMain, net, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { isNewer, latestFileName, parseLatest } from '../engine/update';

/**
 * MendKit's own updates. The release bucket holds each installer plus a small "latest" file.
 * An installed Windows copy and a Linux AppImage download and swap themselves in place;
 * every other kind of copy is told a new version exists and given the download.
 */

interface UpdateState {
  status: 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error';
  current: string;
  version?: string;
  /** auto: MendKit can install it itself. manual: the person downloads and runs the installer. */
  mode: 'auto' | 'manual';
  url?: string;
  percent?: number;
  message?: string;
}

export function registerUpdater(ctx: { getWin: () => BrowserWindow | null; busy: () => boolean }): void {
  const feed = (() => {
    try {
      // The address lives in definitions/update.json so it travels inside every build.
      const u = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'definitions', 'update.json'), 'utf8')).url;
      return typeof u === 'string' && /^https:\/\//.test(u) ? u.replace(/\/+$/, '') : null;
    } catch {
      return null;
    }
  })();
  const single = !!process.env.PORTABLE_EXECUTABLE_DIR;
  // A copy installed from the .deb or .rpm is offered the same kind of package, not the AppImage the feed names.
  // electron-builder records the package type in resources/package-type.
  const linuxPackageFile = (version: string): string | null => {
    if (process.platform !== 'linux' || !app.isPackaged) return null;
    try {
      const t = fs.readFileSync(path.join(process.resourcesPath, 'package-type'), 'utf8').trim();
      return t === 'deb' ? `MendKit-${version}-amd64.deb` : t === 'rpm' ? `MendKit-${version}-x86_64.rpm` : null;
    } catch {
      return null;
    }
  };
  const canAuto = app.isPackaged && !single && (process.platform === 'win32' || (process.platform === 'linux' && !!process.env.APPIMAGE));
  const state: UpdateState = { status: 'idle', current: app.getVersion(), mode: canAuto ? 'auto' : 'manual' };
  const push = (patch: Partial<UpdateState>) => {
    Object.assign(state, patch);
    ctx.getWin()?.webContents.send('mendkit:update', state);
  };

  // electron-updater is only loaded where it can work, so a source or portable copy never touches it.
  let updater: typeof import('electron-updater').autoUpdater | null = null;
  if (canAuto && feed) {
    try {
      updater = require('electron-updater').autoUpdater;
      updater!.setFeedURL({ provider: 'generic', url: feed });
      updater!.autoDownload = false;
      updater!.autoInstallOnAppQuit = true;
      updater!.on('update-available', (i) => push({ status: 'available', version: i.version }));
      updater!.on('update-not-available', () => push({ status: 'none' }));
      updater!.on('download-progress', (p) => push({ status: 'downloading', percent: Math.round(p.percent) }));
      updater!.on('update-downloaded', (i) => push({ status: 'ready', version: i.version, percent: 100 }));
      updater!.on('error', (e) => push({ status: 'error', message: friendly(e) }));
    } catch {
      updater = null;
      state.mode = 'manual';
    }
  }

  const fetchText = (url: string): Promise<string> =>
    new Promise((resolve, reject) => {
      if (process.env.MENDKIT_TEST_UPDATE) return resolve(fs.readFileSync(process.env.MENDKIT_TEST_UPDATE, 'utf8'));
      const req = net.request({ url, redirect: 'follow' });
      const timer = setTimeout(() => req.abort(), 15000);
      req.on('response', (res) => {
        let body = '';
        res.on('data', (d) => (body += d.toString('utf8')));
        res.on('end', () => {
          clearTimeout(timer);
          if (res.statusCode === 200) resolve(body);
          else reject(new Error(`HTTP ${res.statusCode}`));
        });
      });
      req.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      req.on('abort', () => reject(new Error('timed out')));
      req.end();
    });

  const check = async (): Promise<UpdateState> => {
    if (!feed) return Object.assign(state, { status: 'error', message: 'No update address is set in this copy of MendKit.' });
    if (state.status === 'downloading' || state.status === 'ready') return state;
    push({ status: 'checking', message: undefined });
    if (updater) {
      try {
        await updater.checkForUpdates();
      } catch (e) {
        push({ status: 'error', message: friendly(e) });
      }
      return state;
    }
    try {
      const info = parseLatest(await fetchText(`${feed}/${latestFileName(process.platform)}?t=${Date.now()}`));
      if (!info) throw new Error('unreadable');
      if (isNewer(info.version, state.current)) push({ status: 'available', version: info.version, url: `${feed}/${encodeURI(linuxPackageFile(info.version) ?? info.path)}` });
      else push({ status: 'none' });
    } catch (e) {
      push({ status: 'error', message: friendly(e) });
    }
    return state;
  };

  ipcMain.handle('self-update-state', () => state);
  ipcMain.handle('self-update-check', check);
  ipcMain.handle('self-update-download', async () => {
    if (state.status !== 'available') return state;
    if (updater) {
      push({ status: 'downloading', percent: 0 });
      updater.downloadUpdate().catch((e) => push({ status: 'error', message: friendly(e) }));
    } else if (state.url && state.url.startsWith(`${feed}/`)) {
      shell.openExternal(state.url);
    }
    return state;
  });
  ipcMain.handle('self-update-install', () => {
    if (state.status !== 'ready' || !updater) return false;
    if (ctx.busy()) throw new Error('Wait for the current job to finish, then install the update.');
    updater.quitAndInstall(false, true);
    return true;
  });

  // A quiet check shortly after start; scheduled background runs skip it.
  if (!process.argv.includes('--unattended') && (app.isPackaged || process.env.MENDKIT_TEST_UPDATE)) setTimeout(() => void check(), 8000);
}

function friendly(e: unknown): string {
  const m = String((e as Error)?.message ?? e);
  if (/404|HTTP 4\d\d|Cannot find.*latest|unreadable/i.test(m)) return 'No update information was found on the update server yet.';
  if (/ENOTFOUND|ERR_INTERNET|ERR_NAME|timed out|ETIMEDOUT|ECONN|net::/i.test(m)) return 'The update server could not be reached. Check the internet connection.';
  return 'The update check did not work. Try again later.';
}
