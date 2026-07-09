-- ============================================================
-- Migration 042: เพิ่มคำค้น YouTube แยกต่อหัวข้อ (yt_query)
--
-- ให้แต่ละหัวข้อค้น YouTube ด้วยคำที่ต่างจากข่าวได้
-- เช่น สุขภาพ/ความงาม → ค้นแบบ "รีวิวสินค้า" บน YouTube
-- (ถ้า yt_query ว่าง → ใช้ query เดิม)
-- ============================================================

ALTER TABLE trend_topics
  ADD COLUMN IF NOT EXISTS yt_query TEXT;

-- ตั้งคำค้น YouTube แบบ "รีวิวสินค้า" ให้หัวข้อสุขภาพ/ความงาม
UPDATE trend_topics
SET yt_query = 'รีวิว อาหารเสริม สกินแคร์ ครีมบำรุง เซรั่ม วิตามิน สุขภาพ ความงาม'
WHERE (label ILIKE '%สุขภาพ%' OR label ILIKE '%ความงาม%')
  AND (yt_query IS NULL OR yt_query = '');

-- ============================================================
-- DONE · Test:
--   SELECT label, query, yt_query FROM trend_topics ORDER BY sort;
-- ============================================================
