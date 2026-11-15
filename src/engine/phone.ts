import * as fs from 'fs';
import * as path from 'path';

/**
 * Phone helpers: copying photos and videos off a phone plugged in by USB, and checking the iPhone and iPad
 * backups kept on this computer. Kept free of Electron so the parsing and the copy plan can be tested.
 */

/** Photo and video files worth copying (not the .AAE edit notes iPhones keep beside edited photos). */
export const MEDIA = /\.(jpe?g|heic|heif|png|gif|webp|dng|raw|cr2|nef|arw|mov|mp4|m4v|3gp|avi|mkv|webm)$/i;

// ---------- Property lists (iPhone backup details) ----------

/** Reads an XML property list into plain values. */
export function parseXmlPlist(xml: string): any {
  let i = 0;
  const next = (): any => {
    const m = /<(\/?)(\w+)(\s*\/)?>/g;
    m.lastIndex = i;
    let t = m.exec(xml);
    while (t && (t[2] === 'plist' || t[2] === 'xml')) {
      i = m.lastIndex;
      t = m.exec(xml);
    }
    if (!t) return undefined;
    i = m.lastIndex;
    const [, close, tag, selfClose] = t;
    if (close) return Symbol.for('end');
    if (selfClose) return tag === 'true' ? true : tag === 'false' ? false : tag === 'dict' ? {} : tag === 'array' ? [] : '';
    if (tag === 'dict') {
      const o: Record<string, any> = {};
      for (;;) {
        const k = next();
        if (k === Symbol.for('end') || k === undefined) return o;
        o[String(k)] = next();
      }
    }
    if (tag === 'array') {
      const a: any[] = [];
      for (;;) {
        const v = next();
        if (v === Symbol.for('end') || v === undefined) return a;
        a.push(v);
      }
    }
    const end = xml.indexOf(`</${tag}>`, i);
    const text = xml.slice(i, end).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    i = end + tag.length + 3;
    if (tag === 'integer') return Number(text);
    if (tag === 'real') return Number(text);
    if (tag === 'date') return new Date(text.trim());
    if (tag === 'data') return Buffer.from(text.replace(/\s+/g, ''), 'base64');
    return text;
  };
  return next();
}

/** Reads a binary property list (bplist00), as in an iPhone backup's Manifest.plist. */
export function parseBinaryPlist(buf: Buffer): any {
  if (buf.subarray(0, 8).toString('latin1') !== 'bplist00') throw new Error('not a binary plist');
  const t = buf.subarray(buf.length - 32);
  const offSize = t[6];
  const refSize = t[7];
  const count = Number(t.readBigUInt64BE(8));
  const top = Number(t.readBigUInt64BE(16));
  const tableAt = Number(t.readBigUInt64BE(24));
  const uint = (at: number, size: number) => {
    let v = 0;
    for (let k = 0; k < size; k++) v = v * 256 + buf[at + k];
    return v;
  };
  const offsets = Array.from({ length: count }, (_x, n) => uint(tableAt + n * offSize, offSize));
  const read = (ref: number, depth = 0): any => {
    if (depth > 64) throw new Error('plist too deep');
    let at = offsets[ref];
    const marker = buf[at];
    const kind = marker >> 4;
    let len = marker & 0x0f;
    const lenAfter = () => {
      if (len === 0x0f) {
        const intMarker = buf[at + 1];
        const size = 1 << (intMarker & 0x0f);
        len = uint(at + 2, size);
        at += 2 + size;
      } else at += 1;
    };
    switch (kind) {
      case 0x0:
        return marker === 0x09 ? true : marker === 0x08 ? false : null;
      case 0x1:
        return uint(at + 1, 1 << len);
      case 0x2:
        return (1 << len) === 8 ? buf.readDoubleBE(at + 1) : buf.readFloatBE(at + 1);
      case 0x3:
        return new Date((buf.readDoubleBE(at + 1) + 978307200) * 1000);
      case 0x4:
        lenAfter();
        return buf.subarray(at, at + len);
      case 0x5:
        lenAfter();
        return buf.toString('latin1', at, at + len);
      case 0x6: {
        lenAfter();
        const b = Buffer.from(buf.subarray(at, at + len * 2));
        b.swap16();
        return b.toString('utf16le');
      }
      case 0xa: {
        lenAfter();
        return Array.from({ length: len }, (_x, n) => read(uint(at + n * refSize, refSize), depth + 1));
      }
      case 0xd: {
        lenAfter();
        const o: Record<string, any> = {};
        for (let n = 0; n < len; n++) o[String(read(uint(at + n * refSize, refSize), depth + 1))] = read(uint(at + (len + n) * refSize, refSize), depth + 1);
        return o;
      }
      default:
        return null;
    }
  };
  return read(top);
}

export const readPlist = (file: string): any => {
  const b = fs.readFileSync(file);
  return b.subarray(0, 8).toString('latin1') === 'bplist00' ? parseBinaryPlist(b) : parseXmlPlist(b.toString('utf8'));
};

// ---------- iPhone and iPad backups ----------

export interface IosBackup {
  dir: string;
  name: string;
  model: string;
  ios: string;
  date: string;
  encrypted: boolean | null;
}

/** Where iTunes, the Apple Devices app and Finder keep backups. */
export function iosBackupDirs(platform: string, home: string, env: Record<string, string | undefined>): string[] {
  if (platform === 'win32') return [path.join(env.APPDATA ?? path.join(home, 'AppData', 'Roaming'), 'Apple Computer', 'MobileSync', 'Backup'), path.join(home, 'Apple', 'MobileSync', 'Backup')];
  if (platform === 'darwin') return [path.join(home, 'Library', 'Application Support', 'MobileSync', 'Backup')];
  return [];
}

const MODELS: [RegExp, string][] = [[/^iPhone/, 'iPhone'], [/^iPad/, 'iPad'], [/^iPod/, 'iPod touch']];
export function readIosBackup(dir: string): IosBackup | null {
  let info: any;
  try {
    info = readPlist(path.join(dir, 'Info.plist'));
  } catch {
    return null;
  }
  let encrypted: boolean | null = null;
  try {
    encrypted = !!readPlist(path.join(dir, 'Manifest.plist')).IsEncrypted;
  } catch {
    /* unknown */
  }
  const product = String(info['Product Type'] ?? '');
  const date = info['Last Backup Date'] instanceof Date ? info['Last Backup Date'].toISOString() : '';
  return { dir, name: String(info['Device Name'] ?? info['Display Name'] ?? 'Unknown device'), model: `${MODELS.find(([r]) => r.test(product))?.[1] ?? 'Apple device'}${product ? ` (${product})` : ''}`, ios: String(info['Product Version'] ?? ''), date, encrypted };
}

export function listIosBackups(dirs: string[]): IosBackup[] {
  const out: IosBackup[] = [];
  for (const d of dirs) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(d);
    } catch {
      continue;
    }
    for (const n of names) {
      const b = readIosBackup(path.join(d, n));
      if (b) out.push(b);
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

// ---------- Phones mounted as folders (Linux) ----------

export interface PhoneSource {
  id: string;
  name: string;
  kind: 'android' | 'iphone' | 'camera';
  /** Folders holding photos, relative to the phone's root. */
  folders: string[];
  root: string;
}

/** Phones that GNOME, Cinnamon, MATE or Xfce (gvfs) have opened, under /run/user/<uid>/gvfs. */
export function gvfsPhones(gvfsDir: string): PhoneSource[] {
  let mounts: string[] = [];
  try {
    mounts = fs.readdirSync(gvfsDir).filter((m) => /^(mtp|gphoto2|afc):host=/.test(m));
  } catch {
    return [];
  }
  const out: PhoneSource[] = [];
  for (const m of mounts) {
    const root = path.join(gvfsDir, m);
    const host = decodeURIComponent(m.replace(/^\w+:host=/, '')).replace(/_/g, ' ');
    const kind: PhoneSource['kind'] = m.startsWith('afc') || /apple|iphone|ipad/i.test(host) ? 'iphone' : m.startsWith('mtp') ? 'android' : 'camera';
    const folders: string[] = [];
    const look = (rel: string, depth: number) => {
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(path.join(root, rel));
      } catch {
        return;
      }
      for (const e of entries) {
        if (/^(DCIM|Pictures|Movies)$/i.test(e)) folders.push(path.join(rel, e));
        else if (depth > 0 && !/^(Android|\.)/.test(e)) look(path.join(rel, e), depth - 1);
      }
    };
    look('', 1);
    if (folders.length) out.push({ id: `p${out.length}`, name: host.replace(/ ?(\d{6,}|[0-9a-f]{20,})$/i, '').trim() || 'Phone', kind, folders, root });
  }
  return out;
}

/** Every photo and video under the given folders, with sizes. */
export function listMedia(root: string, folders: string[], limit = 200000): { rel: string; size: number; mtime: number }[] {
  const out: { rel: string; size: number; mtime: number }[] = [];
  const walk = (rel: string) => {
    if (out.length >= limit) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) {
        if (!/^(\.thumbnails|\.trashed|\.Trash|cache)$/i.test(e.name)) walk(r);
      } else if (MEDIA.test(e.name)) {
        try {
          const st = fs.statSync(path.join(root, r));
          out.push({ rel: r, size: st.size, mtime: st.mtimeMs });
        } catch {
          /* gone */
        }
      }
    }
  };
  for (const f of folders) walk(f);
  return out;
}

/**
 * Which files still need copying. Files already in the destination with the same name and size are skipped,
 * so running it again after the next holiday only copies the new ones. Everything lands in one folder per
 * month the photo was taken (by file date), which is how most people look for photos.
 */
export function copyPlan(files: { rel: string; size: number; mtime: number }[], dest: string): { from: string; to: string; size: number }[] {
  const plan: { from: string; to: string; size: number }[] = [];
  const taken = new Set<string>();
  for (const f of files) {
    const d = new Date(f.mtime || Date.now());
    const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const ext = path.extname(f.rel);
    const stem = path.basename(f.rel, ext);
    for (let n = 1; n < 1000; n++) {
      // Same name but a different photo (phones restart their numbering): keep both, as name-2, name-3...
      const to = path.join(dest, month, n === 1 ? `${stem}${ext}` : `${stem}-${n}${ext}`);
      if (taken.has(to)) continue;
      let size = -1;
      try {
        size = fs.statSync(to).size;
      } catch {
        /* not there yet */
      }
      if (size === f.size) break;
      if (size === -1) {
        taken.add(to);
        plan.push({ from: f.rel, to, size: f.size });
        break;
      }
    }
  }
  return plan;
}
