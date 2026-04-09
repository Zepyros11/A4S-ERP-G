/* ============================================================
   event-form.js — Controller for Event Form page
============================================================ */

import {
  fetchEventById,
  fetchUsers,
  fetchEvents,
  fetchEventCategories,
  fetchPlaces,
  createEvent,
  updateEvent,
  uploadEventPoster,
  createNotification,
} from "./events-api.js";

// ── STATE ──────────────────────────────────────────────────
let editId = null;
// posterFile และ posterUrl ใช้ผ่าน window._posterFile / window._posterUrl
// (set โดย plain script ใน HTML เพื่อแก้ ES Module timing issue)

// ── FLATPICKR instances ────────────────────────────────────
let fpEventDate, fpEndDate;

// ── INIT ───────────────────────────────────────────────────
async function initPage() {
  const params = new URLSearchParams(window.location.search);
  editId = params.get("id") ? parseInt(params.get("id")) : null;

  // Init flatpickr dd/mm/yyyy
  const fpOpts = { dateFormat: "d/m/Y", allowInput: true };
  fpEventDate = flatpickr("#fEventDate", fpOpts);
  fpEndDate = flatpickr("#fEndDate", fpOpts);

  await Promise.all([loadUsers(), loadEventCategories(), loadPlaces()]);

  if (editId) {
    document.getElementById("pageTitle").textContent = "✏️ แก้ไขกิจกรรม";
    document.getElementById("pageSubtitle").textContent = `Event ID: ${editId}`;
    document.getElementById("btnSave").textContent = "💾 บันทึกการแก้ไข";
    await loadEventData();
  } else {
    await autoGenerateCode();
  }
}

// ── LOAD USERS ─────────────────────────────────────────────
async function loadUsers() {
  try {
    const users = await fetchUsers();
    const sel = document.getElementById("fAssignedTo");
    users.forEach((u) => {
      sel.insertAdjacentHTML(
        "beforeend",
        `<option value="${u.user_id}">${u.full_name}</option>`,
      );
    });

    // Default = user ที่ login อยู่ (ถ้ายังไม่ได้ set จาก editId)
    if (!editId) {
      const session = JSON.parse(
        localStorage.getItem("erp_session") ||
          sessionStorage.getItem("erp_session") ||
          "{}",
      );
      if (session?.user_id) {
        sel.value = session.user_id;
      }
    }
  } catch (e) {
    showToast("โหลดข้อมูลผู้ใช้ไม่ได้", "error");
  }
}
// ── LOAD PLACES ────────────────────────────────────────────
async function loadPlaces() {
  try {
    const places = await fetchPlaces();
    const activePlaces = places.filter((p) => p.status === "ACTIVE");
    const input = document.getElementById("fLocation");
    const dropdown = document.getElementById("locationDropdown");
    if (!input || !dropdown) return;

    // ค่าที่ถูกเลือกจาก dropdown จริงๆ
    let confirmedValue = input.value || "";

    // expose เพื่อให้ loadEventForEdit ตั้งค่าได้
    window._setConfirmedLocation = (v) => {
      confirmedValue = v || "";
      input.value = confirmedValue;
      updateClearBtn();
    };

    // expose getter สำหรับ save
    window._getConfirmedLocation = () => confirmedValue || null;

    function updateClearBtn() {
      const btn = document.getElementById("btnClearLocation");
      if (btn) btn.style.display = confirmedValue ? "block" : "none";
    }

    window._clearLocation = function () {
      confirmedValue = "";
      input.value = "";
      dropdown.style.display = "none";
      updateClearBtn();
    };

    function renderDropdown(keyword) {
      const filtered = keyword
        ? activePlaces.filter((p) =>
            p.place_name.toLowerCase().includes(keyword.toLowerCase()),
          )
        : activePlaces;

      if (!filtered.length) {
        dropdown.style.display = "none";
        return;
      }

      dropdown.innerHTML = filtered
        .map((p) => {
          const imgs =
            p.image_urls && p.image_urls.length
              ? p.image_urls
              : p.cover_image_url
                ? [p.cover_image_url]
                : [];
          const thumb = imgs[0]
            ? `<img src="${imgs[0]}" style="width:100%;height:100%;object-fit:cover;border-radius:6px;">`
            : placeTypeIcon(p.place_type);
          return `
          <div class="ef-loc-item" data-name="${p.place_name}">
            <div class="ef-loc-icon">${thumb}</div>
            <div class="ef-loc-info">
              <div class="ef-loc-name">${p.place_name}</div>
              ${p.address ? `<div class="ef-loc-addr">${p.address}</div>` : ""}
            </div>
            ${p.capacity ? `<div class="ef-loc-cap">👥 ${p.capacity.toLocaleString()}</div>` : ""}
          </div>`;
        })
        .join("");

      dropdown.style.display = "block";

      dropdown.querySelectorAll(".ef-loc-item").forEach((el) => {
        el.addEventListener("mousedown", (e) => {
          e.preventDefault();
          confirmedValue = el.dataset.name;
          input.value = confirmedValue;
          dropdown.style.display = "none";
          updateClearBtn();
        });
      });
    }

    input.addEventListener("focus", () => {
      input.select();
      renderDropdown(confirmedValue ? "" : "");
    });
    input.addEventListener("input", () => renderDropdown(input.value));
    input.addEventListener("blur", () => {
      setTimeout(() => {
        // คืนค่าที่เลือกไว้ ถ้าผู้ใช้พิมพ์เองโดยไม่เลือก
        input.value = confirmedValue;
        dropdown.style.display = "none";
      }, 150);
    });

    updateClearBtn();
  } catch (e) {
    console.error("โหลดสถานที่ไม่ได้", e);
  }
}

function placeTypeIcon(type) {
  return (
    { HOTEL: "🏨", MEETING_ROOM: "🏢", RESTAURANT: "🍽", EVENT_SPACE: "🎤" }[
      type
    ] || "📍"
  );
}

// ── LOAD EVENT CATEGORIES ──────────────────────────────────
let holidayCatIds = [];

async function loadEventCategories() {
  try {
    const cats = await fetchEventCategories();
    const sel = document.getElementById("fEventType");
    // ล้าง option เดิมทิ้ง เหลือแค่ placeholder
    sel.innerHTML = `<option value="">— เลือกประเภทกิจกรรม —</option>`;
    cats.forEach((c) => {
      sel.insertAdjacentHTML(
        "beforeend",
        `<option value="${c.event_category_id}">${c.icon || ""} ${c.category_name}</option>`,
      );
      // เก็บ ID หมวด "วันหยุดบริษัท" ไว้กรอง autocomplete
      if (c.category_name === "วันหยุดบริษัท") {
        holidayCatIds.push(c.event_category_id);
      }
    });
  } catch (e) {
    showToast("โหลดประเภทกิจกรรมไม่ได้", "error");
  }
}

// ── LOAD EVENT DATA (กรณีแก้ไข) ───────────────────────────
async function loadEventData() {
  showLoading(true);
  try {
    const e = await fetchEventById(editId);
    if (!e) {
      showToast("ไม่พบข้อมูลกิจกรรม", "error");
      return;
    }

    document.getElementById("fEventName").value = e.event_name || "";
    document.getElementById("fEventCode").value = e.event_code || "";
    document.getElementById("fEventType").value = e.event_category_id || "";
    if (e.event_date) fpEventDate.setDate(e.event_date, true);
    if (e.end_date) fpEndDate.setDate(e.end_date, true);
    document.getElementById("fStartTime").value = e.start_time
      ? e.start_time.slice(0, 5)
      : "";
    document.getElementById("fEndTime").value = e.end_time
      ? e.end_time.slice(0, 5)
      : "";
    if (window._setConfirmedLocation) window._setConfirmedLocation(e.location || "");
    else document.getElementById("fLocation").value = e.location || "";
    document.getElementById("fMaxAttendees").value = e.max_attendees || "";
    document.getElementById("fAssignedTo").value = e.assigned_to || "";
    document.getElementById("fStatus").value = e.status || "DRAFT";
    document.getElementById("fDescription").value = e.description || "";

    // โหลดรูปภาพ — รองรับทั้ง image_urls (array) และ poster_url เดิม
    const imgUrls = Array.isArray(e.image_urls) && e.image_urls.length
      ? e.image_urls
      : (e.poster_url ? [e.poster_url] : []);
    window._imageUrls = [...imgUrls, ...new Array(5).fill(null)].slice(0, 5);
    window._imageFiles = new Array(5).fill(null);
    if (typeof _renderImgGrid === "function") _renderImgGrid();
  } catch (err) {
    showToast("โหลดข้อมูลไม่ได้: " + err.message, "error");
  }
  showLoading(false);
}

// ── AUTO GENERATE CODE ─────────────────────────────────────
async function autoGenerateCode() {
  const { url, key } = getSB();
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const prefix = `EVT-${yyyy}${mm}-`;

  const res = await fetch(
    `${url}/rest/v1/events?select=event_code&event_code=like.${prefix}*`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  const rows = await res.json();

  let maxSeq = 0;
  if (rows?.length) {
    rows.forEach((r) => {
      const n = parseInt((r.event_code || "").split("-").pop(), 10);
      if (!isNaN(n) && n > maxSeq) maxSeq = n;
    });
  }

  const code = `${prefix}${String(maxSeq + 1).padStart(3, "0")}`;
  document.getElementById("fEventCode").value = code;
  return code;
}

// ── VALIDATE ───────────────────────────────────────────────
function validate() {
  const name = document.getElementById("fEventName").value.trim();
  const type = document.getElementById("fEventType").value;
  const date = fpEventDate.selectedDates[0];

  if (!name) {
    showToast("กรุณาระบุชื่องาน", "error");
    return false;
  }
  if (!type) {
    showToast("กรุณาเลือกประเภทงาน", "error");
    return false;
  }
  if (!date) {
    showToast("กรุณาระบุวันที่เริ่มงาน", "error");
    return false;
  }

  const endDate = fpEndDate.selectedDates[0];
  if (endDate && endDate < date) {
    showToast("วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่ม", "error");
    return false;
  }
  return true;
}

// ── SAVE ───────────────────────────────────────────────────
window._saveEventImpl = async function () {
  if (!validate()) return;

  showLoading(true);
  try {
    const payload = {
      event_name: document.getElementById("fEventName").value.trim(),
      event_code: document.getElementById("fEventCode").value.trim(),
      event_category_id:
        parseInt(document.getElementById("fEventType").value) || null,

      event_date: fpEventDate.selectedDates[0] ? fpEventDate.formatDate(fpEventDate.selectedDates[0], "Y-m-d") : "",
      end_date: fpEndDate.selectedDates[0] ? fpEndDate.formatDate(fpEndDate.selectedDates[0], "Y-m-d") : null,
      start_time: document.getElementById("fStartTime").value || null,
      end_time: document.getElementById("fEndTime").value || null,
      location: window._getConfirmedLocation ? window._getConfirmedLocation() : (document.getElementById("fLocation").value.trim() || null),
      max_attendees:
        parseInt(document.getElementById("fMaxAttendees").value) || 0,
      assigned_to:
        parseInt(document.getElementById("fAssignedTo").value) || null,
      status: document.getElementById("fStatus").value,
      description: document.getElementById("fDescription").value.trim() || null,
    };

    let savedId = editId;
    if (editId) {
      await updateEvent(editId, payload);
    } else {
      const res = await createEvent(payload);
      savedId = res?.event_id;
    }

    // อัปโหลดรูปภาพใหม่ และรวม URLs
    const imageFiles = window._imageFiles || [];
    const imageUrls  = [...(window._imageUrls || [])];
    for (let i = 0; i < 5; i++) {
      if (imageFiles[i] && savedId) {
        imageUrls[i] = await uploadEventPoster(savedId, imageFiles[i]);
      }
    }
    const finalUrls = imageUrls.filter(Boolean);
    await updateEvent(savedId, {
      poster_url: finalUrls[0] || null,
      image_urls: finalUrls.length ? finalUrls : null,
    });

    if (!editId && payload.assigned_to) {
      await createNotification({
        user_id: payload.assigned_to,
        module: "EVENT",
        ref_type: "EVENT",
        ref_id: savedId,
        title: "มีงานใหม่ได้รับมอบหมาย",
        message: `คุณได้รับมอบหมายให้ดูแลงาน "${payload.event_name}"`,
      }).catch(() => {});
    }

    showToast(editId ? "บันทึกการแก้ไขแล้ว" : "สร้างกิจกรรมแล้ว", "success");
    setTimeout(() => {
      window.location.href = "events-list.html";
    }, 1200);
  } catch (err) {
    showToast("บันทึกไม่สำเร็จ: " + err.message, "error");
  }
  showLoading(false);
};

// ── UTILS ──────────────────────────────────────────────────
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

// ── AUTOCOMPLETE EVENT NAME ─────────────────────────────────
let eventNameList = [];

async function loadEventNames() {
  try {
    const events = await fetchEvents();
    eventNameList = [
      ...new Set(
        events
          .filter((e) => !holidayCatIds.includes(e.event_category_id))
          .map((e) => e.event_name)
          .filter(Boolean)
      ),
    ];
  } catch (e) {
    console.error("โหลดชื่อ event ไม่ได้", e);
  }
}

function setupEventNameAutocomplete() {
  const input = document.getElementById("fEventName");
  const dropdown = document.getElementById("eventNameDropdown");

  function showDropdown() {
    const keyword = input.value.toLowerCase();
    const filtered = eventNameList.filter((name) =>
      name.toLowerCase().includes(keyword),
    );

    if (!filtered.length) {
      dropdown.style.display = "none";
      return;
    }

    dropdown.innerHTML = filtered
      .slice(0, 8)
      .map((name) => `<div class="ef-dropdown-item">${name}</div>`)
      .join("");

    dropdown.style.display = "block";

    dropdown.querySelectorAll(".ef-dropdown-item").forEach((el) => {
      el.onclick = () => {
        input.value = el.textContent;
        dropdown.style.display = "none";
      };
    });
  }

  input.addEventListener("focus", showDropdown);
  input.addEventListener("input", showDropdown);

  document.addEventListener("click", (e) => {
    if (!dropdown.contains(e.target) && e.target !== input) {
      dropdown.style.display = "none";
    }
  });
}

// ── START ──────────────────────────────────────────────────
async function startPage() {
  await initPage();
  await loadEventNames();
  setupEventNameAutocomplete();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startPage);
} else {
  startPage();
}
