from lib import *
GR='Linux'
L='Linux'
GUIDES=[
G('linux-install-mendkit',GR,'Installing MendKit on Linux','Which download to pick for each Linux, and how to install it.',[
 sec('Pick the right file',[
  'Ubuntu, Linux Mint, Debian, Pop!_OS, Zorin OS, elementary OS: the .deb package.',
  'Fedora, openSUSE, Nobara: the .rpm package.',
  'Anything else (Arch, Manjaro, Void and others): the AppImage, which runs without installing.']),
 sec('Install the .deb (Ubuntu, Mint and similar)',[
  S('Download the .deb from the MendKit website.'),
  S('Open the Downloads folder and double-click the file.', see='The Software app (or Package Installer on Mint) with an Install button.'),
  S('Click Install and type your password.', tip='Or in Terminal: sudo apt install ./Downloads/MendKit-*.deb'),
  S('Open MendKit from the applications menu.')],'steps'),
 sec('Install the .rpm (Fedora, openSUSE)',[
  S('Download the .rpm and double-click it, then click Install. Or in Terminal: sudo dnf install ./Downloads/MendKit-*.rpm (openSUSE: sudo zypper install ./Downloads/MendKit-*.rpm).')],'steps'),
 sec('Run the AppImage',[
  S('Download the AppImage. Right-click it, choose Properties, then Permissions, and tick "Allow executing file as program" (or run chmod +x on it).'),
  S('Double-click it.', warn='On Ubuntu 22.04 and later the AppImage will not open until one extra package is installed. Run: sudo apt install libfuse2t64 (on 22.04: sudo apt install libfuse2). The .deb does not need this.')],'steps')],
 systems=L, time='5 minutes', level='Easy', related=['mendkit','basics-terminal']),

G('switch-linux',GR,'Switching a computer from Windows 10 to Linux','Moving a Windows 10 computer that cannot run Windows 11 to Linux Mint, from the first check to the restored files.',[
 sec('Why and when',[
  'Windows 10 stopped getting security updates in October 2025. Computers that cannot run Windows 11 keep working, but become less safe each month.',
  'Linux Mint is free, gets updates for years, and looks and works much like Windows: a Start-style menu, a taskbar, a file manager and the usual apps.',
  'It suits people who mostly use a web browser, email, documents, photos and video calls. It does not suit people who rely on Windows-only programs (some accounting, CAD and games with anti-cheat) unless those work in a browser.']),
 sec('1. Check the computer with MendKit',[
  S('On the Windows computer, open MendKit. Click Switch to Linux on the Dashboard notice, or open Repair (Technician mode) and click Switch to Linux.', see='After a minute or two: a verdict, the hardware checks, and a table of each app and what replaces it on Linux.'),
  S('Read every amber and red item. Broadcom Wi-Fi or NVIDIA graphics are fine but need a step after installing; a 32-bit processor or under 2 GB of memory is not worth it.'),
  S('Go through the apps table with the owner.', tip='Programs with no Linux version and no browser version are the deal-breakers. Decide now, not after Windows is gone.')],'steps'),
 sec('2. Back up everything',[
  S('Plug in an external drive. In MendKit, click Back up to a drive and back up every user.', tip='See "Backing up to a drive and restoring".'),
  S('Make sure browser passwords are synced to the person\'s account or exported (Move saved passwords).'),
  S('Write down the Wi-Fi password, and any licence keys for programs that will be reinstalled.'),
  S('Check the backup: open the drive and open a few documents and photos from it.')],'steps'),
 sec('3. Make the USB stick',[
  S('Open ISO Library and download Linux Mint (Cinnamon edition; the Xfce edition for computers with under 4 GB of memory).'),
  S('Write it to a USB stick of 8 GB or more with Rufus, or copy it onto a Ventoy stick.', tip='See the Rufus and Ventoy guides.')],'steps'),
 sec('4. Try it before installing',[
  S('Plug the stick into the computer and start from it (see "Starting a computer from a USB stick").', see='The Mint start menu. Choose the first option, Start Linux Mint.'),
  S('Wait for the desktop.', see='A full Linux Mint desktop running from the stick. Nothing on the drive has changed yet.'),
  S('Check the things that matter: connect to Wi-Fi (network icon at the bottom right), play a video for sound, check the screen, touchpad and webcam.', tip='If Wi-Fi is missing, the card needs a driver: plug in a network cable for the install, and run Missing drivers afterwards.')],'steps'),
 sec('5. Install',[
  S('Double-click Install Linux Mint on the desktop.'),
  S('Choose the language and keyboard layout, and click Continue.'),
  S('Connect to Wi-Fi if asked. Tick "Install multimedia codecs" and click Continue.'),
  S('Installation type: choose "Erase disk and install Linux Mint" to replace Windows.', warn='This deletes everything on the drive, including Windows and every file. Only continue once the backup is checked. To keep Windows, choose "Install Linux Mint alongside Windows" instead; each start then offers a choice.'),
  S('Click Install Now, then Continue to confirm the changes.'),
  S('Choose the time zone on the map.'),
  S('Type the person\'s name, the computer\'s name, a user name and a password. Leave "Require my password to log in" selected.', tip='This password is also the administrator password Linux asks for when installing updates. Write it down for the owner.'),
  S('Wait for the installation, about 10 to 20 minutes. Click Restart Now, remove the USB stick when asked and press Enter.', see='Linux Mint starts from the drive, with a Welcome Screen.')],'steps'),
 sec('6. Finish setting it up',[
  S('In the Welcome Screen, click First Steps and open Driver Manager to install any recommended drivers (NVIDIA, Broadcom). Restart if it installs any.'),
  S('Install MendKit (see "Installing MendKit on Linux").'),
  S('In MendKit, run the recipe "First setup after installing Linux". It installs updates, drivers, codecs, Office-compatible fonts, printer drivers, and turns on the firewall and automatic security updates.'),
  S('Open Setup Profiles and apply "New Linux computer": Firefox, Thunderbird, LibreOffice, VLC, Timeshift and the Standard tweaks.'),
  S('Plug in the backup drive. Open Migrate, Restore from a drive, and restore the files. Then click Reinstall apps from the old computer.'),
  S('Set up Timeshift (see its guide) so the system can be rolled back after a bad update.'),
  S('Sign in to the browser, email and cloud accounts with the owner, and show them the menu, the Software Manager and the Update Manager.')],'steps')],
 systems='Windows 10, Linux Mint', time='2 to 3 hours', level='Takes care', screen='switch', need=['A USB stick of 8 GB or more','An external drive for the backup','A network cable if the Wi-Fi card is Broadcom'], related=['linux-first-setup','linux-install-mendkit','basics-boot','mk-drive-backup']),

G('linux-first-setup',GR,'First setup after installing Linux','Finishing a fresh Linux install with one recipe and one setup profile.',[
 sec('What the recipe does',[
  'Installs all updates, finds devices without a driver and installs the recommended drivers and firmware.',
  'Installs media codecs (MP4, MP3, H.264 and more), turns on Flathub in the Software app, installs fonts that match Microsoft\'s so Office documents keep their layout, and installs printer drivers.',
  'Turns on the firewall and automatic security updates, then reports the security settings.']),
 sec('How to run it',[
  S('Install and open MendKit. Tick Technician mode and click Repair.'),
  S('Find "First setup after installing Linux" and click Run, then Start. Type your password when asked.', see='About 15 to 40 minutes depending on the number of updates.'),
  S('Restart when it finishes.'),
  S('Open Setup Profiles and click Apply to this computer on "New Linux computer".'),
  S('Check sound, Wi-Fi, a printer and a video, then restore the files from the backup.')],'steps'),
 sec('Notes',['On Fedora, codecs come from the RPM Fusion repositories, which the recipe adds.','On Debian, firmware needs the "non-free-firmware" component turned on in Software & Updates.','The Microsoft fonts installer accepts Microsoft\'s licence for you on Ubuntu and Mint.'])],
 systems=L, time='30 to 60 minutes', level='Easy', screen='repair', related=['switch-linux','linux-drivers','timeshift']),

G('linux-drivers',GR,'Linux: missing drivers, NVIDIA graphics and Wi-Fi','Finding hardware without a driver and installing the right one, including NVIDIA graphics and Broadcom Wi-Fi.',[
 sec('Find what is missing',[
  S('In MendKit, run the recipe "Missing drivers" (or "Graphics or Wi-Fi not working right" on the Dashboard).', see='Devices with no driver, firmware that failed to load, and the graphics and network chips.')],'steps'),
 sec('Ubuntu and Linux Mint',[
  S('The recipe runs "Install recommended drivers", which installs what Ubuntu suggests (NVIDIA, Broadcom and others). Restart afterwards.', tip='Mint\'s own Driver Manager (in the menu) does the same, with a choice of versions.')],'steps'),
 sec('NVIDIA on Fedora',[
  S('Run "Install the NVIDIA driver (Fedora)". It adds RPM Fusion and installs the driver, which then builds itself (about 5 minutes).'),
  S('If Secure Boot is on, the results say so. Restart.', see='A blue screen, Perform MOK management. Choose Enroll MOK, then Continue, Yes, type the password you were given, and Reboot.', warn='If you skip this screen, the NVIDIA driver will not load. Run the command again to get another chance.')],'steps'),
 sec('Broadcom Wi-Fi',[
  S('Connect the computer to the internet another way: a network cable, or a phone shared over USB (on the phone, turn on USB tethering).'),
  S('Run "Install the Broadcom Wi-Fi driver", then restart. Wi-Fi networks appear in the network menu.')],'steps'),
 sec('Firmware',['"Install missing firmware" installs the firmware package most Wi-Fi, Bluetooth and graphics chips need. On Debian, turn on the non-free-firmware component first.'])],
 systems=L, time='10 to 30 minutes', level='Takes care', screen='repair', related=['linux-first-setup','switch-linux']),

G('linux-boot-repair',GR,'Repairing a Linux system that will not start','Using a Linux live USB and MendKit to check the drive and rebuild the startup menu and startup files.',[
 sec('Try these first',[
  S('At power-on, hold Shift (or tap Esc on newer systems) to show the GRUB startup menu. Choose Advanced options and an older kernel.', tip='If that works, the newest kernel is the problem: update again later, or run "Always show the startup menu" so the older one is always one key away.'),
  S('Stuck at a black screen or "emergency mode" after an update: restore a Timeshift snapshot, or use the steps below with "Rebuild the startup files".')],'steps'),
 sec('Start from a live USB',[
  S('Make a Ubuntu or Linux Mint USB stick (ISO Library and Rufus or Ventoy). It does not have to match the installed Linux.'),
  S('Start the broken computer from it and choose Try or Start Linux Mint, not Install.'),
  S('Connect to the internet (needed for Fedora, and to download MendKit).'),
  S('Download the MendKit AppImage from the website. Open Terminal and type: sudo apt install libfuse2t64 (on 22.04: libfuse2). Then make the AppImage runnable and open it.')],'steps'),
 sec('Repair with MendKit',[
  S('Tick Technician mode, open Repair, and click Open beside Repair a system that will not start.', see='The partitions found, and notices for encrypted or LVM drives.'),
  S('Encrypted drive: open the Files app, click the encrypted drive and type its password, then reopen the screen. LVM: click Look for LVM partitions.'),
  S('Choose the installed system\'s partition, usually the largest ext4 or btrfs one.', tip='MendKit checks it really holds an installed Linux before changing anything.'),
  S('Leave "Check and repair the file system" and "Reinstall and rebuild the startup menu" ticked. Tick "Rebuild the startup files" too if it stopped at a black screen or emergency mode.'),
  S('Click Repair it and type the live system\'s password if asked (often none: just press Enter).', see='Results for the file system check and for the startup repair, naming the installed system.'),
  S('Shut down, remove the USB stick and start the computer.')],'steps'),
 sec('If it still will not start',['The drive itself may be failing: check it with smartmontools from the live session, and copy the files off with MendKit\'s "Copy from an old drive".','Windows updates sometimes take over the startup order on dual-boot computers: in the computer\'s startup menu (F12 and similar), choose the Linux entry (ubuntu, Mint or Fedora).'])],
 systems=L, time='30 minutes', level='Needs care', screen='repair', need=['A Linux live USB stick','Internet on the broken computer'], related=['basics-boot','mk-old-drive','timeshift']),

G('linux-upgrade',GR,'Upgrading Linux to the next version','Moving Ubuntu, Linux Mint or Fedora to its next release safely.',[
 sec('When',['MendKit\'s Dashboard warns when a version is close to or past the end of its security updates.','Ubuntu LTS and Linux Mint versions get 5 years of updates; Fedora about 13 months, so Fedora needs upgrading every year.']),
 sec('Get ready',[
  S('Open Repair and click Open beside Upgrade to the next version.', see='Checks: free space (15 GB needed), mains power, waiting updates, a Timeshift snapshot, extra software sources, and the end of support date.'),
  S('Fix anything red. Install waiting updates in the Updates screen and restart.'),
  S('Take a Timeshift snapshot and back up personal files.', warn='Upgrades usually go smoothly, but a power cut or a full drive mid-way can leave the computer unable to start.')],'steps'),
 sec('Ubuntu and Linux Mint',[
  S('Click Start the upgrade.', see='Ubuntu: the Software Updater offers the new version; click Upgrade. Mint: the Mint upgrade tool opens.'),
  S('Follow its screens. It asks for your password, checks again, downloads (30 to 90 minutes) and asks before replacing settings files: keep the current version unless you know otherwise.'),
  S('Restart when it finishes. Extra software sources were turned off: turn them back on in Software & Updates (or Software Sources on Mint) if needed.')],'steps'),
 sec('Fedora',[
  S('Click Download Fedora N.', see='MendKit installs current updates, then downloads the new release. The results list any package in the way.'),
  S('Save your work, then click Restart and upgrade.', see='The computer restarts into an upgrade screen with a progress bar (30 to 60 minutes) and restarts again into the new Fedora.')],'steps')],
 systems='Ubuntu, Linux Mint, Fedora', time='1 to 2 hours', level='Takes care', screen='repair', related=['timeshift','mk-updates']),

G('linux-everyday',GR,'Everyday Linux fixes','Quick fixes for the problems Linux users run into most, and which MendKit recipe or command does each.',[
 sec('Desktop frozen or panel gone',['Dashboard: "The desktop froze or the panel vanished". It restarts Cinnamon, KDE Plasma, XFCE or MATE without closing your windows.','GNOME on Wayland cannot be restarted that way: sign out and back in. If nothing responds, press Ctrl, Alt and F3, sign in, and type: sudo systemctl restart gdm']),
 sec('Updates fail',['Recipe "Updates fail" handles "could not get lock" (waits for a running update, then finishes half-installed packages), broken extra sources (lists them; "Turn off broken software sources" sets them aside), held packages, Arch\'s expired signing keys and Snap updates.','Fedora: "Undo the last update (dnf)" rolls back an update that broke something.']),
 sec('No sound or wrong output',['Recipe "No sound" restarts the sound system, then "Reset the sound system completely" clears saved device choices. Afterwards, choose the output in Sound settings.']),
 sec('Printer or scanner',['Printers: "Install printer drivers" and "Install HP printer drivers". Most network printers work without a driver: "Printers on the network" lists them.','Scanners: Dashboard "The scanner does not work" installs scanner support, including network scanners.']),
 sec('Keeps asking to unlock the keyring',['Happens after a password change. Run "Keeps asking to unlock the keyring" (Repair) and sign out and in.', S('Passwords saved in the old keyring (some apps and Chrome) must be typed again.', warn='The old keyring is kept as a backup, but it needs the old password to open.')]),
 sec('Screen problems',['Screen sharing or remote support shows black, or an older app misbehaves: try the X11 session (cog on the sign-in screen), or "Use X11 instead of Wayland (GNOME)".','Tearing lines in videos on XFCE: the "Stop screen tearing" tweak. On other desktops, try the Wayland session.','Text too small: the "Larger text" tweak for your desktop.']),
 sec('Slow to start',['Dashboard "It takes ages to start" shows which services hold startup up. NetworkManager-wait-online is the usual culprit on desktops; turn it off in Startup items.']),
 sec('Out of space',['Repair, Free up space: caches, downloaded update files, old logs, old kernels, old Snap versions, unused Flatpak parts, Docker and Timeshift snapshots, and large files to look at.'])],
 systems=L, time='5 to 15 minutes', level='Easy', screen='dashboard', related=['linux-drivers','mk-linux-tools','linux-security']),

G('linux-security',GR,'Securing a Linux computer','Checking and fixing the firewall, automatic updates, remote login and remote access programs.',[
 sec('Check',[S('Run the recipe "Linux security checkup".', see='Firewall, automatic security updates, remote login (SSH), who has administrator rights, disk encryption and which programs accept network connections.')],'steps'),
 sec('Fix',[
  S('Run "Secure this computer". It turns on the firewall (blocking incoming connections only) and automatic security updates.', tip='If remote login (SSH) is in use, MendKit keeps it allowed through the firewall.'),
  S('If SSH is on and nobody logs in remotely, turn it off: sudo systemctl disable --now ssh'),
  S('Check the administrators listed are people who should have that power.')],'steps'),
 sec('Remote access programs',['Check for remote access (Dashboard) now removes AnyDesk, TeamViewer, RustDesk and others on Linux too: it stops their services, uninstalls the package or Flatpak and sets loose copies aside.']),
 sec('Encryption',['Disk encryption can only be turned on by reinstalling, with "Encrypt the new Linux installation" ticked in the installer. Worth it for laptops.'])],
 systems=L, time='10 minutes', level='Easy', screen='repair', related=['remote-audit','basics-safety']),

G('mk-linux-tools','Using MendKit','Linux tools: startup items and free up space','The Linux tools on the Repair screen, step by step.',[
 sec('Startup items',[
  S('Tick Technician mode, open Repair, and click Open beside Startup items, then Scan.', see='Programs that start when you sign in and services that start with the computer. Ones the system needs are marked and cannot be ticked.'),
  S('Tick the ones you do not use and click Turn off selected. Services for the whole computer ask for your password.', tip='Search a name you do not know before turning it off.'),
  S('Turned-off items are listed under Turned off by MendKit with Turn back on.'),
  S('Restart and check everything still works.')],'steps'),
 sec('Free up space',[
  S('Click Open beside Free up space, then Measure.', see='Free space, then each kind of clearable file with its size. Safe ones are ticked.'),
  S('Tick what to delete and click Delete selected. Items for the whole computer ask for your password.', warn='Deleted files do not go to the Trash.'),
  S('Large files are listed with Show in folder. Decide about them yourself.')],'steps'),
 sec('Also here',['Repair a system that will not start, and Upgrade to the next version, have their own guides.'])],
 systems=L, time='10 minutes', level='Takes care', screen='repair', related=['linux-boot-repair','linux-upgrade','linux-everyday']),
]
