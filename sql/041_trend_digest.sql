-- ============================================================
-- Migration 041: Trend Digest → LINE (สรุปกระแสประจำวันเข้า LINE)
--
-- config แถวเดียว · ตั้งค่าในหน้า trend-radar (ปุ่ม 📩 ตั้งค่าส่ง LINE)
-- cron /cron/trend-digest ยิงทุก 15 นาที → ส่งเฉพาะชั่วโมง send_hour + วันละครั้ง
-- ต้องมี line_groups (จาก webhook ตอน bot เข้ากลุ่ม) ให้เลือกปลายทาง
-- ============================================================

CREATE TABLE IF NOT EXISTS trend_digest_config (
  id            BIGSERIAL PRIMARY KEY,
  is_enabled    BOOLEAN NOT NULL DEFAULT false,
  target_type   TEXT NOT NULL DEFAULT 'group' CHECK (target_type IN ('group','broadcast')),
  target_id     TEXT,                    -- LINE group_id (เมื่อ target_type='group')
  send_hour     INT NOT NULL DEFAULT 8,  -- ชั่วโมงเวลาไทย 0-23
  include_ideas BOOLEAN NOT NULL DEFAULT true,
  last_sent_on  DATE,                    -- กันส่งซ้ำในวันเดียว (เวลาไทย)
  updated_at    TIMESTAMPTZ DEFAULT now(),
  updated_by    TEXT
);

-- ── RLS (config table → anon read/write ผ่าน anon key เหมือน trend_topics) ──
ALTER TABLE trend_digest_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tdc_select_all ON trend_digest_config;
CREATE POLICY tdc_select_all ON trend_digest_config FOR SELECT USING (true);
DROP POLICY IF EXISTS tdc_write_all  ON trend_digest_config;
CREATE POLICY tdc_write_all  ON trend_digest_config FOR ALL    USING (true) WITH CHECK (true);

-- ── Seed 1 แถว (ปิดไว้ก่อน — admin เปิด+เลือกกลุ่มเองใน UI) ──
INSERT INTO trend_digest_config (is_enabled, target_type, send_hour, include_ideas)
SELECT false, 'group', 8, true
WHERE NOT EXISTS (SELECT 1 FROM trend_digest_config);

-- ============================================================
-- DONE · Test:
--   SELECT * FROM trend_digest_config;
-- ============================================================
