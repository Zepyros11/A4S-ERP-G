-- ============================================================
-- Migration 151: program_tasks (เครื่องมือ "งาน Task/Gantt")
-- (เดิมเลข 149 — ย้ายเป็น 151 เพราะ 149 ชนกับ 149_campaigns.sql)
--
-- Why:
--   เครื่องมือแรกใน Operations Hub workspace — task list + gantt
--   ติดตามงานเตรียม trip/event · assign ผู้รับผิดชอบ + กำหนดวัน
--   เป็นอิสระ (ไม่ผูก participant) → ใช้ได้ทุก program (native + wrapper)
--   depends_on (INT[]) เก็บไว้สำหรับเส้น dependency ใน gantt อนาคต
--
-- Idempotent — รันซ้ำได้ · ต้องรัน sql/144 ก่อน (FK → programs)
-- ============================================================

CREATE TABLE IF NOT EXISTS program_tasks (
  task_id     SERIAL PRIMARY KEY,
  program_id  INTEGER NOT NULL REFERENCES programs(program_id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  assignee    TEXT,                  -- ชื่อ staff/ผู้รับผิดชอบ (MVP free text)
  start_date  DATE,
  due_date    DATE,
  status      TEXT DEFAULT 'TODO',   -- 'TODO' | 'DOING' | 'DONE'
  progress    INTEGER DEFAULT 0,     -- 0-100
  depends_on  INTEGER[],             -- task_id ที่ต้องเสร็จก่อน (gantt อนาคต)
  note        TEXT,
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE program_tasks ADD COLUMN IF NOT EXISTS assignee   TEXT;
ALTER TABLE program_tasks ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE program_tasks ADD COLUMN IF NOT EXISTS due_date   DATE;
ALTER TABLE program_tasks ADD COLUMN IF NOT EXISTS status     TEXT DEFAULT 'TODO';
ALTER TABLE program_tasks ADD COLUMN IF NOT EXISTS progress   INTEGER DEFAULT 0;
ALTER TABLE program_tasks ADD COLUMN IF NOT EXISTS depends_on INTEGER[];
ALTER TABLE program_tasks ADD COLUMN IF NOT EXISTS note       TEXT;
ALTER TABLE program_tasks ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
ALTER TABLE program_tasks ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE program_tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

DO $$ BEGIN
  ALTER TABLE program_tasks ADD CONSTRAINT program_tasks_status_chk
    CHECK (status IN ('TODO','DOING','DONE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_program_tasks_program
  ON program_tasks (program_id, sort_order);

DROP TRIGGER IF EXISTS trg_program_tasks_updated ON program_tasks;
CREATE TRIGGER trg_program_tasks_updated
  BEFORE UPDATE ON program_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

UPDATE role_configs
SET permissions = (
  SELECT to_jsonb(array(
    SELECT DISTINCT unnest(
      array(SELECT jsonb_array_elements_text(permissions))
      || ARRAY[
        'program_task_view',
        'program_task_create',
        'program_task_edit',
        'program_task_delete'
      ]
    )
  ))
)
WHERE role_key = 'ADMIN';

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅  Verify:
--   SELECT task_id, program_id, title, status, start_date, due_date
--     FROM program_tasks WHERE program_id = 1 ORDER BY sort_order;
-- ============================================================
