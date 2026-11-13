import * as fs from 'fs';
import * as path from 'path';
import { PackageManager } from './types';

/**
 * App matching between systems. Programs are never copied; the old computer sends a list of what
 * is installed, using system-neutral ids from definitions/apps.json, and the new computer installs
 * each one from its own package manager.
 */

export type AppDef = { id: string; name: string; macApp?: string } & Partial<Record<PackageManager, string>>;

export interface AppList {
  format: 2;
  platform: string;
  /** Raw `winget export` from a Windows computer, used as-is when the new computer is also Windows. */
  winget: unknown | null;
  /** Ids from the app table. */
  apps: string[];
  /** Installed apps the table does not know, by name. */
  other: string[];
}

export function loadApps(definitionsDir: string): AppDef[] {
  const apps = JSON.parse(fs.readFileSync(path.join(definitionsDir, 'apps.json'), 'utf8')) as AppDef[];
  const ids = new Set<string>();
  for (const a of apps) {
    if (!a.id || !a.name || ids.has(a.id)) throw new Error(`Bad or duplicate app definition: ${JSON.stringify(a)}`);
    ids.add(a.id);
    for (const m of ['winget', 'brew', 'apt', 'dnf', 'pacman', 'zypper', 'flatpak'] as PackageManager[]) {
      if (a[m] !== undefined && !/^(cask:)?[A-Za-z0-9.+_-]+$/.test(a[m]!)) throw new Error(`Bad ${m} name for app "${a.id}"`);
    }
  }
  return apps;
}

function wingetIds(exported: any): string[] {
  if (!exported || !Array.isArray(exported.Sources)) return [];
  return exported.Sources.flatMap((s: any) => (Array.isArray(s.Packages) ? s.Packages : [])).map((p: any) => String(p.PackageIdentifier ?? '')).filter(Boolean);
}

/** Turns a `winget export` into table ids plus the ids the table does not know. */
export function fromWinget(exported: unknown, table: AppDef[]): { apps: string[]; other: string[] } {
  const apps = new Set<string>();
  const other: string[] = [];
  for (const id of wingetIds(exported)) {
    const low = id.toLowerCase();
    // "GIMP.GIMP.3" still means GIMP: match the table id exactly or as a dotted prefix.
    const hit = table.find((a) => a.winget && (low === a.winget.toLowerCase() || low.startsWith(a.winget.toLowerCase() + '.')));
    if (hit) apps.add(hit.id);
    else other.push(id);
  }
  return { apps: [...apps], other };
}

/** Accepts the current list format and the plain winget export that earlier versions saved. */
export function normalizeAppList(raw: any, table: AppDef[]): AppList | null {
  if (!raw) return null;
  if (raw.format === 2 && Array.isArray(raw.apps)) {
    return { format: 2, platform: String(raw.platform ?? ''), winget: raw.winget ?? null, apps: raw.apps.map(String), other: Array.isArray(raw.other) ? raw.other.map(String) : [] };
  }
  if (Array.isArray(raw.Sources)) return { format: 2, platform: 'win32', winget: raw, ...fromWinget(raw, table) };
  return null;
}

export function countApps(raw: any): number {
  if (!raw) return 0;
  if (Array.isArray(raw.Sources)) return wingetIds(raw).length;
  if (raw.format === 2) return raw.winget ? wingetIds(raw.winget).length : (raw.apps?.length ?? 0) + (raw.other?.length ?? 0);
  return 0;
}

export interface InstallPlan {
  /** Same-system Windows move: hand the whole export to `winget import`. */
  wingetImport: boolean;
  installs: { app: AppDef; manager: PackageManager; pkg: string }[];
  /** Names of apps that cannot be installed automatically on this computer. */
  unmatched: string[];
}

/** Decides how each listed app gets installed on this computer. */
export function installPlan(list: AppList, table: AppDef[], manager: PackageManager | null, hasFlatpak: boolean): InstallPlan {
  if (manager === 'winget' && list.winget) return { wingetImport: true, installs: [], unmatched: [] };
  const installs: InstallPlan['installs'] = [];
  const unmatched: string[] = [];
  for (const id of list.apps) {
    const app = table.find((a) => a.id === id);
    if (!app) {
      unmatched.push(id);
      continue;
    }
    const native = manager ? app[manager] : undefined;
    if (manager && native) installs.push({ app, manager, pkg: native });
    else if (hasFlatpak && app.flatpak) installs.push({ app, manager: 'flatpak', pkg: app.flatpak });
    else unmatched.push(app.name);
  }
  return { wingetImport: false, installs, unmatched: [...unmatched, ...list.other] };
}

// ---------- settings that need a hand after they arrive ----------

/**
 * Firefox and Thunderbird only show profiles listed in profiles.ini. When the new computer already
 * had its own profiles.ini, the migrated profile folders arrive but are not listed; this adds them.
 * Returns the names of the profiles it added.
 */
export function registerMozillaProfiles(root: string): string[] {
  const ini = path.join(root, 'profiles.ini');
  if (!fs.existsSync(root)) return [];
  const found: string[] = [];
  for (const base of ['', 'Profiles']) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(path.join(root, base));
    } catch {
      continue;
    }
    for (const n of names) {
      const dir = path.join(root, base, n);
      try {
        if (fs.statSync(dir).isDirectory() && (fs.existsSync(path.join(dir, 'prefs.js')) || fs.existsSync(path.join(dir, 'places.sqlite')))) found.push(base ? `${base}/${n}` : n);
      } catch {
        /* unreadable */
      }
    }
  }
  if (!found.length) return [];
  let text = '';
  try {
    text = fs.readFileSync(ini, 'utf8');
  } catch {
    text = '[General]\nStartWithLastProfile=1\nVersion=2\n';
  }
  const listed = new Set([...text.matchAll(/^Path=(.*)$/gm)].map((m) => m[1].trim().replace(/\\/g, '/')));
  let next = Math.max(-1, ...[...text.matchAll(/^\[Profile(\d+)\]/gm)].map((m) => Number(m[1]))) + 1;
  const added: string[] = [];
  for (const rel of found) {
    if (listed.has(rel)) continue;
    const name = `${path.basename(rel).replace(/^[^.]+\./, '')} (from old computer)`;
    text += `${text.endsWith('\n') ? '' : '\n'}\n[Profile${next++}]\nName=${name}\nIsRelative=1\nPath=${rel}\n`;
    added.push(name);
  }
  if (added.length) fs.writeFileSync(ini, text);
  return added;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Converts a Chrome or Edge "Bookmarks" file to the HTML format every browser can import. */
export function bookmarksToHtml(json: string): { html: string; count: number } {
  const data = JSON.parse(json);
  let count = 0;
  const walk = (node: any, depth: number): string => {
    const pad = '    '.repeat(depth);
    if (node?.type === 'url' && typeof node.url === 'string') {
      count++;
      return `${pad}<DT><A HREF="${esc(node.url)}">${esc(String(node.name ?? node.url))}</A>\n`;
    }
    if (Array.isArray(node?.children)) {
      const inner = node.children.map((c: any) => walk(c, depth + 1)).join('');
      return inner ? `${pad}<DT><H3>${esc(String(node.name ?? 'Folder'))}</H3>\n${pad}<DL><p>\n${inner}${pad}</DL><p>\n` : '';
    }
    return '';
  };
  const body = Object.values(data?.roots ?? {})
    .map((r) => walk(r, 1))
    .join('');
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Bookmarks</TITLE>\n<H1>Bookmarks</H1>\n<DL><p>\n${body}</DL><p>\n`;
  return { html, count };
}
