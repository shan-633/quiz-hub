@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 24 or newer: https://nodejs.org/
  pause
  exit /b 1
)
if not exist node_modules (
  call npm ci
  if errorlevel 1 goto failure
)
call npm run build
if errorlevel 1 goto failure
echo.
echo Zhixu is starting. Open http://localhost:3001 in your browser.
echo Press Ctrl+C to stop. Your work stays in the data folder.
echo.
call npm start
exit /b %errorlevel%
:failure
echo Startup failed. See the output above.
pause
exit /b 1
