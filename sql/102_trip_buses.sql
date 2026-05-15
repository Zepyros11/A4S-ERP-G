-- ============================================================
-- Migration 102: ตาราง trip_buses + trip_bus_occupants
--
-- Why:
--   เพิ่มหน้า "จัดที่นั่งรถบัส" (modules/trip/bus-assign.html?trip_id=X)
--   1 trip = ที่นั่งคงเดิมทั้งทริป (ไม่มี leg/วันแยก)
--   1 คน × 1 ที่นั่ง × 1 คัน — แต่ trip มีหลายคันได้
--
-- Layout preset เก็บ key ใน DB (BUS_45_2_2, BUS_40_2_2, BUS_32_2_1,
-- VAN_13, VAN_15, CUSTOM) — render grid ใน JS
--
-- Idempotent — รันซ้ำได้
-- ============================================================

-- 1) ตาราง trip_buses (รถ 1 คัน)
CREATE TABLE IF NOT EXISTS trip_buses (
  bus_id        SERIAL PRIMARY KEY,
  trip_id       INTEGER NOT NULL REFERENCES trips(trip_id) ON DELETE CASCADE,
  bus_no        INTEGER NOT NULL DEFAULT 1,        -- คันที่ 1, 2, 3...
  bus_label     TEXT,                              -- ชื่อ/ฉายาคัน "รถ VIP", "คันใหญ่"
  layout_preset TEXT NOT NULL DEFAULT 'BUS_45_2_2',
  capacity      INTEGER NOT NULL DEFAULT 45,
  vendor        TEXT,                              -- บริษัทรถ
  plate         TEXT,                              -- ทะเบียน
  driver_name   TEXT,
  driver_phone  TEXT,
  note          TEXT,
  sort_order    INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE trip_buses ADD COLUMN IF NOT EXISTS bus_no        INTEGER DEFAULT 1;
ALTER TABLE trip_buses ADD COLUMN IF NOT EXISTS bus_label     TEXT;
ALTER TABLE trip_buses ADD COLUMN IF NOT EXISTS layout_preset TEXT DEFAULT 'BUS_45_2_2';
ALTER TABLE trip_buses ADD COLUMN IF NOT EXISTS capacity      INTEGER DEFAULT 45;
ALTER TABLE trip_buses ADD COLUMN IF NOT EXISTS vendor        TEXT;
ALTER TABLE trip_buses ADD COLUMN IF NOT EXISTS plate         TEXT;
ALTER TABLE trip_buses ADD COLUMN IF NOT EXISTS driver_name   TEXT;
ALTER TABLE trip_buses ADD COLUMN IF NOT EXISTS driver_phone  TEXT;
ALTER TABLE trip_buses ADD COLUMN IF NOT EXISTS note          TEXT;
ALTER TABLE trip_buses ADD COLUMN IF NOT EXISTS sort_order    INTEGER DEFAULT 0;
ALTER TABLE trip_buses ADD COLUMN IF NOT EXISTS created_at    TIMESTAMPTZ DEFAULT now();
ALTER TABLE trip_buses ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_trip_buses_trip_id
  ON trip_buses (trip_id, sort_order);

-- 2) ตาราง trip_bus_occupants — 1 คน × 1 ที่นั่ง × 1 คัน
--    PK = (bus_id, seat_no) → 1 ที่นั่ง 1 คน
--    UNIQUE (bus_id, code) → 1 คนนั่งได้ที่เดียวในคันนั้น
--    แต่ trip อาจมีหลายคัน → 1 code อยู่ได้หลาย row (ต่างคัน)
--    Constraint logical: 1 คน นั่งได้ 1 คันต่อ trip (enforce ฝั่ง app)
CREATE TABLE IF NOT EXISTS trip_bus_occupants (
  bus_id       INTEGER NOT NULL REFERENCES trip_buses(bus_id) ON DELETE CASCADE,
  seat_no      TEXT    NOT NULL,
  code         TEXT    NOT NULL,
  assigned_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (bus_id, seat_no),
  UNIQUE (bus_id, code)
);

CREATE INDEX IF NOT EXISTS idx_tbo_code ON trip_bus_occupants (code);
CREATE INDEX IF NOT EXISTS idx_tbo_bus  ON trip_bus_occupants (bus_id);

-- 3) Permissions: grant trip_bus_* ให้ ADMIN
UPDATE role_configs
SET permissions = (
  SELECT to_jsonb(array(
    SELECT DISTINCT unnest(
      array(SELECT jsonb_array_elements_text(permissions))
      || ARRAY[
        'trip_bus_view',
        'trip_bus_create',
        'trip_bus_edit',
        'trip_bus_delete',
        'trip_bus_assign'
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
--   SELECT * FROM trip_buses WHERE trip_id = 1;
--   SELECT bus_id, seat_no, code FROM trip_bus_occupants
--     WHERE bus_id IN (SELECT bus_id FROM trip_buses WHERE trip_id = 1);
-- ============================================================
