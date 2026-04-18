-- ============================================================
-- Migration 022: Add payment_deadline to event_attendees
-- วันครบกำหนดชำระ — คำนวณจาก created_at + events.grace_days
-- ============================================================

ALTER TABLE event_attendees
  ADD COLUMN IF NOT EXISTS payment_deadline DATE;

-- ============================================================
-- DONE ✅
-- ============================================================
