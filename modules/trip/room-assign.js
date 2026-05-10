/* ============================================================
   room-assign.js — จัดห้องพัก (per-trip room assignment)
   ============================================================ */

const state = {
  tripId: null,
  trip: null,
  passengers: [],   // tour_seat_check rows for this trip (excluding sub-rows = unique people)
  totalSeats: 0,    // total rows including sub-rows (= seat count)
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
        `?trip_id=eq.${state.tripId}&select=code,name,gender,nationality,passport_image_url,visa_image_url,passport_id,passport_exp_date,group_name,seat,room_id,is_sub_row,parent_code&order=group_name.asc.nullslast,name.asc`),
      sbFetch("trip_rooms",
        `?trip_id=eq.${state.tripId}&select=*&order=sort_order.asc,room_id.asc`),
    ]);
    state.trip = trip;
    // แสดงทุกแถว (รวม sub-row) — แต่ละแถว = 1 ที่นั่ง = 1 ช่อง assign ให้ห้องได้
    // sub-row ที่ไม่มี name → ใช้ชื่อ parent + ป้าย "ที่นั่งที่ N" เป็น fallback
    const allRows = paxs || [];
    const byCode = {};
    allRows.forEach(r => { byCode[r.code] = r; });
    allRows.forEach(r => {
      if (r.is_sub_row && r.parent_code) {
        const parent = byCode[r.parent_code];
        if (parent) {
          if (!r.name && parent.name) r._inheritedName = parent.name;
          if (!r.nationality && parent.nationality) r._inheritedNat = parent.nationality;
          if (!r.gender && parent.gender) r._inheritedGender = parent.gender;
          if (!r.passport_image_url && parent.passport_image_url) r._inheritedPassImg = parent.passport_image_url;
          if (!r.visa_image_url && parent.visa_image_url) r._inheritedVisaImg = parent.visa_image_url;
        }
      }
    });
    state.totalSeats = allRows.length;
    state.passengers = allRows;
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

  // Sub-text: parent vs sub-row breakdown
  const sub = document.getElementById("statTotalSub");
  if (sub) {
    const parents = state.passengers.filter(p => !p.is_sub_row).length;
    const subRows = total - parents;
    sub.textContent = subRows > 0 ? `(${parents} หลัก + ${subRows} ที่นั่งร่วม)` : "";
  }
}

// ── PASSENGER LIST (left) ──────────────────────────────────
function renderPassengers() {
  const search = (document.getElementById("paxSearch")?.value || "").toLowerCase();
  const status = document.getElementById("paxFilterStatus")?.value || "unassigned";
  const gender = document.getElementById("paxFilterGender")?.value || "";

  const filtered = state.passengers.filter(p => {
    if (status === "unassigned" && p.room_id != null) return false;
    if (status === "assigned" && p.room_id == null) return false;
    if (gender && normGender(p.gender) !== gender) return false;
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
    const gNorm = normGender(p.gender || p._inheritedGender);
    const gTag = gNorm === "M" ? '<span class="ra-gender-tag ra-gender-M">♂ M</span>'
              : gNorm === "F" ? '<span class="ra-gender-tag ra-gender-F">♀ F</span>'
              : "";
    const room = isAssigned ? roomNameById(p.room_id) : "";
    // sub-row → fallback เป็น parent
    const displayName = p.name || p._inheritedName || "—";
    const displayNat  = p.nationality || p._inheritedNat || "—";
    const codeText    = p.code || "—";
    const hasImg      = !!(p.passport_image_url || p._inheritedPassImg || p.visa_image_url || p._inheritedVisaImg);
    return `<div class="ra-pax-row${sel}${ass}${p.is_sub_row ? " sub" : ""}" data-code="${escapeAttr(p.code)}" onclick="window.selectPax('${escapeJs(p.code)}')">
      <div class="ra-pax-row-top">
        <span class="ra-pax-code">${escapeHtml(codeText)}</span>
        <span class="ra-pax-nat">${escapeHtml(displayNat)}</span>
      </div>
      <div class="ra-pax-row-bot">
        <span class="ra-pax-name${hasImg ? ' clickable' : ''}"
          ${hasImg ? `title="คลิกดูรูป passport" onclick="event.stopPropagation();window.viewPaxPassport('${escapeJs(p.code)}')"` : ""}>
          ${escapeHtml(displayName)}${hasImg ? ' <span class="ra-pax-img-ind">📷</span>' : ''}
        </span>
        ${gTag || '<span></span>'}
      </div>
      ${room ? `<div class="ra-pax-room-tag">🛏️ ${escapeHtml(room)}</div>` : ""}
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

    const ridsCsv = rooms.map(r => r.room_id).join(",");
    return `<div class="ra-rooms-grp">
      <div class="ra-rooms-grp-hdr">
        <div class="ra-grp-title">
          <span class="ra-grp-icon">🛏️</span>${escapeHtml(typeName)}
          <span class="ra-grp-count" style="margin-left:8px">· ${rooms.length} ห้อง · ${totalOcc}/${totalCap} คน</span>
        </div>
        <button class="ra-grp-del" data-perm="trip_rooms_delete"
          title="ลบห้องแบบ ${escapeAttr(typeName)} ทั้งหมด (รายชื่อกลับเป็นยังไม่จัด)"
          onclick="window.deleteRoomGroup('${escapeJs(typeName)}', [${ridsCsv}], ${totalOcc})">
          🗑 ลบทั้งหมด
        </button>
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
  const occHtml = occupants.map(o => {
    const gn = normGender(o.gender || o._inheritedGender);
    const gT = gn === "M" ? '<span class="ra-gender-tag ra-gender-M">♂ M</span>'
            : gn === "F" ? '<span class="ra-gender-tag ra-gender-F">♀ F</span>'
            : "";
    const dName = o.name || o._inheritedName || "—";
    const dNat  = o.nationality || o._inheritedNat || "—";
    const hasImg = !!(o.passport_image_url || o._inheritedPassImg || o.visa_image_url || o._inheritedVisaImg);
    return `<div class="ra-occ">
      <button class="ra-occ-remove" title="ย้ายออกจากห้องนี้" onclick="event.stopPropagation();window.unassignPax('${escapeJs(o.code)}')">×</button>
      <div class="ra-pax-row-top">
        <span class="ra-pax-code">${escapeHtml(o.code || "—")}</span>
        <span class="ra-pax-nat">${escapeHtml(dNat)}</span>
      </div>
      <div class="ra-pax-row-bot">
        <span class="ra-pax-name${hasImg ? ' clickable' : ''}"
          ${hasImg ? `title="คลิกดูรูป passport" onclick="event.stopPropagation();window.viewPaxPassport('${escapeJs(o.code)}')"` : ""}>
          ${escapeHtml(dName)}${hasImg ? ' <span class="ra-pax-img-ind">📷</span>' : ''}
        </span>
        ${gT || '<span></span>'}
      </div>
    </div>`;
  }).join("");

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
    <div class="ra-room-meta" onclick="event.stopPropagation()">
      <div class="ra-cap-bar"><div class="ra-cap-fill${fullCls}" style="width:${pct}%"></div></div>
      <div class="ra-cap-text">
        ${occCount}/<span class="ra-cap-edit" title="คลิกเพื่อแก้ความจุ (เผื่อ extra bed)"
          onclick="window.editRoomCapacity(${r.room_id}, ${cap}, ${occCount})"
          style="cursor:pointer;border-bottom:1px dashed var(--text3);padding:0 2px">${cap}</span>
      </div>
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

window.editRoomCapacity = async function (roomId, currentCap, occCount) {
  let newVal;
  if (window.PromptModal?.open) {
    newVal = await window.PromptModal.open({
      title: "แก้ไขความจุห้อง",
      message: `ความจุปัจจุบัน ${currentCap} คน${occCount > 0 ? ` · มีคนอยู่ ${occCount} คน` : ""} — เพิ่ม = extra bed, ลด = ลบเตียง`,
      icon: "🛏️",
      tone: "primary",
      inputType: "number",
      defaultValue: String(currentCap),
      placeholder: "ใส่จำนวนใหม่",
      okText: "บันทึก",
      required: true,
    });
  } else {
    newVal = prompt(`ความจุห้องใหม่ (ปัจจุบัน ${currentCap}):`, String(currentCap));
  }
  if (newVal == null) return; // cancelled

  const n = parseInt(newVal, 10);
  if (!Number.isFinite(n) || n < 1) {
    showToast("ความจุต้องเป็นตัวเลข ≥ 1", "error");
    return;
  }
  if (n < occCount) {
    showToast(`ห้องนี้มีคนอยู่ ${occCount} คน — ลดต่ำกว่านี้ไม่ได้`, "error");
    return;
  }
  if (n === currentCap) return;

  try {
    await sbFetch("trip_rooms", `?room_id=eq.${roomId}`, {
      method: "PATCH",
      body: { capacity: n, updated_at: new Date().toISOString() },
    });
    const r = state.rooms.find(x => x.room_id === roomId);
    if (r) r.capacity = n;
    renderStats();
    renderRooms();
    showToast(`ปรับความจุเป็น ${n}${n > currentCap ? " (+ extra bed)" : ""}`, "success");
  } catch (e) {
    showToast("แก้ไขไม่สำเร็จ: " + e.message, "error");
  }
};

window.viewPaxPassport = function (code) {
  const p = state.passengers.find(x => x.code === code);
  if (!p) return;
  const pass = p.passport_image_url || p._inheritedPassImg || null;
  const visa = p.visa_image_url     || p._inheritedVisaImg || null;
  const imgs = [pass, visa].filter(Boolean);
  if (!imgs.length) {
    showToast("ไม่มีรูป passport / visa", "info");
    return;
  }
  const titles = [];
  if (pass) titles.push(`Passport — ${p.name || p._inheritedName || code}`);
  if (visa) titles.push(`Visa — ${p.name || p._inheritedName || code}`);
  const skus = imgs.map(() => `${code}${p.passport_id ? ' · ' + p.passport_id : ''}`);
  // ImgPopup เป็น `const` (script-scope) — ไม่อยู่บน window — ใช้ typeof เช็ค
  if (typeof ImgPopup !== "undefined" && ImgPopup.open) {
    ImgPopup.open(imgs, 0, { titles, skus });
  } else {
    window.open(imgs[0], "_blank");
  }
};

window.deleteRoomGroup = function (typeName, roomIds, occCount) {
  if (!Array.isArray(roomIds) || roomIds.length === 0) return;
  const msg = occCount > 0
    ? `ลบห้องแบบ "${typeName}" ทั้งหมด ${roomIds.length} ห้อง?<br><span style="color:#b91c1c">มีผู้พักอยู่ ${occCount} คน — จะถูกย้ายกลับเป็น "ยังไม่จัด" อัตโนมัติ</span>`
    : `ลบห้องแบบ "${typeName}" ทั้งหมด ${roomIds.length} ห้อง?`;

  const opener = window.DeleteModal?.open || window.ConfirmModal?.open;
  const doDelete = async () => {
    showLoading(true);
    try {
      // FK ON DELETE SET NULL → tour_seat_check.room_id ของผู้พัก = NULL อัตโนมัติ
      await sbFetch("trip_rooms", `?room_id=in.(${roomIds.join(",")})`, { method: "DELETE" });
      showToast(`ลบห้องแบบ "${typeName}" ${roomIds.length} ห้องแล้ว`, "success");
      await loadAll();
    } catch (e) {
      showToast("ลบไม่สำเร็จ: " + e.message, "error");
    }
    showLoading(false);
  };
  if (opener) opener(msg, doDelete);
  else if (confirm(msg.replace(/<[^>]+>/g, ""))) doDelete();
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
// แปลง gender ที่อาจเก็บเป็น "M" / "F" / "male" / "female" / "MALE" → "M" | "F" | ""
function normGender(g) {
  const c = String(g || "").trim().charAt(0).toUpperCase();
  return c === "M" || c === "F" ? c : "";
}

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
