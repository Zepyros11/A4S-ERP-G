-- ============================================================
-- Migration 102: Upline Levels (ตั้งค่าสายงาน — global, reusable)
--   เก็บเป็น config กลางใน app_settings.key = 'upline_levels'
--   value = JSON array (ลำดับใน array = ระดับ; index 0 → ระดับ 1)
--
--   โครงสร้าง value:
--     [
--       { "color": "#fecaca",
--         "leaders": [ { "code": "13781", "name": "นาย สุรวัฒน์ ...", "nickname": "พี่หนุ่ย", "color": "#ffe1ec" }, ... ] },
--       { "color": "#fde68a", "leaders": [ ... ] },
--       ...
--     ]
--     code/name = ดึงจาก members (name lookup ตอนใส่รหัส) · nickname = กรอกเอง
--     leader.color = สีประจำคน (สุ่มเฉดอ่อน · ใช้พื้นหลังช่องสายงานในตาราง) · lv.color = สีระดับ (fallback)
--
--   ใช้งาน (modules/event/attendees.js):
--     - ไล่สาย MLM: event_attendees.member_code → members.sponsor_code ขึ้นไป
--       ถ้าเจอ leader.code ที่ตั้งไว้ในระดับใด → ผู้เข้าร่วมอยู่สายนั้น
--     - เรียงตาราง: ระดับล่างสุด (เลขมากสุด) บนสุด → ในระดับเรียงตามลำดับ leader ที่ใส่
--     - ช่องคอลัมน์ "สายงาน" พื้นหลังสีรายคน + แสดงชื่อเล่นหัวหน้าทีมที่จับได้
-- ============================================================

INSERT INTO app_settings (key, value, description)
VALUES (
  'upline_levels',
  '[]',
  'ตั้งค่าสายงาน — ระดับ + รหัสหัวหน้าทีม + สี (ใช้ร่วมทุก event) · JSON array'
)
ON CONFLICT (key) DO NOTHING;

-- Verify:
-- SELECT value FROM app_settings WHERE key = 'upline_levels';
