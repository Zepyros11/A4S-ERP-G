-- ============================================================
-- Migration 129: trip_doc_letterheads — master หัวกระดาษ (letterhead)
--
-- Why:
--   เดิมหัวกระดาษ A4S hardcode ใน front-end · ผู้ใช้ต้องการแก้ข้อความได้เอง
--   (logo / ชื่อบริษัท / ที่อยู่) + มีหลายหัว เลือกต่อเอกสารได้ (เหมือนผู้ลงนาม)
--
--   trip_doc_letterheads — หัวกระดาษ (reusable, เลือกต่อเอกสาร)
--   trip_documents.letterhead_id — หัวกระดาษที่เอกสารฉบับนั้นใช้
--                                   (null = ใช้หัวเริ่มต้น = row แรก)
--
--   logo_data — base64 PNG (null = ใช้ logo A4S default ใน front-end)
--   address   — หลายบรรทัด (\n) · front-end จัด layout 2 คอลัมน์ ไม่ให้ทับ logo
--
-- ⚠️ ต้องรัน 124 ก่อน
-- Idempotent — รันซ้ำได้
-- ============================================================

CREATE TABLE IF NOT EXISTS trip_doc_letterheads (
  letterhead_id SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,            -- ป้ายไว้เลือก เช่น "A4S สำนักงานใหญ่"
  logo_data     TEXT,                     -- base64 PNG (null = default A4S)
  company_name  TEXT,
  address       TEXT,                     -- หลายบรรทัด (\n)
  created_by    INTEGER,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE trip_documents
  ADD COLUMN IF NOT EXISTS letterhead_id INTEGER
  REFERENCES trip_doc_letterheads(letterhead_id) ON DELETE SET NULL;

-- ── seed หัวกระดาษเริ่มต้น A4S (ถ้ายังไม่มีหัวใดเลย) ─────────
INSERT INTO trip_doc_letterheads (name, company_name, address)
SELECT
  'A4S Can Corporation (หลัก)',
  'A4S Can Corporation Co., Ltd.',
  E'Imperial World Ladprao 3rd Floor, Room AT 02-03, No. 2539 Khlong Chaokhun Sing,\nKhet Wang Thonglang, Bangkok 10310.  Tel: 092-326-4946  Email: A4Sservice@gmail.com'
WHERE NOT EXISTS (SELECT 1 FROM trip_doc_letterheads);

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅
-- Verify:
--   SELECT letterhead_id, name, company_name FROM trip_doc_letterheads;
-- ============================================================
