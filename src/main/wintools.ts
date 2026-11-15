import { app, ipcMain } from 'electron';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Engine } from '../engine/runner';
import { CommandDef, RunSummary } from '../engine/types';
import { isElevated } from './system';

/**
 * Windows-only tools that need a choice from the person before anything changes.
 * Startup items are turned off the way Task Manager does it (StartupApproved), so they show as
 * Disabled there too and can be turned back on from either place.
 */

export interface WinStartupItem {
  id: string;
  kind: 'run' | 'folder' | 'task' | 'service';
  name: string;
  command: string;
  file: string;
  publisher: string;
  signer: string;
  signed: boolean | null;
  missing: boolean;
  scope: 'user' | 'all';
  enabled: boolean;
  approvedKey?: string;
  valueName?: string;
  taskPath?: string;
  taskName?: string;
  service?: string;
  delayed?: boolean;
  /** Needed by Windows itself: listed, never offered. */
  essential?: boolean;
  /** Belongs to a hardware maker (audio, touchpad, graphics). */
  hardware?: boolean;
}

const ESSENTIAL = /^(SecurityHealth|WindowsDefender|Windows Security notification icon|ctfmon)$/i;
const HARDWARE = /\b(Intel|Realtek|NVIDIA|AMD|Advanced Micro|Synaptics|ELAN|Dell|HP|Hewlett|Lenovo|ASUS|ASUSTeK|Acer|Logitech|Conexant|Dolby|Waves|Microchip|Qualcomm|MediaTek|Alps|Cirrus)\b/i;

/** "HKCU:\Software\..." to the form reg.exe takes. */
export const regPath = (psPath: string): string => psPath.replace(/^(HKCU|HKLM):\\/, '$1\\');

/** StartupApproved data: 02 = on; 03 plus the time it was turned off = off. */
export function approvedData(on: boolean, now = Date.now()): string {
  if (on) return '02' + '00'.repeat(11);
  let ft = BigInt(now) * 10000n + 116444736000000000n;
  let hex = '';
  for (let i = 0; i < 8; i++) {
    hex += Number(ft & 0xffn).toString(16).padStart(2, '0');
    ft >>= 8n;
  }
  return '03000000' + hex;
}

/** The command that turns one startup item off or back on. */
export function startupToggle(it: WinStartupItem, on: boolean, previousDelayed = false): CommandDef {
  const label = `${on ? 'Turn on' : 'Turn off'} ${it.name}`;
  const base = { id: `${on ? 'on' : 'off'}-${it.id}`, name: label, description: '', typicalMinutes: 1, admin: it.scope === 'all' };
  const friendly = { title: it.name, ok: on ? `${it.name} will start again.` : `${it.name} will no longer start. It is not uninstalled, and Turn back on undoes this.`, problem: `${it.name} could not be changed.` };
  if (it.kind === 'run' || it.kind === 'folder')
    return { ...base, exec: 'reg.exe', args: ['add', regPath(it.approvedKey!), '/v', it.valueName!, '/t', 'REG_BINARY', '/d', approvedData(on), '/f'], friendly };
  if (it.kind === 'task') return { ...base, admin: true, exec: 'schtasks.exe', args: ['/Change', '/TN', `${it.taskPath}${it.taskName}`, on ? '/ENABLE' : '/DISABLE'], friendly };
  return { ...base, admin: true, exec: 'sc.exe', args: ['config', it.service!, 'start=', on ? (previousDelayed ? 'delayed-auto' : 'auto') : 'demand'], friendly: { ...friendly, ok: on ? `${it.name} starts with the computer again.` : `${it.name} no longer starts with the computer. It still starts when a program needs it.` } };
}

const run = (file: string, timeout = 120000): Promise<string> =>
  new Promise((resolve) =>
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 }, (_e, out) => resolve(String(out))),
  );

export function registerWinTools(ctx: { engine: Engine }): void {
  const { engine } = ctx;
  const win = process.platform === 'win32';
  const scripts = path.join(app.getAppPath(), 'definitions', 'scripts');
  const journal = path.join(app.getPath('userData'), 'win-startup-off.json');
  type Off = { key: string; name: string; service: string; delayed: boolean; when: string };
  const readJournal = (): Off[] => {
    try {
      return JSON.parse(fs.readFileSync(journal, 'utf8'));
    } catch {
      return [];
    }
  };
  const notWin = () => {
    throw new Error('This tool is for Windows.');
  };
  const opts = () => ({ elevated: isElevated() });
  let items: WinStartupItem[] = [];

  ipcMain.handle('win-startup-scan', async () => {
    if (!win) notWin();
    let raw: any[] = [];
    try {
      raw = JSON.parse((await run(path.join(scripts, 'windows-startup.ps1'))).trim() || '[]');
    } catch {
      throw new Error('The startup list could not be read.');
    }
    items = (Array.isArray(raw) ? raw : [raw]).map((r, i) => ({
      ...r,
      id: `w${i}`,
      essential: ESSENTIAL.test(String(r.name)),
      hardware: HARDWARE.test(`${r.publisher} ${r.signer}`),
    }));
    // Services MendKit set to start only when needed are no longer automatic, so they come from the journal.
    const off = readJournal().map((j, i) => ({ id: `j${i}`, kind: 'service' as const, name: j.name, command: '', file: '', publisher: '', signer: '', signed: null, missing: false, scope: 'all' as const, enabled: false, service: j.service, delayed: j.delayed }));
    items = [...items, ...off.filter((o) => !items.some((x) => x.kind === 'service' && x.service === o.service))];
    return { items, elevated: isElevated() };
  });

  const toggle = async (ids: string[], on: boolean): Promise<RunSummary> => {
    if (!win) notWin();
    const pick = items.filter((s) => ids.includes(s.id) && !s.essential && s.enabled !== on);
    if (!pick.length) throw new Error('Nothing that can be changed was selected.');
    const steps = pick.map((p) => startupToggle(p, on, p.delayed));
    const summary = await engine.runSteps(on ? 'win-startup-on' : 'win-startup-off', on ? 'Turn startup items back on' : 'Turn off startup items', 'command', steps, opts());
    // Remember services' previous start type so they can be put back exactly.
    let j = readJournal();
    pick.forEach((p, i) => {
      if (p.kind !== 'service' || summary.steps.find((st) => st.command === steps[i].id)?.status !== 'ok') return;
      j = j.filter((x) => x.service !== p.service);
      if (!on) j.push({ key: p.service!, name: p.name, service: p.service!, delayed: !!p.delayed, when: new Date().toISOString() });
    });
    fs.writeFileSync(journal, JSON.stringify(j, null, 2));
    return summary;
  };
  ipcMain.handle('win-startup-off', (_e, ids: string[]) => toggle(ids, false));
  ipcMain.handle('win-startup-on', (_e, ids: string[]) => toggle(ids, true));
}
