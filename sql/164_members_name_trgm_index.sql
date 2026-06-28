-- ============================================================
-- Migration 164: pg_trgm GIN indexes for fast member NAME search
--   ปัญหา: ค้นสมาชิกด้วย "ชื่อ" (ilike '*x*') ผ่าน view member_persons
--          → person_name เป็น computed column (CASE/TRIM/UNION) ใช้ index ไม่ได้
--          → full-scan members ทั้งหมด → ช้าเกิน statement timeout → HTTP 500
--   แก้: ทำ trigram index บนคอลัมน์จริงของ members แล้วให้ client ค้นจาก members ตรงๆ
--        (ilike '*x*' แบบ leading-wildcard ใช้ GIN trigram index ได้)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ค้นชื่อบุคคล/บริษัท (primary) + ชื่อบริษัทเต็ม (company) + ผู้สมัครร่วม
CREATE INDEX IF NOT EXISTS idx_members_member_name_trgm
  ON members USING gin (member_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_members_full_name_trgm
  ON members USING gin (full_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_members_co_applicant_name_trgm
  ON members USING gin (co_applicant_name gin_trgm_ops);

-- ============================================================
-- ตรวจสอบว่าใช้ index จริง (ควรเห็น Bitmap Index Scan ... _trgm):
--   EXPLAIN ANALYZE
--   SELECT member_code, member_name FROM members
--   WHERE member_name ILIKE '%ฤชาภร%'
--      OR full_name ILIKE '%ฤชาภร%'
--      OR co_applicant_name ILIKE '%ฤชาภร%';
-- ============================================================
