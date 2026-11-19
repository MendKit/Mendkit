from lib import S
from details import DETAILS

DETAILS.update({
'occt': {
 'Plug a laptop into power': dict(more='Save and close everything else: a stress test can freeze an unstable computer, and anything unsaved is lost.'),
 'Choose CPU, leave the default settings': dict(ex=['Test: CPU   Mode: Normal (Auto)   Data set: Large   Duration: 15 min', 'The start button is the large round button at the bottom of the test settings.']),
 'Watch the temperature.': dict(ex='CPU Package: 88 °C and steady → fine. 99 °C and climbing → stop the test and clean the cooling first.'),
 'Read the result at the end.': dict(ex=['Test finished: CPU, 15:00, No errors detected', 'Test stopped: Memory, 06:12, Error detected on core 3  ← unstable memory or processor']),
},
'recuva': {
 'Choose the type of file': dict(ex='Lost holiday photos → Pictures. A Word letter → Documents. Not sure → All files (more to sort through).'),
 'Choose where the files were': dict(ex=['Deleted from the desktop → In a specific location: C:\\Users\\Ann\\Desktop', 'Emptied Recycle Bin → In the Recycle Bin', 'Formatted camera card → On my media card or iPod']),
 'Tick Enable Deep Scan': dict(tip='A deep scan can take an hour or more on a large drive. Run the quick scan first; use deep only if it finds nothing.'),
 'Tick the files to recover': dict(ex='Recover to E:\\Recovered (a USB drive), never back onto C: where the files were lost.', tip='Click Switch to advanced mode to see file names, sizes, dates and a preview of photos before recovering.'),
},
'bluescreenview': {
 'Click a crash.': dict(ex=['112624-9843-01.dmp   26/11/2024 14:02   IRQL_NOT_LESS_OR_EQUAL   0x0000000a   Caused By Driver: rtwlane.sys', 'rtwlane.sys is the Realtek Wi-Fi driver: update it from the laptop maker\'s site.']),
 'Note the Caused By Driver': dict(ex=['Common drivers and what they are:', 'nvlddmkm.sys → NVIDIA graphics', 'atikmdag.sys or amdkmdag.sys → AMD graphics', 'igdkmd64.sys → Intel graphics', 'Netwtw10.sys → Intel Wi-Fi', 'ntoskrnl.exe → Windows core (rarely the real cause)']),
},
'tcpview': {
 'Look for unknown programs': dict(ex=['chrome.exe   Established   142.250.72.14:443   (Google: normal)', 'svchost.exe   Established   20.190.160.x:443   (Microsoft: normal)', 'remote.exe   Established   185.220.x.x:5938   (unknown program on a remote-control port: investigate)']),
},
'procmon': {
 'Click Filter, Filter...': dict(ex='Process Name   is   WINWORD.EXE   then   Include  → Add → OK. The list now shows only Word\'s activity.'),
 'Look at the Result column': dict(ex=['WINWORD.EXE  CreateFile  C:\\Users\\Ann\\AppData\\Roaming\\Microsoft\\Templates\\Normal.dotm  ACCESS DENIED', 'Here Word cannot open its template: check that folder\'s permissions or rename Normal.dotm so Word makes a new one.'], tip='Tools, Count Occurrences on the Result column shows how many of each result there were.'),
},
'wireshark': {
 'Type a filter in the bar': dict(ex=['dns                       only name lookups', 'ip.addr == 192.168.1.1    traffic to or from the router', 'tcp.analysis.flags        problems such as retransmissions', 'http || tls               web traffic']),
},
'putty': {
 'For SSH: type the device': dict(ex=['Host Name: 192.168.1.1   Port: 22   Connection type: SSH', 'To save it: type a name under Saved Sessions, for example Office router, and click Save.']),
 'For a serial cable:': dict(ex='Serial line: COM3   Speed: 9600 (Cisco switches) or 115200 (many routers and servers). Device Manager, Ports (COM & LPT) shows which COM number the USB serial cable got.'),
},
'ddu': {
 'Download the correct new driver': dict(ex=['NVIDIA: nvidia.com/drivers, choose the card from GPU-Z', 'AMD: amd.com/support', 'Intel: intel.com/content/www/us/en/download-center/home.html, or the laptop maker\'s site for laptops']),
 'In DDU, choose the device type': dict(ex='Select device type: GPU    Select device: NVIDIA'),
},
'sdio': {
 'Wait for the scan.': dict(ex=['Unknown device → Realtek RTL8821CE Wireless LAN 802.11ac PCI-E NIC   (a missing Wi-Fi driver: install)', 'Intel(R) UHD Graphics 620   Installed: 27.20.100.8935   Available: 31.0.101.2125   (newer: optional)']),
},
'revo': {
 'Back in Revo, choose Moderate': dict(ex=['Bold, safe to delete: HKCU\\Software\\OldPDFTool, C:\\Program Files\\OldPDFTool', 'Not bold, leave: HKLM\\SOFTWARE\\Classes\\.pdf']),
},
'angryip': {
 'Click Start.': dict(ex=['192.168.1.1    router.lan        TP-Link', '192.168.1.42   HP2A1B3C          HP        ← the printer', '192.168.1.57   Galaxy-S23        Samsung   ← a phone'], tip='If Hostname is blank, Tools, Fetchers lets you add MAC Vendor, which names the maker.'),
},
'treesize': {
 'Open the largest folders': dict(ex='C:\\Users  210 GB → Ann  198 GB → AppData  64 GB → Local  58 GB → Google\\Chrome  12 GB (browser cache: clear it in the browser)'),
},
'memtester': {
 'Close other programs. Check': dict(ex=['> free -m', '               total   used   free   available', 'Mem:            7820   2100   4500        5400', 'Here about 5,000 MB is available, so test 4G.']),
 'Test most of the free memory': dict(ex=['> sudo memtester 4G 1', '  Stuck Address       : ok', '  Random Value        : ok', '  Compare XOR         : ok', '  ...', 'Done.']),
},
'stress-ng': {
 'Type: stress-ng': dict(ex=['> stress-ng --cpu 0 --timeout 10m --metrics-brief', 'stress-ng: info: dispatching hogs: 8 cpu', 'stress-ng: info: successful run completed in 10m 0.02s']),
},
'nvme-cli': {
 'Read its health:': dict(ex=['critical_warning   : 0', 'temperature        : 38 °C', 'available_spare    : 100%', 'percentage_used    : 7%     ← 7% of its rated life used', 'media_errors       : 0', 'power_on_hours     : 5,321']),
},
'btop': {
 'Open Terminal and type: btop': dict(tip='Press Esc for the menu; Options lets you change colours and which boxes show. Press m to cycle through layouts.'),
},
'mtr': {
 'Open Terminal and type: sudo mtr': dict(ex=['> sudo mtr --report google.com', 'HOST                     Loss%  Avg', '1. router.lan              0.0%   2.1', '2. 10.20.0.1              18.0%  35.4  ← loss starts at the internet provider', '3. core1.isp.net          17.0%  36.0', '4. google.com             18.0%  38.2']),
},
'fwupd': {
 'See what can be updated:': dict(ex=['> fwupdmgr get-updates', 'Thinkpad X1 Carbon 9th', '└─System Firmware: 0.1.62 → 0.1.67  (Critical security fix)', '└─Samsung SSD 980: 3B4QFXO7 → 3B4QGXA7']),
},
'rkhunter': {
 'Read the summary and the warnings:': dict(ex=['Warning: The file properties have changed: File: /usr/bin/curl  ← normal after updating curl; run sudo rkhunter --propupd after updates', 'Warning: Hidden directory found: /etc/.java  ← usually harmless', 'Warning: Found possible rootkit files  ← take seriously']),
},
'lshw': {
 'Memory only:': dict(ex=['*-bank:0   description: SODIMM DDR4 Synchronous 3200 MHz   size: 8GiB', '*-bank:1   description: [empty]   ← a free slot']),
},
'stats': {
 'Open Stats.': dict(tip='To start Stats with the Mac, open its settings and tick Start at login.'),
},
'onyx': {
 'Check OnyX supports': dict(ex='macOS Sequoia 15 needs OnyX 4.7 or later; macOS Sonoma 14 needs OnyX 4.5. If it says it is the wrong version, MendKit\'s install may be older than the Mac: download the right one from titanium-software.fr.'),
},
'coconutbattery': {
 'Open coconutBattery.': dict(ex=['Full charge capacity: 4,382 mAh   Design capacity: 5,103 mAh   → 86% health', 'Cycle count: 412   Battery age: 31 months']),
},
'grandperspective': {
 'Hover over the large blocks': dict(ex='/Users/ann/Library/Mobile Documents/... 14 GB (iCloud Drive files kept on the Mac); /Users/ann/Movies/iMovie Library 38 GB'),
},
'appcleaner': {
 'Drag the app from Applications': dict(ex=['Zoom.app', '~/Library/Application Support/zoom.us', '~/Library/Caches/us.zoom.xos', '~/Library/Preferences/us.zoom.xos.plist']),
},
'dell-command-update': {
 'Click Check.': dict(ex=['BIOS   Dell Latitude 5420 System BIOS 1.38.0   Urgent', 'Driver   Intel Wi-Fi 6 AX201 23.60.1   Recommended', 'Firmware   Dell TB16 dock firmware   Optional']),
},
'lenovo-system-update': {
 'Wait while it searches.': dict(ex='Critical: BIOS Update (N32ET91W)   Recommended: Intel Graphics Driver, Lenovo Power Management Driver'),
},
'intel-dsa': {
 'Wait for the list': dict(ex='Intel Wi-Fi 6E AX211 Driver 23.60.0   Intel Graphics Driver 32.0.101.6078', tip='If a driver shows "Customised driver: contact the computer maker", Intel is telling you the laptop maker\'s driver is the right one. Skip it.'),
},
'treesize': {
 'Open the largest folders': dict(ex='C:\\Users  210 GB → Ann  198 GB → AppData  64 GB → Local  58 GB → Google\\Chrome  12 GB (browser cache: clear it in the browser)'),
},
})
