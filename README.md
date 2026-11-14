<p align="center"><img src="build/icon.png" width="120" alt="MendKit logo"></p>

# MendKit

MendKit is an all-in-one repair, tune-up and migration toolkit for Windows, macOS and Linux. It puts the jobs a repair technician does by hand into one desktop app: guided repairs, installing trusted free tools, system tweaks that can be undone, moving a person's files and apps to a new computer, hardware tests, crash analysis, backups and secure erase.

It has two modes. **Simple mode** asks "What is the problem?" and reports results in plain language, so a customer can use it. **Technician mode** adds the full command catalog, raw output, tweaks, setup profiles, imaging and erase tools.

**Status:** version 0.17.1. Every feature on the original design list is built. Windows is the main target and the only system it has been run on by hand; the macOS and Linux command packs pass the automated checks but have had little real-world use. Builds are unsigned.

## Download

Website: **https://mendkit.github.io** (source in `website/`, published from the `MendKit/mendkit.github.io` repository).

Version 0.17.1, free for everyone:

| System | Download | Notes |
| --- | --- | --- |
| Windows 10 and 11 | [MendKit-Setup-0.17.1.exe](https://pub-a4ba3af629e94c87a8e9aec1b8e48df7.r2.dev/MendKit-Setup-0.17.1.exe) (122 MB) | Installer. SmartScreen may warn: More info, then Run anyway. |
| macOS (Apple silicon) | [MendKit-0.17.1-arm64.dmg](https://pub-a4ba3af629e94c87a8e9aec1b8e48df7.r2.dev/MendKit-0.17.1-arm64.dmg) (122 MB) | Not yet registered with Apple: open it once, then System Settings, Privacy & Security, Open Anyway. |
| Linux, AppImage | [MendKit-0.17.1-x86_64.AppImage](https://pub-a4ba3af629e94c87a8e9aec1b8e48df7.r2.dev/MendKit-0.17.1-x86_64.AppImage) (126 MB) | `chmod +x`, then run. |
| Linux, archive | [MendKit-0.17.1-x64.tar.gz](https://pub-a4ba3af629e94c87a8e9aec1b8e48df7.r2.dev/MendKit-0.17.1-x64.tar.gz) (121 MB) | Unpack and run `mendkit`. |

The files are served from the project's release bucket, the same place installed copies check for updates.

## What it does

### Repair
- **Symptom picker:** slow, no internet, Wi-Fi dropping, pop-ups, updates failing, crashing, printer, sound, Bluetooth or camera. Each runs a matching recipe.
- **Fix my computer:** restore point, drive health, DISM, SFC, cleanup, malware scan and updates, in order, with a preview before anything runs.
- **Network check:** works out whether the computer is on cable or Wi-Fi and tests that connection, the router, the internet, name lookup and download speed.
- **Mac pack:** a security checkup (FileVault, firewall, Gatekeeper, System Integrity Protection, XProtect, automatic security updates), configuration profiles and third-party drivers (adware cleanup), Rosetta install, "Open With" rebuild, camera, microphone and screen-recording permission resets, deep network reset, address renewal, clock sync, home-folder permission repair, font cache, iCloud Drive and clipboard restarts, memory pressure, heat throttling, last shutdown cause, battery wear, the full macOS installer, and power settings (Power Nap, start on lid open, sleep timers). Recipes: Mac security checkup, An app will not open, Runs hot or shuts down, Low on space, plus Mac steps for camera and crash fixes. Repair has four Mac tools: Startup items (who signed each launch agent and daemon, tick to remove, user items restorable from the Undo Center), Free up space (caches, logs, device update files, each iPhone and iPad backup, Trash, large files), Fix an app that will not open (clears the quarantine flag, optional ad-hoc re-sign) and Check another drive. Guides cover Safe Mode, Recovery and First Aid, NVRAM and SMC resets, a bootable USB installer and battery checks. None of it has been run on a real Mac yet.
- **Permissions setup:** opens on the first start after install, and any time from Permissions in the menu. It checks each permission live and refreshes by itself while you switch things on. On macOS: Full Disk Access (tested by reading a file only it unlocks; opens the right System Settings page and shows MendKit in the Finder to drag in), administrator account, camera and microphone (Allow shows Apple's own prompt), control of System Events for login items, and a test notification. On Windows: running as administrator (restarts elevated), camera and microphone privacy switches including the desktop-apps switch, and notifications. On Linux: pkexec or sudo, and camera device access. The Mac build declares camera, microphone and Apple Events entitlements and the usage text macOS shows in its prompts.
- **Crash Analyzer:** reads 30 days of blue screens, sudden shutdowns, hardware and drive errors and app crashes, names the likely cause and gives an ordered repair plan.
- **Remote access audit:** finds 39 remote-control products commonly left behind by scammers and removes the ones you tick (quarantined, not deleted).
- **Reinstall assistant:** readiness checks, then a keep-everything Windows reinstall through Recovery settings or from an ISO.
- **Upgrade advisor:** a keep, upgrade or replace verdict from memory, drive, age, battery wear and Windows 11 readiness.

### Tools, tweaks and updates
- **Tool catalog:** 61 free tools installed through winget, Homebrew, apt, dnf, pacman, zypper or Flatpak, with multi-select install and a how-to guide for each.
- **Tweaks:** 20 Windows registry tweaks (plus macOS and Linux sets) with presets, import and export. Every change records the previous value, so undo puts back exactly what was there.
- **Updates:** system and app updates, maker driver tools (Dell, Lenovo, Intel), firmware through fwupd on Linux, and driver backup.
- **Setup profiles:** saved bundles of apps, tools and tweaks that set up a new computer in one run.
- **ISO Library:** 31 installer, rescue, imaging and hardware-test images, linked to their official download pages.

### Moving and protecting data
- **Migrate over the network:** one computer shows a six-digit code, the other sends. Encrypted, verified file by file, and nothing is overwritten.
- **Back up to and restore from a drive**, including between Windows, macOS and Linux.
- **Copy from an old drive:** for a computer that will not start. Finds the user profiles on a pulled drive and copies their files and settings.
- **App reinstall:** matches the old computer's apps to the new system's package manager.
- **Weekly backup** and **monthly light maintenance** on the system's own scheduler, silent unless something needs attention.
- **Backup image before repair**, and **secure erase** of files, free space or a whole external drive.
- Saved passwords and cookies are never read or transferred.

### Hardware and bench work
- **Hardware tests:** keyboard, screen colours, speakers, microphone, camera, USB ports and a processor stress test with temperatures.
- **Specs and temperatures** on the Dashboard.
- **Technician USB:** a portable MendKit plus chosen ISO files on a stick. The portable copy needs nothing installed and keeps its logs on the stick.
- **Job history and customer report:** every run is logged with the computer's model and serial number; any result can be saved as a one-page PDF with a health score.
- **Undo Center:** put back changed settings, remove installed tools, or open System Restore.

## How it is built

- **Electron and TypeScript**, with a plain HTML, CSS and JavaScript interface behind a locked-down preload bridge.
- **Data-driven:** commands, recipes, tools, tweaks, guides and the rest are JSON files in `definitions/`. The engine only runs what those files define, so most changes need no code.
- **Plain-language results:** each command carries the wording for its good, attention and problem outcomes.
- **Careful by default:** every recipe previews its steps; destructive actions need ERASE typed in; the system drive is never offered for erasing; existing files are never overwritten during a migration.
- **Self-updating:** installed copies check a release bucket and update themselves.
- **Tested:** `npm test` checks every definition file for all three systems and exercises the engine, tweaks, migration, backup, crash analysis, erase and update logic.

## Run it

You need [Node.js](https://nodejs.org) 20 or newer.

```
npm install
npm start
```

`npm test` checks the definition files for all three systems and runs the read-only Health report.

## Installers

`npm run dist:win`, `dist:mac` or `dist:linux` builds into `release/` with electron-builder (config is the `build` block in `package.json`; the icon is `build/icon.png`, drawn from `build/icon.svg`).

- **Windows:** double-click `Build-Installer.cmd` as administrator. It makes `MendKit-Setup-<version>.exe` (installer with Start menu and Desktop shortcuts) and `MendKit-Portable-<version>.exe` (single file, keeps its data in a `MendKitData` folder beside it).
- **macOS:** a `.dmg`. It has to be built on a Mac.
- **Linux:** an AppImage and a `.tar.gz`.
- **All three at once, and published:** the **Build and publish** workflow (see Updates below).

The builds are unsigned, so Windows SmartScreen and macOS Gatekeeper warn on first run. Signing needs a purchased certificate (Windows) and an Apple Developer account (macOS); the workflow already reads `CSC_LINK` and `CSC_KEY_PASSWORD` for when those exist. Auto-update is described under Updates below.

### Updates

MendKit checks the release bucket named in `definitions/update.json` (the Cloudflare R2 bucket; `build.publish` in `package.json` must name the same address) a few seconds after it starts and from the Updates screen. The logic is in `src/main/updater.ts` and `src/engine/update.ts`.

To publish a new version, open **Actions > Build and publish > Run workflow**, type the new version number (for example `0.18.0`) and click **Run workflow**. In about ten minutes it:

1. builds Windows, macOS and Linux,
2. uploads the installers to the bucket under their versioned names and under fixed `-latest` names (the website links to those),
3. uploads `latest*.yml` and `version.json` last, so installed copies only see the new version once its files are there,
4. sets the new version in `package.json` on `main` and tags the commit `v<version>`.

It refuses to replace a version that is already published unless **overwrite** is ticked. Untick **publish** to only build. The bucket keys are the repository secrets `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ACCOUNT_ID` and `R2_BUCKET`; **Check release bucket** tests them. The upload logic is `.github/scripts/publish-r2.sh`.

The website (`website/`, published from `MendKit/mendkit.github.io`) reads `version.json` from the bucket, so it needs no change for a new version.

What each kind of copy does when a newer version is in the bucket:

- **Installed on Windows (from the Setup exe), or the folder build:** downloads the new installer inside MendKit and installs it on "Restart and install" or the next time MendKit closes.
- **Linux AppImage:** replaces itself the same way.
- **Single-file portable exe, technician USB copy, tar.gz, macOS, or run from source:** shows that a new version exists and opens the download in the browser. macOS can only self-update once the app is signed.

A scheduled background run never checks for updates. Nothing is installed while a job is running.

An installed build behaves like the source copy. A file named `portable` beside the program makes any build keep its settings and logs in `MendKitData` next to the program folder.

## Feature details

- **Dashboard:** computer summary, drive health, and a "Fix my computer" button that runs Standard service.
- **Specs and temperatures:** "View all specs and temperatures" on the Dashboard lists the full hardware details and live temperatures (refreshed every 10 seconds). On Windows, processor and motherboard temperatures need LibreHardwareMonitor running; drive temperatures need administrator rights.
- **Simple and Technician modes:** Simple mode (the default) shows the Dashboard and Reports. The Technician mode switch adds the Repair screen with every recipe and single command.
- **Recipes:** Standard service, Network fix, Health report.
- **Windows commands:** restore point, drive health, DISM (CheckHealth, ScanHealth, RestoreHealth, cleanup), SFC, CHKDSK scan, Defender update and quick scan, temp cleanup, DNS flush, Winsock and TCP/IP reset, winget update list and install, stopped services, battery report.
- **Safety gates:** Standard service stops if a restore point cannot be created or a drive reports a health problem.
- **Results screen:** in Simple mode every run ends on a plain-language results screen. Technician mode adds exit codes and the full log.
- **Tools (Windows, Technician mode):** 18 catalog tools installed or removed through winget, with installed status. Tools come from `definitions/tools.json`.
- **Updates screen:** one place to check and install updates for the operating system and apps. On Windows it opens Windows Update for system and driver updates and uses winget for apps; on macOS it covers Apple updates and Homebrew; on Linux it uses the distro's package manager and Flatpak. Check lists what is available without changing anything.
- **Remote access audit:** scans installed programs, running programs, services and the usual program and user folders for 39 well-known remote-control products (the list is `definitions/remote-tools.json`). It reports first; removal happens only for the products the user ticks and confirms. Removal closes the program, stops and disables its service, runs the product's own uninstaller, and moves loose program files to `ProgramData\MendKit\Quarantine`, from where the Undo Center can put them back. Removal is Windows only; macOS and Linux report running programs and installed apps.
- **Search:** the ISO Library, Repair and Tools screens each have a search box; "Select all" only ticks what the search is showing.
- **ISO Library:** a pick list of 31 installer, rescue, imaging, hardware-test and Linux images, plus the tools for writing them to a stick. MendKit opens each official download page; it does not download or host the images. The list is `definitions/isos.json`.
- **Preview:** every recipe opens a preview of its steps first; nothing runs until Start.
- **Undo Center:** settings MendKit changed (put back one by one), tools MendKit installed (remove), and System Restore for repairs.
- **Job history:** each run is logged with the computer's model and serial number and free space before and after; exportable as CSV from Reports. The Dashboard shows when the computer was last serviced.
- **Customer report:** a one-page PDF from any results screen with a 0 to 100 health score, findings in plain words, free space before and after, and the upgrade advisor's verdict.
- **Get help:** drafts an email with the report in the user's own mail program, and opens (or installs) RustDesk for remote support. A technician contact can be saved in Technician mode.
- **Symptom picker:** the Dashboard asks "What is the problem?" and runs the matching recipe: slow, no internet, Wi-Fi dropping, pop-ups, updates failing, crashing, printer, sound, Bluetooth or camera. Symptoms are in `definitions/symptoms.json`.
- **Everyday-problem recipes:** printer, sound, Bluetooth, camera and Wi-Fi fixes on Windows, with printer, sound, Bluetooth and Wi-Fi on macOS and Linux.
- **Network check:** adapter, Wi-Fi signal, router, internet, name lookup and a 25 MB download speed test.
- **Backup checkup:** looks for File History and OneDrive folder backup on Windows, Time Machine on macOS, and Timeshift or Deja Dup on Linux. It reports; it does not set a backup up.
- **Upgrade advisor:** "Is this computer worth fixing?" gives a keep, upgrade or replace verdict from memory, drive type and health, free space, age, battery wear and Windows 11 readiness (security chip, Secure Boot, memory, storage; the processor model list is not checked).
- **How-To Guides:** a searchable section with a full walk-through of MendKit and one guide per tool (what it is for, how to run it, how to read the results, what to be careful of). Guides live in `definitions/guides.json`.
- **Tools multi-install:** tick several tools, or use "Select all not installed", then "Install selected".
- **Progress bar:** the bottom panel shows overall progress for every run, using the percentages DISM, SFC and CHKDSK print, and bytes copied during a migration.
- **Tweaks (Windows, Technician mode):** Applying, undoing or using a preset ends on the results screen, showing which tweaks turned on, which were skipped because they need administrator rights, and which failed.
- **Tweaks detail:** 20 registry tweaks in four groups, with Standard and Minimal presets, import and export, and undo. MendKit records each value before changing it, so undo puts back exactly what was there.
- **Migrate:** one computer chooses Receive and shows a six-digit code; the other chooses Send, picks it from the list (or types its address) and enters the code. Moves the user folders, Firefox, Thunderbird, LibreOffice and VS Code settings, Chrome and Edge bookmarks, and a winget app list the new computer can reinstall. The link is encrypted with keys derived from the code, every file is checked with SHA-256, existing files are never overwritten, and running it again picks up where it stopped.
- **Back up and restore with a drive:** Migrate can also copy the same items to a folder on an external drive and restore from it later, on this or another computer. The backup is a plain, unencrypted folder with an index of SHA-256 hashes; restore checks every file against it. Re-running a backup only copies new and changed files.
- **macOS and Linux:** full command packs (35 Linux commands covering apt, dnf, pacman, zypper and Flatpak; 62 macOS commands including Homebrew). Commands for package managers that are not installed are left out automatically. Tools install through Homebrew or the distro's package manager. Tweaks use `defaults` on macOS (35 tweaks, including per-Mac `-currentHost` settings) and `gsettings` on GNOME.
- **Between different systems:** a Windows, macOS or Linux computer can send to, or restore a backup on, any of the three. User folders map to the matching folders. Firefox, Thunderbird, LibreOffice and VS Code settings and Chrome and Edge bookmarks move between systems. Apps are matched through `definitions/apps.json` (31 common apps) and installed from winget, Homebrew, the distro's package manager or Flatpak; apps with no match are listed in the results. If Firefox or Thunderbird already has a profile on the new computer, the migrated one is added to its profile list. If Chrome or Edge already has bookmarks, the migrated ones are saved to the Desktop as an HTML file to import.
- **Passwords helper:** Migrate has a "Move saved passwords" guide. MendKit never reads or transfers saved passwords (browsers lock them to each computer); it detects the installed browsers and opens each one's password page so the user can turn on sync or use the browser's own export and import.
- **Setup Profiles (Technician mode):** saved bundles of apps, tools and tweaks, applied in one run to set up a new computer. Two built in (`definitions/profiles.json`); make, edit, import and export your own, or tick the apps found on the current computer.
- **Monthly light maintenance:** the Updates screen can schedule a silent monthly run (Task Scheduler on Windows, a LaunchAgent on macOS, a systemd user timer on Linux). It starts MendKit with `--run=light-maintenance --unattended`, which quits when everything is fine and opens the results with a notification when something needs attention.
- **Leaving it to run:** on Windows the preview screen can restart or shut down when a job finishes (one-minute delay, with cancel). A desktop notification shows when a job ends and the window is not in front.
- **Hardware Tests:** keyboard, screen colours, left and right speakers, microphone level, camera preview, USB port check and a processor stress test that records peak temperatures and saves to Reports.
- **Drivers and firmware:** the Updates screen offers the maker's update tool (Dell Command Update, Lenovo System Update, Intel Driver & Support Assistant), opens Windows optional driver updates, backs up installed drivers, and on Linux checks and installs firmware through fwupd.
- **Crash Analyzer:** reads 30 days of crash records (Windows event log and minidump headers, macOS DiagnosticReports, the Linux kernel journal and coredumpctl), explains each stop code in plain language, names the most likely cause and gives an ordered repair plan with buttons. Logic in `src/engine/crash.ts`.
- **Copy from an old drive (Migrate):** for a computer that will not start. Point MendKit at the pulled drive (or its Users/home folder); it finds the user profiles, copies the same items a live migration moves, and guesses the app list from the old program folders. The old drive is only read.
- **Backup image before repair (Technician mode):** a Windows system image (`wbadmin`) to an NTFS drive, a Time Machine backup on macOS, or a Timeshift snapshot on Linux.
- **Secure erase (Technician mode):** overwrite-and-delete for chosen files and folders, free-space overwrite (`cipher /w` on Windows), and a full zero-fill of an external or second drive (`diskpart clean all`, `diskutil secureErase`, `shred`). Each destructive action needs ERASE typed in; the system drive, system folders and whole user folders are refused; the drive list is re-read at the moment of erasing.
- **Technician USB and portable mode (Technician mode, ISO Library):** copies a portable MendKit (the app plus its Electron runtime and a start script) and chosen ISO files to a USB stick. A portable copy has a `portable` marker file and keeps settings, logs and undo records in `MendKitData` beside the app. It runs on the same system family that made it.
- **Offline awareness:** the connection is checked every minute; a "No internet" badge shows and install, update and download screens carry a notice.
- **Reinstall assistant (Technician mode, Repair):** readiness checks (administrator, free space, power, BitLocker), then Windows 11 "Reinstall now" through Recovery settings, or a repair install that mounts a chosen Windows ISO and starts Setup. macOS and Linux get the steps to follow.
- **Weekly backup (Migrate):** schedules the drive backup every Friday at 12:30 through the system scheduler (`--backup --unattended`), silent unless the drive is missing or files failed; also opens File History or Time Machine.
- **Offline installers (Windows, Technician mode, Tools):** saves chosen tools' installers with `winget download` (installer, manifest and checksum) into a cache folder, by default inside MendKit's data folder, so on a technician USB it travels on the stick. With no internet, installs run the saved installer silently using the manifest's switches (or winget's defaults per installer type), after re-checking the file's SHA-256. Tools that run without installing are opened from the folder. Logic in `src/engine/offline.ts` and `src/main/offline.ts`.
- **Reports:** every run saves a full log and a summary.

## Administrator rights

On macOS and Linux, MendKit asks for your password once per run (through polkit on Linux and a system dialog on macOS) and runs that run's admin steps in a single root shell. Only command lines from the definition files are sent to it.

Most repair steps need administrator rights. On Windows, use "Restart as administrator" on the Dashboard; without it those steps are skipped and marked. The design's separate privileged helper is not built yet: for now the whole app runs elevated. The engine still only runs commands by id from the definition files.

## Layout

- `definitions/` - commands per system, recipes and tools, as JSON. Each command's `friendly` block holds its plain-language result text. Add a command or recipe here; no code change needed.
- `src/engine/` - loads definitions, runs steps in order, writes logs. No Electron code, so it can be tested alone.
- `src/engine/tweaks.ts`, `src/engine/migrate.ts` - the tweak manager and the migration protocol.
- `src/main/` - Electron main process: window, system info, IPC.
- `src/preload/` - the small API the interface is allowed to call.
- `renderer/` - the interface (plain HTML, CSS and JavaScript).

## Not built yet

A self-booting MendKit environment (the technician USB relies on Ventoy and existing rescue ISOs), verified direct downloads for tools that are not in winget, an offline cache of tool installers, migration of Wi-Fi networks and printers, signed definition files and code signing. The separate privileged helper is also not built: on Windows the whole app runs elevated.
