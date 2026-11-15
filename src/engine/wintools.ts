import * as fs from 'fs';
import * as path from 'path';
import { ActionStep } from './runner';
import { CommandDef } from './types';

/** Windows tools: the parts that decide what to do, kept free of Electron so they can be tested anywhere. */

export interface WinStartupItem {
  id: string;
  kind: 'run' | 'folder' | 'task' | 'service';
  name: string;
  command: string;
  file: string;
  publisher: string;
  signer: string;
  signed: boolean | null;
  missing: boolean;
  scope: 'user' | 'all';
  enabled: boolean;
  approvedKey?: string;
  valueName?: string;
  taskPath?: string;
  taskName?: string;
  service?: string;
  delayed?: boolean;
  /** Needed by Windows itself: listed, never offered. */
  essential?: boolean;
  /** Belongs to a hardware maker (audio, touchpad, graphics). */
  hardware?: boolean;
}

export const ESSENTIAL = /^(SecurityHealth|WindowsDefender|Windows Security notification icon|ctfmon)$/i;
export const HARDWARE = /\b(Intel|Realtek|NVIDIA|AMD|Advanced Micro|Synaptics|ELAN|Dell|HP|Hewlett|Lenovo|ASUS|ASUSTeK|Acer|Logitech|Conexant|Dolby|Waves|Microchip|Qualcomm|MediaTek|Alps|Cirrus)\b/i;

/** "HKCU:\Software\..." to the form reg.exe takes. */
export const regPath = (psPath: string): string => psPath.replace(/^(HKCU|HKLM):\\/, '$1\\');

/** StartupApproved data: 02 = on; 03 plus the time it was turned off = off. */
export function approvedData(on: boolean, now = Date.now()): string {
  if (on) return '02' + '00'.repeat(11);
  let ft = BigInt(now) * 10000n + 116444736000000000n;
  let hex = '';
  for (let i = 0; i < 8; i++) {
    hex += Number(ft & 0xffn).toString(16).padStart(2, '0');
    ft >>= 8n;
  }
  return '03000000' + hex;
}

/** The command that turns one startup item off or back on. */
export function startupToggle(it: WinStartupItem, on: boolean, previousDelayed = false): CommandDef {
  const label = `${on ? 'Turn on' : 'Turn off'} ${it.name}`;
  const base = { id: `${on ? 'on' : 'off'}-${it.id}`, name: label, description: '', typicalMinutes: 1, admin: it.scope === 'all' };
  const friendly = { title: it.name, ok: on ? `${it.name} will start again.` : `${it.name} will no longer start. It is not uninstalled, and Turn back on undoes this.`, problem: `${it.name} could not be changed.` };
  if (it.kind === 'run' || it.kind === 'folder')
    return { ...base, exec: 'reg.exe', args: ['add', regPath(it.approvedKey!), '/v', it.valueName!, '/t', 'REG_BINARY', '/d', approvedData(on), '/f'], friendly };
  if (it.kind === 'task') return { ...base, admin: true, exec: 'schtasks.exe', args: ['/Change', '/TN', `${it.taskPath}${it.taskName}`, on ? '/ENABLE' : '/DISABLE'], friendly };
  return { ...base, admin: true, exec: 'sc.exe', args: ['config', it.service!, 'start=', on ? (previousDelayed ? 'delayed-auto' : 'auto') : 'demand'], friendly: { ...friendly, ok: on ? `${it.name} starts with the computer again.` : `${it.name} no longer starts with the computer. It still starts when a program needs it.` } };
}

export const human = (b: number): string => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : b >= 1024 ** 2 ? `${Math.round(b / 1024 ** 2)} MB` : `${Math.max(0, Math.round(b / 1024))} KB`);
const ps = (id: string, name: string, script: string, ok: string, minutes = 2, admin = true): CommandDef => ({
  id, name, description: '', exec: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference='SilentlyContinue'; ${script}`], admin, typicalMinutes: minutes,
  friendly: { title: name, ok, problem: `${name} could not be fully cleared. Files in use are skipped; close open programs and try again.` },
});
/** Windows' own Disk Cleanup, for folders that plain deletion cannot touch (Windows.old, upgrade leftovers). */
const cleanmgr = (id: string, name: string, handlers: string[], ok: string): CommandDef =>
  ps(id, name, `$k='HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VolumeCaches'; Get-ChildItem $k | ForEach-Object { Remove-ItemProperty -Path $_.PSPath -Name StateFlags6501 -ErrorAction SilentlyContinue }; foreach ($h in @(${handlers.map((h) => `'${h}'`).join(',')})) { if (Test-Path "$k\\$h") { New-ItemProperty -Path "$k\\$h" -Name StateFlags6501 -Value 2 -PropertyType DWord -Force | Out-Null } }; Start-Process cleanmgr.exe -ArgumentList '/sagerun:6501' -Wait; 'done'`, ok, 15);

export interface SpaceCategory {
  id: string;
  name: string;
  detail: string;
  preset: boolean;
  /** Deleting it needs the step below; null means report only (Downloads). */
  step: CommandDef | ActionStep | null;
}

/** What can be cleared on Windows, and how. Sizes come from definitions/scripts/windows-space.ps1. */
export function winSpaceCategories(env: { local: string; temp: string }): SpaceCategory[] {
  const emptyIn = (id: string, name: string, dirs: string[], match?: RegExp): ActionStep => ({
    id, name: `Delete ${name.toLowerCase()}`, admin: false, ok: `${name}: deleted. Files in use were skipped.`, problem: `${name} could not be deleted.`,
    action: async (write) => {
      let skipped = 0;
      for (const d of dirs) {
        let names: string[] = [];
        try {
          names = fs.readdirSync(d);
        } catch {
          continue;
        }
        for (const n of names) {
          if (match && !match.test(n)) continue;
          try {
            fs.rmSync(path.join(d, n), { recursive: true, force: true });
          } catch {
            skipped++;
          }
        }
      }
      write(skipped ? `${skipped} items were in use and skipped\n` : 'cleared\n');
      return { ok: true };
    },
  });
  const browsers: string[] = [];
  for (const b of ['Google\\Chrome', 'Microsoft\\Edge', 'BraveSoftware\\Brave-Browser', 'Vivaldi']) {
    const root = path.join(env.local, b, 'User Data');
    let profiles: string[] = [];
    try {
      profiles = fs.readdirSync(root).filter((n) => /^(Default|Profile \d+|Guest Profile)$/.test(n));
    } catch {
      /* not installed */
    }
    for (const p of profiles) for (const c of ['Cache', 'Code Cache', 'GPUCache']) browsers.push(path.join(root, p, c));
  }
  try {
    const ff = path.join(env.local, 'Mozilla', 'Firefox', 'Profiles');
    for (const p of fs.readdirSync(ff)) browsers.push(path.join(ff, p, 'cache2'));
  } catch {
    /* no Firefox */
  }
  return [
    { id: 'user-temp', name: 'Temporary files (yours)', detail: 'Files programs left in your temporary folder.', preset: true, step: emptyIn('space-user-temp', 'Temporary files', [env.temp]) },
    { id: 'win-temp', name: 'Temporary files (Windows)', detail: 'Files Windows and installers left in its temporary folder.', preset: true, step: ps('space-win-temp', 'Windows temporary files', "Get-ChildItem \"$env:WINDIR\\Temp\" -Force | Remove-Item -Recurse -Force; 'done'", 'Windows temporary files were deleted.') },
    { id: 'wu-cache', name: 'Downloaded Windows updates', detail: 'Update files already installed. Windows downloads again anything it still needs.', preset: true, step: ps('space-wu', 'Downloaded Windows updates', "Stop-Service wuauserv,bits -Force; Get-ChildItem \"$env:WINDIR\\SoftwareDistribution\\Download\" -Force | Remove-Item -Recurse -Force; Start-Service bits,wuauserv; 'done'", 'Downloaded update files were deleted.', 3) },
    { id: 'do-cache', name: 'Delivery Optimization files', detail: 'Copies of updates Windows keeps to share with other computers.', preset: true, step: ps('space-do', 'Delivery Optimization files', "Delete-DeliveryOptimizationCache -Force; 'done'", 'Delivery Optimization files were deleted.') },
    { id: 'upgrade', name: 'Windows upgrade leftovers', detail: 'Setup files and logs left from Windows feature updates.', preset: true, step: cleanmgr('space-upgrade', 'Windows upgrade leftovers', ['Temporary Setup Files', 'Windows Upgrade Log Files', 'Setup Log Files'], 'Windows upgrade leftovers were deleted.') },
    { id: 'wer', name: 'Error reports', detail: 'Crash reports Windows saved to send to Microsoft.', preset: true, step: ps('space-wer', 'Error reports', "Get-ChildItem \"$env:ProgramData\\Microsoft\\Windows\\WER\\ReportArchive\",\"$env:ProgramData\\Microsoft\\Windows\\WER\\ReportQueue\",\"$env:LOCALAPPDATA\\Microsoft\\Windows\\WER\" -Force | Remove-Item -Recurse -Force; 'done'", 'Error reports were deleted.') },
    { id: 'thumbs', name: 'Picture thumbnails', detail: 'Small previews of pictures and videos. File Explorer makes them again when needed.', preset: true, step: emptyIn('space-thumbs', 'Picture thumbnails', [path.join(env.local, 'Microsoft', 'Windows', 'Explorer')], /^thumbcache_.*\.db$/i) },
    { id: 'browser', name: 'Browser caches', detail: 'Copies of web pages and images browsers keep. Close the browsers first; signed-in websites and passwords are not touched.', preset: true, step: emptyIn('space-browser', 'Browser caches', browsers) },
    { id: 'recycle', name: 'Recycle Bin', detail: 'Files already in the Recycle Bin.', preset: false, step: ps('space-recycle', 'Recycle Bin', "Clear-RecycleBin -Force; 'done'", 'The Recycle Bin was emptied.', 1, false) },
    { id: 'dumps', name: 'Crash dump files', detail: 'Memory copies saved after blue screens. Run the Crash Analyzer first: it reads these.', preset: false, step: ps('space-dumps', 'Crash dump files', "Remove-Item \"$env:WINDIR\\MEMORY.DMP\" -Force; Get-ChildItem \"$env:WINDIR\\Minidump\",\"$env:LOCALAPPDATA\\CrashDumps\" -Force | Remove-Item -Recurse -Force; 'done'", 'Crash dump files were deleted.') },
    { id: 'win-old', name: 'Previous version of Windows (Windows.old)', detail: 'Kept after a Windows upgrade so it can be undone. Deleting it means you can no longer go back.', preset: false, step: cleanmgr('space-win-old', 'Previous version of Windows', ['Previous Installations'], 'The previous version of Windows was deleted.') },
    { id: 'component', name: 'Superseded Windows components', detail: 'Old copies of Windows parts replaced by updates. Size is only known after cleaning; it can take 15 minutes.', preset: false, step: { ...ps('space-component', 'Superseded Windows components', "dism.exe /Online /Cleanup-Image /StartComponentCleanup; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }", 'Superseded Windows components were removed.', 15), heavy: true } },
    { id: 'hiber', name: 'Hibernation file', detail: 'As large as the memory. Removing it turns off hibernation and Fast Startup; startup may take a few seconds longer.', preset: false, step: ps('space-hiber', 'Hibernation file', "powercfg.exe /hibernate off; 'done'", 'Hibernation is off and its file was removed. Turn it back on with: powercfg /hibernate on', 1) },
    { id: 'downloads', name: 'Downloads folder', detail: 'Look through it yourself: MendKit will not delete your downloads.', preset: false, step: null },
  ];
}

