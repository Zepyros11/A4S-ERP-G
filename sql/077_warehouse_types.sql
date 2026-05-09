-- =====================================================
-- 077_warehouse_types.sql
-- ตาราง warehouse_types — CRUD ประเภทคลัง (เดิม hardcoded 4 ค่า)
-- เก็บ type_code (เช่น MAIN/BRANCH) ที่ warehouses.warehouse_type อ้างอิง
-- =====================================================

CREATE TABLE IF NOT EXISTS warehouse_types (
  type_id     SERIAL PRIMARY KEY,
  type_code   TEXT UNIQUE NOT NULL,
  type_name   TEXT NOT NULL,
  icon        TEXT DEFAULT '📦',
  color       TEXT DEFAULT '#64748b',
  sort_order  INT  DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- seed 4 ประเภทเดิมจาก hardcoded
INSERT INTO warehouse_types (type_code, type_name, icon, color, sort_order) VALUES
  ('MAIN',    'คลังหลัก',      '🏣', '#0369a1', 1),
  ('BRANCH',  'คลังสาขา',      '🏪', '#15803d', 2),
  ('TRANSIT', 'จุดพักสินค้า',  '📦', '#c2410c', 3),
  ('RETURN',  'จุดคืนสินค้า',  '↩️', '#b91c1c', 4)
ON CONFLICT (type_code) DO NOTHING;
