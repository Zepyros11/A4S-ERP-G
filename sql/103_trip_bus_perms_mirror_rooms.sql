-- ============================================================
-- Migration 103: Mirror trip_rooms_* perms → trip_bus_*
--
-- Why:
--   หน้า room-assign.html ตอนนี้รวมส่วน "จัดที่นั่งรถบัส" เข้าไปแล้ว
--   role ที่มี trip_rooms_* ควรได้ trip_bus_* คู่กัน
--   ไม่งั้นจะเห็น section รถบัส แต่กดปุ่มอะไรไม่ได้
--
-- Mapping (1:1):
--   trip_rooms_view   → trip_bus_view
--   trip_rooms_create → trip_bus_create
--   trip_rooms_edit   → trip_bus_edit
--   trip_rooms_delete → trip_bus_delete
--   trip_rooms_assign → trip_bus_assign
--
-- Idempotent — รันซ้ำได้ (DISTINCT ป้องกัน duplicate)
-- ============================================================

UPDATE role_configs
SET permissions = (
  SELECT to_jsonb(array(
    SELECT DISTINCT unnest(
      array(SELECT jsonb_array_elements_text(permissions))
      ||
      -- เพิ่ม bus perm ทีละตัว ถ้า role นี้มี room perm คู่กัน
      CASE WHEN permissions ? 'trip_rooms_view'   THEN ARRAY['trip_bus_view']   ELSE ARRAY[]::text[] END
      ||
      CASE WHEN permissions ? 'trip_rooms_create' THEN ARRAY['trip_bus_create'] ELSE ARRAY[]::text[] END
      ||
      CASE WHEN permissions ? 'trip_rooms_edit'   THEN ARRAY['trip_bus_edit']   ELSE ARRAY[]::text[] END
      ||
      CASE WHEN permissions ? 'trip_rooms_delete' THEN ARRAY['trip_bus_delete'] ELSE ARRAY[]::text[] END
      ||
      CASE WHEN permissions ? 'trip_rooms_assign' THEN ARRAY['trip_bus_assign'] ELSE ARRAY[]::text[] END
    )
  ))
)
WHERE permissions ?| ARRAY[
  'trip_rooms_view', 'trip_rooms_create', 'trip_rooms_edit',
  'trip_rooms_delete', 'trip_rooms_assign'
];

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Verify:
--   SELECT role_key,
--          permissions ? 'trip_rooms_view' AS has_rooms_view,
--          permissions ? 'trip_bus_view'   AS has_bus_view
--   FROM role_configs
--   ORDER BY role_key;
--
--   (ทุก row ที่ has_rooms_view = true ต้องมี has_bus_view = true)
-- ============================================================
