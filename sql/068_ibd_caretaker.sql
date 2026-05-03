-- ============================================================
-- Migration 068: Add caretaker_user_id to 3 IBD tables
--
-- caretaker_user_id = "ผู้ดูแล" — staff ที่รับผิดชอบดูแลคำขอนี้
--   ต่างจาก assigned_to/approved_by ที่เป็น workflow field (ตอน start/approve)
--   caretaker เป็น free assignment ที่ admin/หัวหน้าทีมเลือกได้ตลอดเวลา
--
-- หน้า UI กรอง dropdown เฉพาะ users ที่ role IN ('IBD_STAFF','ADMIN')
-- ============================================================

ALTER TABLE ibd_complaints
  ADD COLUMN IF NOT EXISTS caretaker_user_id INT REFERENCES users(user_id) ON DELETE SET NULL;

ALTER TABLE ibd_ewallet_requests
  ADD COLUMN IF NOT EXISTS caretaker_user_id INT REFERENCES users(user_id) ON DELETE SET NULL;

ALTER TABLE ibd_relocation_requests
  ADD COLUMN IF NOT EXISTS caretaker_user_id INT REFERENCES users(user_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ibd_complaints_caretaker  ON ibd_complaints (caretaker_user_id);
CREATE INDEX IF NOT EXISTS idx_ibd_ewallet_caretaker     ON ibd_ewallet_requests (caretaker_user_id);
CREATE INDEX IF NOT EXISTS idx_ibd_relocation_caretaker  ON ibd_relocation_requests (caretaker_user_id);
