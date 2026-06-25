-- ============================================================
-- Migration 162: ให้ anon อ่าน view member_persons ได้
--
-- Why:
--   หน้า public campaign-register.html (anon key) ต้องค้นชื่อจากรหัส
--   สมาชิก → popup ชื่อให้ผู้ลงทะเบียนเลือก (autofill ช่อง "ชื่อ")
--   ใช้ logic เดียวกับหน้า attendees (digits → member_code lookup)
--
--   member_persons เป็น VIEW (มาจาก 036/042) — หน้า attendees ใช้ key
--   authenticated อยู่แล้ว แต่หน้า register เป็น anon จึงต้อง grant ตรงๆ
--   (โปรเจกต์นี้ไม่เปิด RLS — สอดคล้องกับตารางอื่นที่ anon เข้าถึงได้)
--
-- Idempotent — รันซ้ำได้
-- ============================================================

GRANT SELECT ON member_persons TO anon;

-- ============================================================
-- Test:
--   set role anon;
--   SELECT member_code, person_role, person_name FROM member_persons
--     WHERE member_code = '10001';
--   reset role;
-- ============================================================
