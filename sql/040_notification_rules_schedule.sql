-- ============================================================
-- Migration 040: Time-based scheduling for notification rules
--
-- เพิ่ม columns สำหรับ trigger แบบ scheduled (cron-driven)
--
-- Trigger keys ใหม่ที่จะใช้ column เหล่านี้:
--   - 'event.scheduled'         → anchor='event_date'        (ตามวันงาน + schedule_time)
--   - 'booking.scheduled'       → anchor='booking_date'      (ตามวันจอง + schedule_time)
--   - 'booking.before_start'    → anchor='booking_start_time'(ตาม start_time + offset_minutes)
--
-- ตัวอย่าง:
--   ส่งวันงาน 9:00         → anchor='event_date',        offset_days=0,  time='09:00'
--   ล่วงหน้า 1 วัน 18:00   → anchor='event_date',        offset_days=-1, time='18:00'
--   ก่อน booking 30 นาที   → anchor='booking_start_time',offset_minutes=-30
--
-- Cron: ai-proxy /cron/notifications ยิงทุก 15 นาที (Asia/Bangkok)
-- Dedupe: เช็ค notification_log 24 ชม.ล่าสุด (rule_id + payload_ref->>ref_id)
-- ============================================================

ALTER TABLE notification_rules
  ADD COLUMN IF NOT EXISTS schedule_anchor          TEXT,
  ADD COLUMN IF NOT EXISTS schedule_offset_days     INT  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS schedule_offset_minutes  INT  DEFAULT 0,
  ADD COLUMN IF NOT EXISTS schedule_time            TIME;

-- ── Validate anchor (NULL = on-status เดิม, ไม่บังคับ) ────
ALTER TABLE notification_rules
  DROP CONSTRAINT IF EXISTS notification_rules_anchor_chk;
ALTER TABLE notification_rules
  ADD CONSTRAINT notification_rules_anchor_chk
  CHECK (schedule_anchor IS NULL
         OR schedule_anchor IN ('event_date','booking_date','booking_start_time'));

-- ── Index สำหรับ cron — ดึง active scheduled rules เร็วๆ ──
CREATE INDEX IF NOT EXISTS idx_notif_rules_scheduled
  ON notification_rules(schedule_anchor)
  WHERE is_active = true AND schedule_anchor IS NOT NULL;

-- ── Index สำหรับ dedupe — หา log ของ rule+ref ในช่วงเวลา ──
-- payload_ref ปกติเก็บ {"event_id": X} หรือ {"request_id": X}
CREATE INDEX IF NOT EXISTS idx_notif_log_dedupe
  ON notification_log(rule_id, sent_at DESC)
  WHERE status = 'sent';

-- ============================================================
-- Verify:
--   SELECT column_name, data_type
--     FROM information_schema.columns
--    WHERE table_name='notification_rules'
--      AND column_name LIKE 'schedule_%';
--
--   SELECT conname, pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conrelid='notification_rules'::regclass
--      AND conname='notification_rules_anchor_chk';
-- ============================================================
