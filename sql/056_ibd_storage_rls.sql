-- ============================================================
-- Migration 056: Storage RLS policies for ibd-attachments bucket
--
-- Why:
--   Members log in via MLM password (NOT Supabase Auth) → frontend uses
--   anon key only. We need RLS that allows anon role to:
--     • INSERT files into ibd-attachments/* (uploads from public portal)
--   But NOT to:
--     • SELECT/READ files (private; staff use service_role to issue signed URLs)
--     • DELETE/UPDATE files
--
-- Path convention: {form}/{member_code}/{timestamp}_{filename}
-- ============================================================

-- Allow anon role to upload to ibd-attachments
DROP POLICY IF EXISTS "ibd_attachments_anon_insert" ON storage.objects;
CREATE POLICY "ibd_attachments_anon_insert"
  ON storage.objects
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (bucket_id = 'ibd-attachments');

-- Allow authenticated (staff) to read all files
DROP POLICY IF EXISTS "ibd_attachments_authenticated_read" ON storage.objects;
CREATE POLICY "ibd_attachments_authenticated_read"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'ibd-attachments');

-- ============================================================
-- Allow anon role to INSERT into the 3 IBD form tables
--   (RLS for table data; uploads above are RLS for storage)
-- ============================================================

ALTER TABLE ibd_complaints           ENABLE ROW LEVEL SECURITY;
ALTER TABLE ibd_ewallet_requests     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ibd_relocation_requests  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ibd_countries            ENABLE ROW LEVEL SECURITY;

-- ── ibd_countries: anon read (lookup ใช้ใน portal)
DROP POLICY IF EXISTS "ibd_countries_anon_read" ON ibd_countries;
CREATE POLICY "ibd_countries_anon_read"
  ON ibd_countries FOR SELECT
  TO anon, authenticated
  USING (active = true);

-- ── ibd_complaints: anon insert + authenticated full access
DROP POLICY IF EXISTS "ibd_complaints_anon_insert" ON ibd_complaints;
CREATE POLICY "ibd_complaints_anon_insert"
  ON ibd_complaints FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "ibd_complaints_auth_all" ON ibd_complaints;
CREATE POLICY "ibd_complaints_auth_all"
  ON ibd_complaints FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

-- ── ibd_ewallet_requests
DROP POLICY IF EXISTS "ibd_ewallet_anon_insert" ON ibd_ewallet_requests;
CREATE POLICY "ibd_ewallet_anon_insert"
  ON ibd_ewallet_requests FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "ibd_ewallet_auth_all" ON ibd_ewallet_requests;
CREATE POLICY "ibd_ewallet_auth_all"
  ON ibd_ewallet_requests FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

-- ── ibd_relocation_requests
DROP POLICY IF EXISTS "ibd_relocation_anon_insert" ON ibd_relocation_requests;
CREATE POLICY "ibd_relocation_anon_insert"
  ON ibd_relocation_requests FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "ibd_relocation_auth_all" ON ibd_relocation_requests;
CREATE POLICY "ibd_relocation_auth_all"
  ON ibd_relocation_requests FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

-- ============================================================
-- Note: The backend pages (modules/ibd/*) use anon key from localStorage
-- (sb_key) — same as other ERP modules. Currently other tables don't
-- use RLS (relying on auth at app level). The "auth_all" policies above
-- accept role 'authenticated' which is what Supabase assigns when a
-- valid JWT is present. If your backend uses anon key (no JWT), you
-- may need to either (a) pass an authenticated JWT, or
-- (b) add policies for 'anon' role for SELECT/UPDATE on these tables.
--
-- ⚠️ FOR NOW: anon role can SELECT/UPDATE these tables too, since the
-- backend uses anon key. We add anon SELECT/UPDATE/DELETE policies to
-- keep parity with the rest of the ERP (which doesn't use RLS).
-- ============================================================

DROP POLICY IF EXISTS "ibd_complaints_anon_all" ON ibd_complaints;
CREATE POLICY "ibd_complaints_anon_all"
  ON ibd_complaints FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "ibd_complaints_anon_update" ON ibd_complaints;
CREATE POLICY "ibd_complaints_anon_update"
  ON ibd_complaints FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "ibd_complaints_anon_delete" ON ibd_complaints;
CREATE POLICY "ibd_complaints_anon_delete"
  ON ibd_complaints FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ibd_ewallet_anon_all" ON ibd_ewallet_requests;
CREATE POLICY "ibd_ewallet_anon_all"
  ON ibd_ewallet_requests FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "ibd_ewallet_anon_update" ON ibd_ewallet_requests;
CREATE POLICY "ibd_ewallet_anon_update"
  ON ibd_ewallet_requests FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "ibd_ewallet_anon_delete" ON ibd_ewallet_requests;
CREATE POLICY "ibd_ewallet_anon_delete"
  ON ibd_ewallet_requests FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "ibd_relocation_anon_all" ON ibd_relocation_requests;
CREATE POLICY "ibd_relocation_anon_all"
  ON ibd_relocation_requests FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "ibd_relocation_anon_update" ON ibd_relocation_requests;
CREATE POLICY "ibd_relocation_anon_update"
  ON ibd_relocation_requests FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "ibd_relocation_anon_delete" ON ibd_relocation_requests;
CREATE POLICY "ibd_relocation_anon_delete"
  ON ibd_relocation_requests FOR DELETE TO anon, authenticated USING (true);
