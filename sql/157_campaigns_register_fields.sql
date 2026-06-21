-- ============================================================
-- Migration 157: Campaign custom registration form fields
--
-- Why:
--   ให้ staff กำหนดฟอร์มข้อมูลลงทะเบียนของแต่ละ campaign ได้เอง
--   (ฟิลด์แบบ ข้อความ / checkbox / radio) แทนการ hardcode
--
--   register_fields = [
--     { "id": "f1", "type": "text|checkbox|radio",
--       "label": "คำถาม", "required": true,
--       "options": ["ตัวเลือก A","ตัวเลือก B"]   -- เฉพาะ checkbox/radio
--     }, ...
--   ]
--
-- Idempotent — รันซ้ำได้
-- ============================================================

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS register_fields JSONB DEFAULT '[]'::jsonb;

-- คำตอบของผู้ลงทะเบียนต่อ custom fields ด้านบน
--   custom_answers = { "<field id>": "ข้อความ/ตัวเลือก"  | ["ตัวเลือก A","ตัวเลือก B"] }
ALTER TABLE campaign_participants
  ADD COLUMN IF NOT EXISTS custom_answers JSONB DEFAULT '{}'::jsonb;

-- หน้าลงทะเบียน public เปลี่ยนเป็น "ฟอร์มกรอกข้อมูล" ไม่ต้อง login (ไม่มี member_code)
-- → member_code ต้องเป็น nullable (unique index (campaign_id, member_code) ยังคงอยู่ได้
--   เพราะ Postgres ถือว่า NULL ต่างกันเสมอ — ลงได้หลายแถว)
ALTER TABLE campaign_participants
  ALTER COLUMN member_code DROP NOT NULL;
