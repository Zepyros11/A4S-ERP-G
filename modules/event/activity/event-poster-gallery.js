/* ============================================================
   event-poster-gallery.js — Controller for Poster Gallery page
============================================================ */

import { fetchEvents, fetchEventCategories } from "./events-api.js";

// ── STATE ──────────────────────────────────────────────────
let allEvents = [];
let allCategories = [];
let gridCols = 5;
let activeCatId = "";

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

  document.getElementById("filterPoster").addEventListener("change", renderGallery);
}

function renderCategoryChips() {
  const wrap = document.getElementById("filterChipsWrap");
  // remove old dynamic chips (keep first "ทั้งหมด" and last poster-filter div)
  const allChipBtn = wrap.querySelector('[data-cat=""]');
  const posterDiv = wrap.querySelector('div[style]');
  wrap.innerHTML = "";
  wrap.appendChild(allChipBtn);

  allCategories.forEach((cat) => {
    const btn = document.createElement("button");
    btn.className = "epg-chip";
    btn.dataset.cat = cat.event_category_id;
    btn.textContent = `${cat.icon || ""} ${cat.category_name}`.trim();
    btn.onclick = () => window.setTypeFilter(btn, String(cat.event_category_id));
    wrap.appendChild(btn);
  });

  if (posterDiv) wrap.appendChild(posterDiv);
}

// ── GRID SIZE ──────────────────────────────────────────────
window.setTypeFilter = function (btn, catId) {
  document.querySelectorAll(".epg-chip").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  activeCatId = catId;
  renderGallery();
};

// ── RENDER ─────────────────────────────────────────────────
function renderGallery() {
  const filterPoster = document.getElementById("filterPoster").value;

  let filtered = allEvents.filter((e) => {
    const matchCat = !activeCatId || String(e.event_category_id) === activeCatId;
    const matchPoster =
      filterPoster === "all"
        ? true
        : filterPoster === "has"
          ? !!e.poster_url
          : !e.poster_url;
    return matchCat && matchPoster;
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
         onclick="event.stopPropagation(); ImgPopup.open(${urlsJson}, 0)"
         onerror="this.parentElement.classList.add('epg-card-noposter'); this.remove();">`
    : `<div class="epg-noposter-inner">
         <span class="epg-noposter-icon">🗓️</span>
         <span class="epg-noposter-text">No Poster Available</span>
       </div>`;

  return `
    <div class="epg-card" onclick="window.location.href='./event-form.html?id=${e.event_id}'">
      <div class="epg-card-img ${!e.poster_url ? "epg-card-noposter" : ""}">
        <div class="epg-top-badges">
          <div class="epg-date-badge">
            <span class="epg-date-day">${day}</span>
            <span class="epg-date-mon">${monthShort}</span>
          </div>
          ${imgCountBadge}
        </div>
        ${posterInner}
      </div>
      <div class="epg-card-body">
        <span class="epg-type-chip" style="background:${catColor}22;color:${catColor};border-color:${catColor}55">${catLabel}</span>
        <div class="epg-card-name">${e.event_name || "—"}</div>
        <div class="epg-card-meta">
          ${location ? `<span>📍 ${location}</span>` : ""}
          ${timeTxt ? `<span>🕐 ${timeTxt}</span>` : ""}
        </div>
      </div>
    </div>`;
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
