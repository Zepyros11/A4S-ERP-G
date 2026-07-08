-- ============================================================
-- Migration 029: Auto-derive payment split (KBANK/KTB, Front Office/Online)
--   จากยอดรวม transfer/credit_card + payment_method (ชื่อธนาคาร)
--
-- ปัญหา: sync เขียน payment เป็นยอดรวม (transfer / credit_card) แต่ตาราง
--   Daily Sale แสดงคอลัมน์ split (KBANK/KTB, Front Office/Online) → ช่องว่าง
--   + ผลต่างแดง เพราะ split = 0 (เงินอยู่ใน transfer/credit_card ที่ไม่โชว์)
--
-- แก้: trigger BEFORE INSERT/UPDATE บน daily_sale_payments เติม split อัตโนมัติ
--   เงินโอน (transfer):
--     payment_method มี 'กรุงไทย' → ktb
--     อื่น ๆ (กสิกร/ไม่ระบุ)       → kbank   (default · CS แก้ได้)
--   บัตรเครดิต (credit_card):
--     บิล ...ONLIN... → online · อื่น → front_office
--
-- Guard (ไม่ทับของที่จำแนกแล้ว):
--   - corrected = true          → ข้าม (CS แก้เอง = ต้นฉบับ)
--   - split มีค่าอยู่แล้ว (>0)   → ข้าม (import เก่า / ewallet trigger / CS)
-- → sync ครั้งต่อไป + ของเก่าที่ backfill = โชว์เงินครบทุกช่องอัตโนมัติ
-- ============================================================

CREATE OR REPLACE FUNCTION daily_sale_derive_split()
RETURNS trigger AS $$
BEGIN
  -- เคารพการจำแนกที่มีอยู่: CS แก้แล้ว หรือ split ถูกเซ็ตมาแล้ว → ไม่แตะ
  IF NEW.corrected IS TRUE THEN RETURN NEW; END IF;
  IF COALESCE(NEW.front_office,0) + COALESCE(NEW.online,0)
   + COALESCE(NEW.kbank,0) + COALESCE(NEW.ktb,0) > 0 THEN
    RETURN NEW;
  END IF;

  -- เงินโอน → KBANK/KTB ตามธนาคารใน payment_method
  IF COALESCE(NEW.transfer,0) > 0 THEN
    IF NEW.payment_method ILIKE '%กรุงไทย%' THEN
      NEW.ktb := NEW.transfer;
    ELSE
      NEW.kbank := NEW.transfer;      -- กสิกร / ธนาคารอื่น / ไม่ระบุ
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

DROP TRIGGER IF EXISTS trg_derive_payment_split ON daily_sale_payments;
CREATE TRIGGER trg_derive_payment_split
  BEFORE INSERT OR UPDATE ON daily_sale_payments
  FOR EACH ROW EXECUTE FUNCTION daily_sale_derive_split();

-- ── Backfill: payment เก่าที่ยังไม่ split (touch เพื่อยิง trigger) ──
UPDATE daily_sale_payments
  SET transfer = transfer        -- no-op เพื่อให้ BEFORE UPDATE trigger เติม split
  WHERE corrected IS NOT TRUE
    AND (COALESCE(front_office,0)+COALESCE(online,0)+COALESCE(kbank,0)+COALESCE(ktb,0)) = 0
    AND (COALESCE(transfer,0) > 0 OR COALESCE(credit_card,0) > 0);

-- ============================================================
-- DONE
-- Test:
--   -- ควรเหลือน้อย (บิลที่จ่ายช่องอื่นล้วน เช่น cash/qr/arp)
--   SELECT COUNT(*) FROM daily_sale_payments
--     WHERE corrected IS NOT TRUE
--       AND (COALESCE(front_office,0)+COALESCE(online,0)+COALESCE(kbank,0)+COALESCE(ktb,0))=0
--       AND (COALESCE(transfer,0)>0 OR COALESCE(credit_card,0)>0);
--   -- ดูผล split
--   SELECT bill_no, transfer, credit_card, kbank, ktb, front_office, online, payment_method
--     FROM daily_sale_payments WHERE source_file <> 'DATA_CS-import'
--       AND (kbank>0 OR ktb>0 OR front_office>0 OR online>0) LIMIT 20;
-- ============================================================
