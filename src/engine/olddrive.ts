import * as fs from 'fs';
import * as path from 'path';
import { AppDef, AppList } from './apps';
import { ItemSpec } from './migrate';
import { Platform } from './types';

/**
 * Reading user data off a drive taken out of another computer (or a mounted backup image).
 * Nothing here writes to the old drive.
 */

export interface OldProfile {
  name: string;
  home: string;
  platform: Platform;
  /** The top of the old system (the folder that holds Users or home), used to look for installed apps. */
  systemRoot: string;
}

const SKIP = new Set(['public', 'default', 'default user', 'all users', 'shared', 'guest', 'defaultapppool', 'lost+found', '.localized']);
const SECRETS = ['logins.json', 'logins-backup.json', 'key4.db', 'cert9.db', 'cookies.sqlite', 'cookies.sqlite-wal', 'parent.lock', 'lock', '.parentlock', 'cache2', 'startupCache', 'Crash Reports', 'Pending Pings'];

const isDir = (p: string): boolean => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const dirs = (p: string): string[] => {
  try {
    return fs.readdirSync(p, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
};
/** Finds a child folder whatever its letter case (an NTFS drive mounted on Linux is case-sensitive). */
const child = (dir: string, name: string): string | null => {
  const hit = dirs(dir).find((d) => d.toLowerCase() === name.toLowerCase());
  return hit ? path.join(dir, hit) : null;
};

function profileKind(home: string): Platform | null {
  if (child(home, 'AppData') || fs.existsSync(path.join(home, 'NTUSER.DAT'))) return 'win32';
  if (child(home, 'Library')) return 'darwin';
  if (['.config', '.bashrc', '.profile', '.local'].some((n) => fs.existsSync(path.join(home, n)))) return 'linux';
  return null;
}

/** Looks for user profiles on an old drive. `root` can be the drive, a Users or home folder, or one profile. */
export function findProfiles(root: string): OldProfile[] {
  const out: OldProfile[] = [];
  const seen = new Set<string>();
  const addFrom = (container: string, systemRoot: string, fallback: Platform) => {
    for (const name of dirs(container)) {
      if (SKIP.has(name.toLowerCase()) || name.startsWith('.')) continue;
      const home = path.join(container, name);
      if (seen.has(home)) continue;
      const kind = profileKind(home) ?? (dirs(home).some((d) => ['documents', 'desktop', 'pictures'].includes(d.toLowerCase())) ? fallback : null);
      if (!kind) continue;
      seen.add(home);
      out.push({ name, home, platform: kind, systemRoot });
    }
  };
  const users = child(root, 'Users');
  if (users) addFrom(users, root, child(root, 'Windows') ? 'win32' : 'darwin');
  const old = child(root, 'Windows.old');
  const oldUsers = old ? child(old, 'Users') : null;
  if (old && oldUsers) addFrom(oldUsers, old, 'win32');
  const home = child(root, 'home');
  if (home) addFrom(home, root, 'linux');
  if (!out.length) {
    // The folder picked may itself be a Users/home folder, or one profile.
    const self = profileKind(root);
    if (self) out.push({ name: path.basename(root), home: root, platform: self, systemRoot: path.dirname(path.dirname(root)) });
    else addFrom(root, path.dirname(root), /^users$/i.test(path.basename(root)) ? 'win32' : 'linux');
  }
  return out;
}

/** The same items a live migration offers, located inside an old profile. */
export function oldItems(p: OldProfile): ItemSpec[] {
  const h = p.home;
  const sub = (...names: string[]): string => {
    let cur = h;
    for (const n of names) cur = child(cur, n) ?? path.join(cur, n);
    return cur;
  };
  const items: ItemSpec[] = [
    { id: 'desktop', label: 'Desktop', root: sub('Desktop') },
    { id: 'documents', label: 'Documents', root: sub('Documents') },
    { id: 'pictures', label: 'Pictures', root: sub('Pictures') },
    { id: 'music', label: 'Music', root: sub('Music') },
    { id: 'videos', label: 'Videos', root: p.platform === 'darwin' ? sub('Movies') : sub('Videos') },
    { id: 'downloads', label: 'Downloads', root: sub('Downloads') },
  ];
  // Windows can redirect user folders into OneDrive; offer those too when they hold files.
  if (p.platform === 'win32') {
    for (const [id, label, name] of [['desktop', 'Desktop', 'Desktop'], ['documents', 'Documents', 'Documents'], ['pictures', 'Pictures', 'Pictures']] as const) {
      const od = sub('OneDrive', name);
      const plain = items.find((i) => i.id === id)!;
      if (isDir(od) && dirs(plain.root).length + files(plain.root) === 0) plain.root = od;
      void label;
    }
  }
  const vs = ['workspaceStorage', 'globalStorage', 'History'];
  if (p.platform === 'win32') {
    items.push(
      { id: 'firefox', label: 'Firefox profile (bookmarks, history, add-ons)', root: sub('AppData', 'Roaming', 'Mozilla', 'Firefox'), exclude: SECRETS },
      { id: 'thunderbird', label: 'Thunderbird mail and settings', root: sub('AppData', 'Roaming', 'Thunderbird'), exclude: SECRETS },
      { id: 'libreoffice', label: 'LibreOffice settings', root: sub('AppData', 'Roaming', 'LibreOffice') },
      { id: 'vscode', label: 'VS Code settings', root: sub('AppData', 'Roaming', 'Code', 'User'), exclude: vs },
      { id: 'chrome-bookmarks', label: 'Chrome bookmarks', root: sub('AppData', 'Local', 'Google', 'Chrome', 'User Data', 'Default'), only: ['Bookmarks'] },
      { id: 'edge-bookmarks', label: 'Edge favourites', root: sub('AppData', 'Local', 'Microsoft', 'Edge', 'User Data', 'Default'), only: ['Bookmarks'] },
    );
  } else if (p.platform === 'darwin') {
    const s = ['Library', 'Application Support'];
    items.push(
      { id: 'firefox', label: 'Firefox profile (bookmarks, history, add-ons)', root: sub(...s, 'Firefox'), exclude: SECRETS },
      { id: 'thunderbird', label: 'Thunderbird mail and settings', root: sub('Library', 'Thunderbird'), exclude: SECRETS },
      { id: 'libreoffice', label: 'LibreOffice settings', root: sub(...s, 'LibreOffice') },
      { id: 'vscode', label: 'VS Code settings', root: sub(...s, 'Code', 'User'), exclude: vs },
      { id: 'chrome-bookmarks', label: 'Chrome bookmarks', root: sub(...s, 'Google', 'Chrome', 'Default'), only: ['Bookmarks'] },
      { id: 'edge-bookmarks', label: 'Edge favourites', root: sub(...s, 'Microsoft Edge', 'Default'), only: ['Bookmarks'] },
    );
  } else {
    items.push(
      { id: 'firefox', label: 'Firefox profile (bookmarks, history, add-ons)', root: sub('.mozilla', 'firefox'), exclude: SECRETS },
      { id: 'thunderbird', label: 'Thunderbird mail and settings', root: sub('.thunderbird'), exclude: SECRETS },
      { id: 'libreoffice', label: 'LibreOffice settings', root: sub('.config', 'libreoffice') },
      { id: 'vscode', label: 'VS Code settings', root: sub('.config', 'Code', 'User'), exclude: vs },
      { id: 'chrome-bookmarks', label: 'Chrome bookmarks', root: sub('.config', 'google-chrome', 'Default'), only: ['Bookmarks'] },
      { id: 'edge-bookmarks', label: 'Edge favourites', root: sub('.config', 'microsoft-edge', 'Default'), only: ['Bookmarks'] },
    );
  }
  return items;
}

function files(dir: string): number {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.toLowerCase() !== 'desktop.ini').length;
  } catch {
    return 0;
  }
}

const norm = (s: string): string => s.toLowerCase().replace(/\.app$/, '').replace(/[^a-z0-9]/g, '');

/**
 * Works out which known apps were installed on the old system from its program folders.
 * This is a best guess from folder names; it cannot see every app.
 */
export function oldApps(p: OldProfile, table: AppDef[]): AppList | null {
  const names = new Set<string>();
  if (p.platform === 'win32') {
    for (const pf of ['Program Files', 'Program Files (x86)']) {
      const dir = child(p.systemRoot, pf);
      if (!dir) continue;
      for (const d of dirs(dir)) {
        names.add(norm(d));
        for (const d2 of dirs(path.join(dir, d))) names.add(norm(d2)), names.add(norm(d + d2));
      }
    }
    const local = child(p.home, 'AppData') ? path.join(child(p.home, 'AppData')!, 'Local', 'Programs') : '';
    for (const d of dirs(local)) names.add(norm(d));
  } else if (p.platform === 'darwin') {
    for (const dir of [child(p.systemRoot, 'Applications'), child(p.home, 'Applications')]) if (dir) for (const d of dirs(dir)) if (/\.app$/i.test(d)) names.add(norm(d));
  } else {
    return null;
  }
  if (!names.size) return null;
  const alias: Record<string, string[]> = { vlc: ['videolan', 'vlc'], vscode: ['microsoftvscode', 'visualstudiocode'], '7zip': ['7zip'], libreoffice: ['libreoffice'], obs: ['obsstudio'], teams: ['microsoftteams', 'teams'] };
  const apps = table
    .filter((a) => {
      const keys = [norm(a.name), ...(a.macApp ? [norm(a.macApp)] : []), ...(alias[a.id] ?? [])];
      return keys.some((k) => k.length >= 3 && [...names].some((n) => n === k || (k.length >= 5 && n.includes(k))));
    })
    .map((a) => a.id);
  return apps.length ? { format: 2, platform: p.platform, winget: null, apps, other: [] } : null;
}
