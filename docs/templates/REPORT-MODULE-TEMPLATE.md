# 📊 Report Module — Template / Blueprint

อ้างอิงจาก **Custom Report** ของ Trip (`modules/trip/custom-report.*` + `report-data-source.js`)
ใช้เป็นแม่แบบสร้างหน้า "เลือกคอลัมน์เอง → preview → Excel / Print / PDF / จดหมาย" ให้ module อื่น
(เช่น Event, Booking, IBD, Daily Sale, Stock ฯลฯ)

> สรุป 1 ประโยค: ผู้ใช้ติ๊กคอลัมน์จาก catalog → ผ่าน pipeline `expand → filter → search → sort → group`
> → render เป็น preview สด + export หลายรูปแบบ โดย **logic การ build ตารางใช้ engine กลางตัวเดียว**
> เพื่อให้ "ตอนกดสร้างจดหมาย" กับ "ตอน refresh ในเอกสาร" ได้ผลลัพธ์เป๊ะเหมือนกัน

---

## 1. ไฟล์ที่ประกอบกัน (4 + 1)

| ไฟล์ | หน้าที่ |
|------|---------|
| `xxx-report.html` | โครง DOM + CSS ทั้งหมด (picker, preview table, preview modal A4, print area, lightbox) |
| `xxx-report.js` | State + UI logic ทั้งหน้า (picker, chips, sort/filter/merge popover, preview, export Excel/Print) |
| `xxx-report.lang.js` | lang pack i18n (key `cr.*`) — ลงทะเบียนกับ `I18n.register()` |
| `js/shared/<entity>-fields.js` | **Catalog กลาง** ของคอลัมน์ (single source of truth) — เพิ่มคอลัมน์ที่เดียว |
| `report-data-source.js` | **Engine กลาง** สร้าง HTML ตาราง (letter/insert) จาก `binding` — ใช้ร่วมกับหน้าเอกสาร |

**กฎเหล็ก:** logic catalog + pipeline ใน `xxx-report.js` กับ `report-data-source.js` ต้อง **mirror กัน** —
เพิ่ม/แก้คอลัมน์ calc ต้องแก้ทั้งสองที่ (คอลัมน์ field ปกติดึงจาก catalog กลางจุดเดียวจึงไม่ต้องแก้ซ้ำ)

---

## 2. Catalog กลาง (single source of truth)

`js/shared/<entity>-fields.js` — เพิ่มคอลัมน์ใหม่ 1 entry ที่นี่ที่เดียว แล้วมันโผล่ทุกหน้าที่กิน catalog

```js
// schema ต่อ field
{
  key: "passport_id",            // ชื่อคอลัมน์ใน DB
  th:  "เลขพาสปอร์ต",            // label ไทย (fallback)
  en:  "Passport no.",           // label อังกฤษ (EN + Excel)
  xlsx:"Passport No.",           // header Excel (ถ้าไม่ใส่ = ใช้ en)
  cr:  { group:"checkseat", fmt:"date" }, // config ฝั่ง report — ไม่มี cr = ไม่โผล่ใน report
  // group: id ของกลุ่ม · fmt: "date"|"gender"|"image" (optional)
}
```

API ที่ catalog ต้อง expose (เลียนแบบ `PaxFields`):
- `crCols(groupId)` → `[{key,label,en,src:"pax",fmt}]` ให้ report เอาไปใส่ใน `COLUMN_GROUPS`
- `byKey(key)`, `th(key)`, `en(key)` — label helpers

> **src ของคอลัมน์มี 2 แบบ:**
> - `src:"pax"` = field ตรงในตารางหลัก (อ่าน `row[key]` ตรงๆ) — มาจาก catalog
> - `src:"calc"` = ค่าที่ join/คำนวณเอง (เก็บใน `state.calc[code][key]`) — hardcode ใน `COLUMN_GROUPS`

---

## 3. COLUMN_GROUPS — โครงคอลัมน์ที่ผู้ใช้เลือก

```js
const COLUMN_GROUPS = [
  { id:"checkseat", label:"🪑 หลัก",  cols: window.XxxFields.crCols("checkseat") }, // จาก catalog
  { id:"room",      label:"🛏️ ห้อง",  cols:[ {key:"_hotel",label:"โรงแรม",src:"calc"}, ... ] }, // calc hardcode
  ...
];
const COL_BY_KEY = {};
COLUMN_GROUPS.forEach(g => g.cols.forEach(c => COL_BY_KEY[c.key] = c)); // flat lookup
```

- กลุ่ม `src:"pax"` → ดึงจาก catalog (auto-update เมื่อเพิ่ม field)
- กลุ่ม `src:"calc"` (relation/join) → hardcode เพราะค่ามาจาก fetch แยก + คำนวณ

---

## 4. State shape (หัวใจของหน้า)

```js
const state = {
  // data
  trip:null, pax:[], calc:{},          // pax = แถวข้อมูล · calc[code] = ค่า join (ห้อง/รถ/บิน)
  templates:[],                        // preset คอลัมน์ (เก็บใน DB ใช้ซ้ำได้)
  // user selection
  selected:[],                         // column keys เรียงตามลำดับแสดง (= ลำดับคอลัมน์จริง)
  collapsed:{},                        // group id → ยุบ picker
  sort:[],                             // multi-sort chain [{key,dir:1|-1}] · ลำดับ = priority
  search:"",                           // ค้นทั่วตาราง (AND ทุก token ข้ามทุกคอลัมน์)
  filters:{},                          // key → Set([ค่าที่เลือก]) · ว่าง = ไม่กรอง
  merged:{},                           // key → true = ผสานเซลซ้ำ (rowspan)
  hidden:{},                           // key → true = ซ่อนจาก export (ยังใช้ sort/filter ได้)
  // group + total
  groupBy:"", showTotal:false,
  // print
  layout:"table",                      // "table" | "card"
  orientation:"landscape", rowsPerPage:"auto", cardsPerPage:2, cardFieldPos:"top",
};
```

---

## 5. Data Pipeline (สำคัญที่สุด — copy logic นี้ได้เลย)

```
loadAll()  →  fetch ทุกตารางขนาน (Promise.all)
           →  รวม sub-row (inherit field ว่างจาก parent)
           →  + แถวพิเศษ (เช่น ทีมงาน) ต่อท้าย
           →  buildCalc()  : join relation → state.calc[code] = {ค่า calc ทุกตัว}

getRows()  =  sort( search( filter( expandedPax() ) ) )
              ── expandedPax : ถ้าเลือกคอลัมน์ที่ทำให้ 1 แถวแตกเป็น N (เช่น คน×โรงแรม) → แตกแถว
              ── filterRows  : AND ทุกคอลัมน์ที่มี filter set · ค่าว่าง = BLANK_VAL sentinel
              ── searchRows  : split คำด้วย space → ทุก token ต้อง match (AND) ใน join ของทุก cell
              ── sort        : multi-key chain · localeCompare numeric · pin ใช้ rank พิเศษ

getGroups(rows) → แบ่ง section ตาม groupBy (รักษาลำดับ sort ภายในกลุ่ม)
computeRowspans(rows,cols) → คำนวณ rowspan สำหรับ merge (hierarchical: เคารพ boundary คอลัมน์ซ้าย)
```

**Sentinel ที่ต้องมี:**
- `BLANK_VAL = "__BLANK__"` — แทนค่าว่างใน filter set (เพื่อให้กรอง "ที่ว่าง" ได้)
- `HAS_IMG_VAL = "__HAS_IMG__"` — คอลัมน์รูปกรองแบบ binary มี/ไม่มีภาพ (URL ไม่ซ้ำ → กรองตาม URL ไร้ประโยชน์)

**cellValue(row, col)** = จุดเดียวที่แปลง row+col → ค่า string (date/gender/image/calc/team) —
ทุกอย่าง (preview, export, filter, sort, search) เรียกผ่านฟังก์ชันนี้เพื่อให้ค่า **ตรงกันเสมอ**

---

## 6. ฟีเจอร์ UI ต่อคอลัมน์ (header)

| ปุ่ม | ทำอะไร | เงื่อนไขแสดง |
|------|--------|--------------|
| คลิก label | cycle sort: เพิ่มท้าย chain asc → desc → ออก | เสมอ |
| 🔽 filter/merge popover | เลือกค่ากรอง + toggle "ผสานเซล" | distinct 2..50 (filter) หรือมีค่าซ้ำ (merge) |
| 👁 / 🙈 | ซ่อน/แสดงคอลัมน์ใน export (คงไว้สำหรับ sort/filter) | เสมอ |

- **multi-sort badge** = เลข priority บนหัวคอลัมน์ที่ sort หลายชั้น
- **merge auto-sort** = เปิดผสานเซล → ดันคอลัมน์นั้นขึ้นหน้า sort chain อัตโนมัติ (rowspan เกิดได้เฉพาะแถวติดกัน)
- filter popover เป็น **1 ตัวลอยที่ `document.body`** (กัน clip จาก table overflow) + reposition ตาม scroll/resize

---

## 7. Export 3 ทาง + จดหมาย

| ปุ่ม | ฟังก์ชัน | หมายเหตุ |
|------|----------|----------|
| 📥 Excel | `exportReportExcel()` | ใช้ SheetJS (`XLSX`) · AOA + `!merges` ตาม rowspan · เซลล่างใน merge = "" |
| 👁 Preview | `previewReportPrint()` | จำลองหน้า A4 หลายหน้าใน modal · ตัดหน้าตาม rowsPerPage/cardsPerPage · cap `PREVIEW_MAX_PAGES` |
| 🖨 Print/PDF | `exportReportPrint()` | เติม `#cr-print-area` → `waitForImages()` → `window.print()` · `@page` orientation |
| 📄 สร้างจดหมาย | `createLetterDoc()` | สร้าง `trip_documents` ผ่าน **engine กลาง** → เปิด doc-editor |

**Print กับรูป:** print area ซ่อนบนจอ + `loading="lazy"` → ต้อง `waitForImages()` (ปลด lazy เป็น eager + รอ load/error) **ก่อน** `print()` ไม่งั้นภาพว่าง

**2 layout:**
- `table` — ตารางปกติ (rows/A4 = `resolveRowsPerPage()` geometry-based)
- `card` — 1 คน 1 การ์ด (รูปฝั่งขวา) · grid ตาม `computeCardLayout()` · มีโหมด "ภาพเต็มการ์ด" เมื่อเลือกเฉพาะคอลัมน์รูป

---

## 8. Engine กลาง `report-data-source.js` (ทำไมต้องมี)

ปัญหา: ตารางที่ออกใน **จดหมาย** ต้อง build ได้จาก 2 ที่ — (1) ตอนกด "สร้างจดหมาย" ในหน้า report, (2) ตอนกด 🔄 refresh ในหน้าเอกสาร — แล้วต้องได้ HTML **เหมือนกันเป๊ะ**

ทางออก: ยก pipeline (`loadCtx → getRows → renderTableHtml`) มาไว้ใน engine กลาง รับ `binding` object:

```js
binding = { source, trip_id, columns[], hidden{}, merged{}, sort[],
            filters:{key:[...]}, groupBy, showTotal }
// filters เป็น array (ไม่ใช่ Set) เพราะต้อง serialize ลง DB (data_bindings JSONB)

await TripReportData.buildLetterTable(binding) → { html, rowCount }  // fetch สด + render ในครั้งเดียว
```

- `state.filters` (Set) ↔ `binding.filters` (array) — แปลงไป-กลับด้วย `currentBinding()` / `applyBinding()`
- HTML จากจดหมายใช้ **inline-style** (ฝังในเอกสารได้) ตัดคอลัมน์รูปออก (`c.fmt !== "image"`)
- เก็บ `data_bindings` ใน DB → กดรีเฟรชดึงข้อมูลใหม่ตามเงื่อนไขเดิมได้

---

## 9. Checklist สร้าง report ให้ module ใหม่

1. **Catalog** — สร้าง `js/shared/<entity>-fields.js` (FIELDS + `crCols`/`byKey`) หรือต่อยอด catalog เดิม
2. **HTML** — copy `custom-report.html`, เปลี่ยน id/title, libs ที่ใช้ (`xlsx`, `date-format`, `i18n`, catalog, engine, report.js)
   - guard permission: `AuthZ.requirePerm("<perm>")`
3. **report.js** — แก้:
   - `COLUMN_GROUPS` (catalog groups + calc groups ของ entity ใหม่)
   - `loadAll()` / `buildCalc()` — ตาราง + relation ของ entity (Promise.all)
   - sentinel/pipeline/export functions **คงไว้ตามเดิม** (generic แล้ว)
4. **lang.js** — copy แล้วเพิ่ม key `cr.col.*` ของคอลัมน์ใหม่
5. **engine** (ถ้าต้องการจดหมาย/insert) — mirror `COLUMN_GROUPS` + `buildCalc` ใน `report-data-source.js` (หรือทำ engine ของ entity เอง)
6. ทดสอบ: เลือกคอลัมน์ → sort/filter/merge → Excel + Preview + Print + จดหมาย

---

## 10. กับดักที่เจอมาแล้ว (อย่าพลาดซ้ำ)

- **ชื่อ global ชน sidebar.js** — `window.toggleGroup` ถูก sidebar จองไว้ (load หลัง) → ใช้ `crToggleGroup` แทน
- **double-toggle picker** — อย่าใส่ทั้ง inline `onclick` และ document capture listener (toggle 2 ครั้งกลับที่เดิม)
- **filter popover ถูก clip** — ต้อง append ที่ `document.body` ไม่ใช่ใน table cell
- **ภาพว่างตอน print** — ต้อง `waitForImages()` ก่อน `print()`
- **rows/A4 ล้นกระดาษ** — `resolveRowsPerPage()` คิดจาก geometry จริง (`ROW_H ≈ 7.8mm`) ไม่ใช่เลขเดา
- **engine กับ report เพี้ยนกัน** — เพิ่มคอลัมน์ calc ต้องแก้ทั้ง `report.js` และ `report-data-source.js`
- **filters serialize** — ลง DB ต้องเป็น array ไม่ใช่ Set (ดู `currentBinding`)

---

_อ้างอิงโค้ดจริง: `modules/trip/custom-report.js`, `modules/trip/report-data-source.js`, `js/shared/pax-fields.js`, `modules/trip/custom-report.html`_
