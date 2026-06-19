-- ============================================================
-- Migration 154: เพิ่ม events.portal_show_qr
--
-- Why:
--   ควบคุมว่าหน้า register portal จะ "แสดง QR Code" ให้ผู้เข้าร่วมเห็น
--   ตอน login/ลงทะเบียนเสร็จหรือไม่ (บางงานไม่อยากให้โชว์ QR)
--   toggle อยู่ในโมดัล "🔗 แชร์ลิงก์ลงทะเบียน" ของหน้า attendees
--
--   NULL / true = แสดง QR (default — พฤติกรรมเดิม)
--   false       = ซ่อน QR (โชว์เฉพาะเลขตั๋ว)
--
-- Idempotent — รันซ้ำได้
-- ============================================================

ALTER TABLE events ADD COLUMN IF NOT EXISTS portal_show_qr BOOLEAN NOT NULL DEFAULT true;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Verify:
--   SELECT event_id, event_name, portal_show_qr FROM events LIMIT 5;
-- ============================================================
