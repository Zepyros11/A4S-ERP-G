-- ============================================================
-- Migration 027b: Fix missing columns in line_channels
-- (เผื่อกรณีสร้าง table จาก SQL ก่อนหน้าแล้ว 027 skip CREATE TABLE)
-- idempotent — รันซ้ำไม่ error
-- ============================================================

ALTER TABLE line_channels
  ADD COLUMN IF NOT EXISTS liff_endpoint TEXT,
  ADD COLUMN IF NOT EXISTS note          TEXT,
  ADD COLUMN IF NOT EXISTS liff_id       TEXT,
  ADD COLUMN IF NOT EXISTS friend_url    TEXT,
  ADD COLUMN IF NOT EXISTS channel_id    TEXT,
  ADD COLUMN IF NOT EXISTS is_default    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_active     BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at    TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ DEFAULT now();

-- Recreate unique index on default (if missing)
CREATE UNIQUE INDEX IF NOT EXISTS idx_line_channels_default
  ON line_channels(purpose)
  WHERE is_default = true;

-- ============================================================
-- After running this, refresh PostgREST schema cache:
--   Supabase Dashboard → Settings → API → "Reload schema cache"
-- (หรือรอ ~10 วินาทีให้ cache refresh เอง)
-- ============================================================
