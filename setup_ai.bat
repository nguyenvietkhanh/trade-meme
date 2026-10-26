@echo off
setlocal
cd /d "%~dp0"
py -3 -c "import sys; assert sys.version_info >= (3,11), 'Python 3.11+ required'"
if errorlevel 1 goto fail
if not exist .venv\Scripts\python.exe py -3 -m venv .venv
if errorlevel 1 goto fail
.venv\Scripts\python.exe -m pip install -r requirements.txt
if errorlevel 1 goto fail
.venv\Scripts\python.exe -m unittest discover -s tests -v
if errorlevel 1 goto fail
if not exist .env.ai copy .env.ai.example .env.ai >nul
echo Setup ready. Fill .env.ai LOCALLY, never send it in chat.
echo Run check_account.bat before start_ai.bat. Default is DRY RUN.
pause
exit /b 0
:fail
echo Setup failed. No order sent.
pause
exit /b 1
