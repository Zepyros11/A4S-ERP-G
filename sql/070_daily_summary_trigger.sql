-- ============================================================
-- Migration 070: Daily Summary trigger
--
-- รวม events (CONFIRMED) + bookings (APPROVED) ของวันที่ตาม
-- offset_days แล้วส่ง 1 ข้อความสรุป (ไม่ส่งถ้าวันนั้นว่าง)
--
-- anchor='daily_summary' เป็น anchor ใหม่ — _processRule
-- ใน ai-proxy ต้องมี branch รองรับ (server.js)
-- ============================================================

-- ── 1. ขยาย CHECK constraint ของ column anchor ให้รองรับ 'daily_summary' ──
-- (constraint เดิมจาก migration 067 อนุญาตแค่ 3 ตัว)
ALTER TABLE notification_triggers
  DROP CONSTRAINT IF EXISTS notification_triggers_anchor_check;

ALTER TABLE notification_triggers
  ADD CONSTRAINT notification_triggers_anchor_check
  CHECK (anchor IN ('event_date','booking_date','booking_start_time','daily_summary'));

-- ── 2. seed trigger ──
INSERT INTO notification_triggers
  (trigger_key, label, kind, anchor, placeholders, sample, description, is_builtin, sort_order)
VALUES (
  'daily.event_booking_summary',
  '📊 สรุปงานประจำวัน (event + booking รวม 1 ข้อความ)',
  'scheduled', 'daily_summary',
  ARRAY[
    'date','total_events','total_bookings',
    'event_count_text','booking_count_text',
    'event_list','booking_list'
  ],
  '{
    "date":"03/05/2026",
    "total_events":2,
    "total_bookings":3,
    "event_count_text":"2 events",
    "booking_count_text":"3 bookings",
    "event_list":"• 09:00-12:00 | Tech Summit @ Hall A\n• 13:00-15:00 | Workshop @ Room 201",
    "booking_list":"• 09:00-10:00 | ห้องประชุมเล็ก (วิชัย)\n• 14:00-ทั้งวัน | ห้องประชุมใหญ่ (สมศรี)"
  }'::jsonb,
  'cron รวม events (CONFIRMED) + bookings (APPROVED) ของวันที่ตาม offset_days แล้วส่ง 1 ข้อความ — ถ้าวันนั้นว่างจะข้าม (ไม่ส่ง "วันนี้ว่าง")',
  true, 25
)
ON CONFLICT (trigger_key) DO NOTHING;

-- ============================================================
-- Verify:
--   SELECT trigger_key, label, kind, anchor FROM notification_triggers
--   WHERE trigger_key = 'daily.event_booking_summary';
-- ============================================================
