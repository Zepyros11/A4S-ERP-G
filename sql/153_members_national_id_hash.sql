-- 153_members_national_id_hash.sql
-- เพิ่มคอลัมน์ national_id_hash (SHA-256 ของเลขบัตรประชาชนที่ normalize แล้ว)
-- ใช้ยืนยันตัวตนแบบ cross-device โดยไม่ต้องมี master key
-- (mirror pattern เดียวกับ password_hash) — ให้สมาชิกที่ลืมรหัสผ่าน
-- กรอกเลขบัตรประชาชนแทนรหัสผ่านได้ที่หน้า register
--
-- normalize = uppercase + ตัด space/dash ออก  (ต้องตรงกันทั้ง import / backfill / register)
--   เช่น "3-3103-00741-90-3" → "3310300741903"
--        "A3-17-047-04-02"   → "A317047040 2" (ตัวอย่าง) → "A31704704 02"
--
-- หลังรัน migration นี้ ให้เข้าหน้า "ข้อมูลสมาชิก (A4S)" แล้วกดปุ่ม
-- "🆔 Backfill บัตร" เพื่อสร้าง hash จาก national_id_encrypted ของสมาชิกเดิม (ต้องมี master key)

ALTER TABLE members ADD COLUMN IF NOT EXISTS national_id_hash text;

COMMENT ON COLUMN members.national_id_hash IS
  'SHA-256 ของเลขบัตรประชาชน (normalize: uppercase + ตัด -/space) · ใช้ verify ตอน login แทนรหัสผ่าน · ไม่ใช่ของลับ (one-way)';
