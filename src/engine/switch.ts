/** Windows-to-Linux switch: hardware verdicts and app replacements, kept free of system calls so they can be tested. */

export interface Equivalent {
  match: string[];
  name: string;
  linux: string;
  app?: string;
}

/** Finds the Linux replacement for a Windows program name, matching whole words only ("Word", not "1Password"). */
export function linuxEquivalent(program: string, list: Equivalent[]): Equivalent | null {
  const p = program.toLowerCase();
  for (const e of list) {
    for (const m of e.match) {
      const re = new RegExp(`(^|[^a-z0-9])${m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`);
      if (re.test(p)) return e;
    }
  }
  return null;
}

export interface SwitchFacts {
  ramGb: number;
  is64: boolean;
  uefi: boolean;
  secureBoot: boolean | null;
  gpus: { name: string; vendor: string }[];
  nets: { name: string; vendor: string }[];
  fingerprint: boolean;
  driveType: string;
  driveGb: number;
  bitlocker: boolean;
  fastStartup: boolean;
  win11Ok: boolean | null;
}
export interface SwitchCheck {
  level: 'good' | 'attention' | 'problem' | 'info';
  title: string;
  text: string;
}

const VENDOR: Record<string, string> = { '10de': 'NVIDIA', '1002': 'AMD', '8086': 'Intel', '14e4': 'Broadcom', '10ec': 'Realtek', '14c3': 'MediaTek', '168c': 'Qualcomm Atheros', '17cb': 'Qualcomm' };
export const vendorOf = (pnpId: string): string => VENDOR[(/VEN_([0-9A-F]{4})/i.exec(pnpId)?.[1] ?? '').toLowerCase()] ?? '';

export function switchAdvice(f: SwitchFacts): { verdict: 'good' | 'extra-steps' | 'not-recommended'; distro: string; distroId: string; checks: SwitchCheck[] } {
  const c: SwitchCheck[] = [];
  if (!f.is64) c.push({ level: 'problem', title: 'Processor', text: 'This is a 32-bit computer. Almost no current Linux supports it any more.' });
  if (f.ramGb < 2) c.push({ level: 'problem', title: 'Memory', text: `${f.ramGb} GB of memory is too little for a modern desktop. Add memory first.` });
  else if (f.ramGb < 4) c.push({ level: 'attention', title: 'Memory', text: `${f.ramGb} GB of memory: choose a light edition (Linux Mint Xfce or Xubuntu).` });
  else c.push({ level: 'good', title: 'Memory', text: `${f.ramGb} GB of memory is plenty.` });
  c.push(f.driveType === 'HDD' ? { level: 'attention', title: 'Drive', text: 'A spinning hard drive: Linux runs, but an SSD would make it far faster. A good time to fit one.' } : { level: 'good', title: 'Drive', text: `${f.driveType || 'Drive'}, ${f.driveGb} GB.` });
  const nv = f.gpus.find((g) => g.vendor === 'NVIDIA');
  if (nv) c.push({ level: 'attention', title: 'Graphics', text: `${nv.name}: works straight away, but install NVIDIA's driver afterwards for full speed (Linux Mint offers it on first start; MendKit's "Missing drivers" does it too).` });
  else c.push({ level: 'good', title: 'Graphics', text: `${f.gpus.map((g) => g.name).join(', ') || 'Graphics'}: drivers are built into Linux.` });
  const bc = f.nets.find((n) => n.vendor === 'Broadcom' && /wireless|wi-?fi|802\.11/i.test(n.name));
  if (bc) c.push({ level: 'attention', title: 'Wi-Fi', text: `${bc.name} needs an extra driver. Plug in a network cable (or share a phone's connection by USB) during and after installing, then run "Missing drivers".` });
  else if (f.nets.length) c.push({ level: 'good', title: 'Network', text: `${f.nets.map((n) => n.name).join(', ')}: supported.` });
  if (f.fingerprint) c.push({ level: 'info', title: 'Fingerprint reader', text: 'Many laptop fingerprint readers do not work on Linux. Sign in with the password instead.' });
  if (f.bitlocker) c.push({ level: 'attention', title: 'BitLocker', text: 'The Windows drive is encrypted with BitLocker. Back up the files first, and save the recovery key from aka.ms/myrecoverykey if Windows is being kept alongside Linux.' });
  if (f.fastStartup) c.push({ level: 'info', title: 'Fast Startup', text: 'Windows Fast Startup is on. If Windows stays installed alongside Linux, turn it off so Linux can read the Windows drive safely.' });
  c.push({ level: 'info', title: 'Start-up mode', text: f.uefi ? `UEFI${f.secureBoot ? ' with Secure Boot on. Mint, Ubuntu, Zorin and Fedora start with it on' : ''}.` : 'Legacy BIOS. Linux supports it; make the USB stick with MBR in Rufus or use Ventoy.' });
  if (f.win11Ok) c.push({ level: 'info', title: 'Windows 11', text: 'This computer can also run Windows 11 for free. Linux is still a good choice; it just is not the only one.' });
  const verdict = c.some((x) => x.level === 'problem') ? 'not-recommended' : c.some((x) => x.level === 'attention') ? 'extra-steps' : 'good';
  const light = f.ramGb < 4;
  return { verdict, checks: c, distro: light ? 'Linux Mint Xfce edition' : 'Linux Mint Cinnamon edition', distroId: light ? 'xubuntu' : 'mint' };
}
