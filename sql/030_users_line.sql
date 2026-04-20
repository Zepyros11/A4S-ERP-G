-- ============================================================
-- Migration 030: LINE integration for staff users
-- Architecture:
--   users.line_user_id            — CURRENT/PRIMARY active LINE account ของพนักงาน
--   webhook: พนักงานพิมพ์ username ในแชท Bot → ผูกกับ users.user_id
-- ส่งข้อความ → ใช้ users.line_user_id โดยตรง
-- ============================================================

-- 1) เพิ่ม LINE columns ใน users
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS line_user_id       TEXT,
  ADD COLUMN IF NOT EXISTS line_display_name  TEXT,
  ADD COLUMN IF NOT EXISTS line_picture_url   TEXT,
  ADD COLUMN IF NOT EXISTS line_linked_at     TIMESTAMPTZ;

-- 2) Unique: หนึ่ง LINE account ผูกได้ 1 user (ป้องกันชน member_code กับ username ที่ account เดียวกัน)
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_line_user_id
  ON users(line_user_id)
  WHERE line_user_id IS NOT NULL;

-- 3) Index สำหรับ lookup ด้วย username (webhook)
CREATE INDEX IF NOT EXISTS idx_users_username_lower
  ON users(LOWER(username));

-- ============================================================
-- DONE ✅
-- Verify:
--   SELECT user_id, username, line_user_id, line_display_name
--   FROM users WHERE line_user_id IS NOT NULL;
-- ============================================================
