-- ============================================================
-- Migration 084: Stock lot/expiry tracking + negative-stock toggle
-- - stock_movements.lot_no, expiry_date (nullable, สำหรับ track FIFO/หมดอายุ)
-- - app_settings.inventory_allow_negative (true/false toggle ในหน้า Stock สินค้า)
-- ============================================================

-- 1) เพิ่ม column lot/expiry ใน stock_movements (ทั้งคู่ optional)
ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS lot_no       TEXT,
  ADD COLUMN IF NOT EXISTS expiry_date  DATE;

-- index สำหรับ query "ใกล้หมดอายุ" / "หมดอายุแล้ว"
CREATE INDEX IF NOT EXISTS idx_stock_movements_expiry
  ON stock_movements (expiry_date)
  WHERE expiry_date IS NOT NULL;

-- index สำหรับ group by lot
CREATE INDEX IF NOT EXISTS idx_stock_movements_lot
  ON stock_movements (product_id, warehouse_id, lot_no)
  WHERE lot_no IS NOT NULL;

-- 2) Negative-stock toggle (default = อนุญาต เพื่อไม่ break flow เดิม)
INSERT INTO app_settings (key, value, description)
VALUES (
  'inventory_allow_negative',
  'true',
  'อนุญาตให้สต็อกติดลบหรือไม่ (true=ยอมให้ขาย/เบิกเกิน, false=บังคับมีของก่อน) — ใช้ที่หน้า Stock สินค้า + จะ hard-enforce ที่ฟอร์ม SO/REQ ในภายหลัง'
)
ON CONFLICT (key) DO NOTHING;
