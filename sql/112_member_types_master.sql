-- ============================================================
-- Migration 112: member_types master table (CRUD-able)
--
-- Why:
--   user ต้องการสร้าง/แก้ไข/ลบประเภทสมาชิกทีมเองได้ (ไม่ติด staff/guide/outsource)
--   เช่น เพิ่ม "Driver", "Photographer", "Medic"
--   ใช้ pattern in-context CRUD เหมือน departments
--
-- Schema:
--   member_types (global, shared across all trips)
--   - type_key   TEXT PK (slug ใช้ใน trip_guides.member_type)
--   - label      TEXT
--   - emoji      TEXT
--   - color_bg   TEXT  (badge background, hex)
--   - color_fg   TEXT  (badge text color, hex)
--   - sort_order INT
--   - is_system  BOOL  (true = ห้ามลบ — default staff/guide/outsource)
--
-- Idempotent — รันซ้ำได้
-- ============================================================

CREATE TABLE IF NOT EXISTS member_types (
  type_key    TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  emoji       TEXT DEFAULT '🧑',
  color_bg    TEXT DEFAULT '#fef3c7',
  color_fg    TEXT DEFAULT '#92400e',
  sort_order  INT DEFAULT 0,
  is_system   BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Seed defaults (idempotent — ON CONFLICT DO NOTHING)
INSERT INTO member_types (type_key, label, emoji, color_bg, color_fg, sort_order, is_system) VALUES
  ('staff',     'Staff',     '👔',     '#dbeafe', '#1d4ed8', 1, true),
  ('guide',     'ไกด์',      '🧑‍🏫',   '#fef3c7', '#92400e', 2, true),
  ('outsource', 'Outsource', '🤝',     '#f3e8ff', '#6b21a8', 3, true)
ON CONFLICT (type_key) DO NOTHING;

-- ปลด CHECK constraint จาก trip_guides.member_type (เปลี่ยนเป็น loose FK ผ่าน type_key)
ALTER TABLE trip_guides
  DROP CONSTRAINT IF EXISTS trip_guides_member_type_chk;

-- Permissions: grant member_types_* ให้ทุก role ที่มี trip_team_view
UPDATE role_configs
SET permissions = (
  SELECT to_jsonb(array(
    SELECT DISTINCT unnest(
      array(SELECT jsonb_array_elements_text(permissions))
      || ARRAY[
        'member_types_view',
        'member_types_create',
        'member_types_edit',
        'member_types_delete'
      ]
    )
  ))
)
WHERE permissions ? 'trip_team_view';

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE
-- Verify:
--   SELECT type_key, label, emoji, is_system FROM member_types ORDER BY sort_order;
-- ============================================================
