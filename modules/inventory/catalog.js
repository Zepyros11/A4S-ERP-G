/* ============================================================
   catalog.js — Product Catalog (Sidebar + Grid)
   Left: category list · Right: search + sort + product cards
   ============================================================ */

import {
  fetchProducts,
  fetchCategories,
  fetchProductUnits,
  fetchProductImages,
} from "./products-api.js";

// ── STATE ─────────────────────────────────────────────────
const NO_IMAGE_SRC = "../../assets/images/NoImage.png";

let allProducts = [];
let categories = [];
let units = [];
let productImages = [];
let imagesByProduct = {};
let stockByProduct = {}; // product_id -> total signed qty (number)
let stockByProductWh = {}; // product_id -> { warehouse_id: qty }
let warehouses = [];

let activeCatId = "all"; // "all" | category_id
let activeFilter = "all"; // "all" | "instock" | "outstock"
let searchTerm = "";
let sortMode = "default";
let viewMode = localStorage.getItem("cat_view_mode") || "grid"; // "grid" | "list"

// ── INIT ──────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  loadAll();
});

function bindEvents() {
  document.getElementById("btnRefresh")?.addEventListener("click", loadAll);
  document.getElementById("catModalClose")?.addEventListener("click", closeModal);
  document.getElementById("catModalOv")?.addEventListener("click", closeModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  let searchTimer;
  document.getElementById("catSearch")?.addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchTerm = (e.target.value || "").toLowerCase().trim();
      renderGrid();
    }, 180);
  });

  document.getElementById("catSort")?.addEventListener("change", (e) => {
    sortMode = e.target.value;
    renderGrid();
  });

  // view mode toggle
  document.querySelectorAll(".cat-view-btn[data-view]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === viewMode);
    btn.addEventListener("click", () => {
      viewMode = btn.dataset.view;
      localStorage.setItem("cat_view_mode", viewMode);
      document.querySelectorAll(".cat-view-btn[data-view]").forEach((x) =>
        x.classList.toggle("active", x === btn)
      );
      renderGrid();
    });
  });
}

async function sbGet(path) {
  const url = localStorage.getItem("sb_url") || "";
  const key = localStorage.getItem("sb_key") || "";
  if (!url || !key) return [];
  try {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

async function loadAll() {
  showLoading(true);
  try {
    const [prods, cats, uts, imgs, mvs, whs] = await Promise.all([
      fetchProducts(),
      fetchCategories(),
      fetchProductUnits(),
      fetchProductImages(),
      sbGet("stock_movements?select=product_id,warehouse_id,movement_type,qty"),
      sbGet("warehouses?select=warehouse_id,warehouse_name,country,is_active"),
    ]);
    allProducts = prods || [];
    categories = (cats || [])
      .slice()
      .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999));
    units = uts || [];
    productImages = imgs || [];
    warehouses = whs || [];

    imagesByProduct = {};
    for (const im of productImages) {
      (imagesByProduct[im.product_id] ||= []).push(im);
    }
    for (const k in imagesByProduct) {
      imagesByProduct[k].sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
      );
    }

    // build stockByProduct (totals) + stockByProductWh (per-warehouse)
    // INIT/IN/ADJUST = +qty · OUT = -qty · INTERNAL = 0 (warehouse-to-warehouse transfer)
    stockByProduct = {};
    stockByProductWh = {};
    for (const m of (mvs || [])) {
      const q = +m.qty || 0;
      let signed = 0;
      switch (m.movement_type) {
        case "OUT":
          signed = -q;
          break;
        case "INTERNAL":
          signed = 0;
          break;
        case "INIT":
        case "IN":
        case "ADJUST":
        default:
          signed = q;
      }
      stockByProduct[m.product_id] = (stockByProduct[m.product_id] || 0) + signed;
      if (m.warehouse_id != null) {
        const bucket = (stockByProductWh[m.product_id] ||= {});
        bucket[m.warehouse_id] = (bucket[m.warehouse_id] || 0) + signed;
      }
    }

    renderSidebar();
    renderGrid();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + (e?.message || e), "error");
  }
  showLoading(false);
}

// ── HELPERS ───────────────────────────────────────────────
function getVariants(parentId) {
  return allProducts.filter((p) => p.parent_product_id === parentId);
}

function fmtNum(n) {
  return parseFloat(n || 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtQty(n) {
  const v = +n || 0;
  // integer if whole number, else up to 2 decimals
  if (Number.isInteger(v)) return v.toLocaleString("th-TH");
  return v.toLocaleString("th-TH", { maximumFractionDigits: 2 });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[<>&"']/g, (c) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/`/g, "&#96;");
}

function getCategory(catId) {
  return categories.find((c) => c.category_id === catId);
}

// Per-product current stock (already signed-summed across all movements)
function getVariantStock(productId) {
  return stockByProduct[productId] || 0;
}

// Per-warehouse breakdown for a product (for variants, sum across all variant ids)
function getStockByWarehouse(productIds) {
  const ids = Array.isArray(productIds) ? productIds : [productIds];
  const totals = {};
  for (const pid of ids) {
    const bucket = stockByProductWh[pid] || {};
    for (const whId in bucket) {
      totals[whId] = (totals[whId] || 0) + bucket[whId];
    }
  }
  // turn into array, attach warehouse meta, drop zero-only
  return Object.entries(totals)
    .map(([whId, qty]) => {
      const wh = warehouses.find((w) => String(w.warehouse_id) === String(whId));
      return {
        warehouse_id: +whId,
        warehouse_name: wh?.warehouse_name || `คลัง #${whId}`,
        country: wh?.country || "",
        qty,
      };
    })
    .filter((x) => x.qty !== 0)
    .sort((a, b) => b.qty - a.qty);
}

function priceMin(p) {
  const variants = getVariants(p.product_id);
  if (variants.length) {
    const prices = variants.map((v) => +v.sale_price).filter((x) => x > 0);
    return prices.length ? Math.min(...prices) : 0;
  }
  return +p.sale_price || 0;
}

// total stock for a product (sum of variants, or self if singleton)
function getTotalStock(p) {
  const variants = getVariants(p.product_id);
  const ids = variants.length ? variants.map((v) => v.product_id) : [p.product_id];
  return ids.reduce((s, id) => s + getVariantStock(id), 0);
}

// ── FILTER + SORT ─────────────────────────────────────────
function getFilteredProducts() {
  const parents = allProducts.filter((p) => !p.parent_product_id);
  let list = parents.filter((p) => {
    if (activeCatId !== "all" && String(p.category_id) !== String(activeCatId))
      return false;
    if (activeFilter === "instock" && getTotalStock(p) <= 0) return false;
    if (activeFilter === "outstock" && getTotalStock(p) > 0) return false;
    if (searchTerm) {
      const hay = `${p.product_name || ""} ${p.product_code || ""}`.toLowerCase();
      if (!hay.includes(searchTerm)) return false;
    }
    return true;
  });

  // sort
  switch (sortMode) {
    case "name-asc":
      list.sort((a, b) => (a.product_name || "").localeCompare(b.product_name || "", "th"));
      break;
    case "name-desc":
      list.sort((a, b) => (b.product_name || "").localeCompare(a.product_name || "", "th"));
      break;
    case "price-asc":
      list.sort((a, b) => priceMin(a) - priceMin(b));
      break;
    case "price-desc":
      list.sort((a, b) => priceMin(b) - priceMin(a));
      break;
    default:
      // group by category sort_order, then product_name
      list.sort((a, b) => {
        const ca = getCategory(a.category_id);
        const cb = getCategory(b.category_id);
        const oa = ca?.sort_order ?? 999;
        const ob = cb?.sort_order ?? 999;
        if (oa !== ob) return oa - ob;
        return (a.product_name || "").localeCompare(b.product_name || "", "th");
      });
  }

  return list;
}

// ── RENDER: SIDEBAR ───────────────────────────────────────
function renderSidebar() {
  const wrap = document.getElementById("catSideList");
  if (!wrap) return;

  const parents = allProducts.filter((p) => !p.parent_product_id);
  const cntByCat = {};
  for (const p of parents) {
    const cid = p.category_id ?? "_none";
    cntByCat[cid] = (cntByCat[cid] || 0) + 1;
  }

  // Set "All Product" count
  const cntAll = document.getElementById("cntAll");
  if (cntAll) cntAll.textContent = parents.length;

  // First child: "All Product" — already in HTML, just rebind
  const itemsHtml = [
    `<button class="cat-side-item${activeCatId === "all" ? " active" : ""}" data-cat="all">
      <span class="cat-side-icon">📦</span>
      <span class="cat-side-name">All Product</span>
      <span class="cat-side-count">${parents.length}</span>
    </button>`,
  ];
  for (const c of categories) {
    const n = cntByCat[c.category_id] || 0;
    if (!n) continue; // hide empty categories
    itemsHtml.push(
      `<button class="cat-side-item${String(activeCatId) === String(c.category_id) ? " active" : ""}" data-cat="${escapeAttr(c.category_id)}">
        <span class="cat-side-icon">${escapeHtml(c.icon || "📦")}</span>
        <span class="cat-side-name">${escapeHtml(c.category_name || "—")}</span>
        <span class="cat-side-count">${n}</span>
      </button>`
    );
  }
  wrap.innerHTML = itemsHtml.join("");

  wrap.querySelectorAll(".cat-side-item[data-cat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeCatId = btn.dataset.cat === "all" ? "all" : btn.dataset.cat;
      // numeric ids? keep as-is string; comparison uses String() everywhere
      wrap
        .querySelectorAll(".cat-side-item[data-cat]")
        .forEach((x) => x.classList.toggle("active", x === btn));
      renderGrid();
    });
  });

  // Filter buttons
  document.querySelectorAll(".cat-side-filter[data-filter]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.filter === activeFilter);
    btn.addEventListener("click", () => {
      activeFilter = btn.dataset.filter;
      document
        .querySelectorAll(".cat-side-filter[data-filter]")
        .forEach((x) => x.classList.toggle("active", x === btn));
      renderGrid();
    });
  });
}

// ── RENDER: GRID ──────────────────────────────────────────
function renderGrid() {
  const grid = document.getElementById("catGrid");
  const empty = document.getElementById("catEmpty");
  const countEl = document.getElementById("catResultCount");
  if (!grid) return;

  const list = getFilteredProducts();

  // Update current label
  const labelIcon = document.querySelector(".cat-current-icon");
  const labelName = document.querySelector(".cat-current-name");
  if (activeCatId === "all") {
    if (labelIcon) labelIcon.textContent = "📦";
    if (labelName) labelName.textContent = "All Product";
  } else {
    const c = getCategory(activeCatId) ||
      (typeof activeCatId === "string"
        ? categories.find((x) => String(x.category_id) === activeCatId)
        : null);
    if (labelIcon) labelIcon.textContent = c?.icon || "📦";
    if (labelName) labelName.textContent = c?.category_name || "—";
  }

  if (countEl) countEl.textContent = `${list.length} รายการ`;

  // toggle layout class on grid container
  grid.classList.toggle("cat-grid--list", viewMode === "list");
  grid.classList.toggle("cat-grid--gridmode", viewMode === "grid");

  if (!list.length) {
    grid.innerHTML = "";
    if (empty) empty.style.display = "";
    return;
  }
  if (empty) empty.style.display = "none";

  if (viewMode === "list") {
    grid.innerHTML =
      `<div class="cat-list-head">
        <span class="cat-list-col cat-list-col-name">ชื่อสินค้า</span>
        <span class="cat-list-col cat-list-col-cat">หมวดหมู่</span>
        <span class="cat-list-col cat-list-col-opts">ตัวเลือก</span>
        <span class="cat-list-col cat-list-col-stock">คงเหลือ</span>
      </div>` + list.map((p) => renderListItem(p)).join("");
  } else {
    grid.innerHTML = list.map((p) => renderCard(p)).join("");
  }

  grid.querySelectorAll("[data-id]").forEach((el) => {
    const id = +el.dataset.id;
    el.addEventListener("click", () => openModal(id));
  });
}

function renderListItem(p) {
  const variants = getVariants(p.product_id);
  const cat = getCategory(p.category_id);
  const variantIds = variants.length ? variants.map((v) => v.product_id) : [p.product_id];
  const totalStock = variantIds.reduce((s, id) => s + getVariantStock(id), 0);
  const stockClass =
    totalStock <= 0 ? "out" : totalStock < (p.reorder_point || 0) ? "low" : "ok";
  const imgs = imagesByProduct[p.product_id] || [];
  const thumbSrc = imgs[0]?.url || NO_IMAGE_SRC;

  return `
    <div class="cat-list-row" data-id="${p.product_id}">
      <span class="cat-list-col cat-list-col-name">
        <img class="cat-list-thumb" src="${escapeAttr(thumbSrc)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${NO_IMAGE_SRC}'">
        <span class="cat-list-name-text">
          <span class="cat-list-name">${escapeHtml(p.product_name)}</span>
          ${p.product_code ? `<span class="cat-list-code">${escapeHtml(p.product_code)}</span>` : ""}
        </span>
      </span>
      <span class="cat-list-col cat-list-col-cat">
        ${escapeHtml(cat?.icon || "📦")} ${escapeHtml(cat?.category_name || "—")}
      </span>
      <span class="cat-list-col cat-list-col-opts">
        ${variants.length ? `${variants.length} ตัวเลือก` : "—"}
      </span>
      <span class="cat-list-col cat-list-col-stock">
        <span class="cat-card-stock cat-card-stock--${stockClass}">${fmtQty(totalStock)}</span>
      </span>
    </div>
  `;
}

function renderCard(p) {
  const imgs = imagesByProduct[p.product_id] || [];
  const img = imgs[0];
  const variants = getVariants(p.product_id);
  const cat = getCategory(p.category_id);

  // total stock across self + variants
  const variantIds = variants.length ? variants.map((v) => v.product_id) : [p.product_id];
  const totalStock = variantIds.reduce((s, id) => s + getVariantStock(id), 0);
  const stockClass =
    totalStock <= 0 ? "out" : totalStock < (p.reorder_point || 0) ? "low" : "ok";
  const stockBadge = `<span class="cat-card-stock cat-card-stock--${stockClass}">In Stock: ${fmtQty(totalStock)}</span>`;

  const subText = variants.length
    ? `${escapeHtml(cat?.icon || "📦")} ${escapeHtml(cat?.category_name || "—")} · ${variants.length} ตัวเลือก`
    : `${escapeHtml(cat?.icon || "📦")} ${escapeHtml(cat?.category_name || "—")}`;

  const inactiveTag =
    !p.is_active && !variants.length
      ? `<span class="cat-card-inactive-tag">OFF</span>`
      : "";

  const imgHtml = img
    ? `<img src="${escapeAttr(img.url)}" alt="${escapeAttr(p.product_name)}" loading="lazy" onerror="this.onerror=null;this.src='${NO_IMAGE_SRC}'">`
    : `<img src="${NO_IMAGE_SRC}" alt="${escapeAttr(p.product_name)}" class="cat-card-img-noimg" loading="lazy">`;

  return `
    <article class="cat-card" data-id="${p.product_id}">
      <div class="cat-card-img">
        ${imgHtml}
        ${inactiveTag}
      </div>
      <div class="cat-card-body">
        <h3 class="cat-card-name">${escapeHtml(p.product_name)}</h3>
        <p class="cat-card-desc">${subText}</p>
        <div class="cat-card-stock-row">${stockBadge}</div>
      </div>
    </article>
  `;
}

// ── MODAL (product detail — matrix style) ─────────────────
function openModal(productId) {
  const p = allProducts.find((x) => x.product_id === productId);
  if (!p) return;

  const cat = getCategory(p.category_id);
  const imgs = imagesByProduct[p.product_id] || [];
  const variants = getVariants(p.product_id);
  // rows for the matrix: variants OR singleton (parent itself)
  const rows = variants.length ? variants : [p];

  const mainImg = imgs[0];
  const mainImgHtml = mainImg
    ? `<img id="catModalMainImg" src="${escapeAttr(mainImg.url)}" alt="${escapeAttr(p.product_name)}" onerror="this.onerror=null;this.src='${NO_IMAGE_SRC}'">`
    : `<img id="catModalMainImg" src="${NO_IMAGE_SRC}" alt="${escapeAttr(p.product_name)}" class="cat-md-img-noimg">`;

  const thumbsHtml =
    imgs.length > 1
      ? `<div class="cat-md-thumbs">${imgs
          .map(
            (im, i) =>
              `<div class="cat-md-thumb${i === 0 ? " active" : ""}" data-url="${escapeAttr(im.url)}"><img src="${escapeAttr(im.url)}" alt=""></div>`
          )
          .join("")}</div>`
      : "";

  const catBg = cat?.color
    ? `style="background:${escapeAttr(cat.color)}22;"`
    : "";

  // ── Build matrix: rows × warehouses ──
  // 1. Find warehouses that have ANY stock for this product family
  const usedWhIds = new Set();
  for (const r of rows) {
    const bucket = stockByProductWh[r.product_id] || {};
    for (const whId in bucket) {
      if (bucket[whId] !== 0) usedWhIds.add(String(whId));
    }
  }
  const activeWh = warehouses
    .filter((w) => usedWhIds.has(String(w.warehouse_id)))
    .sort((a, b) => {
      // sort by country then name
      const c = (a.country || "").localeCompare(b.country || "");
      return c !== 0 ? c : (a.warehouse_name || "").localeCompare(b.warehouse_name || "", "th");
    });

  // 2. Group by country + mark country boundary indices for column separators
  const countriesMap = new Map();
  for (const w of activeWh) {
    const key = w.country || "—";
    if (!countriesMap.has(key)) countriesMap.set(key, []);
    countriesMap.get(key).push(w);
  }
  const countries = [...countriesMap.entries()];
  const hasMultiCountry = countries.length > 1;
  // boundary set: index of warehouse in activeWh where a NEW country begins (skip index 0)
  const boundarySet = new Set();
  let cursor = 0;
  for (const [, whs] of countries) {
    if (cursor !== 0) boundarySet.add(cursor);
    cursor += whs.length;
  }

  // 3. Compute prices range
  let priceText = "";
  if (variants.length) {
    const prices = variants.map((v) => +v.sale_price).filter((x) => x > 0);
    if (prices.length) {
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      priceText = min === max ? `฿${fmtNum(min)}` : `฿${fmtNum(min)} – ฿${fmtNum(max)}`;
    }
  } else if (p.sale_price) {
    priceText = `฿${fmtNum(p.sale_price)}`;
  }

  // 4. Build matrix HTML
  let matrixHtml = "";
  if (activeWh.length === 0) {
    matrixHtml = `<div class="cat-md-matrix-empty">— ยังไม่มีข้อมูลสต็อกในคลังใด —</div>`;
  } else {
    // Header rows
    let countryHeaderRow = "";
    if (hasMultiCountry) {
      countryHeaderRow = `<tr class="cat-md-mtx-country-row">
        <th class="cat-md-mtx-corner-empty"></th>
        ${countries
          .map(
            ([cn, whs], i) => `<th colspan="${whs.length}" class="cat-md-mtx-country${i > 0 ? " is-boundary" : ""}">🌐 ${escapeHtml(cn)}</th>`
          )
          .join("")}
        <th class="cat-md-mtx-total-th"></th>
      </tr>`;
    }

    const whHeaderRow = `<tr class="cat-md-mtx-wh-row">
      <th class="cat-md-mtx-corner">ตัวเลือก</th>
      ${activeWh
        .map(
          (w, i) => `<th class="cat-md-mtx-wh${boundarySet.has(i) ? " is-boundary" : ""}" title="${escapeAttr(w.warehouse_name)}">
            <span class="cat-md-mtx-wh-icon">🏭</span>
            <span class="cat-md-mtx-wh-name">${escapeHtml(w.warehouse_name)}</span>
          </th>`
        )
        .join("")}
      <th class="cat-md-mtx-total-th">รวม</th>
    </tr>`;

    // Body
    const bodyRows = rows
      .map((r) => {
        const isVariant = !!r.parent_product_id;
        const label = isVariant ? extractVariantLabel(r.product_name, p.product_name) : "—";
        const bucket = stockByProductWh[r.product_id] || {};
        let total = 0;
        const cells = activeWh
          .map((w, i) => {
            const q = +bucket[w.warehouse_id] || 0;
            total += q;
            const zeroCls = q <= 0 ? "cat-md-mtx-cell-zero" : "";
            const boundaryCls = boundarySet.has(i) ? "is-boundary" : "";
            return `<td class="cat-md-mtx-cell ${zeroCls} ${boundaryCls}">${q === 0 ? "—" : fmtQty(q)}</td>`;
          })
          .join("");
        const totalCls = total <= 0 ? "out" : "";
        const inactive = isVariant && !r.is_active ? " inactive" : !isVariant && !p.is_active ? " inactive" : "";
        const priceLabel = +r.sale_price > 0 ? `฿${fmtNum(r.sale_price)}` : "";
        const labelHtml = isVariant
          ? `<span class="cat-md-mtx-label">${escapeHtml(label)}</span>${priceLabel ? `<span class="cat-md-mtx-label-price">${priceLabel}</span>` : ""}`
          : `<span class="cat-md-mtx-label">ทั้งหมด</span>`;
        return `<tr class="cat-md-mtx-body-row${inactive}">
          <td class="cat-md-mtx-rowlabel">${labelHtml}</td>
          ${cells}
          <td class="cat-md-mtx-total ${totalCls}">${fmtQty(total)}</td>
        </tr>`;
      })
      .join("");

    matrixHtml = `
      <div class="cat-md-matrix-wrap">
        <table class="cat-md-matrix-table">
          <thead>
            ${countryHeaderRow}
            ${whHeaderRow}
          </thead>
          <tbody>
            ${bodyRows}
          </tbody>
        </table>
      </div>
    `;
  }

  const inactiveBanner =
    !p.is_active && !variants.length
      ? `<div class="cat-md-inactive-banner">⛔ สินค้าตัวนี้ปิดใช้งานอยู่</div>`
      : "";

  document.getElementById("catModalBody").innerHTML = `
    <div class="cat-md-imgs">
      <div class="cat-md-img-main">${mainImgHtml}</div>
      ${thumbsHtml}
    </div>
    <div class="cat-md-info">
      ${inactiveBanner}
      <div class="cat-md-title-row">
        <h2 class="cat-md-name">${escapeHtml(p.product_name)}</h2>
        <span class="cat-md-cat" ${catBg}>
          <span>${escapeHtml(cat?.icon || "📦")}</span>
          <span>${escapeHtml(cat?.category_name || "—")}</span>
        </span>
      </div>
      ${priceText ? `<div class="cat-md-price-line"><span class="cat-md-price">${priceText}</span></div>` : ""}
      <div class="cat-md-divider"></div>
      ${matrixHtml}
    </div>
  `;

  // ── Thumb click handler ──
  document.querySelectorAll("#catModalBody .cat-md-thumb").forEach((th) => {
    th.addEventListener("click", () => {
      const url = th.dataset.url;
      document
        .querySelectorAll("#catModalBody .cat-md-thumb")
        .forEach((x) => x.classList.remove("active"));
      th.classList.add("active");
      const main = document.getElementById("catModalMainImg");
      if (main) main.src = url;
    });
  });

  const modalEl = document.getElementById("catModal");
  modalEl.classList.add("open");
  document.getElementById("catModalOv").classList.add("open");

  // ── Auto-fit modal width to table ──
  // After layout, check if matrix wrap has horizontal scroll. If so and viewport
  // still has room, grow the modal width to absorb the overflow.
  modalEl.style.width = ""; // reset any prior inline width
  requestAnimationFrame(() => {
    const wrap = modalEl.querySelector(".cat-md-matrix-wrap");
    const table = modalEl.querySelector(".cat-md-matrix-table");
    if (!wrap || !table) return;
    const overflow = table.scrollWidth - wrap.clientWidth;
    if (overflow <= 0) return; // already fits
    const current = modalEl.getBoundingClientRect().width;
    const maxAllowed = window.innerWidth * 0.95;
    const target = Math.min(current + overflow + 4, maxAllowed);
    modalEl.style.width = target + "px";
  });
}

function closeModal() {
  document.getElementById("catModal")?.classList.remove("open");
  document.getElementById("catModalOv")?.classList.remove("open");
}

function extractVariantLabel(childName, parentName) {
  if (!childName) return "—";
  if (parentName && childName.startsWith(parentName)) {
    const rest = childName.slice(parentName.length).trim();
    const m = rest.match(/^\(([^)]+)\)\s*$/);
    if (m) return m[1].trim();
    return rest || childName;
  }
  return childName;
}

// ── UTIL ──────────────────────────────────────────────────
function showLoading(on) {
  const ov = document.getElementById("loadingOverlay");
  if (!ov) return;
  ov.style.display = on ? "flex" : "none";
}

function showToast(msg, type = "info") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.className = `toast toast-${type} show`;
  setTimeout(() => t.classList.remove("show"), 3000);
}
