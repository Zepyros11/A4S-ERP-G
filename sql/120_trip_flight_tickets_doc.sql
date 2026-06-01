-- ============================================================
-- Migration 120: trip_flight_tickets.ticket_url — ไฟล์ตั๋วบินต่อ Ticket
--
-- Why:
--   แต่ละ Ticket (1 ช่อง 1 คน) แนบไฟล์ตั๋วเครื่องบินของคนนั้นได้ (PDF/รูป)
--   เก็บ public URL 1 ไฟล์ต่อ ticket ใน bucket tour-seat-images (path ticket/...)
--   (แยกจาก trip_flights.image_urls ที่เป็นเอกสารระดับ flight/category)
--
-- Idempotent — รันซ้ำได้
-- ============================================================

ALTER TABLE trip_flight_tickets ADD COLUMN IF NOT EXISTS ticket_url TEXT;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅
-- ============================================================
