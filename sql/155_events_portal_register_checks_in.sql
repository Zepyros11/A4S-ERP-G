-- ============================================================
-- Migration 155: เพิ่ม events.portal_register_checks_in
--
-- Why:
--   ปกติการลงทะเบียนผ่าน portal "ก่อนวันงาน" = pre-registration
--   (checked_in=false · ไปเช็คอินจริงหน้างาน) — เป็นพฤติกรรม default
--
--   บาง event ใช้ portal เป็นการเช็คอินเลย (self check-in / กรอกหน้างาน)
--   เปิด toggle นี้ → ลงทะเบียนเสร็จ = เข้างานทันที (checked_in=true)
--   โดยไม่สน pre-registration window
--   toggle อยู่ในโมดัล "🔗 แชร์ลิงก์ลงทะเบียน" ของหน้า attendees
--
--   false (default) = แยก ลงทะเบียน/เข้างาน ตามเดิม (pre-reg aware)
--   true            = ลงทะเบียน = เข้างานทันที
--
-- Idempotent — รันซ้ำได้
-- ============================================================

ALTER TABLE events ADD COLUMN IF NOT EXISTS portal_register_checks_in BOOLEAN NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Verify:
--   SELECT event_id, event_name, portal_register_checks_in FROM events LIMIT 5;
-- ============================================================
