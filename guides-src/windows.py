from lib import *
GR = 'Windows'
W = 'Windows 10 and 11'
GUIDES = [
G('mk-win-tools', 'Using MendKit', 'Windows tools', 'The Windows tools on the Repair screen, step by step.', [
 sec('Before you start', [
  S('Restart MendKit as administrator (Dashboard, Restart as administrator, then Yes).', tip='Without it, MendKit can only change items for your own account.'),
  'Tick Technician mode at the bottom left, open Repair. Windows tools is the first section.']),
 sec('Startup items', [
  S('Click Open beside Startup items, then Scan.', see='After up to a minute: programs that start when you sign in, scheduled tasks at sign-in or start-up, and background services, each with who made it and what it runs.'),
  S('Look for items marked "not signed", items marked "program missing" (leftovers), and names you do not recognise.', tip='Items marked "hardware helper" belong to the sound, touchpad or graphics maker. Leave them on unless you know they are not needed. Items marked "part of Windows" cannot be ticked.'),
  S('Tick what to stop and click Turn off selected.', see='Results for each item. Programs stay installed; services still start when a program needs them.'),
  S('Restart and check everything still works.'),
  S('To undo, scan again and click Turn back on beside the item under Turned off. Items turned off here also show as Disabled in Task Manager\'s Startup apps, and can be turned on there too.')], 'steps'),
 sec('Free up space', [
  S('Click Open beside Free up space, then Measure.', see='After a minute or two: free space, then each kind of clearable file with its size. The safe ones are ticked.', tip='Close the browsers first if you want their caches cleared.'),
  S('Decide about the unticked ones.', warn='Windows.old lets you undo the last Windows upgrade: once it is deleted you cannot go back. Crash dump files are what the Crash Analyzer reads, so run it first. Removing the hibernation file also turns off Fast Startup.'),
  S('Tick device backups only if the iPhone or iPad is backed up to iCloud or no longer used.'),
  S('Click Delete selected.', see='Results for each item. Windows.old and upgrade leftovers open Windows\' own Disk Cleanup progress window; let it finish.'),
  S('Large files and the Downloads folder are only listed. Click Show in folder and decide about them yourself.')], 'steps')],
 systems=W, time='10 minutes', level='Takes care', screen='repair', related=['autoruns', 'mk-repair']),
G('win-security', GR, 'Securing a Windows computer', 'Checking antivirus, firewall, encryption, updates and accounts, and fixing what is off.', [
 sec('Check', [
  S('On the Dashboard, under Other fixes, click Run beside Security checkup, then Start.', tip='Restart MendKit as administrator first so Secure Boot can be checked.'),
  S('Read each line.', see='One result each for antivirus, firewall, drive encryption, account protection and SmartScreen, Windows Update, Secure Boot, administrator accounts and remote access. Each red or amber line says what to do.')], 'steps'),
 sec('Fix in one run', [
  S('Tick Technician mode, open Repair, and run Secure this computer.', see='A restore point first, then: firewall on, Defender on (unless another antivirus is protecting the computer), Defender updated, User Account Control and SmartScreen back to normal, Windows Update resumed, Guest account off, then the checkup again.'),
  S('Restart if the results ask you to.')], 'steps'),
 sec('Fixes that are not automatic', [
  S('Remote Desktop: if nobody connects to this computer remotely, run "Turn off Remote Desktop" from Repair.', warn='If a technician or employer connects with Remote Desktop, leave it on.'),
  S('SMBv1: run "Turn off SMBv1" unless a very old network drive or a printer that scans to a folder needs it. Restart afterwards.'),
  S('Drive encryption: on Windows Pro, Settings, Privacy & security, Device encryption or BitLocker. Save the recovery key to the person\'s Microsoft account first.', warn='Without the recovery key, an encrypted drive cannot be read if Windows breaks.'),
  S('Secure Boot: turn it on in the computer\'s firmware settings (usually F2 or Del at start-up, under Boot or Security).')]),
 sec('After a scam', ['Run the remote access audit and Pop-ups or strange behaviour as well. See "Staying safe: scams and fake support".'])],
 systems=W, time='10 minutes', level='Easy', screen='dashboard', related=['basics-safety', 'remote-audit', 'mk-win-tools']),
G('win11-upgrade', GR, 'Upgrading to Windows 11', 'Checking whether a Windows 10 computer can run Windows 11, fixing what can be fixed, and doing the upgrade without losing anything.', [
 sec('Before you start', [
  S('Back up the person\'s files first: Migrate, Back up to a drive.', tip='The upgrade keeps files, apps and settings, but a power cut or a failing drive in the middle can lose them.'),
  S('Restart MendKit as administrator (Dashboard, Restart as administrator, then Yes).', tip='Without it, the security chip (TPM), the start-up mode and BitLocker cannot be read.'),
  'Plug a laptop into power. Allow about an hour for the upgrade itself.']),
 sec('Check', [
  S('Open the Windows 11 upgrade: from the Dashboard notice, or tick Technician mode, open Repair, and click Open beside Windows 11 upgrade under Windows tools.', see='After a few seconds: one line per requirement, each green, amber or red, with a button where something can be fixed.'),
  S('Read "Windows\' own check" first.', see='This is the same answer Windows Update uses. If it says Windows has not checked yet, click Ask Windows to check and wait a few minutes.'),
  S('Read the rest.', tip='A red line with a button can be fixed. A red line without one (an old processor, too little memory) is the hardware itself.')], 'steps'),
 sec('Fixes', [
  S('No TPM found, on a newer processor: click Restart into firmware settings, then click it again.', see='The computer restarts into its firmware (BIOS) settings in 10 seconds.', tip='Look under Security, Advanced or Trusted Computing for Intel PTT, AMD fTPM, Security Device Support or TPM, and set it to Enabled. Save and exit, usually with F10.'),
  S('Old BIOS (Legacy) start-up on an MBR drive: click Convert the drive to GPT, then click it again.', warn='After converting, the computer will not start until the firmware is switched to UEFI. Have the BitLocker recovery key ready if the drive is encrypted. Microsoft\'s tool checks first and changes nothing if it is not safe.', see='The result says Converted. Then click Restart into firmware settings, set Boot Mode to UEFI and turn off CSM or Legacy Support, and turn on Secure Boot. Save and exit.'),
  S('Not enough free space: click Free up space. The upgrade needs about 30 GB.'),
  S('After any fix, click Check again at the top, and Ask Windows to check for Windows\' own answer.')], 'steps'),
 sec('Upgrade', [
  S('When the top says the computer is ready, click Start the upgrade.', see='MendKit downloads Microsoft\'s Windows 11 Installation Assistant, checks that Microsoft signed it, and opens it.'),
  S('In the Installation Assistant, click Accept and install.', see='It downloads Windows 11, prepares it, then asks to restart. The computer restarts a few times; the screen says not to turn it off.'),
  S('Sign in when it is done and check the person\'s files, email and printer.', tip='For 10 days, Settings, System, Recovery, Go back returns to Windows 10.')], 'steps'),
 sec('If the computer cannot run Windows 11', [
  'Keep Windows 10 with Extended Security Updates: free for home computers until 12 October 2027. Open Windows Update and click Enroll now. It may ask to sign in with a Microsoft account or turn on Windows Backup.',
  'Switch to Linux with the Switch to Linux assistant: free and supported for years.',
  S('Upgrade anyway: when the only problem is the processor (and the computer has at least a TPM 1.2 chip), click Allow the upgrade, then get the Windows 11 ISO from the ISO Library, open it and run setup.exe.', warn='Microsoft does not support this. The computer may not get every update, and a desktop watermark may appear. Back up first.'),
  'Or replace the computer. "Is this computer worth fixing?" on the Dashboard weighs it up.'])],
 systems=W, time='15 minutes, plus an hour for the upgrade', level='Takes care', screen='repair', related=['win-security', 'mk-win-tools', 'mk-drive-backup']),
]
