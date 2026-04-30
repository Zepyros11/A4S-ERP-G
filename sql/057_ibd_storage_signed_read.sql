-- ============================================================
-- Migration 057: Allow anon role to read ibd-attachments via signed URL
--
-- Why:
--   ERP backend pages (modules/ibd/*) use anon key (no Supabase Auth JWT)
--   — same as the rest of A4S-ERP. The previous policy in 056 only allows
--   `authenticated` role to read; anon couldn't sign URLs to view files.
--
-- Pattern:
--   • Bucket stays PRIVATE (public read disabled)
--   • Anon can SELECT (needed to call /storage/v1/object/sign/...)
--   • Files protected by:
--       - Unguessable path: {form}/{member_code}/{timestamp}_{originalName}
--       - Short-lived signed URLs (default 1 hour)
--   • App-level enforcement via AuthZ.requirePerm('ibd_*_view')
-- ============================================================

DROP POLICY IF EXISTS "ibd_attachments_anon_read" ON storage.objects;
CREATE POLICY "ibd_attachments_anon_read"
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'ibd-attachments');
