-- ============================================================
-- Migration 033: QR Code style per event + reusable presets
-- ------------------------------------------------------------
-- events.qr_style_config JSONB   — style ต่อ event (null = ใช้ default)
-- qr_style_presets                — preset library (system + user-created)
-- Schema ของ config อิงตาม lib qr-code-styling v1.6.x
-- ============================================================

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS qr_style_config JSONB;

CREATE TABLE IF NOT EXISTS qr_style_presets (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  description  TEXT,
  config       JSONB NOT NULL,
  is_default   BOOLEAN DEFAULT false,
  is_system    BOOLEAN DEFAULT false,           -- true = built-in, ลบไม่ได้
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_qr_preset_default
  ON qr_style_presets(is_default)
  WHERE is_default = true;

CREATE OR REPLACE FUNCTION _qrp_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_qrp_updated_at ON qr_style_presets;
CREATE TRIGGER trg_qrp_updated_at
  BEFORE UPDATE ON qr_style_presets
  FOR EACH ROW EXECUTE FUNCTION _qrp_touch_updated_at();

-- Open RLS — presets เป็น config ไม่ใช่ข้อมูลอ่อนไหว
ALTER TABLE qr_style_presets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS qrp_all ON qr_style_presets;
CREATE POLICY qrp_all ON qr_style_presets FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- Seed presets (5 แบบ)
-- ============================================================
INSERT INTO qr_style_presets (name, description, config, is_default, is_system) VALUES
  (
    'Classic',
    'QR ดำ-ขาว มาตรฐาน ไม่มี logo',
    '{
      "width": 300, "height": 300, "margin": 10,
      "qrOptions": {"errorCorrectionLevel": "M"},
      "dotsOptions": {"type": "square", "color": "#000000"},
      "backgroundOptions": {"color": "#ffffff"},
      "cornersSquareOptions": {"type": "square", "color": "#000000"},
      "cornersDotOptions": {"type": "square", "color": "#000000"},
      "imageOptions": {"hideBackgroundDots": true, "imageSize": 0.4, "margin": 6, "crossOrigin": "anonymous"},
      "useLogo": false
    }'::jsonb,
    false, true
  ),
  (
    'A4S Brand',
    'เขียว A4S + logo กลาง + มุมโค้ง',
    '{
      "width": 300, "height": 300, "margin": 10,
      "qrOptions": {"errorCorrectionLevel": "H"},
      "dotsOptions": {"type": "rounded", "color": "#06c755"},
      "backgroundOptions": {"color": "#ffffff"},
      "cornersSquareOptions": {"type": "extra-rounded", "color": "#065f46"},
      "cornersDotOptions": {"type": "dot", "color": "#06c755"},
      "imageOptions": {"hideBackgroundDots": true, "imageSize": 0.38, "margin": 8, "crossOrigin": "anonymous"},
      "useLogo": true
    }'::jsonb,
    true, true
  ),
  (
    'Gradient Bold',
    'gradient ม่วง-ชมพู + logo + dots style',
    '{
      "width": 300, "height": 300, "margin": 10,
      "qrOptions": {"errorCorrectionLevel": "H"},
      "dotsOptions": {
        "type": "extra-rounded",
        "color": "#6366f1",
        "gradient": {"type": "linear", "rotation": 45, "colorStops": [{"offset": 0, "color": "#6366f1"}, {"offset": 1, "color": "#ec4899"}]}
      },
      "backgroundOptions": {"color": "#ffffff"},
      "cornersSquareOptions": {"type": "extra-rounded", "color": "#6366f1"},
      "cornersDotOptions": {"type": "dot", "color": "#ec4899"},
      "imageOptions": {"hideBackgroundDots": true, "imageSize": 0.38, "margin": 8, "crossOrigin": "anonymous"},
      "useLogo": true
    }'::jsonb,
    false, true
  ),
  (
    'Modern Dots',
    'Dot style แบบจุดๆ สีน้ำเงินเข้ม',
    '{
      "width": 300, "height": 300, "margin": 10,
      "qrOptions": {"errorCorrectionLevel": "H"},
      "dotsOptions": {"type": "dots", "color": "#1e3a8a"},
      "backgroundOptions": {"color": "#f8fafc"},
      "cornersSquareOptions": {"type": "extra-rounded", "color": "#1e3a8a"},
      "cornersDotOptions": {"type": "dot", "color": "#0ea5e9"},
      "imageOptions": {"hideBackgroundDots": true, "imageSize": 0.38, "margin": 8, "crossOrigin": "anonymous"},
      "useLogo": true
    }'::jsonb,
    false, true
  ),
  (
    'Classy Dark',
    'โทนเข้ม หรูหรา สำหรับ event premium',
    '{
      "width": 300, "height": 300, "margin": 10,
      "qrOptions": {"errorCorrectionLevel": "H"},
      "dotsOptions": {"type": "classy-rounded", "color": "#0f172a"},
      "backgroundOptions": {"color": "#fef3c7"},
      "cornersSquareOptions": {"type": "extra-rounded", "color": "#b45309"},
      "cornersDotOptions": {"type": "dot", "color": "#0f172a"},
      "imageOptions": {"hideBackgroundDots": true, "imageSize": 0.38, "margin": 8, "crossOrigin": "anonymous"},
      "useLogo": true
    }'::jsonb,
    false, true
  )
ON CONFLICT DO NOTHING;

-- Verify:
--   SELECT id, name, is_default, is_system FROM qr_style_presets ORDER BY id;
--   SELECT event_id, event_name, qr_style_config IS NOT NULL AS has_style FROM events LIMIT 5;
