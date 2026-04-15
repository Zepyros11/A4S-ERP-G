-- ============================================================
-- Migration 008: Member data quality views
--   - Company-name detection (mirrors js/core/member-format.js regex)
--   - Flag members with company name but empty full_name
-- ============================================================

-- ── Per-row quality flags ──
CREATE OR REPLACE VIEW v_member_data_quality AS
SELECT
  m.*,
  (m.member_name ~* '(บริษัท|จำกัด|ห้างหุ้นส่วน|หจก|บจก|ห้างฯ|มูลนิธิ|สมาคม|กรุ๊ป|กลุ่ม|ร้าน|โรงงาน|Co\.|Ltd|Inc\.|LLC|Corporation|Corp\.|Group)') AS is_company,
  (m.full_name IS NULL OR trim(m.full_name) = '')                                                                                                    AS full_name_empty,
  (m.phone IS NULL OR trim(m.phone) = '')                                                                                                            AS phone_empty,
  (m.email IS NULL OR trim(m.email) = '')                                                                                                            AS email_empty,
  (m.national_id_encrypted IS NULL OR trim(m.national_id_encrypted) = '')                                                                            AS national_id_empty
FROM members m
WHERE m.member_code NOT IN ('1');

-- ── Aggregate summary (single row) ──
CREATE OR REPLACE VIEW v_data_quality_summary AS
SELECT
  COUNT(*)::int                                                                                                 AS total,
  COUNT(*) FILTER (WHERE is_company)::int                                                                       AS company_count,
  COUNT(*) FILTER (WHERE NOT is_company)::int                                                                   AS individual_count,
  COUNT(*) FILTER (WHERE is_company AND full_name_empty)::int                                                   AS company_missing_fullname,
  COUNT(*) FILTER (WHERE full_name_empty)::int                                                                  AS any_missing_fullname,
  COUNT(*) FILTER (WHERE phone_empty)::int                                                                      AS missing_phone,
  COUNT(*) FILTER (WHERE email_empty)::int                                                                      AS missing_email,
  COUNT(*) FILTER (WHERE national_id_empty)::int                                                                AS missing_national_id
FROM v_member_data_quality;

-- ── Optional functional index to speed up regex scan ──
CREATE INDEX IF NOT EXISTS idx_members_is_company
  ON members ((member_name ~* '(บริษัท|จำกัด|ห้างหุ้นส่วน|หจก|บจก|ห้างฯ|มูลนิธิ|สมาคม|กรุ๊ป|กลุ่ม|ร้าน|โรงงาน|Co\.|Ltd|Inc\.|LLC|Corporation|Corp\.|Group)'));

-- ============================================================
-- DONE ✅
-- Test:
--   SELECT * FROM v_data_quality_summary;
--   SELECT member_code, member_name, country_code, package, registered_at
--     FROM v_member_data_quality
--     WHERE is_company AND full_name_empty
--     LIMIT 20;
-- ============================================================
