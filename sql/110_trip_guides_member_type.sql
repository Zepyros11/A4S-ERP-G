-- ============================================================
-- Migration 110: เพิ่ม member_type ให้ trip_guides
--
-- Why:
--   trip_guides เดิมเก็บ "ไกด์" อย่างเดียว — ขยายเป็น team management
--   รองรับ Staff / Guide / Outsource ที่มาทำงานให้ trip
--
-- Values:
--   'staff'      — พนักงาน A4S เอง (default ของ tour leader)
--   'guide'      — ไกด์ local / freelance
--   'outsource'  — ทีม outsource / agency
--
-- Idempotent — รันซ้ำได้
-- ============================================================

ALTER TABLE trip_guides
  ADD COLUMN IF NOT EXISTS member_type TEXT DEFAULT 'guide';

ALTER TABLE trip_guides
  ADD COLUMN IF NOT EXISTS company TEXT;

ALTER TABLE trip_guides
  ADD COLUMN IF NOT EXISTS role_title TEXT;

-- Backfill existing rows
UPDATE trip_guides SET member_type = 'guide'
WHERE member_type IS NULL;

-- CHECK constraint (drop+recreate เพื่อให้ idempotent)
ALTER TABLE trip_guides
  DROP CONSTRAINT IF EXISTS trip_guides_member_type_chk;
ALTER TABLE trip_guides
  ADD CONSTRAINT trip_guides_member_type_chk
  CHECK (member_type IN ('staff','guide','outsource'));

-- Permissions: เพิ่ม trip_team_view ให้ทุก role ที่มี trip_guides_view
UPDATE role_configs
SET permissions = (
  SELECT to_jsonb(array(
    SELECT DISTINCT unnest(
      array(SELECT jsonb_array_elements_text(permissions))
      || ARRAY[
        'trip_team_view',
        'trip_team_create',
        'trip_team_edit',
        'trip_team_delete'
      ]
    )
  ))
)
WHERE permissions ? 'trip_guides_view';

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE
-- Verify:
--   SELECT guide_id, full_name, member_type, company, role_title
--   FROM trip_guides ORDER BY trip_id, sort_order;
-- ============================================================
