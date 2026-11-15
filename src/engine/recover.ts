import * as fs from 'fs';
import * as path from 'path';
import { CommandDef } from './types';

/**
 * Recover deleted files with PhotoRec (part of TestDisk, free and open source).
 * PhotoRec reads the drive without changing it and copies every file it recognises to another drive.
 * Kept free of Electron so the command line and the sorting can be tested against a disk image.
 */

export interface RecoverGroup {
  id: string;
  label: string;
  /** PhotoRec file family names. Only names PhotoRec 7.1 and later accept: an unknown name stops the scan. */
  families: string[];
  /** Extensions sorted into this group's folder afterwards. */
  exts: string[];
}

export const RECOVER_GROUPS: RecoverGroup[] = [
  { id: 'photos', label: 'Photos', families: ['jpg', 'png', 'gif', 'bmp', 'tif', 'raw', 'orf', 'psd'], exts: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'tif', 'tiff', 'cr2', 'cr3', 'nef', 'nrw', 'dng', 'arw', 'orf', 'raf', 'rw2', 'pef', 'srw', 'heic', 'raw', 'psd', 'webp'] },
  { id: 'documents', label: 'Documents', families: ['pdf', 'doc', 'zip', 'pst'], exts: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'txt', 'pst', 'pub', 'vsd', 'one'] },
  { id: 'videos', label: 'Videos', families: ['mov', 'mkv', 'riff', 'mpg', 'm2ts', 'asf'], exts: ['mov', 'mp4', 'm4v', '3gp', 'mkv', 'avi', 'mpg', 'mpeg', 'mts', 'm2ts', 'wmv', 'webm'] },
  { id: 'music', label: 'Music and recordings', families: ['mp3', 'flac', 'ogg', 'riff', 'asf', 'mov'], exts: ['mp3', 'm4a', 'flac', 'ogg', 'wav', 'wma', 'aac', 'amr'] },
];

/**
 * PhotoRec's command line. On Mac and Linux the device is one volume (a partition, a USB stick or a memory
 * card), so the partition table is "none". Windows' PhotoRec cannot read a drive letter directly, so there it
 * is the whole disk plus the partition's number. Free space only finds deleted files; the whole volume is
 * for a card or drive that was formatted or will not open.
 */
export function photorecArgs(device: string, dest: string, groups: string[], whole: boolean, partition = 'partition_none'): string[] {
  const fams = [...new Set(RECOVER_GROUPS.filter((g) => groups.includes(g.id)).flatMap((g) => g.families))];
  const fileopt = groups.includes('everything') || !fams.length ? [] : ['fileopt', 'everything', 'disable', ...fams.flatMap((f) => [f, 'enable'])];
  const opts = [partition, 'options', 'keep_corrupted_file_no', ...fileopt, whole ? 'wholespace' : 'freespace', 'search'];
  return ['/log', '/d', path.join(dest, 'recup_dir'), '/cmd', device, opts.join(',')];
}

/** Files PhotoRec has saved so far (it writes recup_dir.1, recup_dir.2, ... with 500 files in each). */
export function countRecovered(dest: string): number {
  let n = 0;
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(dest).filter((d) => /^recup_dir\.\d+$/.test(d));
  } catch {
    return 0;
  }
  for (const d of dirs) {
    try {
      n += fs.readdirSync(path.join(dest, d)).filter((f) => f !== 'report.xml').length;
    } catch {
      /* skip */
    }
  }
  return n;
}

/** Moves recovered files into Photos, Documents, Videos, Music and Other, by type, and removes the empty PhotoRec folders. */
export function sortRecovered(dest: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const groupOf = (ext: string) => RECOVER_GROUPS.find((g) => g.exts.includes(ext))?.label ?? 'Other';
  let dirs: string[] = [];
  try {
    dirs = fs.readdirSync(dest).filter((d) => /^recup_dir\.\d+$/.test(d));
  } catch {
    return counts;
  }
  for (const d of dirs) {
    const from = path.join(dest, d);
    for (const f of fs.readdirSync(from)) {
      if (f === 'report.xml') continue;
      const ext = path.extname(f).slice(1).toLowerCase();
      const label = groupOf(ext);
      const toDir = path.join(dest, label);
      fs.mkdirSync(toDir, { recursive: true });
      let to = path.join(toDir, f);
      for (let i = 2; fs.existsSync(to); i++) to = path.join(toDir, `${path.basename(f, path.extname(f))}-${i}${path.extname(f)}`);
      fs.renameSync(path.join(from, f), to);
      counts[label] = (counts[label] ?? 0) + 1;
    }
    try {
      fs.rmSync(path.join(from, 'report.xml'), { force: true });
      fs.rmdirSync(from);
    } catch {
      /* leave it */
    }
  }
  return counts;
}

/** Where PhotoRec is: on the PATH for Mac and Linux, inside the winget package folder on Windows. */
export function findPhotorec(platform: string, env: Record<string, string | undefined>, exists: (p: string) => boolean = fs.existsSync, list: (d: string) => string[] = (d) => fs.readdirSync(d)): string | null {
  if (platform === 'win32') {
    const roots = [path.join(env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Packages'), path.join(env.ProgramFiles ?? 'C:\\Program Files', 'WinGet', 'Packages')];
    for (const root of roots) {
      let pkgs: string[] = [];
      try {
        pkgs = list(root).filter((p) => /^CGSecurity\.TestDisk/i.test(p));
      } catch {
        continue;
      }
      for (const p of pkgs) {
        const base = path.join(root, p);
        const direct = path.join(base, 'photorec_win.exe');
        if (exists(direct)) return direct;
        let subs: string[] = [];
        try {
          subs = list(base);
        } catch {
          continue;
        }
        for (const s of subs.sort().reverse()) {
          const exe = path.join(base, s, 'photorec_win.exe');
          if (exists(exe)) return exe;
        }
      }
    }
    for (const d of [path.join(env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Links'), env.MENDKIT_PHOTOREC_DIR ?? '']) {
      if (d && exists(path.join(d, 'photorec_win.exe'))) return path.join(d, 'photorec_win.exe');
    }
    return null;
  }
  const dirs = [...(env.PATH ?? '').split(':'), '/usr/sbin', '/usr/bin', '/sbin', '/usr/local/bin', '/usr/local/sbin', '/opt/homebrew/bin'];
  for (const d of dirs) if (d && exists(path.join(d, 'photorec'))) return path.join(d, 'photorec');
  return null;
}

export interface RecoverVolume {
  /** What PhotoRec is given: /dev/sdb1, /dev/rdisk4s1, or \\.\PhysicalDrive1 on Windows */
  device: string;
  /** PhotoRec's partition choice: its number on the disk (Windows), or partition_none for a volume. */
  partition: string;
  label: string;
  size: number;
  fs: string;
  mount: string;
  removable: boolean;
  /** An SSD that is part of the computer: deleted files are usually wiped within minutes (TRIM). */
  internalSsd: boolean;
  /** The drive the system runs from. */
  system: boolean;
}

/** Volumes from `lsblk -J -b -o NAME,PATH,SIZE,FSTYPE,LABEL,MOUNTPOINT,TYPE,TRAN,RM,HOTPLUG,ROTA`. */
export function linuxVolumes(json: string): RecoverVolume[] {
  let j: any;
  try {
    j = JSON.parse(json);
  } catch {
    return [];
  }
  const out: RecoverVolume[] = [];
  const truthy = (v: any) => v === true || v === '1' || v === 1;
  const walk = (list: any[], disk: any) => {
    for (const d of list ?? []) {
      const theDisk = d.type === 'disk' ? d : disk;
      if ((d.type === 'part' || (d.type === 'disk' && !(d.children ?? []).length)) && d.fstype && !/swap|crypto_LUKS|LVM2_member|squashfs|iso9660/.test(d.fstype)) {
        const removable = truthy(theDisk?.rm) || truthy(theDisk?.hotplug) || theDisk?.tran === 'usb';
        out.push({
          device: d.path,
          partition: 'partition_none',
          label: d.label ?? '',
          size: Number(d.size) || 0,
          fs: d.fstype,
          mount: d.mountpoint ?? '',
          removable,
          internalSsd: !removable && !truthy(theDisk?.rota),
          system: d.mountpoint === '/' || d.mountpoint === '/boot' || d.mountpoint === '/boot/efi' || d.mountpoint === '/home',
        });
      }
      walk(d.children, theDisk);
    }
  };
  walk(j.blockdevices, null);
  return out;
}

/** Volumes from the Windows script (Get-Volume joined with the disk it is on). */
export function windowsVolumes(json: string, systemDrive = 'C:'): RecoverVolume[] {
  let j: any;
  try {
    j = JSON.parse(json);
  } catch {
    return [];
  }
  return (Array.isArray(j) ? j : j ? [j] : [])
    .filter((v: any) => v.letter && v.disk !== undefined && v.disk !== null && v.disk !== '')
    .map((v: any) => {
      const removable = v.driveType === 'Removable' || /USB|SD|MMC/i.test(String(v.bus ?? ''));
      // A partition at the very start of the disk is a stick with no partition table.
      const whole = !(Number(v.part) > 0) || Number(v.offset) === 0;
      return {
        device: `\\\\.\\PhysicalDrive${v.disk}`,
        partition: whole ? 'partition_none' : String(v.part),
        label: String(v.label ?? ''),
        size: Number(v.size) || 0,
        fs: String(v.fs ?? ''),
        mount: `${v.letter}:\\`,
        removable,
        internalSsd: !removable && /SSD/i.test(String(v.media ?? '')),
        system: `${v.letter}:`.toUpperCase() === systemDrive.toUpperCase(),
      };
    });
}

/** External volumes from `diskutil list -plist external physical`, converted to JSON. Macs' internal SSDs are encrypted, so they are not offered. */
export function macVolumes(json: string): RecoverVolume[] {
  let j: any;
  try {
    j = JSON.parse(json);
  } catch {
    return [];
  }
  const out: RecoverVolume[] = [];
  for (const d of j.AllDisksAndPartitions ?? []) {
    const parts = d.Partitions?.length ? d.Partitions : d.Content && !/GUID|FDisk/.test(d.Content) ? [d] : [];
    for (const p of parts) {
      if (/EFI|Apple_Boot|Microsoft Reserved/.test(String(p.Content)) || p.VolumeName === 'EFI') continue;
      out.push({ device: `/dev/r${p.DeviceIdentifier}`, partition: 'partition_none', label: String(p.VolumeName ?? ''), size: Number(p.Size) || 0, fs: String(p.Content ?? ''), mount: String(p.MountPoint ?? ''), removable: true, internalSsd: false, system: false });
    }
  }
  return out;
}

/** True when the folder is on the volume being scanned: recovering onto it would overwrite what is being recovered. */
export function sameVolume(dest: string, vol: RecoverVolume, platform: string, destDevice?: string): boolean {
  if (platform === 'win32') return path.win32.parse(path.win32.resolve(dest)).root.slice(0, 2).toUpperCase() === vol.mount.slice(0, 2).toUpperCase();
  if (destDevice) return destDevice.replace('/dev/r', '/dev/') === vol.device.replace('/dev/r', '/dev/');
  return !!vol.mount && (path.resolve(dest) + '/').startsWith(vol.mount.replace(/\/?$/, '/'));
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * The search as one command: PhotoRec runs in the background (its screen is not readable in a log) while
 * the count of files found so far is printed every 20 seconds. On Mac and Linux it runs as root, so the
 * results are handed back to the person afterwards.
 */
export function photorecScan(platform: string, photorec: string, vol: { device: string; partition: string }, folder: string, groups: string[], whole: boolean, what: string, owner: { uid: number; gid: number }): CommandDef {
  const args = photorecArgs(vol.device, folder, groups, whole, vol.partition);
  const notes = [
    { pattern: 'Finished\\. 0 files found', level: 'attention' as const, message: 'No files were found. On an SSD inside a computer, deleted files are usually wiped within minutes. Try "Search the whole drive" if the drive was formatted.' },
    { pattern: 'Finished\\. 1 files found', level: 'good' as const, message: 'One file was found and copied out. The drive that was searched was not changed.' },
    { pattern: 'Finished\\. (\\d+) files found', level: 'good' as const, message: 'Files found and copied out: $1. The drive that was searched was not changed.' },
  ];
  const base = { id: 'recover-scan', name: `Search ${what} for deleted files`, description: '', admin: true, typicalMinutes: 60, friendly: { title: `Search ${what}`, ok: 'The search finished.', problem: 'The search did not finish.', notes } };
  if (platform === 'win32') {
    const argLine = args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
    const script = [
      "$ErrorActionPreference='Stop'",
      `$d = ${psq(folder)}`,
      'New-Item -ItemType Directory -Force -Path $d | Out-Null',
      `$p = Start-Process -FilePath ${psq(photorec)} -ArgumentList ${psq(argLine)} -WorkingDirectory $d -WindowStyle Hidden -PassThru`,
      "$count = { @(Get-ChildItem -LiteralPath $d -Recurse -File -ErrorAction SilentlyContinue | Where-Object { $_.Directory.Name -like 'recup_dir.*' -and $_.Name -ne 'report.xml' }).Count }",
      '$i = 0; while (-not $p.HasExited) { Start-Sleep -Seconds 2; $i++; if ($i % 10 -eq 0) { "Found so far: $(& $count) files" } }',
      '$p.WaitForExit(); if ($p.ExitCode) { "PhotoRec stopped with code $($p.ExitCode)." }',
      '"Finished. $(& $count) files found."',
    ].join('; ');
    return { ...base, exec: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', script] };
  }
  const n = `$(find ${shq(folder)} -type f -path '*/recup_dir.*' ! -name report.xml | wc -l | tr -d ' ')`;
  const script = [
    `mkdir -p ${shq(folder)} || exit 1`,
    `cd ${shq(folder)}`,
    `TERM=dumb ${[photorec, ...args].map(shq).join(' ')} >/dev/null 2>&1 &`,
    'p=$!',
    `stop() { kill $p 2>/dev/null; chown -R ${owner.uid}:${owner.gid} ${shq(folder)}; exit 130; }`,
    'trap stop TERM INT HUP',
    'i=0',
    `while kill -0 $p 2>/dev/null; do sleep 2 & wait $!; i=$((i+1)); [ $((i % 10)) -eq 0 ] && echo "Found so far: ${n} files"; done`,
    'wait $p',
    `chown -R ${owner.uid}:${owner.gid} ${shq(folder)}`,
    `echo "Finished. ${n} files found."`,
  ].join('\n');
  return { ...base, exec: 'sh', args: ['-c', script] };
}
