@echo off
rem LazyKick - installs the panel for After Effects and Premiere Pro.
rem The .zxp next to this file is signed, so nothing else has to be installed
rem first: no extension manager, no debug switch.

setlocal EnableExtensions
title Install LazyKick
cd /d "%~dp0"

set "EXT_ROOT=%APPDATA%\Adobe\CEP\extensions"
set "DEST=%EXT_ROOT%\com.sohan.LazyKick"
set "LEGACY=%EXT_ROOT%\LazyKick"

echo ============================================================
echo   LazyKick - install
echo   After Effects  .  Premiere Pro
echo ============================================================
echo.
echo Close After Effects and Premiere Pro before going on -
echo a running app holds on to the old panel's files.
echo.
pause
echo.

set "ZXP="
for %%f in ("*.zxp") do set "ZXP=%%~ff"
if not defined ZXP (
  echo [!] There is no LazyKick .zxp file next to this one.
  echo     Unzip the whole download first, then run this from inside that folder.
  goto :fail
)

echo Installing %ZXP%
echo         to %DEST%
echo.

if not exist "%EXT_ROOT%" mkdir "%EXT_ROOT%"
call :remove_panel
if exist "%DEST%" (
  echo [!] The old LazyKick panel could not be removed.
  echo     Close After Effects and Premiere Pro and run this again.
  goto :fail
)
call :move_legacy_copy

powershell -NoProfile -ExecutionPolicy Bypass -Command "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('%ZXP%', '%DEST%')"
if not exist "%DEST%\CSXS\manifest.xml" (
  echo [!] The panel did not unpack. Please send the messages above to
  echo     lettertosohan@gmail.com
  goto :fail
)

rem Not inside ( ) - the ")" in "Program Files (x86)" would end the block early.
set "ALL_USERS_COPY=%ProgramFiles(x86)%\Common Files\Adobe\CEP\extensions\LazyKick"
if not exist "%ALL_USERS_COPY%\CSXS\manifest.xml" goto :installed
echo.
echo [!] Another LazyKick copy is installed for all users in
echo     %ALL_USERS_COPY%
echo     Delete that folder (it needs administrator rights) so the two
echo     copies do not clash.

:installed
echo.
echo ============================================================
echo   Installed.
echo ============================================================
echo.
echo   Open it:
echo     After Effects  Window - Extensions - LazyKick
echo     Premiere Pro   Window - Extensions - LazyKick
echo.
echo   Your notes and watch bins from an earlier LazyKick are kept.
echo.
echo   If the panel opens blank, run "Fix a blank panel.bat" and
echo   restart the app.
echo.
goto :end

rem ================================================================ helpers

:remove_panel
if not exist "%DEST%" exit /b 0
rem A junction - what a developer link makes - is removed with a plain rmdir,
rem which never touches the folder it points at.
dir /a:l /b "%EXT_ROOT%" 2>nul | findstr /i /x "com.sohan.LazyKick" >nul
if not errorlevel 1 (
  rmdir "%DEST%"
) else (
  rmdir /s /q "%DEST%"
)
exit /b 0

:move_legacy_copy
rem LazyKick 1.0 was installed by copying its folder here as "LazyKick".
rem Two panels with one ID clash, so that copy is moved out of the way -
rem not deleted - to %APPDATA%\Adobe\CEP\LazyKick-old-copy.
if not exist "%LEGACY%\CSXS\manifest.xml" exit /b 0
findstr /c:"com.sohan.LazyKick" "%LEGACY%\CSXS\manifest.xml" >nul
if errorlevel 1 exit /b 0
dir /a:l /b "%EXT_ROOT%" 2>nul | findstr /i /x "LazyKick" >nul
if not errorlevel 1 (
  rmdir "%LEGACY%"
  echo Removed the developer link "%LEGACY%".
  exit /b 0
)
set "PARKED=%APPDATA%\Adobe\CEP\LazyKick-old-copy"
if exist "%PARKED%" set "PARKED=%APPDATA%\Adobe\CEP\LazyKick-old-copy-%RANDOM%"
move "%LEGACY%" "%PARKED%" >nul
if exist "%LEGACY%" (
  echo [!] Could not move the older copy "%LEGACY%" - delete it by hand.
) else (
  echo Moved the older LazyKick copy to "%PARKED%".
)
exit /b 0

:fail
echo.
echo Nothing was installed. Fix the problem above and run this again.

:end
echo.
pause
