-- ============================================================
-- Migration 035: ยกเลิกระบบ QR style configurable
-- ------------------------------------------------------------
-- QR Design ถูก fix เป็น "Neon Cyber" ใน js/core/qr-designer.js
-- ไม่ต้องใช้ preset library หรือ per-event override อีกต่อไป
-- ============================================================

-- Drop preset library table
DROP TABLE IF EXISTS qr_style_presets CASCADE;

-- Drop per-event style override column
ALTER TABLE events
  DROP COLUMN IF EXISTS qr_style_config;

-- Verify:
--   SELECT to_regclass('public.qr_style_presets');  -- expect: NULL
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'events' AND column_name = 'qr_style_config';  -- expect: 0 rows
