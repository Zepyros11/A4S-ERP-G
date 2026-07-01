# 08 — Backend Services, Automation & Deployment

> [ai-proxy/](../../ai-proxy/) (Node/Express บน Render), [scripts/](../../scripts/) (sync + audit), [.github/workflows/](../../.github/) (cron)

---

## 1. ai-proxy — Node proxy ([ai-proxy/server.js](../../ai-proxy/server.js))

**Deploy:** Render.com (free tier, Singapore) — config [ai-proxy/render.yaml](../../ai-proxy/render.yaml)
**Deps:** express, cors, @anthropic-ai/sdk
**บทบาท:** ซ่อน secret ของ LINE/FB/Claude จาก browser + ทำงาน cron + รับ webhook

### Endpoints

**OCR (Claude Vision)**
- `POST /extract` — `{imageBase64, mediaType}` → ดึง passport_id, expiry (Claude Haiku 4.5); ปิดถ้าไม่มี `ANTHROPIC_API_KEY`

**LINE Messaging proxy (เลี่ยง CORS, ซ่อน token)**
- `POST /line/push` — ส่งหา user เดียว (≤5 messages)
- `POST /line/multicast` — ≤500 userIds
- `POST /line/broadcast` — เพื่อนทั้ง OA
- `POST /line/info` — ชื่อ/รูป bot (health)
- `POST /line/quota` — โควต้า/ยอดใช้เดือนนี้
- `POST /line/group-summary` — ชื่อ/รูปกลุ่ม (auto-fill UI)

**LINE Webhook (ลงทะเบียน + เชื่อมบัญชี)**
- `POST /line/webhook` — verify HMAC-SHA256 (`x-line-signature`); จัดการ:
  - join/leave group → upsert `line_groups`, reply template
  - follow → welcome
  - postback `link_start`/`cancel` → เริ่ม/ยกเลิก flow เชื่อมบัญชี (session 5 นาที)
  - text ในโหมดเชื่อม → state machine: ask_id → password (SHA-256); 3 ครั้งผิด → block 30 นาที; รองรับ member (เลข) + staff (username); token pre-auth จาก register.html
  - event อื่น → อัปเดต `member_line_accounts.last_active_at`
  - templates เก็บใน `line_reply_templates` (cache 60s)
  - เขียน: `line_verify_sessions`, `members`/`test_members`, `member_line_accounts`, `line_groups`, `line_link_tokens`

**Pre-auth (จาก register.html)**
- `POST /line/preauth` — `{code, password}` → token 16-hex one-time (10 นาที) เก็บใน `line_link_tokens`
- `POST /line/templates/reload` — clear cache template

**Cron (GitHub Actions ยิงทุก 15 นาที)**
- `POST /cron/notifications` — อ่าน `notification_rules` ที่มี schedule_anchor (event_date/booking_date/booking_start_time/daily_summary) + offset → multicast LINE + เขียน `user_notifications`; window 15 นาที (Bangkok); dedup 24 ชม.
- `POST /cron/line-promote` — อ่าน `line_scheduled_posts` (SCHEDULED, ≤now+15m) → ส่ง push/broadcast (แทรก placeholder + poster) → mark SENT; throttle 30s

**แจ้งเตือนทันที**
- `POST /ibd/notify` — จาก IBD portal (anon); whitelist `ibd.complaint/ewallet/relocation.created` → `notification_rules` (LINE) + `bell_notification_rules` (กระดิ่ง)
- `POST /bell/notify` — ทั่วไป → เขียน `user_notifications` (in-app, ไม่ส่ง LINE)

**Diagnostics**
- `GET /` — health
- `GET /line/diag` — ตรวจ env + ตาราง + readiness

### Env vars (Render)
`PORT`, `ANTHROPIC_API_KEY` (optional), `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_TOKEN`, `SB_URL`, `SB_SERVICE_KEY` (service role, bypass RLS), `CRON_SECRET`

---

## 2. Scripts ([scripts/](../../scripts/)) — Playwright + Supabase SDK

| script | หน้าที่ | trigger |
|--------|---------|---------|
| `sync-members.js` | login answerforsuccess.com → export สมาชิก → upsert `members`; แบ่ง date เป็น **BUCKET_YEARS=1** (เร็ว+ทนกว่า 3y); default 2021-now (legacy ต้อง `INCLUDE_LEGACY=1`) | GH Actions รายชั่วโมง + manual |
| `sync-daily-sale.js` | ดาวน์โหลด 4 xls (sub 01/08/12/131) → 4 ตาราง `daily_sale_*`; `DAYS_BACK` default 1 | GH Actions 08:00-20:00 BKK รายชั่วโมง |
| `setup-line-richmenu.js` | สร้าง/แทน rich menu (ปุ่ม postback link_start + tel แอดมิน); `node ... menu.png` | manual |
| `backfill-password-hash.js` | backfill `password_hash` (SHA-256) จาก plaintext เดิม | manual one-time |
| `verify-password-counts.js` | audit จำนวน password ที่มี/ไม่มี hash | manual |
| `export-members-lb.js` | export สมาชิกตามรายการ code → xlsx (+country) | manual |
| `audit-pages.mjs` / `audit-page-css.mjs` / `audit-visual.mjs` / `audit-pages.ps1` | สแกนหน้า HTML/CSS/visual | manual |

**Env (scripts):** `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `MASTER_KEY` (decrypt credentials ใน sync_config), `DRY_RUN`, `FORCE`, `INCLUDE_LEGACY`, `DAYS_BACK`
**npm scripts:** `sync`, `sync:dry`, `sync:local`, `sync:daily`, `sync:daily:dry`
**helper:** `run-sync-local.bat`, `run-sync-dryrun.bat`
**features:** screenshot ตอน fail, log ลง `sync_log`, gating ผ่าน `automation_tasks`, LINE notify เมื่อเสร็จ

---

## 3. GitHub Actions ([.github/workflows/](../../.github/))

| workflow | schedule | ทำอะไร |
|----------|----------|--------|
| `sync-members.yml` | `0 * * * *` (รายชั่วโมง) | รัน sync-members.js; inputs: force/test_line/include_legacy; timeout 60m |
| `sync-daily-sale.yml` | `0 1-13 * * *` (08:00-20:00 BKK) | รัน sync-daily-sale.js; inputs: force/days_back; timeout 30m |
| `notif-cron.yml` | `*/15 * * * *` | POST proxy `/cron/notifications` + `/cron/line-promote` (matrix); auth `x-cron-secret` |
| `keep-render-alive.yml` | `*/10 * * * *` | ping proxy `/` กัน Render free tier หลับ (15 นาที) |

**Secrets:** `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `MASTER_KEY`, `CRON_SECRET`

---

## 4. Frontend Hosting & Auth backend

- **GitHub Pages** — `BASE_PATH` ใน sidebar.js auto-detect `github.io` (`/reponame`) vs localhost (`""`)
- **index.html** → redirect login.html
- **login.html** — auth ฝั่ง client: query `users?username=eq.X&is_active=eq.true`, hash SHA-256 เทียบ `password_hash` (รองรับ legacy plaintext), union perms จาก `role_configs.roles[]`, เก็บ session ใน local/sessionStorage (ดู [01](01-ARCHITECTURE.md) §2)

---

## 5. Security model (สรุป)
- **Members/public:** Supabase anon key + RLS
- **Staff:** username + SHA-256 hash (ไม่มี salt) ในตาราง `users` + permission ฝั่ง UI
- **Cron:** `CRON_SECRET` header; **proxy ↔ Supabase:** service_role key (bypass RLS)
- **LINE webhook:** HMAC-SHA256 verify
- **Encryption:** credentials sync (AES-256-GCM, MASTER_KEY); member password/national_id (AES-GCM, master key ใน app_settings); LINE token เข้ารหัสใน `line_channels`
- **Rate limit:** เชื่อมบัญชี 3 ครั้ง → block 30 นาที; cron throttle 30s; webhook window 15 นาที

---

## 6. .env (root, git-ignored)
มีตัวแปรกลุ่ม: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, และ API keys (LINE/FB ฯลฯ) — **ไม่เปิดเผยค่า**; ส่วนใหญ่ frontend อ่าน config จาก `js/core/config.js` + localStorage

---

## 7. Critical flow (ตัวอย่าง end-to-end)
```
สมาชิกแอด LINE OA / register.html
  → /line/preauth (ตรวจรหัส → token)            [proxy]
  → /line/webhook (verify token → ผูก member_code) [proxy]
  → member_line_accounts + members.line_user_id    [Supabase]
อีเวนต์ใกล้ถึง
  → notif-cron.yml (ทุก 15 นาที)                   [GH Actions]
  → /cron/notifications (อ่าน rules + offset)       [proxy]
  → LINE multicast พนักงาน + user_notifications     [LINE + Supabase]
  → พนักงานเห็นกระดิ่ง + ข้อความ LINE
```
