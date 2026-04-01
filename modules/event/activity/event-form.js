/* ============================================================
   event-form.js — Controller for Event Form page
============================================================ */

import {
  fetchEventById,
  fetchUsers,
  fetchEvents,
  createEvent,
  updateEvent,
  uploadEventPoster,
  createNotification,
} from "./events-api.js";

// ── STATE ──────────────────────────────────────────────────
let editId = null;
// posterFile และ posterUrl ใช้ผ่าน window._posterFile / window._posterUrl
// (set โดย plain script ใน HTML เพื่อแก้ ES Module timing issue)

// ── INIT ───────────────────────────────────────────────────
async function initPage() {
  const params = new URLSearchParams(window.location.search);
  editId = params.get("id") ? parseInt(params.get("id")) : null;

  await loadUsers();

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
  } catch (e) {
    showToast("โหลดข้อมูลผู้ใช้ไม่ได้", "error");
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
    document.getElementById("fEventType").value = e.event_type || "";
    document.getElementById("fEventDate").value = e.event_date || "";
    document.getElementById("fEndDate").value = e.end_date || "";
    document.getElementById("fStartTime").value = e.start_time
      ? e.start_time.slice(0, 5)
      : "";
    document.getElementById("fEndTime").value = e.end_time
      ? e.end_time.slice(0, 5)
      : "";
    document.getElementById("fLocation").value = e.location || "";
    document.getElementById("fMaxAttendees").value = e.max_attendees || "";
    document.getElementById("fAssignedTo").value = e.assigned_to || "";
    document.getElementById("fStatus").value = e.status || "DRAFT";
    document.getElementById("fDescription").value = e.description || "";

    if (e.poster_url) {
      window._posterUrl = e.poster_url;
      // แสดง preview โดยเรียก _showPosterPreview ที่ define ใน plain script
      if (typeof _showPosterPreview === "function") {
        _showPosterPreview(e.poster_url);
      }
    }
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
  const date = document.getElementById("fEventDate").value;

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

  const endDate = document.getElementById("fEndDate").value;
  if (endDate && endDate < date) {
    showToast("วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่ม", "error");
    return false;
  }
  return true;
}

// ── SAVE ───────────────────────────────────────────────────
window.saveEvent = async function () {
  if (!validate()) return;

  showLoading(true);
  try {
    const payload = {
      event_name: document.getElementById("fEventName").value.trim(),
      event_code: document.getElementById("fEventCode").value.trim(),
      event_type: document.getElementById("fEventType").value,
      event_date: document.getElementById("fEventDate").value,
      end_date: document.getElementById("fEndDate").value || null,
      start_time: document.getElementById("fStartTime").value || null,
      end_time: document.getElementById("fEndTime").value || null,
      location: document.getElementById("fLocation").value.trim() || null,
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

    // อ่าน posterFile จาก window (set โดย plain script)
    const posterFile = window._posterFile;
    const posterUrl = window._posterUrl;

    if (posterFile && savedId) {
      const url = await uploadEventPoster(savedId, posterFile);
      await updateEvent(savedId, { poster_url: url });
    }

    if (!posterFile && !posterUrl && editId) {
      await updateEvent(editId, { poster_url: null });
    }

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
      window.location.href = "../activity/events-list.html";
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
      ...new Set(events.map((e) => e.event_name).filter(Boolean)),
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
