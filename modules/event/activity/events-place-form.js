/* ============================================================
   events-place-form.js — Controller for Place Form page
============================================================ */

import { createPlace } from "./events-api.js";

// ── STATE ─────────────────────────────────────────
let imageFiles = [];

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

    const res = await createPlace(payload);
    const placeId = res?.place_id;

    if (imageFiles[0] && placeId) {
      const coverUrl = await uploadPlaceImage(placeId, imageFiles[0], 0);
      await patchPlace(placeId, { cover_image_url: coverUrl });
    }

    showToast("บันทึกสถานที่แล้ว", "success");
    setTimeout(() => {
      window.location.href = "./events-place-list.html";
    }, 1200);
  } catch (err) {
    showToast("บันทึกไม่สำเร็จ: " + err.message, "error");
  }
  showLoading(false);
};

// ── UPLOAD ────────────────────────────────────────
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

// ── RENDER SLOTS ─────────────────────────────────
function renderSlots() {
  const grid = document.getElementById("previewGrid");
  if (!grid) return;
  grid.innerHTML = "";

  for (let i = 0; i < 5; i++) {
    const file = imageFiles[i];
    const slot = document.createElement("div");

    if (file) {
      const objectUrl = URL.createObjectURL(file);
      slot.className = "place-slot filled";
      slot.draggable = true;
      slot.innerHTML = `
        <img src="${objectUrl}" alt="slot-${i}" />
        <button class="place-remove" type="button">✕</button>
        <div class="place-slot-num">${i + 1}</div>
      `;
      slot.addEventListener("dragstart", (e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(i));
      });
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
      slot.addEventListener("click", () => triggerFilePicker(i));
    }

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
      const fromIndex = parseInt(e.dataTransfer.getData("text/plain"));
      if (!isNaN(fromIndex) && fromIndex !== i) {
        const temp = imageFiles[fromIndex] ?? null;
        imageFiles[fromIndex] = imageFiles[i] ?? null;
        imageFiles[i] = temp;
        renderSlots();
        return;
      }
      const dropped = e.dataTransfer.files?.[0];
      if (dropped && dropped.type.startsWith("image/")) {
        imageFiles[i] = dropped;
        renderSlots();
      }
    });

    grid.appendChild(slot);
  }
}

// ── FILE PICKER ──────────────────────────────────
function triggerFilePicker(index) {
  const input = document.getElementById("fileInput");
  input.dataset.index = String(index);
  input.value = "";
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

// ── START — ใช้ window.load เพื่อรอ sidebar inject DOM เสร็จก่อน ──
window.addEventListener("load", () => {
  renderSlots();
  document
    .getElementById("fileInput")
    .addEventListener("change", handleFileSelect);
});
