-- ============================================================
-- Migration 178: ตรวจนับสต็อก (แทน Google Sheet "Stock F.3")
--
-- Why:
--   ชีตเดิม 1 แผ่น = 1 รอบตรวจนับ · คอลัมน์ A–M ต่อ 1 สินค้า
--     A  NO             ลำดับ
--     B  รหัสสินค้า      → product_code (snapshot)
--     C  ชื่อสินค้า       → product_name (snapshot)
--     D  ลัง             → qty_box      (พนักงานกรอก)
--     E  ชิ้น            → qty_piece    (พนักงานกรอก)
--     F  รวม (ชิ้น)      → total_pieces (สูตร: D × ตัวคูณลัง + E)
--     G  ยืม             → qty_borrow   (ดึงจาก borrow_ledger)
--     H  เบิก            → qty_issue    (ดึงจากหน้าเบิกสินค้า — เฉพาะที่ยังไม่ตัดสต็อก)
--     I  ยอดในระบบ       → qty_system   (ดึงจาก stock_movements หรืออัปโหลดไฟล์)
--     J  ผลต่าง          → variance     (สูตร: (F + G + H) − I)
--     K  หมายเหตุ        → note
--     L  แจ้งเตือน       → คำนวณในหน้าเว็บ (ของหาย / ของเกิน / ตรงกัน)
--     M  แจ้งเตือน2      → คำนวณในหน้าเว็บ (F < เกณฑ์ → "ใกล้หมดแล้ว")
--   ย้ายเข้า ERP → หน้า modules/inventory/stock-check.html
--
--   แยก 2 ตาราง (header/line) เพราะ 1 รอบตรวจนับ = 1 วันที่ + 1 คลัง
--   แต่มีสินค้าหลายบรรทัด — เหมือน 1 แผ่นชีตต่อรอบ เก็บย้อนหลังเทียบกันได้
--
--   F และ J เป็น GENERATED COLUMN (คำนวณในฐานข้อมูล) แทนสูตร ARRAYFORMULA
--   → แก้ D/E/G/H/I แล้วค่าอัปเดตเองทันที ไม่มีทางลืมลากสูตร และหน้าเว็บ
--     กับไฟล์ export ได้เลขชุดเดียวกันเสมอ
--   หมายเหตุ: Postgres ห้าม generated column อ้าง generated column ด้วยกัน
--   → variance จึงเขียนสูตร total_pieces ซ้ำเต็ม ๆ แทนที่จะอ้าง total_pieces
--
--   บรรทัด "ยังไม่นับ" = qty_box IS NULL AND qty_piece IS NULL
--   → variance = NULL (ไม่ใช่ 0) เพื่อไม่ให้ยังไม่ได้นับถูกอ่านว่า "ตรงกัน"
--     เทียบเท่า IF(C3:C="",,...) ในชีตที่เว้นแถวว่างไว้เฉย ๆ
--
--   pieces_per_box เก็บ snapshot ลงบรรทัด (ไม่ join product_units ตอนคำนวณ)
--   เพราะถ้าแก้ตัวคูณใน master ทีหลัง รอบที่ปิดไปแล้วต้องคงตัวเลขเดิม
--
--   ไม่ใช้ RLS — ERP login เป็น custom (users table) ไม่ใช่ Supabase Auth
--   → ทุก request เป็น role anon · RLS ที่เปิดค้าง = หน้าเว็บอ่าน/เขียนไม่ได้
--   (SQL Editor รันด้วย role postgres ซึ่ง bypass RLS จึงดูเหมือนสำเร็จ แต่หน้าเว็บพัง)
--   → ต้องสั่ง DISABLE ROW LEVEL SECURITY ให้ชัดเจน (ข้อ 6)
--
-- Idempotent — รันซ้ำได้
-- ============================================================

-- ── 1. stock_check_sessions — 1 แถว = 1 รอบตรวจนับ (1 แผ่นชีต) ──
CREATE TABLE IF NOT EXISTS stock_check_sessions (
  id                  BIGSERIAL PRIMARY KEY,
  check_date          DATE NOT NULL DEFAULT CURRENT_DATE,
  title               TEXT,                                  -- เช่น "ตรวจนับสิ้นเดือน ส.ค. 68"
  warehouse_id        INT REFERENCES warehouses(warehouse_id) ON DELETE SET NULL,
  warehouse_name      TEXT,                                  -- snapshot
  status              TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','closed')),  -- closed = ปิดรอบ ห้ามแก้ตัวเลข
  low_stock_threshold NUMERIC(12,2) NOT NULL DEFAULT 50,     -- เกณฑ์ Col M "ใกล้หมดแล้ว"
  note                TEXT,
  closed_at           TIMESTAMPTZ,
  created_by          INT REFERENCES users(user_id) ON DELETE SET NULL,
  created_by_name     TEXT,                                  -- snapshot ชื่อผู้เปิดรอบ
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_check_sessions_date
  ON stock_check_sessions (check_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_stock_check_sessions_wh
  ON stock_check_sessions (warehouse_id);

-- ── 2. stock_check_lines — 1 แถว = 1 สินค้าในรอบนั้น (แถว A–K) ──
CREATE TABLE IF NOT EXISTS stock_check_lines (
  id             BIGSERIAL PRIMARY KEY,
  session_id     BIGINT NOT NULL REFERENCES stock_check_sessions(id) ON DELETE CASCADE,
  product_id     INT REFERENCES products(product_id) ON DELETE SET NULL,
  product_code   TEXT,                                       -- B (snapshot)
  product_name   TEXT NOT NULL,                              -- C (snapshot)
  category_name  TEXT,                                       -- snapshot ไว้กรอง/พิมพ์รายงาน

  -- ตัวคูณลัง→ชิ้น (snapshot จาก product_units.conversion_qty ตอนเปิดรอบ)
  box_unit_name  TEXT,                                       -- ชื่อหน่วยใหญ่ เช่น "ลัง" / "กล่อง"
  pieces_per_box NUMERIC(12,2) NOT NULL DEFAULT 1
                 CHECK (pieces_per_box > 0),                 -- 0 จะทำให้ F เพี้ยนเงียบ ๆ

  -- ค่าที่พนักงานกรอก / ระบบเติม (NULL = ยังไม่กรอก · ต่างจาก 0 ที่แปลว่านับแล้วได้ศูนย์)
  qty_box        NUMERIC(12,2),                              -- D
  qty_piece      NUMERIC(12,2),                              -- E
  qty_borrow     NUMERIC(12,2) NOT NULL DEFAULT 0,           -- G
  qty_issue      NUMERIC(12,2) NOT NULL DEFAULT 0,           -- H
  qty_system     NUMERIC(12,2) NOT NULL DEFAULT 0,           -- I

  -- F = D × ตัวคูณลัง + E
  total_pieces   NUMERIC(14,2) GENERATED ALWAYS AS (
                   COALESCE(qty_box, 0) * pieces_per_box + COALESCE(qty_piece, 0)
                 ) STORED,

  -- J = (F + G + H) − I  ·  NULL เมื่อยังไม่นับ
  variance       NUMERIC(14,2) GENERATED ALWAYS AS (
                   CASE WHEN qty_box IS NULL AND qty_piece IS NULL THEN NULL
                        ELSE (COALESCE(qty_box, 0) * pieces_per_box + COALESCE(qty_piece, 0))
                             + qty_borrow + qty_issue - qty_system
                   END
                 ) STORED,

  note           TEXT,                                       -- K
  sort_order     INT NOT NULL DEFAULT 0,                     -- A (ลำดับที่อยากให้เรียง)

  -- ที่มาของ G / H / I — ไว้ให้หน้าเว็บบอกผู้ใช้ว่าเลขนี้กรอกเองหรือระบบดึงมา
  --
  -- G (ยืม)  ← borrow_ledger (sql/176) · ยืม−คืน ที่ยังค้าง
  --            การยืมไม่เขียน stock_movements → ยอดระบบยังนับของชิ้นนั้นอยู่
  --            แต่ของไม่อยู่บนชั้น จึงต้องบวกกลับตอนเทียบ
  -- H (เบิก) ← withdraw_ledger (sql/177) · เฉพาะบรรทัดที่ movement_id IS NULL
  --            หน้าเบิกสินค้าปกติจะเขียน stock_movements ให้ทันที = ยอดระบบตัดแล้ว
  --            ของพวกนั้นห้ามบวกกลับ ไม่งั้นผลต่างจะเกินจริงเท่าตัว
  --            เหลือแค่บรรทัดที่ยังไม่ตัดสต็อกที่ต้องบวกกลับ — ตรงกับความหมาย
  --            คอลัมน์ H เดิมในชีต ("เบิกออกไปแล้วแต่ระบบยังไม่ตัด")
  borrow_source  TEXT NOT NULL DEFAULT 'manual'
                 CHECK (borrow_source IN ('manual','borrow_ledger')),
  issue_source   TEXT NOT NULL DEFAULT 'manual'
                 CHECK (issue_source IN ('manual','withdraw')),
  system_source  TEXT NOT NULL DEFAULT 'manual'
                 CHECK (system_source IN ('manual','movements','upload')),

  counted_by      INT REFERENCES users(user_id) ON DELETE SET NULL,
  counted_by_name TEXT,
  counted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- สินค้าเดิมห้ามซ้ำในรอบเดียวกัน (กันกดปุ่ม "เติมสินค้า" ซ้ำแล้วได้ 2 แถว)
-- partial: เฉพาะแถวที่ผูก product_id — แถวที่พิมพ์ชื่อเองล้วน ๆ ซ้ำได้
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_check_lines_session_product
  ON stock_check_lines (session_id, product_id)
  WHERE product_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stock_check_lines_session
  ON stock_check_lines (session_id, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_stock_check_lines_product
  ON stock_check_lines (product_id);

-- ── 3. stock_check_report — วิวแบนสำหรับ export / ตรวจข้อมูล ──
--     variance_label = ข้อความ Col L · low_stock = เงื่อนไข Col M
--     (หน้าเว็บคำนวณเองอีกชุดเพื่อให้ตอบสนองทันทีระหว่างพิมพ์ · วิวนี้ไว้ให้
--      คนที่ query ตรงจาก SQL ได้เลขและข้อความชุดเดียวกัน)
CREATE OR REPLACE VIEW stock_check_report AS
SELECT
  l.id            AS line_id,
  s.id            AS session_id,
  s.check_date,
  s.title         AS session_title,
  s.status        AS session_status,
  s.warehouse_id,
  s.warehouse_name,
  l.sort_order,
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
  -- (rtrim ศูนย์ท้าย แล้ว rtrim จุดที่เหลือ — Postgres ไม่มีรหัส '#' ใน to_char)
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

-- ── 4. updated_at auto-touch ────────────────────────────────
CREATE OR REPLACE FUNCTION touch_stock_check_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_check_sessions_touch ON stock_check_sessions;
CREATE TRIGGER trg_stock_check_sessions_touch
  BEFORE UPDATE ON stock_check_sessions
  FOR EACH ROW EXECUTE FUNCTION touch_stock_check_updated_at();

DROP TRIGGER IF EXISTS trg_stock_check_lines_touch ON stock_check_lines;
CREATE TRIGGER trg_stock_check_lines_touch
  BEFORE UPDATE ON stock_check_lines
  FOR EACH ROW EXECUTE FUNCTION touch_stock_check_updated_at();

-- ── 5. กันแก้ตัวเลขหลังปิดรอบ ───────────────────────────────
--     ปิดรอบแล้วต้องเป็นหลักฐานที่ย้อนกลับไปแก้ไม่ได้ (ไม่งั้นเก็บย้อนหลังไปทำไม)
--     แก้ note ได้อย่างเดียว — ที่เหลือ raise error ให้หน้าเว็บเด้ง toast
--     หมายเหตุการเขียน: ต้องแยกทาง TG_OP ให้ชัด — ใน PL/pgSQL ตัวแปร NEW
--     ไม่มีค่าตอน DELETE (อ้างถึงแล้ว error) และ OLD ไม่มีค่าตอน INSERT
--     ส่วน RETURN ก็ต้องคืน OLD สำหรับ DELETE / NEW สำหรับ INSERT-UPDATE ตรง ๆ
--     (COALESCE(NEW, OLD) ใช้กับ record ไม่ได้)
CREATE OR REPLACE FUNCTION guard_stock_check_line_closed()
RETURNS TRIGGER AS $$
DECLARE
  sess_id     BIGINT;
  sess_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN sess_id := OLD.session_id;
  ELSE                     sess_id := NEW.session_id;
  END IF;

  SELECT status INTO sess_status
    FROM stock_check_sessions
   WHERE id = sess_id;

  -- ไม่เจอ session = กำลังถูก cascade ลบพร้อมหัวรอบ → ปล่อยผ่าน
  IF sess_status IS DISTINCT FROM 'closed' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'รอบตรวจนับนี้ปิดแล้ว — ลบรายการไม่ได้ (เปิดรอบก่อน)';
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'รอบตรวจนับนี้ปิดแล้ว — เพิ่มรายการไม่ได้ (เปิดรอบก่อน)';
  END IF;

  IF NEW.qty_box        IS DISTINCT FROM OLD.qty_box
  OR NEW.qty_piece      IS DISTINCT FROM OLD.qty_piece
  OR NEW.qty_borrow     IS DISTINCT FROM OLD.qty_borrow
  OR NEW.qty_issue      IS DISTINCT FROM OLD.qty_issue
  OR NEW.qty_system     IS DISTINCT FROM OLD.qty_system
  OR NEW.pieces_per_box IS DISTINCT FROM OLD.pieces_per_box THEN
    RAISE EXCEPTION 'รอบตรวจนับนี้ปิดแล้ว — แก้ตัวเลขไม่ได้ (เปิดรอบก่อน)';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_check_lines_guard ON stock_check_lines;
CREATE TRIGGER trg_stock_check_lines_guard
  BEFORE INSERT OR UPDATE OR DELETE ON stock_check_lines
  FOR EACH ROW EXECUTE FUNCTION guard_stock_check_line_closed();

-- ── 6. RLS OFF + GRANT anon (สำคัญ — ดูหมายเหตุหัวไฟล์) ──────
ALTER TABLE stock_check_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE stock_check_lines    DISABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON stock_check_sessions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON stock_check_lines    TO anon;
GRANT SELECT ON stock_check_report TO anon;

GRANT USAGE, SELECT ON SEQUENCE stock_check_sessions_id_seq TO anon;
GRANT USAGE, SELECT ON SEQUENCE stock_check_lines_id_seq    TO anon;

-- ── ตรวจผล (relrowsecurity ต้องได้ false ทั้ง 2 ตาราง) ───────
-- SELECT relname, relrowsecurity FROM pg_class
-- WHERE relname IN ('stock_check_sessions','stock_check_lines');
