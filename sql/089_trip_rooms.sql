-- ============================================================
-- Migration 089: ตาราง trip_rooms + เพิ่ม room_id ให้ tour_seat_check
--
-- Why:
--   เพิ่มหน้า "จัดห้องพัก" (modules/trip/room-assign.html?trip_id=X)
--   — Staff สร้างห้องพัก (ตามแบบ + จำนวน) แล้วจับคู่ผู้โดยสารใน
--   tour_seat_check เข้าห้อง
--
-- Idempotent — รันซ้ำได้
-- ============================================================

-- 1) สร้างตาราง trip_rooms
CREATE TABLE IF NOT EXISTS trip_rooms (
  room_id      SERIAL PRIMARY KEY,
  trip_id      INTEGER NOT NULL REFERENCES trips(trip_id) ON DELETE CASCADE,
  room_name    TEXT NOT NULL,           -- เช่น "Twin-1", "Suite A", "101"
  room_type    TEXT,                    -- เช่น "Twin", "Single", "Suite" (ใช้ group ใน UI)
  capacity     INTEGER NOT NULL DEFAULT 2,
  gender_pref  TEXT,                    -- 'M' | 'F' | 'MIXED' | NULL (Staff ตั้งเอง · ไม่ enforce)
  note         TEXT,
  sort_order   INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE trip_rooms ADD COLUMN IF NOT EXISTS room_name   TEXT;
ALTER TABLE trip_rooms ADD COLUMN IF NOT EXISTS room_type   TEXT;
ALTER TABLE trip_rooms ADD COLUMN IF NOT EXISTS capacity    INTEGER DEFAULT 2;
ALTER TABLE trip_rooms ADD COLUMN IF NOT EXISTS gender_pref TEXT;
ALTER TABLE trip_rooms ADD COLUMN IF NOT EXISTS note        TEXT;
ALTER TABLE trip_rooms ADD COLUMN IF NOT EXISTS sort_order  INTEGER DEFAULT 0;
ALTER TABLE trip_rooms ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ DEFAULT now();
ALTER TABLE trip_rooms ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_trip_rooms_trip_id ON trip_rooms (trip_id, sort_order);

-- 2) เพิ่ม room_id ให้ tour_seat_check (ลบห้องไม่ลบรายชื่อ — set null)
ALTER TABLE tour_seat_check ADD COLUMN IF NOT EXISTS room_id INTEGER;

DO $$ BEGIN
  ALTER TABLE tour_seat_check
    ADD CONSTRAINT tour_seat_check_room_id_fkey
    FOREIGN KEY (room_id) REFERENCES trip_rooms(room_id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table  THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_tour_seat_check_room_id ON tour_seat_check (room_id);

-- 3) Permissions
UPDATE role_configs
SET permissions = (
  SELECT to_jsonb(array(
    SELECT DISTINCT unnest(
      array(SELECT jsonb_array_elements_text(permissions))
      || ARRAY[
        'trip_rooms_view',
        'trip_rooms_create',
        'trip_rooms_edit',
        'trip_rooms_delete',
        'trip_rooms_assign'
      ]
    )
  ))
)
WHERE role_key = 'ADMIN';

-- 4) Reload PostgREST cache
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅
-- Verify:
--   SELECT * FROM trip_rooms WHERE trip_id = 1;
--   SELECT room_id, COUNT(*) FROM tour_seat_check
--     WHERE trip_id = 1 GROUP BY room_id;
-- ============================================================
