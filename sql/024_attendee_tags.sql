-- ============================================================
-- Migration 024: Attendee tags for grouping (รางวัล / VIP / speaker ฯลฯ)
-- ใช้ TEXT[] เพื่อความยืดหยุ่น — ไม่มี enum กำหนดล่วงหน้า
-- ============================================================

ALTER TABLE event_attendees
  ADD COLUMN IF NOT EXISTS tags TEXT[];

CREATE INDEX IF NOT EXISTS idx_event_attendees_tags
  ON event_attendees USING GIN (tags);

-- ============================================================
-- DONE ✅
-- ============================================================
