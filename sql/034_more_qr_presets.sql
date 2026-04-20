-- ============================================================
-- Migration 034: Additional QR style presets (12 more designs)
-- Mix ของ solid/gradient + dot styles + color palettes
-- ============================================================

INSERT INTO qr_style_presets (name, description, config, is_default, is_system) VALUES

  -- 1. Sunset Glow
  (
    'Sunset Glow',
    'Gradient ส้ม-ชมพู สไตล์พระอาทิตย์ตก',
    '{
      "width":300,"height":300,"margin":10,
      "qrOptions":{"errorCorrectionLevel":"H"},
      "dotsOptions":{
        "type":"extra-rounded","color":"#f97316",
        "gradient":{"type":"linear","rotation":135,"colorStops":[{"offset":0,"color":"#f97316"},{"offset":1,"color":"#ec4899"}]}
      },
      "backgroundOptions":{"color":"#fff7ed"},
      "cornersSquareOptions":{"type":"extra-rounded","color":"#ea580c"},
      "cornersDotOptions":{"type":"dot","color":"#f97316"},
      "imageOptions":{"hideBackgroundDots":true,"imageSize":0.38,"margin":8,"crossOrigin":"anonymous"},
      "useLogo":true
    }'::jsonb, false, true
  ),

  -- 2. Ocean Wave
  (
    'Ocean Wave',
    'Gradient น้ำทะเล teal-navy',
    '{
      "width":300,"height":300,"margin":10,
      "qrOptions":{"errorCorrectionLevel":"H"},
      "dotsOptions":{
        "type":"rounded","color":"#0891b2",
        "gradient":{"type":"linear","rotation":90,"colorStops":[{"offset":0,"color":"#06b6d4"},{"offset":1,"color":"#1e3a8a"}]}
      },
      "backgroundOptions":{"color":"#f0f9ff"},
      "cornersSquareOptions":{"type":"extra-rounded","color":"#0c4a6e"},
      "cornersDotOptions":{"type":"dot","color":"#0891b2"},
      "imageOptions":{"hideBackgroundDots":true,"imageSize":0.38,"margin":8,"crossOrigin":"anonymous"},
      "useLogo":true
    }'::jsonb, false, true
  ),

  -- 3. Forest Pine
  (
    'Forest Pine',
    'เขียวเข้มเรียบหรู คลาสสิก',
    '{
      "width":300,"height":300,"margin":10,
      "qrOptions":{"errorCorrectionLevel":"H"},
      "dotsOptions":{"type":"classy-rounded","color":"#064e3b"},
      "backgroundOptions":{"color":"#f0fdf4"},
      "cornersSquareOptions":{"type":"extra-rounded","color":"#047857"},
      "cornersDotOptions":{"type":"dot","color":"#064e3b"},
      "imageOptions":{"hideBackgroundDots":true,"imageSize":0.38,"margin":8,"crossOrigin":"anonymous"},
      "useLogo":true
    }'::jsonb, false, true
  ),

  -- 4. Neon Cyber
  (
    'Neon Cyber',
    'พื้นหลังดำ + dots นีออน cyan-magenta',
    '{
      "width":300,"height":300,"margin":10,
      "qrOptions":{"errorCorrectionLevel":"H"},
      "dotsOptions":{
        "type":"dots","color":"#06b6d4",
        "gradient":{"type":"linear","rotation":45,"colorStops":[{"offset":0,"color":"#06b6d4"},{"offset":1,"color":"#d946ef"}]}
      },
      "backgroundOptions":{"color":"#0f172a"},
      "cornersSquareOptions":{"type":"extra-rounded","color":"#06b6d4"},
      "cornersDotOptions":{"type":"dot","color":"#d946ef"},
      "imageOptions":{"hideBackgroundDots":true,"imageSize":0.38,"margin":10,"crossOrigin":"anonymous"},
      "useLogo":true
    }'::jsonb, false, true
  ),

  -- 5. Rose Gold
  (
    'Rose Gold',
    'ชมพู-ทองแบบ luxury',
    '{
      "width":300,"height":300,"margin":10,
      "qrOptions":{"errorCorrectionLevel":"H"},
      "dotsOptions":{
        "type":"classy","color":"#be185d",
        "gradient":{"type":"linear","rotation":60,"colorStops":[{"offset":0,"color":"#be185d"},{"offset":1,"color":"#d97706"}]}
      },
      "backgroundOptions":{"color":"#fff1f2"},
      "cornersSquareOptions":{"type":"extra-rounded","color":"#9f1239"},
      "cornersDotOptions":{"type":"dot","color":"#d97706"},
      "imageOptions":{"hideBackgroundDots":true,"imageSize":0.38,"margin":8,"crossOrigin":"anonymous"},
      "useLogo":true
    }'::jsonb, false, true
  ),

  -- 6. Arctic Frost
  (
    'Arctic Frost',
    'ฟ้า-ขาวเย็นตา dots โค้งมน',
    '{
      "width":300,"height":300,"margin":10,
      "qrOptions":{"errorCorrectionLevel":"H"},
      "dotsOptions":{"type":"extra-rounded","color":"#0369a1"},
      "backgroundOptions":{"color":"#f0f9ff"},
      "cornersSquareOptions":{"type":"extra-rounded","color":"#075985"},
      "cornersDotOptions":{"type":"dot","color":"#0ea5e9"},
      "imageOptions":{"hideBackgroundDots":true,"imageSize":0.38,"margin":8,"crossOrigin":"anonymous"},
      "useLogo":true
    }'::jsonb, false, true
  ),

  -- 7. LINE Green
  (
    'LINE Green',
    'สไตล์ LINE official #06C755',
    '{
      "width":300,"height":300,"margin":10,
      "qrOptions":{"errorCorrectionLevel":"H"},
      "dotsOptions":{"type":"rounded","color":"#06c755"},
      "backgroundOptions":{"color":"#ffffff"},
      "cornersSquareOptions":{"type":"extra-rounded","color":"#06c755"},
      "cornersDotOptions":{"type":"dot","color":"#06c755"},
      "imageOptions":{"hideBackgroundDots":true,"imageSize":0.38,"margin":8,"crossOrigin":"anonymous"},
      "useLogo":true
    }'::jsonb, false, true
  ),

  -- 8. Royal Purple
  (
    'Royal Purple',
    'ม่วง-ฟ้าเข้ม fancy',
    '{
      "width":300,"height":300,"margin":10,
      "qrOptions":{"errorCorrectionLevel":"H"},
      "dotsOptions":{
        "type":"extra-rounded","color":"#6d28d9",
        "gradient":{"type":"linear","rotation":120,"colorStops":[{"offset":0,"color":"#6d28d9"},{"offset":1,"color":"#312e81"}]}
      },
      "backgroundOptions":{"color":"#faf5ff"},
      "cornersSquareOptions":{"type":"extra-rounded","color":"#4c1d95"},
      "cornersDotOptions":{"type":"dot","color":"#7c3aed"},
      "imageOptions":{"hideBackgroundDots":true,"imageSize":0.38,"margin":8,"crossOrigin":"anonymous"},
      "useLogo":true
    }'::jsonb, false, true
  ),

  -- 9. Minimalist Gray
  (
    'Minimalist Gray',
    'เทาๆ เรียบง่าย dots style',
    '{
      "width":300,"height":300,"margin":10,
      "qrOptions":{"errorCorrectionLevel":"H"},
      "dotsOptions":{"type":"dots","color":"#475569"},
      "backgroundOptions":{"color":"#f8fafc"},
      "cornersSquareOptions":{"type":"extra-rounded","color":"#334155"},
      "cornersDotOptions":{"type":"dot","color":"#64748b"},
      "imageOptions":{"hideBackgroundDots":true,"imageSize":0.38,"margin":8,"crossOrigin":"anonymous"},
      "useLogo":true
    }'::jsonb, false, true
  ),

  -- 10. Fire Red
  (
    'Fire Red',
    'Gradient แดง-ส้ม เร้าใจ',
    '{
      "width":300,"height":300,"margin":10,
      "qrOptions":{"errorCorrectionLevel":"H"},
      "dotsOptions":{
        "type":"rounded","color":"#dc2626",
        "gradient":{"type":"linear","rotation":0,"colorStops":[{"offset":0,"color":"#dc2626"},{"offset":1,"color":"#f59e0b"}]}
      },
      "backgroundOptions":{"color":"#fffbeb"},
      "cornersSquareOptions":{"type":"extra-rounded","color":"#991b1b"},
      "cornersDotOptions":{"type":"dot","color":"#f59e0b"},
      "imageOptions":{"hideBackgroundDots":true,"imageSize":0.38,"margin":8,"crossOrigin":"anonymous"},
      "useLogo":true
    }'::jsonb, false, true
  ),

  -- 11. Mint Fresh
  (
    'Mint Fresh',
    'เขียวมินต์อ่อน สบายตา',
    '{
      "width":300,"height":300,"margin":10,
      "qrOptions":{"errorCorrectionLevel":"H"},
      "dotsOptions":{"type":"extra-rounded","color":"#059669"},
      "backgroundOptions":{"color":"#ecfdf5"},
      "cornersSquareOptions":{"type":"extra-rounded","color":"#047857"},
      "cornersDotOptions":{"type":"dot","color":"#10b981"},
      "imageOptions":{"hideBackgroundDots":true,"imageSize":0.38,"margin":8,"crossOrigin":"anonymous"},
      "useLogo":true
    }'::jsonb, false, true
  ),

  -- 12. Vintage Sepia
  (
    'Vintage Sepia',
    'โทนน้ำตาลเก่าคลาสสิก',
    '{
      "width":300,"height":300,"margin":10,
      "qrOptions":{"errorCorrectionLevel":"H"},
      "dotsOptions":{"type":"classy-rounded","color":"#78350f"},
      "backgroundOptions":{"color":"#fef3c7"},
      "cornersSquareOptions":{"type":"extra-rounded","color":"#451a03"},
      "cornersDotOptions":{"type":"square","color":"#b45309"},
      "imageOptions":{"hideBackgroundDots":true,"imageSize":0.38,"margin":8,"crossOrigin":"anonymous"},
      "useLogo":true
    }'::jsonb, false, true
  )

ON CONFLICT DO NOTHING;

-- Verify: SELECT id, name FROM qr_style_presets ORDER BY id;
