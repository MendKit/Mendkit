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
]
