-- ============================================================
-- Migration 032: 2-step verify for LINE linking
-- Flow:
--   1) User ส่ง member_code (digits) หรือ username (text)
--   2) Webhook สร้าง session → ขอรหัสผ่าน
--   3) User ส่งรหัสผ่าน → match กับ members.password / users.password (plaintext)
--   4) ผิด 3 ครั้ง → block 30 นาที
-- ============================================================

CREATE TABLE IF NOT EXISTS line_verify_sessions (
  line_user_id   TEXT PRIMARY KEY,
  pending_type   TEXT,               -- 'member' | 'staff' | null
  pending_id     TEXT,               -- member_code หรือ user_id
  attempts       INT DEFAULT 0,
  expires_at     TIMESTAMPTZ,        -- หมดอายุ session (5 นาที)
  blocked_until  TIMESTAMPTZ,        -- block เพราะลองผิดเยอะ
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lvs_expires ON line_verify_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_lvs_blocked ON line_verify_sessions(blocked_until);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION _lvs_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lvs_updated_at ON line_verify_sessions;
CREATE TRIGGER trg_lvs_updated_at
  BEFORE UPDATE ON line_verify_sessions
  FOR EACH ROW EXECUTE FUNCTION _lvs_touch_updated_at();

-- ============================================================
-- New templates for the 2-step verify flow
-- ============================================================
INSERT INTO line_reply_templates (key, text, description, placeholders) VALUES
  (
    'ask_password_member',
    '🔒 ขั้นตอนยืนยันตัวตน' || E'\n\n' ||
    'สวัสดี {name} (รหัส {code})' || E'\n' ||
    'กรุณาส่ง "รหัสผ่าน" ของคุณเพื่อยืนยัน' || E'\n\n' ||
    '⏱ หมดเวลาภายใน 5 นาที' || E'\n' ||
    '💬 พิมพ์ "ยกเลิก" เพื่อเลิกการยืนยัน',
    'ขอรหัสผ่านหลังสมาชิกส่ง member_code',
    ARRAY['{name}','{code}']
  ),
  (
    'ask_password_staff',
    '🔒 ขั้นตอนยืนยันตัวตน' || E'\n\n' ||
    'สวัสดี {name} ({username})' || E'\n' ||
    'กรุณาส่ง "รหัสผ่าน" ที่ใช้ login ERP เพื่อยืนยัน' || E'\n\n' ||
    '⏱ หมดเวลาภายใน 5 นาที' || E'\n' ||
    '💬 พิมพ์ "ยกเลิก" เพื่อเลิกการยืนยัน',
    'ขอรหัสผ่านหลังพนักงานส่ง username',
    ARRAY['{name}','{username}']
  ),
  (
    'wrong_password',
    '❌ รหัสผ่านไม่ถูกต้อง' || E'\n\n' ||
    'เหลือโอกาสอีก {attempts_left} ครั้ง' || E'\n' ||
    'กรุณาลองใหม่ หรือพิมพ์ "ยกเลิก" เพื่อเริ่มใหม่',
    'เมื่อส่งรหัสผ่านผิด',
    ARRAY['{attempts_left}']
  ),
  (
    'session_expired',
    '⏱ หมดเวลายืนยันแล้ว' || E'\n\n' ||
    'กรุณาส่ง รหัสสมาชิก / username ใหม่อีกครั้ง',
    'session 5 นาทีหมดอายุ',
    ARRAY[]::TEXT[]
  ),
  (
    'rate_limited',
    '🚫 ลองผิดหลายครั้งเกินไป' || E'\n\n' ||
    'กรุณารอ {minutes} นาที แล้วลองใหม่' || E'\n' ||
    'หากจำรหัสผ่านไม่ได้ ติดต่อแอดมิน',
    'block หลังผิด 3 ครั้ง',
    ARRAY['{minutes}']
  ),
  (
    'cancelled',
    '🔄 ยกเลิกการยืนยันเรียบร้อย' || E'\n' ||
    'ส่ง รหัสสมาชิก / username ใหม่เพื่อเริ่มอีกครั้ง',
    'user พิมพ์ "ยกเลิก"',
    ARRAY[]::TEXT[]
  ),
  (
    'no_password_set',
    '⚠️ บัญชีนี้ยังไม่ได้ตั้งรหัสผ่าน' || E'\n' ||
    'กรุณาติดต่อแอดมินเพื่อกำหนดรหัสผ่านก่อนผูก LINE',
    'เมื่อ password ว่างใน DB',
    ARRAY[]::TEXT[]
  )
ON CONFLICT (key) DO NOTHING;

-- Verify:
--   SELECT key, substring(text,1,50) FROM line_reply_templates ORDER BY key;
--   SELECT * FROM line_verify_sessions;
