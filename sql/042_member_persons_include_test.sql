-- ============================================================
-- Migration 042: Include test_members ใน view member_persons
--   attendees.html ใช้ view นี้ search สมาชิกเข้าลงทะเบียน
--   ขยายให้ UNION ALL กับ test_members (mock) → search หาเจอทั้งคู่
-- ============================================================

DROP VIEW IF EXISTS member_persons CASCADE;

CREATE VIEW member_persons AS
WITH base AS (
  SELECT
    m.member_code,
    m.is_company,
    m.phone,
    m.email,
    m.position_level,
    m.position,
    m.country_code,
    NULLIF(TRIM(
      CASE
        WHEN m.is_company THEN COALESCE(NULLIF(TRIM(m.full_name), ''), m.member_name)
        ELSE m.member_name
      END
    ), '') AS primary_name,
    NULLIF(TRIM(m.co_applicant_name), '') AS co_applicant_name
  FROM members m
),
base_test AS (
  SELECT
    t.member_code,
    FALSE::boolean       AS is_company,    -- test = personal เสมอ
    t.phone,
    t.email,
    t.position_level,
    t.position,
    t.country_code,
    NULLIF(TRIM(COALESCE(t.member_name, t.full_name)), '') AS primary_name,
    NULLIF(TRIM(t.co_applicant_name), '')                  AS co_applicant_name
  FROM test_members t
)
-- ── MLM primary ──
SELECT
  member_code,
  'primary'::text  AS person_role,
  primary_name     AS person_name,
  phone, email, position_level, position, country_code, is_company
FROM base
WHERE primary_name IS NOT NULL

UNION ALL

-- ── MLM co-applicant ──
SELECT
  member_code,
  'co_applicant'::text AS person_role,
  co_applicant_name    AS person_name,
  NULL::text, NULL::text, position_level, position, country_code, is_company
FROM base
WHERE co_applicant_name IS NOT NULL

UNION ALL

-- ── TEST primary ──
SELECT
  member_code,
  'primary'::text  AS person_role,
  primary_name     AS person_name,
  phone, email, position_level, position, country_code, is_company
FROM base_test
WHERE primary_name IS NOT NULL

UNION ALL

-- ── TEST co-applicant ──
SELECT
  member_code,
  'co_applicant'::text AS person_role,
  co_applicant_name    AS person_name,
  NULL::text, NULL::text, position_level, position, country_code, is_company
FROM base_test
WHERE co_applicant_name IS NOT NULL;

-- ============================================================
-- Test:
--   SELECT person_role, COUNT(*) FROM member_persons GROUP BY 1;
--   SELECT * FROM member_persons WHERE member_code = '1234';  -- test member
-- ============================================================
