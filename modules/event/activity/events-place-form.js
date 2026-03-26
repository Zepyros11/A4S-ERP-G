import { createPlace } from "./events-api.js";

// ── STATE ─────────────────────────────────────────
let imageFiles = [];
let imageUrl = null;

// ── INIT ─────────────────────────────────────────
function initPage() {
  bindEvents();
  renderSlots();
}

// ── BIND EVENTS ──────────────────────────────────
function bindEvents() {
  const fileInput = document.getElementById("fileInput");
  fileInput.addEventListener("change", handleFileSelect);
}

// ── VALIDATE ─────────────────────────────────────
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

// ── SAVE ─────────────────────────────────────────
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

    // ── SAVE DB ──
    const res = await createPlace(payload);
    const placeId = res?.place_id;

    // ── UPLOAD IMAGE (ถ้ามี) ──
    if (imageFile && placeId) {
      const url = await uploadPlaceImage(placeId, imageFile);
      imageUrl = url;

      await updatePlaceImage(placeId, url);
    }

    showToast("บันทึกสถานที่แล้ว", "success");

    setTimeout(() => {
      window.location.href = "../activity/events-list.html";
    }, 1200);
  } catch (err) {
    showToast("บันทึกไม่สำเร็จ: " + err.message, "error");
  }

  showLoading(false);
};

// ── UPLOAD IMAGE ─────────────────────────────────
async function uploadPlaceImage(placeId, file) {
  const { url, key } = getSB();

  const ext = file.name.split(".").pop();
  const fileName = `place_${placeId}_${Date.now()}.${ext}`;
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

  if (!res.ok) {
    throw new Error("Upload failed");
  }

  return `${url}/storage/v1/object/public/event-files/${path}`;
}

// ── UPDATE IMAGE URL ─────────────────────────────
async function updatePlaceImage(placeId, imageUrl) {
  const { url, key } = getSB();

  await fetch(`${url}/rest/v1/places?place_id=eq.${placeId}`, {
    method: "PATCH",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      cover_image_url: imageUrl,
    }),
  });
}

// ── UTILS ────────────────────────────────────────
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

// ── START ────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPage);
} else {
  initPage();
}
// INIT SLOT 5 ช่อง
function renderSlots() {
  const grid = document.getElementById("previewGrid");
  grid.innerHTML = "";

  for (let i = 0; i < 5; i++) {
    const file = imageFiles[i];

    if (file) {
      const url = URL.createObjectURL(file);

      grid.innerHTML += `
        <div class="place-slot"
             draggable="true"
             ondragstart="handleDragStart(event, ${i})"
             ondragover="handleDragOver(event)"
             ondrop="handleDrop(event, ${i})">

          <img src="${url}" />
          <button class="place-remove" onclick="removeImage(${i})">✕</button>
        </div>
      `;
    } else {
      grid.innerHTML += `
        <div class="place-slot empty"
             onclick="selectImage(${i})"
             ondragover="handleDragOver(event)"
             ondrop="handleDropEmpty(event, ${i})">
        </div>
      `;
    }
  }
}
// SELECT SLOT
window.selectImage = function (index) {
  const input = document.getElementById("fileInput");
  input.dataset.index = index;
  input.click();
};

// HANDLE FILE
function handleFileSelect(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    showToast("กรุณาเลือกไฟล์รูปภาพ", "error");
    return;
  }

  const index = e.target.dataset.index;

  if (index !== undefined) {
    imageFiles[index] = file;
  } else {
    if (imageFiles.length >= 5) {
      showToast("สูงสุด 5 รูป", "error");
      return;
    }
    imageFiles.push(file);
  }

  renderSlots();
}

// REMOVE
window.removeImage = function (index) {
  imageFiles.splice(index, 1);
  renderSlots();
};
let dragIndex = null;

// START DRAG
window.handleDragStart = function (e, index) {
  dragIndex = index;

  // 🔥 สำคัญมาก (ไม่งั้นลากไม่ติดบาง browser)
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", index);
};

// ALLOW DROP
window.handleDragOver = function (e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
};

// DROP ON SLOT (swap)
window.handleDrop = function (e, targetIndex) {
  e.preventDefault();

  const from = parseInt(e.dataTransfer.getData("text/plain"));

  if (isNaN(from)) return;

  const temp = imageFiles[from];
  imageFiles[from] = imageFiles[targetIndex];
  imageFiles[targetIndex] = temp;

  renderSlots();
};

// DROP ON EMPTY SLOT
window.handleDropEmpty = function (e, targetIndex) {
  e.preventDefault();

  const from = parseInt(e.dataTransfer.getData("text/plain"));
  if (isNaN(from)) return;

  const item = imageFiles.splice(from, 1)[0];
  imageFiles[targetIndex] = item;

  renderSlots();
};
