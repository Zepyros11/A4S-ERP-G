-- ============================================================
-- Migration 026: Close stale "pending" bills (business_date IS NULL)
--
-- ปัญหา: sync answerforsuccess fail ตอน 27/4/2026 → บิลที่ sync ดึงเข้ามา
--   ช่วง 19–27 เม.ย. มี business_date = NULL ค้าง (ไม่เคยกด Sync Now → close_day
--   ตีตราปิดวัน) → โผล่ในแท็บ "🆕 บิลใหม่รอตรวจ" ทั้งที่เป็นบิลเก่า 2 เดือน
--
-- แก้: ตีตรา business_date = sale_date ให้บิล NULL ที่ "เก่ากว่าวันนี้" (past-dated)
--   = กฎเดียวกับ backfill ใน migration 023 · ปลอดภัยเพราะ:
--     1. ไม่แตะบิล pending ของ "วันนี้" (sale_date = CURRENT_DATE) ที่รอปิดจริง
--     2. กันบั๊กตอนซ่อม sync เสร็จ: ถ้าปล่อย NULL ไว้ พอกด Sync Now → close_day
--        จะตีบิล เม.ย. พวกนี้เป็น "วันนี้" ผิด → ปิดย้อนหลังตอนนี้กันไว้
--
-- Scope (ตรวจแล้ว 2026-07-08): 70 บิล · sale_date 2026-04-19 … 2026-04-27
--   ทุกใบ source_file = '01_บิลขายทั้งหมด' (มาจาก sync ไม่ใช่ DATA_CS-import)
-- ============================================================

BEGIN;

-- ── ก่อนแก้: ดูว่าจะกระทบกี่แถว (ควรได้ ~70, ทั้งหมด sale_date < วันนี้) ──
-- SELECT sale_date, COUNT(*) FROM daily_sale_bills
--   WHERE business_date IS NULL AND sale_date < CURRENT_DATE
--   GROUP BY sale_date ORDER BY sale_date;

UPDATE daily_sale_bills
  SET business_date = sale_date
  WHERE business_date IS NULL
    AND sale_date < CURRENT_DATE;

UPDATE daily_sale_topup_bills
  SET business_date = sale_date
  WHERE business_date IS NULL
    AND sale_date < CURRENT_DATE;

COMMIT;

-- ============================================================
-- Test (หลังรัน):
--   -- ต้องเหลือ 0 (ยกเว้นบิล pending ของวันนี้จริงๆ ถ้ามี)
--   SELECT COUNT(*) FROM daily_sale_bills
--     WHERE business_date IS NULL AND sale_date < CURRENT_DATE;   -- ควรได้ 0
--   -- แท็บ "บิลใหม่รอตรวจ" (business_date IS NULL) ควรว่างถ้ายังไม่มีบิลวันนี้
--   SELECT COUNT(*) FROM daily_sale_bills WHERE business_date IS NULL;
-- ============================================================
