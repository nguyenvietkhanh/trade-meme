@echo off
setlocal
cd /d "%~dp0"
py -3 -m venv .venv
if errorlevel 1 goto fail
.venv\Scripts\python.exe -c "import sys; assert sys.version_info >= (3,11), 'Python 3.11+ required'"
if errorlevel 1 goto fail
.venv\Scripts\python.exe -m pip install -r requirements.txt
if errorlevel 1 goto fail
.venv\Scripts\python.exe -m unittest discover -s tests -v
if errorlevel 1 goto fail
if not exist .env copy .env.example .env >nul
echo Setup complete. Run run.bat for READ-ONLY scanner or verify.bat for public evidence.
pause
exit /b 0
:fail
echo Setup failed. No trade was sent.
pause
exit /b 1
