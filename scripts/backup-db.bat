@echo off
REM ============================================================
REM  A4S DB Backup — รัน keyset-backup ทุกตาราง Supabase
REM  ใช้กับ Free tier ที่ไม่มี auto-backup
REM  - ดับเบิลคลิก = รันเลย
REM  - Task Scheduler = ตั้งให้เรียกไฟล์นี้รายสัปดาห์
REM  ผล: D:\@Projects\A4S-backups\db-<วันเวลา>\  (+ _manifest.json)
REM ============================================================
REM ปลายทาง = Shared Drive บริษัท (Google Drive for desktop จะ sync ขึ้น cloud อัตโนมัติ = มี copy นอกเครื่อง)
set "BACKUP_DIR=G:\Shared drives\A4S-ERP-Images\Backups"
cd /d "D:\@Projects\A4S-ERP-G"
node scripts\backup-db.cjs
echo.
echo === backup เสร็จ (exit %errorlevel%) — ดูผลที่ %BACKUP_DIR% ===
timeout /t 8 >nul
