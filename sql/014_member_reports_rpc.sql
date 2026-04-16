-- ============================================================
-- 014_member_reports_rpc.sql
-- RPC functions for member reports (all accept date range filter)
-- ============================================================

-- ── 1) Monthly growth (สมาชิกใหม่รายเดือน) ──
CREATE OR REPLACE FUNCTION member_report_monthly(
  p_from DATE DEFAULT '2015-01-01',
  p_to   DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE(month TEXT, cnt BIGINT) AS $$
  SELECT to_char(registered_at, 'YYYY-MM') AS month,
         COUNT(*) AS cnt
  FROM members
  WHERE registered_at BETWEEN p_from AND p_to
  GROUP BY 1 ORDER BY 1;
$$ LANGUAGE sql STABLE;

-- ── 2) Package distribution (สัดส่วน Package) ──
CREATE OR REPLACE FUNCTION member_report_package(
  p_from DATE DEFAULT '2015-01-01',
  p_to   DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE(package TEXT, cnt BIGINT) AS $$
  SELECT COALESCE(package, 'N/A') AS package,
         COUNT(*) AS cnt
  FROM members
  WHERE registered_at BETWEEN p_from AND p_to
  GROUP BY 1 ORDER BY cnt DESC;
$$ LANGUAGE sql STABLE;

-- ── 3) Country distribution (สมาชิกตามประเทศ) ──
CREATE OR REPLACE FUNCTION member_report_country(
  p_from DATE DEFAULT '2015-01-01',
  p_to   DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE(country_code TEXT, cnt BIGINT) AS $$
  SELECT COALESCE(country_code, 'N/A') AS country_code,
         COUNT(*) AS cnt
  FROM members
  WHERE registered_at BETWEEN p_from AND p_to
  GROUP BY 1 ORDER BY cnt DESC;
$$ LANGUAGE sql STABLE;

-- ── 4) Top Sponsors (ใครแนะนำเยอะสุด) ──
CREATE OR REPLACE FUNCTION member_report_top_sponsors(
  p_from  DATE DEFAULT '2015-01-01',
  p_to    DATE DEFAULT CURRENT_DATE,
  p_limit INT  DEFAULT 20
)
RETURNS TABLE(sponsor_code TEXT, sponsor_name TEXT, cnt BIGINT) AS $$
  SELECT m.sponsor_code,
         COALESCE(s.full_name, s.member_name, '—') AS sponsor_name,
         COUNT(*) AS cnt
  FROM members m
  LEFT JOIN members s ON s.member_code = m.sponsor_code
  WHERE m.registered_at BETWEEN p_from AND p_to
    AND m.sponsor_code IS NOT NULL
    AND m.sponsor_code <> ''
  GROUP BY m.sponsor_code, sponsor_name
  ORDER BY cnt DESC
  LIMIT p_limit;
$$ LANGUAGE sql STABLE;

-- ── 5) Top Uplines (ใครมี downline เยอะสุด) ──
CREATE OR REPLACE FUNCTION member_report_top_uplines(
  p_from  DATE DEFAULT '2015-01-01',
  p_to    DATE DEFAULT CURRENT_DATE,
  p_limit INT  DEFAULT 20
)
RETURNS TABLE(upline_code TEXT, upline_name TEXT, cnt BIGINT) AS $$
  SELECT m.upline_code,
         COALESCE(u.full_name, u.member_name, '—') AS upline_name,
         COUNT(*) AS cnt
  FROM members m
  LEFT JOIN members u ON u.member_code = m.upline_code
  WHERE m.registered_at BETWEEN p_from AND p_to
    AND m.upline_code IS NOT NULL
    AND m.upline_code <> ''
  GROUP BY m.upline_code, upline_name
  ORDER BY cnt DESC
  LIMIT p_limit;
$$ LANGUAGE sql STABLE;

-- ── 6) Side balance (ซ้าย vs ขวา) ──
CREATE OR REPLACE FUNCTION member_report_side(
  p_from DATE DEFAULT '2015-01-01',
  p_to   DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE(side TEXT, cnt BIGINT) AS $$
  SELECT COALESCE(side, 'N/A') AS side,
         COUNT(*) AS cnt
  FROM members
  WHERE registered_at BETWEEN p_from AND p_to
  GROUP BY 1 ORDER BY 1;
$$ LANGUAGE sql STABLE;

-- ── 7) Channel distribution (Branch vs System) ──
CREATE OR REPLACE FUNCTION member_report_channel(
  p_from DATE DEFAULT '2015-01-01',
  p_to   DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE(channel TEXT, cnt BIGINT) AS $$
  SELECT COALESCE(channel, 'N/A') AS channel,
         COUNT(*) AS cnt
  FROM members
  WHERE registered_at BETWEEN p_from AND p_to
  GROUP BY 1 ORDER BY cnt DESC;
$$ LANGUAGE sql STABLE;

-- ── 8) Growth by Country (รายเดือน แยกตามประเทศ) ──
CREATE OR REPLACE FUNCTION member_report_growth_by_country(
  p_from DATE DEFAULT '2015-01-01',
  p_to   DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE(month TEXT, country_code TEXT, cnt BIGINT) AS $$
  SELECT to_char(registered_at, 'YYYY-MM') AS month,
         COALESCE(country_code, 'N/A') AS country_code,
         COUNT(*) AS cnt
  FROM members
  WHERE registered_at BETWEEN p_from AND p_to
  GROUP BY 1, 2 ORDER BY 1, 2;
$$ LANGUAGE sql STABLE;
