-- ============================================================
-- Migration 010: Automation tasks table for Dev Tool
-- ============================================================

CREATE TABLE IF NOT EXISTS automation_tasks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  task_type     TEXT DEFAULT 'web_download',   -- web_download | api_fetch | file_import
  target_url    TEXT,
  username      TEXT,
  password_encrypted TEXT,
  workflow      TEXT,                           -- GitHub Actions workflow filename
  schedule      TEXT DEFAULT 'manual',          -- manual | 1h | 6h | 24h | weekly
  status        TEXT DEFAULT 'active',          -- active | inactive | error
  notes         TEXT,
  last_run_at   TIMESTAMPTZ,
  last_row_count INT,
  last_error    TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- DONE
-- Test:
--   SELECT * FROM automation_tasks;
-- ============================================================
