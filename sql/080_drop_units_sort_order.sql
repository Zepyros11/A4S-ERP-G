-- =====================================================
-- 080_drop_units_sort_order.sql
-- ลบ column sort_order ของ units (ไม่ใช้แล้ว · เรียงตามชื่อแทน)
-- =====================================================

ALTER TABLE units DROP COLUMN IF EXISTS sort_order;
