-- ============================================================
-- Migration 130: trip_doc_letterheads — เนื้อหาหัวกระดาษแบบ custom (HTML)
--
-- Why:
--   เดิมหัวกระดาษมีแค่ company_name + address (layout ตายตัว)
--   ผู้ใช้ต้องการจัดเอง (ฟอนต์/สี/ตัวหนา/บรรทัด) → เก็บเป็น rich-text HTML
--
--   เพิ่ม content_html — เนื้อหาหัว (ขวาของโลโก้) เป็น HTML แก้ผ่าน RTE
--   front-end: ถ้ามี content_html ใช้เลย · ถ้า null fallback เป็น company_name+address
--
--   Backfill: แปลง row เดิม (company_name/address) → content_html อัตโนมัติ
--
-- ⚠️ ต้องรัน 129 ก่อน
-- Idempotent — รันซ้ำได้
-- ============================================================

ALTER TABLE trip_doc_letterheads
  ADD COLUMN IF NOT EXISTS content_html TEXT;

-- backfill จากข้อมูลเดิม (เฉพาะ row ที่ยังไม่มี content_html)
UPDATE trip_doc_letterheads
SET content_html =
  '<div style="font-weight:700;font-size:16px;color:#111">' || COALESCE(company_name, '') || '</div>' ||
  '<div style="font-size:12.5px;line-height:1.6;color:#222;white-space:pre-line">' || COALESCE(address, '') || '</div>'
WHERE content_html IS NULL
  AND (company_name IS NOT NULL OR address IS NOT NULL);

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅
-- Verify:
--   SELECT letterhead_id, name, left(content_html, 60) FROM trip_doc_letterheads;
-- ============================================================
