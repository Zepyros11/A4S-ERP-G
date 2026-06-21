-- ============================================================
-- Migration 156: เพิ่ม events.bus_trip_id
--
-- Why:
--   หน้า attendees มีการ์ด "ผู้เข้างานแยกตามรถบัส" — ต้องรู้ว่า event นี้
--   ใช้รถบัสของ trip ไหน (trip_buses / trip_bus_occupants คีย์ด้วย trip_id)
--   ผูกผ่าน dropdown เลือก trip → เก็บค่าไว้ที่ events.bus_trip_id
--   จับคู่คน: event_attendees.member_code = trip_bus_occupants.code
--
--   NULL = ยังไม่ผูกทริป (การ์ดให้เลือกก่อน)
--
-- Idempotent — รันซ้ำได้
-- ============================================================

ALTER TABLE events ADD COLUMN IF NOT EXISTS bus_trip_id INTEGER;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Verify:
--   SELECT event_id, event_name, bus_trip_id FROM events LIMIT 5;
-- ============================================================
