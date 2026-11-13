import { execFile, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';

export interface SystemInfo {
  platform: string;
  hostname: string;
  osName: string;
  cpu: string;
  memoryGb: number;
  diskFreeGb: number | null;
  diskTotalGb: number | null;
  drives: { name: string; type: string; health: string }[];
  elevated: boolean;
}

let elevatedCache: boolean | null = null;
/** Whether MendKit has administrator rights. This cannot change while it runs, so it is worked out once. */
export function isElevated(): boolean {
  if (elevatedCache === null) {
    elevatedCache = process.platform === 'win32' ? spawnSync('net.exe', ['session'], { windowsHide: true, stdio: 'ignore' }).status === 0 : typeof process.getuid === 'function' && process.getuid() === 0;
  }
  return elevatedCache;
}

function powershellJson(command: string): Promise<unknown> {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true, timeout: 20000 }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve(null);
      }
    });
  });
}

export async function getDrives(): Promise<SystemInfo['drives']> {
  if (process.platform !== 'win32') return [];
  const raw = await powershellJson('Get-PhysicalDisk | Select-Object FriendlyName, MediaType, HealthStatus | ConvertTo-Json -Compress');
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((d: any) => ({ name: String(d.FriendlyName ?? 'Drive'), type: String(d.MediaType ?? ''), health: String(d.HealthStatus ?? 'Unknown') }));
}

function disk(): { free: number | null; total: number | null } {
  try {
    const s = fs.statfsSync(process.platform === 'win32' ? 'C:\\' : '/');
    const gb = (blocks: number) => Math.round((blocks * s.bsize) / 1024 ** 3);
    return { free: gb(s.bavail), total: gb(s.blocks) };
  } catch {
    return { free: null, total: null };
  }
}

export async function getSystemInfo(): Promise<SystemInfo> {
  const d = disk();
  const names: Record<string, string> = { win32: 'Windows', darwin: 'macOS', linux: 'Linux' };
  return {
    platform: process.platform,
    hostname: os.hostname(),
    osName: `${names[process.platform] ?? process.platform} ${os.release()}${typeof os.version === 'function' ? ` (${os.version()})` : ''}`,
    cpu: os.cpus()[0]?.model.trim() ?? 'Unknown',
    memoryGb: Math.round(os.totalmem() / 1024 ** 3),
    diskFreeGb: d.free,
    diskTotalGb: d.total,
    // Drive health needs PowerShell, which is slow to start; the Dashboard asks for it separately.
    drives: [],
    elevated: isElevated(),
  };
}

// ---------- Full specs and temperatures ----------

export interface SpecSection {
  title: string;
  rows: { k: string; v: string }[];
}
export interface Temp {
  name: string;
  celsius: number;
  source: string;
}
export interface TempReport {
  temps: Temp[];
  note?: string;
}

export function powershellScript(script: string, timeoutMs = 30000): Promise<any> {
  // UTF-8 output keeps names with accents or symbols intact; no progress records keeps stdout pure JSON.
  const encoded = Buffer.from(`$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.Encoding]::UTF8;${script}`, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (_err, stdout) => {
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve(null);
      }
    });
  });
}

const arr = (x: any): any[] => (Array.isArray(x) ? x : x === null || x === undefined ? [] : [x]);
const gb = (bytes: any): string => (Number(bytes) > 0 ? `${Math.round(Number(bytes) / 1024 ** 3)} GB` : '');
const str = (x: any): string => (x === null || x === undefined ? '' : String(x).trim());

const WIN_SPECS = `
$ErrorActionPreference='SilentlyContinue'
$cs=Get-CimInstance Win32_ComputerSystem; $bios=Get-CimInstance Win32_BIOS; $bb=Get-CimInstance Win32_BaseBoard; $os=Get-CimInstance Win32_OperatingSystem
[pscustomobject]@{
  cs=$cs | Select-Object Manufacturer,Model,SystemType
  bios=$bios | Select-Object SMBIOSBIOSVersion,SerialNumber,@{n='Date';e={$_.ReleaseDate.ToString('yyyy-MM-dd')}}
  board=$bb | Select-Object Manufacturer,Product
  os=$os | Select-Object Caption,Version,BuildNumber,OSArchitecture,@{n='Installed';e={$_.InstallDate.ToString('yyyy-MM-dd')}},@{n='Boot';e={$_.LastBootUpTime.ToString('yyyy-MM-dd HH:mm')}}
  cpu=@(Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed,SocketDesignation)
  mem=@(Get-CimInstance Win32_PhysicalMemory | Select-Object Capacity,Speed,Manufacturer,PartNumber,DeviceLocator)
  slots=(Get-CimInstance Win32_PhysicalMemoryArray | Measure-Object MemoryDevices -Sum).Sum
  gpu=@(Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,CurrentHorizontalResolution,CurrentVerticalResolution,CurrentRefreshRate)
  disk=@(Get-PhysicalDisk | Select-Object FriendlyName,MediaType,BusType,Size,HealthStatus)
  vol=@(Get-Volume | Where-Object DriveLetter | Select-Object DriveLetter,FileSystemLabel,FileSystem,Size,SizeRemaining)
  net=@(Get-NetAdapter -Physical | Select-Object Name,InterfaceDescription,Status,LinkSpeed)
  bat=@(Get-CimInstance Win32_Battery | Select-Object Name,EstimatedChargeRemaining,DesignVoltage)
} | ConvertTo-Json -Depth 4 -Compress
`;

const WIN_TEMPS = `
$ErrorActionPreference='SilentlyContinue'; $out=@()
$lhm=@(Get-CimInstance -Namespace root/LibreHardwareMonitor -ClassName Sensor | Where-Object SensorType -eq 'Temperature')
if($lhm.Count){
  $hw=@{}; Get-CimInstance -Namespace root/LibreHardwareMonitor -ClassName Hardware | ForEach-Object { $hw[$_.Identifier]=$_.Name }
  foreach($s in $lhm){ $out+=[pscustomobject]@{name=($hw[$s.Parent]+' - '+$s.Name); c=[math]::Round($s.Value,1); source='LibreHardwareMonitor'} }
} else {
  Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature | ForEach-Object { $out+=[pscustomobject]@{name='System thermal zone'; c=[math]::Round($_.CurrentTemperature/10-273.15,1); source='ACPI'} }
  Get-PhysicalDisk | ForEach-Object { $r=$_ | Get-StorageReliabilityCounter; if($r.Temperature){ $out+=[pscustomobject]@{name=('Drive - '+$_.FriendlyName); c=[double]$r.Temperature; source='Drive SMART'} } }
  $n = & nvidia-smi --query-gpu=name,temperature.gpu --format=csv,noheader,nounits 2>$null
  foreach($l in $n){ $p=$l -split ','; if($p.Count -ge 2){ $out+=[pscustomobject]@{name=('GPU - '+$p[0].Trim()); c=[double]$p[1]; source='NVIDIA'} } }
}
ConvertTo-Json -InputObject @($out) -Compress
`;

function section(title: string, pairs: [string, any][]): SpecSection {
  return { title, rows: pairs.map(([k, v]) => ({ k, v: str(v) })).filter((r) => r.v !== '') };
}

async function windowsSpecs(): Promise<SpecSection[]> {
  const d = await powershellScript(WIN_SPECS);
  if (!d) return [];
  const out: SpecSection[] = [];
  out.push(
    section('Computer', [
      ['Manufacturer', d.cs?.Manufacturer],
      ['Model', d.cs?.Model],
      ['Type', d.cs?.SystemType],
      ['Serial number', d.bios?.SerialNumber],
      ['Motherboard', [str(d.board?.Manufacturer), str(d.board?.Product)].filter(Boolean).join(' ')],
      ['BIOS', [str(d.bios?.SMBIOSBIOSVersion), str(d.bios?.Date)].filter(Boolean).join(', ')],
    ]),
    section('Windows', [
      ['Edition', d.os?.Caption],
      ['Version', d.os?.Version ? `${d.os.Version} (build ${d.os.BuildNumber})` : ''],
      ['Architecture', d.os?.OSArchitecture],
      ['Installed', d.os?.Installed],
      ['Last started', d.os?.Boot],
    ]),
  );
  arr(d.cpu).forEach((c, i, all) =>
    out.push(
      section(all.length > 1 ? `Processor ${i + 1}` : 'Processor', [
        ['Model', c.Name],
        ['Cores', c.NumberOfCores ? `${c.NumberOfCores} cores, ${c.NumberOfLogicalProcessors} threads` : ''],
        ['Top speed', c.MaxClockSpeed ? `${(c.MaxClockSpeed / 1000).toFixed(2)} GHz` : ''],
        ['Socket', c.SocketDesignation],
      ]),
    ),
  );
  const mem = arr(d.mem);
  const total = mem.reduce((s, m) => s + Number(m.Capacity || 0), 0);
  out.push(
    section('Memory', [
      ['Installed', total ? `${gb(total)} in ${mem.length} module${mem.length === 1 ? '' : 's'}${d.slots ? ` (${d.slots} slots)` : ''}` : ''],
      ...mem.map((m, i): [string, any] => [str(m.DeviceLocator) || `Module ${i + 1}`, [gb(m.Capacity), m.Speed ? `${m.Speed} MHz` : '', str(m.Manufacturer), str(m.PartNumber)].filter(Boolean).join(', ')]),
    ]),
  );
  out.push(
    section(
      'Graphics',
      arr(d.gpu).map((g, i): [string, any] => [
        `Adapter ${i + 1}`,
        [str(g.Name), g.CurrentHorizontalResolution ? `${g.CurrentHorizontalResolution} x ${g.CurrentVerticalResolution} at ${g.CurrentRefreshRate} Hz` : '', g.DriverVersion ? `driver ${g.DriverVersion}` : ''].filter(Boolean).join(', '),
      ]),
    ),
    section(
      'Storage',
      [
        ...arr(d.disk).map((x, i): [string, any] => [`Drive ${i + 1}`, [str(x.FriendlyName), gb(x.Size), str(x.MediaType), str(x.BusType), str(x.HealthStatus)].filter(Boolean).join(', ')]),
        ...arr(d.vol).map((v): [string, any] => [`${v.DriveLetter}:${v.FileSystemLabel ? ` (${v.FileSystemLabel})` : ''}`, `${gb(v.SizeRemaining) || '0 GB'} free of ${gb(v.Size)}, ${str(v.FileSystem)}`]),
      ],
    ),
    section(
      'Network',
      arr(d.net).map((n): [string, any] => [str(n.Name), [str(n.InterfaceDescription), str(n.Status), n.Status === 'Up' ? str(n.LinkSpeed) : ''].filter(Boolean).join(', ')]),
    ),
    section(
      'Battery',
      arr(d.bat).map((b): [string, any] => [str(b.Name) || 'Battery', b.EstimatedChargeRemaining !== null && b.EstimatedChargeRemaining !== undefined ? `${b.EstimatedChargeRemaining}% charged` : '']),
    ),
  );
  return out.filter((s) => s.rows.length > 0);
}

function genericSpecs(): SpecSection[] {
  const cpus = os.cpus();
  const d = disk();
  const nets = Object.entries(os.networkInterfaces())
    .filter(([, a]) => (a ?? []).some((x) => !x.internal))
    .map(([name, a]): [string, any] => [name, (a ?? []).filter((x) => x.family === 'IPv4').map((x) => x.address).join(', ') || 'connected']);
  let model = '';
  try {
    model = [fs.readFileSync('/sys/class/dmi/id/sys_vendor', 'utf8'), fs.readFileSync('/sys/class/dmi/id/product_name', 'utf8')].map((s) => s.trim()).join(' ');
  } catch {
    /* not available on this system */
  }
  return [
    section('Computer', [
      ['Name', os.hostname()],
      ['Model', model],
      ['Architecture', os.arch()],
    ]),
    section('System', [
      ['Type', os.type()],
      ['Release', os.release()],
      ['Version', os.version()],
      ['Running for', `${Math.round(os.uptime() / 3600)} hours`],
    ]),
    section('Processor', [
      ['Model', cpus[0]?.model],
      ['Threads', cpus.length],
    ]),
    section('Memory', [
      ['Installed', gb(os.totalmem())],
      ['Free now', gb(os.freemem())],
    ]),
    section('Storage', [['System drive', d.total !== null ? `${d.free} GB free of ${d.total} GB` : '']]),
    section('Network', nets),
  ].filter((s) => s.rows.length > 0);
}

let specsCache: Promise<SpecSection[]> | null = null;
/** Hardware details do not change while MendKit runs, so they are read once. */
export function getSpecs(): Promise<SpecSection[]> {
  specsCache ??= (async () => {
    if (process.platform === 'win32') {
      const s = await windowsSpecs();
      if (s.length) return s;
      specsCache = null; // PowerShell failed: try again next time
    }
    return genericSpecs();
  })();
  return specsCache;
}

function linuxTemps(): Temp[] {
  const out: Temp[] = [];
  const base = '/sys/class/hwmon';
  const read = (f: string) => fs.readFileSync(f, 'utf8').trim();
  try {
    for (const h of fs.readdirSync(base)) {
      const dir = `${base}/${h}`;
      let chip = h;
      try {
        chip = read(`${dir}/name`);
      } catch {
        /* unnamed chip */
      }
      for (const f of fs.readdirSync(dir).filter((x) => /^temp\d+_input$/.test(x))) {
        try {
          const c = Number(read(`${dir}/${f}`)) / 1000;
          let label = f.replace('_input', '');
          try {
            label = read(`${dir}/${f.replace('_input', '_label')}`);
          } catch {
            /* no label */
          }
          if (c > 0 && c < 150) out.push({ name: `${chip} - ${label}`, celsius: Math.round(c * 10) / 10, source: 'hwmon' });
        } catch {
          /* unreadable sensor */
        }
      }
    }
  } catch {
    /* no hwmon */
  }
  return out;
}

let tempsBusy: Promise<TempReport> | null = null;
/** Only one reading runs at a time; a second request made meanwhile shares its answer. */
export function getTemps(): Promise<TempReport> {
  tempsBusy ??= readTemps().finally(() => (tempsBusy = null));
  return tempsBusy;
}

async function readTemps(): Promise<TempReport> {
  if (process.platform === 'win32') {
    const raw = arr(await powershellScript(WIN_TEMPS, 20000));
    const temps: Temp[] = raw
      .map((t) => ({ name: str(t.name), celsius: Number(t.c), source: str(t.source) }))
      .filter((t) => t.name && t.celsius > 0 && t.celsius < 150);
    const full = temps.some((t) => t.source === 'LibreHardwareMonitor');
    const note = full
      ? undefined
      : 'Windows does not report processor temperature on its own. For processor, graphics and motherboard temperatures, install LibreHardwareMonitor from the Tools screen and leave it open. Drive temperatures need MendKit to run as administrator.';
    return { temps, note };
  }
  if (process.platform === 'linux') {
    const temps = linuxTemps();
    return { temps, note: temps.length ? undefined : 'No temperature sensors were found. Installing lm-sensors usually adds them.' };
  }
  return { temps: [], note: 'Temperature readings on macOS arrive with the macOS pack.' };
}
