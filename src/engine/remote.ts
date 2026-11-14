import * as fs from 'fs';
import * as path from 'path';

/**
 * Remote-access audit: recognises remote-support programs so the owner can see what can reach
 * their computer and decide what stays. Nothing here removes anything; it only matches what a
 * scan found against the list in definitions/remote-tools.json and plans a removal for review.
 */

export interface RemoteToolDef {
  id: string;
  name: string;
  /** Lower-case fragments looked for in program, service and process names. */
  match: string[];
  /** File-name patterns (with * wildcards) for the program files. */
  exe: string[];
  /** Arguments that make this product's own uninstaller run without prompts. */
  silent?: string;
  /** Part of the operating system: listed, never removed. */
  builtin?: boolean;
  note?: string;
}

export interface RawScan {
  programs: { DisplayName?: string; Publisher?: string; UninstallString?: string; QuietUninstallString?: string; InstallLocation?: string; PSChildName?: string }[];
  processes: { Name?: string; Path?: string; Id?: number }[];
  services: { Name?: string; DisplayName?: string; PathName?: string; State?: string; StartMode?: string }[];
  files: string[];
}

export interface RemoteFinding {
  id: string;
  name: string;
  note?: string;
  builtin: boolean;
  installed: { name: string; publisher: string; uninstall: string; quiet: string; msi: string; location: string }[];
  running: { name: string; path: string; pid: number }[];
  services: { name: string; display: string; state: string; start: string }[];
  /** Program files found outside any installed copy: downloads, portable copies, leftovers. */
  files: string[];
}

export function loadRemoteTools(definitionsDir: string): RemoteToolDef[] {
  const list = JSON.parse(fs.readFileSync(path.join(definitionsDir, 'remote-tools.json'), 'utf8')) as RemoteToolDef[];
  const ids = new Set<string>();
  for (const t of list) {
    if (!t.id || !t.name || !Array.isArray(t.match) || !Array.isArray(t.exe) || ids.has(t.id)) throw new Error(`Bad or duplicate remote tool definition: ${JSON.stringify(t)}`);
    if (t.match.some((m) => m.length < 4 || m !== m.toLowerCase())) throw new Error(`Remote tool "${t.id}" has a match fragment that is too short or not lower-case`);
    ids.add(t.id);
  }
  return list;
}

const glob = (pattern: string) => new RegExp('^' + pattern.toLowerCase().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
const base = (p: string) => p.replace(/^.*[\\/]/, '').toLowerCase();
const lower = (s: unknown) => String(s ?? '').toLowerCase();

/** The exe file-name patterns of every tool, for the file search. */
export function exePatterns(defs: RemoteToolDef[]): string[] {
  return [...new Set(defs.flatMap((d) => d.exe))];
}

/** Sorts what a scan found into one finding per recognised product. */
export function matchScan(raw: RawScan, defs: RemoteToolDef[]): RemoteFinding[] {
  const out: RemoteFinding[] = [];
  for (const d of defs) {
    const globs = d.exe.map(glob);
    const hits = (s: string) => d.match.some((m) => s.includes(m));
    const isExe = (p: string) => globs.some((g) => g.test(base(p)));
    const installed = raw.programs
      .filter((p) => hits(lower(p.DisplayName)))
      .map((p) => {
        const un = String(p.UninstallString ?? '');
        const msi = /msiexec/i.test(un) ? (/\{[0-9A-Fa-f-]{36}\}/.exec(un)?.[0] ?? (/^\{[0-9A-Fa-f-]{36}\}$/.test(String(p.PSChildName ?? '')) ? String(p.PSChildName) : '')) : '';
        return { name: String(p.DisplayName), publisher: String(p.Publisher ?? ''), uninstall: un, quiet: String(p.QuietUninstallString ?? ''), msi, location: String(p.InstallLocation ?? '').replace(/[\\/]+$/, '') };
      });
    const running = raw.processes.filter((p) => p.Path && (isExe(p.Path) || hits(lower(p.Path)))).map((p) => ({ name: String(p.Name ?? ''), path: String(p.Path), pid: Number(p.Id) }));
    const services = raw.services
      .filter((s) => hits(lower(s.Name)) || hits(lower(s.DisplayName)) || hits(lower(s.PathName)) || isExe(String(s.PathName ?? '').replace(/^"([^"]+)".*$/, '$1').replace(/\s+[-/].*$/, '')))
      .map((s) => ({ name: String(s.Name), display: String(s.DisplayName ?? s.Name), state: String(s.State ?? ''), start: String(s.StartMode ?? '') }));
    // Files inside an installed copy go when it is uninstalled; only list the ones outside.
    const inside = (f: string) => installed.some((i) => i.location && lower(f).startsWith(lower(i.location) + '\\'));
    const files = [...new Set(raw.files.filter((f) => (isExe(f) || (f.startsWith('/') && hits(lower(base(f))))) && !inside(f)))];
    if (installed.length || running.length || services.length || files.length) out.push({ id: d.id, name: d.name, note: d.note, builtin: !!d.builtin, installed, running, services, files });
  }
  return out;
}

export interface RemovalPlan {
  pids: number[];
  services: string[];
  uninstall: { name: string; msi: string; quiet: string; command: string; silent: string }[];
  files: string[];
}

/** What removing one finding involves. Built-in tools are never planned for removal. */
export function removalPlan(f: RemoteFinding, defs: RemoteToolDef[]): RemovalPlan {
  if (f.builtin) return { pids: [], services: [], uninstall: [], files: [] };
  const def = defs.find((d) => d.id === f.id);
  return {
    pids: f.running.map((r) => r.pid).filter((n) => Number.isInteger(n) && n > 4),
    services: f.services.map((s) => s.name),
    uninstall: f.installed.filter((i) => i.msi || i.quiet || i.uninstall).map((i) => ({ name: i.name, msi: i.msi, quiet: i.quiet, command: i.uninstall, silent: def?.silent ?? '' })),
    files: f.files,
  };
}
