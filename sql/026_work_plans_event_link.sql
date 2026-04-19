-- ============================================================
-- 026: Link work_plans → events (optional FK)
-- เพื่อให้เปิดแผนงานจากหน้า events-list ได้
-- ============================================================

ALTER TABLE work_plans
  ADD COLUMN IF NOT EXISTS event_id INTEGER
    REFERENCES events(event_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_work_plans_event_id
  ON work_plans(event_id)
  WHERE event_id IS NOT NULL;
