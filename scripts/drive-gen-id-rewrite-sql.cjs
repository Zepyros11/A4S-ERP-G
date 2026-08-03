/**
 * drive-gen-id-rewrite-sql.cjs — สร้าง SQL เขียน fileId ใหม่ในฐานข้อมูล
 * ────────────────────────────────────────────────────────────────────────────
 * ขั้นที่ 3 ของการย้าย Drive (ต่อจาก drive-upload-to-personal.cjs)
 *
 *   node scripts/drive-gen-id-rewrite-sql.cjs [srcDir]
 *
 * อ่าน id-map.json (fileId เดิม → fileId ใหม่) แล้วเขียน 2 ไฟล์:
 *   sql/183_rewrite_drive_file_ids.sql        — ตัวเขียนจริง (idempotent)
 *   sql/183_rewrite_drive_file_ids_check.sql  — ตรวจก่อน/หลัง (ต้องเหลือ 0)
 *
 * ทำไมต้องมี: ก๊อปไฟล์ข้ามบัญชี Google = ได้ไฟล์ใหม่ **fileId เปลี่ยน**
 * URL ในฐานข้อมูลเก็บเป็น https://<proxy>/drive/file/<fileId> → ถ้าไม่เขียนใหม่
 * รูป/พาสปอร์ต/วีซ่า/ตั๋ว/โปสเตอร์ จะพังทันทีที่ปิด Shared Drive เดิม
 */
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2] || 'D:/@Projects/A4S-backups/drive-20260803';
const map = JSON.parse(fs.readFileSync(path.join(SRC, 'id-map.json'), 'utf8'));
const pairs = Object.entries(map).filter(([o, n]) => o && n && !String(n).startsWith('DRY-'));
if (!pairs.length) { console.error('id-map.json ว่าง (หรือมีแต่ผล DRY_RUN)'); process.exit(1); }

const SQL_DIR = path.join(__dirname, '..', 'sql');
const q = s => `'${String(s).replace(/'/g, "''")}'`;
const stamp = new Date().toISOString().slice(0, 10);

const values = pairs.map(([o, n]) => `  (${q(o)}, ${q(n)})`).join(',\n');

const main = `-- 183_rewrite_drive_file_ids.sql — เขียน Google Drive fileId ใหม่ทั้งฐานข้อมูล
-- ────────────────────────────────────────────────────────────
-- สร้างอัตโนมัติโดย scripts/drive-gen-id-rewrite-sql.cjs (${stamp}) · ${pairs.length} คู่
--
-- บริบท: ย้ายไฟล์จาก Shared Drive \`A4S-ERP-Images\` (Google Workspace)
--   → My Drive ของ a4scontent@gmail.com
-- ก๊อปข้ามบัญชี = ไฟล์ใหม่ → **fileId เปลี่ยนทุกไฟล์** (ต่างจากตอนย้าย proxy ที่ id เดิม)
-- URL ที่เก็บไว้เป็น https://<proxy>/drive/file/<fileId> จึงต้องเขียนใหม่ทั้งหมด
--
-- ⚠️ รัน **หลัง** อัปโหลดครบและตรวจแล้วว่าไฟล์ใหม่เปิดได้
-- ⚠️ idempotent — รันซ้ำได้ (id เดิมหายไปแล้ว การรันรอบสองจะไม่เจออะไร)
-- ตรวจด้วย: sql/183_rewrite_drive_file_ids_check.sql (ก่อนรัน = ${pairs.length} คู่รอ, หลังรัน = 0)

DROP TABLE IF EXISTS _drive_id_map;
CREATE TEMP TABLE _drive_id_map (old_id text PRIMARY KEY, new_id text NOT NULL);

INSERT INTO _drive_id_map (old_id, new_id) VALUES
${values};

DROP TABLE IF EXISTS _drive_rewrite_result;
CREATE TEMP TABLE _drive_rewrite_result (table_name text, column_name text, rows_changed bigint);

-- แทนที่ทุก fileId ที่โผล่ในสตริงเดียว (บางแถวมีหลายรูป เช่น jsonb ของ web_pages)
-- STABLE ไม่ใช่ IMMUTABLE — ฟังก์ชันอ่านตาราง _drive_id_map จึงไม่ immutable จริง
CREATE OR REPLACE FUNCTION pg_temp.remap_drive_ids(s text) RETURNS text
LANGUAGE plpgsql STABLE AS $f$
DECLARE m record; out text := s;
BEGIN
  IF out IS NULL THEN RETURN NULL; END IF;
  FOR m IN SELECT old_id, new_id FROM _drive_id_map LOOP
    IF position(m.old_id IN out) > 0 THEN
      out := replace(out, m.old_id, m.new_id);
    END IF;
  END LOOP;
  RETURN out;
END $f$;

DO $$
DECLARE
  r     record;
  n     bigint;
  total bigint := 0;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name, c.data_type
    FROM information_schema.columns c
    JOIN pg_tables t
      ON t.tablename = c.table_name AND t.schemaname = c.table_schema
    WHERE c.table_schema = 'public'
      AND c.data_type IN ('text', 'character varying', 'jsonb', 'json')
      AND c.is_generated = 'NEVER'          -- generated column แก้ไม่ได้
    ORDER BY c.table_name, c.column_name
  LOOP
    EXECUTE format(
      'UPDATE public.%I SET %I = pg_temp.remap_drive_ids(%I::text)::%s '
      || 'WHERE %I::text LIKE ''%%/drive/file/%%'' '
      || '  AND pg_temp.remap_drive_ids(%I::text) IS DISTINCT FROM %I::text',
      r.table_name, r.column_name, r.column_name,
      CASE r.data_type WHEN 'character varying' THEN 'text' ELSE r.data_type END,
      r.column_name, r.column_name, r.column_name
    );
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      INSERT INTO _drive_rewrite_result VALUES (r.table_name, r.column_name, n);
      total := total + n;
    END IF;
  END LOOP;

  RAISE NOTICE 'รวมทั้งหมด % แถว', total;
END $$;

-- ผลลัพธ์ (RAISE NOTICE มองไม่เห็นใน Supabase SQL Editor จึงคืนเป็นตาราง)
SELECT * FROM _drive_rewrite_result
UNION ALL SELECT 'รวมทั้งหมด', '', COALESCE(sum(rows_changed), 0) FROM _drive_rewrite_result
ORDER BY rows_changed DESC;
`;

const check = `-- 183_rewrite_drive_file_ids_check.sql — นับ fileId เดิมที่ยังค้างอยู่ในฐานข้อมูล
-- สร้างอัตโนมัติโดย scripts/drive-gen-id-rewrite-sql.cjs (${stamp}) · ${pairs.length} คู่
-- ก่อนรัน 183 = ควรเจอ (ตามจำนวนแถวที่ใช้จริง) · หลังรัน = ต้องได้ 0 แถว

DROP TABLE IF EXISTS _drive_id_map_chk;
CREATE TEMP TABLE _drive_id_map_chk (old_id text PRIMARY KEY);
INSERT INTO _drive_id_map_chk (old_id) VALUES
${pairs.map(([o]) => `  (${q(o)})`).join(',\n')};

DROP TABLE IF EXISTS _drive_chk_result;
CREATE TEMP TABLE _drive_chk_result (table_name text, column_name text, rows_stale bigint);

DO $$
DECLARE
  r record; n bigint; total bigint := 0;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN pg_tables t ON t.tablename = c.table_name AND t.schemaname = c.table_schema
    WHERE c.table_schema = 'public'
      AND c.data_type IN ('text', 'character varying', 'jsonb', 'json')
    ORDER BY c.table_name, c.column_name
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM public.%I x WHERE x.%I::text LIKE ''%%/drive/file/%%'''
      || ' AND EXISTS (SELECT 1 FROM _drive_id_map_chk m WHERE position(m.old_id IN x.%I::text) > 0)',
      r.table_name, r.column_name, r.column_name
    ) INTO n;
    IF n > 0 THEN
      INSERT INTO _drive_chk_result VALUES (r.table_name, r.column_name, n);
      total := total + n;
    END IF;
  END LOOP;
  RAISE NOTICE 'ค้างรวม % แถว', total;
END $$;

-- ผลลัพธ์ — **หลังรัน 183 ต้องได้ 0 แถว** (ไม่มีผลลัพธ์เลย = ผ่าน)
SELECT * FROM _drive_chk_result
UNION ALL SELECT 'ค้างรวม', '', COALESCE(sum(rows_stale), 0) FROM _drive_chk_result
ORDER BY rows_stale DESC;
`;

fs.writeFileSync(path.join(SQL_DIR, '183_rewrite_drive_file_ids.sql'), main);
fs.writeFileSync(path.join(SQL_DIR, '183_rewrite_drive_file_ids_check.sql'), check);
console.log(`เขียนแล้ว (${pairs.length} คู่):`);
console.log('  sql/183_rewrite_drive_file_ids.sql');
console.log('  sql/183_rewrite_drive_file_ids_check.sql');
