-- ============================================================
-- Migration 146: person_profiles (โปรไฟล์คนข้าม program)
--
-- Why:
--   หัวใจของ "ข้อมูลเชื่อมโยงกัน" — ข้อมูลที่ติดตัวคน ไม่ใช่ติด program
--   (ศาสนา/อาหารแพ้/การแพทย์/พาสปอร์ต/ไซส์เสื้อ/ฉุกเฉิน/ประกัน)
--   เพื่อให้คนคนเดียวลงหลาย trip/event แล้วข้อมูลตามไปด้วย
--
--   ทำไมตารางใหม่ ไม่ขยาย members:
--     - members sync จาก master ภายนอก (เพิ่มคอลัมน์เสี่ยงโดนทับตอน import)
--     - members บางคอลัมน์เข้ารหัสหลัง member_decrypt — ข้อมูลเดินทางพวกนี้
--       ไม่ลับ ควรอ่านได้โดยไม่ต้อง master key
--   PK = member_code (1:1 soft กับ members · ไม่ FK แข็ง รองรับ re-import)
--   MVP เก็บ plaintext (match tour_seat_check.passport_id วันนี้) —
--   การเข้ารหัส passport ค่อยตัดสินตอน Phase 2 (Participants tool)
--
-- Idempotent — รันซ้ำได้
-- ============================================================

CREATE TABLE IF NOT EXISTS person_profiles (
  member_code        TEXT PRIMARY KEY,
  religion           TEXT,
  food_allergy       TEXT,
  medical_conditions TEXT,
  daily_medication   TEXT,
  tshirt_size        TEXT,
  passport_id        TEXT,
  passport_exp_date  TEXT,
  passport_image_url TEXT,
  tel                TEXT,
  line_id            TEXT,
  emergency_contact_name     TEXT,
  emergency_contact_phone    TEXT,
  emergency_contact_relation TEXT,
  insurance_company  TEXT,
  insurance_policy_no TEXT,
  special_requests   TEXT,
  updated_at         TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE person_profiles ADD COLUMN IF NOT EXISTS religion           TEXT;
ALTER TABLE person_profiles ADD COLUMN IF NOT EXISTS food_allergy       TEXT;
ALTER TABLE person_profiles ADD COLUMN IF NOT EXISTS medical_conditions TEXT;
ALTER TABLE person_profiles ADD COLUMN IF NOT EXISTS daily_medication   TEXT;
ALTER TABLE person_profiles ADD COLUMN IF NOT EXISTS tshirt_size        TEXT;
ALTER TABLE person_profiles ADD COLUMN IF NOT EXISTS passport_id        TEXT;
ALTER TABLE person_profiles ADD COLUMN IF NOT EXISTS passport_exp_date  TEXT;
ALTER TABLE person_profiles ADD COLUMN IF NOT EXISTS passport_image_url TEXT;
ALTER TABLE person_profiles ADD COLUMN IF NOT EXISTS tel                TEXT;
ALTER TABLE person_profiles ADD COLUMN IF NOT EXISTS line_id            TEXT;
ALTER TABLE person_profiles ADD COLUMN IF NOT EXISTS emergency_contact_name     TEXT;
ALTER TABLE person_profiles ADD COLUMN IF NOT EXISTS emergency_contact_phone    TEXT;
ALTER TABLE person_profiles ADD COLUMN IF NOT EXISTS emergency_contact_relation TEXT;
ALTER TABLE person_profiles ADD COLUMN IF NOT EXISTS insurance_company  TEXT;
ALTER TABLE person_profiles ADD COLUMN IF NOT EXISTS insurance_policy_no TEXT;
ALTER TABLE person_profiles ADD COLUMN IF NOT EXISTS special_requests   TEXT;
ALTER TABLE person_profiles ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ DEFAULT now();

DROP TRIGGER IF EXISTS trg_person_profiles_updated ON person_profiles;
CREATE TRIGGER trg_person_profiles_updated
  BEFORE UPDATE ON person_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Permissions
UPDATE role_configs
SET permissions = (
  SELECT to_jsonb(array(
    SELECT DISTINCT unnest(
      array(SELECT jsonb_array_elements_text(permissions))
      || ARRAY[
        'person_profile_view',
        'person_profile_edit'
      ]
    )
  ))
)
WHERE role_key = 'ADMIN';

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅  Verify:
--   SELECT member_code, religion, food_allergy FROM person_profiles LIMIT 5;
-- ============================================================
