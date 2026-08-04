@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0frontend"

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm not found. Install Node.js LTS and add it to PATH.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [frontend] Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

echo [frontend] Starting Vite at http://localhost:5899
call npm run dev
if errorlevel 1 (
  echo [ERROR] Frontend exited with an error.
  pause
  exit /b 1
)

endlocal
