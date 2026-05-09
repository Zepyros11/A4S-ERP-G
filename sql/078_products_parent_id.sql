-- =====================================================
-- 078_products_parent_id.sql
-- เพิ่ม parent_product_id ให้ products รองรับโครงสร้าง parent + variants
-- (สินค้าชุด = 1 parent + N variants · ลบ parent = ลบ variants ตาม cascade)
-- =====================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS parent_product_id INT
  REFERENCES products(product_id) ON DELETE CASCADE;

-- index สำหรับ query หา children เร็ว ๆ
CREATE INDEX IF NOT EXISTS idx_products_parent_product_id
  ON products(parent_product_id)
  WHERE parent_product_id IS NOT NULL;

-- กัน loop (parent ของตัวเอง)
ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_no_self_parent;
ALTER TABLE products
  ADD CONSTRAINT products_no_self_parent
  CHECK (parent_product_id IS NULL OR parent_product_id <> product_id);
