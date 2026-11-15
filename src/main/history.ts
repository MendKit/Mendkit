import { app, ipcMain } from 'electron';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { addSnapshot, HealthSnapshot, healthTrends } from '../engine/history';
import { gatherFacts } from './advisor';
import { powershellScript } from './system';

/**
 * Takes one health snapshot a day while MendKit is open, keeps them in the app's data folder, and turns
 * them into trend warnings for the Dashboard. Nothing leaves the computer.
 */

const WIN = `
$ErrorActionPreference='SilentlyContinue'
$pd = Get-Partition -DriveLetter C | Get-Disk | Get-PhysicalDisk
$r = $pd | Get-StorageReliabilityCounter
$since = (Get-Date).AddDays(-30)
$bsod = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; Id = 1001; ProviderName = 'Microsoft-Windows-WER-SystemErrorReporting'; StartTime = $since }).Count
$power = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; Id = 41; ProviderName = 'Microsoft-Windows-Kernel-Power'; StartTime = $since }).Count
[pscustomobject]@{ wear = $r.Wear; errors = $r.ReadErrorsUncorrected; temp = $r.Temperature; crashes = $bsod + $power } | ConvertTo-Json -Compress
`;

const sh = (cmd: string): Promise<string> => new Promise((resolve) => execFile('sh', ['-c', cmd], { timeout: 20000, encoding: 'utf8' }, (err, out) => resolve(err ? '' : String(out).trim())));
const num = (x: unknown): number | null => (typeof x === 'number' && isFinite(x) ? x : typeof x === 'string' && x.trim() && isFinite(Number(x)) ? Number(x) : null);

export async function takeSnapshot(): Promise<HealthSnapshot> {
  const f = await gatherFacts();
  let freeGb: number | null = null;
  try {
    const s = fs.statfsSync(process.platform === 'win32' ? 'C:\\' : '/');
    freeGb = Math.round(((s.bavail * s.bsize) / 1024 ** 3) * 10) / 10;
  } catch {
    /* unknown */
  }
  const snap: HealthSnapshot = { at: new Date().toISOString(), freeGb, freePercent: f.freePercent !== null ? Math.round(f.freePercent * 10) / 10 : null, driveHealthy: f.driveHealthy, wear: null, driveErrors: null, temperature: null, batteryPercent: f.batteryPercent !== null ? Math.round(f.batteryPercent * 10) / 10 : null, crashes: null };
  if (process.platform === 'win32') {
    const d = await powershellScript(WIN, 40000);
    if (d) Object.assign(snap, { wear: num(d.wear), driveErrors: num(d.errors), temperature: num(d.temp) || null, crashes: num(d.crashes) });
  } else if (process.platform === 'darwin') {
    const panics = await sh('find /Library/Logs/DiagnosticReports -maxdepth 2 \\( -name "*.panic" -o -name "panic-full-*" \\) -mtime -30 2>/dev/null | wc -l');
    snap.crashes = num(panics);
  } else {
    // Crash reports Ubuntu and Mint keep, from the last 30 days.
    snap.crashes = num(await sh('find /var/crash -maxdepth 1 -name "*.crash" -mtime -30 2>/dev/null | wc -l'));
    // SSD wear from the kernel, where the drive reports it without root (NVMe).
    const wear = await sh('for f in /sys/class/nvme/nvme0/device/nvme/nvme0/percentage_used /sys/class/nvme/nvme0/percentage_used; do [ -r "$f" ] && cat "$f" && break; done');
    snap.wear = num(wear);
  }
  return snap;
}

export function registerHistory(): void {
  const file = path.join(app.getPath('userData'), 'health-history.json');
  const read = (): HealthSnapshot[] => {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Array.isArray(j) ? j : [];
    } catch {
      return [];
    }
  };
  let busy = false;
  const record = async (force = false) => {
    if (busy) return;
    const h = read();
    const today = new Date().toISOString().slice(0, 10);
    if (!force && h.length && h[h.length - 1].at.slice(0, 10) === today) return;
    busy = true;
    try {
      const snap = await takeSnapshot();
      fs.writeFileSync(file, JSON.stringify(addSnapshot(read(), snap)));
    } catch {
      /* try again later */
    } finally {
      busy = false;
    }
  };
  // Once shortly after start, then every few hours for computers left running.
  setTimeout(() => record(), 45000).unref();
  setInterval(() => record(), 4 * 3600000).unref();

  ipcMain.handle('health-history', () => {
    const history = read();
    return { history, trends: healthTrends(history), host: os.hostname() };
  });
  ipcMain.handle('health-history-now', async () => {
    await record(true);
    const history = read();
    return { history, trends: healthTrends(history), host: os.hostname() };
  });
}
