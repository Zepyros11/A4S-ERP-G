-- =====================================================
-- 076_drop_warehouse_icon.sql
-- ลบ column warehouse_icon ออกจาก warehouses
-- (ฟอร์มไม่ให้เลือก icon เองแล้ว · UI derive icon จาก warehouse_type
--  เช่น MAIN→🏣, BRANCH→🏪, TRANSIT→📦, RETURN→↩️)
-- =====================================================

ALTER TABLE warehouses DROP COLUMN IF EXISTS warehouse_icon;
