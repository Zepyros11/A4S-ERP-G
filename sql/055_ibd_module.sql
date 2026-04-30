-- ============================================================
-- Migration 055: IBD (International Business Development) module
--   แทน Google Forms 3 ตัว ที่ลูกค้า MLM (โซน Africa) ใช้แจ้งเรื่อง
--     1. Service Progress & Customer Complaints  → ibd_complaints
--     2. Commission Payment to E-Wallet          → ibd_ewallet_requests
--     3. Changing Location Base Requisition      → ibd_relocation_requests
--
-- + ibd_countries (lookup ประเทศ/สาขา ใช้ร่วมกัน)
-- + Storage bucket "ibd-attachments" (รูป/ไฟล์แนบทุก form)
-- ============================================================

-- ── 0) ibd_countries — lookup ประเทศ/สาขา (รวมเมืองในไนจีเรียด้วย)
-- เรียงลำดับให้ city ของไนจีเรียอยู่บนสุด, ขีดเส้นแบ่งด้วย display_order ที่เว้นช่วง
CREATE TABLE IF NOT EXISTS ibd_countries (
  code           TEXT PRIMARY KEY,             -- 'NG-LAGOS','NG-KANO','CI','CM',...
  name_en        TEXT NOT NULL,
  name_fr        TEXT,                         -- ชื่อฝรั่งเศส (NULL = ใช้ name_en)
  flag_emoji     TEXT,
  parent_country TEXT,                         -- สำหรับเมือง (NG-LAGOS → NG)
  is_branch      BOOLEAN DEFAULT false,        -- true = เป็นสาขา (Form 1) , false = เป็นประเทศเฉยๆ
  display_order  INT DEFAULT 99,
  active         BOOLEAN DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT now()
);

INSERT INTO ibd_countries (code, name_en, name_fr, flag_emoji, parent_country, is_branch, display_order) VALUES
  -- ── ไนจีเรีย: 4 เมือง (สาขา) ──
  ('NG-LAGOS', 'Lagos',         'Lagos',         '🇳🇬', 'NG', true,  10),
  ('NG-KANO',  'Kano',          'Kano',          '🇳🇬', 'NG', true,  11),
  ('NG-IKOM',  'Ikom',          'Ikom',          '🇳🇬', 'NG', true,  12),
  ('NG-ABUJA', 'Abuja',         'Abuja',         '🇳🇬', 'NG', true,  13),
  -- ── เส้นแบ่ง 1 (ประเทศแอฟริกาฝรั่งเศส) ──
  ('CI',       'Côte d''Ivoire','Côte d''Ivoire','🇨🇮', NULL, true,  20),
  ('CM',       'Cameroon',      'Cameroun',      '🇨🇲', NULL, true,  21),
  ('TG',       'Togo',          'Togo',          '🇹🇬', NULL, true,  22),
  -- ── เส้นแบ่ง 2 (ประเทศแอฟริกาอังกฤษ) ──
  ('UG',       'Uganda',        'Ouganda',       '🇺🇬', NULL, true,  30),
  ('ZA',       'South Africa',  'Afrique du Sud','🇿🇦', NULL, true,  31),
  ('GH',       'Ghana',         'Ghana',         '🇬🇭', NULL, true,  32),
  ('NG',       'Nigeria',       'Nigéria',       '🇳🇬', NULL, false, 33),  -- ใช้สำหรับ relocation (ประเทศ ไม่ใช่สาขา)
  -- ── เส้นแบ่ง 3 (เอเชีย) ──
  ('TH',       'Thailand',      'Thaïlande',     '🇹🇭', NULL, false, 40),
  ('LA',       'Laos',          'Laos',          '🇱🇦', NULL, false, 41)
ON CONFLICT (code) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_ibd_countries_active ON ibd_countries (active, display_order);

-- ============================================================
-- 1) ibd_complaints — Form 1: Service Progress & Customer Complaints
-- ============================================================
CREATE TABLE IF NOT EXISTS ibd_complaints (
  id                   BIGSERIAL PRIMARY KEY,
  source_form          TEXT NOT NULL DEFAULT 'complaint',

  -- ── Form fields ──
  member_code          TEXT NOT NULL,
  member_name          TEXT NOT NULL,
  whatsapp_used        TEXT,                          -- WhatsApp number used to contact us
  topic                TEXT NOT NULL,                 -- product_order|info_change|password|commission|service|wrong_sponsor|other
  topic_other          TEXT,                          -- เมื่อ topic='other'
  branch_code          TEXT REFERENCES ibd_countries(code) ON DELETE SET NULL,
  branch_other         TEXT,                          -- เมื่อเลือก "Other"
  cs_whatsapp          TEXT,                          -- A4S CS WhatsApp number ที่ลูกค้าติดต่อไป
  details              TEXT,                          -- "Please write the details"
  attachment_urls      JSONB DEFAULT '[]'::jsonb,     -- array ของ URL (ไฟล์ใน storage)
  others               TEXT,                          -- "Others" (optional)

  -- ── Workflow ──
  status               TEXT NOT NULL DEFAULT 'new',   -- new|in_progress|resolved|closed
  assigned_to          INT REFERENCES users(user_id) ON DELETE SET NULL,
  resolution_note      TEXT,
  resolved_at          TIMESTAMPTZ,

  -- ── Meta ──
  language             TEXT DEFAULT 'en',             -- en/fr (รองรับขยาย)
  ip_address           TEXT,
  user_agent           TEXT,
  created_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ibd_complaints_status   ON ibd_complaints (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ibd_complaints_member   ON ibd_complaints (member_code);
CREATE INDEX IF NOT EXISTS idx_ibd_complaints_topic    ON ibd_complaints (topic);
CREATE INDEX IF NOT EXISTS idx_ibd_complaints_branch   ON ibd_complaints (branch_code);
CREATE INDEX IF NOT EXISTS idx_ibd_complaints_created  ON ibd_complaints (created_at DESC);

-- ============================================================
-- 2) ibd_ewallet_requests — Form 2: Commission to E-Wallet
-- ============================================================
CREATE TABLE IF NOT EXISTS ibd_ewallet_requests (
  id                   BIGSERIAL PRIMARY KEY,
  source_form          TEXT NOT NULL DEFAULT 'ewallet',

  -- ── Form fields ──
  member_code          TEXT NOT NULL,
  member_full_name     TEXT NOT NULL,                 -- "Name and Surname when applied membership"
  whatsapp             TEXT NOT NULL,
  email                TEXT,
  confirmed            BOOLEAN DEFAULT false,         -- "I would like to receive my commission..." radio
  id_document_urls     JSONB DEFAULT '[]'::jsonb,     -- NIN/National ID/Passport (≤5 ไฟล์)
  holding_photo_url    TEXT,                          -- ภาพถือเอกสาร (1 ไฟล์)
  accepted             BOOLEAN DEFAULT false,         -- "I confirm and accept" final checkbox

  -- ── Workflow ──
  status               TEXT NOT NULL DEFAULT 'pending', -- pending|approved|paid|rejected
  approved_by          INT REFERENCES users(user_id) ON DELETE SET NULL,
  approved_at          TIMESTAMPTZ,
  paid_at              TIMESTAMPTZ,
  ref_no               TEXT,                          -- เลขอ้างอิงการโอน
  reject_reason        TEXT,
  notes                TEXT,                          -- internal note

  -- ── Meta ──
  language             TEXT DEFAULT 'en',
  ip_address           TEXT,
  user_agent           TEXT,
  created_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ibd_ewallet_status   ON ibd_ewallet_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ibd_ewallet_member   ON ibd_ewallet_requests (member_code);
CREATE INDEX IF NOT EXISTS idx_ibd_ewallet_created  ON ibd_ewallet_requests (created_at DESC);

-- ============================================================
-- 3) ibd_relocation_requests — Form 3: Changing Location Base
-- ============================================================
CREATE TABLE IF NOT EXISTS ibd_relocation_requests (
  id                   BIGSERIAL PRIMARY KEY,
  source_form          TEXT NOT NULL DEFAULT 'relocation',

  -- ── Form fields ──
  member_code          TEXT NOT NULL,
  member_name          TEXT NOT NULL,
  from_country         TEXT NOT NULL REFERENCES ibd_countries(code) ON DELETE SET NULL,
  to_country           TEXT NOT NULL REFERENCES ibd_countries(code) ON DELETE SET NULL,
  whatsapp             TEXT NOT NULL,
  email                TEXT,
  acknowledged         BOOLEAN DEFAULT false,         -- "Relocation will be processed within 7 days...Noted"
  reason               TEXT,                          -- (optional, future use)

  -- ── Workflow ──
  status               TEXT NOT NULL DEFAULT 'pending', -- pending|approved|rejected
  approved_by          INT REFERENCES users(user_id) ON DELETE SET NULL,
  approved_at          TIMESTAMPTZ,
  effective_date       DATE,
  reject_reason        TEXT,
  notes                TEXT,

  -- ── Meta ──
  language             TEXT DEFAULT 'en',
  ip_address           TEXT,
  user_agent           TEXT,
  created_at           TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ibd_relocation_status   ON ibd_relocation_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ibd_relocation_member   ON ibd_relocation_requests (member_code);
CREATE INDEX IF NOT EXISTS idx_ibd_relocation_country  ON ibd_relocation_requests (from_country, to_country);
CREATE INDEX IF NOT EXISTS idx_ibd_relocation_created  ON ibd_relocation_requests (created_at DESC);

-- ============================================================
-- 4) Storage bucket — ibd-attachments
--    เก็บไฟล์แนบของทั้ง 3 forms (path = {form}/{id}/{filename})
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ibd-attachments',
  'ibd-attachments',
  false,                                              -- private; staff อ่านผ่าน signed URL
  10485760,                                           -- 10 MB / file (ตาม Google Form เดิม)
  ARRAY[
    'image/jpeg','image/png','image/webp','image/gif',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'audio/mpeg','audio/mp4','audio/wav',
    'video/mp4','video/quicktime'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- (RLS policy — เพิ่มทีหลังเมื่อ wire portal upload)
