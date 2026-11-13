import * as crypto from 'crypto';
import * as dgram from 'dgram';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { countApps } from './apps';

/**
 * Computer-to-computer migration over the local network.
 *
 * The Destination listens and shows a six-digit code. The Source connects, both sides do an
 * X25519 key exchange, and the session keys are derived from the shared secret AND the code
 * (scrypt), so a connection without the right code cannot read or send anything.
 * Every frame after that is AES-256-GCM. Files are verified with SHA-256 before they are kept.
 */

export const BEACON_PORT = 47600;
export const DEFAULT_PORT = 47601;
const MAGIC = 'mendkit-migrate-1';
const CHUNK = 256 * 1024;
const MAX_FRAME = 8 * 1024 * 1024;
const T_JSON = 1;
const T_CHUNK = 2;

export interface ItemSpec {
  id: string;
  label: string;
  root: string;
  /** File or folder names to leave out anywhere under the root (saved passwords, caches, locks). */
  exclude?: string[];
  /** If set, only these files directly under the root are moved. */
  only?: string[];
}

export interface ScannedItem {
  id: string;
  label: string;
  files: number;
  bytes: number;
}

export interface MigrateSummary {
  role: 'source' | 'destination' | 'backup' | 'restore';
  peer: string;
  copied: number;
  copiedBytes: number;
  skipped: number;
  failed: { file: string; reason: string }[];
  seconds: number;
  appsListed: number;
  cancelled: boolean;
}

export type MigrateEvent =
  | { phase: 'waiting' | 'paired' | 'locked'; peer?: string }
  | { phase: 'manifest'; peer: string; items: ScannedItem[]; totalBytes: number; totalFiles: number }
  | { phase: 'progress'; bytesDone: number; totalBytes: number; filesDone: number; totalFiles: number; current: string }
  | { phase: 'done'; summary: MigrateSummary }
  | { phase: 'error'; message: string };

// ---------- encrypted channel ----------

class Channel {
  private buf: Buffer[] = [];
  private len = 0;
  private waiter: (() => void) | null = null;
  private closed = false;
  private sendCtr = 0n;
  private recvCtr = 0n;
  private sendKey: Buffer | null = null;
  private recvKey: Buffer | null = null;

  constructor(public readonly sock: net.Socket) {
    sock.on('data', (d: Buffer) => {
      this.buf.push(d);
      this.len += d.length;
      if (this.len > 4 * MAX_FRAME) sock.pause();
      this.wake();
    });
    const end = () => {
      this.closed = true;
      this.wake();
    };
    sock.on('close', end);
    sock.on('error', end);
  }

  private wake(): void {
    const w = this.waiter;
    this.waiter = null;
    w?.();
  }

  close(): void {
    this.sock.destroy();
  }

  private async read(n: number): Promise<Buffer> {
    while (this.len < n) {
      if (this.closed) throw new Error('The connection closed');
      await new Promise<void>((r) => (this.waiter = r));
    }
    const all = this.buf.length === 1 ? this.buf[0] : Buffer.concat(this.buf);
    const out = all.subarray(0, n);
    const rest = all.subarray(n);
    this.buf = rest.length ? [rest] : [];
    this.len = rest.length;
    if (this.len < MAX_FRAME && this.sock.isPaused()) this.sock.resume();
    return out;
  }

  private write(b: Buffer): Promise<void> {
    if (this.closed) return Promise.reject(new Error('The connection closed'));
    return new Promise((resolve) => {
      if (this.sock.write(b)) resolve();
      else this.sock.once('drain', resolve);
    });
  }

  private async readPlain(): Promise<any> {
    const n = (await this.read(4)).readUInt32BE(0);
    if (n > 4096) throw new Error('Bad handshake');
    return JSON.parse((await this.read(n)).toString('utf8'));
  }

  private writePlain(obj: unknown): Promise<void> {
    const body = Buffer.from(JSON.stringify(obj), 'utf8');
    const head = Buffer.alloc(4);
    head.writeUInt32BE(body.length);
    return this.write(Buffer.concat([head, body]));
  }

  /** Key exchange. Both sides must use the same code or nothing after this can be read. */
  async handshake(role: 'source' | 'destination', code: string): Promise<void> {
    const kp = crypto.generateKeyPairSync('x25519');
    const myPub = kp.publicKey.export({ type: 'spki', format: 'der' });
    let peerPub: Buffer;
    if (role === 'source') {
      await this.writePlain({ magic: MAGIC, pub: myPub.toString('base64') });
      peerPub = Buffer.from(String((await this.readPlain()).pub), 'base64');
    } else {
      const hello = await this.readPlain();
      if (hello.magic !== MAGIC) throw new Error('Not a MendKit connection');
      peerPub = Buffer.from(String(hello.pub), 'base64');
      await this.writePlain({ pub: myPub.toString('base64') });
    }
    const secret = crypto.diffieHellman({ privateKey: kp.privateKey, publicKey: crypto.createPublicKey({ key: peerPub, type: 'spki', format: 'der' }) });
    const [srcPub, dstPub] = role === 'source' ? [myPub, peerPub] : [peerPub, myPub];
    const salt = crypto.createHash('sha256').update(secret).update(srcPub).update(dstPub).digest();
    const keys = await new Promise<Buffer>((resolve, reject) => crypto.scrypt(code, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? reject(e) : resolve(k))));
    const a = keys.subarray(0, 32);
    const b = keys.subarray(32, 64);
    [this.sendKey, this.recvKey] = role === 'source' ? [a, b] : [b, a];
  }

  private nonce(ctr: bigint): Buffer {
    const n = Buffer.alloc(12);
    n.writeBigUInt64BE(ctr, 4);
    return n;
  }

  async send(type: number, payload: Buffer): Promise<void> {
    const c = crypto.createCipheriv('aes-256-gcm', this.sendKey!, this.nonce(this.sendCtr++));
    const ct = Buffer.concat([c.update(Buffer.from([type])), c.update(payload), c.final(), c.getAuthTag()]);
    const head = Buffer.alloc(4);
    head.writeUInt32BE(ct.length);
    await this.write(Buffer.concat([head, ct]));
  }

  sendJson(obj: unknown): Promise<void> {
    return this.send(T_JSON, Buffer.from(JSON.stringify(obj), 'utf8'));
  }

  async recv(): Promise<{ type: number; payload: Buffer }> {
    const n = (await this.read(4)).readUInt32BE(0);
    if (n < 17 || n > MAX_FRAME) throw new Error('Bad frame');
    const body = await this.read(n);
    const d = crypto.createDecipheriv('aes-256-gcm', this.recvKey!, this.nonce(this.recvCtr++));
    d.setAuthTag(body.subarray(n - 16));
    let plain: Buffer;
    try {
      plain = Buffer.concat([d.update(body.subarray(0, n - 16)), d.final()]);
    } catch {
      throw new Error('wrong-code');
    }
    return { type: plain[0], payload: plain.subarray(1) };
  }

  async recvJson(expect?: string): Promise<any> {
    const f = await this.recv();
    if (f.type !== T_JSON) throw new Error('Unexpected data');
    const obj = JSON.parse(f.payload.toString('utf8'));
    if (expect && obj.t !== expect) throw new Error(`Expected ${expect}, got ${obj.t}`);
    return obj;
  }
}

// ---------- file walking ----------

export async function* walk(spec: ItemSpec): AsyncGenerator<{ abs: string; rel: string }> {
  const exclude = new Set((spec.exclude ?? []).map((x) => x.toLowerCase()));
  if (spec.only) {
    for (const name of spec.only) {
      const abs = path.join(spec.root, name);
      try {
        if ((await fs.promises.lstat(abs)).isFile()) yield { abs, rel: name };
      } catch {
        /* not present */
      }
    }
    return;
  }
  const stack: string[] = [''];
  while (stack.length) {
    const relDir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(path.join(spec.root, relDir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (exclude.has(e.name.toLowerCase())) continue;
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) stack.push(rel);
      else if (e.isFile()) yield { abs: path.join(spec.root, rel), rel }; // links and special files are skipped
    }
  }
}

/** Counts files and bytes for each item so the user can choose what to move. */
export async function scanItems(specs: ItemSpec[]): Promise<ScannedItem[]> {
  const out: ScannedItem[] = [];
  for (const spec of specs) {
    let files = 0;
    let bytes = 0;
    for await (const f of walk(spec)) {
      try {
        bytes += (await fs.promises.stat(f.abs)).size;
        files++;
      } catch {
        /* unreadable */
      }
    }
    if (files > 0) out.push({ id: spec.id, label: spec.label, files, bytes });
  }
  return out;
}

/** Resolves a relative path sent by the other computer, refusing anything that leaves the root. */
export function safeTarget(root: string, rel: string): string {
  const segs = rel.split('/');
  for (const s of segs) {
    if (s === '' || s === '.' || s === '..' || /[\\:\0]/.test(s)) throw new Error('Unsafe path');
  }
  const target = path.resolve(root, ...segs);
  const base = path.resolve(root);
  if (!target.startsWith(base + path.sep)) throw new Error('Unsafe path');
  return target;
}

// ---------- discovery ----------

function broadcastAddresses(): string[] {
  const out = new Set<string>(['255.255.255.255']);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const ip = a.address.split('.').map(Number);
      const mask = a.netmask.split('.').map(Number);
      out.add(ip.map((o, i) => (o | (~mask[i] & 255)) & 255).join('.'));
    }
  }
  return [...out];
}

export function localAddresses(): string[] {
  return Object.values(os.networkInterfaces())
    .flatMap((l) => l ?? [])
    .filter((a) => a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
}

/** Source side: listens for Destination computers announcing themselves on the network. */
export function discover(onPeer: (peer: { name: string; host: string; port: number }) => void): () => void {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  sock.on('error', () => undefined);
  sock.on('message', (msg, rinfo) => {
    try {
      const m = JSON.parse(msg.toString('utf8'));
      if (m.magic === MAGIC && typeof m.port === 'number') onPeer({ name: String(m.name).slice(0, 64), host: rinfo.address, port: m.port });
    } catch {
      /* not ours */
    }
  });
  sock.bind(BEACON_PORT);
  return () => {
    try {
      sock.close();
    } catch {
      /* already closed */
    }
  };
}

// ---------- destination ----------

export interface DestinationHandle {
  code: string;
  port: number;
  stop(): void;
}

export async function startDestination(opts: {
  name: string;
  roots: Record<string, string>;
  /** Where to save the list of apps the old computer sends. */
  appsFile?: string;
  onEvent: (e: MigrateEvent) => void;
  port?: number;
  beacon?: boolean;
}): Promise<DestinationHandle> {
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  let failures = 0;
  let active: Channel | null = null;
  let stopped = false;

  const server = net.createServer((sock) => {
    if (active || failures >= 5) {
      sock.destroy();
      return;
    }
    const ch = new Channel(sock);
    active = ch;
    sock.setTimeout(120000, () => sock.destroy());
    receive(ch)
      .catch((err: Error) => {
        if (err.message === 'wrong-code') {
          failures++;
          opts.onEvent(failures >= 5 ? { phase: 'locked' } : { phase: 'error', message: 'Someone entered the wrong code. Check the six digits and try again.' });
        } else if (!stopped) {
          opts.onEvent({ phase: 'error', message: err.message });
        }
      })
      .finally(() => {
        ch.close();
        active = null;
      });
  });

  async function receive(ch: Channel): Promise<void> {
    await ch.handshake('destination', code);
    const hello = await ch.recvJson('hello');
    const peer = String(hello.name).slice(0, 64);
    await ch.sendJson({ t: 'welcome', name: opts.name, roots: Object.keys(opts.roots) });
    opts.onEvent({ phase: 'paired', peer });

    const manifest = await ch.recvJson('manifest');
    const totalBytes = Number(manifest.totalBytes) || 0;
    const totalFiles = Number(manifest.totalFiles) || 0;
    let appsListed = 0;
    if (manifest.apps && opts.appsFile) {
      fs.writeFileSync(opts.appsFile, JSON.stringify(manifest.apps));
      appsListed = countApps(manifest.apps);
    }
    opts.onEvent({ phase: 'manifest', peer, items: manifest.items ?? [], totalBytes, totalFiles });
    await ch.sendJson({ t: 'ready' });

    const t0 = Date.now();
    const summary: MigrateSummary = { role: 'destination', peer, copied: 0, copiedBytes: 0, skipped: 0, failed: [], seconds: 0, appsListed, cancelled: false };
    let bytesDone = 0;
    let filesDone = 0;
    let lastEmit = 0;
    const progress = (current: string, force = false) => {
      const now = Date.now();
      if (!force && now - lastEmit < 200) return;
      lastEmit = now;
      opts.onEvent({ phase: 'progress', bytesDone, totalBytes, filesDone, totalFiles, current });
    };

    for (;;) {
      const msg = await ch.recvJson();
      if (msg.t === 'done') break;
      if (msg.t !== 'file') throw new Error('Unexpected message');
      const label = `${msg.item}/${msg.rel}`;
      const size = Number(msg.size) || 0;
      let target: string;
      try {
        const root = opts.roots[String(msg.item)];
        if (!root) throw new Error('Unknown folder');
        target = safeTarget(root, String(msg.rel));
      } catch (err) {
        summary.failed.push({ file: label, reason: (err as Error).message });
        await ch.sendJson({ t: 'file-reply', action: 'skip' });
        continue;
      }
      // Never overwrite: same size means it is already here; a different file keeps both.
      const sameSize = (p: string) => {
        try {
          return fs.statSync(p).size === size;
        } catch {
          return null;
        }
      };
      let exists = sameSize(target);
      if (exists === false) {
        const ext = path.extname(target);
        target = `${target.slice(0, target.length - ext.length)} (migrated)${ext}`;
        exists = sameSize(target);
      }
      if (exists) {
        summary.skipped++;
        filesDone++;
        bytesDone += size;
        progress(label);
        await ch.sendJson({ t: 'file-reply', action: 'skip' });
        continue;
      }
      await ch.sendJson({ t: 'file-reply', action: 'send' });
      const part = `${target}.mendkit-part`;
      const hash = crypto.createHash('sha256');
      let fh: fs.promises.FileHandle | null = null;
      let error: string | null = null;
      try {
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        fh = await fs.promises.open(part, 'w');
      } catch (err) {
        error = (err as Error).message;
      }
      for (;;) {
        const f = await ch.recv();
        if (f.type === T_CHUNK) {
          bytesDone += f.payload.length;
          progress(label);
          if (fh && !error) {
            try {
              hash.update(f.payload);
              await fh.write(f.payload);
            } catch (err) {
              error = (err as Error).message;
            }
          }
          continue;
        }
        const end = JSON.parse(f.payload.toString('utf8'));
        if (end.t !== 'file-end') throw new Error('Unexpected message');
        await fh?.close();
        if (!error && end.aborted) error = 'The old computer could not finish reading this file';
        if (!error && hash.digest('hex') !== end.sha256) error = 'The copy did not match the original';
        if (!error) {
          try {
            await fs.promises.rename(part, target);
            const m = new Date(Number(msg.mtime) || Date.now());
            await fs.promises.utimes(target, m, m);
          } catch (err) {
            error = (err as Error).message;
          }
        }
        break;
      }
      filesDone++;
      if (error) {
        fs.promises.unlink(part).catch(() => undefined);
        summary.failed.push({ file: label, reason: error });
      } else {
        summary.copied++;
        summary.copiedBytes += size;
      }
      await ch.sendJson({ t: 'file-ack', ok: !error, error });
    }
    summary.seconds = Math.round((Date.now() - t0) / 1000);
    progress('', true);
    await ch.sendJson({ t: 'done-ack' });
    opts.onEvent({ phase: 'done', summary });
  }

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', () => {
      // The usual port is taken: let the system pick one.
      server.once('error', reject);
      server.listen(0, () => resolve((server.address() as net.AddressInfo).port));
    });
    server.listen(opts.port ?? DEFAULT_PORT, () => resolve((server.address() as net.AddressInfo).port));
  });

  let beacon: dgram.Socket | null = null;
  let timer: NodeJS.Timeout | null = null;
  if (opts.beacon !== false) {
    beacon = dgram.createSocket('udp4');
    beacon.on('error', () => undefined);
    beacon.bind(() => {
      beacon!.setBroadcast(true);
      const msg = Buffer.from(JSON.stringify({ magic: MAGIC, name: opts.name, port }));
      const tick = () => broadcastAddresses().forEach((a) => beacon!.send(msg, BEACON_PORT, a, () => undefined));
      tick();
      timer = setInterval(tick, 2000);
    });
  }
  opts.onEvent({ phase: 'waiting' });

  return {
    code,
    port,
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      try {
        beacon?.close();
      } catch {
        /* already closed */
      }
      active?.close();
      server.close();
    },
  };
}

// ---------- source ----------

export interface SourceHandle {
  done: Promise<MigrateSummary>;
  cancel(): void;
}

export function runSource(opts: {
  host: string;
  port: number;
  code: string;
  name: string;
  items: ItemSpec[];
  /** The winget export of installed apps, or null. */
  apps: unknown | null;
  onEvent: (e: MigrateEvent) => void;
}): SourceHandle {
  let cancelled = false;
  let ch: Channel | null = null;

  const done = (async (): Promise<MigrateSummary> => {
    // Count everything first so the connection is not left idle during a long scan.
    const scanned = await scanItems(opts.items);
    const sock = await new Promise<net.Socket>((resolve, reject) => {
      const s = net.connect({ host: opts.host, port: opts.port, timeout: 10000 });
      s.once('connect', () => {
        s.setTimeout(120000, () => s.destroy());
        resolve(s);
      });
      s.once('timeout', () => {
        s.destroy();
        reject(new Error('The other computer did not answer. Check that it is waiting on the Receive screen and that its firewall allows MendKit.'));
      });
      s.once('error', () => reject(new Error('Could not reach the other computer. Check the address and that both computers are on the same network.')));
    });
    ch = new Channel(sock);
    try {
      await ch.handshake('source', opts.code);
      await ch.sendJson({ t: 'hello', name: opts.name });
      let welcome: any;
      try {
        welcome = await ch.recvJson('welcome');
      } catch {
        throw new Error('The code did not match. Check the six digits shown on the new computer.');
      }
      const peer = String(welcome.name).slice(0, 64);
      opts.onEvent({ phase: 'paired', peer });

      const totalBytes = scanned.reduce((n, i) => n + i.bytes, 0);
      const totalFiles = scanned.reduce((n, i) => n + i.files, 0);
      await ch.sendJson({ t: 'manifest', items: scanned, totalBytes, totalFiles, apps: opts.apps });
      await ch.recvJson('ready');
      opts.onEvent({ phase: 'manifest', peer, items: scanned, totalBytes, totalFiles });

      const t0 = Date.now();
      const appsListed = countApps(opts.apps);
      const summary: MigrateSummary = { role: 'source', peer, copied: 0, copiedBytes: 0, skipped: 0, failed: [], seconds: 0, appsListed, cancelled: false };
      let bytesDone = 0;
      let filesDone = 0;
      let lastEmit = 0;
      const progress = (current: string, force = false) => {
        const now = Date.now();
        if (!force && now - lastEmit < 200) return;
        lastEmit = now;
        opts.onEvent({ phase: 'progress', bytesDone, totalBytes, filesDone, totalFiles, current });
      };
      const buf = Buffer.allocUnsafe(CHUNK);

      outer: for (const spec of opts.items) {
        for await (const f of walk(spec)) {
          if (cancelled) break outer;
          const label = `${spec.label}/${f.rel}`;
          let fh: fs.promises.FileHandle;
          let st: fs.Stats;
          try {
            fh = await fs.promises.open(f.abs, 'r');
            st = await fh.stat();
          } catch (err) {
            summary.failed.push({ file: label, reason: (err as NodeJS.ErrnoException).code === 'EBUSY' ? 'The file is open in another program' : 'The file could not be read' });
            filesDone++;
            continue;
          }
          try {
            await ch.sendJson({ t: 'file', item: spec.id, rel: f.rel, size: st.size, mtime: st.mtimeMs });
            const reply = await ch.recvJson('file-reply');
            if (reply.action === 'skip') {
              summary.skipped++;
              bytesDone += st.size;
              filesDone++;
              progress(label);
              continue;
            }
            const hash = crypto.createHash('sha256');
            let aborted = false;
            for (;;) {
              let n: number;
              try {
                n = (await fh.read(buf, 0, CHUNK, null)).bytesRead;
              } catch {
                aborted = true;
                break;
              }
              if (n === 0) break;
              const chunk = buf.subarray(0, n);
              hash.update(chunk);
              await ch.send(T_CHUNK, chunk);
              bytesDone += n;
              progress(label);
              if (cancelled) {
                aborted = true;
                break;
              }
            }
            await ch.sendJson({ t: 'file-end', sha256: hash.digest('hex'), aborted });
            const ack = await ch.recvJson('file-ack');
            filesDone++;
            if (ack.ok) {
              summary.copied++;
              summary.copiedBytes += st.size;
            } else if (!cancelled) {
              summary.failed.push({ file: label, reason: String(ack.error ?? 'Not saved') });
            }
          } finally {
            await fh.close();
          }
        }
      }
      summary.cancelled = cancelled;
      summary.seconds = Math.round((Date.now() - t0) / 1000);
      progress('', true);
      await ch.sendJson({ t: 'done' });
      await ch.recvJson('done-ack');
      opts.onEvent({ phase: 'done', summary });
      return summary;
    } finally {
      ch.close();
    }
  })();

  return {
    done,
    cancel() {
      cancelled = true;
    },
  };
}
