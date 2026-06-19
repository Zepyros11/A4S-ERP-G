-- ============================================================
-- Migration 147: in_operations flag ให้ trips + events
--
-- Why:
--   Operations Hub ไม่ควร union ทุก trip/event อัตโนมัติ — โดยเฉพาะ
--   event ที่เป็นวันหยุด/ปฏิทิน (ไม่ต้องจัด rooming/seating/staff)
--   จะกลายเป็น noise. "งานไหนต้องการ operations" = คนตัดสิน ไม่ใช่
--   เดาจากข้อมูล → ใช้ opt-in flag
--
--   default FALSE → hub โชว์เฉพาะที่ staff กด "นำเข้า" (set true) จากหน้า hub
--   เป็นเพียงคอลัมน์ nullable เพิ่ม — โค้ด/หน้า trip-list & events เดิม
--   ไม่สนใจคอลัมน์นี้ ไม่กระทบการทำงานเดิม (forward-only)
--
-- Idempotent — รันซ้ำได้
-- ============================================================

ALTER TABLE trips  ADD COLUMN IF NOT EXISTS in_operations BOOLEAN DEFAULT FALSE;
ALTER TABLE events ADD COLUMN IF NOT EXISTS in_operations BOOLEAN DEFAULT FALSE;

-- partial index — hub query กรอง in_operations=true เป็นหลัก
CREATE INDEX IF NOT EXISTS idx_trips_in_operations  ON trips  (in_operations) WHERE in_operations;
CREATE INDEX IF NOT EXISTS idx_events_in_operations ON events (in_operations) WHERE in_operations;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅  Verify:
--   SELECT trip_id, trip_name, in_operations FROM trips;
--   SELECT event_id, event_name, in_operations FROM events WHERE in_operations;
-- ============================================================
