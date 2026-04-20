-- ============================================================
-- Migration 029: RPC function for distinct member countries
--   ใช้สำหรับ populate dropdown filter ประเทศใน members-list
-- ============================================================

CREATE OR REPLACE FUNCTION member_countries()
RETURNS TABLE(code text, cnt int)
LANGUAGE sql STABLE
AS $$
  SELECT
    COALESCE(country_code, '')::text AS code,
    COUNT(*)::int                     AS cnt
  FROM members
  WHERE member_code <> '1'
    AND country_code IS NOT NULL
    AND country_code <> ''
  GROUP BY country_code
  ORDER BY COUNT(*) DESC, country_code ASC;
$$;

-- ============================================================
-- DONE ✅
-- Test:
--   SELECT * FROM member_countries();
-- ============================================================
