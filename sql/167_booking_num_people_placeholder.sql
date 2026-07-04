-- ============================================================
-- Migration 167: booking triggers — add {{num_people}} placeholder
--
-- Why:
--   หน้ารายละเอียดการจองห้อง (events-calendar) แสดง "จำนวนคน" จากคอลัมน์
--   room_booking_requests.num_people อยู่แล้ว แต่ยังใช้ในข้อความแจ้งเตือน LINE
--   ไม่ได้ — เพิ่ม placeholder num_people ให้ trigger booking ทุกตัว
--
-- How:
--   - ai-proxy _payloadFromBooking() เพิ่ม field num_people (แก้ในโค้ดแล้ว)
--   - VAR_CATALOG.booking ใน notification-rules.js เพิ่มตัวแปร (แก้ในโค้ดแล้ว)
--   - migration นี้: append 'num_people' เข้า placeholders + sample ของ
--     booking.created / booking.approved / booking.scheduled / booking.before_start
--     (idempotent — ข้ามถ้ามีอยู่แล้ว)
--   - booking.created/approved เป็น on_status (payload สร้างจาก frontend) —
--     event-requests.html + cs-view/events-bookingRoom.js เพิ่ม num_people ใน ctx แล้ว
-- ============================================================

UPDATE notification_triggers
SET placeholders = array_append(placeholders, 'num_people'),
    sample       = sample || '{"num_people": 13}'::jsonb
WHERE trigger_key IN ('booking.created', 'booking.approved', 'booking.scheduled', 'booking.before_start')
  AND NOT ('num_people' = ANY(placeholders));

-- ============================================================
-- Verify:
--   SELECT trigger_key, placeholders, sample->'num_people'
--     FROM notification_triggers
--    WHERE trigger_key LIKE 'booking%';
-- ============================================================
