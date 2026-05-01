-- ============================================================
-- 064: Remove "trip" scope from work-plan module
-- ลบข้อมูลแผนงาน Trip ทั้งหมด + drop "trip" ออกจาก CHECK constraint
-- (work_plan_rows ถูกลบ cascade จาก work_plans.id)
-- ============================================================

BEGIN;

-- ── 1. ลบข้อมูล Trip ─────────────────────────────────────────
DELETE FROM work_plans       WHERE scope = 'trip';
DELETE FROM work_departments WHERE scope = 'trip';

-- ── 2. แก้ CHECK constraint ของ work_plans (เหลือแค่ event/cs)
ALTER TABLE work_plans
  DROP CONSTRAINT IF EXISTS work_plans_scope_check;
ALTER TABLE work_plans
  ADD  CONSTRAINT work_plans_scope_check
  CHECK (scope IN ('event','cs'));

-- ── 3. แก้ CHECK constraint ของ work_departments
ALTER TABLE work_departments
  DROP CONSTRAINT IF EXISTS work_departments_scope_check;
ALTER TABLE work_departments
  ADD  CONSTRAINT work_departments_scope_check
  CHECK (scope IN ('event','cs'));

COMMIT;

-- ── หมายเหตุ ────────────────────────────────────────────────
-- • users.custom_permissions ถูกเคลียร์ไปแล้วใน migration 051
-- • ตอนนี้ permission keys trip_wp_* ถูกลบออกจาก permissions.js (UI)
--   ถึงแม้จะมีคีย์เหลือค้างใน custom_permissions ของ user ก็จะกลายเป็น
--   dead key ไม่มี effect (ไม่มี perm node ใน UI/sidebar mapping)
-- ============================================================
