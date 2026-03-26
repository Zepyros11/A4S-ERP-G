/* ============================================================
   event-poster-gallery.js — Controller for Poster Gallery page
============================================================ */

import { fetchEvents } from "./events-api.js";

// ── STATE ──────────────────────────────────────────────────
let allEvents = [];
let gridCols = 5;

// ── INIT ───────────────────────────────────────────────────
async function initPage() {
  showLoading(true);
  try {
    allEvents = (await fetchEvents()) || [];
    renderGallery();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);

  document
    .getElementById("filterType")
    .addEventListener("change", renderGallery);
  document
    .getElementById("filterPoster")
    .addEventListener("change", renderGallery);
}

// ── GRID SIZE ──────────────────────────────────────────────
window.setGrid = function (n) {
  gridCols = n;
  document
    .querySelectorAll(".epg-toggle-btn")
    .forEach((b) => b.classList.remove("active"));
  document.getElementById(`btnGrid${n}`)?.classList.add("active");
  renderGallery();
};

// ── RENDER ─────────────────────────────────────────────────
function renderGallery() {
  const filterType = document.getElementById("filterType").value;
  const filterPoster = document.getElementById("filterPoster").value;

  let filtered = allEvents.filter((e) => {
    const matchType = !filterType || e.event_type === filterType;
    const matchPoster =
      filterPoster === "all"
        ? true
        : filterPoster === "has"
          ? !!e.poster_url
          : !e.poster_url;
    return matchType && matchPoster;
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

  const sortedKeys = Object.keys(groups).sort();

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
const typeMapLabel = {
  BOOTH: "BOOTH",
  MEETING: "MEETING",
  ONLINE: "ONLINE",
  HYBRID: "HYBRID",
  CONFERENCE: "CONF",
  OTHER: "OTHER",
};

function buildCard(e) {
  const day = e.event_date ? parseInt(e.event_date.split("-")[2]) : "??";
  const monthShort = e.event_date ? shortMonth(e.event_date.slice(5, 7)) : "";
  const typeLabel = typeMapLabel[e.event_type] || e.event_type || "";
  const timeTxt = e.start_time ? e.start_time.slice(0, 5) : "";
  const location = e.location || "";

  const posterInner = e.poster_url
    ? `<img src="${e.poster_url}" alt="${e.event_name}"
         loading="lazy"
         onclick="event.stopPropagation(); ImgPopup.open(['${e.poster_url}'], 0)"
         onerror="this.parentElement.classList.add('epg-card-noposter'); this.remove();">`
    : `<div class="epg-noposter-inner">
         <span class="epg-noposter-icon">🗓️</span>
         <span class="epg-noposter-text">No Poster Available</span>
       </div>`;

  return `
    <div class="epg-card" onclick="window.location.href='./event-form.html?id=${e.event_id}'">
      <div class="epg-card-img ${!e.poster_url ? "epg-card-noposter" : ""}">
        <div class="epg-date-badge">
          <span class="epg-date-day">${day}</span>
          <span class="epg-date-mon">${monthShort}</span>
        </div>
        ${posterInner}
      </div>
      <div class="epg-card-body">
        <span class="epg-type-chip epg-type-${e.event_type}">${typeLabel}</span>
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
  const enMonths = [
    "",
    "JANUARY",
    "FEBRUARY",
    "MARCH",
    "APRIL",
    "MAY",
    "JUNE",
    "JULY",
    "AUGUST",
    "SEPTEMBER",
    "OCTOBER",
    "NOVEMBER",
    "DECEMBER",
  ];
  return `${enMonths[parseInt(m)]} ${parseInt(y) + 543}`;
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
