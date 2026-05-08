-- =====================================================
-- 073_remove_sku_builder.sql
-- ลบระบบ SKU Builder ของ categories และล้างข้อมูล products เก่า
-- (ระบบเปลี่ยนเป็น auto-generate product_code: P-000001)
-- =====================================================

-- 1) ล้างข้อมูล (ใช้ DELETE เพื่อไม่ผิดกับ view เช่น stock_balance/stock_available)
-- TRUNCATE ไม่ได้เพราะ stock_balance เป็น view ไม่ใช่ table
DELETE FROM stock_movements;
DELETE FROM product_images;
DELETE FROM product_units;
DELETE FROM products;

-- รีเซ็ต identity sequence ของ products (ให้เริ่มจาก 1 ใหม่)
ALTER SEQUENCE IF EXISTS products_product_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS product_units_unit_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS product_images_image_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS stock_movements_movement_id_seq RESTART WITH 1;

-- 2) ลบ column sku_labels จาก categories
ALTER TABLE categories DROP COLUMN IF EXISTS sku_labels;
