-- ============================================================
-- Migration 061: Grant ibd_*_delete perms to existing roles
--
-- Why:
--   sql/055 added the IBD module + permissions REGISTRY (in
--   js/core/permissions.js). sql/058+059 added rows to the DB.
--   But the new perm KEYS (`ibd_*_delete`, added later) are NOT
--   yet in any role_configs row → backend renders no delete button.
--
-- This patch appends the 3 delete perms to:
--   • Any role that already has the matching `_view` perm
--   • PLUS the ADMIN role (full access by convention)
-- ============================================================

-- ── Append complaints_delete to roles that already have complaints_view ──
UPDATE role_configs
SET permissions = (
  SELECT to_jsonb(array(
    SELECT DISTINCT unnest(
      array(SELECT jsonb_array_elements_text(permissions))
      || ARRAY['ibd_complaints_delete']
    )
  ))
)
WHERE permissions ? 'ibd_complaints_view'
   OR role_key = 'ADMIN';

-- ── Append ewallet_delete to roles that already have ewallet_view ──
UPDATE role_configs
SET permissions = (
  SELECT to_jsonb(array(
    SELECT DISTINCT unnest(
      array(SELECT jsonb_array_elements_text(permissions))
      || ARRAY['ibd_ewallet_delete']
    )
  ))
)
WHERE permissions ? 'ibd_ewallet_view'
   OR role_key = 'ADMIN';

-- ── Append relocation_delete to roles that already have relocation_view ──
UPDATE role_configs
SET permissions = (
  SELECT to_jsonb(array(
    SELECT DISTINCT unnest(
      array(SELECT jsonb_array_elements_text(permissions))
      || ARRAY['ibd_relocation_delete']
    )
  ))
)
WHERE permissions ? 'ibd_relocation_view'
   OR role_key = 'ADMIN';

-- ============================================================
-- Test:
--   SELECT role_key, label,
--          permissions ? 'ibd_complaints_delete' AS has_c_del,
--          permissions ? 'ibd_ewallet_delete'    AS has_e_del,
--          permissions ? 'ibd_relocation_delete' AS has_r_del
--   FROM role_configs ORDER BY sort_order;
-- ============================================================
