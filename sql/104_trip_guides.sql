-- ============================================================
-- Migration 104: ตาราง trip_guides + trip_bus_guides
--
-- Why:
--   ทริปต่างชาติต้องมีไกด์ประจำคันรถ — 1 คันมีไกด์ได้หลายคน
--   (รถบางคันอาจไม่มีไกด์ — assign ทีหลังได้)
--   ไกด์ผูกกับ trip (ไม่ใช้ข้าม trip)
--
-- Idempotent — รันซ้ำได้
-- ============================================================

-- 1) ตาราง trip_guides — master ไกด์ต่อ trip
CREATE TABLE IF NOT EXISTS trip_guides (
  guide_id    SERIAL PRIMARY KEY,
  trip_id     INTEGER NOT NULL REFERENCES trips(trip_id) ON DELETE CASCADE,
  full_name   TEXT NOT NULL,
  phone       TEXT,
  languages   TEXT,           -- comma-separated: "EN, FR, AR"
  line_id     TEXT,
  whatsapp    TEXT,
  note        TEXT,
  sort_order  INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE trip_guides ADD COLUMN IF NOT EXISTS full_name   TEXT;
ALTER TABLE trip_guides ADD COLUMN IF NOT EXISTS phone       TEXT;
ALTER TABLE trip_guides ADD COLUMN IF NOT EXISTS languages   TEXT;
ALTER TABLE trip_guides ADD COLUMN IF NOT EXISTS line_id     TEXT;
ALTER TABLE trip_guides ADD COLUMN IF NOT EXISTS whatsapp    TEXT;
ALTER TABLE trip_guides ADD COLUMN IF NOT EXISTS note        TEXT;
ALTER TABLE trip_guides ADD COLUMN IF NOT EXISTS sort_order  INTEGER DEFAULT 0;
ALTER TABLE trip_guides ADD COLUMN IF NOT EXISTS created_at  TIMESTAMPTZ DEFAULT now();
ALTER TABLE trip_guides ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_trip_guides_trip_id
  ON trip_guides (trip_id, sort_order);

-- 2) ตาราง trip_bus_guides — M:N ระหว่างรถและไกด์
CREATE TABLE IF NOT EXISTS trip_bus_guides (
  bus_id      INTEGER NOT NULL REFERENCES trip_buses(bus_id) ON DELETE CASCADE,
  guide_id    INTEGER NOT NULL REFERENCES trip_guides(guide_id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (bus_id, guide_id)
);

CREATE INDEX IF NOT EXISTS idx_tbg_guide ON trip_bus_guides (guide_id);

-- 3) Permissions: grant trip_guides_* ให้ทุก role ที่มี trip_bus_view อยู่แล้ว
UPDATE role_configs
SET permissions = (
  SELECT to_jsonb(array(
    SELECT DISTINCT unnest(
      array(SELECT jsonb_array_elements_text(permissions))
      || ARRAY[
        'trip_guides_view',
        'trip_guides_create',
        'trip_guides_edit',
        'trip_guides_delete',
        'trip_guides_assign'
      ]
    )
  ))
)
WHERE permissions ? 'trip_bus_view';

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅
-- Verify:
--   SELECT * FROM trip_guides WHERE trip_id = 1;
--   SELECT bus_id, guide_id FROM trip_bus_guides;
-- ============================================================
