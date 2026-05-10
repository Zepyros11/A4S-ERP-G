-- ============================================================
-- Migration 095: ตาราง trip_room_occupants — many-to-many ระหว่างห้องและลูกค้า
--
-- Why:
--   trip ยาว 5-7 วันมักเปลี่ยนโรงแรมหลายช่วง (batch ต่างวัน)
--   tour_seat_check.room_id เก็บได้แค่ 1 ห้อง/คน — ไม่พอ
--   ต้องการให้คนคนเดียวอยู่ห้องไหนก็ได้ในแต่ละช่วงพัก (1 คน × N ห้อง)
--
-- Constraint logical (enforce ฝั่ง app, ไม่ DB):
--   1 customer ห้ามอยู่หลายห้องในกลุ่มเดียวกัน (place_id+room_type+dates)
--
-- Idempotent — รันซ้ำได้
-- ============================================================

CREATE TABLE IF NOT EXISTS trip_room_occupants (
  room_id      INTEGER NOT NULL REFERENCES trip_rooms(room_id) ON DELETE CASCADE,
  code         TEXT    NOT NULL,
  assigned_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (room_id, code)
);

CREATE INDEX IF NOT EXISTS idx_tro_code ON trip_room_occupants (code);

-- Migrate ข้อมูลเดิมจาก tour_seat_check.room_id → trip_room_occupants
-- เก็บ tour_seat_check.room_id ไว้เผื่อ rollback (ไม่อ่าน/เขียนต่อแล้ว)
INSERT INTO trip_room_occupants (room_id, code)
SELECT room_id, code
FROM tour_seat_check
WHERE room_id IS NOT NULL
ON CONFLICT (room_id, code) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Verify:
--   SELECT room_id, code FROM trip_room_occupants ORDER BY room_id, code;
--   SELECT COUNT(*) FROM trip_room_occupants;
-- ============================================================
