-- ============================================================
-- Migration 083: seed `booking.created` trigger
-- ใช้แจ้ง LINE ผู้ดูแล (เช่น admin ภพ) ทันทีที่มีคำขอจองห้องใหม่
-- (ก่อนหน้านี้มีแค่ booking.approved)
-- ============================================================

INSERT INTO notification_triggers
  (trigger_key, label, kind, anchor, placeholders, sample, description, is_builtin, sort_order)
VALUES
  (
    'booking.created',
    '🆕 จองห้อง — คำขอใหม่',
    'on_status', NULL,
    ARRAY['request_code','room_name','place_name','booking_date','start_time','end_time','booked_by_name','cs_name','note','requester'],
    '{"request_code":"RBKQ-2026-05-001","room_name":"ห้องประชุมใหญ่","place_name":"ออฟฟิศ BKK","booking_date":"15/05/2026","start_time":"09:00","end_time":"12:00","booked_by_name":"วิชัย ตั้งใจ","cs_name":"น้องส้ม","note":"ประชุมทีม","requester":"ภพ (admin)"}'::jsonb,
    'ยิงเมื่อมีการสร้าง room_booking_requests ใหม่ (status=PENDING) จาก event-requests.html หรือ cs-view/events-bookingRoom.js',
    true, 25
  )
ON CONFLICT (trigger_key) DO NOTHING;

-- Verify:
--   SELECT trigger_key, label, kind FROM notification_triggers WHERE trigger_key='booking.created';
