-- ============================================================
-- Migration 114: trip_report_templates — preset คอลัมน์ของ Custom Report
--
-- Why:
--   หน้า custom-report.html?trip_id=X ให้ผู้ใช้เลือกคอลัมน์เองจาก
--   3 กลุ่ม (Check Seat / ห้องพัก+รถ / Detail) แล้ว print/excel
--   ตารางนี้เก็บ "ชุดคอลัมน์" ที่ตั้งชื่อไว้ ใช้ซ้ำได้ทุกทริป (org-wide)
--
--   columns — JSONB array ของ column key เรียงตามลำดับที่จะแสดง
--             เช่น ["name","pin","nationality","_room"]
--
-- Idempotent — รันซ้ำได้
-- ============================================================

CREATE TABLE IF NOT EXISTS trip_report_templates (
  template_id SERIAL PRIMARY KEY,
  name        TEXT  NOT NULL,
  columns     JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by  INTEGER,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE trip_report_templates ADD COLUMN IF NOT EXISTS columns    JSONB DEFAULT '[]'::jsonb;
ALTER TABLE trip_report_templates ADD COLUMN IF NOT EXISTS created_by INTEGER;
ALTER TABLE trip_report_templates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- หมายเหตุ: หน้า Custom Report ใช้ permission เดิม trip_pax_detail_view
-- (ไม่สร้าง perm ใหม่ — ผู้ที่ดูข้อมูลผู้เดินทางได้ ก็ทำ report ได้)

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅
-- Verify:
--   SELECT * FROM trip_report_templates;
-- ============================================================
