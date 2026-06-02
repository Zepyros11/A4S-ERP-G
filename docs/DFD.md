# A4S-ERP — Data Flow Diagram (DFD)

> สร้างจากโครงสร้างจริง: `modules/*` (SPA → Supabase), `ai-proxy/server.js` (backend บน Render),
> `scripts/sync-*.js` (Playwright), `.github/workflows/*.yml` (cron) + schema ใน [ER-diagram.md](ER-diagram.md)
> เปิดดูด้วย Mermaid preview (VSCode extension "Markdown Preview Mermaid Support" หรือบน GitHub)

**สัญลักษณ์ (Gane–Sarson style บน Mermaid):**
- `[ผู้ใช้ภายนอก]` สี่เหลี่ยม = External Entity
- `((กระบวนการ))` วงกลม = Process
- `[(Data Store)]` ทรงกระบอก = แหล่งเก็บข้อมูล (ตาราง Supabase / Storage)

---

## สถาปัตยกรรมโดยย่อ (ก่อนเข้า DFD)

```mermaid
flowchart LR
    SPA["Browser SPA<br/>(modules/*)"] -->|REST + anon key + RLS| SB[(Supabase<br/>Postgres + Storage)]
    PROXY["ai-proxy<br/>(Render, service-role)"] --> SB
    CRON["GitHub Actions<br/>(cron)"] -->|trigger| PROXY
    CRON -->|Playwright scrape| AFS["answerforsuccess<br/>(ระบบ MLM ภายนอก)"]
    CRON -->|upsert| SB
    PROXY <-->|Messaging API / webhook| LINE["LINE Platform"]
    PROXY -->|Graph API| FB["Facebook Pages"]
    PROXY -->|OCR/extract| AI["AI (Anthropic)"]
```

จุดสำคัญ: SPA คุยกับ Supabase ตรง ๆ (อ่าน/เขียนงานทั่วไป) ส่วนงานที่ต้อง **service-role / secret / 3rd-party** (ส่ง LINE, FB, AI, cron) วิ่งผ่าน **ai-proxy** เสมอ

---

## Level 0 — Context Diagram

ระบบทั้งหมดมองเป็นกล่องเดียว เห็นเฉพาะ external entity + data flow หลัก

```mermaid
flowchart TB
    STAFF["👤 พนักงาน / ผู้ดูแล<br/>(Staff / Admin)"]
    MEMBER["🧑 สมาชิก MLM<br/>(LIFF / IBD Portal)"]
    AFS["🌐 answerforsuccess<br/>(ระบบ MLM ภายนอก)"]
    LINE["💬 LINE Platform"]
    FB["📘 Facebook"]
    AI["🤖 AI (Anthropic)"]

    SYS((("A4S-ERP<br/>System")))

    STAFF -->|"login, จัดการ stock/event/trip/booking, อนุมัติเอกสาร"| SYS
    SYS -->|"แดชบอร์ด, รายงาน, การแจ้งเตือนในระบบ"| STAFF

    MEMBER -->|"ลงทะเบียน event, คำร้อง IBD, ผูกบัญชี LINE, อัปโหลดเอกสาร"| SYS
    SYS -->|"ยืนยัน/สถานะคำร้อง, ตั๋ว/QR, ข้อความ LINE"| MEMBER

    AFS -->|"ข้อมูลสมาชิก + ยอดขายรายวัน (scrape)"| SYS

    SYS -->|"push / multicast / broadcast / โปรโมท"| LINE
    LINE -->|"webhook: follow, message, postback (ผูกบัญชี)"| SYS

    SYS -->|"โพสต์ตามกำหนดเวลา"| FB
    SYS <-->|"แยกข้อมูลจากเอกสาร/รูป (OCR)"| AI
```

---

## Level 1 — กระบวนการหลัก + Data Stores

แตกกล่อง "A4S-ERP System" เป็นกระบวนการหลัก พร้อม data store (กลุ่มตาราง)

```mermaid
flowchart TB
    %% External
    STAFF["👤 พนักงาน"]
    MEMBER["🧑 สมาชิก"]
    AFS["🌐 answerforsuccess"]
    LINE["💬 LINE"]
    FB["📘 Facebook"]
    AI["🤖 AI"]

    %% Processes
    P1(("1.0<br/>Auth &<br/>Permission"))
    P2(("2.0<br/>Member /<br/>Daily-Sale Sync"))
    P3(("3.0<br/>Inventory<br/>PO·SO·REQ·Stock"))
    P4(("4.0<br/>Event &<br/>Registration"))
    P5(("5.0<br/>Place / Room<br/>Booking"))
    P6(("6.0<br/>Trip<br/>Management"))
    P7(("7.0<br/>LINE / FB<br/>Messaging"))
    P8(("8.0<br/>Notification<br/>Engine"))
    P9(("9.0<br/>IBD<br/>Requests"))

    %% Data stores
    D1[("D1 users / roles / departments")]
    D2[("D2 members / member_line_accounts")]
    D3[("D3 products / warehouses / stock_movements / PO·SO·REQ")]
    D4[("D4 events / attendees / tiers / course")]
    D5[("D5 places / room_booking*")]
    D6[("D6 trips / rooms / buses / flights / guides")]
    D7[("D7 line_* / fb_* / scheduled_posts")]
    D8[("D8 notification_rules / log / user_notifications")]
    D9[("D9 ibd_* + Storage (เอกสาร)")]
    DS[("D10 daily_sale_* / branches")]

    %% Auth
    STAFF --> P1 --> D1

    %% Sync (cron + playwright)
    AFS --> P2
    P2 --> D2
    P2 --> DS

    %% Inventory
    STAFF --> P3 --> D3
    D1 -. created_by/approved_by .-> P3

    %% Event + registration
    STAFF --> P4
    MEMBER -->|ลงทะเบียน| P4
    P4 --> D4
    D2 -. member_code .-> P4

    %% Booking
    STAFF --> P5
    MEMBER -->|ขอจองห้อง| P5
    P5 --> D5
    D4 -. event_id .-> P5

    %% Trip
    STAFF --> P6 --> D6
    D5 -. place_id .-> P6

    %% Messaging
    P7 --> D7
    P7 -->|push/promote| LINE
    LINE -->|webhook/postback| P7
    P7 --> FB
    D4 -. event_id .-> P7
    D2 -. ผูกบัญชี .-> P7

    %% Notification engine
    P8 --> D8
    D4 -. deadline/แท็ก .-> P8
    D6 -. trip events .-> P8
    P8 -->|แจ้งเตือน| P7
    P8 -->|in-app| STAFF

    %% IBD
    MEMBER -->|คำร้อง + เอกสาร| P9
    STAFF -->|อนุมัติ| P9
    P9 --> D9
    P9 -->|OCR| AI
    P9 -->|แจ้งผล| P7
```

---

## Level 2 — ขยายกระบวนการสำคัญ

### 2.1 Member / Daily-Sale Sync (Process 2.0)
GitHub Actions cron → Playwright เปิด answerforsuccess → upsert เข้า Supabase (service-role)

```mermaid
flowchart LR
    CRON["⏰ GitHub Actions<br/>members: รายชั่วโมง<br/>daily-sale: ชม.ละครั้ง (1–13)"]
    AFS["🌐 answerforsuccess"]
    P2a(("2.1<br/>scrape members<br/>(sync-members.js)"))
    P2b(("2.2<br/>scrape ยอดขาย<br/>(sync-daily-sale.js)"))
    D2[("members")]
    DS[("daily_sale_bills / payments<br/>topup / reconcile")]

    CRON --> P2a
    CRON --> P2b
    AFS -->|HTML/xls + login| P2a
    AFS -->|4 ไฟล์ xls| P2b
    P2a -->|upsert (1-year buckets)| D2
    P2b -->|upsert + business_date| DS
```

### 2.2 Event Registration (Process 4.0)
สมาชิกลงทะเบียนผ่าน LIFF/ฟอร์ม → ผูกกับ member_code → ตรวจ tier/qualification

```mermaid
flowchart LR
    MEMBER["🧑 สมาชิก (LIFF)"]
    STAFF["👤 เจ้าหน้าที่"]
    P4a(("4.1<br/>เลือก event +<br/>ตรวจสิทธิ์ (min_position)"))
    P4b(("4.2<br/>กรอกฟอร์ม<br/>(per-event field config)"))
    P4c(("4.3<br/>บันทึก attendee +<br/>ออกตั๋ว/QR"))
    MP[("view member_persons")]
    D4[("event_attendees")]
    TIER[("event_ticket_tiers")]

    MEMBER --> P4a
    STAFF --> P4a
    MP -. ดึงชื่อ/ตำแหน่ง .-> P4b
    P4a --> P4b --> P4c
    TIER -. ราคา/รุ่นตั๋ว .-> P4c
    P4c --> D4
    P4c -->|QR/ตั๋ว| MEMBER
```

### 2.3 LINE Notification & Promote (Process 7.0 + 8.0)
cron ยิงเข้า ai-proxy ทุก 15 นาที → ประเมิน rule/กำหนดการ → ส่ง LINE

```mermaid
flowchart LR
    CRON["⏰ GitHub Actions<br/>notif-cron (ทุก 15 นาที)"]
    PROXY(("ai-proxy<br/>/cron/notifications<br/>/cron/line-promote"))
    RULES[("notification_rules<br/>+ schedule")]
    EVT[("events (D-7/3/2/1)")]
    GRP[("line_groups / channels")]
    LOG[("notification_log /<br/>line_scheduled_posts")]
    LINE["💬 LINE"]

    CRON -->|POST trigger| PROXY
    RULES -. เงื่อนไข/เวลา (Bangkok TZ) .-> PROXY
    EVT -. คอร์สใกล้ถึง .-> PROXY
    GRP -. ปลายทาง .-> PROXY
    PROXY -->|push/multicast| LINE
    PROXY -->|กันส่งซ้ำ| LOG
```

### 2.4 LINE Account Linking (webhook)
สมาชิกแอด/ส่งข้อความ → webhook → จับคู่ member_code ↔ line_user_id

```mermaid
flowchart LR
    MEMBER["🧑 สมาชิก"]
    LINE["💬 LINE Platform"]
    PROXY(("ai-proxy<br/>/line/webhook"))
    TOK[("line_link_tokens /<br/>line_verify_sessions")]
    ACC[("member_line_accounts /<br/>users.line_*")]

    MEMBER -->|follow / ข้อความ / postback| LINE
    LINE -->|webhook event| PROXY
    PROXY <-->|ตรวจ token| TOK
    PROXY -->|บันทึก binding| ACC
    PROXY -->|ตอบกลับ (reply template)| LINE --> MEMBER
```

### 2.5 IBD Self-Service + อนุมัติ (Process 9.0)
สมาชิกยื่นคำร้อง 3 ประเภท (complaint / ewallet / relocation) ผ่าน Portal → เจ้าหน้าที่อนุมัติ → แจ้ง LINE

```mermaid
flowchart LR
    MEMBER["🧑 สมาชิก (IBD Portal EN/FR)"]
    STAFF["👤 เจ้าหน้าที่ IBD"]
    P9a(("9.1<br/>ยื่นคำร้อง +<br/>อัปโหลดเอกสาร"))
    P9b(("9.2<br/>ตรวจ/อนุมัติ +<br/>มอบหมาย caretaker"))
    AI["🤖 AI extract (proxy /extract)"]
    STORE[("Supabase Storage<br/>(signed URL)")]
    D9[("ibd_complaints /<br/>ibd_ewallet_requests /<br/>ibd_relocation_requests")]
    PROXY(("ai-proxy /ibd/notify"))
    LINE["💬 LINE"]

    MEMBER --> P9a
    P9a -->|ไฟล์| STORE
    P9a -. ดึงข้อมูลจากเอกสาร .-> AI
    P9a --> D9
    STAFF --> P9b --> D9
    P9b --> PROXY --> LINE --> MEMBER
```

---

## สรุปจุดควบคุมการไหลของข้อมูล

| ช่องทาง | ไหลอย่างไร | ความปลอดภัย |
|---------|------------|-------------|
| SPA → Supabase | REST + anon key | RLS + permission (3-level) ฝั่ง client/policy |
| Cron → answerforsuccess | Playwright scrape | secret ใน GitHub Actions, service-role upsert |
| ใด ๆ → LINE/FB/AI | ผ่าน **ai-proxy** เท่านั้น | เก็บ token/secret ที่ proxy (ไม่หลุดฝั่ง client) |
| สมาชิก → ระบบ | LIFF / IBD Portal / LINE webhook | token linking + signed URL สำหรับไฟล์ |

> หมายเหตุ: Mermaid ไม่มีชนิด DFD โดยตรง จึงใช้ `flowchart` จำลองสัญลักษณ์ Gane–Sarson —
> วงกลม=process, ทรงกระบอก=data store, สี่เหลี่ยม=external entity, เส้นประ=การอ่านอ้างอิง (lookup)
