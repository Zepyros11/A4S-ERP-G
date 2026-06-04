-- ============================================================
-- Migration 132: trip_doc_letterheads — จัดวางโลโก้ (position/size)
--
-- Why:
--   ผู้ใช้ต้องการจัด layout โลโก้กับข้อความเอง
--   logo_position — left | right | top  (โลโก้ซ้าย/ขวา/บนกึ่งกลาง)
--   logo_width    — ความกว้างโลโก้ (px)
--
-- ⚠️ ต้องรัน 129 ก่อน
-- Idempotent — รันซ้ำได้
-- ============================================================

ALTER TABLE trip_doc_letterheads
  ADD COLUMN IF NOT EXISTS logo_position TEXT DEFAULT 'left';
ALTER TABLE trip_doc_letterheads
  ADD COLUMN IF NOT EXISTS logo_width INTEGER DEFAULT 120;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅
-- Verify:
--   SELECT letterhead_id, name, logo_position, logo_width FROM trip_doc_letterheads;
-- ============================================================
