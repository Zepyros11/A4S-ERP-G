-- ============================================================
-- Migration 108: เพิ่ม columns สำหรับหน้า Pax Detail
--
-- Why:
--   แยก "ข้อมูลส่วนตัวผู้เดินทาง" ออกจากหน้า Check Seat
--   (เดิม Check Seat รวมทั้ง passport/flight/seat/personal — เยอะเกิน)
--   หน้าใหม่ modules/trip/pax-detail.html?trip_id=X จะดูแล:
--     • Health: medical_conditions, daily_medication
--     • Emergency contact: name/phone/relation
--     • Address + LINE
--     • Insurance: company + policy no
--     • Special requests (textarea)
--   ส่วน food_allergy, religion, tshirt_size มี column อยู่แล้ว
--   (เพิ่มจาก migration 106) แค่เพิ่ม UI ให้กรอกจริง
--
--   Permissions: trip_pax_detail_view / trip_pax_detail_edit
--
-- Idempotent — รันซ้ำได้
-- ============================================================

-- 1) เพิ่ม columns ใน tour_seat_check (TEXT, nullable ทั้งหมด)
ALTER TABLE tour_seat_check
  ADD COLUMN IF NOT EXISTS medical_conditions         TEXT,
  ADD COLUMN IF NOT EXISTS daily_medication           TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_name     TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_phone    TEXT,
  ADD COLUMN IF NOT EXISTS emergency_contact_relation TEXT,
  ADD COLUMN IF NOT EXISTS home_address               TEXT,
  ADD COLUMN IF NOT EXISTS line_id                    TEXT,
  ADD COLUMN IF NOT EXISTS insurance_company          TEXT,
  ADD COLUMN IF NOT EXISTS insurance_policy_no        TEXT,
  ADD COLUMN IF NOT EXISTS special_requests           TEXT;

-- 2) Grant permissions ให้ ADMIN
UPDATE role_configs
SET permissions = (
  SELECT to_jsonb(array(
    SELECT DISTINCT unnest(
      array(SELECT jsonb_array_elements_text(permissions))
      || ARRAY[
        'trip_pax_detail_view',
        'trip_pax_detail_edit'
      ]
    )
  ))
)
WHERE role_key = 'ADMIN';

-- 3) Reload PostgREST cache
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Verify:
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'tour_seat_check'
--       AND column_name IN (
--         'medical_conditions','daily_medication',
--         'emergency_contact_name','emergency_contact_phone','emergency_contact_relation',
--         'home_address','line_id',
--         'insurance_company','insurance_policy_no','special_requests'
--       );
--
--   SELECT role_key,
--          permissions ? 'trip_pax_detail_view' AS has_view,
--          permissions ? 'trip_pax_detail_edit' AS has_edit
--   FROM role_configs WHERE role_key = 'ADMIN';
-- ============================================================
