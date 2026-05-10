-- ============================================================
-- Migration 090: ลบ column trip_rooms.gender_pref
--
-- Why:
--   ตอนแรกใส่ gender_pref ให้ Staff ตั้งเอง (ไม่บังคับ)
--   แต่ใช้งานจริงไม่ต้องการ — staff ดู gender ที่ chip ข้างชื่อ
--   ผู้โดยสารและจัดมือเองพอ ไม่จำเป็นต้องมี field ที่ห้อง
-- ============================================================

ALTER TABLE trip_rooms DROP COLUMN IF EXISTS gender_pref;

-- Reload PostgREST cache
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Verify:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name='trip_rooms';
-- ============================================================
