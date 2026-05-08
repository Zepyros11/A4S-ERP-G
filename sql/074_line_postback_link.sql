-- ============================================================
-- Migration 074: Keyword + postback-based LINE linking
--
-- เปลี่ยนจาก "พิมพ์รหัสสมาชิกตรงๆ → trigger flow" เป็น
-- "พิมพ์ 'ลงทะเบียน Line' (หรือกดปุ่ม rich menu) → bot ขอรหัสสมาชิก/username"
--
-- เหตุผล: เลขล้วน เช่น 555/5555/55555 ใช้แทนหัวเราะ ทำให้
--         bot เข้าโหมดผูกบัญชีโดยไม่ตั้งใจ + นับ failed attempt
--         จนโดน rate limit
--
-- Trigger keywords ที่รองรับ: "ลงทะเบียน Line", "ผูก Line" (case-insensitive)
--
-- พร้อมเพิ่ม noise filter ใน password mode (ไม่นับ "555"/"7777"/text สั้น
-- เป็น failed attempt)
-- ============================================================

-- ── อัปเดต welcome ให้แนะนำ keyword "ลงทะเบียน Line" ──
UPDATE line_reply_templates
SET text =
  'ยินดีต้อนรับสู่ A4S 🎉' || E'\n\n' ||
  '🔗 พิมพ์ "ลงทะเบียน Line" เพื่อเริ่มผูก LINE กับระบบ' || E'\n' ||
  '   (สมาชิก = รับแจ้งเตือน event / พนักงาน = แจ้งเตือนภายในองค์กร)',
    description = 'ข้อความต้อนรับเมื่อ user เพิ่ม OA เป็นเพื่อน (แนะนำพิมพ์ "ลงทะเบียน Line")',
    placeholders = ARRAY[]::TEXT[]
WHERE key = 'welcome';

-- ── เพิ่ม template ใหม่ ──
INSERT INTO line_reply_templates (key, text, description, placeholders) VALUES
  (
    'ask_id',
    '🔗 ผูกบัญชี LINE กับระบบ A4S' || E'\n\n' ||
    '📱 สมาชิก: พิมพ์ "รหัสสมาชิก" (ตัวเลข 5-6 หลัก)' || E'\n' ||
    '👤 พนักงาน: พิมพ์ "username" ของคุณ' || E'\n\n' ||
    'ตัวอย่าง: 10271 หรือ somchai' || E'\n' ||
    '⏱ หมดเวลาภายใน 5 นาที' || E'\n' ||
    '💬 พิมพ์ "ยกเลิก" เพื่อออก',
    'ขอรหัสสมาชิก/username หลังกดปุ่ม "ผูกบัญชี" บน rich menu',
    ARRAY[]::TEXT[]
  ),
  (
    'password_hint',
    '💡 ระบบรอ "รหัสผ่าน" เพื่อยืนยันตัวตน' || E'\n' ||
    'พิมพ์รหัสผ่านที่ใช้ login ERP' || E'\n' ||
    'หรือพิมพ์ "ยกเลิก" เพื่อออก',
    'แจ้งเตือนเมื่อ user พิมพ์ noise (เช่น "555") ในโหมดรอ password — ไม่นับ failed attempt',
    ARRAY[]::TEXT[]
  )
ON CONFLICT (key) DO UPDATE SET
  text         = EXCLUDED.text,
  description  = EXCLUDED.description,
  placeholders = EXCLUDED.placeholders;

-- Verify:
--   SELECT key, substring(text,1,60) FROM line_reply_templates
--    WHERE key IN ('welcome','ask_id','password_hint') ORDER BY key;
