-- ============================================================
-- Migration 113: ลบ team_name จาก trip_guides (revert 111)
--
-- Why:
--   ตัดสินใจไม่ใช้ team_name แล้ว — กลุ่มใช้ member_type พอ
--   user เลือก revert design แทน
--
-- Idempotent — รันซ้ำได้
-- ============================================================

DROP INDEX IF EXISTS idx_trip_guides_team_name;

ALTER TABLE trip_guides
  DROP COLUMN IF EXISTS team_name;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE
-- Verify:
--   \d trip_guides   -- ต้องไม่มี team_name แล้ว
-- ============================================================
