-- ============================================================
-- Migration 048: เพิ่ม landing_path ใน role_configs
-- ============================================================
-- กำหนดหน้าแรกหลัง login ตาม Role (ตั้งค่าได้จากหน้า roles.html)
-- ถ้าเป็น NULL → fallback เป็น dashboard.html ใน login.html
-- ============================================================

ALTER TABLE role_configs
  ADD COLUMN IF NOT EXISTS landing_path TEXT;

COMMENT ON COLUMN role_configs.landing_path IS
  'Relative path (เช่น ./modules/dashboard/dashboard.html) ที่ user role นี้จะถูก redirect ไปหลัง login';

-- Optional: seed ค่า default ตาม role ปัจจุบัน
UPDATE role_configs SET landing_path = './modules/event/events-dashboard.html'
  WHERE role_key = 'BRE' AND landing_path IS NULL;

UPDATE role_configs SET landing_path = './modules/customer/members-dashboard.html'
  WHERE role_key = 'CS' AND landing_path IS NULL;

-- ============================================================
-- DONE ✅
-- Test:
--   SELECT role_key, label, landing_path FROM role_configs ORDER BY sort_order;
-- ============================================================
