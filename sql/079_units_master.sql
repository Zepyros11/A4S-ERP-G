-- =====================================================
-- 079_units_master.sql
-- Master units list — แทนการพิมพ์หน่วยซ้ำ ๆ ในแต่ละสินค้า
-- ลด typo ("ชิ้น" vs "ชิน") + dropdown ในฟอร์มเลือกได้เร็ว
-- =====================================================

-- 1) ตาราง master
CREATE TABLE IF NOT EXISTS units (
  unit_id    SERIAL PRIMARY KEY,
  unit_name  TEXT UNIQUE NOT NULL,
  is_active  BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2) seed หน่วยที่ใช้บ่อย
INSERT INTO units (unit_name) VALUES
  ('ชิ้น'),
  ('ตัว'),
  ('อัน'),
  ('แพ็ค'),
  ('โหล'),
  ('กล่อง'),
  ('ลัง'),
  ('คู่'),
  ('ขวด'),
  ('กระป๋อง'),
  ('ถุง'),
  ('ม้วน'),
  ('แผ่น'),
  ('เล่ม'),
  ('ชุด')
ON CONFLICT (unit_name) DO NOTHING;

-- 3) ผูก product_units กับ master (nullable เพื่อ backward compat)
ALTER TABLE product_units
  ADD COLUMN IF NOT EXISTS unit_id INT
  REFERENCES units(unit_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_product_units_unit_id
  ON product_units(unit_id) WHERE unit_id IS NOT NULL;

-- 4) backfill unit_id ของข้อมูลเดิม โดย match ชื่อ
UPDATE product_units pu
SET unit_id = u.unit_id
FROM units u
WHERE pu.unit_name = u.unit_name AND pu.unit_id IS NULL;
