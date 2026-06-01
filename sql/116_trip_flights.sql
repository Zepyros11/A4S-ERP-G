-- ============================================================
-- Migration 116: ตาราง trip_flights + trip_flight_occupants
--
-- Why:
--   เพิ่มแท็บ "เครื่องบิน" ในหน้า room-assign (จัดห้องพัก+รถบัส)
--   1 ตั๋ว (flight) = ชุดข้อมูลเที่ยวบินไป-กลับ + รูปตั๋วได้สูงสุด 5 รูป
--   แล้วมอบหมายลูกค้า/ทีมงานเข้าตั๋วได้ (1 คน อยู่ได้ 1 ตั๋วต่อทริป)
--
--   ฟิลด์ตั๋ว: flight, departure_datetime, arrival_datetime,
--             comeback, comeback_datetime  (เก็บเป็น TEXT = ค่า datetime-local ดิบ)
--   รูป: image_urls (jsonb array ของ public URL ใน bucket tour-seat-images)
--
--   สิทธิ์: ใช้ร่วมกับ trip_bus_* (ใครจัดรถบัสได้ = จัดตั๋วได้) ไม่ต้องเพิ่ม perm ใหม่
--
-- Idempotent — รันซ้ำได้
-- ============================================================

-- 1) ตาราง trip_flights (1 ตั๋ว)
CREATE TABLE IF NOT EXISTS trip_flights (
  flight_id          SERIAL PRIMARY KEY,
  trip_id            INTEGER NOT NULL REFERENCES trips(trip_id) ON DELETE CASCADE,
  flight_label       TEXT,                              -- ชื่อ/ฉายาตั๋ว "กรุ๊ป A", "ไฟลท์เช้า"
  flight             TEXT,                              -- เที่ยวบินขาไป
  port               TEXT,                              -- สนามบินขาออก (เลือกเอง · ตัวเลือกจาก check-seat)
  departure_datetime TEXT,                              -- วันเวลาออก
  arrival_datetime   TEXT,                              -- วันเวลาถึง
  comeback           TEXT,                              -- เที่ยวบินขากลับ
  comeback_datetime  TEXT,                              -- วันเวลากลับ
  image_urls         JSONB NOT NULL DEFAULT '[]'::jsonb,-- รูปตั๋ว (≤5)
  note               TEXT,
  sort_order         INTEGER DEFAULT 0,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE trip_flights ADD COLUMN IF NOT EXISTS flight_label       TEXT;
ALTER TABLE trip_flights ADD COLUMN IF NOT EXISTS flight             TEXT;
ALTER TABLE trip_flights ADD COLUMN IF NOT EXISTS port               TEXT;
ALTER TABLE trip_flights ADD COLUMN IF NOT EXISTS departure_datetime TEXT;
ALTER TABLE trip_flights ADD COLUMN IF NOT EXISTS arrival_datetime   TEXT;
ALTER TABLE trip_flights ADD COLUMN IF NOT EXISTS comeback           TEXT;
ALTER TABLE trip_flights ADD COLUMN IF NOT EXISTS comeback_datetime  TEXT;
ALTER TABLE trip_flights ADD COLUMN IF NOT EXISTS image_urls         JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE trip_flights ADD COLUMN IF NOT EXISTS note               TEXT;
ALTER TABLE trip_flights ADD COLUMN IF NOT EXISTS sort_order         INTEGER DEFAULT 0;
ALTER TABLE trip_flights ADD COLUMN IF NOT EXISTS created_at         TIMESTAMPTZ DEFAULT now();
ALTER TABLE trip_flights ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_trip_flights_trip_id
  ON trip_flights (trip_id, sort_order);

-- 2) ตาราง trip_flight_occupants — bucket (1 คน × 1 ตั๋ว · trip มีหลายตั๋วได้)
--    PK = (flight_id, code) → คนเดิมในตั๋วเดิมไม่ซ้ำ
--    Constraint logical: 1 คน อยู่ได้ 1 ตั๋วต่อทริป (enforce ฝั่ง app)
--    code เก็บ tour_seat_check.code หรือ "g:<guide_id>" สำหรับทีมงาน
CREATE TABLE IF NOT EXISTS trip_flight_occupants (
  flight_id    INTEGER NOT NULL REFERENCES trip_flights(flight_id) ON DELETE CASCADE,
  code         TEXT    NOT NULL,
  assigned_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (flight_id, code)
);

CREATE INDEX IF NOT EXISTS idx_tfo_code   ON trip_flight_occupants (code);
CREATE INDEX IF NOT EXISTS idx_tfo_flight ON trip_flight_occupants (flight_id);

-- 3) Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅
-- Verify:
--   SELECT * FROM trip_flights WHERE trip_id = 1;
--   SELECT flight_id, code FROM trip_flight_occupants
--     WHERE flight_id IN (SELECT flight_id FROM trip_flights WHERE trip_id = 1);
-- ============================================================
