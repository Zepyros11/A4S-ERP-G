-- ============================================================
-- Migration 006: v_top_sponsors returns raw fields
--   (display name logic moved to JS via window.MemberFmt
--    ที่ทุก page ใช้ไอรูปแบบเดียวกัน — ง่ายต่อ maintain + ไม่มี regex ใน SQL)
-- ============================================================

DROP VIEW IF EXISTS v_top_sponsors;
CREATE VIEW v_top_sponsors AS
SELECT
  m.sponsor_code,
  COUNT(*) AS downline_count,
  s.member_name AS sponsor_member_name,
  s.full_name   AS sponsor_full_name,
  s.country_code AS sponsor_country
FROM members m
LEFT JOIN members s ON s.member_code = m.sponsor_code
WHERE m.sponsor_code IS NOT NULL
  AND m.sponsor_code != ''
GROUP BY m.sponsor_code, s.full_name, s.member_name, s.country_code
ORDER BY downline_count DESC
LIMIT 10;

-- ============================================================
-- DONE ✅
-- Test:  SELECT * FROM v_top_sponsors;
-- ============================================================
