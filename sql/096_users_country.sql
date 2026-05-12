-- ============================================================
-- Migration 096: users.country + ensure countries table exists
-- ใช้ countries ตาราง SHARED ร่วมกับ inventory/warehouses
-- (CRUD ในหน้า users และ warehouses-form แชร์ข้อมูลเดียวกัน)
-- users.country เก็บ country_code (TEXT, no FK เพื่อความยืดหยุ่น)
-- Idempotent — รันซ้ำได้ปลอดภัย
-- ============================================================

-- 1) ตาราง countries (ถ้ายังไม่มี — ปกติคลังสร้างไว้แล้ว)
CREATE TABLE IF NOT EXISTS countries (
  country_id    SERIAL PRIMARY KEY,
  country_code  TEXT UNIQUE NOT NULL,
  country_name  TEXT NOT NULL,
  sort_order    INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Defensive: เผื่อมี countries แต่ column ไม่ครบ
ALTER TABLE countries ADD COLUMN IF NOT EXISTS country_code  TEXT;
ALTER TABLE countries ADD COLUMN IF NOT EXISTS country_name  TEXT;
ALTER TABLE countries ADD COLUMN IF NOT EXISTS sort_order    INT DEFAULT 0;
ALTER TABLE countries ADD COLUMN IF NOT EXISTS created_at    TIMESTAMPTZ DEFAULT now();
ALTER TABLE countries ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ DEFAULT now();

DO $$ BEGIN
  ALTER TABLE countries ADD CONSTRAINT countries_country_code_key UNIQUE (country_code);
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table  THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_countries_sort
  ON countries (sort_order, country_code);

-- 2) เพิ่ม users.country (เก็บ country_code, no FK เพื่อทนการลบ/เปลี่ยน code)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS country TEXT;

CREATE INDEX IF NOT EXISTS idx_users_country
  ON users (country)
  WHERE country IS NOT NULL;

-- 3) Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅
-- Verify:
--   SELECT * FROM countries ORDER BY sort_order, country_name;
--   SELECT user_id, full_name, department, country FROM users;
-- ============================================================
