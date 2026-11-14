import { app, BrowserWindow, session, dialog, ipcMain, shell } from 'electron';
import * as os from 'os';
import { ChildProcess, execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { currentPlatform, loadCatalog, onPath } from '../engine/catalog';
import { Engine, installedListCommands, installedTools, toolCheckCommand } from '../engine/runner';
import { EngineEvent, Level, RunSummary, StepResult } from '../engine/types';
import { AppList, bookmarksToHtml, installPlan, loadApps, normalizeAppList, registerMozillaProfiles } from '../engine/apps';
import { detectApps } from './apps';
import { advise } from '../engine/advisor';
import { registerExtras } from './extras';
import { registerRemoteAudit } from './remote-audit';
import { notify, registerBatch3, unattendedRecipe } from './batch3';
import { gatherFacts } from './advisor';
import { JobHandle, readBackup, runBackup, runImport, runRestore } from '../engine/backup';
import { currentDesktops, gsettings, linuxDesktop, linuxTweaksAvailable, loadTweaks, macDefaults, memoryRegistry, TweakManager, windowsRegistry } from '../engine/tweaks';
import { findProfiles, oldApps, oldItems, OldProfile } from '../engine/olddrive';
import { registerBatch4 } from './batch4';
import { registerMacTools } from './mactools';
import { registerPermissions } from './permissions';
import { registerLinuxTools } from './linuxtools';
import { registerSwitchLinux } from './switchlinux';
import { registerUpdater } from './updater';
import { offlineInstallSteps, quickOnline, readCache, registerOffline } from './offline';
import { applyPortableMode, jobScheduled, jobsSupported, registerBatch5, scheduleJob, Job } from './batch5';
import { DestinationHandle, discover, ItemSpec, localAddresses, MigrateEvent, MigrateSummary, runSource, scanItems, SourceHandle, startDestination } from '../engine/migrate';
import { getSpecs, getDrives, getSystemInfo, getTemps, isElevated } from './system';

type Mode = 'simple' | 'technician';
interface Settings {
  mode: Mode;
  helpContact?: { name: string; email: string; phone: string };
}

let win: BrowserWindow | null = null;
let engine: Engine;
let logDir: string;
let settingsFile: string;
let settings: Settings = { mode: 'simple' };

function loadSettings(): void {
  try {
    const s = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    if (s.mode === 'simple' || s.mode === 'technician') settings.mode = s.mode;
    if (s.helpContact && typeof s.helpContact === 'object') settings.helpContact = { name: String(s.helpContact.name ?? ''), email: String(s.helpContact.email ?? ''), phone: String(s.helpContact.phone ?? '') };
  } catch {
    /* first run */
  }
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b1416',
    title: 'MendKit',
    icon: path.join(app.getAppPath(), 'renderer', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(app.getAppPath(), 'renderer', 'index.html'));
  win.on('closed', () => (win = null));
}

/**
 * How admin steps get root on macOS and Linux: one shell per run, started through the system's own
 * password prompt (polkit on Linux, a macOS dialog through sudo's askpass hook). Windows uses UAC instead.
 */
function privilegedSpawner(): (() => ChildProcess) | undefined {
  if (process.platform === 'linux' && onPath('pkexec')) return () => spawn('pkexec', ['/bin/sh', '-s'], { stdio: 'pipe' });
  if (process.platform === 'darwin') {
    return () => {
      const askpass = path.join(app.getPath('userData'), 'askpass.sh');
      fs.writeFileSync(
        askpass,
        '#!/bin/sh\n/usr/bin/osascript -e \'display dialog "MendKit needs your password to run repair steps." default answer "" with hidden answer with title "MendKit" with icon caution\' -e \'text returned of result\'\n',
        { mode: 0o700 },
      );
      return spawn('/usr/bin/sudo', ['-A', '--', '/bin/sh', '-s'], { stdio: 'pipe', env: { ...process.env, SUDO_ASKPASS: askpass } });
    };
  }
  return undefined;
}

function registerIpc(): void {
  const catalog = loadCatalog(path.join(app.getAppPath(), 'definitions'), currentPlatform());
  engine = new Engine(catalog, logDir, privilegedSpawner());
  engine.on('event', (e: EngineEvent) => win?.webContents.send('mendkit:event', e));

  ipcMain.handle('system-info', () => getSystemInfo());
  ipcMain.handle('system-drives', () => getDrives());
  ipcMain.handle('specs', () => getSpecs());
  ipcMain.handle('temps', () => getTemps());
  ipcMain.handle('settings-get', () => settings);
  ipcMain.handle('settings-set-mode', (_e, mode: Mode) => {
    if (mode !== 'simple' && mode !== 'technician') throw new Error('Bad mode');
    settings.mode = mode;
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
    return settings;
  });
  ipcMain.handle('catalog', () => ({
    platform: catalog.platform,
    commands: [...catalog.commands.values()].map(({ id, name, description, admin, heavy, needsRestart, typicalMinutes }) => ({
      id,
      name,
      description,
      admin,
      heavy: !!heavy,
      needsRestart: !!needsRestart,
      typicalMinutes: typicalMinutes ?? 1,
    })),
    recipes: catalog.recipes.map((r) => {
      const steps = r.steps[catalog.platform] ?? [];
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        simpleMode: r.simpleMode,
        steps: steps.map((s) => catalog.commands.get(s.command)!.name),
        detail: steps.map((s) => {
          const c = catalog.commands.get(s.command)!;
          return { name: c.friendly?.title ?? c.name, description: c.description, admin: c.admin, needsRestart: !!c.needsRestart, minutes: c.typicalMinutes ?? 1, gate: !!s.gate };
        }),
        typicalMinutes: steps.reduce((sum, s) => sum + (catalog.commands.get(s.command)!.typicalMinutes ?? 1), 0),
        needsAdmin: steps.some((s) => catalog.commands.get(s.command)!.admin),
      };
    }),
  }));

  ipcMain.handle('run-recipe', (_e, id: string, overrideGates: boolean) => {
    const recipe = catalog.recipes.find((r) => r.id === id);
    if (!recipe) throw new Error('Unknown recipe');
    if (settings.mode === 'simple' && !recipe.simpleMode) throw new Error('This recipe needs Technician mode');
    return engine.runRecipe(id, { elevated: isElevated(), overrideGates: settings.mode === 'technician' && overrideGates === true });
  });
  ipcMain.handle('run-command', (_e, id: string) => {
    if (settings.mode !== 'technician') throw new Error('Single commands need Technician mode');
    return engine.runCommand(id, { elevated: isElevated() });
  });
  ipcMain.handle('cancel', () => engine.cancel());

  ipcMain.handle('tools', () => ({
    supported: catalog.manager !== null,
    manager: catalog.manager,
    tools: catalog.tools.map(({ id, name, job, description, license, homeUseOnly }) => ({ id, name, job, description, license, homeUseOnly: !!homeUseOnly })),
  }));
  ipcMain.handle('tools-status', async (): Promise<string[]> => {
    const installed: string[] = [];
    if (!catalog.manager) return installed;
    const manager = catalog.manager;
    // Fast path: one listing of everything installed, instead of one question per tool.
    const text = (cmd: string[]) => new Promise<string | null>((resolve) => execFile(cmd[0], cmd.slice(1), { windowsHide: true, timeout: 120000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : String(stdout))));
    if (manager === 'winget') {
      const tmp = path.join(app.getPath('temp'), `mendkit-installed-${Date.now()}.json`);
      await text(['winget.exe', 'export', '-o', tmp, '--accept-source-agreements', '--disable-interactivity']);
      try {
        const data = JSON.parse(fs.readFileSync(tmp, 'utf8'));
        const ids: string[] = (Array.isArray(data?.Sources) ? data.Sources : []).flatMap((s: any) => (Array.isArray(s?.Packages) ? s.Packages : [])).map((p: any) => String(p?.PackageIdentifier ?? ''));
        if (ids.length) return installedTools(catalog.tools, manager, [ids.join('\n')]);
      } catch {
        /* fall through to the slow way */
      } finally {
        fs.rmSync(tmp, { force: true });
      }
    } else {
      const outs = await Promise.all(installedListCommands(manager).map(text));
      if (outs.length && outs.every((o) => o !== null)) return installedTools(catalog.tools, manager, outs as string[]);
    }
    // Slow path: ask about each tool, four at a time. Exit code 0 means it is installed.
    const check = (t: (typeof catalog.tools)[number]) => toolCheckCommand(t, manager);
    const queue = [...catalog.tools];
    const worker = async () => {
      for (let t = queue.shift(); t; t = queue.shift()) {
        const tool = t;
        const found = await new Promise<boolean>((resolve) =>
          execFile(check(tool)[0], check(tool).slice(1), { windowsHide: true, timeout: 60000 }, (err) => resolve(!err)),
        );
        if (found) installed.push(tool.id);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return installed;
  });
  ipcMain.handle('tools-install-many', (_e, ids: string[]) => {
    if (settings.mode !== 'technician') throw new Error('Installing tools needs Technician mode');
    const list = [...new Set((Array.isArray(ids) ? ids : []).map(String))];
    if (!list.length) throw new Error('Tick at least one tool');
    return installTools(list).then((s) => (extras.noteToolRun(s), s));
  });
  // With no internet on Windows, tools in the offline cache are installed from there instead of through winget.
  const installTools = async (ids: string[]): Promise<RunSummary> => {
    if ((process.platform === 'win32' || process.platform === 'linux') && readCache().size && !(await quickOnline())) {
      return engine.runSteps('install-tools', `Install ${ids.length} tool${ids.length === 1 ? '' : 's'} from the offline cache`, 'tool', await offlineInstallSteps(catalog, ids), { elevated: isElevated() });
    }
    return ids.length === 1 ? engine.runTool(ids[0], 'install', { elevated: isElevated() }) : engine.runToolInstalls(ids, { elevated: isElevated() });
  };
  ipcMain.handle('app-version', () => app.getVersion());
  ipcMain.handle('guides', () => JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'definitions', 'guides.json'), 'utf8')));
  ipcMain.handle('tool-action', (_e, id: string, action: string) => {
    if (settings.mode !== 'technician') throw new Error('Installing tools needs Technician mode');
    if (action !== 'install' && action !== 'remove') throw new Error('Bad action');
    return (action === 'install' ? installTools([String(id)]) : engine.runTool(id, action, { elevated: isElevated() })).then((s) => (extras.noteToolRun(s), s));
  });

  // ----- Tweaks -----
  const defsDir = path.join(app.getAppPath(), 'definitions');
  // Windows registry, macOS defaults, or on Linux gsettings (GNOME, Cinnamon), KDE config files and xfconf (XFCE).
  // MENDKIT_TEST_TWEAKS=1 swaps in an in-memory registry with the Windows tweak list, so the screen can be tested anywhere.
  const testTweaks = process.env.MENDKIT_TEST_TWEAKS === '1';
  const tweakBackend = testTweaks ? memoryRegistry() : catalog.platform === 'win32' ? windowsRegistry : catalog.platform === 'darwin' ? macDefaults : linuxDesktop;
  const desktops = currentDesktops();
  const tweakData = testTweaks || catalog.platform !== 'linux' ? loadTweaks(defsDir, testTweaks ? 'win32' : catalog.platform) : loadTweaks(defsDir, 'linux', (all) => linuxTweaksAvailable(all, desktops));
  const tweakMgr = new TweakManager(tweakData.tweaks, tweakBackend ?? gsettings, path.join(app.getPath('userData'), 'tweak-journal.json'));
  const extras = registerExtras({ engine, catalog, logDir, tweakMgr, getWin: () => win, settings, saveSettings: () => fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2)) });
  registerRemoteAudit(engine);
  const techOnly = () => {
    if (settings.mode !== 'technician') throw new Error('Tweaks need Technician mode');
  };
  ipcMain.handle('tweaks', async () => ({
    supported: tweakBackend !== null && tweakData.tweaks.length > 0,
    tweaks: tweakData.tweaks.map(({ id, name, description, group, admin, needsSignOut }) => ({ id, name, description, group, admin, needsSignOut: !!needsSignOut })),
    presets: tweakData.presets,
    status: await tweakMgr.status(),
    undoable: tweakMgr.journalIds(),
  }));
  ipcMain.handle('tweaks-apply', async (_e, desired: Record<string, boolean>) => {
    techOnly();
    const status = await tweakMgr.status();
    const steps = tweakData.tweaks.filter((t) => typeof desired?.[t.id] === 'boolean' && desired[t.id] !== status[t.id]).map((t) => tweakMgr.step(t.id, desired[t.id]));
    if (!steps.length) return null;
    return engine.runActions('tweaks', 'Apply tweaks', 'tweak', steps, { elevated: isElevated() });
  });
  ipcMain.handle('tweaks-undo-all', () => {
    techOnly();
    const steps = tweakMgr.journalIds().map((id) => tweakMgr.step(id, false));
    if (!steps.length) return null;
    return engine.runActions('tweaks-undo', 'Undo MendKit tweaks', 'tweak', steps, { elevated: isElevated() });
  });
  ipcMain.handle('tweaks-export', async (_e, ids: string[]) => {
    techOnly();
    const r = await dialog.showSaveDialog(win!, { title: 'Export tweak preset', defaultPath: 'mendkit-tweaks.json', filters: [{ name: 'MendKit tweaks', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return null;
    const known = new Set(tweakData.tweaks.map((t) => t.id));
    const on = (Array.isArray(ids) ? ids : []).map(String).filter((id) => known.has(id));
    fs.writeFileSync(r.filePath, JSON.stringify({ mendkit: 'tweaks', version: 1, on }, null, 2));
    return { file: r.filePath, count: on.length };
  });
  ipcMain.handle('tweaks-import', async () => {
    techOnly();
    const r = await dialog.showOpenDialog(win!, { title: 'Import tweak preset', properties: ['openFile'], filters: [{ name: 'MendKit tweaks', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    if (data.mendkit !== 'tweaks' || !Array.isArray(data.on)) throw new Error('That file is not a MendKit tweaks export');
    const known = new Set(tweakData.tweaks.map((t) => t.id));
    return data.on.map(String).filter((id: string) => known.has(id));
  });
  ipcMain.handle('restart-explorer', () => {
    techOnly();
    if (process.platform !== 'win32') return false;
    spawn('cmd.exe', ['/c', 'taskkill /f /im explorer.exe & start explorer.exe'], { windowsHide: true, detached: true, stdio: 'ignore' });
    return true;
  });

  // ----- Migration -----
  const appsFile = path.join(app.getPath('userData'), 'apps-from-other-computer.json');
  const mig = (e: object) => win?.webContents.send('mendkit:migrate', e);
  const size = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.max(b ? 1 : 0, Math.round(b / 1024 ** 2))} MB`);
  let dest: DestinationHandle | null = null;
  let source: SourceHandle | null = null;
  let stopFind: (() => void) | null = null;

  /** What can be moved, and where it lives on this computer. Password stores, cookies and caches are left out. */
  const migrateItems = (): ItemSpec[] => {
    const items: ItemSpec[] = [
      { id: 'desktop', label: 'Desktop', root: app.getPath('desktop') },
      { id: 'documents', label: 'Documents', root: app.getPath('documents') },
      { id: 'pictures', label: 'Pictures', root: app.getPath('pictures') },
      { id: 'music', label: 'Music', root: app.getPath('music') },
      { id: 'videos', label: 'Videos', root: app.getPath('videos') },
      { id: 'downloads', label: 'Downloads', root: app.getPath('downloads') },
    ];
    if (process.platform === 'win32') {
      const roaming = app.getPath('appData');
      const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
      const secrets = ['logins.json', 'logins-backup.json', 'key4.db', 'cert9.db', 'cookies.sqlite', 'cookies.sqlite-wal', 'parent.lock', 'lock', 'cache2', 'startupCache', 'Crash Reports'];
      items.push(
        { id: 'firefox', label: 'Firefox profile (bookmarks, history, add-ons)', root: path.join(roaming, 'Mozilla', 'Firefox'), exclude: secrets },
        { id: 'thunderbird', label: 'Thunderbird mail and settings', root: path.join(roaming, 'Thunderbird'), exclude: secrets },
        { id: 'libreoffice', label: 'LibreOffice settings', root: path.join(roaming, 'LibreOffice') },
        { id: 'vscode', label: 'VS Code settings', root: path.join(roaming, 'Code', 'User'), exclude: ['workspaceStorage', 'globalStorage', 'History'] },
        { id: 'chrome-bookmarks', label: 'Chrome bookmarks', root: path.join(local, 'Google', 'Chrome', 'User Data', 'Default'), only: ['Bookmarks'] },
        { id: 'edge-bookmarks', label: 'Edge favourites', root: path.join(local, 'Microsoft', 'Edge', 'User Data', 'Default'), only: ['Bookmarks'] },
      );
    }
    if (process.platform !== 'win32') {
      const home = os.homedir();
      const mac = process.platform === 'darwin';
      const support = mac ? path.join(home, 'Library', 'Application Support') : path.join(home, '.config');
      const secrets = ['logins.json', 'logins-backup.json', 'key4.db', 'cert9.db', 'cookies.sqlite', 'cookies.sqlite-wal', 'parent.lock', 'lock', '.parentlock', 'cache2', 'startupCache', 'Crash Reports', 'Pending Pings'];
      items.push(
        { id: 'firefox', label: 'Firefox profile (bookmarks, history, add-ons)', root: mac ? path.join(support, 'Firefox') : path.join(home, '.mozilla', 'firefox'), exclude: secrets },
        { id: 'thunderbird', label: 'Thunderbird mail and settings', root: mac ? path.join(home, 'Library', 'Thunderbird') : path.join(home, '.thunderbird'), exclude: secrets },
        { id: 'libreoffice', label: 'LibreOffice settings', root: path.join(support, mac ? 'LibreOffice' : 'libreoffice') },
        { id: 'vscode', label: 'VS Code settings', root: path.join(support, 'Code', 'User'), exclude: ['workspaceStorage', 'globalStorage', 'History'] },
        { id: 'chrome-bookmarks', label: 'Chrome bookmarks', root: path.join(support, mac ? path.join('Google', 'Chrome') : 'google-chrome', 'Default'), only: ['Bookmarks'] },
        { id: 'edge-bookmarks', label: 'Edge favourites', root: path.join(support, mac ? 'Microsoft Edge' : 'microsoft-edge', 'Default'), only: ['Bookmarks'] },
      );
    }
    // If a user folder is not set up, the system reports the home folder itself; never treat that as one item.
    const home = path.resolve(os.homedir());
    const seen = new Set<string>();
    return items.filter((i) => {
      const root = path.resolve(i.root);
      if (root === home || seen.has(root)) return false;
      seen.add(root);
      return true;
    });
  };

  // ----- App matching between systems -----
  const appTable = loadApps(path.join(app.getAppPath(), 'definitions'));
  const hasFlatpak = process.platform === 'linux' && onPath('flatpak');
  registerSwitchLinux({ appTable });
  registerBatch3({ engine, catalog, tweakMgr, presets: tweakData.presets, appTable, hasFlatpak, getWin: () => win, logDir, noteToolRun: extras.noteToolRun });
  registerBatch4({ engine, getWin: () => win, logDir });
  registerMacTools({ engine, getWin: () => win });
  registerPermissions();
  registerLinuxTools({ engine });
  registerUpdater({ getWin: () => win, busy: () => engine.isBusy() || job !== null });
  registerOffline({ engine, catalog, getWin: () => win });
  registerBatch5({ engine, getWin: () => win, portable });
  const receivedApps = (): AppList | null => {
    try {
      return normalizeAppList(JSON.parse(fs.readFileSync(appsFile, 'utf8')), appTable);
    } catch {
      return null;
    }
  };
  const appPlan = () => {
    const list = receivedApps();
    return list ? { list, plan: installPlan(list, appTable, catalog.manager, hasFlatpak) } : null;
  };
  const canInstallApps = () => {
    const p = appPlan();
    return !!p && (p.plan.wingetImport || p.plan.installs.length > 0);
  };

  /** After files arrive: list migrated Firefox and Thunderbird profiles, and turn clashing bookmark files into something importable. */
  const finishArrival = (): string[] => {
    const notes: string[] = [];
    const roots = Object.fromEntries(migrateItems().map((i) => [i.id, i.root]));
    for (const [id, name] of [['firefox', 'Firefox'], ['thunderbird', 'Thunderbird']] as const) {
      try {
        const added = roots[id] ? registerMozillaProfiles(roots[id]) : [];
        if (added.length) notes.push(`${name} already had a profile here, so the one from the old computer was added beside it. Open ${name}'s profile manager (about:profiles) to switch to "${added[0]}".`);
      } catch {
        /* leave the profile folders as they arrived */
      }
    }
    for (const [id, name] of [['chrome-bookmarks', 'Chrome'], ['edge-bookmarks', 'Edge']] as const) {
      for (const suffix of ['migrated', 'restored']) {
        const clash = roots[id] ? path.join(roots[id], `Bookmarks (${suffix})`) : '';
        if (!clash || !fs.existsSync(clash)) continue;
        try {
          const { html, count } = bookmarksToHtml(fs.readFileSync(clash, 'utf8'));
          const out = path.join(app.getPath('desktop'), `${name} bookmarks from old computer.html`);
          fs.writeFileSync(out, html);
          fs.rmSync(clash, { force: true });
          notes.push(`${name} already had bookmarks here, so the ${count} from the old computer were saved to the Desktop as "${path.basename(out)}". Import that file from the browser's bookmark manager.`);
        } catch {
          /* leave the file where it is */
        }
      }
    }
    return notes;
  };

  const saveMigration = (m: MigrateSummary, startedAt: Date): RunSummary => {
    const base = path.join(logDir, `${startedAt.toISOString().replace(/[:.]/g, '-')}_migration`);
    const lines: string[] = [];
    const step = (id: string, name: string, level: Level, message: string): StepResult => ({ command: id, name, status: level === 'attention' || level === 'problem' ? 'failed' : 'ok', exitCode: null, seconds: 0, friendly: { level, title: name, message } });
    const steps: StepResult[] = [step('copied', 'Files copied', 'good', `${m.copied.toLocaleString()} files (${size(m.copiedBytes)}) were copied and checked.`)];
    const where = m.role === 'backup' ? 'in the backup' : m.role === 'restore' ? 'on this computer' : 'on the new computer';
    if (m.skipped) steps.push(step('skipped', 'Already there', 'info', `${m.skipped.toLocaleString()} files were already ${where} and were left alone.`));
    if (m.failed.length) {
      const why = m.failed.some((f) => /damaged/.test(f.reason))
        ? 'Some copies on the backup drive are damaged. The log lists them.'
        : m.failed.some((f) => /full|too big/.test(f.reason))
          ? 'The drive ran out of room or cannot hold very large files. The log lists what was missed.'
          : 'This is usually because they were open in a program. Close your programs and run it again to pick them up.';
      steps.push(step('failed', 'Not copied', 'attention', `${m.failed.length.toLocaleString()} files could not be copied. ${why}`));
    }
    const arriving = m.role === 'destination' || m.role === 'restore';
    if (arriving) for (const [i, note] of finishArrival().entries()) steps.push(step(`note-${i}`, 'App settings', 'info', note));
    if (m.appsListed) {
      let text = m.role === 'source' ? 'was sent.' : 'was saved with the backup.';
      const p = arriving ? appPlan() : null;
      if (p) {
        if (p.plan.wingetImport) text = 'is ready. Use "Reinstall apps" to install the ones winget can find.';
        else {
          const none = p.plan.unmatched;
          text = `arrived. ${p.plan.installs.length} can be reinstalled here with "Reinstall apps".` + (none.length ? ` ${none.length} have no automatic match on this kind of computer: ${none.slice(0, 12).join(', ')}${none.length > 12 ? ' and more (listed in the log)' : ''}.` : '');
          lines.push('', 'Apps with no automatic match here:', ...none.map((n) => `  ${n}`));
        }
      }
      steps.push(step('apps', 'App list', 'info', `A list of ${m.appsListed} apps ${text}`));
    }
    const summary: RunSummary = {
      id: 'migration',
      title: m.role === 'source' ? `Sent to ${m.peer}` : m.role === 'destination' ? `Received from ${m.peer}` : m.role === 'backup' ? `Backed up to ${m.peer}` : / on the old drive$/.test(m.peer) ? `Copied ${m.peer}` : `Restored from the backup of ${m.peer}`,
      kind: 'migrate',
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      outcome: m.cancelled ? 'cancelled' : 'completed',
      overall: m.cancelled ? 'problem' : m.failed.length ? 'attention' : 'good',
      needsRestart: false,
      steps,
      logFile: `${base}.log`,
    };
    lines.unshift(`MendKit migration: ${summary.title}`, `Started ${summary.startedAt}`, `Finished ${summary.finishedAt}${m.cancelled ? ' (stopped early)' : ''}`, `${m.copied} copied (${size(m.copiedBytes)}), ${m.skipped} already there, ${m.failed.length} failed, ${m.seconds}s`, '');
    for (const f of m.failed) lines.push(`FAILED ${f.file}: ${f.reason}`);
    fs.writeFileSync(summary.logFile, lines.join('\n') + '\n');
    fs.writeFileSync(`${base}.json`, JSON.stringify(summary, null, 2));
    return summary;
  };
  let job: JobHandle | null = null;
  let backupDir: string | null = null;
  let restoreDir: string | null = null;
  const exportApps = (): Promise<unknown> => detectApps(appTable, catalog.manager, app.getPath('temp'));
  const stopMigration = () => {
    dest?.stop();
    source?.cancel();
    job?.cancel();
    job = null;
    stopFind?.();
    dest = null;
    source = null;
    stopFind = null;
  };

  ipcMain.handle('mig-receive', async () => {
    stopMigration();
    fs.rmSync(appsFile, { force: true });
    const roots = Object.fromEntries(migrateItems().map((i) => [i.id, i.root]));
    let started = new Date();
    dest = await startDestination({
      name: os.hostname(),
      roots,
      appsFile,
      onEvent: (e: MigrateEvent) => {
        if (e.phase === 'paired') started = new Date();
        if (e.phase === 'done') mig({ phase: 'done', summary: saveMigration(e.summary, started), canInstallApps: canInstallApps() });
        else mig(e);
      },
    });
    return { code: dest.code, port: dest.port, name: os.hostname(), addresses: localAddresses() };
  });
  ipcMain.handle('mig-stop', () => stopMigration());
  ipcMain.handle('mig-find', () => {
    stopFind?.();
    stopFind = discover((peer) => mig({ phase: 'peer', ...peer }));
  });
  ipcMain.handle('mig-scan', async () => ({ items: await scanItems(migrateItems()), canApps: process.platform !== 'linux' || catalog.manager !== null || hasFlatpak }));
  ipcMain.handle('mig-send', async (_e, host: string, port: number, code: string, ids: string[], includeApps: boolean) => {
    if (!/^[A-Za-z0-9.\-]{1,253}$/.test(String(host))) throw new Error('That does not look like a computer address');
    if (!/^\d{6}$/.test(String(code))) throw new Error('The code is six digits');
    const p = Number(port);
    if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error('Bad port');
    const want = new Set(Array.isArray(ids) ? ids.map(String) : []);
    const items = migrateItems().filter((i) => want.has(i.id));
    if (!items.length && !includeApps) throw new Error('Choose at least one thing to move');
    source?.cancel();
    const apps = includeApps === true ? await exportApps() : null;
    const started = new Date();
    const handle = runSource({ host: String(host), port: p, code: String(code), name: os.hostname(), items, apps, onEvent: (e) => e.phase !== 'done' && mig(e) });
    source = handle;
    try {
      return saveMigration(await handle.done, started);
    } finally {
      if (source === handle) source = null;
    }
  });
  // ----- Passwords helper (guidance only; MendKit never reads or moves saved passwords) -----
  const passwordGuides = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'definitions', 'passwords.json'), 'utf8')) as { id: string; name: string; best: string; export: string; page: string }[];
  /** Where each browser's program lives on this computer, or null if it is not installed. */
  const browserProgram = (id: string): string | null => {
    const firstFile = (list: string[]) => list.find((p) => fs.existsSync(p)) ?? null;
    if (process.platform === 'darwin') {
      const apps: Record<string, string> = { firefox: 'Firefox', chrome: 'Google Chrome', edge: 'Microsoft Edge', brave: 'Brave Browser' };
      return firstFile([`/Applications/${apps[id]}.app`, path.join(os.homedir(), 'Applications', `${apps[id]}.app`)]) ? apps[id] : null;
    }
    if (process.platform === 'linux') {
      const bins: Record<string, string[]> = { firefox: ['firefox'], chrome: ['google-chrome', 'google-chrome-stable'], edge: ['microsoft-edge', 'microsoft-edge-stable'], brave: ['brave-browser', 'brave'] };
      return (bins[id] ?? []).find(onPath) ?? null;
    }
    const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
    const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    const rel: Record<string, string[]> = {
      firefox: ['Mozilla Firefox\\firefox.exe'],
      chrome: ['Google\\Chrome\\Application\\chrome.exe'],
      edge: ['Microsoft\\Edge\\Application\\msedge.exe'],
      brave: ['BraveSoftware\\Brave-Browser\\Application\\brave.exe'],
    };
    return firstFile((rel[id] ?? []).flatMap((r) => [path.join(pf, r), path.join(pf86, r), path.join(local, r)]));
  };
  const browserInstalled = (id: string): boolean => browserProgram(id) !== null;
  ipcMain.handle('password-guides', () => passwordGuides.map((g) => ({ id: g.id, name: g.name, best: g.best, export: g.export, installed: browserInstalled(g.id) })));
  ipcMain.handle('password-open', async (_e, id: string) => {
    // Opens the browser's own password page so the user can export or turn on sync themselves.
    const g = passwordGuides.find((x) => x.id === id);
    if (!g) throw new Error('Unknown browser');
    // Addresses like about:logins or chrome://... only work inside that browser, so start the browser
    // itself with the address. Handing them to the system would look for an app in the Store instead.
    const program = browserProgram(g.id);
    if (!program) throw new Error(`${g.name} is not installed on this computer`);
    const child = process.platform === 'darwin' ? spawn('open', ['-na', program, '--args', g.page], { detached: true, stdio: 'ignore' }) : spawn(program, [g.page], { detached: true, stdio: 'ignore' });
    child.on('error', () => undefined);
    child.unref();
    return true;
  });

  ipcMain.handle('mig-cancel', () => {
    source?.cancel();
    job?.cancel();
  });

  // Backup to and restore from an external drive. The folder always comes from the system folder picker.
  const freeGb = (dir: string): number | null => {
    try {
      const st = fs.statfsSync(dir);
      return Math.round((st.bavail * st.bsize) / 1024 ** 3);
    } catch {
      return null;
    }
  };
  ipcMain.handle('mig-pick-backup', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Choose the external drive or folder for the backup', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const chosen = r.filePaths[0];
    backupDir = /^MendKit-Backup/i.test(path.basename(chosen)) ? chosen : path.join(chosen, `MendKit-Backup-${os.hostname()}`);
    return { dir: backupDir, freeGb: freeGb(chosen), exists: fs.existsSync(path.join(backupDir, 'manifest.json')) };
  });
  ipcMain.handle('mig-backup', async (_e, ids: string[], includeApps: boolean) => {
    if (!backupDir) throw new Error('Choose where to save the backup first');
    const want = new Set(Array.isArray(ids) ? ids.map(String) : []);
    const items = migrateItems().filter((i) => want.has(i.id));
    if (!items.length) throw new Error('Choose at least one thing to back up');
    const apps = includeApps === true ? await exportApps() : null;
    const started = new Date();
    const handle = runBackup({ dir: backupDir, computer: os.hostname(), items, apps, onEvent: mig });
    job = handle;
    try {
      return saveMigration(await handle.done, started);
    } finally {
      if (job === handle) job = null;
    }
  });
  ipcMain.handle('mig-pick-restore', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Choose the MendKit backup folder', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    let dir = r.filePaths[0];
    if (!fs.existsSync(path.join(dir, 'manifest.json'))) {
      // The drive itself was chosen: use the backup inside it if there is exactly one.
      const inside = fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, 'manifest.json')));
      if (inside.length === 1) dir = path.join(dir, inside[0]);
    }
    const m = readBackup(dir);
    restoreDir = dir;
    const here = new Set(migrateItems().map((i) => i.id));
    return { dir, computer: m.computer, platform: m.platform, createdAt: m.createdAt, items: m.items.map((i) => ({ ...i, available: here.has(i.id) })), hasApps: !!m.apps };
  });
  ipcMain.handle('mig-restore', async (_e, ids: string[]) => {
    if (!restoreDir) throw new Error('Choose the backup folder first');
    fs.rmSync(appsFile, { force: true });
    const roots = Object.fromEntries(migrateItems().map((i) => [i.id, i.root]));
    const started = new Date();
    const handle = runRestore({ dir: restoreDir, roots, itemIds: Array.isArray(ids) ? ids.map(String) : [], appsFile, onEvent: mig });
    job = handle;
    try {
      return { summary: saveMigration(await handle.done, started), canInstallApps: canInstallApps() };
    } finally {
      if (job === handle) job = null;
    }
  });
  // Regular file backups: the same backup as "Back up to a drive", run weekly by the system's scheduler.
  const planFile = path.join(app.getPath('userData'), 'backup-plan.json');
  const BACKUP_JOB: Job = { id: 'backup', label: 'MendKit weekly backup', args: ['--backup', '--unattended'], weekday: 'FRI', time: '12:30' };
  const readPlan = (): { dir: string; lastRun?: string; lastOk?: boolean } | null => {
    try {
      const p = JSON.parse(fs.readFileSync(planFile, 'utf8'));
      return typeof p.dir === 'string' ? p : null;
    } catch {
      return null;
    }
  };
  ipcMain.handle('backup-plan', async () => {
    const p = readPlan();
    return { supported: jobsSupported(), enabled: !!p && (await jobScheduled(BACKUP_JOB)), dir: p?.dir ?? null, connected: !!p && fs.existsSync(p.dir), lastRun: p?.lastRun ?? null, lastOk: p?.lastOk ?? null, when: 'every Friday at 12:30' };
  });
  ipcMain.handle('backup-plan-pick', async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'Choose the external drive for the weekly backup', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const chosen = r.filePaths[0];
    const dir = /^MendKit-Backup/i.test(path.basename(chosen)) ? chosen : path.join(chosen, `MendKit-Backup-${os.hostname()}`);
    fs.writeFileSync(planFile, JSON.stringify({ ...(readPlan() ?? {}), dir }, null, 2));
    return dir;
  });
  ipcMain.handle('backup-plan-set', async (_e, on: boolean) => {
    if (on === true && !readPlan()) throw new Error('Choose the backup drive first');
    await scheduleJob(BACKUP_JOB, on === true);
  });
  plannedBackup = async (): Promise<RunSummary> => {
    const p = readPlan();
    const started = new Date();
    if (!p || !fs.existsSync(path.dirname(p.dir))) {
      const now = started.toISOString();
      return { id: 'weekly-backup', title: 'Weekly backup', kind: 'migrate', startedAt: now, finishedAt: now, outcome: 'stopped', overall: 'attention', needsRestart: false, logFile: '', steps: [{ command: 'drive', name: 'Backup drive', status: 'failed', exitCode: null, seconds: 0, friendly: { level: 'attention', title: 'The backup drive is not connected', message: p ? `This week's backup was skipped because ${p.dir} could not be reached. Connect the drive, then use "Back up now" in Migrate.` : 'No backup drive has been chosen. Open Migrate to set one.' } }] };
    }
    const handle = runBackup({ dir: p.dir, computer: os.hostname(), items: migrateItems(), apps: await exportApps().catch(() => null), onEvent: mig });
    job = handle;
    try {
      const s = saveMigration(await handle.done, started);
      fs.writeFileSync(planFile, JSON.stringify({ ...p, lastRun: new Date().toISOString(), lastOk: s.overall !== 'problem' }, null, 2));
      return s;
    } finally {
      if (job === handle) job = null;
    }
  };

  // Migrate from a drive taken out of another computer. The folder always comes from the system folder picker.
  let oldProfiles: OldProfile[] = [];
  ipcMain.handle('old-pick', async () => {
    const r = process.env.MENDKIT_TEST_OLD ? { canceled: false, filePaths: [process.env.MENDKIT_TEST_OLD] } : await dialog.showOpenDialog(win!, { title: 'Choose the old drive, or the Users or home folder on it', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const dir = r.filePaths[0];
    const mine = path.resolve(os.homedir());
    const found = findProfiles(dir).filter((p) => path.resolve(p.home) !== mine);
    if (!found.length) throw new Error('No user folders were found there. Choose the old drive itself, its Users or home folder, or one person\'s folder.');
    oldProfiles = found;
    return { dir, profiles: found.map((p) => ({ name: p.name, platform: p.platform, home: p.home })) };
  });
  ipcMain.handle('old-scan', async (_e, index: number) => {
    const p = oldProfiles[Number(index)];
    if (!p) throw new Error('Choose the old drive first');
    const here = new Set(migrateItems().map((i) => i.id));
    const items = await scanItems(oldItems(p));
    const apps = oldApps(p, appTable);
    return { items: items.map((i) => ({ ...i, available: here.has(i.id) })), apps: apps ? apps.apps.map((id) => appTable.find((a) => a.id === id)?.name ?? id) : [] };
  });
  ipcMain.handle('old-import', async (_e, index: number, ids: string[], includeApps: boolean) => {
    const p = oldProfiles[Number(index)];
    if (!p) throw new Error('Choose the old drive first');
    const want = new Set(Array.isArray(ids) ? ids.map(String) : []);
    const items = oldItems(p).filter((i) => want.has(i.id));
    if (!items.length && !includeApps) throw new Error('Choose at least one thing to copy');
    fs.rmSync(appsFile, { force: true });
    const roots = Object.fromEntries(migrateItems().map((i) => [i.id, i.root]));
    const started = new Date();
    const handle = runImport({ peer: `${p.name}'s files on the old drive`, items, roots, apps: includeApps === true ? oldApps(p, appTable) : null, appsFile, onEvent: mig });
    job = handle;
    try {
      return { summary: saveMigration(await handle.done, started), canInstallApps: canInstallApps() };
    } finally {
      if (job === handle) job = null;
    }
  });

  ipcMain.handle('mig-install-apps', () => {
    const p = appPlan();
    if (!p) throw new Error('No app list has been received');
    if (p.plan.wingetImport) {
      const file = `${appsFile}.winget.json`;
      fs.writeFileSync(file, JSON.stringify(p.list.winget));
      return engine.runAppImport(file, { elevated: isElevated() });
    }
    if (!p.plan.installs.length) throw new Error('None of the listed apps can be installed automatically on this computer');
    return engine.runAppInstalls(p.plan.installs.map((i) => ({ name: i.app.name, manager: i.manager, pkg: i.pkg })), { elevated: isElevated() });
  });

  ipcMain.handle('reports', (): RunSummary[] =>
    fs
      .readdirSync(logDir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, 100)
      .map((f) => JSON.parse(fs.readFileSync(path.join(logDir, f), 'utf8')) as RunSummary),
  );
  ipcMain.handle('report-log', (_e, file: string) => {
    const full = path.join(logDir, path.basename(String(file)));
    if (!full.endsWith('.log')) throw new Error('Bad log file');
    return fs.readFileSync(full, 'utf8');
  });
  ipcMain.handle('open-logs', () => shell.openPath(logDir));

  // ----- Symptom picker and upgrade advisor -----
  ipcMain.handle('symptoms', () => {
    const list = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'definitions', 'symptoms.json'), 'utf8')) as { id: string; label: string; recipe: string }[];
    return list
      .map((s) => ({ ...s, r: catalog.recipes.find((r) => r.id === s.recipe) }))
      .filter((s) => s.r)
      .map((s) => ({ id: s.id, label: s.label, recipe: s.recipe, description: s.r!.description, minutes: (s.r!.steps[catalog.platform] ?? []).reduce((n, st) => n + (catalog.commands.get(st.command)?.typicalMinutes ?? 1), 0) }));
  });
  ipcMain.handle('advisor', async (): Promise<RunSummary> => {
    const started = new Date();
    const advice = advise(await gatherFacts(), started.getFullYear());
    const base = path.join(logDir, `${started.toISOString().replace(/[:.]/g, '-')}_upgrade-advice`);
    const verdictLevel: Level = advice.verdict === 'keep' ? 'good' : advice.verdict === 'upgrade' ? 'attention' : 'problem';
    const steps: StepResult[] = [{ id: 'verdict', level: verdictLevel, title: 'Verdict', message: advice.headline }, ...advice.findings].map((f) => ({
      command: f.id,
      name: f.title,
      status: f.level === 'problem' || f.level === 'attention' ? 'failed' : 'ok',
      exitCode: null,
      seconds: 0,
      friendly: { level: f.level, title: f.title, message: f.message },
    }));
    const summary: RunSummary = {
      id: 'upgrade-advice',
      title: 'Is this computer worth fixing?',
      kind: 'recipe',
      startedAt: started.toISOString(),
      finishedAt: new Date().toISOString(),
      outcome: 'completed',
      overall: advice.verdict === 'keep' ? 'good' : advice.verdict === 'upgrade' ? 'attention' : 'problem',
      needsRestart: false,
      steps,
      logFile: `${base}.log`,
    };
    fs.writeFileSync(summary.logFile, [`MendKit upgrade advice, ${started.toLocaleString()}`, '', ...steps.map((s) => `[${s.friendly.level}] ${s.friendly.title}: ${s.friendly.message}`)].join('\n') + '\n');
    fs.writeFileSync(`${base}.json`, JSON.stringify(summary, null, 2));
    return summary;
  });

  // ----- Updates: OS, apps and drivers in one place -----
  // Each category maps to existing catalog commands; categories whose commands are missing are dropped.
  type UpCat = { id: string; name: string; description: string; refresh?: string; check?: string; install?: string; installLabel?: string; openWindowsUpdate?: boolean };
  const updateCategoriesAll: Record<string, UpCat[]> = {
    win32: [
      { id: 'windows', name: 'Windows and driver updates', description: 'Security fixes, feature updates and manufacturer drivers come through Windows Update.', openWindowsUpdate: true },
      { id: 'apps', name: 'App updates', description: 'Updates installed programs through winget.', check: 'app-updates-list', install: 'app-updates-install' },
      { id: 'driver-backup', name: 'Back up installed drivers', description: 'Copies every third-party driver to Public Documents before a reinstall or a risky driver update.', install: 'driver-backup', installLabel: 'Back up drivers' },
    ],
    darwin: [
      { id: 'macos', name: 'macOS updates', description: 'System and security updates from Apple.', check: 'os-updates-list', install: 'os-updates-install' },
      { id: 'apps', name: 'App updates (Homebrew)', description: 'Updates apps installed with Homebrew.', refresh: 'brew-update', check: 'brew-outdated', install: 'brew-upgrade' },
    ],
    linux: [
      { id: 'system', name: 'System updates', description: 'Updates every package on the system.', refresh: 'apt-update', check: 'apt-updates-list', install: 'apt-upgrade' },
      { id: 'system', name: 'System updates', description: 'Updates every package on the system.', check: 'dnf-updates-list', install: 'dnf-upgrade' },
      { id: 'system', name: 'System updates', description: 'Updates every package on the system.', check: 'pacman-updates-list', install: 'pacman-upgrade' },
      { id: 'system', name: 'System updates', description: 'Updates every package on the system.', check: 'zypper-updates-list', install: 'zypper-upgrade' },
      { id: 'flatpak', name: 'Flatpak app updates', description: 'Updates apps installed through Flatpak.', install: 'flatpak-update' },
      { id: 'firmware', name: 'Firmware updates', description: 'BIOS, SSD and device firmware from the maker, through fwupd.', refresh: 'fwupd-refresh', check: 'fwupd-list', install: 'fwupd-update' },
    ],
  };
  const has = (id?: string) => !id || catalog.commands.has(id);
  const updateCategories = (updateCategoriesAll[catalog.platform] ?? []).filter(
    (c) => c.openWindowsUpdate || ((!c.check || has(c.check)) && (!c.install || has(c.install)) && (c.check ? has(c.check) : has(c.install))),
  );
  // Commands the Updates screen is allowed to run, so it bypasses the Technician-only gate safely.
  const updateCommandIds = new Set(updateCategories.flatMap((c) => [c.refresh, c.check, c.install].filter((x): x is string => !!x && catalog.commands.has(x))));

  ipcMain.handle('update-categories', () =>
    updateCategories.map((c) => ({ id: c.id, name: c.name, description: c.description, hasCheck: !!c.check, hasInstall: !!c.install, installLabel: c.installLabel ?? 'Install updates', openWindowsUpdate: !!c.openWindowsUpdate })),
  );
  ipcMain.handle('run-update', (_e, catId: string, action: string) => {
    const cat = updateCategories.find((c) => c.id === String(catId));
    if (!cat) throw new Error('Unknown update category');
    const ids =
      action === 'check'
        ? [cat.refresh, cat.check].filter((x): x is string => !!x && updateCommandIds.has(x) && has(x))
        : [cat.refresh && has(cat.refresh) ? cat.refresh : undefined, cat.install].filter((x): x is string => !!x && updateCommandIds.has(x));
    if (!ids.length) throw new Error('Nothing to run for this category');
    const title = action === 'check' ? `Check ${cat.name.toLowerCase()}` : `Install ${cat.name.toLowerCase()}`;
    return engine.runCommands(`update-${cat.id}-${action}`, title, ids, { elevated: isElevated() });
  });
  ipcMain.handle('open-windows-update', () => {
    if (process.platform === 'win32') shell.openExternal('ms-settings:windowsupdate');
    return process.platform === 'win32';
  });

  ipcMain.handle('relaunch-elevated', () => {
    if (process.platform !== 'win32') return { ok: false, message: 'On macOS and Linux, admin steps arrive in a later phase.' };
    const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
    const argList = app.isPackaged ? '' : ` -ArgumentList ${quote(`"${app.getAppPath()}"`)}`;
    const ps = `Start-Process -FilePath ${quote(process.execPath)}${argList} -Verb RunAs`;
    // Let go of the one-window lock first, or the administrator copy would see this one and close itself.
    app.releaseSingleInstanceLock();
    return new Promise((resolve) => {
      const p = spawn('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, stdio: 'ignore' });
      p.on('close', (code) => {
        if (code === 0) {
          resolve({ ok: true });
          app.quit();
        } else {
          app.requestSingleInstanceLock();
          resolve({ ok: false, message: 'Administrator access was not granted.' });
        }
      });
      p.on('error', () => {
        app.requestSingleInstanceLock();
        resolve({ ok: false, message: 'Could not ask for administrator access.' });
      });
    });
  });
}

const portable = applyPortableMode();
// One window at a time, so two copies never run repairs side by side. Scheduled runs are separate and short-lived.
const background = process.argv.includes('--unattended');
if (!background && !app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_e, argv) => {
  if (argv.includes('--unattended') || !win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});
/** Set by registerIpc: runs the planned file backup and returns its summary. */
let plannedBackup: (() => Promise<RunSummary>) | null = null;

app.whenReady().then(() => {
  // Apps started from the Finder or a desktop menu get a short PATH that misses Homebrew and local tools.
  if (process.platform !== 'win32') process.env.PATH = [process.env.PATH, '/opt/homebrew/bin', '/usr/local/bin', '/usr/sbin', '/sbin'].filter(Boolean).join(':');
  logDir = path.join(app.getPath('userData'), 'logs');
  settingsFile = path.join(app.getPath('userData'), 'settings.json');
  fs.mkdirSync(logDir, { recursive: true });
  loadSettings();
  registerIpc();
  // The hardware tests use the camera and microphone; allow them for MendKit's own window only.
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(permission === 'media' && wc === win?.webContents));
  createWindow();
  engine.on('event', (e: EngineEvent) => {
    if (e.type === 'run-end' && win && !win.isFocused() && !unattendedRecipe()) {
      const s = e.summary;
      notify('MendKit has finished', `${s.title}: ${s.overall === 'good' ? 'everything looks good' : s.overall === 'attention' ? 'a few things need attention' : 'a problem was found'}.`, () => win?.show());
    }
  });
  if (process.argv.includes('--backup') && process.argv.includes('--unattended')) {
    win?.minimize();
    win?.webContents.once('did-finish-load', async () => {
      try {
        const s = await plannedBackup!();
        if (s.overall === 'good') return app.quit();
        win?.webContents.send('mendkit:show-summary', s);
        notify('MendKit weekly backup', s.steps[0]?.friendly.title === 'The backup drive is not connected' ? 'The backup drive is not connected, so this week\'s backup was skipped.' : 'The backup finished, but some files need attention. Click to see the details.', () => {
          win?.restore();
          win?.show();
        });
      } catch {
        app.quit();
      }
    });
  }
  const auto = unattendedRecipe();
  if (auto) {
    // Scheduled or scripted run: stay out of the way, and only speak up if something needs attention.
    win?.minimize();
    win?.webContents.once('did-finish-load', async () => {
      try {
        const s = await engine.runRecipe(auto, { elevated: isElevated(), noPrompt: true });
        if (s.overall === 'good') return app.quit();
        win?.webContents.send('mendkit:show-summary', s);
        notify('MendKit monthly check', s.overall === 'problem' ? 'A problem was found. Click to see the details.' : 'A few things need attention. Click to see the details.', () => {
          win?.restore();
          win?.show();
        });
      } catch {
        app.quit();
      }
    });
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (engine?.isBusy()) engine.cancel();
  app.quit();
});
