-- 140_event_attendee_checkin_by_day.sql
-- Per-day check-in สำหรับ event หลายวัน (เช่น คอร์ส 2 วัน 13-14 มิ.ย.)
--
-- โมเดล:
--   - event 1 วัน  → ใช้ checked_in / check_in_at เดิมทุกอย่าง (ไม่แตะ)
--   - event หลายวัน (end_date > event_date) → เก็บการเช็คอินราย "วัน" ใน checkin_by_day
--       รูปแบบ: { "2026-06-13": "2026-06-13T10:02:00+00:00", "2026-06-14": "..." }
--       key = วันที่ (YYYY-MM-DD) · value = เวลาที่เช็คอินวันนั้น (มี key = เช็คอินแล้ว)
--   - checked_in / check_in_at ยังคงไว้เป็น "rollup" = มาอย่างน้อย 1 วัน (เวลาที่มาวันแรกสุด)
--     เพื่อให้หน้า/รายงานเดิมที่อ่าน checked_in (QR, Export, LINE notify, สถิติสายงาน) ทำงานต่อได้

ALTER TABLE event_attendees
  ADD COLUMN IF NOT EXISTS checkin_by_day JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Backfill: เฉพาะ event หลายวัน ที่ "เช็คอินไว้แล้ว" → ลงเป็นการมา "วันแรก" (event_date)
-- ใช้ check_in_at เดิมเป็นเวลา (ถ้าไม่มีก็ใช้เที่ยงคืนของวันแรก เวลาไทย)
UPDATE event_attendees ea
SET checkin_by_day = jsonb_build_object(
      e.event_date::text,
      COALESCE(ea.check_in_at, (e.event_date::text || 'T00:00:00+07:00')::timestamptz)
    )
FROM events e
WHERE ea.event_id = e.event_id
  AND e.end_date IS NOT NULL
  AND e.end_date > e.event_date
  AND ea.checked_in = TRUE
  AND (ea.checkin_by_day IS NULL OR ea.checkin_by_day = '{}'::jsonb);
