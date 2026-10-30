@echo off
cd /d "%~dp0"
py -3 -m venv .venv
if errorlevel 1 goto failed
.venv\Scripts\python -m pip install -r requirements.txt
if errorlevel 1 goto failed
.venv\Scripts\python -m playwright install chromium
if errorlevel 1 goto failed
.venv\Scripts\python naukri_local.py login
pause
exit /b
:failed
echo Setup failed. Install Python 3 from python.org, then try again.
pause