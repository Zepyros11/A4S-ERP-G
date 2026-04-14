/* ============================================================
   events-place-list.js — Controller for Place List page
============================================================ */

import { fetchPlaces, removePlace, updatePlace, fetchPlaceTypes } from "./events-api.js";

// ── STATE ──────────────────────────────────────────────────
let allPlaces = [];
let allPlaceTypes = [];
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
    [allPlaces, allPlaceTypes] = await Promise.all([
      fetchPlaces(),
      fetchPlaceTypes(),
    ]);
    allPlaces = allPlaces || [];
    allPlaceTypes = allPlaceTypes || [];
    updateStatCards();
    filterTable();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

// ── BIND EVENTS ────────────────────────────────────────────
function bindEvents() {
  document
    .getElementById("searchInput")
    ?.addEventListener("input", filterTable);
  document
    .getElementById("filterType")
    ?.addEventListener("change", filterTable);
  document
    .getElementById("filterStatus")
    ?.addEventListener("change", filterTable);
}

// ── STAT CARDS ─────────────────────────────────────────────
function updateStatCards() {
  document.getElementById("cardTotal").textContent = allPlaces.length;
  document.getElementById("cardActive").textContent = allPlaces.filter(
    (p) => p.status === "ACTIVE",
  ).length;
  document.getElementById("cardHotel").textContent = allPlaces.filter(
    (p) => p.place_type === "HOTEL",
  ).length;
  document.getElementById("cardEventSpace").textContent = allPlaces.filter(
    (p) => p.place_type === "EVENT_SPACE",
  ).length;
}

// ── FILTER ─────────────────────────────────────────────────
function filterTable() {
  const search =
    document.getElementById("searchInput")?.value.toLowerCase() || "";
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
  else {
    sortKey = key;
    sortAsc = true;
  }
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

  tbody.innerHTML = sorted
    .map((p) => {
      const imgs =
        p.image_urls && p.image_urls.length
          ? p.image_urls
          : p.cover_image_url
            ? [p.cover_image_url]
            : [];
      const imgListJson = JSON.stringify(imgs).replace(/"/g, "&quot;");
      const coverCell = imgs.length
        ? `<div class="place-cover-wrap">
       <img src="${imgs[0]}" alt="${p.place_name}"
         onclick="event.stopPropagation();ImgPopup.open(${imgListJson},0)"
         onerror="this.parentElement.innerHTML='<span style=\\'font-size:20px\\'>📍</span>'">
     </div>`
        : `<div class="place-cover-wrap"><span style="font-size:20px">📍</span></div>`;

      const mapCell = p.google_map_url
        ? `<a href="${p.google_map_url}" target="_blank" onclick="event.stopPropagation()" class="place-map-link">🗺️ Map</a>`
        : "—";

      return `<tr onclick="window.location.href='./events-place-form.html?id=${p.place_id}'">
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
      <td class="col-center" onclick="event.stopPropagation()">
        <button type="button"
          class="place-status-toggle pstatus-${p.status}"
          title="คลิกเพื่อสลับสถานะ"
          onclick="window.togglePlaceStatus(${p.place_id}, this)">
          ${p.status}
        </button>
      </td>
      <td class="col-center" onclick="event.stopPropagation()">
        <div class="action-group">
          <button class="btn-icon" onclick="window.location.href='./events-place-form.html?id=${p.place_id}'">✏️</button>
          <button class="btn-icon danger" onclick="window.deletePlace(${p.place_id})">🗑</button>
        </div>
      </td>
    </tr>`;
    })
    .join("");
}

// ── SIDE PANEL ─────────────────────────────────────────────
window._panelPlaceId = null;

window.openPlacePanel = function (placeId) {
  const p = allPlaces.find((pl) => pl.place_id === placeId);
  if (!p) return;

  window._panelPlaceId = placeId;

  // Cover image
  const panelImgs =
    p.image_urls && p.image_urls.length
      ? p.image_urls
      : p.cover_image_url
        ? [p.cover_image_url]
        : [];

  if (panelImgs.length) {
    const dots = panelImgs
      .map(
        (u, i) =>
          `<div class="place-panel-dot ${i === 0 ? "active" : ""}" onclick="window._panelGoto(${i})"></div>`,
      )
      .join("");
    document.getElementById("panelCover").innerHTML = `
    <div class="place-panel-gallery" id="panelGallery">
      ${panelImgs
        .map(
          (u, i) =>
            `<img src="${u}" class="place-panel-gimg ${i === 0 ? "active" : ""}"
          onclick="ImgPopup.open(${JSON.stringify(panelImgs)},${i})"
          style="cursor:pointer">`,
        )
        .join("")}
    </div>
    ${
      panelImgs.length > 1
        ? `
      <button class="place-panel-nav left" onclick="window._panelNav(-1)">‹</button>
      <button class="place-panel-nav right" onclick="window._panelNav(1)">›</button>
      <div class="place-panel-dots">${dots}</div>
    `
        : ""
    }
  `;
    window._panelImgIndex = 0;
    window._panelImgCount = panelImgs.length;
  } else {
    document.getElementById("panelCover").innerHTML =
      `<span style="font-size:48px;opacity:0.3">📍</span>`;
  }

  // Fill inputs
  document.getElementById("peqName").value = p.place_name || "";
  document.getElementById("peqType").value = p.place_type || "HOTEL";
  document.getElementById("peqStatus").value = p.status || "ACTIVE";
  document.getElementById("peqAddress").value = p.address || "";
  document.getElementById("peqContact").value = p.contact_name || "";
  document.getElementById("peqPhone").value = p.phone || "";
  document.getElementById("peqEmail").value = p.email || "";
  document.getElementById("peqCapacity").value = p.capacity || "";
  document.getElementById("peqMeetingRooms").value = p.meeting_rooms || "";
  document.getElementById("peqRooms").value = p.rooms || "";
  document.getElementById("peqParking").value =
    p.has_parking === true ? "true" : p.has_parking === false ? "false" : "";
  document.getElementById("peqMap").value = p.google_map_url || "";
  document.getElementById("peqDesc").value = p.description || "";

  document.getElementById("plSidePanel").classList.add("open");
  document.getElementById("plPanelOverlay").style.display = "block";
};
// ── TOGGLE STATUS ──────────────────────────────────────────
window.togglePlaceStatus = async function (placeId, btn) {
  const p = allPlaces.find((pl) => pl.place_id === placeId);
  if (!p) return;
  const newStatus = p.status === "ACTIVE" ? "INACTIVE" : "ACTIVE";
  btn.disabled = true;
  // Optimistic UI update
  btn.classList.remove("pstatus-ACTIVE", "pstatus-INACTIVE");
  btn.classList.add(`pstatus-${newStatus}`);
  btn.textContent = newStatus;
  try {
    await updatePlace(placeId, { status: newStatus });
    p.status = newStatus; // sync local state
    // Refresh stat cards that depend on ACTIVE count
    updateStatCards();
  } catch (err) {
    // Revert on failure
    btn.classList.remove("pstatus-ACTIVE", "pstatus-INACTIVE");
    btn.classList.add(`pstatus-${p.status}`);
    btn.textContent = p.status;
    showToast("เปลี่ยนสถานะไม่สำเร็จ: " + err.message, "error");
  } finally {
    btn.disabled = false;
  }
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
window.closePlacePanel = function () {
  document.getElementById("plSidePanel").classList.remove("open");
  document.getElementById("plPanelOverlay").style.display = "none";
};

// ── BULK DELETE ────────────────────────────────────────────
function getSelected() {
  return Array.from(document.querySelectorAll(".row-check:checked")).map((c) =>
    parseInt(c.value),
  );
}

window.updateDeleteButton = function () {
  const btn = document.getElementById("btnDeleteSelected");
  if (btn) btn.style.display = getSelected().length ? "inline-flex" : "none";
};

window.toggleAllCheckbox = function (el) {
  document
    .querySelectorAll(".row-check")
    .forEach((c) => (c.checked = el.checked));
  window.updateDeleteButton();
};

window.deleteSelectedPlaces = async function () {
  const ids = getSelected();
  if (!ids.length) return;
  DeleteModal.open(
    `ต้องการลบสถานที่ ${ids.length} รายการ หรือไม่?`,
    async () => {
      showLoading(true);
      try {
        for (const id of ids) await removePlace(id);
        showToast("ลบที่เลือกแล้ว", "success");
        await loadData();
      } catch (err) {
        showToast("ลบไม่สำเร็จ: " + err.message, "error");
      }
      showLoading(false);
    },
  );
};

// ── HELPERS ────────────────────────────────────────────────
function typeLabel(t) {
  const found = allPlaceTypes.find((pt) => pt.type_code === t);
  if (found) {
    const icon = found.icon || "";
    return `${icon} ${found.type_name}`.trim();
  }
  return (
    {
      HOTEL: "🏨 โรงแรม",
      MEETING_ROOM: "🏢 ห้องประชุม",
      RESTAURANT: "🍽 ร้านอาหาร",
      EVENT_SPACE: "🎤 Event Space",
    }[t] || t
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

// ── PLACE LIST MAP ──────────────────────────────────────────
let listMap = null;
let listMapVisible = false;

function parseLatLonFromUrl(url) {
  if (!url) return null;
  const m = url.match(/[?&@]q?=?([-\d.]+),([-\d.]+)/) || url.match(/@([-\d.]+),([-\d.]+)/);
  if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
  return null;
}

window.togglePlaceMap = function () {
  const container = document.getElementById("placeMapContainer");
  listMapVisible = !listMapVisible;
  container.style.display = listMapVisible ? "block" : "none";

  if (listMapVisible) {
    if (!listMap && typeof L !== "undefined") {
      listMap = L.map("placeListMap").setView([13.75, 100.5], 6);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap",
        maxZoom: 19,
      }).addTo(listMap);
    }
    // slight delay so container is rendered before invalidating
    setTimeout(() => {
      if (listMap) listMap.invalidateSize();
      renderMapPins();
    }, 200);
  }
};

function renderMapPins() {
  if (!listMap) return;
  // clear existing markers
  listMap.eachLayer((l) => { if (l instanceof L.Marker) listMap.removeLayer(l); });

  const bounds = [];
  allPlaces.forEach((p) => {
    const coords = parseLatLonFromUrl(p.google_map_url);
    if (!coords) return;
    const marker = L.marker([coords.lat, coords.lon]).addTo(listMap);
    marker.bindPopup(`<strong>${p.place_name}</strong>`);
    bounds.push([coords.lat, coords.lon]);
  });

  if (bounds.length > 0) {
    listMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }
}

// ── START ──────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPage);
} else {
  initPage();
}
// ── savePanelPlace  ────────────────────────────────────────────
window.savePanelPlace = async function () {
  const placeId = window._panelPlaceId;
  if (!placeId) return;

  const name = document.getElementById("peqName").value.trim();
  if (!name) {
    showToast("กรุณาระบุชื่อสถานที่", "error");
    return;
  }

  const payload = {
    place_name: name,
    place_type: document.getElementById("peqType").value,
    status: document.getElementById("peqStatus").value,
    address: document.getElementById("peqAddress").value.trim() || null,
    contact_name: document.getElementById("peqContact").value.trim() || null,
    phone: document.getElementById("peqPhone").value.trim() || null,
    email: document.getElementById("peqEmail").value.trim() || null,
    capacity: parseInt(document.getElementById("peqCapacity").value) || 0,
    meeting_rooms:
      parseInt(document.getElementById("peqMeetingRooms").value) || 0,
    has_parking:
      document.getElementById("peqParking").value === "true"
        ? true
        : document.getElementById("peqParking").value === "false"
          ? false
          : null,
    google_map_url: document.getElementById("peqMap").value.trim() || null,
    description: document.getElementById("peqDesc").value.trim() || null,
  };

  showLoading(true);
  try {
    await updatePlace(placeId, payload);
    showToast("บันทึกแล้ว", "success");
    await loadData();
    window.closePlacePanel();
  } catch (err) {
    showToast("บันทึกไม่สำเร็จ: " + err.message, "error");
  }
  showLoading(false);
};
window._panelNav = function (dir) {
  const imgs = document.querySelectorAll("#panelGallery .place-panel-gimg");
  const dots = document.querySelectorAll(".place-panel-dot");
  if (!imgs.length) return;
  imgs[window._panelImgIndex].classList.remove("active");
  if (dots[window._panelImgIndex])
    dots[window._panelImgIndex].classList.remove("active");
  window._panelImgIndex =
    (window._panelImgIndex + dir + window._panelImgCount) %
    window._panelImgCount;
  imgs[window._panelImgIndex].classList.add("active");
  if (dots[window._panelImgIndex])
    dots[window._panelImgIndex].classList.add("active");
};

window._panelGoto = function (idx) {
  const imgs = document.querySelectorAll("#panelGallery .place-panel-gimg");
  const dots = document.querySelectorAll(".place-panel-dot");
  if (!imgs.length) return;
  imgs[window._panelImgIndex].classList.remove("active");
  if (dots[window._panelImgIndex])
    dots[window._panelImgIndex].classList.remove("active");
  window._panelImgIndex = idx;
  imgs[idx].classList.add("active");
  if (dots[idx]) dots[idx].classList.add("active");
};
