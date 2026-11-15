import * as fs from 'fs';
import * as path from 'path';

/**
 * Browser cleanup: finds browser profiles, reads their extensions, notification permissions and start-up
 * settings, and makes the edits. Kept free of Electron so it can be tested against sample profiles.
 * Edits are only made while the browser is closed, and the original files are copied to a backup first.
 */

export type BrowserKind = 'chromium' | 'firefox';
export interface BrowserRoot {
  browser: string;
  kind: BrowserKind;
  root: string;
}
export interface Extension {
  id: string;
  name: string;
  enabled: boolean;
  fromStore: boolean;
  installed: string;
  /** Put there by a policy: removing it here does nothing until the policy is gone. */
  forced: boolean;
  /** Unpacked or side-loaded rather than from a store. */
  sideloaded: boolean;
}
export interface BrowserProfile {
  id: string;
  browser: string;
  kind: BrowserKind;
  dir: string;
  name: string;
  extensions: Extension[];
  notifications: string[];
  homepage: string;
  startupPages: string[];
  search: string;
}

/** Where each browser keeps its profiles on this system. */
export function browserRoots(platform: string, home: string, env: Record<string, string | undefined>): BrowserRoot[] {
  const j = path.join;
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA ?? j(home, 'AppData', 'Local');
    const roaming = env.APPDATA ?? j(home, 'AppData', 'Roaming');
    return [
      { browser: 'Google Chrome', kind: 'chromium', root: j(local, 'Google', 'Chrome', 'User Data') },
      { browser: 'Microsoft Edge', kind: 'chromium', root: j(local, 'Microsoft', 'Edge', 'User Data') },
      { browser: 'Brave', kind: 'chromium', root: j(local, 'BraveSoftware', 'Brave-Browser', 'User Data') },
      { browser: 'Vivaldi', kind: 'chromium', root: j(local, 'Vivaldi', 'User Data') },
      { browser: 'Firefox', kind: 'firefox', root: j(roaming, 'Mozilla', 'Firefox', 'Profiles') },
    ];
  }
  if (platform === 'darwin') {
    const as = j(home, 'Library', 'Application Support');
    return [
      { browser: 'Google Chrome', kind: 'chromium', root: j(as, 'Google', 'Chrome') },
      { browser: 'Microsoft Edge', kind: 'chromium', root: j(as, 'Microsoft Edge') },
      { browser: 'Brave', kind: 'chromium', root: j(as, 'BraveSoftware', 'Brave-Browser') },
      { browser: 'Vivaldi', kind: 'chromium', root: j(as, 'Vivaldi') },
      { browser: 'Firefox', kind: 'firefox', root: j(as, 'Firefox', 'Profiles') },
    ];
  }
  const cfg = env.XDG_CONFIG_HOME ?? j(home, '.config');
  return [
    { browser: 'Google Chrome', kind: 'chromium', root: j(cfg, 'google-chrome') },
    { browser: 'Chromium', kind: 'chromium', root: j(cfg, 'chromium') },
    { browser: 'Chromium (Snap)', kind: 'chromium', root: j(home, 'snap', 'chromium', 'common', 'chromium') },
    { browser: 'Microsoft Edge', kind: 'chromium', root: j(cfg, 'microsoft-edge') },
    { browser: 'Brave', kind: 'chromium', root: j(cfg, 'BraveSoftware', 'Brave-Browser') },
    { browser: 'Vivaldi', kind: 'chromium', root: j(cfg, 'vivaldi') },
    { browser: 'Firefox', kind: 'firefox', root: j(home, '.mozilla', 'firefox') },
    { browser: 'Firefox (Snap)', kind: 'firefox', root: j(home, 'snap', 'firefox', 'common', '.mozilla', 'firefox') },
    { browser: 'Firefox (Flatpak)', kind: 'firefox', root: j(home, '.var', 'app', 'org.mozilla.firefox', '.mozilla', 'firefox') },
  ];
}

const readJson = (f: string): any => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return null;
  }
};
const get = (o: any, p: string): any => p.split('.').reduce((a, k) => (a && typeof a === 'object' ? a[k] : undefined), o);

/** Profile folders under a browser's data folder. */
export function listProfileDirs(r: BrowserRoot): string[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(r.root);
  } catch {
    return [];
  }
  return names
    .map((n) => path.join(r.root, n))
    .filter((d) => fs.existsSync(path.join(d, r.kind === 'chromium' ? 'Preferences' : 'prefs.js')))
    .filter((d) => !/System Profile|Guest Profile/i.test(path.basename(d)));
}

/** An extension's display name, resolving "__MSG_name__" from its locale files. */
function extensionName(extDir: string, id: string, manifest: any): string {
  let m = manifest;
  if (!m) {
    try {
      const v = fs.readdirSync(path.join(extDir, id)).sort().pop();
      if (v) m = readJson(path.join(extDir, id, v, 'manifest.json'));
      if (m) m.__dir = path.join(extDir, id, v!);
    } catch {
      /* no files */
    }
  }
  let name = String(m?.name ?? id);
  const msg = /^__MSG_(.+)__$/.exec(name);
  if (msg && m?.__dir) {
    for (const loc of [m.default_locale, 'en', 'en_US'].filter(Boolean)) {
      const messages = readJson(path.join(m.__dir, '_locales', loc, 'messages.json'));
      const key = messages && Object.keys(messages).find((k) => k.toLowerCase() === msg[1].toLowerCase());
      if (key) {
        name = messages[key].message;
        break;
      }
    }
  }
  return name;
}

/** Chromium install_time is microseconds since 1601. */
const chromeTime = (t: any): string => {
  const n = Number(t);
  return n > 0 ? new Date(n / 1000 - 11644473600000).toISOString() : '';
};

export function readChromiumProfile(dir: string, browser: string, forcedIds: Set<string> = new Set()): BrowserProfile {
  const prefs = readJson(path.join(dir, 'Preferences')) ?? {};
  const secure = readJson(path.join(dir, 'Secure Preferences')) ?? {};
  const settings = { ...(get(prefs, 'extensions.settings') ?? {}), ...(get(secure, 'extensions.settings') ?? {}) };
  const extensions: Extension[] = [];
  for (const [id, s] of Object.entries<any>(settings)) {
    const loc = Number(s?.location);
    // 5 and 10 are the browser's own built-in components.
    if (loc === 5 || loc === 10 || s?.manifest?.theme || /^(Chrome Web Store Payments|Web Store)$/i.test(s?.manifest?.name ?? '')) continue;
    if (!fs.existsSync(path.join(dir, 'Extensions', id)) && !s?.manifest && loc !== 4) continue;
    const disabled = s?.state === 0 || (Array.isArray(s?.disable_reasons) ? s.disable_reasons.length > 0 : Number(s?.disable_reasons) > 0);
    extensions.push({
      id,
      name: extensionName(path.join(dir, 'Extensions'), id, s?.manifest),
      enabled: !disabled,
      fromStore: !!s?.from_webstore || loc === 1,
      installed: chromeTime(s?.first_install_time ?? s?.install_time),
      forced: forcedIds.has(id) || loc === 9 || loc === 7,
      sideloaded: loc === 4 || loc === 8 || (!s?.from_webstore && [2, 3, 6].includes(loc)),
    });
  }
  const notif = get(prefs, 'profile.content_settings.exceptions.notifications') ?? {};
  const notifications = Object.entries<any>(notif)
    .filter(([, v]) => Number(v?.setting) === 1)
    .map(([k]) => k.split(',')[0].replace(/:443$/, ''));
  const startup = Number(get(prefs, 'session.restore_on_startup') ?? get(secure, 'session.restore_on_startup')) === 4 ? get(prefs, 'session.startup_urls') ?? get(secure, 'session.startup_urls') ?? [] : [];
  const search = get(prefs, 'default_search_provider_data.template_url_data') ?? get(secure, 'default_search_provider_data.template_url_data');
  return {
    id: '',
    browser,
    kind: 'chromium',
    dir,
    name: String(get(prefs, 'profile.name') ?? path.basename(dir)),
    extensions: extensions.sort((a, b) => a.name.localeCompare(b.name)),
    notifications,
    homepage: get(prefs, 'homepage_is_newtabpage') === false ? String(get(prefs, 'homepage') ?? '') : '',
    startupPages: Array.isArray(startup) ? startup.map(String) : [],
    search: search ? `${search.short_name ?? ''} ${search.url ? `(${search.url})` : ''}`.trim() : '',
  };
}

export function readFirefoxProfile(dir: string, browser: string, notificationsOf: (dbFile: string) => string[] = () => []): BrowserProfile {
  const ext = readJson(path.join(dir, 'extensions.json'));
  const extensions: Extension[] = (ext?.addons ?? [])
    .filter((a: any) => a.type === 'extension' && ['app-profile', 'app-system-share', 'app-system-local', 'app-global'].includes(a.location))
    .map((a: any) => ({
      id: String(a.id),
      name: String(a.defaultLocale?.name ?? a.id),
      enabled: !!a.active,
      fromStore: a.sourceURI ? /addons\.mozilla\.org|addons\.cdn\.mozilla\.net/.test(String(a.sourceURI)) : false,
      installed: a.installDate ? new Date(Number(a.installDate)).toISOString() : '',
      forced: a.location !== 'app-profile',
      sideloaded: a.location !== 'app-profile' || a.foreignInstall === true,
    }));
  let prefs = '';
  try {
    prefs = fs.readFileSync(path.join(dir, 'prefs.js'), 'utf8');
  } catch {
    /* none */
  }
  const pref = (k: string) => new RegExp(`user_pref\\("${k.replace(/\./g, '\\.')}",\\s*"([^"]*)"\\)`).exec(prefs)?.[1] ?? '';
  const home = pref('browser.startup.homepage');
  return {
    id: '',
    browser,
    kind: 'firefox',
    dir,
    name: path.basename(dir).replace(/^[a-z0-9]{8}\./, ''),
    extensions: extensions.sort((a, b) => a.name.localeCompare(b.name)),
    notifications: notificationsOf(path.join(dir, 'permissions.sqlite')),
    homepage: home && !/^about:(home|newtab|blank)$/.test(home) ? home.split('|').join(', ') : '',
    startupPages: [],
    search: '',
  };
}

/** Copies a file into the backup folder before it is edited, keeping its path recognisable. */
export function backupFile(file: string, backupDir: string): string | null {
  if (!fs.existsSync(file)) return null;
  fs.mkdirSync(backupDir, { recursive: true });
  const to = path.join(backupDir, `${path.basename(path.dirname(file))}-${path.basename(file)}`.replace(/[^\w.-]+/g, '_'));
  fs.copyFileSync(file, to);
  return to;
}

/**
 * Removes Chromium extensions: their entries in Preferences and Secure Preferences (with the matching
 * integrity entries, so the browser does not treat the change as tampering) and their files.
 */
export function removeChromiumExtensions(dir: string, ids: string[]): string[] {
  const done: string[] = [];
  for (const file of ['Preferences', 'Secure Preferences']) {
    const f = path.join(dir, file);
    const p = readJson(f);
    if (!p) continue;
    for (const id of ids) {
      const s = get(p, 'extensions.settings');
      if (s && id in s) delete s[id];
      for (const macPath of ['protection.macs.extensions.settings', 'protection.macs.extensions.settings_encrypted_hash']) {
        const m = get(p, macPath);
        if (m && id in m) delete m[id];
      }
      for (const listPath of ['extensions.pinned_extensions', 'extensions.toolbar']) {
        const parent = get(p, listPath.split('.').slice(0, -1).join('.'));
        const key = listPath.split('.').pop()!;
        if (parent && Array.isArray(parent[key])) parent[key] = parent[key].filter((x: string) => x !== id);
      }
    }
    fs.writeFileSync(f, JSON.stringify(p));
  }
  for (const id of ids) {
    for (const sub of ['Extensions', 'Local Extension Settings', 'Extension State']) {
      const d = path.join(dir, sub, id);
      if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    }
    done.push(id);
  }
  return done;
}

/** Removes "allowed" notification permissions from a Chromium profile: all of them, or the given sites. */
export function removeChromiumNotifications(dir: string, sites?: string[]): number {
  const f = path.join(dir, 'Preferences');
  const p = readJson(f);
  const n = get(p, 'profile.content_settings.exceptions.notifications');
  if (!n) return 0;
  let count = 0;
  for (const k of Object.keys(n)) {
    const site = k.split(',')[0].replace(/:443$/, '');
    if (Number(n[k]?.setting) === 1 && (!sites || sites.includes(site))) {
      delete n[k];
      count++;
    }
  }
  fs.writeFileSync(f, JSON.stringify(p));
  return count;
}

/** Firefox removes an add-on whose file is gone at its next start. */
export function removeFirefoxExtensions(dir: string, ids: string[]): string[] {
  const done: string[] = [];
  for (const id of ids) {
    for (const f of [path.join(dir, 'extensions', `${id}.xpi`), path.join(dir, 'extensions', id)]) {
      if (fs.existsSync(f)) {
        fs.rmSync(f, { recursive: true, force: true });
        done.push(id);
      }
    }
  }
  return done;
}

/** The process names each browser runs as, to check it is closed before its files are changed. */
export function browserProcesses(browser: string, platform: string): string[] {
  const b = browser.replace(/ \((Snap|Flatpak)\)$/, '');
  const table: Record<string, Record<string, string[]>> = {
    win32: { 'Google Chrome': ['chrome.exe'], 'Microsoft Edge': ['msedge.exe'], Brave: ['brave.exe'], Vivaldi: ['vivaldi.exe'], Firefox: ['firefox.exe'] },
    darwin: { 'Google Chrome': ['Google Chrome'], 'Microsoft Edge': ['Microsoft Edge'], Brave: ['Brave Browser'], Vivaldi: ['Vivaldi'], Firefox: ['firefox'] },
    linux: { 'Google Chrome': ['chrome'], Chromium: ['chromium', 'chromium-browser'], 'Microsoft Edge': ['msedge'], Brave: ['brave'], Vivaldi: ['vivaldi-bin'], Firefox: ['firefox', 'firefox-bin'] },
  };
  return table[platform]?.[b] ?? [];
}

/** The page where the browser resets its own start-up page, search engine and settings. */
export function resetPage(browser: string): string {
  if (/Edge/.test(browser)) return 'edge://settings/resetProfileSettings';
  if (/Brave/.test(browser)) return 'brave://settings/resetProfileSettings';
  if (/Vivaldi/.test(browser)) return 'vivaldi://settings/resetProfileSettings';
  if (/Firefox/.test(browser)) return 'about:support';
  return 'chrome://settings/resetProfileSettings';
}

/** Something outside the browser that changes it: a policy, or an extension installed by another program. */
export interface BrowserForce {
  id: string;
  browser: string;
  kind: 'policy' | 'external';
  /** A registry key on Windows, a file elsewhere. */
  location: string;
  where: 'registry' | 'file' | 'profile';
  settings: string[];
  extensionIds: string[];
  admin: boolean;
  /** Can MendKit remove it, or only point the way? */
  removable: boolean;
}

export const POLICY_KEYS: [string, string][] = [
  ['Google Chrome', 'SOFTWARE\\Policies\\Google\\Chrome'],
  ['Microsoft Edge', 'SOFTWARE\\Policies\\Microsoft\\Edge'],
  ['Brave', 'SOFTWARE\\Policies\\BraveSoftware\\Brave'],
  ['Chromium', 'SOFTWARE\\Policies\\Chromium'],
  ['Firefox', 'SOFTWARE\\Policies\\Mozilla\\Firefox'],
];
export const EXTERNAL_KEYS: [string, string][] = [
  ['Google Chrome', 'SOFTWARE\\Google\\Chrome\\Extensions'],
  ['Google Chrome', 'SOFTWARE\\WOW6432Node\\Google\\Chrome\\Extensions'],
  ['Microsoft Edge', 'SOFTWARE\\Microsoft\\Edge\\Extensions'],
  ['Microsoft Edge', 'SOFTWARE\\WOW6432Node\\Microsoft\\Edge\\Extensions'],
  ['Brave', 'SOFTWARE\\BraveSoftware\\Brave-Browser\\Extensions'],
];

/** Reads the output of `reg query <key> /s` into key → values. */
export function parseRegQuery(text: string): Record<string, { name: string; type: string; data: string }[]> {
  const out: Record<string, { name: string; type: string; data: string }[]> = {};
  let key = '';
  for (const line of text.split(/\r?\n/)) {
    if (/^HKEY_/.test(line)) {
      key = line.trim();
      out[key] = out[key] ?? [];
      continue;
    }
    const m = /^\s{2,}(.*?)\s{2,}(REG_[A-Z_]+)\s{2,}?(.*)$/.exec(line) ?? /^\s{2,}(.*?)\s{2,}(REG_[A-Z_]+)\s*$/.exec(line);
    if (m && key) out[key].push({ name: m[1] === '(Default)' ? '' : m[1], type: m[2], data: (m[3] ?? '').trim() });
  }
  return out;
}

const EXT_ID = /\b([a-p]{32})\b/g;
/** Extension ids that a policy forces in (ExtensionInstallForcelist, ExtensionSettings with force_installed). */
export function forcedExtensionIds(policyText: string): string[] {
  return [...new Set([...policyText.matchAll(EXT_ID)].map((m) => m[1]))];
}

const short = (v: string) => (v.length > 90 ? `${v.slice(0, 87)}...` : v);

/** Policy and outside-installed extension findings from `reg query` output for HKLM and HKCU. */
export function forcesFromRegistry(hive: 'HKLM' | 'HKCU', policy: string, external: string): BrowserForce[] {
  const found: BrowserForce[] = [];
  const pol = parseRegQuery(policy);
  for (const [browser, sub] of POLICY_KEYS) {
    const root = `${hive === 'HKLM' ? 'HKEY_LOCAL_MACHINE' : 'HKEY_CURRENT_USER'}\\${sub}`;
    const keys = Object.keys(pol).filter((k) => k.toLowerCase() === root.toLowerCase() || k.toLowerCase().startsWith(`${root.toLowerCase()}\\`));
    const settings = keys.flatMap((k) => pol[k].map((v) => `${k.slice(root.length + 1) ? `${k.slice(root.length + 1)}\\` : ''}${v.name}${v.data ? ` = ${short(v.data)}` : ''}`));
    if (!settings.length) continue;
    found.push({
      id: `pol-${hive}-${browser}`,
      browser,
      kind: 'policy',
      location: `${hive}\\${sub}`,
      where: 'registry',
      settings,
      extensionIds: forcedExtensionIds(keys.filter((k) => /Extension/i.test(k)).flatMap((k) => pol[k].map((v) => v.data)).join(' ') + settings.filter((s) => /^Extension/i.test(s)).join(' ')),
      admin: hive === 'HKLM',
      removable: true,
    });
  }
  const ext = parseRegQuery(external);
  for (const [browser, sub] of EXTERNAL_KEYS) {
    const root = `${hive === 'HKLM' ? 'HKEY_LOCAL_MACHINE' : 'HKEY_CURRENT_USER'}\\${sub}`.toLowerCase();
    for (const k of Object.keys(ext)) {
      const id = k.toLowerCase().startsWith(`${root}\\`) ? k.slice(root.length + 1) : '';
      if (!/^[a-p]{32}$/.test(id)) continue;
      found.push({
        id: `ext-${hive}-${id}-${found.length}`,
        browser,
        kind: 'external',
        location: `${hive}\\${sub}\\${id}`,
        where: 'registry',
        settings: ext[k].map((v) => `${v.name || '(default)'} = ${v.data}`),
        extensionIds: [id],
        admin: hive === 'HKLM',
        removable: true,
      });
    }
  }
  return found;
}

/** Policy and outside-extension files on Linux and Mac. */
export function policyFiles(platform: string, home: string): { browser: string; kind: BrowserForce['kind']; dir: string; pattern: RegExp; removable: boolean }[] {
  if (platform === 'darwin') {
    return [
      { browser: 'Google Chrome', kind: 'policy', dir: '/Library/Managed Preferences', pattern: /^com\.google\.Chrome\.plist$/, removable: false },
      { browser: 'Microsoft Edge', kind: 'policy', dir: '/Library/Managed Preferences', pattern: /^com\.microsoft\.Edge\.plist$/, removable: false },
      { browser: 'Brave', kind: 'policy', dir: '/Library/Managed Preferences', pattern: /^com\.brave\.Browser\.plist$/, removable: false },
      { browser: 'Firefox', kind: 'policy', dir: '/Library/Managed Preferences', pattern: /^org\.mozilla\.firefox\.plist$/, removable: false },
      { browser: 'Firefox', kind: 'policy', dir: '/Applications/Firefox.app/Contents/Resources/distribution', pattern: /^policies\.json$/, removable: true },
      { browser: 'Google Chrome', kind: 'external', dir: path.join(home, 'Library/Application Support/Google/Chrome/External Extensions'), pattern: /^[a-p]{32}\.json$/, removable: true },
      { browser: 'Google Chrome', kind: 'external', dir: '/Library/Application Support/Google/Chrome/External Extensions', pattern: /^[a-p]{32}\.json$/, removable: true },
    ];
  }
  return [
    { browser: 'Google Chrome', kind: 'policy', dir: '/etc/opt/chrome/policies/managed', pattern: /\.json$/, removable: true },
    { browser: 'Google Chrome', kind: 'policy', dir: '/etc/opt/chrome/policies/recommended', pattern: /\.json$/, removable: true },
    { browser: 'Chromium', kind: 'policy', dir: '/etc/chromium/policies/managed', pattern: /\.json$/, removable: true },
    { browser: 'Chromium', kind: 'policy', dir: '/etc/chromium-browser/policies/managed', pattern: /\.json$/, removable: true },
    { browser: 'Microsoft Edge', kind: 'policy', dir: '/etc/opt/edge/policies/managed', pattern: /\.json$/, removable: true },
    { browser: 'Brave', kind: 'policy', dir: '/etc/brave/policies/managed', pattern: /\.json$/, removable: true },
    { browser: 'Firefox', kind: 'policy', dir: '/etc/firefox/policies', pattern: /^policies\.json$/, removable: true },
    { browser: 'Firefox', kind: 'policy', dir: '/usr/lib/firefox/distribution', pattern: /^policies\.json$/, removable: true },
    { browser: 'Firefox', kind: 'policy', dir: '/usr/lib64/firefox/distribution', pattern: /^policies\.json$/, removable: true },
    { browser: 'Google Chrome', kind: 'external', dir: '/opt/google/chrome/extensions', pattern: /^[a-p]{32}\.json$/, removable: true },
    { browser: 'Google Chrome', kind: 'external', dir: '/usr/share/google-chrome/extensions', pattern: /^[a-p]{32}\.json$/, removable: true },
    { browser: 'Chromium', kind: 'external', dir: '/usr/share/chromium/extensions', pattern: /^[a-p]{32}\.json$/, removable: true },
  ];
}

/** Finds policy files and outside-installed extension files. Files in the home folder need no admin rights. */
export function forcesFromFiles(platform: string, home: string): BrowserForce[] {
  const found: BrowserForce[] = [];
  for (const p of policyFiles(platform, home)) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(p.dir).filter((n) => p.pattern.test(n));
    } catch {
      continue;
    }
    for (const n of names) {
      const file = path.join(p.dir, n);
      let text = '';
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch {
        /* unreadable */
      }
      const j = /\.json$/.test(n) ? (() => { try { return JSON.parse(text); } catch { return null; } })() : null;
      const settings = j ? Object.entries(j.policies ?? j).map(([k, v]) => `${k} = ${short(JSON.stringify(v))}`) : [`${n}`];
      found.push({
        id: `file-${found.length}`,
        browser: p.browser,
        kind: p.kind,
        location: file,
        where: 'file',
        settings,
        extensionIds: p.kind === 'external' ? [n.replace(/\.json$/, '')] : forcedExtensionIds(text),
        admin: !file.startsWith(home),
        removable: p.removable,
      });
    }
  }
  return found;
}

/** Plain-language reading of policy settings that adware commonly uses. */
export function policyConcerns(settings: string[]): string[] {
  const t = settings.join('\n');
  const c: string[] = [];
  if (/ExtensionInstallForcelist|force_installed|ExtensionSettings|Extensions\\?.*Install/i.test(t)) c.push('Forces extensions in, and stops them being removed');
  if (/DefaultSearchProvider|SearchEngines/i.test(t)) c.push('Sets the search engine');
  if (/HomepageLocation|RestoreOnStartupURLs|Homepage|NewTabPageLocation|StartPage/i.test(t)) c.push('Sets the home page or start-up pages');
  if (/ProxySettings|ProxyServer|ProxyMode|ProxyPacUrl|"Proxy"/i.test(t)) c.push('Sends web traffic through a proxy');
  if (/DeveloperToolsAvailability|DisableDeveloperTools/i.test(t)) c.push('Blocks the developer tools');
  if (/BrowserSignin|SyncDisabled|DisableFirefoxAccounts/i.test(t)) c.push('Changes sign-in or sync');
  if (/\bCACertificates|ImportEnterpriseRoots|^Certificates = .*Install/im.test(t)) c.push('Adds trusted certificates, which can let a program read secure pages');
  return c;
}
