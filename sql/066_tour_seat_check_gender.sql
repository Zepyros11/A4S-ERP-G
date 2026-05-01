-- ============================================================
-- Migration 066: Add gender column to tour_seat_check
--
-- Why:
--   หน้า trip/check-seat ขอเพิ่ม dropdown Gender (male/female)
--   ทางซ้ายของ PIN
--
-- หมายเหตุ:
--   • ใส่เป็น TEXT (ไม่ใช่ ENUM) เผื่ออนาคตเพิ่ม option อื่น
--   • Nullable + ไม่มี default — แถวเดิม 129 rows จะมี gender = NULL
--     (ผู้ใช้กรอกย้อนหลังเองตามต้องการ)
-- ============================================================

ALTER TABLE tour_seat_check
  ADD COLUMN IF NOT EXISTS gender TEXT;

-- ============================================================
-- Test:
--   SELECT code, name, gender FROM tour_seat_check LIMIT 5;
-- ============================================================
