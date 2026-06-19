# Responsive Rollout — Checklist ทุกหน้า

Audit 2026-06-17 · เทียบกับ [`RESPONSIVE-BLUEPRINT.md`](RESPONSIVE-BLUEPRINT.md) (5 กฎ)
Reference page ที่ทำเสร็จแล้ว = `modules/trip/room-assign.html`

**สิ่งที่ auto-apply ทุกหน้าแล้ว (ผ่าน common.css/main.css):** desktop density `zoom:0.65` · sidebar drawer ≤767 · `.toolbar` wrap · `.stats-row` auto-fit→2col · `.side-panel`→overlay · `.modal`→bottom-sheet · `.form-grid`→1col · `.form-control` 16px/42px · `.table-wrap{overflow-x:auto}` (เฉพาะตารางที่ "อยู่ใน" wrapper) · `.fab` show (เฉพาะหน้าที่มี element)

**งานที่เหลือ = per-page** (อยู่ใน `<style>` ของแต่ละหน้า) แบ่งเป็น 6 section ด้านล่าง
สถานะ: ⬜ ยังไม่ทำ · 🔧 กำลังทำ · ✅ เสร็จ · ✔️ clean อยู่แล้ว (ไม่ต้องแตะ)

---
## ✅ สรุปผล (รอบ 2026-06-17 — เสร็จทั้ง 6 section)
ตรวจ ~99 หน้า → **แก้จริง 18 จุด ใน 16 ไฟล์** (ที่เหลือ clean/false-positive — global density+sidebar+shared class คุมไว้แล้ว)

**3 anti-pattern ที่เจอซ้ำ (ใช้เป็น checklist หน้าใหม่):**
1. **ตาราง wrapper `overflow:hidden`** → ต้องเป็น `overflow-x:auto` (เจอ: notification-rules, po-form, work-plan wp-list) — hidden ตัดตารางหายบนมือถือ
2. **master-detail 2-pane ยุบที่ 1024/900** → เปลี่ยนเป็น **767** (เจอ: roles, event-log, manual×2, staff-groups, staff-messaging, bell-triggers) — เพราะ laptop zoom 0.65 → effective ~888 ตกไปใน tier 1024/900 เลยกลายเป็น 1คอลัมน์บน laptop (regression). 767 = คง 2-pane บน laptop + ยุบบนมือถือ
3. **`minmax(≥360px,1fr)` + auto-fill** → ใช้ `minmax(min(360px,100%),1fr)` (เจอ: automation) — ไม่งั้นค้าง 360px ล้นจอ <360

**false-positive เยอะจาก audit:** ตารางส่วนใหญ่ wrap แล้ว · dashboard grid เป็น fr + ยุบแล้ว · public pages (ibd-portal/ticket/login) mobile-first ดีอยู่แล้ว · custom modal มี `max-width:9Xvw` ครบ → **ต้อง verify โค้ดจริงก่อนแก้เสมอ**

---

## Section 1 — List / Table pages  (กฎ #1 ตารางต้องเลื่อนในกรอบ + #4 FAB)
ปัญหาหลัก: ตารางกว้างไม่ได้อยู่ใน overflow container → ล้นแนวนอนบนมือถือ

**ผลตรวจ:** audit over-flag เยอะ — ตารางส่วนใหญ่ "อยู่ใน wrapper อยู่แล้ว" (Rule#1 ผ่าน) เหลือแก้จริง 3 หน้า

| สถานะ | หน้า | ผล |
|---|---|---|
| ✅ | modules/customer/members-list.html | แก้ `.search-wrap-with-mode{min-width:380px}` → ≤767 min-width:0 + wrap (ตารางมี `overflow-x:auto` wrapper อยู่แล้ว) |
| ✅ | modules/settings/notification-rules.html | `.nr-table-wrap` `overflow:hidden`→`auto` (เลื่อนแนวนอนได้) |
| ✅ | modules/settings/db_viewer.html | เพิ่ม `@media≤767{.db-table{display:block;overflow-x:auto}}` (dev tool) |
| ✔️ | modules/event/line-promote.html | ตารางอยู่ใน `.table-wrap` แล้ว (bulk-bar = shared class) |
| ✔️ | modules/event/attendees.html · booking-attendees · attendee-templates · events-place-list · event-suppliers · event-budget | ทุกตารางอยู่ใน `.table-wrap` แล้ว |
| ✔️ | modules/ibd/ibd-complaints · ibd-ewallet · ibd-relocation | ตาราง 12 คอลัมน์อยู่ใน `.ibd-table-wrap > overflow-x:auto` แล้ว |
| ✔️ | line-members · daily-sale · suppliers · notifications · users · po-list · requisition-list · petty-cash-list · units-list · products-list · stock-initial-list · trip-list · bell-rules | clean |

## Section 2 — Form pages  (custom 2-col → 1-col + summary/line-item table)
common.css คุม `.form-grid` แล้ว — เหลือ custom layout เฉพาะหน้า

| สถานะ | หน้า | ผล |
|---|---|---|
| ✅ | modules/event/event-form.css | เพิ่ม `@media≤767` ยุบ `.ef-layout`+`.ef-row-2` → 1col + `.tier-table` (6คอลัมน์) เลื่อนแนวนอน (เดิมไม่มี @media เลย) |
| ✅ | modules/event/events-place-form.css | `@media 900`→`767` (คง 2-pane บน desktop ที่ zoom) |
| ✅ | modules/event/media-schedule.css | `.med-form-grid`→1col + reset `.mspan2{grid-column:auto}` บนมือถือ (modal มี max-width+≤768 อยู่แล้ว) |
| ✅ | modules/transactions/sales_order/so_form.html | `.summary-table` +`max-width:100%` (items-table+form collapse มีแล้ว) |
| ✅ | modules/transactions/purchase_order/po-form.html | `.items-table-wrap` `overflow:hidden`→`auto` (ตัวเดียวที่ตัดตาราง — sibling ใช้ auto) |
| ✅ | modules/transactions/requisition/requisition-form.html | `.summary-table` +`max-width:100%` |
| ✔️ | modules/transactions/petty_cash/petty-cash-form.html | จัดการครบแล้ว (form ยุบ ≤680, items-table `min-width:760`+scroll, summary max-width) |
| ✔️ | members-sync · members-import | grid `repeat(3,1fr)` เป็น fr → ไม่ล้นแนวนอน (cosmetic เท่านั้น) |
| ✔️ | settings · company-settings · account · check-in · register · wizard · categories-form · warehouses-form · product-form | clean |

## Section 3 — 2-pane / split layouts  (กฎ #3 stack ≤767)
ปัญหา: grid 2 คอลัมน์/flex side-by-side ไม่ยุบเป็นคอลัมน์เดียวบนมือถือ (ต้อง verify breakpoint จริง)

**ผลตรวจ:** 1024/900 breakpoint เดิมทำให้ laptop (zoom 0.65 → effective ~888) เป็น 1คอลัมน์ → standardize เป็น 767 แก้ทั้ง regression + mobile · roles/event-log ไม่มี @media เลย

| สถานะ | หน้า | ผล |
|---|---|---|
| ✅ | modules/settings/roles.css | เพิ่ม `@media≤767` ยุบ `.roles-layout`+`height:auto` (เดิมไม่มี @media เลย → break) |
| ✅ | modules/event/event-log.css | เพิ่ม `@media≤767` ยุบ `.log-layout` (เดิมไม่มี @media เลย → break) |
| ✅ | modules/event/event-requests.html | โมดัล `.bkq-modal-body` 2 พาเนล (width:50%) → `flex-direction:column` ≤767 |
| ✅ | modules/manual/manual.css | `.man-reader-layout`+`.man-edit-layout` `@media 900`→`767` |
| ✅ | modules/settings/staff-groups.html | `.sg-grid` `1024`→`767` |
| ✅ | modules/settings/staff-messaging.html | `.sm-grid` `1024`→`767` + `.sm-compose{position:static}` ≤767 |
| ✅ | modules/settings/bell-triggers.html | `.trig-layout` `900`→`767` |
| ✅ | modules/work-plan/work-plan.css | `.wp-list-wrap` `overflow:hidden`→`overflow-x:auto` (filter/edit-header มี flex-wrap, grid-wrap มี overflow-x แล้ว) |
| ✅ | modules/trip/trip-docs.html | 2 modal grid (`300px 1fr`, `30% 70%`) → ใส่ class `.doc-split` + `@media≤767{1fr!important}` |
| ✔️ | modules/customer/members-tree.html | `.chain-row` + stat grid เป็น fr → ไม่ล้น (tree zigzag = 2-sided โดยตั้งใจ) |
| ✔️ | check-seat · custom-report · stock-report · catalog · doc-editor · events-bookingRoom · namecard-generator | มี mobile layout แล้ว |

## Section 4 — Dashboards  (กฎ #5 grid collapse ≤767)
**ผลตรวจ: false-positive ทั้งหมด** — dashboard grid เป็น `fr` (ไม่ล้น) + ยุบให้มือถืออยู่แล้วทุกหน้า · chart row ยุบ ≤800-900 เหมาะกับ chart (อ่านง่ายเต็มจอบน laptop) ไม่ต้องแก้

| สถานะ | หน้า | ผล (verified) |
|---|---|---|
| ✔️ | modules/event/events-dashboard.html | `.ed-row-2/3` ยุบ `@media≤900` แล้ว |
| ✔️ | modules/ibd/ibd-dashboard.css | `.ibd-row2` ยุบ `@media≤900` แล้ว |
| ✔️ | modules/customer/members-dashboard.html | `.donut-row` ยุบ ≤800, `.report-grid` ≤900, `.dq-table` มี overflow wrapper |
| ✔️ | modules/report/reports.html | `.kpi-row` ยุบ ≤768 (4→2col) |
| ✔️ | dashboard.html · stock-dashboard.html | clean |

## Section 5 — Public portals & galleries  (มือถือสำคัญสุด — แต่ส่วนใหญ่ดีอยู่แล้ว)
**ผลตรวจ:** public pages clean หมด · เหลือแก้จริง 2 (ev-popup + shared filter-chips)

| สถานะ | หน้า | ผล |
|---|---|---|
| ✅ | modules/event/events.css (`.ev-popup`) | poster 320px fixed ดัน detail หลุด overflow:hidden → เพิ่ม `@media≤640` ซ้อนแนวตั้ง (events-list ใช้) |
| ✅ | css/core/common.css (`.filter-chips`) | เพิ่ม `flex-wrap:wrap` (shared — date chips event module + อื่นๆ กันชิปล้น ≤320) |
| ✔️ | modules/ticket-portal/ticket-search.html | สร้างมาดีแล้ว: search-row wrap, layout ยุบ 860/600/480, min-width ทุกตัว <320 |
| ✔️ | modules/customer-service/promotion-list.html | `.promo-modal{max-width:95vw}` cap inline width:500px แล้ว |
| ✔️ | modules/event/event-poster-gallery.html + cs-view/view | `.epg-grid-*` ยุบ 5→4→3→2 (≤1100/900/640) |
| ✔️ | modules/event/events-list.html | ตารางอยู่ใน `.table-wrap` · date chips = shared (แก้แล้ว) |
| ✔️ | modules/event/events-category.html | `.ecat-row-3{1fr 1fr 120px}` fr ดูดพื้นที่ ไม่ล้น ≤320 |
| ✔️ | ibd-portal/* (home·my-requests·login·3 forms) · login.html · index.html · manual-list · promotion-gallery | clean (mobile-first) |

## Section 6 — Editors & dev-tools  (priority ต่ำ)
| สถานะ | หน้า | ผล |
|---|---|---|
| ✅ | modules/dev-tool/automation.html | `.task-grid` → `minmax(min(360px,100%),1fr)` (กัน auto-fill ค้าง 360px ล้นจอ <360) |
| ✔️ | modules/trip/trip-team.html | `.action-group{nowrap}` = กลุ่มปุ่มไอคอนเล็กในเซลล์ (พอดี ไม่ล้น) |
| ✔️ | modules/trip/pax-detail.html | ตารางใน `#pd-table-wrap` (overflow-x) + มี FAB แล้ว |
| ✔️ | modules/trip/doc-editor.html | editor เต็มจอ (flex-col) · panel resize ได้ · เครื่องมือ desktop — ไม่ restructure |
| ✔️ | autocheck · test-members · dev-tool/settings · wizard | clean |

> **Sweep ทั้งโปรเจกต์:** `minmax(≥340px,1fr)` มีที่เดียว (automation — แก้แล้ว) · custom modal ที่เหลือ (promo/med/ev-popup/bkq) มี `max-width:9Xvw` ครบ

---

## วิธีตรวจแต่ละหน้า (paste ใน Console, ต้องได้ array ว่าง)
```js
[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().width>innerWidth+1).map(e=>e.className||e.tagName)
```
ทดสอบที่ 320 / 375 / 768px · **browser zoom = 100% เสมอ**
