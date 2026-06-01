-- ============================================================
-- Migration 118: master ตัวเลือก Port (สนามบิน) + เที่ยวบิน — CRUD ได้
--
-- Why:
--   form ตั๋วเครื่องบิน (room-assign) เดิมดึงตัวเลือก Port/เที่ยวบิน จาก check-seat
--   อัตโนมัติเท่านั้น แก้ไม่ได้ → เพิ่มตาราง master ให้ผู้ใช้ เพิ่ม/ลบ/แก้ ได้เอง
--   ผ่านปุ่ม ⚙️ จัดการ ใน dropdown (nested modal) · ใช้ร่วมทุกทริป (global master)
--
--   dropdown = master (เพิ่มเอง) + ค่าจาก check-seat (auto) รวมกัน (dedupe ด้วย code)
--
-- Idempotent — รันซ้ำได้
-- ============================================================

-- สนามบิน/Port: code (IATA เช่น ABJ) + name (เช่น Abidjan)
CREATE TABLE IF NOT EXISTS trip_airports (
  airport_id  SERIAL PRIMARY KEY,
  code        TEXT NOT NULL,
  name        TEXT,
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- เลขเที่ยวบิน: code (เช่น ET934) + name (สายการบิน/เส้นทาง · ไม่บังคับ)
CREATE TABLE IF NOT EXISTS trip_flight_numbers (
  fnum_id     SERIAL PRIMARY KEY,
  code        TEXT NOT NULL,
  name        TEXT,
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅
-- Verify:
--   SELECT * FROM trip_airports ORDER BY sort_order, code;
--   SELECT * FROM trip_flight_numbers ORDER BY sort_order, code;
-- ============================================================
