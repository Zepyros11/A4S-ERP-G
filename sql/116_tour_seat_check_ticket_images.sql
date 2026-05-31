-- ============================================================
-- Migration 116: เพิ่มคอลัมน์ ticket_image_urls ใน tour_seat_check
--
-- Why:
--   หน้า check-seat (trip) ต้องเก็บภาพ "ตั๋วเครื่องบิน" (ไป + กลับ)
--   อัปโหลดได้สูงสุด 5 ภาพต่อคน → เก็บเป็น array ของ public URL
--
--   เก็บเป็น jsonb (array of text) default '[]'
--   รูปอัปโหลดเข้า bucket 'tour-seat-images' path 'ticket/<code>_<ts>_<i>'
--
-- Idempotent — รันซ้ำได้
-- ============================================================

ALTER TABLE tour_seat_check
  ADD COLUMN IF NOT EXISTS ticket_image_urls jsonb NOT NULL DEFAULT '[]'::jsonb;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Verify:
--   SELECT column_name, data_type FROM information_schema.columns
--     WHERE table_name = 'tour_seat_check'
--       AND column_name = 'ticket_image_urls';
-- ============================================================
