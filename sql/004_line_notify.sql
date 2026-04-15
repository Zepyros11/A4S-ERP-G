-- ============================================================
-- Migration 004: LINE Messaging API notification fields
-- Run after 003_pat_expiry.sql
-- ============================================================

ALTER TABLE sync_config
  ADD COLUMN IF NOT EXISTS line_token_encrypted TEXT,         -- AES-encrypted Channel Access Token
  ADD COLUMN IF NOT EXISTS line_target_id       TEXT,         -- group/user ID (e.g. "C1234567890abcdef...")
  ADD COLUMN IF NOT EXISTS line_target_type     TEXT          -- 'group' | 'user' | 'broadcast'
    DEFAULT 'group',
  ADD COLUMN IF NOT EXISTS line_notify_on_success BOOLEAN DEFAULT false;
  -- (default: notify เฉพาะตอน fail. Set true ถ้าอยากรู้ทุกครั้งที่ sync เสร็จ)

-- ============================================================
-- DONE ✅
-- ============================================================
