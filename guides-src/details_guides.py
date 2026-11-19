from details import DETAILS

DETAILS.update({
'basics-terminal': {
 'Click inside the window. Paste the command': dict(ex=['What it looks like on Windows before you type:', 'C:\\Users\\Ann>', 'After pasting a command and pressing Enter:', 'C:\\Users\\Ann> ipconfig', 'Windows IP Configuration ... IPv4 Address. . . : 192.168.1.20', 'C:\\Users\\Ann>   ← the prompt comes back when the command has finished']),
 'If it asks for a password': dict(ex=['[sudo] password for ann:   ← type the password here; the cursor does not move', 'Password:   ← the same on a Mac']),
 'To stop a command that is running': dict(ex='The command stops and the prompt comes back, for example: ^C then ann@laptop:~$'),
},
'basics-boot': {
 'Dell: F12.': dict(ex='Press the key again and again (about twice a second) from the moment you press the power button until a menu appears. Holding it down does not work on most computers.'),
 'Plug the USB stick in while the computer is off.': dict(more='Then switch it on and tap the boot menu key for the computer\'s brand.', ex=['A boot menu looks like this:', 'Windows Boot Manager (Samsung SSD 970)', 'UEFI: SanDisk Ultra 1.00   ← choose the USB stick, with UEFI in front if offered', 'Network boot (IPv4)']),
 'Intel Mac: restart and hold the Option key': dict(ex='Icons appear for Macintosh HD and for the stick, often called EFI Boot or Install macOS. Click the stick, then the arrow under it.'),
},
'mac-nvram-smc': {
 'Apple menu, About This Mac.': dict(ex=['Chip: Apple M2   → Apple silicon: a shut down and restart does both resets', 'Processor: 2.3 GHz Quad-Core Intel Core i5   → an Intel Mac: use the key steps below']),
 'Press the power button, then immediately press': dict(ex='Press the power button, then within a second hold all four: Option (⌥), Command (⌘), P and R. Your left hand takes Option and Command, your right hand P and R.'),
 'Keep holding for about 20 seconds.': dict(ex='Without a T2 chip you hear the startup chime a second time; let go after it. Macs from 2018 to 2020 have a T2 chip: watch for the Apple logo to appear and disappear twice.'),
},
'mk-passwords': {
 'Chrome or Edge: on the old computer sign in': dict(ex=['Chrome: click the round picture at the top right, Turn on sync, sign in with the Google account, then Yes, I\'m in.', 'Edge: click the profile picture, Sign in to sync data, then check Settings, Profiles, Sync shows Passwords turned on.']),
 'Wait a few minutes, then open the password list': dict(ex=['Chrome: type chrome://password-manager/passwords in the address bar.', 'Edge: type edge://wallet/passwords.', 'Firefox: type about:logins.', 'The count should match the old computer, for example "142 passwords".']),
 'Export the passwords on the old computer': dict(warn='The exported file holds every password in plain text. Keep it on a USB stick, not the cloud, and delete it as soon as the import is done.', ex=['Chrome: chrome://password-manager/settings → Export passwords → save as Chrome Passwords.csv', 'Then on the new computer: same page → Import passwords → choose the file.']),
},
'mk-backup-erase': {
 'Read the list twice. Type ERASE': dict(ex='Type the word in capitals, exactly: ERASE. "erase" or "Erase" leaves the button greyed out on purpose.'),
 'For an external or second drive only:': dict(ex=['Erase choices look like: E: SanDisk Extreme (1 TB, USB)', 'The drive Windows runs from (C:) is never offered.']),
},
'mk-drive-backup': {
 'Tick what to back up and click Choose drive': dict(ex=['Ticked: Documents (12 GB), Pictures (48 GB), Desktop (2 GB), Browser bookmarks', 'Drive: E: Backup Plus (2 TB, 1.6 TB free) → the backup goes in E:\\MendKit Backup\\ANN-LAPTOP 2026-11-18']),
 'Plug in the drive. Open Migrate and click Restore': dict(see='A list of the backups found on the drive, newest first, with the computer name and date. Choose one and click Restore.'),
},
'basics-safety': {
 'A pop-up or phone call says the computer is infected': dict(ex='"WARNING! Your computer has been locked due to suspicious activity. Call Microsoft Support at 1-8xx-xxx-xxxx immediately." This is always a scam, however official it looks.'),
 'Disconnect the computer from the internet': dict(ex='Windows: click the Wi-Fi icon at the bottom right and turn Wi-Fi off. Mac: click the Wi-Fi icon at the top right and switch it off. Or unplug the network cable.'),
},
'mk-results': {
 'The headline says in one line': dict(ex=['"All checks passed. Nothing needs attention."', '"2 things need attention." followed by the list, amber first.']),
 '"Skipped, needs administrator"': dict(ex='Dashboard → Restart as administrator → click Yes in the Windows box → run the same recipe again.'),
},
})
