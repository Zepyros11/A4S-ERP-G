-- 172_storage_policies.sql — RLS policies บน storage.objects / storage.buckets
-- ────────────────────────────────────────────────────────────
-- ทำไมต้องมีไฟล์นี้: pg_dump --schema=public ไม่ครอบ schema storage
-- ตอนย้าย project (docs/MIGRATION-2026-08.md) policy ชุดนี้จึงหายไปทั้งหมด
-- snapshot ถอดจาก project เดิม 2026-07-27 — ใช้ตั้ง project ใหม่ให้พฤติกรรมเหมือนเดิมเป๊ะ
--
-- ⚠️ `allow_storage_all` (ALL / public / true) เปิดกว้างสุด → policy อื่นที่เหลือแทบไม่มีผล
--    และ policy ของ bucket ที่ลบไปแล้ว (product-images, tour-seat-images, promotion-files
--    ย้ายไป Google Drive แล้ว) เป็น dead weight — ลบทิ้งได้ถ้าจะทำความสะอาด

DROP POLICY IF EXISTS "Allow delete product images" ON storage.objects;
CREATE POLICY "Allow delete product images" ON storage.objects AS PERMISSIVE FOR DELETE TO public USING ((bucket_id = 'product-images'::text));

DROP POLICY IF EXISTS "Allow upload product images" ON storage.objects;
CREATE POLICY "Allow upload product images" ON storage.objects AS PERMISSIVE FOR INSERT TO public WITH CHECK ((bucket_id = 'product-images'::text));

DROP POLICY IF EXISTS "Auth upload" ON storage.objects;
CREATE POLICY "Auth upload" ON storage.objects AS PERMISSIVE FOR INSERT TO public WITH CHECK ((bucket_id = 'tour-seat-images'::text));

DROP POLICY IF EXISTS "Public read" ON storage.objects;
CREATE POLICY "Public read" ON storage.objects AS PERMISSIVE FOR SELECT TO public USING ((bucket_id = 'tour-seat-images'::text));

DROP POLICY IF EXISTS "Public read event-files" ON storage.objects;
CREATE POLICY "Public read event-files" ON storage.objects AS PERMISSIVE FOR SELECT TO public USING ((bucket_id = 'event-files'::text));

DROP POLICY IF EXISTS "Public read product images" ON storage.objects;
CREATE POLICY "Public read product images" ON storage.objects AS PERMISSIVE FOR SELECT TO public USING ((bucket_id = 'product-images'::text));

DROP POLICY IF EXISTS "allow_all_promotion_files 1gym85p_0" ON storage.objects;
CREATE POLICY "allow_all_promotion_files 1gym85p_0" ON storage.objects AS PERMISSIVE FOR SELECT TO public USING ((bucket_id = 'promotion-files'::text));

DROP POLICY IF EXISTS "allow_all_promotion_files 1gym85p_1" ON storage.objects;
CREATE POLICY "allow_all_promotion_files 1gym85p_1" ON storage.objects AS PERMISSIVE FOR INSERT TO public WITH CHECK ((bucket_id = 'promotion-files'::text));

DROP POLICY IF EXISTS "allow_all_promotion_files 1gym85p_2" ON storage.objects;
CREATE POLICY "allow_all_promotion_files 1gym85p_2" ON storage.objects AS PERMISSIVE FOR DELETE TO public USING ((bucket_id = 'promotion-files'::text));

DROP POLICY IF EXISTS allow_storage_all ON storage.objects;
CREATE POLICY allow_storage_all ON storage.objects AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS cert_templates_anon_delete ON storage.objects;
CREATE POLICY cert_templates_anon_delete ON storage.objects AS PERMISSIVE FOR DELETE TO public USING ((bucket_id = 'cert-templates'::text));

DROP POLICY IF EXISTS cert_templates_anon_update ON storage.objects;
CREATE POLICY cert_templates_anon_update ON storage.objects AS PERMISSIVE FOR UPDATE TO public USING ((bucket_id = 'cert-templates'::text)) WITH CHECK ((bucket_id = 'cert-templates'::text));

DROP POLICY IF EXISTS cert_templates_anon_write ON storage.objects;
CREATE POLICY cert_templates_anon_write ON storage.objects AS PERMISSIVE FOR INSERT TO public WITH CHECK ((bucket_id = 'cert-templates'::text));

DROP POLICY IF EXISTS cert_templates_public_read ON storage.objects;
CREATE POLICY cert_templates_public_read ON storage.objects AS PERMISSIVE FOR SELECT TO public USING ((bucket_id = 'cert-templates'::text));

DROP POLICY IF EXISTS company_assets_anon_delete ON storage.objects;
CREATE POLICY company_assets_anon_delete ON storage.objects AS PERMISSIVE FOR DELETE TO public USING ((bucket_id = 'company-assets'::text));

DROP POLICY IF EXISTS company_assets_anon_update ON storage.objects;
CREATE POLICY company_assets_anon_update ON storage.objects AS PERMISSIVE FOR UPDATE TO public USING ((bucket_id = 'company-assets'::text)) WITH CHECK ((bucket_id = 'company-assets'::text));

DROP POLICY IF EXISTS company_assets_anon_write ON storage.objects;
CREATE POLICY company_assets_anon_write ON storage.objects AS PERMISSIVE FOR INSERT TO public WITH CHECK ((bucket_id = 'company-assets'::text));

DROP POLICY IF EXISTS company_assets_public_read ON storage.objects;
CREATE POLICY company_assets_public_read ON storage.objects AS PERMISSIVE FOR SELECT TO public USING ((bucket_id = 'company-assets'::text));

DROP POLICY IF EXISTS ibd_attachments_anon_delete ON storage.objects;
CREATE POLICY ibd_attachments_anon_delete ON storage.objects AS PERMISSIVE FOR DELETE TO anon, authenticated USING ((bucket_id = 'ibd-attachments'::text));

DROP POLICY IF EXISTS ibd_attachments_anon_insert ON storage.objects;
CREATE POLICY ibd_attachments_anon_insert ON storage.objects AS PERMISSIVE FOR INSERT TO anon, authenticated WITH CHECK ((bucket_id = 'ibd-attachments'::text));

DROP POLICY IF EXISTS ibd_attachments_anon_read ON storage.objects;
CREATE POLICY ibd_attachments_anon_read ON storage.objects AS PERMISSIVE FOR SELECT TO anon, authenticated USING ((bucket_id = 'ibd-attachments'::text));

DROP POLICY IF EXISTS ibd_attachments_authenticated_read ON storage.objects;
CREATE POLICY ibd_attachments_authenticated_read ON storage.objects AS PERMISSIVE FOR SELECT TO authenticated USING ((bucket_id = 'ibd-attachments'::text));

