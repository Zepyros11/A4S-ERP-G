-- ============================================================
-- Migration 097: Grant req_edit + req_delete perms to roles
--
-- Why:
--   permissions.js เพิ่ม req_edit, req_delete ใหม่ แต่ role_configs
--   ใน DB ยังไม่มี → user ปัจจุบัน effective_perms ไม่มี perm นี้ →
--   ปุ่ม ✏️ แก้ไข / 🗑️ ลบ ไม่แสดงในหน้ารายการ
--
-- Strategy:
--   • req_edit   → ทุก role ที่มี req_view (ADMIN + MANAGER + WAREHOUSE + SALES)
--     [policy: ทุกคนที่ดูได้ → แก้ได้ ถ้าต้องการจำกัด ให้ลบจาก WAREHOUSE/SALES]
--   • req_delete → ADMIN เท่านั้น (ตามคำขอ business)
-- ============================================================

-- ── Append req_edit to roles ที่มี req_view ──
UPDATE role_configs
SET permissions = (
  SELECT to_jsonb(array(
    SELECT DISTINCT unnest(
      array(SELECT jsonb_array_elements_text(permissions))
      || ARRAY['req_edit']
    )
  ))
)
WHERE permissions ? 'req_view'
   OR role_key = 'ADMIN';

-- ── Append req_delete → ADMIN เท่านั้น ──
UPDATE role_configs
SET permissions = (
  SELECT to_jsonb(array(
    SELECT DISTINCT unnest(
      array(SELECT jsonb_array_elements_text(permissions))
      || ARRAY['req_delete']
    )
  ))
)
WHERE role_key = 'ADMIN';

-- ============================================================
-- Test:
--   SELECT role_key, label,
--          permissions ? 'req_edit'    AS has_edit,
--          permissions ? 'req_delete'  AS has_delete,
--          permissions ? 'req_approve' AS has_approve
--   FROM role_configs ORDER BY sort_order;
-- ============================================================
