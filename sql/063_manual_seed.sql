-- ============================================================
-- Migration 063: Seed Manual content
-- ============================================================
-- Sample chapters + pages เพื่อให้ผู้ใช้เห็นโครงสร้างก่อน
-- รันได้ครั้งเดียว — ใช้ INSERT ... ON CONFLICT DO NOTHING (slug)
-- หมายเหตุ: คอลัมน์ blocks เก็บเป็น JSONB array โดยตรง (ไม่ใช่ {"blocks":...})
-- ============================================================

-- ── Chapters ────────────────────────────────────────────────
INSERT INTO manual_chapters (slug, title, description, icon, cover_color, sort_order, is_published) VALUES
  ('getting-started', 'เริ่มต้นใช้งาน',
   'ภาพรวมระบบ การเข้าสู่ระบบ และการใช้งานเบื้องต้น',
   '🚀', 'linear-gradient(135deg,#0ea5e9,#6366f1)', 1, TRUE),

  ('event', 'จัดการกิจกรรม (Event)',
   'สร้างกิจกรรม รับลงทะเบียน เช็คอิน และโพสต์ประชาสัมพันธ์',
   '🗓️', 'linear-gradient(135deg,#8b5cf6,#ec4899)', 2, TRUE),

  ('inventory', 'คลังสินค้า (Stock)',
   'จัดหมวดหมู่ คลัง สินค้า สต็อกเริ่มต้น และความเคลื่อนไหว',
   '📦', 'linear-gradient(135deg,#f59e0b,#ef4444)', 3, TRUE),

  ('crm', 'ลูกค้า (MLM)',
   'สมาชิก ผู้แนะนำ MLM Tree และการนำเข้า/sync',
   '🧑', 'linear-gradient(135deg,#10b981,#06b6d4)', 4, TRUE),

  ('cs', 'บริการลูกค้า (CS)',
   'Daily Sale โปรโมชันประจำเดือน และตอบคำถามอัตโนมัติ',
   '🎁', 'linear-gradient(135deg,#dc2626,#f97316)', 5, TRUE),

  ('settings', 'ตั้งค่าระบบ',
   'ผู้ใช้งาน Role สิทธิ์การใช้งาน LINE Bot และ webhook',
   '⚙️', 'linear-gradient(135deg,#7c3aed,#0ea5e9)', 6, TRUE)
ON CONFLICT (slug) DO NOTHING;


-- ── Pages: Getting Started ──────────────────────────────────
WITH ch AS (SELECT id FROM manual_chapters WHERE slug = 'getting-started')
INSERT INTO manual_pages (chapter_id, slug, title, summary, blocks, sort_order, reading_minutes, is_published)
SELECT
  ch.id, p.slug, p.title, p.summary, p.blocks::jsonb, p.sort_order, p.reading_minutes, p.is_published
FROM ch, (VALUES
  (
    'overview', 'ภาพรวมระบบ A4S-ERP', 'ระบบ ERP สำหรับธุรกิจ MLM — เริ่มจากที่นี่',
    $$[
      {"type":"paragraph","text":"A4S-ERP เป็นระบบบริหารจัดการธุรกิจ MLM ที่ครอบคลุมตั้งแต่ **กิจกรรม** **คลังสินค้า** **สมาชิก** ไปจนถึง **บริการลูกค้า** และ **IBD** (International Business Development)"},
      {"type":"heading","level":2,"text":"โมดูลหลัก"},
      {"type":"steps","items":[
        "**Event** — สร้างกิจกรรม รับลงทะเบียน เช็คอิน",
        "**Stock** — จัดการสินค้า คลัง สต็อก",
        "**CRM** — ข้อมูลสมาชิก A4S Tree",
        "**CS** — ขายและบริการลูกค้า",
        "**IBD** — เรื่องร้องเรียน E-Wallet ย้ายฐาน"
      ]},
      {"type":"callout","variant":"tip","title":"💡 เคล็ดลับ","text":"ใช้แถบค้นหาด้านบนของคู่มือเพื่อค้นหาเรื่องที่อยากอ่านได้รวดเร็ว"}
    ]$$::text,
    1, 2, TRUE
  ),
  (
    'login', 'การเข้าสู่ระบบ', 'วิธี Login + การจัดการ session',
    $$[
      {"type":"paragraph","text":"เปิดเบราว์เซอร์แล้วเข้าหน้า login ของระบบ"},
      {"type":"steps","items":[
        "ใส่ชื่อผู้ใช้ (username) ของคุณ",
        "ใส่รหัสผ่าน",
        "กดปุ่ม **เข้าสู่ระบบ**",
        "ระบบจะพาไปที่ Dashboard หรือหน้าแรกตาม role"
      ]},
      {"type":"callout","variant":"warning","text":"หากใส่รหัสผิด 5 ครั้ง ระบบจะระงับการ login ชั่วคราว — ติดต่อ Admin เพื่อปลดล็อก"},
      {"type":"heading","level":3,"text":"การออกจากระบบ"},
      {"type":"paragraph","text":"กดที่รูปโปรไฟล์มุมขวาบน → เลือก **ออกจากระบบ**"}
    ]$$::text,
    2, 3, TRUE
  ),
  (
    'dashboard', 'Dashboard และเมนูหลัก', 'ทำความรู้จักหน้าแรกและการนำทาง',
    $$[
      {"type":"paragraph","text":"Dashboard คือหน้าแรกหลัง login แสดงสรุปข้อมูลและทางลัดไปแต่ละโมดูล"},
      {"type":"heading","level":2,"text":"Sidebar"},
      {"type":"paragraph","text":"แถบเมนูซ้ายมือ — แบ่งเป็นกลุ่ม กดที่หัวกลุ่มเพื่อย่อ/ขยาย"},
      {"type":"callout","variant":"info","text":"เมนูที่คุณเห็น = สิทธิ์ที่ได้รับ Admin สามารถปรับเปลี่ยนได้ที่หน้า **ตั้งค่า → จัดการ Role**"}
    ]$$::text,
    3, 2, TRUE
  )
) AS p(slug, title, summary, blocks, sort_order, reading_minutes, is_published)
ON CONFLICT (chapter_id, slug) DO NOTHING;


-- ── Pages: Event ────────────────────────────────────────────
WITH ch AS (SELECT id FROM manual_chapters WHERE slug = 'event')
INSERT INTO manual_pages (chapter_id, slug, title, summary, blocks, sort_order, reading_minutes, is_published)
SELECT
  ch.id, p.slug, p.title, p.summary, p.blocks::jsonb, p.sort_order, p.reading_minutes, p.is_published
FROM ch, (VALUES
  (
    'create-event', 'สร้างกิจกรรมใหม่', 'จากเมนู Event → รายการกิจกรรม → ＋ เพิ่ม',
    $$[
      {"type":"steps","items":[
        "ไปที่เมนู **กิจกรรม → รายการกิจกรรม**",
        "กดปุ่ม **＋ เพิ่ม** มุมขวาบน",
        "กรอก ชื่อกิจกรรม วันที่ สถานที่ และรายละเอียด",
        "อัปโหลดโปสเตอร์ (สูงสุด 5 ภาพ — ภาพแรกใช้เป็นหลัก)",
        "กด **บันทึก**"
      ]},
      {"type":"callout","variant":"tip","text":"ตั้งสถานะเป็น **DRAFT** ก่อนเสร็จ พอพร้อมเปิดลงทะเบียนแล้วค่อยเปลี่ยนเป็น **PUBLISHED**"}
    ]$$::text,
    1, 4, TRUE
  ),
  (
    'register', 'รับลงทะเบียน', 'วิธีเปิดให้สมาชิกลงทะเบียนผ่าน LIFF/หน้าเว็บ',
    $$[
      {"type":"paragraph","text":"กิจกรรมที่ publish แล้วจะมี QR + ลิงก์ลงทะเบียนอัตโนมัติ"},
      {"type":"heading","level":2,"text":"ช่องทางลงทะเบียน"},
      {"type":"table","headers":["ช่องทาง","ใช้กับ","หมายเหตุ"],"rows":[
        ["LIFF (LINE)","สมาชิกที่เปิดผ่าน LINE OA","Auto-fill ชื่อ/code"],
        ["URL ตรง","สมาชิกที่ไม่ใช้ LINE","ใส่รหัสสมาชิกเอง"],
        ["QR หน้างาน","Walk-in","พนักงานสแกนช่วย"]
      ]}
    ]$$::text,
    2, 3, TRUE
  ),
  (
    'check-in', 'เช็คอินหน้างาน', 'ใช้กล้องสแกน QR หรือกรอกรหัสมือ',
    $$[
      {"type":"steps","items":[
        "เปิดเมนู **กิจกรรม → เช็คอิน**",
        "เลือกกิจกรรม",
        "อนุญาตการเข้าถึงกล้องของเบราว์เซอร์",
        "ส่อง QR ของผู้เข้าร่วม → ระบบเช็คอินอัตโนมัติ"
      ]},
      {"type":"callout","variant":"warning","text":"ถ้าใช้ iOS Safari ครั้งแรกอาจต้อง Reload หน้าหลังอนุญาตกล้อง"}
    ]$$::text,
    3, 2, TRUE
  )
) AS p(slug, title, summary, blocks, sort_order, reading_minutes, is_published)
ON CONFLICT (chapter_id, slug) DO NOTHING;


-- ── Pages: Inventory ────────────────────────────────────────
WITH ch AS (SELECT id FROM manual_chapters WHERE slug = 'inventory')
INSERT INTO manual_pages (chapter_id, slug, title, summary, blocks, sort_order, reading_minutes, is_published)
SELECT
  ch.id, p.slug, p.title, p.summary, p.blocks::jsonb, p.sort_order, p.reading_minutes, p.is_published
FROM ch, (VALUES
  (
    'product-setup', 'ตั้งค่าสินค้า', 'หมวดหมู่ + คลัง + สินค้า — ทำตามลำดับ',
    $$[
      {"type":"callout","variant":"info","text":"ก่อนสร้างสินค้า ต้องสร้าง **หมวดหมู่** และ **คลังสินค้า** ก่อน"},
      {"type":"steps","items":[
        "**หมวดหมู่** — เมนู Stock → ตั้งค่า → หมวดหมู่",
        "**คลังสินค้า** — เมนู Stock → ตั้งค่า → คลังสินค้า",
        "**สินค้า** — เมนู Stock → รายการสินค้า → ＋ เพิ่ม"
      ]}
    ]$$::text,
    1, 3, TRUE
  ),
  (
    'stock-movement', 'ความเคลื่อนไหว Stock', 'รับเข้า/ตัดจ่าย/โอนคลัง',
    $$[
      {"type":"paragraph","text":"การเคลื่อนไหว stock เกิดจาก 3 ทาง:"},
      {"type":"table","headers":["Type","Source","ใช้เมื่อ"],"rows":[
        ["IN","PO รับเข้า","สั่งซื้อจาก supplier"],
        ["OUT","SO/REQ","ขาย / เบิกใช้"],
        ["TRANSFER","คลัง→คลัง","ย้ายระหว่างคลัง"]
      ]},
      {"type":"callout","variant":"tip","text":"การเคลื่อนไหวจะ post อัตโนมัติเมื่อเอกสารถูก approve"}
    ]$$::text,
    2, 4, TRUE
  )
) AS p(slug, title, summary, blocks, sort_order, reading_minutes, is_published)
ON CONFLICT (chapter_id, slug) DO NOTHING;


-- ── Pages: CRM (placeholder) ────────────────────────────────
WITH ch AS (SELECT id FROM manual_chapters WHERE slug = 'crm')
INSERT INTO manual_pages (chapter_id, slug, title, summary, blocks, sort_order, reading_minutes, is_published)
SELECT
  ch.id, p.slug, p.title, p.summary, p.blocks::jsonb, p.sort_order, p.reading_minutes, p.is_published
FROM ch, (VALUES
  (
    'members-overview', 'ภาพรวมสมาชิก', 'รายการสมาชิก + MLM Tree',
    $$[
      {"type":"paragraph","text":"ระบบรองรับสมาชิกแบบ MLM — มีผู้แนะนำเป็น chain"},
      {"type":"heading","level":2,"text":"เมนูที่เกี่ยวข้อง"},
      {"type":"steps","items":[
        "**ข้อมูลสมาชิก** — ค้นหา/แก้ไขข้อมูลสมาชิกแต่ละราย",
        "**MLM Tree View** — ดูโครงสร้างผู้แนะนำเป็นต้นไม้",
        "**Customer Dashboard** — สถิติ KPI สมาชิก"
      ]}
    ]$$::text,
    1, 2, TRUE
  )
) AS p(slug, title, summary, blocks, sort_order, reading_minutes, is_published)
ON CONFLICT (chapter_id, slug) DO NOTHING;


-- ── Pages: CS (placeholder) ─────────────────────────────────
WITH ch AS (SELECT id FROM manual_chapters WHERE slug = 'cs')
INSERT INTO manual_pages (chapter_id, slug, title, summary, blocks, sort_order, reading_minutes, is_published)
SELECT
  ch.id, p.slug, p.title, p.summary, p.blocks::jsonb, p.sort_order, p.reading_minutes, p.is_published
FROM ch, (VALUES
  (
    'daily-sale', 'Daily Sale CS', 'Sync ใบขายประจำวัน + ตรวจบิล',
    $$[
      {"type":"paragraph","text":"โมดูล Daily Sale รับข้อมูลขายจาก **answerforsuccess** อัตโนมัติทุกวัน"},
      {"type":"callout","variant":"info","text":"ดูสถานะการ sync ล่าสุดได้ในหน้า Daily Sale มุมขวาบน"}
    ]$$::text,
    1, 2, TRUE
  )
) AS p(slug, title, summary, blocks, sort_order, reading_minutes, is_published)
ON CONFLICT (chapter_id, slug) DO NOTHING;


-- ── Pages: Settings ─────────────────────────────────────────
WITH ch AS (SELECT id FROM manual_chapters WHERE slug = 'settings')
INSERT INTO manual_pages (chapter_id, slug, title, summary, blocks, sort_order, reading_minutes, is_published)
SELECT
  ch.id, p.slug, p.title, p.summary, p.blocks::jsonb, p.sort_order, p.reading_minutes, p.is_published
FROM ch, (VALUES
  (
    'roles', 'สร้าง Role และกำหนดสิทธิ์', 'ผู้เขียนคู่มือ ผู้ดูแล CS ฯลฯ',
    $$[
      {"type":"paragraph","text":"Role คือชุดของสิทธิ์ (permissions) ที่กำหนดว่าผู้ใช้ทำอะไรได้บ้าง"},
      {"type":"steps","items":[
        "ไปที่ **ตั้งค่า → จัดการ Role**",
        "กด **＋ เพิ่ม** เพื่อสร้าง role ใหม่ (เช่น *ผู้เขียนคู่มือ*)",
        "เลือก permission ที่ต้องการ (เช่น `manual_view`, `manual_edit`)",
        "กด **บันทึก**",
        "ไปที่ **ตั้งค่า → ผู้ใช้งาน** และกำหนด role นี้ให้กับ user"
      ]},
      {"type":"callout","variant":"tip","text":"ตัวอย่าง role *ผู้เขียนคู่มือ* — ให้สิทธิ์ `manual_view` + `manual_edit` + `manual_publish` พอ ไม่ต้องให้ `manual_delete`"}
    ]$$::text,
    1, 4, TRUE
  )
) AS p(slug, title, summary, blocks, sort_order, reading_minutes, is_published)
ON CONFLICT (chapter_id, slug) DO NOTHING;
