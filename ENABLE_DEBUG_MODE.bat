@echo off
echo ========================================================
echo   LazyKick - Enable Adobe CEP Debug Mode
echo   Developed By: RaisulSohan (raisulsohan.com)
echo ========================================================
echo.
echo Adding PlayerDebugMode registry keys for CSXS 9 to 12...

reg add "HKCU\Software\Adobe\CSXS.9"  /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.10" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1
reg add "HKCU\Software\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1

echo.
echo [SUCCESS] Debug Mode is enabled!
echo You can now install and run LazyKick in Premiere Pro and After Effects.
echo.
pause
