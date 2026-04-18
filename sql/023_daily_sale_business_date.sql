-- ============================================================
-- Migration 023: Add business_date column + close_day RPC
--   Logic: business_date = วันที่ user กด Sync Now (ไม่ใช่ hard cutoff 18:00)
--   - บิลที่เข้ามาตอนไหนก็ตาม → business_date = NULL (pending)
--   - User กด Sync Now สำเร็จ → เรียก close_day(today) → tag NULL เป็น today
--   - Cron อัตโนมัติไม่ปิดวัน (NULL ค้างไว้รอ user)
-- ============================================================

-- ── 1) Add columns (ทั้ง bills + topup_bills)
ALTER TABLE daily_sale_bills
  ADD COLUMN IF NOT EXISTS business_date DATE;

ALTER TABLE daily_sale_topup_bills
  ADD COLUMN IF NOT EXISTS business_date DATE;

CREATE INDEX IF NOT EXISTS idx_daily_sale_bills_business_date
  ON daily_sale_bills (business_date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_sale_topup_bills_business_date
  ON daily_sale_topup_bills (business_date DESC);

-- ── 2) Backfill: ข้อมูลเก่า (DATA_CS import + sync ก่อนหน้า) ใช้ sale_date
--   เพราะข้อมูลเหล่านี้ถือว่า "ปิดรอบ" ไปแล้วในอดีต
UPDATE daily_sale_bills
  SET business_date = sale_date
  WHERE business_date IS NULL;

UPDATE daily_sale_topup_bills
  SET business_date = sale_date
  WHERE business_date IS NULL;

-- ── 3) RPC: ปิดวัน (เรียกจาก daily-sale.js หลัง sync สำเร็จ)
CREATE OR REPLACE FUNCTION daily_sale_close_day(p_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (bills_closed INT, topup_closed INT) AS $$
DECLARE
  v_bills INT;
  v_topup INT;
BEGIN
  UPDATE daily_sale_bills
    SET business_date = p_date
    WHERE business_date IS NULL;
  GET DIAGNOSTICS v_bills = ROW_COUNT;

  UPDATE daily_sale_topup_bills
    SET business_date = p_date
    WHERE business_date IS NULL;
  GET DIAGNOSTICS v_topup = ROW_COUNT;

  RETURN QUERY SELECT v_bills, v_topup;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── 4) Update daily_sale_summary view: group by business_date แทน sale_date
DROP VIEW IF EXISTS daily_sale_summary;
CREATE VIEW daily_sale_summary AS
SELECT
  b.business_date                      AS sale_date,  -- keep column name for UI compat
  b.branch,
  COUNT(*)                             AS bill_count,
  SUM(b.amount)                        AS total_amount,
  SUM(b.vat)                           AS total_vat,
  SUM(b.shipping_fee)                  AS total_shipping,
  SUM(COALESCE(p.cash, 0))             AS total_cash,
  SUM(COALESCE(p.transfer, 0))         AS total_transfer,
  SUM(COALESCE(p.credit_card, 0))      AS total_credit_card,
  SUM(COALESCE(p.ewallet, 0))          AS total_ewallet,
  SUM(COALESCE(p.gift_voucher, 0))     AS total_gift_voucher,
  SUM(COALESCE(p.paypal, 0))           AS total_paypal,
  SUM(COALESCE(p.qr_payment, 0))       AS total_qr,
  SUM(COALESCE(p.commission_deduct,0)) AS total_commission,
  SUM(COALESCE(p.arp_amount, 0))       AS total_arp
FROM daily_sale_bills b
LEFT JOIN daily_sale_payments p ON p.bill_no = b.bill_no
GROUP BY b.business_date, b.branch;
-- note: ไม่ filter business_date IS NULL ออก — frontend filter เอง
--       (เพื่อให้ mode "วันนี้" เห็นบิล pending ที่ยังไม่ปิด)

-- ============================================================
-- DONE
-- Test:
--   -- ดูว่า backfill สำเร็จ
--   SELECT COUNT(*) FROM daily_sale_bills WHERE business_date IS NULL;
--   -- ควรได้ 0
--
--   -- ลองเรียก close_day
--   SELECT * FROM daily_sale_close_day(CURRENT_DATE);
--   -- ควรได้ (0, 0) เพราะ backfill เอา NULL ออกหมดแล้ว
--
--   -- ดู summary
--   SELECT * FROM daily_sale_summary ORDER BY sale_date DESC LIMIT 10;
-- ============================================================
