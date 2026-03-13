/* ============================================================
   room-booking.js — Controller for Room Booking page
============================================================ */

// ── API ───────────────────────────────────────────────────
function getSB() {
  return {
    url: localStorage.getItem("sb_url") || "",
    key: localStorage.getItem("sb_key") || "",
  };
}
async function sbFetch(table, query = "", opts = {}) {
  const { url, key } = getSB();
  const { method = "GET", body } = opts;
  const res = await fetch(`${url}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer:
        method === "POST" || method === "PATCH" ? "return=representation" : "",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || "Error");
  }
  return method === "DELETE" ? null : res.json().catch(() => null);
}

async function fetchRooms() {
  return (
    sbFetch("meeting_rooms", "?select=*&is_active=eq.true&order=room_code") ||
    []
  );
}
async function fetchBookings(roomId = null, date = null) {
  let q =
    "?select=*&status=neq.CANCELLED&order=booking_date.asc,start_time.asc";
  if (roomId) q += `&room_id=eq.${roomId}`;
  if (date) q += `&booking_date=eq.${date}`;
  return sbFetch("room_bookings", q) || [];
}
async function fetchAllBookings() {
  return (
    sbFetch(
      "room_bookings",
      "?select=*&order=booking_date.desc,start_time.asc",
    ) || []
  );
}
async function fetchUsers() {
  return sbFetch("users", "?select=user_id,full_name&is_active=eq.true") || [];
}
async function fetchEvents() {
  return (
    sbFetch(
      "events",
      "?select=event_id,event_name,event_code&status=neq.CANCELLED&order=event_date.desc",
    ) || []
  );
}
async function createBooking(data) {
  const res = await sbFetch("room_bookings", "", {
    method: "POST",
    body: data,
  });
  return res?.[0];
}
async function updateBooking(id, data) {
  return sbFetch("room_bookings", `?booking_id=eq.${id}`, {
    method: "PATCH",
    body: data,
  });
}
async function removeBooking(id) {
  return sbFetch("room_bookings", `?booking_id=eq.${id}`, { method: "DELETE" });
}

// ── CONFLICT CHECK ────────────────────────────────────────
async function checkConflict(
  roomId,
  date,
  startTime,
  endTime,
  excludeId = null,
) {
  let q = `?room_id=eq.${roomId}&booking_date=eq.${date}&status=neq.CANCELLED`;
  const bookings = (await sbFetch("room_bookings", q)) || [];
  return bookings.filter((b) => {
    if (excludeId && b.booking_id === excludeId) return false;
    // overlap check: start < other.end AND end > other.start
    return startTime < b.end_time && endTime > b.start_time;
  });
}

// ── STATE ─────────────────────────────────────────────────
let allRooms = [];
let allBookings = [];
let allUsers = [];
let allEvents = [];
let editingBookingId = null;
let preselectedRoomId = null;

// ── INIT ──────────────────────────────────────────────────
async function initPage() {
  // รับ room_id จาก URL (ถ้ามา redirect จาก rooms-list)
  const params = new URLSearchParams(window.location.search);
  preselectedRoomId = params.get("room_id")
    ? parseInt(params.get("room_id"))
    : null;

  await loadData();
  bindEvents();

  // pre-filter ถ้ามา redirect จากห้องใดห้องหนึ่ง
  if (preselectedRoomId) {
    document.getElementById("filterRoom").value = preselectedRoomId;
    filterBookings();
  }
}

async function loadData() {
  showLoading(true);
  try {
    const [rooms, bookings, users, events] = await Promise.all([
      fetchRooms(),
      fetchAllBookings(),
      fetchUsers(),
      fetchEvents(),
    ]);
    allRooms = rooms || [];
    allBookings = bookings || [];
    allUsers = users || [];
    allEvents = events || [];

    populateRoomFilter();
    populateBookingRoomSelect();
    populateEventSelect();
    filterBookings();

    // แสดงชื่อห้องใน page header ถ้า preselected
    if (preselectedRoomId) {
      const r = allRooms.find((x) => x.room_id === preselectedRoomId);
      if (r)
        document.getElementById("pageRoomName").textContent =
          `${r.room_name} (${r.room_code})`;
    }
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

function bindEvents() {
  document
    .getElementById("filterRoom")
    ?.addEventListener("change", filterBookings);
  document
    .getElementById("filterDate")
    ?.addEventListener("change", filterBookings);
  document
    .getElementById("filterBookingStatus")
    ?.addEventListener("change", filterBookings);

  // conflict check on time change
  ["fBookingRoom", "fBookingDate", "fBookingStart", "fBookingEnd"].forEach(
    (id) => {
      document
        .getElementById(id)
        ?.addEventListener("change", checkConflictLive);
    },
  );
}

// ── POPULATE ──────────────────────────────────────────────
function populateRoomFilter() {
  const sel = document.getElementById("filterRoom");
  sel.innerHTML = '<option value="">🚪 ทุกห้อง</option>';
  allRooms.forEach((r) =>
    sel.insertAdjacentHTML(
      "beforeend",
      `<option value="${r.room_id}">${r.room_name}</option>`,
    ),
  );
}
function populateBookingRoomSelect() {
  const sel = document.getElementById("fBookingRoom");
  sel.innerHTML = '<option value="">-- เลือกห้อง --</option>';
  allRooms.forEach((r) =>
    sel.insertAdjacentHTML(
      "beforeend",
      `<option value="${r.room_id}">${r.room_name} (${r.room_code})</option>`,
    ),
  );
}
function populateEventSelect() {
  const sel = document.getElementById("fBookingEvent");
  sel.innerHTML = '<option value="">-- ไม่ระบุ --</option>';
  allEvents.forEach((e) =>
    sel.insertAdjacentHTML(
      "beforeend",
      `<option value="${e.event_id}">${e.event_name} (${e.event_code})</option>`,
    ),
  );
}

// ── FILTER + RENDER ───────────────────────────────────────
function filterBookings() {
  const roomId = document.getElementById("filterRoom")?.value || "";
  const date = document.getElementById("filterDate")?.value || "";
  const status = document.getElementById("filterBookingStatus")?.value || "";

  const filtered = allBookings.filter((b) => {
    const matchRoom = !roomId || String(b.room_id) === roomId;
    const matchDate = !date || b.booking_date === date;
    const matchStatus = !status || b.status === status;
    return matchRoom && matchDate && matchStatus;
  });

  renderBookings(filtered);
}

function renderBookings(list) {
  const tbody = document.getElementById("bookingTableBody");
  const countEl = document.getElementById("bookingCount");
  if (countEl) countEl.textContent = `${list.length} รายการ`;

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="7">
      <div class="empty-state">
        <div class="empty-icon">📅</div>
        <div class="empty-text">ไม่พบการจอง</div>
      </div></td></tr>`;
    return;
  }

  tbody.innerHTML = list
    .map((b) => {
      const room = allRooms.find((r) => r.room_id === b.room_id);
      const user = allUsers.find((u) => u.user_id === b.booked_by);
      return `<tr>
      <td>
        <div style="font-weight:600">${room?.room_name || "—"}</div>
        <div style="font-size:11px;color:var(--text3)">${room?.room_code || ""}</div>
      </td>
      <td class="col-center" style="font-size:13px">${formatDate(b.booking_date)}</td>
      <td class="col-center" style="font-family:'IBM Plex Mono',monospace;font-size:12px">
        ${b.start_time?.slice(0, 5) || "—"} – ${b.end_time?.slice(0, 5) || "—"}
      </td>
      <td style="font-weight:500">${b.topic || "—"}</td>
      <td class="col-center" style="font-size:13px">${user?.full_name || "—"}</td>
      <td class="col-center">
        <span class="booking-status-badge bstatus-${b.status}">
          ${bookingStatusLabel(b.status)}
        </span>
      </td>
      <td style="text-align:center">
        <div class="action-group">
          ${
            b.status === "PENDING"
              ? `
          <button class="btn-icon"
            onclick="window.confirmBooking(${b.booking_id})">✅</button>`
              : ""
          }
          <button class="btn-icon"
            onclick="window.openBookingModal(${b.booking_id})">✏️</button>
          <button class="btn-icon danger"
            onclick="window.cancelBooking(${b.booking_id})">🗑</button>
        </div>
      </td>
    </tr>`;
    })
    .join("");
}

// ── CONFLICT CHECK (live) ─────────────────────────────────
async function checkConflictLive() {
  const roomId = document.getElementById("fBookingRoom").value;
  const date = document.getElementById("fBookingDate").value;
  const startTime = document.getElementById("fBookingStart").value;
  const endTime = document.getElementById("fBookingEnd").value;
  const alertEl = document.getElementById("conflictAlert");

  if (!roomId || !date || !startTime || !endTime) {
    alertEl.classList.remove("show");
    return;
  }
  if (startTime >= endTime) {
    alertEl.textContent = "⚠️ เวลาเริ่มต้องน้อยกว่าเวลาสิ้นสุด";
    alertEl.classList.add("show");
    return;
  }

  const conflicts = await checkConflict(
    parseInt(roomId),
    date,
    startTime,
    endTime,
    editingBookingId,
  );
  if (conflicts.length) {
    alertEl.textContent = `⚠️ ช่วงเวลานี้มีการจองอยู่แล้ว (${conflicts.length} รายการ) กรุณาเลือกเวลาอื่น`;
    alertEl.classList.add("show");
  } else {
    alertEl.classList.remove("show");
  }
}

// ── BOOKING MODAL ─────────────────────────────────────────
window.openBookingModal = function (id = null) {
  editingBookingId = id;
  document.getElementById("bookingModalTitle").textContent = id
    ? "✏️ แก้ไขการจอง"
    : "📅 จองห้องประชุม";
  document.getElementById("conflictAlert").classList.remove("show");

  // reset
  ["fBookingId", "fBookingTopic", "fBookingNote"].forEach(
    (f) => (document.getElementById(f).value = ""),
  );
  document.getElementById("fBookingRoom").value = preselectedRoomId || "";
  document.getElementById("fBookingDate").value = "";
  document.getElementById("fBookingStart").value = "";
  document.getElementById("fBookingEnd").value = "";
  document.getElementById("fBookingEvent").value = "";

  if (id) {
    const b = allBookings.find((x) => x.booking_id === id);
    if (b) {
      document.getElementById("fBookingId").value = b.booking_id;
      document.getElementById("fBookingRoom").value = b.room_id;
      document.getElementById("fBookingTopic").value = b.topic || "";
      document.getElementById("fBookingDate").value = b.booking_date || "";
      document.getElementById("fBookingStart").value =
        b.start_time?.slice(0, 5) || "";
      document.getElementById("fBookingEnd").value =
        b.end_time?.slice(0, 5) || "";
      document.getElementById("fBookingEvent").value = b.event_id || "";
      document.getElementById("fBookingNote").value = b.note || "";
    }
  }

  document.getElementById("bookingModalOverlay").classList.add("open");
};

window.closeBookingModal = function () {
  document.getElementById("bookingModalOverlay").classList.remove("open");
  editingBookingId = null;
};

window.saveBooking = async function () {
  const roomId = document.getElementById("fBookingRoom").value;
  const topic = document.getElementById("fBookingTopic").value.trim();
  const date = document.getElementById("fBookingDate").value;
  const startTime = document.getElementById("fBookingStart").value;
  const endTime = document.getElementById("fBookingEnd").value;

  if (!roomId) {
    showToast("กรุณาเลือกห้อง", "error");
    return;
  }
  if (!topic) {
    showToast("กรุณาระบุหัวข้อ", "error");
    return;
  }
  if (!date) {
    showToast("กรุณาเลือกวันที่", "error");
    return;
  }
  if (!startTime) {
    showToast("กรุณาเลือกเวลาเริ่ม", "error");
    return;
  }
  if (!endTime) {
    showToast("กรุณาเลือกเวลาสิ้นสุด", "error");
    return;
  }
  if (startTime >= endTime) {
    showToast("เวลาเริ่มต้องน้อยกว่าเวลาสิ้นสุด", "error");
    return;
  }

  // เช็ค conflict ก่อน save
  const conflicts = await checkConflict(
    parseInt(roomId),
    date,
    startTime,
    endTime,
    editingBookingId,
  );
  if (conflicts.length) {
    showToast("ช่วงเวลานี้มีการจองอยู่แล้ว", "error");
    return;
  }

  const session = JSON.parse(
    localStorage.getItem("erp_session") ||
      sessionStorage.getItem("erp_session") ||
      "{}",
  );

  const payload = {
    room_id: parseInt(roomId),
    topic,
    booking_date: date,
    start_time: startTime,
    end_time: endTime,
    event_id: document.getElementById("fBookingEvent").value || null,
    note: document.getElementById("fBookingNote").value || null,
    booked_by: session?.user_id || null,
    status: "CONFIRMED",
  };

  showLoading(true);
  try {
    if (editingBookingId) {
      await updateBooking(editingBookingId, payload);
      showToast("แก้ไขการจองแล้ว", "success");
    } else {
      await createBooking(payload);
      showToast("จองห้องสำเร็จ ✅", "success");
    }
    window.closeBookingModal();
    await loadData();
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

// ── CONFIRM / CANCEL ──────────────────────────────────────
window.confirmBooking = async function (id) {
  showLoading(true);
  try {
    await updateBooking(id, { status: "CONFIRMED" });
    showToast("ยืนยันการจองแล้ว ✅", "success");
    await loadData();
  } catch (e) {
    showToast("เกิดข้อผิดพลาด", "error");
  }
  showLoading(false);
};

window.cancelBooking = function (id) {
  const b = allBookings.find((x) => x.booking_id === id);
  if (!b) return;
  DeleteModal.open(`ต้องการยกเลิกการจอง "${b.topic}" หรือไม่?`, async () => {
    showLoading(true);
    try {
      await updateBooking(id, { status: "CANCELLED" });
      showToast("ยกเลิกการจองแล้ว", "success");
      await loadData();
    } catch (e) {
      showToast("เกิดข้อผิดพลาด", "error");
    }
    showLoading(false);
  });
};

// ── HELPERS ───────────────────────────────────────────────
function bookingStatusLabel(s) {
  return (
    {
      PENDING: "⏳ รอยืนยัน",
      CONFIRMED: "✅ ยืนยันแล้ว",
      CANCELLED: "⛔ ยกเลิก",
    }[s] || s
  );
}
function formatDate(d) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  const months = [
    "",
    "ม.ค.",
    "ก.พ.",
    "มี.ค.",
    "เม.ย.",
    "พ.ค.",
    "มิ.ย.",
    "ก.ค.",
    "ส.ค.",
    "ก.ย.",
    "ต.ค.",
    "พ.ย.",
    "ธ.ค.",
  ];
  return `${parseInt(day)} ${months[parseInt(m)]} ${parseInt(y) + 543}`;
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

// ── START ─────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPage);
} else {
  initPage();
}
