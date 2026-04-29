-- ============================================================
-- Migration 049: แยก perm CRM (Customer Dashboard / MLM Tree / LINE Members)
-- ============================================================
-- เดิม: members-dashboard, members-tree, line-members → ใช้ member_view ร่วมกัน
-- ใหม่: แยกเป็น customer_dashboard_view, members_tree_view, line_members_view
-- → backfill perm ใหม่ให้ role ที่เคยมี member_view เพื่อไม่ให้สิทธิ์หาย
-- ============================================================

UPDATE role_configs
SET permissions = (
  SELECT to_jsonb(array(
    SELECT DISTINCT unnest(
      array(SELECT jsonb_array_elements_text(permissions))
      || ARRAY['customer_dashboard_view', 'members_tree_view', 'line_members_view']
    )
  ))
)
WHERE permissions ?| array['member_view'];

-- ============================================================
-- DONE ✅
-- Test:
--   SELECT role_key, label,
--          permissions ? 'member_view' AS has_member_view,
--          permissions ? 'customer_dashboard_view' AS has_dashboard,
--          permissions ? 'members_tree_view' AS has_tree,
--          permissions ? 'line_members_view' AS has_line
--   FROM role_configs ORDER BY sort_order;
-- ============================================================
