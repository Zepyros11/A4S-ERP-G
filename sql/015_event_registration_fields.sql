-- ============================================================
-- Migration 015: Event registration settings
-- ============================================================

ALTER TABLE events ADD COLUMN IF NOT EXISTS registration_enabled BOOLEAN DEFAULT false;
ALTER TABLE events ADD COLUMN IF NOT EXISTS members_only BOOLEAN DEFAULT false;

-- ============================================================
-- DONE ✅
-- ============================================================
