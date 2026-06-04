-- ============================================================
-- Migration 133: trip_doc_letterheads — แนวตั้งโลโก้ (logo_valign)
--
-- Why:
--   จัดโลโก้ชิด บน/กลาง/ล่าง เทียบบล็อกข้อความ (เมื่อวางโลโก้ซ้าย/ขวา)
--   logo_valign — top | center | bottom  (→ align-items: flex-start/center/flex-end)
--
-- ⚠️ ต้องรัน 129 ก่อน
-- Idempotent — รันซ้ำได้
-- ============================================================

ALTER TABLE trip_doc_letterheads
  ADD COLUMN IF NOT EXISTS logo_valign TEXT DEFAULT 'top';

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅
-- Verify:
--   SELECT letterhead_id, name, logo_position, logo_valign FROM trip_doc_letterheads;
-- ============================================================
