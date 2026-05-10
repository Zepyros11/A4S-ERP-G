-- ============================================================
-- Migration 093: เพิ่ม check_in_date + check_out_date ให้ trip_rooms
--
-- Why:
--   ห้องพักในทริปอาจจองคนละช่วงวัน (เช่น ลูกค้าบางคนมาก่อน/กลับก่อน)
--   เพิ่ม field date range ต่อห้อง (default = ช่วงวันของทริป)
-- ============================================================

ALTER TABLE trip_rooms ADD COLUMN IF NOT EXISTS check_in_date  DATE;
ALTER TABLE trip_rooms ADD COLUMN IF NOT EXISTS check_out_date DATE;

NOTIFY pgrst, 'reload schema';
