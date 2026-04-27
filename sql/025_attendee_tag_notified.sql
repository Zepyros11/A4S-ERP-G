-- ============================================================
-- Migration 025: Tag-notification flag on event_attendees
-- ใช้กันส่ง LINE flex (รายการ tag) ซ้ำตอน undo + re-checkin
-- NULL = ยังไม่เคยส่ง · มีค่า = ส่งไปแล้วตอนนั้น
-- ============================================================

ALTER TABLE event_attendees
  ADD COLUMN IF NOT EXISTS tag_notified_at TIMESTAMPTZ;

-- ============================================================
-- DONE ✅
-- ============================================================
