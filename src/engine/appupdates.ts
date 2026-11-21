import { CommandDef } from './types';

/** One app with an update waiting, as winget or Homebrew lists it. */
export interface AppUpdate {
  /** What to pass back to install it: a winget id, or "formula:name" / "cask:name" for Homebrew. */
  id: string;
  name: string;
  current: string;
  available: string;
  /** winget lists some updates only when the app is named on its own ("require explicit targeting"). */
  explicit?: boolean;
  /** winget source: winget or msstore. */
  source?: string;
}

/**
 * Reads winget's `upgrade` table. The column titles are translated on non-English Windows, so the columns
 * are found from where each title starts on the line above the row of dashes; the order is always
 * Name, Id, Version, Available, Source.
 */
export function parseWingetUpgrade(out: string): AppUpdate[] {
  const lines = out.split(/\r?\n/).map((l) => l.split('\r').pop() ?? '');
  const list: AppUpdate[] = [];
  let tables = 0;
  for (let i = 1; i < lines.length; i++) {
    if (!/^-{10,}\s*$/.test(lines[i])) continue;
    const head = lines[i - 1].replace(/^[\s\-\\|/]*(?=\S)/, (m) => ' '.repeat(m.length));
    const starts = [...head.matchAll(/\S+/g)].map((m) => m.index ?? 0);
    if (starts.length < 4) continue;
    tables++;
    for (let j = i + 1; j < lines.length; j++) {
      const row = lines[j];
      if (!row.trim() || /^\d+ /.test(row.trim()) || /^-{10,}\s*$/.test(lines[j + 1] ?? '')) break;
      const col = (k: number) => row.slice(starts[k], k + 1 < starts.length ? starts[k + 1] : undefined).trim();
      // A long name can push the line out of step: fall back to splitting on runs of spaces from the right.
      let name = col(0), id = col(1), current = col(2), available = col(3), source = col(4);
      const parts = row.trim().split(/\s{1,}/);
      if (!/^[\w.+\-]+$/.test(id) || !available) {
        if (parts.length < 5) continue;
        [id, current, available, source] = parts.slice(-4);
        name = parts.slice(0, -4).join(' ');
      }
      if (!/^[\w.+\-]+$/.test(id) || !available) continue;
      list.push({ id, name: name.replace(/…$/, '').trim() || id, current, available, ...(/^[\w-]+$/.test(source) ? { source } : {}), ...(tables > 1 ? { explicit: true } : {}) });
    }
  }
  return list;
}

/** Reads `brew outdated --json=v2`. */
export function parseBrewOutdated(json: string): AppUpdate[] {
  try {
    const d = JSON.parse(json) as { formulae?: { name: string; installed_versions?: string[]; current_version?: string }[]; casks?: { name: string; installed_versions?: string[] | string; current_version?: string }[] };
    const v = (x: string[] | string | undefined) => (Array.isArray(x) ? x.join(', ') : (x ?? ''));
    return [
      ...(d.casks ?? []).map((c) => ({ id: `cask:${c.name}`, name: c.name, current: v(c.installed_versions), available: c.current_version ?? '' })),
      ...(d.formulae ?? []).map((f) => ({ id: `formula:${f.name}`, name: f.name, current: v(f.installed_versions), available: f.current_version ?? '' })),
    ];
  } catch {
    return [];
  }
}

const SAFE = /^[\w.+\-@/]+$/;
const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

/**
 * One app's winget update, with the fixes for the usual failures. winget's own advice for each code is
 * followed: refresh the catalog for a bad download, install for all users when the per-user install is
 * refused, reinstall when the new version uses a different installer type, and hand Store apps to the
 * Microsoft Store. Each outcome prints a marker that the notes below turn into plain words.
 */
export function wingetUpdateScript(u: AppUpdate): string {
  const src = u.source && /^[\w-]+$/.test(u.source) ? u.source : 'winget';
  return [
    `$id = ${q(u.id)}; $src = ${q(src)}; $name = ${q(u.name)}`,
    "$common = @('--id', $id, '--exact', '--source', $src, '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity')",
    "function Run($verb, $more) { $o = & winget.exe $verb @common @more 2>&1 | Out-String; $script:code = $LASTEXITCODE; $script:hex = '0x{0:X8}' -f $script:code; $o }",
    "$out = Run 'upgrade' @()",
    "if ($code -ne 0 -and ($out -match 'administrator context|user scope' -or $hex -match '8A15007D|8A150056')) { 'MK_RETRY_MACHINE'; $out = Run 'upgrade' @('--scope', 'machine') }",
    "if ($code -ne 0 -and ($hex -eq '0x8A150011' -or $out -match '404|0x80190194|hash does not match')) { 'MK_RETRY_SOURCE'; winget.exe source update --disable-interactivity 2>&1 | Out-String; $out = Run 'upgrade' @() }",
    // The new version uses a different installer type (common with iCUE and other vendor installers): winget says to uninstall and install.
    "if ($hex -eq '0x8A15008E' -or $out -match 'install technology is different') { 'MK_REINSTALL'; $u = Run 'uninstall' @(); $out = Run 'install' @(); if ($code -eq 0) { 'MK_REINSTALLED' } }",
    "if ($code -ne 0 -and $src -eq 'msstore') {",
    "  'MK_STORE'",
    // Ask the Store to look for updates for every Store app (works when MendKit runs as administrator), then open its downloads page.
    "  try { Get-CimInstance -Namespace 'Root\\cimv2\\mdm\\dmmap' -ClassName 'MDM_EnterpriseModernAppManagement_AppManagement01' -ErrorAction Stop | Invoke-CimMethod -MethodName UpdateScanMethod -ErrorAction Stop | Out-Null; 'MK_STORE_SCAN' } catch {}",
    "  Start-Process 'ms-windows-store://downloadsandupdates'",
    '}',
    '$out',
    "switch -regex ($hex) {",
    "  '8A150101|8A150103|8A150111' { 'MK_IN_USE' }",
    "  '8A150109|8A15010A|8A15010B' { 'MK_RESTART'; exit 0 }",
    "  '8A150068' { 'MK_PINNED' }",
    "  '8A15002B|8A15004F' { 'MK_NOT_APPLICABLE' }",
    "  '8A150102' { 'MK_BUSY' }",
    "  '8A150105' { 'MK_DISK_FULL' }",
    "  '8A15003A|8A15010F|8A15001B|8A15001C' { 'MK_POLICY' }",
    "  '8A15010C' { 'MK_CANCELLED' }",
    '}',
    "if ($code -ne 0 -and -not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { 'MK_NOT_ADMIN' }",
    'exit $code',
  ].join('\n');
}

function wingetNotes(n: string) {
  return [
    { pattern: 'MK_REINSTALLED', level: 'good' as const, message: `${n}'s new version uses a different kind of installer, so it was removed and the new version installed, as winget advises. Settings are normally kept, but check ${n} opens and is set up as before.` },
    { pattern: 'MK_IN_USE', level: 'attention' as const, message: `${n} is open, so it cannot be updated. Close it, including its icon by the clock (right-click, Exit or Quit), then update it again.` },
    { pattern: 'MK_RESTART', level: 'attention' as const, message: `${n} was updated, but Windows needs a restart to finish.` },
    { pattern: 'MK_PINNED', level: 'attention' as const, message: `${n} is pinned to its current version in winget, so it is skipped. To allow updates: winget pin remove --id <id>.` },
    { pattern: 'MK_NOT_APPLICABLE', level: 'attention' as const, message: `winget lists a newer ${n}, but has no installer for this computer. Update it from inside ${n} (usually Help or Settings, Check for updates) or from the maker's website.` },
    { pattern: 'MK_BUSY', level: 'attention' as const, message: 'Another installation was running (often Windows Update). Wait for it to finish, then update again.' },
    { pattern: 'MK_DISK_FULL', level: 'problem' as const, message: 'The drive is full. Free some space and update again.' },
    { pattern: 'MK_POLICY', level: 'attention' as const, message: `A policy on this computer (school or work management) blocks installing ${n}.` },
    { pattern: 'MK_CANCELLED', level: 'attention' as const, message: `The ${n} update was cancelled, usually by clicking No on the Windows permission box.` },
    { pattern: 'MK_STORE_SCAN', level: 'attention' as const, message: `${n} comes from the Microsoft Store, which updates it itself. MendKit asked the Store to fetch its updates now and opened the Store's Downloads page: click Get updates there if it has not started.` },
    { pattern: 'MK_STORE', level: 'attention' as const, message: `${n} comes from the Microsoft Store, which updates it itself. MendKit opened the Store's Downloads page: click Get updates.` },
    { pattern: 'MK_NOT_ADMIN', level: 'attention' as const, message: `${n} may need administrator rights to update. On the Dashboard, click Restart as administrator, then try again.` },
  ];
}

/** One command per chosen app, so one failure does not stop the rest. Ids not on the list are refused. */
export function appUpdateCommands(platform: string, chosen: AppUpdate[]): CommandDef[] {
  return chosen
    .filter((u) => SAFE.test(u.id.replace(/^(cask|formula):/, '')))
    .map((u) => {
      const base = { id: `app-update-${u.id}`, name: `Update ${u.name}`, description: `${u.current} to ${u.available}`, typicalMinutes: 3, timeoutMinutes: 30 };
      if (platform === 'win32')
        return { ...base, exec: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', wingetUpdateScript(u)], admin: false, friendly: { title: `Update ${u.name}`, ok: `${u.name} was updated to ${u.available}.`, problem: `${u.name} could not be updated.`, notes: wingetNotes(u.name) } };
      const [kind, name] = u.id.split(':');
      return { ...base, exec: 'brew', args: ['upgrade', ...(kind === 'cask' ? ['--cask'] : []), name], admin: false, requires: 'brew', friendly: { title: `Update ${u.name}`, ok: `${u.name} was updated to ${u.available}.`, problem: `${u.name} could not be updated.`, notes: [{ pattern: 'is running|quit .* before', level: 'attention' as const, message: `${u.name} is open. Quit it (Command Q), then update it again.` }, { pattern: 'already installed', level: 'good' as const, message: `${u.name} is already up to date.` }] } };
    });
}
