-- ============================================================
-- Migration 030: Fix payment-split derive — เงินโอนว่าง/QR → qr_payment (ไม่ใช่ kbank)
--
-- แก้ sql/029 ให้ตรงสูตร PAYMENT GATEWAY (ซึ่ง auto-derive จาก
--   '01_รายงานช่องทางการชำระเงิน' = daily_sale_payments):
--     เงินโอน (transfer) + payment_method:
--       'กสิกร'  → KBANK
--       'กรุงไทย' → KTB
--       'QR' / ว่าง / อื่น → QR Paymet   ← เดิม 029 ใส่ KBANK (ผิด)
--     บัตรเครดิต (credit_card): STHBKK→Front Office · STHONLI→Online
--
-- ทำ function ให้ idempotent: reset คอลัมน์ที่ derive แล้วคำนวณใหม่จาก
--   transfer/credit_card ทุกครั้ง (รันซ้ำได้ · แก้ข้อมูลที่ 029 ทำผิดไว้)
-- Guard: corrected=true (CS แก้เอง) · source='ewallet-topup-sync' (028 คุมเอง) → ข้าม
-- ============================================================

CREATE OR REPLACE FUNCTION daily_sale_derive_split()
RETURNS trigger AS $$
BEGIN
  IF NEW.corrected IS TRUE THEN RETURN NEW; END IF;              -- CS แก้แล้ว = ต้นฉบับ
  IF NEW.source_file = 'ewallet-topup-sync' THEN RETURN NEW; END IF;  -- 028 split จาก topup_details

  -- reset คอลัมน์ที่ derive (idempotent — คำนวณใหม่จาก aggregate เสมอ)
  NEW.kbank := 0; NEW.ktb := 0; NEW.front_office := 0; NEW.online := 0; NEW.qr_payment := 0;

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

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- trigger เดิม (จาก 029) ใช้ function ใหม่นี้อัตโนมัติ (CREATE OR REPLACE)

-- ── Re-derive: touch ทุกแถวที่ไม่ corrected + ไม่ใช่ ewallet-trigger (แก้ที่ 029 ทำผิด) ──
UPDATE daily_sale_payments
  SET transfer = transfer     -- no-op เพื่อยิง BEFORE UPDATE trigger ให้คำนวณ split ใหม่
  WHERE corrected IS NOT TRUE
    AND source_file IS DISTINCT FROM 'ewallet-topup-sync';

-- ============================================================
-- DONE
-- Test:
--   -- เงินโอนว่าง/QR ควรอยู่ qr_payment (ไม่ใช่ kbank)
--   SELECT bill_no, transfer, kbank, ktb, qr_payment, payment_method
--     FROM daily_sale_payments
--     WHERE transfer > 0 AND (payment_method IS NULL OR payment_method ILIKE '%QR%')
--       AND corrected IS NOT TRUE LIMIT 20;
--   -- ควรได้ qr_payment = transfer, kbank = 0
-- ============================================================
