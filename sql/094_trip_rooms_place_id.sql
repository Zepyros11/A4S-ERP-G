-- ============================================================
-- Migration 094: เพิ่ม place_id ให้ trip_rooms (ผูกห้องกับโรงแรม)
--
-- Why:
--   หน้าจัดห้องพักต้องการแสดง "โรงแรม : ชื่อห้อง" ใน group header
--   trip_rooms.room_type เก็บแค่ชื่อประเภทห้อง (เช่น "Twin Bedroom")
--   ต้องเพิ่ม FK → places เพื่อ lookup ชื่อโรงแรม
-- ============================================================

ALTER TABLE trip_rooms ADD COLUMN IF NOT EXISTS place_id BIGINT;

DO $$ BEGIN
  ALTER TABLE trip_rooms
    ADD CONSTRAINT trip_rooms_place_id_fkey
    FOREIGN KEY (place_id) REFERENCES places(place_id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table  THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_trip_rooms_place_id ON trip_rooms (place_id);

NOTIFY pgrst, 'reload schema';
