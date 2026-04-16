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
  config_url    TEXT,                           -- link to detail/config page
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- ── Seed: existing automation ──
INSERT INTO automation_tasks (name, task_type, target_url, workflow, schedule, status, notes, config_url)
VALUES (
  'Export All Member',
  'web_download',
  'https://www.answerforsuccess.com/branch/index.php?sessiontab=1&sub=1&typereport=1',
  'sync-members.yml',
  '24h',
  'active',
  'ดาวน์โหลด Excel สมาชิกทั้งหมดจาก answerforsuccess.com แล้ว import เข้า Supabase (Playwright + SheetJS)',
  '../customer/members-sync.html'
)
ON CONFLICT DO NOTHING;

-- ============================================================
-- DONE
-- Test:
--   SELECT * FROM automation_tasks;
-- ============================================================
