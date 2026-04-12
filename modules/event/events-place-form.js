/* ============================================================
   events-place-form.js — Controller for Place Form page
============================================================ */

import { createPlace, fetchPlaceById, updatePlace, fetchPlaceRooms, upsertPlaceRooms, fetchPlaceRoomTypes, upsertPlaceRoomTypes, fetchPlaceTypes, createPlaceType, updatePlaceType, removePlaceType } from "./events-api.js";
import { withLoading } from "../../js/components/ui/loadingButton.js";
import { openIconPicker, renderIcon } from "../../js/components/ui/iconPicker.js";

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
    document.getElementById("fDescription").value = p.description || "";
    document.getElementById("fAddress").value = p.address || "";
    document.getElementById("fMap").value = p.google_map_url || "";
    document.getElementById("fContactName").value = p.contact_name || "";
    document.getElementById("fPhone").value = p.phone || "";
    document.getElementById("fEmail").value = p.email || "";
    document.getElementById("fCapacity").value = p.capacity || "";
    document.getElementById("fParking").value =
      p.has_parking === true ? "true" : p.has_parking === false ? "false" : "";
    document.getElementById("fStatus").value = p.status || "ACTIVE";

    // new fields
    document.getElementById("fRegion").value = p.region || "";
    document.getElementById("fProvince").value = p.province || "";
    document.getElementById("fRating").value = p.rating || "";
    document.getElementById("fLineId").value = p.line_id || "";
    document.getElementById("fWebsite").value = p.website || "";
    document.getElementById("fTaxId").value = p.tax_id || "";
    document.getElementById("fMeetingRate").value = p.meeting_rate_min || "";
    document.getElementById("fPackageRate").value = p.package_rate_min || "";
    document.getElementById("fCoffeeRate").value = p.coffee_break_rate || "";
    document.getElementById("fMealRate").value = p.meal_rate_min || "";
    document.getElementById("fTerms").value = p.terms_notes || "";

    // amenities checkboxes (both equipment + facilities)
    const amenities = p.amenities || [];
    document.querySelectorAll("#amenityTags input[type=checkbox], #facilityTags input[type=checkbox]").forEach((cb) => {
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
    roomRows = rooms || [];
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

function renderGallery(cat) {
  const grid = document.getElementById(`grid-${cat}`);
  if (!grid) return;
  grid.innerHTML = "";
  const items = gallery[cat] || [];
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
const ACCOM_IMG_LIMIT = 8;
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
    document.querySelectorAll("#amenityTags input[type=checkbox]:checked, #facilityTags input[type=checkbox]:checked").forEach((cb) => {
      amenities.push(cb.value);
    });

    const payload = {
      place_name: document.getElementById("fPlaceName").value.trim(),
      place_type: document.getElementById("fPlaceType").value,
      description: document.getElementById("fDescription").value.trim() || null,
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
      capacity: parseInt(document.getElementById("fCapacity").value) || 0,
      meeting_rooms: collectRoomsFromForm().length,
      has_parking: document.getElementById("fParking").value === "true",
      status: document.getElementById("fStatus").value,
      meeting_rate_min: parseFloat(document.getElementById("fMeetingRate").value) || null,
      package_rate_min: parseFloat(document.getElementById("fPackageRate").value) || null,
      coffee_break_rate: parseFloat(document.getElementById("fCoffeeRate").value) || null,
      meal_rate_min: parseFloat(document.getElementById("fMealRate").value) || null,
      amenities: amenities.length > 0 ? amenities : null,
      terms_notes: document.getElementById("fTerms").value.trim() || null,
    };

    let placeId = editId;
    if (editId) {
      await updatePlace(editId, payload);
    } else {
      const res = await createPlace(payload);
      placeId = res?.place_id;
    }

    // ── Upload gallery images ──────────────
    if (placeId) {
      const imageData = {};
      let coverUrl = null;
      for (const cat of ["exterior", "room", "food"]) {
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
    if (input) input.addEventListener("change", (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      if (!accomRows[idx]._images) accomRows[idx]._images = [];
      const remaining = ACCOM_IMG_LIMIT - accomRows[idx]._images.length;
      const toAdd = files.slice(0, remaining);
      if (files.length > remaining) showToast(`เพิ่มได้อีก ${remaining} รูป`, "error");
      toAdd.forEach((f) => accomRows[idx]._images.push({ file: f }));
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
    <div class="ef-row-2">
      <div class="ef-field">
        <label class="ef-label">ชื่อประเภทห้อง</label>
        <input class="ef-input accom-f" data-idx="${idx}" data-key="room_type_name" value="${r.room_type_name || ""}" placeholder="เช่น Deluxe, Superior, Suite" />
      </div>
      <div class="ef-field">
        <label class="ef-label">ประเภทเตียง</label>
        <select class="ef-input accom-f" data-idx="${idx}" data-key="bed_type">
          <option value="">— เลือก —</option>
          <option value="SINGLE" ${r.bed_type === "SINGLE" ? "selected" : ""}>เตียงเดี่ยว</option>
          <option value="DOUBLE" ${r.bed_type === "DOUBLE" ? "selected" : ""}>เตียงคู่</option>
          <option value="TWIN" ${r.bed_type === "TWIN" ? "selected" : ""}>เตียงแฝด (Twin)</option>
          <option value="SINGLE_DOUBLE" ${r.bed_type === "SINGLE_DOUBLE" ? "selected" : ""}>เดี่ยว/คู่</option>
        </select>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
      <div class="ef-field">
        <label class="ef-label">จำนวนห้อง</label>
        <input class="ef-input accom-f" data-idx="${idx}" data-key="room_count" type="number" value="${r.room_count || ""}" placeholder="เช่น 80" />
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
        <label class="ef-label">ราคา (เดี่ยว/คืน)</label>
        <input class="ef-input accom-f" data-idx="${idx}" data-key="rate_single" type="number" value="${r.rate_single || ""}" placeholder="เช่น 750" />
      </div>
      <div class="ef-field">
        <label class="ef-label">ราคา (คู่/คืน)</label>
        <input class="ef-input accom-f" data-idx="${idx}" data-key="rate_double" type="number" value="${r.rate_double || ""}" placeholder="เช่น 750" />
      </div>
      <div class="ef-field">
        <label class="ef-label">Extra Bed / คน</label>
        <input class="ef-input accom-f" data-idx="${idx}" data-key="rate_extra_bed" type="number" value="${r.rate_extra_bed || ""}" placeholder="เช่น 1000" />
      </div>
    </div>
    <div class="ef-row-2">
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
      <button class="btn btn-outline btn-sm" type="button" onclick="window.addAccomImage(${idx})" style="margin-top:6px">＋ เพิ่มรูป</button>
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
    const numKeys = ["room_count", "max_guests", "room_size_sqm", "rate_single", "rate_double", "rate_extra_bed"];
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
function renderRooms() {
  const container = document.getElementById("roomsContainer");
  if (!container) return;
  container.innerHTML = "";
  roomRows.forEach((r, idx) => {
    container.appendChild(buildRoomCard(r, idx));
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
    <div class="ef-row-2">
      <div class="ef-field">
        <label class="ef-label">ชื่อห้อง</label>
        <input class="ef-input room-f" data-idx="${idx}" data-key="room_name" value="${r.room_name || ""}" placeholder="เช่น Ballroom A" />
      </div>
      <div class="ef-field">
        <label class="ef-label">ชั้น</label>
        <input class="ef-input room-f" data-idx="${idx}" data-key="floor" value="${r.floor || ""}" placeholder="เช่น 4" />
      </div>
    </div>
    <div class="ef-row-2">
      <div class="ef-field">
        <label class="ef-label">ขนาด (กว้าง x ยาว x สูง ม.)</label>
        <div style="display:flex;gap:6px">
          <input class="ef-input room-f" data-idx="${idx}" data-key="width_m" type="number" step="0.1" value="${r.width_m || ""}" placeholder="W" style="flex:1" />
          <input class="ef-input room-f" data-idx="${idx}" data-key="length_m" type="number" step="0.1" value="${r.length_m || ""}" placeholder="L" style="flex:1" />
          <input class="ef-input room-f" data-idx="${idx}" data-key="height_m" type="number" step="0.1" value="${r.height_m || ""}" placeholder="H" style="flex:1" />
        </div>
      </div>
      <div class="ef-field">
        <label class="ef-label">พื้นที่ (ตร.ม.)</label>
        <input class="ef-input room-f" data-idx="${idx}" data-key="area_sqm" type="number" value="${r.area_sqm || ""}" placeholder="ตร.ม." />
      </div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
      <div class="ef-field">
        <label class="ef-label">Theatre</label>
        <input class="ef-input room-f" data-idx="${idx}" data-key="cap_theatre" type="number" value="${r.cap_theatre || ""}" />
      </div>
      <div class="ef-field">
        <label class="ef-label">Classroom</label>
        <input class="ef-input room-f" data-idx="${idx}" data-key="cap_classroom" type="number" value="${r.cap_classroom || ""}" />
      </div>
      <div class="ef-field">
        <label class="ef-label">U-Shape</label>
        <input class="ef-input room-f" data-idx="${idx}" data-key="cap_u_shape" type="number" value="${r.cap_u_shape || ""}" />
      </div>
      <div class="ef-field">
        <label class="ef-label">Banquet</label>
        <input class="ef-input room-f" data-idx="${idx}" data-key="cap_banquet" type="number" value="${r.cap_banquet || ""}" />
      </div>
      <div class="ef-field">
        <label class="ef-label">Cocktail</label>
        <input class="ef-input room-f" data-idx="${idx}" data-key="cap_cocktail" type="number" value="${r.cap_cocktail || ""}" />
      </div>
      <div class="ef-field">
        <label class="ef-label">Boardroom</label>
        <input class="ef-input room-f" data-idx="${idx}" data-key="cap_boardroom" type="number" value="${r.cap_boardroom || ""}" />
      </div>
    </div>
    <div class="ef-field">
      <label class="ef-label">รายละเอียดเพิ่มเติม</label>
      <input class="ef-input room-f" data-idx="${idx}" data-key="description" value="${r.description || ""}" placeholder="เช่น มีเสาแต่ไม่บัง, มีแสงธรรมชาติ" />
    </div>
  `;
  return card;
}

function collectRoomsFromForm() {
  const rooms = [];
  const inputs = document.querySelectorAll(".room-f");
  const map = {};
  inputs.forEach((el) => {
    const idx = parseInt(el.dataset.idx);
    const key = el.dataset.key;
    if (!map[idx]) map[idx] = {};
    const numKeys = ["width_m","length_m","height_m","area_sqm","cap_theatre","cap_classroom","cap_u_shape","cap_banquet","cap_cocktail","cap_boardroom"];
    if (numKeys.includes(key)) {
      map[idx][key] = parseFloat(el.value) || null;
    } else {
      map[idx][key] = el.value.trim() || null;
    }
  });
  Object.keys(map).sort((a,b) => a - b).forEach((k) => {
    if (map[k].room_name) rooms.push(map[k]);
  });
  return rooms;
}

window.addRoom = function () {
  roomRows.push({ room_name: "", floor: "", capacity: 0 });
  renderRooms();
  // scroll to bottom
  const container = document.getElementById("roomsContainer");
  if (container) container.lastElementChild?.scrollIntoView({ behavior: "smooth" });
};

window.removeRoom = function (idx) {
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
      });
    });
  });

  input.addEventListener("blur", () => {
    setTimeout(() => { dd.style.display = "none"; }, 150);
  });
}

// ── START ─────────────────────────────────
window.addEventListener("load", () => {
  // bind image fileInput
  const fileInput = document.getElementById("fileInput");
  if (fileInput) {
    fileInput.addEventListener("change", (e) => {
      const files = Array.from(e.target.files || []);
      if (!files.length) return;
      const cat = e.target.dataset.cat || "exterior";
      const limit = IMG_LIMITS[cat];
      const remaining = limit - gallery[cat].length;
      const toAdd = files.slice(0, remaining);
      if (files.length > remaining) {
        showToast(`เพิ่มได้อีก ${remaining} รูป (เลือกมา ${files.length})`, "error");
      }
      toAdd.forEach((f) => gallery[cat].push({ file: f }));
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

  initProvinceAutocomplete();
  loadPlaceTypes().then(() => {
    setTimeout(() => initPage(), 200);
  });
});
