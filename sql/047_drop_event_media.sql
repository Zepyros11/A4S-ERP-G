-- ============================================================
-- Migration 047: Drop event_media (Production tracking ไม่ใช้แล้ว)
-- ============================================================
-- หน้า media-schedule ตัด tab "งาน Media" ออก เหลือแค่ FB Schedule
-- → drop column FK ใน fb_scheduled_posts ก่อน → drop table event_media
-- ============================================================

-- 1) ตัด FK column ใน fb_scheduled_posts
ALTER TABLE fb_scheduled_posts
  DROP COLUMN IF EXISTS source_media_id;

-- 2) Drop index + table
DROP INDEX IF EXISTS idx_fb_posts_media;
DROP TABLE IF EXISTS event_media CASCADE;

-- ============================================================
-- DONE ✅
-- หมายเหตุ: ไฟล์ใน Supabase Storage bucket event-files/media/
--          จะกลายเป็น orphan — ลบเองผ่าน Storage Browser ได้
-- Test:
--   SELECT to_regclass('public.event_media');     -- คืน null = drop แล้ว
--   \d fb_scheduled_posts                          -- ไม่มี source_media_id แล้ว
-- ============================================================
