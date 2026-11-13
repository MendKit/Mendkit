@echo off
rem Builds the MendKit Windows installer and the single-file portable build into the "release" folder.
rem Right-click this file and choose "Run as administrator": the packaging tools need that the first time.
cd /d "%~dp0"
call npm.cmd install || goto :fail
call npm.cmd run dist:win || goto :fail
echo.
echo Done. The installer and the portable build are in the "release" folder.
echo.
echo To publish this version as an update, upload these three files from "release" to the Cloudflare bucket:
echo   latest.yml
echo   MendKit-Setup-[version].exe
echo   MendKit-Setup-[version].exe.blockmap
echo Installed copies of MendKit will then offer the update by themselves.
start "" "%~dp0release"
pause
exit /b 0
:fail
echo.
echo The build did not finish. Scroll up to see the first error.
pause
exit /b 1
