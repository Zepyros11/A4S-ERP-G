-- ============================================================
-- Migration 031: Configurable LINE reply templates
-- Webhook จะอ่าน template จากตารางนี้ (cache 60s) แทน hardcode
-- UI: /modules/settings/line-templates.html
-- ============================================================

CREATE TABLE IF NOT EXISTS line_reply_templates (
  key            TEXT PRIMARY KEY,
  text           TEXT NOT NULL,
  description    TEXT,
  placeholders   TEXT[] DEFAULT ARRAY[]::TEXT[],
  updated_at     TIMESTAMPTZ DEFAULT now(),
  updated_by     TEXT
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION _lrt_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lrt_updated_at ON line_reply_templates;
CREATE TRIGGER trg_lrt_updated_at
  BEFORE UPDATE ON line_reply_templates
  FOR EACH ROW EXECUTE FUNCTION _lrt_touch_updated_at();

-- RLS: เปิด select/update ให้ทุกคน (เป็นข้อความตั้งค่า ไม่ใช่ sensitive)
ALTER TABLE line_reply_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lrt_select_all ON line_reply_templates;
CREATE POLICY lrt_select_all ON line_reply_templates FOR SELECT USING (true);

DROP POLICY IF EXISTS lrt_update_all ON line_reply_templates;
CREATE POLICY lrt_update_all ON line_reply_templates FOR UPDATE USING (true) WITH CHECK (true);

-- Seed 4 templates
INSERT INTO line_reply_templates (key, text, description, placeholders) VALUES
  (
    'welcome',
    'ยินดีต้อนรับสู่ A4S 🎉' || E'\n\n' ||
    '📱 สมาชิก: ส่ง "รหัสสมาชิก" (ตัวเลข 5-6 หลัก)' || E'\n' ||
    '👤 พนักงาน: ส่ง "username" ของคุณ' || E'\n\n' ||
    'ตัวอย่าง: 10271 หรือ somchai',
    'ข้อความต้อนรับ + วิธีผูก (ส่งเมื่อ add friend หรือพิมพ์อะไรที่ยังไม่ผูก)',
    ARRAY[]::TEXT[]
  ),
  (
    'invalid_code',
    '❌ ไม่พบข้อมูลนี้ในระบบ' || E'\n\n' ||
    '• สมาชิก: ตัวเลข 5-6 หลัก' || E'\n' ||
    '• พนักงาน: username ที่ใช้ login ERP' || E'\n\n' ||
    'หากไม่ทราบข้อมูล ติดต่อแอดมิน',
    'เมื่อส่งรหัส/username ที่ไม่มีในระบบ',
    ARRAY[]::TEXT[]
  ),
  (
    'linked_member',
    '✅ ผูก LINE สำเร็จ!' || E'\n\n' ||
    'สมาชิก: {name}' || E'\n' ||
    'รหัส: {code}' || E'\n\n' ||
    '🔔 จากนี้คุณจะได้รับแจ้งเตือน event และข้อมูลสำคัญทาง LINE',
    'ตอบเมื่อสมาชิก (MLM) ผูก LINE สำเร็จ',
    ARRAY['{name}','{code}']
  ),
  (
    'linked_staff',
    '✅ ผูก LINE พนักงานสำเร็จ!' || E'\n\n' ||
    'ชื่อ: {name}' || E'\n' ||
    'Username: {username}' || E'\n' ||
    'Role: {role}' || E'\n\n' ||
    '🔔 คุณจะได้รับแจ้งเตือนภายในองค์กรผ่าน LINE',
    'ตอบเมื่อพนักงานผูก LINE สำเร็จ',
    ARRAY['{name}','{username}','{role}']
  ),
  (
    'staff_inactive',
    '⚠️ บัญชีพนักงานนี้ถูกปิดใช้งาน — ติดต่อแอดมิน',
    'เมื่อ username ตรง แต่ users.is_active=false',
    ARRAY[]::TEXT[]
  )
ON CONFLICT (key) DO NOTHING;

-- Verify: SELECT key, substring(text,1,40) FROM line_reply_templates ORDER BY key;
