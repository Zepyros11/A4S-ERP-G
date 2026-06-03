-- ============================================================
-- Migration 124: ระบบเอกสาร (Document Templates) สำหรับ TRIP
--
-- Why:
--   เมนูใหม่ "เอกสาร" ใน TRIP — รวบรวม + แก้ไขเอกสารต่างๆ จาก "แม่แบบ"
--   ไม่ผูกกับทริปใดทริปหนึ่ง (org-wide) ใช้ซ้ำได้
--
--   Flow:
--     1) สร้าง "แม่แบบ" (template) — เนื้อหามี placeholder {{ชื่อฟิลด์}}
--     2) "สร้างเอกสาร" จากแม่แบบ → กรอกค่า placeholder → ได้เอกสาร 1 ฉบับ
--     3) แก้ไข / พิมพ์ / export ได้
--
-- 3 ตาราง:
--   trip_doc_templates    — แม่แบบ (reusable)
--   trip_doc_signatories  — master ผู้ลงนาม (ชื่อ/ตำแหน่ง/ภาพลายเซ็น) reuse ได้
--   trip_documents        — เอกสารที่สร้างจากแม่แบบ (instance)
--
-- หัวกระดาษ (logo A4S + ที่อยู่บริษัท) = คงที่ใน front-end ไม่เก็บใน DB
--
-- Idempotent — รันซ้ำได้
-- ============================================================

-- ── แม่แบบเอกสาร ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trip_doc_templates (
  template_id SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,                          -- ชื่อแม่แบบ เช่น "หนังสือเชิญเดินทาง"
  category    TEXT,                                    -- หมวดหมู่ เช่น "หนังสือราชการ", "ภายใน"
  body        TEXT NOT NULL DEFAULT '',               -- เนื้อหา + placeholder {{ชื่อฟิลด์}}
  description TEXT,                                    -- คำอธิบายสั้นๆ
  created_by  INTEGER,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ── master ผู้ลงนาม ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trip_doc_signatories (
  signatory_id   SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,                         -- ชื่อ-สกุล เช่น "MUKDA PATTHARABANCHA"
  title          TEXT,                                  -- ตำแหน่ง เช่น "Chief Financial Officer"
  signature_data TEXT,                                  -- ภาพลายเซ็น (base64 data URL, PNG โปร่งใส)
  created_by     INTEGER,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

-- ── เอกสาร (instance จากแม่แบบ) ──────────────────────────────
CREATE TABLE IF NOT EXISTS trip_documents (
  doc_id       SERIAL PRIMARY KEY,
  template_id  INTEGER REFERENCES trip_doc_templates(template_id) ON DELETE SET NULL,
  signatory_id INTEGER REFERENCES trip_doc_signatories(signatory_id) ON DELETE SET NULL,
  title        TEXT NOT NULL,                          -- ชื่อเอกสารฉบับนี้
  status       TEXT NOT NULL DEFAULT 'DRAFT',          -- DRAFT | FINAL
  field_values JSONB NOT NULL DEFAULT '{}'::jsonb,     -- { "ชื่อฟิลด์": "ค่า" }
  body         TEXT NOT NULL DEFAULT '',               -- เนื้อหาที่ render แล้ว (แก้ต่อได้)
  created_by   INTEGER,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- เผื่อ trip_documents ถูกสร้างจาก rev ก่อน (ยังไม่มี signatory_id)
ALTER TABLE trip_documents
  ADD COLUMN IF NOT EXISTS signatory_id INTEGER REFERENCES trip_doc_signatories(signatory_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_trip_documents_template ON trip_documents(template_id);
CREATE INDEX IF NOT EXISTS idx_trip_documents_status   ON trip_documents(status);

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅
-- Verify:
--   SELECT * FROM trip_doc_templates;
--   SELECT * FROM trip_doc_signatories;
--   SELECT * FROM trip_documents;
-- ============================================================
