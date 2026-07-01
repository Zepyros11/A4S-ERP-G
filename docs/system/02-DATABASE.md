# 02 — Database Schema (Supabase / PostgreSQL)

> รวม ~90 ตาราง แยกตามโดเมน · ที่มา: [docs/database.txt](../database.txt) (core 39 ตาราง) + `sql/*.sql` (189 migrations, 001→164+) + [docs/ER-diagram.md](../ER-diagram.md) (Mermaid)
> หมายเหตุ: แสดงเฉพาะคอลัมน์/FK สำคัญ — ดูคอลัมน์เต็มที่ไฟล์ migration ต้นทาง

**แพทเทิร์นสำคัญ:**
- ตารางที่อ้างถึงสมาชิกใช้ **`member_code` (TEXT, soft link)** ไม่ใช่ FK (members เป็น snapshot ที่ sync ใหม่)
- `places`, `event_ticket_tiers` ก็มักเป็น soft link
- self-FK: `products.parent_id`, `warehouses.parent_id`, `tour_seat_check.parent_code`, `course_levels.prerequisite_level_id`
- JSONB ใช้เยอะ (config, questions, answers, tags, extra_fields, columns, ...)

---

## 1. Inventory & Stock

| ตาราง | หน้าที่ | คอลัมน์/FK สำคัญ |
|-------|---------|------------------|
| `categories` | หมวดหมู่สินค้า | category_id PK, category_name, icon, color, sku_labels(JSONB) |
| `products` | สินค้า master | product_id PK, product_code, category_id FK, base_unit, cost_price, sale_price, **parent_id** (kit/variant, 078) |
| `product_units` | หน่วยนับต่อสินค้า | unit_id PK, product_id FK, unit_name, conversion_qty, is_base_unit |
| `product_images` | รูปสินค้า | image_id PK, product_id FK, url, sort_order |
| `units` | หน่วยนับกลาง (079) | unit master ข้ามสินค้า |
| `warehouses` | คลัง | warehouse_id PK, warehouse_code, warehouse_type, country (096), **parent_id**(self), capacity |
| `warehouse_zones` / `warehouse_locations` / `warehouse_bins` | โซน/location/bin ในคลัง | ลำดับชั้นจัดเก็บ |
| `stock_movements` | บัญชีเดินสต็อก (ledger) | movement_id PK, product_id FK, warehouse_id FK, bin_id FK, movement_type (IN/OUT/INIT/ADJUST/TRANSFER/INTERNAL/RETURN), qty (signed), ref_doc_type, ref_doc_id, moved_at, lot_no, expiry_date |
| `stock_balance` | ยอดคงเหลือ (view/snapshot) | product_id, warehouse_id, bin_id, qty_on_hand |
| `suppliers` | ผู้ขาย | supplier_id PK, supplier_code, payment_terms/credit_days, tax_id, map_url, is_active |
| `purchase_orders` / `po_items` | ใบสั่งซื้อ + รายการ | po_number, supplier_id, warehouse_id, status (DRAFT/APPROVED/RECEIVED/CANCELLED); item: qty_ordered/received, unit_price |
| `sales_orders` / `so_items` | ใบขาย + รายการ | so_number, customer (member_code), order_type (SALE/INTERNAL), status, total_amount; item: qty_ordered/delivered |
| `requisitions` / `requisition_items` | ใบเบิก + รายการ | req_number, warehouse_id, dept_id, purpose_id, requested_by, approved_by, status (DRAFT/PENDING/APPROVED/ISSUED/CANCELLED) |
| `requisition_purposes` | วัตถุประสงค์เบิก | MARKETING/PROMOTION/SAMPLE/INTERNAL/DAMAGE/OTHER |
| `petty_cash_books` / `petty_cash_items` | สมุดเงินสดย่อย (141) | book_no, status; item: line_date, detail, cash_in, amount_out, payee |

> **Stock logic:** On-hand = Σ signed qty จาก `stock_movements`; Reserved = (SO confirmed: ordered−delivered) + (REQ approved: approved−issued); Available = On-hand − Reserved. **PO/SO/REQ ยังไม่ auto-write `stock_movements`** (ต้องบันทึก movement เอง)

---

## 2. Org & System (ผู้ใช้ / สิทธิ์ / config)

| ตาราง | หน้าที่ | คอลัมน์/FK สำคัญ |
|-------|---------|------------------|
| `users` | บัญชีพนักงาน | user_id PK, username, **full_name** (ไม่มี first/last name), password_hash, dept_id/department(dept_code), **role** (legacy) + **roles** JSONB (050, multi-role), custom_permissions, country, line_user_id (030), notification_groups TEXT[] (038), is_active |
| `role_configs` | นิยาม role + สิทธิ์ | role_key PK (ADMIN/MANAGER/STAFF/VIEWER/custom), permissions JSONB[], landing_path (048), is_system |
| `departments` | แผนก | dept_id PK, dept_code, dept_name, manager_id, sort_order |
| `countries` | ประเทศ (096) | country_code, country_name |
| `app_settings` | config key/value | key PK, value(JSONB) — เช่น company_logo_url, member_master_key, inventory_allow_negative |
| `automation_tasks` / `automation_steps` | งาน sync ตั้งเวลา (010/011) | task_type (web_download/api_fetch/file_import), workflow (GH Action), schedule, last_run_at, last_row_count, last_error |
| `sync_config` / `sync_log` | config + log การ sync | credentials เข้ารหัส, next_sync_at; log: source, status, error |

---

## 3. Events & Courses

| ตาราง | หน้าที่ | คอลัมน์/FK สำคัญ |
|-------|---------|------------------|
| `event_categories` | ประเภทกิจกรรม | icon, color |
| `events` | กิจกรรม master | event_id PK, event_code, event_name, event_date, end_date, start/end_time, location, poster_url, status, place_id FK (014), series_id/level_id FK (012), template_id FK (101), survey_form_id FK (159), event_category_id, min_position_level (107), **bus_trip_id** FK→trips (156), portal_show_qr (154), portal_register_checks_in (155), line_groups JSONB (053), attendee_field_config JSONB |
| `event_attendees` | ลงทะเบียน (member+guest) | attendee_id PK, event_id FK, **member_code** (soft), name/phone/email, **person_role** (primary/co_applicant/guest, 037), tier_id FK (021), paid/payment_status/payment_deadline (022)/grace_days_granted (023), checked_in, **checkin_by_day** JSONB (140, multi-day), tags JSONB (024)/tag_notified (025), upline_id, position_level (017), line_user_id, extra_fields JSONB |
| `event_ticket_tiers` | ระดับราคา (021) | tier_name, price, quota |
| `event_tag_categories` | tag ต่อ event (043) | tag_name, tag_color (ตัด detail ออกแล้ว) |
| `event_budget` | งบประมาณต่อ event | budget_total, spent_amount, approved_by |
| `event_suppliers` | vendor ต่อ event | service_type (VENUE/CATERING/AV/...), amount, status, doc_url |
| `event_logs` / `event_chat_logs` | log กิจกรรม / แชท | actor, action, message |
| `event_requests` | คำขอจัดงาน (workflow) | request_code, status (DRAFT/PENDING/APPROVED/REJECTED), event_id |
| `course_series` / `course_levels` | หลักสูตร + ระดับ (012) | series→levels, **prerequisite_level_id** (self) |
| `attendee_form_templates` | เทมเพลตฟอร์มลงทะเบียน (101) | config JSONB, is_default (singleton) |
| `upline_leaders` | master upline สำหรับ filter tier | name |

---

## 4. Campaign & Survey

| ตาราง | หน้าที่ | คอลัมน์/FK สำคัญ |
|-------|---------|------------------|
| `campaigns` | แคมเปญรีวิว (149) | campaign_id PK, name, media JSONB(≤5), start/end_date, status (DRAFT/CONFIRMED/ACTIVE/ENDED/CANCELLED, 163), platforms JSONB, rank_metric (views/likes/engagement/weighted), public_token, register_fields JSONB (157), requirements JSONB (160), reward |
| `campaign_missions` | ภารกิจ (149) | platform, points, sort_order |
| `campaign_participants` | ผู้เข้าร่วม (149/157/158) | member_code (nullable 157), social ids/urls (tiktok/ig/facebook), status, custom_answers JSONB (157), social_images JSONB (158), allow_multi (159) |
| `campaign_submissions` | โพสต์ที่ส่ง (metric กรอกมือ) | post_url, views/likes/comments/shares, status |
| `survey_forms` | ฟอร์มประเมิน (159, reusable) | title, questions JSONB ([{id,type,label,required,options,scale}]), public_token, is_active |
| `survey_responses` | คำตอบ | form_id FK, event_id FK, answers JSONB, respondent_name |

---

## 5. Places & Room Booking

| ตาราง | หน้าที่ | คอลัมน์/FK สำคัญ |
|-------|---------|------------------|
| `places` | สถานที่/โรงแรม | place_id PK, place_name, place_type, address, lat/lng, google_map_url, capacity, has_accommodation, bank_account/payment_instructions (026), image_urls[] |
| `place_rooms` / `place_dining_rooms` | ห้องย่อย/ห้องอาหาร (034) | capacity |
| `meeting_rooms` | ห้องประชุมภายในออฟฟิศ | room_code, branch, facilities JSONB |
| `room_booking_requests` | จองสถานที่ (portal) | request_code, place_id FK, booked_by, cs_id, booking_date, start/end_time, status |
| `room_booking_attendees` | ผู้เข้าร่วมการจอง | member_code (soft), person_role, tier_id, payment_*, line_user_id |
| `room_booking_logs` | audit การจอง | message |

---

## 6. Trip / Tour

| ตาราง | หน้าที่ | คอลัมน์/FK สำคัญ |
|-------|---------|------------------|
| `trips` | ทริป master (087) | trip_id PK, trip_name, start/end_date, status |
| `tour_seat_check` | ผู้เดินทางต่อทริป | id PK, code, trip_id FK, name, **member_code** (soft), seat, **gender** ('male'/'female' canonical, 066), title_prefix (137), nationality (115), passport_id/image/exp/pdf_url (143), visa_image_url, tshirt_size, **is_sub_row** + **parent_code** (self, 1 member→1-2 rows) |
| `trip_rooms` / `trip_room_occupants` | ห้องพัก + ผู้เข้าพัก (089-095) | room: place_id FK, check_in/out; occupant: **member_code** (M:N, 1 คน×N ห้อง); groupKey รวม dates |
| `trip_buses` / `trip_bus_occupants` | รถบัส + ที่นั่ง (102) | bus: designation (113); occupant: seat, code (pax หรือ `"g:<guide_id>"`) |
| `trip_guides` | ทีมงาน (104) | member_type (staff/guide/outsource, 110) |
| `trip_bus_guides` | ไกด์ประจำรถ+ที่นั่ง (105) | seat |
| `trip_flights` / `trip_flight_tickets` / occupants | ไฟลท์ + ตั๋ว + ผู้โดยสาร (116-121) | flight_label, port, departure/arrival; ticket: doc_url, note; occupants pivot |
| `trip_documents` / `trip_doc_templates` / `trip_doc_signatories` / `trip_doc_letterheads` | เอกสารทริป (124) | template {{placeholder}} → body; signatory: signature_data; letterhead: logo+address |
| `trip_report_templates` | preset รายงาน (114) | template_content JSONB |
| `nationalities` (115) / `member_types` (112) | master lookup | flag, name_en/th |

---

## 7. Members & MLM

| ตาราง | หน้าที่ | คอลัมน์/FK สำคัญ |
|-------|---------|------------------|
| `members` | สมาชิก MLM master (001, sync จาก answerforsuccess.com) | **member_code** PK (TEXT), member_name, full_name, phone/email, **password_encrypted** / **national_id_encrypted** (AES-GCM), sponsor_code, upline_code, **side** (ซ้าย/ขวา), position/position_level, package, person_type (บุคคล/นิติบุคคล), is_company (009), country_code (096), national_id_hash (153, ค้นได้), line_user_id/display_name/picture/linked_at (030), line_chat_id (162), birth_date, co_applicant_name/id |
| `member_line_accounts` | LINE หลายบัญชีต่อสมาชิก (028) | line_user_id, is_primary, last_active_at |
| `person_profiles` | ข้อมูลส่วนตัวข้าม program (146) | member_code PK (1:1), passport, medical, emergency_contact, insurance |
| `test_members` | member ทดสอบ (041) | member_code PK (กันปนรายงานจริง) |

**Views/RPC:**
- **`member_persons`** (036/042) — UNION members → 1 หรือ 2 person (primary + co_applicant) สำหรับ dropdown ลงทะเบียน; grant anon (162)
- `members` มี trigram GIN index บนชื่อ (071/164) — ค้นชื่อต้องยิงตาราง members ไม่ใช่ ilike บน view (กัน timeout)
- RPC: member stats, get_chain_up (recursive CTE), get_direct_downline, member data-quality reports

---

## 8. LINE & Facebook Messaging

| ตาราง | หน้าที่ | คอลัมน์/FK สำคัญ |
|-------|---------|------------------|
| `line_channels` | LINE OA (027) | access_token (เข้ารหัส), purpose |
| `line_groups` | กลุ่ม LINE (054) | channel_id, group_id, category |
| `line_scheduled_posts` | โพสต์ LINE ตั้งเวลา | event_id, channel_id, caption, scheduled_at, target_type (push/broadcast), status |
| `line_reply_templates` | ตอบกลับอัตโนมัติ (031) | trigger_keyword/key, reply_text (cache 60s) |
| `line_link_tokens` | token เชื่อมบัญชี (one-time) | token, member_code, source_table, expires_at, used_at |
| `line_verify_sessions` | state ระหว่างเชื่อม | line_user_id, attempts, expires_at, blocked_until |
| `fb_pages` / `fb_scheduled_posts` | เพจ FB + โพสต์ตั้งเวลา (046) | page access_token; post: media_urls[], scheduled_at, status |

---

## 9. Notification & Bell

| ตาราง | หน้าที่ | คอลัมน์/FK สำคัญ |
|-------|---------|------------------|
| `notification_rules` | กฎแจ้งเตือน **LINE** (038) | trigger_key, target_type (role/dept/group/user), target_value JSONB, channel_id, message_template ({{...}}), schedule_anchor/offset/time (040), is_active |
| `notification_log` | log การส่ง LINE | rule_id, recipient, channel, status (sent/failed/skipped), error |
| `bell_notification_rules` | กฎแจ้งเตือน **กระดิ่ง** (in-app, แยกจาก LINE) | trigger_key, targets, title/body_template, link_url |
| `notification_triggers` | catalog trigger key (067) | trigger_key, description, enabled |
| `user_notifications` | inbox กระดิ่งต่อ user (069) | user_id, trigger_key, title, body, read_at, payload_ref |

> สำคัญ: กฎกระดิ่ง (`bell_notification_rules` → `user_notifications`) **แยกขาดจาก** LINE (`notification_rules` → multicast)

---

## 10. IBD (International Business Dev)

| ตาราง | หน้าที่ | คอลัมน์/FK สำคัญ |
|-------|---------|------------------|
| `ibd_countries` | ประเทศ/สาขา (055) | code (NG/NG-LAGOS/NG-KANO/CI/CM/...), name_en/fr, flag, parent_country, is_branch |
| `ibd_complaints` | ฟอร์ม 1 ร้องเรียน/ติดตาม (055) | member_code, topic (product_order/password/commission/service/wrong_sponsor/other), branch_code, details, attachment_urls JSONB, status (new/in_progress/resolved/closed), assigned_to/caretaker (068) |
| `ibd_ewallet_requests` | ฟอร์ม 2 ขอโอน E-Wallet (055) | whatsapp/email, id_document_urls JSONB, holding_photo_url, confirmed/accepted, status (pending/approved/paid/rejected), ref_no |
| `ibd_relocation_requests` | ฟอร์ม 3 ย้าย Location (055) | from_country/to_country FK, acknowledged, status, effective_date |

> Storage `ibd-attachments` เป็น private — เปิดด้วย **signed URL** (RLS 056-061); portal สาธารณะ upload ได้ด้วย anon

---

## 11. Daily Sale / CS

| ตาราง | หน้าที่ | ที่มา (export answerforsuccess) |
|-------|---------|--------------------------------|
| `branches` | สาขา/ช่องทางขาย (020) | branch_code, country_code |
| `daily_sale_bills` | บิลขาย | sub 01 (บิลขายทั้งหมด): bill_no, member, amount, bill_type, business_date (NULL จนปิดวัน) |
| `daily_sale_payments` | ช่องทางชำระ | sub 08: cash/transfer/credit_card/ewallet/gift_voucher |
| `daily_sale_topup_bills` | บิลเติมเงิน | sub 12 |
| `daily_sale_topup_details` | รายละเอียดเติมเงิน | sub 131 |
| `daily_sale_reconcile` | กระทบยอดด้วยมือ | bill_count/value vs system, diff, signature |
| `daily_sale_summary` | สรุปรวม (view/trigger 070) | total_amount, total_cash, ... |
| `promotions` / `promotion_categories` | โปรโมชัน/Catalog ประจำเดือน | promo_month (YYYY-MM), poster_url, category icon/color |

---

## 12. Work Plan

| ตาราง | หน้าที่ | คอลัมน์/FK สำคัญ |
|-------|---------|------------------|
| `work_departments` | หมวดต่อ scope (025) | scope (event/cs/trip), name, color |
| `work_plans` | แผนงาน (1 = 1 spreadsheet) | scope, dept_id, event_id (026), year, columns JSONB (schema คอลัมน์), event_start/end |
| `work_plan_rows` | แถวงาน | plan_id, event_day, row_order, data JSONB (ค่าในเซลล์), owner_user_id, helper_user_ids[] |

> Trip scope ถูกลบแล้ว (2026-05-01) — เหลือ event/cs

---

## 13. Operations / Programs (Hub model — forward-only)

| ตาราง | หน้าที่ | คอลัมน์/FK สำคัญ |
|-------|---------|------------------|
| `programs` | container รวม Trip+Event (144) | program_id PK, program_type (TRIP/EVENT), name, code, start/end_date, status, **enabled_tools** JSONB, **source_type** (NULL/trip/event), **source_id** (soft link ครอบงานเดิม) |
| `program_participants` | roster (145) | member_code (soft), person_role, name, gender, paid, checked_in, tier_id, tags[], extra_fields JSONB |
| `program_rooms` / `program_room_occupants` | ห้องพัก (150) | 1 participant : 1 room (unique) |
| `program_seating_tables` / `program_seating_assignments` | ที่นั่งโต๊ะ (150) | seat_no |
| `program_tasks` | งาน checklist (151) | assigned_to, due_date, status, priority |
| `program_buses_flights_staff` | ขนส่ง+ทีม (152) | type (bus/flight/guide), assignment_data JSONB |

> **กลยุทธ์ forward-only:** งานใหม่จาก Operations Hub ลงตาราง `programs`/`program_participants`; ของเก่า (`trips`,`events`,`tour_seat_check`,`event_attendees`) ไม่แตะ — แสดงคู่กันใน UI

---

## 14. Manual / Misc

| ตาราง | หน้าที่ |
|-------|---------|
| `manual_chapters` / `manual_pages` | คู่มือ (062) — chapter→page, blocks JSONB, is_published |

**Storage buckets:** `event-files`, `cert-templates` (111), `promotion-files`, `ibd-attachments`, `tour-seat-images`, `badge-logos` (134), `company-assets` (135)

---

## 15. Migrations สำคัญเชิงสถาปัตยกรรม

| # | เรื่อง |
|---|--------|
| 001 | members table (core MLM, encrypted fields) |
| 012 | course_series + course_levels (prerequisite chain) |
| 020 | daily_sale 4 ตาราง |
| 025-026 | work_plans (+ event link) |
| 028 / 030 / 036 | member_line_accounts / users.line_user_id / **member_persons view** |
| 037 | person_role (primary/co_applicant/guest) |
| 038 / 040 / 067 / 069 | notification_rules / schedule / triggers / user_notifications |
| 046 | fb_pages + fb_scheduled_posts |
| 048 / 050 | role landing_path / **users.roles JSONB (multi-role)** |
| 055 | IBD module (countries + 3 ฟอร์ม) |
| 062 | manual module |
| 072 | member master key ใน app_settings |
| 087 / 089-095 / 102-105 / 110-121 / 124 | Trip: trips / rooms / buses+guides / flights+tickets / documents |
| 141 | petty cash |
| 144-152 | **Operations Hub** (programs + participants + rooming/seating/tasks/transport) |
| 149 / 157-160 / 163 | campaigns (+ register_fields/social_images/requirements/status) |
| 153 / 164 | members national_id_hash / name trigram index |
| 154-156 | events portal toggles + bus_trip_id |
| 159 | survey_forms + responses |

---

## 16. RLS / Grants (สรุป)

- **Anon (สาธารณะ):** `member_persons` view (162), `campaigns`/`campaign_participants` (public_token), `survey_forms`/`survey_responses` (public_token), `events` (portal register), IBD portal upload → bucket `ibd-attachments`. privacy = token/รหัสตรงเป๊ะ
- **Authenticated:** ตารางส่วนใหญ่ read ได้; write ตาม permission ใน UI
- **service_role (ai-proxy):** bypass RLS สำหรับ webhook/cron
- **Restricted:** `ibd-attachments` (signed URL), `manual_pages` (is_published หรือ editor)
