-- ============================================================
-- Migration 159: อนุญาตให้ 1 รหัส (member_code) ลงทะเบียนได้หลายครั้งต่อแคมเปญ
--
-- Why:
--   ฟอร์มลงทะเบียน public อาจต้องการให้คนเดิมกลับมาลงเพิ่ม
--   ช่องทาง Social ภายหลัง → เอา unique (campaign_id, member_code) ออก
--   (เดิมตั้งใน migration 149 = 1 สมาชิก/แคมเปญ)
--
--   ⚠️ ถ้าในอนาคตจะกลับมาบังคับ 1 รหัส/แคมเปญ ให้สร้าง index นี้ใหม่:
--      CREATE UNIQUE INDEX uq_campaign_participant
--        ON campaign_participants(campaign_id, member_code);
--
-- Idempotent — รันซ้ำได้
-- ============================================================

DROP INDEX IF EXISTS uq_campaign_participant;
