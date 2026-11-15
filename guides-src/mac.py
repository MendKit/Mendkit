from lib import *
GR='Mac'
GUIDES=[
G('mac-tools','Using MendKit','Mac tools: startup items, space, damaged apps, other drives','The four Mac tools on the Repair screen, step by step.',[
 sec('Open them',[S('Tick Technician mode, click Repair. Mac tools is the first section.', tip='Give MendKit Full Disk Access first (see "Permissions setup"), or some folders cannot be checked.')],'steps'),
 sec('Startup items',[
  S('Click Open beside Startup items, then Scan.', see='Each program set to start with the Mac or run in the background, not made by Apple: who made (signed) it, what it runs, and whether it is running now. Login items are listed at the bottom.'),
  S('Look for items you do not recognise, items marked "not signed", and items marked "program missing" (leftovers from something already removed).', tip='Search the item\'s name on the web if unsure. Names like com.google.keystone or com.microsoft.update belong to known apps.'),
  S('Tick the ones to remove and click Remove selected. Items for every account or the whole Mac need your password.', see='They stop starting. Your own items can be put back from the Undo Center; system-wide items are moved to /Library/Application Support/MendKit/Quarantine.'),
  S('To remove a login item, click Remove beside it. The first time, click OK when macOS asks whether MendKit may control System Events.'),
  S('Restart the Mac to make sure the items stay gone.')],'steps'),
 sec('Free up space',[
  S('Click Open beside Free up space, then Measure.', see='How much is free, then each kind of clearable file with its size: app caches, logs, iPhone and iPad update files, Mail attachments, Xcode files, the Trash, and each iPhone or iPad backup with its device name and date. Then files over 1 GB.'),
  S('The safe ones are ticked for you. Tick a device backup only if that device is backed up to iCloud or no longer used.', warn='Deleted files do not go to the Trash. They are gone.'),
  S('Click Delete selected.', see='Results with how much space was freed.'),
  S('For large files and Downloads, click Show in Finder and decide yourself. MendKit never deletes them.')],'steps'),
 sec('Fix an app that will not open',[
  S('Use this when macOS says an app "is damaged and can\'t be opened", "cannot be opened because the developer cannot be verified", or "cannot be checked for malicious software".', warn='Only for apps you trust, downloaded from the maker\'s own website. A real malware warning ("will damage your computer") must not be bypassed.'),
  S('Click Open beside Fix an app that will not open, then Choose the app and pick it in Applications.', see='Whether it is blocked as downloaded from the internet, and whether its signature is valid.'),
  S('Leave "Also re-sign it on this Mac" ticked if the signature is not valid. Click Fix.'),
  S('Open the app again. If macOS still asks, go to System Settings, Privacy & Security, scroll down and click Open Anyway.')],'steps'),
 sec('Check another drive',[
  S('Plug in the external drive or USB stick. Click Open beside Check another drive.'),
  S('Choose the drive in the list. Click Check drive.', see='"appears to be OK", or a list of problems.'),
  S('If problems were found, tick Repair problems it finds and click Repair drive. Type your password.', tip='If repair fails, copy the files off the drive now: it may be failing.')],'steps')],
 systems='macOS', time='5 to 20 minutes', level='Takes care', screen='repair', related=['mk-permissions','mk-repair','appcleaner','grandperspective']),

G('mac-safe-mode',GR,'Start a Mac in Safe Mode','Starting macOS with only Apple\'s own software, to find out whether an app or add-on is behind a problem.',[
 sec('Apple silicon (M1 and later)',[
  S('Click the Apple menu and choose Shut Down. Wait 10 seconds after the screen goes dark.'),
  S('Press and hold the power button (Touch ID button on a laptop). Keep holding.', see='"Loading startup options", then the startup disk and an Options gear.'),
  S('Click the startup disk (usually Macintosh HD). Hold Shift and click Continue in Safe Mode, then let go of Shift.'),
  S('Sign in. You may be asked to sign in twice.', see='"Safe Boot" in red at the top right of the login window.')],'steps'),
 sec('Intel Macs',[
  S('Restart the Mac and immediately press and hold Shift.'),
  S('Let go when the login window appears. Sign in, possibly twice.', see='"Safe Boot" at the top right of the login window.')],'steps'),
 sec('What it tells you',[
  'If the problem is gone in Safe Mode, something installed is causing it. Restart normally and use Startup items in MendKit to remove leftovers and unknown items.',
  'If the problem is still there, it is more likely macOS itself or hardware: try "macOS Recovery and First Aid", then MendKit\'s hardware tests.',
  'Safe Mode also checks the startup disk and clears some caches, so a normal restart afterwards sometimes fixes things on its own.',
  'Safe Mode is slower and some features (graphics effects, some Wi-Fi and audio) may not work. That is normal.',
  'To leave Safe Mode, restart normally.'])],
 systems='macOS', time='10 minutes', level='Easy', related=['mac-tools','mac-recovery']),

G('mac-recovery',GR,'macOS Recovery and First Aid','Repairing the startup disk from outside macOS, and reinstalling macOS without erasing files.',[
 sec('Open Recovery',[
  S('Apple silicon: shut down. Press and hold the power button until "Loading startup options" appears. Click Options, then Continue.'),
  S('Intel: restart and immediately hold Command and R until the Apple logo appears.'),
  S('Choose a user and type its password if asked.', see='macOS Recovery with Restore from Time Machine, Reinstall macOS, Safari and Disk Utility.')],'steps'),
 sec('Repair the disk with First Aid',[
  S('Choose Disk Utility and click Continue.'),
  S('Click View in the toolbar and choose Show All Devices.', see='The internal disk, its container, and volumes such as Macintosh HD and Macintosh HD - Data.'),
  S('Select the last volume in the list, click First Aid, then Run.', tip='Work upwards: each volume, then the container, then the disk itself.'),
  S('If it says it repaired something, run it again until it finds no problems.', warn='"First Aid failed" or "unable to repair" on the disk itself: copy the files off now and plan to replace or erase the drive.')],'steps'),
 sec('Reinstall macOS and keep files',[
  S('Quit Disk Utility. Choose Reinstall macOS and click Continue.'),
  S('Choose the startup disk (Macintosh HD) and follow the steps.', see='A progress bar. It takes 30 minutes to over an hour and restarts several times.', tip='Keep a laptop on its charger and connected to the internet. Files, apps and settings stay.')],'steps'),
 sec('Restore from Time Machine',['Restore from Time Machine puts the whole Mac back as it was at a backup time. It replaces what is there now.'])],
 systems='macOS', time='15 minutes to 2 hours', level='Takes care', related=['mac-safe-mode','mac-bootable-installer','mk-reinstall']),

G('mac-nvram-smc',GR,'Reset NVRAM and SMC on Intel Macs','Clearing the stored settings behind startup, sound, display, fan and power problems on Intel Macs. Apple-silicon Macs do this themselves on a restart.',[
 sec('When it helps',['Fans running flat out, a battery that will not charge, a Mac that will not wake from sleep, the wrong startup disk, sound or display settings that keep resetting, or power and lights acting oddly.']),
 sec('Which Mac do I have?',['Apple menu, About This Mac. "Chip: Apple M..." means Apple silicon: just shut down, wait 30 seconds and start it again. "Processor: Intel" means follow these steps.']),
 sec('Reset NVRAM (PRAM)',[
  S('Shut the Mac down.'),
  S('Press the power button, then immediately press and hold Option, Command, P and R together.'),
  S('Keep holding for about 20 seconds. On a Mac with a T2 chip, let go after the Apple logo appears and disappears a second time. On older Macs, let go after the second startup sound.'),
  S('Afterwards, check the startup disk (System Settings, General, Startup Disk), display resolution, sound volume and time zone.')],'steps'),
 sec('Reset the SMC: laptops with a T2 chip (2018 to 2020)',[
  S('Shut down. Press and hold Control, Option and Shift on the left side for 7 seconds.'),
  S('Keep holding them and also press and hold the power button for another 7 seconds.'),
  S('Let go of everything, wait a few seconds, and press the power button to start the Mac.')],'steps'),
 sec('Reset the SMC: other laptops (non-removable battery, before 2018)',[
  S('Shut down. Hold Shift, Control and Option on the left side and the power button, all together, for 10 seconds.'),
  S('Let go and press the power button.')],'steps'),
 sec('Reset the SMC: desktops (iMac, Mac mini, Mac Pro)',[
  S('Shut down and unplug the power cord. Wait 15 seconds.'),
  S('Plug it back in, wait 5 seconds, and press the power button.')],'steps')],
 systems='macOS (Intel Macs)', time='5 minutes', level='Easy', related=['mac-battery','basics-version']),

G('mac-bootable-installer',GR,'Make a bootable macOS USB installer','A USB stick that installs or reinstalls macOS without the internet or a working Recovery.',[
 sec('Get the installer',[
  S('In MendKit, open Repair and run "Download the macOS installer". Type your password.', see='"Install macOS ..." appears in Applications. It is over 12 GB, so allow time.', tip='For a specific older version, use Apple\'s support page "How to download and install macOS". "macOS installers available" lists what Apple offers this Mac.')],'steps'),
 sec('Make the stick',[
  S('Plug in a USB stick of 32 GB or more.', warn='Everything on the stick will be erased.'),
  S('Open Disk Utility (Applications, Utilities). Click View, Show All Devices. Select the stick (the top line for it, with its maker\'s name).'),
  S('Click Erase. Name: MyVolume. Format: Mac OS Extended (Journaled). Scheme: GUID Partition Map. Click Erase.'),
  S('Open Terminal (see "Opening Terminal and typing a command") and type, replacing Sequoia with the name of the installer you downloaded:', see='sudo /Applications/Install\\ macOS\\ Sequoia.app/Contents/Resources/createinstallmedia --volume /Volumes/MyVolume'),
  S('Press Return, type your Mac password (nothing shows as you type) and press Return. Type Y and press Return when asked.', see='"Erasing disk", "Copying to disk" with percentages, then "Install media now available". It takes 10 to 30 minutes.'),
  S('Eject the stick in Finder before unplugging it.')],'steps'),
 sec('Start from it',[
  S('Apple silicon: shut down, hold the power button until startup options appear, choose the installer and click Continue.'),
  S('Intel: restart holding Option and choose the installer.', tip='Macs with a T2 chip need "Allow booting from external media" in Startup Security Utility first (Recovery, Utilities).')],'steps')],
 systems='macOS', time='1 hour including the download', level='Takes care', need=['A USB stick of 32 GB or more','An administrator password'], related=['mac-recovery','basics-boot']),

G('mac-battery',GR,'Mac battery checks','Reading a Mac\'s battery condition, making it last longer, and knowing when it needs replacing.',[
 sec('Check it',[
  S('In MendKit, run Battery from the Repair screen, or run the Health report.', see='Cycle count, condition and Maximum Capacity. Under 80% is flagged as due for replacement.'),
  S('Or open System Settings, Battery, and click the info button next to Battery Health.', see='Normal, or Service Recommended.')],'steps'),
 sec('Make it last longer between charges',[
  'Turn on Optimised Battery Charging in Battery settings.',
  'In MendKit Repair, run "Turn off Power Nap" and "Set sensible sleep timers".',
  'Run the "Runs hot or shuts down" recipe: an app keeping the processor busy drains the battery fast.',
  'Lower the screen brightness; it is the biggest single drain.']),
 sec('When to stop using it',[
  S('A swollen battery lifts the trackpad, makes the bottom case bulge or stops the laptop sitting flat.', warn='Stop using and charging the Mac and have the battery replaced right away. Swollen batteries can catch fire. Do not press on it.'),
  'Sudden shutdowns at 20 to 40% charge mean a worn battery. "Why did it shut down?" in MendKit confirms it.'])],
 systems='macOS (laptops)', time='5 minutes', level='Easy', related=['coconutbattery','mac-nvram-smc']),
]
