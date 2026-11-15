/**
 * Windows 11 upgrade assistant: reads the facts from definitions/scripts/windows-upgrade.ps1 and turns them
 * into checks in plain words, a verdict, and the fixes that apply. Windows' own compatibility verdict (the
 * one Windows Update uses) wins over MendKit's reading of the processor name when it is there.
 */

export interface UpgradeFacts {
  admin: boolean;
  product: string;
  edition: string;
  version: string;
  build: number;
  arch: string;
  cpu: string;
  cores: number;
  ramGb: number;
  tpm: { version: string; enabled: boolean; activated: boolean } | null;
  secureBoot: boolean | 'unsupported' | null;
  /** 1 legacy BIOS, 2 UEFI. */
  firmware: number | null;
  partitionStyle: string;
  diskGb: number;
  freeGb: number;
  bitlocker: string | null;
  activated: boolean;
  verdicts: { target: string; upgEx: string; red: string; gated: string; date: string }[];
  bypass: number | null;
}

export type Fix = 'firmware-tpm' | 'firmware-uefi' | 'mbr2gpt' | 'space' | 'activate' | 'bitlocker-key' | 'recheck';
export interface UpgradeCheck {
  id: string;
  name: string;
  level: 'good' | 'attention' | 'problem' | 'unknown';
  message: string;
  fix?: Fix;
  /** A problem that no setting can fix: the hardware itself. */
  hard?: boolean;
}
export interface UpgradePlan {
  state: 'already' | 'ready' | 'fixable' | 'unsupported';
  headline: string;
  checks: UpgradeCheck[];
  /** The registry value Microsoft documents for unsupported processors needs at least TPM 1.2. */
  bypassPossible: boolean;
}

/**
 * Whether a processor is likely on Microsoft's Windows 11 list, from its name. Broadly: Intel 8th generation
 * Core and newer, recent Pentium, Celeron and N-series; AMD Ryzen 2000 (Zen+) and newer. 'unsure' where the
 * name alone cannot tell.
 */
export function cpuLikelySupported(name: string): 'yes' | 'no' | 'unsure' {
  const n = name.replace(/\((R|TM)\)/gi, '').replace(/\s+/g, ' ');
  if (/Snapdragon|Microsoft SQ|Apple/i.test(n)) return 'yes';
  if (/Core Ultra|Core [3579] \d{3}|Intel N\d{2,3}\b|Intel Processor (N|U)?\d{3}/i.test(n)) return 'yes';
  const core = /Core i[3579]-(\d{4,5})/i.exec(n) ?? /Core m[357]-(\d{4})/i.exec(n);
  if (core) {
    const d = core[1];
    const gen = d.length === 5 ? Number(d.slice(0, 2)) : Number(d[0]);
    return gen >= 8 ? 'yes' : gen === 7 ? 'unsure' : 'no';
  }
  if (/Pentium (Gold|Silver)/i.test(n)) return 'yes';
  const celeron = /Celeron (?:[NJG])?(\d{4})/i.exec(n);
  if (celeron) return Number(celeron[1][0]) >= 4 && !/Celeron N[23]\d{3}|Celeron J[13]\d{3}/i.test(n) ? 'yes' : 'no';
  if (/Atom|Core 2|Pentium (Dual|D|4|G\d{3,4}\b|N\d|J\d)|Celeron (M|D|E|B)\d/i.test(n)) return 'no';
  const ryzen = /Ryzen (?:Threadripper )?(?:PRO )?(?:\d )?(?:PRO )?(\d)(\d{3})([A-Z]*)/i.exec(n);
  if (ryzen) {
    const series = Number(ryzen[1]);
    if (series >= 3) return 'yes';
    if (series === 2) return /^GE?$/i.test(ryzen[3]) ? 'no' : /^(U|H|HS)$/i.test(ryzen[3]) ? 'unsure' : 'yes';
    return 'no';
  }
  if (/Ryzen (AI|Z\d)/i.test(n)) return 'yes';
  if (/Athlon (Gold|Silver|3000G|300U|\d{4}[A-Z]?)/i.test(n)) return 'yes';
  if (/Athlon|Phenom|FX-|A\d{1,2}-\d{4}|E\d?-\d{3,4}|Sempron|Turion/i.test(n)) return 'no';
  return 'unsure';
}

const RED_WORDS: Record<string, string> = {
  CpuFms: 'the processor is not on Microsoft\'s list',
  Cpu: 'the processor has too few cores or is too slow',
  Tpm: 'no TPM 2.0 security chip was found',
  UefiSecureBoot: 'the computer does not start in UEFI mode with Secure Boot available',
  Memory: 'less than 4 GB of memory',
  SystemDriveSize: 'the system drive is smaller than 64 GB',
  SystemDriveFull: 'the system drive or its reserved partition is too full',
  SModeState: 'Windows is in S mode',
};
export const redInWords = (red: string): string[] =>
  red.split(/[,\s]+/).filter(Boolean).map((r) => RED_WORDS[r] ?? r);

export function upgradePlan(f: UpgradeFacts): UpgradePlan {
  const checks: UpgradeCheck[] = [];
  const add = (c: UpgradeCheck) => checks.push(c);
  if (f.build >= 22000) {
    return { state: 'already', headline: `This computer already runs ${f.product.replace(/Windows 10/, 'Windows 11')}${f.version ? ` version ${f.version}` : ''}.`, checks, bypassPossible: false };
  }
  const verdict = [...f.verdicts].filter((v) => v.upgEx).sort((a, b) => b.target.localeCompare(a.target))[0];
  const red = verdict?.upgEx === 'Red' ? verdict.red.split(/[,\s]+/).filter(Boolean) : [];

  if (verdict)
    add(
      verdict.upgEx === 'Red'
        ? { id: 'windows', name: 'Windows\' own check', level: 'problem', message: `Windows checked this computer for ${verdict.target} and says it cannot upgrade: ${redInWords(verdict.red).join(', ') || 'no reason given'}.`, fix: 'recheck' }
        : verdict.gated
          ? { id: 'windows', name: 'Windows\' own check', level: 'attention', message: 'Microsoft is holding the upgrade back on this computer for a known problem with a driver or app (a safeguard hold). It is lifted by a later update; updating drivers and apps can help.', fix: 'recheck' }
          : { id: 'windows', name: 'Windows\' own check', level: 'good', message: `Windows checked this computer for ${verdict.target} and found nothing that blocks the upgrade.`, fix: 'recheck' },
    );
  else add({ id: 'windows', name: 'Windows\' own check', level: 'unknown', message: 'Windows has not checked this computer yet. "Check again" asks it to (a few minutes, needs administrator).', fix: 'recheck' });

  if (f.arch !== 'AMD64' && f.arch !== 'ARM64') add({ id: 'arch', name: '64-bit Windows', level: 'problem', hard: true, message: 'This is 32-bit Windows. Windows 11 is 64-bit only, so it cannot be upgraded in place; a clean install is needed, and only if the processor is 64-bit.' });

  const cpuGuess = cpuLikelySupported(f.cpu);
  const cpuRed = red.includes('CpuFms') || red.includes('Cpu');
  const cpuOk = verdict ? !cpuRed : cpuGuess === 'yes';
  add(
    cpuRed || (!verdict && cpuGuess === 'no')
      ? { id: 'cpu', name: 'Processor', level: 'problem', hard: true, message: `${f.cpu} is not on Microsoft's list of Windows 11 processors. This cannot be changed with a setting.` }
      : cpuOk
        ? { id: 'cpu', name: 'Processor', level: 'good', message: `${f.cpu} is supported.` }
        : { id: 'cpu', name: 'Processor', level: 'unknown', message: `${f.cpu} may or may not be on Microsoft's list. Windows' own check gives the answer.` },
  );
  if (f.cores > 0 && f.cores < 2) add({ id: 'cores', name: 'Processor cores', level: 'problem', hard: true, message: 'Windows 11 needs at least two processor cores.' });

  if (!f.tpm) add({ id: 'tpm', name: 'TPM security chip', level: 'unknown', message: 'Restart MendKit as administrator to read the security chip.' });
  else if (f.tpm.version === '2.0') add({ id: 'tpm', name: 'TPM security chip', level: 'good', message: 'TPM 2.0 is present and turned on.' });
  else if (f.tpm.version === 'none')
    add(
      cpuOk
        ? { id: 'tpm', name: 'TPM security chip', level: 'problem', fix: 'firmware-tpm', message: 'No TPM was found. This processor has one built in, so it is almost certainly turned off in the firmware settings: look for Intel PTT, AMD fTPM, Security Device or TPM, and turn it on.' }
        : { id: 'tpm', name: 'TPM security chip', level: 'problem', hard: true, message: 'No TPM security chip was found. Older computers may have one turned off in the firmware settings; otherwise it cannot be added.', fix: 'firmware-tpm' },
    );
  else add({ id: 'tpm', name: 'TPM security chip', level: 'problem', hard: true, message: `TPM ${f.tpm.version} is present. Windows 11 needs 2.0, and an older chip cannot be updated to it.` });

  if (f.firmware === 1 || f.secureBoot === 'unsupported') {
    add(
      /MBR/i.test(f.partitionStyle)
        ? { id: 'uefi', name: 'UEFI start-up', level: 'problem', fix: 'mbr2gpt', message: 'The computer starts in old BIOS (Legacy) mode from a drive with the old MBR layout. MendKit can convert the drive to GPT without losing anything; then switch the firmware to UEFI.' }
        : { id: 'uefi', name: 'UEFI start-up', level: 'problem', fix: 'firmware-uefi', message: 'The computer starts in old BIOS (Legacy) mode. Switch the firmware to UEFI, and turn off CSM or Legacy support.' },
    );
  } else if (f.secureBoot === true) add({ id: 'uefi', name: 'UEFI and Secure Boot', level: 'good', message: 'Starts in UEFI mode with Secure Boot on.' });
  else if (f.secureBoot === false) add({ id: 'uefi', name: 'UEFI and Secure Boot', level: 'attention', fix: 'firmware-uefi', message: 'Starts in UEFI mode, so Secure Boot is available, but it is turned off. The upgrade does not need it on; turning it on in the firmware settings is safer.' });
  else add({ id: 'uefi', name: 'UEFI and Secure Boot', level: 'unknown', message: 'Restart MendKit as administrator to read the start-up mode.' });

  add(f.ramGb >= 3.5 ? { id: 'ram', name: 'Memory', level: 'good', message: `${f.ramGb} GB.` } : { id: 'ram', name: 'Memory', level: 'problem', hard: true, message: `${f.ramGb} GB. Windows 11 needs 4 GB; adding memory may be possible on a desktop or some laptops.` });
  add(f.diskGb >= 64 ? { id: 'disk', name: 'Drive size', level: 'good', message: `${f.diskGb} GB.` } : { id: 'disk', name: 'Drive size', level: 'problem', hard: true, message: `${f.diskGb} GB. Windows 11 needs 64 GB; replace the drive with a larger SSD.` });
  add(f.freeGb >= 30 ? { id: 'free', name: 'Free space', level: 'good', message: `${f.freeGb} GB free.` } : { id: 'free', name: 'Free space', level: 'problem', fix: 'space', message: `Only ${f.freeGb} GB free. The upgrade needs about 30 GB; clear some space first.` });
  if (!f.activated) add({ id: 'activation', name: 'Activation', level: 'attention', fix: 'activate', message: 'Windows is not activated. A Windows 10 licence carries over to Windows 11, but activate it first so the upgrade keeps it.' });
  if (f.bitlocker && f.bitlocker !== 'Off') add({ id: 'bitlocker', name: 'Drive encryption', level: 'attention', fix: 'bitlocker-key', message: 'The drive is encrypted with BitLocker. Make sure the recovery key is saved (in the person\'s Microsoft account or on paper) before changing firmware settings or upgrading.' });

  const problems = checks.filter((c) => c.level === 'problem' && c.id !== 'windows');
  const hard = problems.filter((c) => c.hard);
  const tpmVersion = f.tpm?.version ?? '';
  const bypassPossible = hard.length > 0 && hard.every((c) => c.id === 'cpu' || (c.id === 'tpm' && tpmVersion === '1.2')) && (tpmVersion === '1.2' || tpmVersion === '2.0') && f.ramGb >= 3.5 && f.diskGb >= 64;
  if (hard.length)
    return { state: 'unsupported', headline: 'This computer cannot run Windows 11 as Microsoft supports it. See the choices below.', checks, bypassPossible };
  if (problems.length || red.length)
    return { state: 'fixable', headline: 'Nearly there. Fix the items marked below, then check again.', checks, bypassPossible: false };
  return { state: 'ready', headline: 'This computer is ready for Windows 11. Files, apps and settings are kept.', checks, bypassPossible: false };
}
