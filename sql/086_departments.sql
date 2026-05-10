-- ============================================================
-- Migration 086: ตาราง departments — CRUD รายชื่อแผนก
-- users.department เก็บ dept_code (TEXT, no FK เพื่อความยืดหยุ่น)
-- Idempotent — รันซ้ำได้ปลอดภัย แม้ตารางเดิมจะมีโครงสร้างไม่ครบ
-- ============================================================

-- 1) สร้างตาราง (ถ้ายังไม่มี)
CREATE TABLE IF NOT EXISTS departments (
  dept_id     SERIAL PRIMARY KEY,
  dept_code   TEXT UNIQUE NOT NULL,
  dept_name   TEXT NOT NULL,
  sort_order  INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- 2) Defensive: เผื่อมีตาราง departments อยู่ก่อนแล้วแต่ column ไม่ครบ
ALTER TABLE departments ADD COLUMN IF NOT EXISTS dept_code   TEXT;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS dept_name   TEXT;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS sort_order  INT DEFAULT 0;
ALTER TABLE departments ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ DEFAULT now();
ALTER TABLE departments ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ DEFAULT now();

-- 3) Unique constraint บน dept_code (เผื่อสร้างคอลัมน์ใหม่จาก ALTER ข้างบน — ยังไม่มี unique)
DO $$ BEGIN
  ALTER TABLE departments ADD CONSTRAINT departments_dept_code_key UNIQUE (dept_code);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table  THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_departments_sort
  ON departments (sort_order, dept_code);

-- 4) seed แผนกที่เห็นในระบบปัจจุบัน (อ้างจาก role_configs prefix)
INSERT INTO departments (dept_code, dept_name, sort_order) VALUES
  ('A4S',   'A4S',           1),
  ('BRE',   'BRE',           2),
  ('IBD',   'IBD',           3),
  ('CS',    'CS',            4),
  ('ADMIN', 'Admin',         5),
  ('SALES', 'ฝ่ายขาย',       6),
  ('ACC',   'บัญชี',         7)
ON CONFLICT (dept_code) DO NOTHING;

-- 5) Reload PostgREST schema cache (สำคัญ — กัน "Could not find column ... in schema cache")
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅
-- Verify:
--   SELECT * FROM departments ORDER BY sort_order;
--
-- ถ้ายังเจอ schema cache error หลังรัน:
--   - รอ ~10 วิ ให้ PostgREST รับ NOTIFY
--   - หรือไปที่ Supabase Dashboard → API → Reload schema
-- ============================================================
