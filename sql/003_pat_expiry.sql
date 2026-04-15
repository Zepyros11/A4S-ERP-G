-- ============================================================
-- Migration 003: Track PAT expiry date for reminder UI
-- Run after 002_sync_github.sql
-- ============================================================

ALTER TABLE sync_config
  ADD COLUMN IF NOT EXISTS github_pat_expires_at DATE;

-- ============================================================
-- DONE ✅
-- ============================================================
