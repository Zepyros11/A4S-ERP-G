-- ============================================================
-- Migration 036: member_persons view
--   Derive 1-2 attendable persons per member_code
--   - บุคคล A เดี่ยว                  → 1 row  (primary)
--   - บุคคล A + ผู้สมัครร่วม B       → 2 rows (primary, co_applicant)
--   - บริษัท X → บุคคล A             → 1 row  (primary, ใช้ full_name)
--   - บริษัท X → A + ผู้สมัครร่วม B  → 2 rows
-- ============================================================

-- DROP ก่อน — กันชน column order/name ของ view เดิม (ถ้ามี)
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
    -- บริษัท → ใช้ full_name (ชื่อบุคคลธรรมดา)
    -- บุคคล → ใช้ member_name
    -- ถ้า company แต่ full_name ว่าง → fallback เป็น member_name
    NULLIF(TRIM(
      CASE
        WHEN m.is_company THEN COALESCE(NULLIF(TRIM(m.full_name), ''), m.member_name)
        ELSE m.member_name
      END
    ), '') AS primary_name,
    NULLIF(TRIM(m.co_applicant_name), '') AS co_applicant_name
  FROM members m
)
SELECT
  member_code,
  'primary'::text       AS person_role,
  primary_name          AS person_name,
  phone, email, position_level, position, country_code, is_company
FROM base
WHERE primary_name IS NOT NULL

UNION ALL

SELECT
  member_code,
  'co_applicant'::text  AS person_role,
  co_applicant_name     AS person_name,
  NULL::text            AS phone,           -- co-applicant ไม่มีเบอร์แยกใน source
  NULL::text            AS email,
  position_level,                            -- share position กับ primary
  position,
  country_code,
  is_company
FROM base
WHERE co_applicant_name IS NOT NULL;

-- ============================================================
-- Test:
--   SELECT * FROM member_persons WHERE member_code = '0118515';
--   SELECT person_role, COUNT(*) FROM member_persons GROUP BY 1;
-- ============================================================
