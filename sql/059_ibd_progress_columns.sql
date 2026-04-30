-- ============================================================
-- Migration 059: Add progress_status + note + pinned to 3 IBD tables
--
-- progress_status: workflow ฝั่ง staff (แยกจาก status ที่เป็น lifecycle ของ submission)
--   pending      = รอดำเนินการ (default)
--   in_progress  = ดำเนินการแล้ว
--   stuck        = ติดปัญหา
--
-- note    : free-text staff note (autosave)
-- pinned  : ปักหมุดให้ขึ้นบนสุด
-- ============================================================

ALTER TABLE ibd_complaints
  ADD COLUMN IF NOT EXISTS progress_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (progress_status IN ('pending','in_progress','stuck')),
  ADD COLUMN IF NOT EXISTS note      TEXT,
  ADD COLUMN IF NOT EXISTS pinned    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

ALTER TABLE ibd_ewallet_requests
  ADD COLUMN IF NOT EXISTS progress_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (progress_status IN ('pending','in_progress','stuck')),
  ADD COLUMN IF NOT EXISTS note      TEXT,
  ADD COLUMN IF NOT EXISTS pinned    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

ALTER TABLE ibd_relocation_requests
  ADD COLUMN IF NOT EXISTS progress_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (progress_status IN ('pending','in_progress','stuck')),
  ADD COLUMN IF NOT EXISTS note      TEXT,
  ADD COLUMN IF NOT EXISTS pinned    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

-- Indexes for "pinned first" sort
CREATE INDEX IF NOT EXISTS idx_ibd_complaints_pinned   ON ibd_complaints (pinned DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ibd_ewallet_pinned      ON ibd_ewallet_requests (pinned DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ibd_relocation_pinned   ON ibd_relocation_requests (pinned DESC, created_at DESC);
