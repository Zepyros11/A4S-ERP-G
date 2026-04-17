-- ============================================================
-- Migration 023: Grace period + payment deadline + expired state
-- - events.grace_days (null = ใช้ค่า default จาก app_settings)
-- - app_settings table สำหรับ config ทั้งระบบ
-- - event_attendees.payment_deadline + expired_at
-- ============================================================

-- 1) App-wide key/value settings
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  description TEXT,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO app_settings (key, value, description)
VALUES
  ('default_grace_days', '3', 'จำนวนวันที่ให้ชำระเงินหลังลงทะเบียน (default ทั้งระบบ)')
ON CONFLICT (key) DO NOTHING;

-- 2) grace_days ต่อ event (override ค่า default)
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS grace_days INTEGER;

-- 3) Deadline + expired state ต่อ attendee
ALTER TABLE event_attendees
  ADD COLUMN IF NOT EXISTS payment_deadline DATE,
  ADD COLUMN IF NOT EXISTS expired_at       TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_event_attendees_deadline
  ON event_attendees(payment_deadline);

-- ============================================================
-- DONE ✅
-- ============================================================
