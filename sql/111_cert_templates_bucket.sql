-- ============================================================
-- Migration 111: สร้าง Supabase Storage bucket "cert-templates"
--                สำหรับเก็บภาพ template ใบประกาศ (5 ตำแหน่ง)
--
-- Why:
--   หน้า /modules/event/namecard-generator.html (tab ใบประกาศ)
--   ต้องการ upload template 5 ใบ (SVP/VP/AVP/SD/DR)
--   เดิมเก็บใน localStorage (10MB limit) → ใช้ภาพคุณภาพต่ำ ภาพแตก
--   ย้ายไป Storage = ไม่จำกัดขนาด + share ทุกเครื่อง
--
--   Filenames: cert-templates/{key}.jpg
--   Public read (URL พร้อมใช้กับ <img>) + auth write
--
-- Idempotent — รันซ้ำได้
-- ============================================================

-- 1) สร้าง bucket (public read)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'cert-templates',
  'cert-templates',
  true,                               -- public read
  50 * 1024 * 1024,                   -- 50 MB per file
  ARRAY['image/jpeg', 'image/png', 'image/jpg']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2) RLS Policies — ใส่ TO anon, authenticated ชัดเจน
--    (ป้องกันบาง role default ไม่ผ่าน)
DROP POLICY IF EXISTS "cert_templates_public_read" ON storage.objects;
CREATE POLICY "cert_templates_public_read"
  ON storage.objects FOR SELECT
  TO public, anon, authenticated
  USING (bucket_id = 'cert-templates');

DROP POLICY IF EXISTS "cert_templates_anon_write" ON storage.objects;
CREATE POLICY "cert_templates_anon_write"
  ON storage.objects FOR INSERT
  TO public, anon, authenticated
  WITH CHECK (bucket_id = 'cert-templates');

DROP POLICY IF EXISTS "cert_templates_anon_update" ON storage.objects;
CREATE POLICY "cert_templates_anon_update"
  ON storage.objects FOR UPDATE
  TO public, anon, authenticated
  USING (bucket_id = 'cert-templates')
  WITH CHECK (bucket_id = 'cert-templates');

DROP POLICY IF EXISTS "cert_templates_anon_delete" ON storage.objects;
CREATE POLICY "cert_templates_anon_delete"
  ON storage.objects FOR DELETE
  TO public, anon, authenticated
  USING (bucket_id = 'cert-templates');

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Verify:
--   SELECT id, name, public, file_size_limit FROM storage.buckets WHERE id = 'cert-templates';
--   SELECT polname FROM pg_policy WHERE polrelid = 'storage.objects'::regclass
--     AND polname LIKE 'cert_templates_%';
-- ============================================================
