# 01 — Frontend Architecture & Core Infrastructure

> โครงสร้างพื้นฐานฝั่ง frontend: การโหลดหน้า, auth/authz, core modules, components ส่วนกลาง, และ design system

---

## 1. การ Bootstrap หน้า (page lifecycle)

ทุกหน้าที่ต้อง login จะ include script ตามลำดับนี้ (สำคัญมาก เพราะมี dependency):

```html
<script src="../../js/core/config.js"></script>      <!-- 1. Supabase URL/key → localStorage -->
<script src="../../js/core/auth.js"></script>         <!-- 2. ตรวจ session, redirect ถ้าไม่ login, set window.ERP_USER -->
<script src="../../js/core/authz.js"></script>        <!-- 3. permission layer + auto-apply DOM perms -->
<script src="../../js/core/i18n.js"></script>         <!-- 4. boot ภาษา + data-i18n -->
<script src="../../js/core/date-format.js"></script>  <!-- 5. DateFmt -->
<script src="../../js/core/crypto.js"></script>       <!-- (ถ้ามีข้อมูลลับ) -->
<script src="../../js/core/notify.js"></script>       <!-- ระบบแจ้งเตือน -->
<script src="../../js/components/navigation/sidebar.js"></script> <!-- inject เมนู + topbar -->
<script src="../../js/components/modal/modalManager.js"></script> <!-- ESC-close ส่วนกลาง -->
<script src="../../js/core/responsive.js"></script>   <!-- mobile backdrop + FAB -->
<!-- ... -->
<script src="./page-module.js"></script>              <!-- logic ของหน้านั้น -->
```

**ลำดับการทำงานตอนโหลด:**
1. `config.js` sync `SUPABASE_URL`/`KEY` ลง localStorage (`sb_url`, `sb_key`)
2. `auth.js` อ่าน session → ถ้าไม่มี redirect ไป `/login.html`; ถ้ามี set `window.ERP_USER`
3. `authz.js` apply DOM perms ตาม `effective_perms`
4. `i18n.js` โหลดภาษาจาก localStorage แล้ว apply `data-i18n`
5. `sidebar.js` render เมนูลง `.sidebar-menu` + inject topbar; `auth.js` (MutationObserver) ฉีด user chip + logout
6. page module รอ `DOMContentLoaded` แล้วเริ่มทำงาน

---

## 2. Authentication (การเข้าสู่ระบบ)

### Login flow — [login.html](../../login.html)
- ฟอร์มฝั่ง client (ไม่มี backend auth) เรียก Supabase REST ตรง:
  `GET /rest/v1/users?username=eq.X&is_active=eq.true`
- hash รหัสด้วย `crypto.subtle.digest('SHA-256')` เทียบกับ `users.password_hash` (รองรับ legacy `users.password` plaintext)
- ดึง role จาก `role_configs` ตาม `users.roles[]` → union permissions ทั้งหมด + `custom_permissions`
- หา `landing_path` จาก role แรก (fallback: dashboard)

### Session
- เก็บที่ `localStorage.erp_session` (ติ๊ก Remember) หรือ `sessionStorage.erp_session`
- โครงสร้าง: `{ user_id, username, full_name, role/roles[], effective_perms[], custom_permissions, is_active, ... }`
- เข้าถึงผ่าน `window.ERP_USER` (ตั้งโดย auth.js)
- `sessionStorage.erp_redirect` จำหน้าเดิมไว้ไปต่อหลัง login

### Logout
- `window.erpLogout()` → modal ยืนยัน → ล้าง `erp_session` ทั้ง local/session → ไป `/login.html`

> ⚠️ หมายเหตุความปลอดภัย: password เป็น SHA-256 (ไม่มี salt), anon key เปิดเผยฝั่ง client — security model พึ่ง RLS ของ Supabase + permission ฝั่ง UI

---

## 3. Authorization (สิทธิ์) — 3 ระดับ

ดู [js/core/authz.js](../../js/core/authz.js) + [js/core/permissions.js](../../js/core/permissions.js)

**`permissions.js`** — registry ของ permission แบบ tree 3 ชั้น (Module → Sub-module → Action) เช่น `events_view`, `events_create`, `member_decrypt` — รูปแบบ `<module>_<action>`

**`window.AuthZ` API:**
- `hasPerm(key)`, `hasAnyPerm([keys])`, `hasAllPerms([keys])`
- `requirePerm(key)` — page guard; ถ้าไม่มีสิทธิ์ redirect ไปหน้าแรกที่เข้าถึงได้
- `applyDomPerms(root, mode)` — ซ่อน/ปิด element ตาม `data-perm` (เรียกซ้ำหลัง render ตาราง)
- `refresh()` — ดึง role/perm ใหม่จาก Supabase

**3 ระดับการบังคับใช้:**
1. **Page-level:** `AuthZ.requirePerm("events_view")` — กันโหลดหน้า
2. **Element-level:** `<button data-perm="events_create" data-perm-mode="remove|hide|disable">` — auto จัดการ
3. **Code-level:** `if (AuthZ.hasPerm(key)) { ... }`

**ADMIN = all-access:** role `ADMIN` ผ่านทุก check เสมอ (ดู `ALL_ACCESS_ROLES` ใน sidebar.js)

รายละเอียดการตั้งค่า role/perm ดู [07-SETTINGS-NOTIFICATIONS-MISC.md](07-SETTINGS-NOTIFICATIONS-MISC.md)

---

## 4. Core modules ([js/core/](../../js/core/))

| ไฟล์ | global | หน้าที่ |
|------|--------|---------|
| `config.js` | `APP_CONFIG` | Supabase URL/anon key → sync ลง localStorage (`sb_url`,`sb_key`); proxy URL = `localStorage.erp_proxy_url` |
| `supabase.js` | — | reference config (ส่วนใหญ่หน้าอ่าน localStorage ตรง) |
| `auth.js` | `ERP_USER`, `erpLogout()` | session + guard + user chip |
| `authz.js` | `AuthZ` | permission enforcement (ดูข้อ 3) |
| `permissions.js` | — | permission registry tree |
| `crypto.js` | `ERPCrypto` | AES-GCM `encrypt/decrypt`, `hash`, master key (PBKDF2 100k, SHA-256) เก็บ `localStorage.erp_master_key` |
| `date-format.js` | `DateFmt` | `formatDMY`, `parseDMY`, `formatDMYTime` (DD/MM/YYYY, Asia/Bangkok) |
| `i18n.js` | `I18n` | `register()`, `t()`, `apply()`, `mountToggle()`, `onChange()`; `data-i18n`/`data-i18n-html`/`data-i18n-attr`; ภาษา TH/EN เก็บ `erp_lang` |
| `notify.js` | `Notify` | `evaluateRules(trigger, payload)` (LINE), `notifyBell(trigger, payload)`; fire-and-forget, log ลง `notification_log` |
| `line.js` | `LineAPI` | `listChannels`, `getDefaultChannel(purpose)`, `getChannelForEvent`, `multicast(...)`; ถอด token ด้วย ERPCrypto; เรียกผ่าน ai-proxy |
| `fb-api.js` | `FbApi` | Facebook Graph v25.0 — ตั้งเวลาโพสต์ (`scheduled_publish_time`), edit/cancel; cache 60s |
| `companyLogo.js` | `CompanyLogo` | โลโก้จาก `app_settings.company_logo_url` + cache localStorage + fallback A4S |
| `imageCompressor.js` | `ImageCompressor` | `compress`, `compressIfImage`, `uploadViaRest/Client` (1600px JPEG q0.82) |
| `member-format.js` | `MemberFmt` | `displayName(member)` — ถ้าชื่อเป็นบริษัทใช้ `full_name`, ไม่งั้น `member_name`; `isCompany()` |
| `qr-designer.js` | `QRDesigner` | `renderQR(el, payload)` — QR ขาวดำ + โลโก้กลาง (lib qr-code-styling, error correction H) |
| `responsive.js` | — | จัดการ side-panel + backdrop + FAB บนมือถือ |
| `breakpoints.js` / `layoutManager.js` | — | helper breakpoints / layout (ดู note: layout wrappers no-op) |

**[js/utils/](../../js/utils/):**
- `bahtText.js` — `window.BahtText(n)` แปลงเลขเป็นคำอ่านภาษาไทย (ใช้ในเอกสารการเงิน/Petty Cash)
- `lineCronPing.js` — piggyback บน activity ผู้ใช้ ทุก 5 นาที ยิง `/cron/line-promote` ถ้ามีโพสต์ค้าง (กัน GitHub Actions throttle); server throttle 30s

---

## 5. Components ส่วนกลาง ([js/components/](../../js/components/))

### modal/
- `modalManager.js` — ESC-close ส่วนกลาง (ปิด modal ที่ z-index สูงสุด/ล่าสุดก่อน); `window.closeAllModals()`. รองรับ `.open`/`.show`/`*-overlay`
- `confirmModal.js` — `ConfirmModal.open({title, message, okText, tone, icon, details, note}) → Promise<boolean>` (แทน native confirm)
- `deleteModal.js` — `DeleteModal.open(message, onConfirm)` (สไตล์ danger)
- `promptModal.js` — `PromptModal.open({...}) → Promise<string|null>` (text/date/number/textarea)
- `onboardingModal.js` — wizard ตั้งค่า user ใหม่; `enterSave.js` — Enter = submit

> กฎ modal สำคัญ: ขนาดพอดี content (ไม่โหวง ไม่ scroll ภายใน), header form ใช้ class `v-sage-header` (gradient sage), ปิดได้แค่ X/ESC (ไม่ปิดเมื่อคลิก backdrop)

### navigation/
- `sidebar.js` — เมนู dropdown หลายชั้นจาก `MENU` array; expose `window.A4S_NAV = {MENU, BASE_PATH, ID_TO_PERM}`; inject CSS runtime (จองชื่อ class `.sb-*` และ `window.toggleGroup` — หน้าอื่นห้ามตั้งชื่อชน)
- `topbar.js` — `loadTopbar(title, options)`; header sticky + โลโก้ + กระดิ่งแจ้งเตือน + language toggle
- `panel.js` — side panel (`.side-panel`) สำหรับ detail/edit
- `imgPopup.js` — `ImgPopup.show(url)` lightbox

### ui/
- `floatingSave.js` — ปุ่ม Save ลอยล่าง panel
- `iconPicker.js` — เลือก emoji/icon
- `imageGrid.js` — อัปโหลดหลายรูป + preview + reorder + delete
- `loadingButton.js` — ปุ่ม spinner ระหว่าง async

### table/
- ปัจจุบันเป็น stub — logic ตารางอยู่ในแต่ละหน้า

---

## 6. Shared catalogs ([js/shared/](../../js/shared/))

หลักการ "single source of truth" — นิยาม field ที่เดียว ให้หลายหน้าใช้ร่วม

| ไฟล์ | ใช้โดย | สาระ |
|------|--------|------|
| `attendee-fields.js` | attendee-templates, attendees | โครง form builder แบบ block; type: core/std/text/date/number/check/stamp/payment; `blocksToFlat()` ↔ `flatToBlocks()`; custom fields → `extra_fields` JSONB |
| `pax-fields.js` | custom-report, pax-detail, check-seat | catalog คอลัมน์ `tour_seat_check`; แต่ละ field มี `cr`(custom-report config) + `pax`(pax-detail config); group: checkseat/detail |
| `program-tools.js` | operations-hub, program-workspace | catalog 9 tools (participants/rooming/buses/flights/seating/staff/tasks/namecard/reports); `availableFor(type)`, `defaultsFor(type)`, `toolsFor(program, can)` |
| `stock-fields.js` | stock-report | catalog คอลัมน์รายงานสต็อก; group info/qty/value; `crCols(groupId)` |

---

## 7. CSS Design System ([css/](../../css/))

### Theme tokens — `css/core/theme.css`
- **Palette: Sage Green** — `--bg` (#f1eee8), `--surface` (#fff), `--accent` (#3d6b4f / สีเขียวสาขา), `--accent-light`, `--accent-pale`
- **Text:** `--text` (#3a3530), `--text2`, `--text3`
- **Status:** success/danger/warning/info/teal (+ `-pale` variants)
- **Shape:** `--radius` (10px), `--radius-lg` (14px), `--panel-w` (360px), `--topbar-h` (56px), `--page-pad` (28px)
- **Shadows:** soft (neumorphic) + drop หลายขนาด

### Layout & responsive — `css/core/layout.css`, `css/core/responsive.css`
- Desktop-first; **breakpoints มาตรฐาน: 1280 / 1024 / 767 / 480**
- desktop ใช้ **zoom 0.65** (เพิ่ม information density) — ⚠️ ทำให้ popup ที่คำนวณตำแหน่งด้วย JS ต้องหาร zoom (`getBoundingClientRect` ให้ค่า real px)
- primitives: `.page`, `.toolbar`, `.side-panel`, `.edit-panel`
- `.stat-card` (canonical, alias `.kpi-card`)

### Components — `css/components/`
- `buttons.css` (`.btn`, `.btn-primary`, `.btn-outline`, `.btn-danger`), `forms.css`, `card.css`, `components.css` (badge/pill/toast), `animations.css`, `imageGrid.css`

> หมายเหตุ: `css/components/{modal,table}.css` เป็น dead (ไม่ถูก import, ซ้ำกับ common.css); `.layout`/`.content-area`/`#sidebar-container` เป็น no-op wrapper ลบได้

---

## 8. Integration & data flow

- **Supabase REST:** `fetch(`${sb_url}/rest/v1/{table}?{filter}&select=...`)` + headers `apikey` + `Authorization: Bearer` + (POST/PATCH) `Prefer: return=representation`
- **ai-proxy:** base = `localStorage.erp_proxy_url`; ใช้กับ LINE (`/line/*`), กระดิ่ง (`/bell/notify`), cron keepalive, FB proxy — fire-and-forget
- **Storage buckets:** `event-files` (posters/qr/slips/documents), `cert-templates`, `promotion-files`, `ibd-attachments` (private+signed URL), `tour-seat-images`, `badge-logos`, `company-assets`
