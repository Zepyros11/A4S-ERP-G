-- ============================================================
-- Migration 125: Grant trip_docs perm keys to existing roles
--
-- Why:
--   เมนูใหม่ "เอกสาร" (modules/trip/trip-docs.html) ใช้ perm keys ใหม่
--   trip_docs_view/create/edit/delete ซึ่งยังไม่มีใน role_configs ที่ live
--   → menu ถูกซ่อน + requirePerm("trip_docs_view") redirect ทุกคน
--     (รวมถึง ADMIN) ออกจากหน้า
--
--   patch นี้ append 4 keys ให้:
--     • ADMIN (full access by convention)
--     • role ที่จัดการทริปอยู่แล้ว (มี trip_list_view) — operator เห็นเมนูได้
--
--   ทำตาม pattern เดียวกับ migration 122
-- ============================================================

UPDATE role_configs
SET permissions = (
  SELECT to_jsonb(array(
    SELECT DISTINCT unnest(
      array(SELECT jsonb_array_elements_text(permissions))
      || ARRAY[
        'trip_docs_view','trip_docs_create','trip_docs_edit','trip_docs_delete'
      ]
    )
  ))
)
WHERE role_key = 'ADMIN'
   OR permissions ? 'trip_list_view';

-- ============================================================
-- Test:
--   SELECT role_key, label,
--          permissions ? 'trip_docs_view'   AS docs_view,
--          permissions ? 'trip_docs_create' AS docs_create
--   FROM role_configs ORDER BY sort_order;
-- ============================================================
