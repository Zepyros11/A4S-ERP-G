-- ============================================================
-- Migration 177: เบิกสินค้า (แทน Google Sheet "Withdraw_DATA")
--
-- Why:
--   ชีตเดิมมี 2 ส่วน
--     1) แผ่นกรอก   : วันที่ / ประเภทการเบิก (พนักงาน · การตลาด · บริจาค ·
--                     ตรวจสอบสินค้า · ทำลาย) + ตารางสินค้า
--                     (ลำดับ · ชื่อสินค้า · ราคา · จำนวน · มูลค่า = ราคา × จำนวน)
--     2) แผ่นรายงาน : แยกแท็บตามประเภท → เมทริกซ์ รหัสสินค้า × วันที่ 1–31
--                     ปิดท้ายด้วยคอลัมน์ "รวมเบิก"
--   ย้ายเข้า ERP → หน้า modules/inventory/withdraw.html
--
--   โครงเป็น header/line เหมือน 176 (ยืม-คืน) เพราะ 1 ครั้งที่กด "Save ข้อมูล"
--   = 1 วันที่ + 1 ประเภท + 1 คลัง แต่มีสินค้าหลายบรรทัด
--
--   ต่างจาก 176 ตรงที่ **บรรทัดผูกกับ products จริง** (ไม่ใช่ master ของตัวเอง)
--   เพราะการเบิกต้องตัดสต็อก → เขียน stock_movements type INTERNAL
--   (stock-balance.js: OUT/INTERNAL = −qty) แล้วเก็บ movement_id ไว้ที่บรรทัด
--   เพื่อให้ลบ/แก้รายการแล้วถอน movement เดิมออกได้ครบ ไม่ทิ้งขยะในบัญชีเดินสต็อก
--
--   บรรทัดยัง snapshot รหัส/ชื่อ/ราคาไว้ด้วย เพราะ master แก้ทีหลังได้
--   แต่รายการที่บันทึกไปแล้วต้องคงมูลค่าเดิม (เหมือนค่าที่พิมพ์ลงชีต)
--
--   "รวมเบิก" ไม่เก็บเป็นคอลัมน์ — คำนวณจาก SUM(qty) เสมอ
--
--   ไม่ใช้ RLS — ERP login เป็น custom (users table) ไม่ใช่ Supabase Auth
--   → ทุก request เป็น role anon · RLS ที่เปิดค้าง = หน้าเว็บอ่าน/เขียนไม่ได้
--   (SQL Editor รันด้วย role postgres ซึ่ง bypass RLS จึงดูเหมือนสำเร็จ แต่หน้าเว็บพัง)
--   → ต้องสั่ง DISABLE ROW LEVEL SECURITY ให้ชัดเจน (ข้อ 7)
--
-- Idempotent — รันซ้ำได้
-- ============================================================

-- ── 1. withdraw_categories — ประเภทการเบิก (แท็บในชีตรายงาน) ──
CREATE TABLE IF NOT EXISTS withdraw_categories (
  id          BIGSERIAL PRIMARY KEY,
  cat_code    TEXT NOT NULL,                          -- EMP / MKT / DON / QC / DSP
  cat_name    TEXT NOT NULL,                          -- ชื่อที่แสดง (= ชื่อแท็บในชีต)
  icon        TEXT,                                   -- emoji บนแท็บ/การ์ด
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_withdraw_categories_code
  ON withdraw_categories (upper(btrim(cat_code)));
CREATE UNIQUE INDEX IF NOT EXISTS uq_withdraw_categories_name
  ON withdraw_categories (lower(btrim(cat_name)));

-- ประเภทตั้งต้นตามชีตเดิม (เพิ่ม/แก้/ปิดใช้ทีหลังได้จาก ⚙️ ในหน้าเว็บ)
INSERT INTO withdraw_categories (cat_code, cat_name, icon, sort_order)
VALUES
  ('EMP', 'พนักงาน',         '👤', 1),
  ('MKT', 'การตลาด',         '📣', 2),
  ('DON', 'บริจาค',          '🎁', 3),
  ('QC',  'ตรวจสอบสินค้า',   '🔍', 4),
  ('DSP', 'ทำลาย',           '🗑️', 5)
ON CONFLICT DO NOTHING;

-- ── 2. withdraw_txns — หัวรายการ (1 ครั้งที่กด Save) ──────────
CREATE TABLE IF NOT EXISTS withdraw_txns (
  id              BIGSERIAL PRIMARY KEY,
  txn_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  category_id     BIGINT REFERENCES withdraw_categories(id) ON DELETE SET NULL,
  category_name   TEXT,                                -- snapshot (แก้ master ทีหลังไม่ทับของเก่า)
  warehouse_id    INT,                                 -- คลังที่ตัดสต็อก (ตรงกับ stock_movements)
  warehouse_name  TEXT,                                -- snapshot
  note            TEXT,
  created_by      INT REFERENCES users(user_id) ON DELETE SET NULL,
  created_by_name TEXT,                                -- snapshot ชื่อผู้บันทึก
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_withdraw_txns_date ON withdraw_txns (txn_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_withdraw_txns_cat  ON withdraw_txns (category_id);

-- ── 3. withdraw_txn_lines — บรรทัดสินค้า ─────────────────────
CREATE TABLE IF NOT EXISTS withdraw_txn_lines (
  id          BIGSERIAL PRIMARY KEY,
  txn_id      BIGINT NOT NULL REFERENCES withdraw_txns(id) ON DELETE CASCADE,
  product_id  INT,                                     -- อ้าง products.product_id (ไม่ FK — สินค้าถูกลบแล้วรายการเก่ายังต้องอ่านได้)
  item_code   TEXT,                                    -- snapshot product_code (คอลัมน์ "รหัสสินค้า" ในรายงาน)
  item_name   TEXT NOT NULL,                           -- snapshot product_name (คอลัมน์ "รายละเอียด")
  price       NUMERIC(12,2) NOT NULL DEFAULT 0,        -- snapshot ราคาทุน
  qty         NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount      NUMERIC(14,2) GENERATED ALWAYS AS (price * qty) STORED,  -- มูลค่า = ราคา × จำนวน
  movement_id BIGINT,                                  -- stock_movements ที่สร้างคู่กัน (ถอนตอนแก้/ลบ)
  line_no     INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_withdraw_lines_txn  ON withdraw_txn_lines (txn_id);
CREATE INDEX IF NOT EXISTS idx_withdraw_lines_prod ON withdraw_txn_lines (product_id);

-- ── 4. withdraw_form_items — สินค้าที่จะโชว์ในตารางกรอก ───────
--     ชีตเดิมมีรายการสินค้าประจำอยู่แล้วทั้งคอลัมน์ ไม่ได้ให้เลือกทีละตัว
--     ตารางนี้คือ "รายการประจำ" นั้น + ลำดับที่อยากให้เรียง
--     ว่างไว้ = หน้าเว็บ fallback ไปแสดง products ที่ is_active ทั้งหมด
CREATE TABLE IF NOT EXISTS withdraw_form_items (
  id          BIGSERIAL PRIMARY KEY,
  product_id  INT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_withdraw_form_items_product
  ON withdraw_form_items (product_id);

-- ── 5. withdraw_ledger — วิวแบนสำหรับรายงาน / ตรวจข้อมูล ─────
CREATE OR REPLACE VIEW withdraw_ledger AS
SELECT
  l.id            AS line_id,
  t.id            AS txn_id,
  t.txn_date,
  t.category_id,
  t.category_name,
  t.warehouse_id,
  t.warehouse_name,
  l.product_id,
  l.item_code,
  l.item_name,
  l.price,
  l.qty,
  l.amount,
  l.movement_id,
  t.note,
  t.created_by_name,
  t.created_at
FROM withdraw_txn_lines l
JOIN withdraw_txns t ON t.id = l.txn_id;

-- ── 6. updated_at auto-touch ────────────────────────────────
CREATE OR REPLACE FUNCTION touch_withdraw_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_withdraw_categories_touch ON withdraw_categories;
CREATE TRIGGER trg_withdraw_categories_touch
  BEFORE UPDATE ON withdraw_categories
  FOR EACH ROW EXECUTE FUNCTION touch_withdraw_updated_at();

DROP TRIGGER IF EXISTS trg_withdraw_txns_touch ON withdraw_txns;
CREATE TRIGGER trg_withdraw_txns_touch
  BEFORE UPDATE ON withdraw_txns
  FOR EACH ROW EXECUTE FUNCTION touch_withdraw_updated_at();

-- ── 7. RLS OFF + GRANT anon (สำคัญ — ดูหมายเหตุหัวไฟล์) ──────
ALTER TABLE withdraw_categories  DISABLE ROW LEVEL SECURITY;
ALTER TABLE withdraw_txns        DISABLE ROW LEVEL SECURITY;
ALTER TABLE withdraw_txn_lines   DISABLE ROW LEVEL SECURITY;
ALTER TABLE withdraw_form_items  DISABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON withdraw_categories  TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON withdraw_txns        TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON withdraw_txn_lines   TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON withdraw_form_items  TO anon;
GRANT SELECT ON withdraw_ledger TO anon;

GRANT USAGE, SELECT ON SEQUENCE withdraw_categories_id_seq  TO anon;
GRANT USAGE, SELECT ON SEQUENCE withdraw_txns_id_seq        TO anon;
GRANT USAGE, SELECT ON SEQUENCE withdraw_txn_lines_id_seq   TO anon;
GRANT USAGE, SELECT ON SEQUENCE withdraw_form_items_id_seq  TO anon;

-- ── ตรวจผล (relrowsecurity ต้องได้ false ทั้ง 4 ตาราง) ───────
-- SELECT relname, relrowsecurity FROM pg_class
-- WHERE relname IN ('withdraw_categories','withdraw_txns','withdraw_txn_lines','withdraw_form_items');
