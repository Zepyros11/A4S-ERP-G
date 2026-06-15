-- ============================================================
-- Migration 141: Petty Cash module (เอกสารเบิกเงินสดย่อย)
--
-- Why:
--   เมนูใหม่ "Petty Cash" ในกลุ่ม "เอกสาร"
--   (modules/transactions/petty_cash/petty-cash-list.html + form)
--
--   Flow:
--     1) กรอก ledger เงินสดย่อย (วันที่/รายละเอียด/เงินนำเข้า/ค่าใช้จ่าย) = ภาพ "Petty Cash"
--     2) เลือกบรรทัดค่าใช้จ่าย → ออกเอกสาร:
--          • ใบรับรองแทนใบเสร็จรับเงิน
--          • ใบสำคัญเงินสดย่อย (Petty Cash Voucher)
--     3) พิมพ์ / บันทึก PDF
--
--   2 ตาราง:
--     petty_cash_books  — สมุด/รอบเบิก 1 ฉบับ = 1 ledger
--     petty_cash_items  — บรรทัดในสมุด (เงินนำเข้า / ค่าใช้จ่าย)
--
--   หัวกระดาษ (logo A4S + ที่อยู่บริษัท) ดึงจาก app_settings (company_*) ใน front-end
--
--   ⚠️ permission system ไม่มี admin bypass — ต้อง grant keys ให้ role (ดูท้ายไฟล์)
--   Idempotent — รันซ้ำได้
-- ============================================================

-- ── สมุดเงินสดย่อย (รอบเบิก) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS petty_cash_books (
  book_id      BIGSERIAL PRIMARY KEY,
  book_no      TEXT NOT NULL,                       -- เลขที่ เช่น PC-2026-01-001
  title        TEXT,                                -- ชื่อรอบ เช่น "ค่าใช้จ่ายทริป African Leaders"
  date_from    DATE,
  date_to      DATE,
  prepared_by  TEXT,                                -- ผู้จัดทำ (Prepare by)
  approved_by  TEXT,                                -- ผู้อนุมัติ (Approve by)
  note         TEXT,
  status       TEXT NOT NULL DEFAULT 'DRAFT',       -- DRAFT | FINAL
  created_by   INTEGER,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- ── บรรทัดในสมุด ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS petty_cash_items (
  item_id     BIGSERIAL PRIMARY KEY,
  book_id     BIGINT NOT NULL REFERENCES petty_cash_books(book_id) ON DELETE CASCADE,
  line_date   DATE,
  detail      TEXT,                                 -- รายละเอียดรายจ่าย
  cash_in     NUMERIC(14,2) NOT NULL DEFAULT 0,     -- คอลัมน์ Petty Cash (เงินนำเข้า)
  amount_out  NUMERIC(14,2) NOT NULL DEFAULT 0,     -- คอลัมน์ Amount (ค่าใช้จ่าย)
  payee       TEXT,                                 -- ผู้รับเงิน/จ่ายให้ (สำหรับออกใบสำคัญ)
  remark      TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_petty_cash_items_book ON petty_cash_items(book_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_petty_cash_book_no ON petty_cash_books(book_no);

-- ============================================================
-- Grant perm keys ให้ role ที่ใช้งานเอกสารอยู่แล้ว
--   • ADMIN (full access by convention)
--   • role ที่เห็นเอกสารสั่งซื้อ/เบิกสินค้าอยู่แล้ว (po_view หรือ req_view)
--   ทำตาม pattern เดียวกับ migration 125
-- ============================================================
UPDATE role_configs
SET permissions = (
  SELECT to_jsonb(array(
    SELECT DISTINCT unnest(
      array(SELECT jsonb_array_elements_text(permissions))
      || ARRAY[
        'petty_cash_view','petty_cash_create','petty_cash_edit','petty_cash_delete'
      ]
    )
  ))
)
WHERE role_key = 'ADMIN'
   OR permissions ? 'po_view'
   OR permissions ? 'req_view';

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅
-- Verify:
--   SELECT * FROM petty_cash_books;
--   SELECT * FROM petty_cash_items;
--   SELECT role_key, permissions ? 'petty_cash_view' AS pc_view
--   FROM role_configs ORDER BY sort_order;
-- ============================================================
