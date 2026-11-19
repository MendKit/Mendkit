import { app, ipcMain, shell } from 'electron';
import * as os from 'os';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { scriptsDir } from './paths';
import { Engine } from '../engine/runner';
import { RunSummary } from '../engine/types';
import { ESSENTIAL, HARDWARE, human, SpaceCategory, startupToggle, winSpaceCategories, WinStartupItem } from '../engine/wintools';

export { approvedData, regPath, startupToggle, winSpaceCategories } from '../engine/wintools';
export type { WinStartupItem } from '../engine/wintools';
import { isElevated } from './system';

/**
 * Windows-only tools that need a choice from the person before anything changes.
 * Startup items are turned off the way Task Manager does it (StartupApproved), so they show as
 * Disabled there too and can be turned back on from either place.
 */

const run = (file: string, timeout = 120000): Promise<string> =>
  new Promise((resolve) =>
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 }, (_e, out) => resolve(String(out))),
  );

export function registerWinTools(ctx: { engine: Engine }): void {
  const { engine } = ctx;
  const win = process.platform === 'win32';
  const scripts = scriptsDir();
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
  // ---------- Free up space ----------
  let space: (SpaceCategory & { bytes: number | null })[] = [];
  let spacePaths: Record<string, string> = {};
  ipcMain.handle('win-space-scan', async () => {
    if (!win) notWin();
    let r: any;
    try {
      r = JSON.parse((await run(path.join(scripts, 'windows-space.ps1'), 600000)).trim());
    } catch {
      throw new Error('The drive could not be measured.');
    }
    const cats = winSpaceCategories({ local: process.env.LOCALAPPDATA ?? '', temp: process.env.TEMP ?? '' });
    space = cats.map((c) => ({ ...c, bytes: c.id === 'component' ? null : Number(r.sizes?.[c.id] ?? 0) })).filter((c) => c.bytes === null || c.bytes > 1024 * 1024);
    if (!r.hibernate) space = space.filter((c) => c.id !== 'hiber');
    spacePaths = { downloads: String(r.downloadsPath ?? '') };
    // Each iPhone or iPad backup on its own, with its device name and date.
    const ios = (Array.isArray(r.ios) ? r.ios : r.ios ? [r.ios] : []).filter((b: any) => Number(b.bytes) > 0);
    ios.forEach((b: any, i: number) => {
      const id = `ios-${i}`;
      const when = b.date ? new Date(b.date).toLocaleDateString() : 'unknown date';
      space.push({ id, name: `Backup of ${b.name || 'an iPhone or iPad'}`, detail: `Made ${when}. Delete only if the device is backed up to iCloud or no longer used.`, preset: false, bytes: Number(b.bytes), step: { id: `space-${id}`, name: `Delete the backup of ${b.name || 'a device'}`, admin: false, ok: 'The backup was deleted.', problem: 'The backup could not be deleted.', action: async () => (fs.rmSync(String(b.path), { recursive: true, force: true }), { ok: true }) } });
    });
    const large = (Array.isArray(r.large) ? r.large : r.large ? [r.large] : []).map((x: any) => ({ path: String(x.path), size: Number(x.bytes), label: `${x.path} (${human(Number(x.bytes))})` }));
    return {
      items: space.map(({ step: _s, ...c }) => ({ ...c, size: c.bytes === null ? 'unknown' : human(c.bytes), reportOnly: !_s })),
      large, free: human(Number(r.free)), total: human(Number(r.total)), downloads: spacePaths.downloads,
    };
  });
  ipcMain.handle('win-reveal', (_e, p: string) => {
    if (typeof p !== 'string' || !p.toLowerCase().startsWith(os.homedir().toLowerCase())) throw new Error('Bad path');
    shell.showItemInFolder(p);
  });
  ipcMain.handle('win-space-clean', async (_e, ids: string[]): Promise<RunSummary> => {
    if (!win) notWin();
    const pick = space.filter((c) => ids.includes(c.id) && c.step);
    if (!pick.length) throw new Error('Nothing was selected.');
    return engine.runSteps('win-space', 'Free up space', 'command', pick.map((c) => c.step!), opts());
  });

  ipcMain.handle('win-startup-off', (_e, ids: string[]) => toggle(ids, false));
  ipcMain.handle('win-startup-on', (_e, ids: string[]) => toggle(ids, true));
}
