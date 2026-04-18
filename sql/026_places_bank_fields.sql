-- ============================================================
-- Migration 026: Bank + media fields for places
-- เพิ่มคอลัมน์ที่ฟอร์ม events-place-form.js ต้องใช้
--   • bank_*              → ข้อมูลบัญชีรับโอน
--   • image_urls          → JSONB {exterior:[], food:[]}
--   • cover_image_url     → รูปหน้ารายการ
--   • document_urls       → TEXT[] เอกสารแนบ
--   • bank_image_urls     → TEXT[] รูปบัญชี/QR
-- ============================================================

ALTER TABLE places
  ADD COLUMN IF NOT EXISTS bank_name         TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_name TEXT,
  ADD COLUMN IF NOT EXISTS bank_account_no   TEXT,
  ADD COLUMN IF NOT EXISTS bank_branch       TEXT,
  ADD COLUMN IF NOT EXISTS bank_note         TEXT,
  ADD COLUMN IF NOT EXISTS image_urls        JSONB,
  ADD COLUMN IF NOT EXISTS cover_image_url   TEXT,
  ADD COLUMN IF NOT EXISTS document_urls     TEXT[],
  ADD COLUMN IF NOT EXISTS bank_image_urls   TEXT[];

-- ============================================================
-- DONE ✅
-- ============================================================
