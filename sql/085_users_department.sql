-- ============================================================
-- Migration 085: เพิ่ม users.department (free text)
-- ใช้ในหน้าจัดการผู้ใช้งาน — กรอกชื่อแผนกเอง (ไม่ใช่ FK)
-- หมายเหตุ: ระบบยังกรอง "user ในแผนก X" ผ่าน role หลัก (slot 1) อยู่
--          field นี้เป็น display label เสริม ไม่ใช้ filter logic
-- ============================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS department TEXT;

CREATE INDEX IF NOT EXISTS idx_users_department
  ON users (department)
  WHERE department IS NOT NULL;

-- ============================================================
-- DONE ✅
-- Verify:
--   SELECT user_id, full_name, department FROM users;
-- ============================================================
