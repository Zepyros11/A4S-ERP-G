# 03 — Event, Campaign & Survey

> โดเมนกิจกรรม: [modules/event/](../../modules/event/) (~90 ไฟล์) + [modules/work-plan/](../../modules/work-plan/) (แผนงาน scope=event)
> ตารางหลัก: ดู [02-DATABASE.md](02-DATABASE.md) §3, §4

---

## 1. Events Core (จัดการกิจกรรม)

| ไฟล์ | หน้าที่ |
|------|---------|
| `events-list.html/.js` | ตาราง/รายการกิจกรรม + side panel แก้ไข + แท็บแชท/ประวัติ + filter สถานะ |
| `event-form.html/.js` | ฟอร์มกิจกรรมเต็ม: poster, ticket tiers, attendee field config, ผูก survey |
| `events-api.js` | REST layer CRUD |
| `events-dashboard.html/.js` | KPI (เดือนนี้/สัปดาห์นี้/กำลังจัด) |
| `events-category.html/.js` | ประเภทกิจกรรม (icon/สี) |
| `events-place-list/form.html/.js` | master สถานที่ (lat/lng, แผนที่, ห้อง, บัญชีธนาคาร) |
| `course-series.html/.js` | หลักสูตร + ระดับ (prerequisite chain) |
| `event-poster-gallery.html/.js` | แกลเลอรีโปสเตอร์ |
| `event-log.html/.js` | log กิจกรรม (audit) |
| `event-requests.html/.js` | คำขอจัดงาน (workflow → สร้าง event) |

**Lifecycle สถานะ:** DRAFT → CONFIRMED → ONGOING → DONE (หรือ CANCELLED)
**ตาราง:** `events`, `event_categories`, `course_series`/`course_levels`, `event_logs`, `event_chat_logs`, `places`
**จุดเชื่อม:** `events.bus_trip_id` → `trips` (ผูกรถบัสทริปให้ event), `events.line_groups` JSONB, `events.survey_form_id`

---

## 2. Attendees & Registration (ลงทะเบียน/เช็คอิน)

| ไฟล์ | หน้าที่ |
|------|---------|
| `attendees.html/.js` | รายชื่อผู้เข้าร่วม + เพิ่ม/แก้/ลบ + import + เช็คอินรายวัน + การ์ดผู้เข้าตามรถบัส |
| `attendee-templates.html/.js` | สร้างเทมเพลตฟอร์มแบบ block (reusable) |
| `booking-attendees.html/.js` | ลงทะเบียน walk-in/guest |
| `register.html` + `register-config.js` | **พอร์ทัลลงทะเบียนสาธารณะ (LIFF)** — ไม่ต้อง login |
| `check-in.html/.js` | สแกน QR หน้างาน + เช็คอินแยกรายวัน + การ์ด tag flex |
| `js/shared/attendee-fields.js` | โมเดล field config (blocks ↔ flat) |

**Flex registration:** รองรับทั้ง member + guest; per-event field config (ดู/บังคับกรอกได้); `person_role` = primary/co_applicant/guest
**Field types:** core (locked: member_code/name), std (phone/position/upline → คอลัมน์ DB), text/date/number/check (→ `extra_fields` JSONB), stamp (auto = ชื่อ user), payment
**Multi-day check-in:** เก็บ `checkin_by_day` JSONB ต่อวัน, `checked_in` = rollup (ต้องตั้ง end_date)
**QR:** path คงที่ `event-files/qr/qr_{event_id}_{attendee_id}.png` (upsert ได้)
**Portal toggles (per-event):** `portal_show_qr` (154), `portal_register_checks_in` (155) — pre-reg เป็นฟีเจอร์ตั้งใจ
**ตาราง:** `event_attendees`, `upline_leaders`, `attendee_form_templates`, `event_ticket_tiers`, `event_tag_categories`

### register.html (พอร์ทัลสาธารณะ)
- **Member mode (LIFF):** auto-detect จาก LINE context → ผูก member_code → prefill โปรไฟล์
- **Guest mode:** กรอกชื่อ/เบอร์เอง
- **Auto-link (optional):** proxy `/line/preauth` ตรวจรหัส → token → deep-link ผูกอัตโนมัติ

---

## 3. Promotion & Scheduling (ประชาสัมพันธ์)

### LINE Promote — `line-promote.html/.js`
- ตั้งเวลาโพสต์เข้ากลุ่ม LINE ต่อ event; โหมด D-7/D-3/D-2/D-1/D-0 หรือกำหนดเอง
- มุมมองปฏิทิน; สถานะ SCHEDULED → SENT/FAILED/CANCELLED
- ส่งจริงผ่าน cron `ai-proxy /cron/line-promote` (ทุก 15 นาที)
- ใช้สำหรับคอร์สบริษัท (auto D-7/3/2/1)
- **ตาราง:** `line_groups`, `line_scheduled_posts`

### FB Scheduler — `media-schedule.html/.js`
- ตั้งเวลาโพสต์ Facebook ต่อ event; เลือกเพจ, ข้อความ, สื่อ
- ใช้ `FbApi` (Graph API v25.0, native scheduled_publish_time)
- **ตาราง:** `fb_pages`, `fb_scheduled_posts` (แทน event_media เดิมที่ถูกลบ)

---

## 4. Printing Tools (พิมพ์ป้าย & ใบประกาศ)

### Namecard Generator — `namecard-generator.html/.js`
3 โหมด:
1. **ป้ายชื่อ** — การ์ด 85×60mm, A4 (8/หน้า), export = native print ผ่าน iframe สะอาด (html2canvas ทำชื่อยาว smear)
2. **ป้ายกำหนดเอง** — repeat (logo+text ×N) หรือ sequence (grid A-Z × 1-12 auto-number); รวม VIP+โลโก้+ลำดับ
3. **ใบประกาศ/Certificate** — ตามตำแหน่ง (SVP/VP/AVP/SD/DR), template ใน bucket `cert-templates`

### Table-tent Generator — `table-tent-generator.html/.js`
- ป้ายรายชื่อกลุ่ม/VIP บน A4 (1 แผ่น = ทั้งกลุ่ม) + โลโก้ + BG + เลขลำดับ + ธีมทอง/ดำ

---

## 5. Procurement & Budget (งบประมาณ)

| ไฟล์ | หน้าที่ |
|------|---------|
| `event-budget.html/.js` | งบ + supplier ต่อ event (upsert pattern) |
| `event-suppliers.html/.js` | ภาพรวม vendor ข้าม event |

- spent = Σ amount ที่ status ≠ CANCELLED; progress bar <80% เขียว, ≥80% เหลือง, ≥100% แดง
- service_type: VENUE/CATERING/AV/DECORATION/PRINTING/TRANSPORT/PHOTOGRAPHER/BOOTH/GIFT/OTHER
- แนบไฟล์ → `event-files/documents/`
- **ตาราง:** `event_budget`, `event_suppliers`

---

## 6. Campaign (แคมเปญรีวิว)

> สมาชิกโพสต์รีวิวลงโซเชียล → staff กรอกยอด metric → จัดอันดับ · API ถูกตัดออก (manual-only) · sql/149 ต้องรันมือ

| ไฟล์ | หน้าที่ |
|------|---------|
| `campaign-planning.html/.js` | list + create/edit (legacy) |
| `campaign-form.html/.js` | ฟอร์มสร้าง (ใหม่) |
| `campaign-dashboard.html/.js` | KPI dashboard (read-only) |
| `campaign-register.html/.js` | ลงทะเบียนสมาชิกสาธารณะ (LIFF, public_token) |
| `campaign-calendar.html/.js` | timeline |
| `campaign-report.html/.js` | ผล + ranking |
| `campaign-detail.html/.js` | รายละเอียด 5 แท็บ |

- **Platforms:** TikTok / Instagram / Facebook
- **Ranking:** views / likes / engagement / weighted (ตาม mission points)
- **สถานะ auto:** ตาม start/end_date (Asia/Bangkok): CONFIRMED → ACTIVE → ENDED
- member ผูกบัญชีโซเชียล + ส่ง link → staff กรอกยอด
- **ตาราง:** `campaigns`, `campaign_missions`, `campaign_participants`, `campaign_submissions`

---

## 7. Survey (แบบประเมินความพอใจ)

> ฟอร์ม reusable ผูกหลาย event ได้ · sql/159 ต้องรันมือ

| ไฟล์ | หน้าที่ |
|------|---------|
| `survey-forms.html/.js` | CRUD ฟอร์ม master |
| `survey-fill.html/.js` | ผู้ตอบ (public, `?event=`/`?form=`) |
| `survey-results.html/.js` | วิเคราะห์ผล + CSV |

- **Question types:** rating (1-5), choice, multichoice, text, textarea, number
- ผูก event ผ่าน `events.survey_form_id`
- **ตาราง:** `survey_forms`, `survey_responses`

---

## 8. CS Views & Room Booking — [modules/event/cs-view/](../../modules/event/cs-view/)

กลุ่มหน้าฝั่ง CS/มุมมองเสริม (แยกจากหลังบ้านจัดงาน) + ระบบ **จองสถานที่/ห้อง** (Places & Room Booking, DB §5)

| ไฟล์ | หน้าที่ | ตาราง |
|------|---------|-------|
| `events-bookingRoom.html/.js` | **จองสถานที่/ห้อง** — สร้างคำขอจอง (เลขที่ `RBKQ-YYYYMM-`), เลือก place, วันเวลา, มอบหมาย CS, ผู้เข้าร่วม (member+guest, person_role, tier, payment, slip) | `room_booking_requests`, `room_booking_attendees`, `room_booking_logs`, `places`, `event_ticket_tiers` |
| `events-calendar.html/.js` (+ `topbar-calendar.js`) | ปฏิทินกิจกรรม + การจอง รายเดือน + แท็บแชท (event_chat_logs) + unread badge | `events`, `event_categories`, `room_booking_requests`, `event_chat_logs`, `course_series`/`course_levels` |
| `event-poster-gallery-view.html/.js` | มุมมองโปสเตอร์สำหรับ CS (popup ดูรูป) | `events` (poster) |

> เกี่ยวข้อง: `booking-attendees.html/.js` (§2) = ผู้เข้าร่วมของการจอง · ระบบนี้คล้าย event registration แต่ผูกกับ "การจองสถานที่" แทน "กิจกรรม"

## 9. Work Plan (แผนงาน — scope=event)

- หน้า [modules/work-plan/work-plan-list.html](../../modules/work-plan/work-plan-list.html)`?scope=event` — ตารางแบบ spreadsheet + autosave + JSONB columns/rows
- เปิดจาก events-list (`event_id`) → auto-create plan
- **ตาราง:** `work_plans`, `work_plan_rows`, `work_departments` (รายละเอียดใน [07](07-SETTINGS-NOTIFICATIONS-MISC.md))
