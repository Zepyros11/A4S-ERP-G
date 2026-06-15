# 📄 Document-Form Module — Template / Blueprint

อ้างอิงจากหน้า **เอกสาร** ของ Trip (`modules/trip/trip-docs.*` + `doc-editor.*` + `report-data-source.js`)
ใช้เป็นแม่แบบสร้างหน้า "ทำเอกสารจากแม่แบบ → กรอกข้อมูลแบบฟอร์ม → render เป็นจดหมายหัวกระดาษ → พิมพ์/ส่งออก"
ให้ module อื่น (เช่น สัญญา, ใบเสนอราคา, หนังสือรับรอง, ใบรับของ ฯลฯ)

> **สรุป 1 ประโยค:** แม่แบบ (template) เก็บเนื้อหา HTML ที่มี `{{ช่องกรอก}}` →
> ตอนสร้างเอกสาร ระบบ **gen ฟอร์มอัตโนมัติจาก placeholder** ให้กรอก →
> แทนค่า → ได้ `body` (HTML) → ห่อด้วย **หัวกระดาษ (letterhead) + บล็อกลายเซ็น (signatory)** →
> preview / print / export PDF·PNG · ทุกอย่างเก็บเป็น HTML จึงแก้ต่อได้อิสระหลังสร้าง

> **แก่นของ "ฟอร์มในรูปแบบเอกสาร":** ไม่มี form schema แยก — **placeholder `{{...}}` ในเนื้อความ = นิยามฟอร์ม**
> ฟอร์มที่ผู้ใช้กรอกถูกสร้างสด ๆ จากการ regex หา placeholder ในแม่แบบ ดังนั้นเพิ่ม/ลบช่องกรอก = แก้ข้อความในแม่แบบเท่านั้น

---

## 1. ไฟล์ที่ประกอบกัน (3 + shared)

| ไฟล์ | หน้าที่ |
|------|---------|
| `xxx-docs.html` | โครง DOM + CSS ทั้งหมด: 2 แท็บ (เอกสาร/แม่แบบ) · stats · table+bulk bar · **6 modal** (สร้างเอกสาร, นำเข้า Excel, แก้เอกสาร[legacy], แม่แบบ, preview, จัดการผู้ลงนาม, จัดการหัวกระดาษ) · `#printArea` ซ่อน · `#pdfHolder` นอกจอ |
| `xxx-docs.js` | Controller ทั้งหน้า: state · CRUD 4 entity · RTE · placeholder engine · Excel import · export PDF/PNG · compose/preview/print |
| `doc-editor.html` + `.js` | **หน้าแก้เอกสารเต็มจอ WYSIWYG A4** (เปิดต่อด้วย `?doc_id=N`) — modal แก้เอกสารในหน้า list ถูกแทนแล้ว (`_openDocEditModal` = dead) |
| `report-data-source.js` *(optional)* | Engine กลางสร้างตารางข้อมูลสดในเอกสาร (ปุ่ม 🔄 รีเฟรช) — ใช้เฉพาะเอกสารที่ผูก data binding · ดู [REPORT-MODULE-TEMPLATE.md](REPORT-MODULE-TEMPLATE.md) |
| shared | `js/core/{auth,authz,date-format}.js` · `js/components/modal/{deleteModal,modalManager,enterSave}.js` · `navigation/{sidebar,topbar}.js` |

**กฎเหล็ก:** ฟังก์ชัน compose/letterhead/placeholder (`composeDocHtml`, `buildLetterheadHead`, `resolveLetterhead`, `extractFields`, `renderTemplate`) คือหัวใจที่ใช้ซ้ำทุกที่ (preview, print, export, import, doc-editor) — แก้ที่เดียวให้กระทบทุกทางออก

---

## 2. Data Model — 4 ตาราง (migration 124+)

```
trip_doc_templates   (แม่แบบ)         1 ──< trip_documents (เอกสาร instance)
trip_doc_signatories (ผู้ลงนาม master)      >── signatory_id
trip_doc_letterheads (หัวกระดาษ master)     >── letterhead_id
```

| ตาราง | คอลัมน์สำคัญ | หมายเหตุ |
|-------|--------------|----------|
| `trip_doc_templates` | `template_id`, `name`, `category`, `description`, **`body`** (HTML มี `{{placeholder}}`), `updated_at` | category = select คงที่ |
| `trip_documents` | `doc_id`, `template_id`(nullable FK), `title`, `status`(`DRAFT`/`FINAL`), **`field_values`**(JSONB), **`body`**(HTML render แล้ว), `signatory_id`, `letterhead_id`, `data_bindings`(JSONB), `updated_at` | `body` แก้ต่อได้อิสระ · ลบแม่แบบไม่ลบเอกสาร |
| `trip_doc_signatories` | `signatory_id`, `name`, `title`, **`signature_data`**(base64 PNG data-URL), `updated_at` | รูปฝังเป็น base64 (resize ≤500px PNG คง transparency) |
| `trip_doc_letterheads` | `letterhead_id`, `name`, **`content_html`**(RTE), `logo_position`(left/right/top), `logo_valign`(top/center/bottom), `logo_width`, `is_default`, *(legacy: `company_name`/`address`/`logo_data`)* | default ได้ทีละ 1 · โลโก้ดึงจาก `app_settings.company_logo_url` |

**Perms:** `xxx_docs_view / create / edit / delete` (ลงทะเบียน permissions.js + sidebar permmap) — guard ในหน้า: `AuthZ.requirePerm("xxx_docs_view")` · ปุ่มใช้ `data-perm="..."` + `AuthZ.applyDomPerms(tbody)` หลัง render

**SQL ที่ต้องมี:** สร้าง 4 ตาราง + **grant perm ให้ ADMIN/role ที่เกี่ยว** (ไม่มี admin bypass — ไม่ grant = แม้ ADMIN ก็ไม่เห็นเมนู) · seed หัวกระดาษ default 1 row

---

## 3. State shape

```js
const state = {
  templates: [],          // trip_doc_templates
  docs: [],               // trip_documents
  signatories: [],        // trip_doc_signatories
  letterheads: [],        // trip_doc_letterheads
  company: {},            // app_settings company_* (โลโก้/ชื่อ/ที่อยู่บริษัท)
  tab: "docs",            // "docs" | "templates"
  pickedFields: [],       // placeholder ของแม่แบบที่เลือกตอนสร้างเอกสาร
  editDocId, editTplId, editSigId, editLhId,   // id ที่กำลังแก้ (null = สร้างใหม่)
  sigImgData: null,       // base64 รูปลายเซ็นที่กำลังแก้
  importRows: [],         // raw rows จาก Excel
  selDocs: new Set(),     // multi-select เอกสาร
  selTpls: new Set(),     // multi-select แม่แบบ
  collapsedGroups: new Set(), groupsInitialized: false,  // กลุ่มเอกสารที่พับ (พับทุกกลุ่มครั้งแรก)
};

// fallback หัวกระดาษถ้ายังไม่มี row ใน DB เลย
const LETTERHEAD = { logoUrl, nameEn, addr };
```

`loadAll()` = `Promise.all` ดึง 5 อย่างขนาน (templates / documents / signatories / letterheads / app_settings company_*) → render ทุกแท็บ

---

## 4. Workflow หลัก (4 phase)

### ① สร้างแม่แบบ (Template) — นิยามฟอร์ม
```
openTemplateModal() → พิมพ์เนื้อหาใน RTE (#tplBody) + ใส่ {{ชื่อฟิลด์}}
   ↳ oninput → refreshTplFields() : extractFields(textContent) → โชว์ chips ฟิลด์ที่พบ
saveTemplate() → POST/PATCH trip_doc_templates {name,category,description,body(HTML)}
```
> placeholder อ่านจาก `.textContent` (ไม่ใช่ innerHTML) เพราะ `{{...}}` เป็น plain text ที่อาจถูก RTE ห่อ tag

### ② สร้างเอกสาร (Document) — gen ฟอร์มจาก placeholder
```
openCreateDoc() → เลือกแม่แบบใน dropdown
   ↳ onPickTemplate() : extractFields(tpl.body) → state.pickedFields
                        → gen <input data-field="..."> grid อัตโนมัติ (1 ช่อง/placeholder)
                        → auto-fill ชื่อเอกสารจากชื่อแม่แบบ
createDoc() → เก็บค่า {field:value} → renderTemplate(tpl.body, values) → body
           → POST trip_documents {template_id,title,status:DRAFT,field_values,body}
           → redirect ไป doc-editor.html?doc_id=N (แก้ต่อเต็มจอ)
```

### ③ แก้เอกสาร — เต็มจอ WYSIWYG
```
openDocEdit(id) → location.href = doc-editor.html?doc_id=id
   doc-editor = หัวกระดาษ(non-edit) + #deBody(contenteditable) + ลายเซ็น(non-edit)
              · เปลี่ยน select หัว/ผู้ลงนาม → re-render หัว/ลายเซ็นสด
              · save = PATCH body(HTML) + signatory_id + letterhead_id
```

### ④ ดู/พิมพ์/ส่งออก
```
printDoc(id) / previewDocFromEditor()
   → showPreview() → composeDocHtml(body, sigId, lhId) ใส่ #previewPaper → เปิด modal
   → printPreview() : copy ไป #printPaper → window.print()   (@page A4 · WYSIWYG)
bulkExportDocs/Png() : เลือกหลายฉบับ → render #pdfHolder นอกจอ → html2canvas → jsPDF/PNG → zip
```

---

## 5. Placeholder Engine (หัวใจของ "ฟอร์มในเอกสาร")

```js
// ดึงชื่อฟิลด์จาก {{...}} — unique, เรียงตามที่พบ → ใช้ gen ฟอร์ม + header Excel
function extractFields(body) {
  const re = /\{\{\s*([^}]+?)\s*\}\}/g; ...   // คืน ["ชื่อ-สกุล","วันที่", ...]
}

// แทน {{ฟิลด์}} ด้วยค่า · ค่าว่าง → คง {{ฟิลด์}} ไว้ (เห็นว่ายังไม่กรอก) · escape ค่ากัน markup พัง
function renderTemplate(body, values) {
  return body.replace(/\{\{\s*([^}]+?)\s*\}\}/g,
    (full, key) => { const v = values[key.trim()]; return v ? escapeHtml(v) : full; });
}
```

- **body เก็บเป็น HTML** → `composeDocHtml` inject ตรง ๆ (ไม่ escape body) แต่ `renderTemplate` escape **เฉพาะค่าที่ผู้ใช้กรอก**
- ตั้งชื่อเอกสารอัตโนมัติตอน import: เลือก field ที่ชื่อมีคำว่า `ชื่อ`/`name` ก่อน ไม่งั้น field แรก

---

## 6. Compose เอกสาร = หัว + เนื้อ + ลายเซ็น

```js
composeDocHtml(body, signatoryId, letterheadId)
  = buildLetterheadHead( resolveLetterhead(letterheadId) )   // ① หัวกระดาษ
  + `<div class="doc-body">${body}</div>`                     // ② เนื้อหา (HTML)
  + `<div class="doc-signature">…(name)…title…</div>`         // ③ บล็อกลายเซ็น (ถ้ามี)
```

**resolveLetterhead(id):** `id → row` · ถ้าไม่ระบุ → `is_default` → row แรก → const `LETTERHEAD` (fallback สุดท้าย)
**buildLetterheadHead(lh):** logo (จาก `lh.logo_data` หรือ `app_settings.company_logo_url`) + `content_html` จัด layout ตาม `logo_position`/`logo_valign`/`logo_width` · เส้นใต้เขียว · มี `legacyLetterheadHtml()` fallback ถ้าไม่มี `content_html`
**`.doc-paper`** = กระดาษ A4 จริง (794px) — preview/print/export ใช้ตัวเดียวกัน → WYSIWYG เป๊ะ

---

## 7. Nested Managers (In-Context CRUD ⚙️)

ผู้ลงนาม + หัวกระดาษ = master จัดการผ่าน **modal ซ้อน** (ปุ่ม ⚙️ ข้าง dropdown · ไม่เด้งไปหน้าแยก — ดู `feedback_in_context_crud`)

| Manager | modal | จุดเด่น |
|---------|-------|---------|
| ผู้ลงนาม | `#sigMgrOverlay` | upload รูป → `resizeImageToPngDataUrl(file,500)` (PNG คง transparency) → เก็บ base64 ใน `signature_data` |
| หัวกระดาษ | `#lhMgrOverlay` | RTE `content_html` + ปุ่ม 📥 ดึงข้อมูลบริษัท (`companyLetterheadHtml` จาก app_settings) + **simulator WYSIWYG** (`updateLhSimulator` ครอบ `.doc-paper` จริงแล้ว transform scale) + ⭐ is_default (เคลียร์ตัวอื่นอัตโนมัติ) |

> ปิด manager → re-fill dropdown ในหน้าหลัก (คงค่าที่เลือกไว้) ด้วย `fillSignatorySelect` / `fillLetterheadSelect`

---

## 8. Rich-Text Editor (RTE) — ไม่ใช้ lib

contenteditable `.rte-area` + toolbar ผ่าน `document.execCommand` (B/I/U · จัดซ้าย/กลาง/ขวา · ขนาด · สี · list)

- `initRTE()` ผูก: `mousedown→preventDefault` (คง selection) + `click→execCommand(data-cmd)`
- **ขนาดฟอนต์ px:** ปิด `styleWithCSS` ชั่วคราว → `fontSize "7"` → แปลง `<font size=7>` เป็น `style.fontSize:px` เอง (กันค่าโดด)
- **สี:** `<input type=color>` → `execCommand('foreColor')` · ต้อง `restoreRteRange()` ก่อน (selection หลุดตอนคลิก toolbar)
- อ่าน/เขียน: `getEditorHTML/setEditorHTML` (innerHTML) — **ไม่ใช่ `.value`** · ตรวจว่าง = `textContent.trim()`
- ⚠️ execCommand ไม่ fire `input` ชัวร์ → เรียก `updateLhSimulator()`/`refreshTplFields()` เองหลังทุก action

---

## 9. Excel Import (สร้างหลายฉบับ)

```
เลือกแม่แบบ → downloadImportTemplate() : header = placeholders ล้วน (SheetJS aoa_to_sheet)
            → onImportFile() : XLSX.read({raw:false}) → preview ตาราง (cap 20 แถว)
            → runImport() : 1 แถว = 1 เอกสาร · renderTemplate ต่อแถว
                          · normalize keys ทุก payload ให้ตรงกัน (กัน PGRST102 — ดู project_supabase_batch_insert)
                          · batch POST ทีละ 200
```
- `raw:false` = อ่านค่าตามที่แสดงใน Excel (วันที่/ตัวเลขคงรูปแบบ ไม่กลายเป็น Date object)
- ผู้ลงนาม + หัวกระดาษ เลือกครั้งเดียวใช้กับทุกฉบับ

---

## 10. Export PDF / PNG หลายฉบับ

```
bulkExportDocs() (PDF) / bulkExportPng() (PNG)
  loop เอกสารที่เลือก → renderDocCanvas(d) : composeDocHtml ใส่ #pdfHolder (นอกจอ left:-10000)
                       → waitImages() → html2canvas(scale:2, useCORS)
  PDF: jsPDF a4 · เนื้อยาว > 1 หน้า → addPage วน · 1 ไฟล์/เอกสาร
  → รวมลง JSZip → downloadBlob(zip)
```
- libs: `xlsx` · `html2canvas` · `jspdf` · `jszip` (โหลดใน `<head>`)
- `downloadBlob`: อย่า revoke/remove `<a>` ทันที (Chromium cancel) — หน่วง 5s
- โลโก้ใส่ `crossorigin="anonymous"` + `html2canvas useCORS` ไม่งั้น canvas tainted

---

## 11. รายการ (List) — pattern ที่ติดมาด้วย

- **จัดกลุ่มตามแม่แบบ** (collapsible group row) · เรียงกลุ่มตาม `updated_at` ล่าสุด · พับทุกกลุ่มครั้งแรก
- **multi-select + bulk bar** (checkbox column + เลือกทั้งหมด + แถบลบ/export) — ดู `feedback_multi_select_delete`
- **search + filter** (ชื่อ / แม่แบบ / สถานะ) re-render client-side
- stat cards: ทั้งหมด / ฉบับร่าง / เสร็จสมบูรณ์ / แม่แบบ
- ลบ: ใช้ `DeleteModal`/`ConfirmModal` (ห้าม native confirm — ดู `feedback_no_native_popup`)

---

## 12. Checklist สร้าง document-form ให้ module ใหม่

1. **SQL** — สร้าง 4 ตาราง (`<x>_doc_templates/documents/signatories/letterheads`) + grant perm + seed หัวกระดาษ default
2. **Perms** — ลงทะเบียน `<x>_docs_view/create/edit/delete` ใน permissions.js + sidebar
3. **HTML** — copy `trip-docs.html`: เปลี่ยน id/title/perm · คง 6 modal + `#printArea` + `#pdfHolder` · ใส่ libs (xlsx/html2canvas/jspdf/jszip) · include `modalManager.js` (ESC-close — ดู `feedback_modal_manager_include`)
4. **JS** — copy `trip-docs.js`: เปลี่ยนชื่อตาราง/PK ใน `sbFetch` · placeholder/compose/RTE/import/export **คงไว้** (generic แล้ว)
5. **doc-editor** — copy `doc-editor.*` ถ้าต้องแก้เอกสารเต็มจอ (ไม่งั้นใช้ modal `_openDocEditModal`)
6. **(optional) engine** — ถ้าเอกสารต้องฝังตารางข้อมูลสด ทำตาม [REPORT-MODULE-TEMPLATE.md](REPORT-MODULE-TEMPLATE.md) แล้วต่อ `data_bindings` + ปุ่ม 🔄
7. ทดสอบ: แม่แบบ {{ฟิลด์}} → สร้างเอกสาร (ฟอร์ม gen ครบ) → แก้ → preview = print → export PDF/PNG → import Excel

---

## 13. กับดักที่เจอมาแล้ว (อย่าพลาดซ้ำ)

- **body เป็น HTML ไม่ใช่ plain text** — อ่าน/เขียนด้วย innerHTML · plain-text body เก่าจะ render collapsed
- **placeholder อ่านจาก `.textContent`** (ไม่ใช่ innerHTML) เพราะ `{{}}` อาจถูก RTE ห่อ tag
- **escape ถูกจุด** — escape เฉพาะค่าที่ผู้ใช้กรอก (`renderTemplate`) · ห้าม escape body ทั้งก้อน (จะเห็น tag เป็นตัวหนังสือ)
- **print หน้าว่าง** — `@page{size:A4;margin:0}` + print คง width/padding เดิมของ `.doc-paper` (ห้าม override 100%/0) + inline `display:none` ต้อง override ตอนพิมพ์
- **canvas tainted ตอน export** — โลโก้ต้อง `crossorigin` + `html2canvas useCORS` + `waitImages()` ก่อน render
- **PGRST102 ตอน import** — normalize keys ทุก payload ให้ตรงกัน (ดู `project_supabase_batch_insert`)
- **ไม่ grant perm = ADMIN ก็ไม่เห็น** — permission system ไม่มี admin bypass (ดู `project_permission_system`)
- **execCommand ไม่ fire input** — เรียก simulator/refresh เองหลังทุก toolbar action
- **modal เปิด/ปิดด้วย `.open`** (ไม่ใช่ .active/.show — ดู `project_modal_pattern`) · form modal ไม่ปิดตอนคลิกนอกกรอบ (ดู `feedback_no_backdrop_close`)

---

_อ้างอิงโค้ดจริง: `modules/trip/trip-docs.html`, `modules/trip/trip-docs.js`, `modules/trip/doc-editor.*`, `modules/trip/report-data-source.js`_
