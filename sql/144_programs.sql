-- ============================================================
-- Migration 144: ตาราง programs (Operations Hub — container กลาง)
--
-- Why:
--   หน้าใหม่ "Operations Hub" (modules/operations/operations-hub.html)
--   รวม trip + event เป็นโมเดลเดียว program_type = TRIP|EVENT
--   กลยุทธ์ forward-only: ของเก่า (trips/events/tour_seat_check/
--   event_attendees) ไม่แตะ ไม่ migrate — ของใหม่ที่สร้างจาก hub
--   ลงตารางนี้ · เก่า/ใหม่อยู่ร่วมกันในหน้าเดียว
--
-- Idempotent — รันซ้ำได้
-- ============================================================

CREATE TABLE IF NOT EXISTS programs (
  program_id    SERIAL PRIMARY KEY,
  program_type  TEXT NOT NULL DEFAULT 'TRIP',   -- 'TRIP' | 'EVENT'
  name          TEXT NOT NULL,
  code          TEXT,                            -- เลขอ้างอิงที่อ่านได้ (optional)
  start_date    DATE,
  end_date      DATE,
  place_id      INTEGER,                         -- soft link → places (ไม่ FK แข็ง — รองรับลบ place ได้อิสระ)
  status        TEXT DEFAULT 'ACTIVE',           -- 'ACTIVE' | 'DONE' | 'CANCELLED'
  enabled_tools JSONB DEFAULT '[]'::jsonb,       -- capability flags เช่น ["rooming","seating"]
  config        JSONB DEFAULT '{}'::jsonb,       -- per-program settings (อนาคต)
  description   TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE programs ADD COLUMN IF NOT EXISTS program_type  TEXT NOT NULL DEFAULT 'TRIP';
ALTER TABLE programs ADD COLUMN IF NOT EXISTS code          TEXT;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS start_date    DATE;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS end_date      DATE;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS place_id      INTEGER;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS status        TEXT DEFAULT 'ACTIVE';
ALTER TABLE programs ADD COLUMN IF NOT EXISTS enabled_tools JSONB DEFAULT '[]'::jsonb;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS config        JSONB DEFAULT '{}'::jsonb;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS description   TEXT;
ALTER TABLE programs ADD COLUMN IF NOT EXISTS created_at    TIMESTAMPTZ DEFAULT now();
ALTER TABLE programs ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ DEFAULT now();

-- CHECK constraints (idempotent ผ่าน DO/EXCEPTION)
DO $$ BEGIN
  ALTER TABLE programs ADD CONSTRAINT programs_type_chk
    CHECK (program_type IN ('TRIP','EVENT'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE programs ADD CONSTRAINT programs_status_chk
    CHECK (status IN ('ACTIVE','DONE','CANCELLED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_programs_type_status
  ON programs (program_type, status, start_date DESC);

-- auto-update updated_at (ใช้ set_updated_at() จาก sql/001)
DROP TRIGGER IF EXISTS trg_programs_updated ON programs;
CREATE TRIGGER trg_programs_updated
  BEFORE UPDATE ON programs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Permissions (umbrella program_* — per-tool perm จะเพิ่มตอน tool นั้นๆ ออก)
UPDATE role_configs
SET permissions = (
  SELECT to_jsonb(array(
    SELECT DISTINCT unnest(
      array(SELECT jsonb_array_elements_text(permissions))
      || ARRAY[
        'program_view',
        'program_create',
        'program_edit',
        'program_delete'
      ]
    )
  ))
)
WHERE role_key = 'ADMIN';

-- Reload PostgREST cache
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅  Verify:
--   SELECT program_id, program_type, name, status, enabled_tools FROM programs;
--   SELECT permissions FROM role_configs WHERE role_key='ADMIN';
-- ============================================================
