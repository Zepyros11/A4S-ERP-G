-- ============================================================
-- Migration 168: ปักหมุดวันบัญชีเอง (business_date manual override)
--
-- ปัญหา: บิลออนไลน์ (STHONLIN) บางตัว CS จับลงวันบัญชีแบบ manual
--   ไม่ตรงกับ sale_date (เช่น 2949 ขาย 08 ก.ค. แต่ต้องนับเป็น 09 ก.ค.)
--   trigger migration 100 บังคับ business_date = sale_date เสมอ → แก้ค่าตรง ๆ ไม่อยู่
--
-- ทางแก้: เพิ่มคอลัมน์ override + ให้ trigger เคารพค่านั้นก่อนทุกอย่าง
--   - business_date_manual มีค่า → business_date = ค่านั้น (ชนะ close-round)
--   - business_date_manual = NULL → คำนวณอัตโนมัติเหมือนเดิม (sale_date / +1 ถ้าปิดรอบ)
--   sync ไม่ส่งคอลัมน์นี้มา → upsert ไม่ล้าง → ค่าที่ปักหมุดอยู่ถาวร
-- ============================================================

-- ── 1) เพิ่มคอลัมน์ override ──
ALTER TABLE daily_sale_bills
  ADD COLUMN IF NOT EXISTS business_date_manual DATE;

COMMENT ON COLUMN daily_sale_bills.business_date_manual IS
  'ปักหมุดวันบัญชีเอง (reconcile ให้ตรง Google Sheet) · NULL = คำนวณอัตโนมัติจาก sale_date';

-- ── 2) แก้ trigger function ให้เช็ค override ก่อน ──
CREATE OR REPLACE FUNCTION daily_sale_assign_business_date()
RETURNS trigger AS $$
DECLARE
  v_closed_at TIMESTAMPTZ;
BEGIN
  -- ปักหมุดเอง → ชนะทุกอย่าง (ใช้ตอน reconcile ให้ตรง Google Sheet)
  IF NEW.business_date_manual IS NOT NULL THEN
    NEW.business_date := NEW.business_date_manual;
    RETURN NEW;
  END IF;

  IF NEW.sale_date IS NULL THEN
    RETURN NEW;   -- ไม่มี sale_date → ไม่แตะ
  END IF;

  SELECT closed_at INTO v_closed_at
    FROM daily_sale_day_close
    WHERE close_date = NEW.sale_date;

  IF v_closed_at IS NOT NULL
     AND NEW.sale_datetime IS NOT NULL
     AND NEW.sale_datetime > v_closed_at THEN
    NEW.business_date := NEW.sale_date + 1;   -- ขายหลังปิดรอบ → วันถัดไป
  ELSE
    NEW.business_date := NEW.sale_date;        -- ปกติ = วันขายจริง
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- trigger trg_daily_sale_business_date (migration 100) ชี้ที่ function นี้อยู่แล้ว → ไม่ต้องสร้างใหม่

-- ============================================================
-- DONE · การใช้งาน:
--   -- ปักหมุดบิลไปวันบัญชีที่ต้องการ (trigger จะ set business_date ให้เอง)
--   UPDATE daily_sale_bills SET business_date_manual = '2026-07-09'
--     WHERE bill_no = 'STHONLIN2607002949';
--
--   -- ยกเลิกปักหมุด → กลับไปคำนวณอัตโนมัติ
--   UPDATE daily_sale_bills SET business_date_manual = NULL
--     WHERE bill_no = 'STHONLIN2607002949';
--
--   -- ตรวจผล
--   SELECT bill_no, sale_date, business_date, business_date_manual
--     FROM daily_sale_bills WHERE bill_no = 'STHONLIN2607002949';
-- ============================================================
