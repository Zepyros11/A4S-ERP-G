/* ============================================================
   products-list.js — Controller for Products List page
   ============================================================ */

import {
  fetchProducts,
  fetchCategories,
  fetchProductUnits,
  fetchProductImages,
  removeProduct,
  removeProductUnits,
  updateProductStatus,
  updateProductCategory,
  removeProductImages,
  createProductImage,
  uploadProductImage,
  updateProduct,
} from "./products-api.js";
import { renderProductsTable } from "./products-table.js";

// ── STATE ──────────────────────────────────────────────────
let allProducts = [];
let categories = [];
let units = [];
let productImages = [];
let sortKey = "product_code";
let sortAsc = true;

const EP_IMG_MAX = 5;
let epImagesState = [];

// ── INIT ──────────────────────────────────────────────────
async function initPage() {
  await loadData();
  bindEvents();

  // ฟัง CustomEvent จาก product-form (ถ้า navigate กลับมา)
  window.addEventListener("product-saved", () => loadData());
}

async function loadData() {
  showLoading(true);
  try {
    const [prods, cats, uts, imgs] = await Promise.all([
      fetchProducts(),
      fetchCategories(),
      fetchProductUnits(),
      fetchProductImages(),
    ]);
    allProducts = prods || [];
    categories = cats || [];
    units = uts || [];
    productImages = imgs || [];

    populateFilters();
    updateStatusCards();
    filterTable();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

function bindEvents() {
  document
    .getElementById("searchInput")
    ?.addEventListener("input", filterTable);
  document
    .getElementById("filterCategory")
    ?.addEventListener("change", filterTable);
  document
    .getElementById("filterStatus")
    ?.addEventListener("change", filterTable);

  // epUpload
  const epUpload = document.getElementById("epUpload");
  if (epUpload) epUpload.addEventListener("change", handleEpUpload);
}

// ── FILTERS ───────────────────────────────────────────────
function populateFilters() {
  const catSel = document.getElementById("filterCategory");
  if (!catSel) return;
  catSel.innerHTML = '<option value="">⚪ ทุกหมวดหมู่</option>';
  categories.forEach((c) =>
    catSel.insertAdjacentHTML(
      "beforeend",
      `<option value="${c.category_id}">${c.icon || ""} ${c.category_name}</option>`,
    ),
  );
}

function filterTable() {
  const search =
    document.getElementById("searchInput")?.value.toLowerCase() || "";
  const catId = document.getElementById("filterCategory")?.value || "";
  const status = document.getElementById("filterStatus")?.value || "";

  const filtered = allProducts.filter((p) => {
    const matchSearch =
      !search ||
      (p.product_name || "").toLowerCase().includes(search) ||
      (p.product_code || "").toLowerCase().includes(search);
    const matchCat = !catId || String(p.category_id) === catId;
    const matchStatus = !status || String(p.is_active) === status;
    return matchSearch && matchCat && matchStatus;
  });

  renderProductsTable(filtered, categories, productImages, sortKey, sortAsc);
}

function updateStatusCards() {
  const total = allProducts.length;
  const active = allProducts.filter((p) => p.is_active).length;
  document.getElementById("cardTotal").textContent = total;
  document.getElementById("cardActive").textContent = active;
  document.getElementById("cardInactive").textContent = total - active;
}

// ── SORT ──────────────────────────────────────────────────
window.sortTable = function (key) {
  if (sortKey === key) sortAsc = !sortAsc;
  else {
    sortKey = key;
    sortAsc = true;
  }
  filterTable();
};

// ── DELETE ────────────────────────────────────────────────
window.deleteProduct = function (productId) {
  const prod = allProducts.find((p) => p.product_id === productId);
  if (!prod) return;

  DeleteModal.open(
    `ต้องการลบสินค้า "${prod.product_name}" หรือไม่ ?`,
    async () => {
      showLoading(true);
      try {
        await removeProductUnits(productId).catch(() => {});
        await removeProduct(productId);
        showToast("ลบสินค้าแล้ว", "success");
        await loadData();
      } catch (e) {
        showToast("ลบสินค้าไม่ได้: " + e.message, "error");
      }
      showLoading(false);
    },
  );
};

// ── BULK DELETE ───────────────────────────────────────────
function getSelectedProducts() {
  return Array.from(document.querySelectorAll(".row-check:checked")).map((c) =>
    parseInt(c.value),
  );
}

window.updateDeleteButton = function () {
  const btn = document.getElementById("btnDeleteSelected");
  btn.style.display = getSelectedProducts().length ? "inline-flex" : "none";
};

window.toggleAllCheckbox = function (el) {
  document
    .querySelectorAll(".row-check")
    .forEach((c) => (c.checked = el.checked));
  window.updateDeleteButton();
};

window.deleteSelectedProducts = async function () {
  const ids = getSelectedProducts();
  if (!ids.length) return;

  DeleteModal.open(
    `ต้องการลบสินค้า ${ids.length} รายการ หรือไม่ ?`,
    async () => {
      showLoading(true);
      try {
        for (const id of ids) {
          await removeProductUnits(id).catch(() => {});
          await removeProduct(id);
        }
        showToast("ลบสินค้าที่เลือกแล้ว", "success");
        await loadData();
      } catch (e) {
        showToast("ลบสินค้าไม่สำเร็จ: " + e.message, "error");
      }
      showLoading(false);
    },
  );
};

// ── TOGGLE STATUS ─────────────────────────────────────────
window.toggleProductActive = async function (productId, el) {
  const isActive = el.checked;
  try {
    await updateProductStatus(productId, isActive);
    const prod = allProducts.find((p) => p.product_id === productId);
    if (prod) prod.is_active = isActive;
    updateStatusCards();
    showToast(
      isActive ? "เปิดใช้งานสินค้าแล้ว" : "ปิดใช้งานสินค้าแล้ว",
      "success",
    );
  } catch (e) {
    showToast("อัปเดตสถานะไม่สำเร็จ", "error");
    el.checked = !isActive;
  }
};

// ── CATEGORY PICKER ───────────────────────────────────────
window.openCategoryPicker = function (productId, event) {
  event.stopPropagation();
  const picker = document.getElementById("catPicker");
  picker.innerHTML = categories
    .map(
      (
        c,
      ) => `<div class="cat-picker-item" onclick="window.changeProductCategory(${productId}, ${c.category_id})">
        <span>${c.icon || "📦"}</span><span>${c.category_name}</span></div>`,
    )
    .join("");
  picker.style.display = "block";
  picker.style.top = event.pageY + "px";
  picker.style.left = event.pageX + "px";
  document.addEventListener("click", closeCategoryPicker);
};

function closeCategoryPicker(e) {
  const picker = document.getElementById("catPicker");
  if (!picker.contains(e.target)) {
    picker.style.display = "none";
    document.removeEventListener("click", closeCategoryPicker);
  }
}

window.changeProductCategory = async function (productId, categoryId) {
  try {
    await updateProductCategory(productId, categoryId);
    document.getElementById("catPicker").style.display = "none";
    showToast("เปลี่ยนหมวดหมู่แล้ว", "success");
    await loadData();
  } catch (e) {
    showToast("เปลี่ยนหมวดหมู่ไม่สำเร็จ", "error");
  }
};

// ── LIGHTBOX ──────────────────────────────────────────────
let lbImages = [],
  lbIndex = 0;

window.openLightbox = function (productId) {
  const imgs = productImages
    .filter((i) => i.product_id === productId)
    .map((i) => i.url);
  if (imgs.length) ImgPopup.open(imgs, 0);
};

window.closeLightbox = function () {
  document.getElementById("lightboxOverlay").classList.remove("open");
  document.removeEventListener("keydown", lightboxKeyHandler);
};

window.closeLightboxOnBg = function (e) {
  if (e.target === document.getElementById("lightboxOverlay"))
    window.closeLightbox();
};

function lightboxKeyHandler(e) {
  if (e.key === "ArrowLeft") lightboxNav(-1);
  if (e.key === "ArrowRight") lightboxNav(1);
  if (e.key === "Escape") window.closeLightbox();
}

window.lightboxNav = function (dir) {
  const next = (lbIndex + dir + lbImages.length) % lbImages.length;
  const img = document.getElementById("lightboxImg");
  img.classList.add("fading");
  setTimeout(() => {
    lbIndex = next;
    renderLightbox();
    img.classList.remove("fading");
  }, 140);
};

window.lightboxGoTo = function (idx) {
  if (idx === lbIndex) return;
  lbIndex = idx;
  renderLightbox();
};

function renderLightbox() {
  const cur = lbImages[lbIndex];
  const img = document.getElementById("lightboxImg");
  img.src = cur.url;
  img.alt = cur.alt;
  document.getElementById("lightboxTitle").textContent = cur.alt;
  document.getElementById("lightboxCounter").textContent =
    lbImages.length > 1 ? `${lbIndex + 1} / ${lbImages.length}` : "";
  const prev = document.getElementById("lbPrev");
  const next = document.getElementById("lbNext");
  if (lbImages.length <= 1) {
    prev.classList.add("hidden");
    next.classList.add("hidden");
  } else {
    prev.classList.remove("hidden");
    next.classList.remove("hidden");
  }
  const thumbWrap = document.getElementById("lightboxThumbs");
  thumbWrap.innerHTML =
    lbImages.length > 1
      ? lbImages
          .map(
            (im, i) =>
              `<div class="lightbox-thumb ${i === lbIndex ? "active" : ""}" onclick="window.lightboxGoTo(${i})">
            <img src="${im.url}" alt="${im.alt}"></div>`,
          )
          .join("")
      : "";
}

// ── UTILS ─────────────────────────────────────────────────
function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove("show"), 3000);
}

function showLoading(show) {
  document.getElementById("loadingOverlay").classList.toggle("show", show);
}

// ── START ─────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPage);
} else {
  initPage();
}
// ── EDIT MODAL ────────────────────────────────────────────
let epProductId = null;
let epSlotTarget = null;

window.openEditPanel = function (productId) {
  epProductId = productId;
  const prod = allProducts.find((p) => p.product_id === productId);
  if (!prod) return;

  document.getElementById("epName").value = prod.product_name || "";
  document.getElementById("epCost").value = prod.cost_price || "";
  document.getElementById("epSale").value = prod.sale_price || "";

  // โหลดรูปภาพ
  epImagesState = productImages
    .filter((i) => i.product_id === productId)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((i) => ({ url: i.url, file: null, imageId: i.image_id }));

  renderEpGrid();
  document.getElementById("epOverlay").classList.add("open");
  document.getElementById("epModal").classList.add("open");
};

window.closeEditPanel = function () {
  document.getElementById("epOverlay").classList.remove("open");
  document.getElementById("epModal").classList.remove("open");
  epProductId = null;
  epImagesState = [];
};

function renderEpGrid() {
  const grid = document.getElementById("epImageGrid");
  const slots = [];
  for (let i = 0; i < EP_IMG_MAX; i++) {
    const img = epImagesState[i];
    if (img) {
      slots.push(`
        <div class="ep-slot">
          <img src="${img.url}" style="width:100%;height:100%;object-fit:cover;border-radius:6px">
          <button class="ep-slot-remove" onclick="window.epRemoveSlot(${i})">✕</button>
        </div>`);
    } else {
      slots.push(`
        <div class="ep-slot" onclick="window.epPickSlot(${i})">
          <span class="ep-slot-plus">＋</span>
        </div>`);
    }
  }
  grid.innerHTML = slots.join("");
}

window.epPickSlot = function (idx) {
  epSlotTarget = idx;
  document.getElementById("epUpload").value = "";
  document.getElementById("epUpload").click();
};

window.epRemoveSlot = function (idx) {
  epImagesState.splice(idx, 1);
  renderEpGrid();
};

async function handleEpUpload(e) {
  const file = e.target.files[0];
  if (!file || epSlotTarget === null) return;
  const tempUrl = URL.createObjectURL(file);
  epImagesState[epSlotTarget] = { url: tempUrl, file, imageId: null };
  renderEpGrid();
}

window.saveEditPanel = async function () {
  if (!epProductId) return;
  const name = document.getElementById("epName").value.trim();
  const cost = parseFloat(document.getElementById("epCost").value) || 0;
  const sale = parseFloat(document.getElementById("epSale").value) || 0;
  if (!name) {
    showToast("กรุณากรอกชื่อสินค้า", "error");
    return;
  }

  showLoading(true);
  try {
    await updateProduct(epProductId, {
      product_name: name,
      cost_price: cost,
      sale_price: sale,
    });

    // อัปโหลดรูปใหม่ที่มี file
    for (let i = 0; i < epImagesState.length; i++) {
      const slot = epImagesState[i];
      if (slot.file) {
        const uploadedUrl = await uploadProductImage(epProductId, slot.file, i);
        epImagesState[i] = { url: uploadedUrl, file: null, imageId: null };
      }
    }

    // ลบรูปเดิมแล้ว insert ใหม่
    await removeProductImages(epProductId);
    for (let i = 0; i < epImagesState.length; i++) {
      await createProductImage({
        product_id: epProductId,
        url: epImagesState[i].url,
        sort_order: i,
      });
    }

    showToast("บันทึกสำเร็จ", "success");
    window.closeEditPanel();
    await loadData();
  } catch (err) {
    showToast("บันทึกไม่สำเร็จ: " + err.message, "error");
  }
  showLoading(false);
};
