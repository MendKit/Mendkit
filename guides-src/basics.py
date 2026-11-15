from lib import *
GR='Start here'
GUIDES=[
G('basics-words',GR,'Words you will see','Plain explanations of the computer words used in MendKit and in these guides.',[
 sec('About the computer',[
  'Operating system (or "system"): the main software that runs the computer: Windows, macOS on a Mac, or Linux (Ubuntu, Mint, Fedora and others).',
  'Drive (hard drive, SSD, disk): where files are stored even when the power is off. An SSD is the fast modern kind with no moving parts; a hard drive (HDD) spins and is much slower.',
  'Memory (RAM): the short-term workspace the computer uses while it is switched on. More memory lets more programs run at once without slowing down.',
  'Processor (CPU): the chip that does the computer\'s work. Heavy tests make it hot, which is normal up to a point.',
  'Partition and volume: a drive can be split into sections. Each section that holds files is a volume, shown as a drive letter (C:, D:) on Windows or a name on a Mac.',
  'Firmware, BIOS and UEFI: the small built-in program that starts the computer before Windows or macOS loads. It is where you choose to start from a USB stick.',
  'Driver: a small program that lets the system talk to a piece of hardware such as a printer, graphics card or Wi-Fi card.']),
 sec('About repairs',[
  'Administrator (admin): an account allowed to change the whole computer. Most repairs need it. See "Administrator rights and passwords".',
  'Restore point (Windows): a snapshot of Windows\' settings and system files taken before a change, so the change can be rolled back. It does not back up your documents or photos.',
  'Backup: a separate copy of your files on another drive or online. The only real protection against losing them.',
  'Recipe: in MendKit, a list of checks and fixes run one after another for one problem, such as "No internet".',
  'Tweak: in MendKit, a single setting change that can always be put back.',
  'Log: the complete record of what a command printed while it ran. Technicians use it to see exactly what happened.',
  'Quarantine: a folder where MendKit moves something it removed instead of deleting it, so it can be put back from the Undo Center.']),
 sec('About files and downloads',[
  'ISO file: a single file holding an entire disc, such as a Windows installer or a rescue system. It is copied to a USB stick so a computer can start from it.',
  'Bootable USB stick: a stick a computer can start from instead of its own drive. Needed to repair a computer that will not start.',
  'Installer: the file that adds a program to the computer, usually ending .exe or .msi on Windows, .dmg or .pkg on a Mac.',
  'Portable program: runs straight from its file or folder without being installed.',
  'Command line, Terminal, Command Prompt, PowerShell: a window where you type instructions instead of clicking. Some tools only work this way.',
  'Package manager (winget, Homebrew, apt and others): the system\'s own app store for programs, used by MendKit to install tools safely from their official sources.']),
 sec('About networks',[
  'Router: the box from your internet company that makes your Wi-Fi and connects your home to the internet.',
  'IP address: the number the router gives each device on the network, such as 192.168.1.20.',
  'DNS: the internet\'s phone book that turns names like google.com into addresses. When DNS fails, websites will not load even though the connection is up.',
  'Ethernet: a network cable plugged into the computer, as opposed to Wi-Fi.'])],
 systems='Windows, macOS, Linux', time='5 minutes to read', level='Easy', related=['basics-admin','basics-terminal','basics-boot']),

G('basics-admin',GR,'Administrator rights and passwords','What "administrator" means, how to give MendKit those rights on each system, and what to do with a standard account.',[
 sec('Why it matters',[
  'Repairs change system files and settings. Windows, macOS and Linux only let an administrator do that, to stop harmful programs doing it behind your back.',
  'Without administrator rights MendKit still runs, but repair steps that need them are skipped and marked "Skipped, needs administrator".',
  'MendKit never stores your password. On a Mac and Linux it asks the system to prompt you, and the system checks the password, not MendKit.']),
 sec('On Windows',[
  S('Open MendKit. On the Dashboard, click Restart as administrator.', see='Windows dims the screen and asks "Do you want to allow this app to make changes to your device?"'),
  S('Click Yes.', see='MendKit closes and opens again. The badge at the bottom left now says Administrator in green.', tip='If Windows asks for a password instead of showing a Yes button, your account is a standard account. Type the name and password of an administrator on this computer.'),
  S('To start MendKit as administrator every time, right-click its icon on the desktop or Start menu, choose More, then Run as administrator.')],'steps'),
 sec('On a Mac',[
  S('Nothing to do in advance. When a step needs administrator rights, MendKit asks once for the password you use to sign in to the Mac.', see='A small box titled with the step\'s name asks for your password. Type it and click OK. Nothing appears as you type; that is normal.'),
  S('If the account is not an administrator, macOS asks for an administrator\'s name and password instead. Find out in System Settings, Users & Groups: it says "Admin" under the account name.'),
  'MendKit asks only once for a whole job, so you can leave it running.'],'steps'),
 sec('On Linux',[
  S('When a step needs it, MendKit asks for your password once through the system\'s own password window (polkit) or sudo.', see='A password box from the system, not from MendKit.'),
  'Your account must be allowed to use sudo. On Ubuntu and Mint the first account created is.'],'steps'),
 sec('If something goes wrong',[
  'Forgotten the Windows password for a Microsoft account: reset it at account.live.com/password/reset from any device.',
  'Forgotten a Mac password: on the password screen click the question mark, or restart in Recovery and use Reset Password.',
  'Typing the password and nothing happens: check Caps Lock, and on a laptop check that the number keys are not acting as a number pad.'])],
 systems='Windows, macOS, Linux', time='2 minutes', level='Easy', related=['mendkit','basics-words']),

G('basics-terminal',GR,'Opening Terminal and typing a command','How to open the command window on each system, type a command exactly, and read what comes back. Several tools work only this way.',[
 sec('Before you start',[
  'You do not need to learn the command line. The guides give each command to copy exactly.',
  'Copy commands from the guide rather than typing them where you can: one wrong space or letter changes the meaning.',
  'Commands that start with sudo change the system and ask for your password.']),
 sec('Open it on Windows',[
  S('Click Start, type Terminal (on Windows 10, type PowerShell) and click it.', see='A dark window with a line ending in > and a blinking cursor. That line is the prompt.'),
  S('For a command that needs administrator rights, right-click Terminal in the Start menu instead and choose Run as administrator, then click Yes.', see='The window title starts with "Administrator".')],'steps'),
 sec('Open it on a Mac',[
  S('Press Command and Space together, type Terminal and press Return.', see='A window with a line ending in % or $. Your name and the Mac\'s name are on that line.'),
  'Or open Finder, Applications, Utilities, Terminal.'],'steps'),
 sec('Open it on Linux',[
  S('Press Ctrl, Alt and T together. If nothing happens, open the applications menu and type Terminal.', see='A window with a line ending in $.')],'steps'),
 sec('Type a command and read the result',[
  S('Click inside the window. Paste the command (Ctrl+V on Windows, Command+V on a Mac, Ctrl+Shift+V on Linux) or type it exactly.'),
  S('Press Enter (Return on a Mac).', see='The command prints its result, then a new prompt line appears when it has finished.', tip='A command that is still working shows no new prompt. Wait for it.'),
  S('If it asks for a password, type it and press Enter. Nothing appears on screen while you type a password; that is normal.'),
  S('To stop a command that is running, hold Ctrl and press C.'),
  S('Read the last few lines. Words such as "error", "not found" or "permission denied" mean it did not work.', tip='"command not found" or "is not recognized" means the tool is not installed or the name was mistyped. Install it from MendKit\'s Tools screen.'),
  S('To copy the result for a technician, select the text with the mouse and press Ctrl+C (Command+C on a Mac). On Windows Terminal, selecting the text copies it.')],'steps')],
 systems='Windows, macOS, Linux', time='5 minutes', level='Easy', related=['basics-words','basics-admin']),

G('basics-boot',GR,'Starting a computer from a USB stick','How to make a computer start from a rescue or installer USB stick instead of its own drive, with the key to press for each brand.',[
 sec('Boot menu keys by brand',[
  'Dell: F12. HP: F9, or Esc then F9. Lenovo laptops: F12 (or the small Novo button with a curved arrow). Lenovo desktops: F12.',
  'Acer: F12 (turn on "F12 Boot Menu" in the BIOS first if it does nothing). Asus: F8 or Esc. MSI: F11. Gigabyte: F12. Toshiba/Dynabook: F12. Samsung: F2 or Esc. Microsoft Surface: hold Volume Down while pressing power.',
  'Custom-built PCs: watch the first screen for "Boot Menu" or "BBS" and the key next to it; usually F8, F11 or F12.']),
 sec('On a Windows PC',[
  S('Plug the USB stick in while the computer is off.'),
  S('Press the power button, then immediately tap the boot menu key for your brand about twice a second.', see='A list titled Boot Menu, Boot Device or Please select boot device, with the drive and the USB stick (often by its maker\'s name, such as SanDisk or Kingston).', tip='If Windows starts instead, the computer was not fully off. In Windows, hold Shift while you click Restart, then choose Use a device and pick the USB stick.'),
  S('Use the arrow keys to pick the USB stick (if it is listed twice, choose the one starting UEFI) and press Enter.', see='The stick\'s menu, such as Ventoy\'s list of ISO files, or the installer starting.'),
  S('When you have finished, remove the stick and restart. The computer starts from its own drive again.')],'steps'),
 sec('On a Mac',[
  S('Apple silicon (M1 and later): shut down, then press and hold the power button until "Loading startup options" appears. Choose the USB stick and click Continue.'),
  S('Intel Mac: restart and hold the Option key until the drive icons appear. Click the USB stick.', warn='Intel Macs with a T2 chip (2018 to 2020) refuse USB sticks until you allow it: start in Recovery (Command R), choose Utilities, Startup Security Utility, and tick "Allow booting from external or removable media".')],'steps'),
 sec('If the stick is not in the list',[
  'Try a different USB port, ideally one on the back of a desktop or directly on a laptop rather than through a hub.',
  'Windows Fast Startup can make the key ignored: in Windows hold Shift while clicking Restart, then Use a device.',
  'Some rescue sticks do not start with Secure Boot on. Enter the BIOS (usually F2 or Del at power on), find Secure Boot under Boot or Security, set it to Disabled, press F10 to save, and turn it back on afterwards.',
  'Make sure the stick was written correctly: with Ventoy or Rufus, not by just copying the ISO file onto a plain stick.'])],
 systems='Windows PCs, Mac', time='5 minutes', level='Takes care', need=['A USB stick prepared with Ventoy or Rufus','The computer plugged into power'], related=['ventoy','rufus','mk-iso']),

G('basics-version',GR,'Finding a computer\'s model, system and serial number','Where to read the make, model, serial number and system version, which repair shops, warranty checks and downloads ask for.',[
 sec('The quick way: MendKit',[
  S('Open MendKit. The Dashboard shows the system version, processor and memory.'),
  S('Click View all specs and temperatures for the full hardware list.'),
  S('Open Reports. The top line shows the computer\'s maker, model and serial number.')],'steps'),
 sec('Windows without MendKit',[
  S('Press the Windows key and R together, type winver and press Enter.', see='A box saying Windows 11 or 10, the version (such as 24H2) and the build number.'),
  S('For model and serial, open Terminal and type: wmic bios get serialnumber, or look on the sticker underneath a laptop or on the back of a desktop.')],'steps'),
 sec('Mac without MendKit',[
  S('Click the Apple menu at the top left and choose About This Mac.', see='The Mac\'s model and year, chip, memory, macOS version and serial number. Click the serial number to copy it.')],'steps'),
 sec('Linux without MendKit',[
  S('Open Terminal and type: hostnamectl', see='The distribution and version, kernel, and on most computers the maker and model.')],'steps')],
 systems='Windows, macOS, Linux', time='2 minutes', level='Easy', related=['mk-dashboard']),

G('basics-backup',GR,'Back up before you fix anything','The simplest safe way to copy someone\'s files before a repair, so nothing can be lost whatever happens.',[
 sec('Why first',[
  'Most repairs are safe. But a failing drive can stop working completely at any moment, and the stress of a scan or repair can be what finishes it.',
  'A restore point protects Windows settings, not documents and photos. Only a copy on another drive does that.']),
 sec('How to do it with MendKit',[
  S('Plug in an external drive or USB stick with more free space than the person\'s files take.', tip='Open MendKit\'s Dashboard: if any drive card does not say Healthy, back up before anything else and copy the most precious folders first.'),
  S('Open Migrate and click Back up to a drive.', see='A list of the user accounts and folders: Desktop, Documents, Pictures, Music, Videos, Downloads and browser data, with sizes.'),
  S('Choose the external drive, tick what to copy and click Start.', see='Progress in the bottom panel. Photos and videos can take an hour or more.'),
  S('When it finishes, open the drive in File Explorer or Finder and check that the folders are there and that a few photos and documents open.'),
  S('Keep the drive somewhere safe until the repair is finished and the person has checked their files.')],'steps'),
 sec('Without MendKit',[
  'Windows: open File Explorer, select the folders in the user\'s folder and drag them to the external drive.',
  'Mac: plug in a drive and let Time Machine use it, or drag the home folder\'s Documents, Desktop and Pictures to the drive.',
  'Photos in the Photos app on a Mac live in one file, Photos Library, in the Pictures folder. Copy that whole file.'])],
 systems='Windows, macOS, Linux', time='15 minutes to several hours', level='Easy', need=['An external drive or large USB stick'], related=['mk-migrate','mk-backup-erase']),

G('basics-windows-recovery',GR,'Windows Safe Mode and recovery','How to reach Windows\' own recovery menu and Safe Mode when Windows misbehaves or will not start.',[
 sec('Reach the recovery menu',[
  S('If Windows starts: click Start, then the power button, then hold Shift while clicking Restart.', see='A blue screen titled Choose an option.'),
  S('If Windows will not start: switch the computer on and, as soon as the logo appears, hold the power button until it switches off. Do this three times. On the fourth start Windows opens Automatic Repair, then click Advanced options.'),
  S('Choose Troubleshoot, then Advanced options.', see='Startup Repair, Startup Settings, Command Prompt, Uninstall Updates, System Restore and System Image Recovery.')],'steps'),
 sec('What each option does',[
  'Startup Repair: Windows tries to fix whatever stops it starting. Try this first.',
  'System Restore: goes back to an earlier restore point, such as "MendKit before repair". Files are not touched.',
  'Uninstall Updates: removes the most recent update, which helps when trouble started straight after one.',
  'Startup Settings: restart into Safe Mode (press 4) or Safe Mode with Networking (press 5).',
  'System Image Recovery: puts back a full backup image made in MendKit\'s Backup & Erase screen. It replaces everything on the drive.']),
 sec('Using Safe Mode',[
  'Safe Mode starts Windows with only Microsoft\'s basic drivers. If the problem is gone in Safe Mode, a driver or program is the cause.',
  'You can run MendKit in Safe Mode with Networking to scan for malware or remove a bad program.',
  'Restart normally to leave Safe Mode.'],),
 sec('BitLocker recovery key',[
  S('If the screen asks for a BitLocker recovery key, the drive is encrypted. The key is a 48-digit number.', tip='Find it on another device at aka.ms/myrecoverykey, signed in with the person\'s Microsoft account.', warn='Without the key the files cannot be read by anyone. Never reset or reinstall until you have it.')])],
 systems='Windows 10 and 11', time='10 minutes', level='Takes care', related=['mk-reinstall','basics-boot']),

G('basics-safety',GR,'Staying safe: scams and fake support','How to tell real help from a scam, and what MendKit will and will not do on a computer.',[
 sec('Signs of a scam',[
  'A pop-up or phone call says the computer is infected and gives a number to call. Microsoft, Apple and banks never do this.',
  'Someone asks you to install a program so they can "fix" the computer, then asks for payment, gift cards or your bank login.',
  'A website says you must call or pay before it will let you leave. Close the browser: on Windows hold Ctrl and Shift and press Esc, select the browser and click End task. On a Mac press Command, Option and Esc.']),
 sec('What MendKit does and does not do',[
  'MendKit only runs the commands in its own lists. It never asks for card or bank details and never sends your files anywhere.',
  'Remote support (RustDesk) only starts when you click Open RustDesk and read out the code. Only do that with someone you contacted yourself.',
  'Emailing a report opens a draft in your own mail program; nothing is sent until you press Send.']),
 sec('If you think you were scammed',[
  S('Disconnect the computer from the internet: unplug the cable or turn off Wi-Fi.'),
  S('In MendKit, run Check for remote access on the Dashboard and remove the programs the scammer installed.', tip='See the guide "Remote access audit".'),
  S('From a different device, change your email and banking passwords.'),
  S('Call your bank on the number on the back of your card if any money, card details or banking was involved.'),
  S('Run "Pop-ups or strange behaviour" from the Dashboard for a malware scan.')],'steps')],
 systems='Windows, macOS, Linux', time='5 minutes to read', level='Easy', related=['remote-audit','mk-dashboard']),
]
