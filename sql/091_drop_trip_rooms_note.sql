-- ============================================================
-- Migration 091: ลบ column trip_rooms.note
--
-- Why:
--   ใช้งานจริงไม่ต้องการ — modal "เพิ่มประเภทห้อง" ลด field
--   ให้เหลือแค่ โรงแรม + ประเภทห้อง + จำนวนห้อง
--   capacity มาจาก place_room_types.max_guests อัตโนมัติ
--   หมายเหตุ ไม่จำเป็น
-- ============================================================

ALTER TABLE trip_rooms DROP COLUMN IF EXISTS note;

-- Reload PostgREST cache
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Verify:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name='trip_rooms' ORDER BY ordinal_position;
-- ============================================================
