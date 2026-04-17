-- ============================================================
-- Migration 019: Relax attend_type on event_attendees
-- field ถูกยกเลิกการใช้งานจาก UI แล้ว (ถูกกำหนดที่ event-level)
-- ปลด NOT NULL + CHECK เพื่อไม่ให้ save ติด
-- ============================================================

ALTER TABLE event_attendees
  ALTER COLUMN attend_type DROP NOT NULL;

ALTER TABLE event_attendees
  DROP CONSTRAINT IF EXISTS event_attendees_attend_type_check;

-- ============================================================
-- DONE ✅
-- ============================================================
