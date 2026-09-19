@echo off
rem  Double-click this file to open the MBOnyx lead checker.
rem  Everything it does lives in start.mjs; this only finds Node and runs it.

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   This computer does not have Node installed yet.
  echo.
  echo   1. Go to  https://nodejs.org
  echo   2. Download the big green "LTS" button and install it.
  echo   3. Double-click this file again.
  echo.
  pause
  exit /b 1
)

node start.mjs

rem  A crash would otherwise close the window before the message could be read.
if errorlevel 1 pause
