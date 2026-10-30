@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Can cai Node.js 24 LTS truoc.
  pause
  exit /b 1
)
node -e "if(parseInt(process.versions.node)<24)process.exit(1)"
if errorlevel 1 (
  echo Can Node.js 24 tro len. Hay cap nhat Node.
  pause
  exit /b 1
)
if not exist paper-week.env (
  copy paper-week.env.example paper-week.env >nul
  echo Da tao paper-week.env. Hay dien Helius va Telegram tren may cua ban.
  echo Khong them private key. Luu file roi chay lai.
  notepad paper-week.env
  pause
  exit /b 0
)
if not exist node_modules\@solana\web3.js (
  call npm ci --omit=dev --ignore-scripts --no-audit --no-fund
  if errorlevel 1 (
    echo Cai dependencies that bai.
    pause
    exit /b 1
  )
)
node --use-env-proxy --env-file-if-exists=paper-week.env paper-week/bootstrap.js
pause
