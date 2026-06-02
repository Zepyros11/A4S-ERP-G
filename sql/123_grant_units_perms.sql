-- ============================================================
-- Migration 123: Grant units_* perm keys to existing roles
--
-- Why:
--   modules/inventory/units-list.html (หน่วยนับ) is a full master CRUD
--   page but had NO permission keys at all — the page lacked a
--   requirePerm guard and the sidebar item borrowed `inv_cat_view`.
--   A dedicated `units` sub-module (units_view/create/edit/delete) is
--   now in the registry (js/core/permissions.js); this patch seeds the
--   keys into role_configs so the guard + buttons actually work.
--
--   Granted to:
--     • ADMIN (full access by convention)
--     • Any role that already manages inventory setup
--       (has inv_cat_view) — same audience that managed units before.
-- ============================================================

UPDATE role_configs
SET permissions = (
  SELECT to_jsonb(array(
    SELECT DISTINCT unnest(
      array(SELECT jsonb_array_elements_text(permissions))
      || ARRAY[
        'units_view','units_create','units_edit','units_delete'
      ]
    )
  ))
)
WHERE role_key = 'ADMIN'
   OR permissions ? 'inv_cat_view';

-- ============================================================
-- Test:
--   SELECT role_key, label,
--          permissions ? 'units_view'   AS u_view,
--          permissions ? 'units_create' AS u_create
--   FROM role_configs ORDER BY sort_order;
-- ============================================================
