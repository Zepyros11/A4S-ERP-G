-- ============================================================
-- Migration 032: บล็อกผู้รับผิดชอบ + หมายเหตุพิเศษ (ท้ายตารางบิลขาย)
--
-- ตามชีท DailySaleCS ท้ายตาราง E-WALLET มีบล็อกลงชื่อผู้รับผิดชอบ 7 บทบาท
--   (ผู้เรียงบิล / ผู้สรุปยอดบิลออนไลน์ / ผู้ดึงยอด / ผู้หยอดบิลลงเดลี่ /
--    ผู้ปริ้นเดลี่ / ผู้ตรวจสอบก่อนส่งบัญชี / ผู้สรุปยอด E-WALLET)
--   + หมายเหตุ รายการพิเศษในวันนี้
--
-- เก็บที่ daily_sale_reconcile (คีย์ reconcile_date + branch เดียวกับตรวจบิล):
--   signoff       JSONB  = { bill_sorter, online_summary, data_puller,
--                            daily_entry, daily_print, final_check, ewallet_summary }
--   special_notes TEXT   = หมายเหตุรายการพิเศษ
-- ============================================================

ALTER TABLE daily_sale_reconcile
  ADD COLUMN IF NOT EXISTS signoff       JSONB,
  ADD COLUMN IF NOT EXISTS special_notes TEXT;

-- ============================================================
-- DONE · Test:
--   SELECT reconcile_date, branch, signoff, special_notes
--     FROM daily_sale_reconcile ORDER BY reconcile_date DESC LIMIT 10;
-- ============================================================
