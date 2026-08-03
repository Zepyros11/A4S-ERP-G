# Website Builder (โมดูล MEDIA) — เอกสารระบบฉบับเต็ม

> **เอกสารนี้คืออะไร:** คำอธิบายทั้งระบบของเครื่องมือสร้างเว็บไซต์บริษัทใน A4S-ERP
> ตั้งแต่หลักคิด · โครงสร้างข้อมูล · สัญญาระหว่างไฟล์ · กลไกในตัว editor · กฎเหล็ก · กับดักที่เคยเหยียบ
> ไปจนถึงวิธียกระบบนี้ไปใช้ในโปรเจกต์อื่น
>
> **ใครควรอ่าน:** Claude Code ที่จะมาแก้/ต่อยอดโมดูลนี้ · ทีม/โปรเจกต์อื่นที่จะ cowork หรือลอกสถาปัตยกรรมนี้ไปใช้
>
> **เอกสารคู่กัน:**
> - [WEBSITE-BUILDER-AI-BRIEF.md](WEBSITE-BUILDER-AI-BRIEF.md) — บรีฟสั้นสำหรับ AI ฝั่ง "วางแผน" ที่ไม่เห็นโค้ดจริง (ใช้เขียน task)
> - เอกสารฉบับนี้ = ฉบับ "เห็นโค้ดจริง" ใช้ลงมือแก้
>
> อัปเดตล่าสุด: 2026-08-01 · สถานะ: Phase 1 + โมเดล container ซ้อนชั้น เสร็จและใช้งานจริง

---

## สารบัญ

1. [ระบบนี้คืออะไร · ขอบเขต](#1-ระบบนี้คืออะไร--ขอบเขต)
2. [หลักคิดแกนกลาง (อ่านก่อนทุกอย่าง)](#2-หลักคิดแกนกลาง-อ่านก่อนทุกอย่าง)
3. [แผนที่ไฟล์](#3-แผนที่ไฟล์)
4. [โครงสร้างข้อมูล](#4-โครงสร้างข้อมูล)
5. [Block Contract — catalog กลาง](#5-block-contract--catalog-กลาง)
6. [Field types ทั้งหมด](#6-field-types-ทั้งหมด)
7. [Renderer — blocks → HTML](#7-renderer--blocks--html)
8. [Editor — เครื่องมือแก้ไข](#8-editor--เครื่องมือแก้ไข)
9. [หน้า Public](#9-หน้า-public)
10. [รูปภาพ & Storage](#10-รูปภาพ--storage)
11. [สิทธิ์ · RLS · ความปลอดภัย](#11-สิทธิ์--rls--ความปลอดภัย)
12. [วิธีต่อยอด (สูตรสำเร็จ)](#12-วิธีต่อยอด-สูตรสำเร็จ)
13. [กฎเหล็ก & กับดักที่เคยเหยียบ](#13-กฎเหล็ก--กับดักที่เคยเหยียบ)
14. [ของที่ยังไม่มี / ยังไม่เสร็จ](#14-ของที่ยังไม่มี--ยังไม่เสร็จ)
15. [ยกไปใช้ในโปรเจกต์อื่น — checklist](#15-ยกไปใช้ในโปรเจกต์อื่น--checklist)

---

## 1. ระบบนี้คืออะไร · ขอบเขต

โมดูล **สื่อ (Media)** ใน A4S-ERP = ระบบสร้างและควบคุมเว็บไซต์บริษัท (A4S Academy) จากในหลังบ้าน ERP
ผู้ใช้ฝ่ายการตลาดสร้างหน้าเว็บได้เองด้วยการลากบล็อกมาวาง โดยไม่ต้องแตะโค้ดและไม่ต้อง deploy

**3 หน้าจอหลัก**

| หน้า | ไฟล์ | หน้าที่ |
|---|---|---|
| จัดการหน้าเว็บ | [web-pages.html](../modules/media/web-pages.html) + [.js](../modules/media/web-pages.js) | รายการหน้าเว็บ · ชื่อ/URL/สถานะ/หน้าแรก · สร้าง/ลบ |
| แก้ไขหน้าเว็บ | [web-editor.html](../modules/media/web-editor.html) + [.js](../modules/media/web-editor.js) + [.css](../modules/media/web-editor.css) | canvas ลากวาง · แผงตั้งค่า · แผงเลเยอร์ |
| เว็บสาธารณะ | [web-view.html](../modules/media/web-view.html) + [.js](../modules/media/web-view.js) | หน้าเว็บจริงที่คนนอกเห็น (ไม่ต้อง login) |

**เมนูอีก 2 ตัวในกลุ่ม MEDIA ยังเป็นหน้าเปล่า (stub)** — [web-content.html](../modules/media/web-content.html) (เนื้อหา/บทความ) และ [web-settings.html](../modules/media/web-settings.html) (ตั้งค่าเว็บไซต์) มีแค่ empty-state "อยู่ระหว่างพัฒนา" + `AuthZ.requirePerm` เท่านั้น

**ไฟล์อ้างอิงดีไซน์:** [website-preview.html](../modules/media/website-preview.html) = หน้าตาต้นฉบับแบบ static ไม่ผูก DB เก็บไว้เทียบว่าที่ render ออกมาตรงกับที่ออกแบบไว้ไหม

---

## 2. หลักคิดแกนกลาง (อ่านก่อนทุกอย่าง)

### 2.1 หน้าเว็บ = ข้อมูล ไม่ใช่ HTML

หน้าเว็บถูกเก็บเป็น **JSON array ของ block** ใน `web_pages.blocks` (JSONB) ไม่ได้เก็บ HTML
เหตุผล: อยากเปลี่ยน theme/หน้าตาทั้งเว็บทีหลังโดยไม่ต้องแก้ข้อมูลของทุกหน้า และไม่ต้องสร้างหน้าซ้ำต่อ theme

### 2.2 Renderer เดียว ใช้ทั้ง editor และหน้า public

[js/shared/web-render.js](../js/shared/web-render.js) เป็นตัวเดียวที่แปลง blocks → HTML
- `web-editor.js` เรียกมันวาด canvas
- `web-view.js` เรียกมันวาดหน้าจริง

**แก้ HTML ที่นี่ที่เดียว = canvas กับเว็บจริงเปลี่ยนพร้อมกันเสมอ** ไม่มีทางหลุดจากกัน

### 2.3 `wrap` callback — กลไกที่ทำให้ editor ไม่ต้องรู้จักโครงสร้าง block เลย

```js
WebRender.page(blocks, wrap)
```
`wrap(node, html)` = ฟังก์ชันของ "คนเรียก" ที่ได้โอกาสห่อ HTML ของ **ทุก node ทุกชั้น** ก่อนส่งออก

- หน้า public **ไม่ส่ง** `wrap` → ได้ HTML สะอาด ไม่มีของ editor ปน
- editor **ส่ง** `wrap` → ได้กรอบเลือก + ปุ่ม ▲▼⧉✕ + ที่จับลากขอบ ครบทุกชั้นอัตโนมัติ

**ผลลัพธ์: เพิ่ม container ชนิดใหม่ ไม่ต้องแตะโค้ด editor เลย** — renderer วาดลูกด้วย `renderList(children, wrap)` ตัวเดิม

### 2.4 Contract คือแหล่งความจริงเดียว

[js/shared/web-blocks.js](../js/shared/web-blocks.js) เก็บ "สัญญา" ของทุก block: ชนิด · หมวด · ภาพจำลอง · รายการ field · ค่า default
Editor **ไม่มีโค้ดวาดแผงตั้งค่าของ block ไหนเป็นการเฉพาะ** — มันอ่าน `fields` แล้วสร้าง UI ให้อัตโนมัติ

> เพิ่ม field ใหม่ 1 บรรทัดใน contract → แผงตั้งค่ามีช่องนั้นขึ้นมาเอง (ต้องไปเพิ่มการใช้งานใน renderer ด้วยถึงจะมีผลกับหน้าตา)

### 2.5 นี่ไม่ใช่ React/Vue

ไม่มี build step · ไม่มี component ที่รับ props แล้ว `onChange` · เป็น vanilla JS + template string ล้วน
โหลดผ่าน `<script>` ธรรมดา (classic script ไม่ใช่ module) ทุกอย่างแขวนบน `window.WebBlocks` / `window.WebRender`

---

## 3. แผนที่ไฟล์

```
js/shared/
  web-blocks.js     892 บรรทัด  Block Contract — catalog กลาง (18 ชนิด) + defaults + field schema
                                 + helper เดินต้นไม้ (find/syncColumns/newBlock/withDefaults)
  web-render.js     522 บรรทัด  Renderer เดียว blocks→HTML + sanitizer + bindCarousels

modules/media/
  web-pages.html/.js            รายการหน้าเว็บ (CRUD ข้อมูลหน้า ไม่ใช่เนื้อหา)
  web-editor.html               โครง 3 แผง (เครื่องมือ/ตั้งค่า · canvas · เลเยอร์) + โมดัลเลือกเลย์เอาต์
  web-editor.js    2511 บรรทัด  ตรรกะ editor ทั้งหมด
  web-editor.css   1287 บรรทัด  หน้าตา editor + guide/drop-line/handle ต่างๆ
  web-view.html/.js             หน้า public (ไม่โหลด auth.js โดยตั้งใจ)
  web-view-config.js            anon key สำหรับหน้า public (คนนอกไม่มี localStorage)
  web-content.html              stub
  web-settings.html             stub
  website-preview.html          design reference (static)

sql/
  171_web_pages.sql             schema + seed หน้าแรก 9 blocks + DISABLE RLS + GRANT anon
                                ⚠️ ต้องรันมือใน Supabase SQL Editor

js/core/
  config.js                     SUPABASE_URL/KEY + DRIVE_PROXY + DRIVE_BUCKETS (มี web-images)
  permissions.js:106-125        นิยาม perm กลุ่ม website
  imageCompressor.js            uploadViaRest (ตัดสิน Drive vs Supabase Storage จากชื่อ bucket)

js/components/navigation/
  sidebar.js:174-200            เมนูกลุ่ม "สื่อ (Media)"
  sidebar.js:613-615            map เมนู → perm
```

### ลำดับการโหลด script (สำคัญ)

หน้า editor:
```
config.js → auth.js → authz.js → date-format.js → imageCompressor.js
→ permissions.js → AuthZ.requirePerm("web_pages_view")
→ web-blocks.js → web-render.js → web-editor.js
→ topbar (module) → sidebar.js → modalManager.js → confirmModal.js
```
หน้า public (สั้นมากโดยตั้งใจ):
```
web-view-config.js → web-blocks.js → web-render.js → web-view.js
```
> หน้า public **ห้ามโหลด `auth.js` / `sidebar.js`** — จะเด้งไป login ทันที

---

## 4. โครงสร้างข้อมูล

### 4.1 ตาราง `web_pages`

```sql
CREATE TABLE web_pages (
  id          BIGSERIAL PRIMARY KEY,
  slug        TEXT UNIQUE NOT NULL,          -- URL: web-view.html?slug=home
  title       TEXT NOT NULL,                 -- ชื่อหน้า + <title>
  blocks      JSONB NOT NULL DEFAULT '[]',   -- array ของ node
  status      TEXT NOT NULL DEFAULT 'draft', -- draft | published (มี CHECK constraint)
  is_home     BOOLEAN NOT NULL DEFAULT false,
  updated_by  TEXT,                          -- users.full_name ตอนกดบันทึก
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);
```
index: `(status, id)` และ `(slug)`

**ไม่มีตาราง/endpoint แยกต่อ component** — ทุกอย่างอยู่ใน `blocks` ก้อนเดียว

### 4.2 รูปทรงของ node

**node ทุกตัวหน้าตาเหมือนกันหมด** ไม่ว่าจะเป็น container หรือใบไม้:

```jsonc
{
  "id": "b7k2m9x",        // สุ่ม "b" + base36 7 ตัว
  "type": "section",      // ต้องตรงกับ type ใน CATALOG
  "props": { },           // flat object เท่านั้น — ห้าม nested
  "children": [ ]         // เฉพาะ container (section / column)
}
```

**`props` ต้อง flat เสมอ** เช่น `{ brand:"A4S", brandSize:30, brandColor:"#16240f" }`
ห้ามรื้อเป็น `{ brand: { text, size, color } }` — หน้าที่บันทึกไว้แล้วจะเปิดไม่ขึ้น

### 4.3 โมเดล container ซ้อนชั้น

```
Section  →  Cell(column)  →  [ Section → Cell ] × N  →  Element
```

- **section** = แถบเต็มความกว้าง กลายเป็น CSS grid · `children` = ช่อง (cell)
- **column** (ชื่อที่ผู้ใช้เห็น = "ช่อง"/Cell) = ช่องในกริด · `children` = element หรือ section ย่อย
  - ไม่อยู่ใน palette · เกิดจาก section เท่านั้น · **ลบ/เลื่อน/ทำซ้ำเดี่ยวไม่ได้**
- **element** (`scope: "element"`) = ใบไม้ ไม่มีลูก · ลากลงได้เฉพาะใน cell

**เพดานความลึก:** `MAX_NEST = 6` ที่ [web-editor.js:648](../modules/media/web-editor.js#L648) — `cellCanNest()` เป็นคนบังคับ
เหตุผลที่ต้องมีเพดาน: ลึกเกินไป responsive คุมไม่ไหว (ไม่รู้ว่าอะไรควรยุบก่อน) + breadcrumb/ต้นไม้เลเยอร์ยาวจนอ่านไม่ออก

**กฎเหล็กของ cell:** ช่องหนึ่งเป็นได้อย่างเดียว — "เป็นที่อยู่ของกริดย่อย" **หรือ** "เป็นที่วาง element" ห้ามปน
(ถ้าปนได้ จะมีของลอยอยู่ใต้กริดย่อยในช่องเดียวกัน อ่านไม่ออกว่าอยู่ชั้นไหน และเล็งวางพลาดตลอด)

### 4.4 จำนวนช่องผูกกับกริด

```
จำนวน cell = จำนวนคอลัมน์ × จำนวนแถว  (+1 ถ้าเปิด headRow)
```
บังคับโดย `WebBlocks.syncColumns(section)` — เพิ่มคอลัมน์ = ต่อช่องว่าง · ลดคอลัมน์ = **ย้ายของในช่องที่หายไปมารวมกับช่องสุดท้าย** (ห้ามตัดทิ้งเงียบๆ)

`layout` เก็บเป็น **สตริงสัดส่วน** ไม่ใช่จำนวนคอลัมน์: `"2-1"` = 2fr 1fr · รับทศนิยม (`"1.4-0.6"`) จากการลากขอบ · แต่ละท่อน clamp 0.2–6 · สูงสุด 4 คอลัมน์

`headRow` = ช่องแรกพาดเต็มความกว้าง ทำโดยตั้ง `spanX` ของช่องแรก = จำนวนคอลัมน์ (ไม่ต้องแก้ renderer เลย)

### 4.5 ส่วนกลางของเว็บ (Global chrome)

header/เมนู/footer เหมือนกันทุกหน้า → **เก็บเป็นแถวเดียวในตาราง `web_pages` เดิม** โดยจอง slug ขึ้นต้นด้วย `_`

```js
LAYOUT_SLUGS = { header: "_layout_header", footer: "_layout_footer" }
isSystemSlug(slug) → slug.startsWith("_")
```
- เวลาแสดงผลจริง: `header ส่วนกลาง + blocks ของหน้านั้น + footer ส่วนกลาง` (ทำใน [web-view.js:50-54](../modules/media/web-view.js#L50-L54))
- ใน editor แถวส่วนกลางถูกวาดเป็น "ตัวล็อกหัว-ท้าย canvas" (`#chromeTop` / `#chromeBottom`) — เห็นได้ แก้ที่นั่นไม่ได้ กดที่ป้ายเพื่อกระโดดไปแก้
- เปิดแถวส่วนกลางด้วย `web-editor.html?slug=_layout_header`
- ยังไม่มีแถวส่วนกลาง = ไม่มีอะไรโผล่ หน้าทำงานเหมือนเดิมทุกอย่าง (ออกแบบให้ค่อยๆ ย้ายได้)

> ⚠️ **ช่องโหว่ที่ยังค้าง** — ดูข้อ [14](#14-ของที่ยังไม่มี--ยังไม่เสร็จ): ยังไม่มี UI/SQL ที่สร้างแถว `_layout_*` และ [web-pages.js](../modules/media/web-pages.js) ยังไม่กรอง `isSystemSlug` ออกจากรายการ

---

## 5. Block Contract — catalog กลาง

### 5.1 รูปทรงของ block definition

```js
{
  type: "el_text",            // id ของชนิด — ต้องไม่ซ้ำ · ใช้เป็น key ทุกที่
  group: "element",           // หมวดใน palette — ต้องตรงกับ key ใน GROUPS ไม่งั้นไม่โผล่
  sub: "ข้อความ",              // หมวดย่อย (ชั้น 2 ของ palette)
  scope: "element",           // มี = ลากลงได้เฉพาะใน cell · ไม่มี = วางระดับหน้า
  label: "ข้อความ",
  icon: "🅃",
  wire: "<svg .../>",         // ภาพจำลอง 120×44 โชว์ใน palette
  container: true,            // มีลูก — editor จะวาด children + รับการวางของ
  makeChildren: true,         // สร้าง children ตั้งแต่เกิด
  presets: [ { key, label, props, wire } ],   // แตกเป็นการ์ดหลายใบใน palette
  fields: [ ... ],            // schema ของแผงตั้งค่า
  defaults: { ... },          // ค่าเริ่มต้นทุก key
}
```

**`wire` = wireframe SVG ไม่ใช่ block จริงย่อส่วน** — ย่อ 1200px เหลือ 250px = scale 0.2 ตัวอักษรเหลือ 3px กลายเป็นรอยเปื้อน · วาด wireframe ที่ 120×44 ให้เห็น "โครง" ชัด
มีตัวสร้างอัตโนมัติ 2 ตัว: `gridWire(layout, rows, ...)` (วาดจากสัดส่วนจริง) และ `txtWire(bars, accent)` (แท่งแทนตัวอักษร)

**`presets` = ชุดค่าที่ทับลง props ตอนสร้าง** — กลไกเดียวกันทุกชนิด: กริดใช้เลือกคอลัมน์/แถว · ข้อความใช้เลือกย่อหน้า/หัวข้อใหญ่ · หัวข้อใช้เลือกแบบเส้นเน้น
แนวคิด: **"เลือกแบบตั้งแต่ตอนหยิบ"** ไม่ใช่วางแล้วค่อยไปไล่ตั้งค่าทีละอัน

### 5.2 หมวด (GROUPS)

| key | ชื่อ | ไอคอน | มีอะไร |
|---|---|---|---|
| `element` | องค์ประกอบ (Elements) | 🧩 | ข้อความ · รูป · หัวข้อ · สไลด์ · ปุ่ม (11 การ์ด) |
| `layout` | โครงสร้าง (Structure) | 🧱 | กริด 11 แบบ · ส่วนหัว · เมนู · เว้นระยะ · เส้นคั่น · ส่วนท้าย (16 การ์ด) |
| `content` | เนื้อหา (Content) | 📰 | แถบข่าวเด่น · ข่าวหลัก (2) |
| `list` | รายการข้อมูล | 🔲 | สินค้า · กิจกรรม+บทเรียน · ดาวน์โหลด (3) |
| `cta` | Call to Action | 🎯 | แบนเนอร์ CTA (1) |

### 5.3 catalog ทั้งหมด (18 ชนิด)

#### กลุ่มโครงสร้าง

| type | ชื่อ | props สำคัญ |
|---|---|---|
| `section` | แถบ + คอลัมน์ | `layout` `rows` `rowH` `headRow` `gap` `vAlign` `bg` `maxWidth` `padY` `padX` |
| `column` | ช่อง (Cell) — ไม่อยู่ใน palette | `spanX` `spanY` `w` `minH` `align` `vAlign` `pad` `gap` `bg` `radius` |
| `site_header` | ส่วนหัว (โลโก้+ภาษา) | `logo` `logoLink` `brand*` `brandAccent`/`accent*` `tagline*` `showLangs` `langs[]` `logoPos` `bgColor` `height` `showBorder` `sticky` `shrinkOnScroll` `hideMobile` |
| `nav_bar` | แถบเมนู | `items[]{label,active,link}` `ctaItems[]{label,enabled,link}` (+`ctaText` legacy) |
| `spacer` | ตัวเว้นระยะ | `height` `mobileHeight` |
| `divider` | เส้นคั่น | `lineStyle` `thickness` `color` `width` `spacing` |
| `site_footer` | ส่วนท้าย | `brand` `brandAccent` `about` `cols[]{title,links}` |

`section` มี 11 preset: `1x1` `1-1x1` `1-1x2` `1-1-1x1` `1-1-1x2` `1-1-1-1x1` `2-1x1` `1-2-1x1` + แบบมีแถวหัว `1-1x1h` `1-1x2h` `1-1-1x1h`
(รหัส preset = `"<layout>x<rows>[h]"`)

#### กลุ่มองค์ประกอบ (element — ลงได้เฉพาะใน cell)

| type | ชื่อ | props สำคัญ | presets |
|---|---|---|---|
| `el_text` | ข้อความ | `text` `size` `weight` `color` `align` `lh` | ย่อหน้า · หัวข้อใหญ่ · หัวข้อรอง · คำโปรย · ตัวเล็ก |
| `el_image` | รูปภาพ | `src` `alt` `link` `ratio` `width` `radius` `align` | — |
| `el_heading` | หัวข้อเซกชัน | `text` `rightText` `rightLink` `size` `weight` `color` `upper` `underline` `lineColor` `lineWeight` `rule` | หัวข้อ+ขีดเน้น · หัวข้อ+ลิงก์ขวา · หัวข้อเปล่า |
| `el_carousel` | สไลด์ภาพ | `heading` `headingSize/Upper/Line/LineColor` `slides[]{image,title,meta,link}` `ratio` `radius` `overlay` `titleSize` `shade` `shadeHeight` `auto` `interval` `arrows` `arrowPos` `dots` | — |
| `el_button` | ปุ่ม | `label` `link` `variant` `bg` `fg` `size` `radius` `align` | — |

#### กลุ่มเนื้อหา / รายการ / CTA (บล็อกสำเร็จรูปยุคแรก — เป็นแถบเต็มความกว้างตายตัว)

| type | ชื่อ | props สำคัญ |
|---|---|---|
| `ticker` | แถบข่าวเด่น | `label` `text` |
| `hero_news` | ข่าวหลัก + หมวดหมู่ | `sectionTitle` `sidebarTitle` `image` `category` `title` `excerpt` `meta` `items[]` |
| `product_grid` | กริดสินค้า 4 ช่อง | `title` `linkText` `items[]{title,image}` |
| `event_lessons` | กิจกรรม + บทเรียน 2 คอลัมน์ | `leftTitle` `rightTitle` `events[]` `lessons[]` |
| `download_grid` | กริดดาวน์โหลด | `title` `linkText` `items[]{type,title,sub}` |
| `cta_banner` | แบนเนอร์ CTA | `title` `sub` `primaryText` `secondaryText` |

> บล็อกสำเร็จรูปกลุ่มนี้เกิดก่อนโมเดล section/cell — หน้าตาตายตัว ปรับแต่งได้น้อย
> **ของใหม่ควรสร้างด้วย section + element แทน** (ยืดหยุ่นกว่ามาก) แต่ห้ามลบของเก่าเพราะหน้าที่บันทึกไว้ยังใช้อยู่

### 5.4 API ของ `window.WebBlocks`

| ฟังก์ชัน | ทำอะไร |
|---|---|
| `CATALOG` / `GROUPS` / `LAYOUTS` / `PRESETS` / `SIZE_PRESETS` | ข้อมูลดิบ |
| `LAYOUT_SLUGS` / `isSystemSlug(slug)` | ส่วนกลางของเว็บ |
| `CHROME_TYPES` | `["site_header","nav_bar","site_footer"]` — ไว้ตรวจว่าหน้ามีของที่ควรย้ายไปส่วนกลางไหม (**ยังไม่มีใครเรียกใช้**) |
| `byGroup(key)` / `get(type)` | หยิบ definition |
| `isElement(type)` / `isContainer(type)` | ใช้ตัดสินตอน drag & drop |
| `find(list, id)` → `{node, list, idx, parent}` | **เดินต้นไม้หา node** — `blocks.find()` ใช้ไม่ได้แล้วเพราะ node ไม่ได้อยู่ระดับเดียว |
| `syncColumns(section)` | ปรับจำนวน cell ให้ตรง คอลัมน์×แถว |
| `newBlock(type, preset)` | สร้าง node ใหม่ (ผ่าน `withDefaults` + สร้าง children ให้ถ้าเป็น container) |
| `withDefaults(block)` | เติม props ที่ขาด + ย้ายข้อมูลรูปแบบเก่า (migration ตอน runtime) |
| `colParts(layout)` / `rowsOf(v)` / `gridWire(...)` | helper |

**`withDefaults` = จุด migration ตอน runtime**
ตัวอย่างที่ทำอยู่: `nav_bar` เดิมเก็บปุ่ม CTA เดียวใน `ctaText` (string) → ตอนนี้เป็น `ctaItems[]`
ทำที่นี่ที่เดียว renderer/editor จึงเห็นรูปเดียวกันเสมอ · `ctaText` ไม่ลบทิ้ง (เผื่อเปิดด้วยโค้ดเวอร์ชันเก่า)
เคล็ด: default ของ `ctaItems` ตั้งเป็น **`null` ไม่ใช่ `[]`** — เป็นสัญญาณว่า "ยังไม่เคยย้าย" ถ้าใช้ `[]` ปุ่มเดิมจะหายเงียบๆ

---

## 6. Field types ทั้งหมด

field 1 ตัว = `{ key, label, type, ...opts }` · editor อ่านแล้วสร้าง UI ให้เอง

| type | UI | opts สำคัญ |
|---|---|---|
| `text` | input บรรทัดเดียว | — |
| `textarea` | ข้อความหลายบรรทัด | — |
| `number` | ช่องตัวเลข | `min` `max` |
| `range` | แถบเลื่อน **+ ช่องตัวเลขพิมพ์เองได้** | `min` `max` `step` `unit` |
| `color` | จานสี + ช่อง hex (sync กัน) | — |
| `swatch` | ปุ่มสีสำเร็จ + ปุ่ม `+` กำหนดเอง | `swatches:[hex,...]` |
| `toggle` | สวิตช์ (`.switch/.slider` ของ design system) | `exclusive` (ในลิสต์ เปิดได้อันเดียว) · `default` |
| `select` | dropdown | `options:[{value,label}]` **หรือ** `optionsFrom:"pages"` · `allowEmpty` · `emptyLabel` |
| `segment` | ปุ่มเลือก 1 ตัว (radio ซ่อน) | `options` |
| `gridpick` | เลือกเลย์เอาต์**จากภาพ** (วาดตามจำนวนแถวจริง) | `options` = LAYOUTS |
| `image` | ปุ่มอัปโหลด + พรีวิว + ปุ่มลบ | `bucket` `keepAlpha` `maxDim` |
| `list` | repeater (array ของ object) พับ/กาง/เรียง/ลบได้ | `itemFields:[...]` · `pills:true` |
| `textsetting` | **ชุดรวม** ข้อความ+ขนาด(S/M/L/XL+px)+น้ำหนัก+สี+จัดวาง (พับได้) | `map:{text,size,color,weight,align}` · `swatches` · `min` `max` |

### layout opts (ใส่ใน field ไหนก็ได้)

- `half` — ครึ่งความกว้าง (2 field เรียงคู่)
- `row` — แถวแนวนอน (label ซ้าย / ตัวคุมขวา)
- `{ section: "ชื่อหมวด" }` — **marker หัวข้อหมวด** (ไม่ใช่ field จริง) ทำให้ panel นั้นเข้าโหมดแบ่งหมวด

### กลไกพิเศษที่ต้องรู้

**`textsetting` + `map`** = ทางแก้ปัญหา "อยากรวม UI แต่ห้ามรื้อ props เป็น nested"
```js
{ type:"textsetting", label:"ชื่อแบรนด์", swatches: BRAND_COLORS, min:10, max:90,
  map:{ text:"brand", size:"brandSize", color:"brandColor",
        weight:"brandWeight", align:"brandAlign" } }
```
UI รวมเป็นก้อนเดียว แต่ค่ายังลงใน flat key เดิมทุกตัว → หน้าเก่าเปิดได้ปกติ · reuse ได้ทุก block ที่มีข้อความ

**`list` + `pills:true`** = ลิสต์สั้นที่ item มีแค่ "ชื่อ + ใช้อยู่" (เช่นภาษา) แสดงเป็นปุ่มกลมแถวเดียว กด ✎ ถึงกางแผงจัดการ
ตัว toggle `exclusive` จะถูกตัดออกจากแผงจัดการอัตโนมัติ (ปุ่มกลมคุมอยู่แล้ว)

**`optionsFrom:"pages"`** = editor โหลดรายชื่อหน้าจริงจาก DB (`loadPagesForSelect()` → `window.__wbPages`) มาเติม dropdown
ใช้กับทุก field ที่เป็น "ลิงก์ไปหน้า" — renderer แปลงเป็น `href="web-view.html?slug=<slug>"`

**การจัดกลุ่ม primary vs style** (ใช้โดยทั้งการไฮไลต์ในแผงและฟีเจอร์คัดลอกสไตล์):
```js
primaryGrp = def.fields[0]?.section != null ? 1 : 0
```
- block ที่ขึ้นต้นด้วย `{section:...}` → กลุ่มที่ 1 = กลุ่มเนื้อหา
- block ที่ยิง field มาเลย → ของที่อยู่ **ก่อนหัวข้อแรก** = กลุ่มเนื้อหา

กลุ่มเนื้อหา = ไม่ก๊อปตอนคัดลอกสไตล์ · กลุ่มถัดไป (สไตล์/พฤติกรรม) = ก๊อป
**ผลพลอยได้: field ใหม่ที่เพิ่มทีหลังเข้ากลุ่มถูกเอง ไม่ต้องมาแก้โค้ดคัดลอกสไตล์อีก**

---

## 7. Renderer — blocks → HTML

ไฟล์: [js/shared/web-render.js](../js/shared/web-render.js)

### 7.1 แกนกลาง

```js
function renderOne(b, wrap) {
  const fn = B[b?.type];
  if (!fn) return "";                        // type ไม่รู้จัก = ข้าม ไม่ทำหน้าพัง
  const nb = window.WebBlocks.withDefaults(b);
  const html = fn(nb.props, nb, wrap);
  return wrap ? wrap(nb, html) : html;
}
function renderList(list, wrap) { return (list||[]).map(b => renderOne(b, wrap)).join("\n"); }
```
`B` = ตาราง `type → ฟังก์ชัน (props, node, wrap) => html` · container เรียก `renderList(node.children, wrap)` ต่อ

**API สาธารณะ:** `WebRender.page(blocks, wrap)` · `.block(b, wrap)` · `.esc(s)` · `.on(v)` · `.bindCarousels(root)`

### 7.2 Sanitizer — บังคับใช้ทุกค่าที่จะลง `style=""`

renderer ใช้ร่วมกับหน้า public ที่คนนอกเห็น → **ค่าจาก user ต้องล้างก่อนเสมอ**

| ฟังก์ชัน | ทำอะไร |
|---|---|
| `esc(s)` | escape HTML (`& < > " '`) — กัน XSS |
| `num(v, def, min=1, max=200)` | ตัวเลข clamp · **ผิดรูป/นอกช่วง = คืน default เงียบๆ** |
| `px0(v, def, max)` | เหมือน `num` แต่ min=0 — **ใช้ตัวนี้เมื่อยอมให้ค่าเป็น 0** |
| `col(v, def)` | ต้องเป็น `#hex` จริงเท่านั้น (regex) ไม่งั้นคืน default |
| `on(v)` | รับได้ทั้ง `true/1/"1"/"true"` — **ห้ามใช้ truthy เปล่าๆ** เพราะ `"0"` เป็น truthy ใน JS |
| `wt(v)` | `light/normal/bold` → `300/400/700` |
| `al(v)` | whitelist `left/center/right` |

> ⚠️ **`esc()` กัน HTML ได้แต่กัน CSS injection ไม่ได้** — ถ้าปล่อยค่าดิบเข้า `style="color:${v}"` คนกรอก `red;background:url(...)` จะแทรก CSS ได้
> ⚠️ **min/max ฝั่ง renderer ต้องตรงกับ field ใน contract เป๊ะ** — ถ้า field ให้เลื่อนถึง 0 แต่ renderer ใช้ `num()` (min=1) ค่า 0 จะถูกตีว่าผิดรูปแล้วเด้งกลับ default เงียบๆ (เลื่อนได้แต่ไม่มีผล — บั๊กที่หาต้นตอยากมาก)

### 7.3 class hook ที่ renderer ปล่อยออกมา (inline style ทำแทนไม่ได้)

| class / attr | ใครใช้ต่อ |
|---|---|
| `.wv-sec` | editor เกาะลากขอบปรับ padding |
| `.wv-grid` | CSS ยุบเหลือ 1 คอลัมน์ที่ ≤767px (ทั้ง editor และ public) |
| `.wv-col` | กล่องในช่อง — **`align-items:stretch` เสมอ ห้ามผูกกับ `p.align`** |
| `.wv-col-empty` | ข้อความ "ลากองค์ประกอบมาวางที่นี่" — โผล่เฉพาะเมื่อมี `wrap` (โหมดแก้ไข) |
| `.wv-header` `.wv-logo` `.wv-hide-sm` `[data-shrink]` | sticky/ย่อโลโก้/ซ่อนมือถือ |
| `.wv-spacer` + `--sp-h` `--sp-hm` | ความสูงมือถือแยก (media query ทำใน inline style ไม่ได้ → ส่งเป็น CSS var) |
| `.wv-carousel` `.wv-car-track/slide/prev/next/dot/stage/dots` + `[data-auto]` | `bindCarousels()` |

**`bindCarousels(root)`** — HTML จาก renderer เป็นของนิ่ง การเลื่อนต้องผูก JS หลังวาดเสมอ
- กัน bind ซ้ำด้วย `data-bound` (editor วาดใหม่บ่อยมาก ไม่กัน = timer ซ้อนจนภาพกระตุก)
- `data-auto` ใส่เฉพาะหน้า public (`!wrap`) — ใน editor ไม่ให้เลื่อนเอง ไม่งั้นแก้ไม่ทัน
- hover = หยุดเลื่อน · กดเอง = รีเซ็ตตัวจับเวลา · วนรอบทั้ง 2 ทาง

### 7.4 สไตล์ = inline hex ตรงๆ (ยังไม่มี theme token)

ตอนนี้สีทั้งหมด hardcode เป็น hex ในตัว renderer
**แผนขั้นถัดไปที่ตกลงไว้:** เปลี่ยน hex เป็น `var(--c-primary)` แล้ว theme = ไฟล์ token ไฟล์เดียว
โดยให้ token-only เป็น default และเปิดให้ override renderer ได้เฉพาะ hero/header/footer

**สีแบรนด์ที่ใช้อยู่:** `#16240f` (เขียวเข้ม) · `#71bf44` (เขียวสด) · `#3B6D11` · `#7c8a72` · พื้นหลัง `#f6f7f3` · footer `#0f2109`
**ฟอนต์:** `Anuphan` (หัวข้อ/ปุ่ม) + `Sarabun` (เนื้อความ)

---

## 8. Editor — เครื่องมือแก้ไข

ไฟล์: [web-editor.js](../modules/media/web-editor.js) (2,511 บรรทัด) — ทุกอย่างเป็น classic script ไม่มี module

### 8.1 State ทั้งหมด

```js
let page = null;         // แถวจาก web_pages
let blocks = [];         // ต้นไม้ที่กำลังแก้ (ยังไม่บันทึก)
let selectedId = null;
let dirty = false;
let isLayout = false;    // กำลังแก้แถวส่วนกลางอยู่ไหม
let siteChrome = { header: [], footer: [] };
```

> ⚠️ **ห้ามตั้งชื่อตัวแปร top-level ชนกับ global ของเบราว์เซอร์** — เคยใช้ชื่อ `chrome` (ชนกับ `window.chrome`) และ `history` (ชนกับ `window.history`) ผลคือ **SyntaxError ทั้งไฟล์ตาย** ปุ่มหายเกลี้ยงทั้งแผง
> `node --check` จับไม่ได้เพราะ Node ไม่มี `window` → ต้องเปิดเบราว์เซอร์ดู console เท่านั้น

### 8.2 โครงหน้าจอ

```
[หัวหน้า: undo/redo · zoom · เส้นโครง · เลเยอร์ · กลับ · ดูเว็บจริง · บันทึก]
┌──────────────┬─┬───────────────────────────┬──────────────┐
│ แผงซ้าย       │ │ #chromeTop (ส่วนกลาง)      │ แผงเลเยอร์   │
│ 2 แท็บ:       │s│ #canvas   (blocks ของหน้า) │ (ต้นไม้)     │
│ 🧰 เครื่องมือ  │p│ #chromeBottom (ส่วนกลาง)   │              │
│ ⚙️ ตั้งค่า     │l│                            │              │
└──────────────┴─┴───────────────────────────┴──────────────┘
```
- `#chromeTop/#chromeBottom` อยู่ **นอก** `#canvas` โดยตั้งใจ — ไม่งั้นจะถูกนับเป็นบล็อกตอนลากวางแล้วลำดับเพี้ยน
- เส้นแบ่ง (`#wbSplit`) ลากปรับความกว้างแผงได้ · ดับเบิลคลิก = คืนค่า · จำใน `localStorage` (`wb_pane_w`)

### 8.3 Palette 3 ชั้น (สไลด์ซ้ายทีละชั้น)

```
ชั้น 1: หมวด (GROUPS)  →  ชั้น 2: หมวดย่อย (def.sub)  →  ชั้น 3: การ์ดบล็อก
```
- หมวดที่มีหมวดย่อยเดียว = **ข้ามชั้น 2 ไปเลย** (คลิกที่เสียเปล่า) แล้วปุ่มย้อนกลับพากลับ "ทุกหมวด"
- ตัวเลขบนป้ายหมวดนับ **"การ์ดที่ลากได้จริง"** (นับ presets) ไม่ใช่จำนวน def
- ความสูงกรอบสไลด์คุมด้วย JS (`syncNavHeight`) — วัดได้ 0 **ห้ามล็อกเป็น `0px`** (กรอบมี `overflow:hidden` → เนื้อหาหายถาวร) ปล่อย auto แล้ววัดใหม่รอบหน้า

**ชื่อชั่วคราว (ดับเบิลคลิกเปลี่ยนชื่อ)** — เก็บใน `localStorage: wbLabelOverrides` เครื่องเดียว ไม่แตะ DB
เป็นที่ "ลองตั้งชื่อ" ระหว่างออกแบบ · พอใจแล้วให้ยกไปใส่ contract แล้วกด "คืนชื่อเดิม" ล้าง override ทิ้ง

### 8.4 Canvas

```js
const editorWrap = (node, html) => blockShell(node, html);
c.innerHTML = blocks.map((b,i) => insertRow(i) + WebRender.block(b, editorWrap)).join("")
            + insertRow(blocks.length, true);
```

`blockShell()` ห่อทุก node ด้วย:
```html
<div class="wb-block [--col|--el]" style="grid-column:span N" data-id data-type draggable>
  <div class="wb-block-tag">ไอคอน+ชื่อ</div>
  <div class="wb-block-bar">⠿ ▲ ▼ ⧉ ✕</div>     <!-- cell ไม่มีแถบนี้ -->
  ...pad handles / col-size handles...
  <button class="wb-cell-add">＋</button>          <!-- cell ว่างเท่านั้น -->
  {html ของ renderer}
</div>
```

> ⚠️ **`cellSpanStyle()` ห้ามลบ** — หน้าจริง `.wv-col` เป็นลูกของกริดโดยตรง `grid-column/row` จึงมีผล
> แต่ใน editor มี `.wb-block` ห่ออีกชั้น → **ตัวที่กริดมองเห็นคือ wrapper** span บน `.wv-col` เลยถูกเมินทั้งหมด
> ต้องยก span ขึ้นมาไว้บน `.wb-block` ด้วย ไม่งั้น "แถวหัวเต็มความกว้าง" ดูเหมือนไม่ทำงานเฉพาะตอนแก้ไข (หน้าจริงถูก)

**`healTree(list)`** เรียกตอนโหลด — เดินทั้งต้นไม้แล้ว:
1. `withDefaults` **ทุกชั้น** (ไม่ใช่แค่ชั้นบนสุด)
2. `syncColumns` ให้ section ทุกตัว (ซ่อมหน้าที่เคยถูกลบ cell ไปสมัยที่ยังลบได้)

> ⚠️ ของเดิมเรียก `withDefaults` แค่ชั้นแรก → element ในช่องไม่เคยได้ default เลย
> ผลคือ field ที่เพิ่มทีหลังไม่มี key ในข้อมูล → **แผงโชว์ค่าต่ำสุด แต่ renderer ใช้ default ของตัวเอง = เลขบนแผงไม่ตรงกับภาพจริง** (โค้ดสองฝั่งดูถูกทั้งคู่ หาต้นตอยากมาก)

**`refreshBlock(id)`** = วาดใหม่เฉพาะ block เดียว (กันช่องกรอกใน props เสีย focus ตอนพิมพ์) + ต้อง `bindCarousels` ใหม่

**เส้นโครง (guides)** — `localStorage: wb_guides` · เปิด = เห็นเส้นประ + คอลัมน์ว่างโชว์กรอบ · ปิด = canvas เหมือนเว็บจริงเป๊ะ (ตรวจงานก่อนเผยแพร่โดยไม่ต้องเปิดแท็บใหม่)

**zoom canvas** — ใช้ **CSS `zoom` ไม่ใช่ `transform:scale`** เพราะ `zoom` ย่อ "พื้นที่ที่ใช้จริง" ด้วย (`transform` ย่อแค่ภาพ กล่องยังกินที่เท่าเดิม → เหลือช่องว่างใหญ่ใต้หน้า)

### 8.5 Drag & Drop (ส่วนที่ยากที่สุด)

**รูปแบบข้อมูลที่ลาก:** `"new:<type>#<preset>"` (จาก palette) · `"move:<id>"` (สลับลำดับใน canvas)

> ⚠️ ต้องจำ `dragType` ไว้ตั้งแต่ `dragstart` เพราะ **`dragover` อ่าน `dataTransfer.getData()` ไม่ได้** (เบราว์เซอร์ปิดไว้กันเว็บแอบดูของที่ลากมาจากที่อื่น) แต่เราต้องรู้ชนิดตั้งแต่ตอน hover เพื่อไฮไลต์เป้าหมายให้ถูก

**`dropTarget(e)` — กติกาการเลือกเป้าหมาย**

| กำลังลาก | ลงตรงไหน | ผลลัพธ์ |
|---|---|---|
| element | อยู่เหนือ cell | ลงใน cell นั้น (+ `snapToCell` ดูดเข้าช่องย่อยที่ใกล้ที่สุดถ้า cell นั้นถูกแบ่งกริดย่อยแล้ว) |
| element | ที่ว่างนอก cell | **สร้าง section 1×1 ห่อให้อัตโนมัติ** (`autoWrap`) |
| section | cell ที่ยังซ้อนได้ + ข้างในไม่มี element ปน | แบ่ง cell นั้นเป็นกริดย่อย |
| อื่นๆ | — | ระดับหน้า |

> ⚠️ **หาเป้าหมาย drop ต้องใช้พิกัด (`cellAtPoint`) ห้ามใช้ `e.target.closest()`**
> ของ editor หลายอย่างลอยทับเนื้อหาและรับคลิกเอง (ป้ายชื่อบล็อก · แถบ ▲▼⧉✕ · ลูกศรสไลด์ · ที่จับ padding)
> ป้ายของกริดย่อยอยู่มุมบน = ทับช่องแถวบนพอดี → `closest()` เด้งไปเจอช่องแม่ = อาการ **"แถวล่างวางได้ แถวบนวางไม่ได้"**
> `cellAtPoint` เทียบพิกัดกับกรอบช่องตรงๆ และเลือก **ช่องที่ลึกที่สุด** ที่ครอบจุดนั้น (ช่องย่อยชนะช่องแม่เสมอ)

**`autoWrap` มีไว้ทำไม:** หน้าเปล่าจะวางอะไรไม่ได้เลยจนกว่าผู้ใช้จะรู้ว่า "ต้องลาก Section มาก่อน" — คนใช้ครั้งแรกไม่มีทางเดาออกและจะสรุปว่าเครื่องมือพัง
`wrapInSection()` ต้องส่ง preset `"1x1"` เสมอ (default ของ section คือ `1-1` = 2 คอลัมน์ ลากรูปมาใบเดียวจะได้กริด 2 ช่องโดยไม่ได้ขอ)

**เส้นบอกตำแหน่ง (`.wb-drop-line`)**
- `showDropLine(idx, host)` **ห้ามแตะ DOM ถ้าตำแหน่งเดิม** — ของเดิมสร้างช่องใหม่ทุก `dragover` (ยิงหลายสิบครั้ง/วินาที) → element ใต้เมาส์ถูกลบทิ้งตลอด → `dragover` ตัวถัดไปไม่ได้ `preventDefault` → ขึ้น 🚫 วางไม่ได้
- `dropIndex()` ต้องหักความสูงของเส้นออกก่อนเทียบ **เฉพาะเมื่ออยู่ host เดียวกัน** (ข้ามช่องแล้วของในช่องใหม่ยังไม่ถูกดัน หักไปด้วยจะเพี้ยน 1 ตำแหน่ง)
- ย้ายข้าม host = `clearDropLine()` ก่อนวัดใหม่เสมอ (วัดบนหน้าที่สะอาด ตัดปัญหาทั้งคลาสทิ้ง)
- พื้นที่รับการวาง = `.wb-canvas-wrap` ทั้งกรอบ ไม่ใช่แค่ `#canvas` (ที่ว่างใต้บล็อกสุดท้ายเป็นของ wrap)

**ย้ายภายในลิสต์เดิม** ต้องหัก index ของตัวเองที่ถูกดึงออก (`if (idx > hit.idx) idx--`) · ข้ามลิสต์ไม่ต้องหัก

### 8.6 ลากขอบปรับค่า (direct manipulation)

**ปรับ padding** (`.wb-pad`) — `PAD_MAP` กำหนดว่า block ไหนมีที่จับด้านไหน
- section: บน/ล่าง → `padY` · ซ้าย/ขวา → `padX`
- cell: บน/ล่างเท่านั้น → `pad` (ปล่อยซ้าย-ขวาไว้ให้ที่จับปรับความกว้างคอลัมน์)
- กฎทิศทาง: **"ลากออกนอกกรอบ = เพิ่ม · ลากเข้าใน = ลด"** (ห้ามทำเป็น "ลากตามทิศเดียวกันทุกด้าน" — ขอบล่างจะลากลงแล้วกรอบหดขึ้น ขัดสัญชาตญาณ)

> ⚠️ **เรื่อง zoom:** px ของเมาส์กับ px ของ layout ไม่เท่ากัน เพราะมี zoom ซ้อน 2 ชั้น (`:root{zoom:.65}` ของทั้งระบบ × zoom ของ canvas)
> **ห้ามอ่านค่า zoom มาคูณเอง** — พลาดชั้นใดชั้นหนึ่งค่าจะเพี้ยนแบบหาต้นตอยาก
> วัดจากของจริงแทน: `rect.width / offsetWidth` = อัตราส่วนรวมทุกชั้น

**ปรับความกว้างคอลัมน์** (`.wb-colsize`) — ลากรอยต่อระหว่างคอลัมน์
- คิดเป็น **fr ไม่ใช่ px**: ย้ายน้ำหนักระหว่างคู่ซ้าย-ขวา โดยผลรวมของคู่คงที่ → คอลัมน์อื่นไม่ขยับ และสัดส่วนคงที่ทุกความกว้างจอ (responsive ไม่พัง)
- ต่ำสุด 0.2 (กันลากจนคอลัมน์แคบจนคลิกกลับมาแก้ไม่ได้)
- มีที่จับทั้ง 2 ฝั่งของช่อง (ขอบขวาคุมรอยต่อ `c` · ขอบซ้ายคุมรอยต่อ `c-1`) — เดิมมีแต่ฝั่งขวา ทำให้ช่องขวาสุด "ปรับขนาดไม่ได้"

**ระหว่างลากห้ามเรียก `refreshBlock`** — DOM ที่วาดใหม่จะพา handle ที่นิ้วจับอยู่หายไปกลางคัน
วิธีที่ใช้: แก้ `style` ของ element จริงสดๆ → เขียนลง props + วาดใหม่ตอนปล่อยนิ้ว

### 8.7 Undo / Redo

- เก็บเป็น **snapshot JSON ของทั้งต้นไม้** ไม่ใช่บันทึกทีละ action (state เป็น JSON ล้วนอยู่แล้ว → ย้อน = โหลดภาพเก่าทับ จบ) ไม่ต้องเขียนตัวย้อนของแต่ละ action ซึ่งพลาดง่ายมากเมื่อมี action ใหม่
- **เกาะที่ `setDirty(true)` จุดเดียว** → ทุกการแก้ไขถูกเก็บครบอัตโนมัติ (ลากวาง · ลบ · พิมพ์ · ลากขอบ · เปลี่ยนเลย์เอาต์) ไม่ต้องไล่ใส่ทีละจุดแล้วลืมบางอัน
- หน่วง 450ms (พิมพ์รัวๆ = 1 ภาพ ไม่ใช่ภาพต่อ 1 ตัวอักษร) · เพดาน 60 ภาพ
- แก้ต่อหลัง undo = ทิ้งเส้นทาง redo เดิม

### 8.8 คัดลอก / วางสไตล์

`Ctrl+Alt+C` / `Ctrl+Alt+V` (ใช้ Alt ร่วมเพราะ `Ctrl+C/V` ล้วนต้องเป็นของการคัดลอกข้อความปกติ)
- "อะไรคือสไตล์" ไม่ต้องไล่ระบุทีละ field — ใช้โครงกลุ่มที่ contract มีอยู่แล้ว (ดูข้อ 6)
- `list` / `image` = เนื้อหาแน่นอน ไม่ก๊อป · `textsetting` ก๊อปทุก role ยกเว้น `text`
- วางข้ามชนิด block ไม่ได้ (prop คนละชุด ยัดข้ามกันได้ค่าเพี้ยนเงียบๆ)
- เก็บใน `localStorage: wb_style_clip` (ข้ามหน้า/ข้ามวันได้)

### 8.9 แผงเลเยอร์ + breadcrumb

- **แผงเลเยอร์** = ต้นไม้ทั้งหน้า แยกเป็นแผงของตัวเอง **ไม่ใช่แท็บ** เพราะต้องดูคู่กับแท็บตั้งค่าพร้อมกัน (ไล่โครงจากต้นไม้ → แก้ค่าในแผงซ้ายทันที) · ความกว้างปรับตามความลึกจริง (`syncLayerWidth`)
- **breadcrumb** (`Section › ช่อง › ข้อความ`) โผล่ใต้หัวแผงตั้งค่าเมื่อของซ้อนกัน — กดชั้นบนเพื่อกระโดดไปเลือกชั้นนั้น (**ทางเดียวที่จะเลือก section ได้เมื่อมันเต็มไปด้วยลูก**)
- cell ที่ถูกแบ่งกริดย่อยแล้วจะมีปุ่มลัด "▦ ช่องนี้แบ่งเป็นกริดย่อยอยู่ — กดเพื่อเปลี่ยนเลย์เอาต์" บนสุดของแผง (ไม่งั้นคลิกเลือก section ย่อยแทบไม่ได้เลย)

### 8.10 เส้นทางการเขียนค่า (write path)

ทุก control ในแผงตั้งค่าใส่ `data-fk="<prop key>"` (+ `data-idx` `data-sub` ถ้าอยู่ใน repeater)
มี **event delegation กลางแค่ 3 ตัว** บน `#props`: `input` · `click` · `change`

```
พิมพ์/เลื่อน → input handler → b.props[fk] = val → setDirty(true) → refreshBlock(b.id)
```
เคสพิเศษที่ handler จัดการให้:
- checkbox อ่าน `.checked` ไม่ใช่ `.value`
- `range` + ช่องตัวเลข sync กันเอง (clamp เฉพาะค่าที่ **เก็บลง props** ไม่แตะตัวอักษรที่กำลังพิมพ์ ไม่งั้นพิมพ์ "16" ไม่ได้เพราะ "1" โดนดันเป็น min ทันที)
- `color` ↔ hex sync กัน (เช็คครบ 6 หลักก่อนยัดใส่ `input[type=color]` ไม่งั้นระหว่างพิมพ์ `#7` จะโดนรีเซ็ตเป็น `#000000`)
- `exclusive` toggle → ปิดตัวอื่นในลิสต์ + วาดแผงใหม่
- section เปลี่ยน `rows`/`headRow`/`layout` → `syncColumns` + `renderCanvas` + `renderProps` (คอลัมน์ใหม่ยังไม่มีใน DOM `refreshBlock` ไม่พอ)

**repeater** (`data-lact`): `add` / `del` / `up` / `down` · จำการ์ดที่กางอยู่ใน `openItems` (คีย์ `"fk:idx"`) · ลบ/สลับแล้วล้างทิ้ง (idx เลื่อน คีย์เดิมชี้ผิดใบ) · ดับเบิลคลิกที่ข้อความสรุป = เปลี่ยนชื่อในที่

### 8.11 คีย์ลัด

| คีย์ | ทำอะไร |
|---|---|
| `Ctrl+S` | บันทึก (blur ก่อนเสมอ เพื่อให้การแก้ชื่อในที่ลง props ก่อน) |
| `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` | undo / redo |
| `Ctrl+Alt+C` / `Ctrl+Alt+V` | คัดลอก/วางสไตล์ |
| `ESC` | เลิกเลือก (กลับแท็บเครื่องมือ) |
| `Delete` / `Backspace` | ลบบล็อกที่เลือก (มี ConfirmModal) |

> ⚠️ **ต้องเทียบด้วย `e.code` ไม่ใช่ `e.key`** — ผู้ใช้ไทยสลับแป้นเป็นภาษาไทยแล้วกด `Ctrl+S` เบราว์เซอร์ส่ง `e.key = "ห"` (`Z→ผ` `Y→ั` `C→แ` `V→อ`) → เช็ค `e.key === "s"` ไม่มีทางเข้าเงื่อนไข คีย์ลัดเงียบทั้งหมดและ `Ctrl+S` หลุดไปเป็น "Save page as…" ของเบราว์เซอร์
> helper: `isKey(e, "KeyS", "s")` = เช็ค `e.code` ก่อน แล้ว fallback `e.key`

**guard ที่ต้องมีครบ:**
- มี modal เปิดอยู่ = ไม่รับคีย์ (โปรเจกต์นี้มี 3 convention: `.modal-overlay.open` · `.cm-overlay.open` · `.dm-overlay.active`)
- `Ctrl+Z` ระหว่างพิมพ์ในช่องข้อความ = ปล่อยให้เบราว์เซอร์ย้อนตัวอักษร แต่ **อย่าเหมารวมทุก `input`** — แถบเลื่อน/สวิตช์/จานสี เบราว์เซอร์ไม่มี undo ให้ ถ้าเหมารวมจะกลายเป็น "ลากแถบเลื่อนเสร็จแล้วกด Ctrl+Z เงียบสนิท" ซึ่งเป็นจังหวะที่อยาก undo ที่สุดพอดี
- `Delete` ระหว่างพิมพ์ = เป็นของช่องนั้น ห้ามไปลบบล็อก

### 8.12 บันทึก

```js
sbPatch(`web_pages?id=eq.${page.id}`, { blocks, updated_by, updated_at })
```
เช็ค `AuthZ.hasPerm("web_pages_edit")` ก่อน · `beforeunload` กันปิดแท็บทิ้งงานที่ยังไม่บันทึก

---

## 9. หน้า Public

[web-view.js](../modules/media/web-view.js) — 77 บรรทัด ทั้งหมด

```js
const slug = new URLSearchParams(location.search).get("slug");
const q = slug ? `slug=eq.${slug}` : `is_home=eq.true`;

const [rows, chrome] = await Promise.all([
  sbGet(`${q}&status=eq.published&select=title,blocks&limit=1`),
  sbGet(`slug=in.(_layout_header,_layout_footer)&select=slug,blocks`),
]);

document.getElementById("site").innerHTML = WebRender.page([
  ...partOf(header), ...(page.blocks||[]), ...partOf(footer)
]);
initShrink();
WebRender.bindCarousels();
```

- `?slug=<slug>` เปิดหน้านั้น · ไม่ใส่ = หน้าที่ `is_home = true`
- **แสดงเฉพาะ `status = 'published'`** — ฉบับร่างดูผ่าน editor เท่านั้น
- แถวส่วนกลาง**ไม่กรอง status** โดยตั้งใจ (สร้างเป็น published เสมอและซ่อนจากรายการหน้า ไม่มีทาง toggle เป็นร่าง)
- ยิง 2 query พร้อมกัน (ส่วนกลางกับหน้าไม่ต้องรอกัน)
- ลิงก์ระหว่างหน้าทั้งหมดเป็น `web-view.html?slug=<slug>` (relative) — ยังไม่มี pretty URL / ไม่มี custom domain

**config:** [web-view-config.js](../modules/media/web-view-config.js) ถือ anon key ตรงๆ เพราะคนนอกไม่ได้ login เลยไม่มี `localStorage.sb_url/sb_key`
(anon key เป็นค่าสาธารณะโดยออกแบบ ความปลอดภัยจริงมาจากสิทธิ์ระดับตารางใน Supabase) · รองรับ env switch เก่า/ใหม่ผ่าน `window.ERP_IS_NEW`
ถ้าเปิดจาก editor (login อยู่แล้ว) จะใช้ค่าใน `localStorage` แทน

**responsive** — ทั้งหมดอยู่ใน `<style>` ของ [web-view.html](../modules/media/web-view.html) แค่ 4 กฎ:
```css
@media (max-width:767px){ .wv-header.wv-hide-sm{ display:none !important } }
@media (max-width:767px){ .wv-spacer{ height:var(--sp-hm) !important } }
@media (max-width:767px){ .wv-grid{ grid-template-columns:1fr !important } }   /* ยุบทุกกริดเหลือ 1 คอลัมน์ */
.wv-header.is-shrunk .wv-logo{ height:30px !important }
```
> **กฎ: อย่าให้ผู้ใช้ตั้ง responsive ทีละ property** — ยุบกริดเป็นคอลัมน์เดียวอัตโนมัติ ผู้ใช้ไม่ต้องตั้งอะไรเลย

---

## 10. รูปภาพ & Storage

**ปลายทางมาจาก field ใน contract ไม่ได้ fix ในโค้ด editor:**

```js
const bucket = fieldDef.bucket || "web-images";
ImageCompressor.uploadViaRest(SB_URL, SB_KEY, bucket, path, file, { keepAlpha, maxDim });
```
- bucket อยู่ใน `DRIVE_BUCKETS` (มี `web-images`) → ขึ้น **Google Drive ผ่าน proxy**
- ไม่อยู่ (เช่น `company-assets` ของโลโก้) → ขึ้น **Supabase Storage**
- `uploadViaRest` ตัดสินเองจากชื่อ bucket · `imageCompressor` ย่อ/แปลงให้ตาม opts
- path: `web/<slug>_<fieldKey>_<timestamp>_<rand>`

**กฎ:** โลโก้/รูปพื้นใส → PNG (`keepAlpha: true`, `maxDim: 600`) · รูปเนื้อหา → JPEG บีบอัดก่อนอัปเสมอ

**URL ที่เก็บเป็น absolute** → ถ้าย้าย Supabase project หรือย้าย proxy ต้องรัน [sql/173_rewrite_proxy_urls.sql](../sql/173_rewrite_proxy_urls.sql) (Drive) และ [sql/174_rewrite_supabase_storage_urls.sql](../sql/174_rewrite_supabase_storage_urls.sql) (Supabase Storage) ไม่งั้นรูปพังทั้งเว็บ

---

## 11. สิทธิ์ · RLS · ความปลอดภัย

**Permissions** ([js/core/permissions.js:102-127](../js/core/permissions.js#L102-L127)) กลุ่ม `website`:

| กลุ่ม | perms |
|---|---|
| `web_pages` | `web_pages_view` `_create` `_edit` `_publish` `_delete` |
| `web_content` | `web_content_view` `_create` `_edit` `_publish` `_delete` (หน้ายัง stub) |
| `web_settings` | `web_settings_view` `_edit` (หน้ายัง stub) |

- หน้า editor: `AuthZ.requirePerm("web_pages_view")` ตอนโหลด + ปุ่มบันทึกมี `data-perm="web_pages_edit"` + เช็คซ้ำใน `savePage()`
- แถวที่ render ทีหลังต้องเรียก `AuthZ.applyDomPerms(tbody)` เอง (DOMContentLoaded ยิงไปแล้ว)

**RLS ปิดโดยตั้งใจ**
```sql
ALTER TABLE web_pages DISABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON web_pages TO anon;
```
เหตุผล: ERP login เป็น custom (ตาราง `users`) ไม่ใช่ Supabase Auth → **ทุก request เป็น role `anon` ทั้งหมด**
ถ้าเปิด RLS แบบ "anon อ่านได้เฉพาะ published" → **editor จะอ่าน draft ไม่ได้ทันที**
แลกกับการที่ anon อ่าน draft ได้ (เป็น marketing copy ไม่ใช่ PII) — รับความเสี่ยงนี้ได้

> ⚠️ Supabase **เปิด RLS ให้ตารางใหม่อัตโนมัติ** — "ไม่สั่งเปิด" ≠ "ปิด"
> RLS ที่เปิดแต่ไม่มี policy = ปฏิเสธทุก query ของ anon · SQL Editor รันด้วย role `postgres` ซึ่ง bypass RLS จึงดูเหมือนสำเร็จ แต่หน้าเว็บพังเงียบ
> → ต้องสั่ง `DISABLE ROW LEVEL SECURITY` + `GRANT` ให้ชัดเจนทุกครั้ง

**ป้องกัน injection:** ทุกค่าที่ลง HTML ผ่าน `esc()` · ทุกค่าที่ลง `style=""` ผ่าน `num`/`px0`/`col`/whitelist (ดูข้อ 7.2)
ค่าที่เป็น enum (เช่น `lineStyle`) ต้อง **whitelist ไม่ใช่ `esc`** เพราะยิงเข้า CSS property ตรงๆ

---

## 12. วิธีต่อยอด (สูตรสำเร็จ)

### 12.1 เพิ่ม block ชนิดใหม่

1. **[web-blocks.js](../js/shared/web-blocks.js)** — เพิ่ม entry ใน `CATALOG`:
   - `type` (ไม่ซ้ำ) · `group` (ต้องตรงกับ key ใน `GROUPS`) · `sub` · `label` · `icon`
   - `wire` — SVG 120×44 (ถ้าเป็นกริดใช้ `gridWire()` · ถ้าเป็นข้อความใช้ `txtWire()`)
   - `scope: "element"` ถ้าต้องการให้ลงได้เฉพาะใน cell
   - `fields` — เลือก type จากตารางข้อ 6 (**อย่าประดิษฐ์ type ใหม่ถ้าของเดิมพอ**)
   - `defaults` — **ต้องมีครบทุก key ที่ปรากฏใน `fields`**
   - `presets` ถ้าอยากให้แตกเป็นการ์ดหลายใบใน palette
2. **[web-render.js](../js/shared/web-render.js)** — เพิ่ม case ใน `B`: `type: (p, node, wrap) => html`
   - ค่าทุกตัวที่ลง `style` ต้องผ่าน sanitizer · min/max ต้องตรงกับ field ใน contract
   - ถ้าเป็น container: เรียก `renderList(node.children, wrap)` และตั้ง `container: true` + `makeChildren: true` ใน contract
3. **ถ้าต้องมีพฤติกรรม JS** (แบบ carousel) — เขียนฟังก์ชัน bind ใน `web-render.js` แล้ว export ให้ทั้ง editor และ view เรียก (ห้ามเขียนแยก 2 ที่)
4. **ไม่ต้องแตะ `web-editor.js` เลย** ถ้าใช้ field type ที่มีอยู่แล้ว

### 12.2 เพิ่ม field type ใหม่

1. `inputHtml()` ใน [web-editor.js:1937](../modules/media/web-editor.js#L1937) — เพิ่ม branch คืน HTML
   - ทุก control ต้องมี `data-fk` (+ `data-idx`/`data-sub` ถ้าใช้ใน repeater ได้) → ไหลผ่าน handler กลางเอง ไม่ต้องเขียน listener ใหม่
   - ปุ่มที่ไม่ใช่ input ให้ใช้ `data-setbtn="1" data-val="..."` (มี handler รออยู่แล้ว)
2. เพิ่ม CSS ใน [web-editor.css](../modules/media/web-editor.css)
3. ถ้าต้อง sync UI สดๆ (เช่น range ↔ number) เพิ่มใน `input` handler ตอนท้าย
4. อัปเดตตารางใน [WEBSITE-BUILDER-AI-BRIEF.md](WEBSITE-BUILDER-AI-BRIEF.md) และเอกสารนี้

### 12.3 เพิ่ม field ให้ block เดิม (เคสที่ทำบ่อยที่สุด)

```js
// 1. contract: เพิ่ม field + default
fields: [ ..., { key:"shadeHeight", label:"ความสูงแถบไล่สี", type:"range",
                 row:true, min:0, max:100, step:5, unit:"%" } ],
defaults: { ..., shadeHeight: 55 },

// 2. renderer: ใช้ค่า — min ต้องตรงกับ contract
const shadeH = px0(p.shadeHeight, 55, 100);   // px0 เพราะยอมให้ 0
```
เท่านี้จบ — `withDefaults` เติมค่าให้หน้าเก่าอัตโนมัติ (backward compatible)

### 12.4 เพิ่ม preset

ต่อรายการใน `presets` ของ block นั้น — palette และโมดัล ＋ ขึ้นให้เอง ไม่ต้องแตะโค้ดอื่น
`key` ต้องไม่ซ้ำในบล็อกเดียวกัน (ใช้เป็นรหัสอ้างอิงตอนลาก)

---

## 13. กฎเหล็ก & กับดักที่เคยเหยียบ

### กฎเหล็ก (task ที่ผ่านต้องเคารพ)

1. **ห้ามรื้อ props เป็น nested / ห้ามสร้าง state ใหม่ทับของเดิม** — หน้าที่บันทึกแล้วจะเปิดไม่ขึ้น/ข้อมูลหาย
   เพิ่มความสามารถ = เพิ่ม flat key ใหม่ + ตั้ง default · ถ้าอยากรวม UI ใช้ `textsetting` + `map`
2. **ค่าใหม่ทุกตัวต้องมี default ใน `defaults`** — `withDefaults` เติมให้หน้าเก่าอัตโนมัติ
3. **ค่าที่ยิงเข้า `style=""` ต้อง sanitize** — renderer ใช้ร่วมกับหน้า public
4. **min/max ฝั่ง renderer ต้องตรงกับ field ใน contract** — ใช้ `px0()` เมื่อยอมให้ 0
5. **อ่านโค้ดเดิมก่อนแก้เสมอ** — ชื่อ class/helper จริงมักต่างจากที่เดา (จริงคือ `.form-control` ไม่ใช่ `.form-input` · มี `.switch` กลางอยู่แล้ว)
6. **desktop มี global zoom 0.65** — spec ที่มีตัวเลข px ต้องระบุว่าเป็น "ค่าที่ตาเห็น" (พื้นที่ layout จริง = ค่า ÷ 0.65)
7. **reuse ของกลางเสมอ** — design token · `.switch` · `swatch` · `TextSetting` · `ConfirmModal` · `modalManager.js`

### กับดักที่เหยียบมาแล้ว (อ่านก่อนแก้ editor)

| อาการ | สาเหตุจริง | ทางแก้ |
|---|---|---|
| ทั้งไฟล์ตาย ปุ่มหายเกลี้ยง | ตั้งตัวแปร top-level ชื่อ `chrome` / `history` ชนกับ global | ตั้งชื่ออื่น (`siteChrome` / `histStack`) · `node --check` จับไม่ได้ ต้องดู console จริง |
| span/แถวหัวไม่ทำงานเฉพาะตอนแก้ไข | wrapper `.wb-block` เป็นตัวที่กริดมองเห็น ไม่ใช่ HTML ที่ renderer ออก | `cellSpanStyle()` ยก span ขึ้นมาบน wrapper |
| กริดย่อยหด ลากของลงไม่ได้ | `.wv-col` ใช้ `align-items` ตาม `p.align` → ลูกหดเท่าเนื้อหา | `align-items:stretch` เสมอ · จัดชิดด้วย `text-align` + margin |
| "แถวล่างวางได้ แถวบนวางไม่ได้" | ใช้ `e.target.closest()` หาเป้าหมาย drop → ป้าย/ปุ่มลอยทับ | `cellAtPoint()` เทียบพิกัด + เลือกช่องลึกสุด |
| ขึ้น 🚫 วางไม่ลงเป็นช่วงๆ | `showDropLine` สร้าง DOM ใหม่ทุก `dragover` | เช็คตำแหน่งเดิม = ไม่แตะ DOM |
| เลขบนแผงไม่ตรงกับภาพจริง | `withDefaults` เติมแค่ชั้นบนสุด / แผงอ่าน `b.props` ตรงๆ | `healTree` เติมทุกชั้น + แผงอ่านผ่าน `withDefaults` |
| เลื่อนแถบได้แต่ไม่มีผล (เด้งกลับ default) | `num()` min=1 ตีค่า 0 ว่าผิดรูป | ใช้ `px0()` และให้ min ตรงกับ contract |
| ช่องหายไปดื้อๆ แก้กลับไม่ได้ | ลบ cell เดี่ยว → จำนวนไม่ตรงกับ คอลัมน์×แถว | กันทั้งปุ่มและคีย์ Delete + `healTree` ซ่อมของเก่า |
| คีย์ลัดเงียบหมดตอนสลับแป้นไทย | เช็ค `e.key` (ได้ "ห" "ผ" "แ") | เช็ค `e.code` ก่อน |
| ลากแถบเลื่อนเสร็จ กด Ctrl+Z เงียบ | เหมารวมทุก `input` ว่า "กำลังพิมพ์" | whitelist เฉพาะช่องที่มีตัวอักษรให้ย้อนจริง |
| จานสีรีเซ็ตเป็นดำระหว่างพิมพ์ hex | ยัดค่าไม่ครบ 6 หลักเข้า `input[type=color]` | เช็ค regex ครบก่อน sync |
| ลากขอบแล้วค่าเพี้ยน | อ่านค่า zoom มาคูณเอง (มี zoom ซ้อน 2 ชั้น) | วัด `rect.width / offsetWidth` |
| แผงเครื่องมือว่างเปล่าถาวร | `syncNavHeight` ล็อกความสูงเป็น `0px` ตอนวัดไม่ได้ | วัดได้ 0 = ปล่อย auto วัดใหม่รอบหน้า |
| กด "เพิ่มรายการ" แล้วไม่มีอะไรเกิดขึ้น | `props[fk]` ยังเป็น `null` (รอ migration) แล้ว `push` throw | `if (!Array.isArray(...)) props[fk] = []` ก่อนเสมอ |

---

## 14. ของที่ยังไม่มี / ยังไม่เสร็จ

### ช่องโหว่ที่ควรอุดก่อน (ตรวจจากโค้ดจริง 2026-08-01)

1. **ไม่มีทางสร้างแถวส่วนกลาง (`_layout_header` / `_layout_footer`)**
   `LAYOUT_SLUGS` ถูกอ่านโดย editor และ view แล้ว แต่ไม่มี UI ปุ่มสร้าง และ [sql/171](../sql/171_web_pages.sql) ก็ไม่ได้ seed ให้
   ตอนนี้ต้องสร้างแถวด้วยมือ (INSERT ใน SQL Editor) แล้วค่อยเปิด `web-editor.html?slug=_layout_header`
2. **[web-pages.js](../modules/media/web-pages.js) ไม่กรอง `isSystemSlug` ออกจากรายการ**
   contract เขียนไว้ชัดว่า "slug ขึ้นต้นด้วย `_` ต้องซ่อนจากรายการหน้าเว็บปกติเสมอ" แต่ `visiblePages()` กรองแค่ status กับคำค้น
   ผลถ้าสร้างแถวส่วนกลางแล้ว: มันจะโผล่เป็นหน้าปกติและถูกลบได้
3. **`CHROME_TYPES` export ไว้แต่ยังไม่มีใครเรียก** — ตั้งใจให้ตรวจว่า "หน้านี้มี header/nav/footer ที่ควรย้ายไปส่วนกลางไหม" แต่ยังไม่ได้ทำ UI เตือน

### ฟีเจอร์ที่ยังไม่ได้ทำ

- **element ที่ยังไม่มี:** การ์ด (repeater ที่วนเนื้อหาเอง) · วิดีโอ · ฟอร์ม · แผนที่
- **theme token** — สียังเป็น hex ตรงๆ ในตัว renderer (แผน: เปลี่ยนเป็น CSS var → theme = ไฟล์ token ไฟล์เดียว)
- **หน้า [web-content](../modules/media/web-content.html) และ [web-settings](../modules/media/web-settings.html)** ยังเป็น stub
- **ไม่มี preview ก่อน publish แยกต่างหาก** (ใช้ "ปิดเส้นโครง" ใน editor แทน)
- **ไม่มี version history ฝั่ง DB** (undo/redo อยู่ในหน่วยความจำของแท็บเท่านั้น หายเมื่อ refresh)
- **ไม่มี pretty URL / custom domain** — เข้าผ่าน `web-view.html?slug=` เท่านั้น

### หลายภาษา — พักไว้ก่อน อย่าเพิ่งทำ

ปุ่มภาษา (ไทย/EN/FR) ใน `site_header` ตอนนี้เป็น **ตกแต่งอย่างเดียว** เป็น `<span>` กดไม่ได้ — **ตั้งใจให้เป็นแบบนี้ชั่วคราว**

แนวทางที่สรุปกันไว้แล้ว (ยังไม่ได้ทำ): **1 ภาษา = 1 หน้า** (slug `home` / `home-en` / `home-fr` · ปุ่มภาษา = ลิงก์)
เหตุผล: IBD ดูแลตลาด EN/FR ที่ต้องการข่าวคนละชุดกับไทยอยู่แล้ว · หน้า EN ไม่ต้องมีเนื้อหาเท่าไทย · ใช้ระบบ slug ที่มีอยู่ ไม่ต้องเขียนโค้ดใหม่ · ที่ ~6 หน้า × 3 ภาษา = 18 หน้า ยังไหว
ถ้าเว็บโตเกิน ~30 หน้า ค่อยพิจารณาช่องแปลใน block แทน

- **`i18n.js` / `portal-shared.js` ใช้กับเว็บนี้ไม่ได้** — ทั้งคู่เป็น dictionary ข้อความตายตัวในโค้ด แต่เนื้อหาเว็บนี้เป็นข้อมูลใน DB ที่ user แก้เอง
- แผนแปลอัตโนมัติถ้าทำ: `POST /web/translate` ใน ai-proxy (มี Anthropic SDK พร้อมแล้ว) → **แปลตอนกดปุ่มในหลังบ้าน ไม่ใช่ตอนคนเข้าเว็บ** (ไม่งั้นจ่ายทุก visit + ช้า + ตรวจก่อนเผยแพร่ไม่ได้ + Render free หลับ 15 นาที)
- ถ้าทำต้องมี **ป้ายเตือน "ต้นฉบับแก้แล้ว"** (`translated_from` + `translated_at` เทียบ `updated_at` ของต้นฉบับ) — ไม่ใช่ของเสริม เป็นตัวกันหน้า EN ค้างข่าวเก่าเงียบๆ

> หมายเหตุ: บั๊กเก่า 2 ข้อของ field `langs` (renderer เช็ค truthy อย่างเดียว · ติ๊กเขียวได้หลายภาษาพร้อมกัน) **แก้แล้ว** — ตอนนี้ renderer ใช้ `on()` และ contract ตั้ง `exclusive: true`

---

## 15. ยกไปใช้ในโปรเจกต์อื่น — checklist

ระบบนี้พึ่งพา ERP น้อยกว่าที่คิด — แกนจริงคือ 2 ไฟล์ใน `js/shared/`

### ต้องก๊อป

```
js/shared/web-blocks.js        ← แกน (แก้ CATALOG ให้ตรงแบรนด์ใหม่)
js/shared/web-render.js        ← แกน (แก้สี/ฟอนต์)
modules/media/web-editor.*     ← editor ทั้งชุด
modules/media/web-view.*       ← หน้า public
sql/171_web_pages.sql          ← schema
```

### ต้องแก้

| จุด | แก้อะไร |
|---|---|
| `web-blocks.js` → `BRAND_COLORS` | สีแบรนด์ใหม่ (โผล่ในทุก `swatch`) |
| `web-blocks.js` → `defaults` ของทุก block | ข้อความ/สีเริ่มต้นให้ตรงแบรนด์ |
| `web-render.js` | hex ที่ hardcode + ชื่อฟอนต์ (`Anuphan`/`Sarabun`) |
| `web-view.html` | `<link>` ฟอนต์ + สีพื้นหลัง + `#site{max-width}` |
| `web-view-config.js` | Supabase URL + anon key ของโปรเจกต์ใหม่ |
| `web-editor.js` → `pickImage()` | ชื่อ bucket เริ่มต้น (`web-images`) |
| `permissions.js` | perm keys ถ้าโครง perm ต่างกัน |
| `sidebar.js` | เมนู + map เมนู→perm |

### สิ่งที่ระบบพึ่งพาจากภายนอก (ต้องมีหรือหาตัวแทน)

| dependency | ใช้ทำอะไร | ถ้าไม่มี |
|---|---|---|
| Supabase REST (`/rest/v1/`) | อ่าน/เขียน `web_pages` | เปลี่ยนเป็น API ของตัวเองใน `sbGet/sbPatch` (4 จุด) |
| `ImageCompressor.uploadViaRest` | อัปโหลดรูป | เขียนตัวอัปโหลดเอง — คืน URL string เป็นพอ |
| `AuthZ.requirePerm/hasPerm/applyDomPerms` | สิทธิ์ | ถอดออกได้ถ้าไม่มีระบบ perm |
| `ConfirmModal.open({...})` | ยืนยันลบ | มี fallback เป็น `DeleteModal` อยู่แล้ว · **ห้ามใช้ native `confirm()`** ตามกฎโปรเจกต์ |
| `css/main.css` (design system) | `.switch` `.btn` `.modal-*` `.toast-*` `.page-hero` | ต้องมี class เหล่านี้หรือเขียนใหม่ |
| `modalManager.js` | ESC ปิด modal ส่วนกลาง | ต้องใส่ทุกหน้าที่มี modal |
| `topbar.js` / `sidebar.js` | โครง ERP | ถอดออกได้ |

### ลำดับการติดตั้ง

1. รัน [sql/171_web_pages.sql](../sql/171_web_pages.sql) ใน SQL Editor → ตรวจด้วย test query ท้ายไฟล์ (RLS ต้อง = false · seed 9 blocks)
2. สร้าง Storage bucket `web-images` (public read)
3. ก๊อปไฟล์ + แก้ config ตามตารางข้างบน
4. เพิ่ม perm + เมนู
5. เปิด `web-pages.html` → กด ✏️ ที่หน้า home → ลากบล็อกทดสอบ → 💾 → 🌐 ดูเว็บจริง

### สิ่งที่ควรทำต่างจากเดิมถ้าเริ่มใหม่

- **เริ่มจาก section/cell/element ตั้งแต่แรก** ไม่ต้องมีบล็อกสำเร็จรูปแบบ `hero_news`/`product_grid` (พวกนั้นเกิดก่อนโมเดลกริดและปรับแต่งได้น้อย ตอนนี้กลายเป็นภาระที่ลบไม่ได้)
- **ทำ theme token ตั้งแต่วันแรก** (CSS var แทน hex ในตัว renderer) — ย้อนมาทำทีหลังต้องไล่แก้ทุก block
- **สร้างแถวส่วนกลาง (`_layout_*`) ใน SQL seed เลย** + กรอง `isSystemSlug` ออกจากรายการหน้าตั้งแต่แรก

---

## ภาคผนวก — คำถามที่ถามบ่อย

**Q: อยากเปลี่ยนหน้าตาของ block ทั้งเว็บพร้อมกัน ทำยังไง?**
A: แก้ฟังก์ชันของ type นั้นใน `web-render.js` ที่เดียว — canvas และเว็บจริงเปลี่ยนพร้อมกัน ไม่ต้องแตะข้อมูลใน DB เลย

**Q: ผู้ใช้แก้หน้าแล้วหน้าพัง เปิดไม่ขึ้น จะกู้ยังไง?**
A: ไม่มี version history ใน DB — ต้องกู้จาก backup Supabase หรือแก้ JSON ตรงๆ ใน SQL Editor
(`healTree` ซ่อมโครงกริดที่ผิดรูปให้ตอนโหลดอยู่แล้ว จึงไม่ค่อยพังจากสาเหตุนี้)

**Q: เพิ่ม block แล้วไม่โผล่ใน palette?**
A: เช็ค `group` ว่าตรงกับ key ใน `GROUPS` ไหม (block ที่ไม่มี `group` = ตั้งใจให้ไม่โผล่ เช่น `column`)

**Q: ตั้งค่าในแผงแล้วภาพไม่เปลี่ยน?**
A: 3 สาเหตุเรียงตามความถี่ — (1) renderer ยังไม่ได้ใช้ prop นั้น (2) min ของ sanitizer ไม่ตรงกับ field (ค่าถูกตีกลับ default เงียบๆ) (3) ลืมใส่ default ทำให้ `withDefaults` ไม่มีค่านั้น

**Q: หน้า public ขึ้น "ยังไม่มีหน้านี้เผยแพร่"?**
A: `status` ยังเป็น `draft` หรือไม่มีหน้าไหนตั้ง `is_home = true` (ตอนเข้าโดยไม่ใส่ `?slug=`)
