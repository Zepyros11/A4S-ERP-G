-- ============================================================
-- Migration 058: Seed notification_rules for IBD module
--
-- 3 rules — INACTIVE by default. Admin enables + sets target
-- (role / group / user) at modules/settings/notification-rules.html
--
-- Triggered by ai-proxy POST /ibd/notify when portal submits.
-- ============================================================

INSERT INTO notification_rules (rule_name, trigger_key, target_type, target_value, message_template, is_active)
VALUES
  (
    '🌍 IBD: Complaint ใหม่จากลูกค้า',
    'ibd.complaint.created',
    'role',
    '["IBD_STAFF","ADMIN"]'::jsonb,
    '📋 มี complaint ใหม่ — IBD' || E'\n\n' ||
    '👤 {{member_name}} ({{member_code}})' || E'\n' ||
    '🏷️ Topic: {{topic_label}}' || E'\n' ||
    '🏢 Branch: {{branch_label}}' || E'\n' ||
    '📱 WhatsApp: {{whatsapp_used}}' || E'\n' ||
    '📝 {{details_short}}',
    false
  ),
  (
    '🌍 IBD: คำขอโอน E-Wallet ใหม่',
    'ibd.ewallet.created',
    'role',
    '["IBD_STAFF","ADMIN"]'::jsonb,
    '💳 มีคำขอโอน E-Wallet ใหม่ — IBD' || E'\n\n' ||
    '👤 {{member_full_name}} ({{member_code}})' || E'\n' ||
    '📱 WhatsApp: {{whatsapp}}' || E'\n' ||
    '📧 Email: {{email}}' || E'\n' ||
    '⏳ รอ verify 3-7 วัน',
    false
  ),
  (
    '🌍 IBD: คำขอย้าย Location Base ใหม่',
    'ibd.relocation.created',
    'role',
    '["IBD_STAFF","ADMIN"]'::jsonb,
    '🌐 มีคำขอย้าย Location Base ใหม่ — IBD' || E'\n\n' ||
    '👤 {{member_name}} ({{member_code}})' || E'\n' ||
    '🛬 จาก: {{from_country_label}}' || E'\n' ||
    '🛫 ไป: {{to_country_label}}' || E'\n' ||
    '📱 WhatsApp: {{whatsapp}}',
    false
  )
ON CONFLICT DO NOTHING;
