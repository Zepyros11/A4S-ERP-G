-- ============================================================
-- Migration 122: Grant new Trip perm keys to existing roles
--
-- Why:
--   The Trip module's newer sub-features (ทีมงาน / รถบัส+ตั๋วเครื่องบิน /
--   ประเภทสมาชิกทีม) were shipped with data-perm / requirePerm keys that
--   were NEVER added to the permission REGISTRY (js/core/permissions.js).
--   They are now added there, but the live role_configs rows still lack
--   these keys → buttons get .remove()'d for EVERYONE (incl. ADMIN) and
--   requirePerm("trip_team_view") even redirects ADMIN off the page.
--
--   This patch appends the 13 new keys to:
--     • ADMIN (full access by convention)
--     • Any role that already manages trips (has trip_rooms_view
--       or trip_list_view) — so trip operators keep working.
--
--   NOTE: room-assign's guide buttons were consolidated from
--   trip_guides_* → trip_team_* (same trip_guides table). No separate
--   trip_guides_* perm exists; nothing to migrate for that rename.
-- ============================================================

UPDATE role_configs
SET permissions = (
  SELECT to_jsonb(array(
    SELECT DISTINCT unnest(
      array(SELECT jsonb_array_elements_text(permissions))
      || ARRAY[
        'trip_team_view','trip_team_create','trip_team_edit','trip_team_delete',
        'trip_bus_view','trip_bus_create','trip_bus_edit','trip_bus_delete','trip_bus_assign',
        'member_types_view','member_types_create','member_types_edit','member_types_delete'
      ]
    )
  ))
)
WHERE role_key = 'ADMIN'
   OR permissions ? 'trip_rooms_view'
   OR permissions ? 'trip_list_view';

-- ============================================================
-- Test:
--   SELECT role_key, label,
--          permissions ? 'trip_team_create'   AS team,
--          permissions ? 'trip_bus_assign'    AS bus,
--          permissions ? 'member_types_create' AS mtypes
--   FROM role_configs ORDER BY sort_order;
-- ============================================================
