-- ============================================================
-- Migration 028: Auto-propagate ewallet topup → daily_sale_bills + payments
--
-- ปัญหา: sync ดึงบิลเติมเงิน ewallet ลง daily_sale_topup_bills (+ topup_details)
--   แต่ตาราง "E-WALLET" ในหน้า Daily Sale อ่านจาก daily_sale_bills → ไม่เห็นบิล sync
--
-- แก้: trigger ทุกครั้งที่ topup_bills / topup_details เปลี่ยน → สร้าง/อัปเดต
--   บิลคู่ใน daily_sale_bills (bill_type='EWALLET') + daily_sale_payments
--   โดย "แยก split" ช่องทางจาก topup_details (03 report):
--     เงินสด            → cash
--     เงินโอน + กรุงไทย → ktb
--     เงินโอน + อื่น ๆ   → kbank   (ธนาคารอื่น/ไม่ระบุ default KBANK · CS แก้ได้)
--     บัตรเครดิต         → online (บิล ...ONLIN...) / front_office (อื่น)
--     Gift Voucher      → gift_voucher
--   ถ้าไม่มี details → fallback ใช้ยอดรวมใน topup_bills (transfer→kbank, credit→fo/online)
--
-- Guard: ถ้า payments row นั้น corrected=true (CS แก้แล้ว) → ไม่ทับ (เหมือน hourly sync)
-- ไม่แตะ Playwright sync · topup_bills/details ยังเป็นแหล่งดิบ (แท็บ "เติม E-Wallet" ใช้ต่อ)
-- ============================================================

CREATE OR REPLACE FUNCTION daily_sale_sync_ewallet_bill(p_bill TEXT)
RETURNS void AS $$
DECLARE
  tb        daily_sale_topup_bills%ROWTYPE;
  v_online  boolean;
  v_cnt     int := 0;
  v_cash    numeric := 0;
  v_kbank   numeric := 0;   -- เงินโอน (กสิกร + ธนาคารอื่น/ไม่ระบุ)
  v_ktb     numeric := 0;   -- เงินโอน กรุงไทย
  v_card    numeric := 0;   -- บัตรเครดิต (รวม ก่อนแยก FO/Online)
  v_gift    numeric := 0;
  v_fo      numeric := 0;
  v_online_amt numeric := 0;
BEGIN
  SELECT * INTO tb FROM daily_sale_topup_bills WHERE bill_no = p_bill;
  IF NOT FOUND THEN RETURN; END IF;                    -- ถูกลบไปแล้ว
  v_online := (p_bill ILIKE '%ONLIN%');

  -- รวมยอดจาก topup_details (03) ต่อบิล
  SELECT
    COUNT(*),
    COALESCE(SUM(amount) FILTER (WHERE payment_channel = 'เงินสด'), 0),
    COALESCE(SUM(amount) FILTER (WHERE payment_channel = 'เงินโอน' AND (payment_format IS DISTINCT FROM 'ธนาคาร กรุงไทย')), 0),
    COALESCE(SUM(amount) FILTER (WHERE payment_channel = 'เงินโอน' AND payment_format = 'ธนาคาร กรุงไทย'), 0),
    COALESCE(SUM(amount) FILTER (WHERE payment_channel = 'บัตรเครดิต'), 0),
    COALESCE(SUM(amount) FILTER (WHERE payment_channel = 'Gift Voucher'), 0)
  INTO v_cnt, v_cash, v_kbank, v_ktb, v_card, v_gift
  FROM daily_sale_topup_details WHERE bill_no = p_bill;

  -- ไม่มี details → ใช้ยอดรวมใน topup_bills
  IF v_cnt = 0 THEN
    v_cash  := COALESCE(tb.cash, 0);
    v_kbank := COALESCE(tb.transfer, 0);   -- โอนไม่ทราบธนาคาร default KBANK
    v_ktb   := 0;
    v_card  := COALESCE(tb.credit_card, 0);
    v_gift  := COALESCE(tb.gift_voucher, 0);
  END IF;

  -- แยกบัตรเครดิต → Online (บิลออนไลน์) / Front Office (อื่น)
  IF v_online THEN v_online_amt := v_card; ELSE v_fo := v_card; END IF;

  -- 1) upsert บิล (identity) เข้า daily_sale_bills
  INSERT INTO daily_sale_bills
    (bill_no, sale_date, business_date, member_code, member_name, amount,
     branch, channel, bill_type, recorded_by, notes, source_file)
  VALUES
    (tb.bill_no, tb.sale_date, tb.business_date, tb.member_code, tb.member_name, tb.amount,
     tb.branch, CASE WHEN v_online THEN 'Online' ELSE 'Branch' END, 'EWALLET',
     tb.recorded_by, tb.notes, 'ewallet-topup-sync')
  ON CONFLICT (bill_no) DO UPDATE SET
    sale_date     = EXCLUDED.sale_date,
    -- คงวันปิดเดิมถ้าบิลถูกปิดวันไปแล้ว (กันบิล import เก่ากลายเป็น pending ย้อนหลัง)
    business_date = COALESCE(daily_sale_bills.business_date, EXCLUDED.business_date),
    member_code   = COALESCE(EXCLUDED.member_code, daily_sale_bills.member_code),
    member_name   = COALESCE(EXCLUDED.member_name, daily_sale_bills.member_name),
    amount        = EXCLUDED.amount,
    bill_type     = 'EWALLET';

  -- 2) upsert payments (split) — ไม่ทับถ้า corrected=true
  INSERT INTO daily_sale_payments
    (bill_no, sale_date, amount, cash, front_office, online, kbank, ktb,
     credit_card, transfer, gift_voucher, source_file)
  VALUES
    (p_bill, tb.sale_date, tb.amount, v_cash, v_fo, v_online_amt, v_kbank, v_ktb,
     v_fo + v_online_amt, v_kbank + v_ktb, v_gift, 'ewallet-topup-sync')
  ON CONFLICT (bill_no) DO UPDATE SET
    sale_date    = EXCLUDED.sale_date,
    amount       = EXCLUDED.amount,
    cash         = EXCLUDED.cash,
    front_office = EXCLUDED.front_office,
    online       = EXCLUDED.online,
    kbank        = EXCLUDED.kbank,
    ktb          = EXCLUDED.ktb,
    credit_card  = EXCLUDED.credit_card,
    transfer     = EXCLUDED.transfer,
    gift_voucher = EXCLUDED.gift_voucher
  WHERE daily_sale_payments.corrected IS NOT TRUE;   -- ← guard: CS แก้แล้วไม่ทับ
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── trigger wrapper ──
CREATE OR REPLACE FUNCTION daily_sale_ewallet_trg()
RETURNS trigger AS $$
BEGIN
  PERFORM daily_sale_sync_ewallet_bill(COALESCE(NEW.bill_no, OLD.bill_no));
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ewallet_from_topup_bills ON daily_sale_topup_bills;
CREATE TRIGGER trg_ewallet_from_topup_bills
  AFTER INSERT OR UPDATE ON daily_sale_topup_bills
  FOR EACH ROW EXECUTE FUNCTION daily_sale_ewallet_trg();

DROP TRIGGER IF EXISTS trg_ewallet_from_topup_details ON daily_sale_topup_details;
CREATE TRIGGER trg_ewallet_from_topup_details
  AFTER INSERT OR UPDATE OR DELETE ON daily_sale_topup_details
  FOR EACH ROW EXECUTE FUNCTION daily_sale_ewallet_trg();

-- ── Backfill: บิล topup ที่มีอยู่แล้วทั้งหมด ──
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT bill_no FROM daily_sale_topup_bills LOOP
    PERFORM daily_sale_sync_ewallet_bill(r.bill_no);
  END LOOP;
END $$;

-- ============================================================
-- DONE
-- Test (หลังรัน):
--   -- ควรได้บิล ewallet เพิ่มใน daily_sale_bills จาก sync
--   SELECT COUNT(*) FROM daily_sale_bills WHERE source_file='ewallet-topup-sync';
--   -- ดู split ที่ map มา
--   SELECT b.bill_no, p.cash, p.kbank, p.ktb, p.front_office, p.online, p.gift_voucher, b.amount
--     FROM daily_sale_bills b JOIN daily_sale_payments p USING (bill_no)
--     WHERE b.source_file='ewallet-topup-sync' LIMIT 20;
-- ============================================================
