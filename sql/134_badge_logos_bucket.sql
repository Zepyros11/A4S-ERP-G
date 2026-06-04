-- ============================================================
-- Migration 134: สร้าง Supabase Storage bucket "badge-logos"
--                สำหรับเก็บโลโก้ป้าย (เครื่องมือ "ป้ายโลโก้+ชื่อ")
--
-- Why:
--   หน้า /modules/event/namecard-generator.html (tab "ป้ายโลโก้+ชื่อ")
--   ให้ผู้ใช้ upload โลโก้เอง + เขียนชื่อ → tile บนกระดาษ A4
--   เก็บใน Storage = โลโก้ใช้ร่วมกันได้ทุกเครื่อง (library)
--
--   Filenames: badge-logos/{timestamp}-{safename}.{png|jpg}
--   Public read (URL พร้อมใช้กับ <img>) + anon write/delete
--
-- Idempotent — รันซ้ำได้
-- ============================================================

-- 1) สร้าง bucket (public read)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'badge-logos',
  'badge-logos',
  true,                               -- public read
  10 * 1024 * 1024,                   -- 10 MB per file (โลโก้ไม่ต้องใหญ่)
  ARRAY['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2) RLS Policies — ใส่ TO anon, authenticated ชัดเจน
DROP POLICY IF EXISTS "badge_logos_public_read" ON storage.objects;
CREATE POLICY "badge_logos_public_read"
  ON storage.objects FOR SELECT
  TO public, anon, authenticated
  USING (bucket_id = 'badge-logos');

DROP POLICY IF EXISTS "badge_logos_anon_write" ON storage.objects;
CREATE POLICY "badge_logos_anon_write"
  ON storage.objects FOR INSERT
  TO public, anon, authenticated
  WITH CHECK (bucket_id = 'badge-logos');

DROP POLICY IF EXISTS "badge_logos_anon_update" ON storage.objects;
CREATE POLICY "badge_logos_anon_update"
  ON storage.objects FOR UPDATE
  TO public, anon, authenticated
  USING (bucket_id = 'badge-logos')
  WITH CHECK (bucket_id = 'badge-logos');

DROP POLICY IF EXISTS "badge_logos_anon_delete" ON storage.objects;
CREATE POLICY "badge_logos_anon_delete"
  ON storage.objects FOR DELETE
  TO public, anon, authenticated
  USING (bucket_id = 'badge-logos');

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Verify:
--   SELECT id, name, public, file_size_limit FROM storage.buckets WHERE id = 'badge-logos';
--   SELECT polname FROM pg_policy WHERE polrelid = 'storage.objects'::regclass
--     AND polname LIKE 'badge_logos_%';
-- ============================================================
