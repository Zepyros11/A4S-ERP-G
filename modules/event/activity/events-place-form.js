import { createPlace } from "./events-api.js";

// ── STATE ─────────────────────────────────────────
let imageFiles = [];
let imageUrl = null;

// ── INIT ─────────────────────────────────────────
function initPage() {
  bindEvents();
  renderSlots();
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
    if (imageFiles[0] && placeId) {
      const url = await uploadPlaceImage(placeId, imageFiles[0]);
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
// ── SLOTS ────────────────────────────────────────
function renderSlots() {
  const grid = document.getElementById("previewGrid");
  grid.innerHTML = "";

  for (let i = 0; i < 5; i++) {
    const file = imageFiles[i];
    const slot = document.createElement("div");

    if (file) {
      const url = URL.createObjectURL(file);
      slot.className = "place-slot filled";
      slot.draggable = true;
      slot.innerHTML = `
        <img src="${url}" alt="slot-${i}" />
        <button class="place-remove" type="button">✕</button>
        <div class="place-slot-num">${i + 1}</div>
      `;
      // drag (เลื่อนลำดับ)
      slot.addEventListener("dragstart", (e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(i));
      });
      // remove
      slot.querySelector(".place-remove").addEventListener("click", (e) => {
        e.stopPropagation();
        imageFiles.splice(i, 1);
        renderSlots();
      });
    } else {
      slot.className = "place-slot empty";
      slot.innerHTML = `
        <div class="place-slot-inner">
          <div class="place-slot-icon">+</div>
          <div class="place-slot-hint">คลิก / ลากรูป</div>
          <div class="place-slot-num">${i + 1}</div>
        </div>
      `;
      // คลิก = เปิด file picker
      slot.addEventListener("click", () => triggerFilePicker(i));
    }

    // dragover + drop สำหรับทุก slot (ทั้ง filled และ empty)
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

      // drop จาก slot อื่น (สลับลำดับ)
      const fromIndex = parseInt(e.dataTransfer.getData("text/plain"));
      if (!isNaN(fromIndex) && fromIndex !== i) {
        const temp = imageFiles[fromIndex] ?? null;
        imageFiles[fromIndex] = imageFiles[i] ?? null;
        imageFiles[i] = temp;
        // ล้าง undefined ที่ไม่จำเป็น
        renderSlots();
        return;
      }

      // drop จากภายนอก (ไฟล์จาก OS)
      const file = e.dataTransfer.files?.[0];
      if (file && file.type.startsWith("image/")) {
        imageFiles[i] = file;
        renderSlots();
      }
    });

    grid.appendChild(slot);
  }
}

// ── FILE PICKER ──────────────────────────────────
function triggerFilePicker(index) {
  const input = document.getElementById("fileInput");
  input.dataset.index = index;
  input.value = ""; // reset ให้เลือกไฟล์เดิมซ้ำได้
  input.click();
}

function handleFileSelect(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showToast("กรุณาเลือกไฟล์รูปภาพ", "error");
    return;
  }
  const index = parseInt(e.target.dataset.index);
  imageFiles[isNaN(index) ? imageFiles.length : index] = file;
  renderSlots();
}

// bind file input
document.addEventListener("DOMContentLoaded", () => {
  document
    .getElementById("fileInput")
    .addEventListener("change", handleFileSelect);
});
