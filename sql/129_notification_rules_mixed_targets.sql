-- ============================================================
-- Migration 129: notification_rules (LINE) — mixed targets
--
-- Why:
--   ให้หน้า "กฎแจ้งเตือน LINE" ใช้ picker แบบเดียวกับกระดิ่ง (sql/128) —
--   เลือก target ผสมได้ในกฎเดียว: role ทั้งอัน + รายคน + group
--
-- How: (pattern เดียวกับ sql/128)
--   เพิ่ม column targets JSONB = { roles:[], groups:[], users:[] }
--   - UI เขียน targets เป็นหลัก
--   - ai-proxy _resolveRuleTargets() + notify.js resolveTargets() อ่าน targets
--     → union user (เฉพาะที่ผูก LINE) · fallback legacy ถ้า targets null
--   - คง target_type/target_value (legacy) แต่ปลด NOT NULL + CHECK
--
-- หมายเหตุ: ไม่ยุ่งกับ notification_rules_anchor_chk (schedule) — คงไว้
-- ============================================================

ALTER TABLE notification_rules
  ADD COLUMN IF NOT EXISTS targets JSONB;

ALTER TABLE notification_rules
  ALTER COLUMN target_type DROP NOT NULL;

-- drop เฉพาะ CHECK ที่อ้าง target_type (ไม่แตะ anchor check)
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'notification_rules'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%target_type%'
  LOOP
    EXECUTE 'ALTER TABLE notification_rules DROP CONSTRAINT ' || quote_ident(c.conname);
  END LOOP;
END $$;

-- ── Backfill targets จาก legacy target_type/target_value ────
--   dept (ไม่เคย resolve ได้) → array ว่างทั้งหมด (พฤติกรรมเดิม = ไม่มีผู้รับ)
UPDATE notification_rules
SET targets = jsonb_build_object(
  'roles',  CASE WHEN target_type = 'role'  THEN COALESCE(target_value, '[]'::jsonb) ELSE '[]'::jsonb END,
  'groups', CASE WHEN target_type = 'group' THEN COALESCE(target_value, '[]'::jsonb) ELSE '[]'::jsonb END,
  'users',  CASE WHEN target_type = 'user'  THEN COALESCE(target_value, '[]'::jsonb) ELSE '[]'::jsonb END
)
WHERE targets IS NULL;

-- ============================================================
-- Verify:
--   SELECT id, rule_name, target_type, targets FROM notification_rules ORDER BY id;
-- ============================================================
