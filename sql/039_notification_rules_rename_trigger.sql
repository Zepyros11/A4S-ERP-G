-- ============================================================
-- Migration 039: Rename trigger key for event approval
--   เดิม: event.request.approved  (ฟัง event_requests.status='APPROVED')
--   ใหม่: event.confirmed         (ฟัง events.status='CONFIRMED')
--
-- เหตุผล: User ยืนยัน 2026-04-23 ว่า trigger ที่ถูกต้องคือ
--         "events.status = CONFIRMED" ไม่ใช่ "event_requests.status = APPROVED"
--         (booking.approved คงเดิม เพราะ room_booking ไม่มี CONFIRMED)
-- ============================================================

UPDATE notification_rules
   SET trigger_key      = 'event.confirmed',
       message_template = REPLACE(message_template, '{{requester}}', '{{dept}}')
 WHERE trigger_key = 'event.request.approved';

-- ============================================================
-- Verify:
--   SELECT id, rule_name, trigger_key, message_template
--     FROM notification_rules ORDER BY id;
-- ============================================================
