-- ============================================================================
-- 181_withdraw_sign_status.sql
-- เบิกสินค้า: สถานะ "รอเซ็น / เซ็นแล้ว" — แทนชีต "เบิกรอเซ็น" (Stock F.3)
-- ============================================================================
--
-- 🔴 ทำไมต้องมีสถานะนี้ (อ่านก่อนคิดจะลบทิ้ง)
--
--   คลัง "กทม.ชั้น3" ไม่ได้เดินตาม flow PO/OD ปกติ ตัวเลข "ยอดในระบบ" ในหน้า
--   ตรวจนับ มาจากการ **อัปโหลดไฟล์ของระบบหลังบ้าน** ไม่ใช่ตัวเลขของ ERP ตัวนี้
--   → ERP เขียนกลับไปที่ระบบหลังบ้านไม่ได้
--
--   เวลาเบิกของออกจากชั้น จะเกิดช่วง "ของออกไปแล้ว แต่หลังบ้านยังไม่ตัด"
--   (รอเซ็นอนุมัติ) ถ้าไม่บวกกลับ ใบตรวจนับจะฟ้อง "ของหาย" ทุกวันทั้งที่ไม่หาย
--
--     ของบนชั้น 100 · เบิกออก 10 รอเซ็น
--       ไม่บวกกลับ : 90 − 100 = −10  → "ของหาย 10"  ❌ ผิด
--       บวกกลับ    : (90+10) − 100 = 0 → "ตรงกัน"    ✅
--
--   สถานะนี้คือคำตอบของ "เมื่อไหร่ถึงเลิกบวกกลับ" = ตอนหลังบ้านตัดยอดให้แล้ว
--   (เซ็นแล้ว) ไม่ใช่ตอนของออกจากชั้น
--
--   ชีตเดิมทำเรื่องนี้ด้วยการ "ลบบรรทัดทิ้งหลังเซ็น" — ที่นี่เปลี่ยนเป็นติ๊ก
--   สถานะแทน ประวัติจึงไม่หาย ย้อนดูได้ว่าใครเบิกอะไรไปเมื่อไหร่
--
-- 🔴 ทำไมไม่ใช้ movement_id ตัดสิน (ของเดิมใช้ — และมันพังกับคลังนี้)
--
--   pullIssue() เดิมเอาเฉพาะบรรทัดที่ movement_id IS NULL
--   แต่คลังนี้ stock_items ผูก catalog 0/45 ตัว → หน้าเบิกเขียน stock_movements
--   ไม่ได้เลย → movement_id เป็น NULL ตลอดกาล → เบิกทุกใบถูกบวกกลับสะสมไม่มี
--   วันหลุด ผ่านไป 3 เดือนคอลัมน์ "เบิก" จะบวมจนผลต่างขึ้น "ของเกิน" มหาศาล
--
--   กฎใหม่ = บวกกลับเมื่อ  sign_status = 'pending'  AND  movement_id IS NULL
--     · คลังนี้ (ยอดในระบบ = ไฟล์หลังบ้าน) → movement_id null เสมอ เหลือแต่ sign_status ✔
--     · คลังที่ใช้ stock_movements เป็นยอดในระบบ → ตัวที่ตัดแล้วหลุดออกเองด้วย movement_id ✔
--
-- รันครั้งเดียว · idempotent (รันซ้ำได้ ไม่พัง)
-- ============================================================================

-- ── 1. สถานะการเซ็น (เก็บที่ "บรรทัด" ไม่ใช่ "ใบ") ─────────────
--
--    ทำไมเก็บที่บรรทัด: ชีตเดิมลบทีละแถว = อนุมัติทีละรายการได้
--    เก็บที่บรรทัดครอบคลุมกว่า — จะเซ็นยกใบก็แค่อัปเดตทุกบรรทัดของใบนั้น
--    (UI มีปุ่มเซ็นยกใบให้อยู่แล้ว) แต่ถ้าเก็บที่ใบ จะเซ็นทีละรายการไม่ได้เลย
ALTER TABLE withdraw_txn_lines
  ADD COLUMN IF NOT EXISTS sign_status    TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS signed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS signed_by      INT REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS signed_by_name TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'withdraw_lines_sign_status_chk'
  ) THEN
    ALTER TABLE withdraw_txn_lines
      ADD CONSTRAINT withdraw_lines_sign_status_chk
      CHECK (sign_status IN ('pending', 'signed'));
  END IF;
END $$;

-- partial index — 99% ของ query คือ "หาบรรทัดที่ยังรอเซ็น"
CREATE INDEX IF NOT EXISTS idx_withdraw_lines_pending
  ON withdraw_txn_lines (txn_id)
  WHERE sign_status = 'pending';

-- ── 2. ผู้เบิก (ชีตเดิมมีคอลัมน์นี้ · ของเดิมยัดรวมใน note) ──────
--
--    ใบรอเซ็นต้องรู้ว่า "ใครเอาของไป" ไม่งั้นตามของไม่ได้
--    ของเดิม placeholder ช่องหมายเหตุเขียนว่า "เช่น ชื่อผู้รับ" = ใช้ note
--    ทำหน้าที่นี้กลาย ๆ อยู่แล้ว แยกออกมาเป็นคอลัมน์จริงให้กรองได้
ALTER TABLE withdraw_txns
  ADD COLUMN IF NOT EXISTS requester TEXT;

-- ── 3. view: เปิดสถานะให้หน้าตรวจนับ + แท็บรอเซ็นอ่าน ───────────
--    DROP ก่อน เพราะ CREATE OR REPLACE แทรกคอลัมน์กลาง list ไม่ได้
DROP VIEW IF EXISTS withdraw_ledger;
CREATE VIEW withdraw_ledger AS
SELECT
  l.id            AS line_id,
  t.id            AS txn_id,
  t.txn_date,
  t.category_id,
  t.category_name,
  t.warehouse_id,
  t.warehouse_name,
  l.item_id,
  l.product_id,
  l.item_code,
  l.item_name,
  l.price,
  l.qty,
  l.amount,
  l.movement_id,
  l.sign_status,
  l.signed_at,
  l.signed_by_name,
  t.requester,
  t.note,
  t.created_by_name,
  t.created_at
FROM withdraw_txn_lines l
JOIN withdraw_txns t ON t.id = l.txn_id;

GRANT SELECT ON withdraw_ledger TO anon;

-- ── 4. RLS ต้องปิด (login เป็น users table ไม่ใช่ Supabase Auth) ──
ALTER TABLE withdraw_txns      DISABLE ROW LEVEL SECURITY;
ALTER TABLE withdraw_txn_lines DISABLE ROW LEVEL SECURITY;

-- ── ตรวจผล ────────────────────────────────────────────────────
-- SELECT sign_status, count(*) FROM withdraw_txn_lines GROUP BY 1;
-- SELECT * FROM withdraw_ledger WHERE sign_status = 'pending' LIMIT 5;
