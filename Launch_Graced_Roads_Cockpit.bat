@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0auto_launch_cockpit.ps1" -OpenOperationsWall -StartupDelaySeconds 0
exit /b %errorlevel%
