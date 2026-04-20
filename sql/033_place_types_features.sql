-- ============================================================
-- Migration 033: Feature flags on place_types
-- ระบุว่าแต่ละประเภทสถานที่มี section ใดบ้างใน events-place-form
--   • has_accommodation → โชว์ section "มีห้องพัก"
--   • has_meeting       → โชว์ section "มีห้องประชุม"
--
-- Default TRUE เพื่อไม่ให้ประเภทเดิม (ที่มี NULL) หาย section ทันที
-- หลัง migrate แล้ว ผู้ใช้ค่อยเข้าไปปิด flag ให้ตรงกับแต่ละประเภท
-- ============================================================

ALTER TABLE place_types
  ADD COLUMN IF NOT EXISTS has_accommodation BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS has_meeting       BOOLEAN NOT NULL DEFAULT TRUE;

-- ============================================================
-- DONE
-- ============================================================
