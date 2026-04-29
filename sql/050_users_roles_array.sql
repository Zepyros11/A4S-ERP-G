-- ============================================================
-- Migration 050: รองรับ user หลาย role พร้อมกัน
-- ============================================================
-- เพิ่ม users.roles (text[]) เก็บได้หลาย role
-- - roles[1] = role หลัก (ใช้สำหรับ landing_path / display)
-- - permissions = union ของทุก role
-- - คอลัมน์เดิม users.role ยังเก็บไว้ = roles[1] (backward compat)
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS roles text[];

-- backfill ของเก่า: roles = ARRAY[role]
UPDATE users
SET roles = ARRAY[role]
WHERE roles IS NULL AND role IS NOT NULL;

-- index สำหรับ filter "หา user ที่มี role X"
CREATE INDEX IF NOT EXISTS idx_users_roles_gin ON users USING gin (roles);

-- ============================================================
-- DONE ✅
-- Test:
--   SELECT user_id, full_name, role, roles FROM users ORDER BY user_id;
-- ============================================================
