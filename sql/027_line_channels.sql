-- ============================================================
-- Migration 027: LINE Channels Registry
-- Multiple LINE OAs per purpose (event/sync/announcement)
-- Per-event channel selection
-- ============================================================

-- 1) Main table — hold all LINE channel configs
CREATE TABLE IF NOT EXISTS line_channels (
  id                SERIAL PRIMARY KEY,
  name              TEXT NOT NULL,           -- "Bot-Assistant (dev)", "A4S.Global (prod)"
  purpose           TEXT NOT NULL,           -- 'event' | 'sync' | 'announcement'

  -- Messaging API credentials
  channel_id        TEXT,                    -- LINE Channel ID (numeric string)
  token_encrypted   TEXT NOT NULL,           -- AES-encrypted Channel Access Token

  -- LIFF (optional — เฉพาะ purpose='event' ที่ใช้ register page)
  liff_id           TEXT,                    -- "1234567890-xxxxxxxx"
  liff_endpoint     TEXT,                    -- หน้า endpoint ที่ผูกกับ LIFF

  -- Meta
  friend_url        TEXT,                    -- "https://line.me/R/ti/p/@xxxxx"
  is_default        BOOLEAN DEFAULT false,   -- default channel ของ purpose นี้
  is_active         BOOLEAN DEFAULT true,
  note              TEXT,

  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- 2) Ensure only ONE default per purpose
CREATE UNIQUE INDEX IF NOT EXISTS idx_line_channels_default
  ON line_channels(purpose)
  WHERE is_default = true;

-- 3) Per-event channel selection (optional FK — null = ใช้ default ของ purpose='event')
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS line_channel_id INT REFERENCES line_channels(id) ON DELETE SET NULL;

-- 4) Capture LINE User ID ของผู้เข้าร่วม (จาก LIFF login)
ALTER TABLE event_attendees
  ADD COLUMN IF NOT EXISTS line_user_id TEXT,
  ADD COLUMN IF NOT EXISTS line_display_name TEXT,
  ADD COLUMN IF NOT EXISTS line_picture_url TEXT,
  ADD COLUMN IF NOT EXISTS line_linked_at TIMESTAMPTZ;

-- 5) Index สำหรับ lookup line_user_id (unique per event)
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_attendees_line_user
  ON event_attendees(event_id, line_user_id)
  WHERE line_user_id IS NOT NULL;

-- 6) Auto-update updated_at
CREATE OR REPLACE FUNCTION _line_channels_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_line_channels_updated_at ON line_channels;
CREATE TRIGGER trg_line_channels_updated_at
  BEFORE UPDATE ON line_channels
  FOR EACH ROW EXECUTE FUNCTION _line_channels_touch_updated_at();

-- ============================================================
-- DONE ✅
-- Run this in Supabase SQL Editor
-- ============================================================
