/* ============================================================
   event-poster-gallery.js — Controller for Poster Gallery page
============================================================ */

import { fetchEvents, fetchEventCategories } from "./events-api.js";

// ── STATE ──────────────────────────────────────────────────
let allEvents = [];
let allCategories = [];
let gridCols = 5;
let activeCatId = "";
let filterThisMonth = false;

// ── INIT ───────────────────────────────────────────────────
async function initPage() {
  showLoading(true);
  try {
    [allEvents, allCategories] = await Promise.all([
      fetchEvents().catch(() => []),
      fetchEventCategories().catch(() => []),
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
  // remove old dynamic chips (keep first "ทั้งหมด" and last poster-filter div)
  const monthBtn = document.getElementById("btnThisMonth");
  const allChipBtn = wrap.querySelector('[data-cat=""]');
  wrap.innerHTML = "";
  if (monthBtn) wrap.appendChild(monthBtn);
  wrap.appendChild(allChipBtn);

  allCategories.forEach((cat) => {
    const btn = document.createElement("button");
    btn.className = "epg-chip";
    btn.dataset.cat = cat.event_category_id;
    btn.textContent = `${cat.icon || ""} ${cat.category_name}`.trim();
    btn.onclick = () => window.setTypeFilter(btn, String(cat.event_category_id));
    wrap.appendChild(btn);
  });

  // populate mobile select
  const sel = document.getElementById("epgCatSelect");
  if (sel) {
    sel.innerHTML = '<option value="">ทั้งหมด</option>';
    allCategories.forEach((cat) => {
      const opt = document.createElement("option");
      opt.value = cat.event_category_id;
      opt.textContent = `${cat.icon || ""} ${cat.category_name}`.trim();
      sel.appendChild(opt);
    });
  }
}

// ── FILTER ─────────────────────────────────────────────────
window.setGrid = function (cols) {
  gridCols = cols;
  document.querySelectorAll(".epg-toggle-btn").forEach((b) => b.classList.remove("active"));
  const activeBtn = document.getElementById("btnGrid" + cols);
  if (activeBtn) activeBtn.classList.add("active");
  renderGallery();
};

window.setTypeFilter = function (btn, catId) {
  document.querySelectorAll(".epg-chip").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  activeCatId = catId;
  filterThisMonth = false;
  const sel = document.getElementById("epgCatSelect");
  if (sel) sel.value = catId;
  renderGallery();
};

window.toggleThisMonth = function (btn) {
  filterThisMonth = !filterThisMonth;
  // clear all chip active states then set correctly
  document.querySelectorAll(".epg-chip").forEach((b) => b.classList.remove("active"));
  if (filterThisMonth) {
    btn.classList.add("active");
  } else {
    // back to "ทั้งหมด"
    const allBtn = document.querySelector('.epg-chip[data-cat=""]');
    if (allBtn) allBtn.classList.add("active");
  }
  renderGallery();
};

window.setTypeFilterFromSelect = function (sel) {
  activeCatId = sel.value;
  document.querySelectorAll(".epg-chip").forEach((b) => {
    b.classList.toggle("active", b.dataset.cat === sel.value);
  });
  renderGallery();
};

// ── RENDER ─────────────────────────────────────────────────
function renderGallery() {
  const now = new Date();
  const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  let filtered = allEvents.filter((e) => {
    if (activeCatId && String(e.event_category_id) !== activeCatId) return false;
    if (filterThisMonth && e.event_date && e.event_date.slice(0, 7) !== curMonth) return false;
    return true;
  });

  document.getElementById("pageSubtitle").textContent =
    `${filtered.length} กิจกรรม`;

  const body = document.getElementById("galleryBody");

  if (!filtered.length) {
    body.innerHTML = `
      <div class="empty-state" style="padding: 60px 0">
        <div class="empty-icon">🖼️</div>
        <div class="empty-text">ไม่พบกิจกรรม</div>
      </div>`;
    return;
  }

  // จัดกลุ่มตามเดือน
  const groups = {};
  filtered.forEach((e) => {
    const key = e.event_date ? e.event_date.slice(0, 7) : "0000-00";
    if (!groups[key]) groups[key] = [];
    groups[key].push(e);
  });

  const sortedKeys = Object.keys(groups).sort().reverse();

  body.innerHTML = sortedKeys
    .map((key) => {
      const events = groups[key];
      const monthLabel = formatMonthLabel(key);
      const cards = events.map((e) => buildCard(e)).join("");
      return `
        <div class="epg-month-section">
          <div class="epg-month-header">
            <span class="epg-month-title">${monthLabel}</span>
            <span class="epg-month-count">${events.length} EVENTS</span>
          </div>
          <div class="epg-grid epg-grid-${gridCols}">
            ${cards}
          </div>
        </div>`;
    })
    .join("");

  // Trigger scroll reveal animation
  requestAnimationFrame(() => initScrollReveal());
}

// ── BUILD CARD ─────────────────────────────────────────────
function getCatInfo(e) {
  const cat = allCategories.find((c) => c.event_category_id === e.event_category_id);
  return {
    label: cat ? `${cat.icon || ""} ${cat.category_name}`.trim() : (e.event_type || ""),
    color: cat?.color || "#6366f1",
  };
}

function buildCard(e) {
  const day = e.event_date ? parseInt(e.event_date.split("-")[2]) : "??";
  const monthShort = e.event_date ? shortMonth(e.event_date.slice(5, 7)) : "";
  const { label: catLabel, color: catColor } = getCatInfo(e);
  const timeTxt = e.start_time ? e.start_time.slice(0, 5) : "";
  const location = e.location || "";

  // รวม image_urls ทั้งหมด หรือ fallback เป็น poster_url เดียว
  const allImgs = Array.isArray(e.image_urls) && e.image_urls.length
    ? e.image_urls
    : (e.poster_url ? [e.poster_url] : []);
  const urlsJson = JSON.stringify(allImgs).replace(/"/g, "&quot;");
  const mainImg = allImgs[0] || null;

  const imgCountBadge = allImgs.length > 1
    ? `<div class="epg-img-count">🖼️ ${allImgs.length}</div>`
    : "";

  const posterInner = mainImg
    ? `<img src="${mainImg}" alt="${e.event_name}"
         loading="lazy"
         onerror="this.parentElement.classList.add('epg-card-noposter'); this.remove();">`
    : `<div class="epg-noposter-inner">
         <span class="epg-noposter-icon">🗓️</span>
         <span class="epg-noposter-text">No Poster Available</span>
       </div>`;

  // Overlay chip colors: light translucent on dark background
  const chipBg = `${catColor}44`;
  const chipText = `#fff`;
  const chipBorder = `${catColor}66`;

  return `
    <div class="epg-card">
      <div class="epg-card-img ${!mainImg ? "epg-card-noposter" : ""}"
           ${mainImg ? `onclick="event.stopPropagation(); ImgPopup.open(${urlsJson}, 0)"` : ""}>
        <div class="epg-top-badges">
          <div class="epg-date-badge">
            <span class="epg-date-day">${day}</span>
            <span class="epg-date-mon">${monthShort}</span>
          </div>
        </div>
        ${imgCountBadge}
        ${posterInner}
        <div class="epg-card-body" onclick="event.stopPropagation(); window.location.href='./event-form.html?id=${e.event_id}'">
          <span class="epg-type-chip" style="background:${chipBg};color:${chipText};border-color:${chipBorder}">${catLabel}</span>
          <div class="epg-card-name">${e.event_name || "—"}</div>
          <div class="epg-card-meta">
            ${location ? `<span>📍 ${location}</span>` : ""}
            ${timeTxt ? `<span>🕐 ${timeTxt}</span>` : ""}
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
          entry.target.classList.add("epg-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.08, rootMargin: "0px 0px -40px 0px" }
  );
  document.querySelectorAll(".epg-card").forEach((card) => observer.observe(card));
}

// ── HELPERS ────────────────────────────────────────────────
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
