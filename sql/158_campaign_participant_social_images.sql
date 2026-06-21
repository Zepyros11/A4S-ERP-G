-- ============================================================
-- Migration 158: Campaign registration — social proof images
--
-- Why:
--   ฟอร์มลงทะเบียน public แบบใหม่: ผู้ลงทะเบียนใส่ลิงก์โซเชียล
--   (Facebook/TikTok/Instagram) อย่างน้อย 1 ช่องทาง และช่องทางที่ใส่ลิงก์
--   ต้องแนบรูปภาพประกอบด้วย → เก็บ public URL ของรูปต่อช่องทาง
--
--   (URL columns มีอยู่แล้วจาก migration 149: facebook_url / tiktok_url / ig_url)
--
-- Idempotent — รันซ้ำได้
-- ============================================================

ALTER TABLE campaign_participants
  ADD COLUMN IF NOT EXISTS facebook_img TEXT,
  ADD COLUMN IF NOT EXISTS tiktok_img   TEXT,
  ADD COLUMN IF NOT EXISTS ig_img       TEXT;

-- ของรางวัลแยกตามช่องทาง + แยกอันดับ 1/2/3 (แทนคอลัมน์ reward เดิมตัวเดียว)
--   rewards = {
--     "facebook": ["รางวัลที่1","รางวัลที่2","รางวัลที่3"],
--     "tiktok":   [...],
--     "ig":       [...]
--   }
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS rewards JSONB DEFAULT '{}'::jsonb;

-- เงื่อนไขการเข้าร่วม (ข้อความหลายบรรทัด — 1 บรรทัด = 1 ข้อ) แสดงในหน้า public
ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS terms TEXT;
