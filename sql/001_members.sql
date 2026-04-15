-- ============================================================
-- A4S-ERP — Member Management Schema
-- Run this in Supabase SQL Editor
-- ============================================================

-- ── Drop (safe re-run) ──
-- DROP TABLE IF EXISTS sync_log CASCADE;
-- DROP TABLE IF EXISTS sync_config CASCADE;
-- DROP TABLE IF EXISTS members CASCADE;

-- ============================================================
-- 1) MEMBERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS members (
  -- Primary & dates
  member_code        TEXT PRIMARY KEY,
  registered_at      DATE,
  birth_date         DATE,

  -- Identity
  member_name        TEXT,
  full_name          TEXT,
  phone              TEXT,
  email              TEXT,

  -- ⚠️ Encrypted (AES-GCM client-side, base64 ciphertext)
  password_encrypted   TEXT,
  national_id_encrypted TEXT,

  -- Co-applicant
  co_applicant_name  TEXT,
  co_applicant_id    TEXT,

  -- MLM structure
  sponsor_code       TEXT,
  upline_code        TEXT,
  side               TEXT,          -- ซ้าย / ขวา
  position           TEXT,
  position_level     TEXT,

  -- Package & status
  package            TEXT,          -- DM / SI / PL / MB / EM
  doc_status         TEXT,
  sp_flag            TEXT,
  tn_flag            TEXT,

  -- Classification
  member_type        TEXT,          -- IBO, etc.
  person_type        TEXT,          -- บุคคลธรรมดา / นิติบุคคล
  wallet_percent     INT,
  channel            TEXT,          -- Branch / System
  nationality        TEXT,          -- Thai / Cambodian
  country_code       TEXT,          -- TH / KH (= LB column)

  -- Raw data (เก็บ column ที่ยังไม่ได้ map)
  extra_data         JSONB,

  -- Sync metadata
  source_file        TEXT,
  imported_at        TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);

-- ── Indexes ──
CREATE INDEX IF NOT EXISTS idx_members_sponsor   ON members(sponsor_code);
CREATE INDEX IF NOT EXISTS idx_members_upline    ON members(upline_code);
CREATE INDEX IF NOT EXISTS idx_members_reg_date  ON members(registered_at);
CREATE INDEX IF NOT EXISTS idx_members_phone     ON members(phone);
CREATE INDEX IF NOT EXISTS idx_members_country   ON members(country_code);
CREATE INDEX IF NOT EXISTS idx_members_package   ON members(package);

-- ── Auto-update updated_at ──
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_members_updated ON members;
CREATE TRIGGER trg_members_updated
  BEFORE UPDATE ON members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ============================================================
-- 2) SYNC CONFIG (single row — ตั้งค่า auto sync)
-- ============================================================
CREATE TABLE IF NOT EXISTS sync_config (
  id                    INT PRIMARY KEY DEFAULT 1,
  enabled               BOOLEAN DEFAULT false,
  frequency             TEXT DEFAULT '24h',   -- '1h' | '6h' | '24h' | 'weekly'
  username_encrypted    TEXT,                 -- answerforsuccess username
  password_encrypted    TEXT,                 -- answerforsuccess password
  last_sync_at          TIMESTAMPTZ,
  next_sync_at          TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT single_row CHECK (id = 1)
);

-- Seed one row
INSERT INTO sync_config (id, enabled, frequency)
VALUES (1, false, '24h')
ON CONFLICT (id) DO NOTHING;


-- ============================================================
-- 3) SYNC LOG (ประวัติการ sync แต่ละครั้ง)
-- ============================================================
CREATE TABLE IF NOT EXISTS sync_log (
  id               SERIAL PRIMARY KEY,
  source           TEXT,                     -- 'manual_import' | 'auto_sync' | 'sync_now'
  started_at       TIMESTAMPTZ DEFAULT now(),
  finished_at      TIMESTAMPTZ,
  duration_sec     INT,
  rows_total       INT,
  rows_inserted    INT,
  rows_updated     INT,
  rows_failed      INT,
  status           TEXT,                     -- 'running' | 'success' | 'partial' | 'failed'
  error_message    TEXT,
  file_name        TEXT,
  triggered_by     TEXT                      -- user_id หรือ 'system'
);

CREATE INDEX IF NOT EXISTS idx_sync_log_started ON sync_log(started_at DESC);


-- ============================================================
-- 4) PERMISSIONS (ไม่ต้องรัน — แค่อ้างอิงว่ามี perms ใหม่)
-- ============================================================
-- member_view, member_import, member_export,
-- member_edit, member_delete, member_decrypt
-- (ไปเพิ่มในหน้าจัดการ Role ให้แต่ละ user ได้)

-- ============================================================
-- DONE ✅
-- ============================================================
