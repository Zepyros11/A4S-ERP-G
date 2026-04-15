/* ============================================================
   permissions.js — Central Permission Registry (3-Level Tree)
   ============================================================
   โครงสร้าง: Module → Sub-module (หน้า) → Actions
   ตรงกับ sidebar ทุกหน้า
   ============================================================ */

/* global AppPermissions */
window.AppPermissions = (() => {
  const modules = [
    /* ── ภาพรวม ── */
    {
      key: "dashboard", label: "ภาพรวม", icon: "📊",
      children: [
        { key: "dashboard", label: "Dashboard", icon: "📊", perms: [
          { key: "dashboard_view", label: "ดู" },
        ]},
      ],
    },

    /* ── กิจกรรม (EVENT) ── */
    {
      key: "event", label: "กิจกรรม (EVENT)", icon: "🗓️",
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
          { key: "attendee_view", label: "ดูรายการ" },
          { key: "attendee_edit", label: "แก้ไข" },
        ]},
        { key: "media", label: "สื่อ & มีเดีย", icon: "🎬", perms: [
          { key: "media_view",   label: "ดูรายการ" },
          { key: "media_upload", label: "อัปโหลด" },
          { key: "media_delete", label: "ลบ" },
        ]},
      ],
    },

    /* ── ตั้งค่า Stock ── */
    {
      key: "stock", label: "ตั้งค่า Stock", icon: "📦",
      children: [
        { key: "inv_cat", label: "หมวดหมู่", icon: "🏷️", perms: [
          { key: "inv_cat_view",   label: "ดูรายการ" },
          { key: "inv_cat_create", label: "สร้าง" },
          { key: "inv_cat_edit",   label: "แก้ไข" },
          { key: "inv_cat_delete", label: "ลบ" },
        ]},
        { key: "warehouse", label: "คลังสินค้า", icon: "🏭", perms: [
          { key: "warehouse_view",   label: "ดูรายการ" },
          { key: "warehouse_create", label: "สร้าง" },
          { key: "warehouse_edit",   label: "แก้ไข" },
          { key: "warehouse_delete", label: "ลบ" },
        ]},
        { key: "product", label: "รายการสินค้า", icon: "✏️", perms: [
          { key: "product_view",   label: "ดูรายการ" },
          { key: "product_create", label: "สร้าง" },
          { key: "product_edit",   label: "แก้ไข" },
          { key: "product_delete", label: "ลบ" },
        ]},
        { key: "stock_init", label: "Stock เริ่มต้น", icon: "📦", perms: [
          { key: "stock_init_view",   label: "ดูรายการ" },
          { key: "stock_init_create", label: "สร้าง" },
          { key: "stock_init_edit",   label: "แก้ไข" },
        ]},
        { key: "stock_move", label: "ความเคลื่อนไหว", icon: "🔄", perms: [
          { key: "stock_move_view",   label: "ดูรายการ" },
          { key: "stock_move_create", label: "บันทึกรายการ" },
        ]},
      ],
    },

    /* ── เอกสาร ── */
    {
      key: "docs", label: "เอกสาร", icon: "📄",
      children: [
        { key: "po", label: "ใบสั่งซื้อ (PO)", icon: "🛒", perms: [
          { key: "po_view",    label: "ดูรายการ" },
          { key: "po_create",  label: "สร้าง" },
          { key: "po_edit",    label: "แก้ไข" },
          { key: "po_approve", label: "อนุมัติ" },
          { key: "po_delete",  label: "ลบ" },
        ]},
        { key: "so", label: "ใบขาย (SO)", icon: "💰", perms: [
          { key: "so_view",    label: "ดูรายการ" },
          { key: "so_create",  label: "สร้าง" },
          { key: "so_edit",    label: "แก้ไข" },
          { key: "so_approve", label: "อนุมัติ" },
          { key: "so_delete",  label: "ลบ" },
        ]},
        { key: "req", label: "ใบเบิก (REQ)", icon: "📋", perms: [
          { key: "req_view",    label: "ดูรายการ" },
          { key: "req_create",  label: "สร้าง" },
          { key: "req_approve", label: "อนุมัติ" },
        ]},
      ],
    },

    /* ── รายงาน ── */
    {
      key: "report", label: "รายงาน", icon: "📈",
      children: [
        { key: "report_stock", label: "รายงาน Stock", icon: "📈", perms: [
          { key: "report_stock_view",   label: "ดูรายงาน" },
          { key: "report_stock_export", label: "ส่งออก" },
        ]},
      ],
    },

    /* ── ตั้งค่า ── */
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
        { key: "supplier", label: "Supplier", icon: "🚚", perms: [
          { key: "supplier_view",   label: "ดูรายการ" },
          { key: "supplier_create", label: "สร้าง" },
          { key: "supplier_edit",   label: "แก้ไข" },
          { key: "supplier_delete", label: "ลบ" },
        ]},
        { key: "customer", label: "ลูกค้า", icon: "🧑", perms: [
          { key: "customer_view",   label: "ดูรายการ" },
          { key: "customer_create", label: "สร้าง" },
          { key: "customer_edit",   label: "แก้ไข" },
          { key: "customer_delete", label: "ลบ" },
        ]},
        { key: "member", label: "สมาชิก (MLM)", icon: "👤", perms: [
          { key: "member_view",         label: "ดูรายการ" },
          { key: "member_import",       label: "นำเข้า Excel" },
          { key: "member_export",       label: "ส่งออก" },
          { key: "member_edit",         label: "แก้ไข" },
          { key: "member_delete",       label: "ลบ" },
          { key: "member_decrypt",      label: "ถอดรหัสข้อมูลลับ" },
          { key: "member_sync_config",  label: "ตั้งค่า Auto-Sync" },
          { key: "member_sync_trigger", label: "กด Sync Now" },
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
      label: "Admin", icon: "fluent-emoji-flat:crown", color: "role-ADMIN",
      perms: [...allPermKeys],
    },
    MANAGER: {
      label: "Manager", icon: "fluent-emoji-flat:office-building", color: "role-MANAGER",
      perms: [
        "dashboard_view",
        "poster_view","poster_create","poster_edit",
        "events_view","events_create","events_edit",
        "evt_cat_view","evt_cat_create","evt_cat_edit",
        "evt_place_view","evt_place_create","evt_place_edit",
        "evt_req_view","evt_req_create","evt_req_approve",
        "evt_budget_view","evt_budget_create","evt_budget_edit",
        "attendee_view","attendee_edit",
        "media_view","media_upload",
        "inv_cat_view","inv_cat_create","inv_cat_edit",
        "warehouse_view","warehouse_create","warehouse_edit",
        "product_view","product_create","product_edit",
        "stock_init_view","stock_init_create","stock_init_edit",
        "stock_move_view","stock_move_create",
        "po_view","po_create","po_edit","po_approve",
        "so_view","so_create","so_edit","so_approve",
        "req_view","req_create","req_approve",
        "report_stock_view","report_stock_export",
        "supplier_view","supplier_create","supplier_edit",
        "customer_view","customer_create","customer_edit",
      ],
    },
    WAREHOUSE: {
      label: "Warehouse", icon: "fluent-emoji-flat:factory", color: "role-WAREHOUSE",
      perms: [
        "dashboard_view",
        "inv_cat_view","inv_cat_create","inv_cat_edit","inv_cat_delete",
        "warehouse_view","warehouse_create","warehouse_edit","warehouse_delete",
        "product_view","product_create","product_edit","product_delete",
        "stock_init_view","stock_init_create","stock_init_edit",
        "stock_move_view","stock_move_create",
        "po_view","po_create",
        "req_view","req_create",
        "report_stock_view",
      ],
    },
    SALES: {
      label: "Sales", icon: "fluent-emoji-flat:money-bag", color: "role-SALES",
      perms: [
        "dashboard_view",
        "poster_view","events_view",
        "product_view",
        "so_view","so_create","so_edit",
        "req_view","req_create",
        "report_stock_view",
        "customer_view","customer_create","customer_edit",
      ],
    },
    VIEWER: {
      label: "Viewer", icon: "fluent-emoji-flat:eye", color: "role-VIEWER",
      perms: [
        "dashboard_view",
        "poster_view","events_view",
        "product_view",
        "po_view","so_view",
        "report_stock_view",
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
    /* Iconify format: "fluent-emoji-flat:crown", "ph:user-fill" */
    if (typeof icon === "string" && icon.includes(":")) {
      /* Colorful sets → อย่า override สี */
      const isColorful = /^(fluent-emoji|twemoji|noto|emojione|openmoji)/.test(icon);
      const colorQS = isColorful ? "" : "?color=%23334155";
      return `<img src="https://api.iconify.design/${icon}.svg${colorQS}" width="${size}" height="${size}" style="vertical-align:middle;display:inline-block" alt="" />`;
    }
    /* Plain emoji */
    return icon;
  }

  return { modules, allPerms, allPermKeys, defaultRoles, renderIcon, iconToEmoji };
})();
