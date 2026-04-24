-- ============================================================
-- Migration 037: person_role on attendees tables
--   - 'primary'      = เจ้าของรหัสหลัก (default)
--   - 'co_applicant' = ผู้สมัครร่วมจากรหัสเดียวกัน
--   - 'guest'        = ไม่ใช่สมาชิก (member_code = NULL)
--
--   1 รหัสสามารถมี attendee ได้สูงสุด 2 แถวต่อ event
--   (primary + co_applicant) แต่ห้ามซ้ำ role เดียวกัน
-- ============================================================

-- ── event_attendees ──
ALTER TABLE event_attendees
  ADD COLUMN IF NOT EXISTS person_role TEXT DEFAULT 'primary';

ALTER TABLE event_attendees
  DROP CONSTRAINT IF EXISTS event_attendees_person_role_check;

ALTER TABLE event_attendees
  ADD CONSTRAINT event_attendees_person_role_check
    CHECK (person_role IN ('primary', 'co_applicant', 'guest'));

-- Backfill: row ที่ไม่มี member_code → guest
UPDATE event_attendees SET person_role = 'guest'
WHERE member_code IS NULL AND (person_role IS NULL OR person_role = 'primary');

-- Unique: (event_id, member_code, person_role) — กันลงซ้ำ role เดียวกันต่อ event
CREATE UNIQUE INDEX IF NOT EXISTS event_attendees_person_unique
  ON event_attendees (event_id, member_code, person_role)
  WHERE member_code IS NOT NULL;

-- ── room_booking_attendees ──
ALTER TABLE room_booking_attendees
  ADD COLUMN IF NOT EXISTS person_role TEXT DEFAULT 'primary';

ALTER TABLE room_booking_attendees
  DROP CONSTRAINT IF EXISTS room_booking_attendees_person_role_check;

ALTER TABLE room_booking_attendees
  ADD CONSTRAINT room_booking_attendees_person_role_check
    CHECK (person_role IN ('primary', 'co_applicant', 'guest'));

UPDATE room_booking_attendees SET person_role = 'guest'
WHERE member_code IS NULL AND (person_role IS NULL OR person_role = 'primary');

CREATE UNIQUE INDEX IF NOT EXISTS rba_person_unique
  ON room_booking_attendees (request_id, member_code, person_role)
  WHERE member_code IS NOT NULL;

-- ============================================================
-- Test:
--   SELECT person_role, COUNT(*) FROM event_attendees GROUP BY 1;
--   -- Try to insert dup → should fail with unique violation:
--   INSERT INTO event_attendees (event_id, name, attend_type, member_code, person_role)
--   VALUES (1, 'test', 'member', '0118515', 'primary');
-- ============================================================
