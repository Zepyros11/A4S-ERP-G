-- ============================================================
-- Migration 176: ยืม / คืน สินค้า (แทน Google Sheet "ยืม-คืน")
--
-- Why:
--   ชีตเดิมมี 2 แผ่น
--     1) แผ่นบันทึก  : วันที่ / ประเภท (ยืม·คืน) / ชื่อผู้ยืม + ตารางสินค้า
--                      (ชื่อสินค้า · ราคา · จำนวน · มูลค่า = ราคา × จำนวน)
--     2) แผ่นรายงาน  : เลือกชื่อคน → สรุปต่อสินค้า (ยืม · คืน · คงเหลือ)
--   ย้ายเข้า ERP → หน้า modules/inventory/borrow-return.html
--
--   โครงเป็น header/line เพราะ 1 ครั้งที่กด "Save ข้อมูล" = 1 วันที่ + 1 ประเภท
--   + 1 คน แต่มีสินค้าหลายบรรทัด (เหมือน 1 แถวบนสุดคุมทั้งตารางในชีต)
--
--   บรรทัดเก็บ snapshot ชื่อสินค้า + ราคา ไว้ด้วย เพราะราคาใน master อาจถูกแก้
--   ทีหลัง แต่รายการที่บันทึกไปแล้วต้องคงมูลค่าเดิม (เหมือนค่าที่พิมพ์ลงชีต)
--
--   "คงเหลือ" ไม่เก็บเป็นคอลัมน์ — คำนวณจาก SUM(ยืม) - SUM(คืน) เสมอ
--   (เก็บยอดสะสมไว้ = ต้องคอย sync ทุกครั้งที่แก้/ลบ ซึ่งเพี้ยนง่าย)
--
--   ไม่ใช้ RLS — ERP login เป็น custom (users table) ไม่ใช่ Supabase Auth
--   → ทุก request เป็น role anon · RLS ที่เปิดค้าง = หน้าเว็บอ่าน/เขียนไม่ได้
--   (SQL Editor รันด้วย role postgres ซึ่ง bypass RLS จึงดูเหมือนสำเร็จ แต่หน้าเว็บพัง)
--   → ต้องสั่ง DISABLE ROW LEVEL SECURITY ให้ชัดเจน (ข้อ 6)
--
-- Idempotent — รันซ้ำได้
-- ============================================================

-- ── 1. borrow_items — master สินค้าที่ให้ยืม ─────────────────
--     แยกจากตาราง products เพราะชีตยืม-คืนใช้รายการ + ราคาชุดของตัวเอง
--     (import จาก CSV ทีหลัง — ตอนนี้สร้างตารางเปล่าไว้ก่อน)
CREATE TABLE IF NOT EXISTS borrow_items (
  id          BIGSERIAL PRIMARY KEY,
  item_code   TEXT,                                  -- (ออปชัน) รหัสสินค้าในชีตเดิม
  item_name   TEXT NOT NULL,
  price       NUMERIC(12,2) NOT NULL DEFAULT 0,      -- ราคาตั้งต้น (คัดลอกลงบรรทัดตอนบันทึก)
  unit        TEXT,                                  -- หน่วยนับ เช่น ชิ้น / กล่อง
  sort_order  INT NOT NULL DEFAULT 0,                -- ลำดับที่อยากให้แสดงในตารางกรอก
  note        TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- ชื่อสินค้าซ้ำไม่ได้ — ชีตเดิม lookup ด้วยชื่อล้วน จึงต้องยุบช่องว่างซ้อนด้วย
-- (ในชีตมี "โบว์ชัว  4TREE" เว้น 2 เคาะ · ถ้าเทียบแค่ btrim จะกลายเป็นคนละตัวกับ "โบว์ชัว 4TREE")
-- กติกาต้องตรงกับ norm() ใน borrow-return.js: trim + ยุบช่องว่าง + lowercase
CREATE UNIQUE INDEX IF NOT EXISTS uq_borrow_items_name
  ON borrow_items (lower(regexp_replace(btrim(item_name), '\s+', ' ', 'g')));

-- ── 2. borrow_persons — master ผู้ยืม (คน / บริษัท) ──────────
--     ชีตเดิมมีทั้งบุคคล (ดร.เพชร) และนิติบุคคล (บริษัท ต.ศรีโสภณ)
--     จึงเก็บเป็น master ของตัวเอง ไม่ผูก users/members
CREATE TABLE IF NOT EXISTS borrow_persons (
  id           BIGSERIAL PRIMARY KEY,
  person_name  TEXT NOT NULL,
  person_type  TEXT NOT NULL DEFAULT 'person'
               CHECK (person_type IN ('person','company')),
  phone        TEXT,
  note         TEXT,
  sort_order   INT NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- ชื่อคนก็ lookup ด้วยชื่อเหมือนกัน — ใช้กติกาเดียวกับสินค้า
CREATE UNIQUE INDEX IF NOT EXISTS uq_borrow_persons_name
  ON borrow_persons (lower(regexp_replace(btrim(person_name), '\s+', ' ', 'g')));

-- ── 3. borrow_txns — หัวรายการ (1 ครั้งที่กด Save) ───────────
CREATE TABLE IF NOT EXISTS borrow_txns (
  id           BIGSERIAL PRIMARY KEY,
  txn_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  txn_type     TEXT NOT NULL CHECK (txn_type IN ('borrow','return')),   -- ยืม / คืน
  person_id    BIGINT REFERENCES borrow_persons(id) ON DELETE SET NULL,
  person_name  TEXT,                                  -- snapshot (แก้ master ทีหลังไม่ทับของเก่า)
  note         TEXT,
  created_by   INT REFERENCES users(user_id) ON DELETE SET NULL,
  created_by_name TEXT,                               -- snapshot ชื่อผู้บันทึก
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_borrow_txns_date   ON borrow_txns (txn_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_borrow_txns_person ON borrow_txns (person_id);
CREATE INDEX IF NOT EXISTS idx_borrow_txns_type   ON borrow_txns (txn_type);

-- ── 4. borrow_txn_lines — บรรทัดสินค้า ───────────────────────
CREATE TABLE IF NOT EXISTS borrow_txn_lines (
  id         BIGSERIAL PRIMARY KEY,
  txn_id     BIGINT NOT NULL REFERENCES borrow_txns(id) ON DELETE CASCADE,
  item_id    BIGINT REFERENCES borrow_items(id) ON DELETE SET NULL,
  item_name  TEXT NOT NULL,                           -- snapshot
  price      NUMERIC(12,2) NOT NULL DEFAULT 0,        -- snapshot
  qty        NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount     NUMERIC(14,2) GENERATED ALWAYS AS (price * qty) STORED,  -- มูลค่า = ราคา × จำนวน
  line_no    INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_borrow_lines_txn  ON borrow_txn_lines (txn_id);
CREATE INDEX IF NOT EXISTS idx_borrow_lines_item ON borrow_txn_lines (item_id);

-- ── 5. borrow_ledger — วิวแบนสำหรับดึงรายงาน / ตรวจข้อมูล ────
CREATE OR REPLACE VIEW borrow_ledger AS
SELECT
  l.id          AS line_id,
  t.id          AS txn_id,
  t.txn_date,
  t.txn_type,
  t.person_id,
  t.person_name,
  l.item_id,
  l.item_name,
  l.price,
  l.qty,
  l.amount,
  t.note,
  t.created_by_name,
  t.created_at
FROM borrow_txn_lines l
JOIN borrow_txns t ON t.id = l.txn_id;

-- ── 6. updated_at auto-touch ────────────────────────────────
CREATE OR REPLACE FUNCTION touch_borrow_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_borrow_items_touch ON borrow_items;
CREATE TRIGGER trg_borrow_items_touch
  BEFORE UPDATE ON borrow_items
  FOR EACH ROW EXECUTE FUNCTION touch_borrow_updated_at();

DROP TRIGGER IF EXISTS trg_borrow_persons_touch ON borrow_persons;
CREATE TRIGGER trg_borrow_persons_touch
  BEFORE UPDATE ON borrow_persons
  FOR EACH ROW EXECUTE FUNCTION touch_borrow_updated_at();

DROP TRIGGER IF EXISTS trg_borrow_txns_touch ON borrow_txns;
CREATE TRIGGER trg_borrow_txns_touch
  BEFORE UPDATE ON borrow_txns
  FOR EACH ROW EXECUTE FUNCTION touch_borrow_updated_at();

-- ── 7. RLS OFF + GRANT anon (สำคัญ — ดูหมายเหตุหัวไฟล์) ──────
ALTER TABLE borrow_items     DISABLE ROW LEVEL SECURITY;
ALTER TABLE borrow_persons   DISABLE ROW LEVEL SECURITY;
ALTER TABLE borrow_txns      DISABLE ROW LEVEL SECURITY;
ALTER TABLE borrow_txn_lines DISABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON borrow_items     TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON borrow_persons   TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON borrow_txns      TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON borrow_txn_lines TO anon;
GRANT SELECT ON borrow_ledger TO anon;

GRANT USAGE, SELECT ON SEQUENCE borrow_items_id_seq     TO anon;
GRANT USAGE, SELECT ON SEQUENCE borrow_persons_id_seq   TO anon;
GRANT USAGE, SELECT ON SEQUENCE borrow_txns_id_seq      TO anon;
GRANT USAGE, SELECT ON SEQUENCE borrow_txn_lines_id_seq TO anon;

-- ── ตรวจผล (relrowsecurity ต้องได้ false ทั้ง 4 ตาราง) ───────
-- SELECT relname, relrowsecurity FROM pg_class
-- WHERE relname IN ('borrow_items','borrow_persons','borrow_txns','borrow_txn_lines');
