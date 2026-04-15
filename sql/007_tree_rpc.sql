-- ============================================================
-- Migration 007: RPC functions for fast tree queries
--   - Upline chain via recursive CTE (1 query vs N round-trips)
--   - Direct downline with child counts (avoid N+1 problem)
-- ============================================================

-- ── Upline chain (Sponsor or Upline field) ──
-- Returns the chain from start_code up to root in single query
CREATE OR REPLACE FUNCTION get_chain_up(start_code TEXT, field_name TEXT)
RETURNS TABLE (
  member_code TEXT,
  member_name TEXT,
  full_name TEXT,
  country_code TEXT,
  package TEXT,
  side TEXT,
  registered_at DATE,
  sponsor_code TEXT,
  upline_code TEXT,
  level INT
) AS $$
BEGIN
  IF field_name = 'sponsor_code' THEN
    RETURN QUERY
    WITH RECURSIVE chain AS (
      SELECT m.member_code, m.member_name, m.full_name, m.country_code,
             m.package, m.side, m.registered_at, m.sponsor_code, m.upline_code,
             0 AS level
      FROM members m
      WHERE m.member_code = start_code
      UNION ALL
      SELECT m.member_code, m.member_name, m.full_name, m.country_code,
             m.package, m.side, m.registered_at, m.sponsor_code, m.upline_code,
             c.level + 1
      FROM members m
      JOIN chain c ON m.member_code = c.sponsor_code
      WHERE c.level < 30
        AND c.sponsor_code IS NOT NULL
        AND c.sponsor_code != ''
    )
    SELECT chain.member_code, chain.member_name, chain.full_name, chain.country_code,
           chain.package, chain.side, chain.registered_at, chain.sponsor_code, chain.upline_code,
           chain.level
    FROM chain
    ORDER BY chain.level;
  ELSE
    RETURN QUERY
    WITH RECURSIVE chain AS (
      SELECT m.member_code, m.member_name, m.full_name, m.country_code,
             m.package, m.side, m.registered_at, m.sponsor_code, m.upline_code,
             0 AS level
      FROM members m
      WHERE m.member_code = start_code
      UNION ALL
      SELECT m.member_code, m.member_name, m.full_name, m.country_code,
             m.package, m.side, m.registered_at, m.sponsor_code, m.upline_code,
             c.level + 1
      FROM members m
      JOIN chain c ON m.member_code = c.upline_code
      WHERE c.level < 30
        AND c.upline_code IS NOT NULL
        AND c.upline_code != ''
    )
    SELECT chain.member_code, chain.member_name, chain.full_name, chain.country_code,
           chain.package, chain.side, chain.registered_at, chain.sponsor_code, chain.upline_code,
           chain.level
    FROM chain
    ORDER BY chain.level;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- ── Direct downline + child count (avoid N+1 round-trips) ──
CREATE OR REPLACE FUNCTION get_direct_downline(parent_code TEXT, field_name TEXT)
RETURNS TABLE (
  member_code TEXT,
  member_name TEXT,
  full_name TEXT,
  country_code TEXT,
  package TEXT,
  side TEXT,
  registered_at DATE,
  sponsor_code TEXT,
  upline_code TEXT,
  child_count BIGINT
) AS $$
BEGIN
  IF field_name = 'sponsor_code' THEN
    RETURN QUERY
    SELECT m.member_code, m.member_name, m.full_name, m.country_code,
           m.package, m.side, m.registered_at, m.sponsor_code, m.upline_code,
           (SELECT COUNT(*) FROM members c WHERE c.sponsor_code = m.member_code) AS child_count
    FROM members m
    WHERE m.sponsor_code = parent_code
    ORDER BY m.registered_at ASC NULLS LAST
    LIMIT 1000;
  ELSE
    RETURN QUERY
    SELECT m.member_code, m.member_name, m.full_name, m.country_code,
           m.package, m.side, m.registered_at, m.sponsor_code, m.upline_code,
           (SELECT COUNT(*) FROM members c WHERE c.upline_code = m.member_code) AS child_count
    FROM members m
    WHERE m.upline_code = parent_code
    ORDER BY m.side ASC NULLS LAST, m.registered_at ASC NULLS LAST
    LIMIT 1000;
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- DONE ✅
-- Test:
--   SELECT * FROM get_chain_up('34167', 'sponsor_code');
--   SELECT * FROM get_direct_downline('34167', 'sponsor_code');
-- ============================================================
