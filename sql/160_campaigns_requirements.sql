-- ============================================================
-- Migration 160: Campaign requirements (ข้อกำหนด Campaign)
--
-- Why:
--   เพิ่มหัวข้อ "ข้อกำหนด Campaign" ในฟอร์มสร้าง/แก้ไขแคมเปญ
--   เก็บได้ทั้ง "ภาพ" (สูงสุด 10 รูป) และ "ข้อความ" (textarea)
--   ใช้บอกรายละเอียด/ข้อกำหนดเชิงลึกของแคมเปญ แยกจาก
--   terms (เงื่อนไขการเข้าร่วม) และ description (รายละเอียดสั้น)
--
--   requirements_images = [{ "url": "...", "name": "..." }, ...]   (UI บังคับ ≤10)
--   requirements_text   = ข้อความอิสระ (AreaBox)
--
-- Idempotent — รันซ้ำได้
-- ============================================================

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS requirements_images JSONB DEFAULT '[]'::jsonb;

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS requirements_text TEXT;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅  Verify:
--   SELECT campaign_id, name, requirements_text, requirements_images FROM campaigns;
-- ============================================================
