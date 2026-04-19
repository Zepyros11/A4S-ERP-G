-- ============================================================
-- Migration 028: Multi-LINE-account per member
-- Architecture:
--   members.line_user_id           — CURRENT/PRIMARY active LINE account
--   member_line_accounts (new)     — HISTORY ของทุก account ที่ member เคย login
-- ส่งข้อความ → ใช้ members.line_user_id (ตัวล่าสุดที่ active)
-- ============================================================

-- 1) เพิ่ม current/primary LINE account ใน members
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS line_user_id       TEXT,
  ADD COLUMN IF NOT EXISTS line_display_name  TEXT,
  ADD COLUMN IF NOT EXISTS line_picture_url   TEXT,
  ADD COLUMN IF NOT EXISTS line_linked_at     TIMESTAMPTZ;

-- 2) History table: ทุก LINE account ที่ member คนนี้เคย login
CREATE TABLE IF NOT EXISTS member_line_accounts (
  id                 SERIAL PRIMARY KEY,
  member_code        TEXT NOT NULL,
  line_user_id       TEXT NOT NULL,
  line_display_name  TEXT,
  line_picture_url   TEXT,
  first_linked_at    TIMESTAMPTZ DEFAULT now(),
  last_active_at     TIMESTAMPTZ DEFAULT now(),      -- ↑ ทุกครั้งที่ login/มี activity
  is_active          BOOLEAN DEFAULT true,
  source             TEXT,                           -- 'liff_login' | 'webhook' | 'migration'
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT uq_member_line UNIQUE (member_code, line_user_id)
);

CREATE INDEX IF NOT EXISTS idx_mla_member_latest
  ON member_line_accounts(member_code, last_active_at DESC);

CREATE INDEX IF NOT EXISTS idx_mla_line_user
  ON member_line_accounts(line_user_id);

-- 3) Auto-update updated_at
CREATE OR REPLACE FUNCTION _mla_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mla_updated_at ON member_line_accounts;
CREATE TRIGGER trg_mla_updated_at
  BEFORE UPDATE ON member_line_accounts
  FOR EACH ROW EXECUTE FUNCTION _mla_touch_updated_at();

-- 4) One-time data migration: import existing event_attendees.line_user_id
--    (ข้อมูลจาก register.html ที่เก็บก่อน migration นี้)
INSERT INTO member_line_accounts (
  member_code, line_user_id, line_display_name, line_picture_url,
  first_linked_at, last_active_at, is_active, source
)
SELECT DISTINCT ON (ea.member_code, ea.line_user_id)
  ea.member_code,
  ea.line_user_id,
  ea.line_display_name,
  ea.line_picture_url,
  COALESCE(ea.line_linked_at, ea.created_at, now()),
  COALESCE(ea.line_linked_at, ea.created_at, now()),
  true,
  'migration'
FROM event_attendees ea
WHERE ea.line_user_id IS NOT NULL
  AND ea.member_code IS NOT NULL
  AND EXISTS (SELECT 1 FROM members m WHERE m.member_code = ea.member_code)
ORDER BY ea.member_code, ea.line_user_id, ea.line_linked_at DESC NULLS LAST
ON CONFLICT (member_code, line_user_id) DO NOTHING;

-- 5) Set members.line_user_id = latest active account for each member
UPDATE members m
SET
  line_user_id      = mla.line_user_id,
  line_display_name = mla.line_display_name,
  line_picture_url  = mla.line_picture_url,
  line_linked_at    = mla.last_active_at
FROM (
  SELECT DISTINCT ON (member_code)
    member_code, line_user_id, line_display_name, line_picture_url, last_active_at
  FROM member_line_accounts
  WHERE is_active = true
  ORDER BY member_code, last_active_at DESC
) mla
WHERE m.member_code = mla.member_code
  AND m.line_user_id IS NULL;   -- เฉพาะที่ยังไม่มี (idempotent — รันซ้ำไม่ทับของใหม่)

-- ============================================================
-- DONE ✅
-- Verify:
--   SELECT COUNT(*) FROM member_line_accounts;
--   SELECT COUNT(*) FROM members WHERE line_user_id IS NOT NULL;
-- ============================================================
