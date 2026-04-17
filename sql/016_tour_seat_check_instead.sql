-- =============================================
-- tour_seat_check: เพิ่มคอลัมน์ instead
-- สำหรับระบุชื่อผู้ที่เดินทางแทน (substitute)
-- =============================================

ALTER TABLE tour_seat_check ADD COLUMN IF NOT EXISTS instead TEXT;
