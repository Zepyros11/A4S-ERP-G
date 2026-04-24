-- ============================================================
-- A4S-ERP — Test Members (mock สำหรับทดสอบ flow ฝั่ง member)
-- ใช้ schema เหมือน members เป๊ะ → register.html / LINE flow
-- สามารถสลับมาอ่าน test_members ได้ในอนาคตโดยไม่ต้องแปลง shape
-- ============================================================

CREATE TABLE IF NOT EXISTS test_members (
  member_code        TEXT PRIMARY KEY,
  registered_at      DATE,
  birth_date         DATE,

  member_name        TEXT,
  full_name          TEXT,
  phone              TEXT,
  email              TEXT,

  -- รหัสผ่าน: เก็บทั้ง encrypted (master-key) + hash (สำหรับ verify แบบ server-less)
  password_encrypted    TEXT,
  password_hash         TEXT,
  national_id_encrypted TEXT,

  co_applicant_name  TEXT,
  co_applicant_id    TEXT,

  sponsor_code       TEXT,
  upline_code        TEXT,
  side               TEXT,
  position           TEXT,
  position_level     TEXT,

  package            TEXT,
  doc_status         TEXT,
  sp_flag            TEXT,
  tn_flag            TEXT,

  member_type        TEXT,
  person_type        TEXT,
  wallet_percent     INT,
  channel            TEXT,
  nationality        TEXT,
  country_code       TEXT,

  note               TEXT,
  extra_data         JSONB,

  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_test_members_phone   ON test_members(phone);
CREATE INDEX IF NOT EXISTS idx_test_members_sponsor ON test_members(sponsor_code);
CREATE INDEX IF NOT EXISTS idx_test_members_upline  ON test_members(upline_code);
CREATE INDEX IF NOT EXISTS idx_test_members_package ON test_members(package);

DROP TRIGGER IF EXISTS trg_test_members_updated ON test_members;
CREATE TRIGGER trg_test_members_updated
  BEFORE UPDATE ON test_members
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
