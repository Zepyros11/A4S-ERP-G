/* ============================================================
   catalog.js — Product Catalog (Editorial scroll webapp)
   Hero + sticky tabs + per-category sections + product grid
   ============================================================ */

import {
  fetchProducts,
  fetchCategories,
  fetchProductUnits,
  fetchProductImages,
} from "./products-api.js";

// ── STATE ─────────────────────────────────────────────────
let allProducts = [];
let categories = [];
let units = [];
let productImages = [];
let imagesByProduct = {};

let activeCatId = "all";
let searchTerm = "";
let scrollSpyObserver = null;

// ── INIT ──────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  loadAll();
  // set Buddhist year
  const buddhist = new Date().getFullYear() + 543;
  const volEl = document.getElementById("catVol");
  if (volEl) volEl.textContent = buddhist;
});

function bindEvents() {
  document.getElementById("btnRefresh")?.addEventListener("click", loadAll);
  document.getElementById("btnBackTop")?.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
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
      renderSections();
    }, 180);
  });
}

async function loadAll() {
  showLoading(true);
  try {
    const [prods, cats, uts, imgs] = await Promise.all([
      fetchProducts(),
      fetchCategories(),
      fetchProductUnits(),
      fetchProductImages(),
    ]);
    allProducts = prods || [];
    categories = (cats || [])
      .slice()
      .sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999));
    units = uts || [];
    productImages = imgs || [];

    imagesByProduct = {};
    for (const im of productImages) {
      (imagesByProduct[im.product_id] ||= []).push(im);
    }
    for (const k in imagesByProduct) {
      imagesByProduct[k].sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
      );
    }

    renderHeroStats();
    renderTabs();
    renderSections();
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

function pad2(n) {
  return String(n).padStart(2, "0");
}

function priceText(p) {
  const variants = getVariants(p.product_id);
  if (variants.length) {
    const prices = variants.map((v) => +v.sale_price).filter((x) => x > 0);
    if (!prices.length)
      return `<span class="cat-card-price-empty">— ราคา —</span>`;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    if (min === max) return `฿${fmtNum(min)}`;
    return `฿${fmtNum(min)}–${fmtNum(max)}`;
  }
  if (!p.sale_price)
    return `<span class="cat-card-price-empty">— ราคา —</span>`;
  return `฿${fmtNum(p.sale_price)}`;
}

// ── FILTERED / GROUPED ────────────────────────────────────
function getFilteredParents() {
  const parents = allProducts.filter((p) => !p.parent_product_id);
  return parents.filter((p) => {
    if (searchTerm) {
      const hay = `${p.product_name || ""} ${p.product_code || ""}`.toLowerCase();
      if (!hay.includes(searchTerm)) return false;
    }
    return true;
  });
}

function groupByCategory(products) {
  const byCat = new Map();
  for (const p of products) {
    const cid = p.category_id ?? "_none";
    if (!byCat.has(cid)) byCat.set(cid, []);
    byCat.get(cid).push(p);
  }
  const ordered = [];
  for (const c of categories) {
    if (byCat.has(c.category_id)) {
      ordered.push({ cat: c, products: byCat.get(c.category_id) });
      byCat.delete(c.category_id);
    }
  }
  for (const [cid, prods] of byCat.entries()) {
    ordered.push({
      cat: { category_id: cid, category_name: "อื่น ๆ", icon: "📦" },
      products: prods,
    });
  }
  return ordered;
}

// ── RENDER: HERO STATS ────────────────────────────────────
function renderHeroStats() {
  const parents = allProducts.filter((p) => !p.parent_product_id);
  const variantCount = allProducts.filter((p) => p.parent_product_id).length;
  const leafParents = parents.filter(
    (p) => getVariants(p.product_id).length === 0
  ).length;
  const totalSkus = leafParents + variantCount;

  setText("kpiProducts", parents.length);
  setText("kpiSkus", totalSkus);
  setText("kpiCats", categories.length);
  setText("catTotalItems", parents.length);
}

// ── RENDER: TABS ──────────────────────────────────────────
function renderTabs() {
  const wrap = document.getElementById("catTabs");
  if (!wrap) return;

  const grouped = groupByCategory(allProducts.filter((p) => !p.parent_product_id));
  const allCount = allProducts.filter((p) => !p.parent_product_id).length;

  const parts = [
    `<a class="cat-tab${activeCatId === "all" ? " active" : ""}" data-cat="all" href="#cat-top">⚪ ทั้งหมด <span class="cat-tab-count">${allCount}</span></a>`,
  ];
  for (const { cat, products } of grouped) {
    parts.push(
      `<a class="cat-tab" data-cat="${cat.category_id}" href="#cat-sec-${cat.category_id}">${escapeHtml(cat.icon || "📦")} ${escapeHtml(cat.category_name)} <span class="cat-tab-count">${products.length}</span></a>`
    );
  }
  wrap.innerHTML = parts.join("");

  // smooth scroll handler
  wrap.querySelectorAll(".cat-tab").forEach((tab) => {
    tab.addEventListener("click", (e) => {
      e.preventDefault();
      const cid = tab.dataset.cat;
      activeCatId = cid;
      setActiveTab(cid);
      const targetSel = cid === "all" ? "#cat-top" : `#cat-sec-${cid}`;
      const el = document.querySelector(targetSel);
      if (el) {
        const top =
          el.getBoundingClientRect().top + window.scrollY - getStickyOffset();
        window.scrollTo({ top, behavior: "smooth" });
      }
    });
  });
}

function setActiveTab(catId) {
  document.querySelectorAll(".cat-tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.cat === String(catId));
  });
  // scroll active tab into view inside the tab strip
  const active = document.querySelector(".cat-tab.active");
  if (active) {
    const wrap = document.getElementById("catTabs");
    if (wrap) {
      const wrapRect = wrap.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      if (activeRect.left < wrapRect.left || activeRect.right > wrapRect.right) {
        active.scrollIntoView({
          behavior: "smooth",
          inline: "center",
          block: "nearest",
        });
      }
    }
  }
}

function getStickyOffset() {
  // topbar height (~56) + sticky bar height (~58) + small gap
  const topbar = document.querySelector(".topbar");
  const sticky = document.querySelector(".cat-sticky");
  return (topbar?.offsetHeight || 56) + (sticky?.offsetHeight || 58) - 1;
}

// ── RENDER: SECTIONS ──────────────────────────────────────
function renderSections() {
  const root = document.getElementById("catSections");
  const empty = document.getElementById("catEmpty");
  if (!root) return;

  const filtered = getFilteredParents();
  if (!filtered.length) {
    root.innerHTML = "";
    if (empty) empty.style.display = "";
    teardownScrollSpy();
    return;
  }
  if (empty) empty.style.display = "none";

  const grouped = groupByCategory(filtered);

  // anchor for "ทั้งหมด" tab top scroll
  const html = [`<div id="cat-top"></div>`];
  let secNum = 0;
  for (const { cat, products } of grouped) {
    secNum++;
    html.push(renderSection(cat, products, secNum));
  }
  root.innerHTML = html.join("");

  // bind product clicks
  root.querySelectorAll(".cat-card[data-id]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = +el.dataset.id;
      openModal(id);
    });
  });

  setupScrollSpy();
}

function renderSection(cat, products, secNum) {
  const cards = products
    .map((p, i) => renderCard(p, i + 1))
    .join("");
  return `
    <section class="cat-section" id="cat-sec-${escapeAttr(cat.category_id)}" data-cat="${escapeAttr(cat.category_id)}">
      <header class="cat-section-hdr">
        <span class="cat-section-num">SEC.${pad2(secNum)}</span>
        <span class="cat-section-icon">${escapeHtml(cat.icon || "📦")}</span>
        <h2 class="cat-section-title">${escapeHtml(cat.category_name || "—")}</h2>
        <span class="cat-section-meta">${products.length} item${products.length > 1 ? "s" : ""}</span>
      </header>
      <div class="cat-grid">${cards}</div>
    </section>
  `;
}

function renderCard(p, indexInSection) {
  const imgs = imagesByProduct[p.product_id] || [];
  const img = imgs[0];
  const variants = getVariants(p.product_id);

  const variantTag = variants.length
    ? `<span class="cat-card-tag">${variants.length} OPT</span>`
    : "";
  const inactiveTag =
    !p.is_active && !variants.length
      ? `<span class="cat-card-tag-inactive">OFF</span>`
      : "";

  const imgHtml = img
    ? `<img src="${escapeAttr(img.url)}" alt="${escapeAttr(p.product_name)}" loading="lazy" onerror="this.outerHTML='<span class=\\'cat-card-img-placeholder\\'>📦</span>'">`
    : `<span class="cat-card-img-placeholder">📦</span>`;

  return `
    <article class="cat-card" data-id="${p.product_id}">
      <div class="cat-card-img">
        ${imgHtml}
        ${variantTag}
        ${inactiveTag}
      </div>
      <div class="cat-card-meta">
        <span class="cat-card-num">№ ${pad2(indexInSection)}</span>
        <span class="cat-card-code">${escapeHtml(p.product_code || "")}</span>
      </div>
      <div class="cat-card-name">${escapeHtml(p.product_name)}</div>
      <div class="cat-card-price">${priceText(p)}</div>
    </article>
  `;
}

// ── SCROLL SPY (highlight tab as user scrolls) ────────────
function teardownScrollSpy() {
  if (scrollSpyObserver) {
    scrollSpyObserver.disconnect();
    scrollSpyObserver = null;
  }
}

function setupScrollSpy() {
  teardownScrollSpy();
  const sections = document.querySelectorAll(".cat-section[data-cat]");
  if (!sections.length) return;

  const offset = getStickyOffset() + 20;
  const visible = new Set();

  scrollSpyObserver = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) visible.add(e.target);
        else visible.delete(e.target);
      }
      if (!visible.size) return;
      // pick the one whose top is highest but still under offset (= top-most visible)
      let best = null;
      let bestTop = Infinity;
      for (const el of visible) {
        const t = el.getBoundingClientRect().top;
        if (t < bestTop) {
          bestTop = t;
          best = el;
        }
      }
      if (best) setActiveTab(best.dataset.cat);
    },
    {
      rootMargin: `-${offset}px 0px -55% 0px`,
      threshold: 0,
    }
  );

  for (const s of sections) scrollSpyObserver.observe(s);
}

// ── MODAL (product detail) ────────────────────────────────
function openModal(productId) {
  const p = allProducts.find((x) => x.product_id === productId);
  if (!p) return;

  const cat = getCategory(p.category_id);
  const imgs = imagesByProduct[p.product_id] || [];
  const variants = getVariants(p.product_id);
  const productUnits = units.filter(
    (u) =>
      u.product_id === p.product_id ||
      variants.some((v) => v.product_id === u.product_id)
  );
  const unitNames = [
    ...new Set(productUnits.map((u) => u.unit_name).filter(Boolean)),
  ];

  const mainImg = imgs[0];
  const mainImgHtml = mainImg
    ? `<img id="catModalMainImg" src="${escapeAttr(mainImg.url)}" alt="${escapeAttr(p.product_name)}">`
    : `<span class="cat-card-img-placeholder">📦</span>`;

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

  let priceHtml = "";
  if (variants.length) {
    const prices = variants.map((v) => +v.sale_price).filter((x) => x > 0);
    if (prices.length) {
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      priceHtml =
        min === max
          ? `<div class="cat-md-price">฿${fmtNum(min)}</div>`
          : `<div class="cat-md-price cat-md-price-range">฿${fmtNum(min)} – ฿${fmtNum(max)}</div>`;
    }
  } else if (p.sale_price) {
    priceHtml = `<div class="cat-md-price">฿${fmtNum(p.sale_price)}</div>`;
  }

  const variantsHtml = variants.length
    ? `<div class="cat-md-section-title">ตัวเลือก (${variants.length})</div>
       <div class="cat-md-variants">
         ${variants
           .map(
             (v) => `
           <div class="cat-md-variant${!v.is_active ? " inactive" : ""}">
             <span class="cat-md-variant-name">${escapeHtml(extractVariantLabel(v.product_name, p.product_name))}</span>
             <span class="cat-md-variant-price">${v.sale_price ? "฿" + fmtNum(v.sale_price) : "—"}</span>
           </div>`
           )
           .join("")}
       </div>`
    : "";

  const unitsHtml = unitNames.length
    ? `<div class="cat-md-section-title">หน่วยที่มี</div>
       <div class="cat-md-units">
         ${unitNames.map((n) => `<span class="cat-md-unit">${escapeHtml(n)}</span>`).join("")}
       </div>`
    : "";

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
      <span class="cat-md-cat" ${catBg}>
        <span>${escapeHtml(cat?.icon || "📦")}</span>
        <span>${escapeHtml(cat?.category_name || "—")}</span>
      </span>
      <div class="cat-md-name">${escapeHtml(p.product_name)}</div>
      ${p.product_code ? `<div class="cat-md-code">รหัส: ${escapeHtml(p.product_code)}</div>` : ""}
      ${priceHtml}
      ${variantsHtml}
      ${unitsHtml}
    </div>
  `;

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

  document.getElementById("catModal").classList.add("open");
  document.getElementById("catModalOv").classList.add("open");
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
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

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
