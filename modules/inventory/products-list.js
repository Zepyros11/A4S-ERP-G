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
  updateProductStockAlert,
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
// default = product_id ASC → ตามลำดับสร้าง (S/M/L/XL/2XL ตามที่กรอก)
let sortKey = "product_id";
let sortAsc = true;

// parents ที่ user ขยายอยู่ (default = ย่อทั้งหมด · persist ระหว่าง re-render)
const expandedParents = new Set();

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

  // group-aware filter: parent match → โชว์พร้อม variants ทั้งหมด
  const parents = allProducts.filter((p) => !p.parent_product_id);
  const childrenByParent = {};
  allProducts
    .filter((p) => p.parent_product_id)
    .forEach((c) => {
      (childrenByParent[c.parent_product_id] ||= []).push(c);
    });

  const matchProd = (p) => {
    const matchSearch =
      !search || (p.product_name || "").toLowerCase().includes(search);
    const matchCat = !catId || String(p.category_id) === catId;
    const matchStatus = !status || String(p.is_active) === status;
    return matchSearch && matchCat && matchStatus;
  };

  const filtered = [];
  parents.forEach((p) => {
    if (matchProd(p)) {
      filtered.push(p);
      (childrenByParent[p.product_id] || []).forEach((k) => filtered.push(k));
    }
  });

  renderProductsTable(
    filtered,
    categories,
    productImages,
    sortKey,
    sortAsc,
    expandedParents,
  );
}

function updateStatusCards() {
  // ชุดสินค้า = parents/singletons (top-level, ไม่มี parent_product_id)
  // ตัวเลือก (SKU ขายจริง) = variants + singletons — ไม่นับ parent ที่เป็น umbrella ของ variants
  const parentIdsWithKids = new Set(
    allProducts
      .filter((p) => p.parent_product_id)
      .map((c) => c.parent_product_id),
  );
  const isSku = (p) =>
    p.parent_product_id || !parentIdsWithKids.has(p.product_id);

  const products = allProducts.filter((p) => !p.parent_product_id).length;
  const skus = allProducts.filter(isSku).length;
  const activeSkus = allProducts.filter((p) => isSku(p) && p.is_active).length;

  document.getElementById("cardProducts").textContent = products;
  document.getElementById("cardSkus").textContent = skus;
  document.getElementById("cardActive").textContent = activeSkus;
  document.getElementById("cardInactive").textContent = skus - activeSkus;
}

// ── COLLAPSE / EXPAND VARIANT GROUP ──────────────────────
// default = collapsed · expandedParents เก็บเฉพาะที่ user กดขยายไว้
window.toggleVariantGroup = function (parentId) {
  const willExpand = !expandedParents.has(parentId);
  if (willExpand) expandedParents.add(parentId);
  else expandedParents.delete(parentId);

  const willCollapse = !willExpand;
  document
    .querySelector(`.prod-collapse-btn[data-parent="${parentId}"]`)
    ?.classList.toggle("collapsed", willCollapse);
  document
    .querySelectorAll(`tr[data-parent-id="${parentId}"]`)
    .forEach((r) => r.classList.toggle("row-collapsed", willCollapse));
};

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
async function deleteProductCascade(productId) {
  // หา variants ที่เป็น children ของ parent นี้
  const kids = allProducts.filter((p) => p.parent_product_id === productId);
  // ลบ children's units/images/row ก่อน (กัน orphan ใน product_units/product_images)
  for (const k of kids) {
    await removeProductUnits(k.product_id).catch(() => {});
    await removeProductImages(k.product_id).catch(() => {});
    await removeProduct(k.product_id);
  }
  // ลบ parent (หรือ singleton) — DB จะ cascade ลบ variants ที่เหลือผ่าน FK ด้วย
  await removeProductUnits(productId).catch(() => {});
  await removeProductImages(productId).catch(() => {});
  await removeProduct(productId);
}

window.deleteProduct = function (productId) {
  const prod = allProducts.find((p) => p.product_id === productId);
  if (!prod) return;

  const kids = allProducts.filter((p) => p.parent_product_id === productId);
  const msg = kids.length
    ? `ต้องการลบ "${prod.product_name}" พร้อมตัวเลือก ${kids.length} รายการ หรือไม่ ?`
    : `ต้องการลบสินค้า "${prod.product_name}" หรือไม่ ?`;

  DeleteModal.open(msg, async () => {
    showLoading(true);
    try {
      await deleteProductCascade(productId);
      showToast("ลบสินค้าแล้ว", "success");
      await loadData();
    } catch (e) {
      showToast("ลบสินค้าไม่ได้: " + e.message, "error");
    }
    showLoading(false);
  });
};

// ── BULK DELETE ───────────────────────────────────────────
function getSelectedProducts() {
  return Array.from(document.querySelectorAll(".row-check:checked")).map((c) =>
    parseInt(c.value),
  );
}

window.updateDeleteButton = function () {
  const ids = getSelectedProducts();
  const has = ids.length > 0;
  document.getElementById("btnDeleteSelected").style.display = has
    ? "inline-flex"
    : "none";

  const alertBtn = document.getElementById("btnToggleStockAlert");
  if (alertBtn) {
    alertBtn.style.display = has ? "inline-flex" : "none";
    if (has) {
      // ปุ่มสลับตามสถานะ: ถ้ามีอย่างน้อย 1 ตัวที่ยัง "เปิดแจ้งเตือน" → action = ปิด
      // ถ้าทุกตัวที่เลือก "ปิดแจ้งเตือน" อยู่แล้ว → action = เปิด
      const sel = ids
        .map((id) => allProducts.find((p) => p.product_id === id))
        .filter(Boolean);
      const allDisabled =
        sel.length > 0 && sel.every((p) => p.disable_stock_alert);
      alertBtn.textContent = allDisabled
        ? "🔔 เปิดแจ้งเตือนสินค้าหมด"
        : "🔕 ปิดแจ้งเตือนสินค้าหมด";
      alertBtn.dataset.action = allDisabled ? "enable" : "disable";
    }
  }
};

window.toggleAllCheckbox = function (el) {
  document
    .querySelectorAll(".row-check")
    .forEach((c) => (c.checked = el.checked));
  window.updateDeleteButton();
};

// ── BULK TOGGLE STOCK ALERT ───────────────────────────────
window.bulkToggleStockAlert = async function () {
  const ids = getSelectedProducts();
  if (!ids.length) return;
  const action = document.getElementById("btnToggleStockAlert")?.dataset
    .action || "disable";
  const disable = action === "disable";

  // ขยายไปยัง variants — เลือก parent → cascade ถึงลูกทั้งชุด
  const idSet = new Set(ids);
  ids.forEach((id) => {
    allProducts
      .filter((p) => p.parent_product_id === id)
      .forEach((k) => idSet.add(k.product_id));
  });
  const targetIds = [...idSet];

  const ok = await ConfirmModal.open({
    title: disable ? "ปิดการแจ้งเตือน" : "เปิดการแจ้งเตือน",
    message: disable
      ? `ปิดการแจ้งเตือน "สินค้าหมด" สำหรับ ${targetIds.length} รายการ ?`
      : `เปิดการแจ้งเตือน "สินค้าหมด" สำหรับ ${targetIds.length} รายการ ?`,
    icon: disable ? "🔕" : "🔔",
    okText: disable ? "ปิดแจ้งเตือน" : "เปิดแจ้งเตือน",
    tone: disable ? "warning" : "success",
  });
  if (!ok) return;

  showLoading(true);
  try {
    await Promise.all(
      targetIds.map((id) =>
        updateProductStockAlert(id, disable).then(() => {
          const p = allProducts.find((x) => x.product_id === id);
          if (p) p.disable_stock_alert = disable;
        }),
      ),
    );
    filterTable();
    window.updateDeleteButton();
    showToast(
      `${disable ? "ปิด" : "เปิด"}การแจ้งเตือนแล้ว ${targetIds.length} รายการ`,
      "success",
    );
  } catch (e) {
    showToast("อัปเดตไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

window.deleteSelectedProducts = async function () {
  const ids = getSelectedProducts();
  if (!ids.length) return;

  // ถ้าเลือกทั้ง parent และ child ของ parent นั้น → ลบ parent แล้ว cascade ครอบคลุม child
  const idSet = new Set(ids);
  const toDelete = ids.filter((id) => {
    const prod = allProducts.find((p) => p.product_id === id);
    if (!prod) return false;
    if (prod.parent_product_id && idSet.has(prod.parent_product_id))
      return false;
    return true;
  });

  DeleteModal.open(
    `ต้องการลบสินค้า ${ids.length} รายการ หรือไม่ ?`,
    async () => {
      showLoading(true);
      try {
        for (const id of toDelete) {
          await deleteProductCascade(id);
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
// parent → cascade ไปทุก variants · child → เฉพาะตัวเอง
window.toggleProductActive = async function (productId, el) {
  const isActive = el.checked;
  const prod = allProducts.find((p) => p.product_id === productId);
  if (!prod) return;
  const kids = allProducts.filter((p) => p.parent_product_id === productId);

  try {
    await updateProductStatus(productId, isActive);
    prod.is_active = isActive;

    if (kids.length) {
      // cascade — update children พร้อมกัน
      await Promise.all(
        kids.map((k) =>
          updateProductStatus(k.product_id, isActive).then(() => {
            k.is_active = isActive;
          }),
        ),
      );
      // re-render เพื่อ sync child checkboxes
      filterTable();
    }
    updateStatusCards();
    showToast(
      kids.length
        ? `${isActive ? "เปิด" : "ปิด"}ใช้งานพร้อมตัวเลือก ${kids.length} รายการ`
        : isActive
          ? "เปิดใช้งานสินค้าแล้ว"
          : "ปิดใช้งานสินค้าแล้ว",
      "success",
    );
  } catch (e) {
    showToast("อัปเดตสถานะไม่สำเร็จ", "error");
    el.checked = !isActive;
  }
};

// ── TOGGLE DISABLE STOCK ALERT ────────────────────────────
// parent → cascade ไปทุก variants · child/singleton → เฉพาะตัวเอง
window.toggleStockAlertDisabled = async function (productId, el) {
  const disabled = el.checked;
  const prod = allProducts.find((p) => p.product_id === productId);
  if (!prod) return;
  const kids = allProducts.filter((p) => p.parent_product_id === productId);

  try {
    await updateProductStockAlert(productId, disabled);
    prod.disable_stock_alert = disabled;

    if (kids.length) {
      await Promise.all(
        kids.map((k) =>
          updateProductStockAlert(k.product_id, disabled).then(() => {
            k.disable_stock_alert = disabled;
          }),
        ),
      );
      filterTable();
    }
    showToast(
      kids.length
        ? `${disabled ? "ปิด" : "เปิด"}แจ้งเตือนพร้อมตัวเลือก ${kids.length} รายการ`
        : disabled
          ? "ปิดการแจ้งเตือนสินค้าหมดแล้ว"
          : "เปิดการแจ้งเตือนสินค้าหมดแล้ว",
      "success",
    );
  } catch (e) {
    showToast("อัปเดตการแจ้งเตือนไม่สำเร็จ", "error");
    el.checked = !disabled;
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
    // cascade ไปยัง variants (ถ้าเป็น parent) — variants ใช้หมวดหมู่ร่วมกับ parent
    const kids = allProducts.filter((p) => p.parent_product_id === productId);
    if (kids.length) {
      await Promise.all(
        kids.map((k) => updateProductCategory(k.product_id, categoryId)),
      );
    }
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
  const prod = allProducts.find((p) => p.product_id === productId);
  if (!prod) return;

  // ถ้าเป็น parent ของ variants → ไปหน้า form (แก้รวมทั้งชุด)
  const isVariantParent = allProducts.some(
    (p) => p.parent_product_id === productId,
  );
  if (isVariantParent) {
    window.location.href = `./product-form.html?id=${productId}`;
    return;
  }

  // Singleton → ใช้ modal เดิม
  epProductId = productId;
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
