import * as path from 'path';
import { CommandDef, ToolDef } from './types';

/**
 * The offline installer cache: what `winget download` saved for a tool, and how to install it
 * again with no internet. Pure logic only; downloading and file handling live in main/offline.ts.
 */

export interface CachedManifest {
  version?: string;
  installerType?: string;
  nestedInstallerType?: string;
  silent?: string;
  custom?: string;
  sha256?: string;
  scope?: string;
  elevation?: string;
}

/** Everything MendKit records about one cached tool, in <cache>/<tool id>/mendkit-cache.json. */
export interface CacheEntry {
  tool: string;
  wingetId: string;
  version: string;
  /** Installer file name inside the tool's cache folder. */
  file: string;
  size: number;
  sha256: string;
  installerType: string;
  silent?: string;
  custom?: string;
  scope?: string;
  downloaded: string;
}

const unquote = (v: string): string => {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1).replace(/''/g, "'");
  return t;
};

/**
 * Reads the few fields MendKit needs from a winget manifest. winget writes a merged manifest
 * beside the installer; a value can sit at the top level or under the chosen installer, and the
 * installer's own value wins.
 */
export function parseWingetManifest(text: string): CachedManifest {
  const root: Record<string, string> = {};
  const inst: Record<string, string> = {};
  let inInstallers = false;
  let switchesIndent = -1;
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    if (/^\s*#/.test(raw) || !raw.trim()) continue;
    const m = /^([\s-]*)([A-Za-z0-9]+):\s*(.*)$/.exec(raw);
    if (!m) continue;
    const [, lead, key, value] = m;
    const indent = lead.length;
    if (indent === 0) inInstallers = key === 'Installers';
    if (switchesIndent >= 0 && indent <= switchesIndent) switchesIndent = -1;
    if (key === 'InstallerSwitches') {
      switchesIndent = indent;
      continue;
    }
    const v = unquote(value);
    if (!v) continue;
    const name = switchesIndent >= 0 ? `switch.${key}` : key;
    const into = inInstallers ? inst : root;
    if (!(name in into)) into[name] = v;
  }
  const get = (k: string) => inst[k] ?? root[k];
  const low = (v: string | undefined) => v?.toLowerCase();
  return {
    version: get('PackageVersion'),
    installerType: low(get('InstallerType')),
    nestedInstallerType: low(get('NestedInstallerType')),
    silent: get('switch.Silent'),
    custom: get('switch.Custom'),
    sha256: low(get('InstallerSha256')),
    scope: low(get('Scope')),
    elevation: get('ElevationRequirement'),
  };
}

/** Splits a switch string the way Windows would, keeping quoted parts together. */
export function splitArgs(s: string | undefined): string[] {
  if (!s) return [];
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  let has = false;
  for (const ch of s) {
    if (ch === '"') {
      quoted = !quoted;
      has = true;
    } else if (/\s/.test(ch) && !quoted) {
      if (has) out.push(cur);
      cur = '';
      has = false;
    } else {
      cur += ch;
      has = true;
    }
  }
  if (has) out.push(cur);
  return out;
}

/** The switches winget itself uses for a silent install of each installer type. */
const DEFAULT_SILENT: Record<string, string> = {
  msi: '/quiet /norestart',
  wix: '/quiet /norestart',
  nullsoft: '/S',
  inno: '/SP- /VERYSILENT /SUPPRESSMSGBOXES /NORESTART',
  burn: '/quiet /norestart',
};

export type OfflineSupport = 'install' | 'portable' | 'unsupported';

/** Whether a cached installer can be installed silently, only run from the folder, or neither. */
export function offlineSupport(e: Pick<CacheEntry, 'installerType' | 'silent'>): OfflineSupport {
  const t = e.installerType;
  if (LINUX_TYPES.includes(t)) return 'install';
  if (t in DEFAULT_SILENT || t === 'msix' || t === 'appx') return 'install';
  if (t === 'exe') return e.silent ? 'install' : 'unsupported';
  if (t === 'folder') return 'install';
  if (t === 'portable' || t === 'zip') return 'portable';
  return 'unsupported';
}

/** Builds the command that installs a cached tool with no internet. */
export function offlineInstallCommand(tool: ToolDef, entry: CacheEntry, dir: string): CommandDef {
  if (LINUX_TYPES.includes(entry.installerType)) return linuxOfflineInstall(tool, entry, dir);
  const file = path.join(dir, entry.file);
  const t = entry.installerType;
  const silent = splitArgs(entry.silent ?? DEFAULT_SILENT[t]);
  const custom = splitArgs(entry.custom);
  let exec: string;
  let args: string[];
  if (t === 'msi' || t === 'wix') {
    exec = 'msiexec.exe';
    args = ['/i', file, ...silent, ...custom];
  } else if (t === 'msix' || t === 'appx') {
    exec = 'powershell.exe';
    args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `Add-AppxPackage -Path '${file.replace(/'/g, "''")}'`];
  } else if (t === 'folder') {
    // A tool that is a folder of programs (Sysinternals): copied into Program Files with a Start menu shortcut.
    const q = (v: string) => `'${v.replace(/'/g, "''")}'`;
    exec = 'powershell.exe';
    args = ['-NoProfile', '-NonInteractive', '-Command', [
      "$dest = Join-Path $env:ProgramFiles 'Sysinternals'",
      'New-Item -ItemType Directory -Force -Path $dest | Out-Null',
      `Get-ChildItem -LiteralPath ${q(dir)} -File | Where-Object { $_.Name -ne 'mendkit-cache.json' } | Copy-Item -Destination $dest -Force`,
      `$lnk = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath('CommonPrograms')) ${q(`${tool.name}.lnk`)}))`,
      `$lnk.TargetPath = Join-Path $dest ${q(entry.file)}; $lnk.Save()`,
      `if (-not (Test-Path (Join-Path $dest ${q(entry.file)}))) { exit 1 }`,
    ].join('; ')];
  } else if (offlineSupport(entry) === 'install') {
    exec = file;
    args = [...silent, ...custom];
  } else {
    throw new Error(`${tool.name} cannot be installed silently from the cache`);
  }
  return {
    id: `install-${tool.id}`,
    name: `Install ${tool.name} from the offline cache`,
    description: tool.description,
    exec,
    args,
    // Without winget there is nobody to ask for rights part-way, so machine-wide installers need MendKit running as administrator.
    admin: !(t === 'msix' || t === 'appx' || entry.scope === 'user'),
    typicalMinutes: 3,
    timeoutMinutes: 30,
    okExitCodes: [0, 3010, 1641],
    exitNotes: { '3010': 'Installed. Restart the computer to finish.', '1641': 'Installed. The installer is restarting the computer.' },
    friendly: {
      title: tool.name,
      ok: `${tool.name} ${entry.version} was installed from the offline cache.`,
      problem: `${tool.name} could not be installed from the offline cache.`,
    },
  };
}

/** Store and MSIX-only packages need a Microsoft account to download, so they are not cached. */
export function cacheable(wingetId: string | undefined): boolean {
  return !!wingetId && !/^[0-9A-Z]{12}$/.test(wingetId);
}

/** Linux cache entries hold a folder of packages (the tool plus what it needs) instead of one installer. */
export const LINUX_TYPES = ['linux-apt', 'linux-dnf', 'linux-pacman'];
const shq = (x: string) => `'${x.replace(/'/g, `'\\''`)}'`;

/** The command that downloads a tool and the packages it needs into a folder, without installing it. */
export function linuxDownloadCommand(manager: string, pkg: string, folder: string): string[] | null {
  const f = shq(folder);
  const p = shq(pkg);
  if (manager === 'apt') return ['sh', '-c', `mkdir -p ${f}/partial && DEBIAN_FRONTEND=noninteractive apt-get install -y --download-only --reinstall -o Dir::Cache::archives=${f} ${p} && rm -rf ${f}/partial ${f}/lock`];
  if (manager === 'dnf') return ['sh', '-c', `mkdir -p ${f} && dnf download -y --resolve --destdir ${f} ${p}`];
  if (manager === 'pacman') return ['sh', '-c', `mkdir -p ${f} && pacman -Sw --noconfirm --cachedir ${f} ${p}`];
  return null;
}

function linuxOfflineInstall(tool: ToolDef, entry: CacheEntry, dir: string): CommandDef {
  const f = shq(path.join(dir, entry.file));
  const script =
    entry.installerType === 'linux-apt'
      ? `DEBIAN_FRONTEND=noninteractive apt-get install -y --no-download ${f}/*.deb`
      : entry.installerType === 'linux-dnf'
        ? `dnf install -y --disablerepo='*' ${f}/*.rpm`
        : `pacman -U --noconfirm --needed ${f}/*.pkg.tar.*`;
  return {
    id: `install-${tool.id}`,
    name: `Install ${tool.name} from the offline cache`,
    description: '',
    exec: 'sh',
    args: ['-c', script],
    admin: true,
    typicalMinutes: 2,
    friendly: { title: tool.name, ok: `${tool.name} was installed from the offline cache.`, problem: `${tool.name} could not be installed offline. This computer may be missing a package it needs that the computer which saved it already had; install it once online.` },
  };
}
