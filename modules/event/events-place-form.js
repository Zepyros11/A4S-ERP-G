/* ============================================================
   events-place-form.js — Controller for Place Form page
============================================================ */

import { createPlace, fetchPlaceById, updatePlace, fetchPlaceRooms, upsertPlaceRooms, fetchPlaceRoomTypes, upsertPlaceRoomTypes, fetchPlaceTypes, createPlaceType, updatePlaceType, removePlaceType } from "./events-api.js";
import { withLoading } from "../../js/components/ui/loadingButton.js";
import { openIconPicker, renderIcon } from "../../js/components/ui/iconPicker.js";

// ── IMAGE COMPRESSION ──
function compressImage(file, maxWidth = 1200, quality = 0.8) {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/")) { resolve(file); return; }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width, h = img.height;
      if (w <= maxWidth) { resolve(file); return; }
      h = Math.round(h * (maxWidth / w));
      w = maxWidth;
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      canvas.toBlob((blob) => {
        resolve(new File([blob], file.name, { type: file.type, lastModified: Date.now() }));
      }, file.type, quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

// ── LEAFLET MAP ──
let placeMap = null;
let placeMarker = null;

function parseLatLonFromUrl(url) {
  if (!url) return null;
  // match patterns like ?q=lat,lon or @lat,lon or ll=lat,lon
  const m = url.match(/[?&@]q?=?([-\d.]+),([-\d.]+)/) || url.match(/@([-\d.]+),([-\d.]+)/);
  if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
  return null;
}

function initMapPreview(lat, lon) {
  if (typeof L === "undefined") return;
  const container = document.getElementById("mapPreview");
  if (!container) return;

  if (!placeMap) {
    placeMap = L.map(container).setView([lat || 13.75, lon || 100.5], lat ? 15 : 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19,
    }).addTo(placeMap);

    // click to pick location
    placeMap.on("click", (e) => {
      const { lat, lng } = e.latlng;
      setMapMarker(lat, lng);
      document.getElementById("fLat").value = lat;
      document.getElementById("fLon").value = lng;
      document.getElementById("fMap").value = `https://www.google.com/maps?q=${lat},${lng}`;
    });
  }

  if (lat && lon) {
    setMapMarker(lat, lon);
    placeMap.setView([lat, lon], 15);
  }
}

function setMapMarker(lat, lon) {
  if (!placeMap) return;
  if (placeMarker) placeMarker.setLatLng([lat, lon]);
  else placeMarker = L.marker([lat, lon]).addTo(placeMap);
  document.getElementById("fLat").value = lat;
  document.getElementById("fLon").value = lon;
}

// ── PLACE SEARCH (OpenStreetMap Nominatim) ──
window.searchPlace = async function () {
  const input = document.getElementById("placeSearchInput");
  const results = document.getElementById("placeSearchResults");
  const q = (input?.value || "").trim();
  if (!q) { results.innerHTML = ""; return; }

  results.innerHTML = '<div class="place-search-loading">🔍 กำลังค้นหา...</div>';

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=5&countrycodes=th&accept-language=th`;
    const res = await fetch(url, { headers: { "User-Agent": "A4S-ERP/1.0" } });
    const data = await res.json();

    if (!data.length) {
      results.innerHTML = '<div class="place-search-loading">ไม่พบผลลัพธ์ — ลองค้นหาด้วยคำอื่น</div>';
      return;
    }

    results.innerHTML = data.map((p, i) => {
      const addr = p.address || {};
      const province = addr.state || addr.city || addr.county || "";
      const district = addr.suburb || addr.town || addr.village || "";
      const fullAddr = p.display_name || "";
      const type = p.type ? p.type.replace(/_/g, " ") : "";
      return `
        <div class="place-result-item" data-idx="${i}">
          <div style="font-size:20px;flex-shrink:0;padding-top:2px">📍</div>
          <div style="flex:1;min-width:0">
            <div class="place-result-name">${p.name || q}</div>
            <div class="place-result-addr">${fullAddr}</div>
            ${type ? `<div class="place-result-type">${type}</div>` : ""}
          </div>
        </div>
      `;
    }).join("");

    // Bind click
    results.querySelectorAll("[data-idx]").forEach((el) => {
      el.addEventListener("click", () => {
        const p = data[parseInt(el.dataset.idx)];
        fillPlaceFromSearch(p);
        results.innerHTML = "";
        input.value = "";
      });
    });
  } catch (e) {
    results.innerHTML = '<div class="place-search-loading">เกิดข้อผิดพลาด: ' + e.message + '</div>';
  }
};

function fillPlaceFromSearch(p) {
  const addr = p.address || {};

  // ชื่อสถานที่
  document.getElementById("fPlaceName").value = p.name || "";

  // ที่อยู่
  const parts = [addr.road, addr.suburb, addr.town || addr.village, addr.city_district, addr.city, addr.state].filter(Boolean);
  const postcode = addr.postcode || "";
  document.getElementById("fAddress").value = parts.join(" ") + (postcode ? " " + postcode : "");

  // จังหวัด
  const province = addr.state || addr.city || "";
  document.getElementById("fProvince").value = province;

  // auto-fill ภูมิภาค
  if (typeof autoFillRegion === "function") autoFillRegion(province);

  // Google Map URL from coordinates + map preview
  if (p.lat && p.lon) {
    const lat = parseFloat(p.lat), lon = parseFloat(p.lon);
    document.getElementById("fMap").value = `https://www.google.com/maps?q=${lat},${lon}`;
    initMapPreview(lat, lon);
  }

  // Fetch extra details from Nominatim (phone, website, stars)
  if (p.osm_type && p.osm_id) {
    const typeChar = p.osm_type === "relation" ? "R" : p.osm_type === "way" ? "W" : "N";
    fetch(`https://nominatim.openstreetmap.org/details?osmtype=${typeChar}&osmid=${p.osm_id}&format=json&addressdetails=1&extratags=1`, {
      headers: { "User-Agent": "A4S-ERP/1.0" },
    }).then(r => r.json()).then(detail => {
      const tags = detail.extratags || {};
      if (tags.phone && !document.getElementById("fPhone").value) {
        document.getElementById("fPhone").value = tags.phone;
      }
      if (tags.website && !document.getElementById("fWebsite").value) {
        document.getElementById("fWebsite").value = tags.website;
      }
      if (tags.stars && !document.getElementById("fRating").value) {
        const stars = parseInt(tags.stars);
        if (stars >= 2 && stars <= 5) document.getElementById("fRating").value = stars;
      }
    }).catch(() => {}); // best-effort
  }

  // Wikimedia thumbnail (best-effort)
  if (p.name) {
    fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(p.name)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        const wrap = document.getElementById("wikiThumbWrap");
        if (data?.thumbnail?.source && wrap) {
          document.getElementById("wikiThumbImg").src = data.thumbnail.source;
          document.getElementById("wikiThumbLabel").textContent = data.description || data.title || "";
          wrap.style.display = "flex";
        }
      }).catch(() => {});
  }
}

// Enter key to search
document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("placeSearchInput");
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); window.searchPlace(); }
    });
  }
});

// ── REVERSE GEOCODE FROM GOOGLE MAPS URL ──
async function reverseGeocodeAndFill(lat, lon, url) {
  // 1. parse place name from URL (/place/Hotel+Name/)
  const placeMatch = url.match(/\/place\/([^/@]+)/);
  if (placeMatch) {
    const nameFromUrl = decodeURIComponent(placeMatch[1].replace(/\+/g, " "));
    const currentName = document.getElementById("fPlaceName").value.trim();
    if (!currentName) {
      document.getElementById("fPlaceName").value = nameFromUrl;
    }
  }

  // 2. reverse geocode with Nominatim
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1&accept-language=th`, {
      headers: { "User-Agent": "A4S-ERP/1.0" }
    });
    const data = await res.json();
    if (!data || data.error) return;

    const addr = data.address || {};

    // fill address if empty
    const fAddress = document.getElementById("fAddress");
    if (fAddress && !fAddress.value.trim()) {
      const parts = [addr.road, addr.suburb, addr.town || addr.village, addr.city_district, addr.city, addr.state].filter(Boolean);
      const postcode = addr.postcode || "";
      fAddress.value = parts.join(" ") + (postcode ? " " + postcode : "");
    }

    // fill province if empty
    const fProvince = document.getElementById("fProvince");
    const province = addr.state || addr.city || "";
    if (fProvince && !fProvince.value.trim() && province) {
      fProvince.value = province;
      if (typeof autoFillRegion === "function") autoFillRegion(province);
    }

    // fill name from Nominatim if still empty
    const fName = document.getElementById("fPlaceName");
    if (fName && !fName.value.trim() && data.name) {
      fName.value = data.name;
    }
  } catch (e) {
    // silent fail
  }

  // 3. search Overpass API for POI details (phone, website, email) near coordinates
  try {
    const radius = 50; // meters
    const overpassQuery = `[out:json][timeout:10];(node["tourism"~"hotel|guest_house|hostel|motel"](around:${radius},${lat},${lon});node["amenity"~"hotel|restaurant|conference_centre"](around:${radius},${lat},${lon});way["tourism"~"hotel|guest_house"](around:${radius},${lat},${lon});way["amenity"~"hotel|conference_centre"](around:${radius},${lat},${lon}););out tags;`;
    const ovRes = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: "data=" + encodeURIComponent(overpassQuery),
    });
    const ovData = await ovRes.json();
    const elements = ovData.elements || [];

    if (elements.length > 0) {
      // pick first match
      const tags = elements[0].tags || {};

      // phone
      const phone = tags.phone || tags["contact:phone"] || "";
      if (phone && !document.getElementById("fPhone").value.trim()) {
        document.getElementById("fPhone").value = phone;
      }

      // website
      const website = tags.website || tags["contact:website"] || tags.url || "";
      if (website && !document.getElementById("fWebsite").value.trim()) {
        document.getElementById("fWebsite").value = website;
      }

      // email
      const email = tags.email || tags["contact:email"] || "";
      if (email && !document.getElementById("fEmail").value.trim()) {
        document.getElementById("fEmail").value = email;
      }

      // rating/stars
      const stars = tags.stars || "";
      if (stars && !document.getElementById("fRating").value) {
        const starNum = parseInt(stars);
        if (starNum >= 2 && starNum <= 5) {
          document.getElementById("fRating").value = String(starNum);
        }
      }

      // name (more accurate from POI)
      const fName = document.getElementById("fPlaceName");
      if (tags.name && fName) {
        const thName = tags["name:th"] || tags.name;
        fName.value = thName;
      }
    }
  } catch (e) {
    // silent fail — Overpass is best-effort
  }
}

// sync map link button
function syncMapLink() {
  const url = document.getElementById("fMap")?.value.trim() || "";
  const btn = document.getElementById("btnOpenMap");
  if (btn) btn.href = url || "#";
}
// observe fMap changes
new MutationObserver(syncMapLink).observe(document.body, { childList: true, subtree: true });
setInterval(syncMapLink, 1000);

// ── STATE ─────────────────────────────────
let editId = null;
let roomRows = [];
let accomRows = []; // accommodation room types
let gallery = { exterior: [], food: [] };
let docFiles = []; // [{url, name, file}]

// ── INIT ──────────────────────────────────
async function initPage() {
  const params = new URLSearchParams(window.location.search);
  editId = params.get("id") ? parseInt(params.get("id")) : null;

  if (editId) {
    const titleEl = document.querySelector(".toolbar div div");
    if (titleEl) {
      titleEl.innerHTML = `
        <div style="font-size:18px;font-weight:700">📍 แก้ไขสถานที่</div>
        <div style="font-size:12px;color:var(--text3)">Place ID: ${editId}</div>
      `;
    }
    await loadPlaceData();
  } else {
    renderAllGalleries();
  }
}

// ── LOAD DATA ─────────────────────────────
async function loadPlaceData() {
  showLoading(true);
  try {
    const p = await fetchPlaceById(editId);
    if (!p) {
      showToast("ไม่พบข้อมูล", "error");
      showLoading(false);
      return;
    }

    document.getElementById("fPlaceName").value = p.place_name || "";
    document.getElementById("fPlaceType").value = p.place_type || "";
    // description field removed
    document.getElementById("fAddress").value = p.address || "";
    document.getElementById("fMap").value = p.google_map_url || "";
    // init map from existing URL
    const coords = parseLatLonFromUrl(p.google_map_url);
    if (coords) {
      setTimeout(() => initMapPreview(coords.lat, coords.lon), 300);
    } else {
      setTimeout(() => initMapPreview(), 300);
    }
    document.getElementById("fContactName").value = p.contact_name || "";
    document.getElementById("fPhone").value = p.phone || "";
    document.getElementById("fEmail").value = p.email || "";

    document.getElementById("fParking").checked = p.has_parking === true;
    const statusEl = document.getElementById("fStatus");
    statusEl.checked = p.status !== "INACTIVE";
    document.getElementById("fStatusLabel").textContent = statusEl.checked ? "ACTIVE" : "INACTIVE";

    // new fields
    document.getElementById("fRegion").value = p.region || "";
    document.getElementById("fProvince").value = p.province || "";
    document.getElementById("fRating").value = p.rating || "";
    document.getElementById("fLineId").value = p.line_id || "";
    document.getElementById("fWebsite").value = p.website || "";
    document.getElementById("fTaxId").value = p.tax_id || "";
    // meeting rates now per-room
    document.getElementById("fTerms").value = p.terms_notes || "";

    // amenities checkboxes (both equipment + facilities)
    const amenities = p.amenities || [];
    document.querySelectorAll(".facility-toggles input[type=checkbox]").forEach((cb) => {
      if (cb.id === "fParking") return; // parking handled separately
      cb.checked = amenities.includes(cb.value);
    });

    // load accommodation room types
    const accom = await fetchPlaceRoomTypes(editId);
    accomRows = (accom || []).map((r) => ({
      ...r,
      _images: (r.image_urls || []).map((u) => ({ url: u })),
    }));
    if (accomRows.length > 0) {
      document.getElementById("chkAccom").checked = true;
      window.toggleSection("accomBody", true);
    }
    renderAccomRows();

    // load meeting rooms
    const rooms = await fetchPlaceRooms(editId);
    roomRows = (rooms || []).map((r) => ({
      ...r,
      _images: (r.image_urls || []).map((u) => ({ url: u })),
    }));
    const hasMeeting = roomRows.length > 0 || p.capacity > 0 || p.meeting_rate_min;
    if (hasMeeting) {
      document.getElementById("chkMeeting").checked = true;
      window.toggleSection("meetingBody", true);
    }
    renderRooms();

    // โหลดรูปตามหมวด — image_urls เก็บเป็น object {exterior:[], room:[], food:[]}
    // backward compat: ถ้าเป็น array เดิม → ใส่ใน exterior
    const imgs = p.image_urls || [];
    if (Array.isArray(imgs) && imgs.length > 0 && typeof imgs[0] === "string") {
      // old format: plain array of URLs
      gallery.exterior = imgs.map((u) => ({ url: u }));
    } else if (imgs && typeof imgs === "object" && !Array.isArray(imgs)) {
      gallery.exterior = (imgs.exterior || []).map((u) => ({ url: u }));
      gallery.food = (imgs.food || []).map((u) => ({ url: u }));
    }
    renderAllGalleries();

    // โหลดเอกสาร
    docFiles = (p.document_urls || []).map((u) => ({ url: u, name: u.split("/").pop() }));
    renderDocList();
  } catch (err) {
    showToast("โหลดข้อมูลไม่ได้: " + err.message, "error");
  }
  showLoading(false);
}

// ── GALLERY RENDER ────────────────────────
function renderAllGalleries() {
  ["exterior", "food"].forEach(renderGallery);
  updateTabCounts();
}

// ── BIND GRID DROP (add files) ──────────────────────
function bindGridDrop(grid, imageArray, limit, onDrop) {
  if (grid._dropBound) return;
  grid._dropBound = true;
  grid.addEventListener("dragover", (e) => { e.preventDefault(); grid.classList.add("grid-drag-over"); });
  grid.addEventListener("dragleave", (e) => { if (!grid.contains(e.relatedTarget)) grid.classList.remove("grid-drag-over"); });
  grid.addEventListener("drop", (e) => {
    e.preventDefault(); grid.classList.remove("grid-drag-over");
    const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith("image/"));
    if (!files.length) return;
    const remaining = limit - imageArray.length;
    files.slice(0, remaining).forEach(f => imageArray.push({ file: f }));
    onDrop();
  });
}

function renderGallery(cat) {
  const grid = document.getElementById(`grid-${cat}`);
  if (!grid) return;
  grid.innerHTML = "";
  const items = gallery[cat] || [];
  const limit = IMG_LIMITS[cat];

  // render filled slots
  items.forEach((item, idx) => {
    const src = item.file ? URL.createObjectURL(item.file) : item.url;
    const slot = document.createElement("div");
    slot.className = "place-slot filled";
    slot.innerHTML = `
      <img src="${src}" />
      <button class="place-remove" onclick="event.stopPropagation();window.removeGalleryImg('${cat}',${idx})">✕</button>
    `;
    grid.appendChild(slot);
  });

  // render empty slots
  for (let i = items.length; i < limit; i++) {
    const slot = document.createElement("div");
    slot.className = "place-slot empty";
    slot.innerHTML = '<div class="place-slot-inner"><span class="place-slot-icon">+</span></div>';
    slot.addEventListener("click", () => window.addImageSlot(cat));
    grid.appendChild(slot);
  }

  // grid-level drag & drop for adding files
  bindGridDrop(grid, gallery[cat], limit, () => { renderGallery(cat); updateTabCounts(); });
}

window.addImageSlot = function (cat) {
  if (gallery[cat].length >= IMG_LIMITS[cat]) {
    showToast(`เพิ่มได้สูงสุด ${IMG_LIMITS[cat]} รูปต่อหมวด`, "error");
    return;
  }
  const input = document.getElementById("fileInput");
  input.dataset.cat = cat;
  input.value = "";
  input.click();
};

window.removeGalleryImg = function (cat, idx) {
  gallery[cat].splice(idx, 1);
  renderGallery(cat);
  updateTabCounts();
};

// ── DOC LIST ─────────────────────────────
function renderDocList() {
  const list = document.getElementById("docList");
  if (!list) return;
  list.innerHTML = "";
  docFiles.forEach((d, idx) => {
    const row = document.createElement("div");
    row.className = "doc-row";
    const name = d.name || d.file?.name || "document";
    const ext = name.split(".").pop().toLowerCase();
    const icon = ext === "pdf" ? "📄" : ext === "xlsx" ? "📊" : "📎";
    row.innerHTML = `
      ${icon} <span class="doc-name">${d.url ? `<a href="${d.url}" target="_blank">${name}</a>` : name}</span>
      <button class="btn-icon-sm" type="button" onclick="window.removeDoc(${idx})">✕</button>
    `;
    list.appendChild(row);
  });
}

window.addDocSlot = function () {
  if (docFiles.length >= DOC_LIMIT) {
    showToast(`เพิ่มได้สูงสุด ${DOC_LIMIT} ไฟล์`, "error");
    return;
  }
  const input = document.getElementById("docInput");
  input.value = "";
  input.click();
};

window.removeDoc = function (idx) {
  docFiles.splice(idx, 1);
  renderDocList();
};

// ── TAB SWITCH ───────────────────────────
window.switchImgTab = function (tab, btn) {
  document.querySelectorAll(".img-tab").forEach((t) => t.classList.remove("active"));
  document.querySelectorAll(".img-tab-panel").forEach((p) => p.classList.remove("active"));
  btn.classList.add("active");
  const panel = document.getElementById(`panel-${tab}`);
  if (panel) panel.classList.add("active");
};

const IMG_LIMITS = { exterior: 10, food: 10 };
const ACCOM_IMG_LIMIT = 5;
const DOC_LIMIT = 5;

function updateTabCounts() {
  ["exterior", "food"].forEach((cat) => {
    const el = document.getElementById(`cnt-${cat}`);
    if (el) el.textContent = `${gallery[cat].length}/${IMG_LIMITS[cat]}`;
  });
  const docEl = document.getElementById("cnt-docs");
  if (docEl) docEl.textContent = `${docFiles.length}/${DOC_LIMIT}`;
}

// ── VALIDATE ─────────────────────────────
function validate() {
  const name = document.getElementById("fPlaceName").value.trim();
  const type = document.getElementById("fPlaceType").value;
  if (!name) {
    showToast("กรุณาระบุชื่อสถานที่", "error");
    return false;
  }
  if (!type) {
    showToast("กรุณาเลือกประเภทสถานที่", "error");
    return false;
  }
  return true;
}

// ── SAVE ─────────────────────────────────
window.savePlace = async function () {
  if (!validate()) return;
  showLoading(true);
  try {
    // amenities (from both equipment + facilities)
    const amenities = [];
    document.querySelectorAll(".facility-toggles input[type=checkbox]:checked").forEach((cb) => {
      if (cb.id === "fParking") return; // parking handled separately
      amenities.push(cb.value);
    });

    const payload = {
      place_name: document.getElementById("fPlaceName").value.trim(),
      place_type: document.getElementById("fPlaceType").value,
      address: document.getElementById("fAddress").value.trim() || null,
      province: document.getElementById("fProvince").value.trim() || null,
      region: document.getElementById("fRegion").value || null,
      google_map_url: document.getElementById("fMap").value.trim() || null,
      contact_name: document.getElementById("fContactName").value.trim() || null,
      phone: document.getElementById("fPhone").value.trim() || null,
      email: document.getElementById("fEmail").value.trim() || null,
      line_id: document.getElementById("fLineId").value.trim() || null,
      website: document.getElementById("fWebsite").value.trim() || null,
      tax_id: document.getElementById("fTaxId").value.trim() || null,
      rating: parseFloat(document.getElementById("fRating").value) || null,
      meeting_rooms: collectRoomsFromForm().length,
      has_parking: document.getElementById("fParking").checked,
      status: document.getElementById("fStatus").checked ? "ACTIVE" : "INACTIVE",
      amenities: amenities.length > 0 ? amenities : null,
      terms_notes: document.getElementById("fTerms").value.trim() || null,
    };

    let placeId = editId;
    if (editId) {
      await updatePlace(editId, payload);
    } else {
      // duplicate detection
      const { url: sbUrl, key: sbKey } = getSB();
      const dupRes = await fetch(`${sbUrl}/rest/v1/places?place_name=eq.${encodeURIComponent(payload.place_name)}&select=place_id,place_name&limit=1`, {
        headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` },
      });
      const dups = await dupRes.json();
      if (dups && dups.length > 0) {
        const proceed = confirm(`สถานที่ชื่อ '${payload.place_name}' มีอยู่แล้ว ต้องการบันทึกซ้ำหรือไม่?`);
        if (!proceed) { showLoading(false); return; }
      }
      const res = await createPlace(payload);
      placeId = res?.place_id;
    }

    // ── Upload gallery images ──────────────
    if (placeId) {
      const imageData = {};
      let coverUrl = null;
      for (const cat of ["exterior", "food"]) {
        const urls = [];
        for (let i = 0; i < gallery[cat].length; i++) {
          const item = gallery[cat][i];
          if (item.file) {
            const uploaded = await uploadPlaceImage(placeId, item.file, `${cat}_${i}`);
            urls.push(uploaded);
          } else if (item.url) {
            urls.push(item.url);
          }
        }
        imageData[cat] = urls;
        if (!coverUrl && urls.length > 0) coverUrl = urls[0];
      }

      // Upload documents
      const docUrls = [];
      for (let i = 0; i < docFiles.length; i++) {
        const d = docFiles[i];
        if (d.file) {
          const uploaded = await uploadPlaceImage(placeId, d.file, `doc_${i}`);
          docUrls.push(uploaded);
        } else if (d.url) {
          docUrls.push(d.url);
        }
      }

      await patchPlace(placeId, {
        image_urls: imageData,
        cover_image_url: coverUrl,
        document_urls: docUrls.length > 0 ? docUrls : null,
      });
    }

    // ── Save sub-rooms + accommodation types ──
    if (placeId) {
      const roomsData = collectRoomsFromForm();
      const accomData = collectAccomFromForm();
      // upload accom images
      for (let a = 0; a < accomData.length; a++) {
        const imgs = accomRows[a]?._images || [];
        const urls = [];
        for (let i = 0; i < imgs.length; i++) {
          if (imgs[i].file) {
            const uploaded = await uploadPlaceImage(placeId, imgs[i].file, `accom_${a}_${i}`);
            urls.push(uploaded);
          } else if (imgs[i].url) {
            urls.push(imgs[i].url);
          }
        }
        accomData[a].image_urls = urls.length > 0 ? urls : null;
      }
      // upload room images (meeting rooms)
      for (let r = 0; r < roomsData.length; r++) {
        const imgs = roomRows[r]?._images || [];
        const urls = [];
        for (let i = 0; i < imgs.length; i++) {
          if (imgs[i].file) {
            const uploaded = await uploadPlaceImage(placeId, imgs[i].file, `room_${r}_${i}`);
            urls.push(uploaded);
          } else if (imgs[i].url) {
            urls.push(imgs[i].url);
          }
        }
        roomsData[r].image_urls = urls.length > 0 ? urls : null;
      }
      await Promise.all([
        upsertPlaceRooms(placeId, roomsData),
        upsertPlaceRoomTypes(placeId, accomData),
      ]);
    }

    showToast(editId ? "บันทึกการแก้ไขแล้ว" : "บันทึกสถานที่แล้ว", "success");
    setTimeout(() => {
      window.location.href = "./events-place-list.html";
    }, 1200);
  } catch (err) {
    showToast("บันทึกไม่สำเร็จ: " + err.message, "error");
  }
  showLoading(false);
};

// ── UPLOAD ────────────────────────────────
async function uploadPlaceImage(placeId, file, index) {
  const { url, key } = getSB();
  const ext = file.name.split(".").pop().toLowerCase();
  const fileName = `place_${placeId}_${index}_${Date.now()}.${ext}`;
  const path = `places/${fileName}`;
  const res = await fetch(`${url}/storage/v1/object/event-files/${path}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": file.type,
      "x-upsert": "true",
    },
    body: file,
  });
  if (!res.ok) throw new Error("Upload failed");
  return `${url}/storage/v1/object/public/event-files/${path}`;
}

async function patchPlace(placeId, data) {
  const { url, key } = getSB();
  await fetch(`${url}/rest/v1/places?place_id=eq.${placeId}`, {
    method: "PATCH",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(data),
  });
}

// ── ACCOMMODATION ROOM TYPES ─────────────
function renderAccomRows() {
  const container = document.getElementById("accomContainer");
  if (!container) return;
  container.innerHTML = "";
  accomRows.forEach((r, idx) => {
    container.appendChild(buildAccomCard(r, idx));
    renderAccomImages(idx);
    // bind file input
    const input = container.querySelector(`.accom-file-input[data-idx="${idx}"]`);
    if (input) input.addEventListener("change", async (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      if (!accomRows[idx]._images) accomRows[idx]._images = [];
      const remaining = ACCOM_IMG_LIMIT - accomRows[idx]._images.length;
      const toAdd = files.slice(0, remaining);
      if (files.length > remaining) showToast(`เพิ่มได้อีก ${remaining} รูป`, "error");
      for (const f of toAdd) {
        const compressed = await compressImage(f);
        accomRows[idx]._images.push({ file: compressed });
      }
      renderAccomImages(idx);
    });
  });
}

function renderAccomImages(idx) {
  const grid = document.getElementById(`accom-grid-${idx}`);
  if (!grid) return;
  const images = accomRows[idx]?._images || [];
  grid.innerHTML = "";
  images.forEach((item, i) => {
    const src = item.file ? URL.createObjectURL(item.file) : item.url;
    const slot = document.createElement("div");
    slot.className = "place-slot filled";
    slot.innerHTML = `
      <img src="${src}" />
      <button class="place-remove" onclick="event.stopPropagation();window.removeAccomImage(${idx},${i})">✕</button>
    `;
    grid.appendChild(slot);
  });
  // empty slots
  for (let i = images.length; i < ACCOM_IMG_LIMIT; i++) {
    const slot = document.createElement("div");
    slot.className = "place-slot empty";
    slot.innerHTML = '<div class="place-slot-inner"><span class="place-slot-icon">+</span></div>';
    slot.addEventListener("click", () => window.addAccomImage(idx));
    grid.appendChild(slot);
  }
  // grid-level drag & drop for adding files
  bindGridDrop(grid, accomRows[idx]._images || [], ACCOM_IMG_LIMIT, () => renderAccomImages(idx));
  const cnt = document.getElementById(`accom-cnt-${idx}`);
  if (cnt) cnt.textContent = `${images.length}/${ACCOM_IMG_LIMIT}`;
}

window.addAccomImage = function (idx) {
  if (!accomRows[idx]._images) accomRows[idx]._images = [];
  if (accomRows[idx]._images.length >= ACCOM_IMG_LIMIT) {
    showToast(`เพิ่มได้สูงสุด ${ACCOM_IMG_LIMIT} รูป`, "error");
    return;
  }
  const input = document.querySelector(`.accom-file-input[data-idx="${idx}"]`);
  if (input) { input.value = ""; input.click(); }
};

window.removeAccomImage = function (idx, imgIdx) {
  if (accomRows[idx]?._images) {
    accomRows[idx]._images.splice(imgIdx, 1);
    renderAccomImages(idx);
  }
};

function buildAccomCard(r, idx) {
  const card = document.createElement("div");
  card.className = "room-card";
  card.innerHTML = `
    <div class="room-card-header">
      <strong>ประเภทที่ ${idx + 1}</strong>
      <button class="btn-icon-sm" type="button" onclick="window.removeAccom(${idx})">✕</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
      <div class="ef-field">
        <label class="ef-label">ชื่อประเภทห้อง</label>
        <input class="ef-input accom-f" data-idx="${idx}" data-key="room_type_name" value="${r.room_type_name || ""}" placeholder="เช่น Deluxe, Superior, Suite" />
      </div>
      <div class="ef-field">
        <label class="ef-label">ห้องสำหรับ</label>
        <div style="display:flex;gap:4px">
          <select class="ef-input accom-f room-for-select" data-idx="${idx}" data-key="room_for" style="flex:1">
            <option value="">— เลือก —</option>
            ${getRoomForOptions(r.room_for)}
          </select>
          <button class="btn btn-outline" type="button" onclick="window.openRoomForManager()" title="จัดการตัวเลือก" style="padding:6px 8px;flex-shrink:0;font-size:12px">⚙️</button>
        </div>
      </div>
      <div class="ef-field">
        <label class="ef-label">ประเภทเตียง</label>
        <div class="bed-type-toggle">
          <label class="bed-type-option ${r.bed_type === "SINGLE" ? "active" : ""}">
            <input type="radio" name="bed_type_${idx}" class="accom-f" data-idx="${idx}" data-key="bed_type" value="SINGLE" ${r.bed_type === "SINGLE" ? "checked" : ""}>
            <span>🛏️ เตียงเดี่ยว</span>
          </label>
          <label class="bed-type-option ${r.bed_type === "DOUBLE" ? "active" : ""}">
            <input type="radio" name="bed_type_${idx}" class="accom-f" data-idx="${idx}" data-key="bed_type" value="DOUBLE" ${r.bed_type === "DOUBLE" ? "checked" : ""}>
            <span>🛏️ เตียงคู่</span>
          </label>
        </div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
      <div class="ef-field">
        <label class="ef-label">ราคาห้อง /คืน</label>
        <input class="ef-input accom-f" data-idx="${idx}" data-key="rate_per_night" type="number" value="${r.rate_per_night || ""}" placeholder="เช่น 1,500" />
      </div>
      <div class="ef-field">
        <label class="ef-label">คนสูงสุด/ห้อง</label>
        <input class="ef-input accom-f" data-idx="${idx}" data-key="max_guests" type="number" value="${r.max_guests || 2}" />
      </div>
      <div class="ef-field">
        <label class="ef-label">ขนาด (ตร.ม.)</label>
        <input class="ef-input accom-f" data-idx="${idx}" data-key="room_size_sqm" type="number" value="${r.room_size_sqm || ""}" />
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
      <div class="ef-field">
        <label class="ef-label">Extra Bed / คน</label>
        <input class="ef-input accom-f" data-idx="${idx}" data-key="rate_extra_bed" type="number" value="${r.rate_extra_bed || ""}" placeholder="เช่น 1000" />
      </div>
      <div class="ef-field">
        <label class="ef-label">รวมอาหารเช้า</label>
        <select class="ef-input accom-f" data-idx="${idx}" data-key="breakfast_included">
          <option value="true" ${r.breakfast_included !== false ? "selected" : ""}>✅ รวม</option>
          <option value="false" ${r.breakfast_included === false ? "selected" : ""}>❌ ไม่รวม</option>
        </select>
      </div>
      <div class="ef-field">
        <label class="ef-label">หมายเหตุ</label>
        <input class="ef-input accom-f" data-idx="${idx}" data-key="description" value="${r.description || ""}" placeholder="เช่น King Bed, Balcony, WiFi" />
      </div>
    </div>
    <div class="ef-field">
      <label class="ef-label">🖼️ รูปห้อง (สูงสุด 5 รูป) <span class="accom-img-count" id="accom-cnt-${idx}">${(r._images || []).length}/5</span></label>
      <div class="place-img-grid accom-img-grid" id="accom-grid-${idx}"></div>
      <input type="file" class="accom-file-input" data-idx="${idx}" accept="image/*" multiple style="display:none" />
    </div>
  `;
  return card;
}

function collectAccomFromForm() {
  const items = [];
  const inputs = document.querySelectorAll(".accom-f");
  const map = {};
  inputs.forEach((el) => {
    const idx = parseInt(el.dataset.idx);
    const key = el.dataset.key;
    if (!map[idx]) map[idx] = {};
    // skip unchecked radio buttons
    if (el.type === "radio" && !el.checked) return;
    const numKeys = ["rate_per_night", "max_guests", "room_size_sqm", "rate_extra_bed"];
    if (numKeys.includes(key)) {
      map[idx][key] = parseFloat(el.value) || null;
    } else if (key === "breakfast_included") {
      map[idx][key] = el.value === "true";
    } else {
      map[idx][key] = el.value.trim() || null;
    }
  });
  Object.keys(map).sort((a, b) => a - b).forEach((k) => {
    if (map[k].room_type_name) items.push(map[k]);
  });
  return items;
}

// ── ROOM FOR (ห้องสำหรับ) ─────────────────────
const DEFAULT_ROOM_FOR = ["พักเดี่ยว", "พักคู่", "ครอบครัว", "หมู่คณะ"];

function loadRoomForList() {
  const stored = localStorage.getItem("room_for_options");
  return stored ? JSON.parse(stored) : [...DEFAULT_ROOM_FOR];
}

function saveRoomForList(list) {
  localStorage.setItem("room_for_options", JSON.stringify(list));
}

function getRoomForOptions(selected) {
  return loadRoomForList().map((opt) =>
    `<option value="${opt}" ${selected === opt ? "selected" : ""}>${opt}</option>`
  ).join("");
}

function refreshRoomForDropdowns() {
  document.querySelectorAll(".room-for-select").forEach((sel) => {
    const current = sel.value;
    sel.innerHTML = `<option value="">— เลือก —</option>${getRoomForOptions(current)}`;
    if (current) sel.value = current;
  });
}

window.openRoomForManager = function () {
  let modal = document.getElementById("rfModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "rfModal";
    modal.className = "pt-modal-overlay";
    document.body.appendChild(modal);
  }

  const items = loadRoomForList();
  const rows = items.map((item, i) => `
    <div class="pt-row" data-idx="${i}">
      <input class="ef-input rf-name" value="${item}" placeholder="ชื่อตัวเลือก" style="flex:1" />
      <button class="btn-icon-sm rf-del" type="button">🗑</button>
    </div>
  `).join("");

  modal.innerHTML = `
    <div class="pt-modal">
      <div class="pt-modal-header">
        <strong>จัดการตัวเลือก "ห้องสำหรับ"</strong>
        <button class="btn-icon-sm" onclick="document.getElementById('rfModal').classList.remove('show')">✕</button>
      </div>
      <div class="pt-modal-body">
        <div class="pt-list" id="rfList">${rows}</div>
        <button class="btn btn-outline" type="button" id="rfAddBtn" style="margin-top:8px">＋ เพิ่มตัวเลือก</button>
      </div>
      <div class="pt-modal-footer">
        <button class="btn btn-primary" type="button" id="rfSaveBtn">💾 บันทึก</button>
      </div>
    </div>
  `;

  modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("show"); });

  modal.querySelector("#rfAddBtn").addEventListener("click", () => {
    const list = modal.querySelector("#rfList");
    const div = document.createElement("div");
    div.className = "pt-row";
    div.innerHTML = `
      <input class="ef-input rf-name" value="" placeholder="ชื่อตัวเลือก" style="flex:1" />
      <button class="btn-icon-sm rf-del" type="button">🗑</button>
    `;
    div.querySelector(".rf-del").addEventListener("click", () => div.remove());
    list.appendChild(div);
    div.querySelector(".rf-name").focus();
  });

  modal.querySelectorAll(".rf-del").forEach((btn) => {
    btn.addEventListener("click", () => btn.closest(".pt-row").remove());
  });

  modal.querySelector("#rfSaveBtn").addEventListener("click", () => {
    const names = Array.from(modal.querySelectorAll(".rf-name"))
      .map((el) => el.value.trim())
      .filter(Boolean);
    saveRoomForList(names);
    refreshRoomForDropdowns();
    modal.classList.remove("show");
  });

  modal.classList.add("show");
};

window.addAccom = function () {
  accomRows.push({ room_type_name: "", bed_type: "", max_guests: 2, breakfast_included: true });
  renderAccomRows();
  const container = document.getElementById("accomContainer");
  if (container) container.lastElementChild?.scrollIntoView({ behavior: "smooth" });
};

window.removeAccom = function (idx) {
  accomRows.splice(idx, 1);
  renderAccomRows();
};

// ── SUB-ROOMS (meeting) ─────────────────
const ROOM_IMG_LIMIT = 10;

function renderRooms() {
  const container = document.getElementById("roomsContainer");
  if (!container) return;
  container.innerHTML = "";
  roomRows.forEach((r, idx) => {
    container.appendChild(buildRoomCard(r, idx));
    renderRoomImages(idx);
  });
  bindRoomImageInputs();
}

function renderRoomImages(idx) {
  const grid = document.getElementById(`room-img-grid-${idx}`);
  if (!grid) return;
  const images = roomRows[idx]?._images || [];
  grid.innerHTML = "";
  images.forEach((item, i) => {
    const src = item.file ? URL.createObjectURL(item.file) : item.url;
    const slot = document.createElement("div");
    slot.className = "place-slot filled";
    slot.innerHTML = `
      <img src="${src}" />
      <button class="place-remove" onclick="event.stopPropagation();window.removeRoomImage(${idx},${i})">✕</button>
    `;
    grid.appendChild(slot);
  });
  for (let i = images.length; i < ROOM_IMG_LIMIT; i++) {
    const slot = document.createElement("div");
    slot.className = "place-slot empty";
    slot.innerHTML = '<div class="place-slot-inner"><span class="place-slot-icon">+</span></div>';
    slot.addEventListener("click", () => window.addRoomImage(idx));
    grid.appendChild(slot);
  }
  // grid-level drag & drop for adding files
  bindGridDrop(grid, roomRows[idx]._images || [], ROOM_IMG_LIMIT, () => renderRoomImages(idx));
  const cnt = document.getElementById(`room-cnt-${idx}`);
  if (cnt) cnt.textContent = `${images.length}/${ROOM_IMG_LIMIT}`;
}

window.addRoomImage = function (idx) {
  if (!roomRows[idx]._images) roomRows[idx]._images = [];
  if (roomRows[idx]._images.length >= ROOM_IMG_LIMIT) {
    showToast(`เพิ่มได้สูงสุด ${ROOM_IMG_LIMIT} รูป`, "error");
    return;
  }
  const input = document.getElementById(`room-img-input-${idx}`);
  input.value = "";
  input.click();
};

window.removeRoomImage = function (idx, imgIdx) {
  roomRows[idx]._images.splice(imgIdx, 1);
  renderRoomImages(idx);
};

function bindRoomImageInputs() {
  document.querySelectorAll(".room-img-file-input").forEach(function(input) {
    if (input._bound) return;
    input._bound = true;
    input.addEventListener("change", async function(e) {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      const idx = parseInt(input.dataset.idx);
      if (!roomRows[idx]._images) roomRows[idx]._images = [];
      const remaining = ROOM_IMG_LIMIT - roomRows[idx]._images.length;
      const toAdd = files.slice(0, remaining);
      for (const f of toAdd) {
        const compressed = await compressImage(f);
        roomRows[idx]._images.push({ file: compressed });
      }
      renderRoomImages(idx);
    });
  });
}

function buildRoomCard(r, idx) {
  const card = document.createElement("div");
  card.className = "room-card";
  card.innerHTML = `
    <div class="room-card-header">
      <strong>ห้อง ${idx + 1}</strong>
      <button class="btn-icon-sm" type="button" onclick="window.removeRoom(${idx})">✕</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
      <div class="ef-field">
        <label class="ef-label">ชื่อห้อง</label>
        <input class="ef-input room-f" data-idx="${idx}" data-key="room_name" value="${r.room_name || ""}" placeholder="เช่น Ballroom A" />
      </div>
      <div class="ef-field">
        <label class="ef-label">ชั้น</label>
        <input class="ef-input room-f" data-idx="${idx}" data-key="floor" value="${r.floor || ""}" placeholder="เช่น 4" />
      </div>
      <div class="ef-field">
        <label class="ef-label">ความจุ (คน)</label>
        <input class="ef-input room-f" data-idx="${idx}" data-key="capacity" type="number" value="${r.capacity || ""}" placeholder="เช่น 200" />
      </div>
    </div>
    <div class="ef-field">
      <label class="ef-label">รายละเอียดเพิ่มเติม</label>
      <input class="ef-input room-f" data-idx="${idx}" data-key="description" value="${r.description || ""}" placeholder="เช่น มีเสาแต่ไม่บัง, มีแสงธรรมชาติ" />
    </div>
    <div class="ef-field">
      <label class="ef-label">สิ่งอำนวยความสะดวก</label>
      <div class="room-amenity-toggles">
        ${[
          { val: "projector", icon: "📽️", label: "Projector" },
          { val: "led_screen", icon: "📺", label: "LED Screen" },
          { val: "mic", icon: "🎤", label: "ไมค์/เครื่องเสียง" },
          { val: "wifi", icon: "📶", label: "WiFi" },
          { val: "stage", icon: "🎭", label: "เวที" },
          { val: "backdrop", icon: "🖼️", label: "Backdrop" },
          { val: "whiteboard", icon: "📋", label: "Whiteboard" },
          { val: "air_con", icon: "❄️", label: "แอร์" },
        ].map((a) => `
          <label class="facility-toggle-item compact">
            <div class="toggle-switch toggle-sm"><input type="checkbox" class="room-amenity-cb" data-idx="${idx}" value="${a.val}" ${(r.amenities || []).includes(a.val) ? "checked" : ""}><span class="toggle-slider"></span></div>
            <span>${a.icon} ${a.label}</span>
          </label>
        `).join("")}
      </div>
    </div>
    <div class="ef-field">
      <label class="ef-label">📐 รูปห้อง (สูงสุด 10 รูป) <span class="room-img-count" id="room-cnt-${idx}">${(r._images || []).length}/10</span></label>
      <div class="place-img-grid accom-img-grid" id="room-img-grid-${idx}"></div>
      <input type="file" id="room-img-input-${idx}" class="room-img-file-input" data-idx="${idx}" accept="image/*" multiple style="display:none" />
    </div>
  `;

  return card;
}

function buildFloorplanPreview(r, idx) {
  if (r._floorplan) {
    var fpHtml = r._floorplan.type === "pdf"
      ? '<a href="' + r._floorplan.url + '" target="_blank" class="room-fp-file">📄 ' + (r._floorplan.name || "Floor Plan.pdf") + '</a>'
      : '<img src="' + r._floorplan.url + '" class="room-fp-img" />';
    return '<div class="room-fp-preview">' + fpHtml + '<button class="room-fp-delete" type="button" onclick="window.removeFloorplan(' + idx + ')">✕</button></div>';
  }
  return '<div class="place-slot empty" style="width:120px;height:90px;aspect-ratio:auto" onclick="document.getElementById(\'fp-input-' + idx + '\').click()"><div class="place-slot-inner"><span class="place-slot-icon">+</span></div></div>';
}

function bindFloorplanInputs() {
  document.querySelectorAll(".room-fp-input").forEach(function(fpInput) {
    if (fpInput._bound) return;
    fpInput._bound = true;
    fpInput.addEventListener("change", function(e) {
      var file = e.target.files[0];
      if (!file) return;
      var i = parseInt(fpInput.dataset.idx);
      var isPdf = file.type === "application/pdf";
      var url = URL.createObjectURL(file);
      if (!roomRows[i]) return;
      roomRows[i]._floorplan = { file: file, url: url, name: file.name, type: isPdf ? "pdf" : "image" };
      var area = document.getElementById("room-fp-" + i);
      area.innerHTML = buildFloorplanPreview(roomRows[i], i);
    });
  });
}

window.removeFloorplan = function (idx) {
  if (roomRows[idx]) roomRows[idx]._floorplan = null;
  const area = document.getElementById(`room-fp-${idx}`);
  if (area) {
    area.innerHTML = `<button class="btn btn-outline btn-sm" type="button" onclick="document.getElementById('fp-input-${idx}').click()">＋ เพิ่มไฟล์</button>`;
  }
};

function collectRoomsFromForm() {
  const rooms = [];
  const inputs = document.querySelectorAll(".room-f");
  const map = {};
  inputs.forEach((el) => {
    const idx = parseInt(el.dataset.idx);
    const key = el.dataset.key;
    if (!map[idx]) map[idx] = {};
    const numKeys = ["width_m","length_m","height_m","area_sqm","cap_theatre","cap_classroom","cap_u_shape","cap_banquet","cap_cocktail","cap_boardroom","meeting_rate","package_rate","coffee_rate","meal_rate"];
    if (numKeys.includes(key)) {
      map[idx][key] = parseFloat(el.value) || null;
    } else {
      map[idx][key] = el.value.trim() || null;
    }
  });
  // collect room amenities
  document.querySelectorAll(".room-amenity-cb:checked").forEach((cb) => {
    const idx = parseInt(cb.dataset.idx);
    if (!map[idx]) map[idx] = {};
    if (!map[idx].amenities) map[idx].amenities = [];
    map[idx].amenities.push(cb.value);
  });
  Object.keys(map).sort((a,b) => a - b).forEach((k) => {
    if (map[k].room_name) rooms.push(map[k]);
  });
  return rooms;
}

function syncRoomFormToState() {
  document.querySelectorAll(".room-f").forEach((el) => {
    const idx = parseInt(el.dataset.idx);
    const key = el.dataset.key;
    if (!roomRows[idx]) return;
    if (el.type === "number") {
      roomRows[idx][key] = parseFloat(el.value) || null;
    } else {
      roomRows[idx][key] = el.value.trim() || null;
    }
  });
  // sync amenities
  roomRows.forEach((r, idx) => { r.amenities = []; });
  document.querySelectorAll(".room-amenity-cb:checked").forEach((cb) => {
    const idx = parseInt(cb.dataset.idx);
    if (roomRows[idx]) roomRows[idx].amenities.push(cb.value);
  });
}

window.addRoom = function () {
  syncRoomFormToState();
  roomRows.push({ room_name: "", floor: "", capacity: 0, _images: [], amenities: [] });
  renderRooms();
  // scroll to bottom
  const container = document.getElementById("roomsContainer");
  if (container) container.lastElementChild?.scrollIntoView({ behavior: "smooth" });
};

window.removeRoom = function (idx) {
  syncRoomFormToState();
  roomRows.splice(idx, 1);
  renderRooms();
};

// ── UTILS ────────────────────────────────
function getSB() {
  return {
    url: localStorage.getItem("sb_url") || "",
    key: localStorage.getItem("sb_key") || "",
  };
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

// ── PLACE TYPES ──────────────────────────
let allPlaceTypes = [];

async function loadPlaceTypes() {
  allPlaceTypes = await fetchPlaceTypes();
  renderPlaceTypeSelect();
}

function iconToEmoji(icon) {
  if (!icon) return "";
  // ถ้าเป็น iconify name → แปลงเป็น emoji fallback
  if (icon.includes(":")) {
    const emojiMap = {
      "fluent-emoji-flat:bust-in-silhouette": "👤",
      "fluent-emoji-flat:busts-in-silhouette": "👥",
      "fluent-emoji-flat:crown": "👑",
      "fluent-emoji-flat:shield": "🛡",
      "fluent-emoji-flat:key": "🔑",
      "fluent-emoji-flat:locked": "🔒",
      "fluent-emoji-flat:wrench": "🔧",
      "fluent-emoji-flat:hammer": "🔨",
      "fluent-emoji-flat:gear": "⚙️",
      "fluent-emoji-flat:briefcase": "💼",
      "fluent-emoji-flat:clipboard": "📋",
      "fluent-emoji-flat:chart-increasing": "📈",
      "fluent-emoji-flat:trophy": "🏆",
      "fluent-emoji-flat:star": "⭐",
      "fluent-emoji-flat:rocket": "🚀",
      "fluent-emoji-flat:direct-hit": "🎯",
      "fluent-emoji-flat:department-store": "🏬",
      "fluent-emoji-flat:delivery-truck": "🚚",
      "fluent-emoji-flat:package": "📦",
      "fluent-emoji-flat:receipt": "🧾",
      "fluent-emoji-flat:bell": "🔔",
      "fluent-emoji-flat:light-bulb": "💡",
      "fluent-emoji-flat:house": "🏠",
      "fluent-emoji-flat:office-building": "🏢",
      "fluent-emoji-flat:hotel": "🏨",
      "fluent-emoji-flat:fork-and-knife": "🍽",
      "fluent-emoji-flat:microphone": "🎤",
      "fluent-emoji-flat:calendar": "📅",
      "fluent-emoji-flat:money-bag": "💰",
      "fluent-emoji-flat:globe-showing-asia-australia": "🌏",
    };
    return emojiMap[icon] || "🏷";
  }
  return icon;
}

function renderPlaceTypeSelect() {
  const sel = document.getElementById("fPlaceType");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">— เลือกประเภท —</option>';
  allPlaceTypes.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t.type_code;
    opt.textContent = `${iconToEmoji(t.icon)} ${t.type_name}`.trim();
    sel.appendChild(opt);
  });
  if (current) sel.value = current;
}

window.openPlaceTypeManager = function () {
  let modal = document.getElementById("ptModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "ptModal";
    modal.className = "pt-modal-overlay";
    document.body.appendChild(modal);
  }
  renderPTModal();
  modal.classList.add("show");
};

function bindPTRowEvents(container) {
  container.querySelectorAll(".pt-del").forEach((btn) => {
    btn.addEventListener("click", () => btn.closest(".pt-row").remove());
  });
  container.querySelectorAll(".pt-icon-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = btn.closest(".pt-row");
      const hiddenInput = row.querySelector(".pt-icon");
      const preview = btn.querySelector(".pt-icon-preview");
      openIconPicker({
        current: hiddenInput.value,
        onPick: (icon) => {
          hiddenInput.value = icon;
          preview.innerHTML = renderIcon(icon, 20);
        },
      });
    });
  });
}

function renderPTModal() {
  const modal = document.getElementById("ptModal");
  const rows = allPlaceTypes.map((t) => `
    <div class="pt-row" data-id="${t.type_id}">
      <button class="pt-icon-btn" type="button" title="เลือก icon">
        <span class="pt-icon-preview">${renderIcon(t.icon || "❓", 20)}</span>
      </button>
      <input class="pt-icon" type="hidden" value="${t.icon || ""}" />
      <input class="ef-input pt-code" value="${t.type_code || ""}" placeholder="CODE" style="width:120px" />
      <input class="ef-input pt-name" value="${t.type_name || ""}" placeholder="ชื่อ" style="flex:1" />
      <input class="ef-input pt-sort" type="number" value="${t.sort_order || 0}" style="width:50px" />
      <button class="btn-icon-sm pt-del" type="button">🗑</button>
    </div>
  `).join("");

  modal.innerHTML = `
    <div class="pt-modal">
      <div class="pt-modal-header">
        <strong>จัดการประเภทสถานที่</strong>
        <button class="btn-icon-sm" onclick="document.getElementById('ptModal').classList.remove('show')">✕</button>
      </div>
      <div class="pt-modal-body">
        <div class="pt-list">${rows}</div>
        <button class="btn btn-outline" type="button" id="ptAddBtn" style="margin-top:8px">＋ เพิ่มประเภท</button>
      </div>
      <div class="pt-modal-footer">
        <button class="btn btn-primary" type="button" id="ptSaveBtn">💾 บันทึก</button>
      </div>
    </div>
  `;

  // bind events
  modal.querySelector(".pt-modal-overlay, .pt-modal")?.addEventListener("click", (e) => e.stopPropagation());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.classList.remove("show"); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && modal.classList.contains("show")) modal.classList.remove("show"); });

  modal.querySelector("#ptAddBtn").addEventListener("click", () => {
    const list = modal.querySelector(".pt-list");
    const div = document.createElement("div");
    div.className = "pt-row";
    div.dataset.id = "new";
    div.innerHTML = `
      <button class="pt-icon-btn" type="button" title="เลือก icon">
        <span class="pt-icon-preview">${renderIcon("❓", 20)}</span>
      </button>
      <input class="pt-icon" type="hidden" value="" />
      <input class="ef-input pt-code" value="" placeholder="CODE" style="width:120px" />
      <input class="ef-input pt-name" value="" placeholder="ชื่อ" style="flex:1" />
      <input class="ef-input pt-sort" type="number" value="${allPlaceTypes.length + 1}" style="width:50px" />
      <button class="btn-icon-sm pt-del" type="button">🗑</button>
    `;
    list.appendChild(div);
    bindPTRowEvents(div);
    div.querySelector(".pt-code").focus();
  });

  bindPTRowEvents(modal);

  modal.querySelector("#ptSaveBtn").addEventListener("click", function () {
    withLoading(this, savePlaceTypes, { text: "กำลังบันทึก...", successText: "บันทึกแล้ว!" });
  });
}

async function savePlaceTypes() {
  const modal = document.getElementById("ptModal");
  const rows = modal.querySelectorAll(".pt-row");
  const oldIds = allPlaceTypes.map((t) => t.type_id);
  const keepIds = [];
  const updates = [];
  const creates = [];
  const deletes = [];

  for (const row of rows) {
    const id = row.dataset.id;
    const icon = row.querySelector(".pt-icon").value.trim();
    const code = row.querySelector(".pt-code").value.trim().toUpperCase();
    const name = row.querySelector(".pt-name").value.trim();
    const sort = parseInt(row.querySelector(".pt-sort").value) || 0;
    if (!code || !name) continue;
    const data = { type_code: code, type_name: name, icon, sort_order: sort };

    if (id && id !== "new") {
      const tid = parseInt(id);
      keepIds.push(tid);
      updates.push(updatePlaceType(tid, data));
    } else {
      creates.push(createPlaceType(data));
    }
  }

  for (const old of oldIds) {
    if (!keepIds.includes(old)) deletes.push(removePlaceType(old));
  }

  await Promise.all([...updates, ...creates, ...deletes]);
  await loadPlaceTypes();
  modal.classList.remove("show");
}

// ── TOGGLE SECTIONS ──────────────────────
window.toggleSection = function (bodyId, show) {
  const body = document.getElementById(bodyId);
  if (body) body.style.display = show ? "block" : "none";
  // auto add first row if empty
  if (show) {
    if (bodyId === "accomBody" && accomRows.length === 0) window.addAccom();
    if (bodyId === "meetingBody" && roomRows.length === 0) window.addRoom();
  }
};

// ── PROVINCE AUTOCOMPLETE ─────────────────
const PROVINCES = [
  "กรุงเทพมหานคร","กระบี่","กาญจนบุรี","กาฬสินธุ์","กำแพงเพชร","ขอนแก่น","จันทบุรี","ฉะเชิงเทรา",
  "ชลบุรี","ชัยนาท","ชัยภูมิ","ชุมพร","เชียงราย","เชียงใหม่","ตรัง","ตราด","ตาก","นครนายก","นครปฐม",
  "นครพนม","นครราชสีมา","นครศรีธรรมราช","นครสวรรค์","นนทบุรี","นราธิวาส","น่าน","บึงกาฬ","บุรีรัมย์",
  "ปทุมธานี","ประจวบคีรีขันธ์","ปราจีนบุรี","ปัตตานี","พระนครศรีอยุธยา","พะเยา","พังงา","พัทลุง",
  "พิจิตร","พิษณุโลก","เพชรบุรี","เพชรบูรณ์","แพร่","ภูเก็ต","มหาสารคาม","มุกดาหาร","แม่ฮ่องสอน",
  "ยโสธร","ยะลา","ร้อยเอ็ด","ระนอง","ระยอง","ราชบุรี","ลพบุรี","ลำปาง","ลำพูน","เลย","ศรีสะเกษ",
  "สกลนคร","สงขลา","สตูล","สมุทรปราการ","สมุทรสงคราม","สมุทรสาคร","สระแก้ว","สระบุรี","สิงห์บุรี",
  "สุโขทัย","สุพรรณบุรี","สุราษฎร์ธานี","สุรินทร์","หนองคาย","หนองบัวลำภู","อ่างทอง","อำนาจเจริญ",
  "อุดรธานี","อุตรดิตถ์","อุทัยธานี","อุบลราชธานี",
];

const PROVINCE_REGION = {
  "กรุงเทพมหานคร": "กรุงเทพฯ",
  "นนทบุรี": "ปริมณฑล", "ปทุมธานี": "ปริมณฑล", "สมุทรปราการ": "ปริมณฑล", "นครปฐม": "ปริมณฑล", "สมุทรสาคร": "ปริมณฑล", "สมุทรสงคราม": "ปริมณฑล",
  "กาญจนบุรี": "ภาคกลาง", "กำแพงเพชร": "ภาคกลาง", "ชัยนาท": "ภาคกลาง", "นครนายก": "ภาคกลาง", "นครสวรรค์": "ภาคกลาง",
  "ลพบุรี": "ภาคกลาง", "พระนครศรีอยุธยา": "ภาคกลาง", "พิจิตร": "ภาคกลาง", "พิษณุโลก": "ภาคกลาง", "เพชรบูรณ์": "ภาคกลาง",
  "ราชบุรี": "ภาคกลาง", "สระบุรี": "ภาคกลาง", "สิงห์บุรี": "ภาคกลาง", "สุโขทัย": "ภาคกลาง", "สุพรรณบุรี": "ภาคกลาง",
  "อ่างทอง": "ภาคกลาง", "อุทัยธานี": "ภาคกลาง", "เพชรบุรี": "ภาคกลาง", "ประจวบคีรีขันธ์": "ภาคกลาง",
  "เชียงใหม่": "ภาคเหนือ", "เชียงราย": "ภาคเหนือ", "ลำปาง": "ภาคเหนือ", "ลำพูน": "ภาคเหนือ", "แม่ฮ่องสอน": "ภาคเหนือ",
  "น่าน": "ภาคเหนือ", "พะเยา": "ภาคเหนือ", "แพร่": "ภาคเหนือ", "อุตรดิตถ์": "ภาคเหนือ", "ตาก": "ภาคเหนือ",
  "กาฬสินธุ์": "ภาคอีสาน", "ขอนแก่น": "ภาคอีสาน", "ชัยภูมิ": "ภาคอีสาน", "นครพนม": "ภาคอีสาน", "นครราชสีมา": "ภาคอีสาน",
  "บึงกาฬ": "ภาคอีสาน", "บุรีรัมย์": "ภาคอีสาน", "มหาสารคาม": "ภาคอีสาน", "มุกดาหาร": "ภาคอีสาน", "ยโสธร": "ภาคอีสาน",
  "ร้อยเอ็ด": "ภาคอีสาน", "เลย": "ภาคอีสาน", "ศรีสะเกษ": "ภาคอีสาน", "สกลนคร": "ภาคอีสาน", "สุรินทร์": "ภาคอีสาน",
  "หนองคาย": "ภาคอีสาน", "หนองบัวลำภู": "ภาคอีสาน", "อำนาจเจริญ": "ภาคอีสาน", "อุดรธานี": "ภาคอีสาน", "อุบลราชธานี": "ภาคอีสาน",
  "จันทบุรี": "ภาคตะวันออก", "ฉะเชิงเทรา": "ภาคตะวันออก", "ชลบุรี": "ภาคตะวันออก", "ตราด": "ภาคตะวันออก",
  "ปราจีนบุรี": "ภาคตะวันออก", "ระยอง": "ภาคตะวันออก", "สระแก้ว": "ภาคตะวันออก",
  "กระบี่": "ภาคใต้", "ชุมพร": "ภาคใต้", "ตรัง": "ภาคใต้", "นครศรีธรรมราช": "ภาคใต้", "นราธิวาส": "ภาคใต้",
  "ปัตตานี": "ภาคใต้", "พังงา": "ภาคใต้", "พัทลุง": "ภาคใต้", "ภูเก็ต": "ภาคใต้", "ระนอง": "ภาคใต้",
  "สงขลา": "ภาคใต้", "สตูล": "ภาคใต้", "สุราษฎร์ธานี": "ภาคใต้", "ยะลา": "ภาคใต้",
};

function autoFillRegion(province) {
  const region = PROVINCE_REGION[province];
  if (region) {
    document.getElementById("fRegion").value = region;
  }
}

function initProvinceAutocomplete() {
  const input = document.getElementById("fProvince");
  const dd = document.getElementById("provinceDd");
  if (!input || !dd) return;

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { dd.innerHTML = ""; dd.style.display = "none"; return; }
    const matches = PROVINCES.filter((p) => p.toLowerCase().includes(q)).slice(0, 8);
    if (!matches.length) { dd.innerHTML = ""; dd.style.display = "none"; return; }
    dd.style.display = "block";
    dd.innerHTML = matches.map((p) => `<div class="province-opt">${p}</div>`).join("");
    dd.querySelectorAll(".province-opt").forEach((opt) => {
      opt.addEventListener("click", () => {
        input.value = opt.textContent;
        dd.style.display = "none";
        autoFillRegion(opt.textContent);
      });
    });
  });

  input.addEventListener("blur", () => {
    setTimeout(() => { dd.style.display = "none"; }, 150);
  });
}

// ── START ─────────────────────────────────
window.addEventListener("load", () => {
  // status toggle label
  const statusToggle = document.getElementById("fStatus");
  if (statusToggle) {
    statusToggle.addEventListener("change", () => {
      document.getElementById("fStatusLabel").textContent = statusToggle.checked ? "ACTIVE" : "INACTIVE";
    });
  }
  // bind image fileInput (with compression)
  const fileInput = document.getElementById("fileInput");
  if (fileInput) {
    fileInput.addEventListener("change", async (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      const cat = e.target.dataset.cat || "exterior";
      const limit = IMG_LIMITS[cat];
      const remaining = limit - gallery[cat].length;
      const toAdd = files.slice(0, remaining);
      if (files.length > remaining) {
        showToast(`เพิ่มได้อีก ${remaining} รูป (เลือกมา ${files.length})`, "error");
      }
      for (const f of toAdd) {
        const compressed = await compressImage(f);
        gallery[cat].push({ file: compressed });
      }
      renderGallery(cat);
      updateTabCounts();
    });
  }

  // bind doc input
  const docInput = document.getElementById("docInput");
  if (docInput) {
    docInput.addEventListener("change", (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      const remaining = DOC_LIMIT - docFiles.length;
      const toAdd = files.slice(0, remaining);
      if (files.length > remaining) {
        showToast(`เพิ่มได้อีก ${remaining} ไฟล์ (เลือกมา ${files.length})`, "error");
      }
      toAdd.forEach((f) => docFiles.push({ file: f, name: f.name }));
      renderDocList();
      updateTabCounts();
    });
  }

  // Google Map URL paste/change -> auto-fill everything
  const fMapInput = document.getElementById("fMap");
  if (fMapInput) {
    const handleMapUrl = () => {
      const url = fMapInput.value.trim();
      if (!url) return;

      // short link (maps.app.goo.gl / goo.gl) → แจ้งให้ใช้ full URL
      if (url.includes("goo.gl/") || url.includes("maps.app.goo.gl/")) {
        alert("กรุณาใช้ Full URL แทน Short Link\n\nวิธี: เปิด link ใน browser → copy URL จาก address bar ที่ขึ้นต้นด้วย https://www.google.com/maps/...");
        return;
      }

      const coords = parseLatLonFromUrl(url);
      if (coords) {
        initMapPreview(coords.lat, coords.lon);
        reverseGeocodeAndFill(coords.lat, coords.lon, url);
      }
    };
    fMapInput.addEventListener("change", handleMapUrl);
    fMapInput.addEventListener("paste", () => setTimeout(handleMapUrl, 100));
  }

  initProvinceAutocomplete();
  loadPlaceTypes().then(() => {
    setTimeout(() => {
      initPage();
      // init empty map for new places
      if (!editId) setTimeout(() => initMapPreview(), 300);
    }, 200);
  });
});
