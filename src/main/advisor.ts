import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import { AdvisorFacts } from '../engine/advisor';
import { powershellScript } from './system';

const num = (x: unknown): number | null => (typeof x === 'number' && isFinite(x) ? x : null);
const sh = (cmd: string): Promise<string> => new Promise((resolve) => execFile('sh', ['-c', cmd], { timeout: 15000, encoding: 'utf8' }, (err, stdout) => resolve(err ? '' : String(stdout).trim())));

const WIN = `
$ErrorActionPreference='SilentlyContinue'
$pd = Get-Partition -DriveLetter C | Get-Disk | Get-PhysicalDisk
$vol = Get-Volume -DriveLetter C
$tpm = $null; $t = Get-CimInstance -Namespace root/cimv2/security/microsofttpm -ClassName Win32_Tpm
if ($t) { $tpm = ($t.SpecVersion -split ',')[0].Trim() } elseif (([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole('Administrators')) { $tpm = 'none' }
$sb = $null; try { $sb = [bool](Confirm-SecureBootUEFI -ErrorAction Stop) } catch { if ($_.Exception -is [System.PlatformNotSupportedException]) { $sb = $false } }
$design = (Get-CimInstance -Namespace root/wmi -ClassName BatteryStaticData | Measure-Object DesignedCapacity -Sum).Sum
$full = (Get-CimInstance -Namespace root/wmi -ClassName BatteryFullChargedCapacity | Measure-Object FullChargedCapacity -Sum).Sum
[pscustomobject]@{
  ram = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)
  media = [string]$pd.MediaType; health = [string]$pd.HealthStatus; driveGb = [math]::Round($pd.Size / 1GB)
  freePct = if ($vol.Size) { 100 * $vol.SizeRemaining / $vol.Size } else { $null }
  build = [Environment]::OSVersion.Version.Build
  tpm = $tpm; secureBoot = $sb
  cores = (Get-CimInstance Win32_Processor | Measure-Object NumberOfCores -Sum).Sum
  biosYear = (Get-CimInstance Win32_BIOS).ReleaseDate.Year
  battery = if ($design -gt 0 -and $full -gt 0) { 100 * $full / $design } else { $null }
} | ConvertTo-Json -Compress
`;

export async function gatherFacts(): Promise<AdvisorFacts> {
  const base: AdvisorFacts = { platform: process.platform, ramGb: Math.round(os.totalmem() / 1024 ** 3), driveType: null, driveHealthy: null, freePercent: null, windowsBuild: null, tpm: null, secureBoot: null, cores: os.cpus().length || null, driveGb: null, biosYear: null, batteryPercent: null };
  try {
    const s = fs.statfsSync(process.platform === 'win32' ? 'C:\\' : '/');
    base.freePercent = (100 * s.bavail) / s.blocks;
    base.driveGb = Math.round((s.blocks * s.bsize) / 1024 ** 3);
  } catch {
    /* unknown */
  }

  if (process.platform === 'win32') {
    const d = await powershellScript(WIN, 40000);
    if (!d) return base;
    return {
      ...base,
      ramGb: num(d.ram) ?? base.ramGb,
      driveType: d.media === 'SSD' ? 'SSD' : d.media === 'HDD' ? 'HDD' : null,
      driveHealthy: d.health ? d.health === 'Healthy' : null,
      driveGb: num(d.driveGb) ?? base.driveGb,
      freePercent: num(d.freePct) ?? base.freePercent,
      windowsBuild: num(d.build),
      tpm: typeof d.tpm === 'string' && d.tpm ? d.tpm : null,
      secureBoot: typeof d.secureBoot === 'boolean' ? d.secureBoot : null,
      cores: num(d.cores) ?? base.cores,
      biosYear: num(d.biosYear),
      batteryPercent: num(d.battery),
    };
  }

  if (process.platform === 'linux') {
    const dev = await sh('lsblk -no PKNAME "$(findmnt -no SOURCE /)" 2>/dev/null | head -1');
    const rot = dev ? await sh(`cat /sys/block/${dev.replace(/[^A-Za-z0-9]/g, '')}/queue/rotational 2>/dev/null`) : '';
    if (rot === '0') base.driveType = 'SSD';
    else if (rot === '1') base.driveType = 'HDD';
    const year = /(\d{4})\s*$/.exec(await sh('cat /sys/class/dmi/id/bios_date 2>/dev/null'));
    if (year) base.biosYear = Number(year[1]);
    const bat = await sh('for b in /sys/class/power_supply/BAT*; do f=$(cat $b/energy_full 2>/dev/null || cat $b/charge_full 2>/dev/null); d=$(cat $b/energy_full_design 2>/dev/null || cat $b/charge_full_design 2>/dev/null); [ -n "$f" ] && [ -n "$d" ] && [ "$d" -gt 0 ] && echo "$f $d" && break; done');
    const m = /^(\d+) (\d+)$/.exec(bat);
    if (m) base.batteryPercent = (100 * Number(m[1])) / Number(m[2]);
    return base;
  }

  // macOS
  const ssd = await sh('diskutil info / | grep "Solid State"');
  if (/Yes/.test(ssd)) base.driveType = 'SSD';
  else if (/No/.test(ssd)) base.driveType = 'HDD';
  const smart = await sh('diskutil info disk0 | grep -i "SMART"');
  if (/Verified/.test(smart)) base.driveHealthy = true;
  else if (/Failing/.test(smart)) base.driveHealthy = false;
  const cap = /Maximum Capacity:\s*(\d+)%/.exec(await sh('system_profiler SPPowerDataType | grep "Maximum Capacity"'));
  if (cap) base.batteryPercent = Number(cap[1]);
  return base;
}
