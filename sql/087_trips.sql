-- ============================================================
-- Migration 087: ตาราง trips + เพิ่ม trip_id ให้ tour_seat_check
--
-- Why:
--   เพิ่มหน้า "รายการทริป" (modules/trip/trip-list.html) แทน Check Seat
--   ให้เป็นหน้าหลักของ TRIP module — แต่ละ trip มี name + ช่วงวันที่
--   Check Seat กลายเป็น sub-feature (per-trip) — เปิดผ่าน
--   check-seat.html?trip_id=X
--
-- Idempotent — รันซ้ำได้
-- ============================================================

-- 1) สร้างตาราง trips
CREATE TABLE IF NOT EXISTS trips (
  trip_id     SERIAL PRIMARY KEY,
  trip_name   TEXT NOT NULL,
  start_date  DATE,
  end_date    DATE,
  status      TEXT DEFAULT 'ACTIVE',     -- ACTIVE | DONE | CANCELLED
  description TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Defensive (เผื่อมีตารางเก่าที่ column ไม่ครบ)
ALTER TABLE trips ADD COLUMN IF NOT EXISTS trip_name   TEXT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS start_date  DATE;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS end_date    DATE;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS status      TEXT DEFAULT 'ACTIVE';
ALTER TABLE trips ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ DEFAULT now();
ALTER TABLE trips ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_trips_status_start
  ON trips (status, start_date DESC);

-- 2) เพิ่ม trip_id ให้ tour_seat_check (nullable = ข้อมูลเก่าไม่กระทบ)
ALTER TABLE tour_seat_check ADD COLUMN IF NOT EXISTS trip_id INTEGER;

-- FK soft (ON DELETE SET NULL) — ลบ trip ไม่ลบรายชื่อ
DO $$ BEGIN
  ALTER TABLE tour_seat_check
    ADD CONSTRAINT tour_seat_check_trip_id_fkey
    FOREIGN KEY (trip_id) REFERENCES trips(trip_id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table  THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_tour_seat_check_trip_id
  ON tour_seat_check (trip_id);

-- 3) Permissions: grant trip_list_* ให้ ADMIN
UPDATE role_configs
SET permissions = (
  SELECT to_jsonb(array(
    SELECT DISTINCT unnest(
      array(SELECT jsonb_array_elements_text(permissions))
      || ARRAY[
        'trip_list_view',
        'trip_list_create',
        'trip_list_edit',
        'trip_list_delete'
      ]
    )
  ))
)
WHERE role_key = 'ADMIN';

-- 4) Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅
-- Verify:
--   SELECT * FROM trips ORDER BY trip_id;
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='tour_seat_check' AND column_name='trip_id';
-- ============================================================
