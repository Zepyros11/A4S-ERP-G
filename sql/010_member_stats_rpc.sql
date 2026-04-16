-- ============================================================
-- Migration 010: RPC function for member stats (fast, single query)
--   Replaces 4 separate count queries that cause statement timeout
-- ============================================================

-- 1️⃣ Exact stats (single table scan — much faster than 4 separate counts)
CREATE OR REPLACE FUNCTION member_stats()
RETURNS JSON
LANGUAGE sql STABLE
AS $$
  SELECT json_build_object(
    'total',     COUNT(*)::int,
    'th',        COUNT(*) FILTER (WHERE country_code = 'TH')::int,
    'kh',        COUNT(*) FILTER (WHERE country_code = 'KH')::int,
    'this_year', COUNT(*) FILTER (WHERE registered_at >= date_trunc('year', CURRENT_DATE))::int
  )
  FROM members
  WHERE member_code <> '1';
$$;

-- 2️⃣ Fast approximate stats (uses pg_class reltuples — instant, no scan)
CREATE OR REPLACE FUNCTION member_stats_fast()
RETURNS JSON
LANGUAGE sql STABLE
AS $$
  SELECT json_build_object(
    'total', COALESCE(c.reltuples, 0)::int
  )
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname = 'members' AND n.nspname = 'public';
$$;

-- ============================================================
-- DONE ✅
-- Test:
--   SELECT member_stats();
--   SELECT member_stats_fast();
-- ============================================================
