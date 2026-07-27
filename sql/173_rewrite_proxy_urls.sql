-- 173_rewrite_proxy_urls.sql — เปลี่ยน hostname ของ ai-proxy ในทุก URL ที่เก็บในฐานข้อมูล
-- ────────────────────────────────────────────────────────────
-- ทำไมต้องมี: รูป/ไฟล์ที่ย้ายไป Google Drive แล้ว เก็บ URL เป็น absolute
--   https://<proxy>/drive/file/<fileId>
-- (ประกอบตอนอัปโหลดจาก env PUBLIC_PROXY_URL) → hostname ของ proxy ฝังอยู่ในข้อมูล
--
-- ตอนย้ายไปบัญชีบริษัท (docs/MIGRATION-2026-08.md) proxy เปลี่ยนเครื่อง
-- ถ้าไม่รันไฟล์นี้ ระบบใหม่จะยังวิ่งผ่าน proxy เก่าของบัญชีส่วนตัว
-- → วันที่ปิดบัญชีนั้น พาสปอร์ต/วีซ่า/ตั๋ว/โปสเตอร์/รูปสินค้า พังหมด
--   (ไฟล์จริงไม่หาย ยังอยู่ใน Drive — แค่ URL ชี้ไปเครื่องที่ตายแล้ว)
--
-- fileId ไม่เปลี่ยน → proxy ใหม่ที่ใช้ service account เดิม เสิร์ฟไฟล์เดิมได้ทันที
--
-- ⚠️ รันบน project **ใหม่** เท่านั้น · idempotent (รันซ้ำได้ ไม่มีผลข้างเคียง)
-- ⚠️ แก้ new_host ให้ตรงชื่อ Render service จริงก่อนรัน
--
-- ตรวจก่อน/หลังด้วย: sql/173_rewrite_proxy_urls_check.sql

DO $$
DECLARE
  old_host CONSTANT text := 'https://a4s-erp-proxy.onrender.com';
  new_host CONSTANT text := 'https://a4s-erp-proxy-new.onrender.com';
  r     record;
  n     bigint;
  total bigint := 0;
BEGIN
  IF old_host = new_host THEN
    RAISE EXCEPTION 'old_host กับ new_host เหมือนกัน — ยังไม่ได้แก้ค่า';
  END IF;

  FOR r IN
    SELECT c.table_name, c.column_name, c.data_type
    FROM information_schema.columns c
    JOIN pg_tables t
      ON t.tablename = c.table_name AND t.schemaname = c.table_schema
    WHERE c.table_schema = 'public'
      AND c.data_type IN ('text', 'character varying', 'jsonb', 'json')
      AND c.is_generated = 'NEVER'          -- ข้าม generated column (UPDATE ไม่ได้)
    ORDER BY c.table_name, c.column_name
  LOOP
    EXECUTE format(
      'UPDATE public.%I SET %I = replace(%I::text, %L, %L)::%s WHERE %I::text LIKE %L',
      r.table_name, r.column_name, r.column_name, old_host, new_host,
      CASE r.data_type WHEN 'character varying' THEN 'text' ELSE r.data_type END,
      r.column_name, '%' || old_host || '%'
    );
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      RAISE NOTICE '  % . %  → % แถว', r.table_name, r.column_name, n;
      total := total + n;
    END IF;
  END LOOP;

  RAISE NOTICE 'รวมทั้งหมด % แถว', total;
END $$;
