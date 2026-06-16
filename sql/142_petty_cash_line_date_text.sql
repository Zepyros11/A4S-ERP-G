-- ============================================================
-- Migration 142: petty_cash_items.line_date → TEXT
--
-- Why:
--   ใบ Petty Cash ต้นฉบับใช้วันที่แบบ พ.ศ. ย่อ "21.01.69" (วว/ดด/ปป)
--   ผู้ใช้พิมพ์ปี 2 หลักได้ → ต้องเก็บเป็น "ข้อความตามที่พิมพ์" ไม่ใช่ DATE
--   (ถ้าเป็น DATE จะ insert พลาด + บังคับปี 4 หลัก ไม่ตรงต้นฉบับ)
--
--   เปลี่ยน line_date จาก DATE → TEXT (ค่าที่มีอยู่แปลงเป็น 'YYYY-MM-DD' อัตโนมัติ)
--   Idempotent — รันซ้ำได้ (alter เฉพาะตอนยังเป็น date)
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'petty_cash_items'
      AND column_name = 'line_date'
      AND data_type = 'date'
  ) THEN
    ALTER TABLE petty_cash_items
      ALTER COLUMN line_date TYPE text USING line_date::text;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅  Verify:
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name='petty_cash_items' AND column_name='line_date';
--   → ควรเป็น 'text'
-- ============================================================
