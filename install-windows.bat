@echo off
setlocal
cd /d "%~dp0"
echo ============================================
echo  Translate Workbench - Windows installer
echo ============================================
where node >nul 2>nul || (echo [ERROR] Node.js not found. Install Node.js 20+ first. & pause & exit /b 1)
where python >nul 2>nul || (echo [ERROR] Python not found. Install Python 3.10+ first. & pause & exit /b 1)
echo.
echo [1/3] Installing Node dependencies...
call npm install || (echo [ERROR] npm install failed. & pause & exit /b 1)
echo.
echo [2/3] Installing Python packages...
call python -m pip install --upgrade pip
call python -m pip install faster-whisper pillow numpy || (echo [WARN] Python package install failed. & pause)
echo.
echo [3/3] Installing Chromium for HTML renderer (optional)...
set PLAYWRIGHT_BROWSERS_PATH=%CD%\.playwright
call npx playwright-core install chromium
echo.
echo Done. Double-click start-windows.bat to run.
pause
