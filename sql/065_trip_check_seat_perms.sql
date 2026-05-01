-- ============================================================
-- Migration 065: Grant trip_check_seat_* perms to ADMIN role
--
-- Why:
--   ย้ายหน้า check-seat จาก standalone (modules/tour/check-seat.html)
--   เข้ามาในระบบ A4S-ERP เป็น modules/trip/check-seat.html
--   ภายใต้ auth + permission ของระบบ
--
--   หน้าใหม่ใช้ permission key: trip_check_seat_view (+ edit/import/export/delete)
--   ซึ่งยังไม่มีใน role_configs ใดๆ → ต้อง grant ให้ ADMIN ก่อน ไม่งั้น
--   แม้แต่ admin ก็เข้าหน้านี้ไม่ได้ (โดน redirect)
--
-- หมายเหตุ:
--   • DB table `tour_seat_check` และ bucket `tour-seat-images` ยังคงชื่อเดิม
--     (ไม่ rename เพื่อให้ข้อมูลเดิมใช้งานต่อได้ทันที)
--   • หลัง run migration นี้ → admin ต้อง log out + log in ใหม่
--     เพื่อให้ session refresh effective_perms
-- ============================================================

UPDATE role_configs
SET permissions = (
  SELECT to_jsonb(array(
    SELECT DISTINCT unnest(
      array(SELECT jsonb_array_elements_text(permissions))
      || ARRAY[
        'trip_check_seat_view',
        'trip_check_seat_edit',
        'trip_check_seat_import',
        'trip_check_seat_export',
        'trip_check_seat_delete'
      ]
    )
  ))
)
WHERE role_key = 'ADMIN';

-- ============================================================
-- Test:
--   SELECT role_key, label,
--          permissions ? 'trip_check_seat_view'   AS has_view,
--          permissions ? 'trip_check_seat_edit'   AS has_edit,
--          permissions ? 'trip_check_seat_import' AS has_import,
--          permissions ? 'trip_check_seat_export' AS has_export,
--          permissions ? 'trip_check_seat_delete' AS has_delete
--   FROM role_configs WHERE role_key = 'ADMIN';
-- ============================================================
