-- ============================================================
-- Migration 115: nationalities master table (CRUD-able)
--
-- Why:
--   user ต้องการเพิ่ม/แก้ไข/ลบสัญชาติเองได้จากหน้า Check Seat
--   (เดิม hardcoded ใน NATIONALITY_OPTIONS) — ใช้ pattern in-context
--   CRUD เหมือน member_types/departments
--
-- Schema:
--   nationalities (global, shared)
--   - id          BIGSERIAL PK
--   - name        TEXT UNIQUE NOT NULL  (ค่าที่เก็บใน tour_seat_check.nationality)
--   - sort_order  INT DEFAULT 999       (น้อย = บน)
--
-- Idempotent — รันซ้ำได้
-- ============================================================

CREATE TABLE IF NOT EXISTS nationalities (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  sort_order  INT DEFAULT 999,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_nationalities_sort
  ON nationalities (sort_order, name);

-- Seed defaults (idempotent — ON CONFLICT DO NOTHING)
INSERT INTO nationalities (name, sort_order) VALUES
  ('Beninese',    1),
  ('Burkinabé',   2),
  ('Cameroonian', 3),
  ('France',      4),
  ('Ghanaian',    5),
  ('Ivoirienne',  6),
  ('Nigerian',    7),
  ('Togolese',    8)
ON CONFLICT (name) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE
-- Verify:
--   SELECT id, name, sort_order FROM nationalities ORDER BY sort_order, name;
-- ============================================================
