-- ============================================================
-- Migration 138: backfill คำนำหน้าชื่อ (title_prefix) จากเพศ
--
-- Why:
--   หลังเพิ่มคอลัมน์ title_prefix (137) แถวเดิมยังว่าง
--   เติมค่าเริ่มต้นตามเพศ: ชาย → Mr. / หญิง → Mrs.
--   ใช้ left(gender,1) เพื่อรองรับทั้ง 'male'/'female' และค่าเก่า 'M'/'F'
--   เติมเฉพาะแถวที่ยังว่าง (ไม่ทับค่าที่กรอกเอง)
--
-- Idempotent — รันซ้ำได้ (จะไม่แตะแถวที่มีค่าแล้ว)
-- ============================================================

UPDATE tour_seat_check
SET title_prefix = CASE
  WHEN lower(left(gender, 1)) = 'm' THEN 'Mr.'
  WHEN lower(left(gender, 1)) = 'f' THEN 'Mrs.'
END
WHERE (title_prefix IS NULL OR title_prefix = '')
  AND gender IS NOT NULL AND gender <> '';
