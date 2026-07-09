/* ============================================================
   permissions.js — Central Permission Registry (3-Level Tree)
   ============================================================
   โครงสร้าง: Module → Sub-module (หน้า) → Actions
   ตรงกับ sidebar ทุกหน้า
   ============================================================ */

/* global AppPermissions */
window.AppPermissions = (() => {
  const modules = [
    /* ── 1. ภาพรวม ── */
    {
      key: "dashboard", label: "ภาพรวม", icon: "📊",
      children: [
        { key: "dashboard", label: "Dashboard", icon: "📊", perms: [
          { key: "dashboard_view", label: "ดู" },
        ]},
      ],
    },

    /* ── 2. กิจกรรม (EVENT) ── */
    {
      key: "event", label: "กิจกรรม (Event)", icon: "🗓️",
      children: [
        { key: "poster", label: "Poster Gallery", icon: "🖼️", perms: [
          { key: "poster_view",   label: "ดูรายการ" },
          { key: "poster_create", label: "สร้าง" },
          { key: "poster_edit",   label: "แก้ไข" },
          { key: "poster_delete", label: "ลบ" },
        ]},
        { key: "events", label: "รายการกิจกรรม", icon: "🗓️", perms: [
          { key: "events_view",   label: "ดูรายการ" },
          { key: "events_create", label: "สร้าง" },
          { key: "events_edit",   label: "แก้ไข" },
          { key: "events_delete", label: "ลบ" },
        ]},
        { key: "evt_calendar", label: "ปฏิทินกิจกรรม", icon: "📅", perms: [
          { key: "evt_calendar_view", label: "ดู" },
        ]},
        { key: "evt_req", label: "คำขอจัดกิจกรรม", icon: "📋", perms: [
          { key: "evt_req_view",    label: "ดูรายการ" },
          { key: "evt_req_create",  label: "สร้าง" },
          { key: "evt_req_approve", label: "อนุมัติ" },
        ]},
        { key: "evt_budget", label: "งบประมาณ", icon: "💰", perms: [
          { key: "evt_budget_view",   label: "ดูรายการ" },
          { key: "evt_budget_create", label: "สร้าง" },
          { key: "evt_budget_edit",   label: "แก้ไข" },
          { key: "evt_budget_delete", label: "ลบ" },
        ]},
        { key: "attendee", label: "ผู้เข้าร่วม", icon: "👥", perms: [
          { key: "attendee_view",     label: "ดูรายการ" },
          { key: "attendee_edit",     label: "แก้ไข" },
          { key: "attendee_register", label: "ลงทะเบียนให้" },
          { key: "attendee_checkin",  label: "Check-in" },
        ]},
        { key: "media", label: "ตารางโพสต์ FB", icon: "📅", perms: [
          { key: "media_fb_view",   label: "ดูรายการ" },
          { key: "media_fb_create", label: "สร้างโพสต์" },
          { key: "media_fb_edit",   label: "แก้ไข" },
          { key: "media_fb_cancel", label: "ยกเลิก" },
        ]},
        { key: "line_promote", label: "ตารางโพสต์ LINE", icon: "📢", perms: [
          { key: "line_promote_view",   label: "ดูรายการ" },
          { key: "line_promote_create", label: "สร้างกำหนดการ" },
          { key: "line_promote_edit",   label: "แก้ไข" },
          { key: "line_promote_cancel", label: "ยกเลิก" },
        ]},
        { key: "trend_radar", label: "เรดาร์กระแส", icon: "📡", perms: [
          { key: "trend_radar_view",   label: "ดู/ปั้นคอนเทนต์" },
          { key: "trend_radar_manage", label: "จัดการหัวข้อ" },
        ]},
        { key: "campaign", label: "วางแผนแคมเปญ", icon: "🚀", perms: [
          { key: "campaign_view",        label: "ดูรายการ" },
          { key: "campaign_create",      label: "สร้าง" },
          { key: "campaign_edit",        label: "แก้ไข" },
          { key: "campaign_delete",      label: "ลบ" },
          { key: "campaign_metric_edit", label: "กรอกยอด/ตรวจผลงาน" },
        ]},
        { key: "evt_wp", label: "แผนงานกิจกรรม", icon: "📋", perms: [
          { key: "evt_wp_view",   label: "ดูรายการ" },
          { key: "evt_wp_create", label: "สร้าง" },
          { key: "evt_wp_edit",   label: "แก้ไข" },
          { key: "evt_wp_delete", label: "ลบ" },
        ]},
        /* ── ตั้งค่า Event ── */
        { key: "evt_cat", label: "ประเภทกิจกรรม", icon: "🏷️", perms: [
          { key: "evt_cat_view",   label: "ดูรายการ" },
          { key: "evt_cat_create", label: "สร้าง" },
          { key: "evt_cat_edit",   label: "แก้ไข" },
          { key: "evt_cat_delete", label: "ลบ" },
        ]},
        { key: "evt_place", label: "สถานที่", icon: "📍", perms: [
          { key: "evt_place_view",   label: "ดูรายการ" },
          { key: "evt_place_create", label: "สร้าง" },
          { key: "evt_place_edit",   label: "แก้ไข" },
          { key: "evt_place_delete", label: "ลบ" },
        ]},
      ],
    },

    /* ── 3. คลังสินค้า (STOCK) ── */
    {
      key: "stock", label: "คลังสินค้า (Stock)", icon: "📦",
      children: [
        { key: "product", label: "รายการสินค้า", icon: "✏️", perms: [
          { key: "product_view",   label: "ดูรายการ" },
          { key: "product_create", label: "สร้าง" },
          { key: "product_edit",   label: "แก้ไข" },
          { key: "product_delete", label: "ลบ" },
        ]},
        { key: "stock_move", label: "ความเคลื่อนไหว", icon: "🔄", perms: [
          { key: "stock_move_view",   label: "ดูรายการ" },
          { key: "stock_move_create", label: "บันทึกรายการ" },
        ]},
        /* ── ตั้งค่า Stock ── */
        { key: "inv_cat", label: "หมวดหมู่", icon: "🏷️", perms: [
          { key: "inv_cat_view",   label: "ดูรายการ" },
          { key: "inv_cat_create", label: "สร้าง" },
          { key: "inv_cat_edit",   label: "แก้ไข" },
          { key: "inv_cat_delete", label: "ลบ" },
        ]},
        { key: "units", label: "หน่วยนับ", icon: "📐", perms: [
          { key: "units_view",   label: "ดูรายการ" },
          { key: "units_create", label: "สร้าง" },
          { key: "units_edit",   label: "แก้ไข" },
          { key: "units_delete", label: "ลบ" },
        ]},
        { key: "warehouse", label: "คลังสินค้า", icon: "🏭", perms: [
          { key: "warehouse_view",   label: "ดูรายการ" },
          { key: "warehouse_create", label: "สร้าง" },
          { key: "warehouse_edit",   label: "แก้ไข" },
          { key: "warehouse_delete", label: "ลบ" },
        ]},
        { key: "stock_init", label: "Stock เริ่มต้น", icon: "📦", perms: [
          { key: "stock_init_view",   label: "ดูรายการ" },
          { key: "stock_init_create", label: "สร้าง" },
          { key: "stock_init_edit",   label: "แก้ไข" },
        ]},
      ],
    },

    /* ── 4. เอกสาร ── */
    {
      key: "docs", label: "เอกสาร", icon: "📄",
      children: [
        { key: "po", label: "รายการสั่งซื้อ", icon: "🛒", perms: [
          { key: "po_view",    label: "ดูรายการ" },
          { key: "po_create",  label: "สร้าง" },
          { key: "po_edit",    label: "แก้ไข" },
          { key: "po_approve", label: "อนุมัติ" },
          { key: "po_receive", label: "รับของ" },
          { key: "po_delete",  label: "ลบ" },
        ]},
        { key: "so", label: "ใบขาย (SO)", icon: "💰", perms: [
          { key: "so_view",    label: "ดูรายการ" },
          { key: "so_create",  label: "สร้าง" },
          { key: "so_edit",    label: "แก้ไข" },
          { key: "so_approve", label: "อนุมัติ" },
          { key: "so_delete",  label: "ลบ" },
        ]},
        { key: "req", label: "รายการเบิกสินค้า", icon: "📋", perms: [
          { key: "req_view",    label: "ดูรายการ" },
          { key: "req_create",  label: "สร้าง" },
          { key: "req_edit",    label: "แก้ไข" },
          { key: "req_approve", label: "อนุมัติ" },
          { key: "req_delete",  label: "ลบ" },
        ]},
        { key: "petty_cash", label: "Petty Cash", icon: "🧾", perms: [
          { key: "petty_cash_view",   label: "ดูรายการ" },
          { key: "petty_cash_create", label: "สร้าง" },
          { key: "petty_cash_edit",   label: "แก้ไข" },
          { key: "petty_cash_delete", label: "ลบ" },
        ]},
      ],
    },

    /* ── 5. ลูกค้า (CRM) ── */
    {
      key: "crm", label: "ลูกค้า (CRM)", icon: "🧑",
      children: [
        { key: "customer_dashboard", label: "Customer Dashboard", icon: "📊", perms: [
          { key: "customer_dashboard_view", label: "ดู" },
        ]},
        { key: "member", label: "ข้อมูลสมาชิก (A4S)", icon: "👤", perms: [
          { key: "member_view",         label: "ดูรายการ" },
          { key: "member_import",       label: "นำเข้า Excel" },
          { key: "member_export",       label: "ส่งออก" },
          { key: "member_edit",         label: "แก้ไข" },
          { key: "member_delete",       label: "ลบ" },
          { key: "member_decrypt",      label: "ถอดรหัสข้อมูลลับ" },
          { key: "member_sync_config",  label: "ตั้งค่า Auto-Sync" },
          { key: "member_sync_trigger", label: "กด Sync Now" },
        ]},
        { key: "members_tree", label: "A4S Tree View", icon: "🌳", perms: [
          { key: "members_tree_view", label: "ดู" },
        ]},
        { key: "line_members", label: "สมาชิกที่เชื่อม LINE", icon: "💬", perms: [
          { key: "line_members_view", label: "ดู" },
        ]},
      ],
    },

    /* ── 6. ซัพพลายเออร์ ── */
    {
      key: "supplier_grp", label: "ซัพพลายเออร์ (Supplier)", icon: "🚚",
      children: [
        { key: "supplier", label: "ข้อมูล Supplier", icon: "🚚", perms: [
          { key: "supplier_view",   label: "ดูรายการ" },
          { key: "supplier_create", label: "สร้าง" },
          { key: "supplier_edit",   label: "แก้ไข" },
          { key: "supplier_delete", label: "ลบ" },
        ]},
      ],
    },

    /* ── 7. บริการลูกค้า (Customer Service) ── */
    {
      key: "customer_service", label: "บริการลูกค้า (CS)", icon: "🎁",
      children: [
        { key: "daily_sale", label: "Daily Sale", icon: "📊", perms: [
          { key: "daily_sale_view",      label: "ดูข้อมูล" },
          { key: "daily_sale_sync",      label: "สั่ง Sync" },
          { key: "daily_sale_reconcile", label: "บันทึกตรวจบิล" },
        ]},
        { key: "promotion_gallery", label: "Catalog ประจำเดือน", icon: "📰", perms: [
          { key: "view_promotions",   label: "ดูรายการ" },
        ]},
        { key: "promotion", label: "จัดการโปรโมชัน", icon: "🎁", perms: [
          { key: "promotion_create", label: "สร้าง" },
          { key: "promotion_edit",   label: "แก้ไข" },
          { key: "promotion_delete", label: "ลบ" },
        ]},
        { key: "cs_wp", label: "แผนงาน CS", icon: "📋", perms: [
          { key: "cs_wp_view",   label: "ดูรายการ" },
          { key: "cs_wp_create", label: "สร้าง" },
          { key: "cs_wp_edit",   label: "แก้ไข" },
          { key: "cs_wp_delete", label: "ลบ" },
        ]},
      ],
    },

    /* ── 8.5 International Business Development (IBD) ── */
    {
      key: "ibd", label: "International Business Dev (IBD)", icon: "🌍",
      children: [
        { key: "ibd_dashboard", label: "IBD Dashboard", icon: "📊", perms: [
          { key: "ibd_dashboard_view", label: "ดู" },
        ]},
        { key: "ibd_complaints", label: "เรื่องร้องเรียน/ติดตาม", icon: "📋", perms: [
          { key: "ibd_complaints_view",    label: "ดูรายการ" },
          { key: "ibd_complaints_assign",  label: "มอบหมาย" },
          { key: "ibd_complaints_resolve", label: "ปิดเรื่อง" },
          { key: "ibd_complaints_delete",  label: "ลบ" },
          { key: "ibd_complaints_export",  label: "ส่งออก" },
        ]},
        { key: "ibd_ewallet", label: "ขอโอน E-Wallet", icon: "💳", perms: [
          { key: "ibd_ewallet_view",      label: "ดูรายการ" },
          { key: "ibd_ewallet_approve",   label: "อนุมัติ" },
          { key: "ibd_ewallet_mark_paid", label: "บันทึกโอนแล้ว" },
          { key: "ibd_ewallet_reject",    label: "ปฏิเสธ" },
          { key: "ibd_ewallet_delete",    label: "ลบ" },
          { key: "ibd_ewallet_export",    label: "ส่งออก" },
        ]},
        { key: "ibd_relocation", label: "ย้าย Location Base", icon: "🌐", perms: [
          { key: "ibd_relocation_view",    label: "ดูรายการ" },
          { key: "ibd_relocation_approve", label: "อนุมัติ" },
          { key: "ibd_relocation_reject",  label: "ปฏิเสธ" },
          { key: "ibd_relocation_delete",  label: "ลบ" },
          { key: "ibd_relocation_export",  label: "ส่งออก" },
        ]},
      ],
    },

    /* ── 8.6 ทริป (Trip) ── */
    {
      key: "trip", label: "ทริป (Trip)", icon: "✈️",
      children: [
        { key: "trip_list", label: "รายการทริป", icon: "✈️", perms: [
          { key: "trip_list_view",   label: "ดูรายการ" },
          { key: "trip_list_create", label: "สร้างทริป" },
          { key: "trip_list_edit",   label: "แก้ไขทริป" },
          { key: "trip_list_delete", label: "ลบทริป" },
        ]},
        { key: "trip_check_seat", label: "Check Seat", icon: "💺", perms: [
          { key: "trip_check_seat_view",   label: "ดูรายการ" },
          { key: "trip_check_seat_edit",   label: "แก้ไข/บันทึก" },
          { key: "trip_check_seat_import", label: "นำเข้า Excel" },
          { key: "trip_check_seat_export", label: "ส่งออก Excel" },
          { key: "trip_check_seat_delete", label: "ลบรายการ" },
        ]},
        { key: "trip_rooms", label: "จัดห้องพัก", icon: "🛏️", perms: [
          { key: "trip_rooms_view",   label: "ดูรายการ" },
          { key: "trip_rooms_create", label: "เพิ่มห้อง" },
          { key: "trip_rooms_edit",   label: "แก้ไขห้อง" },
          { key: "trip_rooms_delete", label: "ลบห้อง" },
          { key: "trip_rooms_assign", label: "จัดผู้โดยสารเข้าห้อง" },
        ]},
        { key: "trip_pax_detail", label: "ข้อมูลผู้เดินทาง", icon: "ℹ️", perms: [
          { key: "trip_pax_detail_view", label: "ดูรายการ" },
          { key: "trip_pax_detail_edit", label: "แก้ไข/บันทึก" },
        ]},
        { key: "trip_team", label: "ทีมงานทริป", icon: "🧑‍🤝‍🧑", perms: [
          { key: "trip_team_view",   label: "ดูรายการ" },
          { key: "trip_team_create", label: "เพิ่มทีมงาน/ไกด์" },
          { key: "trip_team_edit",   label: "แก้ไข" },
          { key: "trip_team_delete", label: "ลบ" },
        ]},
        { key: "trip_bus", label: "รถบัส & ตั๋วเครื่องบิน", icon: "🚌", perms: [
          { key: "trip_bus_view",   label: "ดูรายการ" },
          { key: "trip_bus_create", label: "เพิ่มคัน/ตั๋ว" },
          { key: "trip_bus_edit",   label: "แก้ไข" },
          { key: "trip_bus_delete", label: "ลบ" },
          { key: "trip_bus_assign", label: "จัดผู้โดยสารขึ้นรถ/เครื่อง" },
        ]},
        { key: "member_types", label: "ประเภทสมาชิกทีม", icon: "🏷️", perms: [
          { key: "member_types_view",   label: "ดูรายการ" },
          { key: "member_types_create", label: "สร้าง" },
          { key: "member_types_edit",   label: "แก้ไข" },
          { key: "member_types_delete", label: "ลบ" },
        ]},
        { key: "trip_docs", label: "เอกสาร", icon: "📄", perms: [
          { key: "trip_docs_view",   label: "ดูเอกสาร/แม่แบบ" },
          { key: "trip_docs_create", label: "สร้างเอกสาร/แม่แบบ" },
          { key: "trip_docs_edit",   label: "แก้ไข" },
          { key: "trip_docs_delete", label: "ลบ" },
        ]},
      ],
    },

    /* ── 9. รายงาน ── */
    {
      key: "report", label: "รายงาน", icon: "📈",
      children: [
        { key: "report_stock", label: "รายงาน Stock", icon: "📈", perms: [
          { key: "report_stock_view",   label: "ดูรายงาน" },
          { key: "report_stock_export", label: "ส่งออก" },
        ]},
      ],
    },

    /* ── 10. คู่มือ (Manual) ── */
    {
      key: "manual", label: "คู่มือการใช้งาน", icon: "📖",
      children: [
        { key: "manual", label: "คู่มือการใช้งาน", icon: "📖", perms: [
          { key: "manual_view",    label: "อ่านคู่มือ" },
          { key: "manual_edit",    label: "เขียน/แก้ไข" },
          { key: "manual_publish", label: "เผยแพร่" },
          { key: "manual_delete",  label: "ลบ" },
        ]},
      ],
    },

    /* ── 11. ตั้งค่า ── */
    {
      key: "settings", label: "ตั้งค่า", icon: "⚙️",
      children: [
        { key: "sys_settings", label: "ตั้งค่าระบบ", icon: "⚙️", perms: [
          { key: "sys_settings_view", label: "ดู" },
          { key: "sys_settings_edit", label: "แก้ไข" },
        ]},
        { key: "db_viewer", label: "Database Viewer", icon: "🗄️", perms: [
          { key: "db_viewer_view", label: "ดู" },
        ]},
        { key: "users_mgmt", label: "ผู้ใช้งาน", icon: "👥", perms: [
          { key: "users_view",   label: "ดูรายการ" },
          { key: "users_create", label: "สร้าง" },
          { key: "users_edit",   label: "แก้ไข" },
          { key: "users_delete", label: "ลบ" },
        ]},
        { key: "roles_mgmt", label: "จัดการ Role", icon: "🔐", perms: [
          { key: "roles_view",   label: "ดู" },
          { key: "roles_create", label: "สร้าง" },
          { key: "roles_edit",   label: "แก้ไข" },
          { key: "roles_delete", label: "ลบ" },
        ]},
      ],
    },

    /* ── 12. Dev Tool ── */
    {
      key: "devtool", label: "Dev Tool", icon: "🛠️",
      children: [
        { key: "devtool_automation", label: "Web Automation", icon: "🤖", perms: [
          { key: "devtool_view",    label: "ดู" },
          { key: "devtool_manage",  label: "จัดการ Task" },
          { key: "devtool_run",     label: "รัน Manual" },
        ]},
      ],
    },
  ];

  /* ── Helper: flat array ── */
  const allPerms = modules.flatMap(m => m.children.flatMap(c => c.perms));
  const allPermKeys = allPerms.map(p => p.key);

  /* ── Default roles — fallback เมื่อ Supabase ไม่ได้เชื่อมต่อ ── */
  const defaultRoles = {
    ADMIN: {
      label: "Admin", icon: "👑", color: "role-ADMIN",
      perms: [...allPermKeys],
    },
    MANAGER: {
      label: "Manager", icon: "🏢", color: "role-MANAGER",
      perms: [
        "dashboard_view",
        "manual_view",
        "poster_view","poster_create","poster_edit",
        "events_view","events_create","events_edit",
        "evt_calendar_view",
        "evt_cat_view","evt_cat_create","evt_cat_edit",
        "evt_place_view","evt_place_create","evt_place_edit",
        "evt_req_view","evt_req_create","evt_req_approve",
        "evt_budget_view","evt_budget_create","evt_budget_edit",
        "attendee_view","attendee_edit",
        "media_fb_view","media_fb_create","media_fb_edit","media_fb_cancel",
        "line_promote_view","line_promote_create","line_promote_edit","line_promote_cancel",
        "trend_radar_view","trend_radar_manage",
        "campaign_view","campaign_create","campaign_edit","campaign_delete","campaign_metric_edit",
        "inv_cat_view","inv_cat_create","inv_cat_edit",
        "warehouse_view","warehouse_create","warehouse_edit",
        "product_view","product_create","product_edit",
        "stock_init_view","stock_init_create","stock_init_edit",
        "stock_move_view","stock_move_create",
        "po_view","po_create","po_edit","po_approve","po_receive",
        "so_view","so_create","so_edit","so_approve",
        "req_view","req_create","req_edit","req_approve",
        "petty_cash_view","petty_cash_create","petty_cash_edit","petty_cash_delete",
        "report_stock_view","report_stock_export",
        "supplier_view","supplier_create","supplier_edit",
      ],
    },
    WAREHOUSE: {
      label: "Warehouse", icon: "🏭", color: "role-WAREHOUSE",
      perms: [
        "dashboard_view",
        "manual_view",
        "inv_cat_view","inv_cat_create","inv_cat_edit","inv_cat_delete",
        "warehouse_view","warehouse_create","warehouse_edit","warehouse_delete",
        "product_view","product_create","product_edit","product_delete",
        "stock_init_view","stock_init_create","stock_init_edit",
        "stock_move_view","stock_move_create",
        "po_view","po_create","po_receive",
        "req_view","req_create",
        "report_stock_view",
      ],
    },
    SALES: {
      label: "Sales", icon: "💰", color: "role-SALES",
      perms: [
        "dashboard_view",
        "manual_view",
        "poster_view","events_view","evt_calendar_view",
        "product_view",
        "so_view","so_create","so_edit",
        "req_view","req_create",
        "report_stock_view",
      ],
    },
    VIEWER: {
      label: "Viewer", icon: "👁️", color: "role-VIEWER",
      perms: [
        "dashboard_view",
        "manual_view",
        "poster_view","events_view","evt_calendar_view",
        "product_view",
        "po_view","so_view",
        "report_stock_view",
      ],
    },
    IBD_STAFF: {
      label: "IBD Staff", icon: "🌍", color: "role-IBD_STAFF",
      perms: [
        "dashboard_view",
        "manual_view",
        "ibd_dashboard_view",
        "ibd_complaints_view","ibd_complaints_assign","ibd_complaints_resolve","ibd_complaints_export",
        "ibd_ewallet_view","ibd_ewallet_approve","ibd_ewallet_mark_paid","ibd_ewallet_reject","ibd_ewallet_export",
        "ibd_relocation_view","ibd_relocation_approve","ibd_relocation_reject","ibd_relocation_export",
        "member_view",
      ],
    },
  };

  /* ── Helper: iconToEmoji ── แปลง Iconify fluent-emoji-flat → emoji char (สำหรับใช้ใน <option>) ── */
  const EMOJI_MAP = {
    "fluent-emoji-flat:bust-in-silhouette": "👤",
    "fluent-emoji-flat:crown": "👑",
    "fluent-emoji-flat:office-building": "🏢",
    "fluent-emoji-flat:factory": "🏭",
    "fluent-emoji-flat:money-bag": "💰",
    "fluent-emoji-flat:eye": "👁️",
    "fluent-emoji-flat:locked": "🔒",
    "fluent-emoji-flat:gear": "⚙️",
    "fluent-emoji-flat:key": "🔑",
    "fluent-emoji-flat:wrench": "🔧",
    "fluent-emoji-flat:man-office-worker": "👨‍💼",
    "fluent-emoji-flat:woman-office-worker": "👩‍💼",
    "fluent-emoji-flat:technologist": "🧑‍💻",
    "fluent-emoji-flat:construction-worker": "👷",
    "fluent-emoji-flat:busts-in-silhouette": "👥",
    "fluent-emoji-flat:briefcase": "💼",
    "fluent-emoji-flat:clipboard": "📋",
    "fluent-emoji-flat:chart-increasing": "📈",
    "fluent-emoji-flat:bar-chart": "📊",
    "fluent-emoji-flat:trophy": "🏆",
    "fluent-emoji-flat:star": "⭐",
    "fluent-emoji-flat:rocket": "🚀",
    "fluent-emoji-flat:direct-hit": "🎯",
    "fluent-emoji-flat:department-store": "🏬",
    "fluent-emoji-flat:delivery-truck": "🚚",
    "fluent-emoji-flat:package": "📦",
    "fluent-emoji-flat:receipt": "🧾",
    "fluent-emoji-flat:bell": "🔔",
    "fluent-emoji-flat:light-bulb": "💡",
    "fluent-emoji-flat:shield": "🛡️",
    "fluent-emoji-flat:graduation-cap": "🎓",
    "fluent-emoji-flat:house": "🏠",
    "fluent-emoji-flat:calendar": "📅",
    "fluent-emoji-flat:triangular-flag": "🚩",
    "fluent-emoji-flat:red-heart": "❤️",
    "fluent-emoji-flat:bookmark": "🔖",
    "fluent-emoji-flat:artist-palette": "🎨",
  };

  function iconToEmoji(icon) {
    if (!icon) return "";
    if (!icon.includes(":")) return icon; /* already plain emoji */
    return EMOJI_MAP[icon] || "";
  }

  /* ── Helper: renderIcon ── รองรับทั้ง emoji และ Iconify name ── */
  function renderIcon(icon, size = 16) {
    if (!icon) return "❓";
    /* Iconify name → convert to emoji via lookup (no API call) */
    if (typeof icon === "string" && icon.includes(":")) {
      const emoji = EMOJI_MAP[icon];
      if (emoji) return `<span style="font-size:${size}px;line-height:1">${emoji}</span>`;
      /* Fallback: unknown Iconify name → use 🎯 */
      return `<span style="font-size:${size}px;line-height:1">🎯</span>`;
    }
    /* Plain emoji */
    return `<span style="font-size:${size}px;line-height:1">${icon}</span>`;
  }

  return { modules, allPerms, allPermKeys, defaultRoles, renderIcon, iconToEmoji };
})();
