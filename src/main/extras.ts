import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { advise, healthScore } from '../engine/advisor';
import { onPath } from '../engine/catalog';
import { Engine } from '../engine/runner';
import { TweakManager } from '../engine/tweaks';
import { Catalog, EngineEvent, RunSummary } from '../engine/types';
import { gatherFacts } from './advisor';
import { isElevated, powershellScript } from './system';

/**
 * ISO library, undo center, job history, customer report and "Get help".
 * Kept apart from main.ts so each feature is easy to find.
 */

interface Machine {
  maker: string;
  model: string;
  serial: string;
}
interface HistoryEntry {
  startedAt: string;
  title: string;
  kind: string;
  outcome: string;
  overall: string;
  freeBeforeGb: number | null;
  freeAfterGb: number | null;
  logFile: string;
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const run = (cmd: string, args: string[]): Promise<string> => new Promise((resolve) => execFile(cmd, args, { timeout: 15000, windowsHide: true }, (_e, out) => resolve(String(out ?? '').trim())));

function freeGb(): number | null {
  try {
    const s = fs.statfsSync(process.platform === 'win32' ? 'C:\\' : '/');
    return Math.round(((s.bavail * s.bsize) / 1024 ** 3) * 10) / 10;
  } catch {
    return null;
  }
}

async function readMachine(): Promise<Machine> {
  const clean = (s: unknown) => String(s ?? '').trim();
  if (process.platform === 'win32') {
    const d = await powershellScript("$c=Get-CimInstance Win32_ComputerSystem; [pscustomobject]@{maker=$c.Manufacturer; model=$c.Model; serial=(Get-CimInstance Win32_BIOS).SerialNumber} | ConvertTo-Json -Compress", 20000);
    return { maker: clean(d?.maker), model: clean(d?.model), serial: clean(d?.serial) };
  }
  if (process.platform === 'darwin') {
    const serial = /"IOPlatformSerialNumber" = "([^"]+)"/.exec(await run('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']))?.[1] ?? '';
    return { maker: 'Apple', model: await run('sysctl', ['-n', 'hw.model']), serial };
  }
  const dmi = (f: string) => {
    try {
      return fs.readFileSync(`/sys/class/dmi/id/${f}`, 'utf8').trim();
    } catch {
      return '';
    }
  };
  return { maker: dmi('sys_vendor'), model: dmi('product_name'), serial: dmi('product_serial') };
}

export function registerExtras(ctx: { engine: Engine; catalog: Catalog; logDir: string; tweakMgr: TweakManager; getWin: () => BrowserWindow | null; settings: { mode: string; helpContact?: { name: string; email: string; phone: string } }; saveSettings: () => void }): { noteToolRun: (s: RunSummary) => void } {
  const { engine, catalog, logDir, tweakMgr } = ctx;
  const userData = app.getPath('userData');
  const defs = path.join(app.getAppPath(), 'definitions');

  // ---------- ISO library ----------
  const isos = JSON.parse(fs.readFileSync(path.join(defs, 'isos.json'), 'utf8')) as { id: string; group: string; name: string; size: string; description: string; url: string }[];
  ipcMain.handle('isos', () => isos.map(({ id, group, name, size, description, url }) => ({ id, group, name, size, description, site: new URL(url).hostname.replace(/^www\./, '') })));
  ipcMain.handle('iso-open', (_e, ids: string[]) => {
    const want = new Set(Array.isArray(ids) ? ids.map(String) : []);
    // Only addresses from the definitions file are ever opened, and only https ones.
    const list = isos.filter((i) => want.has(i.id) && i.url.startsWith('https://'));
    for (const i of list) shell.openExternal(i.url);
    return list.length;
  });

  // ---------- Machine identity and job history ----------
  const machineFile = path.join(userData, 'machine.json');
  const historyFile = path.join(userData, 'job-history.jsonl');
  let machine: Machine = { maker: '', model: '', serial: '' };
  try {
    machine = JSON.parse(fs.readFileSync(machineFile, 'utf8'));
  } catch {
    readMachine().then((m) => {
      machine = m;
      if (m.model || m.serial) fs.writeFileSync(machineFile, JSON.stringify(m));
    });
  }
  const history = (): HistoryEntry[] => {
    try {
      return fs
        .readFileSync(historyFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as HistoryEntry);
    } catch {
      return [];
    }
  };
  let freeBefore: number | null = null;
  engine.on('event', (e: EngineEvent) => {
    if (e.type === 'run-start') freeBefore = freeGb();
    if (e.type === 'run-end') {
      const s = e.summary;
      const entry: HistoryEntry = { startedAt: s.startedAt, title: s.title, kind: s.kind, outcome: s.outcome, overall: s.overall, freeBeforeGb: freeBefore, freeAfterGb: freeGb(), logFile: path.basename(s.logFile) };
      fs.appendFileSync(historyFile, JSON.stringify(entry) + '\n');
    }
  });
  ipcMain.handle('history', () => ({ machine, entries: history().reverse().slice(0, 200) }));
  ipcMain.handle('history-export', async () => {
    const r = await dialog.showSaveDialog(ctx.getWin()!, { title: 'Export job history', defaultPath: `mendkit-history-${machine.serial || os.hostname()}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (r.canceled || !r.filePath) return null;
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [['Date', 'Job', 'Result', 'Finished', 'Free space before (GB)', 'Free space after (GB)', 'Maker', 'Model', 'Serial']];
    for (const h of history()) rows.push([h.startedAt, h.title, h.overall, h.outcome, String(h.freeBeforeGb ?? ''), String(h.freeAfterGb ?? ''), machine.maker, machine.model, machine.serial]);
    fs.writeFileSync(r.filePath, rows.map((x) => x.map(q).join(',')).join('\r\n') + '\r\n');
    return r.filePath;
  });

  // ---------- Undo center ----------
  const toolsFile = path.join(userData, 'tools-installed-by-mendkit.json');
  const installedTools = (): Record<string, string> => {
    try {
      return JSON.parse(fs.readFileSync(toolsFile, 'utf8'));
    } catch {
      return {};
    }
  };
  /** Remembers which tools MendKit itself installed, so the undo center can offer to remove them. */
  const noteToolRun = (s: RunSummary) => {
    const rec = installedTools();
    for (const step of s.steps) {
      const m = /^(install|remove)-(.+)$/.exec(step.command);
      if (!m || step.status !== 'ok' || !catalog.tools.some((t) => t.id === m[2])) continue;
      if (m[1] === 'install') rec[m[2]] = new Date().toISOString();
      else delete rec[m[2]];
    }
    fs.writeFileSync(toolsFile, JSON.stringify(rec, null, 2));
  };
  ipcMain.handle('changes', () => ({
    tweaks: tweakMgr.journalEntries(),
    tools: Object.entries(installedTools())
      .map(([id, when]) => ({ id, when, name: catalog.tools.find((t) => t.id === id)?.name ?? id }))
      .filter((t) => catalog.tools.some((x) => x.id === t.id)),
    systemRestore: process.platform === 'win32',
    jobs: history()
      .filter((h) => h.kind !== 'tweak' && !/report|check/i.test(h.title))
      .reverse()
      .slice(0, 30),
  }));
  ipcMain.handle('undo-tweak', (_e, id: string) => {
    if (!tweakMgr.journalIds().includes(String(id))) throw new Error('MendKit did not change that setting');
    return engine.runActions('tweaks-undo', 'Undo a tweak', 'tweak', [tweakMgr.step(String(id), false)], { elevated: isElevated() });
  });
  ipcMain.handle('undo-tool', async (_e, id: string) => {
    if (!(String(id) in installedTools())) throw new Error('MendKit did not install that tool');
    const s = await engine.runTool(String(id), 'remove', { elevated: isElevated() });
    noteToolRun(s);
    return s;
  });
  ipcMain.handle('open-system-restore', () => {
    if (process.platform !== 'win32') return false;
    spawn('rstrui.exe', [], { detached: true, stdio: 'ignore' }).unref();
    return true;
  });

  // ---------- Customer report (PDF) ----------
  const loadSummary = (logFile: string): RunSummary => {
    const base = path.join(logDir, path.basename(String(logFile)).replace(/\.log$/, ''));
    return JSON.parse(fs.readFileSync(`${base}.json`, 'utf8')) as RunSummary;
  };
  const reportText = (s: RunSummary): { fixed: string[]; attention: string[]; problems: string[]; skipped: string[] } => {
    const pick = (levels: string[]) => s.steps.filter((x) => levels.includes(x.friendly?.level)).map((x) => `${x.friendly.title}: ${x.friendly.message}`);
    return { fixed: pick(['good', 'info']), attention: pick(['attention']), problems: pick(['problem']), skipped: pick(['skipped']) };
  };
  ipcMain.handle('customer-report', async (_e, logFile: string) => {
    const s = loadSummary(logFile);
    const facts = await gatherFacts();
    const advice = advise(facts, new Date().getFullYear());
    const t = reportText(s);
    const score = healthScore(facts, { problems: t.problems.length, attention: t.attention.length });
    const h = history().find((x) => x.logFile === path.basename(s.logFile));
    const headline = s.overall === 'good' ? 'Everything looks good' : s.overall === 'attention' ? 'A few things need attention' : 'A problem was found';
    const list = (title: string, items: string[], cls: string) => (items.length ? `<h2 class="${cls}">${title}</h2><ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '');
    const space = h && h.freeBeforeGb !== null && h.freeAfterGb !== null ? `<tr><th>Free space</th><td>${h.freeBeforeGb} GB before, ${h.freeAfterGb} GB after</td></tr>` : '';
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font:13px/1.5 "Segoe UI",Helvetica,Arial,sans-serif;color:#1c2b2d;margin:34px 40px}
      h1{font-size:22px;margin:0}.sub{color:#5b6f72;margin:2px 0 18px}
      .top{display:flex;gap:24px;align-items:center;border:1px solid #cfdcdc;border-radius:10px;padding:16px 20px;margin-bottom:16px}
      .score{font-size:40px;font-weight:700;color:${score >= 80 ? '#2e9d57' : score >= 60 ? '#c9861a' : '#c9473d'};text-align:center;line-height:1}
      .score small{display:block;font-size:11px;font-weight:400;color:#5b6f72;margin-top:4px}
      .head{font-size:18px;font-weight:600}
      table{border-collapse:collapse;margin-bottom:8px}th{text-align:left;padding:3px 16px 3px 0;color:#5b6f72;font-weight:400}td{padding:3px 0}
      h2{font-size:14px;margin:16px 0 4px;padding-bottom:3px;border-bottom:1px solid #dfe8e8}
      h2.ok{color:#2e9d57}h2.warn{color:#c9861a}h2.bad{color:#c9473d}ul{margin:4px 0;padding-left:20px}li{margin:3px 0}
      .foot{margin-top:22px;color:#7a8b8d;font-size:11px}
    </style></head><body>
      <h1>MendKit service report</h1><div class="sub">${esc(new Date(s.startedAt).toLocaleString())}</div>
      <div class="top"><div class="score">${score}<small>health score<br>out of 100</small></div><div><div class="head">${esc(headline)}</div><div>${esc(s.title)}</div></div></div>
      <table><tr><th>Computer</th><td>${esc([machine.maker, machine.model].filter(Boolean).join(' ') || 'Not recorded')}</td></tr>
      <tr><th>Serial number</th><td>${esc(machine.serial || 'Not recorded')}</td></tr>
      <tr><th>System</th><td>${esc(`${os.type() === 'Windows_NT' ? 'Windows' : os.type() === 'Darwin' ? 'macOS' : 'Linux'} ${os.release()}`)}</td></tr>${space}</table>
      ${list('Problems found', t.problems, 'bad')}${list('Needs attention', t.attention, 'warn')}${list('Checked and fine, or fixed', t.fixed, 'ok')}${list('Skipped', t.skipped, '')}
      <h2>Looking ahead</h2><p>${esc(advice.headline)}</p>
      <div class="foot">The health score starts at 100 and loses points for a failing or nearly full drive, low memory, a hard drive in place of an SSD, an unsupported Windows version, a worn battery, and problems found in this run. Made with MendKit ${esc(app.getVersion())}.</div>
    </body></html>`;
    const r = await dialog.showSaveDialog(ctx.getWin()!, { title: 'Save customer report', defaultPath: `MendKit-report-${s.startedAt.slice(0, 10)}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled || !r.filePath) return null;
    const w = new BrowserWindow({ show: false, webPreferences: { javascript: false } });
    try {
      await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      fs.writeFileSync(r.filePath, await w.webContents.printToPDF({ pageSize: 'Letter', printBackground: true }));
    } finally {
      w.destroy();
    }
    return { file: r.filePath, score };
  });

  // ---------- Get help ----------
  const rustdeskProgram = (): string | null => {
    if (process.platform === 'win32') {
      const p = path.join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'RustDesk', 'rustdesk.exe');
      return fs.existsSync(p) ? p : null;
    }
    if (process.platform === 'darwin') return fs.existsSync('/Applications/RustDesk.app') ? 'RustDesk' : null;
    return onPath('rustdesk') ? 'rustdesk' : null;
  };
  ipcMain.handle('help-info', () => ({ contact: ctx.settings.helpContact ?? { name: '', email: '', phone: '' }, rustdesk: rustdeskProgram() !== null, canInstallRustdesk: catalog.tools.some((t) => t.id === 'rustdesk') }));
  ipcMain.handle('help-set-contact', (_e, c: { name: string; email: string; phone: string }) => {
    if (ctx.settings.mode !== 'technician') throw new Error('Changing the help contact needs Technician mode');
    const email = String(c?.email ?? '').trim();
    if (email && !/^[^\s@,;?&]+@[^\s@,;?&]+\.[^\s@,;?&]+$/.test(email)) throw new Error('That does not look like an email address');
    ctx.settings.helpContact = { name: String(c?.name ?? '').trim().slice(0, 80), email, phone: String(c?.phone ?? '').trim().slice(0, 40) };
    ctx.saveSettings();
    return ctx.settings.helpContact;
  });
  const plainReport = (logFile?: string): string => {
    const lines = [`MendKit report from ${[machine.maker, machine.model].filter(Boolean).join(' ') || 'a computer'}${machine.serial ? `, serial ${machine.serial}` : ''}`];
    if (logFile) {
      const s = loadSummary(logFile);
      const t = reportText(s);
      lines.push(`${s.title}, ${new Date(s.startedAt).toLocaleString()}: ${s.overall === 'good' ? 'everything looks good' : s.overall === 'attention' ? 'a few things need attention' : 'a problem was found'}.`, '');
      for (const [label, items] of [['Problems', t.problems], ['Needs attention', t.attention], ['Skipped', t.skipped]] as const) if (items.length) lines.push(`${label}:`, ...items.map((i) => `- ${i}`), '');
      if (!t.problems.length && !t.attention.length) lines.push('No problems were found.');
    }
    return lines.join('\n').slice(0, 1600);
  };
  ipcMain.handle('help-text', (_e, logFile?: string) => plainReport(logFile));
  ipcMain.handle('help-email', (_e, logFile?: string) => {
    // Opens a draft in the person's own mail program. Nothing is sent until they press Send.
    const to = ctx.settings.helpContact?.email ?? '';
    shell.openExternal(`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent('Help with my computer')}&body=${encodeURIComponent(plainReport(logFile) + '\n\nWhat I need help with:\n')}`);
    return true;
  });
  ipcMain.handle('help-rustdesk', () => {
    const p = rustdeskProgram();
    if (!p) return false;
    const child = process.platform === 'darwin' ? spawn('open', ['-a', p], { detached: true, stdio: 'ignore' }) : spawn(p, [], { detached: true, stdio: 'ignore' });
    child.on('error', () => undefined);
    child.unref();
    return true;
  });
  ipcMain.handle('help-install-rustdesk', async () => {
    const s = await engine.runTool('rustdesk', 'install', { elevated: isElevated() });
    noteToolRun(s);
    return s;
  });

  return { noteToolRun };
}
