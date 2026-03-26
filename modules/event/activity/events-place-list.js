/* ============================================================
   events-place-list.js — Controller for Place List page
============================================================ */

import { fetchPlaces, removePlace } from "./events-api.js";

// ── STATE ──────────────────────────────────────────────────
let allPlaces = [];
let sortKey = "place_name";
let sortAsc = true;

// ── INIT ───────────────────────────────────────────────────
async function initPage() {
  await loadData();
  bindEvents();
}

async function loadData() {
  showLoading(true);
  try {
    allPlaces = (await fetchPlaces()) || [];
    updateStatCards();
    filterTable();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

// ── BIND EVENTS ────────────────────────────────────────────
function bindEvents() {
  document.getElementById("searchInput")?.addEventListener("input", filterTable);
  document.getElementById("filterType")?.addEventListener("change", filterTable);
  document.getElementById("filterStatus")?.addEventListener("change", filterTable);
}

// ── STAT CARDS ─────────────────────────────────────────────
function updateStatCards() {
  document.getElementById("cardTotal").textContent = allPlaces.length;
  document.getElementById("cardActive").textContent = allPlaces.filter((p) => p.status === "ACTIVE").length;
  document.getElementById("cardHotel").textContent = allPlaces.filter((p) => p.place_type === "HOTEL").length;
  document.getElementById("cardEventSpace").textContent = allPlaces.filter((p) => p.place_type === "EVENT_SPACE").length;
}

// ── FILTER ─────────────────────────────────────────────────
function filterTable() {
  const search = document.getElementById("searchInput")?.value.toLowerCase() || "";
  const type = document.getElementById("filterType")?.value || "";
  const status = document.getElementById("filterStatus")?.value || "";

  const filtered = allPlaces.filter((p) => {
    const matchSearch =
      !search ||
      (p.place_name || "").toLowerCase().includes(search) ||
      (p.address || "").toLowerCase().includes(search);
    const matchType = !type || p.place_type === type;
    const matchStatus = !status || p.status === status;
    return matchSearch && matchType && matchStatus;
  });

  renderTable(filtered);
}

// ── SORT ───────────────────────────────────────────────────
window.sortTable = function (key) {
  if (sortKey === key) sortAsc = !sortAsc;
  else { sortKey = key; sortAsc = true; }
  filterTable();
};

// ── RENDER TABLE ───────────────────────────────────────────
function renderTable(places) {
  const sorted = [...places].sort((a, b) => {
    let av = a[sortKey] ?? "";
    let bv = b[sortKey] ?? "";
    if (typeof av === "string") av = av.toLowerCase();
    if (typeof bv === "string") bv = bv.toLowerCase();
    return sortAsc ? (av > bv ? 1 : -1) : av < bv ? 1 : -1;
  });

  const tbody = document.getElementById("tableBody");
  document.getElementById("tableCount").textContent = `${sorted.length} รายการ`;

  if (!sorted.length) {
    tbody.innerHTML = `
      <tr><td colspan="10">
        <div class="empty-state">
          <div class="empty-icon">📍</div>
          <div class="empty-text">ไม่พบสถานที่</div>
        </div>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = sorted.map((p) => {
    const coverCell = p.cover_image_url
      ? `<div class="place-cover-wrap">
           <img src="${p.cover_image_url}" alt="${p.place_name}"
             onclick="event.stopPropagation();ImgPopup.open(['${p.cover_image_url}'],0)"
             onerror="this.parentElement.innerHTML='<span style=\\'font-size:20px\\'>📍</span>'">
         </div>`
      : `<div class="place-cover-wrap"><span style="font-size:20px">📍</span></div>`;

    const mapCell = p.google_map_url
      ? `<a href="${p.google_map_url}" target="_blank" onclick="event.stopPropagation()" class="place-map-link">🗺️ Map</a>`
      : "—";

    return `<tr onclick="window.openPlacePanel(${p.place_id})">
      <td style="text-align:center" onclick="event.stopPropagation()">
        <input type="checkbox" class="row-check" value="${p.place_id}" onchange="window.updateDeleteButton()">
      </td>
      <td class="col-center">${coverCell}</td>
      <td>
        <div class="place-name">${p.place_name}</div>
        ${p.contact_name ? `<div class="place-sub">${p.contact_name}</div>` : ""}
      </td>
      <td class="col-center">
        <span class="place-type-badge ptype-${p.place_type}">${typeLabel(p.place_type)}</span>
      </td>
      <td><div class="place-address">${p.address || "—"}</div></td>
      <td>
        ${p.phone ? `<div class="place-sub">📞 ${p.phone}</div>` : ""}
        ${p.email ? `<div class="place-sub">✉️ ${p.email}</div>` : ""}
        ${!p.phone && !p.email ? "—" : ""}
      </td>
      <td class="col-center">${p.capacity ? `${p.capacity.toLocaleString()} คน` : "—"}</td>
      <td class="col-center">${p.has_parking ? "✅" : "—"}</td>
      <td class="col-center">
        <span class="place-status-badge pstatus-${p.status}">${p.status}</span>
      </td>
      <td class="col-center" onclick="event.stopPropagation()">
        <div class="action-group">
          <button class="btn-icon" onclick="window.openPlacePanel(${p.place_id})">✏️</button>
          <button class="btn-icon danger" onclick="window.deletePlace(${p.place_id})">🗑</button>
        </div>
      </td>
    </tr>`;
  }).join("");
}

// ── SIDE PANEL ─────────────────────────────────────────────
window.openPlacePanel = function (placeId) {
  const p = allPlaces.find((pl) => pl.place_id === placeId);
  if (!p) return;

  document.getElementById("panelCover").innerHTML = p.cover_image_url
    ? `<img src="${p.cover_image_url}" alt="${p.place_name}" style="width:100%;height:100%;object-fit:cover">`
    : `<span style="font-size:48px;opacity:0.3">📍</span>`;

  document.getElementById("panelName").textContent = p.place_name;
  document.getElementById("panelType").innerHTML =
    `<span class="place-type-badge ptype-${p.place_type}">${typeLabel(p.place_type)}</span>`;
  document.getElementById("panelStatus").innerHTML =
    `<span class="place-status-badge pstatus-${p.status}">${p.status}</span>`;
  document.getElementById("panelAddress").textContent = p.address || "—";
  document.getElementById("panelContact").textContent =
    [p.contact_name, p.phone].filter(Boolean).join(" · ") || "—";
  document.getElementById("panelEmail").textContent = p.email || "—";
  document.getElementById("panelCapacity").textContent = p.capacity
    ? `${p.capacity.toLocaleString()} คน`
    : "—";
  document.getElementById("panelRooms").textContent =
    `ห้องประชุม ${p.meeting_rooms || 0} · ห้องพัก ${p.rooms || 0}`;
  document.getElementById("panelMap").innerHTML = p.google_map_url
    ? `<a href="${p.google_map_url}" target="_blank" class="place-map-link">เปิด Google Map ↗</a>`
    : "—";
  document.getElementById("panelDesc").textContent = p.description || "—";

  document.getElementById("panelBtnEdit").onclick = () =>
    (window.location.href = `./events-place-form.html?id=${p.place_id}`);

  document.getElementById("plSidePanel").classList.add("open");
  document.getElementById("plPanelOverlay").style.display = "block";
};

window.closePlacePanel = function () {
  document.getElementById("plSidePanel").classList.remove("open");
  document.getElementById("plPanelOverlay").style.display = "none";
};

// ── DELETE ─────────────────────────────────────────────────
window.deletePlace = function (placeId) {
  const p = allPlaces.find((pl) => pl.place_id === placeId);
  if (!p) return;
  DeleteModal.open(`ต้องการลบสถานที่ "${p.place_name}" หรือไม่?`, async () => {
    showLoading(true);
    try {
      await removePlace(placeId);
      showToast("ลบสถานที่แล้ว", "success");
      await loadData();
    } catch (err) {
      showToast("ลบไม่สำเร็จ: " + err.message, "error");
    }
    showLoading(false);
  });
};

// ── BULK DELETE ────────────────────────────────────────────
function getSelected() {
  return Array.from(document.querySelectorAll(".row-check:checked")).map((c) => parseInt(c.value));
}

window.updateDeleteButton = function () {
  const btn = document.getElementById("btnDeleteSelected");
  if (btn) btn.style.display = getSelected().length ? "inline-flex" : "none";
};

window.toggleAllCheckbox = function (el) {
  document.querySelectorAll(".row-check").forEach((c) => (c.checked = el.checked));
  window.updateDeleteButton();
};

window.deleteSelectedPlaces = async function () {
  const ids = getSelected();
  if (!ids.length) return;
  DeleteModal.open(`ต้องการลบสถานที่ ${ids.length} รายการ หรือไม่?`, async () => {
    showLoading(true);
    try {
      for (const id of ids) await removePlace(id);
      showToast("ลบที่เลือกแล้ว", "success");
      await loadData();
    } catch (err) {
      showToast("ลบไม่สำเร็จ: " + err.message, "error");
    }
    showLoading(false);
  });
};

// ── HELPERS ────────────────────────────────────────────────
function typeLabel(t) {
  return (
    { HOTEL: "🏨 โรงแรม", MEETING_ROOM: "🏢 ห้องประชุม", RESTAURANT: "🍽 ร้านอาหาร", EVENT_SPACE: "🎤 Event Space" }[t] || t
  );
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