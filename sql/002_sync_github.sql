-- ============================================================
-- Migration 002: Add GitHub Actions integration to sync_config
-- Run after 001_members.sql
-- ============================================================

ALTER TABLE sync_config
  ADD COLUMN IF NOT EXISTS github_owner          TEXT,         -- "Zepyros11"
  ADD COLUMN IF NOT EXISTS github_repo           TEXT,         -- "A4S-ERP-G"
  ADD COLUMN IF NOT EXISTS github_workflow       TEXT,         -- "sync-members.yml"
  ADD COLUMN IF NOT EXISTS github_pat_encrypted  TEXT,         -- AES-encrypted PAT
  ADD COLUMN IF NOT EXISTS github_branch         TEXT DEFAULT 'main';

-- Default values for current project
UPDATE sync_config SET
  github_owner    = COALESCE(github_owner,    'Zepyros11'),
  github_repo     = COALESCE(github_repo,     'A4S-ERP-G'),
  github_workflow = COALESCE(github_workflow, 'sync-members.yml'),
  github_branch   = COALESCE(github_branch,   'main')
WHERE id = 1;

-- ============================================================
-- DONE ✅
-- ============================================================
