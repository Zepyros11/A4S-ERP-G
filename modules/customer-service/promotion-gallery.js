/* ============================================================
   promotion-gallery.js — Controller for Promotion Gallery page
============================================================ */

import { fetchPromotions, fetchPromotionCategories } from "./promotion-api.js";

// ── STATE ──────────────────────────────────────────────────
let allPromotions = [];
let allCategories = [];
let gridCols = 4;
let activeCatId = "";
let filterThisMonth = true;

// ── INIT ───────────────────────────────────────────────────
async function initPage() {
  showLoading(true);
  try {
    [allPromotions, allCategories] = await Promise.all([
      fetchPromotions().catch(() => []),
      fetchPromotionCategories().catch(() => []),
    ]);
    renderCategoryChips();
    renderGallery();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

function renderCategoryChips() {
  const wrap = document.getElementById("filterChipsWrap");
  const monthBtn = document.getElementById("btnThisMonth");
  const allChipBtn = wrap.querySelector('[data-cat=""]');
  wrap.innerHTML = "";
  if (monthBtn) wrap.appendChild(monthBtn);
  wrap.appendChild(allChipBtn);

  // Sync active chip
  [monthBtn, allChipBtn].forEach((b) => b && b.classList.remove("active"));
  if (filterThisMonth && monthBtn) monthBtn.classList.add("active");
  else if (!activeCatId) allChipBtn.classList.add("active");

  allCategories.forEach((cat) => {
    const btn = document.createElement("button");
    btn.className = "pg-chip";
    btn.dataset.cat = cat.promotion_category_id;
    btn.textContent = `${cat.icon || ""} ${cat.category_name}`.trim();
    btn.onclick = () => window.setTypeFilter(btn, String(cat.promotion_category_id));
    wrap.appendChild(btn);
  });
}

// ── FILTER ─────────────────────────────────────────────────
window.setGrid = function (cols) {
  gridCols = cols;
  document.querySelectorAll(".pg-toggle-btn").forEach((b) => b.classList.remove("active"));
  const activeBtn = document.getElementById("btnGrid" + cols);
  if (activeBtn) activeBtn.classList.add("active");
  renderGallery();
};

window.setTypeFilter = function (btn, catId) {
  document.querySelectorAll(".pg-chip").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  activeCatId = catId;
  filterThisMonth = false;
  renderGallery();
};

window.toggleThisMonth = function (btn) {
  filterThisMonth = !filterThisMonth;
  document.querySelectorAll(".pg-chip").forEach((b) => b.classList.remove("active"));
  if (filterThisMonth) {
    btn.classList.add("active");
  } else {
    const allBtn = document.querySelector('.pg-chip[data-cat=""]');
    if (allBtn) allBtn.classList.add("active");
  }
  renderGallery();
};

// ── RENDER ─────────────────────────────────────────────────
function renderGallery() {
  const now = new Date();
  const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  let filtered = allPromotions.filter((p) => {
    if (activeCatId && String(p.promotion_category_id) !== activeCatId) return false;
    if (filterThisMonth && p.start_date && p.start_date.slice(0, 7) !== curMonth) return false;
    return true;
  });

  document.getElementById("pageSubtitle").textContent =
    `${filtered.length} โปรโมชัน`;

  const body = document.getElementById("galleryBody");

  if (!filtered.length) {
    body.innerHTML = `
      <div class="empty-state" style="padding: 60px 0">
        <div class="empty-icon">🖼️</div>
        <div class="empty-text">ไม่พบโปรโมชัน</div>
      </div>`;
    return;
  }

  // จัดกลุ่มตามเดือน (ใช้ start_date)
  const groups = {};
  filtered.forEach((p) => {
    const key = p.start_date ? p.start_date.slice(0, 7) : "0000-00";
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  });

  const sortedKeys = Object.keys(groups).sort().reverse();

  body.innerHTML = sortedKeys
    .map((key) => {
      const promos = groups[key];
      const monthLabel = formatMonthLabel(key);
      const cards = promos.map((p) => buildCard(p)).join("");
      return `
        <div class="pg-month-section">
          <div class="pg-month-header">
            <span class="pg-month-title">${monthLabel}</span>
            <span class="pg-month-count">${promos.length} PROMOTIONS</span>
          </div>
          <div class="pg-grid pg-grid-${gridCols}">
            ${cards}
          </div>
        </div>`;
    })
    .join("");

  // Trigger scroll reveal
  requestAnimationFrame(() => initScrollReveal());
}

// ── BUILD CARD ─────────────────────────────────────────────
function getCatInfo(p) {
  const cat = allCategories.find((c) => c.promotion_category_id === p.promotion_category_id);
  return {
    label: cat ? `${cat.icon || ""} ${cat.category_name}`.trim() : "",
    color: cat?.color || "#f59e0b",
  };
}

function buildCard(p) {
  const day = p.start_date ? parseInt(p.start_date.split("-")[2]) : "??";
  const monthShort = p.start_date ? shortMonth(p.start_date.slice(5, 7)) : "";
  const { label: catLabel, color: catColor } = getCatInfo(p);

  // end date display
  const endTxt = p.end_date ? `ถึง ${formatShortDate(p.end_date)}` : "";

  // images
  const allImgs = Array.isArray(p.image_urls) && p.image_urls.length
    ? p.image_urls
    : (p.poster_url ? [p.poster_url] : []);
  const urlsJson = JSON.stringify(allImgs).replace(/"/g, "&quot;");
  const mainImg = allImgs[0] || null;

  const imgCountBadge = allImgs.length > 1
    ? `<div class="pg-img-count">🖼️ ${allImgs.length}</div>`
    : "";

  const posterInner = mainImg
    ? `<img src="${mainImg}" alt="${p.promotion_name || ''}"
         loading="lazy"
         onerror="this.parentElement.classList.add('pg-card-noposter'); this.remove();">`
    : `<div class="pg-noposter-inner">
         <span class="pg-noposter-icon">🎁</span>
         <span class="pg-noposter-text">No Poster Available</span>
       </div>`;

  const chipBg = `${catColor}44`;
  const chipText = `#fff`;
  const chipBorder = `${catColor}66`;

  return `
    <div class="pg-card">
      <div class="pg-card-img ${!mainImg ? "pg-card-noposter" : ""}"
           ${mainImg ? `onclick="event.stopPropagation(); ImgPopup.open(${urlsJson}, 0)"` : ""}>
        <div class="pg-top-badges">
          <div class="pg-date-badge">
            <span class="pg-date-day">${day}</span>
            <span class="pg-date-mon">${monthShort}</span>
          </div>
        </div>
        ${imgCountBadge}
        ${posterInner}
        <div class="pg-card-body">
          ${catLabel ? `<span class="pg-type-chip" style="background:${chipBg};color:${chipText};border-color:${chipBorder}">${catLabel}</span>` : ""}
          <div class="pg-card-name">${p.promotion_name || "—"}</div>
          <div class="pg-card-meta">
            ${endTxt ? `<span>📅 ${endTxt}</span>` : ""}
            ${p.description ? `<span>📝 ${truncate(p.description, 40)}</span>` : ""}
          </div>
        </div>
      </div>
    </div>`;
}

// ── SCROLL REVEAL ─────────────────────────────────────────
function initScrollReveal() {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("pg-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.08, rootMargin: "0px 0px -40px 0px" }
  );
  document.querySelectorAll(".pg-card").forEach((card) => observer.observe(card));
}

// ── HELPERS ────────────────────────────────────────────────
function truncate(str, len) {
  if (!str) return "";
  return str.length > len ? str.slice(0, len) + "..." : str;
}

function shortMonth(mm) {
  return (
    [
      "",
      "JAN",
      "FEB",
      "MAR",
      "APR",
      "MAY",
      "JUN",
      "JUL",
      "AUG",
      "SEP",
      "OCT",
      "NOV",
      "DEC",
    ][parseInt(mm)] || ""
  );
}

function formatShortDate(d) {
  if (!d) return "";
  const [y, m, dd] = d.split("-");
  return `${parseInt(dd)}/${parseInt(m)}/${parseInt(y) + 543}`;
}

function formatMonthLabel(key) {
  if (!key || key === "0000-00") return "ไม่ระบุวันที่";
  const [y, m] = key.split("-");
  const thMonths = [
    "",
    "มกราคม",
    "กุมภาพันธ์",
    "มีนาคม",
    "เมษายน",
    "พฤษภาคม",
    "มิถุนายน",
    "กรกฎาคม",
    "สิงหาคม",
    "กันยายน",
    "ตุลาคม",
    "พฤศจิกายน",
    "ธันวาคม",
  ];
  return `${thMonths[parseInt(m)]} ${parseInt(y) + 543}`;
}

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
