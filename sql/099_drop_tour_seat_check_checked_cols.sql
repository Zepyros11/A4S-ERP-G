-- ============================================================
-- Migration 099: Drop checked_by + checked from tour_seat_check
--
-- Why:
--   ลองเพิ่ม UI 2 column (Checked By / Checked) แล้วผู้ใช้ไม่ต้องการ
--   จึงลบ UI + ต้อง drop column ใน DB ด้วยเพื่อกัน schema drift
--
-- หมายเหตุ:
--   • ถ้ามีข้อมูลใน 2 column นี้แล้วจะหายถาวร (ผู้ใช้รับทราบแล้ว)
--   • IF EXISTS — รันซ้ำได้ ไม่ error ถ้า column ไม่มีอยู่
-- ============================================================

ALTER TABLE tour_seat_check
  DROP COLUMN IF EXISTS checked_by,
  DROP COLUMN IF EXISTS checked;

-- ============================================================
-- Test:
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'tour_seat_check'
--     AND column_name IN ('checked_by', 'checked');
--   -- ควรคืน 0 rows
-- ============================================================
