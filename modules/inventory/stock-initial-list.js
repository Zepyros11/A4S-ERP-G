/* ============================================================
   stock-initial-list.js — Controller (Product-centric + Modal)
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
  renderProductList,
  renderMatrix,
  buildMatrixSubtitle,
} from "./stock-initial-table.js";

// ── State ────────────────────────────────────────────────────
let products = [];
let warehouses = [];
let categories = [];
let productImages = [];
let initMap = {}; // key: `${productId}-${warehouseId}` → record
let currentSort = { field: "product_name", dir: "asc" };

// modal state
let modalParent = null; // current product (parent or singleton) being edited
let modalRows = []; // SKUs in matrix (singleton → [product]; parent → variants)
let modalOriginal = {}; // key `${productId}-${whId}` → original qty (for change detection)

// ── Init ─────────────────────────────────────────────────────
async function initPage() {
  const url = localStorage.getItem("sb_url");
  if (!url) return;
  await loadData();
  bindEvents();
}

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

    // build init map · last-write wins (in case of duplicate INIT records)
    initMap = {};
    (inits || []).forEach((r) => {
      initMap[`${r.product_id}-${r.warehouse_id}`] = r;
    });

    populateCategoryFilter();
    renderStats();
    redraw();
  } catch (err) {
    console.error(err);
    showToast("โหลดข้อมูลไม่สำเร็จ", "error");
  } finally {
    showLoading(false);
  }
}

function bindEvents() {
  document.getElementById("searchInput")?.addEventListener("input", redraw);
  document
    .getElementById("filterFillStatus")
    ?.addEventListener("change", redraw);
  document
    .getElementById("filterCategory")
    ?.addEventListener("change", redraw);
}

function populateCategoryFilter() {
  const sel = document.getElementById("filterCategory");
  if (!sel) return;
  sel.innerHTML = '<option value="">🧿 ทุกหมวดหมู่</option>';
  categories.forEach((c) =>
    sel.insertAdjacentHTML(
      "beforeend",
      `<option value="${c.category_id}">${c.icon || ""} ${c.category_name}</option>`,
    ),
  );
}

// ── Redraw product list ──────────────────────────────────────
function redraw() {
  const search =
    document.getElementById("searchInput")?.value.toLowerCase() || "";
  const fillStatus =
    document.getElementById("filterFillStatus")?.value || "";
  const categoryId =
    document.getElementById("filterCategory")?.value || "";

  renderProductList({
    products,
    categories,
    productImages,
    warehouses,
    initMap,
    currentSort,
    search,
    fillStatus,
    categoryId,
  });
}

// ── Stats ─────────────────────────────────────────────────────
function renderStats() {
  // SKU = parent_product_id != null OR singleton (no kids)
  const parentIdsWithKids = new Set(
    products.filter((p) => p.parent_product_id).map((c) => c.parent_product_id),
  );
  const isSku = (p) =>
    p.parent_product_id || !parentIdsWithKids.has(p.product_id);
  const skuList = products.filter(isSku);
  const parentList = products.filter((p) => !p.parent_product_id);

  // ตั้งครบ vs บางส่วน — ใช้ระดับ "ชุดสินค้า"
  let fully = 0,
    partial = 0;
  parentList.forEach((p) => {
    const skus = parentIdsWithKids.has(p.product_id)
      ? products.filter((c) => c.parent_product_id === p.product_id)
      : [p];
    let setCount = 0;
    skus.forEach((sku) => {
      warehouses.forEach((w) => {
        if (initMap[`${sku.product_id}-${w.warehouse_id}`]) setCount++;
      });
    });
    const total = skus.length * warehouses.length;
    if (total === 0) return;
    if (setCount === total) fully++;
    else if (setCount > 0) partial++;
  });

  document.getElementById("statTotal").textContent = skuList.length;
  document.getElementById("statParents").textContent =
    `${parentList.length} ชุดสินค้า`;

  document.getElementById("statFullySet").textContent = fully;
  document.getElementById("statFullySetSub").textContent =
    `จาก ${parentList.length} ชุด`;

  document.getElementById("statPartial").textContent = partial;
  document.getElementById("statPartialSub").textContent =
    `จาก ${parentList.length} ชุด`;

  document.getElementById("statWarehouses").textContent = warehouses.length;
  const countries = new Set(warehouses.map((w) => w.country).filter(Boolean));
  document.getElementById("statCountries").textContent =
    `${countries.size} ประเทศ`;
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

// ── Image popup (from product list) ──────────────────────────
window.openImgPopup = function (productId) {
  const imgs = productImages
    .filter((i) => i.product_id === productId)
    .map((i) => i.url);
  if (imgs.length) ImgPopup.open(imgs, 0);
};

// ── Open / Close stock modal ─────────────────────────────────
window.openStockModal = function (productId) {
  const parent = products.find((p) => p.product_id === productId);
  if (!parent) return;

  // determine SKUs to show in matrix
  // sort by product_id ASC (= ลำดับที่สร้าง: S/M/L/XL/2XL ตามที่กรอกใน product-form)
  const kids = products
    .filter((p) => p.parent_product_id === productId)
    .sort((a, b) => a.product_id - b.product_id);
  modalParent = parent;
  modalRows = kids.length > 0 ? kids : [parent]; // variants OR singleton

  // snapshot original values for change detection
  modalOriginal = {};
  modalRows.forEach((sku) => {
    warehouses.forEach((w) => {
      const key = `${sku.product_id}-${w.warehouse_id}`;
      modalOriginal[key] = initMap[key]?.qty ?? "";
    });
  });

  // populate modal
  document.getElementById("simTitle").textContent =
    `ตั้ง Stock เริ่มต้น: ${parent.product_name}`;
  document.getElementById("simSubtitle").textContent = buildMatrixSubtitle(
    modalRows,
    warehouses,
  );

  renderMatrix({
    parent,
    rows: modalRows,
    warehouses,
    initMap,
  });

  updateChangedBadge();
  document.getElementById("simOverlay").classList.add("open");
  document.getElementById("simModal").classList.add("open");
  document.addEventListener("keydown", modalKeyHandler);
};

window.closeStockModal = async function (e) {
  // ถ้า click ที่ overlay (e exists) แต่มีค่าเปลี่ยน → ขอ confirm
  if (e && hasModalChanges()) {
    const ok = await ConfirmModal.open({
      title: "ออกโดยไม่บันทึก?",
      message: "มีการเปลี่ยนแปลงที่ยังไม่บันทึก ต้องการปิดหรือไม่?",
      icon: "⚠️",
      okText: "ปิดเลย",
      cancelText: "ทำต่อ",
      tone: "warning",
    });
    if (!ok) return;
  }
  document.getElementById("simOverlay").classList.remove("open");
  document.getElementById("simModal").classList.remove("open");
  document.removeEventListener("keydown", modalKeyHandler);
  modalParent = null;
  modalRows = [];
  modalOriginal = {};
};

function modalKeyHandler(e) {
  if (e.key === "Escape") window.closeStockModal();
  else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    window.saveStockModal();
  }
}

// ── Track changes inside modal ───────────────────────────────
window.onMatrixInput = function (input) {
  const key = input.dataset.key; // `${productId}-${whId}`
  const val = input.value === "" ? "" : parseFloat(input.value);
  const orig = modalOriginal[key];
  const changed = val !== orig && !(val === "" && (orig === "" || orig == null));

  input.classList.toggle("changed", changed);
  input.classList.toggle("has-value", input.value !== "" && !changed);
  updateRowSums();
  updateChangedBadge();
};

function updateRowSums() {
  // update Σ row at bottom of matrix
  warehouses.forEach((w) => {
    let sum = 0;
    let hasAny = false;
    modalRows.forEach((sku) => {
      const inp = document.getElementById(
        `sim-inp-${sku.product_id}-${w.warehouse_id}`,
      );
      if (inp && inp.value !== "") {
        sum += parseFloat(inp.value) || 0;
        hasAny = true;
      }
    });
    const cell = document.getElementById(`sim-sum-${w.warehouse_id}`);
    if (cell) cell.textContent = hasAny ? formatNum(sum) : "—";
  });
}

function hasModalChanges() {
  const inputs = document.querySelectorAll(".sim-qty-input");
  for (const inp of inputs) {
    if (inp.classList.contains("changed")) return true;
  }
  return false;
}

function getModalChanges() {
  const changes = [];
  document.querySelectorAll(".sim-qty-input.changed").forEach((inp) => {
    const [productId, whId] = inp.dataset.key.split("-").map((n) => parseInt(n));
    const val = inp.value === "" ? null : parseFloat(inp.value);
    changes.push({ productId, whId, qty: val });
  });
  return changes;
}

function updateChangedBadge() {
  const count = document.querySelectorAll(".sim-qty-input.changed").length;
  const badge = document.getElementById("simChangedBadge");
  const btn = document.getElementById("simSaveBtn");
  if (count === 0) {
    badge.textContent = "";
    btn.disabled = true;
    btn.style.opacity = "0.55";
    btn.style.cursor = "not-allowed";
  } else {
    badge.textContent = `🟡 มีการเปลี่ยนแปลง ${count} ช่อง`;
    btn.disabled = false;
    btn.style.opacity = "";
    btn.style.cursor = "";
  }
}

// ── Save modal ───────────────────────────────────────────────
window.saveStockModal = async function () {
  const changes = getModalChanges();
  if (changes.length === 0) {
    showToast("ไม่มีการเปลี่ยนแปลง", "warning");
    return;
  }

  showLoading(true);
  let saved = 0,
    failed = 0;
  try {
    for (const { productId, whId, qty } of changes) {
      const key = `${productId}-${whId}`;
      const existing = initMap[key];
      try {
        // ลบของเดิมก่อน (ถ้ามี) แล้วสร้างใหม่ — ยกเว้นกรณี clear ค่า (qty == null) ก็แค่ลบ
        if (existing) await deleteStockInit(existing.movement_id);
        if (qty != null) await createStockInit(productId, whId, qty);
        saved++;
      } catch (err) {
        console.error("save fail", key, err);
        failed++;
      }
    }
    await loadData();
    if (failed === 0) {
      showToast(`บันทึกสำเร็จ ${saved} ช่อง`, "success");
      window.closeStockModal();
    } else {
      showToast(`บันทึก ${saved} สำเร็จ · ${failed} ล้มเหลว`, "error");
    }
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

// ── Utils ────────────────────────────────────────────────────
function formatNum(n) {
  return parseFloat(n || 0).toLocaleString("th-TH", {
    maximumFractionDigits: 2,
  });
}

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

// ── Boot ─────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", initPage);
