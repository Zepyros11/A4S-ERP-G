-- ============================================================
-- Migration 062: User Manual / Documentation Module
-- ============================================================
-- 1) manual_chapters  — บทหลักของหนังสือคู่มือ
-- 2) manual_pages     — หน้าใต้แต่ละบท (block-based content)
-- 3) Storage bucket   — manual-files (public read)
--
-- ใช้กับโมดูล modules/manual/*
--   - manual-list.html  สารบัญ (TOC)
--   - manual-view.html  หน้าอ่าน
--   - manual-edit.html  หน้าสร้าง/แก้ไข (admin)
-- ============================================================

-- ── 1. Chapters ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS manual_chapters (
  id            BIGSERIAL PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,           -- 'getting-started'
  title         TEXT NOT NULL,                  -- 'เริ่มต้นใช้งาน'
  description   TEXT,                           -- preview สั้นๆใต้ชื่อบท
  icon          TEXT DEFAULT '📖',              -- emoji แสดงบนปกบท
  cover_color   TEXT DEFAULT 'linear-gradient(135deg,#0ea5e9,#6366f1)',
                                                -- gradient ของ chapter card
  sort_order    INT DEFAULT 0,
  is_published  BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_manual_chapters_sort
  ON manual_chapters(sort_order, id);
CREATE INDEX IF NOT EXISTS idx_manual_chapters_published
  ON manual_chapters(is_published);

-- ── 2. Pages ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS manual_pages (
  id               BIGSERIAL PRIMARY KEY,
  chapter_id       BIGINT NOT NULL REFERENCES manual_chapters(id) ON DELETE CASCADE,
  slug             TEXT NOT NULL,                -- unique within chapter
  title            TEXT NOT NULL,
  summary          TEXT,                         -- 1–2 บรรทัด preview ใน TOC
  blocks           JSONB DEFAULT '[]'::JSONB,    -- array of content blocks
  reading_minutes  INT DEFAULT 1,
  sort_order       INT DEFAULT 0,
  is_published     BOOLEAN DEFAULT FALSE,        -- default draft
  updated_by       INT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (chapter_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_manual_pages_chapter
  ON manual_pages(chapter_id, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_manual_pages_published
  ON manual_pages(is_published);
CREATE INDEX IF NOT EXISTS idx_manual_pages_blocks_gin
  ON manual_pages USING GIN (blocks);

-- ── 3. Updated-at trigger ───────────────────────────────────
CREATE OR REPLACE FUNCTION manual_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_manual_chapters_touch ON manual_chapters;
CREATE TRIGGER trg_manual_chapters_touch
  BEFORE UPDATE ON manual_chapters
  FOR EACH ROW EXECUTE FUNCTION manual_touch_updated_at();

DROP TRIGGER IF EXISTS trg_manual_pages_touch ON manual_pages;
CREATE TRIGGER trg_manual_pages_touch
  BEFORE UPDATE ON manual_pages
  FOR EACH ROW EXECUTE FUNCTION manual_touch_updated_at();

-- ── 4. Storage bucket (run once via Supabase dashboard if not exists) ──
-- เปิด public read · upload จาก client ที่ login แล้ว
INSERT INTO storage.buckets (id, name, public)
VALUES ('manual-files', 'manual-files', TRUE)
ON CONFLICT (id) DO NOTHING;

-- ── 5. Block schema reference (documentation, not enforced) ─
-- blocks: JSONB array, each item has { type, ...payload }
--
--   { "type": "heading",   "level": 2, "text": "หัวข้อ" }
--   { "type": "paragraph", "text": "เนื้อหา รองรับ **bold** *italic* `code`" }
--   { "type": "image",     "src": "https://.../manual-files/...", "caption": "...", "width": "full|medium|small" }
--   { "type": "steps",     "items": ["ขั้นที่ 1", "ขั้นที่ 2"] }
--   { "type": "callout",   "variant": "info|tip|warning|success", "text": "..." }
--   { "type": "video",     "src": "...", "poster": "..." }                 -- mp4 หรือ youtube embed url
--   { "type": "table",     "headers": ["A","B"], "rows": [["1","2"]] }
--   { "type": "code",      "lang": "js", "text": "..." }
--   { "type": "divider" }
