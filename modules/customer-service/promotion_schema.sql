-- ============================================================
-- promotion_schema.sql — Promotion Module Tables
-- ============================================================

-- ── 1) หมวดหมู่โปรโมชัน ──
CREATE TABLE IF NOT EXISTS promotion_categories (
  promotion_category_id  SERIAL PRIMARY KEY,
  category_name          TEXT NOT NULL,
  icon                   TEXT DEFAULT '🎁',
  color                  TEXT DEFAULT '#f59e0b',
  sort_order             INT DEFAULT 0,
  created_at             TIMESTAMPTZ DEFAULT now()
);

-- ── 2) โปรโมชัน (1 row = 1 poster) ──
CREATE TABLE IF NOT EXISTS promotions (
  promotion_id            SERIAL PRIMARY KEY,
  promotion_category_id   INT REFERENCES promotion_categories(promotion_category_id) ON DELETE SET NULL,
  promo_month             TEXT NOT NULL,              -- 'YYYY-MM' เช่น '2026-04'
  poster_url              TEXT NOT NULL,              -- public URL จาก Supabase Storage
  title                   TEXT DEFAULT '',            -- caption (optional)
  sort_order              INT DEFAULT 0,
  created_at              TIMESTAMPTZ DEFAULT now()
);

-- ── INDEX สำหรับ filter by month ──
CREATE INDEX IF NOT EXISTS idx_promotions_month ON promotions (promo_month);
CREATE INDEX IF NOT EXISTS idx_promotions_cat   ON promotions (promotion_category_id);

-- ── 3) Seed หมวดหมู่เริ่มต้น (ปรับตามจริง) ──
INSERT INTO promotion_categories (category_name, icon, color, sort_order) VALUES
  ('4Tree',                    '🌳', '#1d4ed8', 1),
  ('Zun Zhine',                '🪥', '#059669', 2),
  ('4life Promotion',          '💊', '#dc2626', 3),
  ('60CV SuperStar x ARP EASY','⭐', '#f59e0b', 4),
  ('Special SET',              '🎁', '#7c3aed', 5),
  ('อื่นๆ',                    '📦', '#64748b', 6)
ON CONFLICT DO NOTHING;

-- ── 4) RLS — เปิด read ให้ anon, write ให้ authenticated ──
ALTER TABLE promotion_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE promotions           ENABLE ROW LEVEL SECURITY;

-- read: ทุกคนอ่านได้
CREATE POLICY "promotion_categories_read" ON promotion_categories
  FOR SELECT USING (true);
CREATE POLICY "promotions_read" ON promotions
  FOR SELECT USING (true);

-- write: anon ก็ write ได้ (ERP ใช้ anon key)
CREATE POLICY "promotion_categories_write" ON promotion_categories
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "promotions_write" ON promotions
  FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- 5) Storage bucket สำหรับ poster files
-- ============================================================
-- รันใน Supabase SQL Editor:
--   INSERT INTO storage.buckets (id, name, public)
--   VALUES ('promotion-files', 'promotion-files', true)
--   ON CONFLICT (id) DO NOTHING;
--
-- แล้วเพิ่ม policy ใน Storage → promotion-files:
--   SELECT: true (public read)
--   INSERT: true (allow upload)
--   DELETE: true (allow delete)
-- ============================================================
