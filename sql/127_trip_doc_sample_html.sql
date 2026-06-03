-- ============================================================
-- Migration 127: แปลง body แม่แบบตัวอย่างเป็น HTML (rich-text)
--
-- Why:
--   หน้า "เอกสาร" เปลี่ยนช่องเนื้อหาเป็น rich-text editor (เก็บเป็น HTML)
--   แม่แบบที่ seed ไว้ใน 126 เป็น plain text → พอ render เป็น HTML
--   newline/ช่องว่างหาย + จัดกึ่งกลาง/ตัวหนาไม่ได้
--
--   patch นี้ตั้ง body ใหม่เป็น HTML:
--     • วันที่ — จัดกึ่งกลาง + ตัวหนา
--     • "Subject :" — ตัวหนา
--     • ย่อหน้าเนื้อความ — เยื้องบรรทัดแรก (text-indent)
--
--   UPDATE by name → ใช้ได้ทั้ง install เดิม (อัปเดต row ที่มีอยู่)
--   และ fresh (รัน 126 ใส่ plain ก่อน แล้ว 127 อัปเดตเป็น HTML)
--
-- ⚠️ ต้องรัน 124 + 126 ก่อน
-- Idempotent — ตั้งค่าเดิมซ้ำได้
-- ============================================================

UPDATE trip_doc_templates
SET body = $body$<p style="text-align:center"><b>{{วันที่}}</b></p>
<p><br></p>
<p><b>Subject :</b> Warm Congratulations on Your Qualification for the African Leaders Trip to Thailand</p>
<p>To: {{คำนำหน้า}} {{ชื่อผู้รับ}}</p>
<p>ID No. {{รหัสสมาชิก}}</p>
<p><br></p>
<p>Dear {{คำนำหน้า}} {{ชื่อผู้รับ}}</p>
<p><br></p>
<p style="text-indent:2.5em">On behalf of A4S Global, we are truly delighted and honored to extend our heartfelt congratulations to you. Your exceptional leadership, dedication, and outstanding contribution as a {{ตำแหน่ง}} have earned you a prestigious qualification for the A4S African Leaders Incentive Trip to Thailand,</p>
<p style="text-indent:2.5em">This milestone reflects not only your hard work and deep commitment to the A4S mission, but also the inspiring impact you bring to your entire team and to the A4S organization across Africa. We are extremely proud of your achievements and grateful for your leadership.</p>
<p style="text-indent:2.5em">The official trip is scheduled for {{ช่วงวันเดินทาง}} (further details will be announced soon). We sincerely look forward to welcoming you to Thailand and celebrating your success together as part of A4S the global family.</p>
<p style="text-indent:2.5em">Once again, congratulations on this outstanding accomplishment. Your success is a reflection of true leadership, dedication, and the spirit of A4S. With our warmest regards and appreciation, A4S Global</p>$body$,
    updated_at = now()
WHERE name = 'หนังสือแสดงความยินดี (African Leaders Trip)';

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅
-- Verify:
--   SELECT name, left(body, 60) FROM trip_doc_templates
--   WHERE name = 'หนังสือแสดงความยินดี (African Leaders Trip)';
-- ============================================================
