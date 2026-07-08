-- ============================================================
-- Migration 025: "corrected" flag for daily_sale_payments
--   Forward workstream — ย้าย "ชั้นแก้ไขช่องทางชำระ" จาก Google Sheet DATA_CS
--   มาไว้ใน ERP โดยตรง
--
-- ปัญหาเดิม: answerforsuccess ลงช่องทางชำระ (payment channel) ผิด และแก้
--   หลังบ้านไม่ได้ → CS ต้อง export มาแก้ในชีต DATA_CS ก่อนทำ daily report
--
-- แนวทางใหม่: CS แก้ channel ต่อบิลในหน้า daily-sale (ERP = source of truth)
--   → set corrected = true → hourly sync จะ "ข้าม" การเขียนทับ payment ของบิลนั้น
--     (ดู scripts/lib/supabase-dailysale.js → upsertPayments)
--   → identity ของบิล (daily_sale_bills) ยัง upsert ตามปกติ
-- ============================================================

ALTER TABLE daily_sale_payments
  ADD COLUMN IF NOT EXISTS corrected         BOOLEAN     DEFAULT false,
  ADD COLUMN IF NOT EXISTS corrected_by      TEXT,        -- user_id ที่แก้
  ADD COLUMN IF NOT EXISTS corrected_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS correction_notes  TEXT;

-- Partial index: sync ค้นหาบิลที่ corrected=true เพื่อกันเขียนทับ
CREATE INDEX IF NOT EXISTS idx_daily_sale_payments_corrected
  ON daily_sale_payments (bill_no) WHERE corrected = true;

-- ============================================================
-- DONE
-- Test:
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'daily_sale_payments'
--       AND column_name IN ('corrected','corrected_by','corrected_at','correction_notes');
--   -- ควรได้ 4 แถว
--
--   -- ลองดูบิลที่ CS แก้แล้ว
--   SELECT bill_no, corrected, corrected_by, corrected_at
--     FROM daily_sale_payments WHERE corrected = true;
-- ============================================================
