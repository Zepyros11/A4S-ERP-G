# แผนย้ายระบบ A4S-ERP → บัญชีบริษัท (เดดไลน์ กลาง ส.ค. 2569)

> สร้าง 2026-07-27 · โหมด **รันคู่ขนาน** — ระบบเดิมยัง production ต่อจนกว่าจะเทสต์ผ่านและ cutover

## เป้าหมาย

| ขา | เดิม (ส่วนตัว) | ใหม่ (บริษัท) |
|---|---|---|
| GitHub | `Zepyros11/A4S-ERP-G` | `a4scontent/A4S-ERP-G` |
| หน้าเว็บ (Pages) | `https://zepyros11.github.io/A4S-ERP-G/` | `https://a4scontent.github.io/A4S-ERP-G/` |
| Supabase | `dtiynydgkcqausqktreg` | `egnwfmdsqtxxyhyajnnu` |
| Render proxy | `a4s-erp-proxy.onrender.com` | ต้องสร้างตัวที่ 2 |
| Google Drive | Shared Drive บริษัท | **ใช้ของเดิม ไม่เปลี่ยน** |
| LINE OA | channel เดิม | ตัดสินใจตอน cutover (ดู Phase 5) |

**ทำไม Drive ไม่ต้องแตะ:** URL รูปในฐานข้อมูลเก็บเป็น `/drive/file/<fileId>` — proxy อ่านด้วย fileId ตรงๆ ไม่สนว่าไฟล์อยู่โฟลเดอร์ไหน → ระบบใหม่ที่ต่อ service account เดิม อ่านรูปเก่าได้ครบทันทีโดยไม่ต้อง migrate อะไรเลย

---

## Phase 1 — GitHub (`a4scontent`)

### 1.1 สร้าง repo
- Repositories → **New**
- Name: `A4S-ERP-G` (ใช้ชื่อเดิม — `getBasePath()` ใน [js/core/auth.js](../js/core/auth.js) อ่านชื่อ repo จาก URL อัตโนมัติ เปลี่ยนชื่อก็ได้แต่ไม่จำเป็น)
- **Visibility: Public** ⚠️ จำเป็น — GitHub Pages บนบัญชีฟรีใช้กับ private repo ไม่ได้
- **อย่าติ๊ก** Add README / .gitignore / license (จะทำให้ push แรกชนกัน)

### 1.2 หยุด cron ⚠️ สำคัญที่สุด

ถ้าปล่อยไว้ พอ push ปุ๊บ cron 4 ตัวจะเริ่มวิ่งทันที:
- `notif-cron.yml` — ยิงทุก 15 นาที → **แจ้งเตือน LINE ส่งซ้ำถึงสมาชิกจริง**
- `sync-members.yml` / `sync-daily-sale.yml` → ดึง answerforsuccess.com ชนกับระบบเดิม
- `keep-render-alive.yml` → ping proxy เดิม

**⚠️ ห้ามใช้ "Disable actions" ทั้ง repo** — GitHub Pages แบบ *Deploy from a branch* ต้องใช้ Actions
build ผ่าน workflow ระบบ `pages-build-deployment` ปิด Actions = **เว็บไม่ deploy เลย**

ใช้ repo variable แทน — ทั้ง 4 workflow มี guard ระดับ job:
```yaml
if: github.event_name == 'workflow_dispatch' || vars.CRON_DISABLED != '1'
```
> **กดรันมือจากแท็บ Actions ยังทำได้เสมอ** แม้ตั้ง `CRON_DISABLED=1` ไว้ — จงใจให้ทดสอบได้ก่อน cutover
> (ปิดเฉพาะการรันตามเวลาเท่านั้น)
**Settings → Secrets and variables → Actions → แท็บ `Variables` → New repository variable**
`CRON_DISABLED` = `1`

| repo | ตั้ง `CRON_DISABLED` ไหม | ผล |
|---|---|---|
| ใหม่ (a4scontent) ช่วงเทสต์ | ✅ `1` | cron ทั้ง 4 ไม่ทำงาน · Pages ยัง build ได้ |
| เดิม (zepyros11) | ❌ ไม่ตั้ง | ทำงานปกติ — production ไม่กระทบ |
| ใหม่ ตอน cutover | ลบ variable ทิ้ง | cron เริ่มทำงาน |

> **ลำดับสำคัญ**: ตั้ง variable ให้เสร็จ **ก่อน** เปิด Actions ไม่งั้นมีช่องว่างให้ cron ยิงได้
> (ยังอยากปิดสนิทระหว่างยังไม่ตั้ง variable ก็ปิด Actions ไว้ก่อนได้ แค่ต้องเปิดคืนตอนจะให้ Pages build)

### 1.3 ให้สิทธิ์ push
วิธีง่ายสุด (ไม่ต้อง re-login): repo ใหม่ → Settings → Collaborators → Add people → `Zepyros11` → Write → แล้วรับคำเชิญที่เมล

### 1.4 push
```bash
git remote add company https://github.com/a4scontent/A4S-ERP-G.git
git push company main
```
(ยังเก็บ `origin` เดิมไว้ — จะได้ push เข้า production เดิมได้ระหว่างคู่ขนาน)

### 1.5 เปิด Pages
Settings → Pages → Source: **Deploy from a branch** → Branch `main` / `/ (root)` → Save
รอ 1–2 นาที → เปิด `https://a4scontent.github.io/A4S-ERP-G/`

### 1.6 ตั้ง Actions secrets (ยังไม่เปิด Actions)
Settings → Secrets and variables → Actions → New repository secret

| ชื่อ | ค่า |
|---|---|
| `SUPABASE_URL` | `https://egnwfmdsqtxxyhyajnnu.supabase.co` |
| `SUPABASE_SERVICE_KEY` | service_role key ของ project ใหม่ |
| `MASTER_KEY` | ⚠️ **ค่าเดิมเป๊ะ** — ใช้ถอดรหัสข้อมูลสมาชิก ถ้าต่างจากเดิมข้อมูลที่ย้ายมาจะอ่านไม่ออก |
| `CRON_SECRET` | สุ่มใหม่ + ตั้งให้ตรงกับ env ของ Render ตัวใหม่ |

---

## Phase 2 — Supabase (`egnwfmdsqtxxyhyajnnu`) — ✅ เสร็จแล้ว 2026-07-27

### ผลการย้าย (ตรวจแล้วตรงกันทุกตัว)

| | เดิม | ใหม่ |
|---|---|---|
| pooler host | `aws-1-ap-south-1` (มุมไบ) | `aws-1-ap-northeast-2` (โซล) |
| ตาราง / view / function / trigger | 132 / 11 / 60 / 31 | **เท่ากัน** |
| index / RLS policy / ตาราง RLS on | 374 / 53 / 21 | **เท่ากัน** |
| sequence | 103 | **ค่า last_value ตรงกันทุกตัว** |
| GRANT ให้ `anon` | 1001 | **เท่ากัน** |
| จำนวนแถว 132 ตาราง | — | **ตรงกันครบ** (`members` 116,951) |
| storage bucket / ไฟล์ | 4 / 49 | **ก๊อปครบ 49/49** |
| storage RLS policy | 22 | **22 ตรงกัน** |

> latency: โซลเร็วกว่ามุมไบ (DB connect 1.7s vs 2.9s) · REST ~0.1–0.25s เท่ากัน → ไม่ต้องย้าย region

### วิธีที่ใช้จริง (ทำซ้ำได้)
ไฟล์ dump เก็บไว้ที่ `D:/@Projects/A4S-backups/migration-2026-07-27/old-public-20260727.dump` (21MB)

```bash
# 1) dump เฉพาะ schema public
pg_dump "host=aws-1-ap-south-1.pooler.supabase.com port=5432 \
  user=postgres.dtiynydgkcqausqktreg dbname=postgres sslmode=require" \
  --schema=public --no-owner -Fc -f old-public.dump

# 2) กรอง TOC ทิ้ง 2 entry ที่ restore ไม่ได้ (schema public มีอยู่แล้ว)
pg_restore -l old-public.dump | grep -vE "SCHEMA - public |COMMENT - SCHEMA public " > toc.list

# 3) restore
pg_restore -d "host=aws-1-ap-northeast-2.pooler.supabase.com port=5432 \
  user=postgres.egnwfmdsqtxxyhyajnnu dbname=postgres sslmode=require" \
  --no-owner -L toc.list old-public.dump
```

**⚠️ อย่าใช้ `--no-privileges`** — จะทิ้ง `GRANT ... TO anon` ทั้งหมด แล้วหน้าเว็บพังเงียบ (ระบบนี้ยิง REST ด้วย anon key)

error ที่ขึ้นตอน restore มี 3 อัน เป็นชนิดไม่กระทบ:
`ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin ...` → เปลี่ยน default privileges ของ role อื่นไม่ได้ และ Supabase ตั้งให้เองอยู่แล้ว

### สิ่งที่ `pg_dump --schema=public` **ไม่**ครอบ (ต้องทำแยก — ทำแล้วทั้งคู่)
1. **storage buckets + ไฟล์** → [scripts/migrate-storage-to-new-project.cjs](../scripts/migrate-storage-to-new-project.cjs) (idempotent, รันซ้ำได้)
2. **RLS policy บน `storage.objects`** → [sql/172_storage_policies.sql](../sql/172_storage_policies.sql) (22 policies)

### ทดสอบแล้วผ่าน
- REST + anon key อ่านได้ทุกตารางหลัก (`users`, `members`, `events`, `app_settings`, `line_channels`, ...)
- public bucket โหลดรูปได้ (HTTP 200)
- private bucket `ibd-attachments`: signed URL ใช้ได้ (200) · เปิด path public ตรงๆ ถูกบล็อก (400) ✅

---

### 2.1 เก็บค่าที่ต้องใช้ (อ้างอิง)
Project ใหม่ → Settings → **API**: Project URL, `anon public`, `service_role`
Project ใหม่ → Settings → **Database** → Database password → **Reset** (จดไว้ ใช้ตอน restore)
Project **เดิม** → Settings → Database → Database password → Reset ถ้าจำไม่ได้ (⚠️ reset แล้วต้องอัปเดตที่ไหนก็ตามที่ใช้ connection string อยู่)

Connection string ที่ใช้ dump/restore = **Session pooler** (Connect → Session pooler)

### 2.2 เปิด extension ก่อน restore
SQL Editor ของ project ใหม่:
```sql
create extension if not exists pg_trgm;
create extension if not exists pgcrypto;
```
(pg_trgm จำเป็นสำหรับ index ค้นชื่อสมาชิก — [sql/071](../sql/071_members_search_trigram.sql), [sql/164](../sql/164_members_name_trgm_index.sql))

### 2.3 ย้าย schema + data
**อย่ารัน `sql/*.sql` ทั้ง 209 ไฟล์ซ้ำ** — ในนั้นปนทั้ง migration จริงและ data-fix ครั้งเดียว ลำดับเพี้ยนแน่

ใช้ `pg_dump` → `pg_restore` เฉพาะ schema `public`:
```bash
pg_dump --schema=public --no-owner --no-privileges -Fc \
  "postgresql://postgres.dtiynydgkcqausqktreg:<PW_OLD>@<pooler-host>:5432/postgres" \
  -f old.dump

pg_restore --no-owner --no-privileges -d \
  "postgresql://postgres.egnwfmdsqtxxyhyajnnu:<PW_NEW>@<pooler-host>:5432/postgres" \
  old.dump
```

### 2.4 หลัง restore — ต้องเช็ค 3 อย่าง
1. **RLS + GRANT** — Supabase เปิด RLS ให้ตารางใหม่อัตโนมัติ ระบบนี้ไม่ใช้ RLS (ยิง REST ตรงด้วย anon key)
   ```sql
   -- ทุกตารางใน public ต้อง RLS disabled + anon มีสิทธิ์
   select tablename, rowsecurity from pg_tables where schemaname='public' and rowsecurity;
   ```
   ถ้าเจอต้อง `ALTER TABLE x DISABLE ROW LEVEL SECURITY;` + `GRANT ALL ON x TO anon;`
2. **จำนวนแถวทุกตาราง** — เทียบเก่า/ใหม่ (โดยเฉพาะ `members` ~114k, `daily_sale_bills`)
3. **sequence** — `select setval(...)` ให้ตรง ไม่งั้น insert ใหม่ชน PK

### 2.5 Storage buckets (pg_dump ไม่ย้ายไฟล์ให้)
สร้าง 5 bucket ใน project ใหม่ → Storage → New bucket:

| bucket | Public? | ใช้ที่ |
|---|---|---|
| `event-files` | ✅ Public | ไฟล์งานอีเวนต์/แคมเปญ |
| `company-assets` | ✅ Public | โลโก้บริษัท, web builder |
| `badge-logos` | ✅ Public | namecard generator |
| `cert-templates` | ✅ Public | namecard generator |
| `ibd-attachments` | ❌ **Private** | พาสปอร์ต/PII — ใช้ signed URL |

แล้วรันสคริปต์ก๊อปไฟล์ (จะเขียนตอนถึงขั้นนี้): download จาก project เดิม → upload เข้าใหม่ ชื่อ path เดิมเป๊ะ

---

## Phase 3 — Render proxy ตัวที่ 2 — ✅ เสร็จแล้ว 2026-07-27

`https://a4s-erp-proxy-new.onrender.com` · ตรวจแล้ว:

| ทดสอบ | ผล |
|---|---|
| `GET /` | ✅ `{"status":"ok"}` |
| `GET /drive/health` | ✅ `{"ok":true,"configured":true}` |
| อ่านไฟล์เดิมจาก Drive (product/poster/passport/visa/ticket) | ✅ 200 ทุกไฟล์ · ขนาดตรงกับ proxy เก่าไบต์ต่อไบต์ |
| `POST /drive/upload` | ✅ อัปได้ + อ่านกลับได้ |
| upload โดยไม่มี `x-drive-key` | ✅ 401 (gate ทำงาน) |
| [sql/173](../sql/173_rewrite_proxy_urls.sql) เขียน URL ใหม่ | ✅ **503 แถว · เหลือค้าง 0** |

> 🧹 มีไฟล์ทดสอบค้างใน Drive: `event-files/_migration-test-DELETE-ME.txt` — ลบทิ้งได้
>
> ⏳ proxy ใหม่จะ **หลับหลังไม่มีคนใช้ 15 นาที** (free tier) → โหลดรูปครั้งแรกช้า ~50 วินาที
> เป็นเรื่องปกติช่วงเทสต์ เพราะ `keep-render-alive` ถูกปิดด้วย `CRON_DISABLED=1`
> พอ cutover (ลบ variable) workflow จะ ping ทุก 10 นาที แล้วอาการนี้จะหาย

### ค่า env ที่ตั้งไว้จริง (อ้างอิง)

New → Web Service → เชื่อม repo `a4scontent/A4S-ERP-G` → Root Directory `ai-proxy` → plan Free → region Singapore
ตั้งชื่อเช่น `a4s-erp-proxy-new` → URL `https://a4s-erp-proxy-new.onrender.com`

Environment variables:

| key | ค่าตอนเทสต์ |
|---|---|
| `SB_URL` | `https://egnwfmdsqtxxyhyajnnu.supabase.co` |
| `SB_SERVICE_KEY` | service_role **ใหม่** |
| `PUBLIC_PROXY_URL` | URL ของ proxy ตัวใหม่ |
| `DRIVE_UPLOAD_KEY` | สุ่มใหม่ (`openssl rand -hex 24`) |
| `GOOGLE_SA_EMAIL` / `GOOGLE_SA_PRIVATE_KEY` | **เดิม** (Drive เดิม) |
| `GDRIVE_FOLDER_ID` | แนะนำโฟลเดอร์ `_staging` ใหม่ใน Shared Drive เดิม — เขียนไฟล์เทสต์ไม่ปนของจริง แต่ยังอ่านของเก่าได้ครบ · ตอน cutover ค่อยเปลี่ยนกลับเป็น ID เดิม |
| `CRON_SECRET` | ให้ตรงกับ GitHub secret ใหม่ |
| `ANTHROPIC_API_KEY` | เดิม (OCR) |
| `LINE_CHANNEL_SECRET` / `LINE_CHANNEL_TOKEN` | ⚠️ **เว้นว่างไว้ก่อน** — ดู Phase 5 |

เช็ค: `curl https://a4s-erp-proxy-new.onrender.com/drive/health` → `{"ok":true,"configured":true}`

### 3.1 ⚠️ รันทันทีหลัง Render ใหม่พร้อม — เขียน URL รูปในฐานข้อมูลใหม่

**นี่คือกับดักที่มองไม่เห็น** — ระบบใหม่เปิดดูรูปได้ตั้งแต่ยังไม่มี proxy ของตัวเอง
เพราะ URL ที่เก็บในฐานข้อมูลเป็น **absolute** ชี้ไป proxy เก่าของบัญชีส่วนตัว:

```
https://a4s-erp-proxy.onrender.com/drive/file/<fileId>
```

สำรวจเมื่อ 2026-07-27 พบ **505 แถว ใน 17 คอลัมน์**:

| ตาราง.คอลัมน์ | แถว |
|---|---|
| `tour_seat_check.passport_image_url` | 132 |
| `tour_seat_check.visa_pdf_url` | 104 |
| `events.poster_url` | 66 |
| `trip_flight_tickets.ticket_url` | 62 |
| `product_images.url` | 48 |
| `promotions.poster_url` | 33 |
| `campaign_participants.{facebook,tiktok,ig}_img` | 37 |
| `places` / `place_rooms` / `campaigns` / `web_pages` | 23 |

**ถ้าไม่แก้:** วันที่ปิดบัญชี Render ส่วนตัว (หรือ free tier ถูกระงับ) → พาสปอร์ต วีซ่า ตั๋วเครื่องบิน
โปสเตอร์ รูปสินค้า **พังพร้อมกันหมด** ทั้งที่ไฟล์จริงยังอยู่ครบใน Shared Drive ของบริษัท

**วิธีแก้** (fileId ไม่เปลี่ยน → proxy ใหม่ที่ใช้ service account เดิม เสิร์ฟไฟล์เดิมได้ทันที):
1. แก้ `new_host` ใน [sql/173_rewrite_proxy_urls.sql](../sql/173_rewrite_proxy_urls.sql) ให้ตรงชื่อ Render service จริง
2. รัน [sql/173_rewrite_proxy_urls_check.sql](../sql/173_rewrite_proxy_urls_check.sql) → จดตัวเลขไว้
3. รัน [sql/173_rewrite_proxy_urls.sql](../sql/173_rewrite_proxy_urls.sql) (idempotent รันซ้ำได้)
4. รัน check อีกรอบ → ต้องได้ **0 แถว**
5. เปิดหน้า catalog / pax-detail / trip-list ดูว่ารูปยังขึ้นครบ

> รันบน project **ใหม่** เท่านั้น — อย่ารันบนของเดิม

---

## Phase 4 — แก้โค้ด: env switch (✅ ทำแล้ว 2026-07-27)

**ไม่แยก branch** — ใช้โค้ดชุดเดียวกันทั้ง 2 repo แล้วให้ตัวโค้ดเลือก config เองตาม hostname
เหตุผล: ระหว่างคู่ขนาน 3 สัปดาห์ยังพัฒนาต่อบน production อยู่ ถ้าแยก branch ต้อง cherry-pick ทุกครั้ง
→ วิธีนี้ `git push company main` ได้ตลอดโดยไม่มี conflict และ push ขึ้น `origin` ก็ปลอดภัย (ค่าเดิมไม่เปลี่ยน)

```js
window.ERP_IS_NEW =
  window.ERP_IS_NEW ??
  (localStorage.getItem("erp_env") === "new" ||
    location.hostname.startsWith("a4scontent"));
```

| hostname | ชี้ไป |
|---|---|
| `a4scontent.github.io` | Supabase + proxy **ใหม่** |
| `zepyros11.github.io` | ของเดิม (production — พฤติกรรมไม่เปลี่ยน) |
| `localhost` / `127.0.0.1` | ของเดิม |
| localhost + `localStorage.setItem('erp_env','new')` | ของใหม่ (สำหรับเทสต์บนเครื่อง) |

> localStorage แยกตาม origin อยู่แล้ว → 2 เว็บไม่กวน key กัน

### ไฟล์ที่แก้ (17)
**Supabase URL/key (11)** — [js/core/config.js](../js/core/config.js) · [js/core/supabase.js](../js/core/supabase.js) · [modules/customer-service/promotion-api.js](../modules/customer-service/promotion-api.js) · [modules/event/campaign-calendar.js](../modules/event/campaign-calendar.js) · [modules/event/cs-view/events-bookingRoom.js](../modules/event/cs-view/events-bookingRoom.js) · [modules/event/cs-view/events-calendar.js](../modules/event/cs-view/events-calendar.js) · [modules/event/events-api.js](../modules/event/events-api.js) · [modules/event/register-config.js](../modules/event/register-config.js) · [modules/ibd-portal/portal-config.js](../modules/ibd-portal/portal-config.js) · [modules/manual/manual-api.js](../modules/manual/manual-api.js) · [modules/media/web-view-config.js](../modules/media/web-view-config.js)

**Proxy URL (4 + 2 workflow)** — [js/core/imageCompressor.js](../js/core/imageCompressor.js) และ config ข้างบน · workflow ใช้ repo variable `vars.PROXY_URL` (มี fallback เป็น URL เดิม) → [keep-render-alive.yml](../.github/workflows/keep-render-alive.yml) · [notif-cron.yml](../.github/workflows/notif-cron.yml)

**URL หน้าเว็บ (5)** — `PUBLIC_BASE` สลับตาม `erp_env` ใน [campaign-detail.js](../modules/event/campaign-detail.js) · [campaign-planning.js](../modules/event/campaign-planning.js) · [survey-forms.js](../modules/event/survey-forms.js) · [event-form.js](../modules/event/event-form.js) · [trip-list.html](../modules/trip/trip-list.html) เปลี่ยนเป็นลิงก์ relative (ใช้ได้ทั้ง 2 โดเมน)

### ค่าใหม่ที่ตั้งไว้ในโค้ดแล้ว
| | ค่า |
|---|---|
| Supabase URL ใหม่ | `https://egnwfmdsqtxxyhyajnnu.supabase.co` |
| proxy ใหม่ | `https://a4s-erp-proxy-new.onrender.com` ⚠️ **ต้องตั้งชื่อ Render service ว่า `a4s-erp-proxy-new` เป๊ะ** |
| `DRIVE_UPLOAD_KEY` ใหม่ | `7f2f204a8636f7136e23ec84924d691bde6879086605ece1` |

### ควรถือโอกาส rotate
- Facebook App Secret + access token ที่เขียน plaintext ใน [.env](../.env)
- `DRIVE_UPLOAD_KEY` (เคยอยู่ในบัญชีส่วนตัว)
- service_role key เดิม (หลัง cutover)

---

## ⚠️ กฎเหล็กระหว่างยังใช้ 2 URL: push ต้องไป **ทั้ง 2 repo**

```bash
git push origin main      # a4scontent — เว็บใหม่
git push old-prod main    # Zepyros11 — URL ที่พนักงานใช้จริงอยู่ตอนนี้
```

พลาดไปแล้วครั้งหนึ่ง (30 ก.ค. 2569): push แต่ repo บริษัทติดกัน 5 commit
ทำให้ `zepyros11` ยังใช้ `login.html` ตัวเก่าที่ไม่มีโค้ดขอ master key
→ ถ้าลบแถว `app_settings.member_master_key` ตอนนั้น **พนักงานทุกคนถอดรหัสไม่ได้ทันที**

**เลิกกฎนี้ได้เมื่อ:** ประกาศ URL ใหม่ + ปิด Pages ของ repo เก่าแล้ว

---

## Phase 4.5 — Cutover ชั้นข้อมูล (✅ 29 ก.ค. 2569 เช้า)

**ทำก่อน cutover เต็มรูปแบบ** — ยุบให้เหลือฐานข้อมูลเดียว แต่ยังคง URL เดิมไว้ให้ผู้ใช้

เหตุผล: ระบบเก่ายังมีคนใช้และ sync ทุกชั่วโมง → ข้อมูล 2 ฝั่งแยกกันทุกวัน
ถ้าไม่ยุบ ต้องนั่งย้าย delta ไปเรื่อยๆ จนถึงวัน cutover

```
zepyros11.github.io  ┐
                     ├──→  Supabase ใหม่ (a4scontent)  ←── ตัวเดียว
a4scontent.github.io ┘
```

| # | เปลี่ยนที่ | เปลี่ยนอะไร |
|---|---|---|
| 1 | Render **เก่า** (`a4s-erp-proxy`) | `SB_URL` + `SB_SERVICE_KEY` → project ใหม่ (LINE webhook/cron เขียนลง DB ใหม่) |
| 2 | GitHub Secrets repo **เก่า** | `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `MASTER_KEY` → ค่าใหม่ (⚠️ MASTER_KEY ต้องเป็นคีย์หลัง re-key) |
| 3 | โค้ด (push ทั้ง 2 repo) | env switch เปลี่ยน default เป็น "ใหม่" ทุก hostname |
| 4 | repo ใหม่ | คง `CRON_DISABLED=1` ไว้ → cron วิ่งชุดเดียวจาก repo เก่า |

**ก่อนสลับต้องทำ delta sync ให้ข้อมูล 2 ฝั่งตรงกันก่อน** — คราวนี้ต่างกัน 6 ตาราง
(daily_sale 5 ตาราง + events/notifications/room_booking_requests/sync_log/notification_log)
ตรวจด้วย md5 checksum รายแถว ไม่ใช่แค่นับจำนวน · และ **resync sequence** หลัง insert ด้วย `setval`

**วิธียืนยันว่า proxy ชี้ DB ใหม่จริง:** เรียก `GET /line/diag` — ถ้า `SB_URL` เป็นของเก่าแต่ key เป็นของใหม่
Supabase จะตอบ 401 · ได้ 200 ทุกตาราง = URL กับ key เป็นคู่เดียวกันของ project ใหม่

**ปุ่มถอยฉุกเฉิน** (ต่อเครื่อง ไม่ต้อง deploy): `localStorage.setItem('erp_env','old'); location.reload()`

### กับดัก 2 อย่างที่เจอตอนทำจริง (ถ้าพลาดจะเงียบมาก)

1. **คนที่ login ค้างจะยังยิงเข้าฐานเดิม** — `sb_url` ถูกเก็บใน localStorage ตอน login
   และมีแค่ 3 หน้าที่โหลด `config.js` มาคำนวณใหม่
   → แก้ด้วย **connection guard** บนสุดของ [js/core/auth.js](../js/core/auth.js) (โหลดครบ 117 หน้า)
2. **URL รูปที่ยังอยู่ใน Supabase Storage** (ไม่ได้ย้ายไป Drive) ฝัง project ref ไว้ 7 แถว
   รวม `app_settings.company_logo_url` ที่ขึ้นทุกหน้า → แก้ด้วย [sql/174](../sql/174_rewrite_supabase_storage_urls.sql)

### ✅ pause project เก่าแล้ว (29 ก.ค. 2569)

ทดสอบโดยการ **pause** project เก่า — ถ้ามีอะไรหลงเหลือชี้ฐานเดิมจะพังทันทีให้เห็น

| ตรวจ | ผล |
|---|---|
| ต่อฐานเก่า | `tenant not found` = pause สำเร็จ |
| ดึง `member_master_key` ผ่าน REST | ไม่มีข้อมูลตอบกลับ → **เลขบัตรประชาชนที่เคยเปิดอยู่ ถูกปิดแล้ว** |
| ระบบใหม่หลัง pause | ใช้งานปกติ · `daily_sale_bills` +52 · `events` +2 ในวันเดียว |

ข้อมูลยังเพิ่มขึ้นเรื่อยๆ ทั้งที่ฐานเก่าปิดไปแล้ว = ไม่มีอะไรพึ่งฐานเก่าเหลืออยู่

> ⚠️ หลัง pause **ปุ่มถอยฉุกเฉินใช้ไม่ได้แล้ว** (ฐานไม่ตอบ)
> ตาข่ายรองที่เหลือคือ dump 2 ชุดที่ `D:/@Projects/A4S-backups/migration-2026-07-27/`

---

## Phase 5 — LINE + Webhook — ✅ เสร็จแล้ว 30 ก.ค. 2569

**ทำได้เร็วกว่าแผนเพราะเจอจังหวะดี 2 อย่าง**

1. **โควต้า LINE เต็ม (300/300)** → push ส่งไม่ออกอยู่แล้ว = ไม่มีความเสี่ยงส่งข้อความซ้ำถึงสมาชิก
2. **webhook ใช้ `lineReply` ล้วน 32 จุด ไม่ใช้ push เลย** → LINE ไม่นับ reply ในโควต้า
   = ทดสอบ webhook ได้เต็มรูปแบบ ฟรี ไม่จำกัด แม้โควต้าเต็ม
3. **ฐานข้อมูลเหลือตัวเดียวแล้ว** (Phase 4.5) → proxy เก่า/ใหม่ อ่านเขียนที่เดียวกัน
   ย้าย webhook ไปตัวไหนก็ไม่มีผลกับข้อมูล = ความเสี่ยงเกือบเป็นศูนย์

### ลำดับที่ทำ (สำคัญ — อย่าสลับ)

| # | ที่ไหน | ทำอะไร |
|---|---|---|
| 1 | Render **ใหม่** | เพิ่ม `LINE_CHANNEL_SECRET` + `LINE_CHANNEL_TOKEN` (ก๊อปจาก Render เก่า) |
| 2 | repo **ใหม่** | เพิ่ม var `PROXY_URL` = URL proxy ใหม่ · **ลบ** `CRON_DISABLED` |
| 3 | repo **เก่า** | เพิ่ม var `CRON_DISABLED` = `1` |
| 4 | LINE Console | Webhook URL → `https://a4s-erp-proxy-new.onrender.com/line/webhook` → **Verify** |

> 🔴 ข้อ 2 ต้องทำก่อนข้อ 4 — Render free หลับเมื่อไม่มีคนใช้ 15 นาที และ **LINE ไม่ retry webhook**
> ถ้า proxy หลับตอน LINE ยิงเข้ามา event นั้นหายเลย · `keep-render-alive` ping ทุก 10 นาทีจึงจำเป็น
>
> 🔴 ข้อ 2 ก่อนข้อ 3 เสมอ — เปิดของใหม่ก่อน ปิดของเก่าทีหลัง ไม่งั้นมีช่วงที่ไม่มีใคร ping proxy

### วิธียืนยันว่าใช้ได้จริง

- **Verify ใน LINE Console** → ขึ้น `Success` (พิสูจน์แค่ว่า endpoint ตอบ 200)
- **ยืนยันจริงต้องดู Render → Logs** ของ proxy ใหม่ หา:
  ```
  [LINE webhook] message from U1a8b6d349... len=5
  ```
  ส่งข้อความหา OA แล้วเวลาต้องตรงกัน · `len` = จำนวนตัวอักษรที่ส่ง

> ⚠️ **bot ไม่ตอบข้อความทั่วไป — ปกติ ไม่ใช่บั๊ก**
> ตอบเฉพาะ: `รหัสยืนยัน: xxx` · `🔗 ผูกบัญชี xxx` · `ยกเลิก`/`cancel` (เฉพาะเมื่อมี session)
> · ตัวเลข 3-8 หลัก · username `[A-Za-z0-9_.-]{2,40}` · รหัสผ่าน
> ข้อความไทยทั่วไปเช่น "ทดสอบ" จะถูกเมินตามที่ออกแบบไว้

### ยังไม่ทำ (ทำตอนไหนก็ได้ ไม่กระทบการใช้งาน)

- **LIFF endpoint** → ยังชี้ `zepyros11.github.io` · เปลี่ยนเมื่อพร้อมแจก URL ใหม่
  (สร้าง LIFF app ตัวที่ 2 ชี้ URL ใหม่ ทดสอบก่อนก็ได้ แล้วสลับเลข `line_channels.liff_id`)
- **Rich menu** → ปุ่มยังลิงก์ URL เก่า · รันสคริปต์ [setup-line-richmenu.js](../scripts/setup-line-richmenu.js) ใหม่เมื่อพร้อม

ทั้งสองอย่างไม่เร่ง เพราะ **2 URL ใช้งานได้ทั้งคู่และชี้ฐานเดียวกัน**

---

## Phase 5 (เดิม) — รายละเอียดอ้างอิง

LINE ผูกกับระบบ 3 จุด และ **ทุกจุดชี้ปลายทางได้ที่เดียว**:

| จุด | ตั้งที่ไหน | ค่าปัจจุบัน |
|---|---|---|
| **Webhook URL** | LINE Developers → Messaging API | `https://a4s-erp-proxy.onrender.com/line/webhook` |
| **LIFF endpoint** | LINE Developers → LIFF | หน้า register บน `zepyros11.github.io` |
| **Rich menu** (ปุ่ม URL) | สร้างด้วย [scripts/setup-line-richmenu.js](../scripts/setup-line-richmenu.js) | ลิงก์ไป `zepyros11.github.io` |

> LIFF ID เก็บในตาราง `line_channels.liff_id` → ตามมากับ dump อยู่แล้ว ไม่ต้องแก้โค้ด

### ระหว่างเทสต์คู่ขนาน
- **ห้ามย้าย webhook** — ย้ายเมื่อไหร่ ระบบเดิมหยุดรับ event (ผูกบัญชี LINE ของสมาชิกจะพัง) → เก็บไว้ชี้ proxy เดิมจนถึงวัน cutover
- **อย่าใส่ `LINE_CHANNEL_TOKEN` ใน proxy ใหม่** จนกว่าจะพร้อม — ถ้าใส่แล้วเผลอเปิด cron จะ **ส่งข้อความจริงถึงสมาชิกซ้ำ 2 รอบ**
- อยากเทสต์ LINE เต็มรูปแบบ → สร้าง **LINE Messaging API channel ทดสอบใหม่** (ฟรี) + LIFF ทดสอบ ชี้ proxy/Pages ใหม่ แล้วเพิ่มแถวใน `line_channels` ของ DB ใหม่ ชี้ channel ทดสอบ

### วัน cutover (ทำเรียงตามนี้)
1. ปิด Actions ใน repo เดิม (Zepyros11) ทั้งหมด
2. sync ข้อมูลรอบสุดท้าย เก่า → ใหม่ (delta ตั้งแต่วัน restore)
3. เปลี่ยน `GDRIVE_FOLDER_ID` ของ proxy ใหม่ กลับเป็น ID จริง + ย้ายไฟล์ที่อยู่ `_staging` ออก
4. ใส่ `LINE_CHANNEL_SECRET` + `LINE_CHANNEL_TOKEN` ใน proxy ใหม่
5. เปลี่ยน **Webhook URL** ใน LINE Developers → proxy ใหม่ → กด Verify
6. เปลี่ยน **LIFF endpoint URL** → `a4scontent.github.io`
7. รัน `setup-line-richmenu.js` ใหม่ (URL ใหม่)
8. เปิด Actions ใน repo ใหม่
9. แจก URL ใหม่ให้ผู้ใช้

### Rollback
กลับ webhook + LIFF ไปชี้ของเดิม + เปิด Actions repo เดิม → ระบบเดิมกลับมาทันที (ข้อมูลที่กรอกในระบบใหม่ช่วง cutover จะไม่ตามกลับมา)

---

## ของที่ตกค้าง / ต้องทำมือ

- [ ] QR code ที่พิมพ์แจกไปแล้ว — ถ้าฝัง URL เก่า จะพังหลังปิดระบบเดิม (ควรเช็คว่ามีที่ไหนบ้าง)
- [ ] `.env` เครื่อง local — ต้องอัปเดตค่าใหม่
- [ ] backup NDJSON ([D:/@Projects/A4S-backups](D:/@Projects/A4S-backups)) — เปลี่ยนปลายทางเป็น project ใหม่หลัง cutover
- [ ] repo ใหม่เป็น Public + `anon key` อยู่ในโค้ด + RLS ปิดทั้งระบบ = ใครก็อ่าน/เขียน DB ได้ผ่าน REST — ความเสี่ยงเดิมที่ยกมาด้วย ควรวางแผนแก้แยกต่างหาก (ไม่ใช่ scope การย้าย)
