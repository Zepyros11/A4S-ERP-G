-- ============================================================
-- Migration 052: Add 'group_joined' reply template
-- ============================================================
-- ใช้ในข้อความที่บอทตอบเมื่อถูกเชิญเข้ากลุ่ม LINE สำเร็จ
-- แก้ไขผ่านหน้า Settings → ตอบกลับอัตโนมัติ (line-templates.html)
-- ============================================================

INSERT INTO line_reply_templates (key, text, description, placeholders)
VALUES (
  'group_joined',
  E'✅ ผูกกลุ่มกับระบบ A4S-ERP สำเร็จ\n\n📢 พร้อมส่ง promote กิจกรรมเข้ากลุ่มนี้แล้ว — ตั้งกำหนดการได้ที่หน้า "ตารางโพสต์ LINE"',
  'ข้อความตอบกลับเมื่อบอทถูกเชิญเข้ากลุ่ม LINE',
  ARRAY[]::TEXT[]
)
ON CONFLICT (key) DO NOTHING;

-- Test:
--   SELECT key, text FROM line_reply_templates WHERE key = 'group_joined';
-- ============================================================
