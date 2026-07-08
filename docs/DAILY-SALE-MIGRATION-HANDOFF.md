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

## ⏳ งานที่เหลือ

### 1. Historical import (DATA_CS → SQL) — รอ CSV
- CSV ที่เคยส่งในแชทเก่า **หายแล้ว** (ไม่ได้เซฟลงดิสก์ · /clear ไปพร้อม context)
- `sql/022_data_cs_import.sql` มีแค่ ~314 บิล (partial) + **ยังไม่ตั้ง corrected=true** (สร้างก่อน migration 025)
- **CSV ไม่ได้เสีย** — ที่เห็นเพี้ยนใน Excel เป็นแค่ display (ไฟล์เป็น UTF-8 ถูกต้อง) · ห้ามเปิด Excel แล้ว Save ทับ (จะเสียจริง)
- **ต้องการ:** ลาก CSV 3 ไฟล์มาวางในแชท → `DailySale_DATA` (~7,600) · `Billonline_DATA` (~1,480) · `CheckBill_DATA`
- **แผน:** เขียน `scripts/import-data-cs.js` อ่าน CSV → map คอลัมน์ → upsert (corrected=true, business_date=sale_date, source='DATA_CS-import') → user รัน `node scripts/import-data-cs.js`
- **Column map:** `Cash`→cash · `Front Office`+`Online`→credit_card · `KBANK`+`KTB`→transfer · `E-WALLET`→ewallet · `gift`→gift_voucher · `QR`→qr_payment · `หักคอม`→commission_deduct · `ARP`→arp_amount · `CheckBill_DATA`→daily_sale_reconcile

### 2. ซ่อม sync ที่ failed
- หน้า Daily Sale ขึ้น "Sync ล่าสุด failed" ค้างที่ 27/4/2569 — pipeline answerforsuccess พังอยู่ ต้องดู log GitHub Actions workflow `sync-daily-sale.yml`

### 3. (ค้างถาม) เสริม guard บิลเก่า
- ถ้ารัน sql/022 ไปแล้ว → UPDATE `daily_sale_payments SET corrected=true WHERE source_file='DATA_CS-import'` กันโดน sync ทับ

---

## ลำดับที่แนะนำ
1. รัน `sql/025` → เปิดใช้ Forward (แก้ channel ได้)
2. ส่ง CSV 3 ไฟล์ → ผมเขียน importer → รัน → ได้ข้อมูลเก่าครบ
3. ซ่อม sync failed → บิลใหม่ไหลเข้าอัตโนมัติ

## Memory ที่เกี่ยวข้อง (มีอยู่แล้ว)
`project_daily_sale_backfill` · `project_daily_sale_module`
