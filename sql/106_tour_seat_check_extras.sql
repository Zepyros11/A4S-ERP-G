-- ============================================================
-- Migration 106: เพิ่ม columns ใน tour_seat_check สำหรับ Bus Export
--
-- Why:
--   หน้า bus export ต้องมีคอลัมน์ตาม spec:
--   Code | Name | PIN | Room | NATIONALITY | RELIGION |
--   FOOD ALLERGY | T-SHIRT SIZE | RETURN FLIGHT | RETURN DATE
--
--   ที่มีอยู่แล้ว: code, name, pin, nationality, tshirt_size
--   ที่ต้องเพิ่ม: religion, food_allergy, return_flight, return_date
--   (Room ดึงจาก trip_rooms ผ่าน trip_room_occupants — ไม่ต้องเพิ่ม)
--
-- Idempotent — รันซ้ำได้
-- ============================================================

ALTER TABLE tour_seat_check ADD COLUMN IF NOT EXISTS religion       TEXT;
ALTER TABLE tour_seat_check ADD COLUMN IF NOT EXISTS food_allergy   TEXT;
ALTER TABLE tour_seat_check ADD COLUMN IF NOT EXISTS return_flight  TEXT;
ALTER TABLE tour_seat_check ADD COLUMN IF NOT EXISTS return_date    TEXT;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Verify:
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'tour_seat_check'
--       AND column_name IN ('religion','food_allergy','return_flight','return_date');
-- ============================================================
