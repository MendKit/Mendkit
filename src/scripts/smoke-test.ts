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
import * as browsers from '../engine/browsers';
import * as recover from '../engine/recover';
import { cpuLikelySupported, upgradePlan, UpgradeFacts } from '../engine/upgrade';
import * as phone from '../engine/phone';
import { addSnapshot, HealthSnapshot, healthTrends, slopePerDay } from '../engine/history';
import { compareSpeed, speedScore } from '../engine/speed';

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
  assert(windowsEol(26100, '24H2', 'Professional').ends === '2026-10-13' && windowsEol(26100, '24h2', 'Enterprise').ends === '2027-10-12' && windowsEol(26300, '26H2', 'Core').ends === null && windowsEol(19045).esuEnds === '2027-10-12', 'Windows 11 version support dates wrong');
  assert(eolState(windowsEol(26100, '24H2', 'Core'), new Date('2026-11-14')) === 'ended' && eolState(windowsEol(26200, '25H2', 'Core'), new Date('2026-11-14')) === 'ok' && eolState(windowsEol(26200, '25H2', 'Core'), new Date('2027-06-01')) === 'soon', 'Windows 11 end of support state wrong');
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
    const { isNewer, latestFileName, parseLatest, installerFor } = await import('../engine/update');
    const mac = parseLatest('version: 0.19.0\nfiles:\n  - url: MendKit-0.19.0-arm64.dmg\n    sha512: x\n  - url: MendKit-0.19.0-x64.dmg\n    sha512: y\npath: MendKit-0.19.0-arm64.dmg\n')!;
    assert(installerFor(mac, 'x64') === 'MendKit-0.19.0-x64.dmg' && installerFor(mac, 'arm64') === 'MendKit-0.19.0-arm64.dmg' && installerFor({ ...mac, files: [] }, 'x64') === mac.path, 'installer for this processor wrong');
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

  {
    // Browser cleanup against a made-up Chrome and Firefox profile.
    const b = browsers;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-browsers-'));
    const roots = b.browserRoots('linux', tmp, {});
    const chrome = roots.find((r) => r.browser === 'Google Chrome')!;
    const prof = path.join(chrome.root, 'Default');
    const bad = 'abcdefghijklmnopabcdefghijklmnop';
    const good = 'cjpalhdlnbpafiamejdnhcphjbkeiagm';
    for (const [id, name, ver] of [[bad, '__MSG_appName__', '1.0'], [good, 'uBlock Origin', '2.0']]) {
      const d = path.join(prof, 'Extensions', id, ver);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify({ name, default_locale: 'en' }));
      if (id === bad) {
        fs.mkdirSync(path.join(d, '_locales', 'en'), { recursive: true });
        fs.writeFileSync(path.join(d, '_locales', 'en', 'messages.json'), JSON.stringify({ appname: { message: 'Super Search Helper' } }));
      }
    }
    fs.writeFileSync(path.join(prof, 'Preferences'), JSON.stringify({
      profile: { name: 'Person 1', content_settings: { exceptions: { notifications: { 'https://spam.example:443,*': { setting: 1 }, 'https://mail.example:443,*': { setting: 2 } } } } },
      extensions: { settings: { [bad]: { location: 4, state: 1 }, [good]: { location: 1, from_webstore: true, state: 1 }, mhjfbmdgcfjbbpaeojofohoefgiehjai: { location: 5 } }, pinned_extensions: [bad, good] },
      homepage: 'http://search.example/', homepage_is_newtabpage: false, session: { restore_on_startup: 4, startup_urls: ['http://search.example/'] },
    }));
    fs.writeFileSync(path.join(prof, 'Secure Preferences'), JSON.stringify({ protection: { macs: { extensions: { settings: { [bad]: 'X', [good]: 'Y' } } } } }));
    fs.mkdirSync(path.join(chrome.root, 'System Profile'), { recursive: true });
    fs.writeFileSync(path.join(chrome.root, 'System Profile', 'Preferences'), '{}');
    const dirs = b.listProfileDirs(chrome);
    assert(dirs.length === 1 && dirs[0] === prof, 'browser profile discovery wrong');
    const cp = b.readChromiumProfile(prof, 'Google Chrome', new Set());
    assert(cp.extensions.length === 2 && cp.extensions.some((e) => e.name === 'Super Search Helper' && e.sideloaded) && cp.extensions.some((e) => e.name === 'uBlock Origin' && e.fromStore && !e.sideloaded), `chromium extensions wrong: ${JSON.stringify(cp.extensions)}`);
    assert(cp.notifications.length === 1 && cp.notifications[0] === 'https://spam.example' && cp.homepage === 'http://search.example/' && cp.startupPages.length === 1, 'chromium settings wrong');
    const bk = b.backupFile(path.join(prof, 'Preferences'), path.join(tmp, 'backup'));
    assert(!!bk && fs.existsSync(bk), 'preferences backup missing');
    b.removeChromiumExtensions(prof, [bad]);
    assert(b.removeChromiumNotifications(prof) === 1, 'notification removal count wrong');
    const after = b.readChromiumProfile(prof, 'Google Chrome');
    const sec = JSON.parse(fs.readFileSync(path.join(prof, 'Secure Preferences'), 'utf8'));
    const pref = JSON.parse(fs.readFileSync(path.join(prof, 'Preferences'), 'utf8'));
    assert(after.extensions.length === 1 && after.notifications.length === 0 && !fs.existsSync(path.join(prof, 'Extensions', bad)) && !(bad in sec.protection.macs.extensions.settings) && 'Y' === sec.protection.macs.extensions.settings[good] && pref.extensions.pinned_extensions.join() === good, 'chromium removal wrong');
    assert('https://mail.example:443,*' in pref.profile.content_settings.exceptions.notifications, 'blocked notification entry should stay');

    const ff = path.join(roots.find((r) => r.browser === 'Firefox')!.root, 'ab12cd34.default-release');
    fs.mkdirSync(path.join(ff, 'extensions'), { recursive: true });
    fs.writeFileSync(path.join(ff, 'prefs.js'), 'user_pref("browser.startup.homepage", "http://search.example/");\n');
    fs.writeFileSync(path.join(ff, 'extensions', 'bad@example.xpi'), 'x');
    fs.writeFileSync(path.join(ff, 'extensions.json'), JSON.stringify({ addons: [{ id: 'bad@example', type: 'extension', location: 'app-profile', active: true, foreignInstall: true, defaultLocale: { name: 'Bad Toolbar' } }, { id: 'formautofill@mozilla.org', type: 'extension', location: 'app-builtin', active: true }] }));
    const fp = b.readFirefoxProfile(ff, 'Firefox');
    assert(fp.name === 'default-release' && fp.extensions.length === 1 && fp.extensions[0].sideloaded && fp.homepage === 'http://search.example/', `firefox profile wrong: ${JSON.stringify(fp)}`);
    b.removeFirefoxExtensions(ff, ['bad@example']);
    assert(!fs.existsSync(path.join(ff, 'extensions', 'bad@example.xpi')), 'firefox extension not removed');

    const reg = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Google\\Chrome\r\n    HomepageLocation    REG_SZ    http://search.example/\r\n\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Policies\\Google\\Chrome\\ExtensionInstallForcelist\r\n    1    REG_SZ    ' + bad + ';https://clients2.google.com/service/update2/crx\r\n';
    const ext = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Google\\Chrome\\Extensions\\' + bad + '\r\n    update_url    REG_SZ    https://clients2.google.com/service/update2/crx\r\n';
    const fo = b.forcesFromRegistry('HKLM', reg, ext);
    const pol = fo.find((x) => x.kind === 'policy');
    assert(fo.length === 2 && !!pol && pol.admin && pol.extensionIds.includes(bad) && pol.location === 'HKLM\\SOFTWARE\\Policies\\Google\\Chrome' && fo.some((x) => x.kind === 'external' && x.extensionIds[0] === bad), `registry policy parsing wrong: ${JSON.stringify(fo)}`);
    const concerns = b.policyConcerns(pol!.settings);
    assert(concerns.some((c) => /home page/.test(c)) && concerns.some((c) => /Forces extensions/.test(c)), `policy concerns wrong: ${concerns}`);
    assert(b.readChromiumProfile(prof, 'Google Chrome', new Set([good])).extensions[0].forced, 'forced flag not applied');
    assert(b.browserProcesses('Firefox (Snap)', 'linux').includes('firefox') && b.resetPage('Microsoft Edge').startsWith('edge://'), 'browser process names wrong');
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('browser cleanup: profiles, extensions, notifications, policies OK');
  }

  {
    // Recover deleted files: command line, volume lists, the same-drive guard, and a real PhotoRec run on a disk image when the tools are here.
    const r = recover;
    const a = r.photorecArgs('/dev/sdb1', '/media/usb/Recovered', ['photos', 'documents'], false);
    assert(a[0] === '/log' && a[2] === path.join('/media/usb/Recovered', 'recup_dir') && a[4] === '/dev/sdb1' && /^partition_none,options,keep_corrupted_file_no,fileopt,everything,disable,jpg,enable,.*pdf,enable.*,freespace,search$/.test(a[5]), `photorec args wrong: ${a}`);
    assert(r.photorecArgs('\\\\.\\PhysicalDrive1', 'D:\\R', ['photos'], false, '2')[5].startsWith('2,options,'), 'partition number not passed to PhotoRec');
    assert(/,wholespace,search$/.test(r.photorecArgs('/dev/sdb1', '/x', ['everything'], true)[5]) && !r.photorecArgs('/dev/sdb1', '/x', ['everything'], true)[5].includes('fileopt'), 'whole-drive args wrong');
    // Names PhotoRec 7.1 rejects stop the whole scan, so none may slip in.
    const ok71 = new Set('jpg png gif bmp tif raw psd pdf doc zip txt mov mp3 mkv riff flac ogg asf mpg m2ts orf pst sqlite'.split(' '));
    assert(r.RECOVER_GROUPS.every((g) => g.families.every((f) => ok71.has(f))), 'a PhotoRec family name is not accepted by PhotoRec 7.1');
    const lsblk = JSON.stringify({ blockdevices: [
      { name: 'nvme0n1', path: '/dev/nvme0n1', type: 'disk', rm: false, hotplug: false, rota: false, tran: 'nvme', children: [
        { name: 'nvme0n1p1', path: '/dev/nvme0n1p1', type: 'part', fstype: 'vfat', mountpoint: '/boot/efi', size: 500000000 },
        { name: 'nvme0n1p2', path: '/dev/nvme0n1p2', type: 'part', fstype: 'ext4', mountpoint: '/', size: 500000000000 },
        { name: 'nvme0n1p3', path: '/dev/nvme0n1p3', type: 'part', fstype: 'swap', size: 1 }] },
      { name: 'sdb', path: '/dev/sdb', type: 'disk', rm: true, hotplug: true, rota: false, tran: 'usb', children: [{ name: 'sdb1', path: '/dev/sdb1', type: 'part', fstype: 'exfat', label: 'CARD', mountpoint: '/media/me/CARD', size: 64000000000 }] },
      { name: 'sdc', path: '/dev/sdc', type: 'disk', rm: '1', fstype: 'vfat', size: 8000000000 }] });
    const lv = r.linuxVolumes(lsblk);
    assert(lv.length === 4 && lv.find((v) => v.device === '/dev/nvme0n1p2')!.internalSsd && lv.find((v) => v.device === '/dev/nvme0n1p2')!.system && lv.find((v) => v.device === '/dev/sdb1')!.removable && !lv.find((v) => v.device === '/dev/sdb1')!.internalSsd && lv.some((v) => v.device === '/dev/sdc'), `linux volumes wrong: ${JSON.stringify(lv)}`);
    const wv = r.windowsVolumes(JSON.stringify([{ letter: 'C', fs: 'NTFS', size: 1, driveType: 'Fixed', bus: 'NVMe', media: 'SSD', disk: 0, part: 3, offset: 1048576 }, { letter: 'E', label: 'SD', fs: 'exFAT', size: 2, driveType: 'Removable', bus: 'SD', disk: 1, part: 1, offset: 0 }, { letter: 'Z', fs: 'NTFS' }]));
    assert(wv.length === 2 && wv[0].device === '\\\\.\\PhysicalDrive0' && wv[0].partition === '3' && wv[1].partition === 'partition_none' && wv[0].system && wv[0].internalSsd && wv[1].removable && wv[1].mount === 'E:\\', `windows volumes wrong: ${JSON.stringify(wv)}`);
    const mv = r.macVolumes(JSON.stringify({ AllDisksAndPartitions: [{ DeviceIdentifier: 'disk4', Content: 'GUID_partition_scheme', Partitions: [{ DeviceIdentifier: 'disk4s1', Content: 'EFI', VolumeName: 'EFI' }, { DeviceIdentifier: 'disk4s2', Content: 'Microsoft Basic Data', VolumeName: 'USB', MountPoint: '/Volumes/USB', Size: 3 }] }, { DeviceIdentifier: 'disk5', Content: 'DOS_FAT_32', VolumeName: 'CARD', Size: 4 }] }));
    assert(mv.length === 2 && mv[0].device === '/dev/rdisk4s2' && mv[1].device === '/dev/rdisk5', `mac volumes wrong: ${JSON.stringify(mv)}`);
    assert(r.sameVolume('E:\\Saved', wv[1], 'win32') && !r.sameVolume('D:\\Saved', wv[1], 'win32'), 'windows same-drive check wrong');
    assert(r.sameVolume('/media/me/CARD/x', lv.find((v) => v.device === '/dev/sdb1')!, 'linux', '/dev/sdb1') && !r.sameVolume('/home/me', lv.find((v) => v.device === '/dev/sdb1')!, 'linux', '/dev/nvme0n1p2') && r.sameVolume('/Volumes/USB/x', mv[0], 'darwin', '/dev/disk4s2'), 'same-drive check wrong');
    const fake = new Set(['L/Microsoft/WinGet/Packages/CGSecurity.TestDisk_X/testdisk-7.2/photorec_win.exe']);
    const found = r.findPhotorec('win32', { LOCALAPPDATA: 'L' }, (p) => fake.has(p.split(path.sep).join('/')), (d) => (d.split(path.sep).join('/') === 'L/Microsoft/WinGet/Packages' ? ['CGSecurity.TestDisk_X', 'Other'] : ['testdisk-7.2']));
    assert(!!found && found.endsWith('photorec_win.exe'), `photorec not found in the winget folder: ${found}`);
    const tools = ['photorec', 'mkfs.vfat', 'mcopy', 'mdel'].map((t) => r.findPhotorec('linux', { PATH: `${process.env.PATH}:/usr/sbin:/sbin` }, (p) => fs.existsSync(p.replace(/photorec$/, t))));
    if (process.platform === 'linux' && tools.every(Boolean)) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-recover-'));
      const img = path.join(tmp, 'card.img');
      fs.writeFileSync(img, Buffer.alloc(16 * 1024 * 1024));
      const sh = (c: string) => require('child_process').execSync(c, { stdio: 'pipe' }).toString();
      sh(`mkfs.vfat ${img}`);
      // A real photo and a small PDF, copied on and then deleted.
      const pdf = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n';
      fs.copyFileSync(path.join(__dirname, '..', '..', 'test', 'fixtures', 'photo.jpg'), path.join(tmp, 'photo.jpg'));
      fs.writeFileSync(path.join(tmp, 'letter.pdf'), pdf);
      sh(`mcopy -i ${img} ${path.join(tmp, 'photo.jpg')} ::/photo.jpg && mcopy -i ${img} ${path.join(tmp, 'letter.pdf')} ::/letter.pdf && mdel -i ${img} ::/photo.jpg ::/letter.pdf`);
      const out = path.join(tmp, 'out');
      fs.mkdirSync(out);
      const args = r.photorecArgs(img, out, ['photos', 'documents'], false);
      require('child_process').spawnSync(found && tools[0]!, args, { cwd: out, env: { ...process.env, TERM: 'dumb' }, stdio: 'ignore', timeout: 120000 });
      const n = r.countRecovered(out);
      const sorted = r.sortRecovered(out);
      assert(n >= 2 && (sorted.Photos ?? 0) >= 1 && (sorted.Documents ?? 0) + (sorted.Photos ?? 0) === n && !fs.readdirSync(out).some((d) => /^recup_dir/.test(d)), `photorec run wrong: ${n} found, sorted ${JSON.stringify(sorted)}`);
      console.log(`recover: PhotoRec found ${n} deleted file(s) on a disk image and sorted them (${JSON.stringify(sorted)})`);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    console.log('recover: command line, volumes, same-drive guard and PhotoRec location OK');
  }

  {
    // Windows 11 upgrade assistant.
    const cpus: [string, string][] = [
      ['Intel(R) Core(TM) i5-8250U CPU @ 1.60GHz', 'yes'], ['Intel(R) Core(TM) i7-7700HQ CPU @ 2.80GHz', 'unsure'], ['Intel(R) Core(TM) i5-4590 CPU @ 3.30GHz', 'no'],
      ['12th Gen Intel(R) Core(TM) i7-12700H', 'yes'], ['Intel(R) Core(TM) Ultra 7 155H', 'yes'], ['Intel(R) Core(TM) i3-10110U CPU', 'yes'], ['Intel(R) Core(TM) m3-8100Y', 'yes'],
      ['Intel(R) Pentium(R) Silver N5000 CPU', 'yes'], ['Intel(R) Celeron(R) N4020 CPU', 'yes'], ['Intel(R) Celeron(R) CPU N3060', 'no'], ['Intel(R) Celeron(R) CPU  N3350', 'no'], ['Intel(R) N100', 'yes'],
      ['Intel(R) Core(TM)2 Duo CPU E8400', 'no'], ['Intel(R) Atom(TM) x5-Z8350', 'no'],
      ['AMD Ryzen 5 3600 6-Core Processor', 'yes'], ['AMD Ryzen 5 2600 Six-Core Processor', 'yes'], ['AMD Ryzen 5 2400G with Radeon Vega Graphics', 'no'], ['AMD Ryzen 5 2500U with Radeon Vega Mobile Gfx', 'unsure'],
      ['AMD Ryzen 7 1700 Eight-Core Processor', 'no'], ['AMD Ryzen 7 PRO 4750U', 'yes'], ['AMD Athlon Silver 3050U', 'yes'], ['AMD A6-9225 RADEON R4', 'no'], ['AMD FX-8350 Eight-Core Processor', 'no'],
    ];
    const wrongCpu = cpus.filter(([n, want]) => cpuLikelySupported(n) !== want).map(([n, want]) => `${n}: ${cpuLikelySupported(n)} not ${want}`);
    assert(!wrongCpu.length, `processor list wrong: ${wrongCpu.join('; ')}`);
    const base: UpgradeFacts = { admin: true, product: 'Windows 10 Pro', edition: 'Professional', version: '22H2', build: 19045, arch: 'AMD64', cpu: 'Intel(R) Core(TM) i5-8250U CPU', cores: 4, ramGb: 8, tpm: { version: '2.0', enabled: true, activated: true }, secureBoot: true, firmware: 2, partitionStyle: 'GPT', diskGb: 256, freeGb: 80, bitlocker: 'Off', activated: true, verdicts: [], bypass: null };
    assert(upgradePlan(base).state === 'ready', 'a ready computer was not ready');
    assert(upgradePlan({ ...base, build: 26100 }).state === 'already', 'Windows 11 not recognised');
    const legacy = upgradePlan({ ...base, firmware: 1, secureBoot: 'unsupported', partitionStyle: 'MBR' });
    assert(legacy.state === 'fixable' && legacy.checks.find((c) => c.id === 'uefi')!.fix === 'mbr2gpt', 'legacy BIOS on MBR should offer the GPT conversion');
    const noTpm = upgradePlan({ ...base, tpm: { version: 'none', enabled: false, activated: false } });
    assert(noTpm.state === 'fixable' && noTpm.checks.find((c) => c.id === 'tpm')!.fix === 'firmware-tpm', 'a turned-off TPM on a supported processor should be fixable');
    const old = upgradePlan({ ...base, cpu: 'Intel(R) Core(TM) i5-4590 CPU', tpm: { version: '1.2', enabled: true, activated: true } });
    assert(old.state === 'unsupported' && old.bypassPossible, 'an old processor with TPM 1.2 should be unsupported, with the registry option');
    const oldNoTpm = upgradePlan({ ...base, cpu: 'Intel(R) Core(TM) i5-4590 CPU', tpm: { version: 'none', enabled: false, activated: false } });
    assert(oldNoTpm.state === 'unsupported' && !oldNoTpm.bypassPossible, 'no TPM at all rules out the registry option');
    const red = upgradePlan({ ...base, cpu: 'Intel(R) Core(TM) i7-7700HQ CPU', verdicts: [{ target: 'GE25H2', upgEx: 'Red', red: 'CpuFms', gated: '', date: '' }, { target: 'GE24H2', upgEx: 'Green', red: '', gated: '', date: '' }] });
    assert(red.state === 'unsupported' && /not on Microsoft/.test(red.checks.find((c) => c.id === 'cpu')!.message) && /Windows 11 25H2/.test(red.checks[0].message), 'Windows\' own verdict should decide the processor');
    const green7 = upgradePlan({ ...base, cpu: 'Intel(R) Core(TM) i7-7820HQ CPU', verdicts: [{ target: 'GE25H2', upgEx: 'Green', red: '', gated: '', date: '' }] });
    assert(green7.state === 'ready', 'a green verdict should clear an unsure processor');
    assert(upgradePlan({ ...base, freeGb: 12 }).checks.find((c) => c.id === 'free')!.fix === 'space' && upgradePlan({ ...base, arch: 'x86' }).state === 'unsupported', 'space or 32-bit check wrong');
    console.log('Windows 11 upgrade: processor list, readiness, fixes and Windows\' own verdict OK');
  }

  {
    // Phone helpers: backup details from property lists, phones opened as folders, and the copy plan.
    const fx = path.join(__dirname, '..', '..', 'test', 'fixtures');
    const man = phone.parseBinaryPlist(fs.readFileSync(path.join(fx, 'Manifest.plist')));
    assert(man.IsEncrypted === true && man.Lockdown.DeviceName === 'Nerd\u2019s iPhone' && man.Sizes[2] === 300000 && man.Date instanceof Date && man.Date.toISOString() === '2026-10-01T12:00:00.000Z' && man.Data.length === 2, `binary plist wrong: ${JSON.stringify(man)}`);
    const info = phone.parseXmlPlist(fs.readFileSync(path.join(fx, 'Info.plist'), 'utf8'));
    assert(info['Device Name'] === 'Kitchen iPad' && info['Last Backup Date'].toISOString() === '2026-09-30T18:05:00.000Z' && info.Applications['com.x'].a === 1 && info.Empty === '', `xml plist wrong: ${JSON.stringify(info)}`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-phone-'));
    const bdir = path.join(tmp, 'Backup', '00008110-001A2B3C4D5E');
    fs.mkdirSync(bdir, { recursive: true });
    fs.copyFileSync(path.join(fx, 'Info.plist'), path.join(bdir, 'Info.plist'));
    fs.copyFileSync(path.join(fx, 'Manifest.plist'), path.join(bdir, 'Manifest.plist'));
    fs.mkdirSync(path.join(tmp, 'Backup', 'not-a-backup'));
    const bl = phone.listIosBackups([path.join(tmp, 'Backup'), path.join(tmp, 'missing')]);
    assert(bl.length === 1 && bl[0].name === 'Kitchen iPad' && bl[0].model === 'iPad (iPad13,18)' && bl[0].encrypted === true && bl[0].ios === '17.5.1', `backup list wrong: ${JSON.stringify(bl)}`);
    assert(phone.iosBackupDirs('win32', 'C:\\Users\\me', { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }).length === 2, 'Windows backup folders wrong');

    const gv = path.join(tmp, 'gvfs');
    const dcim = path.join(gv, 'mtp:host=SAMSUNG_SAMSUNG_Android_R58N12345AB', 'Internal shared storage', 'DCIM', 'Camera');
    fs.mkdirSync(dcim, { recursive: true });
    fs.mkdirSync(path.join(gv, 'mtp:host=SAMSUNG_SAMSUNG_Android_R58N12345AB', 'Internal shared storage', 'Android', 'data', 'DCIM'), { recursive: true });
    fs.mkdirSync(path.join(gv, 'gphoto2:host=Apple_Inc._iPhone_00008110001A2B3C4D5E', 'DCIM', '100APPLE'), { recursive: true });
    fs.mkdirSync(path.join(gv, 'smb-share:server=nas,share=photos'), { recursive: true });
    const when = new Date('2026-07-04T12:00:00').getTime() / 1000;
    for (const [n, size] of [['IMG_0001.jpg', 10], ['IMG_0002.jpg', 20], ['VID_0003.mp4', 30], ['notes.txt', 5], ['IMG_0001.jpg.aae', 1]] as [string, number][]) {
      fs.writeFileSync(path.join(dcim, n), Buffer.alloc(size));
      fs.utimesSync(path.join(dcim, n), when, when);
    }
    const ph = phone.gvfsPhones(gv);
    assert(ph.length === 2 && ph.find((p) => p.kind === 'android')!.folders.length === 1 && ph.find((p) => p.kind === 'iphone') && ph.find((p) => p.kind === 'android')!.name === 'SAMSUNG Android' && ph.find((p) => p.kind === 'iphone')!.name === 'Apple Inc. iPhone', `gvfs phones wrong: ${JSON.stringify(ph)}`);
    const android = ph.find((p) => p.kind === 'android')!;
    const media = phone.listMedia(android.root, android.folders);
    assert(media.length === 3, `media list wrong: ${JSON.stringify(media)}`);
    const dest = path.join(tmp, 'Photos');
    fs.mkdirSync(path.join(dest, '2026-07'), { recursive: true });
    fs.writeFileSync(path.join(dest, '2026-07', 'IMG_0001.jpg'), Buffer.alloc(10));
    fs.writeFileSync(path.join(dest, '2026-07', 'IMG_0002.jpg'), Buffer.alloc(99));
    const plan = phone.copyPlan(media, dest);
    assert(plan.length === 2 && plan.some((p) => p.to.endsWith(path.join('2026-07', 'IMG_0002-2.jpg'))) && plan.some((p) => p.to.endsWith(path.join('2026-07', 'VID_0003.mp4'))), `copy plan wrong: ${JSON.stringify(plan)}`);
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('phone helpers: backup details, phones as folders and the copy plan OK');
  }

  {
    // Health history: one snapshot a day, and trend warnings.
    const day = (n: number) => new Date(Date.UTC(2026, 9, 1) + n * 86400000).toISOString();
    const snap = (n: number, o: Partial<HealthSnapshot>): HealthSnapshot => ({ at: day(n), freeGb: 100, freePercent: 40, driveHealthy: true, wear: 10, driveErrors: 0, temperature: 35, batteryPercent: 90, crashes: 0, ...o });
    let h: HealthSnapshot[] = [];
    h = addSnapshot(h, snap(0, {}));
    h = addSnapshot(h, { ...snap(0, { freeGb: 99 }), at: day(0).replace('T00', 'T15') });
    assert(h.length === 1 && h[0].freeGb === 99, 'one snapshot per day not kept');
    assert(slopePerDay([{ at: 0, v: 10 }, { at: 86400000 * 5, v: 5 }, { at: 86400000 * 10, v: 0 }]) === -1 && slopePerDay([{ at: 0, v: 1 }, { at: 1, v: 2 }, { at: 2, v: 3 }]) === null, 'slope wrong');
    const now = Date.UTC(2026, 9, 1) + 30 * 86400000;
    const calm = Array.from({ length: 30 }, (_x, i) => snap(i, { freeGb: 100 - i * 0.01, batteryPercent: 90 - i * 0.02 }));
    assert(healthTrends(calm, now).length === 0, `calm history gave warnings: ${JSON.stringify(healthTrends(calm, now))}`);
    const bad = Array.from({ length: 30 }, (_x, i) => snap(i, { freeGb: 60 - i * 1.5, batteryPercent: 90 - i * 0.2, driveErrors: i > 20 ? 3 : 0, wear: 10 + i * 0.5, crashes: i === 29 ? 4 : 0 }));
    bad[29].driveHealthy = false;
    const ids = healthTrends(bad, now).map((x) => x.id).sort().join(',');
    assert(ids === 'battery,crashes,drive-errors,drive-failing,space,wear', `trend warnings wrong: ${ids}`);
    assert(healthTrends(bad, now).find((x) => x.id === 'space')!.level === 'problem', 'space running out in under two weeks should be a problem');
    console.log('health history: daily snapshots, trends and warnings OK');
  }

  {
    // Old drive: folders the old computer's permissions keep closed are found, and the command opens them.
    const od = require('../engine/olddrive');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-oldperm-'));
    const home = path.join(tmp, 'Users', 'Ann');
    for (const d of ['AppData', 'Documents', 'Pictures']) fs.mkdirSync(path.join(home, d), { recursive: true });
    fs.writeFileSync(path.join(home, 'Documents', 'a.txt'), 'x');
    const prof = { name: 'Ann', home, platform: 'win32', systemRoot: tmp };
    assert(od.lockedFolders(prof).length === 0, 'open folders reported as locked');
    if (process.getuid && process.getuid() !== 0) {
      fs.chmodSync(path.join(home, 'Documents'), 0o000);
      const locked = od.lockedFolders(prof);
      fs.chmodSync(path.join(home, 'Documents'), 0o755);
      assert(locked.length === 1 && locked[0].endsWith('Documents'), `locked folders wrong: ${locked}`);
    }
    const w = od.grantAccessCommand('win32', 'E:\\Users\\Ann O\'Neil', { user: 'tech', uid: 0, sid: 'S-1-5-21-1-2-3-1001' });
    assert(w.admin && w.exec === 'powershell.exe' && w.args[3].includes("'E:\\Users\\Ann O''Neil'") && w.args[3].includes('*S-1-5-21-1-2-3-1001:(OI)(CI)RX') && /takeown/.test(w.args[3]), 'Windows access command wrong');
    assert(/diskutil disableOwnership '\/Volumes\/Old Mac'/.test(od.grantAccessCommand('darwin', '/Volumes/Old Mac/Users/ann', { user: 'tech', uid: 501 }).args[1]), 'Mac access command wrong');
    const l = od.grantAccessCommand('linux', home, { user: 'tech', uid: 1000 });
    assert(l.args[1].includes('setfacl -R -m u:1000:rX'), 'Linux access command wrong');
    if (process.getuid && process.getuid() === 0) {
      fs.chmodSync(path.join(home, 'Documents'), 0o700);
      fs.chownSync(path.join(home, 'Documents'), 4242, 4242);
      require('child_process').execFileSync('sh', ['-c', od.grantAccessCommand('linux', home, { user: 'x', uid: 4343 }).args[1]]);
      const mode = fs.statSync(path.join(home, 'Documents')).mode & 0o7;
      const acl = require('child_process').spawnSync('getfacl', ['-p', path.join(home, 'Documents')], { encoding: 'utf8' }).stdout ?? '';
      assert(/user:4343:r-x/.test(acl) || mode >= 5, `Linux access not given: ${acl} mode ${mode}`);
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('old drive: closed folders found, access commands for each system OK');
  }

  {
    // Speed score: a slow, full, cluttered computer scores low; after a service it scores higher.
    const slow = { at: '', writeMBs: 40, readMBs: null, cpuMs: 1800, memoryUsed: 92, freePercent: 4, startupItems: 28 };
    const fast = { ...slow, writeMBs: 900, memoryUsed: 55, freePercent: 30, startupItems: 6 };
    const a = speedScore(slow).score;
    const b = speedScore(fast).score;
    const cmp = compareSpeed(slow, fast);
    assert(a < 25 && b > 75 && cmp.before === a && cmp.after === b && cmp.lines.length === 4 && speedScore({ at: '', writeMBs: null, readMBs: null, cpuMs: null, memoryUsed: null, freePercent: null, startupItems: null }).score === 0, `speed score wrong: ${a} ${b} ${JSON.stringify(cmp)}`);
    console.log(`speed score: ${a} before, ${b} after OK`);
  }

  {
    // Search everything: everyday words find the fixes for that problem.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const S = require(path.join(__dirname, '..', '..', 'renderer', 'search.js'));
    const defs = path.join(__dirname, '..', '..', 'definitions');
    const read = (f: string) => JSON.parse(fs.readFileSync(path.join(defs, f), 'utf8'));
    const items: any[] = [];
    for (const x of [].concat(read('symptoms.json').symptoms ?? read('symptoms.json'))) items.push({ kind: 'fix', title: (x as any).label, text: (x as any).description, weight: 6 });
    for (const f of ['commands.win32.json', 'commands.darwin.json', 'commands.linux.json']) for (const c of [].concat(read(f).commands ?? read(f))) items.push({ kind: 'step', title: (c as any).name, text: (c as any).description, weight: 1 });
    items.push({ kind: 'tool', title: 'Browser cleanup', text: 'Pop-ups, a changed home page or search engine, or toolbars nobody installed', weight: 5 });
    const P = items.map(S.prepare);
    const top = (q: string) => S.search(P, q)[0]?.title;
    const all = (q: string) => S.search(P, q).map((x: any) => x.title);
    assert(/Printer/.test(top('printer')) && /Printer/.test(top("printer won't print")) && all('printing').some((t: string) => /print queue/i.test(t)), `printer search wrong: ${all('printer').slice(0, 5)}`);
    assert(/Pop-ups/.test(top('pop-ups')) && /Pop-ups/.test(top('popups')) && all('pop ups').includes('Browser cleanup') && all('adware').includes('Browser cleanup'), `pop-up search wrong: ${all('pop-ups').slice(0, 5)}`);
    assert(/Wi-Fi/.test(top('wifi')) && /sound/i.test(top('no sound')) && /slow/i.test(top('my computer is slow')) && S.search(P, 'zzzz').length === 0, 'everyday searches wrong');
    console.log('search: printer, pop-ups, wifi, sound and slow find their fixes OK');
  }

  {
    const { probeNewest } = require('../engine/publisher');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-'));
    const fake = async (u: string) => ({ ok: /hwi64_858/.test(u), status: /hwi64_858/.test(u) ? 200 : 404, text: async () => '', arrayBuffer: async () => new ArrayBuffer(4) });
    const got = await probeNewest(fake, 'https://x/files/', { prefix: 'hwi64_' }, 854, dir, () => {});
    if (got !== 'hwi64_858.exe') throw new Error(`publisher probe found ${got}`);
    console.log('publisher probe: finds the newer installer after the one winget lists OK');
  }
  {
    const { parseWingetUpgrade, parseBrewOutdated, appUpdateCommands } = require('../engine/appupdates');
    const out = [
      '   - \r   \\ \rName                         Id                          Version      Available    Source',
      '------------------------------------------------------------------------------------------------',
      'Mozilla Firefox (x64 en-US)  Mozilla.Firefox             131.0        132.0.1      winget',
      'Notepad++ (64-bit x64)       Notepad++.Notepad++         8.6.9        8.7          winget',
      'A very long program name that pushes everything along Vendor.LongApp 1.0 2.0 winget',
      '3 upgrades available.',
      '',
      'The following packages have an upgrade available, but require explicit targeting for upgrade:',
      'Name        Id                 Version  Available Source',
      '--------------------------------------------------------',
      'Discord     Discord.Discord    1.0.9    1.0.9170  winget',
    ].join('\r\n');
    const u = parseWingetUpgrade(out);
    const ids = u.map((x: { id: string }) => x.id).join(',');
    if (ids !== 'Mozilla.Firefox,Notepad++.Notepad++,Vendor.LongApp,Discord.Discord') throw new Error(`winget list read as ${ids}`);
    if (u[0].current !== '131.0' || u[0].available !== '132.0.1' || !u[3].explicit || u[0].explicit) throw new Error(`winget versions read wrongly: ${JSON.stringify(u)}`);
    const b = parseBrewOutdated('{"formulae":[{"name":"wget","installed_versions":["1.24"],"current_version":"1.25"}],"casks":[{"name":"firefox","installed_versions":"131","current_version":"132"}]}');
    if (b.map((x: { id: string }) => x.id).join(',') !== 'cask:firefox,formula:wget') throw new Error('brew list read wrongly');
    const cmds = appUpdateCommands('darwin', b);
    if (cmds[0].args.join(' ') !== 'upgrade --cask firefox' || appUpdateCommands('win32', u)[0].args[2] !== 'Mozilla.Firefox') throw new Error('app update commands built wrongly');
    if (appUpdateCommands('win32', [{ id: 'x & calc', name: 'x', current: '', available: '' }]).length) throw new Error('unsafe app id accepted');
    console.log('app updates: lists from winget and Homebrew read, chosen apps update one at a time OK');
  }
  console.log(`Smoke test passed. Log: ${summary.logFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
