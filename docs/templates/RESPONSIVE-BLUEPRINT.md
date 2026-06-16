# Responsive Blueprint

ต้นแบบทำให้หน้า **responsive ได้ทุก device โดยไม่ติดขัดการใช้งาน**
Reference implementation จริง: [`modules/trip/room-assign.html`](../../modules/trip/room-assign.html) (หน้า 2-pane ที่ซับซ้อนสุดในระบบ)

CSS library กลาง: [`css/core/responsive-patterns.css`](../../css/core/responsive-patterns.css) — มาพร้อม `main.css` แล้ว
Breakpoint มาตรฐาน: [`css/core/responsive.css`](../../css/core/responsive.css)

---

## Breakpoint มาตรฐาน (desktop-first — ใช้ `max-width` เท่านั้น)

| ค่า | ระดับ | หมายเหตุ |
|---|---|---|
| `1280px` | desktop ใหญ่ | จำกัดความกว้าง content |
| `1024px` | tablet / laptop | sidebar พับ, 2-col → 1 |
| `767px` | **mobile** | **767 ไม่ใช่ 768** — กัน iPad แนวตั้ง (768px) ตกเป็น layout มือถือ |
| `480px` | mobile เล็ก | ย่อปุ่ม/ฟอนต์ |

> ห้ามตั้ง breakpoint เอง (600/720/900...) — ยึด 4 ค่านี้เท่านั้น

---

## 5 กฎเหล็ก (หน้าใหม่ต้องผ่านครบก่อน merge)

### กฎ #1 — ห้าม horizontal overflow เด็ดขาด
บั๊กที่เจอบ่อยสุด: element บางตัวกว้างเกินจอ → ดันทั้งหน้า → เนื้อหาดูแคบ/มีพื้นที่ว่างด้านขวา
- ข้อความ `white-space:nowrap` ยาวๆ → บนมือถือต้องให้ห่อ หรือใส่ class `.r-wrap`
- รูป/ตาราง → `responsive-patterns.css` คุม `max-width:100%` ให้แล้ว
- ตาราง/บล็อกกว้างที่ย่อไม่ได้ → ครอบด้วย `.r-table-scroll` (เลื่อนในกรอบแทนดันหน้า)

**วิธีตรวจ** (paste ใน Console, ต้องได้ `overflowers: []`):
```js
[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().width>innerWidth+1)
```

### กฎ #2 — Touch target ≥ 44px บนมือถือ
ปุ่ม/แถวที่แตะได้ ต้องสูงพอนิ้วแตะ → ใส่ class `.r-touch` (ปุ่ม) หรือ `.r-touch-row` (แถวรายการ)

### กฎ #3 — จอเล็ก = ทำทีละอย่าง
อย่ายัด 2 แพเนลเคียงกันบนมือถือ → ใช้ **panel toggle** (`.r-pane-switch` + `.r-panes`)
ชุด control เยอะ (ตัวกรอง) → ยุบเป็น **accordion** (`.r-collapse`)

### กฎ #4 — ปุ่ม action หลักเอื้อมถึงเสมอ
ปุ่มเพิ่ม/บันทึก ต้องไม่หลุดขอบบนเวลาเลื่อน → ใช้ **FAB** (`.r-fab`) ลอยมุมล่างขวาบนมือถือ

### กฎ #5 — Fluid vs Fix มีนโยบายชัด
| ประเภท | หน่วย | class |
|---|---|---|
| หัวข้อใหญ่ (h1/h2) | `clamp()` fluid | `.r-h1` / `.r-h2` |
| body / label / ปุ่ม | `px` step ตาม breakpoint | — |
| ความกว้าง layout | `fr` / `minmax` / `%` | `.r-stat-grid` ฯลฯ |
| spacing | token px ชุดเล็ก | `var(--page-pad)` |

---

## Pattern พร้อมใช้ (จาก `responsive-patterns.css`)

### Two-pane → mobile toggle (กฎ #3)
```html
<div class="r-pane-switch">
  <button class="active" data-pane="a" onclick="switchPane('a')">👤 รายชื่อ</button>
  <button data-pane="b" onclick="switchPane('b')">🏨 จัดการ</button>
</div>
<div class="r-panes m-a" id="panes" style="display:grid;grid-template-columns:340px 1fr;gap:14px">
  <div class="r-pane-a">…ซ้าย…</div>
  <div class="r-pane-b">…ขวา…</div>
</div>
```
```js
function switchPane(which){
  var p = document.getElementById('panes');
  p.classList.toggle('m-a', which==='a');
  p.classList.toggle('m-b', which==='b');
  document.querySelectorAll('.r-pane-switch button')
    .forEach(b=>b.classList.toggle('active', b.dataset.pane===which));
}
```
desktop เห็น 2 แพเนล · มือถือเห็นทีละอัน (ปุ่มสลับ sticky บนสุด)
**โบนัส:** ผูก auto-switch — เลือกของฝั่งซ้ายแล้วเด้งไปฝั่งขวาเอง (ดู `switchRaPanel` + wrap `selectPax` ใน room-assign)

### Accordion ตัวกรอง (กฎ #3)
```html
<div class="r-collapse ra-pax-toolbar">
  <input type="text" placeholder="🔍 ค้นหา..." />
  <button class="r-collapse-toggle" onclick="this.closest('.r-collapse').classList.toggle('open')">
    ⚙️ ตัวกรอง <span class="r-collapse-arr">▾</span>
  </button>
  <div class="r-collapse-body">…dropdowns…</div>
</div>
```
desktop: filters กางเสมอ · มือถือ: เหลือปุ่มเดียว กดค่อยกาง

### Stat grid (กฎ #5)
```html
<div class="r-stat-grid"> <div>…</div> …4 cards… </div>
```
desktop เรียงเท่าที่พอ → มือถือ 2 คอลัมน์ → จอจิ๋ว 1 คอลัมน์ (อัตโนมัติ)

### FAB (กฎ #4)
```html
<button class="r-fab" onclick="openCreate()">＋ เพิ่ม</button>
```
โผล่เฉพาะมือถือ · จะ gate ให้โผล่เฉพาะบางสถานะก็ได้ (ดู `.ra-grid.m-manage ~ .r-fab` ใน room-assign)

### Utils
`.r-table-scroll` (ครอบตารางกว้าง) · `.r-wrap` (ห่อข้อความยาว) · `.r-hide-mobile` / `.r-show-mobile`

---

## ✅ Checklist ก่อน merge (ติ๊กให้ครบ)

- [ ] **กฎ #1** — Console snippet ได้ `overflowers: []` ที่ 320 / 375 / 768px
- [ ] **กฎ #2** — ปุ่ม/แถวแตะง่าย (≥44px) บนมือถือ
- [ ] **กฎ #3** — จอเล็กไม่ยัด 2 อย่างเคียงกัน (toggle/accordion แล้ว)
- [ ] **กฎ #4** — ปุ่ม action หลักเอื้อมถึงตอนเลื่อนลง
- [ ] **กฎ #5** — หัวข้อใช้ `.r-h1/.r-h2`, breakpoint ยึด 1280/1024/767/480
- [ ] เดสก์ท็อปไม่กระทบ (ของใหม่อยู่ใน `@media(max-width:767px)` ทั้งหมด)

## 🧪 Test matrix (เปิด DevTools device mode, **zoom 100%**)

| px | device | เช็คอะไร |
|---|---|---|
| 320 | iPhone SE เล็กสุด | stats 1-col, ไม่ล้น |
| 375 | iPhone ทั่วไป | flow หลัก |
| 430 | iPhone Pro Max | — |
| 768 | iPad แนวตั้ง | ต้องยัง **เป็น tablet** (ไม่ใช่ mobile) |
| 1024 | iPad แนวนอน | 2-col เริ่มทำงาน |
| 1280 | laptop | — |
| 1440 | desktop | content ไม่ยืดเกินไป |

> ⚠️ **เช็ค browser zoom = 100% ก่อนเสมอ** — zoom เพี้ยนทำให้ดู "ใหญ่/เล็ก" ผิด ไม่ใช่บั๊ก CSS
