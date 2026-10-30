@echo off
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
echo Run setup-windows.bat first.
pause
exit /b
)
.venv\Scripts\python naukri_local.py watch
pause