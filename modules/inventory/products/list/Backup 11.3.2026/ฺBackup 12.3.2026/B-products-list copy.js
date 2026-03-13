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
} from "../../products-api.js";
import { renderProductsTable } from "../../products-table.js";

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

  openDeleteModal(
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

  openDeleteModal(
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

window.openLightbox = function (productId, startIndex = 0) {
  const prod = allProducts.find((p) => p.product_id === productId);
  const imgs = productImages
    .filter((i) => i.product_id === productId && i.url)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  if (!imgs.length) return;
  lbImages = imgs.map((i) => ({ url: i.url, alt: prod?.product_name || "" }));
  lbIndex = Math.min(startIndex, lbImages.length - 1);
  renderLightbox();
  document.getElementById("lightboxOverlay").classList.add("open");
  document.addEventListener("keydown", lightboxKeyHandler);
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

// ── EDIT PANEL ────────────────────────────────────────────
window.openEditPanel = function (productId) {
  const p = allProducts.find((x) => x.product_id === productId);
  if (!p) return;
  document.getElementById("epProductId").value = p.product_id;
  document.getElementById("epName").value = p.product_name || "";
  document.getElementById("epCost").value = p.cost_price || 0;
  document.getElementById("epSale").value = p.sale_price || 0;
  epImagesState = [];
  const imgs = productImages
    .filter((i) => i.product_id === productId)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  imgs.forEach((i) => epImagesState.push(i.url));
  renderEpImages();
  document.getElementById("editPanel").classList.add("open");
};

window.closeEditPanel = function () {
  document.getElementById("editPanel").classList.remove("open");
};

window.saveEditPanel = async function () {
  const id = document.getElementById("epProductId").value;
  const name = document.getElementById("epName").value.trim();
  const cost = document.getElementById("epCost").value;
  const sale = document.getElementById("epSale").value;
  if (!name) {
    showToast("กรุณากรอกชื่อสินค้า", "error");
    return;
  }

  showLoading(true);
  try {
    await updateProduct(id, {
      product_name: name,
      cost_price: cost,
      sale_price: sale,
    });
    await removeProductImages(id).catch(() => {});

    for (let idx = 0; idx < epImagesState.length; idx++) {
      const img = epImagesState[idx];
      if (!img) continue;
      if (typeof img === "string") {
        await createProductImage({
          product_id: id,
          url: img,
          sort_order: idx,
        }).catch(() => {});
      } else {
        try {
          const publicUrl = await uploadProductImage(id, img, idx);
          await createProductImage({
            product_id: id,
            url: publicUrl,
            sort_order: idx,
          });
        } catch (e) {
          showToast(`⚠️ อัปโหลดรูป slot ${idx + 1} ไม่สำเร็จ`, "error");
        }
      }
    }
    showToast("บันทึกแล้ว", "success");
    window.closeEditPanel();
    await loadData();
  } catch (e) {
    showToast("บันทึกไม่ได้: " + e.message, "error");
  }
  showLoading(false);
};

function handleEpUpload(e) {
  const files = Array.from(e.target.files);
  let index = parseInt(e.target.dataset.index || 0);
  files.forEach((file) => {
    if (epImagesState.length < EP_IMG_MAX) {
      epImagesState.splice(index, 0, file);
      index++;
    }
  });
  epImagesState = epImagesState.slice(0, EP_IMG_MAX);
  renderEpImages();
  e.target.value = "";
}

window.removeEpImage = function (index) {
  epImagesState.splice(index, 1);
  renderEpImages();
};

function renderEpImages() {
  for (let i = 0; i < EP_IMG_MAX; i++) {
    const slot = document.querySelector(`.ep-slot[data-index="${i}"]`);
    if (!slot) continue;
    const img = epImagesState[i];
    slot.onclick = null;
    if (img) {
      const url = typeof img === "string" ? img : URL.createObjectURL(img);
      slot.innerHTML = `
        <img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:6px;"
          onerror="this.parentElement.innerHTML='<div class=\\'ep-slot-plus\\'>📷</div>'">
        <button class="ep-slot-remove" onclick="window.removeEpImage(${i})">×</button>`;
    } else {
      slot.innerHTML = `<div class="ep-slot-plus">+</div>`;
      slot.onclick = () => {
        const upload = document.getElementById("epUpload");
        upload.dataset.index = i;
        upload.click();
      };
    }
  }
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
