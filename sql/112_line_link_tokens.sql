-- ============================================================
-- Migration 112: One-time tokens สำหรับ LINE auto-link จาก register.html
--
-- Why:
--   เดิม user ต้องพิมพ์ "ลงทะเบียน Line" + ตอบรหัส + รหัสผ่านใน LINE chat
--   (3-4 ข้อความ) — slow + UX แย่ + password อยู่ใน chat history ถาวร
--
--   ใหม่: register.html verify password ฝั่ง server → ออก token หมดอายุ 10 นาที
--   → ฝัง token ใน oaMessage deep link → user แค่กด send → webhook ผูกอัตโนมัติ
--   (Password ไม่เคยโผล่ใน chat — token random ใช้ครั้งเดียว)
--
-- Security:
--   • token = random 32-byte hex (cryptographically secure)
--   • TTL 10 นาที (expires_at)
--   • used_at NOT NULL หลังผูก → ใช้ซ้ำไม่ได้
--   • member_code + source_table → รองรับทั้ง members + test_members
--
-- Idempotent — รันซ้ำได้
-- ============================================================

CREATE TABLE IF NOT EXISTS line_link_tokens (
  token          TEXT PRIMARY KEY,
  member_code    TEXT NOT NULL,
  source_table   TEXT NOT NULL DEFAULT 'members',   -- 'members' | 'test_members'
  expires_at     TIMESTAMPTZ NOT NULL,
  used_at        TIMESTAMPTZ,                       -- NULL = ยังไม่ใช้
  used_by_line_user_id TEXT,                        -- track ว่าใครใช้ token นี้
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_llt_expires ON line_link_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_llt_member  ON line_link_tokens(member_code);

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Cleanup expired tokens (run periodically via cron):
--   DELETE FROM line_link_tokens
--    WHERE created_at < now() - interval '1 day';
--
-- Verify:
--   SELECT COUNT(*) FROM line_link_tokens;
--   SELECT * FROM line_link_tokens ORDER BY created_at DESC LIMIT 5;
-- ============================================================
