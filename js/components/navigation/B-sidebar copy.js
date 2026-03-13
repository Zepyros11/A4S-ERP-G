// ============================================================
// A4S-ERP — Shared Sidebar Navigation v4 (Dropdown)
// ============================================================

(function () {
  const BASE_PATH = window.location.hostname.includes("github.io")
    ? "/" + window.location.pathname.split("/")[1]
    : "";

  const MENU = [
    {
      group: "ภาพรวม",
      icon: "📊",
      id: "g-overview",
      items: [
        {
          id: "dashboard",
          icon: "📊",
          label: "Dashboard",
          path: BASE_PATH + "/modules/dashboard/dashboard.html",
        },
      ],
    },
    {
      group: "่ตั้งค่า Stock",
      icon: "📦",
      id: "g-stock",
      items: [
        {
          id: "categories",
          icon: "🏷️",
          label: "หมวดหมู่",
          path:
            BASE_PATH +
            "/modules/inventory/categories/list/categories-list.html",
        },
        {
          id: "warehouses",
          icon: "🏭",
          label: "คลังสินค้า",
          path:
            BASE_PATH +
            "/modules/inventory/warehouses/list/warehouses-list.html",
        },
        {
          id: "products",
          icon: "✏️",
          label: "รายการสินค้า",
          path:
            BASE_PATH + "/modules/inventory/products/list/products-list.html",
        },
        {
          id: "stock-initial",
          icon: "📦",
          label: "Stock เริ่มต้น",
          path:
            BASE_PATH +
            "/modules/inventory/stockInitial/list/stock-initial-list.html",
        },

        {
          id: "stock-move",
          icon: "🔄",
          label: "ความเคลื่อนไหว",
          path: BASE_PATH + "/modules/stock/movements.html",
        },
      ],
    },
    {
      group: "เอกสาร",
      icon: "📄",
      id: "g-docs",
      items: [
        {
          id: "po",
          icon: "🛒",
          label: "ใบสั่งซื้อ (PO)",
          path: BASE_PATH + "/modules/document/po_form.html",
        },
        {
          id: "so",
          icon: "💰",
          label: "ใบขาย (SO)",
          path: BASE_PATH + "/modules/document/so_form.html",
        },
        {
          id: "req",
          icon: "📋",
          label: "ใบเบิก (REQ)",
          path: BASE_PATH + "/modules/document/requisition.html",
        },
      ],
    },
    {
      group: "รายงาน",
      icon: "📈",
      id: "g-reports",
      items: [
        {
          id: "reports",
          icon: "📈",
          label: "รายงาน Stock",
          path: BASE_PATH + "/modules/report/reports.html",
        },
      ],
    },
    {
      group: "ตั้งค่า",
      icon: "⚙️",
      id: "g-settings",
      items: [
        {
          id: "settings",
          icon: "⚙️",
          label: "ตั้งค่าระบบ",
          path: BASE_PATH + "/modules/settings/settings.html",
        },
        {
          id: "db_viewer",
          icon: "🗄️",
          label: "Database Viewer",
          path: BASE_PATH + "/modules/settings/db_viewer.html",
        },
        {
          id: "users",
          icon: "👥",
          label: "ผู้ใช้งาน",
          path: BASE_PATH + "/modules/settings/users.html",
        },
        {
          id: "suppliers",
          icon: "🚚",
          label: "Supplier",
          path: BASE_PATH + "/modules/settings/suppliers.html",
        },
        {
          id: "customers",
          icon: "🧑",
          label: "ลูกค้า",
          path: BASE_PATH + "/modules/settings/customers.html",
        },
      ],
    },
  ];

  const READY = [
    "po",
    "so",
    "req",
    "settings",
    //  **** Inventory ****
    "categories",
    "warehouses",
    "products",
    "stock-initial",
    // "dashboard",
    // "stock-move",
    "suppliers",
    "users",
    "customers",
    "reports",
    "db_viewer",
  ];

  function getActiveId() {
    const p = window.location.pathname;
    for (const g of MENU)
      for (const item of g.items) {
        const idSlug = item.id.replace(/-/g, "_");
        if (
          p.includes(idSlug) ||
          p.includes(item.id) ||
          p.endsWith(item.path.replace(/^\//, ""))
        )
          return item.id;
      }
    return "";
  }

  function getActiveGroupId(activeId) {
    for (const g of MENU)
      if (g.items.some((i) => i.id === activeId)) return g.id;
    return "";
  }

  // ── CSS ──
  const css = document.createElement("style");
  css.textContent = `
    html,body{margin:0;padding:0;}
    body{display:flex;flex-direction:column;min-height:100vh;}
    .topbar{position:sticky;top:0;z-index:200;flex-shrink:0;}
    #erp-shell{display:flex;flex:1;min-height:0;overflow:hidden;}

    #erp-sidebar{
      width:220px;min-width:220px;flex-shrink:0;
      background:#0d1117;
      display:flex;flex-direction:column;
      height:calc(100vh - 56px);
      position:sticky;top:56px;
      overflow-y:auto;overflow-x:hidden;
      transition:width .25s ease,min-width .25s ease;
      scrollbar-width:thin;scrollbar-color:#21262d transparent;
      z-index:100;
    }
    #erp-sidebar.collapsed{width:56px;min-width:56px;}
    #erp-sidebar::-webkit-scrollbar{width:4px;}
    #erp-sidebar::-webkit-scrollbar-thumb{background:#21262d;border-radius:2px;}
    #erp-main{flex:1;min-width:0;overflow-y:auto;height:calc(100vh - 56px);}

    .sb-logo{padding:14px 16px;border-bottom:1px solid #21262d;display:flex;align-items:center;justify-content:space-between;gap:8px;}
    .sb-logo-text{font-size:15px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;transition:opacity .2s,width .25s;}
    .sb-logo-text em{color:#6e7681;font-style:normal;font-weight:400;}
    #erp-sidebar.collapsed .sb-logo-text{opacity:0;width:0;}
    .sb-toggle{width:28px;height:28px;border-radius:6px;border:none;background:#21262d;color:#8b949e;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;transition:all .18s;}
    .sb-toggle:hover{background:#30363d;color:#e6edf3;}

    /* ── GROUP HEADER ── */
    .sb-group{border-bottom:1px solid #161b22;}
    .sb-grp-hdr{
      display:flex;align-items:center;gap:9px;
      padding:9px 14px;
      cursor:pointer;user-select:none;
      transition:background .15s;
      position:relative;
    }
    .sb-grp-hdr:hover{background:#161b22;}
    .sb-grp-icon{font-size:13px;flex-shrink:0;width:18px;text-align:center;}
    .sb-grp-lbl{
      font-size:11px;font-weight:700;letter-spacing:.8px;
      color:#c9d1d9;
      text-transform:uppercase;
      white-space:nowrap;flex:1;
      overflow:hidden;transition:opacity .2s;
    }
    #erp-sidebar.collapsed .sb-grp-lbl{opacity:0;width:0;}
    .sb-grp-arrow{font-size:9px;color:#6e7681;flex-shrink:0;transition:transform .2s;}
    .sb-grp-hdr.open .sb-grp-arrow{transform:rotate(90deg);}
    #erp-sidebar.collapsed .sb-grp-arrow{display:none;}

    /* ── DROPDOWN ITEMS ── */
    .sb-items{overflow:hidden;max-height:0;transition:max-height .25s ease;}
    .sb-items.open{max-height:500px;}
    #erp-sidebar.collapsed .sb-items{max-height:0!important;}

    .sb-item{
      display:flex;align-items:center;gap:9px;
      padding:8px 14px 8px 30px;
      font-size:13px;font-family:'Sarabun',sans-serif;
      color:#8b949e;text-decoration:none;
      white-space:nowrap;position:relative;
      transition:all .15s;box-sizing:border-box;width:100%;
    }
    .sb-item:hover{background:#161b22;color:#c9d1d9;}
    .sb-item.active{background:#1c2d3f;color:#79c0ff;}
    .sb-item.active::before{content:'';position:absolute;left:0;top:5px;bottom:5px;width:3px;background:#388bfd;border-radius:0 3px 3px 0;}
    .sb-item.soon{opacity:.35;cursor:default;}
    .sb-item.soon:hover{background:transparent;color:#8b949e;}
    .sb-icon{font-size:13px;flex-shrink:0;width:18px;text-align:center;}
    .sb-lbl{overflow:hidden;transition:opacity .2s;}
    #erp-sidebar.collapsed .sb-lbl{opacity:0;width:0;}
    .sb-soon{margin-left:auto;font-size:9px;padding:2px 5px;background:#21262d;color:#6e7681;border-radius:4px;font-weight:600;flex-shrink:0;}
    #erp-sidebar.collapsed .sb-soon{display:none;}
    #erp-sidebar.collapsed .sb-item{padding:8px 14px;}

    /* tooltips when collapsed */
    .sb-tip,.sb-grp-tip{display:none;position:absolute;left:calc(100% + 8px);top:50%;transform:translateY(-50%);background:#161b22;color:#e6edf3;padding:5px 10px;border-radius:6px;font-size:12px;white-space:nowrap;pointer-events:none;z-index:300;box-shadow:0 4px 16px rgba(0,0,0,.5);border:1px solid #30363d;}
    #erp-sidebar.collapsed .sb-item:hover .sb-tip{display:block;}
    #erp-sidebar.collapsed .sb-grp-hdr:hover .sb-grp-tip{display:block;}

    #sb-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:99;}
    #sb-overlay.show{display:block;}
    #sb-hamburger{display:none;padding:7px 10px;background:rgba(255,255,255,.12);color:#fff;border:none;border-radius:6px;font-size:16px;cursor:pointer;align-items:center;margin-right:4px;}

    @media(max-width:768px){
      #sb-hamburger{display:flex!important;}
      #erp-sidebar{position:fixed;top:56px;left:-220px;width:220px!important;min-width:220px!important;transition:left .25s ease;z-index:150;height:calc(100vh - 56px);}
      #erp-sidebar.open{left:0;}
      #erp-sidebar.collapsed .sb-logo-text,#erp-sidebar.collapsed .sb-lbl{opacity:1;width:auto;}
      #erp-sidebar.collapsed .sb-grp-lbl{opacity:1;}
      #erp-sidebar.collapsed .sb-soon{display:flex;}
      #erp-sidebar.collapsed .sb-items{max-height:500px!important;}
      #erp-sidebar.collapsed .sb-grp-arrow{display:block;}
      #erp-sidebar.collapsed .sb-item{padding:8px 14px 8px 30px;}
    }
  `;
  document.head.appendChild(css);

  // ── Build menu HTML ──
  const activeId = getActiveId();
  const activeGroupId = getActiveGroupId(activeId);
  const collapsed = localStorage.getItem("sb_collapsed") === "true";

  let openGroups = JSON.parse(localStorage.getItem("sb_open_groups") || "[]");
  if (activeGroupId && !openGroups.includes(activeGroupId))
    openGroups.push(activeGroupId);
  // default open single-item groups
  MENU.forEach((g) => {
    if (g.items.length === 1 && !openGroups.includes(g.id))
      openGroups.push(g.id);
  });

  let menuHTML = "";
  for (const g of MENU) {
    const isOpen = openGroups.includes(g.id);
    menuHTML += `<div class="sb-group" id="${g.id}">
      <div class="sb-grp-hdr ${isOpen ? "open" : ""}" onclick="toggleGroup('${g.id}')">
        <span class="sb-grp-icon">${g.icon}</span>
        <span class="sb-grp-lbl">${g.group}</span>
        <span class="sb-grp-arrow">›</span>
        <span class="sb-grp-tip">${g.group}</span>
      </div>
      <div class="sb-items ${isOpen ? "open" : ""}">`;
    for (const item of g.items) {
      const ready = READY.includes(item.id);
      const cls = [
        "sb-item",
        item.id === activeId ? "active" : "",
        !ready ? "soon" : "",
      ]
        .filter(Boolean)
        .join(" ");
      menuHTML += `<a href="${ready ? item.path : "#"}" class="${cls}" ${!ready ? 'onclick="return false"' : ""}>
        <span class="sb-icon">${item.icon}</span>
        <span class="sb-lbl">${item.label}</span>
        ${!ready ? '<span class="sb-soon">SOON</span>' : ""}
        <span class="sb-tip">${item.label}</span>
      </a>`;
    }
    menuHTML += `</div></div>`;
  }

  // ── Inject DOM ──
  window.addEventListener("DOMContentLoaded", function () {
    const topbar = document.querySelector(".topbar");
    const page = document.querySelector(".page");
    if (!topbar || !page) return;

    const hamburger = document.createElement("button");
    hamburger.id = "sb-hamburger";
    hamburger.textContent = "☰";
    hamburger.onclick = toggleSidebar;
    topbar.insertBefore(hamburger, topbar.firstChild);

    const overlay = document.createElement("div");
    overlay.id = "sb-overlay";
    overlay.onclick = toggleSidebar;
    document.body.appendChild(overlay);

    const sidebar = document.createElement("aside");
    sidebar.id = "erp-sidebar";
    if (collapsed) sidebar.classList.add("collapsed");
    sidebar.innerHTML = `
      <div class="sb-logo">
        <span class="sb-logo-text">📦 A4S<em>-ERP</em></span>
        <button class="sb-toggle" onclick="toggleSidebar()" title="ย่อ/ขยาย">
          <span id="sb-icon">${collapsed ? "›" : "‹"}</span>
        </button>
      </div>
      ${menuHTML}`;

    const main = document.createElement("div");
    main.id = "erp-main";
    const footer = document.querySelector(".form-footer");
    main.appendChild(page);
    if (footer) main.appendChild(footer);

    const shell = document.createElement("div");
    shell.id = "erp-shell";
    shell.appendChild(sidebar);
    shell.appendChild(main);
    topbar.after(shell);
  });

  window.toggleSidebar = function () {
    const sb = document.getElementById("erp-sidebar");
    const ov = document.getElementById("sb-overlay");
    const ico = document.getElementById("sb-icon");
    if (!sb) return;
    if (window.innerWidth <= 768) {
      sb.classList.toggle("open");
      ov.classList.toggle("show");
    } else {
      sb.classList.toggle("collapsed");
      const c = sb.classList.contains("collapsed");
      if (ico) ico.textContent = c ? "›" : "‹";
      localStorage.setItem("sb_collapsed", c);
    }
  };

  window.toggleGroup = function (groupId) {
    const sb = document.getElementById("erp-sidebar");
    if (sb && sb.classList.contains("collapsed") && window.innerWidth > 768)
      return;
    const grp = document.getElementById(groupId);
    const hdr = grp?.querySelector(".sb-grp-hdr");
    const items = grp?.querySelector(".sb-items");
    if (!hdr || !items) return;
    const isOpen = items.classList.contains("open");
    hdr.classList.toggle("open", !isOpen);
    items.classList.toggle("open", !isOpen);
    let og = JSON.parse(localStorage.getItem("sb_open_groups") || "[]");
    if (isOpen) og = og.filter((id) => id !== groupId);
    else if (!og.includes(groupId)) og.push(groupId);
    localStorage.setItem("sb_open_groups", JSON.stringify(og));
  };
})();
