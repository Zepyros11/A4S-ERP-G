-- ============================================================
-- Migration 119: trip_flight_tickets — Ticket ย่อยในตั๋วเครื่องบิน (เลขรัน · ว่างได้)
--
-- Why:
--   เปลี่ยนโมเดล "คนในตั๋ว" → "Ticket ย่อย" ในแต่ละ flight (category itinerary)
--   1 Ticket = 1 ช่อง มีเลขรัน (ticket_no) · code = คนที่ถือตั๋ว (ว่างได้ = ยังไม่ assign)
--   flow: กด ➕ เพิ่ม Ticket (ได้ช่องเปล่า) → คลิกคนซ้าย → คลิกแถว Ticket ที่ว่าง
--
--   แทนตาราง trip_flight_occupants เดิม (occupant = คนที่ assign · ว่างไม่ได้)
--   migrate occupant เดิม → ticket (เลขรันตาม assigned_at)
--
-- Idempotent — รันซ้ำได้
-- ============================================================

CREATE TABLE IF NOT EXISTS trip_flight_tickets (
  ticket_id  SERIAL PRIMARY KEY,
  flight_id  INTEGER NOT NULL REFERENCES trip_flights(flight_id) ON DELETE CASCADE,
  ticket_no  INTEGER NOT NULL DEFAULT 1,        -- เลขรันภายใน flight
  code       TEXT,                              -- คนที่ถือตั๋ว (tour_seat_check.code / "g:<id>") · NULL = ว่าง
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tft_flight ON trip_flight_tickets (flight_id, ticket_no);
CREATE INDEX IF NOT EXISTS idx_tft_code   ON trip_flight_tickets (code);

-- ── Migrate: occupant เดิม → ticket (เลขรันตาม assigned_at) — เฉพาะ flight ที่ยังไม่มี ticket ──
INSERT INTO trip_flight_tickets (flight_id, ticket_no, code)
SELECT o.flight_id,
       ROW_NUMBER() OVER (PARTITION BY o.flight_id ORDER BY o.assigned_at, o.code),
       o.code
FROM trip_flight_occupants o
WHERE NOT EXISTS (
  SELECT 1 FROM trip_flight_tickets t WHERE t.flight_id = o.flight_id
);

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅  (trip_flight_occupants คงไว้เผื่อ rollback · ไม่ใช้แล้ว)
-- Verify:
--   SELECT * FROM trip_flight_tickets ORDER BY flight_id, ticket_no;
-- ============================================================
