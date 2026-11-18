import { app, BrowserWindow, ipcMain } from 'electron';
import { createHash, randomUUID } from 'crypto';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { compareSpeed, SpeedMeasure, speedScore } from '../engine/speed';

/**
 * Check-in form and the before/after speed score. Check-ins are kept in the app's data folder on this
 * computer only; the printed sheet carries no shop branding.
 */

export interface CheckIn {
  id: string;
  created: string;
  customer: { name: string; phone: string; email: string };
  device: string;
  problem: string;
  accessories: string;
  condition: string;
  notes: string;
  backupOk: boolean;
  before?: SpeedMeasure;
  after?: SpeedMeasure;
  closed?: string;
}

const run = (file: string, args: string[]): Promise<string> => new Promise((resolve) => execFile(file, args, { windowsHide: true, timeout: 120000, maxBuffer: 8 * 1024 * 1024 }, (_e, out) => resolve(String(out ?? ''))));

async function startupCount(): Promise<number | null> {
  if (process.platform === 'win32') {
    const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(app.getAppPath(), 'definitions', 'scripts', 'windows-startup.ps1')]);
    try {
      const j = JSON.parse(out.trim() || '[]');
      return (Array.isArray(j) ? j : [j]).filter((x: any) => x && x.enabled !== false).length;
    } catch {
      return null;
    }
  }
  const dirs = process.platform === 'darwin' ? [path.join(os.homedir(), 'Library', 'LaunchAgents'), '/Library/LaunchAgents', '/Library/LaunchDaemons'] : [path.join(os.homedir(), '.config', 'autostart')];
  let n = 0;
  for (const d of dirs) {
    try {
      n += fs.readdirSync(d).filter((f) => /\.(plist|desktop)$/.test(f) && !f.startsWith('com.apple.')).length;
    } catch {
      /* none */
    }
  }
  return n;
}

/** Quick measurements, about 10 seconds. The drive test writes 256 MB to the temporary folder and deletes it. */
export async function measureSpeed(): Promise<SpeedMeasure> {
  const m: SpeedMeasure = { at: new Date().toISOString(), writeMBs: null, readMBs: null, cpuMs: null, memoryUsed: null, freePercent: null, startupItems: null };
  const file = path.join(os.tmpdir(), `mendkit-speed-${process.pid}.tmp`);
  try {
    const chunk = Buffer.alloc(8 * 1024 * 1024, 7);
    const fd = fs.openSync(file, 'w');
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 32; i++) fs.writeSync(fd, chunk);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    m.writeMBs = 256 / (Number(process.hrtime.bigint() - t0) / 1e9);
  } catch {
    /* no space or no access */
  } finally {
    fs.rmSync(file, { force: true });
  }
  const t1 = process.hrtime.bigint();
  let h = Buffer.alloc(1024 * 1024, 1);
  for (let i = 0; i < 300; i++) h = Buffer.concat([createHash('sha256').update(h).digest(), h.subarray(32)]);
  m.cpuMs = Number(process.hrtime.bigint() - t1) / 1e6;
  m.memoryUsed = 100 * (1 - os.freemem() / os.totalmem());
  try {
    const s = fs.statfsSync(process.platform === 'win32' ? 'C:\\' : '/');
    m.freePercent = (100 * s.bavail) / s.blocks;
  } catch {
    /* unknown */
  }
  m.startupItems = await startupCount();
  return m;
}

const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The printable sheet for a check-in, with the speed comparison when both measurements exist. */
export function checkInSheet(c: CheckIn): string {
  const row = (k: string, v: string) => (v ? `<tr><th>${esc(k)}</th><td>${esc(v).replace(/\n/g, '<br>')}</td></tr>` : '');
  let speed = '';
  if (c.before && c.after) {
    const cmp = compareSpeed(c.before, c.after);
    speed = `<h2>Speed score</h2><p class="big">${cmp.before} before &rarr; ${cmp.after} after (out of 100)</p><ul>${cmp.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`;
  } else if (c.before) speed = `<h2>Speed score at check-in</h2><p class="big">${speedScore(c.before).score} out of 100</p>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Check-in ${esc(c.customer.name)}</title><style>
body{font:12pt/1.45 system-ui,sans-serif;margin:24px;color:#111}h1{font-size:18pt;margin:0 0 4px}h2{font-size:13pt;margin:22px 0 6px}
table{border-collapse:collapse;width:100%}th{text-align:left;width:30%;vertical-align:top;padding:5px 8px 5px 0;color:#444;font-weight:600}td{padding:5px 0;border-bottom:1px solid #ddd}
.big{font-size:16pt;font-weight:600}.sign{margin-top:40px;display:flex;gap:40px}.sign div{flex:1;border-top:1px solid #111;padding-top:4px;font-size:10pt}</style></head><body>
<h1>Computer check-in</h1><p>${esc(new Date(c.created).toLocaleString())}${c.closed ? ` &middot; returned ${esc(new Date(c.closed).toLocaleString())}` : ''}</p>
<table>${row('Name', c.customer.name)}${row('Phone', c.customer.phone)}${row('Email', c.customer.email)}${row('Computer', c.device)}${row('Problem', c.problem)}${row('Left with it', c.accessories)}${row('Condition', c.condition)}${row('Notes', c.notes)}${row('Data', c.backupOk ? 'Customer agrees to a backup of their files being made if needed.' : 'Customer did not ask for a backup.')}</table>
${speed}<div class="sign"><div>Customer signature</div><div>Date</div></div></body></html>`;
}

export function registerCheckIn(): void {
  const file = path.join(app.getPath('userData'), 'checkins.json');
  const read = (): CheckIn[] => {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Array.isArray(j) ? j : [];
    } catch {
      return [];
    }
  };
  const write = (list: CheckIn[]) => fs.writeFileSync(file, JSON.stringify(list, null, 1));
  const withScores = (list: CheckIn[]) => list.map((c) => ({ ...c, beforeScore: c.before ? speedScore(c.before) : null, afterScore: c.after ? speedScore(c.after) : null }));

  ipcMain.handle('checkin-list', () => withScores(read()).reverse());
  ipcMain.handle('checkin-save', (_e, c: Partial<CheckIn>) => {
    const list = read();
    const clean = (v: unknown, n = 2000) => String(v ?? '').slice(0, n);
    const prev = list.find((x) => x.id === c.id);
    const item: CheckIn = {
      ...(prev ?? { id: randomUUID(), created: new Date().toISOString() }),
      customer: { name: clean(c.customer?.name, 200), phone: clean(c.customer?.phone, 60), email: clean(c.customer?.email, 200) },
      device: clean(c.device, 300), problem: clean(c.problem), accessories: clean(c.accessories, 500), condition: clean(c.condition), notes: clean(c.notes), backupOk: !!c.backupOk,
    };
    if (!item.customer.name.trim()) throw new Error('Enter the customer\'s name.');
    write(prev ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item]);
    return item;
  });
  ipcMain.handle('checkin-measure', async (_e, id: string, which: 'before' | 'after') => {
    const m = await measureSpeed();
    const list = read();
    const c = list.find((x) => x.id === id);
    if (!c) throw new Error('That check-in was not found.');
    c[which === 'after' ? 'after' : 'before'] = m;
    if (which === 'after') c.closed = new Date().toISOString();
    write(list);
    return withScores([c])[0];
  });
  ipcMain.handle('checkin-delete', (_e, id: string) => write(read().filter((x) => x.id !== id)));
  ipcMain.handle('checkin-print', async (_e, id: string) => {
    const c = read().find((x) => x.id === id);
    if (!c) throw new Error('That check-in was not found.');
    const w = new BrowserWindow({ show: false, webPreferences: { javascript: false } });
    await w.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(checkInSheet(c))}`);
    return new Promise<boolean>((resolve) => w.webContents.print({ printBackground: false }, (ok) => {
      w.destroy();
      resolve(ok);
    }));
  });
}
