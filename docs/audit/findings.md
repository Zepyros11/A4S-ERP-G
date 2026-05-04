# Audit findings — สรุปสิ่งที่พบ

ไฟล์ดิบ: `pages-audit.md` / `pages-audit.json`

## ภาพรวม (79 HTML files)

| Kind | จำนวน |
|---|---:|
| **internal** (หน้า ERP เต็ม shell) | 63 |
| **standalone** (LIFF / kiosk / public — ไม่มี shell โดยตั้งใจ) | 7 |
| **fragment** (modal HTML โหลดผ่าน fetch — ไม่ใช่หน้า) | 2 |
| **portal** (ibd-portal สำหรับลูกค้าภายนอก) | 6 |
| **empty** (ไฟล์ว่าง 0 byte) | 1 |

## ❗ Bug ของจริง (ต้องแก้)

### 1. ไฟล์ว่าง / ไม่ใช้
- `modules/inventory/dashboard.html` — **0 bytes** ลบทิ้งหรือเขียนใหม่

### 2. CSS ซ้ำซ้อน + Dead code (ใหญ่สุด)
- `css/components/modal.css` → **ไม่มี import จากที่ไหนเลย** (40 หน้าใช้ modal markup) แต่ `modal-overlay`/`.modal` มีอยู่ใน `css/core/common.css` แล้ว → `modal.css` คือ dead code
- `css/components/table.css` → ไม่ import เช่นกัน + ซ้ำกับ `common.css` (`.table-wrap`, `.data-table`, `.table-card`, ...)
- `css/components/imageGrid.css` → ไม่ import จาก main.css แต่ 2 หน้า import เอง (event-form, events-place-form) → inconsistent
- ผลลัพธ์: ถ้าใครเปิด modal.css/table.css ไปแก้ จะแก้ผิดที่ — เปลี่ยนแล้วไม่มีผล
- **แนะนำ:** ลบ modal.css + table.css ทิ้ง · ย้าย imageGrid.css เข้า main.css

### 3. native popup (ผิด memory rule "no native popup")
| ไฟล์ | alert | confirm | prompt |
|---|---:|---:|---:|
| modules/settings/db_viewer.html | 6 | 1 | 2 |
| modules/event/event-requests.html | 2 | 0 | 0 |
| modules/event/event-form.html | 1 | 0 | 0 |
| modules/tour/check-seat.html | 0 | 1 | 1 |
| modules/trip/check-seat.html | 0 | 1 | 1 |

→ แทนด้วย `ConfirmModal.open(...)` / `PromptModal.open(...)`

### 4. หน้าที่ Shell ขาด JS สำคัญ
- `modules/manual/manual-view.html` — **ไม่มี modalManager.js** (1 เคสเดียว)
- `modules/settings/db_viewer.html` — **ไม่มี toast + ไม่มี loadingOverlay** (1 เคสเดียว)
- 7 หน้าขาด `authz.js` (ทั้ง list, ดูในรายงานเต็ม)

## ✅ ผ่านแล้ว (consistency แข็งแรง)

ทุกหน้า internal (63/63):
- ✓ import `css/main.css`
- ✓ มี `auth.js`
- ✓ มี `sidebar.js`
- ✓ มี topbar markup
- 62/63 มี `modalManager.js`
- 62/63 มี toast + loadingOverlay

## ⚠️ Drift "นิ่ม" — ตัดสินใจก่อนปรับ

### A. Layout shell 2 แบบ (functionally identical)
- 42 หน้าใช้ `<div class="layout"> <div id="sidebar-container"></div> <div class="content-area"> <div class="page">...`
- 21 หน้าใช้ `<div class="topbar"></div> <div class="page">...` ตรงๆ ไม่มี layout/content-area wrapper

**ค้นพบสำคัญ:** `.layout` และ `.content-area` **ไม่มี CSS rules** (grep ไม่พบใน css/) → แค่ wrapper เปล่าๆ ผลลัพธ์เหมือนกัน 100% → drift ลำดับ cosmetic ไม่ใช่ functional

→ **แนะนำ:** เลือก template แบบหนึ่งแล้วทยอยปรับ ไม่ใช่ urgent

### B. `permissions.js` (50/63 หน้าไม่มี)
- 13 หน้าที่ใส่: ส่วนใหญ่เป็น settings/users, ibd, manual, events-dashboard
- เป็น optional UI gating (hide button by permission)
- → **ตัดสินใจ:** บังคับใส่ทุกหน้า หรือเป็น opt-in?

### C. `date-format.js` (40/63 หน้าไม่มี)
- Memory rule: ทุกหน้าแสดง DD/MM/YYYY + Asia/Bangkok
- 23 หน้าใส่แล้ว · 40 หน้ายังไม่ใส่
- → ถ้าหน้าไหนแสดงวันที่ ควรใส่ — **น่าจะรวมไว้ใน main bundle** (เป็น core helper)

### D. Module CSS naming ไม่สม่ำเสมอ
- บางที่ใช้ relative path `./events.css` บางที่ `events.css` (no prefix)
- บาง folder มี shared module CSS (`events.css`, `procurement.css`) บาง folder ไม่มี

## 💡 ประเด็นเพิ่มเติม (สำหรับ Step 3)

- **fragment pattern เริ่มสับสน** — `inventory/categories-form.html` ดูเหมือนหน้าปกติแต่จริงๆ คือ modal content (โหลดผ่าน fetch) → ควรย้ายไปอยู่ใต้ `modules/<area>/_fragments/` หรือเปลี่ยนเป็น JS template literal เพื่อป้องกันสับสน
- **portal-shared.css separate** — ibd-portal มี style แยกของตัวเองอยู่แล้ว (ใช้ `portal-shared.css` + `portal-config.js` + `portal-shared.js`) → เป็น precedent ที่ดีสำหรับ "customer portal" ที่จะมาใหม่

## 🎨 Visual drift (สำคัญที่สุด — เพิ่มเติม)

ดูดิบ: [`visual-drift.md`](./visual-drift.md)

ปัญหาจริงที่ทำให้ "หน้าแต่ละหน้าหน้าตาคนละแบบ" คือ **ทุก module roll CSS ของตัวเอง** ไม่มี shared visual primitives ใน core CSS

### ตัวเลขชี้ชัด

| Visual concept | ความหลากหลาย (prefix ที่ต่างกัน) |
|---|---:|
| Hero / page header banner | **21 แบบ** (`ds-hero`, `cat-hero`, `ed-hero`, `ibd-hero`, `wp-hero`, `tm-hero`, ...) |
| Page card / panel | **50 แบบ** (`stat-card`, `epg-card`, `pp-card`, `cat-card`, `ibd-card`, ...) |
| Empty state | **38 แบบ** |
| Filter bar / toolbar | **17 แบบ** (มี `.toolbar` ใน core/layout.css อยู่แล้วแต่ใช้น้อยมาก) |
| Stats row / KPI | **13 แบบ** (`ibd-kpi`, `ed-kpi`, `cs-stats`, `sp-stats`, ...) |

### Inline `<style>` ขนาดมหาศาล (root cause)

36 หน้ามี inline `<style>` block · 7 หน้าใหญ่กว่า 15K chars:

| File | inline CSS |
|---|---:|
| modules/trip/check-seat.html | 35,253 |
| modules/tour/check-seat.html | 30,957 |
| modules/event/check-in.html | 17,863 |
| modules/transactions/sales_order/so_form.html | 17,116 |
| modules/dashboard/dashboard.html | 16,592 |
| modules/customer/members-sync.html | 15,917 |
| modules/event/register.html | 15,927 |

→ ทุก visual primitive (hero, card, kpi, empty state) ถูกเขียนซ้ำในแต่ละหน้าด้วย prefix ของตัวเอง

### แนวทางแก้ — เสนอ 3 ขั้น

**Phase 0.5a — เพิ่ม shared visual primitives ใน `core/common.css` (additive, ไม่เสี่ยง):**
- `.page-hero` + `.page-hero--gradient-blue` (default), `.page-hero--simple`, `.page-hero--solid-dark`
  - sub-elements: `.page-hero-title`, `.page-hero-sub`, `.page-hero-actions`
- `.kpi-row` (grid 4 col responsive) + `.kpi-card` + `.kpi-icon` + `.kpi-label` + `.kpi-value` + `.kpi-foot`
- `.empty-state` (รวม icon + title + hint)
- ใช้ `.toolbar` ที่มีอยู่แล้วใน `core/layout.css` เป็น standard

**Phase 0.5b — Pilot migrate 1 หน้า** (เช่น `events-dashboard.html` ที่ user เห็นว่า hero ดีอยู่แล้ว) เพื่อ validate ว่า shared classes ครอบคลุม

**Phase 0.5c — Bulk migrate ทีละ module** (events → ibd → settings → customer → inventory → ...) แทน inline style + per-module prefixes ด้วย shared classes

→ หลังจบ Phase 0.5 ค่อยกลับไปคุย Step 3 (customer portal architecture) จะ inherit ระบบที่สะอาดแล้ว

## ลำดับงานที่แนะนำ (Phase แรก)

| Priority | Task | ประมาณเวลา |
|:-:|---|---|
| 🔥 P0 | ลบ `modal.css`, `table.css` ทิ้ง · ย้าย `imageGrid.css` เข้า `main.css` | 30 นาที |
| 🔥 P0 | เพิ่ม `date-format.js` เป็น core ใน main bundle (หรือใส่ทุกหน้า) | 10 นาที |
| 🔥 P0 | ลบ `inventory/dashboard.html` (empty) | 1 นาที |
| 🔥 P0 | แก้ native popup ทั้ง 5 หน้า | 1-2 ชม. |
| ⚡ P1 | แก้ `manual-view.html` ใส่ modalManager · `db_viewer.html` ใส่ toast/overlay | 30 นาที |
| ⚡ P1 | แก้ 7 หน้า missing authz | 30 นาที |
| 📋 P2 | ออกแบบ + เผยแพร่ Page Template มาตรฐาน → migrate ทั้ง 63 หน้าให้ใช้ shape เดียวกัน | 2-4 ชม. (ถ้าใช้ search/replace) |
| 📋 P2 | ย้าย fragment HTML ไปอยู่ folder แยก (`_fragments/` หรือ JS) | 1 ชม. |
