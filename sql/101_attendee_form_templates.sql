-- ============================================================
-- Migration 101: Attendee Form Templates (hybrid FK link + override)
--   - Template master: ใช้ซ้ำได้ระหว่าง event หลายๆ ตัว
--   - events.template_id (FK, ON DELETE SET NULL) — link
--   - events.attendee_field_config (มีอยู่แล้ว) = override layer
--
--   Resolve logic:
--     ถ้า events.attendee_field_config เป็น {} หรือ NULL → ใช้ template สด
--     ถ้ามีค่า → ถือเป็น override → ใช้ของตัวเอง (ไม่ merge)
--     ถ้าไม่มี template + ไม่มี override → ใช้ DEFAULT_CONFIG (hardcoded ใน UI)
-- ============================================================

-- ── 1. Template master ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendee_form_templates (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  description  TEXT,
  config       JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order   INT DEFAULT 100,
  is_active    BOOLEAN DEFAULT true,
  is_default   BOOLEAN DEFAULT false,   -- ⭐ ฟอร์มกลางที่ใช้กับทุก event ที่ไม่ได้เลือกเอง (ได้แค่ 1 ตัว)
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- idempotent: เผื่อตารางมีอยู่แล้วจาก migration เวอร์ชันก่อนที่ยังไม่มี is_default
ALTER TABLE attendee_form_templates
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_attendee_form_templates_active
  ON attendee_form_templates (is_active, sort_order);

-- บังคับให้มี default ได้แค่ตัวเดียว (partial unique index)
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendee_template_single_default
  ON attendee_form_templates (is_default) WHERE is_default = true;

-- ── 2. events.template_id ──────────────────────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS template_id BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'events_template_fk'
  ) THEN
    ALTER TABLE events
      ADD CONSTRAINT events_template_fk
      FOREIGN KEY (template_id) REFERENCES attendee_form_templates(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_events_template_id
  ON events (template_id) WHERE template_id IS NOT NULL;

-- ── 3. Seed 7 baseline templates ───────────────────────────
-- (อ้างอิงจาก spreadsheet จริงของ A4S — แก้ในหน้า master ได้ภายหลัง)

INSERT INTO attendee_form_templates (name, description, config, sort_order) VALUES

-- (1) UNLOCK CH1 — มือใหม่
('UNLOCK CH1', 'คอร์ส UNLOCK THE WORD CHAPTER 1 — มือใหม่ + checklist พื้นฐาน', '{
  "fields": {
    "phone":        { "show": true,  "required": false },
    "position":     { "show": true,  "required": false },
    "upline":       { "show": true,  "required": true  },
    "cs_staff":     { "show": true,  "required": false },
    "line_name":    { "show": false },
    "fb_page_name": { "show": false },
    "had_attended": { "show": true,  "required": true  },
    "note":         { "show": true,  "required": false }
  },
  "qualifications": [
    { "key": "fb_5_posts", "label": "มี FACEBOOK โฟร์ทรี อย่างน้อย 5 โพสต์" },
    { "key": "ads_fb",     "label": "เคยยิง Ads FB" },
    { "key": "whatsapp",   "label": "มี Whatsapp" },
    { "key": "notebook",   "label": "มี Notebook" }
  ]
}'::jsonb, 10),

-- (2) UNLOCK CH2 — ต่อยอด CH1
('UNLOCK CH2', 'คอร์ส UNLOCK THE WORD CHAPTER 2 — ต้องผ่าน CH1 + มีทีมงาน', '{
  "fields": {
    "phone":        { "show": true,  "required": false },
    "position":     { "show": true,  "required": false },
    "upline":       { "show": true,  "required": true  },
    "cs_staff":     { "show": true,  "required": false },
    "line_name":    { "show": false },
    "fb_page_name": { "show": false },
    "had_attended": { "show": true,  "required": true  },
    "note":         { "show": true,  "required": false }
  },
  "qualifications": [
    { "key": "fb_5_posts", "label": "มี FACEBOOK โฟร์ทรี อย่างน้อย 5 โพสต์" },
    { "key": "ads_fb",     "label": "เคยยิง Ads FB" },
    { "key": "whatsapp",   "label": "มี Whatsapp" },
    { "key": "notebook",   "label": "มี Notebook" },
    { "key": "passed_ch1", "label": "ผ่าน CHAPTER 1" },
    { "key": "ng_team_2",  "label": "มีทีมงาน NG อย่างน้อย 2 คน (พื้นฐานต้องรู้เรื่องธุรกิจ)" }
  ]
}'::jsonb, 20),

-- (3) ADVANCE — สอนยิงแอด advance
('UNLOCK ADVANCE', 'คอร์ส ADVANCE — ต้องมีเพจ FB + เคยเรียนพื้นฐาน', '{
  "fields": {
    "phone":        { "show": true,  "required": false },
    "position":     { "show": true,  "required": false },
    "upline":       { "show": true,  "required": true  },
    "cs_staff":     { "show": true,  "required": false },
    "line_name":    { "show": true,  "required": false },
    "fb_page_name": { "show": true,  "required": false },
    "had_attended": { "show": true,  "required": false },
    "note":         { "show": true,  "required": false }
  },
  "qualifications": []
}'::jsonb, 30),

-- (4) BASIC — basic photography/live
('UNLOCK BASIC', 'คอร์ส BASIC — บันทึกเพจ + ชื่อไลน์', '{
  "fields": {
    "phone":        { "show": true,  "required": false },
    "position":     { "show": true,  "required": false },
    "upline":       { "show": true,  "required": true  },
    "cs_staff":     { "show": true,  "required": false },
    "line_name":    { "show": true,  "required": false },
    "fb_page_name": { "show": true,  "required": false },
    "had_attended": { "show": true,  "required": false },
    "note":         { "show": true,  "required": false }
  },
  "qualifications": []
}'::jsonb, 40),

-- (5) TTT — Train The Trainer
('TTT (Train The Trainer)', 'คอร์ส TTT — ต้องเคยเรียน + เป็น trainer', '{
  "fields": {
    "phone":        { "show": true,  "required": false },
    "position":     { "show": true,  "required": false },
    "upline":       { "show": true,  "required": true  },
    "cs_staff":     { "show": true,  "required": false },
    "line_name":    { "show": true,  "required": false },
    "fb_page_name": { "show": true,  "required": false },
    "had_attended": { "show": true,  "required": true  },
    "note":         { "show": true,  "required": false }
  },
  "qualifications": []
}'::jsonb, 50),

-- (6) WELLNESS — Wellness courses
('WELLNESS', 'คอร์ส Wellness — minimum fields เน้นสายงาน + LINE', '{
  "fields": {
    "phone":        { "show": true,  "required": false },
    "position":     { "show": false },
    "upline":       { "show": true,  "required": true  },
    "cs_staff":     { "show": true,  "required": false },
    "line_name":    { "show": true,  "required": false },
    "fb_page_name": { "show": false },
    "had_attended": { "show": false },
    "note":         { "show": true,  "required": false }
  },
  "qualifications": []
}'::jsonb, 60),

-- (7) Default / General — fallback
('General Event', 'ฟอร์ม default ทุกฟิลด์เปิด ไม่มี checklist', '{
  "fields": {
    "phone":        { "show": true,  "required": false },
    "position":     { "show": true,  "required": false },
    "upline":       { "show": true,  "required": true  },
    "cs_staff":     { "show": true,  "required": false },
    "line_name":    { "show": true,  "required": false },
    "fb_page_name": { "show": true,  "required": false },
    "had_attended": { "show": true,  "required": false },
    "note":         { "show": true,  "required": false }
  },
  "qualifications": []
}'::jsonb, 999)

ON CONFLICT (name) DO NOTHING;

-- ── 4. Test / verify ───────────────────────────────────────
-- SELECT id, name, sort_order, jsonb_array_length(config->'qualifications') AS quals_count
--   FROM attendee_form_templates ORDER BY sort_order;
--
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'events' AND column_name = 'template_id';
