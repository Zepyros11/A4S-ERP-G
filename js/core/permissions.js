/* ============================================================
   permissions.js — Central Permission Registry
   ============================================================
   วิธีเพิ่ม Module ใหม่:
     เพิ่ม object ใน modules[] พร้อม key, label, icon, perms[]
     Role permissions จะถูกจัดการใน Supabase → role_configs
   ============================================================ */

/* global AppPermissions */
window.AppPermissions = (() => {
  /* ── MODULE TREE ── เพิ่ม Module ใหม่ที่นี่ ── */
  const modules = [
    {
      key: "dashboard",
      label: "Dashboard",
      icon: "📊",
      perms: [
        { key: "view_dashboard", label: "ดู Dashboard" },
      ],
    },
    {
      key: "event",
      label: "กิจกรรม (EVENT)",
      icon: "🎪",
      perms: [
        { key: "event_view",     label: "ดูรายการกิจกรรม" },
        { key: "event_create",   label: "สร้างกิจกรรม" },
        { key: "event_edit",     label: "แก้ไขกิจกรรม" },
        { key: "event_delete",   label: "ลบกิจกรรม" },
        { key: "event_category", label: "จัดการประเภทกิจกรรม" },
        { key: "event_place",    label: "จัดการสถานที่" },
        { key: "event_poster",   label: "จัดการโปสเตอร์ / Media" },
        { key: "event_budget",   label: "งบประมาณกิจกรรม" },
        { key: "event_request",  label: "คำขอกิจกรรม" },
        { key: "event_attendee", label: "ผู้เข้าร่วมกิจกรรม" },
      ],
    },
    {
      key: "inventory",
      label: "คลังสินค้า",
      icon: "🏭",
      perms: [
        { key: "inventory_view",      label: "ดูสินค้าและคลัง" },
        { key: "inventory_create",    label: "เพิ่มสินค้า" },
        { key: "inventory_edit",      label: "แก้ไขสินค้า" },
        { key: "inventory_delete",    label: "ลบสินค้า" },
        { key: "inventory_category",  label: "จัดการประเภทสินค้า" },
        { key: "inventory_warehouse", label: "จัดการคลัง" },
        { key: "manage_stock",        label: "นับ / ปรับ Stock" },
        { key: "inventory_movement",  label: "เคลื่อนย้ายสินค้า" },
      ],
    },
    {
      key: "po",
      label: "จัดซื้อ (PO)",
      icon: "📦",
      perms: [
        { key: "po_view",   label: "ดู Purchase Order" },
        { key: "create_po", label: "สร้าง PO" },
        { key: "approve_po", label: "อนุมัติ PO" },
        { key: "po_delete", label: "ลบ PO" },
      ],
    },
    {
      key: "so",
      label: "ขาย (SO)",
      icon: "💰",
      perms: [
        { key: "so_view",    label: "ดู Sales Order" },
        { key: "create_so",  label: "สร้าง SO" },
        { key: "approve_so", label: "อนุมัติ SO" },
        { key: "so_delete",  label: "ลบ SO" },
      ],
    },
    {
      key: "requisition",
      label: "คำขอ (Requisition)",
      icon: "📋",
      perms: [
        { key: "req_view",    label: "ดู Requisition" },
        { key: "req_create",  label: "สร้าง Requisition" },
        { key: "req_approve", label: "อนุมัติ Requisition" },
      ],
    },
    {
      key: "report",
      label: "รายงาน",
      icon: "📈",
      perms: [
        { key: "view_reports",      label: "ดูรายงานภาพรวม" },
        { key: "report_event",      label: "รายงานกิจกรรม" },
        { key: "report_inventory",  label: "รายงานคลังสินค้า" },
        { key: "report_finance",    label: "รายงานการเงิน" },
      ],
    },
    {
      key: "settings",
      label: "ตั้งค่าระบบ",
      icon: "⚙️",
      perms: [
        { key: "manage_users",    label: "จัดการผู้ใช้งาน" },
        { key: "manage_roles",    label: "จัดการ Role & สิทธิ์" },
        { key: "manage_settings", label: "ตั้งค่าระบบ" },
      ],
    },
  ];

  /* Default roles — ใช้เป็น fallback เมื่อ Supabase ไม่ได้เชื่อมต่อ */
  const defaultRoles = {
    ADMIN: {
      label: "👑 Admin", icon: "👑", color: "role-ADMIN",
      perms: [
        "view_dashboard",
        "event_view","event_create","event_edit","event_delete","event_category","event_place","event_poster","event_budget","event_request","event_attendee",
        "inventory_view","inventory_create","inventory_edit","inventory_delete","inventory_category","inventory_warehouse","manage_stock","inventory_movement",
        "po_view","create_po","approve_po","po_delete",
        "so_view","create_so","approve_so","so_delete",
        "req_view","req_create","req_approve",
        "view_reports","report_event","report_inventory","report_finance",
        "manage_users","manage_roles","manage_settings",
      ],
    },
    MANAGER: {
      label: "🏢 Manager", icon: "🏢", color: "role-MANAGER",
      perms: [
        "view_dashboard",
        "event_view","event_create","event_edit","event_category",
        "inventory_view","inventory_create","inventory_edit","manage_stock",
        "po_view","create_po","approve_po",
        "so_view","create_so","approve_so",
        "req_view","req_create","req_approve",
        "view_reports","report_event","report_inventory",
      ],
    },
    WAREHOUSE: {
      label: "🏭 Warehouse", icon: "🏭", color: "role-WAREHOUSE",
      perms: [
        "view_dashboard",
        "inventory_view","inventory_create","inventory_edit","inventory_category","inventory_warehouse","manage_stock","inventory_movement",
        "po_view","create_po",
        "req_view","req_create",
      ],
    },
    SALES: {
      label: "💰 Sales", icon: "💰", color: "role-SALES",
      perms: [
        "view_dashboard",
        "event_view",
        "inventory_view",
        "so_view","create_so",
        "req_view","req_create",
        "view_reports",
      ],
    },
    VIEWER: {
      label: "👁 Viewer", icon: "👁", color: "role-VIEWER",
      perms: ["view_dashboard","event_view","inventory_view","po_view","so_view"],
    },
  };

  const allPerms = modules.flatMap((m) => m.perms);

  return { modules, allPerms, defaultRoles };
})();
