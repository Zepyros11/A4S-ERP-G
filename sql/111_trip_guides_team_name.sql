-- ============================================================
-- Migration 111: เพิ่ม team_name ให้ trip_guides
--
-- Why:
--   user ต้องการจัดกลุ่ม team members เป็น "ทีม" ที่ตั้งชื่อเองได้
--   เช่น "ทีมไกด์หลัก", "ทีม Staff บริษัท", "ทีมตากล้อง"
--   member_type ยังเก็บ broad category (staff/guide/outsource)
--   team_name เก็บกลุ่มย่อยที่ user กำหนดเอง — free text, scoped per trip
--
-- Idempotent — รันซ้ำได้
-- ============================================================

ALTER TABLE trip_guides
  ADD COLUMN IF NOT EXISTS team_name TEXT;

-- Index ช่วย autosuggest dropdown (DISTINCT per trip)
CREATE INDEX IF NOT EXISTS idx_trip_guides_team_name
  ON trip_guides (trip_id, team_name);

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE
-- Verify:
--   SELECT trip_id, team_name, COUNT(*) FROM trip_guides
--   WHERE team_name IS NOT NULL GROUP BY trip_id, team_name;
-- ============================================================
