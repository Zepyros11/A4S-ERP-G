-- =====================================================
-- 075_drop_category_description.sql
-- ลบ column description ออกจาก categories
-- (ฟอร์มเพิ่ม/แก้ไขหมวดหมู่ไม่ใช้ field นี้แล้ว)
-- =====================================================

ALTER TABLE categories DROP COLUMN IF EXISTS description;
