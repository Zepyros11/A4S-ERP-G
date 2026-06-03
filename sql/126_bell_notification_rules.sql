-- ============================================================
-- Migration 126: bell_notification_rules — กฎกระดิ่ง (in-app) แยกอิสระจาก LINE
--
-- Why:
--   เดิมกระดิ่ง topbar (user_notifications) ไม่มีหน้าตั้งค่าของตัวเอง —
--   มันเกาะอยู่บนกฎ LINE (notification_rules) ผ่าน _writeInbox() ใน ai-proxy
--   ผลคือ: กระดิ่งได้เฉพาะ IBD + scheduled · event/booking ยิงแค่ LINE ไม่เขียนกระดิ่ง
--
--   ตารางนี้ทำให้กระดิ่งมี "กฎของตัวเอง" คนละชุดกับ LINE โดยสิ้นเชิง —
--   แต่ละ role/แผนกเห็นกระดิ่งเฉพาะเหตุการณ์ที่เกี่ยวกับตัวเอง
--   (IBD เห็น case ใหม่ · CS/Event เห็นการจองห้อง · Stock เห็นใบเบิกใหม่)
--
-- Architecture:
--   โมดูล → Notify.notifyBell(trigger_key, payload)
--         → POST /bell/notify (ai-proxy)
--         → _processBellRules() อ่านตารางนี้ → resolve role/group/user
--         → เขียน user_notifications (1 row/คน)
--   ใช้ notification_triggers (sql/067) ร่วมกับ LINE — ไม่ duplicate trigger metadata
--
-- Scope: instant / on_status เท่านั้น (ยังไม่รวม scheduled)
-- ============================================================

-- ── 1. Table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bell_notification_rules (
  id              BIGSERIAL PRIMARY KEY,
  rule_name       TEXT NOT NULL,
  trigger_key     TEXT NOT NULL,                                  -- FK แบบหลวมไป notification_triggers.trigger_key
  target_type     TEXT NOT NULL CHECK (target_type IN ('role','group','user')),
  target_value    JSONB NOT NULL DEFAULT '[]'::jsonb,             -- array: roles | group_names | user_ids
  title_template  TEXT,                                          -- หัวข้อสั้น 1 บรรทัด (NULL = fallback _titleForTrigger)
  body_template   TEXT NOT NULL,                                  -- เนื้อหา (รองรับ {{placeholder}})
  link_url        TEXT,                                          -- ลิงก์เปิดเมื่อคลิก (NULL = fallback _linkForTrigger)
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bell_rules_trigger
  ON bell_notification_rules(trigger_key) WHERE is_active = true;

-- auto-update updated_at
CREATE OR REPLACE FUNCTION _bell_rules_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bell_rules_updated_at ON bell_notification_rules;
CREATE TRIGGER trg_bell_rules_updated_at
  BEFORE UPDATE ON bell_notification_rules
  FOR EACH ROW EXECUTE FUNCTION _bell_rules_touch_updated_at();

-- ── 2. RLS (config table → allow authenticated read/write) ──
ALTER TABLE bell_notification_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bnr_select_all ON bell_notification_rules;
CREATE POLICY bnr_select_all ON bell_notification_rules FOR SELECT USING (true);
DROP POLICY IF EXISTS bnr_write_all  ON bell_notification_rules;
CREATE POLICY bnr_write_all  ON bell_notification_rules FOR ALL    USING (true) WITH CHECK (true);

-- ── 3. Trigger ใหม่: stock.req.created (built-in) ───────────
INSERT INTO notification_triggers
  (trigger_key, label, kind, anchor, placeholders, sample, description, is_builtin, sort_order)
VALUES
  (
    'stock.req.created',
    '📦 Stock: ใบเบิกสินค้าใหม่',
    'on_status', NULL,
    ARRAY['req_number','requester','dept','purpose','item_count','req_date','req_id'],
    '{"req_number":"REQ-2026-06-001","requester":"วิชัย ตั้งใจ","dept":"ฝ่ายขาย","purpose":"เบิกใช้ในออฟฟิศ","item_count":3,"req_date":"03/06/2026","req_id":1}'::jsonb,
    'ยิงจาก requisition-form.js เมื่อสร้างใบเบิก (REQ) ใหม่',
    true, 90
  )
ON CONFLICT (trigger_key) DO NOTHING;

-- ── 4. Seed กฎ IBD — copy จาก notification_rules (LINE) ─────
--   รักษา target/is_active ที่ admin ตั้งไว้ live → กันกระดิ่ง IBD เงียบหลัง decouple
--   body_template = message_template เดิม · title_template = NULL (ใช้ _titleForTrigger)
--   NOT EXISTS guard → idempotent (รันซ้ำไม่ดูป)
INSERT INTO bell_notification_rules
  (rule_name, trigger_key, target_type, target_value, body_template, is_active)
SELECT nr.rule_name, nr.trigger_key, nr.target_type, nr.target_value, nr.message_template, nr.is_active
FROM notification_rules nr
WHERE nr.trigger_key IN ('ibd.complaint.created','ibd.ewallet.created','ibd.relocation.created')
  AND NOT EXISTS (
    SELECT 1 FROM bell_notification_rules b WHERE b.trigger_key = nr.trigger_key
  );

-- ── 5. Seed กฎ event/booking/stock — INACTIVE (admin เปิด + เลือก role เอง) ──
INSERT INTO bell_notification_rules
  (rule_name, trigger_key, target_type, target_value, title_template, body_template, is_active)
SELECT v.rule_name, v.trigger_key, 'role', '[]'::jsonb, v.title_template, v.body_template, false
FROM (VALUES
  (
    'แจ้งทีม: Event ยืนยันแล้ว',
    'event.confirmed',
    '📌 Event ยืนยันแล้ว — {{event_name}}',
    E'📅 {{event_date}}\n📍 {{location}}\n👤 อนุมัติ: {{approver}}'
  ),
  (
    'แจ้งทีม: จองห้องประชุมอนุมัติ',
    'booking.approved',
    '🏢 จองห้องอนุมัติ — {{room_name}}',
    E'📅 {{booking_date}} {{start_time}}-{{end_time}}\n👤 ผู้จอง: {{booked_by_name}}'
  ),
  (
    'แจ้ง Stock: ใบเบิกใหม่',
    'stock.req.created',
    '📦 ใบเบิกใหม่ — {{req_number}}',
    E'👤 ผู้ขอ: {{requester}} ({{dept}})\n📝 {{purpose}}\n📦 {{item_count}} รายการ'
  )
) AS v(rule_name, trigger_key, title_template, body_template)
WHERE NOT EXISTS (
  SELECT 1 FROM bell_notification_rules b WHERE b.trigger_key = v.trigger_key
);

-- ============================================================
-- Verify:
--   SELECT id, rule_name, trigger_key, target_type, target_value, is_active
--     FROM bell_notification_rules ORDER BY id;
--   SELECT trigger_key, label FROM notification_triggers WHERE trigger_key='stock.req.created';
-- ============================================================
