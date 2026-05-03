-- ============================================================
-- Migration 069: user_notifications — per-user in-app inbox
--
-- เก็บ notification ของแต่ละ user (กระดิ่งใน topbar + หน้า inbox)
--   ai-proxy เขียน 1 row ต่อ recipient ตอนยิง notification
--   พร้อมกับส่ง LINE (แยกกันคนละช่องทาง — user เห็นในแอพแม้ไม่เปิด LINE)
--
-- กรองตาม "แผนก" = ผ่าน notification_rules.target (role/dept/group/user)
--   เพราะ recipient ถูก resolve ไปแล้วตอน ai-proxy เรียก _resolveRuleTargets
--   → row ใน user_notifications = "เฉพาะคนที่ตรง rule" → กระดิ่งของแต่ละแผนกแยกกันโดยอัตโนมัติ
-- ============================================================

CREATE TABLE IF NOT EXISTS user_notifications (
  id            BIGSERIAL PRIMARY KEY,
  user_id       INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  rule_id       BIGINT REFERENCES notification_rules(id) ON DELETE SET NULL,
  trigger_key   TEXT NOT NULL,                  -- 'ibd.relocation.created' ฯลฯ
  title         TEXT NOT NULL,                  -- หัวข้อสั้น (1 บรรทัด) — สำหรับ list
  body          TEXT,                           -- เนื้อหาเต็ม (rendered จาก template)
  link_url      TEXT,                           -- ลิ้งก์เปิดเมื่อคลิก (e.g. /modules/ibd/ibd-relocation.html?id=5)
  payload_ref   JSONB,                          -- {submission_id: 5} หรือ {event_id: 1, request_id: 2}
  read_at       TIMESTAMPTZ,                    -- NULL = ยังไม่อ่าน
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- index สำหรับ "หา unread ของ user" (กระดิ่ง count)
CREATE INDEX IF NOT EXISTS idx_user_notif_user_unread
  ON user_notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

-- index หลักสำหรับ list (read+unread เรียงใหม่สุดก่อน)
CREATE INDEX IF NOT EXISTS idx_user_notif_user_created
  ON user_notifications (user_id, created_at DESC);

-- index สำหรับ dedupe (เผื่อยิง trigger ซ้ำใน 24 ชม.)
CREATE INDEX IF NOT EXISTS idx_user_notif_dedupe
  ON user_notifications (user_id, trigger_key, ((payload_ref->>'submission_id')));

-- ── RLS ──
ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS un_select_all ON user_notifications;
CREATE POLICY un_select_all ON user_notifications FOR SELECT USING (true);
DROP POLICY IF EXISTS un_write_all  ON user_notifications;
CREATE POLICY un_write_all  ON user_notifications FOR ALL    USING (true) WITH CHECK (true);

-- ============================================================
-- Verify:
--   SELECT user_id, trigger_key, title, read_at IS NULL AS unread
--     FROM user_notifications ORDER BY created_at DESC LIMIT 20;
-- ============================================================
