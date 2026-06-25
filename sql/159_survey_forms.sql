-- ============================================================
-- Migration 159: Event Satisfaction Survey Forms
--
-- Why:
--   เครื่องมือใหม่ในกลุ่ม Event — สร้าง "แบบประเมินความพอใจ" เก็บเป็น
--   list (reusable) แล้วแต่ละ event เลือกผูกฟอร์มผ่าน dropdown ในหน้า
--   แก้ไข event (events.survey_form_id) · ผู้เข้าร่วมตอบผ่าน public link/QR
--   (ไม่ต้อง login — เหมือน campaign-register / ticket portal)
--
--   2 ตาราง + 1 FK:
--     survey_forms      — ตัวฟอร์ม (master list) · questions เก็บใน JSONB
--     survey_responses  — คำตอบ 1 คน = 1 แถว · answers JSONB {question_id: value}
--     events.survey_form_id (FK ON DELETE SET NULL) — link form ↔ event
--
--   questions JSONB = array ของ:
--     { id, type, label, required, options[], scale_max, scale_min_label, scale_max_label }
--     type: 'rating' | 'choice' | 'multichoice' | 'text' | 'textarea' | 'number'
--
--   public_token = ลิงก์สาธารณะ (privacy = token เดาไม่ได้ เหมือน campaigns)
--   ไม่เปิด RLS — สอดคล้องกับตารางอื่นที่ anon เข้าถึงได้ (campaigns/events)
--
-- Idempotent — รันซ้ำได้
-- ============================================================

-- ── 1. survey_forms (master list) ───────────────────────────
CREATE TABLE IF NOT EXISTS survey_forms (
  id              BIGSERIAL PRIMARY KEY,
  title           TEXT NOT NULL,
  description     TEXT,
  intro_text      TEXT,                       -- ข้อความเกริ่นนำหัวฟอร์ม (optional)
  thank_you_text  TEXT DEFAULT 'ขอบคุณสำหรับความคิดเห็นของท่านค่ะ 🙏',
  questions       JSONB NOT NULL DEFAULT '[]'::jsonb,
  public_token    TEXT UNIQUE,
  is_active       BOOLEAN DEFAULT true,
  created_by      TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_survey_forms_active
  ON survey_forms (is_active, id);

-- ── 2. survey_responses ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS survey_responses (
  id              BIGSERIAL PRIMARY KEY,
  form_id         BIGINT NOT NULL REFERENCES survey_forms(id) ON DELETE CASCADE,
  event_id        BIGINT REFERENCES events(event_id) ON DELETE SET NULL,
  answers         JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { question_id: value }
  respondent_name TEXT,
  submitted_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_survey_responses_form  ON survey_responses (form_id);
CREATE INDEX IF NOT EXISTS idx_survey_responses_event ON survey_responses (event_id);

-- ── 3. events.survey_form_id (FK link) ──────────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS survey_form_id BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'events_survey_form_fk'
  ) THEN
    ALTER TABLE events
      ADD CONSTRAINT events_survey_form_fk
      FOREIGN KEY (survey_form_id) REFERENCES survey_forms(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_events_survey_form_id
  ON events (survey_form_id) WHERE survey_form_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅  Verify:
--   SELECT id, title, public_token, is_active,
--          jsonb_array_length(questions) AS q_count
--     FROM survey_forms ORDER BY id;
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'events' AND column_name = 'survey_form_id';
-- ============================================================
