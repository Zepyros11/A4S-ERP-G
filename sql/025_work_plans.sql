-- ============================================================
-- 025: Work Planning module
-- ตารางวางแผนงานแบบ spreadsheet (ข้อ/เวลา/นาที/รายละเอียด/ผู้รับผิดชอบ/สถานที่)
-- แยกตาม scope: event | cs | trip  และ แผนก (category) + ปี
-- ============================================================

-- ── 1. Department/Category ภายในแต่ละ scope ─────────────────
CREATE TABLE IF NOT EXISTS work_departments (
  id          BIGSERIAL PRIMARY KEY,
  scope       TEXT NOT NULL CHECK (scope IN ('event','cs','trip')),
  name        TEXT NOT NULL,
  color       TEXT DEFAULT '#4a90e2',
  sort_order  INT  DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (scope, name)
);
CREATE INDEX IF NOT EXISTS idx_work_dept_scope ON work_departments(scope);

-- ── 2. แผนงานหลัก (1 row = 1 ตารางแบบในภาพ SUMMIT) ─────────
CREATE TABLE IF NOT EXISTS work_plans (
  id           BIGSERIAL PRIMARY KEY,
  scope        TEXT NOT NULL CHECK (scope IN ('event','cs','trip')),
  dept_id      BIGINT REFERENCES work_departments(id) ON DELETE SET NULL,
  year         INT  NOT NULL,
  plan_name    TEXT NOT NULL,
  event_start  DATE,
  event_end    DATE,                 -- 1-3 วัน (optional)
  location     TEXT,
  note         TEXT,
  columns      JSONB NOT NULL DEFAULT '[
    {"key":"time","label":"เวลา","type":"text","width":130},
    {"key":"minutes","label":"นาที","type":"number","width":70},
    {"key":"detail","label":"รายละเอียด","type":"text","width":320},
    {"key":"location","label":"สถานที่","type":"text","width":160}
  ]'::jsonb,
  created_by   INT,                   -- users.user_id
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_work_plans_scope_year ON work_plans(scope, year);
CREATE INDEX IF NOT EXISTS idx_work_plans_dept       ON work_plans(dept_id);

-- ── 3. แถวงานในแผน ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_plan_rows (
  id             BIGSERIAL PRIMARY KEY,
  plan_id        BIGINT NOT NULL REFERENCES work_plans(id) ON DELETE CASCADE,
  event_day      INT DEFAULT 1,                    -- วันที่ 1/2/3
  row_order      INT DEFAULT 0,
  data           JSONB NOT NULL DEFAULT '{}'::jsonb, -- ค่าในแต่ละ custom column
  owner_user_id  INT,                              -- ผู้รับผิดชอบหลัก (users.user_id)
  helper_user_ids INT[] DEFAULT '{}',              -- ผู้ช่วย
  notified_at    TIMESTAMPTZ,                      -- สำหรับ noti ทีหลัง
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_work_rows_plan  ON work_plan_rows(plan_id, event_day, row_order);
CREATE INDEX IF NOT EXISTS idx_work_rows_owner ON work_plan_rows(owner_user_id);

-- ── 4. Triggers (updated_at auto) ───────────────────────────
DROP TRIGGER IF EXISTS trg_work_plans_updated ON work_plans;
CREATE TRIGGER trg_work_plans_updated
  BEFORE UPDATE ON work_plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_work_plan_rows_updated ON work_plan_rows;
CREATE TRIGGER trg_work_plan_rows_updated
  BEFORE UPDATE ON work_plan_rows
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── 5. Seed: แผนกเริ่มต้น ──────────────────────────────────
INSERT INTO work_departments (scope, name, color, sort_order) VALUES
  ('event', 'ทีมงานหลัก',       '#1e40af', 1),
  ('event', 'ทีมสื่อ/มีเดีย',   '#7c3aed', 2),
  ('event', 'ทีมอาหาร/สถานที่', '#059669', 3),
  ('cs',    'ทีม CS',            '#0ea5e9', 1),
  ('trip',  'ทีมนำเที่ยว',      '#ea580c', 1)
ON CONFLICT (scope, name) DO NOTHING;
