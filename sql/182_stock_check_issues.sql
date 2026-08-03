-- ============================================================================
-- 182_stock_check_issues.sql
-- "เบิกรอเซ็น" = แท็บที่ 2 ของหน้าตรวจนับ — แทนชีต `เบิกรอเซ็น` ของ Stock F.3
-- ============================================================================
--
-- 🔴 ทำไมเป็นตารางแยก ไม่ใช้ withdraw_txn_lines (sql/181 เคยทำแบบนั้น — เลิกแล้ว)
--
--   ในไฟล์ Google Sheet เดิม `Stock F.3` กับ `เบิกรอเซ็น` เป็น "คนละชีตในไฟล์
--   เดียวกัน" ส่วน `Withdraw_DATA` (= หน้าเบิกสินค้า) เป็นอีกเรื่องหนึ่ง
--   → เจ้าของงานยืนยันว่า "หน้าเบิกสินค้าทำงานคนละส่วนกับตรงนี้"
--
--   และรายการที่นี่ **ถูกลบทิ้งเมื่อเซ็นแล้ว** (ตามที่ชีตเดิมทำ)
--   ถ้าไปเก็บใน withdraw_txn_lines การลบจะทำให้บิลเบิกจริงหายจากรายงาน
--   รายเดือน/ประวัติของหน้าเบิกสินค้าไปด้วย ซึ่งไม่ควรเกิด
--
-- 🔴 ตารางนี้มีไว้ทำอะไร
--
--   คลัง "กทม.ชั้น3" ไม่เดินตาม flow PO/OD ตัวเลข "ยอดในระบบ" มาจากการอัปโหลด
--   ไฟล์ของระบบหลังบ้าน ที่ ERP เขียนกลับไม่ได้
--   → ช่วง "ของออกจากชั้นแล้ว แต่หลังบ้านยังไม่ตัดยอด (รอเซ็นอนุมัติ)"
--     ต้องบวกกลับในคอลัมน์ "เบิก" ไม่งั้นใบตรวจนับจะฟ้อง "ของหาย" ทุกวัน
--
--     ของบนชั้น 100 · เบิกออก 10 รอเซ็น
--       ไม่บวกกลับ : 90 − 100 = −10  → "ของหาย 10"  ❌ ผิด
--       บวกกลับ    : (90+10) − 100 = 0 → "ตรงกัน"    ✅
--
--   ทุกแถวในตารางนี้ = "ยังรอเซ็น" เสมอ (เซ็นแล้ว = user ลบแถวทิ้ง)
--   จึงไม่ต้องมีคอลัมน์สถานะ — มีแถวอยู่ = ต้องบวกกลับ
--
-- ============================================================================

-- ── 1. ตารางเบิกรอเซ็น (แถวเดี่ยว ๆ ไม่มีหัวบิล — ตรงกับชีตเดิม) ──
CREATE TABLE IF NOT EXISTS stock_check_issues (
  id              BIGSERIAL PRIMARY KEY,
  issue_date      DATE NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Bangkok')::date,
  warehouse_id    INT,                       -- คลังที่เบิกออก (ตามใบตรวจนับ)

  -- สินค้า: ผูก stock_items ไว้ให้จับคู่แม่น + snapshot ชื่อ/รหัสกันของถูกลบทีหลัง
  item_id         BIGINT REFERENCES stock_items(id) ON DELETE SET NULL,
  item_code       TEXT,
  item_name       TEXT NOT NULL,

  qty             NUMERIC(14,2) NOT NULL CHECK (qty > 0),
  requester       TEXT,                      -- ผู้เบิก (ชีตเดิมคอลัมน์ D)
  note            TEXT,                      -- หมายเหตุ (ชีตเดิมคอลัมน์ E)

  created_by      INT REFERENCES users(user_id) ON DELETE SET NULL,
  created_by_name TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- คอลัมน์ "เบิก" ในใบตรวจนับ = SUM(qty) GROUP BY item ของคลังนั้น → index ตามนั้น
CREATE INDEX IF NOT EXISTS idx_stock_check_issues_wh_item
  ON stock_check_issues (warehouse_id, item_id);
CREATE INDEX IF NOT EXISTS idx_stock_check_issues_date
  ON stock_check_issues (issue_date DESC);

CREATE OR REPLACE FUNCTION touch_stock_check_issues()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_stock_check_issues ON stock_check_issues;
CREATE TRIGGER trg_touch_stock_check_issues
  BEFORE UPDATE ON stock_check_issues
  FOR EACH ROW EXECUTE FUNCTION touch_stock_check_issues();

-- ── 2. RLS ต้องปิด (login เป็น users table ไม่ใช่ Supabase Auth) ──
--    ⚠️ Supabase เปิด RLS ให้ตารางใหม่อัตโนมัติ — ลืมบรรทัดนี้ = หน้าเว็บพังเงียบ
ALTER TABLE stock_check_issues DISABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON stock_check_issues TO anon;
GRANT USAGE, SELECT ON SEQUENCE stock_check_issues_id_seq TO anon;

-- ── 3. ถอน sign_status ของ sql/181 (ไม่ได้ใช้แล้ว) ─────────────
--
--    181 เคยเก็บสถานะรอเซ็น/เซ็นแล้วไว้ที่ withdraw_txn_lines
--    เปลี่ยนมาเป็นตารางแยก + "เซ็นแล้ว = ลบแถว" แล้ว คอลัมน์ชุดนั้นจึงตายซาก
--    ถอนออกให้ schema ตรงกับความจริง คนรับงานต่อจะได้ไม่หลงว่ายังใช้อยู่
--
--    ⚠️ `requester` บน withdraw_txns **ไม่ถอน** — เป็นฟิลด์ที่มีประโยชน์ในตัวเอง
--    (หน้าเบิกสินค้ายังมีช่อง "ผู้เบิก" ใช้อยู่)
DROP VIEW IF EXISTS withdraw_ledger;

ALTER TABLE withdraw_txn_lines
  DROP CONSTRAINT IF EXISTS withdraw_lines_sign_status_chk;
DROP INDEX IF EXISTS idx_withdraw_lines_pending;
ALTER TABLE withdraw_txn_lines
  DROP COLUMN IF EXISTS sign_status,
  DROP COLUMN IF EXISTS signed_at,
  DROP COLUMN IF EXISTS signed_by,
  DROP COLUMN IF EXISTS signed_by_name;

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
  t.requester,
  t.note,
  t.created_by_name,
  t.created_at
FROM withdraw_txn_lines l
JOIN withdraw_txns t ON t.id = l.txn_id;

GRANT SELECT ON withdraw_ledger TO anon;

-- ── ตรวจผล ────────────────────────────────────────────────────
-- SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'stock_check_issues';  -- ต้องได้ false
-- SELECT count(*) FROM stock_check_issues;
-- SELECT item_name, sum(qty) FROM stock_check_issues GROUP BY 1 ORDER BY 2 DESC;
