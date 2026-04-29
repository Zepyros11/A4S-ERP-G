-- ============================================================
-- Migration 054: Add category column to line_groups
-- ============================================================
-- ใช้จัดหมวดหมู่กลุ่ม LINE — เช่น "ลูกค้า", "ทีมงาน", "ผู้บริหาร"
-- หน้า line-promote.html (modal จัดการกลุ่ม) จะแสดงเป็น sections
-- ============================================================

ALTER TABLE line_groups
  ADD COLUMN IF NOT EXISTS category TEXT;

CREATE INDEX IF NOT EXISTS idx_line_groups_category
  ON line_groups(category);

COMMENT ON COLUMN line_groups.category IS
  'หมวดหมู่กลุ่ม (เช่น "ลูกค้า", "ทีมงาน") — null = ไม่จัดหมวด';

-- Test:
--   SELECT category, COUNT(*) FROM line_groups GROUP BY category;
-- ============================================================
