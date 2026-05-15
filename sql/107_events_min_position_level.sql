-- ============================================================
-- Migration 107: เพิ่ม events.min_position_level
--
-- Why:
--   บาง event จำกัดให้เฉพาะสมาชิกตำแหน่งสูงพอ (เช่น "director ขึ้นไป")
--   ใช้ตรวจตอน register จาก members.position_level
--
-- Hierarchy (สูง → ต่ำ): SVP > VP > AVP > SD > DR
--   NULL = ไม่จำกัด (default — รับทุกตำแหน่ง)
--
-- Idempotent — รันซ้ำได้
-- ============================================================

ALTER TABLE events ADD COLUMN IF NOT EXISTS min_position_level TEXT;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Verify:
--   SELECT event_id, event_name, min_position_level FROM events LIMIT 5;
-- ============================================================
