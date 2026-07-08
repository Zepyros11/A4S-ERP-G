# Handoff: ย้าย Daily Sale (Google Sheet → ERP)

> เอกสารส่งต่องาน — วางไฟล์นี้ในโปรเจกต์เพื่อกัน context หาย (/clear)
> อัปเดตล่าสุด: 2026-07-08

## เป้าหมาย
ย้าย process + ข้อมูล Daily Sale จาก Google Sheet (DailySaleCS + DATA_CS) มาไว้บน ERP ทั้งหมด
โดย **ERP = ตัวจริง (source of truth)** เลิกใช้ชีต

## ความจริงหลัก (สำคัญที่สุด — เคยเข้าใจกลับด้าน)
- **answerforsuccess = ข้อมูลดิบที่ "ช่องทางชำระผิด"** — CS ลง channel ผิด แก้หลังบ้านไม่ได้
- **Google Sheet DATA_CS = ข้อมูลที่ "ถูกต้องแล้ว"** (แก้เฉพาะ payment channel · ยอด/ชื่อ/วันที่/เลขบิลเหมือน answer)
- ดังนั้นข้อมูลจาก DATA_CS ต้องตั้ง `corrected=true` เสมอ เพื่อกัน sync (answer ดิบ) เขียนทับ

## สถาปัตยกรรมที่มีอยู่แล้ว
- Schema: `daily_sale_bills` · `daily_sale_payments` · `daily_sale_topup_bills` · `daily_sale_topup_details` · `daily_sale_reconcile` · `branches` · view `daily_sale_summary`
- Sync: Playwright + GitHub Actions (`scripts/sync-daily-sale.js`) ดึง 4 xls จาก answerforsuccess ทุก 1 ชม. → upsert
- `business_date` + RPC `daily_sale_close_day` (migration 023): บิล sync เข้ามา business_date=NULL (pending) · กด Sync Now → ปิดวัน tag pending เป็นวันนี้
- หน้า UI: `modules/customer-service/daily-sale.html/js/css`

## Day-close model (ยืนยันแล้ว — อย่าเปลี่ยน)
ใช้ **manual close** (กด Sync Now = เส้นแบ่งวัน) ไม่ใช่ hard 18:00 cutoff
เหตุผล: ปิดยอด "โดยประมาณ" 18:00 + บิล online หลัง 18:00 ต้องนับเป็นวันถัดไป
→ pending (NULL) ค้างไว้ รอบปิดถัดไปตีเป็นพรุ่งนี้เอง

---

## ✅ Forward workstream — ทำเสร็จแล้ว (session นี้)
ย้าย "ชั้นแก้ไขช่องทางชำระ" จากชีต มาไว้ใน ERP

| ไฟล์ | สิ่งที่ทำ |
|---|---|
| `sql/025_daily_sale_corrected.sql` | เพิ่ม `corrected`/`corrected_by`/`corrected_at`/`correction_notes` ใน daily_sale_payments · **ต้องรันมือใน Supabase** |
| `scripts/lib/supabase-dailysale.js` | `upsertPayments()` ดึง bill_no ที่ corrected=true กรองออกจาก batch → sync ไม่ทับ channel ที่ CS แก้ (bills identity ยัง upsert ปกติ) |
| `modules/customer-service/daily-sale.{html,js,css}` | (1) ปุ่ม ✏️ ต่อแถว → modal แก้ 8 ช่องทาง + badge "แก้แล้ว" (2) แท็บ **"🆕 บิลใหม่รอตรวจ"** = บิล business_date IS NULL + badge จำนวน + แก้ channel ได้จากตรงนั้น |

**ทดสอบแล้ว:** syntax ผ่าน · ID ตรง · UI ขึ้นจริง (แท็บบิลใหม่รอตรวจโชว์ 190 บิล)
**ค้าง:** ต้องรัน `sql/025` ก่อนใช้ modal แก้จริง (บันทึกจะ error ถ้ายังไม่มีคอลัมน์)

**ข้อจำกัด increment 1:** ยังใช้ `transfer`/`credit_card` คอลัมน์เดียว (ชื่อธนาคารไปอยู่ `payment_method` text) — ยังไม่แยก KBANK/KTB · Front Office/Online ถ้ารายงานสรุปต้องแยกธนาคาร ค่อยเพิ่มทีหลัง

---

## ✅ Historical import (DATA_CS) — เสร็จแล้ว (2026-07-08)
- CSV 3 ไฟล์เซฟไว้ที่ `data/daily-sale-import/` (ต้นฉบับ UTF-8 · ห้ามเปิด Excel save ทับ)
- Importer: [`scripts/import-data-cs.js`](../scripts/import-data-cs.js) — อ่าน CSV → map → upsert idempotent · `DRY_RUN=1` = ตรวจอย่างเดียว · preflight เช็ค migration 021/023/025 live ก่อนเขียน
- **ผลรัน:** 7,081 bills · 7,081 payments (**corrected=true ทุกแถว** กัน sync ทับ) · 184 reconcile · source_file=`DATA_CS-import` · ช่วง 2025-09-01 … 2026-07-07 · verified round-trip ครบ
- **Column map:** `Cash`→cash · `Front Office`+`Online`→credit_card · `KBANK`+`KTB`→transfer · `E-WALLET`→ewallet · `gift`→gift_voucher · `qr`→qr_payment · `หักคอม`→commission_deduct · `ARP`→arp_amount · TYPE→bill_type · `CheckBill_DATA`→daily_sale_reconcile
- **การตัดสินใจ (encode ไว้ในโค้ด):**
  1. ETH (EWALLET เติมเงิน 605 บิล) ปนใน DailySale → import เข้า `daily_sale_bills` ตามชีท แต่ tag `bill_type='EWALLET'` → แยกไป topup ทีหลังได้
  2. branch = `BKK01` บังคับล้วน (Billonline สาขา=จุดรับของ NB/DP ไม่ใช่สาขาขาย · รายละเอียดอยู่ใน note)
  3. CheckBill: คู่แรก=นับจริง(bill_count/value) คู่สอง=system → ตรงเครื่องหมาย ผลต่าง ในชีท (verify 12/7 = −13,400)
  4. duplicate bill_no 300 กลุ่ม (297 เหมือนเป๊ะ · 3 ต่างแต่ Total เท่า) → last-wins ไม่ทำเงินหาย
  5. 3 บิล Total มีแต่ชีทไม่ลงช่องทาง (STHBKK012509000386/628/667) = gap ต้นทาง import ตามจริง
- **รันซ้ำ:** `node scripts/import-data-cs.js` (upsert idempotent ปลอดภัย)

## ⏳ งานที่เหลือ

### ~~2b. บิลค้าง "รอตรวจ" 70 ใบ~~ ✅ แก้แล้ว 2026-07-08
- อาการ: บิล เม.ย. 2026 (19–27) โผล่แท็บ "รอตรวจ" · เหตุ: sync fail → business_date=NULL ค้าง (ไม่เคย close_day)
- แก้: [sql/026_close_stale_pending.sql](../sql/026_close_stale_pending.sql) ตีตรา business_date=sale_date ให้ NULL ที่ sale_date<วันนี้ (รันแล้ว · NULL เหลือ 0)

### 2. ซ่อม sync ที่ failed  ← เหลืองานนี้
- หน้า Daily Sale ขึ้น "Sync ล่าสุด failed" ค้างที่ 27/4/2569 — pipeline answerforsuccess พังอยู่ ต้องดู log GitHub Actions workflow `sync-daily-sale.yml`
- หมายเหตุ: พอ sync กลับมา บิลใหม่จะเข้า business_date=NULL (pending) ตามปกติ · sql/026 จัดการเฉพาะ orphan เก่า ไม่กระทบ flow ปกติ

### ~~3. เสริม guard บิลเก่า~~ ✅ ครบแล้ว
- importer เขียน `corrected=true` ทุกแถวอยู่แล้ว → ไม่ต้อง UPDATE แยก

---

## ลำดับที่แนะนำ
1. ~~รัน `sql/025`~~ ✅ live แล้ว (preflight ยืนยัน)
2. ~~import CSV~~ ✅ เสร็จ 2026-07-08 (7,081 บิล)
3. **ซ่อม sync failed** (ค้าง 27/4/2569) → บิลใหม่ไหลเข้าอัตโนมัติ ← เหลืองานเดียว

## Memory ที่เกี่ยวข้อง (มีอยู่แล้ว)
`project_daily_sale_backfill` · `project_daily_sale_module`
