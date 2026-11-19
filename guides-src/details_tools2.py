from lib import S
from details import DETAILS

DETAILS.update({
'autoruns': {
 'Click Options, tick Hide Microsoft': dict(more='Then press F5 to refresh the list so the change takes effect.'),
 'Click the Logon tab first': dict(ex=['Logon tab, a typical clean computer:', 'OneDrive   Microsoft Corporation   (normal)', 'SecurityHealth   Microsoft Corporation   (Windows Security, keep)', 'RtkAudUService   Realtek Semiconductor   (sound driver helper, keep)', 'A suspicious one:', 'chromupdate   (Not verified)   C:\\Users\\Ann\\AppData\\Local\\Temp\\cu.exe   ← pink, odd name, runs from Temp']),
 'Look for: rows in pink': dict(ex=['Worth a closer look: an entry with no Publisher, running from AppData\\Roaming or Temp, with a random name such as xkqzt.exe, or a scheduled task that opens a website.', 'Usually fine even if unfamiliar: Adobe, Google Update, Zoom, Steam, Dropbox, the printer maker\'s helper.']),
 'Untick the box beside an entry': dict(tip='Untick first and restart. Only delete an entry (right-click, Delete) once you are sure, for example after Malwarebytes has named it.'),
},
'procexp': {
 'Click the CPU column heading': dict(ex=['CPU 38.5   MsMpEng.exe   Antimalware Service Executable   Microsoft   ← Defender scanning: normal for a few minutes', 'CPU 92.1   updater.exe   (no description)   (no company)   ← worth investigating'], more='Watch for half a minute: short spikes are normal, a program that stays at the top is the cause.'),
 'Hover over a program': dict(ex='Path: C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe (expected). A browser running from C:\\Users\\Ann\\AppData\\Local\\Temp would not be.'),
 'To check for malware:': dict(ex=['0/74   chrome.exe   (clean)', '12/74  svchosts.exe   (note the extra s: malware pretending to be a Windows part)'], tip='Click the number to open the full report in the browser.'),
 'To find what locks a file:': dict(ex=['Search for: Budget.xlsx', 'Result: EXCEL.EXE   C:\\Users\\Ann\\Documents\\Budget.xlsx', 'Close Excel (save first) and the file can be moved or deleted.']),
},
'malwarebytes': {
 'Open Malwarebytes.': dict(tip='If the dashboard says "Real-Time Protection: off" after the trial, that is expected for the free version; scans still work.'),
 'Click Scan.': dict(more='You can keep using the computer, but it will be slow. Do not shut it down mid-scan.'),
 'When it finishes, read the list': dict(ex=['Adware.Bundler   C:\\Users\\Ann\\Downloads\\setup_free_pdf.exe', 'PUP.Optional.WebCompanion   (bundled extra)', 'PUM.Optional.DisableTaskMgr   (a setting that stops Task Manager opening: remove it)', 'Trojan.Agent   C:\\Users\\Ann\\AppData\\Roaming\\svc\\run.exe   (real malware: remove)']),
 'Restart if asked': dict(more='A second scan that finds nothing confirms the clean-up worked. If the same item keeps coming back, something is reinstalling it: check Autoruns for its startup entry.'),
},
'adwcleaner': {
 'Click Scan now.': dict(ex=['Services: 1 (eg. GoogleUpdaterService... (only if odd))', 'Folders: 3   C:\\Program Files (x86)\\Search Protect', 'Registry: 6   HKCU\\Software\\Conduit', 'Chromium extensions: 2   "Quick Maps Now"']),
 'Restart. After restarting': dict(more='Open each browser and check its home page and search engine are back to normal (Settings, Search engine). If not, reset the browser: in MendKit, use Clean browsers under Repair.'),
},
'hwinfo': {
 'Open HWiNFO64': dict(tip='If you see two versions (HWiNFO32 and HWiNFO64), use HWiNFO64. On a Windows ARM laptop it is HWiNFO ARM64.'),
 'For parts, tick Summary-only': dict(ex=['CPU: Intel Core i5-1135G7   4 cores / 8 threads', 'Motherboard: LENOVO 20VE', 'Memory: 8 GB DDR4-3200, 1 of 2 slots used  ← a second 8 GB stick can be added', 'Drive: SAMSUNG MZVLB512HBJQ (512 GB NVMe)']),
 'Find CPU Package': dict(ex=['CPU Package   Current 54 °C   Min 41 °C   Max 96 °C   Average 63 °C   ← reached 96 °C: throttling', 'GPU Temperature   Current 48 °C   Max 71 °C   (fine)', 'Drive Temperature   Current 39 °C   Max 52 °C   (fine)'], tip='Press Ctrl F in the sensors window to search for a sensor by name, for example Package.'),
},
'ncdu': {
 'Open Terminal and type: ncdu': dict(ex=['> ncdu ~', '   48.2 GiB [##########] /Movies', '   21.7 GiB [####      ] /Library', '    9.1 GiB [#         ] /Downloads', 'Whole drive on a Mac:', '> sudo ncdu -x /System/Volumes/Data']),
},
'ddrescue': {
 'Find both drives.': dict(ex=['Linux:', '> sudo lsblk -o NAME,SIZE,MODEL', 'sda  238.5G  SAMSUNG MZ7LN256  ← the computer\'s own drive', 'sdb  465.8G  WDC WD5000LPVX   ← the failing drive (source)', 'sdc  931.5G  Seagate Expansion ← the healthy drive (destination)']),
 'First pass, fast,': dict(ex=['> sudo ddrescue -f -n /dev/sdb /dev/sdc rescue.map', 'rescued: 401 GB, bad areas: 12, read errors: 340, pct rescued: 86.12%, remaining time: 1h 20m']),
 'Second pass, retrying': dict(ex='> sudo ddrescue -f -r3 /dev/sdb /dev/sdc rescue.map'),
},
'lm-sensors': {
 'Type: sensors': dict(ex=['coretemp-isa-0000', 'Package id 0:  +52.0°C  (high = +100.0°C, crit = +100.0°C)', 'Core 0:        +49.0°C', 'thinkpad-isa-0000', 'fan1:        2900 RPM']),
},
'inxi': {
 'Open Terminal and type: inxi -Fxz': dict(ex=['CPU: quad core Intel Core i5-8250U speed/min/max: 800/400/3400 MHz', 'Graphics: Device-1: Intel UHD Graphics 620 driver: i915', 'Drives: Local Storage: total: 238.47 GiB used: 61.2 GiB (25.7%)', 'Battery: ID-1: BAT0 charge: 38.1 Wh (100.0%) condition: 38.1/57.0 Wh (66.8%)  ← worn battery']),
},
'iperf3': {
 'On the second computer, type:': dict(ex=['> iperf3 -c 192.168.1.20', '[ ID] Interval       Transfer     Bitrate', '[  5] 0.00-10.00 sec  1.09 GBytes  936 Mbits/sec  sender  ← a good wired result', 'Over Wi-Fi in another room you might see: 74.3 Mbits/sec']),
},
'timeshift': {
 'Choose RSYNC': dict(tip='Choose a drive other than the system drive if you have one; a snapshot on the same drive does not help if that drive fails.'),
 'To roll back, select a snapshot': dict(ex='Pick the snapshot from before the problem, for example "2026-11-02 09:00  Before update  O (ondemand)", then Restore, Next, Next.'),
},
'gparted': {
 'Choose the drive from the top right list.': dict(ex=['/dev/sda (238.47 GiB)  ← the drive Linux is running from', '/dev/sdb (14.91 GiB)  ← a 16 GB USB stick']),
 'Right-click a partition for actions:': dict(ex=['Format a USB stick for Windows and Mac: right-click its partition, Unmount, then Format to, exfat.', 'Use space left after cloning to a bigger SSD: right-click the last partition, Resize/Move, drag its right edge to the end.']),
},
'htop': {
 'Open Terminal and type: htop': dict(ex=['  1[|||||||||||||||  58%]   Mem[||||||||||    5.1G/7.6G]', '  PID USER  CPU%  MEM%  Command', ' 2214 ann   97.3   4.2  /usr/lib/firefox/firefox -contentproc  ← one browser tab busy']),
},
'topgrade': {
 'Open Terminal and type: topgrade': dict(ex=['── Homebrew ──', '==> Upgrading 4 outdated packages: wget, git, node, python@3.12', '── App Store ──', 'Summary: Homebrew: OK   App Store: OK   pip3: SKIPPED']),
},
'rufus': {
 'Check that Device shows': dict(ex='Device: SanDisk Ultra (E:) [32 GB]. If it shows the wrong stick, pick the right one from the drop-down list.'),
 'Click START.': dict(ex=['Windows 11 options box, good choices for a repair stick:', 'Remove requirement for 4GB+ RAM, Secure Boot and TPM 2.0: tick only for computers that fail the Windows 11 check.', 'Remove requirement for an online Microsoft account: tick to allow a local account.', 'Disable data collection (skip privacy questions): tick to save time.']),
},
'everything': {
 'Type part of the file name.': dict(ex=['budget            every file with budget in its name', '*.pst             every Outlook mail file', 'thesis *.docx     Word files with thesis in the name', 'dm:today          files changed today', 'size:>1gb         files bigger than 1 GB']),
},
'wiztree': {
 'Click File View': dict(ex=['C:\\hiberfil.sys  6.4 GB (Windows sleep file, leave it)', 'C:\\Users\\Ann\\Downloads\\Win11.iso  5.8 GB (old download, safe to delete)', 'C:\\Users\\Ann\\Videos\\Holiday 2019.mp4  4.1 GB (personal: ask first)']),
},
'cpuz': {
 'Memory: total size': dict(ex='Type DDR4   Size 8 GBytes   Channel # Single   DRAM Frequency 1596 MHz (DDR4-3200, because DDR memory runs at twice the frequency shown)'),
 'SPD: choose each slot': dict(ex=['Slot #1: DDR4, 8 GBytes, Samsung, M471A1K43DB1-CWE, PC4-25600 (DDR4-3200)', 'Slot #2: empty', 'To add memory: buy the same type and speed, for example another 8 GB DDR4-3200 SO-DIMM for a laptop.']),
},
'gpuz': {
 'Open GPU-Z': dict(ex='Name: NVIDIA GeForce GTX 1650   Memory Size: 4096 MB   Driver Version: 31.0.15.5244 (NVIDIA 552.44)'),
 'Click the Sensors tab': dict(tip='To log a test, tick Log to file at the bottom, play the game or run the test, then untick it and open the saved file.'),
},
'crystaldiskmark': {
 'Choose the drive in the list': dict(ex='C: 63% (302/476GiB)   The percentage is how full the drive is. A drive over 90% full tests slower.'),
 'Click All.': dict(ex=['SATA SSD, healthy:', 'SEQ1M Q8T1  Read 560   Write 520', 'RND4K Q1T1  Read 45    Write 110', 'Laptop hard drive:', 'SEQ1M Q8T1  Read 105   Write 98', 'RND4K Q1T1  Read 0.6   Write 1.1  ← why it feels slow']),
},
})
