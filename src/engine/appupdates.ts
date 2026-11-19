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
      let name = col(0), id = col(1), current = col(2), available = col(3);
      const parts = row.trim().split(/\s{1,}/);
      if (!/^[\w.+\-]+$/.test(id) || !available) {
        if (parts.length < 5) continue;
        [id, current, available] = parts.slice(-4, -1);
        name = parts.slice(0, -4).join(' ');
      }
      if (!/^[\w.+\-]+$/.test(id) || !available) continue;
      list.push({ id, name: name.replace(/…$/, '').trim() || id, current, available, ...(tables > 1 ? { explicit: true } : {}) });
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

/** One command per chosen app, so one failure does not stop the rest. Ids not on the list are refused. */
export function appUpdateCommands(platform: string, chosen: AppUpdate[]): CommandDef[] {
  return chosen
    .filter((u) => SAFE.test(u.id.replace(/^(cask|formula):/, '')))
    .map((u) => {
      const base = { id: `app-update-${u.id}`, name: `Update ${u.name}`, description: `${u.current} to ${u.available}`, typicalMinutes: 3, friendly: { title: `Update ${u.name}`, ok: `${u.name} was updated to ${u.available}.`, problem: `${u.name} could not be updated.` } };
      if (platform === 'win32')
        return { ...base, exec: 'winget.exe', args: ['upgrade', '--id', u.id, '--exact', '--accept-source-agreements', '--accept-package-agreements', '--disable-interactivity'], admin: false };
      const [kind, name] = u.id.split(':');
      return { ...base, exec: 'brew', args: ['upgrade', ...(kind === 'cask' ? ['--cask'] : []), name], admin: false, requires: 'brew' };
    });
}
