-- ============================================================
-- Migration 031: เพิ่มคอลัมน์ delivery_note (หมายเหตุจัดส่งของบิลออนไลน์)
--
-- แท็บ "บิลออนไลน์" มี dropdown หมายเหตุ 5 ค่า (ตามชีท DailySaleCS):
--   จัดส่ง กทม. · รับเอง กทม. · จัดส่ง DP · รับเอง DP · เรียกแกร็ป
-- เป็นค่าที่ CS กรอกเอง (ไม่มีในต้นทาง answerforsuccess)
--
-- เก็บแยกจาก notes เพราะ sync (upsert merge-duplicates) ไม่เคยส่ง delivery_note
-- → ค่าที่ CS เลือกไว้ "ไม่หาย" ตอน re-sync/backfill (parser ไม่ map คอลัมน์นี้)
-- ============================================================

ALTER TABLE daily_sale_bills
  ADD COLUMN IF NOT EXISTS delivery_note TEXT;

-- ============================================================
-- DONE · Test:
--   SELECT bill_no, delivery_note FROM daily_sale_bills
--     WHERE bill_no ILIKE '%ONLIN%' LIMIT 20;
-- ============================================================
