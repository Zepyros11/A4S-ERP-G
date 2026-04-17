/* ============================================================
   promotion-catalog.js — Public Catalog View (read-only)
============================================================ */

import { fetchPromotions, fetchPromotionCategories } from "./promotion-api.js";

let allPromotions = [];
let allCategories = [];
let activeCat = "all";
let currentMonth = "";

// ── INIT ───────────────────────────────────────────────────
async function initPage() {
  const now = new Date();
  currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  showLoading(true);
  try {
    [allPromotions, allCategories] = await Promise.all([
      fetchPromotions(currentMonth).catch(() => []),
      fetchPromotionCategories().catch(() => []),
    ]);
    renderMonthLabel();
    renderCatFilter();
    renderCatalog();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

// ── MONTH NAV ──────────────────────────────────────────────
const TH_MONTHS = [
  "", "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

function renderMonthLabel() {
  const [y, m] = currentMonth.split("-");
  const label = `${TH_MONTHS[parseInt(m)]} ${parseInt(y) + 543}`;
  document.getElementById("monthLabel").textContent = label;
  document.getElementById("heroTitle").textContent = `โปรโมชันประจำเดือน`;
  document.getElementById("heroSubtitle").textContent = label;
}

function shiftMonth(delta) {
  const [y, m] = currentMonth.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  currentMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  reloadMonth();
}

async function reloadMonth() {
  showLoading(true);
  renderMonthLabel();
  try {
    allPromotions = await fetchPromotions(currentMonth).catch(() => []);
    activeCat = "all";
    renderCatFilter();
    renderCatalog();
  } catch (_) {}
  showLoading(false);
}

window.prevMonth = () => shiftMonth(-1);
window.nextMonth = () => shiftMonth(+1);

// ── CATEGORY FILTER ────────────────────────────────────────
function renderCatFilter() {
  const bar = document.getElementById("catFilterBar");
  const countMap = {};
  allPromotions.forEach((p) => {
    const cid = p.promotion_category_id || 0;
    countMap[cid] = (countMap[cid] || 0) + 1;
  });

  let html = `<button class="cat-chip ${activeCat === "all" ? "active" : ""}"
    onclick="window.filterCat('all')">ทั้งหมด <span class="cat-chip-count">${allPromotions.length}</span></button>`;

  allCategories.forEach((cat) => {
    const cnt = countMap[cat.promotion_category_id] || 0;
    if (!cnt) return; // ซ่อนหมวดที่ไม่มี poster เดือนนี้
    const isActive = activeCat === String(cat.promotion_category_id);
    const style = isActive
      ? `background:${cat.color || "#f59e0b"};color:#fff;border-color:${cat.color || "#f59e0b"}`
      : "";
    html += `<button class="cat-chip ${isActive ? "active" : ""}" style="${style}"
      onclick="window.filterCat('${cat.promotion_category_id}')">
      ${cat.icon || "📁"} ${cat.category_name}
      <span class="cat-chip-count">${cnt}</span>
    </button>`;
  });

  bar.innerHTML = html;
}

window.filterCat = function (catId) {
  activeCat = catId;
  renderCatFilter();
  renderCatalog();
};

// ── RENDER CATALOG ─────────────────────────────────────────
function renderCatalog() {
  let filtered = allPromotions;
  if (activeCat !== "all") {
    filtered = filtered.filter((p) => String(p.promotion_category_id) === activeCat);
  }

  const body = document.getElementById("catalogBody");

  if (!filtered.length) {
    body.innerHTML = `
      <div class="cat-empty">
        <div class="cat-empty-icon">📰</div>
        <div class="cat-empty-text">ไม่มีโปรโมชันในเดือนนี้</div>
      </div>`;
    return;
  }

  // group by category
  const groups = {};
  filtered.forEach((p) => {
    const cid = p.promotion_category_id || 0;
    if (!groups[cid]) groups[cid] = [];
    groups[cid].push(p);
  });

  const catOrder = {};
  allCategories.forEach((c, i) => { catOrder[c.promotion_category_id] = i; });
  const sortedKeys = Object.keys(groups).sort((a, b) => (catOrder[a] ?? 999) - (catOrder[b] ?? 999));

  let html = "";
  sortedKeys.forEach((cid) => {
    const cat = allCategories.find((c) => String(c.promotion_category_id) === String(cid));
    const catLabel = cat ? `${cat.icon || "📁"} ${cat.category_name}` : "📁 อื่นๆ";
    const catColor = cat?.color || "#94a3b8";
    const promos = groups[cid];
    const allUrls = promos.map((p) => p.poster_url).filter(Boolean);

    html += `
      <div class="cat-section">
        <div class="cat-section-hdr">
          <span class="cat-section-dot" style="background:${catColor}"></span>
          <span class="cat-section-title">${catLabel}</span>
          <span class="cat-section-count">${promos.length}</span>
          <div class="cat-section-line" style="background:linear-gradient(to right,${catColor}25,transparent)"></div>
        </div>
        <div class="cat-grid">
          ${promos.map((p, idx) => buildCard(p, allUrls, idx, catColor)).join("")}
        </div>
      </div>`;
  });

  body.innerHTML = html;
  requestAnimationFrame(() => initScrollReveal());
}

// ── CARD ───────────────────────────────────────────────────
function buildCard(p, allUrls, idx, catColor) {
  const urlsJson = JSON.stringify(allUrls).replace(/"/g, "&quot;");
  return `
    <div class="cat-card" onclick="ImgPopup.open(${urlsJson}, ${idx})">
      <div class="cat-card-img">
        <img src="${p.poster_url}" alt="" loading="lazy"
          onerror="this.parentElement.innerHTML='<div class=cat-card-noposter>🖼️</div>'" />
        <div class="cat-card-hover">
          <span class="cat-card-zoom">🔍 ดูภาพเต็ม</span>
        </div>
      </div>
    </div>`;
}

// ── SCROLL REVEAL ──────────────────────────────────────────
function initScrollReveal() {
  const obs = new IntersectionObserver(
    (entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add("cat-visible"); obs.unobserve(e.target); }
    }),
    { threshold: 0.05, rootMargin: "0px 0px -20px 0px" }
  );
  document.querySelectorAll(".cat-card").forEach((c) => obs.observe(c));
}

// ── HELPERS ────────────────────────────────────────────────
function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove("show"), 3000);
}

function showLoading(show) {
  document.getElementById("loadingOverlay").classList.toggle("show", show);
}

// ── START ──────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPage);
} else {
  initPage();
}
