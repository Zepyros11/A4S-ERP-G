-- ============================================================
-- Migration 137: เพิ่ม column คำนำหน้าชื่อ (title_prefix) ใน tour_seat_check
--
-- Why:
--   หน้า Pax Detail (modules/trip/pax-detail.html) ต้องการคอลัมน์
--   "คำนำหน้าชื่อ" เป็น dropdown (Mr./Mrs./Dr./นาย/นาง/...)
--   เก็บแยกจาก name เพื่อใช้ทำเอกสาร/จดหมาย/ป้ายชื่อ ได้สะอาดขึ้น
--
-- Idempotent — รันซ้ำได้
-- ============================================================

ALTER TABLE tour_seat_check
  ADD COLUMN IF NOT EXISTS title_prefix TEXT;

-- Reload PostgREST cache
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Verify:
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'tour_seat_check' AND column_name = 'title_prefix';
-- ============================================================
