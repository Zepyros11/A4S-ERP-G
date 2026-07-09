-- ============================================================
-- Migration 100: ปิดรอบวัน (Close Round) — cutoff เวลา · บิลหลังปิดรอบ = วันถัดไป
--
-- แนวคิด: business_date ของบิล = คำนวณจาก sale_date + จุดปิดรอบ
--   - ปกติ  business_date = sale_date
--   - ถ้าวันนั้น "ปิดรอบ" แล้ว และบิลขาย (sale_datetime) หลังเวลาปิด
--       → business_date = sale_date + 1 (เด้งเป็นวันถัดไป)
--
-- ทำเป็น trigger → deterministic ทั้ง sync อัตโนมัติ (cron) และกดเอง (manual)
--   ปุ่ม "ปิดรอบ" บน UI แค่ INSERT แถวลง daily_sale_day_close (เวลาปิด = now)
-- ============================================================

CREATE TABLE IF NOT EXISTS daily_sale_day_close (
  id          BIGSERIAL PRIMARY KEY,
  close_date  DATE NOT NULL UNIQUE,                 -- วันบัญชีที่ปิดรอบ (global · ทุกสาขา)
  closed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),   -- เวลาปิด (cutoff) · บิลหลังเวลานี้ = วันถัดไป
  closed_by   TEXT,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- RLS: อ่าน/เขียนผ่าน anon key (เหมือน config อื่นในโมดูล)
ALTER TABLE daily_sale_day_close ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dsc_all ON daily_sale_day_close;
CREATE POLICY dsc_all ON daily_sale_day_close FOR ALL USING (true) WITH CHECK (true);

-- ── trigger: ตี business_date ตาม sale_date + close cutoff ──
CREATE OR REPLACE FUNCTION daily_sale_assign_business_date()
RETURNS trigger AS $$
DECLARE
  v_closed_at TIMESTAMPTZ;
BEGIN
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

DROP TRIGGER IF EXISTS trg_daily_sale_business_date ON daily_sale_bills;
CREATE TRIGGER trg_daily_sale_business_date
  BEFORE INSERT OR UPDATE ON daily_sale_bills
  FOR EACH ROW EXECUTE FUNCTION daily_sale_assign_business_date();

-- หมายเหตุ: แถวเดิมที่มี business_date อยู่แล้วไม่ถูกแตะ (trigger ทำเฉพาะ insert/update ใหม่)
--   ถ้าอยาก re-apply ทั้งหมด: UPDATE daily_sale_bills SET sale_date = sale_date;

-- ============================================================
-- DONE · Test:
--   -- ปิดรอบวันนี้
--   INSERT INTO daily_sale_day_close (close_date) VALUES (CURRENT_DATE)
--     ON CONFLICT (close_date) DO UPDATE SET closed_at = now();
--   -- บิลที่ขายหลัง now ของวันนี้ → business_date = พรุ่งนี้
--   SELECT bill_no, sale_datetime, business_date FROM daily_sale_bills
--     WHERE sale_date = CURRENT_DATE ORDER BY sale_datetime DESC LIMIT 10;
-- ============================================================
