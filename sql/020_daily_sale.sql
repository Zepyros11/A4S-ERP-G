-- ============================================================
-- Migration 020: Daily Sale CS module
--   แทน Google Sheet "DailySaleCS" + "CheckBillOnline" + "DATA_CS"
--
-- Source: 4 xls exports จาก answerforsuccess.com (Python ExportDailysale_CS.py เดิม)
--   1. 01_บิลขายทั้งหมด        → daily_sale_bills         (master STH)
--   2. 01_รายงานช่องทางชำระเงิน → daily_sale_payments      (1:1 bill_no)
--   3. 03_รายงานรายละเอียด Payment → daily_sale_topup_details (N:1 bill_no, ETH)
--   4. 08_บิลเติมเงิน Ewallet    → daily_sale_topup_bills   (master ETH)
--
-- + daily_sale_reconcile (manual entry, แทน DATA_CS Table C "ตรวจบิล")
-- + branches (lookup table)
-- ============================================================

-- ── 0) branches — lookup table สาขา/ช่องทาง
-- Parser จะ upsert สาขาใหม่อัตโนมัติถ้าเจอใน xls (ป้องกัน FK fail)
CREATE TABLE IF NOT EXISTS branches (
  branch_code    TEXT PRIMARY KEY,
  branch_name    TEXT NOT NULL,
  country_code   TEXT DEFAULT 'TH',        -- TH/KH/CIV/CMR/NG/...
  display_order  INT DEFAULT 99,
  active         BOOLEAN DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT now()
);

INSERT INTO branches (branch_code, branch_name, country_code, display_order) VALUES
  ('BKK01', 'สำนักงานใหญ่ กรุงเทพฯ',       'TH',  1),
  ('HY',    'สาขา หาดใหญ่',                 'TH',  2),
  ('BUR',   'สาขา บุรีรัมย์',                'TH',  3),
  ('NB',    'สาขา นนทบุรี',                  'TH',  4),
  ('ONLINE','ช่องทางออนไลน์',                'TH', 10),
  ('CIV01', 'Côte d''Ivoire 01',             'CIV', 20),
  ('CMR01', 'Cameroon 01',                   'CMR', 21),
  ('NG01',  'Nigeria 01',                    'NG',  22)
ON CONFLICT (branch_code) DO NOTHING;

-- ── 1) daily_sale_bills — master ทุกบิลขาย (prefix STH)
CREATE TABLE IF NOT EXISTS daily_sale_bills (
  bill_no         TEXT PRIMARY KEY,
  tax_invoice_no  TEXT,
  sale_date       DATE NOT NULL,
  sale_datetime   TIMESTAMPTZ,
  member_code     TEXT,
  member_name     TEXT,
  bill_type       TEXT,                    -- โฮลด์/อัพเกรด/สั่งซื้อ/สมัคร/รักษาสิทธิ์/แลกสินค้า
  points          NUMERIC(12,2) DEFAULT 0,
  amount          NUMERIC(14,2) DEFAULT 0,
  vat             NUMERIC(12,2) DEFAULT 0,
  shipping_fee    NUMERIC(10,2) DEFAULT 0,
  recorded_by     TEXT,
  shipping        TEXT,                    -- YES/NO
  channel         TEXT,                    -- Branch/Online
  branch          TEXT REFERENCES branches(branch_code) ON DELETE SET NULL,
  receive_branch  TEXT REFERENCES branches(branch_code) ON DELETE SET NULL,
  category        TEXT,                    -- สั่งซื้อ/สมัคร
  bill_channel    TEXT,                    -- System
  lb              TEXT,                    -- TH/KH/...
  notes           TEXT,
  source_file     TEXT DEFAULT '01_บิลขายทั้งหมด',
  imported_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_sale_bills_date     ON daily_sale_bills (sale_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_sale_bills_branch   ON daily_sale_bills (branch, sale_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_sale_bills_member   ON daily_sale_bills (member_code);

-- ── 2) daily_sale_payments — payment breakdown 1:1 กับ bills
CREATE TABLE IF NOT EXISTS daily_sale_payments (
  bill_no         TEXT PRIMARY KEY REFERENCES daily_sale_bills(bill_no) ON DELETE CASCADE,
  sale_date       DATE NOT NULL,
  amount          NUMERIC(14,2) DEFAULT 0,
  base_price      NUMERIC(14,2) DEFAULT 0,  -- ราคากลาง
  cash            NUMERIC(14,2) DEFAULT 0,
  transfer        NUMERIC(14,2) DEFAULT 0,
  credit_card     NUMERIC(14,2) DEFAULT 0,
  paypal          NUMERIC(14,2) DEFAULT 0,
  dummy           NUMERIC(14,2) DEFAULT 0,
  ewallet         NUMERIC(14,2) DEFAULT 0,
  gift_voucher    NUMERIC(14,2) DEFAULT 0,
  payment_method  TEXT,                     -- รูปแบบการชำระเงิน เช่น "ธนาคาร กสิกรไทย"
  source_file     TEXT DEFAULT '01_รายงานช่องทางชำระเงิน',
  imported_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_sale_payments_date ON daily_sale_payments (sale_date DESC);

-- ── 3) daily_sale_topup_bills — master บิลเติม Ewallet (prefix ETH/E*)
CREATE TABLE IF NOT EXISTS daily_sale_topup_bills (
  bill_no         TEXT PRIMARY KEY,
  sale_date       DATE NOT NULL,
  member_code     TEXT,
  member_name     TEXT,
  amount          NUMERIC(14,2) DEFAULT 0,
  cash            NUMERIC(14,2) DEFAULT 0,
  transfer        NUMERIC(14,2) DEFAULT 0,
  credit_card     NUMERIC(14,2) DEFAULT 0,
  gift_voucher    NUMERIC(14,2) DEFAULT 0,
  recorded_by     TEXT,
  branch          TEXT REFERENCES branches(branch_code) ON DELETE SET NULL,
  channel         TEXT,                    -- ONLINE/Branch
  lb              TEXT,
  notes           TEXT,
  source_file     TEXT DEFAULT '08_บิลเติมเงินEwallet',
  imported_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_sale_topup_bills_date   ON daily_sale_topup_bills (sale_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_sale_topup_bills_member ON daily_sale_topup_bills (member_code);

-- ── 4) daily_sale_topup_details — รายละเอียดวิธีจ่ายต่อบิล (N:1)
-- note: ไม่มี unique constraint ต่อ bill_no เพราะ 1 บิลมีหลายแถว (หลายวิธีจ่าย)
CREATE TABLE IF NOT EXISTS daily_sale_topup_details (
  detail_id       BIGSERIAL PRIMARY KEY,
  bill_no         TEXT NOT NULL,
  sale_date       DATE NOT NULL,
  member_code     TEXT,
  member_name     TEXT,
  payment_channel TEXT,                    -- ช่องทางการชำระ: เงินโอน/บัตรเครดิต
  amount          NUMERIC(14,2) DEFAULT 0,
  payment_format  TEXT,                    -- รูปแบบ เช่น Providus Bank, ธนาคาร กสิกรไทย
  reference       TEXT,                    -- อ้างอิง
  source_file     TEXT DEFAULT '03_รายงานรายละเอียด Payment',
  imported_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_sale_topup_details_bill ON daily_sale_topup_details (bill_no);
CREATE INDEX IF NOT EXISTS idx_daily_sale_topup_details_date ON daily_sale_topup_details (sale_date DESC);

-- ── 5) daily_sale_reconcile — "ตรวจบิล" (แทน DATA_CS Table C)
-- Workflow:
--   1. ระบบ prefill bill_count/bill_value จาก daily_sale_bills (ERP snapshot)
--   2. CS เปิดหน้าดู → แก้ค่าได้ถ้า ERP บันทึกผิด (CS คือ source of truth)
--   3. system_count/system_value = snapshot ERP ตอน prefill (ไม่แก้)
--   4. diff_count/diff_value = generated, แสดงผลต่างให้เห็นเลย
--   5. CS เซ็น signature + notes → UNIQUE (วัน, สาขา)
CREATE TABLE IF NOT EXISTS daily_sale_reconcile (
  id              BIGSERIAL PRIMARY KEY,
  reconcile_date  DATE NOT NULL,
  branch          TEXT NOT NULL DEFAULT 'BKK01' REFERENCES branches(branch_code) ON DELETE RESTRICT,
  -- CS's recorded values (editable, source of truth)
  bill_count      INT DEFAULT 0,
  bill_value      NUMERIC(14,2) DEFAULT 0,
  remaining       NUMERIC(14,2) DEFAULT 0,
  -- ERP snapshot at prefill time (read-only reference)
  system_count    INT DEFAULT 0,
  system_value    NUMERIC(14,2) DEFAULT 0,
  -- Computed diffs (แสดงผลต่าง CS vs ERP)
  diff_count      INT            GENERATED ALWAYS AS (bill_count - system_count) STORED,
  diff_value      NUMERIC(14,2)  GENERATED ALWAYS AS (bill_value - system_value) STORED,
  signature       TEXT,                    -- เหน่ง/เกษ/etc.
  notes           TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (reconcile_date, branch)
);

CREATE INDEX IF NOT EXISTS idx_daily_sale_reconcile_date ON daily_sale_reconcile (reconcile_date DESC);

-- ── 6) daily_sale_summary — view สรุปยอดรายวัน/สาขา
CREATE OR REPLACE VIEW daily_sale_summary AS
SELECT
  b.sale_date,
  b.branch,
  COUNT(*)                          AS bill_count,
  SUM(b.amount)                     AS total_amount,
  SUM(b.vat)                        AS total_vat,
  SUM(b.shipping_fee)               AS total_shipping,
  SUM(COALESCE(p.cash, 0))          AS total_cash,
  SUM(COALESCE(p.transfer, 0))      AS total_transfer,
  SUM(COALESCE(p.credit_card, 0))   AS total_credit_card,
  SUM(COALESCE(p.ewallet, 0))       AS total_ewallet,
  SUM(COALESCE(p.gift_voucher, 0))  AS total_gift_voucher,
  SUM(COALESCE(p.paypal, 0))        AS total_paypal
FROM daily_sale_bills b
LEFT JOIN daily_sale_payments p ON p.bill_no = b.bill_no
GROUP BY b.sale_date, b.branch;

-- ── 7) Seed automation_tasks (idempotent — ใช้ NOT EXISTS เพราะ name ไม่ unique)
INSERT INTO automation_tasks (name, task_type, target_url, workflow, schedule, status, notes, config_url)
SELECT
  'Export Daily Sale CS',
  'web_download',
  'https://www.answerforsuccess.com/branch/index.php?sessiontab=3',
  'sync-daily-sale.yml',
  '1h',
  'active',
  'ดาวน์โหลด 4 xls (บิลขาย + payment + ewallet topup + topup details) จาก answerforsuccess.com แล้ว import เข้า Supabase · แทน Python ExportDailysale_CS.py',
  '../customer-service/daily-sale.html'
WHERE NOT EXISTS (
  SELECT 1 FROM automation_tasks WHERE workflow = 'sync-daily-sale.yml'
);

-- ============================================================
-- DONE ✅
-- Test:
--   SELECT * FROM daily_sale_summary ORDER BY sale_date DESC LIMIT 30;
--   SELECT * FROM daily_sale_bills WHERE sale_date = CURRENT_DATE;
--   SELECT b.bill_no, b.amount, p.cash, p.transfer FROM daily_sale_bills b
--     LEFT JOIN daily_sale_payments p USING (bill_no)
--     WHERE b.sale_date = CURRENT_DATE;
-- ============================================================
