-- ============================================================
-- Migration 098: Grant po_receive + po_delete perms to roles
--
-- Why:
--   PO module rewrite ทำให้มี perm keys ใหม่: po_receive (รับของ),
--   po_delete (ลบ + คืน stock). DB role_configs ยังไม่มี → ปุ่ม 📦/🗑
--   ไม่แสดงในหน้ารายการ
--
-- Strategy:
--   • po_receive → MANAGER + WAREHOUSE + ADMIN (คนที่ทำงานคลังจริง)
--   • po_delete  → ADMIN เท่านั้น
-- ============================================================

-- ── Append po_receive to MANAGER + WAREHOUSE + ADMIN ──
UPDATE role_configs
SET permissions = (
  SELECT to_jsonb(array(
    SELECT DISTINCT unnest(
      array(SELECT jsonb_array_elements_text(permissions))
      || ARRAY['po_receive']
    )
  ))
)
WHERE role_key IN ('ADMIN', 'MANAGER', 'WAREHOUSE');

-- ── Append po_delete → ADMIN เท่านั้น ──
UPDATE role_configs
SET permissions = (
  SELECT to_jsonb(array(
    SELECT DISTINCT unnest(
      array(SELECT jsonb_array_elements_text(permissions))
      || ARRAY['po_delete']
    )
  ))
)
WHERE role_key = 'ADMIN';

-- ============================================================
-- Test:
--   SELECT role_key, label,
--          permissions ? 'po_view'    AS has_view,
--          permissions ? 'po_create'  AS has_create,
--          permissions ? 'po_edit'    AS has_edit,
--          permissions ? 'po_approve' AS has_approve,
--          permissions ? 'po_receive' AS has_receive,
--          permissions ? 'po_delete'  AS has_delete
--   FROM role_configs ORDER BY sort_order;
-- ============================================================
