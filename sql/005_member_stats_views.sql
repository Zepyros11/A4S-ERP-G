-- ============================================================
-- Migration 005: Aggregation views for Dashboard stats
-- All read-only — no data changes, just convenience for charts
-- ============================================================

-- ── 1) Country split ──
CREATE OR REPLACE VIEW v_members_country_count AS
SELECT
  COALESCE(NULLIF(country_code, ''), 'OTHER') AS country_code,
  COUNT(*) AS count
FROM members
GROUP BY 1
ORDER BY count DESC;

-- ── 2) Package mix ──
CREATE OR REPLACE VIEW v_members_package_count AS
SELECT
  COALESCE(NULLIF(package, ''), 'OTHER') AS package,
  COUNT(*) AS count
FROM members
GROUP BY 1
ORDER BY count DESC;

-- ── 3) Monthly signups (last 24 months) ──
CREATE OR REPLACE VIEW v_members_monthly_signups AS
SELECT
  TO_CHAR(registered_at, 'YYYY-MM') AS month,
  COUNT(*) AS count
FROM members
WHERE registered_at IS NOT NULL
  AND registered_at >= (CURRENT_DATE - INTERVAL '24 months')
GROUP BY month
ORDER BY month;

-- ── 4) Top 10 sponsors (downline counts) ──
-- ใช้ COALESCE: full_name → member_name (เพราะ Excel บางคนไม่กรอก full_name)
CREATE OR REPLACE VIEW v_top_sponsors AS
SELECT
  m.sponsor_code,
  COUNT(*) AS downline_count,
  COALESCE(NULLIF(s.full_name, ''), NULLIF(s.member_name, '')) AS sponsor_name,
  s.country_code AS sponsor_country
FROM members m
LEFT JOIN members s ON s.member_code = m.sponsor_code
WHERE m.sponsor_code IS NOT NULL
  AND m.sponsor_code != ''
GROUP BY m.sponsor_code, s.full_name, s.member_name, s.country_code
ORDER BY downline_count DESC
LIMIT 10;

-- ── 5) Year-over-year growth (yearly) ──
CREATE OR REPLACE VIEW v_members_yearly_signups AS
SELECT
  EXTRACT(YEAR FROM registered_at)::INT AS year,
  COUNT(*) AS count
FROM members
WHERE registered_at IS NOT NULL
GROUP BY year
ORDER BY year;

-- ============================================================
-- DONE ✅
-- Test:
--   SELECT * FROM v_members_country_count;
--   SELECT * FROM v_members_package_count;
--   SELECT * FROM v_members_monthly_signups;
--   SELECT * FROM v_top_sponsors;
--   SELECT * FROM v_members_yearly_signups;
-- ============================================================
