-- ============================================================
-- Migration 148: programs.source_type/source_id (wrap legacy)
--
-- Why:
--   "นำเข้า" legacy trip/event → สร้าง program ที่ "ครอบ" ของเดิม
--   (source_type+source_id) แทนการแค่ติด flag — เพื่อให้ legacy ที่
--   นำเข้ากลายเป็น program เต็มตัว: มี enabled_tools + workspace +
--   เลือกเครื่องมือได้เหมือน program ที่สร้างใหม่ (program model เดียว)
--   ของเดิม (trips/events/tour_seat_check/event_attendees) ยังไม่ถูกแตะ
--   — program wrapper แค่ "ชี้" ไปหา แล้วอ่านข้อมูลคน/ห้องจากของเดิม
--
--   source_type = 'trip' | 'event' | NULL (NULL = program สร้างใหม่ native)
--
-- + Backfill: legacy ที่เคยกด "นำเข้า" (in_operations=true จาก sql/147)
--   แต่ยังไม่มี wrapper → สร้าง wrapper ให้อัตโนมัติ (ไม่ต้องนำเข้าซ้ำ)
--
-- Idempotent — รันซ้ำได้ · ต้องรัน sql/144 + 147 ก่อน
-- ============================================================

ALTER TABLE programs ADD COLUMN IF NOT EXISTS source_type TEXT;     -- 'trip' | 'event' | NULL
ALTER TABLE programs ADD COLUMN IF NOT EXISTS source_id   INTEGER;

DO $$ BEGIN
  ALTER TABLE programs ADD CONSTRAINT programs_source_type_chk
    CHECK (source_type IS NULL OR source_type IN ('trip','event'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- กัน wrap ซ้ำ: 1 legacy item → ได้ program เดียว
CREATE UNIQUE INDEX IF NOT EXISTS uq_programs_source
  ON programs (source_type, source_id) WHERE source_type IS NOT NULL;

-- ── Backfill: trips ที่ in_operations=true แต่ยังไม่มี wrapper ──
INSERT INTO programs (program_type, name, code, start_date, end_date, status, enabled_tools, source_type, source_id)
SELECT 'TRIP', t.trip_name, NULL, t.start_date, t.end_date,
       CASE WHEN t.status IN ('DONE','CANCELLED') THEN t.status ELSE 'ACTIVE' END,
       '["participants","rooming","buses","flights","staff","reports"]'::jsonb,
       'trip', t.trip_id
FROM trips t
WHERE t.in_operations = true
  AND NOT EXISTS (SELECT 1 FROM programs p WHERE p.source_type = 'trip' AND p.source_id = t.trip_id);

-- ── Backfill: events ที่ in_operations=true แต่ยังไม่มี wrapper ──
INSERT INTO programs (program_type, name, code, start_date, end_date, status, enabled_tools, source_type, source_id)
SELECT 'EVENT', e.event_name, e.event_code, e.event_date, e.end_date,
       CASE WHEN e.status IN ('DONE','CANCELLED') THEN e.status ELSE 'ACTIVE' END,
       '["participants","seating","tasks","namecard","reports"]'::jsonb,
       'event', e.event_id
FROM events e
WHERE e.in_operations = true
  AND NOT EXISTS (SELECT 1 FROM programs p WHERE p.source_type = 'event' AND p.source_id = e.event_id);

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅  Verify:
--   SELECT program_id, program_type, name, source_type, source_id, enabled_tools
--     FROM programs ORDER BY program_id;
-- ============================================================
