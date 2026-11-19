import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ToolDef } from './types';
import { childEnv } from './runner';

/**
 * Downloads a Windows tool straight from its publisher, for when winget cannot: Sysinternals replaces its
 * zips in place (so winget's checksum goes stale), and HWiNFO removes old versions that winget's catalog
 * still lists. Every program is checked to be signed by its publisher before it is kept.
 * The fetch function is passed in: Electron's (Chromium's network stack) in the app, Node's in the tests.
 */

export type Fetch = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string>; arrayBuffer(): Promise<ArrayBuffer> }>;
export interface PublisherFile {
  /** File name inside the folder: the installer, or the program for a tool that is a folder of files. */
  file: string;
  /** 'folder' for a tool that is copied into place; otherwise the installer kind (inno, nullsoft, msi). */
  installerType: string;
  silent?: string;
  version: string;
}

export const hasPublisherSource = (t: ToolDef): boolean => !!(t.windowsZip || t.windowsDownload);

const ps = (script: string): Promise<string> =>
  new Promise((resolve) =>
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 300000, env: childEnv('powershell.exe'), maxBuffer: 4 * 1024 * 1024 }, (_e, out, err) => resolve(`${out ?? ''}${err ?? ''}`.trim())),
  );
const q = (v: string) => `'${v.replace(/'/g, "''")}'`;

/** "Valid|CN=..., O=Microsoft Corporation, ..." or the reason it is not. */
export async function signatureOf(file: string): Promise<string> {
  return ps(`$s = Get-AuthenticodeSignature -LiteralPath ${q(file)}; "$($s.Status)|$($s.SignerCertificate.Subject)"`);
}
export const signedBy = (sig: string, signer: string): boolean => /^Valid\|/.test(sig) && new RegExp(signer, 'i').test(sig);

/** The newest installer file name linked from a download page (by the number in its name). */
export function newestLink(html: string, pattern: string): string | null {
  const names = [...new Set([...html.matchAll(new RegExp(pattern, 'gi'))].map((m) => m[0]))];
  names.sort((a, b) => Number(b.replace(/\D/g, '')) - Number(a.replace(/\D/g, '')));
  return names[0] ?? null;
}

async function save(fetch: Fetch, url: string, file: string): Promise<void> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} answered ${r.status}${r.status === 403 ? ' (the site refused the download)' : ''}`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}

/** Downloads the tool from its publisher into dir and checks the signature. Throws with a plain reason. */
export async function publisherDownload(tool: ToolDef, dir: string, fetch: Fetch, write: (s: string) => void): Promise<PublisherFile> {
  fs.mkdirSync(dir, { recursive: true });
  if (tool.windowsZip) {
    const z = tool.windowsZip;
    const zip = path.join(dir, 'download.zip');
    write(`Downloading ${z.url}\n`);
    await save(fetch, z.url, zip);
    const out = await ps(`Expand-Archive -LiteralPath ${q(zip)} -DestinationPath ${q(dir)} -Force; 'unpacked'`);
    fs.rmSync(zip, { force: true });
    if (!fs.existsSync(path.join(dir, z.exe))) throw new Error(`The download did not contain ${z.exe}. ${out}`);
    const sig = await signatureOf(path.join(dir, z.exe));
    write(`Signature: ${sig}\n`);
    if (!signedBy(sig, z.signer ?? 'O=Microsoft Corporation')) throw new Error('The downloaded program is not signed by its publisher, so it was not kept.');
    return { file: z.exe, installerType: 'folder', version: 'latest' };
  }
  const d = tool.windowsDownload;
  if (!d) throw new Error(`${tool.name} has no publisher download`);
  const errors: string[] = [];
  for (const src of d.sources) {
    try {
      write(`Reading ${src.page}\n`);
      const page = await fetch(src.page);
      if (!page.ok) throw new Error(`${src.page} answered ${page.status}`);
      const name = newestLink(await page.text(), d.link);
      if (!name) throw new Error(`no installer link on ${src.page}`);
      const file = path.join(dir, name);
      const url = `${src.base}${name}${src.suffix ?? ''}`;
      write(`Downloading ${url}\n`);
      await save(fetch, url, file);
      const sig = await signatureOf(file);
      write(`Signature: ${sig}\n`);
      if (!signedBy(sig, d.signer)) {
        fs.rmSync(file, { force: true });
        throw new Error('the download is not signed by the publisher, so it was not kept');
      }
      return { file: name, installerType: d.type ?? 'exe', silent: d.args, version: /(\d+)/.exec(name.replace(/^\D*64_?/, ''))?.[1] ?? 'latest' };
    } catch (e) {
      errors.push((e as Error).message);
      write(`${(e as Error).message}\n`);
    }
  }
  throw new Error(`It could not be downloaded from the publisher either: ${errors.join('; ')}. Download it from ${d.sources[0].page} and run it.`);
}

/**
 * Installs what publisherDownload saved. A folder tool is copied to Program Files (or the user's Programs
 * folder without administrator rights) with a Start menu shortcut; an installer runs silently, asking for
 * administrator rights itself when MendKit has none.
 */
export async function publisherInstall(tool: ToolDef, dir: string, f: PublisherFile, elevated: boolean): Promise<string> {
  if (f.installerType === 'folder') {
    return ps(
      [
        `$src = ${q(dir)}`,
        elevated ? "$dest = Join-Path $env:ProgramFiles 'Sysinternals'; $menu = [Environment]::GetFolderPath('CommonPrograms')" : "$dest = Join-Path $env:LOCALAPPDATA 'Programs\\Sysinternals'; $menu = [Environment]::GetFolderPath('Programs')",
        'New-Item -ItemType Directory -Force -Path $dest | Out-Null',
        "Get-ChildItem -LiteralPath $src -File | Where-Object { $_.Name -ne 'mendkit-cache.json' } | Copy-Item -Destination $dest -Force",
        `$lnk = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $menu ${q(`${tool.name}.lnk`)}))`,
        `$lnk.TargetPath = Join-Path $dest ${q(f.file)}; $lnk.Save()`,
        "if (Test-Path (Join-Path $dest " + q(f.file) + ')) { "MK_DIRECT_OK installed in $dest" } else { \'MK_DIRECT_FAILED copy\' }',
      ].join('; '),
    );
  }
  const file = path.join(dir, f.file);
  const verb = elevated ? '' : ' -Verb RunAs';
  return ps(`$p = Start-Process -FilePath ${q(file)} -ArgumentList ${q(f.silent ?? '')}${verb} -Wait -PassThru; if ($p.ExitCode -eq 0 -or $p.ExitCode -eq 3010) { 'MK_DIRECT_OK installed' } else { "MK_DIRECT_FAILED the installer stopped with code $($p.ExitCode)" }`);
}
