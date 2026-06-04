-- ============================================================
-- Migration 131: trip_doc_letterheads — หัวกระดาษเริ่มต้น (is_default)
--
-- Why:
--   เดิม "หัวเริ่มต้น" = row แรก (letterhead_id น้อยสุด) โดยปริยาย
--   ผู้ใช้ต้องการเลือกเองว่าหัวไหนเป็น default (เอกสารที่ไม่ได้เลือกหัว → ใช้อันนี้)
--
--   is_default BOOLEAN — มีได้ทีละ 1 (front-end เคลียร์ของอื่นตอนตั้ง)
--
-- ⚠️ ต้องรัน 129 ก่อน
-- Idempotent — รันซ้ำได้
-- ============================================================

ALTER TABLE trip_doc_letterheads
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT false;

-- ตั้ง row แรกเป็น default ถ้ายังไม่มี default เลย
UPDATE trip_doc_letterheads
SET is_default = true
WHERE letterhead_id = (SELECT letterhead_id FROM trip_doc_letterheads ORDER BY letterhead_id LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM trip_doc_letterheads WHERE is_default = true);

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅
-- Verify:
--   SELECT letterhead_id, name, is_default FROM trip_doc_letterheads ORDER BY letterhead_id;
-- ============================================================
