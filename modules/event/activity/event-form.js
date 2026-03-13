/* ============================================================
   event-form.js — Controller for Event Form page
============================================================ */

import {
  fetchEventById,
  fetchUsers,
  createEvent,
  updateEvent,
  uploadEventPoster,
  createNotification,
} from "./events-api.js";

// ── STATE ──────────────────────────────────────────────────
let editId = null; // null = สร้างใหม่, number = แก้ไข
let posterFile = null; // ไฟล์ที่เลือกแต่ยังไม่ upload
let posterUrl = null; // URL ที่มีอยู่แล้ว (กรณีแก้ไข)

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
    const code = await autoGenerateCode();
    document.getElementById("fEventCode").value = code;
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

    // โปสเตอร์
    if (e.poster_url) {
      posterUrl = e.poster_url;
      showPosterPreview(e.poster_url);
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

  // ดึงทุก code ที่มี prefix นี้ แล้วหา max seq
  const res = await fetch(
    `${url}/rest/v1/events?select=event_code&event_code=like.${prefix}*`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    },
  );
  const rows = await res.json();

  let maxSeq = 0;
  if (rows?.length) {
    rows.forEach((r) => {
      const n = parseInt((r.event_code || "").split("-").pop(), 10);
      if (!isNaN(n) && n > maxSeq) maxSeq = n;
    });
  }

  // ใช้ timestamp เป็น fallback กัน collision
  const seq = maxSeq + 1;
  const code = `${prefix}${String(seq).padStart(3, "0")}`;
  document.getElementById("fEventCode").value = code;
  return code;
}
// ── POSTER HANDLERS ────────────────────────────────────────
window.handlePosterSelect = function (input) {
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    showToast("ไฟล์ใหญ่เกิน 5MB", "error");
    return;
  }
  posterFile = file;
  const url = URL.createObjectURL(file);
  showPosterPreview(url);
};

window.handlePosterDrop = function (e) {
  e.preventDefault();
  document.getElementById("uploadZone").classList.remove("drag-over");
  const file = e.dataTransfer.files?.[0];
  if (!file || !file.type.startsWith("image/")) {
    showToast("กรุณาเลือกไฟล์รูปภาพเท่านั้น", "error");
    return;
  }
  posterFile = file;
  showPosterPreview(URL.createObjectURL(file));
};

function showPosterPreview(url) {
  document.getElementById("posterPreview").innerHTML =
    `<img src="${url}" alt="poster preview">`;
  document.getElementById("btnRemovePoster").style.display = "block";
}

window.removePoster = function () {
  posterFile = null;
  posterUrl = null;
  document.getElementById("posterPreview").innerHTML =
    `<span class="ef-poster-placeholder">🗓️</span>`;
  document.getElementById("btnRemovePoster").style.display = "none";
  document.getElementById("posterInput").value = "";
};

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
    // 1. เตรียม payload
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

    // 2. Save to DB
    let savedId = editId;
    if (editId) {
      await updateEvent(editId, payload);
    } else {
      const res = await createEvent(payload);
      savedId = res?.event_id;
    }

    // 3. Upload poster ถ้ามีไฟล์ใหม่
    if (posterFile && savedId) {
      const url = await uploadEventPoster(savedId, posterFile);
      await updateEvent(savedId, { poster_url: url });
    }

    // 4. ถ้าลบโปสเตอร์
    if (!posterFile && !posterUrl && editId) {
      await updateEvent(editId, { poster_url: null });
    }

    // 5. Notification (กรณีสร้างใหม่)
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

    // 6. กลับหน้า list
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

// ── START ──────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPage);
} else {
  initPage();
}
