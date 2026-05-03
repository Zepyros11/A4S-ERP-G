-- ============================================================
-- Migration 067: notification_triggers — CRUD source for trigger types
--
-- เดิม: TRIGGERS เป็น const ใน notification-rules.js (5 ตัว: event/booking)
--       แต่ใน DB มี IBD trigger 3 ตัวที่ seed มาจาก migration 058
--       → dropdown ในหน้าแก้ไขกฎไม่โชว์ IBD ทำให้ admin แก้ไขรูล IBD ไม่ได้
--
-- แก้: ย้าย metadata มาเก็บในตาราง อนุญาตให้ admin จัดการได้เอง
--      - is_builtin = true → key ที่ wire กับ code (ห้ามลบ แต่แก้ label/placeholders/sample ได้)
--      - is_builtin = false → admin สร้างใหม่ ลบได้
--
-- หมายเหตุเรื่อง scheduled:
--   ai-proxy `_processRule` รองรับเฉพาะ anchor 3 ตัว (event_date | booking_date |
--   booking_start_time) — admin สร้าง scheduled trigger ใหม่ได้แต่ต้องใช้ anchor
--   ใน 3 ตัวนี้เท่านั้น ถ้าจะรองรับ anchor ใหม่ต้องแก้ ai-proxy
-- ============================================================

CREATE TABLE IF NOT EXISTS notification_triggers (
  trigger_key   TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('on_status','scheduled')),
  anchor        TEXT CHECK (anchor IN ('event_date','booking_date','booking_start_time')),
  placeholders  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  sample        JSONB  NOT NULL DEFAULT '{}'::jsonb,
  description   TEXT,
  is_builtin    BOOLEAN NOT NULL DEFAULT false,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  sort_order    INT NOT NULL DEFAULT 100,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT chk_anchor_kind CHECK (
    (kind = 'scheduled' AND anchor IS NOT NULL)
    OR (kind = 'on_status' AND anchor IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_notif_triggers_active_sort
  ON notification_triggers(is_active, sort_order);

-- auto-update updated_at
CREATE OR REPLACE FUNCTION _notif_triggers_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notif_triggers_updated_at ON notification_triggers;
CREATE TRIGGER trg_notif_triggers_updated_at
  BEFORE UPDATE ON notification_triggers
  FOR EACH ROW EXECUTE FUNCTION _notif_triggers_touch_updated_at();

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE notification_triggers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nt_select_all ON notification_triggers;
CREATE POLICY nt_select_all ON notification_triggers FOR SELECT USING (true);
DROP POLICY IF EXISTS nt_write_all  ON notification_triggers;
CREATE POLICY nt_write_all  ON notification_triggers FOR ALL    USING (true) WITH CHECK (true);

-- ── Seed: built-in triggers (ที่ wire กับ code อยู่) ─────────
INSERT INTO notification_triggers
  (trigger_key, label, kind, anchor, placeholders, sample, description, is_builtin, sort_order)
VALUES
  (
    'event.confirmed',
    '📌 Event ยืนยัน (CONFIRMED)',
    'on_status', NULL,
    ARRAY['event_code','event_name','event_type','event_date','end_date','location','dept','attendees_count','request_code','approver'],
    '{"event_code":"EVT-2026-05-001","event_name":"Tech Summit 2026","event_type":"EVENT","event_date":"15/05/2026","end_date":"16/05/2026","location":"Bangkok Convention Center","dept":"ทีมจัดงาน","attendees_count":120,"request_code":"REQ-2026-05-001","approver":"ภพ (admin)"}'::jsonb,
    'ยิงเมื่อ events.status เปลี่ยนเป็น CONFIRMED (ใน event-form.js)',
    true, 10
  ),
  (
    'booking.approved',
    '🏢 จองห้องประชุมอนุมัติ',
    'on_status', NULL,
    ARRAY['room_name','place_name','booking_date','start_time','end_time','booked_by_name','cs_name','request_code','approver'],
    '{"room_name":"ห้องประชุมใหญ่","place_name":"ออฟฟิศ BKK","booking_date":"20/05/2026","start_time":"09:00","end_time":"12:00","booked_by_name":"วิชัย ตั้งใจ","cs_name":"น้องส้ม","request_code":"RBKQ-2026-05-001","approver":"ภพ (admin)"}'::jsonb,
    'ยิงเมื่อ room_booking_requests.status เปลี่ยนเป็น APPROVED',
    true, 20
  ),
  (
    'event.scheduled',
    '⏰ Event — แจ้งตามเวลา (cron)',
    'scheduled', 'event_date',
    ARRAY['event_code','event_name','event_type','event_date','end_date','location','attendees_count','start_time','end_time'],
    '{"event_code":"EVT-2026-05-001","event_name":"Tech Summit 2026","event_type":"EVENT","event_date":"15/05/2026","end_date":"16/05/2026","location":"Bangkok Convention Center","attendees_count":120,"start_time":"09:00","end_time":"17:00"}'::jsonb,
    'cron ทุก 15 นาทีตรวจ event ที่ event_date ใกล้ครบกำหนดตาม offset_days/time',
    true, 30
  ),
  (
    'booking.scheduled',
    '⏰ Booking — แจ้งตามเวลา (cron)',
    'scheduled', 'booking_date',
    ARRAY['request_code','room_name','place_name','booking_date','start_time','end_time','booked_by_name','cs_name'],
    '{"request_code":"RBKQ-2026-05-001","room_name":"ห้องประชุมใหญ่","place_name":"ออฟฟิศ BKK","booking_date":"20/05/2026","start_time":"09:00","end_time":"12:00","booked_by_name":"วิชัย ตั้งใจ","cs_name":"น้องส้ม"}'::jsonb,
    'cron ทุก 15 นาทีตรวจ booking ที่ booking_date ใกล้ครบกำหนดตาม offset_days/time',
    true, 40
  ),
  (
    'booking.before_start',
    '⏰ Booking — ก่อนเริ่ม N นาที',
    'scheduled', 'booking_start_time',
    ARRAY['request_code','room_name','place_name','booking_date','start_time','end_time','booked_by_name','cs_name'],
    '{"request_code":"RBKQ-2026-05-001","room_name":"ห้องประชุมใหญ่","place_name":"ออฟฟิศ BKK","booking_date":"20/05/2026","start_time":"09:00","end_time":"12:00","booked_by_name":"วิชัย ตั้งใจ","cs_name":"น้องส้ม"}'::jsonb,
    'cron ตรวจทุก booking ของวันนี้ ส่งเตือนตาม offset_minutes ก่อน/หลัง start_time',
    true, 50
  ),
  (
    'ibd.complaint.created',
    '🌍 IBD: Complaint ใหม่จากลูกค้า',
    'on_status', NULL,
    ARRAY['member_name','member_code','topic_label','branch_label','whatsapp_used','details_short','submission_id'],
    '{"member_name":"John Doe","member_code":"M00012345","topic_label":"การเงิน","branch_label":"Singapore","whatsapp_used":"+65 9123 4567","details_short":"ขอตรวจสอบยอดโบนัสเดือนนี้","submission_id":1}'::jsonb,
    'ยิงจาก ai-proxy POST /ibd/notify เมื่อ portal IBD รับ complaint ใหม่',
    true, 60
  ),
  (
    'ibd.ewallet.created',
    '🌍 IBD: คำขอโอน E-Wallet ใหม่',
    'on_status', NULL,
    ARRAY['member_full_name','member_code','whatsapp','email','submission_id'],
    '{"member_full_name":"John Doe","member_code":"M00012345","whatsapp":"+65 9123 4567","email":"john@example.com","submission_id":2}'::jsonb,
    'ยิงจาก ai-proxy POST /ibd/notify เมื่อ portal IBD รับคำขอโอน E-Wallet ใหม่',
    true, 70
  ),
  (
    'ibd.relocation.created',
    '🌍 IBD: คำขอย้ายฐานประเทศใหม่',
    'on_status', NULL,
    ARRAY['member_name','member_code','from_country_label','to_country_label','whatsapp','submission_id'],
    '{"member_name":"John Doe","member_code":"M00012345","from_country_label":"Singapore","to_country_label":"Thailand","whatsapp":"+65 9123 4567","submission_id":3}'::jsonb,
    'ยิงจาก ai-proxy POST /ibd/notify เมื่อ portal IBD รับคำขอย้ายฐานประเทศใหม่',
    true, 80
  )
ON CONFLICT (trigger_key) DO NOTHING;

-- ============================================================
-- Verify:
--   SELECT trigger_key, label, kind, anchor, is_builtin
--     FROM notification_triggers ORDER BY sort_order;
-- ============================================================
