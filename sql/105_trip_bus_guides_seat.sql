-- ============================================================
-- Migration 105: เพิ่ม seat_no ใน trip_bus_guides
--
-- Why:
--   ไกด์ใช้ seat pool เดียวกับลูกค้า — 1 ไกด์ครอง 1 ที่นั่งบนรถ
--   (รถ 40 ที่นั่ง + 2 ไกด์ → ลูกค้านั่งได้ 38 คน)
--   seat_no nullable — assign ไกด์ก่อนเลือก seat ได้
--
-- Constraint:
--   UNIQUE (bus_id, seat_no) WHERE seat_no IS NOT NULL
--     → ไกด์ห้ามนั่ง seat ซ้ำกัน
--   (logic ฝั่ง app ป้องกัน seat ไกด์ทับ seat passenger)
--
-- Idempotent — รันซ้ำได้
-- ============================================================

ALTER TABLE trip_bus_guides ADD COLUMN IF NOT EXISTS seat_no TEXT;

-- ห้ามไกด์ 2 คนนั่ง seat เดียวกันในรถคันเดียวกัน
CREATE UNIQUE INDEX IF NOT EXISTS uq_tbg_bus_seat
  ON trip_bus_guides (bus_id, seat_no)
  WHERE seat_no IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Verify:
--   SELECT bus_id, guide_id, seat_no FROM trip_bus_guides ORDER BY bus_id, seat_no;
-- ============================================================
