import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron';
import { execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Worker } from 'worker_threads';
import { AppDef, installPlan } from '../engine/apps';
import { onPath } from '../engine/catalog';
import { ActionStep, Engine, toolCommand } from '../engine/runner';
import { TweakManager, TweakPreset } from '../engine/tweaks';
import { Catalog, CommandDef, Level, RunSummary, StepResult } from '../engine/types';
import { detectApps } from './apps';
import { getTemps, isElevated, powershellScript } from './system';

/**
 * Setup profiles, scheduled light maintenance, unattended runs, the hardware test bench
 * and manufacturer driver tools.
 */

export interface Profile {
  id: string;
  name: string;
  description?: string;
  apps: string[];
  tools: string[];
  tweaks: string[];
  tweakPreset?: string;
  builtin?: boolean;
}

const TASK = 'MendKit monthly maintenance';
const run = (cmd: string, args: string[], timeout = 30000): Promise<{ ok: boolean; out: string }> =>
  new Promise((resolve) => execFile(cmd, args, { windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}${stderr}` })));

export function registerBatch3(ctx: { engine: Engine; catalog: Catalog; tweakMgr: TweakManager; presets: TweakPreset[]; appTable: AppDef[]; hasFlatpak: boolean; getWin: () => BrowserWindow | null; logDir: string; noteToolRun: (s: RunSummary) => void }): void {
  const { engine, catalog, tweakMgr, appTable } = ctx;
  const userData = app.getPath('userData');
  const defs = path.join(app.getAppPath(), 'definitions');

  // ---------- Setup profiles ----------
  const profilesFile = path.join(userData, 'profiles.json');
  const builtin = (JSON.parse(fs.readFileSync(path.join(defs, 'profiles.json'), 'utf8')) as Profile[]).map((p) => ({ ...p, builtin: true }));
  const saved = (): Profile[] => {
    try {
      return JSON.parse(fs.readFileSync(profilesFile, 'utf8')) as Profile[];
    } catch {
      return [];
    }
  };
  const all = (): Profile[] => [...builtin, ...saved()];
  const strings = (x: unknown): string[] => (Array.isArray(x) ? [...new Set(x.map(String))] : []);
  /** Keeps only ids this copy of MendKit knows, so an imported file cannot name anything else. */
  const clean = (p: any): Profile => ({
    id: String(p?.id || `p-${Date.now().toString(36)}`).replace(/[^A-Za-z0-9-]/g, '').slice(0, 40) || `p-${Date.now().toString(36)}`,
    name: String(p?.name ?? 'Profile').trim().slice(0, 60) || 'Profile',
    description: String(p?.description ?? '').trim().slice(0, 200),
    apps: strings(p?.apps).filter((id) => appTable.some((a) => a.id === id)),
    tools: strings(p?.tools),
    tweaks: strings(p?.tweaks),
    tweakPreset: ['standard', 'minimal'].includes(String(p?.tweakPreset)) ? String(p.tweakPreset) : '',
  });
  const canInstall = (a: AppDef) => !!(catalog.manager && a[catalog.manager]) || (ctx.hasFlatpak && !!a.flatpak);

  ipcMain.handle('profiles', () => ({
    profiles: all(),
    apps: appTable.map((a) => ({ id: a.id, name: a.name, available: canInstall(a) })),
    tools: catalog.tools.map((t) => ({ id: t.id, name: t.name, job: t.job })),
    tweaks: tweakMgr.defs.map((t) => ({ id: t.id, name: t.name, group: t.group })),
    presets: ctx.presets.map((p) => ({ id: p.id, name: p.name })),
  }));
  ipcMain.handle('profile-save', (_e, p: unknown) => {
    const prof = clean(p);
    if (builtin.some((b) => b.id === prof.id)) prof.id = `p-${Date.now().toString(36)}`;
    fs.writeFileSync(profilesFile, JSON.stringify([...saved().filter((x) => x.id !== prof.id), prof], null, 2));
    return prof;
  });
  ipcMain.handle('profile-delete', (_e, id: string) => fs.writeFileSync(profilesFile, JSON.stringify(saved().filter((x) => x.id !== String(id)), null, 2)));
  ipcMain.handle('profile-detect', async () => (await detectApps(appTable, catalog.manager, app.getPath('temp')))?.apps ?? []);
  ipcMain.handle('profile-export', async (_e, id: string) => {
    const p = all().find((x) => x.id === String(id));
    if (!p) throw new Error('Unknown profile');
    const r = await dialog.showSaveDialog(ctx.getWin()!, { title: 'Export setup profile', defaultPath: `mendkit-profile-${p.name.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}.json`, filters: [{ name: 'MendKit profile', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, JSON.stringify({ mendkit: 'profile', version: 1, ...p, builtin: undefined }, null, 2));
    return r.filePath;
  });
  ipcMain.handle('profile-import', async () => {
    const r = await dialog.showOpenDialog(ctx.getWin()!, { title: 'Import setup profile', properties: ['openFile'], filters: [{ name: 'MendKit profile', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    if (data.mendkit !== 'profile') throw new Error('That file is not a MendKit setup profile');
    const prof = clean({ ...data, id: '' });
    fs.writeFileSync(profilesFile, JSON.stringify([...saved(), prof], null, 2));
    return prof;
  });
  ipcMain.handle('profile-apply', async (_e, id: string) => {
    const p = all().find((x) => x.id === String(id));
    if (!p) throw new Error('Unknown profile');
    const steps: (CommandDef | ActionStep)[] = [];
    const plan = installPlan({ format: 2, platform: '', winget: null, apps: p.apps, other: [] }, appTable, catalog.manager, ctx.hasFlatpak);
    plan.installs.forEach((i, n) => steps.push(toolCommand({ id: `profile-app-${n}`, name: i.app.name, job: '', description: `Installs ${i.app.name}.`, license: 'free', packages: { [i.manager]: i.pkg } }, 'install', i.manager)));
    for (const tid of p.tools) {
      const t = catalog.tools.find((x) => x.id === tid);
      if (t) steps.push(toolCommand(t, 'install', catalog.manager));
    }
    const preset = ctx.presets.find((x) => x.id === p.tweakPreset)?.tweaks ?? [];
    const status = await tweakMgr.status();
    for (const tw of new Set([...preset, ...p.tweaks])) if (tweakMgr.defs.some((d) => d.id === tw) && !status[tw]) steps.push(tweakMgr.step(tw, true));
    if (!steps.length) throw new Error('Nothing in this profile applies to this computer, or it is all in place already');
    const s = await engine.runSteps('setup-profile', `Set up: ${p.name}`, 'recipe', steps, { elevated: isElevated() });
    ctx.noteToolRun(s);
    return { summary: s, unmatched: plan.unmatched };
  });

  // ---------- Scheduled light maintenance ----------
  const launchArgs = (recipe: string) => [...(app.isPackaged ? [] : [app.getAppPath()]), `--run=${recipe}`, '--unattended'];
  const plist = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.mendkit.maintenance.plist');
  const unitDir = path.join(os.homedir(), '.config', 'systemd', 'user');
  const scheduleSupported = process.platform === 'win32' || process.platform === 'darwin' || (process.platform === 'linux' && onPath('systemctl'));

  async function scheduleStatus(): Promise<{ supported: boolean; enabled: boolean; withUpdates: boolean; elevated: boolean }> {
    let enabled = false;
    let text = '';
    if (process.platform === 'win32') {
      const r = await run('schtasks.exe', ['/Query', '/TN', TASK, '/XML']);
      enabled = r.ok;
      text = r.out;
    } else if (process.platform === 'darwin') {
      enabled = fs.existsSync(plist);
      text = enabled ? fs.readFileSync(plist, 'utf8') : '';
    } else {
      const f = path.join(unitDir, 'mendkit-maintenance.service');
      enabled = fs.existsSync(path.join(unitDir, 'mendkit-maintenance.timer'));
      text = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
    }
    return { supported: scheduleSupported, enabled, withUpdates: /light-maintenance-updates/.test(text), elevated: isElevated() };
  }
  ipcMain.handle('schedule-status', scheduleStatus);
  ipcMain.handle('schedule-set', async (_e, on: boolean, withUpdates: boolean) => {
    if (!scheduleSupported) throw new Error('Scheduling is not available on this system');
    const recipe = withUpdates === true ? 'light-maintenance-updates' : 'light-maintenance';
    const args = launchArgs(recipe);
    if (process.platform === 'win32') {
      if (!on) await run('schtasks.exe', ['/Delete', '/TN', TASK, '/F']);
      else {
        const tr = [process.execPath, ...args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
        // With administrator rights the task also runs elevated, so cleanup and scan steps are not skipped.
        const r = await run('schtasks.exe', ['/Create', '/TN', TASK, '/TR', tr, '/SC', 'MONTHLY', '/D', '1', '/ST', '12:00', '/F', ...(isElevated() ? ['/RL', 'HIGHEST'] : [])]);
        if (!r.ok) throw new Error(r.out.trim() || 'The scheduled task could not be created');
      }
    } else if (process.platform === 'darwin') {
      await run('launchctl', ['unload', plist]);
      fs.rmSync(plist, { force: true });
      if (on) {
        const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
        fs.mkdirSync(path.dirname(plist), { recursive: true });
        fs.writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>com.mendkit.maintenance</string>\n<key>ProgramArguments</key><array>${[process.execPath, ...args].map((a) => `<string>${x(a)}</string>`).join('')}</array>\n<key>StartCalendarInterval</key><dict><key>Day</key><integer>1</integer><key>Hour</key><integer>12</integer><key>Minute</key><integer>0</integer></dict>\n</dict></plist>\n`);
        const r = await run('launchctl', ['load', '-w', plist]);
        if (!r.ok) throw new Error(r.out.trim() || 'The schedule could not be loaded');
      }
    } else {
      await run('systemctl', ['--user', 'disable', '--now', 'mendkit-maintenance.timer']);
      for (const f of ['mendkit-maintenance.service', 'mendkit-maintenance.timer']) fs.rmSync(path.join(unitDir, f), { force: true });
      if (on) {
        fs.mkdirSync(unitDir, { recursive: true });
        const q = (s: string) => `"${s.replace(/(["\\$`])/g, '\\$1')}"`;
        fs.writeFileSync(path.join(unitDir, 'mendkit-maintenance.service'), `[Unit]\nDescription=MendKit monthly maintenance\n\n[Service]\nType=oneshot\nExecStart=${[process.execPath, ...args].map(q).join(' ')}\n`);
        fs.writeFileSync(path.join(unitDir, 'mendkit-maintenance.timer'), `[Unit]\nDescription=MendKit monthly maintenance\n\n[Timer]\nOnCalendar=*-*-01 12:00:00\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n`);
        await run('systemctl', ['--user', 'daemon-reload']);
        const r = await run('systemctl', ['--user', 'enable', '--now', 'mendkit-maintenance.timer']);
        if (!r.ok) throw new Error(r.out.trim() || 'The timer could not be enabled');
      }
    }
    return scheduleStatus();
  });

  // ---------- Power action after a run (Windows) ----------
  ipcMain.handle('power', (_e, action: string) => {
    if (process.platform !== 'win32') return false;
    const args = action === 'restart' ? ['/r', '/t', '60', '/c', 'MendKit has finished. Restarting in one minute.'] : action === 'shutdown' ? ['/s', '/t', '60', '/c', 'MendKit has finished. Shutting down in one minute.'] : action === 'cancel' ? ['/a'] : null;
    if (!args) throw new Error('Unknown power action');
    spawn('shutdown.exe', args, { windowsHide: true, stdio: 'ignore' });
    return true;
  });

  // ---------- Hardware test bench ----------
  ipcMain.handle('usb-devices', async (): Promise<string[]> => {
    if (process.platform === 'win32') {
      const d = await powershellScript("Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like 'USB*' } | Select-Object FriendlyName, Class | ConvertTo-Json -Compress", 20000);
      return (Array.isArray(d) ? d : d ? [d] : []).map((x: any) => `${x.FriendlyName ?? 'Unknown device'}${x.Class ? ` (${x.Class})` : ''}`).sort();
    }
    if (process.platform === 'darwin') return (await run('system_profiler', ['SPUSBDataType', '-detailLevel', 'mini'])).out.split('\n').filter((l) => /^\s{4,}\S.*:$/.test(l)).map((l) => l.trim().replace(/:$/, ''));
    return (await run('lsusb', [])).out.split('\n').map((l) => l.replace(/^Bus \d+ Device \d+: ID \S+\s*/, '').trim()).filter(Boolean).sort();
  });

  let stress: { stop: () => void } | null = null;
  ipcMain.handle('stress-stop', () => stress?.stop());
  ipcMain.handle('stress-start', (_e, minutes: number): Promise<RunSummary> => {
    if (stress) throw new Error('A stress test is already running');
    if (engine.isBusy()) throw new Error('Another job is running');
    const total = Math.max(1, Math.min(60, Math.round(Number(minutes) || 5))) * 60;
    const cores = os.cpus().length;
    const flag = new Int32Array(new SharedArrayBuffer(4));
    // Each worker hashes in a loop until the shared flag is set.
    const code = "const { workerData } = require('worker_threads'); const crypto = require('crypto'); const flag = new Int32Array(workerData); let b = Buffer.alloc(65536, 7); while (Atomics.load(flag, 0) === 0) { for (let i = 0; i < 200; i++) b = crypto.createHash('sha256').update(b).digest().length ? b : b; }";
    const workers = Array.from({ length: cores }, () => new Worker(code, { eval: true, workerData: flag.buffer }));
    const started = new Date();
    const max = new Map<string, number>();
    const send = (e: object) => ctx.getWin()?.webContents.send('mendkit:stress', e);
    return new Promise((resolve) => {
      let finished = false;
      let stopped = false;
      const sample = async () => {
        const t = await getTemps();
        for (const x of t.temps) max.set(x.name, Math.max(max.get(x.name) ?? 0, x.celsius));
        const elapsed = Math.round((Date.now() - started.getTime()) / 1000);
        send({ elapsed, total, hottest: Math.max(0, ...t.temps.map((x) => x.celsius)), sensors: t.temps.length });
        if (elapsed >= total) end();
      };
      const timer = setInterval(sample, 5000);
      const end = () => {
        if (finished) return;
        finished = true;
        clearInterval(timer);
        Atomics.store(flag, 0, 1);
        workers.forEach((w) => w.terminate());
        stress = null;
        const seconds = Math.round((Date.now() - started.getTime()) / 1000);
        const step = (id: string, name: string, level: Level, message: string): StepResult => ({ command: id, name, status: level === 'problem' || level === 'attention' ? 'failed' : 'ok', exitCode: null, seconds: 0, friendly: { level, title: name, message } });
        const steps: StepResult[] = [step('load', 'Processor load', stopped ? 'info' : 'good', `All ${cores} processor threads ran at full load for ${Math.floor(seconds / 60)} min ${seconds % 60} s${stopped ? ' before the test was stopped' : ' without the computer freezing or restarting'}.`)];
        if (!max.size) steps.push(step('temps', 'Temperatures', 'skipped', 'No temperature sensors could be read. On Windows, install LibreHardwareMonitor from Tools, leave it open and run the test again.'));
        for (const [name, c] of [...max.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
          steps.push(step(`temp-${name}`, name, c >= 95 ? 'problem' : c >= 85 ? 'attention' : 'good', `Peaked at ${Math.round(c)} °C (${Math.round((c * 9) / 5 + 32)} °F).${c >= 95 ? ' That is at the limit. Clean the fans and vents and renew the thermal paste.' : c >= 85 ? ' That is hot. Check the fans and vents for dust.' : ''}`));
        }
        const levels = steps.map((s) => s.friendly.level);
        const base = path.join(ctx.logDir, `${started.toISOString().replace(/[:.]/g, '-')}_stress-test`);
        const summary: RunSummary = { id: 'stress-test', title: 'Processor stress test', kind: 'recipe', startedAt: started.toISOString(), finishedAt: new Date().toISOString(), outcome: stopped ? 'cancelled' : 'completed', overall: levels.includes('problem') ? 'problem' : levels.includes('attention') || levels.includes('skipped') ? 'attention' : 'good', needsRestart: false, steps, logFile: `${base}.log` };
        fs.writeFileSync(summary.logFile, [`MendKit processor stress test, ${started.toLocaleString()}`, ...steps.map((s) => `[${s.friendly.level}] ${s.friendly.title}: ${s.friendly.message}`)].join('\n') + '\n');
        fs.writeFileSync(`${base}.json`, JSON.stringify(summary, null, 2));
        resolve(summary);
      };
      stress = {
        stop: () => {
          stopped = true;
          end();
        },
      };
      sample();
    });
  });

  // ---------- Manufacturer driver tools (Windows) ----------
  const makerTool = (): { maker: string; toolId: string | null } => {
    let maker = '';
    try {
      maker = String(JSON.parse(fs.readFileSync(path.join(userData, 'machine.json'), 'utf8')).maker ?? '');
    } catch {
      /* not read yet */
    }
    const id = /dell|alienware/i.test(maker) ? 'dell-command-update' : /lenovo/i.test(maker) ? 'lenovo-system-update' : null;
    return { maker, toolId: id && catalog.tools.some((t) => t.id === id) ? id : null };
  };
  const driverToolIds = ['dell-command-update', 'lenovo-system-update', 'intel-dsa'];
  ipcMain.handle('driver-tools', () => {
    if (process.platform !== 'win32') return { supported: false, maker: '', tools: [] };
    const m = makerTool();
    const intel = /intel/i.test(os.cpus()[0]?.model ?? '');
    const ids = [m.toolId, intel ? 'intel-dsa' : null].filter((x): x is string => !!x && catalog.tools.some((t) => t.id === x));
    return { supported: true, maker: m.maker, tools: ids.map((id) => ({ id, name: catalog.tools.find((t) => t.id === id)!.name, description: catalog.tools.find((t) => t.id === id)!.description })) };
  });
  ipcMain.handle('driver-tool-install', async (_e, id: string) => {
    if (!driverToolIds.includes(String(id))) throw new Error('Unknown driver tool');
    const s = await engine.runTool(String(id), 'install', { elevated: isElevated() });
    ctx.noteToolRun(s);
    return s;
  });
  ipcMain.handle('open-optional-updates', () => {
    if (process.platform === 'win32') shell.openExternal('ms-settings:windowsupdate-optionalupdates');
    return process.platform === 'win32';
  });
}

/** Unattended start: `--run=<recipe> --unattended` runs one recipe with no prompts, then quits unless something needs attention. */
export function unattendedRecipe(): string | null {
  const arg = process.argv.find((a) => a.startsWith('--run='));
  return arg && process.argv.includes('--unattended') ? arg.slice(6).replace(/[^a-z0-9-]/gi, '') : null;
}

export function notify(title: string, body: string, onClick?: () => void): void {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body });
  if (onClick) n.on('click', onClick);
  n.show();
}
