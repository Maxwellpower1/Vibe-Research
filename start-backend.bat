@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0backend"

where python >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Python not found. Install Python 3.10+ and add it to PATH.
  pause
  exit /b 1
)

echo [backend] Installing dependencies (system Python, no venv)...
python -m pip install -r requirements.txt
if errorlevel 1 (
  echo [ERROR] pip install failed.
  pause
  exit /b 1
)

echo [backend] Freeing port 8900...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":8900 .*LISTENING"') do (
  if not "%%P"=="0" taskkill /F /PID %%P >nul 2>&1
)

echo [backend] Starting FastAPI at http://0.0.0.0:8900 (LAN open)
python -m uvicorn app:app --host 0.0.0.0 --port 8900
if errorlevel 1 (
  echo [ERROR] Backend exited with an error.
  pause
  exit /b 1
)

endlocal
