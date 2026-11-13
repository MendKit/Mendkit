/**
 * Turns raw crash records (blue screens, sudden power loss, app crashes, kernel panics)
 * into a plain-language finding and a short list of next steps. No system calls here.
 */

export type CrashKind = 'bluescreen' | 'power-loss' | 'app-crash' | 'app-hang' | 'kernel-panic' | 'out-of-memory' | 'hardware-error' | 'disk-error';
export type Cause = 'driver' | 'memory' | 'disk' | 'hardware' | 'heat-power' | 'software' | 'system-files' | 'unknown';

export interface CrashEvent {
  /** ISO time. */
  time: string;
  kind: CrashKind;
  /** Windows stop code as a number (0x9F ...). */
  code?: number;
  /** The app, driver or module named in the record. */
  subject?: string;
  detail?: string;
}

export interface Bugcheck {
  name: string;
  meaning: string;
  cause: Cause;
}

const BUGCHECKS: Record<number, Bugcheck> = {
  0x0a: { name: 'IRQL_NOT_LESS_OR_EQUAL', meaning: 'A driver touched memory it should not have.', cause: 'driver' },
  0x1a: { name: 'MEMORY_MANAGEMENT', meaning: 'Windows found its memory records damaged.', cause: 'memory' },
  0x1e: { name: 'KMODE_EXCEPTION_NOT_HANDLED', meaning: 'A driver or system part hit an error it could not handle.', cause: 'driver' },
  0x24: { name: 'NTFS_FILE_SYSTEM', meaning: 'The file system on a drive reported a serious error.', cause: 'disk' },
  0x3b: { name: 'SYSTEM_SERVICE_EXCEPTION', meaning: 'A driver or system service failed, often a graphics or antivirus driver.', cause: 'driver' },
  0x4e: { name: 'PFN_LIST_CORRUPT', meaning: 'The list Windows uses to track memory was damaged.', cause: 'memory' },
  0x50: { name: 'PAGE_FAULT_IN_NONPAGED_AREA', meaning: 'Something asked for memory that does not exist. Faulty memory or a bad driver are the usual causes.', cause: 'memory' },
  0x7a: { name: 'KERNEL_DATA_INPAGE_ERROR', meaning: 'Windows could not read part of itself back from the drive.', cause: 'disk' },
  0x7b: { name: 'INACCESSIBLE_BOOT_DEVICE', meaning: 'Windows could not reach the drive it starts from.', cause: 'disk' },
  0x7e: { name: 'SYSTEM_THREAD_EXCEPTION_NOT_HANDLED', meaning: 'A driver crashed while starting or running.', cause: 'driver' },
  0x7f: { name: 'UNEXPECTED_KERNEL_MODE_TRAP', meaning: 'The processor reported an error Windows could not handle, often a hardware fault.', cause: 'hardware' },
  0x9c: { name: 'MACHINE_CHECK_EXCEPTION', meaning: 'The processor reported a hardware fault.', cause: 'hardware' },
  0x9f: { name: 'DRIVER_POWER_STATE_FAILURE', meaning: 'A driver did not respond while the computer was going to sleep or waking.', cause: 'driver' },
  0xa0: { name: 'INTERNAL_POWER_ERROR', meaning: 'The power manager failed, usually during sleep or hibernate.', cause: 'driver' },
  0xbe: { name: 'ATTEMPTED_WRITE_TO_READONLY_MEMORY', meaning: 'A driver tried to change protected memory.', cause: 'driver' },
  0xc1: { name: 'SPECIAL_POOL_DETECTED_MEMORY_CORRUPTION', meaning: 'A driver wrote outside its own memory.', cause: 'driver' },
  0xc2: { name: 'BAD_POOL_CALLER', meaning: 'A driver made a bad memory request.', cause: 'driver' },
  0xc4: { name: 'DRIVER_VERIFIER_DETECTED_VIOLATION', meaning: 'Driver Verifier caught a faulty driver.', cause: 'driver' },
  0xc5: { name: 'DRIVER_CORRUPTED_EXPOOL', meaning: 'A driver damaged system memory.', cause: 'driver' },
  0xd1: { name: 'DRIVER_IRQL_NOT_LESS_OR_EQUAL', meaning: 'A driver touched memory at the wrong moment. Network and graphics drivers are common culprits.', cause: 'driver' },
  0xef: { name: 'CRITICAL_PROCESS_DIED', meaning: 'A part of Windows that must keep running stopped. Damaged system files or a failing drive are the usual causes.', cause: 'system-files' },
  0xf4: { name: 'CRITICAL_OBJECT_TERMINATION', meaning: 'A vital Windows process ended unexpectedly, often because the drive stopped answering.', cause: 'disk' },
  0x101: { name: 'CLOCK_WATCHDOG_TIMEOUT', meaning: 'A processor core stopped responding. Overheating, unstable settings or a failing processor can do this.', cause: 'hardware' },
  0x109: { name: 'CRITICAL_STRUCTURE_CORRUPTION', meaning: 'Core Windows data was changed unexpectedly, by a driver or by faulty memory.', cause: 'memory' },
  0x113: { name: 'VIDEO_DXGKRNL_FATAL_ERROR', meaning: 'The graphics system failed.', cause: 'driver' },
  0x116: { name: 'VIDEO_TDR_FAILURE', meaning: 'The graphics driver stopped responding and could not be restarted.', cause: 'driver' },
  0x117: { name: 'VIDEO_TDR_TIMEOUT_DETECTED', meaning: 'The graphics driver took too long to respond.', cause: 'driver' },
  0x119: { name: 'VIDEO_SCHEDULER_INTERNAL_ERROR', meaning: 'The graphics scheduler hit a fatal error.', cause: 'driver' },
  0x124: { name: 'WHEA_UNCORRECTABLE_ERROR', meaning: 'The hardware itself reported a fault: processor, memory, motherboard or power.', cause: 'hardware' },
  0x133: { name: 'DPC_WATCHDOG_VIOLATION', meaning: 'A driver held the processor too long. Storage and network drivers are common culprits.', cause: 'driver' },
  0x139: { name: 'KERNEL_SECURITY_CHECK_FAILURE', meaning: 'Windows found damaged data in memory, from a driver or faulty memory.', cause: 'driver' },
  0x13a: { name: 'KERNEL_MODE_HEAP_CORRUPTION', meaning: 'A driver damaged system memory.', cause: 'driver' },
  0x144: { name: 'BUGCODE_USB3_DRIVER', meaning: 'The USB 3 driver failed.', cause: 'driver' },
  0x154: { name: 'UNEXPECTED_STORE_EXCEPTION', meaning: 'The storage system failed, often a failing drive.', cause: 'disk' },
  0x1ca: { name: 'SYNTHETIC_WATCHDOG_TIMEOUT', meaning: 'The system stopped responding for too long.', cause: 'hardware' },
  0xc000021a: { name: 'WINLOGON_FATAL_ERROR', meaning: 'A core sign-in component failed, usually from damaged system files.', cause: 'system-files' },
  0xc0000221: { name: 'STATUS_IMAGE_CHECKSUM_MISMATCH', meaning: 'A system file or driver is damaged.', cause: 'system-files' },
};

export function bugcheck(code: number): Bugcheck {
  return BUGCHECKS[code >>> 0] ?? { name: `Stop code 0x${(code >>> 0).toString(16).toUpperCase()}`, meaning: 'Windows stopped to protect itself. This stop code is not in MendKit\'s list.', cause: 'unknown' };
}

/** Reads the stop code from a Windows kernel dump header (the first 0x60 bytes are enough). */
export function parseDumpHeader(buf: Buffer): { code: number; params: string[] } | null {
  if (buf.length < 0x60 || buf.toString('latin1', 0, 4) !== 'PAGE') return null;
  const kind = buf.toString('latin1', 4, 8);
  if (kind === 'DU64') {
    return { code: buf.readUInt32LE(0x38), params: [0x40, 0x48, 0x50, 0x58].map((o) => `0x${buf.readBigUInt64LE(o).toString(16)}`) };
  }
  if (kind === 'DUMP') {
    return { code: buf.readUInt32LE(0x20), params: [0x24, 0x28, 0x2c, 0x30].map((o) => `0x${buf.readUInt32LE(o).toString(16)}`) };
  }
  return null;
}

/** Pulls the stop code out of the event-log text "The bugcheck was: 0x0000009f (0x..., ...)". */
export function parseBugcheckMessage(text: string): number | null {
  const m = /bugcheck was:?\s*0x([0-9a-f]{1,8})/i.exec(text) ?? /^\s*0x([0-9a-f]{8})\s*\(/i.exec(text);
  return m ? parseInt(m[1], 16) : null;
}

export interface CrashAdvice {
  text: string;
  /** Something MendKit can start: a recipe, a screen or a built-in action. */
  action?: { label: string; type: 'recipe' | 'screen' | 'memtest'; id: string };
}

export interface CrashFinding {
  title: string;
  count: number;
  last: string;
  level: 'attention' | 'problem' | 'info';
  explanation: string;
}

export interface CrashAnalysis {
  overall: 'good' | 'attention' | 'problem';
  headline: string;
  summary: string;
  days: number;
  findings: CrashFinding[];
  advice: CrashAdvice[];
  events: (CrashEvent & { title: string })[];
}

const CAUSE_TEXT: Record<Cause, string> = {
  driver: 'a faulty or outdated driver',
  memory: 'faulty memory (RAM)',
  disk: 'a failing or damaged drive',
  hardware: 'a hardware fault',
  'heat-power': 'overheating or a power problem',
  software: 'one misbehaving app',
  'system-files': 'damaged system files',
  unknown: 'an unknown cause',
};

export function titleOf(e: CrashEvent): string {
  switch (e.kind) {
    case 'bluescreen':
      return e.code !== undefined ? `Blue screen: ${bugcheck(e.code).name}` : 'Blue screen';
    case 'power-loss':
      return 'Shut down without warning';
    case 'app-crash':
      return `${e.subject || 'An app'} crashed`;
    case 'app-hang':
      return `${e.subject || 'An app'} stopped responding`;
    case 'kernel-panic':
      return 'System crash (kernel panic)';
    case 'out-of-memory':
      return `Ran out of memory${e.subject ? ` and closed ${e.subject}` : ''}`;
    case 'hardware-error':
      return 'Hardware error reported';
    case 'disk-error':
      return 'Drive error reported';
  }
}

export function analyse(events: CrashEvent[], days: number, platform: string): CrashAnalysis {
  const sorted = [...events].sort((a, b) => b.time.localeCompare(a.time));
  const of = (k: CrashKind) => sorted.filter((e) => e.kind === k);
  const blues = of('bluescreen');
  const panics = of('kernel-panic');
  const power = of('power-loss');
  const hw = of('hardware-error');
  const disk = of('disk-error');
  const oom = of('out-of-memory');
  const appEvents = sorted.filter((e) => e.kind === 'app-crash' || e.kind === 'app-hang');
  const findings: CrashFinding[] = [];
  const advice: CrashAdvice[] = [];
  const causes = new Map<Cause, number>();
  const bump = (c: Cause, n = 1) => causes.set(c, (causes.get(c) ?? 0) + n);

  // Blue screens, grouped by stop code.
  const byCode = new Map<number | undefined, CrashEvent[]>();
  for (const e of blues) byCode.set(e.code, [...(byCode.get(e.code) ?? []), e]);
  for (const [code, list] of byCode) {
    const b = code !== undefined ? bugcheck(code) : { name: 'Blue screen', meaning: 'Windows stopped, but the record does not say why.', cause: 'unknown' as Cause };
    bump(b.cause, list.length);
    const drivers = [...new Set(list.map((e) => e.subject).filter(Boolean))];
    findings.push({ title: `${b.name}${code !== undefined ? ` (0x${(code >>> 0).toString(16).toUpperCase()})` : ''}`, count: list.length, last: list[0].time, level: 'problem', explanation: `${b.meaning}${drivers.length ? ` Named in the record: ${drivers.join(', ')}.` : ''}` });
  }
  if (panics.length) {
    bump('unknown', panics.length);
    findings.push({ title: 'System crash (kernel panic)', count: panics.length, last: panics[0].time, level: 'problem', explanation: `The system itself crashed and had to restart.${panics[0].detail ? ` Latest: ${panics[0].detail}` : ''}` });
  }
  if (hw.length) {
    bump('hardware', hw.length * 2);
    findings.push({ title: 'Hardware errors', count: hw.length, last: hw[0].time, level: 'problem', explanation: 'The processor, memory or motherboard reported faults directly. This points at the hardware, not at Windows or an app.' });
  }
  if (disk.length) {
    bump('disk', disk.length);
    findings.push({ title: 'Drive errors', count: disk.length, last: disk[0].time, level: disk.length >= 3 ? 'problem' : 'attention', explanation: 'The system logged errors reading from or writing to a drive. Back up important files before anything else.' });
  }
  if (power.length) {
    // A blue screen is also followed by a power-loss record; only count the ones with no blue screen nearby.
    const lone = power.filter((p) => !blues.some((b) => Math.abs(Date.parse(b.time) - Date.parse(p.time)) < 10 * 60 * 1000));
    if (lone.length) {
      bump('heat-power', lone.length);
      findings.push({ title: 'Shut down without warning', count: lone.length, last: lone[0].time, level: lone.length >= 3 ? 'problem' : 'attention', explanation: 'The computer lost power or froze and was switched off, with no crash record. Overheating, a weak power supply or battery, or holding the power button cause this.' });
    }
  }
  if (oom.length) {
    bump('software', oom.length);
    findings.push({ title: 'Ran out of memory', count: oom.length, last: oom[0].time, level: 'attention', explanation: `The system closed programs because memory ran out.${oom[0].subject ? ` Most recently: ${oom[0].subject}.` : ''} Fewer open programs or more memory fixes this.` });
  }
  // App crashes, grouped by app; only repeat offenders are worth a finding.
  const byApp = new Map<string, CrashEvent[]>();
  for (const e of appEvents) byApp.set(e.subject || 'Unknown app', [...(byApp.get(e.subject || 'Unknown app') ?? []), e]);
  const repeat = [...byApp.entries()].filter(([, l]) => l.length >= 2).sort((a, b) => b[1].length - a[1].length);
  for (const [name, list] of repeat.slice(0, 6)) {
    const mods = [...new Set(list.map((e) => e.detail).filter(Boolean))].slice(0, 2);
    findings.push({ title: `${name} keeps crashing`, count: list.length, last: list[0].time, level: list.length >= 5 ? 'attention' : 'info', explanation: `This app crashed or froze ${list.length} times.${mods.length ? ` Failing part: ${mods.join(', ')}.` : ''} Updating or reinstalling it is the usual fix.` });
  }
  if (repeat.length >= 4 && !blues.length) bump('memory', 1), bump('system-files', 1);
  else if (repeat.length) bump('software', 1);

  const system = blues.length + panics.length + hw.length;
  const top = [...causes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const win = platform === 'win32';
  const add = (text: string, action?: CrashAdvice['action']) => advice.push({ text, action });
  if (disk.length || causes.has('disk')) {
    add('Back up important files now, before running any repair. A drive that is failing can stop without warning.', { label: 'Back up files', type: 'screen', id: 'migrate' });
    add('Check the drive\'s health.', { label: 'Run the health report', type: 'recipe', id: 'health-report' });
  }
  if (causes.has('driver')) {
    add('Update drivers, starting with graphics, network and storage. The maker\'s own update tool is the safest source.', { label: 'Open Updates', type: 'screen', id: 'updates' });
    if (blues.some((e) => e.code === 0x9f || e.code === 0xa0)) add('These crashes happen around sleep and wake. If updating drivers does not help, turn off Fast Startup in Tweaks.', { label: 'Open Tweaks', type: 'screen', id: 'tweaks' });
  }
  if (causes.has('memory') || causes.has('hardware')) {
    if (win) add('Test the memory. The test restarts the computer and takes 15 to 30 minutes.', { label: 'Schedule a memory test', type: 'memtest', id: 'memtest' });
    else add('Test the memory with MemTest86+ from the ISO Library.', { label: 'Open the ISO Library', type: 'screen', id: 'isos' });
    add('Run the processor stress test and watch the temperatures. A crash during the test confirms a hardware or cooling fault.', { label: 'Open Hardware Tests', type: 'screen', id: 'hardware' });
  }
  if (causes.has('heat-power')) {
    add('Check for overheating: clean the vents and fans, and run the stress test to see how hot it gets.', { label: 'Open Hardware Tests', type: 'screen', id: 'hardware' });
    add('On a laptop, check the battery and charger. On a desktop, a failing power supply causes the same symptom.', { label: 'Run the health report', type: 'recipe', id: 'health-report' });
  }
  if (causes.has('system-files') || (system && !causes.has('disk'))) add('Repair the system files.', { label: 'Run the crash repair', type: 'recipe', id: 'crashing' });
  if (repeat.length) add(`Update or reinstall the apps that keep crashing: ${repeat.slice(0, 4).map(([n]) => n).join(', ')}.`, { label: 'Open Updates', type: 'screen', id: 'updates' });
  if (causes.get('unknown') && !advice.length) add('Run the crash repair, then watch whether the crashes return.', { label: 'Run the crash repair', type: 'recipe', id: 'crashing' });

  const overall: CrashAnalysis['overall'] = system || findings.some((f) => f.level === 'problem') ? 'problem' : findings.some((f) => f.level === 'attention') ? 'attention' : 'good';
  const headline = overall === 'good' ? (findings.length ? 'No serious crashes found' : 'No crashes found') : top ? `The most likely cause is ${CAUSE_TEXT[top]}` : 'Crashes were found';
  const parts: string[] = [];
  if (blues.length) parts.push(`${blues.length} blue screen${blues.length === 1 ? '' : 's'}`);
  if (panics.length) parts.push(`${panics.length} system crash${panics.length === 1 ? '' : 'es'}`);
  if (hw.length) parts.push(`${hw.length} hardware error${hw.length === 1 ? '' : 's'}`);
  if (disk.length) parts.push(`${disk.length} drive error${disk.length === 1 ? '' : 's'}`);
  if (power.length) parts.push(`${power.length} sudden shutdown${power.length === 1 ? '' : 's'}`);
  if (oom.length) parts.push(`${oom.length} out-of-memory event${oom.length === 1 ? '' : 's'}`);
  if (appEvents.length) parts.push(`${appEvents.length} app crash${appEvents.length === 1 ? '' : 'es'} or freeze${appEvents.length === 1 ? '' : 's'}`);
  const summary = parts.length ? `In the last ${days} days: ${parts.join(', ')}.` : `Nothing was recorded in the last ${days} days.`;
  return { overall, headline, summary, days, findings, advice, events: sorted.slice(0, 200).map((e) => ({ ...e, title: titleOf(e) })) };
}
