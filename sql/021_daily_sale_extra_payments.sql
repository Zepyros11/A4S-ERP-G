-- ============================================================
-- Migration 021: Add QR / หักค่าคอม / ARP columns to daily_sale_payments
--   เพื่อรองรับการ import DATA_CS (Google Sheet เก่า) ที่มี payment categories เพิ่มเติม
--   + update daily_sale_summary view ให้รวม columns ใหม่
-- ============================================================

ALTER TABLE daily_sale_payments
  ADD COLUMN IF NOT EXISTS qr_payment       NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission_deduct NUMERIC(14,2) DEFAULT 0,  -- หักค่าคอม
  ADD COLUMN IF NOT EXISTS arp_amount       NUMERIC(14,2) DEFAULT 0;   -- ARP point มูลค่า

-- Recreate view ให้รวม columns ใหม่
DROP VIEW IF EXISTS daily_sale_summary;
CREATE VIEW daily_sale_summary AS
SELECT
  b.sale_date,
  b.branch,
  COUNT(*)                            AS bill_count,
  SUM(b.amount)                       AS total_amount,
  SUM(b.vat)                          AS total_vat,
  SUM(b.shipping_fee)                 AS total_shipping,
  SUM(COALESCE(p.cash, 0))            AS total_cash,
  SUM(COALESCE(p.transfer, 0))        AS total_transfer,
  SUM(COALESCE(p.credit_card, 0))     AS total_credit_card,
  SUM(COALESCE(p.ewallet, 0))         AS total_ewallet,
  SUM(COALESCE(p.gift_voucher, 0))    AS total_gift_voucher,
  SUM(COALESCE(p.paypal, 0))          AS total_paypal,
  SUM(COALESCE(p.qr_payment, 0))      AS total_qr,
  SUM(COALESCE(p.commission_deduct,0)) AS total_commission,
  SUM(COALESCE(p.arp_amount, 0))      AS total_arp
FROM daily_sale_bills b
LEFT JOIN daily_sale_payments p ON p.bill_no = b.bill_no
GROUP BY b.sale_date, b.branch;

-- ============================================================
-- DONE
-- Test:
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'daily_sale_payments' ORDER BY ordinal_position;
-- ============================================================
