@echo off
echo ========================================================
echo   LazyKick - Enable Adobe CEP Debug Mode
echo   Developed By: RaisulSohan (raisulsohan.com)
echo ========================================================
echo.
echo For developers running LazyKick unpacked from this folder.
echo The signed .zxp release does not need this.
echo.
echo Adding PlayerDebugMode registry keys for CSXS 9 to 14...

for %%v in (9 10 11 12 13 14) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1

echo.
echo [SUCCESS] Debug Mode is enabled!
echo You can now run the unpacked LazyKick in Premiere Pro and After Effects.
echo.
pause
