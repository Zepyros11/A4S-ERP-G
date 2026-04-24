-- ============================================================
-- Migration 038: Staff notification rules (LINE) for Event & Booking approvals
--
-- Scope (ยืนยันกับ user 2026-04-23):
--   - Trigger ชุดแรก: event.request.approved, booking.approved (เพิ่มภายหลังได้)
--   - Target: role / dept / custom group / specific users (ผ่าน users.notification_groups)
--   - Hook แบบ frontend (เรียกจาก event-requests.js + events-bookingRoom flow)
--
-- Related:
--   - sql/027_line_channels.sql  — line_channels(id) FK
--   - sql/030_users_line.sql     — users.line_user_id
-- ============================================================

-- ── 1. Custom group column บน users ─────────────────────────
-- array of group names (free text) ให้ admin จัดกลุ่ม custom เช่น "ทีมจัดงาน BKK"
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notification_groups TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE INDEX IF NOT EXISTS idx_users_notification_groups
  ON users USING GIN (notification_groups);

-- ── 2. notification_rules ───────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_rules (
  id                BIGSERIAL PRIMARY KEY,
  rule_name         TEXT NOT NULL,
  trigger_key       TEXT NOT NULL,          -- 'event.request.approved' | 'booking.approved' | ...
  target_type       TEXT NOT NULL CHECK (target_type IN ('role','dept','group','user')),
  target_value      JSONB NOT NULL DEFAULT '[]'::jsonb,  -- array: roles | dept_ids | group_names | user_ids
  channel_id        BIGINT REFERENCES line_channels(id) ON DELETE SET NULL,  -- null = default announcement
  message_template  TEXT NOT NULL,          -- รองรับ {{event_name}} {{date}} {{requester}} ฯลฯ
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  updated_by        TEXT
);

CREATE INDEX IF NOT EXISTS idx_notif_rules_trigger
  ON notification_rules(trigger_key) WHERE is_active = true;

-- auto-update updated_at
CREATE OR REPLACE FUNCTION _notif_rules_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notif_rules_updated_at ON notification_rules;
CREATE TRIGGER trg_notif_rules_updated_at
  BEFORE UPDATE ON notification_rules
  FOR EACH ROW EXECUTE FUNCTION _notif_rules_touch_updated_at();

-- ── 3. notification_log ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_log (
  id                 BIGSERIAL PRIMARY KEY,
  rule_id            BIGINT REFERENCES notification_rules(id) ON DELETE SET NULL,
  trigger_key        TEXT NOT NULL,
  payload_ref        JSONB,                -- e.g. {"request_id":123,"event_name":"..."}
  recipient_user_id  INT REFERENCES users(user_id) ON DELETE SET NULL,
  recipient_line_id  TEXT,
  channel_id         BIGINT REFERENCES line_channels(id) ON DELETE SET NULL,
  status             TEXT NOT NULL CHECK (status IN ('sent','failed','skipped')),
  error              TEXT,
  sent_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notif_log_trigger_sent
  ON notification_log(trigger_key, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_log_recipient
  ON notification_log(recipient_user_id, sent_at DESC);

-- ── 4. RLS (config table → allow authenticated read/write) ──
ALTER TABLE notification_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_log   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nr_select_all ON notification_rules;
CREATE POLICY nr_select_all ON notification_rules FOR SELECT USING (true);
DROP POLICY IF EXISTS nr_write_all  ON notification_rules;
CREATE POLICY nr_write_all  ON notification_rules FOR ALL    USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS nl_select_all ON notification_log;
CREATE POLICY nl_select_all ON notification_log FOR SELECT USING (true);
DROP POLICY IF EXISTS nl_insert_all ON notification_log;
CREATE POLICY nl_insert_all ON notification_log FOR INSERT WITH CHECK (true);

-- ── 5. Seed 2 default rules (inactive — admin ไปตั้ง target + enable เอง) ──
INSERT INTO notification_rules (rule_name, trigger_key, target_type, target_value, message_template, is_active)
VALUES
  (
    'แจ้งทีม: Event Request อนุมัติแล้ว',
    'event.request.approved',
    'role',
    '["ADMIN"]'::jsonb,
    '✅ อนุมัติคำขอ Event แล้ว' || E'\n\n' ||
    '📌 {{event_name}}' || E'\n' ||
    '📅 {{event_date}}' || E'\n' ||
    '📍 {{location}}' || E'\n' ||
    '👤 ผู้ขอ: {{requester}}',
    false   -- default off: admin เปิดใช้ใน settings หลังตั้ง target/channel
  ),
  (
    'แจ้งทีม: จองห้องประชุมอนุมัติแล้ว',
    'booking.approved',
    'role',
    '["ADMIN"]'::jsonb,
    '✅ อนุมัติจองห้องประชุมแล้ว' || E'\n\n' ||
    '🏢 {{room_name}}' || E'\n' ||
    '📅 {{booking_date}} {{start_time}}-{{end_time}}' || E'\n' ||
    '👤 ผู้จอง: {{booked_by_name}}',
    false
  )
ON CONFLICT DO NOTHING;

-- ============================================================
-- Verify:
--   SELECT id, rule_name, trigger_key, target_type, is_active FROM notification_rules;
--   \d notification_log
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='users' AND column_name='notification_groups';
-- ============================================================
