-- ============================================================
-- Migration 135: สร้าง Supabase Storage bucket "company-assets"
--                + เก็บข้อมูลบริษัทใน app_settings (ใช้ร่วมทุกเครื่อง)
--
-- Why:
--   หน้า /modules/settings/settings.html → การ์ด "ข้อมูลบริษัท"
--   เดิมเก็บใน localStorage ของแต่ละเครื่อง → user ใหม่/เปลี่ยนเครื่อง
--   ต้องกรอกใหม่ + อัปโลโก้ไม่ได้  ตอนนี้ย้ายไปเก็บใน DB:
--     • โลโก้  → bucket "company-assets" (public read) → URL ใน app_settings
--     • ข้อมูลข้อความ → app_settings (key/value)
--
--   Filenames: company-assets/logo-{timestamp}.{png|jpg|svg}
--   Public read (URL พร้อมใช้กับ <img>) + anon write/delete
--
-- Idempotent — รันซ้ำได้
-- ============================================================

-- 1) สร้าง bucket (public read)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'company-assets',
  'company-assets',
  true,                               -- public read
  10 * 1024 * 1024,                   -- 10 MB per file
  ARRAY['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2) RLS Policies — ใส่ TO anon, authenticated ชัดเจน
DROP POLICY IF EXISTS "company_assets_public_read" ON storage.objects;
CREATE POLICY "company_assets_public_read"
  ON storage.objects FOR SELECT
  TO public, anon, authenticated
  USING (bucket_id = 'company-assets');

DROP POLICY IF EXISTS "company_assets_anon_write" ON storage.objects;
CREATE POLICY "company_assets_anon_write"
  ON storage.objects FOR INSERT
  TO public, anon, authenticated
  WITH CHECK (bucket_id = 'company-assets');

DROP POLICY IF EXISTS "company_assets_anon_update" ON storage.objects;
CREATE POLICY "company_assets_anon_update"
  ON storage.objects FOR UPDATE
  TO public, anon, authenticated
  USING (bucket_id = 'company-assets')
  WITH CHECK (bucket_id = 'company-assets');

DROP POLICY IF EXISTS "company_assets_anon_delete" ON storage.objects;
CREATE POLICY "company_assets_anon_delete"
  ON storage.objects FOR DELETE
  TO public, anon, authenticated
  USING (bucket_id = 'company-assets');

-- 3) Seed key ข้อมูลบริษัทใน app_settings (ว่างไว้ — กรอกผ่านหน้า settings)
--    app_settings(key PK, value, description) มีอยู่แล้ว (migration 023)
INSERT INTO app_settings (key, value, description) VALUES
  ('company_name',        '', 'ชื่อบริษัท (ไทย) — แสดงในใบสั่งซื้อ/ใบขาย/เอกสาร'),
  ('company_name_en',     '', 'Company name (English)'),
  ('company_tax_id',      '', 'เลขประจำตัวผู้เสียภาษี 13 หลัก'),
  ('company_address',     '', 'ที่อยู่บริษัท (ไทย)'),
  ('company_address_en',  '', 'Company address (English)'),
  ('company_phone',       '', 'เบอร์โทรศัพท์'),
  ('company_email',       '', 'อีเมลติดต่อ'),
  ('company_website',     '', 'เว็บไซต์'),
  ('company_logo_url',    '', 'URL โลโก้บริษัท (bucket company-assets)')
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- Verify:
--   SELECT id, name, public, file_size_limit FROM storage.buckets WHERE id = 'company-assets';
--   SELECT key, value FROM app_settings WHERE key LIKE 'company_%';
-- ============================================================
