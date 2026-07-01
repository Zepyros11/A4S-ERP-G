# 06 — CRM (Members/MLM), Customer Service & IBD

> [modules/customer/](../../modules/customer/) (~12), [modules/customer-service/](../../modules/customer-service/) (~11), [modules/ibd/](../../modules/ibd/) (~12), [modules/ibd-portal/](../../modules/ibd-portal/) (~9)
> ตารางหลัก: ดู [02-DATABASE.md](02-DATABASE.md) §7, §10, §11

---

# ส่วน A — CRM / Members (MLM)

> สมาชิก ~100k+ คน sync จาก answerforsuccess.com (ดู [08](08-BACKEND-AUTOMATION.md))

## 1. Members List — `members-list.html/.js`
- ตาราง server-side paginated (50/หน้า) + ~25 คอลัมน์ filter ได้
- ค้นหา: member_code (exact/multi), full_name, sponsor_code, upline_code, phone, email
- filter ประเทศ/package/position (chips); column visibility (localStorage)
- **ถอดรหัส** `password_encrypted` / `national_id_encrypted` ผ่าน `ERPCrypto` (ต้องมี perm `member_decrypt` + master key จาก `app_settings`)
- export Excel; backfill hash (password_hash/national_id_hash) แบบ batch; purge all
- **ตาราง:** `members`, `app_settings`, `automation_tasks`

## 2. Members Dashboard — `members-dashboard.html/.js`
- คุณภาพข้อมูล (company vs individual, full_name ว่าง); donut + รายการปัญหา
- 6 รายงาน (date range): growth รายเดือน, package, ประเทศ, side balance (ซ้าย/ขวา), channel, top sponsors/uplines
- CSV export; ใช้ view `v_member_data_quality` + RPC reports

## 3. Members Tree — `members-tree.html/.js`
- ผังสายงาน MLM 5 โหมด:
  - sponsor-down (ลูกทีม sponsor + ซ้าย/ขวา), sponsor-up (chain upline), sponsor-leaders (เฉพาะ SVP/VP/AVP)
  - upline-down (binary ≤2/node + ซ้าย/ขวา), upline-up (chain upline)
- lazy-load children; ค้นเลข = direct lookup, ค้นชื่อ = suggest 5
- RPC: `get_chain_up` (recursive CTE), `get_direct_downline`
- **ค้นชื่อสมาชิกต้องยิงตาราง `members` + trigram index** (sql/164) ไม่ใช่ ilike บน view (กัน timeout)

## 4. LINE Members — `line-members.html/.js`
- สมาชิกที่เชื่อม LINE (แยกจากผู้เข้า event); stats เชื่อมแล้ว/7วัน/coverage%
- avatar, line name, linked_at/last_active (stale >30 วัน); copy line_user_id; CSV
- **"ลบการเชื่อม LINE"** (ห้ามใช้คำ "ปลดผูก") = ลบจาก `member_line_accounts` + clear `line_*` ใน members
- **ตาราง:** `members`, `member_line_accounts`

## 5. Members Import / Sync — `members-import.html/.js`, `members-sync.html/.js`
- `members-import` — อัปโหลด CSV/ตั้ง master key เข้ารหัส → upsert `members`
- `members-sync` — trigger/ดูสถานะ sync จาก answerforsuccess.com (ผ่าน GitHub Actions `sync-members.yml`, ดู [08](08-BACKEND-AUTOMATION.md))
- **ตาราง:** `members`, `automation_tasks`, `sync_config`, `sync_log`

> Encryption: master key เก็บใน `app_settings(key='member_master_key')` auto-fetch ให้ user ที่มี perm `member_decrypt` (แทน localStorage ต่อเครื่อง)

---

# ส่วน B — Customer Service (CS)

## 1. Daily Sale — `customer-service/daily-sale.html/.js`
- auto-sync 4 xls จาก answerforsuccess.com → 4 ตาราง Supabase (แทน Google Sheet)
- 3 แท็บ:
  - **Sale:** bills + payments (เงินสด/โอน/บัตร/e-wallet/voucher) + KPI
  - **Topup:** บิลเติมเงิน + รายละเอียด
  - **Reconcile:** กระทบยอดด้วยมือ (บิลจริง vs ระบบ, diff, signature, note) + ประวัติ 30 วัน
- ปุ่ม **Sync Now** → trigger GitHub Actions (`sync-daily-sale.yml`) ผ่าน PAT (decrypt จาก app_settings) + polling logs; ปิดวัน (close-day) tag `business_date`
- **ตาราง:** `daily_sale_bills`/`_payments`/`_topup_bills`/`_topup_details`/`_reconcile`/`_summary`, `sync_log`, `sync_config`, `branches`

## 2. Promotions / Catalog — `promotion-list.js`, `promotion-gallery.html`, `promotion-api.js`
- **Catalog ประจำเดือน** (`promotion-gallery`) — แกลเลอรีโปสเตอร์ตามเดือน + หมวด + lightbox
- **จัดการโปรโมชัน** (`promotion-list`) — upload หลายรูป, เลือกหมวด/เดือน, จัดการหมวด (icon/สี)
- bucket `promotion-files`
- **ตาราง:** `promotions`, `promotion_categories`

## 3. Work Plan (scope=cs)
- `work-plan-list.html?scope=cs` (ดู [07](07-SETTINGS-NOTIFICATIONS-MISC.md))

---

# ส่วน C — IBD (International Business Development)

> แทน Google Forms 3 ฟอร์ม สำหรับสมาชิกแอฟริกา (NG/CI/CM/...) · EN/FR · sql/055 · เสร็จ 2026-04-30

## หลังบ้าน — [modules/ibd/](../../modules/ibd/)

| ไฟล์ | หน้าที่ | ตาราง |
|------|---------|-------|
| `ibd-dashboard.js` | summary 3 ฟอร์ม + top topics/branches + recent + export | ทั้ง 3 + `ibd_countries` |
| `ibd-complaints.js` | ฟอร์ม 1 ร้องเรียน/ติดตาม (paginated + filter + caretaker + progress + detail modal signed URL) | `ibd_complaints` |
| `ibd-ewallet.js` | ฟอร์ม 2 ขอโอน E-Wallet (id docs + holding photo, confirmed/accepted, status pending/approved/paid/rejected) | `ibd_ewallet_requests` |
| `ibd-relocation.js` | ฟอร์ม 3 ย้าย Location Base (from/to country, acknowledged, effective_date) | `ibd_relocation_requests` |
| `ibd-storage.js` | signed URL helper (attachment เป็น private) | bucket `ibd-attachments` |
| `ibd-export-modal.js` | export date range (Bangkok TZ) | — |

- **Topics (ฟอร์ม 1):** product_order / info_change / password / commission / service / wrong_sponsor / ethics / other
- **Caretaker:** มอบหมาย user ที่ role ขึ้นต้น IBD (caretaker_user_id, 068)
- **LINE notify:** ส่งผ่าน ai-proxy `/ibd/notify` (whitelist trigger) → LINE + กระดิ่ง

## พอร์ทัลสมาชิก (สาธารณะ) — [modules/ibd-portal/](../../modules/ibd-portal/)
- self-service EN/FR; login = member_code + password_hash (SHA-256 ผ่าน ERPCrypto)
- 3 ฟอร์ม (complaint/ewallet/relocation) + My Requests + upload attachment (anon key, RLS อนุญาต)
- webhook-based LINE linking
- ไฟล์: `portal-config.js`, `portal-shared.js` (i18n EN/FR + auth), `login.html`, `home.html`, `*-form.html`, `my-requests.html`
- **ตาราง:** `ibd_countries` (NG/NG-LAGOS/NG-KANO/CI/CM/TG/UG/ZA/GH/TH/LA, name_en/fr, flag, is_branch), `ibd_complaints`/`ibd_ewallet_requests`/`ibd_relocation_requests`
