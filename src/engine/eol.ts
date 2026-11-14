/**
 * End of support dates, so MendKit can warn when a system no longer gets security updates.
 * Dates are the vendor's published end of standard (free) security support. Update this table with each release.
 */

export interface EolInfo {
  name: string;
  /** ISO date security updates stop, or null when unknown (rolling releases, unknown versions). */
  ends: string | null;
  /** What to do about it. */
  advice: string;
}

const UBUNTU: Record<string, string> = {
  '20.04': '2025-05-31',
  '22.04': '2027-06-30',
  '24.04': '2029-05-31',
  '24.10': '2025-07-10',
  '25.04': '2026-01-15',
  '25.10': '2026-07-09',
  '26.04': '2031-05-31',
};
const MINT: Record<string, string> = { '20': '2025-04-30', '21': '2027-04-30', '22': '2029-04-30' };
const FEDORA: Record<string, string> = { '40': '2025-05-13', '41': '2025-12-15', '42': '2026-05-13', '43': '2026-12-09', '44': '2027-05-19', '45': '2027-12-08' };
const DEBIAN: Record<string, string> = { '11': '2026-08-31', '12': '2028-06-30', '13': '2030-06-30' };

/** Reads /etc/os-release text into its fields. */
export function parseOsRelease(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return out;
}

export function linuxEol(osRelease: Record<string, string>): EolInfo {
  const id = (osRelease.ID ?? '').toLowerCase();
  const v = osRelease.VERSION_ID ?? '';
  const name = osRelease.PRETTY_NAME ?? `${id} ${v}`;
  if (id === 'ubuntu' || id === 'pop' || id === 'zorin') return { name, ends: UBUNTU[v] ?? null, advice: 'Upgrade to the next Ubuntu LTS release with Upgrade to the next version in Repair.' };
  if (id === 'linuxmint') return { name, ends: MINT[v.split('.')[0]] ?? null, advice: 'Upgrade with the Mint upgrade tool: Upgrade to the next version in Repair.' };
  if (id === 'fedora') return { name, ends: FEDORA[v] ?? null, advice: 'Upgrade to the next Fedora release with Upgrade to the next version in Repair.' };
  if (id === 'debian') return { name, ends: DEBIAN[v] ?? null, advice: 'Upgrade to the next Debian release by following Debian\'s release notes.' };
  return { name, ends: null, advice: '' };
}

/** Windows 10 left support on 14 October 2025 (Extended Security Updates aside). */
export function windowsEol(build: number): EolInfo {
  return build > 0 && build < 22000
    ? { name: 'Windows 10', ends: '2025-10-14', advice: 'Upgrade to Windows 11 if the computer qualifies, or switch to Linux with the Switch to Linux assistant.' }
    : { name: 'Windows 11', ends: null, advice: '' };
}

/** 'ended', 'soon' (within 6 months) or 'ok'. */
export function eolState(e: EolInfo, today: Date): 'ended' | 'soon' | 'ok' {
  if (!e.ends) return 'ok';
  const days = (new Date(e.ends).getTime() - today.getTime()) / 86400000;
  return days < 0 ? 'ended' : days < 183 ? 'soon' : 'ok';
}
