-- ============================================================
-- ล้างยอด/ผลงานทดสอบ (campaign_submissions)
--
-- Why:
--   ค่าในคอลัมน์ "ผลงาน" (หน้าผู้เข้าร่วม) และตัวเลขในหน้า "อันดับ"
--   ดึงมาจากตาราง campaign_submissions (ยอดที่กรอกผ่านฟอร์ม "กรอกยอด")
--   เอาแท็บ "ผลงาน" ออกจาก UI แล้ว แต่ข้อมูลทดสอบยังค้างใน DB
--   ลบ row ในตารางนี้ → ผลงาน = 0 และอันดับว่าง
--
-- ⚠️ DESTRUCTIVE — ลบแล้วกู้ไม่ได้ · ตรวจ campaign ให้ตรงก่อนรัน
-- ============================================================

-- ── ตรวจก่อนลบ: มีกี่ row ต่อแคมเปญ ──
-- SELECT s.campaign_id, c.name, COUNT(*) AS n
-- FROM campaign_submissions s
-- JOIN campaigns c ON c.campaign_id = s.campaign_id
-- GROUP BY s.campaign_id, c.name;

-- ── (A) ล้างเฉพาะแคมเปญเดียว — แก้ชื่อให้ตรง ──
-- DELETE FROM campaign_submissions
-- WHERE campaign_id IN (
--   SELECT campaign_id FROM campaigns WHERE name ILIKE '%4 Body%'
-- );

-- ── (B) ล้างยอดทดสอบทั้งหมดทุกแคมเปญ ◀ ใช้ตัวนี้ ──
DELETE FROM campaign_submissions;

-- ── ตรวจหลังลบ (ควรได้ 0) ──
-- SELECT COUNT(*) FROM campaign_submissions;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅  รีเฟรชหน้า campaign-detail → ผลงาน = 0, อันดับว่าง
-- ============================================================
