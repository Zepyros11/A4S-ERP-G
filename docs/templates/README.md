# Page templates

หน้าใหม่ทุกหน้าควร copy จาก template ต่อไปนี้แล้วเติม slot:

| Template | ใช้กับ | ไฟล์ |
|---|---|---|
| **Internal page** (มี topbar + sidebar) | ทุกหน้าใน ERP สำหรับพนักงาน | [`page-template.html`](./page-template.html) |
| Standalone page (ไม่มี shell) | LIFF, kiosk, ลูกค้าทั่วไปที่ไม่ login | _ยังไม่ได้เขียน — ดู `modules/event/register.html` เป็น reference_ |
| Customer portal (ลูกค้า login) | ลูกค้าใช้ผ่าน portal แยก | _ยังไม่ตัดสินใจ architecture — รอ Step 3_ |

## Slots

| Slot | ตัวอย่าง |
|---|---|
| `{{TITLE}}` | `"🌍 IBD Dashboard"` |
| `{{MODULE_CSS}}` | `"ibd-dashboard"` (จะ link เป็น `./ibd-dashboard.css`) |
| `{{MODULE_JS}}` | `"ibd-dashboard"` (จะ link เป็น `./ibd-dashboard.js`) |
| `{{PERM_KEY}}` | `"ibd_dashboard_view"` (key ใน `permissions.js`) |

## โครงสร้างที่บังคับ (อย่าเอาออก)

```
<div class="loading-overlay" id="loadingOverlay"><div class="spinner"></div></div>
<div class="toast" id="toast"></div>
<div class="topbar"></div>
<div class="page"> ... </div>
```

ถ้าหน้าไหน "ไม่ใช้" loadingOverlay หรือ toast ก็ยังควรปล่อยไว้ — ไม่กิน performance และเป็น insurance ว่า `showToast()` / `showLoading()` ที่ใช้ทั่วโปรเจกต์จะทำงานเสมอ

## โครงสร้างที่ "ไม่ต้องใส่" (เคยมีในหน้าเก่า แต่เป็น dead wrapper)

```html
<!-- ❌ ไม่ต้อง — .layout, .content-area ไม่มี CSS rule + ไม่ถูกอ้างใน JS -->
<div class="layout">
  <div id="sidebar-container"></div>     <!-- ❌ ไม่ต้อง — sidebar.js ไม่ใช้ id นี้ -->
  <div class="content-area">
    <div class="page"> ... </div>
  </div>
</div>
```

ถ้าหน้าเก่ามี wrappers เหล่านี้ → migrate ตอนแก้หน้านั้นได้เลย ไม่กระทบอะไร (audit ยืนยัน 0 references ใน css/js)

## Script ordering — ทำไมเรียงแบบนี้

1. **Core** (`auth.js`, `authz.js`, `date-format.js`) — ต้องโหลดก่อน module JS เพราะ module JS อาจเรียก `AuthZ.*` หรือ `formatDate()`
2. **Permission gate** (optional) — เรียก `AuthZ.requirePerm()` หลัง authz.js โหลด ถ้าไม่ผ่านจะ redirect ทันที (ก่อน module JS run = ป้องกัน flash of unauthorized content)
3. **Module JS** — โค้ดของหน้านี้
4. **Topbar (module) + Sidebar** — Topbar ใช้ ES module (`import`) เลยใส่หลังเพราะ async
5. **modalManager** — ผูก ESC-listener กับทุก `.modal-overlay.open` ที่อยู่ใน DOM ตอนนั้น → ใส่สุดท้ายให้ครอบคลุม modals ทุกตัวที่ markup ไว้

## Path prefix (`../../`)

Template สมมติว่าไฟล์อยู่ที่ `modules/<area>/<page>.html` (depth 2)

ถ้าหน้าอยู่ลึกกว่า เช่น `modules/transactions/purchase_order/po_form.html` → เปลี่ยนเป็น `../../../`

| Depth | Prefix |
|---|---|
| `modules/<area>/page.html` | `../../` |
| `modules/<area>/<sub>/page.html` | `../../../` |
