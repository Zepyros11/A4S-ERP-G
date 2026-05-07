-- ============================================================
-- 072 — Member master key in app_settings
-- ------------------------------------------------------------
-- เก็บ master key สำหรับ decrypt password_encrypted + national_id_encrypted
-- ของสมาชิก ใน app_settings table
--
-- หน้า members-list.html จะดึง key นี้อัตโนมัติให้ user ที่มี perm
-- `member_decrypt` → set เข้า ERPCrypto → decrypt visible cells
--
-- ⚠️ หลังรัน migration แล้ว ต้อง UPDATE value เป็น master key จริง
--    (ตัวเดียวกับที่ใช้ตอน import members)
--
-- ⚠️ Threat model: anon key อ่าน app_settings ได้ — ระดับเดียวกับ
--    ตาราง members ที่ encrypted blob อยู่แล้ว (ระบบนี้ใช้ anon key
--    ทุก user) — ไม่ลด security จากเดิม
-- ============================================================

INSERT INTO app_settings (key, value, description)
VALUES (
  'member_master_key',
  'REPLACE_ME_WITH_REAL_KEY',
  'Master key สำหรับ AES decrypt password/national_id ของสมาชิก (ตัวเดียวกับตอน import)'
)
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- ขั้นต่อไป: รันคำสั่งด้านล่างนี้ เปลี่ยน 'YOUR_REAL_MASTER_KEY'
-- เป็น key ที่ใช้ตอน import (ดูใน DevTools localStorage:
-- key = "erp_master_key" บน browser ที่เคย import แล้ว)
-- ─────────────────────────────────────────────────────────────
--
--   UPDATE app_settings
--      SET value = 'YOUR_REAL_MASTER_KEY',
--          updated_at = NOW()
--    WHERE key = 'member_master_key';
--
-- ─────────────────────────────────────────────────────────────
