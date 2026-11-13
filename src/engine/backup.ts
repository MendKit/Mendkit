import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { countApps } from './apps';
import { ItemSpec, MigrateEvent, MigrateSummary, safeTarget, ScannedItem, scanItems, walk } from './migrate';

/**
 * Backup to, and restore from, a folder on an external drive.
 *
 * A backup is a plain folder anyone can browse:
 *   manifest.json   what is inside, where it came from, the app list
 *   index.jsonl     one line per file with its size, date and SHA-256
 *   files/<item>/…  the files themselves
 * It is not encrypted. Restore checks every file against the index, so damage on the drive is caught.
 */

const CHUNK = 1024 * 1024;

export interface BackupManifest {
  mendkit: 'backup';
  version: 1;
  computer: string;
  platform: string;
  createdAt: string;
  items: ScannedItem[];
  apps: unknown | null;
}

interface IndexLine {
  item: string;
  rel: string;
  size: number;
  mtime: number;
  sha256: string;
}

export interface JobHandle {
  done: Promise<MigrateSummary>;
  cancel(): void;
}

/** Copies one file through a temporary name, returning its SHA-256. */
async function copyHashed(src: string, dst: string, shouldStop: () => boolean, onBytes: (n: number) => void): Promise<string> {
  await fs.promises.mkdir(path.dirname(dst), { recursive: true });
  const part = `${dst}.mendkit-part`;
  const hash = crypto.createHash('sha256');
  const input = await fs.promises.open(src, 'r');
  let output: fs.promises.FileHandle | null = null;
  try {
    output = await fs.promises.open(part, 'w');
    const buf = Buffer.allocUnsafe(CHUNK);
    for (;;) {
      const { bytesRead } = await input.read(buf, 0, CHUNK, null);
      if (bytesRead === 0) break;
      const chunk = buf.subarray(0, bytesRead);
      hash.update(chunk);
      await output.write(chunk);
      onBytes(bytesRead);
      if (shouldStop()) throw new Error('Cancelled');
    }
    await output.close();
    output = null;
    const st = await input.stat();
    await fs.promises.rename(part, dst);
    await fs.promises.utimes(dst, st.mtime, st.mtime);
    return hash.digest('hex');
  } catch (err) {
    await output?.close().catch(() => undefined);
    await fs.promises.unlink(part).catch(() => undefined);
    throw err;
  } finally {
    await input.close();
  }
}

function reason(err: unknown): string {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') return 'The file is open in another program or is protected';
  if (code === 'ENOSPC') return 'The drive is full';
  if (code === 'EFBIG') return 'The file is too big for this drive (FAT32 drives stop at 4 GB per file)';
  return (err as Error).message;
}

function readIndex(file: string): Map<string, IndexLine> {
  const map = new Map<string, IndexLine>();
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue;
      const e = JSON.parse(line) as IndexLine;
      map.set(`${e.item}/${e.rel}`, e);
    }
  } catch {
    /* no index yet */
  }
  return map;
}

function progressor(onEvent: (e: MigrateEvent) => void, totalBytes: number, totalFiles: number) {
  const state = { bytesDone: 0, filesDone: 0 };
  let last = 0;
  const emit = (current: string, force = false) => {
    const now = Date.now();
    if (!force && now - last < 200) return;
    last = now;
    onEvent({ phase: 'progress', bytesDone: state.bytesDone, totalBytes, filesDone: state.filesDone, totalFiles, current });
  };
  return { state, emit };
}

/** Copies the chosen items into `dir`. Running it again on the same folder only copies what changed. */
export function runBackup(opts: { dir: string; computer: string; items: ItemSpec[]; apps: unknown | null; onEvent: (e: MigrateEvent) => void }): JobHandle {
  let cancelled = false;
  const done = (async (): Promise<MigrateSummary> => {
    const t0 = Date.now();
    const scanned = await scanItems(opts.items);
    const totalBytes = scanned.reduce((n, i) => n + i.bytes, 0);
    const totalFiles = scanned.reduce((n, i) => n + i.files, 0);
    await fs.promises.mkdir(path.join(opts.dir, 'files'), { recursive: true });
    opts.onEvent({ phase: 'manifest', peer: opts.dir, items: scanned, totalBytes, totalFiles });

    const indexFile = path.join(opts.dir, 'index.jsonl');
    const old = readIndex(indexFile);
    const lines: string[] = [];
    const appsListed = countApps(opts.apps);
    const summary: MigrateSummary = { role: 'backup', peer: opts.dir, copied: 0, copiedBytes: 0, skipped: 0, failed: [], seconds: 0, appsListed, cancelled: false };
    const { state, emit } = progressor(opts.onEvent, totalBytes, totalFiles);

    outer: for (const spec of opts.items) {
      for await (const f of walk(spec)) {
        if (cancelled) break outer;
        const label = `${spec.label}/${f.rel}`;
        const key = `${spec.id}/${f.rel}`;
        try {
          const st = await fs.promises.stat(f.abs);
          const dst = safeTarget(path.join(opts.dir, 'files', spec.id), f.rel);
          const prev = old.get(key);
          let have = false;
          try {
            have = !!prev && prev.size === st.size && prev.mtime === Math.floor(st.mtimeMs) && (await fs.promises.stat(dst)).size === st.size;
          } catch {
            have = false;
          }
          if (have) {
            lines.push(JSON.stringify(prev));
            summary.skipped++;
            state.bytesDone += st.size;
          } else {
            const sha256 = await copyHashed(f.abs, dst, () => cancelled, (n) => {
              state.bytesDone += n;
              emit(label);
            });
            lines.push(JSON.stringify({ item: spec.id, rel: f.rel, size: st.size, mtime: Math.floor(st.mtimeMs), sha256 } satisfies IndexLine));
            summary.copied++;
            summary.copiedBytes += st.size;
          }
        } catch (err) {
          if (!cancelled) summary.failed.push({ file: label, reason: reason(err) });
          if ((err as NodeJS.ErrnoException).code === 'ENOSPC') {
            cancelled = true;
          }
        }
        state.filesDone++;
        emit(label);
      }
    }
    fs.writeFileSync(indexFile, lines.join('\n') + (lines.length ? '\n' : ''));
    const manifest: BackupManifest = { mendkit: 'backup', version: 1, computer: opts.computer, platform: process.platform, createdAt: new Date().toISOString(), items: scanned, apps: opts.apps };
    fs.writeFileSync(path.join(opts.dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    summary.cancelled = cancelled;
    summary.seconds = Math.round((Date.now() - t0) / 1000);
    emit('', true);
    return summary;
  })();
  return { done, cancel: () => (cancelled = true) };
}

/** Reads a backup folder's manifest, or throws if the folder is not a MendKit backup. */
export function readBackup(dir: string): BackupManifest {
  let m: BackupManifest;
  try {
    m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  } catch {
    throw new Error('That folder is not a MendKit backup. Choose the folder that contains manifest.json.');
  }
  if (m.mendkit !== 'backup' || !Array.isArray(m.items)) throw new Error('That folder is not a MendKit backup.');
  return m;
}

/** Copies items from a backup into this computer's folders. Existing files are never overwritten. */
export function runRestore(opts: { dir: string; roots: Record<string, string>; itemIds: string[]; appsFile?: string; onEvent: (e: MigrateEvent) => void }): JobHandle {
  let cancelled = false;
  const done = (async (): Promise<MigrateSummary> => {
    const t0 = Date.now();
    const manifest = readBackup(opts.dir);
    const want = new Set(opts.itemIds);
    const entries = [...readIndex(path.join(opts.dir, 'index.jsonl')).values()].filter((e) => want.has(e.item));
    const totalBytes = entries.reduce((n, e) => n + e.size, 0);
    const apps: any = manifest.apps;
    let appsListed = 0;
    if (apps && opts.appsFile) {
      fs.writeFileSync(opts.appsFile, JSON.stringify(apps));
      appsListed = countApps(apps);
    }
    const summary: MigrateSummary = { role: 'restore', peer: manifest.computer, copied: 0, copiedBytes: 0, skipped: 0, failed: [], seconds: 0, appsListed, cancelled: false };
    const { state, emit } = progressor(opts.onEvent, totalBytes, entries.length);
    opts.onEvent({ phase: 'manifest', peer: manifest.computer, items: manifest.items.filter((i) => want.has(i.id)), totalBytes, totalFiles: entries.length });

    for (const e of entries) {
      if (cancelled) break;
      const label = `${e.item}/${e.rel}`;
      try {
        const root = opts.roots[e.item];
        if (!root) throw new Error('This computer has no matching folder');
        const src = safeTarget(path.join(opts.dir, 'files', e.item), e.rel);
        let target = safeTarget(root, e.rel);
        const sameSize = (p: string) => {
          try {
            return fs.statSync(p).size === e.size;
          } catch {
            return null;
          }
        };
        let exists = sameSize(target);
        if (exists === false) {
          const ext = path.extname(target);
          target = `${target.slice(0, target.length - ext.length)} (restored)${ext}`;
          exists = sameSize(target);
        }
        if (exists) {
          summary.skipped++;
          state.bytesDone += e.size;
        } else {
          const sha256 = await copyHashed(src, target, () => cancelled, (n) => {
            state.bytesDone += n;
            emit(label);
          });
          if (sha256 !== e.sha256) {
            await fs.promises.unlink(target).catch(() => undefined);
            throw new Error('The copy on the backup drive is damaged');
          }
          const m = new Date(e.mtime);
          await fs.promises.utimes(target, m, m);
          summary.copied++;
          summary.copiedBytes += e.size;
        }
      } catch (err) {
        if (!cancelled) summary.failed.push({ file: label, reason: reason(err) });
      }
      state.filesDone++;
      emit(label);
    }
    summary.cancelled = cancelled;
    summary.seconds = Math.round((Date.now() - t0) / 1000);
    emit('', true);
    return summary;
  })();
  return { done, cancel: () => (cancelled = true) };
}

/**
 * Copies items straight from an old drive's folders into this computer's folders.
 * Existing files are never overwritten, and every copy is read back and compared by SHA-256.
 */
export function runImport(opts: { peer: string; items: ItemSpec[]; roots: Record<string, string>; apps?: unknown | null; appsFile?: string; onEvent: (e: MigrateEvent) => void }): JobHandle {
  let cancelled = false;
  const done = (async (): Promise<MigrateSummary> => {
    const t0 = Date.now();
    const scanned = await scanItems(opts.items);
    const totalBytes = scanned.reduce((n, i) => n + i.bytes, 0);
    const totalFiles = scanned.reduce((n, i) => n + i.files, 0);
    let appsListed = 0;
    if (opts.apps && opts.appsFile) {
      fs.writeFileSync(opts.appsFile, JSON.stringify(opts.apps));
      appsListed = countApps(opts.apps);
    }
    opts.onEvent({ phase: 'manifest', peer: opts.peer, items: scanned, totalBytes, totalFiles });
    const summary: MigrateSummary = { role: 'restore', peer: opts.peer, copied: 0, copiedBytes: 0, skipped: 0, failed: [], seconds: 0, appsListed, cancelled: false };
    const { state, emit } = progressor(opts.onEvent, totalBytes, totalFiles);
    outer: for (const spec of opts.items) {
      for await (const f of walk(spec)) {
        if (cancelled) break outer;
        const label = `${spec.label}/${f.rel}`;
        try {
          const root = opts.roots[spec.id];
          if (!root) throw new Error('This computer has no matching folder');
          const st = await fs.promises.stat(f.abs);
          let target = safeTarget(root, f.rel);
          const sameSize = (p: string) => {
            try {
              return fs.statSync(p).size === st.size;
            } catch {
              return null;
            }
          };
          let exists = sameSize(target);
          if (exists === false) {
            const ext = path.extname(target);
            target = `${target.slice(0, target.length - ext.length)} (restored)${ext}`;
            exists = sameSize(target);
          }
          if (exists) {
            summary.skipped++;
            state.bytesDone += st.size;
          } else {
            const sha256 = await copyHashed(f.abs, target, () => cancelled, (n) => {
              state.bytesDone += n;
              emit(label);
            });
            if ((await hashFile(target)) !== sha256) {
              await fs.promises.unlink(target).catch(() => undefined);
              throw new Error('The copy did not match the original');
            }
            summary.copied++;
            summary.copiedBytes += st.size;
          }
        } catch (err) {
          if (!cancelled) summary.failed.push({ file: label, reason: reason(err) });
          if ((err as NodeJS.ErrnoException).code === 'ENOSPC') cancelled = true;
        }
        state.filesDone++;
        emit(label);
      }
    }
    summary.cancelled = cancelled;
    summary.seconds = Math.round((Date.now() - t0) / 1000);
    emit('', true);
    return summary;
  })();
  return { done, cancel: () => (cancelled = true) };
}

function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => hash.update(d)).on('end', () => resolve(hash.digest('hex'))).on('error', reject);
  });
}

