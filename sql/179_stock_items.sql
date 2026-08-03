-- ============================================================
-- Migration 179: stock_items — รายการสินค้ากลาง ใช้ร่วม 3 หน้า
--                (ตรวจนับสต็อก · เบิกสินค้า · ยืม/คืน สินค้า)
--
-- Why:
--   3 หน้านี้เกิดจากชีต Stock_Data คนละแผ่น แต่กรอก "ตารางสินค้า" ชุดเดียวกัน
--   ตอนย้ายเข้า ERP กลับแตกเป็น 3 แหล่ง:
--     ตรวจนับ  → products + product_units
--     เบิก     → products + withdraw_form_items
--     ยืม/คืน  → borrow_items (master ของตัวเอง)
--   → แก้ชื่อ/ราคาที่หนึ่ง อีกสองหน้าไม่รู้เรื่อง และตัวเลขที่ส่งข้ามหน้า
--     (ดึงยอดยืม / ดึงยอดเบิก เข้าใบตรวจนับ) ต้องเดาจับคู่ด้วยชื่อ ซึ่งพลาดเงียบ
--   ตารางนี้ยุบให้เหลือ master เดียว แก้ที่หน้าตรวจนับที่เดียว
--
--   ทำไมไม่ใช้ products (catalog) เป็น master:
--     catalog ปัจจุบัน 153 รายการเป็นเสื้อ/ของพรีเมียมล้วน — ไม่มีสินค้าจริง
--     ที่ 3 หน้านี้ใช้ (4Soil · Lean C · EYE+ · Amino Black …) เลยสักตัว
--     และ 3 หน้านี้ต้องการฟิลด์ที่ catalog ไม่มี (ตัวคูณลัง→ชิ้นแบบตายตัว
--     ต่อสินค้า · ลำดับการแสดงในฟอร์มกรอก) จึงแยก master ของตัวเองไว้ก่อน
--
--   product_id เป็นสะพานกลับไป catalog แบบ "ผูกก็ได้ ไม่ผูกก็ได้" (nullable):
--     ผูกแล้ว  → หน้าเบิกเขียน stock_movements ตัดสต็อกจริงได้
--                + หน้าตรวจนับกด "ดึงยอดในระบบ" ได้
--     ไม่ผูก   → 2 อย่างนั้นข้ามตัวนั้นไป (ยอดในระบบใช้อัปโหลดไฟล์แทน)
--   หน้าเว็บต้องบอกผู้ใช้ให้ชัดว่าตัวไหนผูกแล้ว ไม่ใช่เงียบ ๆ แล้วยอดหาย
--
--   sort_order เป็น NUMERIC ไม่ใช่ INT — ชีตเดิมใช้เลขทศนิยมจัดกลุ่ม
--   (3.1 · 3.2 · 5.1 · 5.2) เพื่อแทรกสินค้าใหม่กลางกลุ่มโดยไม่ต้องเรียงใหม่ทั้งชุด
--
--   item_code ไม่ unique — ชีตเดิมมี SKU ซ้ำจริง (TS0001.1 ใช้กับ
--   "เสื้อแขนยาว 4Tree" และ "เสื้อแขนยาว 4Tree (โปร)") บังคับ unique แล้ว
--   import จะล้มทั้งชุด ส่วน item_name unique เพราะทุกชีต lookup ด้วยชื่อล้วน
--
--   ไม่ใช้ RLS — ERP login เป็น custom (users table) ไม่ใช่ Supabase Auth
--   → ทุก request เป็น role anon · RLS ที่เปิดค้าง = หน้าเว็บอ่าน/เขียนไม่ได้
--   (SQL Editor รันด้วย role postgres ซึ่ง bypass RLS จึงดูเหมือนสำเร็จ แต่หน้าเว็บพัง)
--   → ต้องสั่ง DISABLE ROW LEVEL SECURITY ให้ชัดเจน (ข้อ 8)
--
-- ⚠️ ต้องรันหลัง sql/176 + sql/177 + sql/178
-- Idempotent — รันซ้ำได้
-- ============================================================

-- ── 1. stock_items — master กลาง ─────────────────────────────
CREATE TABLE IF NOT EXISTS stock_items (
  id             BIGSERIAL PRIMARY KEY,
  item_code      TEXT,                                   -- SKU (ชีต: คอลัมน์ SKU)
  item_name      TEXT NOT NULL,                          -- ชื่อสินค้า (ชีต: productName)
  category       TEXT,                                   -- หมวด (ข้อความ — ชีตเก็บเป็นข้อความ ไม่ FK)

  -- ตัวคูณลัง→ชิ้น ของหน้าตรวจนับ (ชีต: Qty/Box)
  -- 0/ว่างในชีต = ขายเป็นซอง ไม่มีลัง → เก็บเป็น 1 (คูณแล้วไม่เปลี่ยนค่า)
  pieces_per_box NUMERIC(12,2) NOT NULL DEFAULT 1
                 CHECK (pieces_per_box > 0),
  box_unit_name  TEXT,                                   -- ชื่อหน่วยใหญ่ที่แสดง เช่น "ลัง"
  unit           TEXT,                                   -- หน่วยย่อย เช่น "ชิ้น" / "ซอง"

  price          NUMERIC(12,2) NOT NULL DEFAULT 0,       -- ราคาตั้งต้น (คัดลอกลงบรรทัดตอนบันทึก)
  sort_order     NUMERIC(10,3) NOT NULL DEFAULT 0,       -- ชีต: ลำดับการแสดง (3.1 / 5.2 …)
  is_active      BOOLEAN NOT NULL DEFAULT true,          -- ชีต: status Active/Inactive
  note           TEXT,

  -- สะพานกลับ catalog (nullable — ดูหมายเหตุหัวไฟล์)
  product_id     INT,

  -- ที่มาตอน migrate จาก borrow_items — ใช้ remap borrow_txn_lines (ข้อ 3)
  -- เก็บไว้ถาวรเพื่อให้ตามรอยได้ว่าแถวไหนมาจากชีตยืม-คืนเดิม
  legacy_borrow_item_id BIGINT,

  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

-- ชื่อซ้ำไม่ได้ — ทุกชีตต้นทาง lookup ด้วยชื่อล้วน จึงต้องยุบช่องว่างซ้อนด้วย
-- (ชีตมี "โบว์ชัว  4TREE" เว้น 2 เคาะ · ถ้าเทียบแค่ btrim จะกลายเป็นคนละตัวกับ "โบว์ชัว 4TREE")
-- กติกาต้องตรงกับ norm() ในหน้าเว็บ: trim + ยุบช่องว่าง + lowercase
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_items_name
  ON stock_items (lower(regexp_replace(btrim(item_name), '\s+', ' ', 'g')));

-- รหัสไม่ unique (มี SKU ซ้ำจริงในชีต) แต่ต้องค้นเร็ว — หน้าเว็บจับคู่ด้วยรหัสก่อนชื่อ
CREATE INDEX IF NOT EXISTS idx_stock_items_code
  ON stock_items (lower(btrim(item_code)));
CREATE INDEX IF NOT EXISTS idx_stock_items_order
  ON stock_items (is_active, sort_order, item_name);
CREATE INDEX IF NOT EXISTS idx_stock_items_product
  ON stock_items (product_id) WHERE product_id IS NOT NULL;

-- ── 2–4. ย้าย borrow_items → stock_items + remap บรรทัดเดิม ──
--
--   ทั้งก้อนอยู่ใน DO เดียวกันและคุมด้วยเงื่อนไข "borrow_items ยังมีอยู่"
--   เพราะขั้นสุดท้ายเปลี่ยนชื่อ borrow_items ทิ้ง → รันไฟล์นี้ซ้ำจะข้ามทั้งก้อนเอง
--
--   ทำไมต้องรันครั้งเดียวเป๊ะ ๆ: id ของ borrow_items (1–30) กับ stock_items ที่
--   สร้างใหม่ทับช่วงกัน ถ้าปล่อยให้ remap รอบสองทำงาน บรรทัดที่ชี้ id ใหม่แล้ว
--   จะถูกจับคู่กับ legacy_borrow_item_id ของ "สินค้าคนละตัว" ที่บังเอิญเลขตรงกัน
--   แล้วย้ายไปผิดตัวแบบเงียบ ๆ — เช็คไม่เจอจนกว่ารายงานจะเพี้ยน
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema = 'public' AND table_name = 'borrow_items') THEN
    RAISE NOTICE 'ข้าม migrate borrow_items — ย้ายไปแล้ว (borrow_items_bak_179)';
    RETURN;
  END IF;

  -- 2a) แถวที่ยังไม่มีใน stock_items → เพิ่มใหม่
  --     ไม่ใช้ ON CONFLICT เพราะ unique index เป็น expression index
  --     (การ infer จากนิพจน์ต้องเขียนให้ตรงตัวอักษรเป๊ะ พลาดง่ายและ error ตอน deploy)
  INSERT INTO stock_items (item_code, item_name, price, unit, sort_order, note,
                           is_active, legacy_borrow_item_id)
  SELECT b.item_code, b.item_name, b.price, b.unit, b.sort_order, b.note,
         b.is_active, b.id
    FROM borrow_items b
   WHERE NOT EXISTS (
           SELECT 1 FROM stock_items s
            WHERE lower(regexp_replace(btrim(s.item_name), '\s+', ' ', 'g'))
                = lower(regexp_replace(btrim(b.item_name), '\s+', ' ', 'g'))
         );

  -- 2b) แถวที่มีอยู่แล้ว (import ชีต 🧴Products ไปก่อน) → ผูก legacy id ให้ครบ
  --     ราคาจากชีตถือว่าถูกต้องกว่า borrow_items (ซึ่ง import มาแบบ price = 0 ทั้งชุด)
  --     จึงเติมให้เฉพาะตัวที่ยังเป็น 0 เท่านั้น ไม่ทับของที่มีค่าแล้ว
  UPDATE stock_items s
     SET legacy_borrow_item_id = b.id,
         price = CASE WHEN s.price = 0 THEN b.price ELSE s.price END,
         unit  = COALESCE(s.unit, b.unit)
    FROM borrow_items b
   WHERE lower(regexp_replace(btrim(s.item_name), '\s+', ' ', 'g'))
       = lower(regexp_replace(btrim(b.item_name), '\s+', ' ', 'g'))
     AND s.legacy_borrow_item_id IS NULL;

  -- 3) borrow_txn_lines.item_id : borrow_items → stock_items
  --    211 บรรทัดเดิมต้องชี้ master ใหม่ ไม่งั้นรายงาน "คงเหลือต่อคน" กลายเป็นกำพร้า
  ALTER TABLE borrow_txn_lines DROP CONSTRAINT IF EXISTS borrow_txn_lines_item_id_fkey;

  UPDATE borrow_txn_lines l
     SET item_id = s.id
    FROM stock_items s
   WHERE s.legacy_borrow_item_id = l.item_id;

  -- บรรทัดที่หา master ใหม่ไม่เจอ → ตัดเป็น NULL ไม่ปล่อยให้ FK ล้ม
  -- (item_name/price เป็น snapshot อยู่แล้ว บรรทัดยังอ่านออกและยังนับในรายงาน)
  UPDATE borrow_txn_lines l
     SET item_id = NULL
   WHERE l.item_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM stock_items s WHERE s.id = l.item_id);

  ALTER TABLE borrow_txn_lines
    ADD CONSTRAINT borrow_txn_lines_item_id_fkey
    FOREIGN KEY (item_id) REFERENCES stock_items(id) ON DELETE SET NULL;

  -- 4) เก็บ borrow_items ไว้เป็นสำเนาสำรอง (ไม่ลบทิ้ง)
  --    Supabase Free tier ไม่มี PITR — ลบแล้วกู้ไม่ได้ จึงแค่เปลี่ยนชื่อ
  --    ตรวจข้อมูลเทียบกันเรียบร้อยแล้วค่อย DROP เองทีหลัง
  --    การเปลี่ยนชื่อนี้เองคือตัวล็อกไม่ให้ก้อนนี้ทำงานซ้ำ
  ALTER TABLE borrow_items RENAME TO borrow_items_bak_179;
END $$;

-- ── 5. stock_check_lines : ผูก stock_items ───────────────────
--     product_id เดิม (→ catalog) ยังอยู่ ใช้ตอน "ดึงยอดในระบบ" จาก stock_movements
ALTER TABLE stock_check_lines
  ADD COLUMN IF NOT EXISTS item_id BIGINT REFERENCES stock_items(id) ON DELETE SET NULL;

-- สินค้าเดิมห้ามซ้ำในรอบเดียวกัน (กันกด "เติมสินค้าเข้ารอบ" ซ้ำแล้วได้ 2 แถว)
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_check_lines_session_item
  ON stock_check_lines (session_id, item_id)
  WHERE item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stock_check_lines_item
  ON stock_check_lines (item_id);

-- ตัวกันซ้ำเดิมผูก product_id — ใช้ต่อไม่ได้แล้ว เพราะ product_id เปลี่ยนความหมาย
-- จาก "ตัวสินค้า" เป็น "สินค้าใน catalog ที่ผูกไว้" ซึ่งสินค้าหลายตัวใน master กลาง
-- ชี้ตัวเดียวกันได้ (เช่น "Lean C" กับ "Lean C (ซอง)" ผูก SKU เดียวกัน)
-- ปล่อยไว้ = เติมสินค้าเข้ารอบแล้วล้มด้วย duplicate key ทั้งที่คนละสินค้า
DROP INDEX IF EXISTS uq_stock_check_lines_session_product;

-- ── 6. withdraw_txn_lines : ผูก stock_items ──────────────────
ALTER TABLE withdraw_txn_lines
  ADD COLUMN IF NOT EXISTS item_id BIGINT REFERENCES stock_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_withdraw_lines_item
  ON withdraw_txn_lines (item_id);

-- withdraw_form_items ถูกแทนที่ด้วย stock_items.is_active + sort_order
-- (ตารางนี้ว่างเปล่า ไม่เคยมีข้อมูล — ลบได้ไม่เสียอะไร)
DROP TABLE IF EXISTS withdraw_form_items;

-- ── 7. อัปเดตวิวให้พ่วง item_id ──────────────────────────────
--     ต้อง DROP ก่อน ไม่ใช่ CREATE OR REPLACE — Postgres ยอมให้ replace view
--     ได้เฉพาะเมื่อคอลัมน์เดิมชื่อ/ชนิด/ลำดับเหมือนเดิมเป๊ะ และคอลัมน์ใหม่ต่อ
--     ท้ายเท่านั้น · ที่นี่แทรก item_code / item_id กลางชุด → replace จะ error
--     'cannot change name of view column' ทั้งไฟล์เลยล้มตั้งแต่รอบแรก
DROP VIEW IF EXISTS borrow_ledger;
CREATE VIEW borrow_ledger AS
SELECT
  l.id          AS line_id,
  t.id          AS txn_id,
  t.txn_date,
  t.txn_type,
  t.person_id,
  t.person_name,
  l.item_id,
  l.item_name,
  s.item_code,                    -- รหัสจาก master ปัจจุบัน (ใบตรวจนับจับคู่ด้วยรหัสก่อนชื่อ)
  l.price,
  l.qty,
  l.amount,
  t.note,
  t.created_by_name,
  t.created_at
FROM borrow_txn_lines l
JOIN borrow_txns t  ON t.id = l.txn_id
LEFT JOIN stock_items s ON s.id = l.item_id;

DROP VIEW IF EXISTS withdraw_ledger;
CREATE VIEW withdraw_ledger AS
SELECT
  l.id            AS line_id,
  t.id            AS txn_id,
  t.txn_date,
  t.category_id,
  t.category_name,
  t.warehouse_id,
  t.warehouse_name,
  l.item_id,
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

-- ── 8. updated_at auto-touch ────────────────────────────────
CREATE OR REPLACE FUNCTION touch_stock_items_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_items_touch ON stock_items;
CREATE TRIGGER trg_stock_items_touch
  BEFORE UPDATE ON stock_items
  FOR EACH ROW EXECUTE FUNCTION touch_stock_items_updated_at();

-- ── 9. RLS OFF + GRANT anon (สำคัญ — ดูหมายเหตุหัวไฟล์) ──────
ALTER TABLE stock_items DISABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON stock_items TO anon;
GRANT USAGE, SELECT ON SEQUENCE stock_items_id_seq TO anon;
GRANT SELECT ON borrow_ledger   TO anon;
GRANT SELECT ON withdraw_ledger TO anon;

-- ── ตรวจผล ──────────────────────────────────────────────────
-- SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'stock_items';   -- ต้องได้ false
-- SELECT count(*) FROM stock_items;                                             -- ≥ 30 (ก่อน import ชีต)
-- SELECT count(*) FROM borrow_txn_lines WHERE item_id IS NULL;                  -- ต้องได้ 0
