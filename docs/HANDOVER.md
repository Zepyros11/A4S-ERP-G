# เอกสารส่งมอบระบบ A4S-ERP

> เขียน 29 ก.ค. 2569 · ตอนย้ายระบบมาอยู่บัญชีบริษัท
> ⚠️ **repo นี้เป็น Public** — เอกสารนี้จึงไม่มีค่าคีย์จริง มีแต่ "คีย์อยู่ที่ไหน"

เอกสารแบ่ง 2 ส่วน:
- **[ส่วนที่ 1](#ส่วนที่-1--สำหรับผู้ดูแลระบบ)** — สำหรับผู้ดูแล (ไม่ต้องเขียนโค้ดเป็น)
- **[ส่วนที่ 2](#ส่วนที่-2--สำหรับทีม-dev-ที่รับช่วงต่อ)** — สำหรับทีม dev ที่รับช่วงต่อ

---
---

# ส่วนที่ 1 — สำหรับผู้ดูแลระบบ

## 1.1 ระบบนี้คืออะไร

ระบบ ERP ภายในของบริษัท ใช้จัดการสมาชิก MLM · อีเวนต์ · ทริป · คลังสินค้า · เอกสาร · แจ้งเตือน LINE

**เว็บ:** https://a4scontent.github.io/A4S-ERP-G/

ระบบยืนอยู่บน **4 ขา** ถ้าขาไหนล้ม จะพังต่างกัน:

| ขา | คืออะไร | ถ้าล้ม |
|---|---|---|
| **GitHub Pages** | ตัวเว็บที่คนเปิดใช้ | เปิดเว็บไม่ได้เลย |
| **Supabase** | ฐานข้อมูล | เว็บเปิดได้แต่ไม่มีข้อมูล |
| **Render** (ai-proxy) | ตัวกลางคุย LINE / รูปภาพ / งานอัตโนมัติ | รูปไม่ขึ้น · LINE ไม่ส่ง · อัปโหลดไม่ได้ |
| **Google Drive** | ที่เก็บไฟล์รูปจริง | รูปไม่ขึ้น |

## 1.2 บัญชีที่ต้องดูแล

| บริการ | บัญชี | ค่าใช้จ่าย |
|---|---|---|
| GitHub | `a4scontent` | ฟรี |
| Supabase | `a4scontent's Org` → project `a4scontent's Project` | ฟรี |
| Render | service `a4s-erp-proxy-new` | ฟรี |
| Google Drive | Shared Drive **`A4S-ERP-Images`** ของบริษัท | ใช้โควตา Workspace เดิม |
| Google Cloud | project **`a4s-storage`** ใต้องค์กร **`a4s.global`** — ออก service account ให้เข้า Drive | ฟรี |
| LINE | Messaging API channel **A4S Lyra** | ฟรี (มีโควตาข้อความ/เดือน) |

### ✅ ตรวจแล้ว 29 ก.ค. 2569 — ขา Google Drive ไม่ผูกกับตัวบุคคล

- **Shared Drive** = เป็นของ**องค์กร** ไม่ใช่ของคนสร้าง → บัญชีใครถูกลบ ไฟล์ก็ยังอยู่ครบ
- **Google Cloud project `a4s-storage`** = อยู่ใต้องค์กร `a4s.global` (ID 414906114207) ไม่ใช่บัญชีส่วนตัว
- **Service account** ที่ระบบใช้: `a4s-drive-uploader@a4s-storage.iam.gserviceaccount.com`
  เป็นสมาชิกของ Shared Drive ระดับ **ผู้จัดการเนื้อหา**

ผู้ดูแล Google Workspace ของบริษัทเข้าจัดการทั้งสองอย่างได้เสมอ

> project อื่นในองค์กรเดียวกัน (ไม่เกี่ยวกับ ERP โดยตรงแต่บันทึกไว้): `A4S-Trend`, `A4S-Automation`, `A4S-Customer-Data-Project`, `Calendar`
>
> ⚠️ project ชื่อ `A4S-ERP` (id `a4s-erp`) ที่อยู่ใต้ Gmail ส่วนตัวของผู้พัฒนาเดิม **ไม่ได้ถูกใช้โดยระบบนี้** — อย่าสับสน

## 1.3 ตัวเลขที่ต้องเฝ้า

| อย่าง | ตอนนี้ | เพดาน | ถ้าเกิน |
|---|---|---|---|
| ขนาดฐานข้อมูล | **110 MB** | 500 MB | ระบบหยุดรับข้อมูลใหม่ |
| ไฟล์ใน Supabase Storage | ~16 MB (49 ไฟล์) | 1 GB | อัปโหลดไม่ได้ |
| สมาชิกในระบบ | 117,259 คน | — | |

โตช้ามาก ไม่น่าถึงเพดานในปีนี้ แต่ควรดูปีละครั้ง

## 1.4 งานที่มีกำหนดเวลา

| เมื่อไหร่ | ต้องทำอะไร |
|---|---|
| **12 ก.ย. 2569** | GitHub PAT หมดอายุ → ปุ่ม "Sync ตอนนี้" ในหน้าเว็บจะใช้ไม่ได้ (ระบบ sync อัตโนมัติยังทำงานปกติ) ต้องออก token ใหม่แล้วใส่ในหน้า **CRM → ซิงค์สมาชิก** |
| เมื่อบัญชี answerforsuccess ที่ใช้ดึงข้อมูลถูกระงับ | เปลี่ยนบัญชีในหน้า **CRM → ซิงค์สมาชิก** (ดูข้อ 1.5) |

## 1.5 อาการพังที่พบบ่อย + วิธีแก้

### 🔴 หน้า Dashboard ขึ้นตัวเลข 0 หรือกราฟไม่ขึ้น

**สาเหตุ:** ฐานข้อมูลมีขยะสะสมจากการ sync ทุกวัน ทำให้คำนวณช้าเกินกำหนด

**วิธีแก้:** เข้า Supabase → เมนูซ้าย **SQL Editor** → วางบรรทัดนี้ → กด **Run**
```sql
VACUUM (ANALYZE) members;
```
รอสักครู่แล้วรีเฟรชหน้าเว็บ · ปลอดภัย ทำระหว่างคนใช้งานอยู่ได้ · ควรทำทุก 1-2 เดือน

---

### 🔴 รูปภาพไม่ขึ้น / อัปโหลดรูปไม่ได้ / LINE ไม่ส่ง

**สาเหตุที่พบบ่อยสุด:** Render (ตัวกลาง) หลับอยู่ — มันหลับเองเมื่อไม่มีคนใช้ 15 นาที

**วิธีแก้:** เปิด https://a4s-erp-proxy-new.onrender.com/ ในเบราว์เซอร์ รอ ~1 นาที
ถ้าขึ้น `{"status":"ok"}` = ตื่นแล้ว กลับไปใช้งานเว็บได้

ถ้ายังไม่ขึ้น → เข้า render.com → service `a4s-erp-proxy-new` → ดูแท็บ **Logs** และกด **Manual Deploy**

---

### 🔴 ข้อมูลสมาชิกไม่อัปเดต / ไม่มีสมาชิกใหม่เข้ามา

**สาเหตุ:** บัญชี answerforsuccess ที่ใช้ดึงข้อมูลถูกระงับ หรือรหัสผ่านเปลี่ยน

**วิธีแก้:** เข้าเว็บ ERP → เมนู **CRM → ซิงค์สมาชิก** → กรอก username/password ของบัญชี answerforsuccess ตัวใหม่ → บันทึก

> บัญชีที่ใช้ต้องมีสิทธิ์เข้าดู **รายงานสาขา** ไม่งั้นระบบหาหน้าไม่เจอ

**ตรวจว่าใช้ได้ไหม:** ไป GitHub → แท็บ **Actions** → **Sync Members** → **Run workflow**
ดู log ถ้าขึ้น `🔐 Logged as: ...` แล้วไปต่อ = ใช้ได้

---

### 🔴 หน้าเว็บขึ้นข้อมูลเก่า / แก้แล้วไม่เปลี่ยน

กด **Ctrl + Shift + R** (ล้าง cache แล้วโหลดใหม่)

---

### 🔴 ลืมรหัสผ่านเข้าระบบ

ผู้ใช้ที่มีสิทธิ์ ADMIN แก้ให้ได้ที่ **ตั้งค่า → ผู้ใช้งาน**

## 1.6 สิ่งที่ห้ามทำ

| ห้าม | เพราะ |
|---|---|
| ❌ ลบหรือแก้ค่า `member_master_key` ใน Supabase (ตาราง `app_settings`) | เป็นกุญแจถอดรหัสข้อมูลส่วนตัวสมาชิก 117,000 คน **ถ้าหาย = ข้อมูลอ่านไม่ออกตลอดกาล กู้ไม่ได้** |
| ❌ ลบ project Supabase / repo GitHub / service Render | ไม่มี backup อัตโนมัติ |
| ❌ เปลี่ยน Webhook URL ใน LINE Developers | การเชื่อมบัญชี LINE ของสมาชิกจะพังทันที |
| ❌ กด "Reset database password" ใน Supabase โดยไม่จำเป็น | ระบบเบื้องหลังที่ใช้รหัสนั้นจะหยุดทำงาน |

## 1.7 คีย์และรหัสอยู่ที่ไหน

**ไม่มีคีย์เก็บในเอกสารนี้** (repo เป็น Public) — แต่ละอันดูได้จาก:

| คีย์ | ดูได้ที่ |
|---|---|
| Supabase URL / API keys | Supabase Dashboard → Settings → API Keys |
| รหัสผ่านฐานข้อมูล | Supabase Dashboard → Settings → Database (ดูไม่ได้ ต้อง reset ใหม่) |
| คีย์ของ Render ทั้งหมด | render.com → service → แท็บ **Environment** |
| คีย์ของ GitHub Actions | GitHub → Settings → Secrets and variables (ใส่ได้อย่างเดียว ดูย้อนไม่ได้) |
| กุญแจถอดรหัสสมาชิก | Supabase → Table Editor → `app_settings` → แถว `member_master_key` |
| LINE token | Supabase → ตาราง `line_channels` (เข้ารหัสไว้) และ LINE Developers Console |

> 📌 **สำคัญ:** กุญแจถอดรหัสสมาชิกต้องเป็นค่า**เดียวกัน**ทั้ง 2 ที่ คือใน `app_settings` และใน GitHub Secret ชื่อ `MASTER_KEY` ถ้าไม่ตรงกัน ระบบ sync จะพัง

---
---

# ส่วนที่ 2 — สำหรับทีม dev ที่รับช่วงต่อ

## 2.1 อ่านอะไรก่อน

1. [docs/system/00-OVERVIEW.md](system/00-OVERVIEW.md) — ภาพรวมทั้งระบบ + สารบัญเอกสารชุดใหญ่ (9 ไฟล์ อธิบายทุกโมดูล + DB + backend)
2. [docs/MIGRATION-2026-08.md](MIGRATION-2026-08.md) — บันทึกการย้ายระบบมาบัญชีบริษัท (ก.ค. 2569) มีวิธี dump/restore, ย้าย storage, เขียน URL ใหม่
3. ไฟล์นี้ — ส่วนที่ 2.3 (ความเสี่ยงที่รู้อยู่แล้ว) **อ่านก่อนแตะโค้ด**

## 2.2 สิ่งที่ต้องรู้ก่อนแตะโค้ด

**Stack:** Vanilla JS + HTML + CSS ล้วน · **ไม่มี build step · ไม่มี framework · ไม่มี npm ฝั่ง frontend**
แก้ไฟล์ → push → GitHub Pages deploy เอง (~1 นาที)

**Backend:** Node/Express ตัวเดียวที่ [ai-proxy/server.js](../ai-proxy/server.js) บน Render (free tier — หลับเมื่อไม่มีคนใช้ 15 นาที)

**ฐานข้อมูล:** Supabase (PostgreSQL) — หน้าเว็บยิง REST เข้า PostgREST **ตรงจาก browser** ด้วย anon key

**⚠️ กับดักที่ต้องรู้:**

| เรื่อง | รายละเอียด |
|---|---|
| **config โหลดแค่ 3 หน้า** | มีแค่ `login.html`, `web-editor.html`, `web-pages.html` ที่โหลด [js/core/config.js](../js/core/config.js) · อีก 94 หน้าอ่าน `localStorage.getItem('sb_url')` ที่ 3 หน้านั้นเขียนไว้ · localStorage แยกตาม origin จึงใช้งานได้จริง แต่เปราะ |
| **env switch** | โค้ดชุดเดียวรองรับ 2 สภาพแวดล้อม — ดู `window.ERP_IS_NEW` ใน config.js · ตกค้างจากช่วงย้ายระบบ **ลบทิ้งได้เมื่อระบบเก่าถูกปิดถาวรแล้ว** |
| **RLS ปิดทั้งระบบ** | ทุกตารางใน `public` ปิด Row Level Security + `GRANT` ให้ `anon` · **CREATE TABLE ใหม่ทุกครั้งต้อง `DISABLE ROW LEVEL SECURITY` + `GRANT` ไม่งั้นหน้าเว็บพังเงียบๆ** (SQL Editor bypass RLS ทำให้หลอกตาว่าใช้ได้) |
| **ไฟล์รูปอยู่ Google Drive** | URL เก็บเป็น `https://<proxy>/drive/file/<fileId>` — **hostname ของ proxy ฝังอยู่ในข้อมูล** ถ้าย้าย proxy ต้องรัน [sql/173_rewrite_proxy_urls.sql](../sql/173_rewrite_proxy_urls.sql) |
| **ข้อมูลลับเข้ารหัสฝั่ง client** | AES-GCM + PBKDF2 100k, salt `A4S-ERP-salt-v1` · ดู [js/core/crypto.js](../js/core/crypto.js) (browser) และ [scripts/lib/crypto.js](../scripts/lib/crypto.js) (node) — ต้องตรงกันเสมอ |
| **`sql/` ไม่ใช่ migration ที่รันซ้ำได้** | 173 ไฟล์ ปนทั้ง schema migration และ data fix ครั้งเดียว · **อย่ารันทั้งชุดใหม่** ถ้าต้องย้าย DB ให้ใช้ `pg_dump`/`pg_restore` |
| **งานอัตโนมัติ** | GitHub Actions 4 ตัว: `sync-members` (รายชั่วโมง) · `sync-daily-sale` (8:00-20:00) · `notif-cron` (ทุก 15 นาที) · `keep-render-alive` (ทุก 10 นาที) · ปิด cron ได้ด้วย repo variable `CRON_DISABLED=1` (กดรันมือยังได้อยู่) |

## 2.3 ความเสี่ยงที่รู้อยู่แล้ว (เรียงตามความสำคัญ)

### 🔴 1. ใครก็อ่าน/เขียนฐานข้อมูลได้ — ไม่ต้อง login

`anon key` อยู่ในโค้ดของ repo **สาธารณะ** และ RLS ปิดทั้งระบบ พิสูจน์แล้วเมื่อ 29 ก.ค. 2569 ว่าคนนอกทำได้:

- อ่าน `app_settings.member_master_key` → **กุญแจถอดข้อมูลส่วนตัวสมาชิก 117,000 คน**
- อ่าน `users` ทั้งตาราง รวม `password_hash`
- `POST` สร้างข้อมูลใหม่ได้ (ทดสอบกับ `departments` ได้ HTTP 201) → **สร้างบัญชี ADMIN ให้ตัวเองแล้ว login เข้ามาได้**

**ทำไมยังไม่แก้:** ต้องรื้อสถาปัตยกรรม — ระบบไม่มี identity ระดับฐานข้อมูล (ไม่ได้ใช้ Supabase Auth) จึงเขียน RLS policy แยกผู้ใช้ไม่ได้ ต้องย้ายการเข้าถึงข้อมูลสำคัญไปผ่าน proxy ที่ตรวจสิทธิ์จริงก่อน

**แนวทางที่แนะนำ (ทำทีละขั้น):**
1. ย้าย `member_master_key` ออกจากตารางที่ anon อ่านได้ → เก็บใน env ของ proxy + เปิด endpoint ที่ตรวจรหัสผ่าน ERP ก่อนคืนคีย์
2. ปิด `anon` อ่านตาราง `users` → ย้ายการตรวจ login ไปที่ proxy (ตอนนี้ตรวจฝั่ง browser ที่ [login.html](../login.html))
3. ค่อยๆ ปิดสิทธิ์เขียนของ `anon` ทีละตาราง แล้วเปิด endpoint แทน

### 🟠 2. ไม่มี backup

Supabase Free ไม่มี backup อัตโนมัติ · มีสคริปต์ [scripts/backup-db.cjs](../scripts/backup-db.cjs) แต่ต้องรันมือ
ข้อมูลสมาชิก/ยอดขาย ดึงใหม่จาก answerforsuccess ได้ แต่ **ข้อมูลที่เกิดในระบบนี้เอง (event, trip, campaign, IBD, petty cash, survey) ไม่มีต้นทางให้กู้**

แนะนำ: ทำ GitHub Actions รัน backup อัตโนมัติแล้วอัปเก็บใน Google Drive ของบริษัท

### 🟠 3. รหัสผ่านพนักงานใช้ SHA-256 เปล่า

[login.html](../login.html) hash ด้วย SHA-256 ไม่มี salt ไม่มี key stretching → ถ้า `password_hash` หลุด (ซึ่งหลุดได้ตามข้อ 1) แกะกลับได้ไม่ยาก
ควรเปลี่ยนไปใช้ bcrypt/argon2 ฝั่ง server พร้อมกับข้อ 1.2

### 🟡 4. อื่นๆ

- ทุกอย่างอยู่บน free tier — Render หลับ 15 นาที, Supabase Free อาจ pause ถ้าไม่มีการใช้งาน 1 สัปดาห์
- `sql/` 173 ไฟล์ไม่มีระบบ migration จริง (ไม่มีตารางบันทึกว่ารันอะไรไปแล้ว)
- CSS/JS หลายไฟล์ตายแล้วแต่ยังอยู่ (ดู `docs/system/`)
- ไม่มี test อัตโนมัติเลย

## 2.4 ถ้าจะเริ่มทำงาน

```bash
git clone https://github.com/a4scontent/A4S-ERP-G.git
cd A4S-ERP-G
# เปิดด้วย Live Server (VS Code extension) ที่ port 5501 — ไม่ต้อง build อะไร
```

แก้ไฟล์ → commit → push → GitHub Pages deploy เอง ~1 นาที (ไม่มี staging environment)

**ทดสอบก่อน push:** ไม่มีระบบทดสอบ — ต้องเปิดหน้าที่แก้ในเบราว์เซอร์แล้วดู Console ว่าไม่มี error

---

## ติดต่อ

ผู้พัฒนาเดิมไม่ได้อยู่กับบริษัทแล้ว · เอกสารชุด [docs/system/](system/) คือแหล่งข้อมูลที่ครบที่สุดที่มี
