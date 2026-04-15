@echo off
REM ============================================================
REM  A4S-ERP Sync — DRY RUN (ทดสอบ flow ไม่ upsert จริง)
REM ============================================================

cd /d "%~dp0"

echo ============================================================
echo  A4S-ERP Sync Members - DRY RUN mode
echo  (ทดสอบ flow ไม่บันทึกข้อมูลลง Supabase)
echo ============================================================
echo.

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org/
    pause
    exit /b 1
)

if not exist ".env" (
    echo [ERROR] .env file not found in %cd%
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [SETUP] First run — installing dependencies...
    call npm install
    call npx playwright install chromium
)

set LOCAL_TEST=1
set DRY_RUN=1
node --env-file=.env sync-members.js

echo.
pause
