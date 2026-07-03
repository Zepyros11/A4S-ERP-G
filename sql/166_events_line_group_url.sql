-- ============================================================
-- Migration 166: Add line_group_url to events
-- ============================================================
-- ลิงก์เชิญเข้า "กลุ่ม LINE" ของ event นี้ (invite link รายงาน)
-- เก็บ URL เดียวต่อ event · แสดง/แก้ในแถบเครื่องมือหน้า attendees
-- เอาไว้ส่งต่อให้ลูกค้าเข้ากลุ่ม LINE ของงาน
--
-- หมายเหตุ: ต่างจาก events.line_group_ids (migration 053) ซึ่งเป็น
-- array ของ line_groups ภายในสำหรับ auto-promote posts — คนละเรื่องกัน
-- ============================================================

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS line_group_url TEXT DEFAULT NULL;

COMMENT ON COLUMN events.line_group_url IS
  'ลิงก์เชิญเข้ากลุ่ม LINE ของ event นี้ — ส่งต่อให้ลูกค้า (invite link เดียวต่องาน)';

-- Test:
--   SELECT event_id, event_name, line_group_url FROM events WHERE line_group_url IS NOT NULL;
-- ============================================================
