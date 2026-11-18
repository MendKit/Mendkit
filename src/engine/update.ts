/** Reading the small "latest" file that the update bucket holds, and comparing versions. No network calls here. */

export interface LatestInfo {
  version: string;
  /** File name of the installer, relative to the bucket. */
  path: string;
  releaseDate?: string;
  /** Every installer listed (a Mac release has one for Apple silicon and one for Intel). */
  files: string[];
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
  const files = [...text.matchAll(/^\s*-\s*url:\s*['"]?([^'"\r\n]+?)['"]?\s*$/gm)].map((m) => m[1]).filter((f) => !/[\\]|\.\.|^[a-z]+:/i.test(f));
  return { version, path, releaseDate: get('releaseDate'), files };
}

/** The installer for this processor: arm64 or x64 by its name, else the default one. */
export function installerFor(info: LatestInfo, arch: string): string {
  const want = arch === 'arm64' ? /arm64/i : /x64|x86_64|amd64/i;
  return info.files.find((f) => want.test(f) && !/\.(blockmap|zip)$/.test(f)) ?? info.path;
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
