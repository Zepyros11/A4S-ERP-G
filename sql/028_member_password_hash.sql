-- ============================================================
-- 028: Member password hash (for verification without master key)
--
-- ทำไม:
--   password_encrypted ใช้ AES-GCM + master key (client-side)
--   → verify ได้เฉพาะอุปกรณ์ที่ตั้ง master key (desktop admin)
--   → ฝั่ง member (มือถือ, register, check-in) ไม่ควรมี master key
--
--   password_hash (SHA-256) ใช้เทียบได้ทุกที่ ไม่ต้องมี secret ใดๆ
--   (one-way hash, ไม่ใช่ encryption)
--
-- Role ของแต่ละคอลัมน์:
--   password_encrypted  → admin ดูรหัสจริงในหน้า members-list (reversible)
--   password_hash       → verify ที่ทุก flow (check-in, login, register ฯลฯ)
-- ============================================================

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_members_password_hash
  ON members(password_hash)
  WHERE password_hash IS NOT NULL;

-- ============================================================
-- DONE ✅
-- หลังรัน migration นี้ แล้วให้ backfill password_hash จาก
-- password_encrypted ผ่านหน้า members-list (ปุ่ม Backfill hash)
-- ============================================================
