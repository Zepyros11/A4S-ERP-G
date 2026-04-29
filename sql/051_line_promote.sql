-- ============================================================
-- Migration 051: LINE Promote Scheduler
-- ============================================================
-- 1) line_groups            — registry กลุ่ม LINE ที่ระบบส่งข้อความได้
--                             (group_id ได้จาก webhook event 'join')
-- 2) line_scheduled_posts   — ข้อความที่ schedule ส่งเข้า LINE
--                             (auto-generate D-7/3/2/1 สำหรับ event ประเภท "คอร์สบริษัท")
-- ============================================================

-- ── 1. LINE Groups Registry ─────────────────────────────────
CREATE TABLE IF NOT EXISTS line_groups (
  id              BIGSERIAL PRIMARY KEY,
  group_id        TEXT UNIQUE NOT NULL,         -- LINE groupId (เช่น "Cxxxxxxxxxxxxxxxx")
  group_name      TEXT,                         -- ชื่อกลุ่ม (manual หรือ summary จาก LINE)
  channel_id      INT REFERENCES line_channels(id) ON DELETE SET NULL,
  is_default      BOOLEAN DEFAULT FALSE,        -- default group สำหรับ promote
  is_active       BOOLEAN DEFAULT TRUE,
  joined_at       TIMESTAMPTZ DEFAULT now(),    -- เวลาที่บอทถูกเชิญเข้ากลุ่ม
  last_seen_at    TIMESTAMPTZ,                  -- update ทุก webhook event
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_line_groups_active  ON line_groups(is_active);
CREATE INDEX IF NOT EXISTS idx_line_groups_default ON line_groups(is_default) WHERE is_default = TRUE;

-- ── 2. LINE Scheduled Posts ─────────────────────────────────
CREATE TABLE IF NOT EXISTS line_scheduled_posts (
  id                BIGSERIAL PRIMARY KEY,
  event_id          INT REFERENCES events(event_id) ON DELETE CASCADE,

  -- Target
  target_type       TEXT NOT NULL DEFAULT 'group'
                    CHECK (target_type IN ('group','user','broadcast')),
  target_id         TEXT,                       -- groupId / userId (NULL ถ้า broadcast)
  channel_id        INT REFERENCES line_channels(id) ON DELETE SET NULL,

  -- Promote metadata
  promote_offset    INT,                        -- วันก่อน event (7/3/2/1) — null = manual
  message_text      TEXT NOT NULL,

  -- Scheduling
  scheduled_at      TIMESTAMPTZ NOT NULL,       -- เวลาที่จะส่ง (Asia/Bangkok aware)
  status            TEXT NOT NULL DEFAULT 'SCHEDULED'
                    CHECK (status IN ('DRAFT','SCHEDULED','SENT','FAILED','CANCELLED')),

  -- Result
  sent_at           TIMESTAMPTZ,
  error_message     TEXT,
  retry_count       INT DEFAULT 0,

  -- Audit
  created_by        INT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_line_posts_event     ON line_scheduled_posts(event_id);
CREATE INDEX IF NOT EXISTS idx_line_posts_status    ON line_scheduled_posts(status);
CREATE INDEX IF NOT EXISTS idx_line_posts_scheduled ON line_scheduled_posts(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_line_posts_pending
  ON line_scheduled_posts(scheduled_at)
  WHERE status = 'SCHEDULED';

-- ── 3. Auto-update updated_at ───────────────────────────────
DROP TRIGGER IF EXISTS trg_line_groups_updated ON line_groups;
CREATE TRIGGER trg_line_groups_updated
  BEFORE UPDATE ON line_groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_line_posts_updated ON line_scheduled_posts;
CREATE TRIGGER trg_line_posts_updated
  BEFORE UPDATE ON line_scheduled_posts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- DONE ✅
-- การใช้งาน:
--   1. เชิญบอท @949bctau เข้ากลุ่ม LINE → webhook 'join' จะ insert row
--      ใน line_groups อัตโนมัติ (ดู ai-proxy/server.js)
--   2. ทำเครื่องหมาย default group ด้วย:
--        UPDATE line_groups SET is_default = TRUE WHERE id = <id>;
--   3. สร้าง event ประเภท "คอร์สบริษัท" → auto-generate 4 posts
--      (D-7, D-3, D-2, D-1) ที่ 09:00 Bangkok
--
-- Test:
--   SELECT id, group_id, group_name, is_active FROM line_groups;
--   SELECT id, event_id, promote_offset, scheduled_at, status
--     FROM line_scheduled_posts ORDER BY scheduled_at;
-- ============================================================
