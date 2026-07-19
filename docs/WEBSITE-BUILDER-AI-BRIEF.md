# Website Builder — บรีฟสำหรับ AI ที่ช่วยออกแบบ/วางแผน

> วางเอกสารนี้ให้ AI ฝั่งวางแผน (เช่น Claude chat) อ่านก่อนออกแบบ/สั่งงานทุกครั้ง
> เป้าหมาย: ให้ task ที่ออกมา "map เข้าโค้ดจริงได้ทันที" ไม่ต้องแปลง mindset

---

## บทบาทของแต่ละฝ่าย

- **AI วางแผน (คุณ)** = คิด concept, ออกแบบ UX, เขียน spec/task + เกณฑ์ "เสร็จเมื่อ"
- **Implementer (Claude Code ในโปรเจกต์)** = อ่านโค้ดจริง, เขียนโค้ด, ทดสอบด้วยเบราว์เซอร์จริง (Playwright)
- คุณ **ไม่เห็นโค้ดจริง** → เขียน task โดยยึด "สัญญา" ในเอกสารนี้ อย่าเดา API/ชื่อไฟล์/ชื่อ class
  ถ้าอ้างชื่อไฟล์/ฟังก์ชันเป๊ะ ให้กำกับว่า "ให้ verify ก่อน" เสมอ (ของจริงมักต่างจากที่เดา)

---

## สถาปัตยกรรมใน 1 ประโยค

**หน้าเว็บ = ข้อมูล (JSON) ไม่ใช่ HTML** · มี renderer เดียวแปลง JSON → HTML ใช้ทั้งตอนแก้ (canvas) และหน้า public จริง → แก้ที่เดียวเปลี่ยนพร้อมกัน

**นี่ไม่ใช่ React/Vue** — ไม่มี "component ที่รับ props แล้ว onChange" อย่าออกแบบเป็นแบบนั้น

---

## โครงสร้างข้อมูล (Data model)

- ตาราง `web_pages` (Supabase) · 1 แถว = 1 หน้าเว็บ
- คอลัมน์: `slug`, `title`, `blocks` (JSONB), `status` (`draft`|`published`), `is_home`
- `blocks` = array ของ `{ id, type, props }`
- `props` = **flat object** เช่น `{ brand:"A4S", brandSize:30, brandColor:"#16240f" }` — **ไม่ nested**
- **ไม่มี DB/API/ตารางแยกต่อ component** — ทุกอย่างอยู่ใน `blocks` ก้อนเดียว

---

## Block = หน่วยเนื้อหา (ตอนนี้มี 9 ชนิด)

`site_header` · `nav_bar` · `ticker` · `hero_news` · `product_grid` · `event_lessons` · `download_grid` · `cta_banner` · `site_footer`

- แต่ละ block นิยามที่ `js/shared/web-blocks.js` (contract) + renderer ที่ `js/shared/web-render.js`
- เพิ่ม block ใหม่ = เพิ่มใน contract (พร้อม `group`, `wire` SVG, `fields`, `defaults`) + เพิ่ม case ใน renderer

---

## Contract คือหัวใจ — เพิ่ม/แก้ field ที่เดียว panel ขึ้นเอง

field หนึ่งตัว = `{ key, label, type, ...opts }`
Editor อ่าน field list → สร้าง properties panel ให้อัตโนมัติ

### field types ที่มีแล้ว (เรียกใช้ได้เลย ไม่ต้องสร้างใหม่)

| type | ใช้ทำ | opts สำคัญ |
|---|---|---|
| `text` | ข้อความบรรทัดเดียว | — |
| `textarea` | ข้อความหลายบรรทัด | — |
| `number` | ตัวเลข | `min`, `max` |
| `range` | slider + ตัวเลข | `min`, `max`, `step`, `unit` |
| `color` | จานสี + ช่อง hex | — |
| `swatch` | ปุ่มสีสำเร็จ + ปุ่ม "+" กำหนดเอง | `swatches:[hex...]` |
| `toggle` | สวิตช์เปิด/ปิด | `exclusive` (เปิดอันเดียวในลิสต์) |
| `select` | dropdown | `options` หรือ `optionsFrom:"pages"` |
| `segment` | ปุ่มเลือก 1 ตัว (ซ้าย/กลาง) | `options:[{value,label}]` |
| `image` | URL + ปุ่มอัปโหลด | `bucket`, `keepAlpha`, `maxDim` |
| `list` | repeater (array ของ object) | `itemFields:[...]` |
| `textsetting` | **ชุดตั้งค่าข้อความรวม** (ข้อความ+ขนาด+น้ำหนัก+สี+จัดวาง) พับได้ | `map:{...}`, `swatches` |

### layout opts (ใส่ใน field ไหนก็ได้)
- `half` — ครึ่งความกว้าง (2 field เรียงคู่)
- `row` — แถวแนวนอน (label ซ้าย / ตัวคุมขวา)
- `section:"ชื่อหมวด"` — marker หัวข้อหมวด (ทำให้ panel นั้นเป็นโหมดแบ่งหมวด)

---

## กฎเหล็ก 7 ข้อ (task ที่ผ่านต้องเคารพ)

1. **ห้ามสร้าง state ใหม่ทับของเดิม / ห้ามรื้อ props เป็น nested**
   หน้าเก่าที่บันทึกแล้วเก็บเป็น flat key ถ้าเปลี่ยนโครง → เปิดไม่ขึ้น/ข้อมูลหาย
   เพิ่มความสามารถ = **เพิ่ม flat key ใหม่ + ตั้ง default** · field ที่รวมหลายค่า (เช่น TextSetting) ใช้ `map` ผูกเข้า key เดิม
   *(นี่คือจุดที่พลาดง่ายสุด — CC เคยเตือนเองว่า "ถ้าสร้าง state ใหม่ทับ หน้าที่บันทึกไว้จะเปิดไม่ขึ้น")*

2. **ค่าใหม่ทุกตัวต้องมี default ใน `block.defaults`**
   ระบบมี `withDefaults` เติมค่าที่ขาดให้หน้าเก่าอัตโนมัติ → backward compatible

3. **renderer ใช้ร่วม 2 ที่ (canvas + public)** → ค่าที่ยิงเข้า `style=""` ต้อง sanitize
   สี = ตรวจว่าเป็น `#hex` จริง · ตัวเลข = clamp ในช่วง · ค่าผิดรูป = ใช้ default
   (กัน CSS injection บนหน้า public ที่คนนอกเห็น)

4. **สั่ง implementer ให้อ่านโค้ดเดิมก่อนเสมอ** — ชื่อ class/helper จริงมักต่างจากที่เดา
   (เคยพลาด: จริงคือ `.form-control` ไม่ใช่ `.form-input` · มี `.switch` กลางอยู่แล้ว ไม่ต้องทำใหม่)

5. **desktop มี global zoom 0.65** — ถ้า spec มีตัวเลข px/breakpoint ให้ระบุว่าเป็น "ค่าที่ตาเห็น"
   ไม่ใช่ pixel จริง (พื้นที่ layout จริง = ค่า ÷ 0.65) — implementer หาร zoom เอง

6. **โลโก้/รูปพื้นใส → PNG (keepAlpha)** · รูปเนื้อหา → JPEG · เก็บ Supabase หรือ Google Drive ตาม bucket

7. **reuse ของกลางเสมอ** — design token, `.switch`, `swatch`, `TextSetting` — อย่าประดิษฐ์ซ้ำ

---

## เขียน task ยังไงให้ map เข้าระบบทันที (ใส่ 4 อย่าง)

1. **ทำอะไร** — 1-2 ประโยค
2. **ผูกกับ prop key ไหน** (ถ้าแก้ของเดิม) หรือ **key ใหม่ + ค่า default** (ถ้าเพิ่ม)
3. **field type ที่ใช้** — เลือกจากตารางข้างบน หรือบอกชัดว่า "ต้องสร้าง type ใหม่ชื่อ…"
4. **เสร็จเมื่อ** — เกณฑ์ทดสอบได้เป็นข้อๆ (implementer จะขับเบราว์เซอร์จริงเช็คตามนี้)

---

## Anti-pattern (อย่าเขียน task แบบนี้)

- ❌ "สร้างตาราง/endpoint สำหรับ component นี้" → ไม่มี ใช้ `blocks` JSONB
- ❌ "สร้าง component รับ `value` แล้ว `onChange`" → mindset React · ที่ถูก = "เพิ่ม field type ใน contract"
- ❌ "เปลี่ยน props เป็น `{ text, size, weight, ... }` (nested)" → พังหน้าเก่า · ที่ถูก = flat key + `map`
- ❌ อ้างชื่อไฟล์/ฟังก์ชัน/class เป๊ะโดยไม่บอกให้ verify

---

## ตัวอย่าง task ที่ "ดี" (แปลจากที่ทำสำเร็จแล้ว)

> **ทำ:** เปลี่ยน control สีตัวอักษรในส่วนหัว จากช่องกรอก hex → ปุ่มสีแบรนด์ + ปุ่มกำหนดเอง
> **ผูก state:** prop key เดิม `brandColor`/`accentColor`/`taglineColor` (ห้ามสร้างใหม่)
> **field type:** สร้าง type ใหม่ `swatch` (ปุ่มสี 4 อัน + "+"), สีแบรนด์ = #16240f #71bf44 #3B6D11 #7c8a72
> **เสร็จเมื่อ:** กดเขียว → preview เป็น #71bf44 ทันที · กด + กรอก #123456 → เปลี่ยน + ปุ่มแบรนด์เลิกไฮไลต์ · ค่าเก่าโหลดกลับถูก
> **ขอบเขต:** แตะเฉพาะส่วนหัว

---

## ไฟล์อ้างอิง (สำหรับ implementer — ให้ verify ก่อนแก้)

- `js/shared/web-blocks.js` — contract (block + field + defaults)
- `js/shared/web-render.js` — renderer เดียว (canvas + public) + ตัว sanitize
- `modules/media/web-editor.js|css` — editor (properties panel, drag&drop)
- `modules/media/web-view.js|html` — หน้า public (ไม่โหลด auth)
- `modules/media/web-pages.js` — หน้าจัดการรายการหน้าเว็บ
- `sql/171_web_pages.sql` — schema (รันมือใน Supabase)

---

## reuse ต่อไป (ตามที่ CC เสนอ — ถูกต้อง)

`TextSetting` (field type `textsetting`) พร้อมใช้กับทุก block ที่มีข้อความ — เมนู, ส่วนท้าย, hero, CTA
เพิ่ม field ทีเดียวได้ครบทั้งระบบ ไม่ต้องเขียน UI ซ้ำ
