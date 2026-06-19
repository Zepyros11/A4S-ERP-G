-- ============================================================
-- Migration 149: Campaign Review Planning
--
-- Why:
--   หน้าใหม่ในกลุ่ม Event สำหรับวางแผน/บริหาร "campaign รีวิวสินค้า"
--   สมาชิก (member) ลงทะเบียน → ผูก ID TikTok/IG/Facebook → ทำ mission
--   (รีวิวสินค้า) โดยแต่ละงานผูกกับ link โพสต์ → เก็บยอดวิว/ยอด like
--   ของแต่ละแพลตฟอร์ม → จัดอันดับ (rank)
--
--   4 ตาราง:
--     campaigns             — ตัว campaign (สื่อ ≤5, ช่วงเวลา, แพลตฟอร์ม, วิธีจัดอันดับ)
--     campaign_missions     — ภารกิจย่อยในแต่ละ campaign (ถ่วงน้ำหนัก points)
--     campaign_participants — ผู้เข้าร่วม (members-only) + โซเชียลที่ผูก
--     campaign_submissions  — ผลงาน 1 โพสต์ = 1 แถว + metrics (views/likes/...)
--                             *** staff กรอกยอดเอง (ไม่ดึง API) ***
--   + view campaign_participant_scores — รวมยอดต่อ participant สำหรับอันดับ
--
--   public_token = ลิงก์ลงทะเบียนแบบ public (privacy = token เดาไม่ได้
--   เหมือน Ticket Portal) — ไม่เปิด RLS (สอดคล้องกับตารางอื่นที่ anon เข้าถึงได้)
--
-- Idempotent — รันซ้ำได้
-- ============================================================

-- ── campaigns ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaigns (
  campaign_id   SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT,
  cover_url     TEXT,
  media         JSONB       DEFAULT '[]'::jsonb,   -- [{url, type:'image'|'video', name}]  (UI บังคับ ≤5)
  start_date    DATE,
  end_date      DATE,
  status        TEXT        DEFAULT 'DRAFT',        -- DRAFT | ACTIVE | ENDED | CANCELLED
  platforms     JSONB       DEFAULT '["tiktok","instagram","facebook"]'::jsonb,
  rank_metric   TEXT        DEFAULT 'views',        -- views | likes | engagement | weighted
  reg_open      BOOLEAN     DEFAULT true,
  public_token  TEXT UNIQUE,
  reward        TEXT,
  created_by    TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE campaigns ADD CONSTRAINT campaigns_status_chk
    CHECK (status IN ('DRAFT','ACTIVE','ENDED','CANCELLED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE campaigns ADD CONSTRAINT campaigns_rank_metric_chk
    CHECK (rank_metric IN ('views','likes','engagement','weighted'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── campaign_missions ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaign_missions (
  mission_id   SERIAL PRIMARY KEY,
  campaign_id  INTEGER NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT,
  platform     TEXT,                  -- tiktok | instagram | facebook | NULL(=any)
  points       NUMERIC DEFAULT 1,     -- ถ่วงน้ำหนักสำหรับ rank_metric = 'weighted'
  sort_order   INTEGER DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_campaign_missions_cid ON campaign_missions(campaign_id);

-- ── campaign_participants ───────────────────────────────────
CREATE TABLE IF NOT EXISTS campaign_participants (
  participant_id SERIAL PRIMARY KEY,
  campaign_id    INTEGER NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
  member_code    TEXT NOT NULL,
  member_name    TEXT,                -- snapshot ตอนลงทะเบียน
  phone          TEXT,
  tiktok_id      TEXT,
  tiktok_url     TEXT,
  ig_id          TEXT,
  ig_url         TEXT,
  facebook_id    TEXT,
  facebook_url   TEXT,
  status         TEXT DEFAULT 'pending',   -- pending | approved | rejected
  source         TEXT DEFAULT 'staff',     -- public | staff
  note           TEXT,
  joined_at      TIMESTAMPTZ DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE campaign_participants ADD CONSTRAINT campaign_participants_status_chk
    CHECK (status IN ('pending','approved','rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE campaign_participants ADD CONSTRAINT campaign_participants_source_chk
    CHECK (source IN ('public','staff'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 1 สมาชิก ต่อ 1 campaign = 1 แถว
CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_participant
  ON campaign_participants(campaign_id, member_code);
CREATE INDEX IF NOT EXISTS idx_campaign_participants_cid ON campaign_participants(campaign_id);

-- ── campaign_submissions ────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaign_submissions (
  submission_id  SERIAL PRIMARY KEY,
  campaign_id    INTEGER NOT NULL REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES campaign_participants(participant_id) ON DELETE CASCADE,
  mission_id     INTEGER REFERENCES campaign_missions(mission_id) ON DELETE SET NULL,
  platform       TEXT NOT NULL,        -- tiktok | instagram | facebook
  post_url       TEXT NOT NULL,
  views          INTEGER DEFAULT 0,    -- staff กรอกเอง
  likes          INTEGER DEFAULT 0,    -- staff กรอกเอง
  comments       INTEGER DEFAULT 0,    -- staff กรอกเอง
  shares         INTEGER DEFAULT 0,    -- staff กรอกเอง
  proof_url      TEXT,                 -- screenshot ยอด (หลักฐานประกอบการกรอก)
  status         TEXT DEFAULT 'pending',-- pending | approved | rejected
  submitted_at   TIMESTAMPTZ DEFAULT now(),
  verified_at    TIMESTAMPTZ,
  verified_by    TEXT
);

DO $$ BEGIN
  ALTER TABLE campaign_submissions ADD CONSTRAINT campaign_submissions_platform_chk
    CHECK (platform IN ('tiktok','instagram','facebook'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE campaign_submissions ADD CONSTRAINT campaign_submissions_status_chk
    CHECK (status IN ('pending','approved','rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_campaign_submissions_cid ON campaign_submissions(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_submissions_pid ON campaign_submissions(participant_id);

-- ── view: คะแนนรวมต่อ participant (เฉพาะ submissions ที่ approved) ──
-- (weighted ranking ที่ใช้ mission.points คำนวณใน JS — view นี้สำหรับยอดดิบ)
CREATE OR REPLACE VIEW campaign_participant_scores AS
SELECT p.participant_id,
       p.campaign_id,
       p.member_code,
       p.member_name,
       p.status AS participant_status,
       COALESCE(SUM(s.views), 0)    AS total_views,
       COALESCE(SUM(s.likes), 0)    AS total_likes,
       COALESCE(SUM(s.comments), 0) AS total_comments,
       COALESCE(SUM(s.shares), 0)   AS total_shares,
       COUNT(s.submission_id)       AS approved_posts
FROM campaign_participants p
LEFT JOIN campaign_submissions s
       ON s.participant_id = p.participant_id
      AND s.status = 'approved'
GROUP BY p.participant_id, p.campaign_id, p.member_code, p.member_name, p.status;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅  Verify:
--   SELECT campaign_id, name, status, rank_metric, public_token FROM campaigns;
--   SELECT * FROM campaign_participant_scores;
-- ============================================================
