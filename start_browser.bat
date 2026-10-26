@echo off
setlocal
cd /d "%~dp0"
echo Public-data Chrome mode. READ ONLY. No keys and no real trades.
py -3 -c "import sys; assert sys.version_info >= (3,11), 'Python 3.11+ required'"
if errorlevel 1 goto fail
if not exist .venv\Scripts\python.exe py -3 -m venv .venv
if errorlevel 1 goto fail
.venv\Scripts\python.exe -m pip install -r requirements.txt
if errorlevel 1 goto fail
.venv\Scripts\python.exe -m unittest discover -s tests -v
if errorlevel 1 goto fail
echo Chrome will open in a separate temporary profile. Keep that window open.
.venv\Scripts\python.exe local_verify.py --api-only --backend browser
if errorlevel 1 goto fail
set "PUBLIC_HTTP_BACKEND=browser"
set "DRY_RUN=true"
echo Preflight passed. Starting READ-ONLY scanner. Ctrl+C stops it.
.venv\Scripts\python.exe run_local.py --loop
if errorlevel 1 goto fail
pause
exit /b 0
:fail
echo Stopped. No real order sent. Check output or latest verification ZIP.
echo CHROME_START_FAILED: check Google Chrome is installed.
echo CAPTCHA or access denied: stop; this program does not bypass access controls.
pause
exit /b 1
