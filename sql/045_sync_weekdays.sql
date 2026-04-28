-- ============================================================
-- Migration 045: Weekdays + hour scheduling for Auto-Sync
-- frequency='weekdays' → run only on selected weekdays at given hour (Asia/Bangkok)
-- frequency_days  : array of 0-6 (0=Sunday .. 6=Saturday) เช่น {1,3,5} = จ./พ./ศ.
-- frequency_hour  : 0-23 (Bangkok TZ hour-of-day)
-- ============================================================

ALTER TABLE sync_config
  ADD COLUMN IF NOT EXISTS frequency_days  SMALLINT[],
  ADD COLUMN IF NOT EXISTS frequency_hour  SMALLINT;

ALTER TABLE automation_tasks
  ADD COLUMN IF NOT EXISTS schedule_days   SMALLINT[],
  ADD COLUMN IF NOT EXISTS schedule_hour   SMALLINT;

-- ============================================================
-- DONE ✅
-- Test:
--   SELECT frequency, frequency_days, frequency_hour FROM sync_config WHERE id=1;
--   SELECT workflow, schedule, schedule_days, schedule_hour FROM automation_tasks;
-- ============================================================
