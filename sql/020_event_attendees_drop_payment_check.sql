-- ============================================================
-- Migration 020: Drop payment_status CHECK constraint
-- JS validates values already (FREE / PENDING / PAID / WAIVED)
-- ============================================================

ALTER TABLE event_attendees
  DROP CONSTRAINT IF EXISTS event_attendees_payment_status_check;

-- ============================================================
-- DONE ✅
-- ============================================================
