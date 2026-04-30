-- ============================================================
-- Migration 060: Allow anon DELETE on ibd-attachments storage
--
-- Why:
--   When a staff deletes a row in ibd_complaints / ibd_ewallet_requests
--   from the backend, we cascade-delete the related files in Storage so
--   nothing is orphaned in the bucket.
--
--   Backend uses anon key (no JWT) — same as the rest of A4S-ERP — so
--   the policy must allow `anon` role.
--
-- Risk: anyone with the bucket name + file path can delete files.
--   Acceptable because:
--     • Path includes member_code + timestamp (hard to guess)
--     • Same parity as table DELETE policies (sql/056)
--     • Production deployment hides the delete UI via permissions
-- ============================================================

DROP POLICY IF EXISTS "ibd_attachments_anon_delete" ON storage.objects;
CREATE POLICY "ibd_attachments_anon_delete"
  ON storage.objects
  FOR DELETE
  TO anon, authenticated
  USING (bucket_id = 'ibd-attachments');
