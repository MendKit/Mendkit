from lib import *
GR='Using MendKit'
ALL='Windows, macOS, Linux'
GUIDES=[
G('mendkit',GR,'Getting started with MendKit','Your first run: what to do before you start, the two modes, and the safest order to work in.',[
 sec('Before you start',[
  S('Plug a laptop into power. Repairs, scans and transfers can take an hour or more, and a laptop that dies part-way through a repair can be left worse off.'),
  S('Save any open work and close other programs, so their files are not locked while MendKit works.'),
  S('If Windows says it is waiting to restart for an update, restart first. Repairs can stall while an update is half installed.'),
  S('Back up anything that cannot be lost.', tip='See "Back up before you fix anything". MendKit saves a restore point before repairs, but that does not protect documents and photos.')],'steps'),
 sec('First start',[
  S('Open MendKit from the Start menu (Windows), Applications (Mac) or the applications menu (Linux).', see='The first time, a Welcome screen lists the permissions MendKit needs. See "Permissions setup".'),
  S('Allow what is listed, then click Start using MendKit (or Skip for now).', see='The Dashboard: the computer\'s name, system, processor, memory, free space and drive health.'),
  S('On Windows, click Restart as administrator on the Dashboard and click Yes.', see='The badge at the bottom left turns green and says Administrator.', tip='On a Mac or Linux there is nothing to restart: MendKit asks for your password when a step needs it.')],'steps'),
 sec('Simple mode and Technician mode',[
  'MendKit starts in Simple mode: Dashboard, Migrate, Updates, Hardware Tests, Crash Analyzer, ISO Library, Undo Center, How-To Guides, Reports and Permissions. Results are in plain language.',
  'Tick Technician mode at the bottom left to add Repair, Tools, Tweaks, Setup Profiles and Backup & Erase, the live output panel, exit codes and the full logs.',
  'Simple mode only runs safe recipes and will not carry on with a repair if a restore point cannot be saved. Leave it on for customers.']),
 sec('The safest order to work in',[
  S('Read the Dashboard cards. A drive that does not say Healthy needs its files copied off before anything else.'),
  S('Run Health report under Other fixes. It changes nothing and tells you what is wrong.'),
  S('Pick the problem under What is the problem?, or click Fix my computer for a general service.'),
  S('Read the results, restart if asked, and check the problem is gone.'),
  S('If something got worse, use the Undo Center or System Restore.', tip='See "Undo Center".')],'steps'),
 sec('Finding your way around',[
  'Every screen is in the menu on the left. The bottom panel shows what is running, a progress bar and Cancel.',
  'The badges at the bottom left show administrator rights, "No internet" when the connection is down, and "Update available" when a new MendKit is out.',
  'Every guide is in How-To Guides. Each tool on the Tools screen has a "How to use it" link to its own guide. Print this guide puts a guide on paper to follow at the bench.']),
 sec('Without internet',[
  'MendKit checks the connection every minute and shows "No internet" at the bottom left when it is down.',
  'Repairs, hardware tests, the crash analyzer, migration, tweaks, backup and erasing all work offline.',
  'Tool installs, updates and ISO downloads need a connection, except tools saved for offline use (see "Offline installers"). Fix the network first with "No internet" on the Dashboard.'])],
 systems=ALL, time='10 minutes', level='Easy', screen='dashboard', related=['mk-dashboard','mk-results','mk-permissions','basics-admin']),

G('mk-permissions',GR,'Permissions setup','Giving MendKit the access it needs: Full Disk Access on a Mac, administrator rights on Windows, and camera and microphone for the hardware tests.',[
 sec('When it appears',[
  'The first time MendKit opens after install, it starts on the Welcome screen. Open it again any time from Permissions in the menu.',
  'Each permission shows a green tick when allowed, and amber or red when it is not. The screen checks again every few seconds, so you can switch things on in Settings and watch them turn green.',
  'Items marked optional only matter for one feature, such as the camera test.']),
 sec('On a Mac: Full Disk Access',[
  S('Click Open Settings beside Full Disk Access.', see='System Settings opens at Privacy & Security, Full Disk Access, and a Finder window shows MendKit in Applications.'),
  S('If MendKit is in the list, turn its switch on. If it is not, drag MendKit from the Finder window into the list, or click + under the list, choose Applications, MendKit and click Open.', see='macOS asks for your password or Touch ID. Then MendKit\'s switch is on.'),
  S('If macOS offers Quit & Reopen, choose it. Otherwise click Restart MendKit at the bottom of the Permissions screen.', see='Full Disk Access shows Allowed with a green tick.', tip='Still Not allowed after an update of MendKit? Select MendKit in the Settings list, click −, then add it again. macOS keeps an old switch from the previous version that no longer applies.')],'steps'),
 sec('On a Mac: camera, microphone and the rest',[
  S('Click Allow beside Camera.', see='macOS asks "MendKit would like to access the camera". Click OK (or Allow).'),
  S('Do the same for Microphone.'),
  S('Click Allow beside Control System Events and click OK when macOS asks. This lets MendKit list and remove login items.'),
  S('Click Send a test beside Notifications.', see='A MendKit notification at the top right. If none appears, click Open Settings and turn on Allow notifications for MendKit.'),
  S('If something was refused before, Allow does nothing: macOS only asks once. Click Open Settings and turn MendKit on in that list instead.')],'steps'),
 sec('On Windows',[
  S('Running as administrator: click Restart as administrator and click Yes.'),
  S('Camera or Microphone shows Not allowed: click Open Settings. Turn on Camera access (or Microphone access) and further down "Let desktop apps access your camera" (or microphone).'),
  S('Notifications: click Send a test. If nothing appears, Open Settings and turn notifications on.')],'steps'),
 sec('On Linux',[
  'Password prompt for repairs needs pkexec or sudo, which almost every desktop Linux has.',
  'If the camera shows Not allowed, open Terminal, type sudo usermod -aG video $USER, then sign out and back in.']),
 sec('Finish',[S('Click Start using MendKit (or Done). Missing permissions are listed on the Dashboard on a Mac until they are given.')],'steps')],
 systems=ALL, time='5 minutes', level='Easy', screen='permissions', related=['mendkit','basics-admin']),

G('mk-dashboard',GR,'Dashboard and Fix my computer','Reading the Dashboard, running a general service, fixing a specific problem, and asking whether a computer is worth fixing.',[
 sec('Read the cards',[
  'Computer, System, Processor and Memory describe the machine.',
  'System drive shows free space. Under 10% free turns amber: the computer will be slow and updates may fail. See "Free up space" (Mac) or run Low on space.',
  'Each drive shows its health. Anything other than Healthy means copy the files off first.',
  S('Click View all specs and temperatures for every hardware detail and live temperatures (refreshed every 10 seconds).')]),
 sec('Fix my computer (general service)',[
  S('Click Fix my computer.', see='A preview listing each step: restore point, drive check, system file repair, disk check, virus scan and cleanup, with how long each usually takes.'),
  S('Read the preview, choose what happens when it finishes (do nothing, restart or shut down), and click Start.', tip='Allow 30 to 60 minutes. You can keep using the computer lightly, but do not start anything else in MendKit.'),
  S('When it finishes, read the results.', tip='See "Reading the results".')],'steps'),
 sec('What is the problem?',[
  S('Click the button that matches the trouble: slow, no internet, Wi-Fi dropping, pop-ups or strange behaviour, updates failing, crashing, printer, sound, Bluetooth, camera, and on a Mac also an app will not open, runs hot or shuts down, and out of space.', tip='Hover over a button to see what it checks and how long it takes.'),
  S('Check the preview and click Start. MendKit runs the checks and fixes for that problem only.'),
  S('Restart if the results ask you to, then test the problem again.')],'steps'),
 sec('Other fixes',[
  'Health report: checks everything and changes nothing. A good first run on any computer.',
  'Network check: tests the connection step by step (adapter, router, internet, names) and measures download speed. It tests whichever connection is active, cable or Wi-Fi.',
  'Network fix: resets the network settings. Needs a restart afterwards, and saved Wi-Fi networks may need their password again.',
  'Backup checkup: says whether the computer has a working backup.',
  'Check for remote access: looks for remote-control programs. See "Remote access audit".']),
 sec('Is this computer worth fixing?',[
  S('Click the button under Is this computer worth fixing?', see='A verdict of keep, upgrade or replace, with the reasons: memory, drive type, age, battery, and Windows 11 readiness.'),
  'It changes nothing. On Windows, run MendKit as administrator so the Windows 11 check can read the security chip.']),
 sec('Get help',[
  S('Click Get help on the Dashboard or on a results screen.'),
  S('Email this report opens a draft in your mail program with what MendKit found. Read it, add a note and press Send yourself.'),
  S('Open RustDesk starts remote support. Read the ID and one-time password to your technician.', warn='Only do this with a technician you contacted yourself, never with someone who called you.')],'steps')],
 systems=ALL, time='5 minutes plus the run', level='Easy', screen='dashboard', related=['mk-results','mendkit','remote-audit']),

G('mk-results',GR,'Previews, running jobs and reading the results','What the preview tells you, how to follow a job while it runs, and what each colour on the results screen means.',[
 sec('The preview',[
  'Every recipe opens a preview first. It lists each step in order, what it does, how long it usually takes and whether it needs a restart.',
  'Nothing has changed yet. Back leaves without running anything.',
  '"Must succeed to continue" marks a safety step, such as saving a restore point. If it fails, the rest does not run.',
  'On Windows, When it finishes lets you restart or shut down automatically. A restart or shutdown waits one minute and shows Cancel it.']),
 sec('While it runs',[
  'The bottom panel shows "Running step 3 of 8", the step name, the time so far, the usual time and a progress bar.',
  'You can use the computer lightly. MendKit runs one job at a time and tells you if you try to start another.',
  'Cancel stops the current step. Steps already finished stay done.',
  'If a step runs far past its usual time on Windows, it is usually waiting on Windows Update. Cancel, restart the computer and run it again.',
  'When the window is behind others, a notification tells you the job finished.']),
 sec('Reading the results',[
  'The headline says in one line whether all is well, something needs attention, or there is a problem.',
  'Green tick: the check passed or the fix worked.',
  'Blue "i": information only.',
  'Amber "!": something to look at, such as updates waiting or a step that could not run.',
  'Red cross: a problem MendKit could not fix. The text says what it means and what to do next.',
  '"Skipped, needs administrator": restart MendKit as administrator and run it again.',
  'If the results say to restart, restart before deciding whether the fix worked.']),
 sec('Keeping and sharing results',[
  S('Save customer report (PDF) makes a one-page summary with a health score, what was found and fixed, and what to watch for. Save it or print it.'),
  S('Copy report text copies the summary to paste into an email or a job ticket.'),
  S('Every run is kept in Reports.')],'steps')],
 systems=ALL, time='5 minutes to read', level='Easy', related=['mk-reports','mk-dashboard','mk-undo']),

G('mk-repair',GR,'Repair: recipes and single commands','Running a whole repair recipe or a single command yourself, in Technician mode.',[
 sec('Open it',[
  S('Tick Technician mode at the bottom left and click Repair.', see='Recipes at the top, then every single command, each with how long it takes and tags for "admin" and "restart". On a Mac, a Mac tools section comes first.'),
  S('Type in the search box to find a recipe or command by name or by what it does.')],'steps'),
 sec('Run a recipe',[
  S('Click Run beside the recipe.', see='The preview of every step.'),
  S('Click Start.'),
  S('Read the results and restart if asked.', tip='"Continue even if a restore point cannot be created" lets a technician go ahead when System Restore is turned off. Leave it unticked unless you have another backup.')],'steps'),
 sec('Run a single command',[
  S('Click Run beside the command. It starts straight away, without a preview.', warn='Commands tagged restart change things that only finish after a restart. Network reset commands drop the connection briefly.'),
  S('Watch the output in the bottom panel, then read the results.')],'steps'),
 sec('Also on this screen',[
  'Remote access audit: finds remote-control programs. See its guide.',
  'Reinstall assistant: for when repairs do not hold. See its guide.',
  'Mac tools (Mac only): Startup items, Free up space, Fix an app that will not open, and Check another drive. See "Mac tools".'])],
 systems=ALL, time='Varies', level='Takes care', screen='repair', related=['mk-results','remote-audit','mk-reinstall','mac-tools']),

G('mk-tools',GR,'Tools: installing and removing free tools','Installing the trusted free tools MendKit knows about, checking which are installed, and removing them again.',[
 sec('How it works',[
  'Each tool installs from its official source through the system\'s own package manager: winget on Windows, Homebrew on a Mac, and apt, dnf, pacman, zypper or Flatpak on Linux.',
  'Only tools that work on this system are listed. The Licence column shows whether a tool is free for business use or for home use only.']),
 sec('Install tools',[
  S('Tick Technician mode and click Tools.', see='Every tool with its job, licence, Status (Installed or not) and, on Windows, an Offline column.'),
  S('Tick the tools you want, or use Select all, then click Install selected.', tip='Already-installed tools are skipped automatically.'),
  S('On Windows, run MendKit as administrator first so installs do not stop to ask. On a Mac or Linux, type your password when asked.'),
  S('Wait until each Status says Installed.', tip='A Mac needs Homebrew for tool installs. If it is missing, MendKit says so and offers to install it.')],'steps'),
 sec('Use and remove them',[
  S('Click How to use it beside any tool to open its guide.'),
  S('To remove a tool, click Remove on its row, or open the Undo Center, which lists every tool MendKit installed.')],'steps'),
 sec('If an install fails',[
  'Check the internet connection (the No internet badge shows when it is down).',
  'On Windows, if winget itself is missing or broken, run Updates first; winget comes with the App Installer from the Microsoft Store.',
  'Open Reports and View log for the exact error.'])],
 systems=ALL, time='1 to 5 minutes per tool', level='Easy', screen='tools', related=['mk-offline','mk-undo']),

G('mk-offline',GR,'Offline installers','Saving tool installers while online, so they can be installed on a computer with no internet.',[
 sec('Save them while online',[
  S('In Technician mode open Tools. Tick the tools you will want offline.'),
  S('Optional: click Check download sizes to see roughly how much space they need.'),
  S('Click Save selected for offline use.', see='Each tool downloads into the cache. The Offline column then shows its version and size.', tip='Save again later to pick up newer versions. Change folder moves the cache, for example to a USB stick.')],'steps'),
 sec('Install without internet',[
  S('Run MendKit as administrator. Without internet there is nothing to ask permission part-way through.'),
  S('On the Tools screen tick the tools and click Install selected.', see='The button reads Install from cache, and the saved copies are used automatically.')],'steps'),
 sec('Carry them to other computers',[
  S('Build a technician USB stick in the ISO Library and tick Offline installers.', tip='See "ISO Library and technician USB".'),
  'A few tools run without installing; their saved copy opens straight from the cache. Microsoft Store apps cannot be saved.',
  'On Linux (apt, dnf or pacman) each tool is saved with the packages it needs that this computer lacks, so install them on the same Linux version. Not available on a Mac yet.'])],
 systems='Windows, Linux', time='10 to 30 minutes to download', level='Easy', screen='tools', related=['mk-tools','mk-iso']),

G('mk-migrate',GR,'Migrate: moving to a new computer over the network','Copying files, settings and the list of apps from an old computer to a new one on the same network.',[
 sec('What moves and what does not',[
  'Moves: Desktop, Documents, Pictures, Music, Videos, Downloads and other folders you choose, browser bookmarks, Firefox and Thunderbird profiles, LibreOffice and VS Code settings, and a list of installed apps.',
  'Does not move: programs themselves (they are reinstalled from the list), and saved passwords (see "Moving saved passwords").',
  'Works between any two of Windows, macOS and Linux. Folders land in the matching place.',
  'Nothing on the new computer is overwritten. A different file with the same name is kept beside it as "name (migrated)".']),
 sec('On the new computer',[
  S('Install and open MendKit. Click Migrate, then Receive on this computer.', see='A six-digit code in large numbers and "Waiting for the old computer".'),
  S('If Windows asks whether to allow MendKit on networks, tick Private networks and click Allow.', warn='Both computers must be on the same network (the same Wi-Fi or router). Guest Wi-Fi often blocks this.')],'steps'),
 sec('On the old computer',[
  S('Open MendKit, click Migrate, then Send from this computer.', see='1. What to move: each folder with its size. 2. The new computer: a list of computers found on the network.'),
  S('Tick what to move. Leave Downloads unticked if it is mostly old installers.'),
  S('Click the new computer in the list.', tip='If it is not listed after a minute, check both are on the same network and that Receive is open on the new one.'),
  S('Type the six-digit code shown on the new computer and click Start.', see='Progress on both computers. Large photo and video collections can take hours over Wi-Fi; a network cable is much faster.')],'steps'),
 sec('Afterwards, on the new computer',[
  S('Read the results. They list what was copied and any files that could not be read.'),
  S('Click Reinstall apps from the old computer.', see='The apps that could be matched are installed from official sources. Apps with no match are listed so you can install them yourself.'),
  S('Open each browser and check the bookmarks, then move the passwords.', tip='See "Moving saved passwords".'),
  S('Keep the old computer untouched for a week or two, until the person is sure nothing is missing.')],'steps')],
 systems=ALL, time='30 minutes to several hours', level='Easy', screen='migrate', need=['MendKit on both computers','Both computers on the same network','Both plugged into power'], related=['mk-drive-backup','mk-passwords','mk-old-drive']),

G('mk-drive-backup',GR,'Backing up to a drive and restoring','Copying files to an external drive, restoring them on any computer, and keeping a weekly backup.',[
 sec('Back up to a drive',[
  S('Plug in the external drive. Open Migrate and click Back up to a drive.', see='1. What to back up, with sizes. 2. Where to save it.'),
  S('Tick what to back up and click Choose drive or folder to pick the drive.'),
  S('Click Start.', see='A MendKit backup folder on the drive, with the files in plain folders you can also open yourself.')],'steps'),
 sec('Restore on this or another computer',[
  S('Plug in the drive. Open Migrate and click Restore from a drive.'),
  S('Choose the backup folder on the drive, tick what to restore and click Start.', see='Files arrive in the matching folders. Nothing already on the computer is overwritten.'),
  S('Click Reinstall apps from the old computer to install the apps from the saved list.')],'steps'),
 sec('Weekly backup',[
  S('In Migrate, under Keep a regular backup, click Choose the backup drive and pick the external drive.'),
  S('Click Turn on the weekly backup.', see='It runs every Friday at 12:30 and only copies new and changed files.'),
  'It is silent when all is well. If the drive is not plugged in, MendKit shows a notice so it is not forgotten.',
  'The button beside it opens the system\'s own backup (File History on Windows, Time Machine on a Mac) if you want both.'],'steps')],
 systems=ALL, time='15 minutes to several hours', level='Easy', screen='migrate', need=['An external drive with enough free space'], related=['mk-migrate','basics-backup']),

G('mk-old-drive',GR,'Copying files from an old drive','Getting a person\'s files off a computer that will not start, by connecting its drive to a working computer.',[
 sec('Get the drive connected',[
  S('Take the drive out of the old computer.', tip='Laptops: usually a few screws on the bottom. SSDs are small cards (M.2) or 2.5-inch boxes. Mac drives from 2016 on are soldered in and cannot be removed this way.'),
  S('Connect it to the working computer with a USB adapter, enclosure or dock that fits the drive type (SATA or NVMe).'),
  S('On Windows, run MendKit as administrator, or the old user\'s folders cannot be read.')],'steps'),
 sec('Copy the files',[
  S('Open Migrate and click Copy from an old drive, then Choose the old drive.'),
  S('Pick the drive itself, its Users (or home) folder, or one person\'s folder.', see='2. Whose files: the people found on the drive. 3. What to copy: their folders with sizes.'),
  S('Choose the person, tick the folders and click Start copying.', tip='If the drive is failing (clicking noises, very slow, errors), copy the most important folder on its own first, such as Pictures.'),
  S('Read the results. Files that could not be read are listed.')],'steps'),
 sec('If it does not work',[
  '"No files could be read": run MendKit as administrator on Windows, and unlock BitLocker (Windows) or FileVault (Mac) drives first. BitLocker needs the recovery key from the owner\'s Microsoft account.',
  'The drive does not appear at all: try another adapter or port. Check Disk Management (Windows) or Disk Utility (Mac). A drive that is not detected anywhere needs professional data recovery; do not keep trying, as that can make it worse.',
  'Nothing on the old drive is changed, and saved passwords are not copied.'])],
 systems=ALL, time='30 minutes to several hours', level='Takes care', screen='migrate', need=['A USB adapter or enclosure for the drive','A screwdriver for the old computer'], related=['ddrescue','testdisk','mk-drive-backup']),

G('mk-passwords',GR,'Moving saved passwords','The safe way to move saved website passwords between browsers and computers.',[
 sec('Why MendKit does not copy them',[
  'Browsers lock saved passwords with a key tied to the old computer, so copying the files does not work, and moving them as plain text is risky.',
  'The safe way is each browser\'s own sync or export.']),
 sec('The easiest way: sign in to the browser',[
  S('Chrome or Edge: on the old computer sign in to the browser with the person\'s Google or Microsoft account and turn on sync. Sign in with the same account on the new computer.'),
  S('Firefox: sign in to a Firefox account on both. Safari: passwords sync through iCloud Keychain when both Macs or devices use the same Apple Account.'),
  S('Wait a few minutes, then open the password list on the new computer to check.')],'steps'),
 sec('Moving them with a file',[
  S('In MendKit\'s Migrate screen, click Move saved passwords. It opens the right page in each browser found and explains each step.'),
  S('Export the passwords on the old computer, copy the file to the new one, and import it there.', warn='The export file holds every password in plain text. Delete it from both computers and empty the Recycle Bin or Trash straight after importing.')],'steps')],
 systems=ALL, time='10 minutes', level='Takes care', screen='migrate', related=['mk-migrate']),

G('mk-tweaks',GR,'Tweaks: changing settings safely','Turning settings on and off with presets, and putting every change back exactly.',[
 sec('Apply tweaks',[
  S('Tick Technician mode and click Tweaks.', see='Settings in groups (Privacy, Interface, Finder, Dock and others), each with a tick box showing whether it is on now, and presets at the top.'),
  S('Tick the settings you want on, or click a preset such as Standard or Minimal to tick a recommended set.', tip='Read each description. Tweaks marked as needing a sign-out only show after signing out.'),
  S('Click Apply.', see='Results listing each change.')],'steps'),
 sec('Put things back',[
  S('Untick a tweak and click Apply to put that one back.'),
  S('Undo all MendKit tweaks puts back every change MendKit made, using the exact values that were there before.'),
  S('The Undo Center also lists each change with Put back.')],'steps'),
 sec('Share a set',[
  'Export ticked saves the ticked tweaks to a file. Import loads it on another computer. Setup Profiles can include tweaks too.']),
 sec('If a tweak will not change',[
  'On Windows, run MendKit as administrator for tweaks that affect the whole computer. Some are locked by a work or school account.',
  'On Linux, the tweaks shown depend on the desktop: GNOME, Cinnamon (Linux Mint), KDE Plasma or XFCE. Settings that do not exist on this computer are hidden.',
  'On a Mac, a few need MendKit to have Full Disk Access (see "Permissions setup").'])],
 systems=ALL, time='5 minutes', level='Easy', screen='tweaks', related=['mk-undo','mk-setup']),

G('mk-updates',GR,'Updates, drivers and monthly maintenance','Checking for and installing system and app updates, maker driver tools, scheduled maintenance and updating MendKit itself.',[
 sec('Check and install updates',[
  S('Click Updates, then Check.', see='A list of what is available for the system and apps. Nothing changes yet.'),
  S('Click Install updates.', tip='On Windows, system and driver updates go through Windows Update, which MendKit opens for you. Apps update through winget. On a Mac: Apple updates and Homebrew. On Linux: the package manager and Flatpak.'),
  S('Restart if asked, then Check again until nothing is left.')],'steps'),
 sec('Drivers and firmware',[
  'On Windows, the maker\'s own update tool (Dell, Lenovo, Intel) is offered when it fits this computer. See its guide.',
  'Open optional driver updates goes to the Windows Update page listing maker drivers.',
  'Back up drivers saves a copy of every third-party driver first, in case a new one misbehaves.',
  'On Linux, the Firmware section uses fwupd.']),
 sec('Monthly light maintenance',[
  S('Turn on Monthly light maintenance. It runs on the 1st of each month at noon.', tip='On Windows, turn it on while running as administrator so it can clean up and scan.'),
  'It is silent. MendKit only opens and shows a notification when something needs attention.',
  'Tick Also install app updates to include app updates. Run it now does it straight away.'],'steps'),
 sec('Updating MendKit',[
  'A few seconds after starting, MendKit checks for a newer version. "Update available" appears at the bottom left.',
  S('Open Updates. The MendKit itself card shows your version and the new one. Click Download the update, then Restart and install.'),
  'A portable or USB copy opens the download page instead. An update never installs while a job is running.'])],
 systems=ALL, time='10 to 60 minutes', level='Easy', screen='updates', related=['dell-command-update','lenovo-system-update','intel-dsa','fwupd']),

G('mk-hardware',GR,'Hardware tests','Proving each part works: keyboard, screen, speakers, microphone, camera, USB ports and the processor under load.',[
 sec('Before you start',[
  'Open Hardware Tests and pick a test. Starting another test stops the one that was running.',
  'Allow camera and microphone access when asked (see "Permissions setup").']),
 sec('Keyboard',[S('Click Keyboard and press every key once, including the function keys and the arrows.', see='Each key turns green when pressed, and a count shows how many are left.', tip='Keys that do nothing may be broken, or may be special keys the system handles itself (such as volume or Fn).')],'steps'),
 sec('Screen',[S('Click Screen.', see='The screen fills with one colour at a time.'),S('Look closely at each colour for dots that stay black, white or one colour (dead or stuck pixels), lines, or patches of different brightness.'),S('Click to go to the next colour. Press Esc to stop.')],'steps'),
 sec('Speakers',[S('Click Left, then Right.', see='A one-second tone from only that side. Sound from both, or none, points to a speaker or settings problem.', tip='No sound at all: check the volume and output device, then run "No sound" on the Dashboard.')],'steps'),
 sec('Microphone and camera',[S('Microphone: speak or tap near it.', see='The level bar moves.'),S('Camera: the live picture appears.', tip='A black picture with the light on usually means the privacy shutter is closed; a "no camera" message can mean a privacy switch or key is off.')],'steps'),
 sec('USB ports',[S('Plug a USB stick or mouse into one port and click Refresh.', see='The device is marked new, proving that port works.'),S('Unplug it, move to the next port and repeat.')],'steps'),
 sec('Processor stress test',[S('Plug a laptop into power. On Windows, open LibreHardwareMonitor first so temperatures can be read.'),S('Choose a length and click Start.', see='Every processor thread runs flat out. Fans get loud. Temperatures are recorded every five seconds.'),S('A healthy computer finishes without freezing or restarting and stays under about 90 °C.', warn='If it switches off or freezes, stop: it is overheating or has a power or hardware fault. Clean the fans before trying again.'),S('The result is saved in Reports.')],'steps')],
 systems=ALL, time='2 to 30 minutes', level='Easy', screen='hardware', related=['occt','hwinfo','mk-permissions']),

G('mk-crash',GR,'Crash Analyzer','Finding out why a computer crashes, freezes or switches itself off, and what to do about it.',[
 sec('Run it',[
  S('On Windows, run MendKit as administrator so it can read crash dump files.'),
  S('Click Crash Analyzer.', see='MendKit reads the last 30 days of crash records: blue screens, sudden shutdowns, hardware and drive errors, and apps that crashed or froze.')],'steps'),
 sec('Read the result',[
  'The headline names the most likely cause in plain words.',
  'What was found lists each kind of crash, how often it happened and what it means. Blue screen stop codes are explained.',
  'What to do, in order is the repair plan. Each step has a button that opens the right screen or starts the right repair. Work down the list.',
  'Technician mode adds the raw detail (event IDs, stop codes, driver names) to each line of the timeline.']),
 sec('Tips',[
  'Crashes that started after a new driver or update point at that driver: roll it back or update it from the maker.',
  'Sudden shutdowns with no blue screen usually mean power or heat: check the charger, battery and fans.',
  'Random crashes with different codes each time point at memory: test it with Memtest86+ from the ISO Library.'])],
 systems=ALL, time='2 minutes', level='Easy', screen='crash', related=['bluescreenview','mk-hardware','mk-iso']),

G('mk-setup',GR,'Setup Profiles','Setting up a new computer in one run with a saved bundle of apps, tools and tweaks.',[
 sec('Apply a profile',[
  S('Tick Technician mode and click Setup Profiles.', see='The built-in profiles and any you have made, each listing its apps, tools and tweaks.'),
  S('Click Apply to this computer on the profile you want.', see='MendKit installs the apps and tools and applies the tweaks, then shows one results screen.', tip='On Windows, run as administrator first.')],'steps'),
 sec('Make your own',[
  S('Click New profile, give it a name, and tick the apps, tools and tweaks.'),
  S('Tick the apps installed on this computer copies the app list from the machine in front of you.'),
  S('Built-in profiles cannot be changed; Copy and edit makes your own version.')],'steps'),
 sec('Move profiles between computers',['Export saves a profile as a file. Import loads it on another computer.'])],
 systems=ALL, time='10 to 40 minutes', level='Easy', screen='setup', related=['mk-tools','mk-tweaks']),

G('mk-backup-erase',GR,'Backup image and secure erase','Making a full backup image before a risky repair, and erasing files or drives so they cannot be recovered.',[
 sec('Backup image before repair',[
  S('Tick Technician mode and open Backup & Erase.'),
  S('Windows: connect an external drive formatted as NTFS with more free space than the Windows drive uses. Run MendKit as administrator.'),
  S('Choose the drive and click Create the backup image.', see='Windows saves a WindowsImageBackup folder on that drive. Leave it where it is and do not rename it.', tip='On a Mac this starts a Time Machine backup; on Linux it takes a Timeshift snapshot named MendKit before repair.'),
  S('To put it back: start Windows recovery (hold Shift and click Restart), then Troubleshoot, Advanced options, System Image Recovery.', warn='Restoring an image replaces everything on the drive with the copy, including files made since.')],'steps'),
 sec('Erase files and folders',[
  S('Under Secure erase, click to add files or folders to the list.', tip='System folders and whole user folders are refused, to prevent accidents.'),
  S('Read the list twice. Type ERASE in the box and click Erase them.', warn='Erasing cannot be undone. The files are overwritten with random data, then deleted.')],'steps'),
 sec('Erase free space',['Overwrites the empty part of a drive so files deleted earlier cannot be recovered. Files still on the drive are not touched. It can take hours on a large drive.']),
 sec('Erase a whole drive',[
  S('For an external or second drive only: choose it, type ERASE and click Erase the drive. The drive the computer runs from is never offered.'),
  'To wipe the whole computer before selling it: on Windows use Reset this PC, Remove everything, Change settings, Clean data. On a Mac use Erase All Content and Settings. Or boot ShredOS from the ISO Library.',
  'On SSDs and USB sticks, overwriting may not reach every old copy. Erase the whole drive, or use the maker\'s secure erase tool.'],'steps')],
 systems=ALL, time='30 minutes to several hours', level='Needs care', screen='drive', need=['An external drive for the image'], related=['basics-backup','mk-iso']),

G('mk-reinstall',GR,'Reinstall assistant','Reinstalling Windows over itself while keeping files, apps and settings, when repairs do not hold.',[
 sec('Before you start',[
  S('Back up the files anyway (see "Back up before you fix anything").'),
  S('Open Repair (Technician mode) and click Reinstall assistant.', see='Before you start: checks for administrator rights, free space (at least 25 GB), power and BitLocker. Fix anything marked as a problem.')],'steps'),
 sec('Windows 11: Option 1',[
  S('Click the Option 1 button.', see='Settings, System, Recovery opens.'),
  S('Click Reinstall now next to "Fix problems using Windows Update", and confirm.', see='Windows downloads a fresh copy and reinstalls itself. Files, apps and settings stay. It takes an hour or more and restarts several times.')],'steps'),
 sec('Windows 10, or when Option 1 fails: Option 2',[
  S('Click Get a Windows ISO and download the ISO that matches the installed edition and language.'),
  S('Under Option 2, click Choose the Windows ISO, pick the file, and click Start the repair install.', see='Windows Setup opens.'),
  S('In Setup, choose "Keep personal files and apps" and follow the screens.', warn='If "Keep personal files and apps" is greyed out, the ISO does not match the installed Windows. Stop and get the right edition and language, or files and apps will be removed.')],'steps'),
 sec('Mac and Linux',['MendKit shows the steps for macOS Recovery (Reinstall macOS keeps files) and for Linux. See "macOS Recovery and First Aid".'])],
 systems='Windows (steps for macOS and Linux)', time='1 to 2 hours', level='Needs care', screen='repair', related=['basics-windows-recovery','mac-recovery']),

G('mk-iso',GR,'ISO Library and technician USB','Downloading rescue and installer images, and building a USB stick with portable MendKit, the images and offline installers.',[
 sec('Download images',[
  S('Click ISO Library.', see='Installer and rescue images (Windows installers, Linux live systems, Memtest86+, Hiren\'s BootCD PE, Rescuezilla, GParted, ShredOS and others) with what each is for.'),
  S('Tick the ones you want and click the button to open each official download page. Download from there.')],'steps'),
 sec('Build a technician USB',[
  S('In Technician mode, the Build a technician USB card is at the top of the ISO Library. Plug in a USB stick.', tip='To start computers from the ISO files, install Ventoy on the stick first (see "Ventoy"). Ventoy erases the stick, so do that before copying.'),
  S('Click Choose the USB stick and pick it. Nothing already on it is removed.'),
  S('Tick Portable MendKit, Offline installers (Windows) and the ISO files to copy. ISO files in Downloads are listed; Add ISO files adds others.'),
  S('Click Copy to the stick.', see='Progress in the bottom panel. Copying again later only copies what changed.')],'steps'),
 sec('Use it on another computer',[
  S('Open the MendKit folder on the stick and start "Start MendKit". Nothing is installed; settings, logs and undo records stay on the stick.', tip='A portable copy runs on the same kind of system that made it: build it on Windows for Windows computers.'),
  S('To start a computer from one of the images, see "Starting a computer from a USB stick".')],'steps'),
 sec('Which image for which job',[
  'Windows will not start and you need files off it: Hiren\'s BootCD PE or a Linux live system.',
  'Random crashes: Memtest86+, at least two full passes.',
  'Clone a drive to a new SSD: Rescuezilla or Clonezilla.',
  'Resize or repair partitions: GParted Live.',
  'Malware that blocks scanners inside Windows: ESET SysRescue Live.',
  'Wipe drives before selling: ShredOS.',
  'Reinstall or repair-install Windows: the Windows 11 or 10 installer.'])],
 systems=ALL, time='30 minutes plus downloads', level='Takes care', screen='isos', need=['A USB stick of 32 GB or more'], related=['ventoy','rufus','basics-boot','mk-offline']),

G('mk-undo',GR,'Undo Center','Putting back settings MendKit changed, removing tools it installed, and restoring quarantined files.',[
 sec('What is listed',[
  'Settings MendKit changed: every tweak, with when it was changed and Put back.',
  'Tools MendKit installed: each with Remove.',
  'Files set aside by MendKit (remote access audit, Browser cleanup, and startup items removed on a Mac): each with Put back.']),
 sec('Put something back',[S('Click Undo Center and click Put back (or Remove) beside the item.', see='A results screen confirming it.')],'steps'),
 sec('Undoing a repair',[
  'Repairs such as system file fixes cannot be reversed one by one.',
  S('On Windows, click Open System Restore and choose the restore point named "MendKit before repair". Files are not touched; programs and settings go back to that moment.')])],
 systems=ALL, time='2 minutes', level='Easy', screen='undo', related=['mk-tweaks','remote-audit']),

G('mk-reports',GR,'Reports and job history','Finding past results, logs, the computer\'s serial number and a job history for your records.',[
 sec('Use it',[
  S('Click Reports.', see='The computer\'s model and serial number at the top, then every job with when it ran and its result.'),
  S('Click View results to see a job\'s plain-language summary again, and save the customer PDF from there.'),
  S('In Technician mode, View log shows the complete output, and Open logs folder opens the folder to copy logs from.'),
  S('Export job history (CSV) saves the list of jobs, which opens in Excel or any spreadsheet.')],'steps')],
 systems=ALL, time='2 minutes', level='Easy', screen='reports', related=['mk-results']),

G('remote-audit',GR,'Remote access audit','Finding remote-control programs a scammer may have installed, and removing the ones nobody wants.',[
 sec('What it is for',[
  'Scammers talk people into installing a remote-control program, then watch the screen or move money. The program often stays installed afterwards.',
  'The same programs are used honestly by technicians, employers and family. Finding one does not prove a scam.']),
 sec('How to run it',[
  S('On Windows, restart MendKit as administrator first, so it can check every user\'s folders and remove what you choose.'),
  S('Click Check for remote access on the Dashboard (or Remote access audit on the Repair screen).'),
  S('Click Scan this computer.', see='After a few minutes, each remote-control program found, with where it was found and tags for "running now" and "starts with the computer".'),
  S('Ask the person about each one. Tick the ones nobody recognises or wants.', tip='Keep anything their own technician, employer or family set up.'),
  S('Click Remove selected, read the confirmation and click Yes, remove them.', see='Each program is closed, its service stopped and disabled, its uninstaller run, and loose copies moved to quarantine. An uninstaller window may ask you to confirm.'),
  S('Restart the computer and scan again to confirm they are gone.')],'steps'),
 sec('Reading the results',[
  '"Running now": active at this moment. "Starts with the computer": it comes back after every restart.',
  '"Program file" lines are loose copies, usually in Downloads or on the Desktop, run without installing.',
  'Quick Assist is part of Windows and listed for information only. It only connects when someone opens it and types a code.',
  'The audit knows a fixed list of well-known products, so a clean result is not a guarantee.',
  'Removal works on Windows and Linux. On a Mac it reports what it finds; remove those with Startup items and the app\'s own uninstaller.']),
 sec('After a scam',['See "Staying safe: scams and fake support" for what to do next: passwords from another device, calling the bank, and a malware scan.'])],
 systems=ALL, time='5 to 10 minutes', level='Easy', screen='dashboard', related=['basics-safety','mk-undo','mac-tools']),
G('mk-browsers',GR,'Browser cleanup','Removing unwanted extensions, notification pop-ups and settings forced into Chrome, Edge, Brave, Vivaldi or Firefox.',[
 sec('When to use it',[
  'Pop-ups in the corner of the screen saying the computer is infected, even with the browser closed or on a different website. These are almost always a website that was allowed to show notifications.',
  'The home page or search engine changed and keeps changing back.',
  'A toolbar, coupon helper or "search assistant" nobody remembers installing.',
  'The browser says "Managed by your organization" on a home computer.']),
 sec('Scan',[
  S('Close every browser window first.',tip='Changes are only made while a browser is closed. Check the taskbar or Dock: the browser icon should not show a dot or line under it.'),
  S('Tick Technician mode at the bottom left, open Repair, and click Open beside Browser cleanup under Cleanup and recovery.'),
  S('Click Scan.',see='A section for each browser profile on this account, with its extensions, the sites allowed to show notifications, and its home page, start-up pages and search engine if they were changed. If anything forces settings in from outside the browser, it is listed first under "Set from outside the browser".')],'steps'),
 sec('Choose what to remove',[
  S('Extensions marked "not from the store" are ticked for you.',tip='They were put there by another program rather than added from the Chrome Web Store, Edge Add-ons or Firefox Add-ons. That is how adware arrives.'),
  S('Read the rest. Untick anything the person uses, such as a password manager or an ad blocker they chose.',tip='Not sure what one is? Search its name. A name you cannot find anything about is a good reason to remove it.'),
  S('Leave "Stop sites showing notifications" ticked.',see='The list under it shows each site. Removing them all is safe: sites the person wants, such as email or chat, can ask again.'),
  S('Under "Set from outside the browser", tick the policies marked with things like "Sets the search engine" or "Forces extensions in".',warn='On a computer from a workplace or school, these are put there on purpose. Leave them alone and ask their IT department.'),
  S('Click Clean selected.',see='A result for each browser profile and each outside setting. Settings for every user need MendKit running as administrator (Windows) or your password (Mac and Linux).')],'steps'),
 sec('If the home page or search engine is still wrong',[
  S('Beside the changed settings, click Open the reset page.',see='The browser opens on its own reset page. If it opens on a normal page instead, type the address MendKit shows at the bottom of its window into the address bar.'),
  S('Click Reset settings (Firefox: Refresh Firefox).',see='The home page, start-up pages and search engine go back to normal and extensions are turned off. Bookmarks, passwords and history stay.')],'steps'),
 sec('If something comes back',[
  'The browser is signed in with sync turned on and another computer still has the extension. Remove it on that computer too, or from the extensions page while signed in.',
  'A program on the computer puts it back. Run Startup items and look for unfamiliar entries, and run the malware scan in Pop-ups or strange behaviour.',
  'Scan again: a policy may have been added after the first scan.']),
 sec('Putting something back',['The old browser settings files and removed extension files are kept. Open Undo Center and click Put back beside the item, with the browser closed. On Windows, a removed policy is saved as a .reg file in the same folder; double-click it to put it back.'])],
 systems=ALL, time='10 minutes', level='Easy', screen='repair', related=['mk-undo','basics-safety','remote-audit']),
]
