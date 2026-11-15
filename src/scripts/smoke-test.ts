import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { currentPlatform, loadCatalog, PLATFORMS } from '../engine/catalog';
import { spawn } from 'child_process';
import { Engine, toolCheckCommand, toolCommand } from '../engine/runner';
import { Catalog, CommandDef } from '../engine/types';
import { hasFullDiskAccess } from '../main/permissions';
import { approvedData, regPath, startupToggle, winSpaceCategories, WinStartupItem } from '../engine/wintools';
import { eolState, linuxEol, parseOsRelease, windowsEol } from '../engine/eol';
import { linuxEquivalent, switchAdvice, vendorOf } from '../engine/switch';
import { linuxDownloadCommand, offlineInstallCommand, offlineSupport } from '../engine/offline';
import { currentDesktops, linuxTweaksAvailable, loadTweaks, RegBackend, RegValue, TweakManager } from '../engine/tweaks';
import { runSource, safeTarget, startDestination } from '../engine/migrate';
import { bookmarksToHtml, countApps, fromWinget, installPlan, loadApps, normalizeAppList, registerMozillaProfiles } from '../engine/apps';
import { advise, AdvisorFacts } from '../engine/advisor';
import { exePatterns, loadRemoteTools, matchScan, removalPlan } from '../engine/remote';
import { readBackup, runBackup, runRestore } from '../engine/backup';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** In-memory registry so the tweak logic can be tested on any system. */
class FakeRegistry implements RegBackend {
  values = new Map<string, { type: string; data: string }>();
  ran: string[] = [];
  private k = (p: string, n: string) => `${p}\\${n}`;
  async get(p: string, n: string): Promise<RegValue> {
    const v = this.values.get(this.k(p, n));
    return v ? { exists: true, ...v } : { exists: false };
  }
  async set(p: string, n: string, type: string, data: string) {
    this.values.set(this.k(p, n), { type, data });
  }
  async del(p: string, n: string) {
    this.values.delete(this.k(p, n));
  }
  async delKey(p: string) {
    for (const key of [...this.values.keys()]) if (key.startsWith(p)) this.values.delete(key);
  }
  async run(cmd: string[]) {
    this.ran.push(cmd.join(' '));
  }
}

async function testTweaks(defs: string, engine: Engine, tmp: string): Promise<void> {
  const { tweaks, presets } = loadTweaks(defs);
  const reg = new FakeRegistry();
  // A value the user had already changed: undo must restore it, not the Windows default.
  await reg.set('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', 'TaskbarAl', 'REG_DWORD', '0x5');
  const mgr = new TweakManager(tweaks, reg, path.join(tmp, 'journal.json'));
  const ids = ['file-extensions', 'taskbar-left', 'classic-context-menu', 'telemetry-minimum'];
  let sum = await engine.runActions('tweaks', 'Apply tweaks', 'tweak', ids.map((id) => mgr.step(id, true)), { elevated: true });
  assert(sum.steps.every((s) => s.status === 'ok'), 'tweaks did not apply');
  let st = await mgr.status();
  assert(ids.every((id) => st[id]), 'applied tweaks not detected as on');
  assert(mgr.journalIds().length === 4, 'journal not written');
  sum = await engine.runActions('tweaks', 'Undo tweaks', 'tweak', mgr.journalIds().map((id) => mgr.step(id, false)), { elevated: true });
  assert(sum.steps.every((s) => s.status === 'ok'), 'tweaks did not revert');
  st = await mgr.status();
  assert(ids.every((id) => !st[id]), 'reverted tweaks still on');
  const al = await reg.get('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Advanced', 'TaskbarAl');
  assert(al.exists && Number(al.data) === 5, 'undo did not restore the earlier value');
  assert(reg.values.size === 1, `undo left extra values behind (${reg.values.size})`);
  // Admin tweaks are skipped without rights.
  sum = await engine.runActions('tweaks', 'Apply tweaks', 'tweak', [mgr.step('telemetry-minimum', true)], { elevated: false });
  assert(sum.steps[0].status === 'needs-admin', 'admin tweak ran without rights');
  console.log(`tweaks: ${tweaks.length} tweaks, ${presets.length} presets, apply/detect/undo OK`);
}

async function testMigration(tmp: string): Promise<void> {
  const src = path.join(tmp, 'old');
  const dst = path.join(tmp, 'new');
  fs.mkdirSync(path.join(src, 'docs', 'sub'), { recursive: true });
  fs.mkdirSync(path.join(src, 'profile'), { recursive: true });
  fs.mkdirSync(path.join(dst, 'docs'), { recursive: true });
  const big = Buffer.alloc(3 * 1024 * 1024 + 123);
  for (let i = 0; i < big.length; i += 4096) big.writeUInt32LE(i, i);
  fs.writeFileSync(path.join(src, 'docs', 'big.bin'), big);
  fs.writeFileSync(path.join(src, 'docs', 'sub', 'note.txt'), 'hello');
  fs.writeFileSync(path.join(src, 'docs', 'empty.txt'), '');
  fs.writeFileSync(path.join(src, 'docs', 'clash.txt'), 'from the old computer');
  fs.writeFileSync(path.join(dst, 'docs', 'clash.txt'), 'already here');
  fs.writeFileSync(path.join(src, 'profile', 'places.sqlite'), 'bookmarks');
  fs.writeFileSync(path.join(src, 'profile', 'logins.json'), 'secret');
  const items = [
    { id: 'documents', label: 'Documents', root: path.join(src, 'docs') },
    { id: 'firefox', label: 'Firefox', root: path.join(src, 'profile'), exclude: ['logins.json'] },
  ];
  const roots = { documents: path.join(dst, 'docs'), firefox: path.join(dst, 'profile') };
  let destSummary: any = null;
  const dest = await startDestination({ name: 'new-pc', roots, onEvent: (e) => e.phase === 'done' && (destSummary = e.summary), port: 0, beacon: false, appsFile: path.join(tmp, 'apps.json') });
  const apps = { Sources: [{ Packages: [{ PackageIdentifier: 'Mozilla.Firefox' }] }] };

  // Wrong code is refused and nothing is written.
  const wrong = dest.code === '000000' ? '000001' : '000000';
  let refused = false;
  await runSource({ host: '127.0.0.1', port: dest.port, code: wrong, name: 'old-pc', items, apps, onEvent: () => undefined }).done.catch(() => (refused = true));
  assert(refused, 'wrong pairing code was accepted');
  assert(!fs.existsSync(path.join(dst, 'docs', 'big.bin')), 'files were written with the wrong code');
  await new Promise((r) => setTimeout(r, 100));

  const first = await runSource({ host: '127.0.0.1', port: dest.port, code: dest.code, name: 'old-pc', items, apps, onEvent: () => undefined }).done;
  assert(first.copied === 5 && first.failed.length === 0, `first pass: copied ${first.copied}, failed ${JSON.stringify(first.failed)}`);
  assert(fs.readFileSync(path.join(dst, 'docs', 'big.bin')).equals(big), 'large file differs');
  assert(fs.readFileSync(path.join(dst, 'docs', 'sub', 'note.txt'), 'utf8') === 'hello', 'nested file differs');
  assert(fs.readFileSync(path.join(dst, 'docs', 'clash.txt'), 'utf8') === 'already here', 'an existing file was overwritten');
  assert(fs.readFileSync(path.join(dst, 'docs', 'clash (migrated).txt'), 'utf8') === 'from the old computer', 'clashing file was not kept alongside');
  assert(!fs.existsSync(path.join(dst, 'profile', 'logins.json')), 'an excluded password file was copied');
  assert(fs.existsSync(path.join(tmp, 'apps.json')) && destSummary?.appsListed === 1, 'app list not received');
  await new Promise((r) => setTimeout(r, 100));

  // Running again copies nothing: that is what makes an interrupted transfer resumable.
  const second = await runSource({ host: '127.0.0.1', port: dest.port, code: dest.code, name: 'old-pc', items, apps: null, onEvent: () => undefined }).done;
  assert(second.copied === 0 && second.skipped === 5, `second pass: copied ${second.copied}, skipped ${second.skipped}`);
  dest.stop();

  for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'a\\b', 'C:/x', '']) {
    let threw = false;
    try {
      safeTarget(dst, bad);
    } catch {
      threw = true;
    }
    assert(threw, `unsafe path accepted: ${bad}`);
  }
  console.log('migration: pairing, wrong-code refusal, transfer, no-overwrite, exclusions, resume, path safety OK');
}

async function testPhase5(defs: string, tmp: string): Promise<void> {
  // One root shell per run: here a plain shell stands in for pkexec or sudo.
  const cmd = (id: string, script: string, admin = true): CommandDef => ({ id, name: id, description: '', exec: 'sh', args: ['-c', script], admin });
  const commands = new Map<string, CommandDef>([
    ['a', cmd('a', 'echo "it\'s $(id -u) here"; echo second line')],
    ['b', cmd('b', 'echo failing; exit 3')],
    ['c', cmd('c', 'echo plain', false)],
    ['d', { id: 'd', name: 'd', description: '', exec: 'no-such-program-xyz', args: [], admin: true }],
  ]);
  const catalog: Catalog = { platform: 'linux', manager: null, commands, tools: [], recipes: [{ id: 'r', name: 'r', description: '', simpleMode: true, steps: { linux: ['a', 'b', 'c', 'd'].map((c) => ({ command: c, onFail: 'continue' as const })) } }] };
  let spawned = 0;
  let out = '';
  const engine = new Engine(catalog, tmp, () => (spawned++, spawn('sh', ['-s'], { stdio: 'pipe' })));
  engine.on('event', (e) => e.type === 'output' && (out += e.text));
  const sum = await engine.runRecipe('r', { elevated: false });
  assert(spawned === 1, `root shell started ${spawned} times, expected once`);
  assert(sum.steps.map((s) => s.status).join() === 'ok,failed,ok,error', `privileged steps: ${sum.steps.map((s) => s.status).join()}`);
  assert(sum.steps[1].exitCode === 3, 'exit code not passed back from the root shell');
  assert(out.includes("it's ") && out.includes('second line') && !out.includes('__MENDKIT_'), 'root shell output wrong');
  // A command that hangs is stopped at its time limit and counted as failed.
  commands.set('hang', { id: 'hang', name: 'hang', description: '', exec: 'sleep', args: ['30'], admin: false, timeoutMinutes: 0.02 });
  const t0 = Date.now();
  const hung = await new Engine(catalog, tmp).runCommand('hang', { elevated: false });
  assert(hung.steps[0].status === 'failed' && Date.now() - t0 < 10000, `hung command: ${hung.steps[0].status}`);
  commands.delete('hang');

  // A refused password prompt: admin steps are skipped, the rest still run.
  const refused = new Engine(catalog, tmp, () => spawn('sh', ['-c', 'exit 126'], { stdio: 'pipe' }));
  const sum2 = await refused.runRecipe('r', { elevated: false });
  assert(sum2.steps.map((s) => s.status).join() === 'needs-admin,needs-admin,ok,needs-admin', `refused prompt: ${sum2.steps.map((s) => s.status).join()}`);

  // Distro filtering: an apt-only system keeps apt steps and drops dnf, pacman and zypper ones.
  const debian = loadCatalog(defs, 'linux', (b) => ['apt-get', 'systemctl', 'journalctl'].includes(b));
  const ids = debian.recipes.find((r) => r.id === 'standard-service')!.steps.linux!.map((s) => s.command);
  assert(debian.manager === 'apt' && ids.includes('apt-update') && !ids.some((i) => /^(dnf|pacman|zypper|flatpak)/.test(i)), `debian steps: ${ids.join()}`);
  const clam = debian.tools.find((t) => t.id === 'clamav')!;
  assert(toolCommand(clam, 'install', 'apt').args.join(' ') === 'DEBIAN_FRONTEND=noninteractive apt-get -y install clamav' && toolCommand(clam, 'install', 'apt').admin, 'apt install command wrong');
  const mac = loadCatalog(defs, 'darwin', () => true);
  const rd = mac.tools.find((t) => t.id === 'rustdesk')!;
  assert(toolCommand(rd, 'install', 'brew').args.join(' ') === 'install --cask rustdesk' && toolCheckCommand(rd, 'brew').join(' ') === 'brew list --cask rustdesk', 'brew cask command wrong');
  assert(loadCatalog(defs, 'linux', () => false).manager === null, 'a package manager was invented');

  // macOS and GNOME tweaks go through the same apply, detect and undo logic.
  for (const platform of ['darwin', 'linux']) {
    const { tweaks, presets } = loadTweaks(defs, platform);
    const reg = new FakeRegistry();
    const mgr = new TweakManager(tweaks, reg, path.join(tmp, `journal-${platform}.json`));
    const eng = new Engine(catalog, tmp);
    let s = await eng.runActions('t', 't', 'tweak', tweaks.map((t) => mgr.step(t.id, true)), { elevated: false });
    assert(s.steps.every((x) => x.status === 'ok') && Object.values(await mgr.status()).every(Boolean), `${platform} tweaks did not apply`);
    s = await eng.runActions('t', 't', 'tweak', tweaks.map((t) => mgr.step(t.id, false)), { elevated: false });
    assert(s.steps.every((x) => x.status === 'ok') && reg.values.size === 0, `${platform} tweaks did not undo cleanly`);
    assert(presets.length === 2, `${platform} presets missing`);
    console.log(`${platform} tweaks: ${tweaks.length} tweaks, apply/detect/undo OK`);
  }
  // Linux tweaks follow the desktop: Mint (Cinnamon) gets Cinnamon tweaks, KDE gets KDE ones, none leak across.
  assert(currentDesktops('X-Cinnamon').join() === 'cinnamon' && currentDesktops('ubuntu:GNOME').join() === 'ubuntu,gnome', 'desktop names parsed wrong');
  const allLinux = loadTweaks(defs, 'linux').tweaks;
  const forDesk = (d: string) => linuxTweaksAvailable(allLinux, currentDesktops(d), () => true).map((t) => t.id);
  const mint = forDesk('X-Cinnamon'), plasma = forDesk('KDE'), xf = forDesk('XFCE'), gnome = forDesk('ubuntu:GNOME');
  assert(mint.includes('cinnamon-hidden-files') && !mint.some((i) => /^(kde|xfce|gnome)-/.test(i)), `Mint tweaks wrong: ${mint}`);
  assert(plasma.includes('kde-no-indexing') && !plasma.some((i) => /^(cinnamon|xfce|gnome)-/.test(i)), 'KDE tweaks wrong');
  assert(xf.includes('xfce-no-tearing') && gnome.includes('gnome-min-max') && !gnome.includes('cinnamon-date'), 'XFCE or GNOME tweaks wrong');
  const mintPresets = loadTweaks(defs, 'linux', (all) => linuxTweaksAvailable(all, ['cinnamon'], () => true)).presets;
  assert(mintPresets.every((p) => p.tweaks.every((id) => mint.includes(id))), 'a preset offers another desktop\'s tweak');
  // Backends that print booleans as words (KDE, XFCE) or numbers (macOS) still read back as on.
  {
    const words = new Map<string, string>();
    const wordy: RegBackend = { get: async (p, n) => (words.has(`${p}|${n}`) ? { exists: true, data: words.get(`${p}|${n}`)! } : { exists: false }), set: async (p, n, t, d) => void words.set(`${p}|${n}`, t === 'bool' ? (/^(1|true)$/.test(d) ? 'true' : 'false') : d), del: async (p, n) => void words.delete(`${p}|${n}`), delKey: async () => {}, run: async () => {} };
    const kdeTweaks = allLinux.filter((t) => t.id.startsWith('kde-') || t.id.startsWith('xfce-'));
    const km = new TweakManager(kdeTweaks, wordy, path.join(tmp, 'journal-kde.json'));
    const ks = await new Engine(catalog, tmp).runActions('t', 't', 'tweak', kdeTweaks.map((t) => km.step(t.id, true)), { elevated: false });
    assert(ks.steps.every((x) => x.status === 'ok'), `KDE/XFCE tweaks not detected after applying: ${ks.steps.filter((x) => x.status !== 'ok').map((x) => x.name)}`);
  }
  console.log(`linux desktops: Cinnamon ${mint.length}, KDE ${plasma.length}, XFCE ${xf.length}, GNOME ${gnome.length} tweaks OK`);
  console.log('phase 5: single root shell, refused prompt, distro filtering, package manager commands OK');
}

function testCrossSystem(defs: string, tmp: string): void {
  const table = loadApps(defs);
  const exported = { Sources: [{ Packages: [{ PackageIdentifier: 'Mozilla.Firefox' }, { PackageIdentifier: 'GIMP.GIMP.3' }, { PackageIdentifier: 'Microsoft.Teams' }, { PackageIdentifier: 'Some.UnknownApp' }] }] };
  const m = fromWinget(exported, table);
  assert(m.apps.join() === 'firefox,gimp,teams' && m.other.join() === 'Some.UnknownApp', `winget matching: ${m.apps.join()} / ${m.other.join()}`);
  const list = normalizeAppList(exported, table)!; // the format earlier versions saved
  assert(list.format === 2 && countApps(exported) === 4 && countApps(list) === 4, 'legacy app list not understood');
  // Windows to Windows: hand the whole export to winget.
  assert(installPlan(list, table, 'winget', false).wingetImport, 'same-system plan should use winget import');
  // Windows to Mac: casks, with the unknown app reported.
  const mac = installPlan(list, table, 'brew', false);
  assert(mac.installs.map((i) => i.pkg).join() === 'cask:firefox,cask:gimp,cask:microsoft-teams' && mac.unmatched.join() === 'Some.UnknownApp', `mac plan: ${mac.installs.map((i) => i.pkg).join()}`);
  // Windows to Debian with Flatpak: native where it exists, Flatpak otherwise, Teams has neither.
  const deb = installPlan(list, table, 'apt', true);
  assert(deb.installs.map((i) => `${i.manager}:${i.pkg}`).join() === 'apt:firefox,apt:gimp' && deb.unmatched.join() === 'Microsoft Teams,Some.UnknownApp', `debian plan: ${deb.installs.map((i) => `${i.manager}:${i.pkg}`).join()} / ${deb.unmatched.join()}`);
  // A Mac list arriving on Windows without a winget export installs by table id.
  const fromMac = installPlan({ format: 2, platform: 'darwin', winget: null, apps: ['vlc', 'zoom'], other: ['Final Cut Pro'] }, table, 'winget', false);
  assert(fromMac.installs.map((i) => i.pkg).join() === 'VideoLAN.VLC,Zoom.Zoom' && fromMac.unmatched.join() === 'Final Cut Pro', 'mac to windows plan wrong');
  // Linux with only Flatpak.
  assert(installPlan({ format: 2, platform: 'win32', winget: null, apps: ['zoom'], other: [] }, table, null, true).installs[0].manager === 'flatpak', 'flatpak fallback missing');

  // A Windows-layout Firefox profile arriving beside an existing Linux-layout one.
  const ff = path.join(tmp, 'ff');
  fs.mkdirSync(path.join(ff, 'abcd.default-release'), { recursive: true });
  fs.mkdirSync(path.join(ff, 'Profiles', 'wxyz.default-release'), { recursive: true });
  fs.writeFileSync(path.join(ff, 'abcd.default-release', 'prefs.js'), '');
  fs.writeFileSync(path.join(ff, 'Profiles', 'wxyz.default-release', 'places.sqlite'), '');
  fs.writeFileSync(path.join(ff, 'profiles.ini'), '[Profile0]\nName=default-release\nIsRelative=1\nPath=abcd.default-release\nDefault=1\n\n[General]\nStartWithLastProfile=1\n');
  const added = registerMozillaProfiles(ff);
  const ini = fs.readFileSync(path.join(ff, 'profiles.ini'), 'utf8');
  assert(added.length === 1 && ini.includes('[Profile1]') && ini.includes('Path=Profiles/wxyz.default-release') && ini.includes('Path=abcd.default-release'), `profiles.ini not updated: ${ini}`);
  assert(registerMozillaProfiles(ff).length === 0, 'profile registered twice');

  const bm = JSON.stringify({ roots: { bookmark_bar: { name: 'Bar', type: 'folder', children: [{ type: 'url', name: 'A & B', url: 'https://example.com/?a=1&b=2' }, { type: 'folder', name: 'Empty', children: [] }] }, other: { name: 'Other', type: 'folder', children: [{ type: 'url', name: 'C', url: 'https://example.org' }] } } });
  const { html, count } = bookmarksToHtml(bm);
  assert(count === 2 && html.includes('<A HREF="https://example.com/?a=1&amp;b=2">A &amp; B</A>') && !html.includes('Empty') && html.startsWith('<!DOCTYPE NETSCAPE-Bookmark-file-1>'), 'bookmark conversion wrong');
  console.log(`cross-system: ${table.length} apps in the table, matching, install plans, profile registration, bookmark conversion OK`);
}

async function testBackup(tmp: string): Promise<void> {
  const src = path.join(tmp, 'b-old');
  const drive = path.join(tmp, 'b-drive', 'MendKit-Backup');
  const dst = path.join(tmp, 'b-new');
  fs.mkdirSync(path.join(src, 'docs', 'sub'), { recursive: true });
  fs.mkdirSync(path.join(dst, 'docs'), { recursive: true });
  const big = Buffer.alloc(2 * 1024 * 1024 + 7, 0x5a);
  fs.writeFileSync(path.join(src, 'docs', 'big.bin'), big);
  fs.writeFileSync(path.join(src, 'docs', 'sub', 'note.txt'), 'hello');
  fs.writeFileSync(path.join(src, 'docs', 'clash.txt'), 'old one');
  fs.writeFileSync(path.join(dst, 'docs', 'clash.txt'), 'new');
  const items = [{ id: 'documents', label: 'Documents', root: path.join(src, 'docs') }];
  const apps = { Sources: [{ Packages: [{ PackageIdentifier: 'A.B' }, { PackageIdentifier: 'C.D' }] }] };
  const b1 = await runBackup({ dir: drive, computer: 'old-pc', items, apps, onEvent: () => undefined }).done;
  assert(b1.copied === 3 && b1.failed.length === 0, `backup copied ${b1.copied}`);
  fs.writeFileSync(path.join(src, 'docs', 'new.txt'), 'added later');
  const b2 = await runBackup({ dir: drive, computer: 'old-pc', items, apps, onEvent: () => undefined }).done;
  assert(b2.copied === 1 && b2.skipped === 3, `second backup copied ${b2.copied}, skipped ${b2.skipped}`);
  const m = readBackup(drive);
  assert(m.computer === 'old-pc' && m.items[0].files === 4, 'manifest wrong');
  // Damage one file on the "drive": restore must refuse it and keep the rest.
  fs.writeFileSync(path.join(drive, 'files', 'documents', 'sub', 'note.txt'), 'hellp');
  const r1 = await runRestore({ dir: drive, roots: { documents: path.join(dst, 'docs') }, itemIds: ['documents'], appsFile: path.join(tmp, 'b-apps.json'), onEvent: () => undefined }).done;
  assert(r1.copied === 3 && r1.failed.length === 1 && r1.appsListed === 2, `restore copied ${r1.copied}, failed ${r1.failed.length}`);
  assert(!fs.existsSync(path.join(dst, 'docs', 'sub', 'note.txt')), 'a damaged file was restored');
  assert(fs.readFileSync(path.join(dst, 'docs', 'big.bin')).equals(big), 'restored file differs');
  assert(fs.readFileSync(path.join(dst, 'docs', 'clash.txt'), 'utf8') === 'new', 'restore overwrote a file');
  assert(fs.readFileSync(path.join(dst, 'docs', 'clash (restored).txt'), 'utf8') === 'old one', 'clashing file not kept alongside');
  let refused = false;
  try {
    readBackup(tmp);
  } catch {
    refused = true;
  }
  assert(refused, 'a non-backup folder was accepted');
  console.log('backup: copy, incremental re-run, manifest, damaged-file detection, no-overwrite restore OK');
}

async function main(): Promise<void> {
  const defs = path.join(__dirname, '..', '..', 'definitions');

  // 1. Every platform's definitions load and every recipe step points at a real command.
  for (const p of PLATFORMS) {
    const c = loadCatalog(defs, p, () => true); // every command, whatever is installed here
    console.log(`${p}: ${c.commands.size} commands, ${c.recipes.length} recipes, ${c.tools.length} tools OK`);
  }

  // 2. Run the read-only Health report on this machine, without admin rights.
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mendkit-test-'));
  const engine = new Engine(loadCatalog(defs, currentPlatform()), logDir);
  let outputChars = 0;
  engine.on('event', (e) => {
    if (e.type === 'output') outputChars += e.text.length;
  });
  const summary = await engine.runRecipe('health-report', { elevated: false });
  for (const s of summary.steps) console.log(`  ${s.status.padEnd(8)} [${s.friendly.level}] ${s.friendly.title}: ${s.friendly.message}`);
  console.log(`  overall: ${summary.overall}`);
  if (summary.outcome !== 'completed') throw new Error(`Health report did not complete: ${summary.outcome}`);
  if (!fs.existsSync(summary.logFile) || outputChars === 0) throw new Error('No log output was produced');
  if (!summary.steps.some((s) => s.status === 'ok')) throw new Error('No step succeeded');

  // 3. Unknown ids are refused.
  let refused = false;
  try {
    await engine.runCommand('format-c', { elevated: true });
  } catch {
    refused = true;
  }
  if (!refused) throw new Error('Unknown command id was not refused');

  // 4. Tweaks apply, are detected, and undo exactly. 5. Migration over loopback.
  await testTweaks(defs, engine, logDir);
  await testMigration(logDir);
  await testBackup(logDir);
  await testPhase5(defs, logDir);
  testCrossSystem(defs, logDir);

  // Full Disk Access probe: a readable protected file means granted, none at all means unknown.
  const fda = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-fda-'));
  assert(hasFullDiskAccess(fda) === 'unknown' || process.platform === 'darwin', 'Full Disk Access guessed without evidence');
  fs.mkdirSync(path.join(fda, 'Library/Safari'), { recursive: true });
  fs.writeFileSync(path.join(fda, 'Library/Safari/Bookmarks.plist'), '');
  assert(hasFullDiskAccess(fda) === 'granted', 'Full Disk Access not detected');
  console.log('permissions: Full Disk Access probe OK');

  // End of support: Windows 10 has ended, Mint 22 is supported, an old Ubuntu has ended.
  const now = new Date('2026-11-14');
  assert(eolState(windowsEol(19045), now) === 'ended' && eolState(windowsEol(26100), now) === 'ok', 'Windows end of support wrong');
  assert(eolState(linuxEol(parseOsRelease('ID=linuxmint\nVERSION_ID="22.1"\n')), now) === 'ok', 'Mint 22 should be supported');
  assert(eolState(linuxEol(parseOsRelease('ID=ubuntu\nVERSION_ID="20.04"\n')), now) === 'ended', 'Ubuntu 20.04 should have ended');
  assert(eolState(linuxEol(parseOsRelease('ID=arch\n')), now) === 'ok', 'a rolling release has no end date');
  // Switch to Linux: verdicts and app replacements.
  const eqs = JSON.parse(fs.readFileSync(path.join(defs, 'linux-equivalents.json'), 'utf8'));
  assert(linuxEquivalent('Microsoft Office Home and Business 2021', eqs)?.app === 'libreoffice' && linuxEquivalent('1Password', eqs) === null && linuxEquivalent('Adobe Acrobat Reader DC', eqs)?.name === 'PDF reader', 'app replacements matched wrong');
  const base = { ramGb: 8, is64: true, uefi: true, secureBoot: true, gpus: [{ name: 'Intel UHD', vendor: vendorOf('PCI\\VEN_8086&DEV_9B41') }], nets: [{ name: 'Intel Wi-Fi 6 AX201', vendor: 'Intel' }], fingerprint: false, driveType: 'SSD', driveGb: 256, bitlocker: false, fastStartup: false, win11Ok: false };
  assert(switchAdvice(base).verdict === 'good' && switchAdvice(base).distroId === 'mint', 'a plain Intel laptop should suit Linux');
  assert(switchAdvice({ ...base, nets: [{ name: 'Broadcom 802.11ac Wireless', vendor: 'Broadcom' }] }).verdict === 'extra-steps', 'Broadcom Wi-Fi needs extra steps');
  assert(switchAdvice({ ...base, ramGb: 3 }).distroId === 'xubuntu' && switchAdvice({ ...base, is64: false }).verdict === 'not-recommended', 'light edition or 32-bit verdict wrong');
  // Linux offline cache: download and install commands for each package manager.
  assert(linuxDownloadCommand('apt', 'htop', '/c/htop')!.join(' ').includes("--download-only --reinstall -o Dir::Cache::archives='/c/htop' 'htop'") && linuxDownloadCommand('zypper', 'x', '/c') === null, 'Linux download command wrong');
  const le = { tool: 'htop', wingetId: '', version: '3', file: 'pkgs', size: 1, sha256: 'x', installerType: 'linux-dnf', downloaded: '' };
  assert(offlineSupport(le) === 'install' && offlineInstallCommand({ id: 'htop', name: 'htop', job: '', description: '', license: 'free', packages: {} }, le, '/c/htop').args[1].includes("dnf install -y --disablerepo='*' '/c/htop/pkgs'/*.rpm"), 'Linux offline install command wrong');
  // Remote access audit on Linux: packages, Flatpaks, services and loose copies are recognised.
  const lf = matchScan({ programs: [{ DisplayName: 'anydesk', UninstallString: 'pkg:apt:anydesk' }, { DisplayName: 'com.rustdesk.RustDesk', UninstallString: 'flatpak:system:com.rustdesk.RustDesk' }], processes: [], services: [{ Name: 'anydesk.service', DisplayName: 'anydesk.service', PathName: '', State: 'enabled', StartMode: 'Auto' }], files: ['/home/a/Downloads/TeamViewer_x64.AppImage', '/home/a/Downloads/photos'] }, loadRemoteTools(defs));
  assert(['anydesk', 'rustdesk', 'teamviewer'].every((id) => lf.some((f) => f.id === id)) && lf.find((f) => f.id === 'anydesk')!.services.length === 1, `Linux remote access findings wrong: ${lf.map((f) => f.id)}`);
  console.log('Linux batch: end of support, switch assistant, offline packages and remote access on Linux OK');

  // Windows startup items: Task Manager's on/off data and the command for each kind of item.
  assert(approvedData(true) === '02' + '00'.repeat(11) && approvedData(false, Date.UTC(2026, 0, 1)).length === 24 && approvedData(false).startsWith('03000000'), 'StartupApproved data wrong');
  assert(regPath('HKCU:\\Software\\X') === 'HKCU\\Software\\X', 'registry path conversion wrong');
  const wi = (kind: WinStartupItem['kind'], extra: Partial<WinStartupItem>): WinStartupItem => ({ id: 'w1', kind, name: 'Thing', command: '', file: '', publisher: '', signer: '', signed: true, missing: false, scope: 'user', enabled: true, ...extra });
  const runOff = startupToggle(wi('run', { approvedKey: 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run', valueName: 'Thing' }), false);
  assert(runOff.exec === 'reg.exe' && runOff.args.includes('REG_BINARY') && !runOff.admin && runOff.args[1].startsWith('HKCU\\Software'), 'Run item toggle wrong');
  const svcOn = startupToggle(wi('service', { scope: 'all', service: 'FooSvc' }), true, true);
  assert(svcOn.exec === 'sc.exe' && svcOn.admin && svcOn.args.join(' ') === 'config FooSvc start= delayed-auto', 'service restore wrong');
  const taskOff = startupToggle(wi('task', { scope: 'all', taskPath: '\\Vendor\\', taskName: 'Updater' }), false);
  assert(taskOff.args.join(' ') === '/Change /TN \\Vendor\\Updater /DISABLE', `task toggle wrong: ${taskOff.args.join(' ')}`);
  const cats = winSpaceCategories({ local: '/nonexistent', temp: '/nonexistent' });
  assert(new Set(cats.map((c) => c.id)).size === cats.length, 'two space categories share an id');
  const userLevel = cats.filter((c) => c.step && !c.step.admin).map((c) => c.id).sort().join();
  assert(userLevel === 'browser,recycle,thumbs,user-temp', `only your own files should clear without administrator: ${userLevel}`);
  assert(cats.filter((c) => c.preset).every((c) => !['recycle', 'dumps', 'win-old', 'hiber', 'component', 'downloads'].includes(c.id)), 'a risky category is ticked by default');
  console.log('Windows startup items and free up space: OK');

  // Symptoms point at real recipes on every system that lists them; advisor verdicts.
  const symptoms = JSON.parse(fs.readFileSync(path.join(defs, 'symptoms.json'), 'utf8')) as { id: string; recipe: string }[];
  const anyRecipes = new Set((['win32', 'darwin', 'linux'] as const).flatMap((p) => loadCatalog(defs, p, () => true).recipes.map((r) => r.id)));
  assert(symptoms.every((s) => anyRecipes.has(s.recipe)), 'a symptom points at a missing recipe');
  // Mac-only additions are offered on a Mac and hidden elsewhere.
  const macIds = new Set(loadCatalog(defs, 'darwin', () => true).recipes.map((r) => r.id));
  const winIds = new Set(loadCatalog(defs, 'win32', () => true).recipes.map((r) => r.id));
  for (const id of ['mac-security', 'app-wont-open', 'running-hot', 'free-space', 'camera-fix']) assert(macIds.has(id), `Mac recipe ${id} missing`);
  assert(!winIds.has('running-hot'), 'Mac-only recipe shown on Windows');
  const facts: AdvisorFacts = { platform: 'win32', ramGb: 16, driveType: 'SSD', driveHealthy: true, freePercent: 40, windowsBuild: 26100, tpm: '2.0', secureBoot: true, cores: 8, driveGb: 512, biosYear: 2024, batteryPercent: 91 };
  assert(advise(facts, 2026).verdict === 'keep', 'healthy computer not judged worth keeping');
  const tired = advise({ ...facts, ramGb: 4, driveType: 'HDD', windowsBuild: 19045, biosYear: 2019 }, 2026);
  assert(tired.verdict === 'upgrade' && /more memory and an SSD/.test(tired.headline), `upgrade verdict wrong: ${tired.headline}`);
  const done = advise({ ...facts, ramGb: 4, driveType: 'HDD', windowsBuild: 19045, tpm: 'none', secureBoot: false, biosYear: 2013 }, 2026);
  assert(done.verdict === 'replace' && done.findings.some((f) => f.id === 'win11' && f.level === 'problem'), 'replace verdict wrong');
  const unknown = advise({ ...facts, windowsBuild: 19045, tpm: null, secureBoot: null }, 2026);
  assert(unknown.findings.some((f) => f.id === 'win11' && f.level === 'skipped'), 'unreadable TPM should ask for administrator');
  assert(advise({ ...facts, platform: 'linux', windowsBuild: null, tpm: null, secureBoot: null, driveType: null, batteryPercent: null }, 2026).verdict === 'keep', 'linux advice wrong');
  console.log(`first batch: ${symptoms.length} symptoms, advisor verdicts OK`);

  // Remote access audit: recognition and removal planning.
  const rdefs = loadRemoteTools(defs);
  const scan = matchScan(
    {
      programs: [
        { DisplayName: 'AnyDesk', Publisher: 'AnyDesk Software GmbH', UninstallString: '"C:\\Program Files (x86)\\AnyDesk\\AnyDesk.exe" --uninstall', InstallLocation: 'C:\\Program Files (x86)\\AnyDesk\\' },
        { DisplayName: 'TeamViewer', UninstallString: 'MsiExec.exe /X{12345678-1234-1234-1234-123456789ABC}', PSChildName: '{12345678-1234-1234-1234-123456789ABC}' },
        { DisplayName: 'Mozilla Firefox (x64 en-US)', UninstallString: 'helper.exe' },
        { DisplayName: 'Anytime Organizer Deluxe', UninstallString: 'x.exe' },
      ],
      processes: [
        { Name: 'AnyDesk', Path: 'C:\\Users\\Pat\\Downloads\\AnyDesk.exe', Id: 4321 },
        { Name: 'explorer', Path: 'C:\\Windows\\explorer.exe', Id: 900 },
      ],
      services: [
        { Name: 'AnyDesk', DisplayName: 'AnyDesk Service', PathName: '"C:\\Program Files (x86)\\AnyDesk\\AnyDesk.exe" --service', State: 'Running', StartMode: 'Auto' },
        { Name: 'Spooler', DisplayName: 'Print Spooler', PathName: 'C:\\Windows\\System32\\spoolsv.exe', State: 'Running', StartMode: 'Auto' },
      ],
      files: ['C:\\Users\\Pat\\Downloads\\AnyDesk.exe', 'C:\\Program Files (x86)\\AnyDesk\\AnyDesk.exe', 'C:\\Users\\Pat\\Desktop\\UltraViewer_setup_6.6.exe', 'C:\\Windows\\System32\\quickassist.exe'],
    },
    rdefs,
  );
  assert(scan.map((f) => f.id).join() === 'anydesk,teamviewer,ultraviewer,quick-assist', `remote audit matched: ${scan.map((f) => f.id).join()}`);
  const any = scan[0];
  assert(any.installed.length === 1 && any.running.length === 1 && any.services.length === 1 && any.files.join() === 'C:\\Users\\Pat\\Downloads\\AnyDesk.exe', 'AnyDesk finding wrong (installed copy should not be listed as a loose file)');
  const plan = removalPlan(any, rdefs);
  assert(plan.pids.join() === '4321' && plan.services.join() === 'AnyDesk' && plan.uninstall[0].silent === '--remove --silent' && plan.files.length === 1, 'AnyDesk removal plan wrong');
  assert(removalPlan(scan[1], rdefs).uninstall[0].msi === '{12345678-1234-1234-1234-123456789ABC}', 'MSI product code not recognised');
  const qa = removalPlan(scan[3], rdefs);
  assert(scan[3].builtin && !qa.pids.length && !qa.files.length && !qa.uninstall.length, 'a built-in Windows tool was planned for removal');
  assert(exePatterns(rdefs).length > 50, 'exe patterns missing');
  console.log(`remote audit: ${rdefs.length} products, recognition and removal planning OK`);

  // Every tool in the catalog has a guide, and every guide has steps.
  const guides = JSON.parse(fs.readFileSync(path.join(defs, 'guides.json'), 'utf8')) as { id: string; related?: string[]; screen?: string; sections: { heading: string; steps: (string | { t: string })[] }[] }[];
  const gIds = new Set(guides.map((g) => g.id));
  assert(gIds.size === guides.length, 'two guides share an id');
  assert(guides.every((g) => (g.related ?? []).every((r) => gIds.has(r))), 'a guide links to a missing guide');
  assert(guides.every((g) => g.sections.every((x) => x.steps.every((st) => typeof st === 'string' ? st.length > 0 : typeof st.t === 'string' && st.t.length > 0))), 'a guide step is empty');
  const toolIds = (JSON.parse(fs.readFileSync(path.join(defs, 'tools.json'), 'utf8')) as { id: string }[]).map((t) => t.id);
  assert(toolIds.every((id) => guides.some((g) => g.id === id)), 'a tool has no guide');
  assert(guides.every((g) => g.sections.length > 0 && g.sections.every((x) => x.steps.length > 0)) && guides.some((g) => g.id === 'mendkit'), 'a guide is empty');
  console.log(`guides: ${guides.length} guides, one per tool plus MendKit OK`);

  // Batch 3: profiles reference real ids, light maintenance exists everywhere, mixed step runs work.
  const profs = JSON.parse(fs.readFileSync(path.join(defs, 'profiles.json'), 'utf8')) as { id: string; apps: string[]; tools: string[]; tweakPreset?: string }[];
  const appIds = (JSON.parse(fs.readFileSync(path.join(defs, 'apps.json'), 'utf8')) as { id: string }[]).map((x) => x.id);
  const presetIds = (JSON.parse(fs.readFileSync(path.join(defs, 'tweak-presets.json'), 'utf8')) as { id: string }[]).map((x) => x.id);
  for (const pr of profs) {
    assert(pr.apps.every((id) => appIds.includes(id)), `profile ${pr.id} names an unknown app`);
    assert(pr.tools.every((id) => toolIds.includes(id)), `profile ${pr.id} names an unknown tool`);
    assert(!pr.tweakPreset || presetIds.includes(pr.tweakPreset), `profile ${pr.id} names an unknown preset`);
  }
  const recipesAll = JSON.parse(fs.readFileSync(path.join(defs, 'recipes.json'), 'utf8')) as { id: string; steps: Record<string, { command: string }[]> }[];
  for (const rid of ['light-maintenance', 'light-maintenance-updates']) {
    const rec = recipesAll.find((x) => x.id === rid);
    assert(!!rec, `${rid} recipe missing`);
    for (const plat of ['win32', 'darwin', 'linux']) {
      const cmds = (JSON.parse(fs.readFileSync(path.join(defs, `commands.${plat}.json`), 'utf8')) as { id: string }[]).map((c) => c.id);
      const steps = rec!.steps[plat] || [];
      assert(steps.length > 0 && steps.every((st) => cmds.includes(st.command)), `${rid} has a missing step on ${plat}`);
    }
  }
  console.log(`batch 3: ${profs.length} profiles and light maintenance recipes OK`);

  // Batch 4: old-drive migration, crash analysis, secure erase.
  {
    const { findProfiles, oldItems, oldApps } = await import('../engine/olddrive');
    const { runImport } = await import('../engine/backup');
    const { loadApps } = await import('../engine/apps');
    const old = fs.mkdtempSync(path.join(os.tmpdir(), 'mendkit-old-'));
    const mk = (rel: string, text = 'x') => {
      const f = path.join(old, rel);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, text);
    };
    mk('Windows/notepad.exe');
    mk('Users/Bob/NTUSER.DAT');
    mk('Users/Bob/Documents/letter.txt', 'dear');
    mk('Users/Bob/Documents/sub/plan.txt', 'plan');
    mk('Users/Bob/AppData/Roaming/Mozilla/Firefox/profiles.ini', '[General]');
    mk('Users/Bob/AppData/Roaming/Mozilla/Firefox/Profiles/abc/logins.json', 'secret');
    mk('Users/Bob/AppData/Local/Google/Chrome/User Data/Default/Bookmarks', '{}');
    mk('Users/Public/Documents/x.txt');
    mk('Program Files/Mozilla Firefox/firefox.exe');
    mk('Program Files/VideoLAN/VLC/vlc.exe');
    const found = findProfiles(old);
    assert(found.length === 1 && found[0].name === 'Bob' && found[0].platform === 'win32', 'old drive profiles not found');
    assert(findProfiles(path.join(old, 'Users', 'Bob')).length === 1, 'a single profile folder was not recognised');
    const oi = oldItems(found[0]);
    const apps = oldApps(found[0], loadApps(defs));
    assert(!!apps && apps.apps.includes('firefox') && apps.apps.includes('vlc'), 'old drive apps not recognised');
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mendkit-new-'));
    const roots = { documents: path.join(dest, 'Documents'), firefox: path.join(dest, 'ff'), 'chrome-bookmarks': path.join(dest, 'chrome') };
    fs.mkdirSync(roots.documents, { recursive: true });
    fs.writeFileSync(path.join(roots.documents, 'letter.txt'), 'a different letter');
    const pick = oi.filter((i) => i.id in roots);
    const r1 = await runImport({ peer: 'old', items: pick, roots, onEvent: () => undefined }).done;
    assert(r1.copied === 4 && r1.failed.length === 0, `old drive import copied ${r1.copied}, failed ${r1.failed.length}`);
    assert(fs.readFileSync(path.join(roots.documents, 'letter (restored).txt'), 'utf8') === 'dear' && fs.readFileSync(path.join(roots.documents, 'letter.txt'), 'utf8') === 'a different letter', 'import overwrote an existing file');
    assert(!fs.existsSync(path.join(roots.firefox, 'Profiles', 'abc', 'logins.json')), 'saved passwords were copied from the old drive');
    const r2 = await runImport({ peer: 'old', items: pick, roots, onEvent: () => undefined }).done;
    assert(r2.copied === 0 && r2.skipped === 4, 'second import copied files again');
    assert(fs.readFileSync(path.join(old, 'Users/Bob/Documents/letter.txt'), 'utf8') === 'dear', 'the old drive was changed');
    console.log('old drive: profiles, apps and import OK');

    const { analyse, bugcheck, parseBugcheckMessage, parseDumpHeader } = await import('../engine/crash');
    const head = Buffer.alloc(0x60);
    head.write('PAGEDU64', 0, 'latin1');
    head.writeUInt32LE(0x9f, 0x38);
    head.writeBigUInt64LE(3n, 0x40);
    assert(parseDumpHeader(head)?.code === 0x9f && parseDumpHeader(head)?.params[0] === '0x3' && parseDumpHeader(Buffer.alloc(0x60)) === null, 'dump header parsing wrong');
    assert(parseBugcheckMessage('The computer has rebooted from a bugcheck.  The bugcheck was: 0x00000124 (0x0, 0x1, 0x2, 0x3).') === 0x124, 'bugcheck message parsing wrong');
    assert(bugcheck(0xd1).cause === 'driver' && bugcheck(0xdead).cause === 'unknown', 'bugcheck table wrong');
    const now = Date.now();
    const at = (h: number) => new Date(now - h * 3600000).toISOString();
    const an = analyse([{ time: at(5), kind: 'bluescreen', code: 0xd1 }, { time: at(5), kind: 'power-loss' }, { time: at(30), kind: 'bluescreen', code: 0xd1 }, { time: at(50), kind: 'app-crash', subject: 'game.exe' }, { time: at(51), kind: 'app-crash', subject: 'game.exe' }], 30, 'win32');
    assert(an.overall === 'problem' && /driver/.test(an.headline) && an.findings[0].count === 2 && !an.findings.some((f) => /without warning/.test(f.title)) && an.findings.some((f) => /game\.exe/.test(f.title)), 'crash analysis wrong');
    assert(an.advice.some((x) => x.action?.id === 'updates'), 'crash advice missing');
    const hwa = analyse([{ time: at(1), kind: 'bluescreen', code: 0x124 }, { time: at(2), kind: 'hardware-error' }], 30, 'win32');
    assert(/hardware/.test(hwa.headline) && hwa.advice.some((x) => x.action?.type === 'memtest'), 'hardware crash advice wrong');
    assert(analyse([], 30, 'linux').overall === 'good', 'empty crash list not good');
    assert(analyse([{ time: at(1), kind: 'power-loss' }], 30, 'win32').overall === 'attention', 'lone power loss not flagged');
    console.log('crash analyzer: dump header, stop codes and advice OK');

    const { isProtected, measure, shredPaths, wipeFreeSpace } = await import('../engine/wipe');
    assert(isProtected(os.homedir()) && isProtected(path.parse(os.homedir()).root) && isProtected(process.platform === 'win32' ? 'C:\\Windows\\System32' : '/usr/bin') && !isProtected(path.join(dest, 'Documents')), 'protected folder check wrong');
    const victim = path.join(dest, 'Documents');
    fs.symlinkSync(path.join(old, 'Users/Bob/Documents/letter.txt'), path.join(victim, 'link.txt'));
    const m = measure(victim);
    const sh = await shredPaths([victim, os.homedir()], () => undefined, () => false);
    assert(sh.erased === m.files && sh.failed.length === 1 && !fs.existsSync(victim), `secure erase left files behind (${sh.erased}/${m.files}, ${sh.failed.length} failed)`);
    assert(fs.readFileSync(path.join(old, 'Users/Bob/Documents/letter.txt'), 'utf8') === 'dear', 'secure erase followed a link');
    const wf = await wipeFreeSpace(dest, () => undefined, () => false, 0, 3 * 1024 * 1024);
    assert(wf.written === 3 * 1024 * 1024 && !fs.readdirSync(dest).some((n) => n.startsWith('mendkit-wipe')), 'free space wipe wrong');
    console.log('secure erase: protected folders, file erase and free space OK');
  }

  {
    const { installedListCommands, installedTools } = await import('../engine/runner');
    const tl = [{ id: 'a', name: 'A', job: '', description: '', license: 'free' as const, packages: { apt: 'smartmontools', winget: 'GIMP.GIMP', brew: 'cask:vlc' } }, { id: 'b', name: 'B', job: '', description: '', license: 'free' as const, packages: { apt: 'htop', winget: 'Other.Tool', brew: 'htop' } }];
    assert(installedTools(tl, 'apt', ['smartmontools installed\nhtop config-files\n']).join() === 'a', 'apt installed list wrong');
    assert(installedTools(tl, 'winget', ['Mozilla.Firefox\nGIMP.GIMP.3\n']).join() === 'a', 'winget installed list wrong');
    assert(installedTools(tl, 'brew', ['htop\nvlc\n', '']).join() === 'b' && installedTools(tl, 'brew', ['', 'vlc\n']).join() === 'a', 'brew installed list wrong');
    assert(installedListCommands('apt').length === 1 && installedListCommands('winget').length === 0, 'installed list commands wrong');
    console.log('tool status: single-listing fast path OK');
  }

  {
    const { friendlyFor } = await import('../engine/runner');
    for (const plat of ['win32', 'darwin', 'linux']) {
      const cmds = JSON.parse(fs.readFileSync(path.join(defs, `commands.${plat}.json`), 'utf8')) as any[];
      const ac = cmds.find((c) => c.id === 'active-connection');
      assert(!!ac, `active-connection missing on ${plat}`);
      const say = (out: string) => friendlyFor(ac, 'ok', out);
      assert(say('CONN_WIRED Ethernet LINK 1 Gbps\r\n').level === 'good' && /cable \(Ethernet\) at 1 Gbps\./.test(say('CONN_WIRED Ethernet LINK 1 Gbps\r\n').message), 'wired connection not reported');
      assert(say('CONN_WIRED Ethernet LINK 10 Mbps').level === 'attention' && say('CONN_WIRED Ethernet LINK 100 Mbps').level === 'good', 'slow cable link not flagged');
      assert(say('CONN_WIFI Wi-Fi\n    Signal                 : 35%\n').level === 'attention' && say('CONN_WIFI Wi-Fi\n    Signal                 : 88%\n').level === 'good', 'Wi-Fi signal not graded');
      assert(say('CONN_WIFI wlan0').level === 'good' && say('CONN_NONE').level === 'problem' && say('CONN_OTHER tun0').level === 'info', 'connection kinds not graded');
      const wr = cmds.find((c) => c.id === 'wifi-restart');
      assert(friendlyFor(wr, 'ok', 'NO_WIFI_ADAPTER').level === 'attention', `wifi-restart on ${plat} fails without a Wi-Fi adapter`);
    }
    const nc = (JSON.parse(fs.readFileSync(path.join(defs, 'recipes.json'), 'utf8')) as any[]).find((x) => x.id === 'network-check');
    assert(Object.values(nc.steps).every((st: any) => st.some((x: any) => x.command === 'active-connection') && !st.some((x: any) => x.command === 'wifi-signal')), 'network check still tests Wi-Fi only');
    console.log('network check: tests the active connection (cable or Wi-Fi) OK');
  }

  {
    const { isNewer, latestFileName, parseLatest } = await import('../engine/update');
    const yml = "version: 0.18.0\nfiles:\n  - url: MendKit-Setup-0.18.0.exe\n    sha512: abc==\n    size: 90000000\npath: MendKit-Setup-0.18.0.exe\nsha512: abc==\nreleaseDate: '2026-11-20T10:00:00.000Z'\n";
    const li = parseLatest(yml);
    assert(li?.version === '0.18.0' && li.path === 'MendKit-Setup-0.18.0.exe' && li.releaseDate === '2026-11-20T10:00:00.000Z', 'latest.yml not parsed');
    assert(parseLatest('<html>Not found</html>') === null && parseLatest('version: 1.0.0\npath: ../evil.exe') === null && parseLatest('version: 1.0.0\npath: https://elsewhere/x.exe') === null, 'bad update files were accepted');
    assert(isNewer('0.18.0', '0.17.0') && isNewer('0.17.1', '0.17.0') && isNewer('1.0.0', '0.99.9') && !isNewer('0.17.0', '0.17.0') && !isNewer('0.9.0', '0.17.0') && isNewer('0.17.0', '0.17.0-beta'), 'version compare wrong');
    assert(latestFileName('win32') === 'latest.yml' && latestFileName('linux') === 'latest-linux.yml' && latestFileName('darwin') === 'latest-mac.yml', 'latest file names wrong');
    const pkg = JSON.parse(fs.readFileSync(path.join(defs, '..', 'package.json'), 'utf8'));
    const feedUrl = JSON.parse(fs.readFileSync(path.join(defs, 'update.json'), 'utf8')).url;
    assert(/^https:\/\/[^/]+$/.test(feedUrl) && pkg.build.publish[0].url === feedUrl && pkg.dependencies['electron-updater'], 'update feed not configured');
    console.log('self-update: feed, version compare and latest file parsing OK');
  }

  {
    const { parseWingetManifest, splitArgs, offlineInstallCommand, offlineSupport, cacheable } = await import('../engine/offline');
    const exeMan = `# Created with WinGet\nPackageIdentifier: 7zip.7zip\nPackageVersion: 24.09\nPackageName: 7-Zip\nInstallerType: exe\nInstallers:\n- Architecture: x64\n  InstallerUrl: https://www.7-zip.org/a/7z2409-x64.exe\n  InstallerSha256: AB12CD\n  InstallerSwitches:\n    Silent: /S\n    SilentWithProgress: /S\nManifestType: merged\nManifestVersion: 1.9.0\n`;
    const m1 = parseWingetManifest(exeMan);
    assert(m1.version === '24.09' && m1.installerType === 'exe' && m1.silent === '/S' && m1.sha256 === 'ab12cd', `exe manifest not read: ${JSON.stringify(m1)}`);
    const msiMan = "PackageVersion: '3.1.0'\r\nInstallerType: inno\r\nInstallerSwitches:\r\n  Custom: /MERGETASKS=!runcode\r\nInstallers:\r\n- Architecture: x64\r\n  InstallerType: msi\r\n  Scope: machine\r\n  InstallerSha256: FF00\r\n";
    const m2 = parseWingetManifest(msiMan);
    assert(m2.installerType === 'msi' && m2.scope === 'machine' && m2.custom === '/MERGETASKS=!runcode' && !m2.silent && m2.version === '3.1.0', `installer-level values should win: ${JSON.stringify(m2)}`);
    assert(JSON.stringify(splitArgs('/S /D="C:\\Program Files\\X" -q')) === JSON.stringify(['/S', '/D=C:\\Program Files\\X', '-q']) && splitArgs(undefined).length === 0, 'switches not split');
    const tool = { id: 'demo', name: 'Demo', job: '', description: '', license: 'free' as const, packages: { winget: 'Demo.Demo' } };
    const base = { tool: 'demo', wingetId: 'Demo.Demo', version: '1.0', size: 1, sha256: 'x', downloaded: '' };
    const msi = offlineInstallCommand(tool, { ...base, file: 'demo.msi', installerType: 'msi', scope: 'machine' }, 'C:\\cache\\demo');
    assert(msi.exec === 'msiexec.exe' && msi.args[0] === '/i' && msi.args.includes('/quiet') && msi.admin && msi.okExitCodes!.includes(3010), 'msi offline command wrong');
    const inno = offlineInstallCommand(tool, { ...base, file: 'demo.exe', installerType: 'inno', custom: '/MERGETASKS=!runcode' }, '/c');
    assert(inno.exec.endsWith('demo.exe') && inno.args.includes('/VERYSILENT') && inno.args.includes('/MERGETASKS=!runcode'), 'inno offline command wrong');
    const appx = offlineInstallCommand(tool, { ...base, file: "it's.msix", installerType: 'msix' }, '/c');
    assert(appx.exec === 'powershell.exe' && appx.args[4].includes("it''s.msix") && !appx.admin, 'msix offline command wrong');
    assert(offlineSupport({ installerType: 'exe' }) === 'unsupported' && offlineSupport({ installerType: 'exe', silent: '/S' }) === 'install' && offlineSupport({ installerType: 'portable' }) === 'portable' && offlineSupport({ installerType: 'zip' }) === 'portable', 'offline support wrong');
    let threw = false;
    try {
      offlineInstallCommand(tool, { ...base, file: 'x.zip', installerType: 'zip' }, '/c');
    } catch {
      threw = true;
    }
    assert(threw, 'a zip should not get a silent install command');
    assert(cacheable('7zip.7zip') && !cacheable('9NBLGGH4NNS1') && !cacheable(undefined), 'store apps should not be cacheable');
    console.log('offline cache: manifest reading, silent switches and install commands OK');
  }

  console.log(`Smoke test passed. Log: ${summary.logFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
