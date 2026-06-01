-- ============================================================
-- Migration 117: trip_flights → เที่ยวบินต่อเครื่อง (connecting segments)
--
-- Why:
--   ตั๋วจริงเป็นเที่ยวบินต่อเครื่อง (เช่น ABJ→ADD→BKK) ทิศทางละหลายช่วง
--   form เดิมเก็บได้แค่ทิศทางละ 1 เที่ยว → เปลี่ยนให้เก็บหลายช่วงได้
--
--   โครงสร้างใหม่ (ตามกรอบแดงใน PDF ตั๋ว):
--     dep_segments JSONB = [{ flight, dep, arr }, ...]  ← ขาไป (หลายช่วง)
--     ret_segments JSONB = [{ flight, dep, arr }, ...]  ← ขากลับ (หลายช่วง)
--       · flight = เลขเที่ยวบิน (ET0934)
--       · dep    = เวลาออก (Departing At · ค่า datetime-local ดิบ)
--       · arr    = เวลาถึง (Arriving At · ค่า datetime-local ดิบ)
--     port      TEXT = Port ต้นทางช่วงแรก "ขาไป"  (reuse คอลัมน์เดิม · เช่น ABJ)
--     ret_port  TEXT = Port ต้นทางช่วงแรก "ขากลับ" (เพิ่มใหม่ · เช่น BKK)
--
--   คอลัมน์เดิม flight/departure_datetime/arrival_datetime/comeback/comeback_datetime
--   ยังคงไว้ (mirror ช่วงแรก) เพื่อ backward-compat กับ custom-report + dropdown check-seat
--
-- Idempotent — รันซ้ำได้
-- ============================================================

ALTER TABLE trip_flights ADD COLUMN IF NOT EXISTS dep_segments JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE trip_flights ADD COLUMN IF NOT EXISTS ret_segments JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE trip_flights ADD COLUMN IF NOT EXISTS ret_port     TEXT;

-- ── Backfill: ย้ายข้อมูลเดิม (ทิศทางละ 1 เที่ยว) → segment ช่วงแรก ──
-- กันข้อมูลตั๋วเก่าหายเงียบๆ เมื่อ UI อ่านจาก *_segments เป็นหลัก
UPDATE trip_flights
   SET dep_segments = jsonb_build_array(
         jsonb_build_object(
           'flight', COALESCE(flight, ''),
           'dep',    COALESCE(departure_datetime, ''),
           'arr',    COALESCE(arrival_datetime, '')
         ))
 WHERE jsonb_array_length(dep_segments) = 0
   AND (flight IS NOT NULL OR departure_datetime IS NOT NULL OR arrival_datetime IS NOT NULL);

UPDATE trip_flights
   SET ret_segments = jsonb_build_array(
         jsonb_build_object(
           'flight', COALESCE(comeback, ''),
           'dep',    COALESCE(comeback_datetime, ''),
           'arr',    ''
         ))
 WHERE jsonb_array_length(ret_segments) = 0
   AND (comeback IS NOT NULL OR comeback_datetime IS NOT NULL);

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- DONE ✅
-- Verify:
--   SELECT flight_id, flight_label, port, ret_port, dep_segments, ret_segments
--     FROM trip_flights WHERE trip_id = 1;
-- ============================================================
