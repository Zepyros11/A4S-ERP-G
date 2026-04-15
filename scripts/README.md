# A4S-ERP Sync — Auto-sync Members from answerforsuccess

## 📋 Overview

Script ที่ run บน **GitHub Actions** (cron ทุก 1 ชม.) เพื่อ:
1. อ่าน `sync_config` จาก Supabase
2. Decrypt credentials ด้วย Master Key
3. Login answerforsuccess.com ด้วย Playwright
4. Export members → parse `.xls` → upsert Supabase
5. Log ผลลง `sync_log`

**สถานะ:** Phase 2B — skeleton (login only). Export flow ยังไม่ implement

---

## 🔧 Setup

### 1. เพิ่ม GitHub Secrets

ไปที่ https://github.com/Zepyros11/A4S-ERP-G/settings/secrets/actions

เพิ่ม **3 secrets:**

| Name | ค่า | หาจากไหน |
|---|---|---|
| `SUPABASE_URL` | `https://xxx.supabase.co` | Supabase Dashboard → Settings → API |
| `SUPABASE_SERVICE_KEY` | `eyJhbGc...` (service_role — **ไม่ใช่ anon**) | Supabase → Settings → API → service_role secret |
| `MASTER_KEY` | Master Key ที่ใช้ใน ERP | ตัวเดียวกับที่ตั้งตอน import |

> ⚠️ **Master Key = key ที่ encrypt/decrypt รหัสผ่าน** — ถ้าใส่ผิด decrypt ไม่ได้ → script fail

---

### 2. Run locally (ทดสอบ login)

```bash
cd scripts
npm install
npx playwright install chromium

# สร้าง .env (ไม่ commit)
cat > .env <<EOF
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGc...
MASTER_KEY=your-master-key
EOF

# Run with visible browser
LOCAL_TEST=1 node --env-file=.env sync-members.js
```

**Expected output:**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔄 A4S-ERP Sync Members
   Mode: LIVE · LOCAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 Loading sync_config...
🔐 Logged as: phop
📝 sync_log id=...

🌐 Navigating to https://www.answerforsuccess.com/branch/index.php
   📸 debug-01-login-page.png
🔑 Attempting login...
   📸 debug-02-after-login.png
✅ Logged in — current URL: ...

⏳ Export flow not implemented yet (waiting for Phase 2C spec)
```

จะได้ screenshot 2 รูปใน `scripts/debug-*.png` — ดูว่า login ได้จริงไหม

---

### 3. Test manual trigger บน GitHub Actions

1. Push code ขึ้น repo
2. ไป GitHub → **Actions tab** → **Sync Members** workflow
3. กด **Run workflow** → Run
4. ดู log ใน Actions → ต้องเห็น step `🚀 Run sync` สำเร็จ
5. ถ้า failed → screenshots จะอยู่ใน artifact `debug-screenshots`

---

### 4. Verify Auto-Sync

- Cron `0 * * * *` = ทุก **นาทีที่ 0** ของชั่วโมง
- Script จะเช็ค `sync_config.next_sync_at` — ถ้ายังไม่ถึง → skip
- Log ทุกครั้งลง `sync_log` table (ดูได้จาก ERP → ตั้งค่า Auto-Sync)

---

## 🧩 Architecture

```
 GitHub Actions (cron ทุก 1 ชม.)
        │
        ▼
 scripts/sync-members.js
        │
        ├─► lib/supabase.js → Supabase REST (getConfig, startLog, upsert, finishLog)
        ├─► lib/crypto.js   → AES-GCM decrypt credentials
        └─► Playwright      → login + scrape answerforsuccess
                │
                ▼
         .xls download → SheetJS parse → Supabase upsert
```

---

## ⚠️ Known Limitations (Phase 2B)

- ❌ Export flow ยังไม่เขียน (รอ user แจ้ง step-by-step)
- ❌ Parse `.xls` ยังไม่ integrate
- ✅ Login + credentials decrypt ทำงาน
- ✅ sync_log logging ทำงาน
- ✅ GitHub Actions infrastructure พร้อม

---

## 🐛 Troubleshooting

### "MASTER_KEY env missing"
→ ตั้ง GitHub Secret `MASTER_KEY` หรือ local `.env`

### "Credentials not set in sync_config"
→ ไปหน้า ERP → ตั้งค่า Auto-Sync → กรอก username/password → บันทึก

### "Login failed — credentials rejected"
→ เปิด `debug-02-after-login.png` ดูว่าเว็บบอกอะไร
→ หรือเช็ค username/password ใน ERP UI ว่าถูกไหม

### DOM selector ผิด
→ เปิด `debug-01-login-page.png` → inspect HTML ของ answerforsuccess.com
→ แก้ selector ใน `sync-members.js` function login section

---

## 📅 Next: Phase 2C

รอ user แจ้ง Export flow:
1. หลัง login ไปเมนูไหน?
2. กดปุ่มอะไรบ้างจนได้ไฟล์
3. ไฟล์ชื่ออะไร / เลือกช่วงปียังไง

แล้วจะเขียน scraper function ใน `sync-members.js` ต่อ
