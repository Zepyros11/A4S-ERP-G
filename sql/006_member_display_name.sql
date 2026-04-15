-- ============================================================
-- Migration 006: Update views to use proper display name logic
--   Rule: if member_name is company (บริษัท/จำกัด/หจก/...)
--         AND full_name is not empty → use full_name (real person)
--         else → use member_name
-- ============================================================

-- Regex for company-style names
-- Postgres uses POSIX regex (similar to JS but no /i flag — use ~* for case-insensitive)
-- Note: Thai chars are case-insensitive by nature

DROP VIEW IF EXISTS v_top_sponsors;
CREATE VIEW v_top_sponsors AS
SELECT
  m.sponsor_code,
  COUNT(*) AS downline_count,
  CASE
    WHEN s.member_name ~* '(บริษัท|จำกัด|ห้างหุ้นส่วน|หจก|บจก|กรุ๊ป|กลุ่ม|มูลนิธิ|สมาคม|ร้าน|Co\.|Ltd|Inc|LLC|Corp|Group)'
         AND COALESCE(NULLIF(s.full_name, ''), '') != ''
    THEN s.full_name
    ELSE COALESCE(NULLIF(s.member_name, ''), NULLIF(s.full_name, ''))
  END AS sponsor_name,
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
