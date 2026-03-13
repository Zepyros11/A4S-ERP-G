/* ============================================================
   rooms-list.js — Controller for Meeting Rooms page
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
  return sbFetch("meeting_rooms", "?select=*&order=room_code") || [];
}
async function fetchTodayBookings() {
  const today = new Date().toISOString().split("T")[0];
  return (
    sbFetch(
      "room_bookings",
      `?booking_date=eq.${today}&status=neq.CANCELLED&select=*`,
    ) || []
  );
}
async function createRoom(data) {
  const res = await sbFetch("meeting_rooms", "", {
    method: "POST",
    body: data,
  });
  return res?.[0];
}
async function updateRoom(id, data) {
  return sbFetch("meeting_rooms", `?room_id=eq.${id}`, {
    method: "PATCH",
    body: data,
  });
}
async function removeRoom(id) {
  return sbFetch("meeting_rooms", `?room_id=eq.${id}`, { method: "DELETE" });
}

// ── STATE ─────────────────────────────────────────────────
let allRooms = [];
let todayBookings = [];
let editingRoomId = null;

// ── INIT ──────────────────────────────────────────────────
async function initPage() {
  await loadData();
  bindEvents();
}

async function loadData() {
  showLoading(true);
  try {
    const [rooms, bookings] = await Promise.all([
      fetchRooms(),
      fetchTodayBookings(),
    ]);
    allRooms = rooms || [];
    todayBookings = bookings || [];
    populateBranchFilter();
    updateCards();
    filterRooms();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

function bindEvents() {
  document
    .getElementById("searchInput")
    ?.addEventListener("input", filterRooms);
  document
    .getElementById("filterBranch")
    ?.addEventListener("change", filterRooms);
  document
    .getElementById("filterStatus")
    ?.addEventListener("change", filterRooms);
}

// ── POPULATE ──────────────────────────────────────────────
function populateBranchFilter() {
  const branches = [...new Set(allRooms.map((r) => r.branch).filter(Boolean))];
  const sel = document.getElementById("filterBranch");
  sel.innerHTML = '<option value="">⚪ ทุกสาขา</option>';
  branches.forEach((b) =>
    sel.insertAdjacentHTML("beforeend", `<option value="${b}">${b}</option>`),
  );
}

// ── CARDS ─────────────────────────────────────────────────
function updateCards() {
  document.getElementById("cardTotal").textContent = allRooms.length;
  document.getElementById("cardActive").textContent = allRooms.filter(
    (r) => r.is_active,
  ).length;
  document.getElementById("cardTodayBookings").textContent =
    todayBookings.length;
}

// ── FILTER + RENDER ───────────────────────────────────────
function filterRooms() {
  const search =
    document.getElementById("searchInput")?.value.toLowerCase() || "";
  const branch = document.getElementById("filterBranch")?.value || "";
  const status = document.getElementById("filterStatus")?.value || "";

  const filtered = allRooms.filter((r) => {
    const matchSearch =
      !search ||
      (r.room_name || "").toLowerCase().includes(search) ||
      (r.room_code || "").toLowerCase().includes(search);
    const matchBranch = !branch || r.branch === branch;
    const matchStatus = !status || String(r.is_active) === status;
    return matchSearch && matchBranch && matchStatus;
  });

  renderRooms(filtered);
}

function renderRooms(list) {
  const grid = document.getElementById("roomsGrid");
  const countEl = document.getElementById("roomCount");
  if (countEl) countEl.textContent = `${list.length} ห้อง`;

  if (!list.length) {
    grid.innerHTML = `<div style="grid-column:1/-1">
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <div class="empty-text">ไม่พบห้องประชุม</div>
      </div></div>`;
    return;
  }

  grid.innerHTML = list
    .map((r) => {
      const facilities = Array.isArray(r.facilities)
        ? r.facilities
        : r.facilities
          ? Object.values(r.facilities)
          : [];

      const facTags = facilities
        .slice(0, 4)
        .map((f) => `<span class="facility-tag">${facilityLabel(f)}</span>`)
        .join("");
      const moreTag =
        facilities.length > 4
          ? `<span class="facility-tag">+${facilities.length - 4}</span>`
          : "";

      const todayCount = todayBookings.filter(
        (b) => b.room_id === r.room_id,
      ).length;

      return `
    <div class="room-card ${r.is_active ? "" : "inactive"}">
      <div class="room-card-header">
        <div class="room-card-icon">🚪</div>
        <div style="flex:1">
          <div class="room-card-name">${r.room_name}</div>
          <div class="room-card-code">${r.room_code}</div>
        </div>
        <label class="switch" onclick="event.stopPropagation()">
          <input type="checkbox" ${r.is_active ? "checked" : ""}
            onchange="window.toggleRoomActive(${r.room_id}, this)">
          <span class="slider"></span>
        </label>
      </div>
      <div class="room-card-meta">
        ${r.capacity ? `<span class="room-meta-chip">👥 ${r.capacity} คน</span>` : ""}
        ${r.branch ? `<span class="room-meta-chip">🏢 ${r.branch}</span>` : ""}
        ${r.floor ? `<span class="room-meta-chip">🏬 ชั้น ${r.floor}</span>` : ""}
        ${todayCount ? `<span class="room-meta-chip" style="background:#dbeafe;color:#1d4ed8">📅 ${todayCount} จองวันนี้</span>` : ""}
      </div>
      ${facilities.length ? `<div class="room-facilities">${facTags}${moreTag}</div>` : ""}
      <div class="room-card-actions">
        <button class="btn btn-secondary" style="font-size:12px;flex:1"
          onclick="window.location.href='./room-booking.html?room_id=${r.room_id}'">
          📅 ดูการจอง
        </button>
        <button class="btn-icon" onclick="window.openRoomModal(${r.room_id})">✏️</button>
        <button class="btn-icon danger" onclick="window.deleteRoom(${r.room_id})">🗑</button>
      </div>
    </div>`;
    })
    .join("");
}

// ── TOGGLE ACTIVE ─────────────────────────────────────────
window.toggleRoomActive = async function (id, el) {
  try {
    await updateRoom(id, { is_active: el.checked });
    const r = allRooms.find((x) => x.room_id === id);
    if (r) r.is_active = el.checked;
    updateCards();
    showToast(el.checked ? "เปิดใช้งานแล้ว" : "ปิดใช้งานแล้ว", "success");
  } catch (e) {
    el.checked = !el.checked;
    showToast("อัปเดตสถานะไม่สำเร็จ", "error");
  }
};

// ── ROOM MODAL ────────────────────────────────────────────
window.openRoomModal = function (id = null) {
  editingRoomId = id;
  document.getElementById("roomModalTitle").textContent = id
    ? "✏️ แก้ไขห้องประชุม"
    : "🚪 เพิ่มห้องประชุม";

  // reset
  [
    "fRoomId",
    "fRoomCode",
    "fRoomName",
    "fRoomBranch",
    "fRoomFloor",
    "fRoomNote",
  ].forEach((f) => {
    document.getElementById(f).value = "";
  });
  document.getElementById("fRoomCapacity").value = "";
  document.getElementById("fRoomActive").value = "true";
  document
    .querySelectorAll(".facilities-grid input[type=checkbox]")
    .forEach((cb) => (cb.checked = false));

  if (id) {
    const r = allRooms.find((x) => x.room_id === id);
    if (r) {
      document.getElementById("fRoomId").value = r.room_id;
      document.getElementById("fRoomCode").value = r.room_code || "";
      document.getElementById("fRoomName").value = r.room_name || "";
      document.getElementById("fRoomBranch").value = r.branch || "";
      document.getElementById("fRoomFloor").value = r.floor || "";
      document.getElementById("fRoomCapacity").value = r.capacity || "";
      document.getElementById("fRoomActive").value = String(r.is_active);
      document.getElementById("fRoomNote").value = r.note || "";

      const facs = Array.isArray(r.facilities)
        ? r.facilities
        : r.facilities
          ? Object.values(r.facilities)
          : [];
      document
        .querySelectorAll(".facilities-grid input[type=checkbox]")
        .forEach((cb) => {
          if (facs.includes(cb.value)) cb.checked = true;
        });
    }
  }

  document.getElementById("roomModalOverlay").classList.add("open");
};

window.closeRoomModal = function () {
  document.getElementById("roomModalOverlay").classList.remove("open");
  editingRoomId = null;
};

window.saveRoom = async function () {
  const code = document.getElementById("fRoomCode").value.trim();
  const name = document.getElementById("fRoomName").value.trim();
  if (!code) {
    showToast("กรุณาระบุรหัสห้อง", "error");
    return;
  }
  if (!name) {
    showToast("กรุณาระบุชื่อห้อง", "error");
    return;
  }

  const facilities = Array.from(
    document.querySelectorAll(".facilities-grid input[type=checkbox]:checked"),
  ).map((cb) => cb.value);

  const payload = {
    room_code: code,
    room_name: name,
    branch: document.getElementById("fRoomBranch").value || null,
    floor: document.getElementById("fRoomFloor").value || null,
    capacity: parseInt(document.getElementById("fRoomCapacity").value) || null,
    is_active: document.getElementById("fRoomActive").value === "true",
    note: document.getElementById("fRoomNote").value || null,
    facilities: facilities,
  };

  showLoading(true);
  try {
    if (editingRoomId) {
      await updateRoom(editingRoomId, payload);
      showToast("แก้ไขห้องแล้ว", "success");
    } else {
      await createRoom(payload);
      showToast("เพิ่มห้องแล้ว", "success");
    }
    window.closeRoomModal();
    await loadData();
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

// ── DELETE ────────────────────────────────────────────────
window.deleteRoom = function (id) {
  const r = allRooms.find((x) => x.room_id === id);
  if (!r) return;
  DeleteModal.open(`ต้องการลบห้อง "${r.room_name}" หรือไม่?`, async () => {
    showLoading(true);
    try {
      await removeRoom(id);
      showToast("ลบห้องแล้ว", "success");
      await loadData();
    } catch (e) {
      showToast("ลบไม่สำเร็จ: " + e.message, "error");
    }
    showLoading(false);
  });
};

// ── HELPERS ───────────────────────────────────────────────
function facilityLabel(f) {
  return (
    {
      projector: "📽 Projector",
      tv: "📺 TV",
      whiteboard: "📋 Whiteboard",
      video_conf: "📹 VDO Conf",
      wifi: "📶 Wi-Fi",
      ac: "❄️ AC",
      mic: "🎤 Mic",
      coffee: "☕ Coffee",
      phone: "📞 Phone",
    }[f] || f
  );
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
