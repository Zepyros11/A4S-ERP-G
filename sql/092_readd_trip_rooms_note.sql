-- ============================================================
-- Migration 092: คืน column trip_rooms.note (per-room note)
--
-- Why:
--   ใน 091 ลบ note ออกเพราะตอนแรกอยู่ใน modal batch create ซึ่งไม่จำเป็น
--   แต่ "note ต่อห้อง" ยังมีประโยชน์ (ห้องชั้น 5, connecting, มี balcony, ฯลฯ)
--   ใส่ผ่านไอคอน 📝 บนการ์ดห้อง — ไม่ใช่ตอนสร้าง batch
-- ============================================================

ALTER TABLE trip_rooms ADD COLUMN IF NOT EXISTS note TEXT;

-- Reload PostgREST cache
NOTIFY pgrst, 'reload schema';
