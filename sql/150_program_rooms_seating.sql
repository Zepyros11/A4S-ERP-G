-- ============================================================
-- Migration 150: program_rooms + program_seating (Rooming + Seating tools)
--
-- Why:
--   เครื่องมือ Rooming (จัดห้องพัก) + Seating (ผังโต๊ะ/ที่นั่ง) ใน
--   Operations Hub · mirror pattern trip_rooms+occupants แต่ root ที่
--   program_id + occupant อ้าง participant_id (program_participants)
--   1 คน อยู่ได้ 1 ห้อง + 1 โต๊ะ ต่อ program (unique participant_id)
--
-- Idempotent · ต้องรัน sql/144 + 145 ก่อน
-- ============================================================

-- ── ROOMS ──
CREATE TABLE IF NOT EXISTS program_rooms (
  room_id     SERIAL PRIMARY KEY,
  program_id  INTEGER NOT NULL REFERENCES programs(program_id) ON DELETE CASCADE,
  room_name   TEXT NOT NULL,
  room_type   TEXT,
  capacity    INTEGER NOT NULL DEFAULT 2,
  gender_pref TEXT,                    -- 'M' | 'F' | 'MIXED' | NULL
  note        TEXT,
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE program_rooms ADD COLUMN IF NOT EXISTS room_type   TEXT;
ALTER TABLE program_rooms ADD COLUMN IF NOT EXISTS capacity    INTEGER DEFAULT 2;
ALTER TABLE program_rooms ADD COLUMN IF NOT EXISTS gender_pref TEXT;
ALTER TABLE program_rooms ADD COLUMN IF NOT EXISTS note        TEXT;
ALTER TABLE program_rooms ADD COLUMN IF NOT EXISTS sort_order  INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_program_rooms_program ON program_rooms (program_id, sort_order);

DROP TRIGGER IF EXISTS trg_program_rooms_updated ON program_rooms;
CREATE TRIGGER trg_program_rooms_updated BEFORE UPDATE ON program_rooms
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS program_room_occupants (
  room_id        INTEGER NOT NULL REFERENCES program_rooms(room_id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES program_participants(participant_id) ON DELETE CASCADE,
  PRIMARY KEY (room_id, participant_id)
);
-- 1 คน → 1 ห้อง ต่อ program (participant ผูก program เดียวอยู่แล้ว)
CREATE UNIQUE INDEX IF NOT EXISTS uq_program_room_occ_participant
  ON program_room_occupants (participant_id);

-- ── SEATING (banquet tables / ผังห้องประชุม) ──
CREATE TABLE IF NOT EXISTS program_seating_tables (
  table_id    SERIAL PRIMARY KEY,
  program_id  INTEGER NOT NULL REFERENCES programs(program_id) ON DELETE CASCADE,
  table_name  TEXT NOT NULL,
  capacity    INTEGER NOT NULL DEFAULT 10,
  note        TEXT,
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE program_seating_tables ADD COLUMN IF NOT EXISTS capacity   INTEGER DEFAULT 10;
ALTER TABLE program_seating_tables ADD COLUMN IF NOT EXISTS note       TEXT;
ALTER TABLE program_seating_tables ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_program_seating_tables_program ON program_seating_tables (program_id, sort_order);

DROP TRIGGER IF EXISTS trg_program_seating_tables_updated ON program_seating_tables;
CREATE TRIGGER trg_program_seating_tables_updated BEFORE UPDATE ON program_seating_tables
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS program_seating_assignments (
  table_id       INTEGER NOT NULL REFERENCES program_seating_tables(table_id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES program_participants(participant_id) ON DELETE CASCADE,
  seat_no        INTEGER,
  PRIMARY KEY (table_id, participant_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_program_seat_participant
  ON program_seating_assignments (participant_id);

-- ── Permissions ──
UPDATE role_configs
SET permissions = (
  SELECT to_jsonb(array(
    SELECT DISTINCT unnest(
      array(SELECT jsonb_array_elements_text(permissions))
      || ARRAY[
        'program_room_view','program_room_create','program_room_edit','program_room_delete','program_room_assign',
        'program_seating_view','program_seating_create','program_seating_edit','program_seating_delete','program_seating_assign'
      ]
    )
  ))
)
WHERE role_key = 'ADMIN';

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅  Verify:
--   SELECT * FROM program_rooms WHERE program_id = 1;
--   SELECT * FROM program_seating_tables WHERE program_id = 1;
-- ============================================================
