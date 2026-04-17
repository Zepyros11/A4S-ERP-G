-- ============================================================
-- Migration 018: Add price to events
-- Fixed price per attendee (auto-fill ยอดชำระ in attendee modal)
-- ============================================================

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS price NUMERIC(10, 2) DEFAULT 0;

-- ============================================================
-- DONE ✅
-- ============================================================
