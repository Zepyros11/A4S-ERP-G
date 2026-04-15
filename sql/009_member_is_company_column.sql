-- ============================================================
-- Migration 009: Add stored is_company column for fast queries
--   - Replaces the slow regex-based view filter
--   - Uses generated column (auto-updated on INSERT/UPDATE)
-- ============================================================

-- 1️⃣ Drop old views that depend on the regex (will recreate below)
DROP VIEW IF EXISTS v_data_quality_summary;
DROP VIEW IF EXISTS v_member_data_quality;

-- 2️⃣ Drop old functional index (no longer needed)
DROP INDEX IF EXISTS idx_members_is_company;

-- 3️⃣ Add is_company as STORED generated column (computed once, then indexed)
ALTER TABLE members DROP COLUMN IF EXISTS is_company;
ALTER TABLE members ADD COLUMN is_company BOOLEAN
  GENERATED ALWAYS AS (
    (member_name ~* '(บริษัท|จำกัด|ห้างหุ้นส่วน|หจก|บจก|ห้างฯ|มูลนิธิ|สมาคม|กรุ๊ป|กลุ่ม|ร้าน|โรงงาน|Co\.|Ltd|Inc\.|LLC|Corporation|Corp\.|Group)')
  ) STORED;

-- 4️⃣ Index for fast WHERE is_company = true
CREATE INDEX IF NOT EXISTS idx_members_is_company ON members (is_company);

-- 5️⃣ Recreate data-quality views (fast now — uses column not regex)
CREATE OR REPLACE VIEW v_member_data_quality AS
SELECT
  m.*,
  (m.full_name IS NULL OR trim(m.full_name) = '') AS full_name_empty,
  (m.phone IS NULL OR trim(m.phone) = '')         AS phone_empty
FROM members m
WHERE m.member_code NOT IN ('1');

CREATE OR REPLACE VIEW v_data_quality_summary AS
SELECT
  COUNT(*)::int                                                                                         AS total,
  COUNT(*) FILTER (WHERE is_company)::int                                                               AS company_count,
  COUNT(*) FILTER (WHERE NOT is_company)::int                                                           AS individual_count,
  COUNT(*) FILTER (WHERE is_company AND (full_name IS NULL OR trim(full_name) = ''))::int              AS company_missing_fullname,
  COUNT(*) FILTER (WHERE full_name IS NULL OR trim(full_name) = '')::int                               AS any_missing_fullname,
  COUNT(*) FILTER (WHERE phone IS NULL OR trim(phone) = '')::int                                        AS missing_phone
FROM members
WHERE member_code <> '1';

-- ============================================================
-- DONE ✅
-- Test:
--   SELECT * FROM v_data_quality_summary;            -- should return instantly
--   SELECT COUNT(*) FROM members WHERE is_company;   -- uses index
-- ============================================================
