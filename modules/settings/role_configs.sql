-- ============================================================
-- role_configs — เก็บสิทธิ์ของแต่ละ Role
-- รัน SQL นี้ใน Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS role_configs (
  role_key    TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  icon        TEXT DEFAULT '👤',
  color       TEXT DEFAULT 'role-VIEWER',
  permissions JSONB DEFAULT '[]'::jsonb,
  is_system   BOOLEAN DEFAULT false,
  sort_order  INT DEFAULT 99,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Default Roles
INSERT INTO role_configs (role_key, label, icon, color, permissions, is_system, sort_order) VALUES
(
  'ADMIN', 'Admin', '👑', 'role-ADMIN',
  '["view_dashboard","event_view","event_create","event_edit","event_delete","event_category","event_place","event_poster","event_budget","event_request","event_attendee","inventory_view","inventory_create","inventory_edit","inventory_delete","inventory_category","inventory_warehouse","manage_stock","inventory_movement","po_view","create_po","approve_po","po_delete","so_view","create_so","approve_so","so_delete","req_view","req_create","req_approve","view_reports","report_event","report_inventory","report_finance","manage_users","manage_roles","manage_settings"]'::jsonb,
  true, 1
),
(
  'MANAGER', 'Manager', '🏢', 'role-MANAGER',
  '["view_dashboard","event_view","event_create","event_edit","event_category","inventory_view","inventory_create","inventory_edit","manage_stock","po_view","create_po","approve_po","so_view","create_so","approve_so","req_view","req_create","req_approve","view_reports","report_event","report_inventory"]'::jsonb,
  true, 2
),
(
  'WAREHOUSE', 'Warehouse', '🏭', 'role-WAREHOUSE',
  '["view_dashboard","inventory_view","inventory_create","inventory_edit","inventory_category","inventory_warehouse","manage_stock","inventory_movement","po_view","create_po","req_view","req_create"]'::jsonb,
  true, 3
),
(
  'SALES', 'Sales', '💰', 'role-SALES',
  '["view_dashboard","event_view","inventory_view","so_view","create_so","req_view","req_create","view_reports"]'::jsonb,
  true, 4
),
(
  'VIEWER', 'Viewer', '👁', 'role-VIEWER',
  '["view_dashboard","event_view","inventory_view","po_view","so_view"]'::jsonb,
  true, 5
)
ON CONFLICT (role_key) DO NOTHING;
