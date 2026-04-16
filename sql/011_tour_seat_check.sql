-- =============================================
-- tour_seat_check: สร้างตารางและเพิ่ม columns ที่ขาด
-- =============================================

-- สร้างตาราง (ถ้ายังไม่มี)
CREATE TABLE IF NOT EXISTS tour_seat_check (
  code               TEXT PRIMARY KEY,
  name               TEXT,
  pin                TEXT,
  port               TEXT,
  group_name         TEXT,
  flight             TEXT,
  departure_datetime TEXT,
  arrival_datetime   TEXT,
  comeback           TEXT,
  comeback_datetime  TEXT,
  seat               NUMERIC,
  nationality        TEXT,
  passport_image_url TEXT,
  passport_id        TEXT,
  passport_exp_date  TEXT,
  visa_image_url     TEXT,
  tel                TEXT,
  tshirt_size        TEXT,
  port_name          TEXT,
  highlighted        BOOLEAN DEFAULT FALSE,
  waive              BOOLEAN DEFAULT FALSE,
  is_sub_row         BOOLEAN DEFAULT FALSE,
  parent_code        TEXT,
  created_at         TIMESTAMPTZ DEFAULT now()
);

-- เพิ่ม columns ใหม่ (ถ้าตารางมีอยู่แล้วแต่ยังไม่มี columns เหล่านี้)
ALTER TABLE tour_seat_check ADD COLUMN IF NOT EXISTS port        TEXT;
ALTER TABLE tour_seat_check ADD COLUMN IF NOT EXISTS highlighted BOOLEAN DEFAULT FALSE;
ALTER TABLE tour_seat_check ADD COLUMN IF NOT EXISTS waive       BOOLEAN DEFAULT FALSE;
