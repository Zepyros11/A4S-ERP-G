-- ============================================================
-- Migration 051: เคลียร์ custom_permissions ที่ค้างจาก UI เก่า
-- ============================================================
-- หลัง 050 เราลบ perm-tree ออกจากหน้า users.html
-- → perms ของ user ทุกคนต้องมาจาก roles[] อย่างเดียว
-- → custom_permissions เก่าที่ค้างอยู่ จะทำให้ effective_perms เกิน role
--   (เคสจริง: user role=CS แต่ยังเห็นเมนู Event เพราะ custom_perms มี events_view)
-- ============================================================

UPDATE users
SET custom_permissions = NULL
WHERE custom_permissions IS NOT NULL;

-- ============================================================
-- DONE ✅
-- หมายเหตุ:
--   • คอลัมน์ custom_permissions ยังอยู่ใน schema เผื่อใช้ในอนาคต
--   • หลังรันแล้ว user ที่กำลัง login อยู่ต้อง logout → login ใหม่
--     เพื่อ refresh effective_perms ใน session
-- Test:
--   SELECT user_id, full_name, role, roles, custom_permissions
--   FROM users WHERE custom_permissions IS NOT NULL;
--   -- ควรได้ 0 rows
-- ============================================================
