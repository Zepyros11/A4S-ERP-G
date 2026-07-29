-- 174_rewrite_supabase_storage_urls.sql — เปลี่ยน host ของ Supabase Storage URL ในฐานข้อมูล
-- ────────────────────────────────────────────────────────────
-- คู่กับ sql/173 (ตัวนั้นแก้ URL ของ ai-proxy/Drive · ตัวนี้แก้ของ Supabase Storage)
--
-- ทำไมต้องมี: ไฟล์บางส่วนยังอยู่ใน Supabase Storage (ไม่ได้ย้ายไป Drive)
--   เช่น โลโก้บริษัท (app_settings.company_logo_url) · โปสเตอร์อีเวนต์ · รูปแคมเปญ
--   URL เก็บเป็น absolute https://<project-ref>.supabase.co/storage/v1/object/public/...
--   → project ref ฝังอยู่ในข้อมูล ตอนย้าย project จึงยังชี้ของเก่า
--   ถ้า pause/ลบ project เก่า รูปพวกนี้จะหายทันทีทั้งที่ไฟล์ถูกก๊อปมาแล้ว
--
-- ต้องรัน scripts/migrate-storage-to-new-project.cjs ให้ไฟล์ครบก่อน (path เดิมเป๊ะ)
--
-- ⚠️ รันบน project ใหม่เท่านั้น · idempotent (รันซ้ำได้)
-- ตรวจก่อน/หลัง: เปลี่ยน old_ref ใน 174_..._check.sql แล้วรัน ต้องได้ 0 แถว

DO $$
DECLARE
  old_host CONSTANT text := 'https://dtiynydgkcqausqktreg.supabase.co';
  new_host CONSTANT text := 'https://egnwfmdsqtxxyhyajnnu.supabase.co';
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
      AND c.is_generated = 'NEVER'
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
