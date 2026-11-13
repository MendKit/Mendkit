/** Reading the small "latest" file that the update bucket holds, and comparing versions. No network calls here. */

export interface LatestInfo {
  version: string;
  /** File name of the installer, relative to the bucket. */
  path: string;
  releaseDate?: string;
}

/** The file electron-builder writes next to each installer: latest.yml, latest-mac.yml or latest-linux.yml. */
export function latestFileName(platform: string): string {
  return platform === 'darwin' ? 'latest-mac.yml' : platform === 'linux' ? 'latest-linux.yml' : 'latest.yml';
}

export function parseLatest(text: string): LatestInfo | null {
  const get = (key: string) => new RegExp(`^${key}:\\s*['"]?([^'"\\r\\n]+?)['"]?\\s*$`, 'm').exec(text)?.[1];
  const version = get('version');
  const path = get('path');
  if (!version || !path || !/^\d+\.\d+\.\d+/.test(version) || /[\\]|\.\.|^[a-z]+:/i.test(path)) return null;
  return { version, path, releaseDate: get('releaseDate') };
}

/** True when `candidate` is a later release than `current` (numeric compare of major.minor.patch). */
export function isNewer(candidate: string, current: string): boolean {
  const nums = (v: string) => v.split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const a = nums(candidate);
  const b = nums(current);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  // 1.2.3 is newer than 1.2.3-beta
  return !candidate.includes('-') && current.includes('-');
}
