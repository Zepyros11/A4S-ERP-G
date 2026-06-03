-- ============================================================
-- Migration 126: Seed แม่แบบเอกสารตัวอย่าง + ผู้ลงนาม
--
-- Why:
--   ใส่แม่แบบ "หนังสือแสดงความยินดี (African Leaders Trip)" ตามฟอร์มจริง
--   ที่ใช้อยู่ + ผู้ลงนามตัวอย่าง — ให้เปิดหน้า "เอกสาร" แล้วลองได้ทันที
--
--   placeholder ที่ใช้:
--     {{วันที่}}          — วันที่ออกหนังสือ
--     {{คำนำหน้า}}        — Mr. / Ms. / Mrs.
--     {{ชื่อผู้รับ}}       — ชื่อ-สกุลผู้รับ
--     {{รหัสสมาชิก}}      — ID No.
--     {{ตำแหน่ง}}         — ตำแหน่งของผู้รับ
--     {{ช่วงวันเดินทาง}}  — กำหนดการเดินทาง
--
--   หัวกระดาษ A4S + บล็อกลายเซ็น เติมอัตโนมัติจาก front-end (ไม่อยู่ใน body)
--
-- ⚠️ ต้องรัน 124_trip_documents.sql ก่อน
-- Idempotent — insert เฉพาะเมื่อยังไม่มี (เช็คจาก name)
-- ============================================================

-- ── แม่แบบ: หนังสือแสดงความยินดี ─────────────────────────────
INSERT INTO trip_doc_templates (name, category, description, body)
SELECT
  'หนังสือแสดงความยินดี (African Leaders Trip)',
  'หนังสือราชการ',
  'จดหมายแสดงความยินดีผู้ผ่านคุณสมบัติร่วมทริป — กรอกชื่อ/ตำแหน่ง/วันเดินทาง',
  $body${{วันที่}}


Subject : Warm Congratulations on Your Qualification for the African Leaders Trip to Thailand
To: {{คำนำหน้า}} {{ชื่อผู้รับ}}
ID No. {{รหัสสมาชิก}}

Dear {{คำนำหน้า}} {{ชื่อผู้รับ}}

       On behalf of A4S Global, we are truly delighted and honored to extend our heartfelt congratulations to you. Your exceptional leadership, dedication, and outstanding contribution as a {{ตำแหน่ง}} have earned you a prestigious qualification for the A4S African Leaders Incentive Trip to Thailand,

   This milestone reflects not only your hard work and deep commitment to the A4S mission, but also the inspiring impact you bring to your entire team and to the A4S organization across Africa. We are extremely proud of your achievements and grateful for your leadership.

       The official trip is scheduled for {{ช่วงวันเดินทาง}} (further details will be announced soon). We sincerely look forward to welcoming you to Thailand and celebrating your success together as part of A4S the global family.

       Once again, congratulations on this outstanding accomplishment.  Your success is a reflection of true leadership, dedication, and the spirit of A4S. With our warmest regards and appreciation, A4S Global$body$
WHERE NOT EXISTS (
  SELECT 1 FROM trip_doc_templates
  WHERE name = 'หนังสือแสดงความยินดี (African Leaders Trip)'
);

-- ── ผู้ลงนามตัวอย่าง (ภาพลายเซ็นอัปโหลดผ่าน UI ภายหลัง) ──────
INSERT INTO trip_doc_signatories (name, title)
SELECT 'MUKDA PATTHARABANCHA', 'Chief Financial Officer'
WHERE NOT EXISTS (
  SELECT 1 FROM trip_doc_signatories WHERE name = 'MUKDA PATTHARABANCHA'
);

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅
-- Verify:
--   SELECT template_id, name, category FROM trip_doc_templates;
--   SELECT signatory_id, name, title  FROM trip_doc_signatories;
-- ============================================================
