-- ============================================================
-- Migration 040: Trend Radar (เรดาร์กระแส)
--
-- หัวข้อที่ผู้ใช้ให้ระบบ "ส่อง" — ใช้ยิง Google News RSS ต่อหัวข้อ
-- (Google Trends daily ดึงรวมทุกครั้งอยู่แล้ว ไม่ต้องเก็บ)
--
-- หน้า trend-radar.html มี fallback default 4 หัวข้อในโค้ด
-- → ถ้ายังไม่รัน migration นี้หน้าไม่พัง (แค่แก้หัวข้อไม่ถาวร)
-- ============================================================

CREATE TABLE IF NOT EXISTS trend_topics (
  id          BIGSERIAL PRIMARY KEY,
  label       TEXT NOT NULL,               -- ชื่อหัวข้อที่โชว์
  query       TEXT NOT NULL,               -- คำค้นที่ยิงเข้า Google News RSS
  emoji       TEXT DEFAULT '🔎',
  sort        INT DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ── RLS (config table → anon read/write ผ่าน anon key เหมือนตารางอื่น) ──
ALTER TABLE trend_topics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tt_select_all ON trend_topics;
CREATE POLICY tt_select_all ON trend_topics FOR SELECT USING (true);
DROP POLICY IF EXISTS tt_write_all  ON trend_topics;
CREATE POLICY tt_write_all  ON trend_topics FOR ALL    USING (true) WITH CHECK (true);

-- ── Seed 4 หัวข้อเริ่มต้น (ตรงกับที่ user เลือก 2026-07-09) ──
INSERT INTO trend_topics (label, query, emoji, sort) VALUES
  ('MLM / ธุรกิจเครือข่าย', 'ธุรกิจเครือข่าย ขายตรง MLM แชร์ลูกโซ่', '🔗', 1),
  ('สุขภาพ / ความงาม',     'เทรนด์สุขภาพ อาหารเสริม ความงาม สกินแคร์', '💚', 2),
  ('ท่องเที่ยว / อีเวนต์',   'เทรนด์ท่องเที่ยว ทริป สัมมนา คอนเสิร์ต อีเวนต์', '✈️', 3),
  ('ไลฟ์สไตล์ / ไวรัล',     'ไวรัล กระแสโซเชียล ไลฟ์สไตล์ ที่กำลังฮิต', '🔥', 4)
ON CONFLICT DO NOTHING;

-- ============================================================
-- DONE · Test:
--   SELECT id, label, query, is_active FROM trend_topics ORDER BY sort;
-- ============================================================
