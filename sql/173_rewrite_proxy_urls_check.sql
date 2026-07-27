-- 173_rewrite_proxy_urls_check.sql — นับ URL ที่ยังชี้ proxy เก่า (read-only)
-- ใช้คู่กับ sql/173_rewrite_proxy_urls.sql — รันก่อนและหลังเพื่อเทียบ
-- ก่อนรัน 173: ควรเจอหลายร้อยแถว · หลังรัน: ต้องได้ 0 แถว

select table_name, column_name, cnt
from (
  select c.table_name, c.column_name,
    (xpath('/row/c/text()', query_to_xml(
      format('select count(*) c from public.%I where %I::text like ''%%a4s-erp-proxy.onrender.com%%''',
             c.table_name, c.column_name),
      false, true, '')))[1]::text::bigint as cnt
  from information_schema.columns c
  join pg_tables t
    on t.tablename = c.table_name and t.schemaname = c.table_schema
  where c.table_schema = 'public'
    and c.data_type in ('text', 'character varying', 'jsonb', 'json')
) x
where cnt > 0
order by cnt desc;
