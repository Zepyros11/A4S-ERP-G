-- ============================================================
-- Migration 100: Flexible attendee registration
--   - รองรับ guest (ไม่ใช่สมาชิก) เต็มรูปแบบ
--   - สายงาน (upline) — master list + snapshot ใน attendee
--   - ฟิลด์เสริม per event (FB page, LINE name, เคยเรียน, CS staff, note)
--   - คุณสมบัติ (qualifications) — JSONB ตาม config ของ event
--
--   NULLABLE ทุกตัว → ไม่ break แถวเดิม
-- ============================================================

-- ── 1. event_attendees: เพิ่ม flexible fields ──────────────
ALTER TABLE event_attendees
  ADD COLUMN IF NOT EXISTS upline_id           BIGINT,
  ADD COLUMN IF NOT EXISTS upline_name_text    TEXT,
  ADD COLUMN IF NOT EXISTS fb_page_name        TEXT,
  ADD COLUMN IF NOT EXISTS line_name_reported  TEXT,
  ADD COLUMN IF NOT EXISTS had_attended_before BOOLEAN,
  ADD COLUMN IF NOT EXISTS cs_staff            TEXT,
  ADD COLUMN IF NOT EXISTS attendee_note       TEXT,
  ADD COLUMN IF NOT EXISTS extra_fields        JSONB DEFAULT '{}'::jsonb;

-- index สำหรับ filter "ใครอยู่สายไหน"
CREATE INDEX IF NOT EXISTS idx_event_attendees_upline_id
  ON event_attendees (upline_id) WHERE upline_id IS NOT NULL;

-- index สำหรับ filter qualifications (GIN)
CREATE INDEX IF NOT EXISTS idx_event_attendees_extra_fields
  ON event_attendees USING GIN (extra_fields);

-- ── 2. upline_leaders master ───────────────────────────────
CREATE TABLE IF NOT EXISTS upline_leaders (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  member_code  TEXT,                          -- optional link back to members
  sort_order   INT DEFAULT 100,
  is_active    BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_upline_leaders_active
  ON upline_leaders (is_active, sort_order);

-- FK from event_attendees.upline_id (SET NULL on delete — เก็บ snapshot ใน upline_name_text)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'event_attendees_upline_fk'
  ) THEN
    ALTER TABLE event_attendees
      ADD CONSTRAINT event_attendees_upline_fk
      FOREIGN KEY (upline_id) REFERENCES upline_leaders(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Seed สายงานหลักจากภาพ (เพิ่มได้ภายหลังใน UI)
INSERT INTO upline_leaders (name, sort_order) VALUES
  ('พี่โอ๊ค',         10),
  ('พี่นุ้ย',          20),
  ('พี่เบิร์ด',        30),
  ('ดร.เค้ก',         40),
  ('พี่มีสุข',         50),
  ('พี่แมน',          60),
  ('พี่กิ่ง',          70),
  ('พี่ตุ๊ก',          80),
  ('พี่ไหม',          90),
  ('พี่อัม',          100),
  ('โค้ชเชน',        110),
  ('โค้ชเจน-แวน',    120),
  ('โค้ชมีสุข',      130),
  ('พี่หนุ่ยนฤชา',   140),
  ('พี่เจี๊ยบ',         150),
  ('พี่แทน',         160)
ON CONFLICT (name) DO NOTHING;

-- ── 3. events.attendee_field_config (JSONB) ────────────────
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS attendee_field_config JSONB DEFAULT '{}'::jsonb;

-- Default config (used when event has empty {} ):
--   {
--     "fields": {
--       "fb_page_name":  { "show": true,  "required": false },
--       "line_name":     { "show": true,  "required": false },
--       "had_attended":  { "show": true,  "required": false },
--       "cs_staff":      { "show": true,  "required": false },
--       "position":      { "show": true,  "required": false },
--       "upline":        { "show": true,  "required": true  },
--       "phone":         { "show": true,  "required": false },
--       "note":          { "show": true,  "required": false }
--     },
--     "qualifications": [
--       { "key": "fb_5_posts",  "label": "มี FACEBOOK โพสต์อย่างน้อย 5 โพสต์" },
--       { "key": "ads_fb",      "label": "เคยยิง Ads FB" },
--       { "key": "whatsapp",    "label": "มี Whatsapp" },
--       { "key": "notebook",    "label": "มี Notebook" },
--       { "key": "ng_team_2",   "label": "มีทีมงาน NG อย่างน้อย 2 คน" }
--     ]
--   }

-- ── 4. Test / verify ───────────────────────────────────────
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'event_attendees'
--   AND column_name IN ('upline_id','upline_name_text','fb_page_name',
--                       'line_name_reported','had_attended_before',
--                       'cs_staff','attendee_note','extra_fields');
--
-- SELECT * FROM upline_leaders ORDER BY sort_order;
--
-- SELECT event_id, event_name, attendee_field_config FROM events LIMIT 3;
