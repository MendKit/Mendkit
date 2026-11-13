import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Overwrite-then-delete for chosen files and folders, and a free-space overwrite.
 * On solid-state drives an overwrite cannot be guaranteed to reach every old copy.
 */

const CHUNK = 1024 * 1024;

/** Folders MendKit refuses to erase, whatever was picked. */
export function isProtected(target: string, extra: string[] = []): boolean {
  const p = path.resolve(target);
  const norm = (x: string) => (process.platform === 'win32' ? x.toLowerCase() : x);
  const np = norm(p);
  if (path.parse(p).root === p) return true; // a whole drive or /
  const home = path.resolve(os.homedir());
  const fixed = [home, path.dirname(home), ...extra];
  if (process.platform === 'win32') {
    const sys = process.env.SystemRoot ?? 'C:\\Windows';
    fixed.push(sys, process.env.ProgramFiles ?? 'C:\\Program Files', process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', process.env.ProgramData ?? 'C:\\ProgramData', path.join(home, 'AppData'));
  } else {
    fixed.push('/bin', '/boot', '/dev', '/etc', '/lib', '/lib64', '/opt', '/proc', '/root', '/run', '/sbin', '/sys', '/usr', '/var', '/System', '/Library', '/Applications', '/private', '/Volumes', '/home', '/Users', path.join(home, 'Library'));
  }
  for (const f of fixed) {
    const nf = norm(path.resolve(f));
    // The folder itself, or anything that contains it, is off limits. System folders are also protected inside.
    if (np === nf || nf.startsWith(np + path.sep)) return true;
  }
  const inside = process.platform === 'win32' ? [process.env.SystemRoot ?? 'C:\\Windows'] : ['/bin', '/boot', '/etc', '/lib', '/sbin', '/usr', '/System'];
  return inside.some((f) => np.startsWith(norm(path.resolve(f)) + path.sep));
}

export interface WipeCount {
  files: number;
  bytes: number;
}

export function measure(target: string): WipeCount {
  const out = { files: 0, bytes: 0 };
  const visit = (p: string) => {
    let st: fs.Stats;
    try {
      st = fs.lstatSync(p);
    } catch {
      return;
    }
    if (st.isSymbolicLink()) out.files++;
    else if (st.isDirectory()) {
      try {
        for (const n of fs.readdirSync(p)) visit(path.join(p, n));
      } catch {
        /* unreadable */
      }
    } else {
      out.files++;
      out.bytes += st.size;
    }
  };
  visit(target);
  return out;
}

async function shredFile(file: string, onBytes: (n: number) => void, shouldStop: () => boolean): Promise<void> {
  const st = await fs.promises.lstat(file);
  if (st.isSymbolicLink() || !st.isFile()) {
    await fs.promises.unlink(file); // never follow a link
    return;
  }
  try {
    await fs.promises.chmod(file, 0o600);
  } catch {
    /* try anyway */
  }
  const fh = await fs.promises.open(file, 'r+');
  try {
    let left = st.size;
    let pos = 0;
    while (left > 0) {
      if (shouldStop()) throw new Error('Cancelled');
      const n = Math.min(CHUNK, left);
      await fh.write(crypto.randomBytes(n), 0, n, pos);
      pos += n;
      left -= n;
      onBytes(n);
    }
    await fh.sync();
  } finally {
    await fh.close();
  }
  // Rename so the original name does not linger in the folder's records, then delete.
  const anon = path.join(path.dirname(file), crypto.randomBytes(8).toString('hex'));
  await fs.promises.rename(file, anon);
  await fs.promises.unlink(anon);
}

/** Overwrites and deletes every file under each target, then removes the emptied folders. */
export async function shredPaths(targets: string[], onProgress: (done: WipeCount, current: string) => void, shouldStop: () => boolean): Promise<{ erased: number; bytes: number; failed: { file: string; reason: string }[] }> {
  const done = { files: 0, bytes: 0 };
  const failed: { file: string; reason: string }[] = [];
  const visit = async (p: string): Promise<void> => {
    if (shouldStop()) return;
    let st: fs.Stats;
    try {
      st = await fs.promises.lstat(p);
    } catch {
      return;
    }
    if (st.isDirectory() && !st.isSymbolicLink()) {
      let names: string[] = [];
      try {
        names = await fs.promises.readdir(p);
      } catch (err) {
        failed.push({ file: p, reason: (err as Error).message });
        return;
      }
      for (const n of names) await visit(path.join(p, n));
      if (!shouldStop()) await fs.promises.rmdir(p).catch(() => undefined);
      return;
    }
    try {
      await shredFile(p, (n) => {
        done.bytes += n;
        onProgress(done, p);
      }, shouldStop);
      done.files++;
      onProgress(done, p);
    } catch (err) {
      if (!shouldStop()) failed.push({ file: p, reason: (err as NodeJS.ErrnoException).code === 'EBUSY' || (err as NodeJS.ErrnoException).code === 'EPERM' ? 'The file is open in another program or is protected' : (err as Error).message });
    }
  };
  for (const t of targets) {
    if (isProtected(t)) {
      failed.push({ file: t, reason: 'MendKit does not erase system folders or whole user folders' });
      continue;
    }
    await visit(t);
  }
  return { erased: done.files, bytes: done.bytes, failed };
}

/**
 * Fills the free space of the drive holding `dir` with zeros, then deletes the fill files.
 * Stops `keepBytes` short of full so the system keeps working while it runs.
 */
export async function wipeFreeSpace(dir: string, onProgress: (written: number, total: number) => void, shouldStop: () => boolean, keepBytes = 512 * 1024 * 1024, maxBytes = Infinity): Promise<{ written: number }> {
  const work = path.join(dir, `mendkit-wipe-${crypto.randomBytes(4).toString('hex')}`);
  await fs.promises.mkdir(work, { recursive: true });
  const zeros = Buffer.alloc(4 * CHUNK);
  const free = () => {
    const st = fs.statfsSync(work);
    return st.bavail * st.bsize;
  };
  const total = Math.min(maxBytes, Math.max(0, free() - keepBytes));
  let written = 0;
  let n = 0;
  try {
    outer: while (written < total && !shouldStop()) {
      // Separate files of at most 2 GB keep this working on FAT32 drives too.
      const fh = await fs.promises.open(path.join(work, `fill-${n++}`), 'w');
      let size = 0;
      try {
        while (size < 2 * 1024 ** 3 - zeros.length && written < total) {
          if (shouldStop()) break outer;
          if (free() <= keepBytes) break outer;
          const len = Math.min(zeros.length, total - written);
          await fh.write(zeros, 0, len);
          size += len;
          written += len;
          onProgress(written, total);
        }
        await fh.sync();
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOSPC') break outer;
        throw err;
      } finally {
        await fh.close();
      }
    }
  } finally {
    await fs.promises.rm(work, { recursive: true, force: true });
  }
  return { written };
}
