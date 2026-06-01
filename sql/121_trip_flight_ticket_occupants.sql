-- ============================================================
-- Migration 121: trip_flight_ticket_occupants — 1 Ticket มีได้หลายคน
--
-- Why:
--   ตั๋วจริง 1 ใบ (PNR/PDF เดียว) มีผู้โดยสารได้หลายคน
--   เดิม trip_flight_tickets.code = 1 คน/ticket → เปลี่ยนเป็น N คน/ticket
--   ผ่านตาราง occupant ต่อ ticket (เหมือน trip_room_occupants)
--
--   Ticket (trip_flight_tickets) = กลุ่ม/PNR · มี ticket_no + ticket_url (PDF) ของกลุ่ม
--   คนในกลุ่ม = trip_flight_ticket_occupants (ticket_id, code)
--   code เดิมบน trip_flight_tickets ถูก migrate → occupant แล้วเลิกใช้ (ignore)
--
-- Idempotent — รันซ้ำได้
-- ============================================================

CREATE TABLE IF NOT EXISTS trip_flight_ticket_occupants (
  ticket_id    INTEGER NOT NULL REFERENCES trip_flight_tickets(ticket_id) ON DELETE CASCADE,
  code         TEXT    NOT NULL,
  assigned_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (ticket_id, code)
);

CREATE INDEX IF NOT EXISTS idx_tfto_code   ON trip_flight_ticket_occupants (code);
CREATE INDEX IF NOT EXISTS idx_tfto_ticket ON trip_flight_ticket_occupants (ticket_id);

-- ── Migrate: code เดิม (1 คน/ticket) → occupant — เฉพาะ ticket ที่ยังไม่มี occupant ──
INSERT INTO trip_flight_ticket_occupants (ticket_id, code)
SELECT ticket_id, code
FROM trip_flight_tickets
WHERE code IS NOT NULL AND code <> ''
  AND NOT EXISTS (
    SELECT 1 FROM trip_flight_ticket_occupants o WHERE o.ticket_id = trip_flight_tickets.ticket_id
  );

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅  (trip_flight_tickets.code คงไว้เผื่อ rollback · ไม่ใช้แล้ว)
-- Verify:
--   SELECT t.flight_id, t.ticket_no, o.code
--     FROM trip_flight_tickets t
--     LEFT JOIN trip_flight_ticket_occupants o USING (ticket_id)
--    ORDER BY t.flight_id, t.ticket_no;
-- ============================================================
