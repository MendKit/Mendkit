from lib import S
from details import DETAILS

DETAILS.update({
'clamav': {
 'Open Terminal': dict(more='On Windows, click Start, type cmd, right-click Command Prompt and choose Run as administrator. On a Mac, press Command and Space, type Terminal and press Return. On Linux, press Ctrl, Alt and T together.', see='A window with a blinking cursor after a line such as C:\\Windows\\system32> or yourname@computer ~ %.'),
 'Update the virus definitions': dict(ex=['Windows:', '> freshclam', 'Mac and Linux:', '> sudo freshclam', 'A good result ends with lines like: daily.cvd updated (version: 27450, sigs: 2070000)'], tip='"Can\'t query current.cvd.clamav.net" or "Problem with internal logger" a few times is normal when the database is already up to date.'),
 'Scan your user folder': dict(more='Type the command exactly, with the spaces, then press Enter. Leave the window open until it finishes; you can keep using the computer, but it will be slower.', ex=['Scan your own folders (Windows):', '> clamscan -r -i %USERPROFILE%', 'Scan your own folders (Mac or Linux):', '> clamscan -r -i ~', 'Scan only the Downloads folder (quicker):', '> clamscan -r -i ~/Downloads', 'Scan a USB stick on Windows that shows as drive E:', '> clamscan -r -i E:\\']),
 'Read the summary at the end.': dict(ex=['----------- SCAN SUMMARY -----------', 'Known viruses: 8697511', 'Scanned files: 48213', 'Infected files: 1', 'Time: 1834.212 sec (30 m 34 s)', 'Above it, the infected file is listed: C:\\Users\\Ann\\Downloads\\free-player.exe: Win.Adware.Agent-123 FOUND'], more='Scroll up to see any lines ending in FOUND; each one names the file and what it matched.'),
},
'bleachbit': {
 'Close the browsers': dict(more='Check the taskbar (Windows) or the Dock (Mac): a browser with a dot under its icon is still open. Right-click it and choose Close window or Quit.'),
 'Open BleachBit.': dict(tip='On Windows there may be two entries: BleachBit and BleachBit as Administrator. Use BleachBit as Administrator to clean Windows\' own temporary files too.'),
 'Tick System,': dict(ex=['A safe everyday choice:', 'Google Chrome: Cache, Code cache', 'Microsoft Edge: Cache', 'Firefox: Cache', 'System (Windows): Temporary files, Recycle bin, Logs', 'System (Linux): Cache, Temporary files, Trash']),
 'Click Preview.': dict(more='Scroll the right-hand list to check what would go. The bottom line shows the total.', ex='Disk space to be recovered: 2.4 GB    Files to be deleted: 18,532'),
 'If the list looks right': dict(see='Lines scroll past as files are deleted. It usually takes under a minute. A few lines saying a file is in use or permission was denied are normal.'),
},
'bcu': {
 'Wait while it lists': dict(more='It takes up to a minute on a computer with many programs.'),
 'Sort by Install date': dict(more='Click the column heading once to sort; click again to reverse the order.', ex=['Usually safe to remove (if not wanted): McAfee or Norton trials, WildTangent Games, Booking.com, ExpressVPN trial, Dropbox promotion, "Driver Booster", "PC Cleaner", toolbars.', 'Leave alone: Intel, AMD, NVIDIA, Realtek, Microsoft Visual C++ Redistributable, .NET, Windows SDK, the touchpad or audio driver.']),
 'Tick the programs to remove': dict(tip='Hold Ctrl and click to select several rows, then tick them all at once with the Space key.'),
 'Wait for the uninstallers.': dict(more='If an uninstaller asks "Are you sure?" or offers a "keep my settings" choice, answer yes to removing and no to keeping. If one asks for a reason or a survey, close the survey page.'),
},
'smartmontools': {
 'Open Terminal as administrator': dict(more='On Windows, click Start, type cmd, right-click Command Prompt and choose Run as administrator.'),
 'List the drives:': dict(ex=['> smartctl --scan', '/dev/sda -d ata # /dev/sda, ATA device', '/dev/nvme0 -d nvme # /dev/nvme0, NVMe device', 'Each line is one drive. Use the first word (here /dev/sda or /dev/nvme0) in the next command.']),
 'Read the health of the first drive.': dict(more='The output is long: scroll up to the line that starts with SMART overall-health, then down to the table of numbers.', ex=['Linux, first drive:', '> sudo smartctl -a /dev/sda', 'Windows, NVMe drive:', '> smartctl -a /dev/nvme0', 'Mac, internal drive:', '> sudo smartctl -a disk0', 'To show only the health line and the error counts:', '> sudo smartctl -H -A /dev/sda']),
 'Optional: start a short self-test': dict(ex=['> sudo smartctl -t short /dev/sda', 'Please wait 2 minutes for test to complete.', 'Then:', '> sudo smartctl -l selftest /dev/sda', '# 1  Short offline   Completed without error   00%   12345   -'], tip='"Completed: read failure" with a number in the last column means the test found a bad area at that place on the drive. Back up now.'),
},
'crystaldiskinfo': {
 'Open CrystalDiskInfo': dict(tip='The first time, it asks nothing; if it opens very small, drag the window corner to make it bigger.'),
 'Read Health Status,': dict(ex=['Healthy SSD: Good (98 %), 38 °C, Power On Hours 4,210, Total Host Writes 9,800 GB', 'Failing hard drive: Caution, 41 °C, Reallocated Sectors Count raw value 00000000002C (44 bad areas moved), Current Pending Sector Count 0000000008'], more='The raw value column is in hexadecimal on some versions; Function, Advanced Feature, Raw Values, 10 [DEC] shows ordinary numbers.'),
},
'windirstat': {
 'Choose the C: drive': dict(tip='Scanning all drives can take a long time with a large external drive plugged in. Start with C: only.'),
 'Click the arrow beside the biggest folders': dict(ex=['A typical full drive:', 'C:\\Users\\Ann\\Videos   86 GB (old phone videos)', 'C:\\Users\\Ann\\AppData\\Local\\Packages   24 GB (app data, leave it)', 'C:\\Windows   28 GB (Windows itself, leave it)', 'C:\\Users\\Ann\\Downloads   19 GB (old installers, usually safe to clear)']),
 'Click a large rectangle': dict(more='The list at the top jumps to that file and highlights it. The colour shows the file type; the legend on the right says which colour is which (for example .mp4 videos, .iso disk images).'),
},
'testdisk': {
 'Open Terminal as administrator': dict(ex=['Windows (in the folder where it was installed):', '> photorec_win', 'Mac and Linux:', '> sudo photorec'], see='A text screen headed PhotoRec with a list of disks and a row of choices at the bottom ([Proceed] [Quit]). The mouse does nothing here: use the arrow keys and Enter.'),
 'Use the arrow keys to choose the drive': dict(ex=['Disk /dev/sda - 512 GB / 476 GiB (the computer\'s own drive)', 'Disk /dev/sdb - 63 GB / 59 GiB - Generic STORAGE DEVICE (a 64 GB memory card)'], more='Then press the right arrow to highlight [Proceed] if needed, and press Enter.'),
 'Choose the partition': dict(more='The screen lists the partitions on the drive; usually there is one large one (FAT32, exFAT or NTFS). Highlight it and press Enter. Use [File Opt] first if you only want certain types: press s to untick all, then tick jpg, mov or docx with the Space key, and press b to save.'),
 'Choose Whole to search': dict(tip='Free is faster and enough when files were deleted from a drive that is still in use. Choose Whole for a formatted card or a drive that says it needs formatting.'),
 "Move to the second drive's folder": dict(more='Use the arrow keys and Enter to open folders; .. goes up one level. When you are inside the folder you want, press C (capital or small) to start.', ex=['Windows: move up to C:, then into the other drive, for example E:\\Recovered', 'Mac: /Volumes/Backup/Recovered', 'Linux: /media/yourname/Backup/Recovered']),
},
'lhm': {
 'Open the processor section.': dict(ex=['CPU Package   Value 46 °C   Min 38 °C   Max 92 °C', 'Here the processor sat at 46 °C and reached 92 °C under load: acceptable for most laptops, hot for a desktop.']),
 'Leave it open while you run': dict(tip='File, Reset Min/Max clears the Min and Max columns, so you can start a fresh test without closing the program.'),
},
'unigetui': {
 'Open UniGetUI.': dict(tip='The first time, it may ask to install extra package managers (Chocolatey, Scoop). These are optional: skip them unless you know you need them.'),
 'Click Software updates.': dict(more='It checks for a minute first. The number next to Software updates is how many are waiting.', ex='Mozilla Firefox   Mozilla.Firefox   131.0 → 132.0.1   Winget'),
 'Tick the apps to update': dict(tip='Close each app before updating it (a browser that is open cannot be updated). Right-click an app and choose Ignore updates for this package to leave it on its current version.'),
},
'nmap': {
 'Find the network': dict(ex=['This computer is 192.168.1.20 → scan 192.168.1.0/24', 'This computer is 10.0.0.15 → scan 10.0.0.0/24', 'Windows: type ipconfig in Command Prompt and read the IPv4 Address line. Mac and Linux: ifconfig or ip addr.']),
 'Open Terminal and type: nmap -sn': dict(ex=['> nmap -sn 192.168.1.0/24', 'Nmap scan report for router.lan (192.168.1.1)', 'MAC Address: 3C:84:6A:12:34:56 (TP-Link)', 'Nmap scan report for 192.168.1.42', 'MAC Address: 00:1E:0B:AB:CD:EF (HP)  ← likely a printer', 'Nmap done: 256 IP addresses (9 hosts up) scanned in 4.12 seconds'], tip='On Mac and Linux, add sudo at the front (sudo nmap -sn ...) to see the maker of each device.'),
 'To see what one device offers': dict(ex=['> nmap 192.168.1.42', 'PORT    STATE SERVICE', '80/tcp  open  http      ← the printer\'s settings page: open http://192.168.1.42', '631/tcp open  ipp       ← printing', '9100/tcp open jetdirect ← printing']),
},
'7zip': {
 'Windows: right-click the compressed file': dict(more='On Windows 10 the 7-Zip entry is in the first right-click menu; on Windows 11 it is under Show more options.', ex=['Right-click photos-2023.7z → Show more options → 7-Zip → Extract to "photos-2023\\"', 'Result: a new folder called photos-2023 in the same place, with the files inside.'], tip='If it asks for a password, the sender set one; ask them for it.'),
 'To make one:': dict(ex=['Right-click the folder Tax 2024 → Show more options → 7-Zip → Add to "Tax 2024.zip"', 'For a password: choose Add to archive..., type the password twice under Encryption, choose AES-256 and click OK.'], tip='Zip files open on any computer without extra software. 7z files are smaller but need 7-Zip or a similar program to open.'),
 'On a Mac and Linux, 7-Zip': dict(ex=['First go to the folder with the file:', '> cd ~/Downloads', 'Extract (Mac):', '> 7zz x photos-2023.7z', 'Extract (Linux):', '> 7z x photos-2023.7z', 'Make a zip of a folder:', '> 7z a Tax-2024.zip "Tax 2024"']),
},
'rustdesk': {
 'Open RustDesk.': dict(tip='On a Mac, the first time, it asks for Screen Recording and Accessibility permission. Click the button it shows to open System Settings, turn RustDesk on in both lists, then quit and reopen RustDesk.'),
 'Read the ID and password': dict(ex='ID: 1 234 567 890   One-time password: 7x9kq2', tip='Click the copy icon beside the ID to paste it into a message instead of reading it out.'),
 'When they connect': dict(more='The window shows the technician\'s name or ID; check it is the person you expected. You can untick Keyboard or Clipboard there to let them only watch.'),
},
'ventoy': {
 'Open Ventoy2Disk': dict(more='If Ventoy is not in the Start menu, MendKit installed it as a folder: open it from the Tools screen row, or look in C:\\Program Files\\Ventoy.'),
 'Check the Device box': dict(ex=['Right: SanDisk Ultra USB 3.0, 57.3 GB, [E:]  (a 64 GB USB stick)', 'Wrong: Samsung SSD 870 EVO, 931.5 GB  (a computer drive: stop)'], tip='Unplug every other USB drive before you start, so the stick is the only choice.'),
 'Copy ISO files onto the Ventoy drive': dict(ex=['Ventoy (E:)', '  Windows11_24H2.iso', '  memtest86plus-7.20.iso', '  Linux\\linuxmint-22-cinnamon-64bit.iso', '  Rescue\\hbcd_pe_x64.iso'], tip='Wait until the copy finishes, then use Eject before unplugging. A half-copied ISO will not start.'),
 'Eject the stick.': dict(ex='At startup the Ventoy menu lists every ISO by name. Use the arrow keys to pick one and press Enter.'),
},
})
