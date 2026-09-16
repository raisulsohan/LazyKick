@echo off
rem LazyKick - removes the panel. Your notes, watch bins and settings are
rem removed too, but only if you say so. Pasted images stay next to your
rem projects.

setlocal EnableExtensions
title Uninstall LazyKick
set "EXT_ROOT=%APPDATA%\Adobe\CEP\extensions"
set "DEST=%EXT_ROOT%\com.sohan.LazyKick"
set "DATA=%APPDATA%\AdobeProjectNotepad"

echo Removing the LazyKick panel...
echo Close After Effects and Premiere Pro first.
echo.
pause

if not exist "%DEST%" (
  echo The panel was not installed.
  goto :data
)

dir /a:l /b "%EXT_ROOT%" 2>nul | findstr /i /x "com.sohan.LazyKick" >nul
if not errorlevel 1 (rmdir "%DEST%") else (rmdir /s /q "%DEST%")

if exist "%DEST%" (
  echo [!] Could not remove it - After Effects or Premiere Pro is probably still open.
  goto :end
)
echo Removed the panel.

:data
if not exist "%DATA%" goto :done
echo.
echo LazyKick keeps your project notes, watch bins and settings in
echo   %DATA%
echo Keep them if you might install LazyKick again.
choice /c YN /m "Delete your notes and settings as well"
if errorlevel 2 goto :done
rmdir /s /q "%DATA%"
if exist "%DATA%" (
  echo [!] Could not remove it - close After Effects and Premiere Pro and try again.
) else (
  echo Removed your notes and settings.
)

:done
echo.
echo Pasted images stay in the "Pasted Images" folders next to your projects.

:end
echo.
pause
