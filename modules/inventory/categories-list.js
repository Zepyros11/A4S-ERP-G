/* =====================================================
   categories-list.js
   Page Controller — Categories List
===================================================== */

import {
  fetchCategories,
  fetchProductsByCategory,
  createCategory,
  updateCategory,
  removeCategory,
} from "./categories-api.js";

import { openCategoryModal } from "./categories-form.js";
import { renderCategoriesTable } from "./categories-table.js";

/* ================================
   STATE
================================ */

let categories = [];
let products = [];
let currentSort = { field: "", asc: true };

/* ================================
   INIT
================================ */

window.addEventListener("DOMContentLoaded", initPage);

async function initPage() {
  await loadFormModal();
  await loadData();
  bindEvents();
}

/* โหลด categories-form.html เข้า DOM */
async function loadFormModal() {
  const container = document.getElementById("categoryFormContainer");
  if (!container) return;

  const res = await fetch("./categories-form.html");
  const html = await res.text();
  container.innerHTML = html;
}

/* ================================
   LOAD DATA
================================ */

async function loadData() {
  showLoading(true);
  try {
    const [cats, prods] = await Promise.all([
      fetchCategories(),
      fetchProductsByCategory(),
    ]);

    categories = cats || [];
    products = prods || [];

    renderTable(categories);
    renderStats();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

/* ================================
   RENDER TABLE
================================ */

function renderTable(list) {
  renderCategoriesTable(list, products);
}

/* ================================
   RENDER STATS
================================ */

function renderStats() {
  const total = categories.length;
  const withProduct = categories.filter((c) =>
    products.some((p) => p.category_id === c.category_id),
  ).length;

  document.getElementById("statTotalCat").textContent = total;
  document.getElementById("statCatWithProduct").textContent = withProduct;
  document.getElementById("statCatEmpty").textContent = total - withProduct;
  document.getElementById("statTotalProduct").textContent = products.length;
}

/* ================================
   FILTER + SEARCH
================================ */

function renderFiltered() {
  const q = document.getElementById("searchInput")?.value.toLowerCase() || "";
  const filter = document.getElementById("filterStatus")?.value || "";

  const list = categories.filter((c) => {
    const text = (c.category_name + " " + (c.description || "")).toLowerCase();
    const count = products.filter(
      (p) => p.category_id === c.category_id,
    ).length;

    if (q && !text.includes(q)) return false;
    if (filter === "with" && count === 0) return false;
    if (filter === "empty" && count > 0) return false;

    return true;
  });

  renderTable(list);
}

/* ================================
   SORT
================================ */

window.sortTable = function (field) {
  currentSort.asc = currentSort.field === field ? !currentSort.asc : true;
  currentSort.field = field;

  const sorted = [...categories].sort((a, b) => {
    const valA =
      field === "product_count"
        ? products.filter((p) => p.category_id === a.category_id).length
        : a[field] || "";
    const valB =
      field === "product_count"
        ? products.filter((p) => p.category_id === b.category_id).length
        : b[field] || "";

    if (valA < valB) return currentSort.asc ? -1 : 1;
    if (valA > valB) return currentSort.asc ? 1 : -1;
    return 0;
  });

  renderTable(sorted);
};

/* ================================
   EDIT / DELETE
================================ */

window.editCategory = function (id) {
  openCategoryModal(categories.find((c) => c.category_id === id));
};

window.deleteCategory = async function (id, name) {
  const count = products.filter((p) => p.category_id === id).length;

  if (count > 0) {
    showToast(`ไม่สามารถลบได้ มีสินค้า ${count} รายการในหมวดนี้`, "error");
    return;
  }

  DeleteModal.open(`ลบหมวดหมู่ "${name}" ?`, async () => {
    showLoading(true);
    try {
      await removeCategory(id);
      showToast("ลบหมวดหมู่แล้ว");
      await loadData();
    } catch (e) {
      showToast("ลบไม่ได้: " + e.message, "error");
    }
    showLoading(false);
  });
};
/* ================================
   SAVE EVENT (จาก categories-form.js)
================================ */

window.addEventListener("category-saved", async (e) => {
  const { category_id, ...data } = e.detail; // แยก id ออกจาก payload

  showLoading(true);
  try {
    if (category_id) {
      await updateCategory(category_id, data); // ส่งเฉพาะ data
      showToast("✅ แก้ไขหมวดหมู่สำเร็จ!");
    } else {
      await createCategory(data); // ส่งเฉพาะ data ไม่มี id
      showToast("✅ เพิ่มหมวดหมู่สำเร็จ!");
    }
    await loadData();
  } catch (err) {
    showToast("บันทึกไม่ได้: " + err.message, "error");
  }
  showLoading(false);
});

/* ================================
   BIND EVENTS
================================ */

function bindEvents() {
  document
    .getElementById("btnAddCategory")
    ?.addEventListener("click", () => openCategoryModal());

  document
    .getElementById("searchInput")
    ?.addEventListener("input", renderFiltered);

  document
    .getElementById("filterStatus")
    ?.addEventListener("change", renderFiltered);
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
