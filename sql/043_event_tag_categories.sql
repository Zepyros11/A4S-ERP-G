-- ============================================================
-- Migration 043: Event-scoped Tag Categories
-- หมวดหมู่ Tag ที่ unique ต่อ event (ไม่แชร์ข้ามงาน)
-- ใช้ใน UI หน้า attendees: เลือก tag จาก dropdown แทน free-form
-- attendees.tags ยังเก็บแบบ TEXT[] เหมือนเดิม
-- ============================================================

CREATE TABLE IF NOT EXISTS event_tag_categories (
  tag_category_id BIGSERIAL PRIMARY KEY,
  event_id        INTEGER NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
  tag_name        TEXT NOT NULL,
  color           TEXT,                    -- preset key: yellow|blue|green|pink|purple|red|gray (NULL = default)
  sort_order      INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (event_id, tag_name)
);

CREATE INDEX IF NOT EXISTS idx_event_tag_categories_event
  ON event_tag_categories(event_id);

-- ============================================================
-- DONE ✅
-- ============================================================
