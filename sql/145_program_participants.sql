-- ============================================================
-- Migration 145: program_participants (คนในแต่ละ program)
--
-- Why:
--   รวมจุดเด่นของ tour_seat_check (pax) + event_attendees (member+guest)
--   เป็นตารางเดียวต่อ program · เก็บ "สถานะเชิงปฏิบัติการต่อ program"
--   (paid/checked_in/tier/role) — ส่วนข้อมูลคนข้าม program
--   (ศาสนา/อาหารแพ้/passport) อยู่ที่ person_profiles (sql/146)
--
--   ops tables อนาคต (program_rooms ฯลฯ) จะ FK ที่ participant_id
--   = handle ต่อ program เทียบเท่า tour_seat_check.code
--
-- Idempotent — รันซ้ำได้ · ต้องรัน sql/144 ก่อน (FK → programs)
-- ============================================================

CREATE TABLE IF NOT EXISTS program_participants (
  participant_id SERIAL PRIMARY KEY,
  program_id     INTEGER NOT NULL REFERENCES programs(program_id) ON DELETE CASCADE,
  member_code    TEXT,                          -- nullable (guest) · soft link → members
  person_role    TEXT DEFAULT 'primary',        -- 'primary' | 'co_applicant' | 'guest'
  name           TEXT,                           -- snapshot ตอนเพิ่ม
  title_prefix   TEXT,
  gender         TEXT,                           -- 'male' | 'female' (canonical lowercase)
  paid           BOOLEAN DEFAULT FALSE,
  waive          BOOLEAN DEFAULT FALSE,
  checked_in     BOOLEAN DEFAULT FALSE,
  tier_id        INTEGER,                         -- soft link → event_ticket_tiers (event-style pricing)
  extra_fields   JSONB DEFAULT '{}'::jsonb,       -- per-program custom fields
  tags           TEXT[],
  note           TEXT,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE program_participants ADD COLUMN IF NOT EXISTS member_code  TEXT;
ALTER TABLE program_participants ADD COLUMN IF NOT EXISTS person_role  TEXT DEFAULT 'primary';
ALTER TABLE program_participants ADD COLUMN IF NOT EXISTS name         TEXT;
ALTER TABLE program_participants ADD COLUMN IF NOT EXISTS title_prefix TEXT;
ALTER TABLE program_participants ADD COLUMN IF NOT EXISTS gender       TEXT;
ALTER TABLE program_participants ADD COLUMN IF NOT EXISTS paid         BOOLEAN DEFAULT FALSE;
ALTER TABLE program_participants ADD COLUMN IF NOT EXISTS waive        BOOLEAN DEFAULT FALSE;
ALTER TABLE program_participants ADD COLUMN IF NOT EXISTS checked_in   BOOLEAN DEFAULT FALSE;
ALTER TABLE program_participants ADD COLUMN IF NOT EXISTS tier_id      INTEGER;
ALTER TABLE program_participants ADD COLUMN IF NOT EXISTS extra_fields JSONB DEFAULT '{}'::jsonb;
ALTER TABLE program_participants ADD COLUMN IF NOT EXISTS tags         TEXT[];
ALTER TABLE program_participants ADD COLUMN IF NOT EXISTS note         TEXT;
ALTER TABLE program_participants ADD COLUMN IF NOT EXISTS created_at   TIMESTAMPTZ DEFAULT now();
ALTER TABLE program_participants ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ DEFAULT now();

DO $$ BEGIN
  ALTER TABLE program_participants ADD CONSTRAINT program_participants_role_chk
    CHECK (person_role IN ('primary','co_applicant','guest'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_program_participants_program
  ON program_participants (program_id);
CREATE INDEX IF NOT EXISTS idx_program_participants_member
  ON program_participants (member_code);

-- 1 member 1 บทบาท ต่อ 1 program (guest = member_code NULL ซ้ำได้ — mirror sql/037)
CREATE UNIQUE INDEX IF NOT EXISTS uq_program_participant_member
  ON program_participants (program_id, member_code, person_role)
  WHERE member_code IS NOT NULL;

DROP TRIGGER IF EXISTS trg_program_participants_updated ON program_participants;
CREATE TRIGGER trg_program_participants_updated
  BEFORE UPDATE ON program_participants
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Permissions
UPDATE role_configs
SET permissions = (
  SELECT to_jsonb(array(
    SELECT DISTINCT unnest(
      array(SELECT jsonb_array_elements_text(permissions))
      || ARRAY[
        'program_participant_view',
        'program_participant_create',
        'program_participant_edit',
        'program_participant_delete'
      ]
    )
  ))
)
WHERE role_key = 'ADMIN';

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅  Verify:
--   SELECT participant_id, program_id, name, person_role
--     FROM program_participants WHERE program_id = 1;
-- ============================================================
