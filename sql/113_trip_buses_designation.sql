-- ============================================================
-- Migration 113: trip_buses — designation (กลุ่มเป้าหมายของรถแต่ละคัน)
--
-- Why:
--   หน้าจัดที่นั่งรถบัส (room-assign.html — แท็บรถบัส) ต้องการกำหนดได้ว่า
--   รถแต่ละคัน "สำหรับ" สัญชาติ/ตำแหน่งไหน เพื่อให้ปุ่ม "ตามคู่ห้องพัก"
--   จัดคนลงรถได้ตรงตามที่ตั้งใจ
--
--   target_nationality — สัญชาติเป้าหมาย เก็บได้ "หลายสัญชาติ" (text[])
--                        เพราะ 1 คันมักรวมหลายชาติตามกลุ่มภาษาที่ใช้
--                        (เช่น ฝรั่งเศส: Beninese/Ivoirienne/Togolese/... )
--   target_pin         — ตำแหน่งเป้าหมาย เก็บได้ "หลายตำแหน่ง" (text[])
--                        เช่น คันสำหรับผู้บริหาร: AVP/VP/SVP
--   ทั้งคู่ NULL/ว่าง = ไม่กำหนด (รับทุกค่า)
--
-- Idempotent — รันซ้ำได้ (รองรับกรณีเคยสร้างเป็น TEXT มาก่อน → แปลงเป็น text[])
-- ============================================================

ALTER TABLE trip_buses ADD COLUMN IF NOT EXISTS target_nationality text[];
ALTER TABLE trip_buses ADD COLUMN IF NOT EXISTS target_pin         text[];

-- ถ้าเวอร์ชันก่อนหน้าเคยสร้างคอลัมน์เป็น TEXT (เลือกได้ค่าเดียว)
-- → แปลงเป็น text[] โดยห่อค่าเดิมเป็น array 1 สมาชิก
DO $$
DECLARE
  col text;
BEGIN
  FOREACH col IN ARRAY ARRAY['target_nationality', 'target_pin'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'trip_buses'
        AND column_name = col
        AND data_type  = 'text'
    ) THEN
      EXECUTE format(
        'ALTER TABLE trip_buses ALTER COLUMN %I TYPE text[] USING ('
        || 'CASE WHEN %I IS NULL OR btrim(%I) = '''' THEN NULL '
        || 'ELSE ARRAY[%I] END)',
        col, col, col, col
      );
    END IF;
  END LOOP;
END $$;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅
-- Verify:
--   SELECT bus_id, bus_no, target_nationality, target_pin
--     FROM trip_buses WHERE trip_id = 1;
-- ============================================================
