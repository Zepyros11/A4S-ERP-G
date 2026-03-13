/* ============================================================
   stock-initial-list.js — Controller for Stock Initial page
   ============================================================ */

import {
  fetchProducts,
  fetchWarehouses,
  fetchCategories,
  fetchProductImages,
  fetchStockInits,
  deleteStockInit,
  createStockInit,
} from "./stock-initial-api.js";

import {
  buildTableHeader,
  renderTable,
  buildWarehouseTabs,
} from "./stock-initial-table.js";

// ── State ────────────────────────────────────────────────────
let products = [];
let warehouses = [];
let categories = [];
let productImages = [];
let initMap = {};
let originalValues = {};
let currentSort = { field: "product_name", dir: "asc" };

let activeCountry = null;
let activeParent = null;
let activeWarehouseId = null;

// ── Init ─────────────────────────────────────────────────────
async function initPage() {
  const { url } = { url: localStorage.getItem("sb_url") };
  if (!url) return;
  await loadData();
  bindEvents();
}

function bindEvents() {
  document.getElementById("searchInput")?.addEventListener("input", redraw);
  document.getElementById("filterCategory")?.addEventListener("change", redraw);
  document.getElementById("filterStatus")?.addEventListener("change", redraw);
}

// ── Load Data ────────────────────────────────────────────────
async function loadData() {
  showLoading(true);
  try {
    const [_prods, _whs, _cats, _imgs, inits] = await Promise.all([
      fetchProducts(),
      fetchWarehouses(),
      fetchCategories(),
      fetchProductImages(),
      fetchStockInits(),
    ]);

    products = _prods || [];
    warehouses = _whs || [];
    categories = _cats || [];
    productImages = _imgs || [];

    initMap = {};
    (inits || []).forEach((r) => {
      initMap[`${r.product_id}-${r.warehouse_id}`] = r;
    });
    originalValues = {};

    // set initial active warehouse
    if (warehouses.length) {
      activeCountry = warehouses[0]?.country || null;
      const firstParent = warehouses.find(
        (w) => !w.parent_id && w.country === activeCountry,
      );
      activeParent = firstParent?.warehouse_id || null;
      activeWarehouseId = activeParent || warehouses[0]?.warehouse_id;
    }

    buildCategoryFilter();
    renderStats();
    buildWarehouseTabs(
      warehouses,
      activeCountry,
      activeParent,
      activeWarehouseId,
    );
    buildTableHeader(warehouses, activeWarehouseId);
    redraw();
  } catch (err) {
    console.error(err);
    showToast("โหลดข้อมูลไม่สำเร็จ", "error");
  } finally {
    showLoading(false);
  }
}

// ── Redraw Table ─────────────────────────────────────────────
function redraw() {
  const search =
    document.getElementById("searchInput")?.value.toLowerCase() || "";
  const catId = document.getElementById("filterCategory")?.value || "";
  const status = document.getElementById("filterStatus")?.value || "";

  renderTable({
    products,
    categories,
    productImages,
    initMap,
    originalValues,
    activeWarehouseId,
    currentSort,
    search,
    catId,
    status,
  });

  updateSaveAllBtn();
}

// ── Category Filter ──────────────────────────────────────────
function buildCategoryFilter() {
  const sel = document.getElementById("filterCategory");
  if (!sel) return;
  sel.innerHTML = `<option value="">🏷️ ทุกหมวดหมู่</option>`;
  categories.forEach((c) => {
    sel.innerHTML += `<option value="${c.category_id}">${c.category_name}</option>`;
  });
}

// ── Stats ─────────────────────────────────────────────────────
function renderStats() {
  const productIdsWithInit = new Set(
    Object.keys(initMap).map((k) => parseInt(k.split("-")[0])),
  );
  const hasStock = products.filter((p) =>
    productIdsWithInit.has(p.product_id),
  ).length;

  document.getElementById("statTotal").textContent = products.length;
  document.getElementById("statHasStock").textContent = hasStock;
  document.getElementById("statNoStock").textContent =
    products.length - hasStock;
  document.getElementById("statWarehouses").textContent = warehouses.length;
}

// ── Sort ──────────────────────────────────────────────────────
window.sortTable = function (field) {
  if (currentSort.field === field) {
    currentSort.dir = currentSort.dir === "asc" ? "desc" : "asc";
  } else {
    currentSort.field = field;
    currentSort.dir = "asc";
  }
  document.querySelectorAll(".sort-icon").forEach((i) => {
    i.classList.remove("active");
    i.textContent = "⇅";
  });
  const icon = document.getElementById("sort-" + field);
  if (icon) {
    icon.classList.add("active");
    icon.textContent = currentSort.dir === "asc" ? "▲" : "▼";
  }
  redraw();
};

// ── Warehouse Navigation ─────────────────────────────────────
window.setCountry = function (code) {
  activeCountry = code;
  const firstParent = warehouses.find(
    (w) => !w.parent_id && w.country === code,
  );
  activeParent = firstParent?.warehouse_id || null;
  activeWarehouseId = activeParent;
  buildWarehouseTabs(
    warehouses,
    activeCountry,
    activeParent,
    activeWarehouseId,
  );
  buildTableHeader(warehouses, activeWarehouseId);
  redraw();
};

window.setParent = function (id) {
  activeParent = id;
  activeWarehouseId = id;
  buildWarehouseTabs(
    warehouses,
    activeCountry,
    activeParent,
    activeWarehouseId,
  );
  buildTableHeader(warehouses, activeWarehouseId);
  redraw();
};

window.setWarehouse = function (id) {
  activeWarehouseId = id;
  buildWarehouseTabs(
    warehouses,
    activeCountry,
    activeParent,
    activeWarehouseId,
  );
  buildTableHeader(warehouses, activeWarehouseId);
  redraw();
};

// ── Change Detection ─────────────────────────────────────────
window.onAnyInput = function () {
  updateSaveAllBtn();
};

function updateSaveAllBtn() {
  const btn = document.getElementById("saveAllBtn");
  if (!btn) return;
  const hasChange = getChangedRows().length > 0;
  btn.style.display = hasChange ? "inline-flex" : "none";
}

function getChangedRows() {
  const changed = [];
  document.querySelectorAll(".si-qty-input").forEach((input) => {
    const parts = input.id.replace("inp-", "").split("-");
    const productId = parseInt(parts[0]);
    const whId = parseInt(parts[1]);
    const key = `${productId}-${whId}`;
    const currentVal = input.value === "" ? "" : parseFloat(input.value);
    const original = originalValues[key] ?? "";
    if (currentVal !== original && input.value !== "") {
      changed.push({ productId, whId, qty: parseFloat(input.value) });
    }
  });
  return changed;
}

// ── Save ──────────────────────────────────────────────────────
window.saveAll = async function () {
  const changed = getChangedRows();
  if (changed.length === 0) {
    showToast("ไม่มีการเปลี่ยนแปลง", "warning");
    return;
  }
  showLoading(true);
  try {
    for (const { productId, whId, qty } of changed) {
      const key = `${productId}-${whId}`;
      const existing = initMap[key];
      if (existing) await deleteStockInit(existing.movement_id);
      await createStockInit(productId, whId, qty);
    }
    await loadData();
    showToast(`บันทึกสำเร็จ ${changed.length} รายการ`);
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

// ── Image Popup ───────────────────────────────────────────────
window.openImgPopup = function (productId) {
  const imgs = productImages
    .filter((i) => i.product_id === productId)
    .map((i) => i.url);
  if (imgs.length) ImgPopup.open(imgs, 0);
};

// ── Toast / Loading ───────────────────────────────────────────
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

// ── Boot ──────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", initPage);
