-- ============================================================
-- Migration 163: เพิ่มสถานะ CONFIRMED (ยืนยัน) ให้ campaigns
--
-- Why:
--   เพิ่มสถานะ "ยืนยัน" คั่นระหว่าง ร่าง (DRAFT) กับ ดำเนินการ (ACTIVE)
--   กฎการเปลี่ยนสถานะอัตโนมัติ (ตามวันที่เริ่ม/สิ้นสุด) จะเริ่มทำงาน
--   เฉพาะเมื่อแคมเปญถูก "ยืนยัน" แล้วเท่านั้น:
--     DRAFT      → ไม่ auto (ยังแก้ไขอยู่ ค้างเป็นร่างจนกว่าจะยืนยันเอง)
--     CONFIRMED  → ก่อนถึงวันเริ่ม = คงเป็น CONFIRMED (รอเริ่ม)
--     CONFIRMED/ACTIVE → อยู่ในช่วง = ACTIVE · เลยวันสิ้นสุด = ENDED
--     CANCELLED  → ค้างไว้เสมอ (auto ไม่ทับ)
--   (logic auto อยู่ฝั่ง client: campaign-planning.js computeAutoStatus)
--
-- Idempotent — รันซ้ำได้
-- ============================================================

ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_status_chk;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_status_chk
  CHECK (status IN ('DRAFT','CONFIRMED','ACTIVE','ENDED','CANCELLED'));

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅  Verify:
--   SELECT campaign_id, name, status FROM campaigns;
-- ============================================================
