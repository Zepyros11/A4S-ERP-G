-- ============================================================
-- Migration 053: Add line_group_ids to events
-- ============================================================
-- ใช้เก็บกลุ่ม LINE ที่ event นี้จะส่ง promote เข้า (multi-select)
-- ตอน auto-create posts (D-7/3/2/1) จะ replicate 1 row per group
-- ============================================================

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS line_group_ids TEXT[] DEFAULT NULL;

COMMENT ON COLUMN events.line_group_ids IS
  'Array ของ line_groups.group_id ที่ event นี้จะส่งโพสต์ promote เข้า — null = ใช้ default group';

-- Test:
--   SELECT event_id, event_name, line_group_ids FROM events WHERE line_group_ids IS NOT NULL;
-- ============================================================
