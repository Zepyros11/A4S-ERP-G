-- ============================================================
-- ลบ submission ซ้ำ (โพสต์เดียวกันถูกบันทึก 2 ครั้ง)
--
-- Why:
--   Direk (participant_id=8) มี submission FB โพสต์เดียวกัน 2 row:
--     #8  likes 18 / comments 6  (orphan ซ้ำ)
--     #13 likes 30 / comments 0  (ตัวที่ UI แก้อยู่จริง — เก็บไว้)
--   ranking รวมยอดทั้งคู่ → likes 48 (ผิด, ควรเป็น 30)
--   bug ต้นเหตุแก้ที่ saveSub แล้ว (กันซ้ำด้วย participant + post_url)
--
-- ⚠️ DESTRUCTIVE — ลบ #8 → comments โพสต์นี้เหลือ 0 (กรอกเพิ่มทีหลังได้)
-- ============================================================

-- ── ตรวจก่อนลบ ──
-- SELECT submission_id, participant_id, platform, post_url, likes, comments
-- FROM campaign_submissions WHERE participant_id = 8 ORDER BY submitted_at;

DELETE FROM campaign_submissions WHERE submission_id = 8;

-- ── ตรวจหลังลบ (ควรเหลือ row เดียวต่อโพสต์) ──
-- SELECT submission_id, likes, comments FROM campaign_submissions WHERE participant_id = 8;

-- ============================================================
-- DONE ✅  รีเฟรชหน้า campaign-detail → Direk likes = 30
-- ============================================================
