-- ============================================================
-- Migration 175: Delivery Tracking (แทน Google Sheet "ส่ง Track")
--
-- Why:
--   ทีม CS บันทึกการจัดส่งในชีต: Order Date / วันที่จัดส่ง / CS / Line ID /
--   ชื่อลูกค้า / จังหวัด / เบอร์ / Tracking / ค่าส่ง / ติ๊ก "ส่ง Track แล้ว"
--   ย้ายเข้า ERP → หน้า modules/inventory/delivery-tracking.html
--
--   แยก 2 ตาราง:
--   1) delivery_customers = master ลูกค้า (Line ID → ชื่อ → จังหวัด/เบอร์/Line OA)
--      ชีตเดิมใช้ Line ID เป็นตัวชี้ลูกค้า จึง unique ที่ line_id (เฉพาะที่ไม่ว่าง)
--      member_code = ช่องว่างไว้ผูกกับ members ภายหลัง (ยังไม่บังคับ — CS พิมพ์ชื่อเองได้)
--   2) delivery_orders = 1 แถว = 1 รอบจัดส่ง
--      เก็บ snapshot ชื่อ/จังหวัด/เบอร์ ไว้ในแถวด้วย เพราะข้อมูลลูกค้าอาจถูกแก้ทีหลัง
--      แต่บิลที่ส่งไปแล้วต้องคงค่าเดิม (เหมือนชีตที่พิมพ์ค่าลงแถว)
--
--   ไม่ใช้ RLS — ERP login เป็น custom (users table) ไม่ใช่ Supabase Auth
--   → ทุก request เป็น role anon · RLS ที่เปิดค้าง = หน้าเว็บอ่าน/เขียนไม่ได้
--   (SQL Editor รันด้วย role postgres ซึ่ง bypass RLS จึงดูเหมือนสำเร็จ แต่หน้าเว็บพัง)
--   → ต้องสั่ง DISABLE ROW LEVEL SECURITY ให้ชัดเจน (ข้อ 4)
--
-- Idempotent — รันซ้ำได้
-- ============================================================

-- ── 1. delivery_customers — master ลูกค้าจัดส่ง ──────────────
CREATE TABLE IF NOT EXISTS delivery_customers (
  id            BIGSERIAL PRIMARY KEY,
  line_id       TEXT,                          -- Line ID ที่ CS ใช้คุย (ตัวชี้ลูกค้าในชีตเดิม)
  customer_name TEXT NOT NULL,                 -- ชื่อที่ใช้เรียกในข้อความแจ้งลูกค้า
  province      TEXT,
  phone         TEXT,
  line_oa_url   TEXT,                          -- LineOA Link — มี = สถานะเขียว / ว่าง = แดง
  member_code   TEXT,                          -- (ออปชัน) ผูกกับ members ภายหลัง
  note          TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Line ID ซ้ำไม่ได้ (แต่ปล่อยว่างได้หลายแถว)
CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_customers_line_id
  ON delivery_customers (lower(line_id))
  WHERE line_id IS NOT NULL AND btrim(line_id) <> '';

CREATE INDEX IF NOT EXISTS idx_delivery_customers_name
  ON delivery_customers (lower(customer_name));

-- ── 2. delivery_orders — รายการจัดส่ง ────────────────────────
CREATE TABLE IF NOT EXISTS delivery_orders (
  id             BIGSERIAL PRIMARY KEY,
  order_date     DATE NOT NULL DEFAULT CURRENT_DATE,   -- วันที่ตามบิล
  ship_date      DATE,                                  -- วันที่ส่งจริง
  cs_user_id     INT REFERENCES users(user_id) ON DELETE SET NULL,
  cs_name        TEXT,                                  -- snapshot ชื่อ CS
  customer_id    BIGINT REFERENCES delivery_customers(id) ON DELETE SET NULL,
  customer_name  TEXT,                                  -- snapshot (ลูกค้าถูกแก้ทีหลังก็ไม่กระทบบิลเก่า)
  line_id        TEXT,                                  -- snapshot
  province       TEXT,                                  -- snapshot
  phone          TEXT,                                  -- snapshot
  courier        TEXT NOT NULL DEFAULT 'KEX',           -- KEX | FLASH | JT | THP | OTHER
  tracking_no    TEXT,
  shipping_cost  NUMERIC(12,2) NOT NULL DEFAULT 0,      -- "คิดราคา" = SUM ของคอลัมน์นี้
  track_sent     BOOLEAN NOT NULL DEFAULT false,        -- ติ๊กเมื่อส่ง tracking ให้ลูกค้าแล้ว
  track_sent_at  TIMESTAMPTZ,
  note           TEXT,
  created_by     INT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_delivery_orders_order_date ON delivery_orders (order_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_customer   ON delivery_orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_tracking   ON delivery_orders (tracking_no);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_track_sent ON delivery_orders (track_sent);

-- ── 3. updated_at auto-touch ────────────────────────────────
CREATE OR REPLACE FUNCTION touch_delivery_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_delivery_customers_touch ON delivery_customers;
CREATE TRIGGER trg_delivery_customers_touch
  BEFORE UPDATE ON delivery_customers
  FOR EACH ROW EXECUTE FUNCTION touch_delivery_updated_at();

DROP TRIGGER IF EXISTS trg_delivery_orders_touch ON delivery_orders;
CREATE TRIGGER trg_delivery_orders_touch
  BEFORE UPDATE ON delivery_orders
  FOR EACH ROW EXECUTE FUNCTION touch_delivery_updated_at();

-- ── 4. RLS OFF + GRANT anon (สำคัญ — ดูหมายเหตุหัวไฟล์) ──────
ALTER TABLE delivery_customers DISABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_orders    DISABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON delivery_customers TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON delivery_orders    TO anon;
GRANT USAGE, SELECT ON SEQUENCE delivery_customers_id_seq TO anon;
GRANT USAGE, SELECT ON SEQUENCE delivery_orders_id_seq    TO anon;

-- ── ตรวจผล (ต้องได้ false ทั้งคู่) ───────────────────────────
-- SELECT relname, relrowsecurity FROM pg_class
-- WHERE relname IN ('delivery_customers','delivery_orders');
