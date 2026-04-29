-- ============================================================
-- Migration 046: Facebook Page Post Scheduler
-- ============================================================
-- 1) fb_pages              — registry ของ FB Page ที่ระบบโพสต์ได้
-- 2) fb_scheduled_posts    — โพสต์ที่ schedule ไว้ + history (DRAFT → SCHEDULED → PUBLISHED)
-- ใช้ร่วมกับหน้า modules/event/media-schedule.html (Tab "FB Schedule")
-- ============================================================

-- ── 1. FB Pages Registry ────────────────────────────────────
CREATE TABLE IF NOT EXISTS fb_pages (
  id              BIGSERIAL PRIMARY KEY,
  page_id         TEXT UNIQUE NOT NULL,         -- FB Page ID เช่น "1693073274279563"
  page_name       TEXT NOT NULL,                -- "A4S.Global"
  access_token    TEXT NOT NULL,                -- Page Access Token (never-expire)
  page_category   TEXT,                         -- "Business" / "ธุรกิจ"
  picture_url     TEXT,                         -- รูปโปรไฟล์เพจ (cache)
  is_active       BOOLEAN DEFAULT TRUE,
  added_by        INT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fb_pages_active ON fb_pages(is_active);

-- ── 2. FB Scheduled Posts ───────────────────────────────────
CREATE TABLE IF NOT EXISTS fb_scheduled_posts (
  id                BIGSERIAL PRIMARY KEY,
  fb_page_id        BIGINT NOT NULL REFERENCES fb_pages(id) ON DELETE CASCADE,
  event_id          INT REFERENCES events(event_id) ON DELETE SET NULL,
  source_media_id   INT REFERENCES event_media(media_id) ON DELETE SET NULL,

  -- Post content
  caption           TEXT NOT NULL,
  media_urls        TEXT[],                     -- รูป/วิดีโอที่จะแนบ (Supabase Storage URLs)
  link_url          TEXT,                       -- url แชร์ (optional)

  -- Scheduling
  scheduled_at      TIMESTAMPTZ NOT NULL,       -- เวลาที่จะ publish (Asia/Bangkok aware)
  status            TEXT DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT','SCHEDULED','PUBLISHED','FAILED','CANCELLED')),

  -- Result from FB
  fb_published_id   TEXT,                       -- post id ที่ FB คืนกลับ
  fb_post_url       TEXT,                       -- URL ของโพสต์ที่ publish
  posted_at         TIMESTAMPTZ,                -- เวลา FB confirm publish
  error_message     TEXT,                       -- ถ้า fail
  retry_count       INT DEFAULT 0,

  -- Audit
  created_by        INT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fb_posts_event     ON fb_scheduled_posts(event_id);
CREATE INDEX IF NOT EXISTS idx_fb_posts_page      ON fb_scheduled_posts(fb_page_id);
CREATE INDEX IF NOT EXISTS idx_fb_posts_status    ON fb_scheduled_posts(status);
CREATE INDEX IF NOT EXISTS idx_fb_posts_scheduled ON fb_scheduled_posts(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_fb_posts_media     ON fb_scheduled_posts(source_media_id);

-- ── 3. Auto-update updated_at ───────────────────────────────
DROP TRIGGER IF EXISTS trg_fb_pages_updated ON fb_pages;
CREATE TRIGGER trg_fb_pages_updated
  BEFORE UPDATE ON fb_pages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_fb_posts_updated ON fb_scheduled_posts;
CREATE TRIGGER trg_fb_posts_updated
  BEFORE UPDATE ON fb_scheduled_posts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- DONE ✅
-- รันใน Supabase SQL Editor แล้วเพิ่มเพจแรกด้วยคำสั่ง:
--
--   INSERT INTO fb_pages (page_id, page_name, access_token, page_category)
--   VALUES (
--     '1693073274279563',
--     'A4S.Global',
--     '<paste-page-access-token>',         -- never-expire token
--     'Business'
--   );
--
-- Test:
--   SELECT id, page_id, page_name, is_active FROM fb_pages;
--   SELECT id, status, scheduled_at FROM fb_scheduled_posts;
-- ============================================================
