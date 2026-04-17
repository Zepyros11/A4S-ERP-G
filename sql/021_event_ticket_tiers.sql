-- ============================================================
-- Migration 021: Event Ticket Tiers (Time-based Pricing)
-- หลายราคาต่อ event ตามช่วงเวลา (Early Bird / Regular / Walk-in)
-- ============================================================

-- 1) Tiers table ─ ราคาแยกตามช่วงวันที่
CREATE TABLE IF NOT EXISTS event_ticket_tiers (
  tier_id      SERIAL PRIMARY KEY,
  event_id     INTEGER NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  tier_name    TEXT NOT NULL,
  price        NUMERIC(10, 2) NOT NULL DEFAULT 0,
  valid_from   DATE,                  -- null = ไม่จำกัดวันเริ่ม
  valid_to     DATE,                  -- null = ไม่จำกัดวันสิ้นสุด
  seat_limit   INTEGER,               -- null = ไม่จำกัดที่นั่ง
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_ticket_tiers_event
  ON event_ticket_tiers(event_id);
CREATE INDEX IF NOT EXISTS idx_event_ticket_tiers_valid
  ON event_ticket_tiers(valid_from, valid_to);

-- 2) Attendee ↔ tier  (lock tier ตอน register)
ALTER TABLE event_attendees
  ADD COLUMN IF NOT EXISTS tier_id INTEGER
    REFERENCES event_ticket_tiers(tier_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_event_attendees_tier
  ON event_attendees(tier_id);

-- หมายเหตุ: paid_amount ใน event_attendees ทำหน้าที่เป็น "ราคา lock"
-- อยู่แล้ว — ไม่ต้องเพิ่ม price_locked ซ้ำซ้อน

-- ============================================================
-- DONE ✅
-- ============================================================
