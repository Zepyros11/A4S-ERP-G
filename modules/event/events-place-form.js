/* ============================================================
   events-place-form.js — Controller for Place Form page
============================================================ */

import { createPlace, fetchPlaceById, updatePlace } from "./events-api.js";

// ── STATE ─────────────────────────────────
let editId = null;
// เก็บ URL รูปเดิมจาก DB (string) แยกจาก File ใหม่
let existingImageUrls = []; // array ของ URL string เดิม (จาก image_urls[])

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
    document.getElementById("fLat").value = p.latitude || "";
    document.getElementById("fLong").value = p.longitude || "";
    document.getElementById("fMap").value = p.google_map_url || "";
    document.getElementById("fContactName").value = p.contact_name || "";
    document.getElementById("fPhone").value = p.phone || "";
    document.getElementById("fEmail").value = p.email || "";
    document.getElementById("fCapacity").value = p.capacity || "";
    document.getElementById("fRoomsMeeting").value = p.meeting_rooms || "";
    document.getElementById("fRooms").value = p.rooms || "";
    document.getElementById("fParking").value =
      p.has_parking === true ? "true" : p.has_parking === false ? "false" : "";
    document.getElementById("fStatus").value = p.status || "ACTIVE";

    // โหลดรูปเดิม — ใช้ image_urls[] ถ้ามี ไม่งั้น fallback cover_image_url
    const urls =
      p.image_urls && p.image_urls.length
        ? p.image_urls
        : p.cover_image_url
          ? [p.cover_image_url]
          : [];

    existingImageUrls = [...urls];
    // ส่งให้ plain script render
    window._existingImageUrls = [...urls];
    window._imageFiles = new Array(5).fill(null);
    _renderSlotsWithUrls();
  } catch (err) {
    showToast("โหลดข้อมูลไม่ได้: " + err.message, "error");
  }
  showLoading(false);
}

// ── RENDER SLOTS พร้อม URL เดิม ───────────
function _renderSlotsWithUrls() {
  const grid = document.getElementById("previewGrid");
  if (!grid) return;
  grid.innerHTML = "";

  const urls = window._existingImageUrls || [];
  const files = window._imageFiles || [];

  for (let i = 0; i < 5; i++) {
    const slot = document.createElement("div");
    const file = files[i];
    const url = urls[i];

    if (file instanceof File) {
      // รูปใหม่ที่เพิ่งเลือก
      slot.className = "place-slot filled";
      slot.draggable = true;
      slot.innerHTML = `
        <img src="${URL.createObjectURL(file)}" />
        <button class="place-remove" onclick="event.stopPropagation();_removeSlot(${i})">✕</button>
        <div class="place-slot-num">${i + 1}</div>
      `;
    } else if (url) {
      // รูปเดิมจาก DB
      slot.className = "place-slot filled";
      slot.draggable = true;
      slot.innerHTML = `
        <img src="${url}" style="pointer-events:none" />
        <button class="place-remove" onclick="event.stopPropagation();_removeSlot(${i})">✕</button>
        <div class="place-slot-num">${i + 1}</div>
      `;
    } else {
      // slot ว่าง
      slot.className = "place-slot empty";
      slot.innerHTML = `
        <div class="place-slot-inner">
          <div class="place-slot-icon">+</div>
          <div class="place-slot-hint">คลิก / ลากรูป</div>
          <div class="place-slot-num">${i + 1}</div>
        </div>
      `;
      slot.addEventListener("click", () => _pickFile(i));
    }

    // drag & drop
    slot.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", String(i));
    });
    slot.addEventListener("dragover", (e) => {
      e.preventDefault();
      slot.classList.add("drag-over");
    });
    slot.addEventListener("dragleave", () =>
      slot.classList.remove("drag-over"),
    );
    slot.addEventListener("drop", (e) => {
      e.preventDefault();
      slot.classList.remove("drag-over");
      const from = parseInt(e.dataTransfer.getData("text/plain"));
      if (!isNaN(from) && from !== i) {
        // swap files
        const tf = window._imageFiles[from] ?? null;
        window._imageFiles[from] = window._imageFiles[i] ?? null;
        window._imageFiles[i] = tf;
        // swap urls
        const tu = (window._existingImageUrls || [])[from] ?? null;
        window._existingImageUrls[from] =
          (window._existingImageUrls || [])[i] ?? null;
        window._existingImageUrls[i] = tu;
        _renderSlotsWithUrls();
        return;
      }
      const dropped = e.dataTransfer.files?.[0];
      if (dropped && dropped.type.startsWith("image/")) {
        if (!window._imageFiles) window._imageFiles = new Array(5).fill(null);
        window._imageFiles[i] = dropped;
        if (window._existingImageUrls) window._existingImageUrls[i] = null;
        _renderSlotsWithUrls();
      }
    });

    grid.appendChild(slot);
  }
}

// expose ให้ plain script / inline onclick ใช้
window._removeSlot = function (idx) {
  if (window._imageFiles) window._imageFiles[idx] = null;
  if (window._existingImageUrls) window._existingImageUrls[idx] = null;
  _renderSlotsWithUrls();
};

function _pickFile(idx) {
  const input = document.getElementById("fileInput");
  input.dataset.index = String(idx);
  input.value = "";
  input.click();
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
    const payload = {
      place_name: document.getElementById("fPlaceName").value.trim(),
      place_type: document.getElementById("fPlaceType").value,
      description: document.getElementById("fDescription").value.trim() || null,
      address: document.getElementById("fAddress").value.trim() || null,
      latitude: parseFloat(document.getElementById("fLat").value) || null,
      longitude: parseFloat(document.getElementById("fLong").value) || null,
      google_map_url: document.getElementById("fMap").value.trim() || null,
      contact_name:
        document.getElementById("fContactName").value.trim() || null,
      phone: document.getElementById("fPhone").value.trim() || null,
      email: document.getElementById("fEmail").value.trim() || null,
      capacity: parseInt(document.getElementById("fCapacity").value) || 0,
      meeting_rooms:
        parseInt(document.getElementById("fRoomsMeeting").value) || 0,
      rooms: parseInt(document.getElementById("fRooms").value) || 0,
      has_parking: document.getElementById("fParking").value === "true",
      status: document.getElementById("fStatus").value,
    };

    let placeId = editId;
    if (editId) {
      await updatePlace(editId, payload);
    } else {
      const res = await createPlace(payload);
      placeId = res?.place_id;
    }

    // ── Upload รูปใหม่ทุก slot ──────────────
    const files = window._imageFiles || [];
    const oldUrls = window._existingImageUrls || [];
    const finalUrls = [];

    for (let i = 0; i < 5; i++) {
      if (files[i] instanceof File) {
        // รูปใหม่ — upload
        const uploadedUrl = await uploadPlaceImage(placeId, files[i], i);
        finalUrls.push(uploadedUrl);
      } else if (oldUrls[i]) {
        // รูปเดิม — เก็บ URL เดิมไว้
        finalUrls.push(oldUrls[i]);
      }
      // null/undefined = slot ว่าง ไม่เพิ่ม
    }

    // บันทึก image_urls[] และ cover_image_url (รูปแรก)
    if (placeId) {
      await patchPlace(placeId, {
        image_urls: finalUrls,
        cover_image_url: finalUrls[0] || null,
      });
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

// ── START ─────────────────────────────────
window.addEventListener("load", () => {
  // init _imageFiles และ _existingImageUrls ก่อน
  window._imageFiles = new Array(5).fill(null);
  window._existingImageUrls = new Array(5).fill(null);

  // override _renderSlots ของ plain script ให้ใช้ version นี้แทน
  window._renderSlots = _renderSlotsWithUrls;

  // bind fileInput
  const fileInput = document.getElementById("fileInput");
  if (fileInput) {
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const idx = parseInt(e.target.dataset.index);
      const i = isNaN(idx) ? 0 : idx;
      window._imageFiles[i] = file;
      if (window._existingImageUrls) window._existingImageUrls[i] = null;
      _renderSlotsWithUrls();
    });
  }

  setTimeout(() => initPage(), 200);
});
