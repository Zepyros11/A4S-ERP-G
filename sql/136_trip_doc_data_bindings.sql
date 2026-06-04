-- 136_trip_doc_data_bindings.sql
-- เพิ่มคอลัมน์ data_bindings ใน trip_documents
-- เก็บ config การดึงข้อมูล (source/trip_id/columns/groupBy/...) จาก custom-report
-- เพื่อให้เอกสารที่สร้างจากปุ่ม "สร้างเป็นจดหมาย" สามารถรีเฟรชข้อมูลได้ภายหลัง (phase 2)
ALTER TABLE trip_documents
  ADD COLUMN IF NOT EXISTS data_bindings JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN trip_documents.data_bindings IS
  'snapshot binding จาก custom-report: {source, trip_id, columns, filters, sort, merged, hidden, groupBy, showTotal}';
