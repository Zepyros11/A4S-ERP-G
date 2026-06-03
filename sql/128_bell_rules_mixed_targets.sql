-- ============================================================
-- Migration 128: bell_notification_rules — mixed targets
--
-- Why:
--   เดิม 1 กฎมี target ชนิดเดียว (role | group | user) ผ่าน
--   target_type + target_value
--   ผู้ใช้ต้องการเลือก "ผสม" ได้ในกฎเดียว เช่น ทั้ง role CS + เพิ่ม
--   บางคนจาก role อื่น
--
-- How:
--   เพิ่ม column targets JSONB = { "roles":[...], "groups":[...], "users":[...] }
--   - UI เขียน targets เป็นหลัก
--   - ai-proxy _resolveBellTargets() อ่าน targets → union user_id ทุกชนิด
--     (fallback ไป target_type/target_value ถ้า targets เป็น null = แถวเก่า)
--   - คง target_type/target_value ไว้ (legacy) แต่ปลด NOT NULL + CHECK
--     เพื่อให้กฎ mixed ไม่ต้องเลือก primary type
-- ============================================================

ALTER TABLE bell_notification_rules
  ADD COLUMN IF NOT EXISTS targets JSONB;

-- ปลด constraint เดิมเพื่อรองรับ mixed (target_type อาจว่างได้)
ALTER TABLE bell_notification_rules
  ALTER COLUMN target_type DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'bell_notification_rules'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%target_type%'
  ) THEN
    EXECUTE (
      SELECT 'ALTER TABLE bell_notification_rules DROP CONSTRAINT ' || quote_ident(conname)
      FROM pg_constraint
      WHERE conrelid = 'bell_notification_rules'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) ILIKE '%target_type%'
      LIMIT 1
    );
  END IF;
END $$;

-- ── Backfill targets จาก legacy target_type/target_value ────
UPDATE bell_notification_rules
SET targets = jsonb_build_object(
  'roles',  CASE WHEN target_type = 'role'  THEN COALESCE(target_value, '[]'::jsonb) ELSE '[]'::jsonb END,
  'groups', CASE WHEN target_type = 'group' THEN COALESCE(target_value, '[]'::jsonb) ELSE '[]'::jsonb END,
  'users',  CASE WHEN target_type = 'user'  THEN COALESCE(target_value, '[]'::jsonb) ELSE '[]'::jsonb END
)
WHERE targets IS NULL;

-- ============================================================
-- Verify:
--   SELECT id, rule_name, target_type, targets FROM bell_notification_rules ORDER BY id;
-- ============================================================
