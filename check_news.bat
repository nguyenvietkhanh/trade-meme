@echo off
setlocal
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
 echo Run setup_ai.bat first.
 pause
 exit /b 1
)
.venv\Scripts\python.exe news_check.py
pause
