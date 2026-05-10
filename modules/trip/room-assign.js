/* ============================================================
   room-assign.js — จัดห้องพัก (per-trip room assignment)
   ============================================================ */

const state = {
  tripId: null,
  trip: null,
  passengers: [],   // tour_seat_check rows for this trip (excluding sub-rows)
  rooms: [],        // trip_rooms for this trip
  selectedPaxCode: null,  // currently selected passenger code (single-select)
};

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
    throw new Error(e.message || "API Error");
  }
  return method === "DELETE" ? null : res.json().catch(() => null);
}

// ── INIT ───────────────────────────────────────────────────
async function init() {
  const qs = new URLSearchParams(location.search);
  const tid = parseInt(qs.get("trip_id"), 10);
  if (!Number.isFinite(tid) || tid <= 0) {
    showToast("ไม่พบ trip_id ใน URL", "error");
    setTimeout(() => (location.href = "./trip-list.html"), 1500);
    return;
  }
  state.tripId = tid;

  const { url, key } = getSB();
  if (!url || !key) {
    showToast("ยังไม่ได้เชื่อมต่อ Supabase", "error");
    return;
  }

  bindEvents();
  await loadAll();
}

async function loadAll() {
  showLoading(true);
  try {
    const [trip, paxs, rooms] = await Promise.all([
      sbFetch("trips", `?trip_id=eq.${state.tripId}&select=*`).then(r => r?.[0] || null),
      sbFetch("tour_seat_check",
        `?trip_id=eq.${state.tripId}&select=code,name,gender,group_name,seat,room_id,is_sub_row,parent_code&order=group_name.asc.nullslast,name.asc`),
      sbFetch("trip_rooms",
        `?trip_id=eq.${state.tripId}&select=*&order=sort_order.asc,room_id.asc`),
    ]);
    state.trip = trip;
    // ตัด sub-row ออก (sub-row ไม่ใช่คน — เป็น seat ที่นั่งซ้ำของคนเดียว)
    // แต่ในกรณีตั๋ว seat=2 = 1 คน 2 ที่นั่ง ลูกใน sub-row ไม่ใช่คนเพิ่ม
    state.passengers = (paxs || []).filter(p => !p.is_sub_row);
    state.rooms = rooms || [];

    renderTripBanner();
    renderStats();
    renderPassengers();
    renderRooms();
  } catch (e) {
    showToast("โหลดข้อมูลไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
}

function bindEvents() {
  document.getElementById("paxSearch")?.addEventListener("input", renderPassengers);
  document.getElementById("paxFilterStatus")?.addEventListener("change", renderPassengers);
  document.getElementById("paxFilterGender")?.addEventListener("change", renderPassengers);
}

// ── TRIP BANNER ────────────────────────────────────────────
function renderTripBanner() {
  if (!state.trip) return;
  const fmt = (window.DateFmt && window.DateFmt.formatDMY) || (s => s || "");
  document.getElementById("raTripName").textContent = "✈️ " + (state.trip.trip_name || `Trip #${state.tripId}`);
  const dates = (state.trip.start_date || state.trip.end_date)
    ? `${fmt(state.trip.start_date) || "—"} → ${fmt(state.trip.end_date) || "—"}`
    : "";
  document.getElementById("raTripDates").textContent = dates;
  document.getElementById("raTripBanner").style.display = "inline-flex";
  document.title = `${state.trip.trip_name || "Trip"} — จัดห้องพัก — A4S-ERP`;
}

// ── STATS ──────────────────────────────────────────────────
function renderStats() {
  const total = state.passengers.length;
  const assigned = state.passengers.filter(p => p.room_id != null).length;
  document.getElementById("statTotal").textContent = total;
  document.getElementById("statAssigned").textContent = assigned;
  document.getElementById("statUnassigned").textContent = total - assigned;
  document.getElementById("statRooms").textContent = state.rooms.length;
}

// ── PASSENGER LIST (left) ──────────────────────────────────
function renderPassengers() {
  const search = (document.getElementById("paxSearch")?.value || "").toLowerCase();
  const status = document.getElementById("paxFilterStatus")?.value || "unassigned";
  const gender = document.getElementById("paxFilterGender")?.value || "";

  const filtered = state.passengers.filter(p => {
    if (status === "unassigned" && p.room_id != null) return false;
    if (status === "assigned" && p.room_id == null) return false;
    if (gender && (p.gender || "").toUpperCase() !== gender) return false;
    if (search) {
      const hay = `${p.code || ""} ${p.name || ""} ${p.group_name || ""}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  document.getElementById("paxFilteredCount").textContent = filtered.length;

  const list = document.getElementById("paxList");
  if (!filtered.length) {
    list.innerHTML = `<div class="ra-pax-empty">ไม่พบผู้โดยสาร</div>`;
    return;
  }

  list.innerHTML = filtered.map(p => {
    const isAssigned = p.room_id != null;
    const sel = state.selectedPaxCode === p.code ? " selected" : "";
    const ass = isAssigned ? " assigned" : "";
    const g = (p.gender || "").toUpperCase();
    const gTag = g === "M" ? '<span class="ra-gender-tag ra-gender-M">M</span>'
              : g === "F" ? '<span class="ra-gender-tag ra-gender-F">F</span>'
              : "";
    const room = isAssigned ? roomNameById(p.room_id) : "";
    return `<div class="ra-pax-row${sel}${ass}" data-code="${escapeAttr(p.code)}" onclick="window.selectPax('${escapeJs(p.code)}')">
      <div style="flex:1;min-width:0">
        <div class="ra-pax-name">${escapeHtml(p.name || p.code || "—")}${gTag}</div>
        <div class="ra-pax-meta">${escapeHtml(p.code || "")}${p.group_name ? " · " + escapeHtml(p.group_name) : ""}${room ? ` · 🛏️ ${escapeHtml(room)}` : ""}</div>
      </div>
    </div>`;
  }).join("");
}

window.selectPax = function (code) {
  // toggle off if clicking same row
  state.selectedPaxCode = state.selectedPaxCode === code ? null : code;
  renderPassengers();
  updateSelectionHint();
  updateRoomCardsAssignableState();
};

window.clearPaxSelection = function () {
  state.selectedPaxCode = null;
  renderPassengers();
  updateSelectionHint();
  updateRoomCardsAssignableState();
};

function updateSelectionHint() {
  const hint = document.getElementById("selectedHint");
  const btn  = document.getElementById("btnClearSelection");
  if (state.selectedPaxCode) {
    const p = state.passengers.find(x => x.code === state.selectedPaxCode);
    hint.innerHTML = `เลือก: <b style="color:var(--accent)">${escapeHtml(p?.name || state.selectedPaxCode)}</b> — คลิกห้องที่ต้องการ`;
    btn.style.display = "inline-flex";
  } else {
    hint.textContent = "ยังไม่ได้เลือกผู้โดยสาร — คลิกชื่อด้านซ้ายเพื่อเริ่ม";
    btn.style.display = "none";
  }
}

function updateRoomCardsAssignableState() {
  document.querySelectorAll(".ra-room-card").forEach(card => {
    const rid = parseInt(card.dataset.roomId, 10);
    const r = state.rooms.find(x => x.room_id === rid);
    if (!r) return;
    const occCount = state.passengers.filter(p => p.room_id === rid).length;
    const isFull = occCount >= r.capacity;
    card.classList.toggle("full", isFull);
    card.classList.toggle("assignable", !!state.selectedPaxCode && !isFull);
  });
}

// ── ROOMS (right) ──────────────────────────────────────────
function roomNameById(rid) {
  const r = state.rooms.find(x => x.room_id === rid);
  return r ? r.room_name : "";
}

function renderRooms() {
  const c = document.getElementById("roomsContainer");
  if (!state.rooms.length) {
    c.innerHTML = `<div class="ra-empty-rooms">
      ยังไม่มีห้องพัก — กด "＋ เพิ่มประเภทห้อง" เพื่อสร้าง
    </div>`;
    return;
  }

  // Group by room_type
  const groups = {};
  state.rooms.forEach(r => {
    const k = r.room_type || "อื่นๆ";
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  });

  const occByRoom = {};
  state.passengers.forEach(p => {
    if (p.room_id != null) {
      if (!occByRoom[p.room_id]) occByRoom[p.room_id] = [];
      occByRoom[p.room_id].push(p);
    }
  });

  c.innerHTML = Object.keys(groups).map(typeName => {
    const rooms = groups[typeName];
    const totalCap = rooms.reduce((a, r) => a + (r.capacity || 0), 0);
    const totalOcc = rooms.reduce((a, r) => a + (occByRoom[r.room_id]?.length || 0), 0);

    return `<div class="ra-rooms-grp">
      <div class="ra-rooms-grp-hdr">
        <div class="ra-grp-title">
          <span class="ra-grp-icon">🛏️</span>${escapeHtml(typeName)}
          <span class="ra-grp-count" style="margin-left:8px">· ${rooms.length} ห้อง · ${totalOcc}/${totalCap} คน</span>
        </div>
      </div>
      <div class="ra-rooms-cards">
        ${rooms.map(r => roomCardHtml(r, occByRoom[r.room_id] || [])).join("")}
      </div>
    </div>`;
  }).join("");

  updateRoomCardsAssignableState();
}

function roomCardHtml(r, occupants) {
  const occCount = occupants.length;
  const cap = r.capacity || 0;
  const pct = cap > 0 ? Math.min(100, (occCount / cap) * 100) : 0;
  const fullCls = occCount >= cap ? " full" : (pct >= 70 ? " warn" : "");
  const occHtml = occupants.map(o => `
    <div class="ra-occ">
      <div>
        <span class="ra-occ-name">${escapeHtml(o.name || o.code || "—")}</span>
        <span class="ra-occ-meta">${escapeHtml(o.code || "")}${o.gender ? " · " + escapeHtml(o.gender) : ""}</span>
      </div>
      <button class="ra-occ-remove" title="ย้ายออกจากห้องนี้" onclick="event.stopPropagation();window.unassignPax('${escapeJs(o.code)}')">×</button>
    </div>
  `).join("");

  return `<div class="ra-room-card" data-room-id="${r.room_id}" onclick="window.assignSelectedPax(${r.room_id})">
    <div class="ra-room-card-hdr">
      <input class="ra-room-name" value="${escapeAttr(r.room_name || "")}" data-room-id="${r.room_id}"
             onclick="event.stopPropagation()"
             onblur="window.renameRoom(${r.room_id}, this.value)"
             onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" />
      <div class="ra-room-actions" onclick="event.stopPropagation()">
        <button class="danger" title="ลบห้องนี้" data-perm="trip_rooms_delete"
                onclick="window.deleteRoom(${r.room_id})">🗑</button>
      </div>
    </div>
    <div class="ra-room-meta">
      <div class="ra-cap-bar"><div class="ra-cap-fill${fullCls}" style="width:${pct}%"></div></div>
      <div class="ra-cap-text">${occCount}/${cap}</div>
    </div>
    <div class="ra-room-meta ra-room-gender" onclick="event.stopPropagation()">
      <span style="color:var(--text2)">เพศ:</span>
      <select onchange="window.updateRoomGender(${r.room_id}, this.value)">
        <option value=""  ${!r.gender_pref ? "selected" : ""}>ผสม / ไม่กำหนด</option>
        <option value="M" ${r.gender_pref === "M" ? "selected" : ""}>ชาย (M)</option>
        <option value="F" ${r.gender_pref === "F" ? "selected" : ""}>หญิง (F)</option>
      </select>
    </div>
    ${occHtml ? `<div class="ra-room-occupants">${occHtml}</div>` : `<div style="font-size:11px;color:var(--text3);text-align:center;padding:8px 0">ห้องว่าง</div>`}
  </div>`;
}

// ── ASSIGN / UNASSIGN ──────────────────────────────────────
window.assignSelectedPax = async function (roomId) {
  if (!state.selectedPaxCode) {
    showToast("เลือกผู้โดยสารทางซ้ายก่อน", "info");
    return;
  }
  const r = state.rooms.find(x => x.room_id === roomId);
  if (!r) return;
  const occCount = state.passengers.filter(p => p.room_id === roomId).length;
  if (occCount >= r.capacity) {
    showToast(`ห้อง "${r.room_name}" เต็มแล้ว (${occCount}/${r.capacity})`, "error");
    return;
  }

  const code = state.selectedPaxCode;
  const p = state.passengers.find(x => x.code === code);
  if (!p) return;

  // Optimistic UI
  const prevRoom = p.room_id;
  p.room_id = roomId;
  state.selectedPaxCode = null;
  renderStats();
  renderPassengers();
  renderRooms();
  updateSelectionHint();

  try {
    await sbFetch("tour_seat_check", `?code=eq.${encodeURIComponent(code)}`, {
      method: "PATCH",
      body: { room_id: roomId },
    });
    showToast(`✅ ${p.name || code} → ${r.room_name}`, "success");
  } catch (e) {
    p.room_id = prevRoom; // revert
    renderStats();
    renderPassengers();
    renderRooms();
    showToast("Assign ไม่สำเร็จ: " + e.message, "error");
  }
};

window.unassignPax = async function (code) {
  const p = state.passengers.find(x => x.code === code);
  if (!p) return;
  const prevRoom = p.room_id;

  p.room_id = null;
  renderStats();
  renderPassengers();
  renderRooms();

  try {
    await sbFetch("tour_seat_check", `?code=eq.${encodeURIComponent(code)}`, {
      method: "PATCH",
      body: { room_id: null },
    });
    showToast(`ย้ายออกจากห้องแล้ว: ${p.name || code}`, "success");
  } catch (e) {
    p.room_id = prevRoom;
    renderStats();
    renderPassengers();
    renderRooms();
    showToast("ย้ายออกไม่สำเร็จ: " + e.message, "error");
  }
};

// ── ROOM CRUD ──────────────────────────────────────────────
window.openRoomBatchModal = function () {
  document.getElementById("rbName").value = "";
  document.getElementById("rbCapacity").value = 2;
  document.getElementById("rbCount").value = 1;
  document.getElementById("rbGender").value = "";
  document.getElementById("rbNote").value = "";
  document.getElementById("roomBatchOverlay").classList.add("open");
  setTimeout(() => document.getElementById("rbName").focus(), 50);
};

window.closeRoomBatchModal = function (e) {
  if (e && e.target.id !== "roomBatchOverlay") return;
  document.getElementById("roomBatchOverlay").classList.remove("open");
};

window.saveRoomBatch = async function () {
  const name = document.getElementById("rbName").value.trim();
  const cap = parseInt(document.getElementById("rbCapacity").value, 10) || 2;
  const count = parseInt(document.getElementById("rbCount").value, 10) || 1;
  const gender = document.getElementById("rbGender").value || null;
  const note = document.getElementById("rbNote").value.trim() || null;

  if (!name) { showToast("กรอกชื่อแบบห้อง", "error"); return; }
  if (cap < 1)   { showToast("ความจุต้อง ≥ 1", "error"); return; }
  if (count < 1) { showToast("จำนวนต้อง ≥ 1", "error"); return; }

  // หา start index จากห้องประเภทเดียวกัน (เพื่อต่อเลข Twin-3 ถ้ามี Twin-1, Twin-2 อยู่)
  const sameType = state.rooms.filter(r => (r.room_type || "") === name);
  const startIdx = sameType.length + 1;
  const baseSort = state.rooms.length;

  const payload = [];
  for (let i = 0; i < count; i++) {
    payload.push({
      trip_id: state.tripId,
      room_name: `${name}-${startIdx + i}`,
      room_type: name,
      capacity: cap,
      gender_pref: gender,
      note: note,
      sort_order: baseSort + i,
    });
  }

  showLoading(true);
  try {
    await sbFetch("trip_rooms", "", { method: "POST", body: payload });
    showToast(`สร้างห้อง ${count} ห้องแล้ว`, "success");
    document.getElementById("roomBatchOverlay").classList.remove("open");
    await loadAll();
  } catch (e) {
    showToast("สร้างห้องไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

window.renameRoom = async function (roomId, newName) {
  const r = state.rooms.find(x => x.room_id === roomId);
  if (!r) return;
  const trimmed = (newName || "").trim();
  if (!trimmed || trimmed === r.room_name) {
    // restore previous if blank
    if (!trimmed) renderRooms();
    return;
  }
  try {
    await sbFetch("trip_rooms", `?room_id=eq.${roomId}`, {
      method: "PATCH",
      body: { room_name: trimmed, updated_at: new Date().toISOString() },
    });
    r.room_name = trimmed;
    showToast("เปลี่ยนชื่อห้องแล้ว", "success");
  } catch (e) {
    showToast("เปลี่ยนชื่อไม่ได้: " + e.message, "error");
    renderRooms();
  }
};

window.updateRoomGender = async function (roomId, val) {
  const r = state.rooms.find(x => x.room_id === roomId);
  if (!r) return;
  const newVal = val || null;
  try {
    await sbFetch("trip_rooms", `?room_id=eq.${roomId}`, {
      method: "PATCH",
      body: { gender_pref: newVal, updated_at: new Date().toISOString() },
    });
    r.gender_pref = newVal;
  } catch (e) {
    showToast("อัปเดตเพศไม่ได้: " + e.message, "error");
  }
};

window.deleteRoom = function (roomId) {
  const r = state.rooms.find(x => x.room_id === roomId);
  if (!r) return;
  const occCount = state.passengers.filter(p => p.room_id === roomId).length;
  const msg = occCount > 0
    ? `ห้อง "${r.room_name}" มีผู้พักอยู่ ${occCount} คน — ลบแล้วผู้โดยสารจะกลับเป็น "ยังไม่จัด" ดำเนินการต่อ?`
    : `ลบห้อง "${r.room_name}" หรือไม่?`;

  const opener = window.DeleteModal?.open || window.ConfirmModal?.open;
  const doDelete = async () => {
    showLoading(true);
    try {
      await sbFetch("trip_rooms", `?room_id=eq.${roomId}`, { method: "DELETE" });
      showToast("ลบห้องแล้ว", "success");
      await loadAll();
    } catch (e) {
      showToast("ลบไม่สำเร็จ: " + e.message, "error");
    }
    showLoading(false);
  };
  if (opener) opener(msg, doDelete);
  else if (confirm(msg)) doDelete();
};

// ── UTILS ──────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? "").replace(/[<>&"']/g, c => ({
    "<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;",
  })[c]);
}
function escapeAttr(s) { return escapeHtml(s); }
function escapeJs(s) {
  return String(s ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove("show"), 3000);
}

function showLoading(show) {
  document.getElementById("loadingOverlay")?.classList.toggle("show", show);
}

// ── START ──────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
