-- ============================================================
-- Migration 152: program_buses + program_flights + program_staff
--   เครื่องมือ Buses (จัดรถบัส) · Flights (เที่ยวบิน/ตั๋ว) · Staff (ทีมงาน)
--   ใน Operations Hub · mirror pattern จาก trip_buses/trip_flights/trip_guides
--   occupant อ้าง participant_id · 1 คน → 1 รถ / 1 เที่ยวบิน ต่อ program
--
-- Idempotent · ต้องรัน sql/144 + 145 ก่อน
-- ============================================================

-- ── BUSES ──
CREATE TABLE IF NOT EXISTS program_buses (
  bus_id      SERIAL PRIMARY KEY,
  program_id  INTEGER NOT NULL REFERENCES programs(program_id) ON DELETE CASCADE,
  bus_name    TEXT NOT NULL,
  bus_type    TEXT,                    -- เช่น "45 ที่นั่ง" / "VAN"
  capacity    INTEGER NOT NULL DEFAULT 45,
  note        TEXT,
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE program_buses ADD COLUMN IF NOT EXISTS bus_type   TEXT;
ALTER TABLE program_buses ADD COLUMN IF NOT EXISTS capacity   INTEGER DEFAULT 45;
ALTER TABLE program_buses ADD COLUMN IF NOT EXISTS note       TEXT;
ALTER TABLE program_buses ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_program_buses_program ON program_buses (program_id, sort_order);
DROP TRIGGER IF EXISTS trg_program_buses_updated ON program_buses;
CREATE TRIGGER trg_program_buses_updated BEFORE UPDATE ON program_buses FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS program_bus_occupants (
  bus_id         INTEGER NOT NULL REFERENCES program_buses(bus_id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES program_participants(participant_id) ON DELETE CASCADE,
  seat_no        INTEGER,
  PRIMARY KEY (bus_id, participant_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_program_bus_occ_participant ON program_bus_occupants (participant_id);

-- ── FLIGHTS ──
CREATE TABLE IF NOT EXISTS program_flights (
  flight_id        SERIAL PRIMARY KEY,
  program_id       INTEGER NOT NULL REFERENCES programs(program_id) ON DELETE CASCADE,
  flight_name      TEXT NOT NULL,         -- ชื่อกลุ่ม เช่น "กรุ๊ป A ไป-กลับ"
  flight_no        TEXT,
  route            TEXT,                  -- เช่น "BKK → NRT"
  depart_datetime  TIMESTAMPTZ,
  return_datetime  TIMESTAMPTZ,
  note             TEXT,
  sort_order       INTEGER DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE program_flights ADD COLUMN IF NOT EXISTS flight_no       TEXT;
ALTER TABLE program_flights ADD COLUMN IF NOT EXISTS route           TEXT;
ALTER TABLE program_flights ADD COLUMN IF NOT EXISTS depart_datetime TIMESTAMPTZ;
ALTER TABLE program_flights ADD COLUMN IF NOT EXISTS return_datetime TIMESTAMPTZ;
ALTER TABLE program_flights ADD COLUMN IF NOT EXISTS note            TEXT;
ALTER TABLE program_flights ADD COLUMN IF NOT EXISTS sort_order      INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_program_flights_program ON program_flights (program_id, sort_order);
DROP TRIGGER IF EXISTS trg_program_flights_updated ON program_flights;
CREATE TRIGGER trg_program_flights_updated BEFORE UPDATE ON program_flights FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS program_flight_occupants (
  flight_id      INTEGER NOT NULL REFERENCES program_flights(flight_id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES program_participants(participant_id) ON DELETE CASCADE,
  seat           TEXT,
  PRIMARY KEY (flight_id, participant_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_program_flight_occ_participant ON program_flight_occupants (participant_id);

-- ── STAFF / GUIDE / OUTSOURCE (roster) ──
CREATE TABLE IF NOT EXISTS program_staff (
  staff_id     SERIAL PRIMARY KEY,
  program_id   INTEGER NOT NULL REFERENCES programs(program_id) ON DELETE CASCADE,
  full_name    TEXT NOT NULL,
  member_type  TEXT DEFAULT 'staff',    -- 'staff' | 'guide' | 'outsource'
  phone        TEXT,
  languages    TEXT,
  note         TEXT,
  sort_order   INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE program_staff ADD COLUMN IF NOT EXISTS member_type TEXT DEFAULT 'staff';
ALTER TABLE program_staff ADD COLUMN IF NOT EXISTS phone       TEXT;
ALTER TABLE program_staff ADD COLUMN IF NOT EXISTS languages   TEXT;
ALTER TABLE program_staff ADD COLUMN IF NOT EXISTS note        TEXT;
ALTER TABLE program_staff ADD COLUMN IF NOT EXISTS sort_order  INTEGER DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE program_staff ADD CONSTRAINT program_staff_type_chk
    CHECK (member_type IN ('staff','guide','outsource'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_program_staff_program ON program_staff (program_id, sort_order);
DROP TRIGGER IF EXISTS trg_program_staff_updated ON program_staff;
CREATE TRIGGER trg_program_staff_updated BEFORE UPDATE ON program_staff FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── Permissions ──
UPDATE role_configs
SET permissions = (
  SELECT to_jsonb(array(
    SELECT DISTINCT unnest(
      array(SELECT jsonb_array_elements_text(permissions))
      || ARRAY[
        'program_bus_view','program_bus_create','program_bus_edit','program_bus_delete','program_bus_assign',
        'program_flight_view','program_flight_create','program_flight_edit','program_flight_delete','program_flight_assign',
        'program_staff_view','program_staff_create','program_staff_edit','program_staff_delete'
      ]
    )
  ))
)
WHERE role_key = 'ADMIN';

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅  Verify:
--   SELECT * FROM program_buses   WHERE program_id = 1;
--   SELECT * FROM program_flights WHERE program_id = 1;
--   SELECT * FROM program_staff   WHERE program_id = 1;
-- ============================================================
