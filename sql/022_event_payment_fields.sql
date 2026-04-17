-- ============================================================
-- Migration 022: Payment tracking fields on event_attendees
-- method (slip_kbank / slip_ktb / cash / credit_card) + ref + slip_url
-- ============================================================

ALTER TABLE event_attendees
  ADD COLUMN IF NOT EXISTS payment_method TEXT,         -- slip_kbank | slip_ktb | cash | credit_card
  ADD COLUMN IF NOT EXISTS slip_url       TEXT,
  ADD COLUMN IF NOT EXISTS payment_ref    TEXT,         -- เลข ref โอน / EDC / ใบเสร็จ
  ADD COLUMN IF NOT EXISTS paid_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_by    INTEGER;      -- users.user_id (no FK to avoid cascade issues)

CREATE INDEX IF NOT EXISTS idx_event_attendees_paid_at
  ON event_attendees(paid_at);

-- ============================================================
-- DONE ✅
-- ============================================================
