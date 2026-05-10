-- ============================================================
-- Migration 088: ผูกข้อมูล tour_seat_check เก่า (trip_id IS NULL)
--                เข้ากับทริปแรก "Africa Hero Thailand Trip"
--
-- Why:
--   ก่อนรัน 087 ทุกแถวยังไม่มี trip_id → หน้า check-seat?trip_id=X
--   มองไม่เห็น 124 แถวเดิม
--
-- เปลี่ยนเลข trip_id ตรง :target_trip_id ถ้าต้องการผูกกับทริปอื่น
-- ============================================================

DO $$
DECLARE
  target_trip_id INT := 1;  -- ← ID ของทริปที่ต้องการผูกข้อมูลเก่าเข้าไป
  affected_count INT;
BEGIN
  -- ตรวจสอบว่าทริปปลายทางมีอยู่จริง
  IF NOT EXISTS (SELECT 1 FROM trips WHERE trip_id = target_trip_id) THEN
    RAISE EXCEPTION 'Trip id=% ไม่มีอยู่ใน table trips — สร้างทริปก่อน', target_trip_id;
  END IF;

  -- ผูกแถวที่ trip_id IS NULL ทั้งหมดเข้ากับทริปนี้
  UPDATE tour_seat_check
  SET trip_id = target_trip_id
  WHERE trip_id IS NULL;

  GET DIAGNOSTICS affected_count = ROW_COUNT;
  RAISE NOTICE '✅ ผูกข้อมูลเก่า % แถวเข้ากับทริป id=%', affected_count, target_trip_id;
END $$;

-- ============================================================
-- Verify:
--   SELECT trip_id, COUNT(*) FROM tour_seat_check GROUP BY trip_id;
-- ============================================================
