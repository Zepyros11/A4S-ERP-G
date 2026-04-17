-- ============================================================
-- 015_quality_stats_rpc.sql
-- Replace slow v_data_quality_summary view with fast RPC
-- Uses is_company stored column + index from 009
-- ============================================================

CREATE OR REPLACE FUNCTION member_quality_stats()
RETURNS JSON AS $$
  SELECT json_build_object(
    'total',                    COUNT(*)::int,
    'company_count',            COUNT(*) FILTER (WHERE is_company)::int,
    'individual_count',         COUNT(*) FILTER (WHERE NOT is_company)::int,
    'company_missing_fullname', COUNT(*) FILTER (WHERE is_company AND (full_name IS NULL OR trim(full_name) = ''))::int,
    'missing_phone',            COUNT(*) FILTER (WHERE phone IS NULL OR trim(phone) = '')::int
  )
  FROM members
  WHERE member_code <> '1';
$$ LANGUAGE sql STABLE;
