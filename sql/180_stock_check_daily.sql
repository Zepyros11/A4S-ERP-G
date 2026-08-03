-- ============================================================
-- Migration 180: ตรวจนับสต็อกเป็น "รายวัน" (1 วัน = 1 ใบ)
--
-- Why (บริบทการทำงานจริง):
--   ทุกเย็นพนักงานนับของบนชั้นแล้วเทียบกับ "ยอดในระบบหลังบ้านของบริษัท"
--   (คนละระบบกับ ERP ตัวนี้ · ระบบหลังบ้านมีแต่ตัวเลขดิบ ไม่มี dashboard/แจ้งเตือน
--    ERP ตัวนี้จึงเป็นชั้นที่ครอบไว้เพื่อให้เห็นของหาย-ของเกินและเตือนของใกล้หมด)
--   เดิมต้องกด "เปิดรอบใหม่" เองทุกครั้ง ซึ่งไม่เข้ากับงานที่ทำทุกวัน
--   → เปลี่ยนเป็นเลื่อนวันที่เอา (เหมือนหน้า Daily Sale ของ CS) และสร้างใบของวันให้อัตโนมัติ
--
--   ⚠️ คลังที่นับคือ "กทม.ชั้น3" ซึ่ง **การเข้า-ออกของคลังนี้ไม่ได้เดินตาม flow PO/OD
--   ปกติของ ERP** → ยอดในคอลัมน์ "ยอดในระบบ" ต้องมาจากไฟล์ที่อัปโหลด/กรอกมือ
--   ไม่ใช่จาก stock_movements ของ ERP (ปุ่ม "ดึงยอดในระบบ" จึงใช้กับคลังนี้ไม่ได้)
--
-- กติกาการล็อก:
--   แก้ไขได้เมื่อ  →  เป็นใบของ "วันนี้"  หรือ  ถูกกดปลดล็อก (edit_unlocked = true)
--   วันตัดที่เที่ยงคืนตามเวลาไทย — ต้องใช้ (now() AT TIME ZONE 'Asia/Bangkok')::date
--   ห้ามใช้ CURRENT_DATE เฉย ๆ เพราะ Supabase รันที่ UTC → ช่วง 00:00–07:00 ของไทย
--   ยังนับเป็น "เมื่อวาน" ใบของวันนี้จะถูกล็อกทันทีที่เปิดใช้ตอนเช้า
--
--   คอลัมน์ status เดิม ('draft'/'closed') เลิกใช้แล้ว — เก็บไว้เฉย ๆ ไม่ลบ
--   เพื่อไม่ให้ข้อมูลเก่าหาย · ตัวตัดสินสิทธิ์แก้ไขคือ check_date + edit_unlocked เท่านั้น
--
-- ⚠️ ต้องรันหลัง sql/178 + sql/179
-- Idempotent — รันซ้ำได้
-- ============================================================

-- ── 1. ปลดล็อกแก้ไขใบย้อนหลัง ────────────────────────────────
ALTER TABLE stock_check_sessions
  ADD COLUMN IF NOT EXISTS edit_unlocked BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN stock_check_sessions.edit_unlocked IS
  'true = ปลดล็อกให้แก้ใบของวันที่ผ่านมาแล้ว · ใบของวันนี้แก้ได้เสมอโดยไม่ต้องตั้งค่านี้';

COMMENT ON COLUMN stock_check_sessions.status IS
  'เลิกใช้ตั้งแต่ sql/180 — สิทธิ์แก้ไขดูจาก check_date + edit_unlocked แทน';

-- ── 2. 1 วัน = 1 ใบ (ต่อคลัง) ────────────────────────────────
--     กันเผลอสร้างซ้ำตอนเปิดหลายแท็บพร้อมกัน — หน้าเว็บสร้างใบให้อัตโนมัติ
--     ถ้าไม่มี unique กันไว้ 2 แท็บที่เปิดพร้อมกันจะได้ใบซ้อนกัน 2 ใบของวันเดียว
--     COALESCE(...,0) เพราะ warehouse_id เป็น NULL ได้ (= ทุกคลัง) และ NULL
--     ไม่ชนกันเองใน unique index ธรรมดา → จะสร้างใบ "ทุกคลัง" ซ้ำได้ไม่จำกัด
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_check_sessions_date_wh
  ON stock_check_sessions (check_date, COALESCE(warehouse_id, 0));

-- ── 3. trigger กันแก้ใบที่ล็อกแล้ว ───────────────────────────
--     แทนตัวเดิมใน sql/178 ที่ดูจาก status = 'closed'
--     หมายเหตุการเขียน: ต้องแยกทาง TG_OP ให้ชัด — ใน PL/pgSQL ตัวแปร NEW
--     ไม่มีค่าตอน DELETE (อ้างถึงแล้ว error) และ OLD ไม่มีค่าตอน INSERT
--     ส่วน RETURN ก็ต้องคืน OLD สำหรับ DELETE / NEW สำหรับ INSERT-UPDATE ตรง ๆ
--     (COALESCE(NEW, OLD) ใช้กับ record ไม่ได้)
CREATE OR REPLACE FUNCTION guard_stock_check_line_closed()
RETURNS TRIGGER AS $$
DECLARE
  sess_id   BIGINT;
  sess_date DATE;
  sess_open BOOLEAN;
  today_th  DATE := (now() AT TIME ZONE 'Asia/Bangkok')::date;
BEGIN
  IF TG_OP = 'DELETE' THEN sess_id := OLD.session_id;
  ELSE                     sess_id := NEW.session_id;
  END IF;

  SELECT check_date, edit_unlocked
    INTO sess_date, sess_open
    FROM stock_check_sessions
   WHERE id = sess_id;

  -- ไม่เจอ session = กำลังถูก cascade ลบพร้อมหัวใบ → ปล่อยผ่าน
  IF sess_date IS NULL
     OR sess_date >= today_th          -- ใบของวันนี้ (หรืออนาคต) แก้ได้เสมอ
     OR sess_open THEN                 -- ใบเก่าที่กดปลดล็อกไว้
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ใบตรวจนับวันที่ % ถูกล็อกแล้ว — กด "ปลดล็อกแก้ไข" ก่อนถึงจะลบรายการได้', sess_date;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'ใบตรวจนับวันที่ % ถูกล็อกแล้ว — กด "ปลดล็อกแก้ไข" ก่อนถึงจะเพิ่มรายการได้', sess_date;
  END IF;

  IF NEW.qty_box        IS DISTINCT FROM OLD.qty_box
  OR NEW.qty_piece      IS DISTINCT FROM OLD.qty_piece
  OR NEW.qty_borrow     IS DISTINCT FROM OLD.qty_borrow
  OR NEW.qty_issue      IS DISTINCT FROM OLD.qty_issue
  OR NEW.qty_system     IS DISTINCT FROM OLD.qty_system
  OR NEW.pieces_per_box IS DISTINCT FROM OLD.pieces_per_box THEN
    RAISE EXCEPTION 'ใบตรวจนับวันที่ % ถูกล็อกแล้ว — กด "ปลดล็อกแก้ไข" ก่อนถึงจะแก้ตัวเลขได้', sess_date;
  END IF;

  RETURN NEW;   -- แก้หมายเหตุอย่างเดียวยังทำได้แม้ใบจะล็อก
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_check_lines_guard ON stock_check_lines;
CREATE TRIGGER trg_stock_check_lines_guard
  BEFORE INSERT OR UPDATE OR DELETE ON stock_check_lines
  FOR EACH ROW EXECUTE FUNCTION guard_stock_check_line_closed();

-- ── 4. วิวรายงานพ่วงสถานะล็อก ────────────────────────────────
--     DROP ก่อนเสมอ — CREATE OR REPLACE VIEW เพิ่มคอลัมน์กลางชุดไม่ได้
DROP VIEW IF EXISTS stock_check_report;
CREATE VIEW stock_check_report AS
SELECT
  l.id            AS line_id,
  s.id            AS session_id,
  s.check_date,
  s.title         AS session_title,
  s.warehouse_id,
  s.warehouse_name,
  s.edit_unlocked,
  (s.check_date >= (now() AT TIME ZONE 'Asia/Bangkok')::date OR s.edit_unlocked) AS is_editable,
  l.sort_order,
  l.item_id,
  l.product_id,
  l.product_code,
  l.product_name,
  l.category_name,
  l.box_unit_name,
  l.pieces_per_box,
  l.qty_box,
  l.qty_piece,
  l.total_pieces,
  l.qty_borrow,
  l.qty_issue,
  l.qty_system,
  l.variance,
  -- ตัดทศนิยม .00 ที่ไม่จำเป็นทิ้ง ให้ได้ "35" ไม่ใช่ "35.00" แต่ยังเก็บ "35.5" ไว้
  CASE
    WHEN l.variance IS NULL THEN 'ยังไม่นับ'
    WHEN l.variance > 0 THEN
      'ของเกิน ' || rtrim(rtrim(to_char(l.variance,  'FM999999999990.99'), '0'), '.') || ' ชิ้น'
    WHEN l.variance < 0 THEN
      'ของหาย '  || rtrim(rtrim(to_char(-l.variance, 'FM999999999990.99'), '0'), '.') || ' ชิ้น'
    ELSE 'ตรงกัน'
  END             AS variance_label,
  (l.qty_box IS NOT NULL OR l.qty_piece IS NOT NULL)
    AND l.total_pieces < s.low_stock_threshold  AS is_low_stock,
  s.low_stock_threshold,
  l.note,
  l.counted_by_name,
  l.counted_at
FROM stock_check_lines l
JOIN stock_check_sessions s ON s.id = l.session_id;

GRANT SELECT ON stock_check_report TO anon;

-- ── ตรวจผล ──────────────────────────────────────────────────
-- วันที่ไทยที่ระบบใช้ตัดรอบ (ต้องตรงกับนาฬิกาบนผนัง):
--   SELECT (now() AT TIME ZONE 'Asia/Bangkok')::date AS วันนี้ตามเวลาไทย, now() AS utc_now;
-- ใบทั้งหมด + สถานะแก้ไข:
--   SELECT id, check_date, warehouse_name, edit_unlocked,
--          (check_date >= (now() AT TIME ZONE 'Asia/Bangkok')::date OR edit_unlocked) AS แก้ไขได้
--     FROM stock_check_sessions ORDER BY check_date DESC;
