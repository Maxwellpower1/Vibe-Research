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

echo [backend] Starting FastAPI at http://127.0.0.1:8900
python -m uvicorn app:app --host 127.0.0.1 --port 8900
if errorlevel 1 (
  echo [ERROR] Backend exited with an error.
  pause
  exit /b 1
)

endlocal
