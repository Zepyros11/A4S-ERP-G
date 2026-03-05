// ============================================================
// A4S-ERP — Sidebar Navigation (GitHub Pages Safe)
// ============================================================

// ---------- Detect BASE PATH ----------
function getBasePath() {
  const host = window.location.hostname;

  if (host.includes("github.io")) {
    const parts = window.location.pathname.split("/");
    return "/" + parts[1];
  }

  return "";
}

const BASE_PATH = getBasePath();

// ---------- MENU CONFIG ----------
const MENU = [
  {
    group: "ภาพรวม",
    icon: "📊",
    items: [
      {
        id: "dashboard",
        icon: "📊",
        label: "Dashboard",
        path: "/modules/dashboard/dashboard.html",
      },
    ],
  },

  {
    group: "Stock",
    icon: "📦",
    items: [
      {
        id: "products",
        icon: "📦",
        label: "รายการสินค้า",
        path: "/modules/stock/products.html",
      },
      {
        id: "categories",
        icon: "🏷️",
        label: "หมวดหมู่",
        path: "/modules/stock/categories.html",
      },
      {
        id: "stock-adjust",
        icon: "✏️",
        label: "จัดการสินค้า",
        path: "/modules/stock/stock_adjustment.html",
      },
      {
        id: "movements",
        icon: "🔄",
        label: "ความเคลื่อนไหว",
        path: "/modules/stock/movements.html",
      },
      {
        id: "warehouses",
        icon: "🏭",
        label: "คลังสินค้า",
        path: "/modules/stock/warehouses.html",
      },
    ],
  },

  {
    group: "เอกสาร",
    icon: "📄",
    items: [
      {
        id: "po",
        icon: "🛒",
        label: "ใบสั่งซื้อ (PO)",
        path: "/modules/document/po_form.html",
      },
      {
        id: "so",
        icon: "💰",
        label: "ใบขาย (SO)",
        path: "/modules/document/so_form.html",
      },
      {
        id: "req",
        icon: "📋",
        label: "ใบเบิก (REQ)",
        path: "/modules/document/requisition.html",
      },
    ],
  },

  {
    group: "รายงาน",
    icon: "📈",
    items: [
      {
        id: "reports",
        icon: "📈",
        label: "รายงาน Stock",
        path: "/modules/report/reports.html",
      },
    ],
  },

  {
    group: "ตั้งค่า",
    icon: "⚙️",
    items: [
      {
        id: "settings",
        icon: "⚙️",
        label: "ตั้งค่าระบบ",
        path: "/modules/settings/settings.html",
      },
      {
        id: "users",
        icon: "👥",
        label: "ผู้ใช้งาน",
        path: "/modules/settings/users.html",
      },
      {
        id: "suppliers",
        icon: "🚚",
        label: "Supplier",
        path: "/modules/settings/suppliers.html",
      },
      {
        id: "customers",
        icon: "🧑",
        label: "ลูกค้า",
        path: "/modules/settings/customers.html",
      },
    ],
  },
];

// ---------- Detect Active Page ----------
function getActivePage() {
  const path = window.location.pathname;

  for (const group of MENU) {
    for (const item of group.items) {
      if (path.includes(item.path)) {
        return item.id;
      }
    }
  }

  return "";
}

// ---------- Build Sidebar ----------
function buildSidebar() {
  const activePage = getActivePage();

  let html = `
  <aside id="erp-sidebar">
    <div class="sb-logo">
      📦 A4S-ERP
    </div>
  `;

  MENU.forEach((group) => {
    html += `
    <div class="sb-group">
      <div class="sb-group-title">
        ${group.icon} ${group.group}
      </div>
    `;

    group.items.forEach((item) => {
      const url = BASE_PATH + item.path;
      const active = item.id === activePage ? "active" : "";

      html += `
        <a class="sb-item ${active}" href="${url}">
          <span class="sb-icon">${item.icon}</span>
          <span class="sb-label">${item.label}</span>
        </a>
      `;
    });

    html += `</div>`;
  });

  html += `</aside>`;

  return html;
}

// ---------- Inject Layout ----------
document.addEventListener("DOMContentLoaded", () => {
  const sidebar = buildSidebar();

  const body = document.body;

  const wrapper = document.createElement("div");
  wrapper.id = "erp-layout";

  wrapper.innerHTML = `
    ${sidebar}
    <main id="erp-main"></main>
  `;

  body.prepend(wrapper);
});
