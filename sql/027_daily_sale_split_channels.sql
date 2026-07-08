-- ============================================================
-- Migration 027: Split Credit Card / Transfer channels (increment 2)
--   ให้ตาราง "บิลขาย" ตรงกับ Google Sheet DAILY SALE เป๊ะ:
--     Credit Card → Front Office | Online
--     Transfer    → KBANK | KTB
--
-- เดิม (increment 1) ยุบเป็น credit_card / transfer คอลัมน์เดียว
--   (ชื่อธนาคารไปอยู่ payment_method text) — ตอนนี้แยกเป็นคอลัมน์จริง
--
-- ความสัมพันธ์ (คงไว้เพื่อ backward-compat กับ summary view + hourly sync):
--   credit_card = front_office + online
--   transfer    = kbank + ktb
--   → answerforsuccess sync ส่งมาแค่ยอดรวม (เขียน credit_card/transfer)
--     ช่อง front_office/online/kbank/ktb = 0 จนกว่า CS จำแนกในโมดัลแก้ช่องทาง
--     (บิลที่ยังไม่จำแนก → ผลต่างในตารางจะโชว์ ≠ 0 เป็นสัญญาณให้ CS แก้)
-- ============================================================

ALTER TABLE daily_sale_payments
  ADD COLUMN IF NOT EXISTS front_office NUMERIC(14,2) DEFAULT 0,  -- บัตรเครดิต หน้าร้าน
  ADD COLUMN IF NOT EXISTS online       NUMERIC(14,2) DEFAULT 0,  -- บัตรเครดิต ออนไลน์
  ADD COLUMN IF NOT EXISTS kbank        NUMERIC(14,2) DEFAULT 0,  -- โอน กสิกร
  ADD COLUMN IF NOT EXISTS ktb          NUMERIC(14,2) DEFAULT 0;  -- โอน กรุงไทย

-- Recreate summary view รวมคอลัมน์แยกใหม่ (คง alias เดิมไว้ครบ)
DROP VIEW IF EXISTS daily_sale_summary;
CREATE VIEW daily_sale_summary AS
SELECT
  b.business_date                      AS sale_date,
  b.branch,
  COUNT(*)                             AS bill_count,
  SUM(b.amount)                        AS total_amount,
  SUM(b.vat)                           AS total_vat,
  SUM(b.shipping_fee)                  AS total_shipping,
  SUM(COALESCE(p.cash, 0))             AS total_cash,
  SUM(COALESCE(p.transfer, 0))         AS total_transfer,
  SUM(COALESCE(p.credit_card, 0))      AS total_credit_card,
  SUM(COALESCE(p.front_office, 0))     AS total_front_office,
  SUM(COALESCE(p.online, 0))           AS total_online,
  SUM(COALESCE(p.kbank, 0))            AS total_kbank,
  SUM(COALESCE(p.ktb, 0))              AS total_ktb,
  SUM(COALESCE(p.ewallet, 0))          AS total_ewallet,
  SUM(COALESCE(p.gift_voucher, 0))     AS total_gift_voucher,
  SUM(COALESCE(p.paypal, 0))           AS total_paypal,
  SUM(COALESCE(p.qr_payment, 0))       AS total_qr,
  SUM(COALESCE(p.commission_deduct,0)) AS total_commission,
  SUM(COALESCE(p.arp_amount, 0))       AS total_arp
FROM daily_sale_bills b
LEFT JOIN daily_sale_payments p ON p.bill_no = b.bill_no
GROUP BY b.business_date, b.branch;

-- ============================================================
-- DONE
-- Test:
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='daily_sale_payments'
--       AND column_name IN ('front_office','online','kbank','ktb');  -- ควรได้ 4 แถว
-- หลังรัน → re-run scripts/import-data-cs.js เพื่อ backfill split ของข้อมูลเก่า
-- ============================================================
