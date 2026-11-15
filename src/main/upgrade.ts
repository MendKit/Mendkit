import { app, ipcMain, net, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { ActionStep, Engine } from '../engine/runner';
import { CommandDef } from '../engine/types';
import { upgradePlan, UpgradeFacts } from '../engine/upgrade';
import { isElevated } from './system';

/**
 * Windows 11 upgrade assistant: readiness in plain words, the fixes that apply (firmware settings, MBR to
 * GPT, space, activation), and the upgrade itself through Microsoft's own Installation Assistant.
 */

/** Microsoft's permanent link to the Windows 11 Installation Assistant. */
export const INSTALL_ASSISTANT_URL = 'https://go.microsoft.com/fwlink/?linkid=2171764';

const ps = (id: string, name: string, script: string, ok: string, problem: string, minutes = 2, notes?: NonNullable<CommandDef['friendly']>['notes']): CommandDef => ({
  id, name, description: '', exec: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', script], admin: true, typicalMinutes: minutes, timeoutMinutes: minutes * 4,
  friendly: { title: name, ok, problem, notes },
});
const runPs = (file: string): Promise<string> =>
  new Promise((resolve) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true, timeout: 120000, maxBuffer: 8 * 1024 * 1024 }, (_e, out) => resolve(String(out ?? ''))));

export function registerUpgrade(ctx: { engine: Engine }): void {
  const { engine } = ctx;
  const scripts = path.join(app.getAppPath(), 'definitions', 'scripts');
  const winOnly = () => {
    if (process.platform !== 'win32') throw new Error('The Windows 11 upgrade assistant runs on the Windows computer.');
  };
  const opts = () => ({ elevated: isElevated() });
  let facts: UpgradeFacts | null = null;

  ipcMain.handle('upgrade-check', async () => {
    // MENDKIT_TEST_UPGRADE holds made-up facts, so the screen can be looked at on any system.
    if (!process.env.MENDKIT_TEST_UPGRADE) winOnly();
    try {
      const raw = JSON.parse(process.env.MENDKIT_TEST_UPGRADE ?? (await runPs(path.join(scripts, 'windows-upgrade.ps1'))).trim());
      facts = { ...raw, verdicts: Array.isArray(raw.verdicts) ? raw.verdicts : raw.verdicts ? [raw.verdicts] : [] } as UpgradeFacts;
    } catch {
      throw new Error('This computer\'s details could not be read.');
    }
    return { facts, plan: upgradePlan(facts), elevated: isElevated() };
  });

  /** Asks Windows to run its compatibility check now, the same one Windows Update uses. */
  ipcMain.handle('upgrade-recheck', () => {
    winOnly();
    return engine.runSteps('upgrade-recheck', 'Windows 11 compatibility check', 'command', [
      ps('appraiser', 'Run Windows\' compatibility check', 'Start-Process -FilePath "$env:SystemRoot\\System32\\CompatTelRunner.exe" -ArgumentList \'-m:appraiser.dll -f:DoScheduledTelemetryRun\' -Wait -WindowStyle Hidden; \'done\'', 'Windows checked this computer again. The results are shown below.', 'Windows\' compatibility check did not finish.', 5),
    ], opts());
  });

  ipcMain.handle('upgrade-firmware', () => {
    winOnly();
    return engine.runSteps('upgrade-firmware', 'Restart into firmware settings', 'command', [
      ps('firmware', 'Restart into firmware settings', 'shutdown.exe /r /fw /t 10 2>&1; if ($LASTEXITCODE -ne 0) { exit 1 }; \'restarting\'', 'The computer restarts into its firmware settings in 10 seconds. Save your work now.', 'This computer cannot restart straight into its firmware settings (it starts in old BIOS mode). Restart and press the setup key shown on screen, usually F2, F10, F12 or Delete.', 1),
    ], opts());
  });

  /** MBR to GPT with Microsoft's own tool. Validation must pass first; BitLocker is paused for two restarts. */
  ipcMain.handle('upgrade-mbr2gpt', () => {
    winOnly();
    const bl = facts?.bitlocker && facts.bitlocker !== 'Off';
    const script = [
      "$ErrorActionPreference='Continue'",
      bl ? "manage-bde.exe -protectors -disable $env:SystemDrive -RebootCount 2; 'BitLocker paused for two restarts.'" : '',
      'mbr2gpt.exe /validate /allowFullOS 2>&1',
      "if ($LASTEXITCODE -ne 0) { 'VALIDATE_FAILED'; exit 1 }",
      'mbr2gpt.exe /convert /allowFullOS 2>&1',
      "if ($LASTEXITCODE -ne 0) { 'CONVERT_FAILED'; exit 1 }",
      "'CONVERTED'",
    ].filter(Boolean).join('; ');
    return engine.runSteps('upgrade-mbr2gpt', 'Convert the drive to GPT', 'command', [
      ps('mbr2gpt', 'Convert the system drive from MBR to GPT', script, 'Converted. Now restart into the firmware settings and switch the boot mode to UEFI (turn off CSM or Legacy). The computer will not start until you do.', 'The drive was not converted.', 5, [
        { pattern: 'VALIDATE_FAILED', level: 'problem', message: 'Microsoft\'s conversion tool found a reason it cannot convert this drive safely (often too many partitions, or no room for the new start-up partition). Nothing was changed. The full reason is in the technician log; a clean install of Windows 11 is the way forward.' },
        { pattern: 'CONVERT_FAILED', level: 'problem', message: 'The conversion stopped. Do not restart yet: read the technician log, and run it again or get help.' },
        { pattern: 'CONVERTED', level: 'attention', message: 'Converted. Now restart into the firmware settings and switch the boot mode to UEFI (turn off CSM or Legacy). The computer will not start until you do.' },
      ]),
    ], opts());
  });

  /** Microsoft's documented registry value for processors not on the list (needs TPM 1.2 or later). */
  ipcMain.handle('upgrade-allow-unsupported', () => {
    winOnly();
    return engine.runSteps('upgrade-allow', 'Allow the upgrade on unsupported hardware', 'command', [
      { id: 'mosetup', name: 'Allow Windows Setup to upgrade this computer', description: '', exec: 'reg.exe', args: ['add', 'HKLM\\SYSTEM\\Setup\\MoSetup', '/v', 'AllowUpgradesWithUnsupportedTPMOrCPU', '/t', 'REG_DWORD', '/d', '1', '/f'], admin: true, typicalMinutes: 1, friendly: { title: 'Allow the upgrade', ok: 'Set. Now get the Windows 11 ISO from the ISO Library, open it, and run setup.exe. The Installation Assistant and Windows Update ignore this setting.', problem: 'The setting could not be saved.' } },
    ], opts());
  });

  /** Downloads Microsoft's Installation Assistant, checks Microsoft signed it, and starts it. */
  ipcMain.handle('upgrade-start', () => {
    winOnly();
    const file = path.join(app.getPath('downloads'), 'Windows11InstallationAssistant.exe');
    const step: ActionStep = {
      id: 'assistant',
      name: 'Download and start Microsoft\'s Installation Assistant',
      admin: false,
      ok: 'The Installation Assistant is open. Click Accept and install; it downloads Windows 11 and restarts the computer a few times (about an hour). Files, apps and settings are kept.',
      problem: 'The Installation Assistant could not be started.',
      action: async (write) => {
        write(`Downloading ${INSTALL_ASSISTANT_URL}\n`);
        const res = await net.fetch(INSTALL_ASSISTANT_URL);
        if (!res.ok) return { ok: false, note: `The download failed (${res.status}). Check the internet connection.` };
        fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
        write(`Saved ${file} (${Math.round(fs.statSync(file).size / 1024)} KB)\n`);
        const sig = await new Promise<string>((resolve) =>
          execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$s = Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}'; "$($s.Status)|$($s.SignerCertificate.Subject)"`], { windowsHide: true }, (_e, out) => resolve(String(out ?? '').trim())),
        );
        write(`Signature: ${sig}\n`);
        if (!/^Valid\|.*O=Microsoft Corporation/.test(sig)) {
          fs.rmSync(file, { force: true });
          return { ok: false, note: 'The downloaded file is not signed by Microsoft, so it was deleted and not started.' };
        }
        const err = await shell.openPath(file);
        return err ? { ok: false, note: err } : { ok: true };
      },
    };
    return engine.runSteps('upgrade-start', 'Upgrade to Windows 11', 'command', [step], opts());
  });

  ipcMain.handle('upgrade-open', (_e, what: string) => {
    const links: Record<string, string> = {
      esu: 'ms-settings:windowsupdate',
      activate: 'ms-settings:activation',
      'bitlocker-key': 'https://account.microsoft.com/devices/recoverykey',
      requirements: 'https://www.microsoft.com/windows/windows-11-specifications',
      esuInfo: 'https://www.microsoft.com/windows/extended-security-updates',
    };
    if (!links[what]) throw new Error('Unknown link');
    return shell.openExternal(links[what]);
  });
}
