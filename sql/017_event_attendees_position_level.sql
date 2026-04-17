-- ============================================================
-- Migration 017: Add position_level to event_attendees
-- Snapshot สมาชิก's highest rank at time of registration
-- ============================================================

ALTER TABLE event_attendees
  ADD COLUMN IF NOT EXISTS position_level TEXT;

-- ============================================================
-- DONE ✅
-- ============================================================
