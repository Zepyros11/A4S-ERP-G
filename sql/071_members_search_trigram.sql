-- ============================================================
-- 071 — Trigram indexes for `members` text search
-- ------------------------------------------------------------
-- Fix: หน้า "ข้อมูลสมาชิก" ค้น "all" mode ทำ OR query 7 columns
-- × ILIKE %term% บน 107K rows → sequential scan → timeout 57014
--
-- ⚠️ วิธีรัน — รันทีละ block ใน Supabase SQL Editor
-- (อย่า paste ทั้งไฟล์ทีเดียว — editor's HTTP จะ timeout ~60 วิ
--  แล้วได้ "Failed to fetch (api.supabase.com)")
-- ============================================================

-- ── Block 1: enable extension (เร็วมาก, รันได้ทันที) ──
CREATE EXTENSION IF NOT EXISTS pg_trgm;


-- ── Block 2: full_name (รันแยก, ~10-30 วิ) ──
SET statement_timeout = '5min';
CREATE INDEX IF NOT EXISTS idx_members_full_name_trgm
  ON members USING gin (full_name gin_trgm_ops);


-- ── Block 3: member_name (รันแยก) ──
SET statement_timeout = '5min';
CREATE INDEX IF NOT EXISTS idx_members_member_name_trgm
  ON members USING gin (member_name gin_trgm_ops);


-- ── Block 4: email (รันแยก) ──
SET statement_timeout = '5min';
CREATE INDEX IF NOT EXISTS idx_members_email_trgm
  ON members USING gin (email gin_trgm_ops);


-- ── Block 5: member_code + phone (รันคู่ได้ — สั้น) ──
SET statement_timeout = '5min';
CREATE INDEX IF NOT EXISTS idx_members_member_code_trgm
  ON members USING gin (member_code gin_trgm_ops);

SET statement_timeout = '5min';
CREATE INDEX IF NOT EXISTS idx_members_phone_trgm
  ON members USING gin (phone gin_trgm_ops);


-- ── Block 6: sponsor_code + upline_code (รันคู่ได้) ──
SET statement_timeout = '5min';
CREATE INDEX IF NOT EXISTS idx_members_sponsor_code_trgm
  ON members USING gin (sponsor_code gin_trgm_ops);

SET statement_timeout = '5min';
CREATE INDEX IF NOT EXISTS idx_members_upline_code_trgm
  ON members USING gin (upline_code gin_trgm_ops);


-- ── Block 7: refresh planner statistics ──
ANALYZE members;


-- ============================================================
-- ตรวจสอบหลังรันครบ:
--   SELECT indexname FROM pg_indexes
--   WHERE tablename = 'members' AND indexname LIKE '%_trgm';
-- → ควรได้ 7 indexes
--
-- ทดสอบ:
--   EXPLAIN ANALYZE
--   SELECT member_code FROM members
--   WHERE full_name ILIKE '%ลาออก%' OR member_name ILIKE '%ลาออก%';
-- → ควรเห็น "Bitmap Index Scan on idx_members_full_name_trgm"
-- ============================================================
