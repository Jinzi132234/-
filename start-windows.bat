@echo off
setlocal
cd /d "%~dp0"
set WB_PYTHON=python
set PLAYWRIGHT_BROWSERS_PATH=%CD%\.playwright
if not exist data mkdir data
echo Starting Translate Workbench at http://127.0.0.1:4321
node server/index.mjs
pause
