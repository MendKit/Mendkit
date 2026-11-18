# Hands-on test checklist

Automated tests cover the logic and run real commands on Windows, Mac and seven Linux distributions, but some
things need a real computer and a person. Tick these on a bench machine before each release.

## Every system
- [ ] Install from the website's download, open it, and check the version in the bottom-left corner.
- [ ] Dashboard: cards fill in, drive health appears, "Health over time" shows after the first day.
- [ ] Fix my computer: runs to the end; results screen reads sensibly; report saved under Reports.
- [ ] Check-in: fill the form, Check in and measure speed, Measure after, Print (sheet has both scores, no branding).
- [ ] Browser cleanup: with Chrome or Edge closed, remove a test extension and a notification site; open the
      browser and confirm both are gone; Undo Center puts the settings back.
- [ ] Recover deleted files: on a USB stick, delete a photo, search the stick saving to another drive, and open
      the recovered photo.
- [ ] Phone photos: plug in an iPhone and an Android phone (unlocked, trusted / File transfer), copy, run again
      and confirm nothing is copied twice.
- [ ] Migrate, old drive: plug in a drive from another computer, choose its Users folder, and confirm closed
      folders are opened automatically (Windows: restart as administrator when asked; Mac: password prompt).
- [ ] Migrate, network: pair two computers with the code and send a folder both ways.
- [ ] Self-update: install the previous version, open it, and confirm it offers and installs the new one.

## Windows
- [ ] Installer on Windows 11 x64 and on a Windows on ARM laptop (Surface or Snapdragon) if one is available.
- [ ] Windows 11 upgrade on a Windows 10 computer: readiness lines are right; on an unsupported one the choices
      appear; "Ask Windows to check" finishes.
- [ ] Startup items: turn one off and on again; Free up space: clean the safe categories.
- [ ] Security checkup and "Secure this computer".

## Mac
- [ ] Both disk images: Apple silicon and Intel. Each opens without "damaged" (ad-hoc signed) and, once signing
      is set up, without any Gatekeeper warning.
- [ ] Permissions screen after install: Full Disk Access and the others turn green after granting.
- [ ] Phone photos: Open Image Capture works; iPhone backups list after Full Disk Access.

## Linux (Ubuntu or Mint at least)
- [ ] .deb installs and updates; AppImage runs.
- [ ] Linux tools: driver check, startup items, Timeshift count.
- [ ] Recover deleted files asks for the password and hands the results back to the user's account.
