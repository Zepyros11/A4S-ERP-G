-- ============================================================
-- Migration 171: Website Builder — web_pages
--
-- Why:
--   หน้า "จัดการหน้าเว็บ" (modules/media/) ต้องเก็บหน้าเว็บเป็น "ข้อมูล" ไม่ใช่ HTML
--   blocks = JSONB array ของ block ตาม contract ใน js/shared/web-blocks.js
--   เช่น [{"id":"b1","type":"nav_bar","props":{...}}, ...]
--   → editor ลากสลับลำดับ = สลับลำดับ array เฉยๆ
--   → renderer (js/shared/web-render.js) แปลง array นี้เป็น HTML ทั้ง editor และเว็บจริง
--   → เปลี่ยน theme ทีหลังไม่ต้องแตะข้อมูลนี้เลย (นี่คือเหตุผลที่แยก content ออกจาก markup)
--
--   status: draft = เห็นเฉพาะใน ERP · published = เว็บสาธารณะ (web-view.html) แสดง
--   is_home: หน้าเดียวที่เปิดโดยไม่ต้องใส่ ?slug=
--
--   ไม่ใช้ RLS — สอดคล้องกับตารางอื่นที่ anon เข้าถึงได้ (campaigns/events/survey_forms)
--   หมายเหตุ: ERP login เป็น custom (users table) ไม่ใช่ Supabase Auth → ทุก request
--   เป็น role anon ทั้งหมด ถ้าเปิด RLS แบบ "anon อ่านได้เฉพาะ published" editor จะอ่าน
--   draft ไม่ได้ทันที · เนื้อหาเป็นข้อมูลการตลาด ไม่ใช่ PII จึงรับความเสี่ยงนี้ได้
--
--   สำคัญ: Supabase เปิด RLS ให้ตารางใหม่ใน schema public อัตโนมัติ
--   "ไม่สั่งเปิด" ≠ "ปิด" — RLS ที่เปิดแต่ไม่มี policy = ปฏิเสธทุก SELECT/INSERT ของ anon
--   (SQL Editor รันด้วย role postgres ซึ่ง bypass RLS จึงดูเหมือนสำเร็จ แต่หน้าเว็บพัง)
--   → ต้องสั่ง DISABLE ROW LEVEL SECURITY ให้ชัดเจน (ข้อ 3)
--
-- Idempotent — รันซ้ำได้
-- ============================================================

-- ── 1. web_pages ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS web_pages (
  id          BIGSERIAL PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL,          -- ใช้ใน URL: web-view.html?slug=home
  title       TEXT NOT NULL,                 -- ชื่อหน้า (แสดงใน ERP + <title>)
  blocks      JSONB NOT NULL DEFAULT '[]',   -- array ของ block ตาม contract
  status      TEXT NOT NULL DEFAULT 'draft', -- draft | published
  is_home     BOOLEAN NOT NULL DEFAULT false,
  updated_by  TEXT,                          -- users.full_name ตอนกดบันทึก
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- status ต้องเป็น 1 ใน 2 ค่า (idempotent — เช็คก่อน add)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'web_pages_status_chk'
  ) THEN
    ALTER TABLE web_pages
      ADD CONSTRAINT web_pages_status_chk CHECK (status IN ('draft', 'published'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_web_pages_status ON web_pages (status, id);
CREATE INDEX IF NOT EXISTS idx_web_pages_slug   ON web_pages (slug);

-- ── 2. หน้าแรกเริ่มต้น — seed จาก design A4S Academy Portal ──
--    ใส่เฉพาะตอนยังไม่มี slug='home' (รันซ้ำไม่ทับของที่แก้ไปแล้ว)
INSERT INTO web_pages (slug, title, status, is_home, blocks)
SELECT 'home', 'หน้าแรก — A4S Academy', 'published', true, '[
  {"id":"b_header","type":"site_header","props":{
    "brand":"A4S","brandAccent":"Academy","tagline":"Make a Life, Not Just a Living!",
    "langs":[{"code":"ไทย","active":"1"},{"code":"EN","active":""},{"code":"FR","active":""}]}},
  {"id":"b_nav","type":"nav_bar","props":{
    "items":[{"label":"หน้าแรก","active":"1"},{"label":"ข่าวสาร","active":""},{"label":"สินค้า","active":""},
             {"label":"กิจกรรม","active":""},{"label":"บทเรียนออนไลน์","active":""},{"label":"ดาวน์โหลด","active":""}],
    "ctaText":"สมัครเป็นสปอนเซอร์ →"}},
  {"id":"b_ticker","type":"ticker","props":{
    "label":"ข่าวเด่น",
    "text":"ผู้นำต้องเริ่มก่อนเสมอ · คลื่นลูกใหม่แห่งอนาคต · การเป็นสปอนเซอร์มืออาชีพ (ภาค 3)"}},
  {"id":"b_hero","type":"hero_news","props":{
    "sectionTitle":"ข่าวหลัก","sidebarTitle":"หมวดหมู่ข่าว","image":"","category":"ธุรกิจ",
    "title":"People Join People — สร้างเครือข่ายที่เริ่มจากความสัมพันธ์ ไม่ใช่แค่ตัวเลข",
    "excerpt":"แนวคิดการเป็นผู้นำที่คนรุ่นใหม่ควรรู้ ก่อนจะก้าวเข้าสู่โลกของธุรกิจขายตรงอย่างมืออาชีพ",
    "meta":"admin · มิถุนายน 21, 2025",
    "items":[
      {"category":"ธุรกิจ","title":"โอกาสที่มองไม่เห็นด้วยตา แต่รู้สึกได้ด้วยใจ","image":""},
      {"category":"ผลิตภัณฑ์","title":"ดูแลสุขภาพของคุณด้วยรอยัล ออยล์ ทุกวัน","image":""},
      {"category":"กิจกรรม","title":"พาวเวอร์พอยต์ท่องเที่ยวเยอรมนี 2026","image":""},
      {"category":"การท่องเที่ยว","title":"ตามล่าแสงเหนือ ณ ออโรร่า","image":""}]}},
  {"id":"b_products","type":"product_grid","props":{
    "title":"สินค้า & ผลิตภัณฑ์","linkText":"ดูทั้งหมด →",
    "items":[
      {"title":"ผลิตภัณฑ์เพื่อการเกษตร 4Tree","image":""},
      {"title":"รอยัล ออยล์ ดูแลสุขภาพ","image":""},
      {"title":"ผลิตภัณฑ์กลุ่ม 4Life","image":""},
      {"title":"กาแฟอะโลฮ่า ซี","image":""}]}},
  {"id":"b_events","type":"event_lessons","props":{
    "leftTitle":"กิจกรรม & อีเวนต์","rightTitle":"บทเรียนออนไลน์",
    "events":[
      {"day":"01","month":"ต.ค.","title":"Reward Trip ท่องเที่ยวเยอรมนี 2026","sub":"สำหรับผู้นำระดับ Ultimate Leaders"},
      {"day":"22","month":"มิ.ย.","title":"ตามล่าแสงเหนือ ณ ออโรร่า","sub":"ทริปพิเศษสำหรับสมาชิก A4S"}],
    "lessons":[
      {"title":"สไลด์บรรยาย 4Tree โดย อ. โก พัสกร","sub":"บทเรียน · 12 นาที","image":""},
      {"title":"คู่มือการใช้ 4Tree พร้อมกับ Booster","sub":"บทเรียน · 18 นาที","image":""}]}},
  {"id":"b_downloads","type":"download_grid","props":{
    "title":"ดาวน์โหลด & สื่อ","linkText":"ประเภทไฟล์ทั้งหมด →",
    "items":[
      {"type":"PDF","title":"เอกสาร & โบรชัวร์","sub":"อัปเดต ก.ค. 18, 2025"},
      {"type":"PPT","title":"รวมไฟล์นำเสนอ","sub":"อัปเดต มิ.ย. 20, 2025"},
      {"type":"IMG","title":"รวมภาพต่างๆ","sub":"อัปเดต มิ.ย. 20, 2025"},
      {"type":"VDO","title":"วิดีโอต่างๆ","sub":"อัปเดต มิ.ย. 20, 2025"}]}},
  {"id":"b_cta","type":"cta_banner","props":{
    "title":"พร้อมเริ่มธุรกิจกับ A4S แล้วหรือยัง?",
    "sub":"รับข่าวสาร ค้นหาข้อมูล และสมัครเป็นสปอนเซอร์เข้าบริษัทได้ในที่เดียว",
    "primaryText":"สมัครเป็นสปอนเซอร์","secondaryText":"ติดต่อทีม"}},
  {"id":"b_footer","type":"site_footer","props":{
    "brand":"A4S","brandAccent":"Academy",
    "about":"แหล่งรวมข่าวสาร ธุรกิจ สินค้า และสื่อของ A4S สำหรับลูกค้าและผู้สนใจร่วมธุรกิจ",
    "cols":[
      {"title":"เมนู","links":"ข่าวสาร, สินค้า, กิจกรรม, บทเรียนออนไลน์"},
      {"title":"แหล่งข้อมูล","links":"ดาวน์โหลด, โบรชัวร์, ไฟล์นำเสนอ, วิดีโอ"},
      {"title":"ติดต่อ","links":"สมัครเป็นสปอนเซอร์, ติดต่อทีมงาน, ไทย / EN / FR"}]}}
]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM web_pages WHERE slug = 'home');

-- ── 3. ปิด RLS ให้ชัดเจน (ดูข้อ Why) ────────────────────────
--    Supabase เปิดให้อัตโนมัติตอน CREATE TABLE → ถ้าไม่ปิด anon จะโดนบล็อกทุก query
ALTER TABLE web_pages DISABLE ROW LEVEL SECURITY;

-- ── 4. Grant — anon อ่าน/เขียนได้ ───────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON web_pages TO anon;
GRANT USAGE, SELECT ON SEQUENCE web_pages_id_seq TO anon;

-- Test:
--   -- 1) RLS ต้องปิด — ควรได้ rowsecurity = false
--   SELECT relname, relrowsecurity AS rls_on
--     FROM pg_class WHERE relname = 'web_pages';
--
--   -- 2) ข้อมูล seed — ควรได้ home / published / true / 9
--   SELECT id, slug, title, status, is_home, jsonb_array_length(blocks) AS n_blocks
--     FROM web_pages;
--
--   -- 3) anon ต้องอ่านเห็น (จำลอง role เดียวกับหน้าเว็บ) — ควรได้ 1 แถว
--   SET ROLE anon;
--   SELECT count(*) FROM web_pages;
--   RESET ROLE;
