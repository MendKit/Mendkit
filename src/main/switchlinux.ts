import { app, ipcMain } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { gatherFacts } from './advisor';
import { detectApps } from './apps';
import { advise } from '../engine/advisor';
import { AppDef } from '../engine/apps';
import { eolState, windowsEol } from '../engine/eol';
import { Equivalent, linuxEquivalent, switchAdvice, SwitchFacts, vendorOf } from '../engine/switch';
import { powershellScript } from './system';

/** The Windows 10 to Linux switch assistant: can this computer run Linux well, and what replaces each app. */
export function registerSwitchLinux(ctx: { appTable: AppDef[] }): void {
  const defs = path.join(app.getAppPath(), 'definitions');
  const equivalents = JSON.parse(fs.readFileSync(path.join(defs, 'linux-equivalents.json'), 'utf8')) as Equivalent[];

  ipcMain.handle('windows-eol', () => {
    if (process.platform !== 'win32') return null;
    const e = windowsEol(Number(os.release().split('.')[2]) || 0);
    return { ...e, state: eolState(e, new Date()) };
  });

  ipcMain.handle('switch-check', async () => {
    if (process.platform !== 'win32') throw new Error('The switch assistant runs on the Windows computer.');
    const r = await powershellScript(`
$ErrorActionPreference='SilentlyContinue'
$cs=Get-CimInstance Win32_ComputerSystem
$gpu=@(Get-CimInstance Win32_VideoController | ForEach-Object { @{name=$_.Name; id=$_.PNPDeviceID} })
$net=@(Get-PnpDevice -Class Net -PresentOnly | Where-Object { $_.InstanceId -like 'PCI*' -or $_.InstanceId -like 'USB*' } | ForEach-Object { @{name=$_.FriendlyName; id=$_.InstanceId} })
$bio=@(Get-PnpDevice -Class Biometric -PresentOnly).Count
$disk=Get-PhysicalDisk | Sort-Object Size -Descending | Select-Object -First 1
$sb=$null; try { $sb=Confirm-SecureBootUEFI } catch {}
$bl=(New-Object -ComObject Shell.Application).NameSpace('C:').Self.ExtendedProperty('System.Volume.BitLockerProtection')
$fs=(Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power').HiberbootEnabled
$progs=@(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' | Where-Object { $_.DisplayName -and -not $_.SystemComponent } | ForEach-Object { $_.DisplayName } | Sort-Object -Unique)
@{progs=$progs; ram=[math]::Round($cs.TotalPhysicalMemory/1GB); is64=[Environment]::Is64BitOperatingSystem; fw=$env:firmware_type; sb=$sb; gpu=$gpu; net=$net; bio=$bio; dtype=[string]$disk.MediaType; dsize=[math]::Round($disk.Size/1GB); bl=$bl; fast=$fs} | ConvertTo-Json -Depth 4 -Compress`, 60000);
    const arr = (x: any): any[] => (Array.isArray(x) ? x : x ? [x] : []);
    let win11Ok: boolean | null = null;
    try {
      const a = advise(await gatherFacts(), new Date().getFullYear());
      const w = a.findings.find((f) => f.id === 'win11');
      win11Ok = w ? w.level === 'good' : null;
    } catch {
      /* unknown */
    }
    const facts: SwitchFacts = {
      ramGb: Number(r?.ram) || 0,
      is64: r?.is64 !== false,
      uefi: String(r?.fw ?? '').toUpperCase() === 'UEFI',
      secureBoot: typeof r?.sb === 'boolean' ? r.sb : null,
      gpus: arr(r?.gpu).filter((g) => !/basic display|remote/i.test(g.name)).map((g) => ({ name: String(g.name), vendor: vendorOf(String(g.id)) })),
      nets: arr(r?.net).filter((n) => !/virtual|bluetooth|wan miniport|vpn|hyper-v/i.test(n.name)).map((n) => ({ name: String(n.name), vendor: vendorOf(String(n.id)) })),
      fingerprint: Number(r?.bio) > 0,
      driveType: /ssd/i.test(String(r?.dtype)) ? 'SSD' : /hdd/i.test(String(r?.dtype)) ? 'HDD' : String(r?.dtype ?? ''),
      driveGb: Number(r?.dsize) || 0,
      bitlocker: [1, 3, 5].includes(Number(r?.bl)),
      fastStartup: Number(r?.fast) === 1,
      win11Ok,
    };
    const advice = switchAdvice(facts);
    // Apps: the ones MendKit can reinstall on Linux, and replacements for the rest.
    const list = await detectApps(ctx.appTable, 'winget', app.getPath('temp')).catch(() => null);
    const onLinux = (id: string) => {
      const a = ctx.appTable.find((x) => x.id === id);
      return !!a && !!(a.flatpak || a.apt);
    };
    const apps = (list?.apps ?? []).map((id) => ({ name: ctx.appTable.find((a) => a.id === id)?.name ?? id, linux: onLinux(id) ? 'Installs on Linux automatically when you restore the backup' : 'No Linux version', ok: onLinux(id) }));
    const other: { name: string; linux: string; ok: boolean }[] = [];
    const names = arr(r?.progs).map(String).filter((n) => !/^(Microsoft (Visual C\+\+|\.NET|Edge WebView|Update Health)|Windows (SDK|Driver)|Intel|Realtek|NVIDIA|AMD |Dolby|Synaptics|Elan|Conexant)/i.test(n));
    const tableNames = new Set(apps.map((a) => a.name.toLowerCase()));
    for (const n of names) {
      const e = linuxEquivalent(n, equivalents);
      if (e && !other.some((o) => o.name === e.name)) other.push({ name: e.name, linux: e.linux, ok: true });
    }
    const unknown = names.filter((n) => !linuxEquivalent(n, equivalents) && ![...tableNames].some((t) => n.toLowerCase().includes(t))).slice(0, 60);
    return { facts, ...advice, apps, replacements: other, unknown };
  });
}
