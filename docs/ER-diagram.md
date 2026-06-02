# A4S-ERP — ER Diagram

> สร้างจาก `docs/database.txt` (core 39 ตาราง) + `sql/*.sql` migrations (ตารางเพิ่มเติม)
> เปิดดูด้วย Mermaid preview (VSCode: ติดตั้ง "Markdown Preview Mermaid Support" หรือดูบน GitHub)
> หมายเหตุ: แสดงเฉพาะ PK / FK / คอลัมน์สำคัญเพื่อให้อ่านง่าย — ดูคอลัมน์เต็มที่ไฟล์ต้นทาง

ระบบแบ่งเป็นโดเมนหลัก:
1. [Inventory & Stock](#1-inventory--stock) — สินค้า/คลัง/PO/SO/เบิก
2. [Org & System](#2-org--system) — users/แผนก/สิทธิ์/แจ้งเตือน
3. [Events](#3-events) — อีเวนต์/ผู้เข้าร่วม/คอร์ส
4. [Places & Room Booking](#4-places--room-booking) — สถานที่/จองห้อง
5. [Trip / Tour](#5-trip--tour) — ทริป/ห้อง/รถบัส/ไฟลท์/ไกด์
6. [Members (MLM)](#6-members-mlm)
7. [LINE & FB Messaging](#7-line--fb-messaging)
8. [Notification](#8-notification)
9. [IBD](#9-ibd-international-business-dept)
10. [Daily Sale / CS](#10-daily-sale--cs)
11. [Work Plan & Misc](#11-work-plan--misc)

---

## 1. Inventory & Stock

```mermaid
erDiagram
    categories     ||--o{ products          : "category_id"
    products       ||--o{ product_units      : "product_id"
    products       ||--o{ product_images     : "product_id"
    products       ||--o{ po_items           : "product_id"
    products       ||--o{ so_items           : "product_id"
    products       ||--o{ requisition_items  : "product_id"
    products       ||--o{ stock_movements    : "product_id"
    products       ||--o{ stock_balance      : "product_id"
    product_units  ||--o{ po_items           : "unit_id"
    product_units  ||--o{ so_items           : "unit_id"
    product_units  ||--o{ requisition_items  : "unit_id"

    suppliers      ||--o{ purchase_orders    : "supplier_id"
    warehouses     ||--o{ purchase_orders    : "warehouse_id"
    purchase_orders||--o{ po_items           : "po_id"

    customers      ||--o{ sales_orders       : "customer_id"
    warehouses     ||--o{ sales_orders       : "warehouse_id"
    sales_orders   ||--o{ so_items           : "so_id"

    warehouses     ||--o{ requisitions       : "warehouse_id"
    departments    ||--o{ requisitions       : "dept_id"
    requisition_purposes ||--o{ requisitions : "purpose_id"
    requisitions   ||--o{ requisition_items  : "req_id"

    warehouses     ||--o{ warehouse_zones    : "warehouse_id"
    warehouses     ||--o{ warehouse_locations: "warehouse_id"
    warehouses     ||--o{ warehouse_bins     : "warehouse_id"
    warehouse_locations ||--o{ warehouse_bins: "location_id"
    warehouses     ||--o{ warehouses         : "parent_id (self)"
    warehouses     ||--o{ stock_movements    : "warehouse_id"
    warehouse_bins ||--o{ stock_movements    : "bin_id"
    warehouses     ||--o{ stock_balance      : "warehouse_id"

    categories {
        int category_id PK
        varchar category_name UK
        jsonb sku_labels
    }
    products {
        int product_id PK
        varchar product_code UK
        int category_id FK
        int parent_id "self (kit/variant)"
        numeric cost_price
        numeric sale_price
    }
    product_units {
        int unit_id PK
        int product_id FK
        varchar unit_name
        numeric conversion_qty
        bool is_base_unit
    }
    product_images {
        int image_id PK
        int product_id FK
        varchar url
    }
    suppliers {
        int supplier_id PK
        varchar supplier_code UK
    }
    customers {
        int customer_id PK
        varchar customer_code UK
    }
    purchase_orders {
        int po_id PK
        varchar po_number UK
        int supplier_id FK
        int warehouse_id FK
        text status "DRAFT/APPROVED/RECEIVED/CANCELLED"
        int created_by FK
    }
    po_items {
        int po_item_id PK
        int po_id FK
        int product_id FK
        int unit_id FK
        numeric qty_ordered
        numeric qty_received
    }
    sales_orders {
        int so_id PK
        varchar so_number UK
        int customer_id FK
        int warehouse_id FK
        text order_type "SALE/RETURN"
        text status
    }
    so_items {
        int so_item_id PK
        int so_id FK
        int product_id FK
        int unit_id FK
        numeric qty_ordered
        numeric qty_delivered
    }
    requisitions {
        int req_id PK
        varchar req_number UK
        int warehouse_id FK
        int dept_id FK
        int purpose_id FK
        int requested_by FK
        int approved_by FK
        text status
    }
    requisition_items {
        int req_item_id PK
        int req_id FK
        int product_id FK
        int unit_id FK
    }
    requisition_purposes {
        int purpose_id PK
        varchar purpose_code UK
        text purpose_type
    }
    warehouses {
        int warehouse_id PK
        varchar warehouse_code UK
        int parent_id FK
        varchar warehouse_type
        varchar country
    }
    warehouse_zones {
        bigint zone_id PK
        bigint warehouse_id FK
    }
    warehouse_locations {
        bigint location_id PK
        int warehouse_id FK
    }
    warehouse_bins {
        bigint bin_id PK
        int warehouse_id FK
        bigint location_id FK
    }
    stock_movements {
        int movement_id PK
        int product_id FK
        int warehouse_id FK
        bigint bin_id FK
        text movement_type "IN/OUT/TRANSFER/ADJUST/INIT"
        numeric qty
        int created_by FK
    }
    stock_balance {
        int product_id FK
        int warehouse_id FK
        bigint bin_id FK
        numeric qty_on_hand
    }
```

มาสเตอร์เพิ่มเติม (ไม่มี FK แข็ง): `units` (079, หน่วยกลาง), `warehouse_types` (077), `countries` (096)

---

## 2. Org & System

```mermaid
erDiagram
    departments ||--o{ users         : "dept_id"
    users       ||--o{ departments   : "manager_id"
    users       ||--o{ user_roles    : "user_id"
    users       ||--o{ notifications : "user_id"
    users       ||--o{ user_notifications : "user_id"

    departments {
        int dept_id PK
        varchar dept_code UK
        int manager_id FK
    }
    users {
        int user_id PK
        varchar user_code UK
        varchar full_name
        int dept_id FK
        text role "ADMIN/MANAGER/STAFF/VIEWER"
        text roles "jsonb array (multi-role)"
        text username UK
        text department "dept_code"
        text country
    }
    user_roles {
        int role_id PK
        int user_id FK
        varchar module
        varchar role
    }
    notifications {
        int notif_id PK
        int user_id FK
        varchar module
        varchar ref_type
        int ref_id
        bool is_read
    }
    user_notifications {
        int id PK
        int user_id FK
        bigint rule_id FK
    }
    app_settings {
        text key PK
        jsonb value
    }
    role_configs {
        text role_key PK
        jsonb config
    }
```

มาสเตอร์ระบบ: `app_settings` (key/value — เก็บ grace days, member master key ฯลฯ), `role_configs` (นิยาม role + permission), `automation_tasks` / `automation_steps` (sync scheduler)

---

## 3. Events

```mermaid
erDiagram
    event_categories ||--o{ events            : "event_category_id"
    users            ||--o{ events            : "created_by / assigned_to"
    places           ||--o{ events            : "place_id"
    course_series    ||--o{ events            : "series_id"
    course_levels    ||--o{ events            : "level_id"
    course_series    ||--o{ course_levels     : "series_id"
    course_levels    ||--o{ course_levels     : "prerequisite_level_id (self)"

    events ||--o{ event_attendees    : "event_id"
    events ||--o{ event_budget       : "event_id"
    events ||--o{ event_logs         : "event_id"
    events ||--o{ event_media        : "event_id"
    events ||--o{ event_requests     : "event_id"
    events ||--o{ event_suppliers    : "event_id"
    events ||--o{ event_ticket_tiers : "event_id"
    events ||--o{ event_tag_categories : "event_id"

    event_ticket_tiers ||--o{ event_attendees : "tier_id"
    suppliers          ||--o{ event_suppliers : "supplier_id"
    upline_leaders     ||--o{ event_attendees : "upline_id"
    attendee_form_templates ||--o{ events     : "template_id"

    events {
        int event_id PK
        varchar event_code
        date event_date
        int place_id FK
        int event_category_id FK
        int created_by FK
        int assigned_to FK
        int series_id FK
        int level_id FK
        int min_position_level
    }
    event_attendees {
        int attendee_id PK
        int event_id FK
        varchar name
        text member_code
        text person_role "primary/co_applicant/guest"
        int tier_id FK
        int upline_id FK
        bool checked_in
    }
    event_budget {
        int budget_id PK
        int event_id FK
        int approved_by FK
    }
    event_logs {
        int log_id PK
        int event_id FK
        int user_id FK
    }
    event_media {
        int media_id PK
        int event_id FK
        int assigned_to FK
    }
    event_requests {
        int request_id PK
        int event_id FK
        int requested_by FK
        int dept_id FK
        int reviewed_by FK
    }
    event_suppliers {
        int ev_supplier_id PK
        int event_id FK
        int supplier_id FK
    }
    event_ticket_tiers {
        int tier_id PK
        int event_id FK
        numeric price
    }
    event_tag_categories {
        int id PK
        int event_id FK
    }
    course_series {
        uuid id PK
    }
    course_levels {
        uuid id PK
        uuid series_id FK
        uuid prerequisite_level_id FK
    }
    upline_leaders {
        int id PK
        text name
    }
    attendee_form_templates {
        int id PK
        jsonb fields
    }
```

---

## 4. Places & Room Booking

```mermaid
erDiagram
    places ||--o{ place_rooms        : "place_id"
    places ||--o{ place_dining_rooms : "place_id"
    places ||--o{ events             : "place_id"
    places ||--o{ room_booking_requests : "place_id"

    meeting_rooms ||--o{ room_bookings : "room_id"
    events        ||--o{ room_bookings : "event_id"
    users         ||--o{ room_bookings : "booked_by"

    room_booking_requests ||--o{ room_booking_logs      : "request_id"
    room_booking_requests ||--o{ room_booking_attendees : "request_id"
    users                 ||--o{ room_booking_requests  : "booked_by / cs_id"

    places {
        bigint place_id PK
        text place_name
        text place_type
        text province
    }
    place_rooms {
        bigint room_id PK
        bigint place_id FK
    }
    place_dining_rooms {
        bigint id PK
        bigint place_id FK
    }
    meeting_rooms {
        int room_id PK
        varchar room_code UK
        varchar branch
    }
    room_bookings {
        int booking_id PK
        int event_id FK
        int room_id FK
        int booked_by FK
        date booking_date
    }
    room_booking_requests {
        bigint request_id PK
        text request_code
        bigint place_id FK
        bigint booked_by FK
        bigint cs_id FK
        text status
    }
    room_booking_logs {
        bigint log_id PK
        bigint request_id FK
    }
    room_booking_attendees {
        bigint attendee_id PK
        bigint request_id FK
        text member_code
        text person_role
    }
```

---

## 5. Trip / Tour

```mermaid
erDiagram
    trips ||--o{ tour_seat_check : "trip_id"
    trips ||--o{ trip_rooms      : "trip_id"
    trips ||--o{ trip_buses      : "trip_id"
    trips ||--o{ trip_guides     : "trip_id"
    trips ||--o{ trip_flights    : "trip_id"

    places     ||--o{ trip_rooms          : "place_id"
    trip_rooms ||--o{ trip_room_occupants  : "room_id"

    trip_buses ||--o{ trip_bus_occupants : "bus_id"
    trip_buses ||--o{ trip_bus_guides    : "bus_id"
    trip_guides||--o{ trip_bus_guides    : "guide_id"

    trip_flights        ||--o{ trip_flight_occupants : "flight_id"
    trip_flights        ||--o{ trip_flight_tickets   : "flight_id"
    trip_flight_tickets ||--o{ trip_flight_ticket_occupants : "ticket_id"

    tour_seat_check ||--o{ tour_seat_check : "parent_code (self)"

    trips {
        int trip_id PK
        text trip_name
    }
    tour_seat_check {
        uuid id PK
        text code
        int trip_id FK
        text parent_code FK
        numeric seat
        text nationality
        text gender
    }
    trip_rooms {
        int room_id PK
        int trip_id FK
        bigint place_id FK
        date check_in
        date check_out
    }
    trip_room_occupants {
        int id PK
        int room_id FK
        text member_code
    }
    trip_buses {
        int bus_id PK
        int trip_id FK
        text designation
    }
    trip_bus_occupants {
        int id PK
        int bus_id FK
    }
    trip_guides {
        int guide_id PK
        int trip_id FK
        text member_type "staff/guide/outsource"
    }
    trip_bus_guides {
        int id PK
        int bus_id FK
        int guide_id FK
        int seat
    }
    trip_flights {
        int flight_id PK
        int trip_id FK
    }
    trip_flight_occupants {
        int id PK
        int flight_id FK
    }
    trip_flight_tickets {
        int ticket_id PK
        int flight_id FK
    }
    trip_flight_ticket_occupants {
        int id PK
        int ticket_id FK
    }
```

มาสเตอร์ทริป (ไม่มี FK แข็ง): `trip_airports`, `trip_flight_numbers`, `flight_masters`, `trip_report_templates`, `nationalities` (115), `member_types` (112)

---

## 6. Members (MLM)

```mermaid
erDiagram
    members ||--o{ member_line_accounts : "member_code"

    members {
        text member_code PK
        text member_name
        text full_name
        bool is_company
        text co_applicant_name
        text position_level
        text country_code
    }
    member_line_accounts {
        int id PK
        text member_code FK
        text line_user_id
    }
    test_members {
        text member_code PK
    }
    sync_config {
        text key PK
    }
    sync_log {
        int id PK
    }
```

- **View `member_persons`**: แตก 1 `member_code` → 1-2 คน (primary + co_applicant) ใช้กับ dropdown ลงทะเบียน event/booking/trip
- `members` เป็น snapshot จาก sync (sync-members.js) — `event_attendees.member_code` / `room_booking_attendees.member_code` / `trip_room_occupants.member_code` อ้างถึง (soft link, ไม่ใช่ FK แข็ง)

---

## 7. LINE & FB Messaging

```mermaid
erDiagram
    line_channels ||--o{ line_groups          : "channel_id"
    line_channels ||--o{ line_scheduled_posts : "channel_id"
    line_channels ||--o{ notification_rules   : "channel_id"
    events        ||--o{ line_scheduled_posts : "event_id"
    users         ||--o{ line_scheduled_posts : "created_by"

    fb_pages ||--o{ fb_scheduled_posts : "fb_page_id"
    events   ||--o{ fb_scheduled_posts : "event_id"
    users    ||--o{ fb_scheduled_posts : "created_by / added_by"

    line_channels {
        int id PK
        text name
        text access_token
    }
    line_groups {
        int id PK
        int channel_id FK
        text group_id
        text category
    }
    line_scheduled_posts {
        int id PK
        int event_id FK
        int channel_id FK
        int created_by FK
    }
    line_reply_templates {
        int id PK
    }
    line_verify_sessions {
        uuid id PK
    }
    line_link_tokens {
        uuid id PK
        text token
    }
    fb_pages {
        bigint id PK
        int added_by FK
    }
    fb_scheduled_posts {
        bigint id PK
        bigint fb_page_id FK
        int event_id FK
        int created_by FK
    }
```

หมายเหตุ: `events` มีคอลัมน์ link กลุ่ม LINE (053) · `users.line_*` (030) เก็บ LINE binding ของพนักงาน

---

## 8. Notification

```mermaid
erDiagram
    line_channels      ||--o{ notification_rules : "channel_id"
    notification_rules ||--o{ notification_log   : "rule_id"
    notification_rules ||--o{ user_notifications : "rule_id"
    line_channels      ||--o{ notification_log   : "channel_id"
    users              ||--o{ notification_log   : "recipient_user_id"
    users              ||--o{ user_notifications : "user_id"

    notification_rules {
        bigint id PK
        bigint channel_id FK
        text trigger
        jsonb schedule
    }
    notification_log {
        bigint id PK
        bigint rule_id FK
        int recipient_user_id FK
        bigint channel_id FK
    }
    notification_triggers {
        bigint id PK
        text trigger_key
    }
    user_notifications {
        int id PK
        int user_id FK
        bigint rule_id FK
        bool is_read
    }
```

---

## 9. IBD (International Business Dept)

```mermaid
erDiagram
    ibd_countries ||--o{ ibd_complaints          : "branch_code"
    ibd_countries ||--o{ ibd_relocation_requests : "from_country / to_country"
    users ||--o{ ibd_complaints          : "assigned_to / caretaker_user_id"
    users ||--o{ ibd_ewallet_requests    : "approved_by / caretaker_user_id"
    users ||--o{ ibd_relocation_requests : "approved_by / caretaker_user_id"

    ibd_countries {
        text code PK
        text name
    }
    ibd_complaints {
        int id PK
        text branch_code FK
        int assigned_to FK
        int caretaker_user_id FK
    }
    ibd_ewallet_requests {
        int id PK
        int approved_by FK
        int caretaker_user_id FK
    }
    ibd_relocation_requests {
        int id PK
        text from_country FK
        text to_country FK
        int approved_by FK
        int caretaker_user_id FK
    }
```

---

## 10. Daily Sale / CS

```mermaid
erDiagram
    branches ||--o{ daily_sale_bills        : "branch / receive_branch"
    branches ||--o{ daily_sale_topup_bills  : "branch"
    branches ||--o{ daily_sale_reconcile    : "branch"
    daily_sale_bills       ||--o{ daily_sale_payments       : "bill_no"
    daily_sale_topup_bills ||--o{ daily_sale_topup_details  : "bill_no"

    promotion_categories ||--o{ promotions : "promotion_category_id"

    branches {
        text branch_code PK
        text branch_name
    }
    daily_sale_bills {
        text bill_no PK
        text branch FK
        text receive_branch FK
    }
    daily_sale_payments {
        text bill_no PK "FK→daily_sale_bills"
    }
    daily_sale_topup_bills {
        text bill_no PK
        text branch FK
    }
    daily_sale_topup_details {
        int id PK
        text bill_no FK
    }
    daily_sale_reconcile {
        int id PK
        text branch FK
    }
    promotion_categories {
        int promotion_category_id PK
    }
    promotions {
        int promotion_id PK
        int promotion_category_id FK
    }
```

---

## 11. Work Plan & Misc

```mermaid
erDiagram
    work_departments ||--o{ work_plans     : "dept_id"
    events           ||--o{ work_plans     : "event_id"
    work_plans       ||--o{ work_plan_rows : "plan_id"

    work_departments {
        bigint id PK
        text name
    }
    work_plans {
        bigint id PK
        bigint dept_id FK
        int event_id FK
        jsonb data
    }
    work_plan_rows {
        bigint id PK
        bigint plan_id FK
    }
```

มาสเตอร์/ตารางเดี่ยวอื่น ๆ: `qr_style_presets`, `manual_chapters` → `manual_pages` (chapter_id, updated_by→users), `attendee_form_templates`

---

## สรุปจุดเชื่อมข้ามโดเมน (hub tables)

- **`users`** — ศูนย์กลาง: ถูกอ้างถึงจาก events, requisitions, PO, SO, stock, notification, ibd, line, fb, room_booking, manual ฯลฯ (created_by / assigned_to / approved_by / caretaker)
- **`events`** — เชื่อม places, room_bookings, line/fb scheduled posts, work_plans, course_series/levels, ticket_tiers, attendees
- **`places`** — เชื่อม events, place_rooms, trip_rooms, room_booking_requests
- **`member_code`** (soft link จาก `members`) — ใช้ใน event_attendees, room_booking_attendees, trip_room_occupants (ไม่ใช่ FK แข็ง เพราะ members เป็น sync snapshot)
- **`warehouses`** — เชื่อม PO, SO, requisitions, stock_movements, bins/locations/zones (+ self parent_id)
