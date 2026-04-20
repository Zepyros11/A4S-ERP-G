-- ============================================================
-- Migration 034: Dining rooms per place
-- เพิ่ม flag has_dining บน place_types + ตาราง place_dining_rooms
-- Pattern เดียวกับ place_rooms (1 place → หลายห้อง)
-- ============================================================

ALTER TABLE place_types
  ADD COLUMN IF NOT EXISTS has_dining BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS place_dining_rooms (
  dining_id       BIGSERIAL PRIMARY KEY,
  place_id        BIGINT NOT NULL REFERENCES places(place_id) ON DELETE CASCADE,
  room_name       TEXT NOT NULL,
  floor           TEXT,
  capacity        INTEGER,
  pricing_models  TEXT[],          -- ['menu','buffet','set_per_head','room_charter']
  price_per_head  NUMERIC,
  price_per_event NUMERIC,
  price_per_hour  NUMERIC,
  cuisine_types   TEXT[],          -- ['thai','chinese','western','japanese','fusion',...]
  is_halal        BOOLEAN DEFAULT FALSE,
  is_vegetarian   BOOLEAN DEFAULT FALSE,
  allow_alcohol   BOOLEAN DEFAULT FALSE,
  corkage_fee     NUMERIC,
  open_time       TEXT,            -- เก็บเป็น string "11:00" ให้ยืดหยุ่น
  close_time      TEXT,
  notes           TEXT,
  image_urls      TEXT[],
  sort_order      INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_place_dining_rooms_place
  ON place_dining_rooms(place_id);

-- ============================================================
-- DONE
-- ============================================================
