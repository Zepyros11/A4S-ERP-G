-- ============================================================
-- Migration 012: Course Series + Levels + Prerequisites
--   - course_series: groups related events (e.g., "Unlock the World")
--   - course_levels: levels within a series (Basic → Advance → Master)
--   - ALTER events: add series_id + level_id
--   - ALTER event_attendees: add member_code (link to MLM)
-- ============================================================

-- ── Course Series ──
CREATE TABLE IF NOT EXISTS course_series (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  description   TEXT,
  icon          TEXT DEFAULT '📚',
  color         TEXT DEFAULT '#3b82f6',
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- ── Course Levels ──
CREATE TABLE IF NOT EXISTS course_levels (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id             UUID NOT NULL REFERENCES course_series(id) ON DELETE CASCADE,
  level_order           INT NOT NULL DEFAULT 1,
  level_name            TEXT NOT NULL,
  prerequisite_level_id UUID REFERENCES course_levels(id) ON DELETE SET NULL,
  description           TEXT,
  created_at            TIMESTAMPTZ DEFAULT now(),
  UNIQUE(series_id, level_order)
);

-- ── Link events to course series + level ──
ALTER TABLE events ADD COLUMN IF NOT EXISTS series_id UUID REFERENCES course_series(id) ON DELETE SET NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS level_id UUID REFERENCES course_levels(id) ON DELETE SET NULL;

-- ── Link attendees to MLM members ──
ALTER TABLE event_attendees ADD COLUMN IF NOT EXISTS member_code TEXT;
CREATE INDEX IF NOT EXISTS idx_attendees_member ON event_attendees (member_code);

-- ── Indexes for fast queries ──
CREATE INDEX IF NOT EXISTS idx_events_series ON events (series_id);
CREATE INDEX IF NOT EXISTS idx_events_level ON events (level_id);
CREATE INDEX IF NOT EXISTS idx_levels_series ON course_levels (series_id, level_order);

-- ============================================================
-- DONE ✅
-- Test:
--   SELECT * FROM course_series;
--   SELECT * FROM course_levels ORDER BY series_id, level_order;
--   SELECT e.event_name, cs.name AS series, cl.level_name
--     FROM events e
--     LEFT JOIN course_series cs ON e.series_id = cs.id
--     LEFT JOIN course_levels cl ON e.level_id = cl.id
--     LIMIT 10;
-- ============================================================
