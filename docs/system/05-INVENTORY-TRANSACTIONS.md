# 05 — Inventory, Transactions & Supplier

> [modules/inventory/](../../modules/inventory/) (~43), [modules/transactions/](../../modules/transactions/), [modules/supplier/](../../modules/supplier/)
> ตารางหลัก: ดู [02-DATABASE.md](02-DATABASE.md) §1

---

## 1. Inventory / Stock (คลังสินค้า)

### Products (สินค้า)
- `products-api.js` — CRUD products/categories/units/images
- `product-form.js` / `products-list.js` / `products-table.js` — สร้าง/แก้สินค้า + variant (parent-child ผ่าน `parent_id`); in-context CRUD units/categories ผ่าน ⚙️ modal
- variant ใช้ units ของ parent ถ้าไม่ override; รูป fallback ไป parent

### Categories / Units / Warehouses (master, in-context CRUD)
- `categories-list/form/api/table.js` — หมวดหมู่ (icon/สี/sort)
- `units-list.js` — หน่วยนับ
- `warehouses-list/form/api/table.js` — คลัง (code, type, country, parent_id ลำดับชั้น); filter ตาม country ของ user
- หลักการ: dropdown ที่ CRUD ได้ ใช้ ⚙️ จัดการ + nested modal เสมอ (auto-gen code)

### Stock Balance / Dashboard / Report
- `stock-balance.html/.js` — **On-hand / Reserved / Available** ต่อ SKU + คลัง
  - **On-hand** = Σ signed qty จาก `stock_movements` (คำนวณสด ไม่เก็บ)
  - **Reserved** = (SO confirmed: ordered−delivered) + (REQ approved: approved−issued)
  - **Available** = On-hand − Reserved
  - variant group ใต้ parent; status badge ปกติ/ใกล้สั่ง/หมด/ติดลบ; toggle `inventory_allow_negative`
- `stock-dashboard.html/.js` — มูลค่ารวม (qty×cost), in/low/out-of-stock, top SKU, charts
- `stock-report.html/.js` — รายงาน (คอลัมน์จาก `js/shared/stock-fields.js`) + export
- `stock-initial-list.js` — ตั้งสต็อกเริ่มต้น (สร้าง movement type INIT)

### Movements (ความเคลื่อนไหว)
- `movements.html/.js` — บันทึก/ดู stock movement
  - **Signed qty:** IN/INIT/RETURN/ADJUST/TRANSFER → +qty ; OUT/INTERNAL → −qty
  - timeline ตามวันที่; ref_doc_type/id; lot_no/expiry (optional)

**ตาราง:** `products`, `categories`, `product_units`, `product_images`, `warehouses`(+zones/locations/bins), `stock_movements`, `stock_balance`, `units`, `app_settings`

---

## 2. Transactions (เอกสาร)

> ⚠️ สำคัญ: PO/SO/REQ **ไม่** auto-create `stock_movements` ตอน approve/confirm — สต็อกถูก reserve เท่านั้น ต้องบันทึก movement (รับเข้า/จ่ายออก) แยกเอง

### Purchase Order (PO) — `transactions/purchase_order/`
- `po-list.html` + `po-form.js`/`po-list.js`
- เลือก supplier + warehouse (card grid, filter ตาม country ของ user); line items: product/qty/unit_price + badge สต็อก
- เลขที่: `PO-YYYY-MM-nnnnn`; สถานะ DRAFT → APPROVED → RECEIVED (CANCELLED)
- **ตาราง:** `purchase_orders`, `po_items`, `suppliers`

### Sales Order (SO) — `transactions/sales_order/`
- `so_form.html/.js`
- 2 ประเภท: **SALE** (`SO-YYYY-`, ต้องเลือกสมาชิก) / **INTERNAL** (`INT-YYYY-`, ไม่มีลูกค้า)
- **ขายให้สมาชิก MLM เท่านั้น** — ไม่มีตาราง customers แยก (ใช้ `members`)
- line: product + unit + qty + price; ส่วนลด (จำนวน/%); VAT 7% (default on SALE)
- สถานะ DRAFT → CONFIRMED → DELIVERED (CANCELLED)
- **ตาราง:** `sales_orders`, `so_items`, `members`

### Requisition (REQ) — `transactions/requisition/`
- `requisition-list.html` + `requisition-form.js`/`requisition-list.js`
- เบิกสินค้าภายในต่อแผนก; เลือก dept (auto จาก user.department) + warehouse + purpose
- เลขที่: `REQ-YYYY-MM-nnnnn`; สถานะ DRAFT → PENDING → APPROVED → ISSUED (CANCELLED); workflow อนุมัติ
- **ตาราง:** `requisitions`, `requisition_items`, `requisition_purposes`, `departments`

### Petty Cash (เงินสดย่อย) — `transactions/petty_cash/`
- `petty-cash-list.html` + `petty-cash-form.js`/`petty-cash-list.js`
- ledger รับเข้า/ใช้จ่าย; เลือกบรรทัด → ออกเอกสาร:
  - สรุป Petty Cash
  - **ใบรับรองแทนใบเสร็จ**
  - **ใบสำคัญเงินสดย่อย**
- ใช้ `js/utils/bahtText.js` แปลงจำนวนเงินเป็นคำอ่านไทย
- letterhead จาก `trip_doc_letterheads` + company info จาก `app_settings`
- **ตาราง:** `petty_cash_books`, `petty_cash_items`, `trip_doc_letterheads`, `app_settings`

---

## 3. Supplier — `modules/supplier/suppliers.html/.js`
- CRUD ผู้ขาย (code auto SUP-001, contact, tax_id, credit_days, แผนที่ผ่าน Nominatim)
- แสดงประวัติ PO ล่าสุด; KPI total/active/with-PO; side panel detail
- **ตาราง:** `suppliers`

---

## ข้อจำกัด/หมายเหตุ
- ไม่มี auto stock movement (manual receive/issue)
- ติดลบได้ default (toggle ปิดได้ → reject ถ้า available < 0)
- ขายให้สมาชิกเท่านั้น (ไม่มี customer CRM แยก)
- lot/expiry optional
- batch insert ต้อง normalize keys ทุก row ให้ตรงกัน (ไม่งั้น PGRST102)
