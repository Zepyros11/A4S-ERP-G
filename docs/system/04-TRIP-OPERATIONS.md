# 04 — Trip / Tour & Operations Hub

> [modules/trip/](../../modules/trip/) (~19 ไฟล์), [modules/ticket-portal/](../../modules/ticket-portal/), [modules/operations/](../../modules/operations/) (~24 ไฟล์)
> ตารางหลัก: ดู [02-DATABASE.md](02-DATABASE.md) §6, §13

---

# ส่วน A — Trip / Tour (ระบบเดิม, ยังใช้งานหลัก)

## 1. Trip List (parent) — `trip-list.html/.js`
- รายการทริปทั้งหมด + นับที่นั่งจาก `tour_seat_check` + stat cards
- ปุ่มเปิดเครื่องมือต่อแถว (เปิดด้วย `?trip_id=N`):

| ปุ่ม | เปิด |
|------|------|
| 💺 Check Seat | `check-seat.html?trip_id=N` |
| 🧳 Room+Bus+Flight | `room-assign.html?trip_id=N` |
| 🧑‍🤝‍🧑 Trip Team | `trip-team.html?trip_id=N` |
| ℹ️ Pax Detail | `pax-detail.html?trip_id=N` |
| 📊 Custom Report | `custom-report.html?trip_id=N` |

**ตาราง:** `trips`, `tour_seat_check`

## 2. Check Seat (จัดการผู้เดินทาง) — `check-seat.html`
- โหลดผู้เดินทางจาก `tour_seat_check` (รองรับ parent-child: 1 member → 1-2 rows ผ่าน `parent_code`/`is_sub_row`)
- ตาราง sortable/searchable + คอลัมน์ freeze + resize
- โหมดแก้ไข (FAB) + auto-save (debounced)
- อัปโหลด passport image (compress) + visa PDF → Supabase Storage
- OCR passport ผ่าน ai-proxy `/extract` (Claude Haiku) → กรอก passport_id/exp อัตโนมัติ
- stat cards (Total/Confirmed/ชาย/หญิง/มี passport/...) + report modal drill-down
- multi-select + bulk delete
- **Gender canonical:** เก็บ `'male'`/`'female'` (lowercase) — check-seat ใช้ strict equality

## 3. Room Assign (ห้อง + รถบัส + ไฟลท์) — `room-assign.html/.js`
รวม 3 เครื่องมือในหน้าเดียว (bus-assign.html redirect มาที่นี่)

- **Rooms:** group ด้วย `groupKey = place_id_checkin_checkout` (รองรับหลายโรงแรมในทริปเดียว); `trip_room_occupants` เป็น M:N (1 คน × N ห้อง ต่างวัน); occupant code = pax code หรือ `"g:<guide_id>"`
- **Buses:** `trip_buses` + `trip_bus_occupants` (seat + code); ไกด์ประจำรถ `trip_bus_guides`; pills แสดงทีม
- **Flights (แท็บ):** `trip_flights` + `trip_flight_tickets` (≤5 รูป/ตั๋ว); occupants pivot — ⚠️ ห้ามเอา ticket column กลับไป check-seat
- assign แบบ drag-drop หรือเลือก+คลิก; sidebar แสดง Customers/Team

## 4. Trip Team — `trip-team.html/.js`
- ทีมงานต่อทริป (`trip_guides`); filter ตาม `member_type` (Staff/Guide/Outsource + custom)
- จัดการ member_types แบบ nested modal (auto-gen type_key; system type ลบไม่ได้)
- แสดงใน room-assign sidebar + bus pills

## 5. Trip Docs — `trip-docs.html/.js` + `doc-editor.html/.js`
- เทมเพลต `{{placeholder}}` → จดหมายหัวกระดาษ A4S + ลายเซ็น master → preview/พิมพ์
- doc-editor = WYSIWYG เต็มจอ (rich text, letterhead, signatories, A4 preview, export PDF)
- ไม่ผูกทริปโดยตรง
- **ตาราง:** `trip_documents`, `trip_doc_templates`, `trip_doc_signatories`, `trip_doc_letterheads`

## 6. Custom Report — `custom-report.html/.js` (+ `.lang.js`, `report-data-source.js`)
- เลือกคอลัมน์ (column picker) → จัดเรียง/filter/search → export Excel/PDF/print
- กลุ่มคอลัมน์: Check Seat / ห้องพัก / รถบัส / เครื่องบิน / Detail / ทีมงาน (จาก `pax-fields.js`)
- multi-sort, merge cells, group by, layout table/card
- save preset → `trip_report_templates`
- i18n ผ่าน `custom-report.lang.js` (pilot ของระบบ i18n)

## 7. Pax Detail — `pax-detail.html/.js`
- ตารางข้อมูลส่วนตัวผู้เดินทาง (คอลัมน์จาก `pax-fields.js` `.pax` config + `PAX_DETAIL_ORDER`)
- auto-save ต่อ field (debounced 1s)

## 8. Passport Print — `printPassports.js`
- พิมพ์ชีตรูป passport (2/A4 landscape) + metadata

## 9. Ticket Portal (สาธารณะ) — [modules/ticket-portal/](../../modules/ticket-portal/)
- หน้า public ค้นตั๋ว PDF + passport (ไม่ login), `?trip_id=X`
- **Privacy:** รหัส (code) ตรงเป๊ะ → เผยรายละเอียดเต็ม; ค้นด้วยชื่อ → แสดงแค่ code/name (เลือกแล้วค่อยเผย)
- 3 ภาษา (EN/TH/FR)
- **ตาราง:** `trips`, `tour_seat_check`, `trip_flights`, `trip_flight_tickets`

**Shared catalog:** `js/shared/pax-fields.js` = single source of truth คอลัมน์ผู้เดินทาง (เพิ่มคอลัมน์ที่นี่ → pax-detail + custom-report อัปเดตเอง)

---

# ส่วน B — Operations Hub (โมดูลใหม่, forward-only)

> รวม Trip+Event เป็น "program" เดียว · Phase 1 backbone เสร็จ (schema+hub+registry+sidebar) · เครื่องมือบางส่วนยัง stub · migration (144-152) ต้องรันมือ

## โมเดล
- `programs` = container (`program_type` TRIP/EVENT)
- **Wrapper strategy:** สร้าง `programs` row ที่มี `source_type` (trip/event) + `source_id` ครอบงานระบบเดิม โดย**ไม่แตะ**ตารางเดิม; งานใหม่ (native) `source_type=NULL`
- `enabled_tools` JSONB ควบคุมว่า program นี้เปิดเครื่องมืออะไร

## ไฟล์หลัก

| ไฟล์ | หน้าที่ | ตาราง |
|------|---------|-------|
| `operations-hub.html/.js` | list programs + create/edit/import จากระบบเดิม | `programs` |
| `program-workspace.html/.js` | dashboard 1 program → ปุ่มเครื่องมือตาม enabled_tools + type | `programs` |
| `program-participants.html/.js` | **เครื่องมือแกน** — CRUD คน, member picker จาก `member_persons`, pull จาก event_attendees/tour_seat_check | `program_participants` |
| `program-rooming` / `program-seating` | จับคนเข้าห้อง/โต๊ะ | `program_rooms`/`_occupants`, `program_seating_*` |
| `program-buses` / `program-flights` | รถบัส / ไฟลท์ | `program_buses_flights_staff` |
| `program-staff` | Staff/Guide/Outsource | `program_participants` (subset) |
| `program-tasks` | งาน checklist + Gantt | `program_tasks` |
| `program-namecard` / `program-reports` | พิมพ์ป้าย / export | read participants |
| `operations-tools.html/.js` | launcher เครื่องมือเสริม (docs/survey) + sandbox |

**Catalog:** `js/shared/program-tools.js` — `TOOLS` 9 ตัว, `availableFor(type)`, `defaultsFor(type)`, `toolsFor(program, can)`; แต่ละ tool มี `{key,label,icon,perm,types,ready,path}`

**ตาราง:** `programs`, `program_participants`, `person_profiles` (ข้อมูลส่วนตัวข้าม program), `program_rooms`/`_room_occupants`, `program_seating_tables`/`_assignments`, `program_tasks`, `program_buses_flights_staff`
