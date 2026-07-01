# A4S-ERP — System Overview & Master Index

> เอกสารชุดนี้อธิบาย **ทั้งระบบ** ของ A4S-ERP เพื่อให้ผู้อ่าน (รวมถึง AI assistant) เข้าใจสถาปัตยกรรม โครงสร้างโมดูล ฐานข้อมูล และบริการเบื้องหลังได้อย่างครบถ้วน
> อัปเดต: 2026-06-30 · สร้างจากการสำรวจ source code จริง (`modules/`, `js/`, `sql/`, `ai-proxy/`, `scripts/`, `.github/`)

---

## 1. ระบบนี้คืออะไร

A4S-ERP คือระบบ ERP/CRM ภายในองค์กรของ **A4S CAN Corporation** (ธุรกิจ MLM / network marketing + อีเวนต์ + ทัวร์) ครอบคลุมงาน:

- **สมาชิก MLM (Members/CRM)** — ฐานข้อมูลสมาชิก ~100k+ คน, ผังสายงาน (tree), การเชื่อม LINE
- **อีเวนต์ (Event)** — จัดงาน/สัมมนา, ลงทะเบียนผู้เข้าร่วม, เช็คอิน, งบประมาณ, ประชาสัมพันธ์ (FB/LINE)
- **แคมเปญรีวิว (Campaign)** + **แบบประเมิน (Survey)**
- **ทริป/ทัวร์ (Trip)** — จัดที่นั่ง, ห้องพัก, รถบัส, ไฟลท์, ทีมงาน, เอกสาร, พอร์ทัลตั๋ว
- **คลังสินค้า & เอกสาร (Inventory/Transactions)** — สินค้า, สต็อก, PO/SO/เบิก, Petty Cash, Supplier
- **บริการลูกค้า (CS)** — Daily Sale, โปรโมชัน/Catalog
- **IBD** — งานบริการสมาชิกต่างประเทศ (แอฟริกา) แทน Google Forms 3 ฟอร์ม
- **Operations Hub** — โมดูลรวม Trip+Event เป็น "program" เดียว (forward-only)
- **ระบบกลาง** — ผู้ใช้/สิทธิ์ (permission), แจ้งเตือน (LINE + กระดิ่ง), คู่มือ, dev tools

---

## 2. Tech Stack (สรุปสั้น)

| ชั้น | เทคโนโลยี | หมายเหตุ |
|------|-----------|----------|
| Frontend | **Vanilla JS (ES6)** + HTML + CSS | ไม่มี build tool / ไม่มี framework — โหลด `<script>` ตรงๆ |
| Hosting (frontend) | **GitHub Pages** | `BASE_PATH` auto-detect สำหรับ `github.io` |
| Database/API | **Supabase** (PostgreSQL + PostgREST + Storage) | เรียก REST API ตรงจาก browser ด้วย anon key |
| Backend proxy | **Node.js (Express)** บน **Render.com** | `ai-proxy/server.js` — LINE API, cron, OCR |
| Automation | **GitHub Actions** (cron) + **Playwright** | sync members/daily-sale, cron แจ้งเตือน |
| External APIs | **LINE Messaging API**, **Facebook Graph API**, **Anthropic Claude** (OCR) | ผ่าน ai-proxy |
| Data source | **answerforsuccess.com** | ระบบ MLM ต้นทาง (browser automation ดึงข้อมูล) |

**สถาปัตยกรรม 3 ชั้น:**
```
Browser (GitHub Pages, Vanilla JS)
   │  REST (anon key + RLS)
   ▼
Supabase (PostgreSQL + PostgREST + Storage)
   ▲  service_role key (admin)
   │
ai-proxy (Node/Express บน Render) ──► LINE API / FB Graph / Claude / answerforsuccess.com
   ▲
   │  cron (x-cron-secret)
GitHub Actions (sync + notify + keep-alive)
```

---

## 3. โครงสร้างไดเรกทอรี (root)

```
A4S-ERP-G/
├── index.html              # redirect → login.html
├── login.html              # หน้า login (ตรวจ password กับตาราง users ฝั่ง client)
├── modules/                # ทุกหน้าฟีเจอร์ แยกตามโดเมน (ดูข้อ 5)
├── js/
│   ├── core/               # โครงสร้างพื้นฐาน (auth, authz, supabase, line, notify, i18n, ...)
│   ├── components/         # UI ส่วนกลาง (modal, navigation/sidebar+topbar, table, ui)
│   ├── shared/             # catalog กลาง (attendee-fields, pax-fields, program-tools, stock-fields)
│   └── utils/              # bahtText.js, lineCronPing.js
├── css/
│   ├── core/               # theme, layout, responsive (design tokens)
│   ├── components/         # buttons, forms, card, ...
│   ├── shared/             # assign-2pane.css ฯลฯ
│   └── main.css            # entry รวม
├── sql/                    # 189 migration files (001 → 164+) เรียงตามลำดับ
├── ai-proxy/               # Node proxy (server.js + render.yaml)
├── scripts/                # sync-members, sync-daily-sale, audit-*, setup-line-richmenu, ...
├── docs/                   # เอกสาร (รวมโฟลเดอร์ system/ นี้)
└── .github/workflows/      # GitHub Actions (cron jobs)
```

---

## 4. แผนผัง Navigation (Sidebar) — โครงทั้งระบบ

> นิยามจริงอยู่ที่ [js/components/navigation/sidebar.js](../../js/components/navigation/sidebar.js) (`MENU` array) แต่ละเมนูผูก permission key ผ่าน `ID_TO_PERM`

| กลุ่ม (group) | เมนู (items) | path หลัก | perm |
|---------------|--------------|-----------|------|
| **ภาพรวม** | Dashboard | `dashboard/dashboard.html` | `dashboard_view` |
| **Operations** | Operations Hub | `operations/operations-hub.html` | `program_view` |
| **กิจกรรม (Event)** | Poster Gallery, Event Dashboard, รายการกิจกรรม, งบประมาณ, แผนงาน, ตารางโพสต์ FB, ตารางโพสต์ LINE, ประเภทกิจกรรม, สถานที่, จัดการหลักสูตร, เทมเพลตฟอร์มลงทะเบียน, แบบประเมิน, พิมพ์ป้าย&ใบประกาศ | `event/*` | `events_view`, `poster_view`, `evt_budget_view`, `media_fb_view`, `line_promote_view`, ... |
| **แคมเปญ (Campaign)** | Dashboard แคมเปญ, วางแผนแคมเปญ | `event/campaign-*` | `campaign_view` |
| **คลังสินค้า (Stock)** | Stock Dashboard, Stock สินค้า, Stock Report, รายการสินค้า, ความเคลื่อนไหว, หมวดหมู่, หน่วยนับ, คลังสินค้า, Stock เริ่มต้น | `inventory/*` | `product_view`, `inv_cat_view`, `units_view`, `warehouse_view`, `stock_init_view`, `stock_move_view` |
| **เอกสาร** | รายการสั่งซื้อ (PO), ใบขาย (SO), รายการเบิกสินค้า (REQ), Petty Cash | `transactions/*` | `po_view`, `so_view`, `req_view`, `petty_cash_view` |
| **ลูกค้า (CRM)** | Customer Dashboard, ข้อมูลสมาชิก (A4S), A4S Tree View, สมาชิกที่เชื่อม LINE | `customer/*` | `member_view`, `customer_dashboard_view`, `members_tree_view`, `line_members_view` |
| **ซัพพลายเออร์** | ข้อมูล Supplier | `supplier/suppliers.html` | `supplier_view` |
| **บริการลูกค้า (CS)** | Daily Sale, Catalog ประจำเดือน, จัดการโปรโมชัน, แผนงาน | `customer-service/*`, `work-plan/*` | `daily_sale_view`, `view_promotions`, `cs_wp_view` |
| **IBD** | IBD Dashboard, เรื่องร้องเรียน/ติดตาม, ขอโอน E-Wallet, ย้าย Location Base | `ibd/*` | `ibd_dashboard_view`, `ibd_complaints_view`, `ibd_ewallet_view`, `ibd_relocation_view` |
| **ทริป (Trip)** | รายการทริป, เอกสาร | `trip/*` | `trip_list_view`, `trip_docs_view` |
| **คู่มือ** | คู่มือการใช้งาน | `manual/manual-list.html` | `manual_view` |
| **รายงาน** | รายงาน Stock | `report/reports.html` | `report_stock_view` |
| **ตั้งค่า** | ตั้งค่าระบบ, ตั้งค่าบริษัท, Database Viewer, ผู้ใช้งาน, ส่งข้อความพนักงาน, ตอบกลับอัตโนมัติ, กฎแจ้งเตือน LINE, กฎแจ้งเตือนกระดิ่ง, เหตุการณ์แจ้งเตือน, กลุ่มพนักงาน, จัดการ Role | `settings/*` | `sys_settings_view`, `db_viewer_view`, `users_view`, `roles_view` |
| **Dev Tool** | Web Automation, Step Wizard, ตั้งค่า Automation, System Health Check, Test Members, Component Library | `dev-tool/*` | `devtool_view`, `devtool_manage` |

> หมายเหตุ: ผู้ใช้ role `ADMIN` เข้าถึง **ทุกเมนูอัตโนมัติ** (all-access) ไม่ขึ้นกับ perms ที่เก็บใน DB — โมดูลใหม่จะโผล่เองโดยไม่ต้องติ๊กสิทธิ์

---

## 5. ดัชนีเอกสาร (อ่านต่อ)

| ไฟล์ | เนื้อหา |
|------|---------|
| [01-ARCHITECTURE.md](01-ARCHITECTURE.md) | สถาปัตยกรรม frontend, auth/authz, design system, การ bootstrap หน้า, core modules |
| [02-DATABASE.md](02-DATABASE.md) | สคีมาฐานข้อมูลครบ (~90 ตาราง) แยกตามโดเมน + views + migrations สำคัญ |
| [03-EVENT-CAMPAIGN-SURVEY.md](03-EVENT-CAMPAIGN-SURVEY.md) | โดเมน Event, การลงทะเบียน/เช็คอิน, FB/LINE scheduler, Campaign, Survey |
| [04-TRIP-OPERATIONS.md](04-TRIP-OPERATIONS.md) | โดเมน Trip/Tour, room/bus/flight assign, docs, ticket portal + Operations Hub |
| [05-INVENTORY-TRANSACTIONS.md](05-INVENTORY-TRANSACTIONS.md) | คลังสินค้า, สต็อก, PO/SO/REQ, Petty Cash, Supplier |
| [06-CRM-CS-IBD.md](06-CRM-CS-IBD.md) | สมาชิก MLM, Tree, LINE binding, Daily Sale, โปรโมชัน, IBD + IBD Portal |
| [07-SETTINGS-NOTIFICATIONS-MISC.md](07-SETTINGS-NOTIFICATIONS-MISC.md) | สิทธิ์/ผู้ใช้/role, แจ้งเตือน LINE+กระดิ่ง, Work Plan, Manual, Dev Tool, Dashboard |
| [08-BACKEND-AUTOMATION.md](08-BACKEND-AUTOMATION.md) | ai-proxy endpoints, scripts sync, GitHub Actions, deployment, security |

เอกสารเดิมที่เกี่ยวข้อง: [ER-diagram.md](../ER-diagram.md) (Mermaid ER), [DFD.md](../DFD.md), [database.txt](../database.txt)

---

## 6. หลักการ/แพทเทิร์นสำคัญที่ใช้ทั้งระบบ (cross-cutting)

1. **ไม่มี backend route สำหรับ CRUD** — ทุกหน้าเรียก Supabase REST ตรงด้วย `sbFetch()` helper ของแต่ละหน้า (อ่าน `sb_url`/`sb_key` จาก localStorage)
2. **Permission 3 ระดับ** — page guard (`AuthZ.requirePerm`), DOM-level (`data-perm`), code-level (`AuthZ.hasPerm`); ADMIN = all-access
3. **Soft link ด้วย `member_code`** — ตารางที่อ้างถึงสมาชิกใช้ TEXT ไม่ใช่ FK (เพราะ members เป็น snapshot ที่ sync ใหม่เรื่อยๆ)
4. **เข้ารหัสฝั่ง client** — `password_encrypted`, `national_id_encrypted` (AES-GCM) ถอดด้วย master key จาก `app_settings` (สิทธิ์ `member_decrypt`)
5. **วันที่ DD/MM/YYYY + Asia/Bangkok** เสมอ (`DateFmt`); เก็บใน DB เป็น ISO
6. **Modal ส่วนกลาง** — `ConfirmModal`/`DeleteModal`/`PromptModal` (ห้าม native confirm/alert); ESC ปิดผ่าน `modalManager.js`; form modal ปิดได้แค่ X/ESC (ไม่ปิดเมื่อคลิกนอกกรอบ)
7. **Toast** — class `toast-{type}`
8. **อัปโหลดรูปต้อง compress** ก่อน (`ImageCompressor` 1600px JPEG q0.82)
9. **Design system** — Sage Green palette, design tokens ใน `css/core/theme.css`, desktop zoom 0.65
10. **i18n** — `I18n` + `data-i18n` + ไฟล์ `*.lang.js` ต่อหน้า (pilot: custom-report, IBD portal EN/FR)
