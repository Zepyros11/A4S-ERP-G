-- =====================================================
-- 082_products_disable_stock_alert.sql
-- เพิ่ม flag ปิดการแจ้งเตือน "สินค้าหมด/ใกล้หมด" รายตัวสินค้า
-- ใช้กับ stock-dashboard และหน้า dashboard หลัก
--   true  = ไม่แจ้งเตือน (สินค้าที่ไม่ได้สต๊อกประจำ/เฉพาะกิจ)
--   false = แจ้งเตือนปกติ (default)
-- =====================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS disable_stock_alert BOOLEAN NOT NULL DEFAULT FALSE;
