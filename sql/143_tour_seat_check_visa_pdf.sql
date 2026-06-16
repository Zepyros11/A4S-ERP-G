-- ============================================================
-- Migration 143: เพิ่ม column ไฟล์วีซ่า (visa_pdf_url) ใน tour_seat_check
--
-- Why:
--   หน้า Check Seat (modules/trip/check-seat.html) เพิ่มคอลัมน์ "Visa"
--   ระหว่าง Pass. Exp. กับ Group สำหรับเก็บไฟล์ PDF วีซ่าของผู้เดินทาง
--   (drag & drop ไฟล์ PDF ในโหมดแก้ไข) เก็บเป็น public URL ใน
--   bucket `tour-seat-images` path `visa-pdf/<code>.pdf`
--
--   หมายเหตุ: คนละคอลัมน์กับ visa_image_url (= ช่อง "Slip" รูปสลิป/วีซ่า)
--
-- Idempotent — รันซ้ำได้
-- ============================================================

ALTER TABLE tour_seat_check
  ADD COLUMN IF NOT EXISTS visa_pdf_url TEXT;

-- Reload PostgREST cache
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Verify:
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'tour_seat_check' AND column_name = 'visa_pdf_url';
-- ============================================================
