/* =====================================================
   warehouses-list.js
   Page Controller — Warehouses List
===================================================== */

import {
  fetchWarehouses,
  fetchStock,
  fetchCountries,
  createWarehouse,
  updateWarehouse,
  removeWarehouse,
  patchWarehouseStatus,
} from "./warehouses-api.js";

import { openWarehouseModal, setFormState } from "./warehouses-form.js";
import { renderWarehousesTable } from "./warehouses-table.js";

/* ================================
   STATE
================================ */

let warehouses = [];
let stock = [];
let countries = [];
let currentSort = { field: "", dir: "asc" };
let currentPanelItems = [];

/* ================================
   INIT
================================ */

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", initPage);
} else {
  initPage();
}

async function initPage() {
  await loadFormModal();
  await loadData();
  bindEvents();
}

async function loadFormModal() {
  const container = document.getElementById("warehouseFormContainer");
  if (!container) return;
  const res = await fetch("./warehouses-form.html");
  const html = await res.text();
  container.innerHTML = html;
}

/* ================================
   LOAD DATA
================================ */

async function loadData() {
  showLoading(true);
  try {
    [warehouses, stock, countries] = await Promise.all([
      fetchWarehouses(),
      fetchStock(),
      fetchCountries(),
    ]);

    warehouses = warehouses || [];
    stock = stock || [];
    countries = countries || [];

    setFormState(warehouses, countries);
    renderTable();
    renderStats();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

/* ================================
   RENDER TABLE
================================ */

function renderTable() {
  renderWarehousesTable(warehouses, stock, countries);
}

/* ================================
   RENDER STATS
================================ */

function renderStats() {
  const total = warehouses.length;
  const active = warehouses.filter((w) => w.is_active).length;
  document.getElementById("statTotal").textContent = total;
  document.getElementById("statActive").textContent = active;
  document.getElementById("statInactive").textContent = total - active;
  document.getElementById("statStock").textContent = stock.length;
}

/* ================================
   SORT
================================ */

window.sortTable = function (field) {
  currentSort.dir =
    currentSort.field === field
      ? currentSort.dir === "asc"
        ? "desc"
        : "asc"
      : "asc";
  currentSort.field = field;

  warehouses.sort((a, b) => {
    const x = a[field] || "";
    const y = b[field] || "";
    return currentSort.dir === "asc" ? (x > y ? 1 : -1) : x < y ? 1 : -1;
  });

  document.querySelectorAll(".sort-icon").forEach((i) => {
    i.classList.remove("active");
    i.textContent = "⇅";
  });
  const icon = document.getElementById("sort-" + field);
  if (icon) {
    icon.classList.add("active");
    icon.textContent = currentSort.dir === "asc" ? "▲" : "▼";
  }

  renderTable();
};

/* ================================
   EDIT / DELETE / TOGGLE
================================ */

window.editWarehouse = function (id) {
  openWarehouseModal(warehouses.find((w) => w.warehouse_id === id));
};

window.deleteWarehouse = function (id, name) {
  const qty = stock
    .filter((s) => s.warehouse_id === id)
    .reduce((a, b) => a + (b.qty_on_hand || 0), 0);

  if (qty > 0) {
    showToast(`คลัง "${name}" ยังมีสินค้าอยู่ ลบไม่ได้`, "warning");
    return;
  }

  DeleteModal.open(`ต้องการลบคลัง "${name}" หรือไม่?`, async () => {
    showLoading(true);
    try {
      await removeWarehouse(id);
      showToast("ลบสำเร็จ");
      await loadData();
    } catch (e) {
      showToast("ลบไม่สำเร็จ: " + e.message, "error");
    }
    showLoading(false);
  });
};

window.toggleWarehouseStatus = async function (id, status) {
  try {
    await patchWarehouseStatus(id, status);
    const w = warehouses.find((w) => w.warehouse_id === id);
    if (w) w.is_active = status;
    renderTable();
    renderStats();
    showToast("อัปเดตสถานะสำเร็จ");
  } catch {
    showToast("เปลี่ยนสถานะไม่ได้", "error");
  }
};

/* ================================
   SAVE EVENT (จาก warehouses-form.js)
================================ */

window.addEventListener("warehouse-saved", async (e) => {
  const { warehouse_id, ...data } = e.detail;

  showLoading(true);
  try {
    if (warehouse_id) {
      await updateWarehouse(warehouse_id, data);
      showToast("✅ แก้ไขคลังสำเร็จ!");
    } else {
      await createWarehouse(data);
      showToast("✅ เพิ่มคลังสำเร็จ!");
    }
    await loadData();
  } catch (e) {
    const msg =
      e.message.includes("duplicate") || e.message.includes("unique")
        ? "รหัสคลังซ้ำ"
        : "บันทึกไม่สำเร็จ";
    showToast(msg, "error");
  }
  showLoading(false);
});

/* ================================
   PANEL — Stock ในคลัง
================================ */

window.openWarehouseStock = function (id, name, icon) {
  currentPanelItems = stock.filter((s) => s.warehouse_id === id);
  document.getElementById("panelTitle").innerHTML =
    `สินค้าในคลัง : ${icon || "🏣"} ${name}`;
  document.getElementById("warehousePanel").classList.add("open");
  drawPanel(currentPanelItems);
};

window.closePanel = function () {
  document.getElementById("warehousePanel").classList.remove("open");
};

window.filterPanelStock = function () {
  const q = document.getElementById("panelSearch").value.toLowerCase();
  drawPanel(
    currentPanelItems.filter(
      (i) =>
        (i.product_name || "").toLowerCase().includes(q) ||
        (i.product_sku || "").toLowerCase().includes(q),
    ),
  );
};

function drawPanel(items) {
  const body = document.getElementById("panelBody");
  if (items.length === 0) {
    body.innerHTML = `<div style="padding:30px;text-align:center;color:var(--text3)">ไม่พบสินค้า</div>`;
    return;
  }
  body.innerHTML = `
<table class="stock-table">
  <thead><tr><th>สินค้า</th><th>จำนวน</th></tr></thead>
  <tbody>
    ${items
      .map((i) => {
        const cls =
          i.qty_on_hand === 0
            ? "qty-zero"
            : i.qty_on_hand < 5
              ? "qty-low"
              : "qty-ok";
        return `<tr><td>${i.product_name || "-"}</td><td class="stock-qty ${cls}">${i.qty_on_hand}</td></tr>`;
      })
      .join("")}
  </tbody>
</table>`;
}

/* ================================
   EXPORT / IMPORT / TEMPLATE
================================ */

window.exportWarehouses = function () {
  if (!warehouses.length) {
    showToast("ไม่มีข้อมูลให้ Export", "warning");
    return;
  }
  const rows = warehouses.map((w) => ({
    code: w.warehouse_code,
    name: w.warehouse_name,
    type: w.warehouse_type,
    manager: w.manager_name || "",
    location: w.location || "",
    phone: w.phone || "",
    active: w.is_active ? "YES" : "NO",
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Warehouses");
  XLSX.writeFile(wb, "warehouses_export.xlsx");
};

window.importWarehouses = function () {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".xlsx,.csv";
  input.onchange = async (e) => {
    const file = e.target.files[0];
    const text = await file.text();
    const rows = text.split("\n").slice(1);
    for (const row of rows) {
      if (!row.trim()) continue;
      const cols = row.split(",");
      await createWarehouse({
        warehouse_code: cols[0],
        warehouse_name: cols[1],
        warehouse_type: cols[2] || "MAIN",
        manager_name: cols[3] || "",
        location: cols[4] || "",
        phone: cols[5] || "",
        is_active: true,
      });
    }
    await loadData();
    showToast("Import สำเร็จ");
  };
  input.click();
};

window.downloadTemplate = function () {
  const data = [
    {
      warehouse_code: "",
      warehouse_name: "",
      warehouse_type: "",
      manager_name: "",
      location: "",
      phone: "",
    },
  ];
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Warehouses");
  XLSX.writeFile(wb, "warehouse_template.xlsx");
};

/* ================================
   BIND EVENTS
================================ */

function bindEvents() {
  document
    .getElementById("btnAddWarehouse")
    ?.addEventListener("click", () => openWarehouseModal());

  document
    .getElementById("searchInput")
    ?.addEventListener("input", renderTable);

  document
    .getElementById("filterType")
    ?.addEventListener("change", renderTable);

  document
    .getElementById("filterStatus")
    ?.addEventListener("change", renderTable);
}

/* ================================
   UTILS
================================ */

function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove("show"), 3000);
}

function showLoading(show) {
  document.getElementById("loadingOverlay")?.classList.toggle("show", show);
}
