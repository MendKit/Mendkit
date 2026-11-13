import { Level } from './types';

/** What the upgrade advisor knows about a computer. Unknown values are null. */
export interface AdvisorFacts {
  platform: string;
  ramGb: number | null;
  driveType: 'SSD' | 'HDD' | null;
  driveHealthy: boolean | null;
  freePercent: number | null;
  /** Windows build number (22000 and up is Windows 11). */
  windowsBuild: number | null;
  /** '2.0', '1.2', 'none', or null when it could not be read (needs administrator). */
  tpm: string | null;
  secureBoot: boolean | null;
  cores: number | null;
  driveGb: number | null;
  biosYear: number | null;
  /** Battery full-charge capacity as a percentage of its design capacity. */
  batteryPercent: number | null;
}

export interface Finding {
  id: string;
  level: Level;
  title: string;
  message: string;
}

export interface Advice {
  findings: Finding[];
  verdict: 'keep' | 'upgrade' | 'replace';
  headline: string;
}

/** Turns the facts into plain-language findings and a keep, upgrade or replace verdict. */
export function advise(f: AdvisorFacts, thisYear: number): Advice {
  const out: Finding[] = [];
  const add = (id: string, level: Level, title: string, message: string) => out.push({ id, level, title, message });
  const upgrades: string[] = [];
  let blockers = 0;

  if (f.driveHealthy === false) {
    add('drive-health', 'problem', 'Drive health', 'The system drive reports a problem. Back up now and replace the drive before doing anything else.');
    upgrades.push('a new drive');
  }
  if (f.ramGb !== null) {
    if (f.ramGb < 4) {
      add('memory', 'problem', 'Memory', `${f.ramGb} GB of memory is too little for a current system. 8 GB is the practical minimum.`);
      upgrades.push('more memory');
    } else if (f.ramGb < 8) {
      add('memory', 'attention', 'Memory', `${f.ramGb} GB of memory is tight. 8 GB or more makes a clear difference with a browser and a few apps open.`);
      upgrades.push('more memory');
    } else add('memory', 'good', 'Memory', `${f.ramGb} GB of memory is enough for everyday use${f.ramGb >= 16 ? ' and heavier work' : ''}.`);
  }
  if (f.driveType === 'HDD') {
    add('drive-type', 'attention', 'Drive type', 'The system is on a spinning hard drive. Moving to an SSD is the biggest single speed-up for an older computer.');
    upgrades.push('an SSD');
  } else if (f.driveType === 'SSD') add('drive-type', 'good', 'Drive type', 'The system is on an SSD.');
  if (f.freePercent !== null && f.freePercent < 10) add('free-space', 'attention', 'Free space', `Only ${Math.round(f.freePercent)}% of the system drive is free. Below 10% the system slows down and updates can fail.`);

  if (f.platform === 'win32' && f.windowsBuild !== null) {
    const win11 = f.windowsBuild >= 22000;
    if (win11) add('os', 'good', 'Windows version', 'This computer runs Windows 11, which is still supported.');
    else {
      add('os', 'problem', 'Windows version', 'This computer runs Windows 10, which stopped getting free security updates in October 2025. It should move to Windows 11 or another supported system.');
      // Windows 11 needs TPM 2.0, Secure Boot, 4 GB memory, 64 GB storage and two cores. The processor model list is not checked.
      const missing: string[] = [];
      if (f.tpm !== null && f.tpm !== '2.0') missing.push(f.tpm === 'none' ? 'no TPM security chip' : `TPM ${f.tpm} (2.0 is needed)`);
      if (f.secureBoot === false) missing.push('Secure Boot is off or unsupported');
      if (f.ramGb !== null && f.ramGb < 4) missing.push('less than 4 GB memory');
      if (f.driveGb !== null && f.driveGb < 64) missing.push('a drive smaller than 64 GB');
      if (f.cores !== null && f.cores < 2) missing.push('a single-core processor');
      if (f.tpm === null || f.secureBoot === null) {
        add('win11', 'skipped', 'Windows 11 readiness', 'The security chip and Secure Boot could not be read. Restart MendKit as administrator and run this again.');
      } else if (missing.length) {
        add('win11', 'problem', 'Windows 11 readiness', `This computer does not meet the Windows 11 requirements: ${missing.join(', ')}.${f.secureBoot === false && missing.length === 1 ? ' Secure Boot can often be turned on in the firmware settings.' : ''}`);
        if (!(missing.length === 1 && f.secureBoot === false)) blockers++;
      } else {
        add('win11', 'attention', 'Windows 11 readiness', 'The security chip, Secure Boot, memory and storage all meet the Windows 11 requirements. The processor model was not checked; Windows Update or the PC Health Check app gives the final answer.');
      }
    }
  }

  const age = f.biosYear ? thisYear - f.biosYear : null;
  if (age !== null && age >= 8) add('age', 'info', 'Age', `The firmware dates from ${f.biosYear}, so this computer is probably about ${age} years old or more.`);
  if (f.batteryPercent !== null) {
    if (f.batteryPercent < 60) {
      add('battery', 'attention', 'Battery', `The battery holds about ${Math.round(f.batteryPercent)}% of what it did when new. It is due for replacement.`);
      upgrades.push('a new battery');
    } else add('battery', 'good', 'Battery', `The battery holds about ${Math.min(100, Math.round(f.batteryPercent))}% of what it did when new.`);
  }

  const old = age !== null && age >= 8;
  let verdict: Advice['verdict'] = 'keep';
  let headline = 'Worth keeping. Nothing here calls for new hardware.';
  if (blockers > 0 && (old || upgrades.length >= 2)) {
    verdict = 'replace';
    headline = 'Probably time to replace it. It cannot run a supported version of Windows, and upgrades would cost a good part of a newer computer. Installing Linux or ChromeOS Flex is the low-cost alternative.';
  } else if (old && upgrades.length >= 3) {
    verdict = 'replace';
    headline = `Probably time to replace it. It needs ${list(upgrades)}, which adds up on a computer of this age.`;
  } else if (upgrades.length || blockers > 0) {
    verdict = 'upgrade';
    headline = upgrades.length ? `Worth fixing with ${list(upgrades)}.` : 'Worth keeping, but it cannot move to Windows 11 as it stands. Plan for a replacement or a different system.';
  }
  return { findings: out, verdict, headline };
}

function list(items: string[]): string {
  const u = [...new Set(items)];
  return u.length <= 1 ? u.join('') : `${u.slice(0, -1).join(', ')} and ${u[u.length - 1]}`;
}

/** A 0 to 100 health score from the same facts, for the customer report. */
export function healthScore(f: AdvisorFacts, lastRun?: { problems: number; attention: number }): number {
  let s = 100;
  if (f.driveHealthy === false) s -= 40;
  if (f.freePercent !== null && f.freePercent < 10) s -= 10;
  if (f.ramGb !== null && f.ramGb < 4) s -= 20;
  else if (f.ramGb !== null && f.ramGb < 8) s -= 10;
  if (f.driveType === 'HDD') s -= 10;
  if (f.platform === 'win32' && f.windowsBuild !== null && f.windowsBuild < 22000) s -= 15;
  if (f.batteryPercent !== null && f.batteryPercent < 60) s -= 5;
  if (lastRun) s -= Math.min(20, lastRun.problems * 5) + Math.min(10, lastRun.attention * 2);
  return Math.max(0, Math.min(100, s));
}
