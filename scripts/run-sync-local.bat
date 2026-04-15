@echo off
REM ============================================================
REM  A4S-ERP Sync — Double-click to run locally
REM  Run mode: LOCAL_TEST=1 (browser visible) + LIVE (upsert จริง)
REM ============================================================

cd /d "%~dp0"

echo ============================================================
echo  A4S-ERP Sync Members - LOCAL mode
echo ============================================================
echo.

REM Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org/
    pause
    exit /b 1
)

REM Check .env
if not exist ".env" (
    echo [ERROR] .env file not found in %cd%
    echo.
    echo Please create .env with:
    echo   SUPABASE_URL=https://xxx.supabase.co
    echo   SUPABASE_SERVICE_KEY=eyJhbG...
    echo   MASTER_KEY=your-master-key
    echo.
    pause
    exit /b 1
)

REM Check node_modules
if not exist "node_modules" (
    echo [SETUP] First run detected — installing dependencies...
    call npm install
    call npx playwright install chromium
)

echo.
echo [RUN] Starting sync...
echo.

set LOCAL_TEST=1
node --env-file=.env sync-members.js

echo.
echo ============================================================
echo  Done. Press any key to close.
echo ============================================================
pause
