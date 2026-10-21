@echo off
echo ==========================================
echo   Deploy wrapper-lite key server
echo   Target: C:\wrapper-lite
echo.
echo   QEMU cannot run from a Chinese path,
echo   so it must be copied to C:\ first.
echo ==========================================
echo.
if exist "C:\wrapper-lite\wrapper-lite-qemu.exe" (
  echo [!] Already deployed at C:\wrapper-lite
  echo     Just run  C:\wrapper-lite\2-start-server.bat
  echo.
  pause
  exit /b 0
)
echo Copying files ^(about 600MB^), please wait...
robocopy "%~dp0wrapper-lite" "C:\wrapper-lite" /E /NFL /NDL /NJH /NP >nul
if errorlevel 8 (
  echo [X] Copy FAILED. Try running this file as Administrator.
  pause
  exit /b 1
)
echo.
echo [OK] Deployed to C:\wrapper-lite
echo.
echo Next steps:
echo   1. First time only: run  C:\wrapper-lite\1-login.bat
echo      ^(use a SECONDARY Apple ID, never your main one!^)
echo   2. Every time: run  C:\wrapper-lite\2-start-server.bat
echo      and KEEP the window open while downloading.
echo.
pause
