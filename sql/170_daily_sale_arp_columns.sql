-- ============================================================
-- Migration 170: คอลัมน์ ARP จริง (ABB EASY / ABB ONLINE / ARP USD)
--
-- ปัญหา: ตาราง "แลก ARP" ในหน้า Daily Sale อ่านจาก qr_payment / commission_deduct /
--   arp_amount ซึ่งบิล ARP ไม่เคยมีค่า → ทุกช่องว่าง · ผลต่าง = -ยอดบิล (แดงทั้งตาราง)
--
-- ค่าจริงจาก sync อยู่ที่:
--   daily_sale_payments.dummy   = ช่อง 'Dummy' ในไฟล์ 01_รายงานช่องทางการชำระเงิน (= ชำระด้วย ABB)
--   daily_sale_payments.amount  = ยอดบิล ARP ออนไลน์ (หน่วยเป็น USD · dummy = 0)
--
-- กฎที่ถอดจากชีทจริง (12 ก.ค. 2569 · ยอดตรงเป๊ะ 4,500 / 2,050 / 319 = 6,869):
--   dummy > 0 และ bill_type = 'แลกสินค้า'  → ABB ONLINE   (บิลสาขา 354/363/364 = 2,050)
--   dummy > 0 และ bill_type อื่น           → ABB EASY     (บิล 369 โฮลด์ = 4,500)
--   dummy = 0 และ bill_type = 'แลกสินค้า'  → ARP (USD)    (บิล ONLIN 6 ใบ = 319)
-- ============================================================

-- ── 1) คอลัมน์ใหม่ ──
ALTER TABLE daily_sale_payments
  ADD COLUMN IF NOT EXISTS abb_easy   NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS abb_online NUMERIC(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS arp_usd    NUMERIC(14,2) DEFAULT 0;

COMMENT ON COLUMN daily_sale_payments.abb_easy   IS 'ชำระด้วย ABB EASY (dummy · บิลไม่ใช่แลกสินค้า)';
COMMENT ON COLUMN daily_sale_payments.abb_online IS 'รับรางวัล ABB ONLINE (dummy · บิลแลกสินค้า)';
COMMENT ON COLUMN daily_sale_payments.arp_usd    IS 'แลก ARP POINT หน่วย USD (บิลแลกสินค้าออนไลน์ · dummy = 0)';

-- ── 2) ต่อ derive trigger เดิม (migration 030) ให้ปั้น 3 คอลัมน์นี้จาก dummy + bill_type ──
CREATE OR REPLACE FUNCTION daily_sale_derive_split()
RETURNS trigger AS $$
DECLARE
  v_type TEXT;
BEGIN
  IF NEW.corrected IS TRUE THEN RETURN NEW; END IF;              -- CS แก้แล้ว = ต้นฉบับ
  IF NEW.source_file = 'ewallet-topup-sync' THEN RETURN NEW; END IF;  -- 028 split จาก topup_details

  -- reset คอลัมน์ที่ derive (idempotent — คำนวณใหม่จาก aggregate เสมอ)
  NEW.kbank := 0; NEW.ktb := 0; NEW.front_office := 0; NEW.online := 0; NEW.qr_payment := 0;
  NEW.abb_easy := 0; NEW.abb_online := 0; NEW.arp_usd := 0;

  -- เงินโอน → KBANK / KTB / QR ตามธนาคารใน payment_method
  IF COALESCE(NEW.transfer,0) > 0 THEN
    IF NEW.payment_method ILIKE '%กสิกร%' THEN
      NEW.kbank := NEW.transfer;
    ELSIF NEW.payment_method ILIKE '%กรุงไทย%' THEN
      NEW.ktb := NEW.transfer;
    ELSE
      NEW.qr_payment := NEW.transfer;    -- 'QR' / ว่าง / ธนาคารอื่น → QR Paymet
    END IF;
  END IF;

  -- บัตรเครดิต → Online (บิลออนไลน์) / Front Office (อื่น)
  IF COALESCE(NEW.credit_card,0) > 0 THEN
    IF NEW.bill_no ILIKE '%ONLIN%' THEN
      NEW.online := NEW.credit_card;
    ELSE
      NEW.front_office := NEW.credit_card;
    END IF;
  END IF;

  -- ── ARP / ABB (sync upsert bills ก่อน payments เสมอ → bill_type อ่านได้) ──
  SELECT bill_type INTO v_type FROM daily_sale_bills WHERE bill_no = NEW.bill_no;

  IF COALESCE(NEW.dummy,0) > 0 THEN
    IF TRIM(COALESCE(v_type,'')) = 'แลกสินค้า' THEN
      NEW.abb_online := NEW.dummy;       -- รับรางวัล ABB ONLINE
    ELSE
      NEW.abb_easy := NEW.dummy;         -- ชำระด้วย ARP EASY
    END IF;
  ELSIF TRIM(COALESCE(v_type,'')) = 'แลกสินค้า' THEN
    NEW.arp_usd := COALESCE(NEW.amount,0);   -- แลก ARP POINT (USD)
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 3) Re-derive ข้อมูลเดิมทั้งหมด (no-op update → ยิง BEFORE UPDATE trigger) ──
UPDATE daily_sale_payments
  SET dummy = dummy
  WHERE corrected IS NOT TRUE
    AND source_file IS DISTINCT FROM 'ewallet-topup-sync';

-- ============================================================
-- ตรวจผล — ARP 12/7/2569 ต้องได้ ABB EASY 4,500 · ABB ONLINE 2,050 · ARP USD 319
--   SELECT SUM(p.abb_easy), SUM(p.abb_online), SUM(p.arp_usd)
--     FROM daily_sale_payments p JOIN daily_sale_bills b USING (bill_no)
--    WHERE b.business_date = '2026-07-12'
--      AND (p.dummy > 0 OR b.bill_type = 'แลกสินค้า');
-- ============================================================
