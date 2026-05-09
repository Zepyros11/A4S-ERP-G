-- =====================================================
-- 081_fix_product_units_master_ref.sql
-- แก้ปัญหา: 079 ตั้งใจเพิ่ม FK ไปยัง units master ผ่านชื่อ unit_id
-- แต่ product_units.unit_id เป็น SERIAL PK อยู่แล้ว → ADD COLUMN IF NOT EXISTS skip
-- ทำให้ JS ที่ส่ง unit_id = master_unit_id ไปทับ PK → duplicate key violation
--
-- วิธีแก้: ใช้คอลัมน์ใหม่ master_unit_id (ไม่ rename PK เพื่อไม่กระทบ
-- FK ของ po_items/requisition_items/so_items ที่อ้างถึง product_units.unit_id)
-- =====================================================

-- 1) ลบ index/constraint ที่ 079 พยายามสร้าง (ถ้าเผลอติดมา)
DROP INDEX IF EXISTS idx_product_units_unit_id;

-- 2) เพิ่มคอลัมน์ใหม่ master_unit_id อ้างอิง units master
ALTER TABLE product_units
  ADD COLUMN IF NOT EXISTS master_unit_id INT
  REFERENCES units(unit_id) ON DELETE SET NULL;

-- 3) backfill จาก unit_name → master_unit_id
UPDATE product_units pu
SET master_unit_id = u.unit_id
FROM units u
WHERE pu.unit_name = u.unit_name AND pu.master_unit_id IS NULL;

-- 4) สร้าง index ใหม่บน master_unit_id
CREATE INDEX IF NOT EXISTS idx_product_units_master_unit_id
  ON product_units(master_unit_id) WHERE master_unit_id IS NOT NULL;
