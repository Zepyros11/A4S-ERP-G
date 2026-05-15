/* ============================================================
   room-assign.js — จัดห้องพัก (per-trip room assignment)
   ============================================================ */

const state = {
  tripId: null,
  trip: null,
  passengers: [],   // tour_seat_check rows for this trip
  totalSeats: 0,    // total rows including sub-rows (= seat count)
  rooms: [],        // trip_rooms for this trip
  // 1 คน × N ห้อง — รองรับ trip หลายช่วงพัก (เปลี่ยนโรงแรมตามวัน)
  occupants: {},      // { [room_id]: [code, code, ...] }
  codeToRooms: {},    // { [code]: Set<room_id> }   reverse lookup
  selectedPaxCode: null,  // currently selected passenger code (single-select)
  hotels: [],       // places with place_type='HOTEL' (for modal helper)
  hotelRoomTypes: {}, // { [place_id]: [room_type_rows...] } cache
  // global room filter — true = แสดงเฉพาะห้องว่าง
  filterEmptyOnly: false,
  // groups ที่ถูกย่อ (collapsed) — เก็บ groupKey ของกลุ่มที่ย่ออยู่
  collapsedGroups: new Set(),
  // edit mode: ถ้าไม่ null = กำลังแก้ไขกลุ่มนี้ (แทนที่จะสร้างใหม่)
  editingGroupKey: null,
  // duplicate mode: ถ้าไม่ null = สร้างกลุ่มใหม่โดยใช้ผู้พักจากกลุ่มต้นฉบับนี้
  duplicateFromGroupKey: null,
  // Modal state
  rbSelectedHotelId: null,
  rbSelectedRoomTypeName: null,
  rbSelectedRoomTypeMaxGuests: 0,

  // ── BUS (รวมจาก bus-assign) ──
  buses: [],                  // trip_buses
  busOccupants: {},           // { [bus_id]: { [seat_no]: code } }
  codeToBusSeat: {},          // { [code]: { bus_id, seat_no } }   1 code ต่อทริป (UNIQUE per bus)
  collapsedBuses: new Set(),
  editingBusId: null,
  activeTab: "rooms",         // "rooms" | "buses"
  initialCollapseSet: false,  // set true หลัง init เพื่อกัน reset state ขยายของ user

  // ── GUIDES ──
  guides: [],                 // trip_guides
  busGuides: {},              // { [bus_id]: [guide_id, ...] }
  guideToBuses: {},           // { [guide_id]: Set<bus_id> }   reverse lookup
  editingGuideId: null,
  guideTargetBusId: null,     // bus_id ที่กำลังจะ assign ไกด์ให้ (ตอนเปิด modal)
};

// ── SEAT LAYOUT PRESETS ────────────────────────────────────
// cell: number=ที่นั่ง | "AISLE"=ทางเดิน | "EMPTY"=ช่องว่าง
const BUS_PRESETS = {
  BUS_45_2_2: {
    label: "🚌 รถบัส 45 ที่นั่ง (2+2 · แถวหลัง 5)",
    capacity: 45,
    description: "รถบัสมาตรฐาน 11 แถว — 10 แถวแบบ 2+2 + แถวหลังสุด 5 ที่นั่ง",
    rows: (() => {
      const rs = []; let n = 1;
      for (let r = 0; r < 10; r++) { rs.push([n, n + 1, "AISLE", n + 2, n + 3]); n += 4; }
      rs.push([n, n + 1, n + 2, n + 3, n + 4]);
      return rs;
    })(),
  },
  BUS_40_2_2: {
    label: "🚌 รถบัส 40 ที่นั่ง (2+2)",
    capacity: 40,
    description: "รถบัส 10 แถว แบบ 2+2 (4 ที่นั่ง/แถว)",
    rows: (() => {
      const rs = []; let n = 1;
      for (let r = 0; r < 10; r++) { rs.push([n, n + 1, "AISLE", n + 2, n + 3]); n += 4; }
      return rs;
    })(),
  },
  BUS_32_2_1: {
    label: "🚌 รถบัส VIP 32 ที่นั่ง (2+1)",
    capacity: 32,
    description: "รถบัส VIP 10 แถว แบบ 2+1 + แถวหลังสุด 2 ที่นั่ง",
    rows: (() => {
      const rs = []; let n = 1;
      for (let r = 0; r < 10; r++) { rs.push([n, n + 1, "AISLE", n + 2]); n += 3; }
      rs.push([n, "AISLE", n + 1]);
      return rs;
    })(),
  },
  VAN_15: {
    label: "🚐 รถตู้ Hiace 15 ที่นั่ง",
    capacity: 15,
    description: "รถตู้ 5 แถว — 2 / 3 / 3 / 3 / 4 (แถวหลัง)",
    rows: [
      ["EMPTY", "AISLE", 1, 2],
      [3, "AISLE", 4, 5],
      [6, "AISLE", 7, 8],
      [9, "AISLE", 10, 11],
      [12, 13, 14, 15],
    ],
  },
  VAN_13: {
    label: "🚐 รถตู้ Commuter 13 ที่นั่ง",
    capacity: 13,
    description: "รถตู้ 4 แถว — 2 / 3 / 3 / 3 / 2 (แถวหลัง)",
    rows: [
      ["EMPTY", "AISLE", 1, 2],
      [3, "AISLE", 4, 5],
      [6, "AISLE", 7, 8],
      [9, "AISLE", 10, 11],
      [12, "AISLE", 13],
    ],
  },
  CUSTOM_10: {
    label: "🚐 รถเล็ก 10 ที่นั่ง (custom)",
    capacity: 10,
    description: "รถเล็ก — แสดงเป็นตาราง 2×5",
    rows: [
      [1, "AISLE", 2],
      [3, "AISLE", 4],
      [5, "AISLE", 6],
      [7, "AISLE", 8],
      [9, "AISLE", 10],
    ],
  },
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
    const [trip, paxs, rooms, hotels, buses, guides] = await Promise.all([
      sbFetch("trips", `?trip_id=eq.${state.tripId}&select=*`).then(r => r?.[0] || null),
      sbFetch("tour_seat_check",
        `?trip_id=eq.${state.tripId}&select=code,name,gender,nationality,passport_image_url,visa_image_url,passport_id,passport_exp_date,pin,tshirt_size,religion,food_allergy,return_flight,return_date,group_name,seat,is_sub_row,parent_code&order=group_name.asc.nullslast,name.asc`),
      sbFetch("trip_rooms",
        `?trip_id=eq.${state.tripId}&select=*&order=sort_order.asc,room_id.asc`),
      sbFetch("places",
        "?place_type=eq.HOTEL&select=*&order=place_name.asc").catch((e) => { console.warn("[room-assign] load hotels:", e.message); return []; }),
      sbFetch("trip_buses",
        `?trip_id=eq.${state.tripId}&select=*&order=sort_order.asc,bus_id.asc`).catch(() => []),
      sbFetch("trip_guides",
        `?trip_id=eq.${state.tripId}&select=*&order=sort_order.asc,guide_id.asc`).catch(() => []),
    ]);
    state.hotels = hotels || [];
    state.buses = buses || [];
    state.guides = guides || [];
    populateHotelDropdown();
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

    // Load occupants (1 คน × N ห้อง)
    state.occupants = {};
    state.codeToRooms = {};
    const roomIds = state.rooms.map(r => r.room_id);
    if (roomIds.length) {
      const occRows = await sbFetch("trip_room_occupants",
        `?room_id=in.(${roomIds.join(",")})&select=room_id,code`);
      (occRows || []).forEach(o => {
        if (!state.occupants[o.room_id]) state.occupants[o.room_id] = [];
        state.occupants[o.room_id].push(o.code);
        if (!state.codeToRooms[o.code]) state.codeToRooms[o.code] = new Set();
        state.codeToRooms[o.code].add(o.room_id);
      });
    }

    // Load bus occupants
    state.busOccupants = {};
    state.codeToBusSeat = {};
    const busIds = state.buses.map(b => b.bus_id);
    if (busIds.length) {
      const occRows = await sbFetch("trip_bus_occupants",
        `?bus_id=in.(${busIds.join(",")})&select=bus_id,seat_no,code`);
      (occRows || []).forEach(o => {
        if (!state.busOccupants[o.bus_id]) state.busOccupants[o.bus_id] = {};
        state.busOccupants[o.bus_id][o.seat_no] = o.code;
        state.codeToBusSeat[o.code] = { bus_id: o.bus_id, seat_no: o.seat_no };
      });
    }

    // Load bus_guides relation (รวม seat_no)
    state.busGuides = {};         // { [bus_id]: [{ guide_id, seat_no }, ...] }
    state.guideToBuses = {};      // { [guide_id]: Set<bus_id> }
    state.busGuideSeats = {};     // { [bus_id]: { [seat_no]: guide_id } } — fast lookup
    const busIds2 = state.buses.map(b => b.bus_id);
    if (busIds2.length) {
      const bgRows = await sbFetch("trip_bus_guides",
        `?bus_id=in.(${busIds2.join(",")})&select=bus_id,guide_id,seat_no`).catch(() => []);
      (bgRows || []).forEach(r => {
        if (!state.busGuides[r.bus_id]) state.busGuides[r.bus_id] = [];
        state.busGuides[r.bus_id].push({ guide_id: r.guide_id, seat_no: r.seat_no || null });
        if (!state.guideToBuses[r.guide_id]) state.guideToBuses[r.guide_id] = new Set();
        state.guideToBuses[r.guide_id].add(r.bus_id);
        if (r.seat_no) {
          if (!state.busGuideSeats[r.bus_id]) state.busGuideSeats[r.bus_id] = {};
          state.busGuideSeats[r.bus_id][r.seat_no] = r.guide_id;
        }
      });
    }

    // Initial load: ย่อทุก group/bus เป็น default
    // (เฉพาะครั้งแรกเท่านั้น — reload หลัง assign จะคง state ที่ user กดเอง)
    if (!state.initialCollapseSet) {
      state.collapsedGroups = new Set(state.rooms.map(groupKeyOf));
      state.collapsedBuses = new Set(state.buses.map(b => b.bus_id));
      state.initialCollapseSet = true;
    }

    renderTripBanner();
    populateBatchFilter();
    populateNatFilter();
    // syncCollapsedWithBatch จะ override state เมื่อ dropdown มีค่า — ไม่เรียกใน initial load
    renderStats();
    renderPassengers();
    renderRooms();
    renderBuses();
    updateTabCounts();
    window.switchTab(state.activeTab);
  } catch (e) {
    showToast("โหลดข้อมูลไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
}

function bindEvents() {
  document.getElementById("paxSearch")?.addEventListener("input", renderPassengers);
  document.getElementById("paxFilterStatus")?.addEventListener("change", renderPassengers);
  document.getElementById("paxFilterGender")?.addEventListener("change", renderPassengers);
  document.getElementById("paxFilterNat")?.addEventListener("change", renderPassengers);
  document.getElementById("paxFilterBatch")?.addEventListener("change", (ev) => {
    const val = ev.target.value || "";
    ev.target.classList.toggle("has-value", !!val);
    if (val.startsWith("bus:")) {
      // เลือก bus → switch tab + auto-expand bus คันที่เลือก
      const bid = parseInt(val.slice(4), 10);
      if (Number.isFinite(bid)) state.collapsedBuses.delete(bid);
      window.switchTab("buses");
    } else if (val) {
      // เลือก hotel → switch tab rooms (syncCollapsedWithBatch จะขยายกลุ่มที่เลือก)
      window.switchTab("rooms");
    }
    syncCollapsedWithBatch();
    renderPassengers();
    renderRooms();
    renderBuses();
  });
}

// ── TAB SWITCHER ───────────────────────────────────────────
window.switchTab = function (tab) {
  if (tab !== "rooms" && tab !== "buses") return;
  state.activeTab = tab;
  document.getElementById("tabRooms")?.classList.toggle("active", tab === "rooms");
  document.getElementById("tabBuses")?.classList.toggle("active", tab === "buses");
  const roomsC = document.getElementById("roomsContainer");
  const busesC = document.getElementById("busesContainer");
  if (roomsC) roomsC.style.display = tab === "rooms" ? "" : "none";
  if (busesC) busesC.style.display = tab === "buses" ? "" : "none";
  const btnAddRoom = document.getElementById("btnAddRoom");
  const btnAddBus  = document.getElementById("btnAddBus");
  const btnSyncBus = document.getElementById("btnSyncBus");
  if (btnAddRoom) btnAddRoom.style.display = tab === "rooms" ? "" : "none";
  if (btnAddBus)  btnAddBus.style.display  = tab === "buses" ? "" : "none";
  if (btnSyncBus) btnSyncBus.style.display = tab === "buses" ? "" : "none";
  // re-apply perms (กรณีปุ่มที่ถูก hide ตาม perm ต้องคงสภาพ)
  if (window.AuthZ?.applyDomPerms) AuthZ.applyDomPerms(document.querySelector(".ra-rooms-toolbar"));
  // refresh hint label ตาม tab ใหม่
  if (typeof updateSelectionHint === "function") updateSelectionHint();
};

function updateTabCounts() {
  const roomGroupKeys = new Set();
  state.rooms.forEach(r => roomGroupKeys.add(groupKeyOf(r)));
  const rEl = document.getElementById("tabRoomsCount");
  if (rEl) rEl.textContent = roomGroupKeys.size;
  const bEl = document.getElementById("tabBusesCount");
  if (bEl) bEl.textContent = state.buses.length;
}

// sync collapse state ตาม batch filter
// — มี >1 โรงแรม + ยังไม่เลือก → ย่อทุกกลุ่ม
// — เลือกแล้ว → ขยายเฉพาะโรงแรมนั้น, อื่น ๆ ย่อ + lock
function syncCollapsedWithBatch() {
  const sel = document.getElementById("paxFilterBatch");
  const activeKey = sel?.value || "";
  // ถ้าไม่เลือก หรือเลือก bus → คง state เดิม (default = ย่อทั้งหมด ตาม initial load)
  if (!activeKey || activeKey.startsWith("bus:")) return;
  // เลือก hotel batch → ขยายเฉพาะนั้น, ย่อกลุ่มอื่น
  const allKeys = new Set();
  state.rooms.forEach(r => allKeys.add(groupKeyOf(r)));
  state.collapsedGroups = new Set([...allKeys].filter(k => k !== activeKey));
}

// dropdown "ช่วงพัก" — แสดงรายการ batch (group key) ทั้งหมดของทริปนี้
function populateBatchFilter() {
  const sel = document.getElementById("paxFilterBatch");
  if (!sel) return;
  const prev = sel.value;
  // distinct batches โดยเรียงตาม sort_order ของห้องตัวแรกที่เจอ
  const seen = new Map(); // key → { hotel, type, ci, co, sort }
  state.rooms.forEach(r => {
    const k = groupKeyOf(r);
    if (seen.has(k)) return;
    const hotel = state.hotels.find(h => h.place_id === r.place_id);
    seen.set(k, {
      key: k,
      hotelName: hotel?.place_name || (r.place_id ? `Place #${r.place_id}` : "ไม่ระบุโรงแรม"),
      type: r.room_type || "อื่นๆ",
      ci: r.check_in_date || "",
      co: r.check_out_date || "",
      sort: r.sort_order || 0,
    });
  });
  const batches = [...seen.values()].sort((a, b) => a.sort - b.sort);
  const opts = ['<option value="">🏨 เลือกโรงแรม / 🚌 รถบัส</option>'];
  // hotel optgroup
  if (batches.length) {
    opts.push('<optgroup label="🏨 โรงแรม (ช่วงพัก)">');
    batches.forEach(b => {
      const dates = (b.ci || b.co) ? `${b.ci ? fmtDate(b.ci) : "?"}→${b.co ? fmtDate(b.co) : "?"}` : "";
      const label = `${b.hotelName}${dates ? " · " + dates : ""}`;
      opts.push(`<option value="${escapeAttr(b.key)}">${escapeHtml(label)}</option>`);
    });
    opts.push('</optgroup>');
  }
  // bus optgroup
  if (state.buses.length) {
    opts.push('<optgroup label="🚌 รถบัส">');
    state.buses.forEach(bus => {
      const lbl = bus.bus_label
        ? `คันที่ ${bus.bus_no || "?"} · ${bus.bus_label}`
        : `คันที่ ${bus.bus_no || "?"}`;
      opts.push(`<option value="bus:${bus.bus_id}">${escapeHtml(lbl)}</option>`);
    });
    opts.push('</optgroup>');
  }
  sel.innerHTML = opts.join("");
  // คงค่าเดิมถ้ายังอยู่
  const validValues = new Set([...seen.keys(), ...state.buses.map(b => `bus:${b.bus_id}`)]);
  if (prev && validValues.has(prev)) {
    sel.value = prev;
  } else if (batches.length === 1 && !state.buses.length) {
    // ทริปมีโรงแรมเดียว ไม่มีรถ → auto-select เพื่อใช้ห้องเดียวเลย
    sel.value = batches[0].key;
  }
  sel.classList.toggle("has-value", !!sel.value);
}

// dropdown "สัญชาติ" — distinct nationalities ของ passengers
function populateNatFilter() {
  const sel = document.getElementById("paxFilterNat");
  if (!sel) return;
  const prev = sel.value;
  // นับจำนวนต่อสัญชาติ
  const counts = new Map();
  state.passengers.forEach(p => {
    const nat = (p.nationality || p._inheritedNat || "").trim();
    if (!nat) return;
    counts.set(nat, (counts.get(nat) || 0) + 1);
  });
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const opts = ['<option value="">🌐 ทุกสัญชาติ</option>'];
  sorted.forEach(([nat, n]) => {
    opts.push(`<option value="${escapeAttr(nat)}">${escapeHtml(nat)} (${n})</option>`);
  });
  sel.innerHTML = opts.join("");
  if (prev && counts.has(prev)) sel.value = prev;
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
  document.title = `${state.trip.trip_name || "Trip"} — จัดห้องพัก+รถบัส — A4S-ERP`;
}

// ── STATS ──────────────────────────────────────────────────
function setStatTone(cardId, level) {
  const el = document.getElementById(cardId);
  if (!el) return;
  el.classList.remove("ra-stat--ok", "ra-stat--warn", "ra-stat--err");
  if (level) el.classList.add(`ra-stat--${level}`);
}

function renderStats() {
  const total = state.passengers.length;
  document.getElementById("statTotal").textContent = total;

  // 2) โรงแรมที่ยังมีคนเหลือ — batch ที่ยังมีลูกค้าไม่ได้ห้อง
  const groupedRooms = {};
  state.rooms.forEach(r => {
    const k = groupKeyOf(r);
    if (!groupedRooms[k]) groupedRooms[k] = [];
    groupedRooms[k].push(r);
  });
  let batchPending = 0;
  Object.values(groupedRooms).forEach(rooms => {
    const codesInBatch = new Set();
    rooms.forEach(r => (state.occupants[r.room_id] || []).forEach(c => codesInBatch.add(c)));
    if (codesInBatch.size < total) batchPending++;
  });
  document.getElementById("statBatchPending").textContent = batchPending;
  setStatTone("statBatchPendingCard", batchPending > 0 ? "warn" : "ok");

  // 3) เพศปนกัน — ห้องที่มีทั้ง M และ F
  let mixedRooms = 0;
  state.rooms.forEach(r => {
    const codes = state.occupants[r.room_id] || [];
    const genders = new Set();
    for (const c of codes) {
      const p = state.passengers.find(x => x.code === c);
      if (!p) continue;
      const g = normGender(p.gender || p._inheritedGender);
      if (g) genders.add(g);
      if (genders.size > 1) break;
    }
    if (genders.size > 1) mixedRooms++;
  });
  document.getElementById("statMixed").textContent = mixedRooms;
  setStatTone("statMixedCard", mixedRooms > 0 ? "err" : "ok");

  // 4) โรงแรม | ห้องทั้งหมด — informational
  document.getElementById("statHotelCount").textContent = totalBatchCount();
  document.getElementById("statRoomCount").textContent = state.rooms.length;
}

// ── EXPORT (Excel / PDF) ───────────────────────────────────
// i18n สำหรับ export ทั้ง Excel + PDF
const RA_I18N = {
  th: {
    title:        "🛏️ จัดห้องพัก",
    trip:         "ทริป",
    days:         "วัน",
    nights:       "คืน",
    rooms:        "ห้อง",
    people:       "คน",
    summary:      "📊 สรุปทั้งทริป",
    perHotel:     "🏨 สรุปต่อโรงแรม",
    summaryTab:   "สรุป",
    colSeq:       "#",
    colHotel:     "โรงแรม",
    colRoomType:  "ประเภทห้อง",
    colCheckIn:   "Check-in",
    colCheckOut:  "Check-out",
    colCheckedBy: "Checked By",
    colChecked:   "Checked",
    colNights:    "คืน",
    colRooms:     "ห้อง",
    colPax:       "ผู้พัก",
    colDays:      "วันทริป",
    colTotalRows: "รวมแถว",
    code:         "รหัส",
    name:         "ชื่อ",
    roomName:     "ชื่อห้อง",
    noOccupant:   "(ยังไม่มีผู้พัก)",
    noOccupantH:  "ยังไม่มีผู้พักในโรงแรมนี้",
    noHotel:      "ยังไม่มีโรงแรม",
    generated:    "Generated",
    toastTh:      "เปิดหน้าต่าง print — เลือก 'Save as PDF'",
    excelOk:      (n) => `ดาวน์โหลด Excel แล้ว (${n} โรงแรม + สรุป)`,
  },
  en: {
    title:        "🛏️ Room Assignment",
    trip:         "Trip",
    days:         "days",
    nights:       "nights",
    rooms:        "rooms",
    people:       "people",
    summary:      "📊 Trip Summary",
    perHotel:     "🏨 By Hotel",
    summaryTab:   "Summary",
    colSeq:       "#",
    colHotel:     "Hotel",
    colRoomType:  "Room Type",
    colCheckIn:   "Check-in",
    colCheckOut:  "Check-out",
    colCheckedBy: "Checked By",
    colChecked:   "Checked",
    colNights:    "Nights",
    colRooms:     "Rooms",
    colPax:       "People",
    colDays:      "Trip Days",
    colTotalRows: "Total Rows",
    code:         "Code",
    name:         "Name",
    roomName:     "Room",
    noOccupant:   "(No occupants yet)",
    noOccupantH:  "No occupants at this hotel",
    noHotel:      "No hotels",
    generated:    "Generated",
    toastTh:      "Print dialog opened — choose 'Save as PDF'",
    excelOk:      (n) => `Excel downloaded (${n} hotels + summary)`,
  },
};
window.toggleRaExport = function (ev) {
  ev?.stopPropagation?.();
  const wrap = document.getElementById("raExportWrap");
  if (!wrap) return;
  wrap.classList.toggle("open");
};
window.closeRaExport = function () {
  document.getElementById("raExportWrap")?.classList.remove("open");
};
document.addEventListener("click", (ev) => {
  if (!ev.target.closest("#raExportWrap")) window.closeRaExport();
});

// สร้าง sections สำหรับ export — แยกตาม batch (โรงแรม + ประเภท + ช่วงวัน)
// แต่ละ section มี rows: 1 (คน × ห้อง) = 1 แถว
// lang: "th" | "en" — กำหนดชื่อคอลัมน์
function _buildExportSections(lang = "th") {
  const t = RA_I18N[lang] || RA_I18N.th;
  const groups = {};
  state.rooms.forEach(r => {
    const k = groupKeyOf(r);
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  });
  // sort batch by sort_order ของห้องแรกในกลุ่ม
  const orderedKeys = Object.keys(groups).sort((a, b) => {
    const aSort = Math.min(...groups[a].map(r => r.sort_order || 0));
    const bSort = Math.min(...groups[b].map(r => r.sort_order || 0));
    return aSort - bSort;
  });
  return orderedKeys.map(k => {
    const rooms = groups[k];
    const sample = rooms[0];
    const hotel = state.hotels.find(h => h.place_id === sample.place_id);
    const hotelName = hotel?.place_name || (sample.place_id ? `Place #${sample.place_id}` : (lang === "en" ? "No hotel" : "ไม่ระบุโรงแรม"));
    const ci = sample.check_in_date  ? fmtDate(sample.check_in_date)  : "—";
    const co = sample.check_out_date ? fmtDate(sample.check_out_date) : "—";
    const title = `${hotelName} · ${sample.room_type || ""} · ${ci}→${co}`;
    const rows = [];
    rooms.forEach(r => {
      (state.occupants[r.room_id] || []).forEach(code => {
        const p = state.passengers.find(x => x.code === code);
        const name = (p?.name || p?._inheritedName || "—");
        rows.push({
          [t.code]:        code || "",
          [t.name]:        name,
          [t.roomName]:    r.room_name || "",
          [t.colCheckIn]:  r.check_in_date  ? fmtDate(r.check_in_date)  : "",
          [t.colCheckOut]: r.check_out_date ? fmtDate(r.check_out_date) : "",
          [t.colCheckedBy]: "",
          [t.colChecked]:   "",
          _room: r.room_name || "",
          _code: code || "",
        });
      });
    });
    // เรียงตามชื่อห้อง ASC (natural sort: Twin-2 < Twin-3 < Twin-21) แล้วตาม code ในห้องเดียวกัน
    rows.sort((a, b) =>
      a._room.localeCompare(b._room, undefined, { numeric: true, sensitivity: "base" })
      || a._code.localeCompare(b._code)
    );
    return {
      title,
      hotelName,
      rows: rows.map(({ _room, _code, ...rest }) => rest),
    };
  });
}

// helper: ทาขอบทุกเซลล์ในช่วง + ใส่ header style ที่แถวบนสุด
function _applyBorders(ws, nCols, nRows, headerRowIdx = 0) {
  const border = {
    top:    { style: "thin", color: { rgb: "94A3B8" } },
    bottom: { style: "thin", color: { rgb: "94A3B8" } },
    left:   { style: "thin", color: { rgb: "94A3B8" } },
    right:  { style: "thin", color: { rgb: "94A3B8" } },
  };
  for (let r = headerRowIdx; r < headerRowIdx + nRows; r++) {
    for (let c = 0; c < nCols; c++) {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (!ws[ref]) ws[ref] = { v: "", t: "s" };
      ws[ref].s = ws[ref].s || {};
      ws[ref].s.border = border;
      ws[ref].s.alignment = ws[ref].s.alignment || { vertical: "center", wrapText: false };
      if (r === headerRowIdx) {
        ws[ref].s.font = { bold: true, sz: 11 };
        ws[ref].s.fill = { patternType: "solid", fgColor: { rgb: "F1F5F9" } };
        ws[ref].s.alignment = { vertical: "center", horizontal: "center" };
      }
    }
  }
  // ขยาย worksheet range เพื่อให้เซลล์เปล่าที่เราเพิ่งสร้างถูก export ด้วย
  ws["!ref"] = XLSX.utils.encode_range({ s: { c: 0, r: headerRowIdx }, e: { c: nCols - 1, r: headerRowIdx + nRows - 1 } });
}

window.exportRaExcel = function (lang = "th") {
  if (typeof XLSX === "undefined") {
    showToast("XLSX library ยังโหลดไม่เสร็จ — ลองใหม่อีกครั้ง", "error");
    return;
  }
  const t = RA_I18N[lang] || RA_I18N.th;
  const sections = _buildExportSections(lang);
  if (!sections.length) { showToast(lang === "en" ? "No rooms to export" : "ยังไม่มีห้องให้ export", "info"); return; }

  const wb = XLSX.utils.book_new();
  const used = new Set();
  // sanitize sheet name: remove forbidden chars, max 31 chars, must be unique
  const safeSheetName = (raw, idx) => {
    let name = String(raw || `Sheet ${idx + 1}`).replace(/[\\\/\?\*\[\]:]/g, "_").slice(0, 31).trim();
    if (!name) name = `Sheet ${idx + 1}`;
    let unique = name, n = 2;
    while (used.has(unique)) {
      const suffix = ` (${n++})`;
      unique = name.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(unique);
    return unique;
  };

  // ─── สรุป sheet (อยู่หน้าสุด) ───
  const tripName  = state.trip?.trip_name || `Trip #${state.tripId}`;
  const tripStart = state.trip?.start_date ? fmtDate(state.trip.start_date) : "—";
  const tripEnd   = state.trip?.end_date   ? fmtDate(state.trip.end_date)   : "—";
  const tripDays  = _daysInclusive(state.trip?.start_date, state.trip?.end_date);
  const totalRooms = state.rooms.length;
  const totalPax   = state.passengers.length;
  const totalRows  = sections.reduce((a, s) => a + s.rows.length, 0);

  // sheet 2D array — header + data + spacing + per-hotel breakdown
  const aoa = [
    [`${t.title} — ${tripName}`],
    [`${t.trip}: ${tripStart} → ${tripEnd}${tripDays > 0 ? ` (${tripDays} ${t.days})` : ""}`],
    [],
    [t.summary],
    [t.colHotel, t.colRooms, t.colPax, t.colDays, t.colTotalRows],
    [sections.length, totalRooms, totalPax, tripDays || "—", totalRows],
    [],
    [t.perHotel],
    [t.colSeq, t.colHotel, t.colRoomType, t.colCheckIn, t.colCheckOut, t.colNights, t.colRooms, t.colPax],
  ];
  sections.forEach((sec, i) => {
    // หาห้องของ section นี้เพื่อดึง dates+capacity
    const groupRooms = state.rooms.filter(r => {
      const hotel = state.hotels.find(h => h.place_id === r.place_id);
      const hotelName = hotel?.place_name || (r.place_id ? `Place #${r.place_id}` : "ไม่ระบุโรงแรม");
      const ci = r.check_in_date  ? fmtDate(r.check_in_date)  : "—";
      const co = r.check_out_date ? fmtDate(r.check_out_date) : "—";
      return `${hotelName} · ${r.room_type || ""} · ${ci}→${co}` === sec.title;
    });
    const sample = groupRooms[0] || {};
    const ci = sample.check_in_date  ? fmtDate(sample.check_in_date)  : "—";
    const co = sample.check_out_date ? fmtDate(sample.check_out_date) : "—";
    const nights = _nightsBetween(sample.check_in_date, sample.check_out_date);
    aoa.push([
      i + 1,
      sec.hotelName,
      sample.room_type || "",
      ci, co,
      nights || 0,
      groupRooms.length,
      sec.rows.length,
    ]);
  });

  const summaryWs = XLSX.utils.aoa_to_sheet(aoa);
  // กำหนดความกว้างคอลัมน์
  summaryWs["!cols"] = [
    { wch: 4 }, { wch: 28 }, { wch: 16 }, { wch: 12 }, { wch: 12 },
    { wch: 6 }, { wch: 8 }, { wch: 8 },
  ];
  // merge title rows
  summaryWs["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 7 } },
    { s: { r: 3, c: 0 }, e: { r: 3, c: 7 } },
    { s: { r: 7, c: 0 }, e: { r: 7, c: 7 } },
  ];
  // borders: ตาราง "สรุปทั้งทริป" (row 4-5, col 0-4) + ตาราง "สรุปต่อโรงแรม" (row 8 ลงมา, col 0-7)
  _applyBorders(summaryWs, 5, 2, 4);
  _applyBorders(summaryWs, 8, sections.length + 1, 8);
  // header styles for title rows (row 0,1,3,7) — bold + center
  ["A1", "A2", "A4", "A8"].forEach(ref => {
    if (!summaryWs[ref]) summaryWs[ref] = { v: "", t: "s" };
    summaryWs[ref].s = {
      font: { bold: true, sz: ref === "A1" ? 14 : 12 },
      alignment: { vertical: "center", horizontal: "left" },
    };
  });
  used.add(t.summaryTab);
  XLSX.utils.book_append_sheet(wb, summaryWs, t.summaryTab);

  // ─── 1 sheet ต่อ 1 โรงแรม ───
  // คอลัมน์: 0=code 1=name 2=room 3=check-in 4=check-out
  // merge cell ของ col 2,3,4 สำหรับแถวที่ "ชื่อห้อง" (key=t.roomName) ติดกันและเหมือนกัน
  const computeMerges = (rows, headerRowIdx = 0) => {
    const merges = [];
    let i = 0;
    while (i < rows.length) {
      const cur = rows[i][t.roomName];
      let j = i + 1;
      while (j < rows.length && rows[j][t.roomName] === cur && cur !== "") j++;
      if (j - i > 1) {
        const r1 = headerRowIdx + 1 + i;
        const r2 = headerRowIdx + j;
        [2, 3, 4].forEach(c => merges.push({ s: { r: r1, c }, e: { r: r2, c } }));
      }
      i = j;
    }
    return merges;
  };
  sections.forEach((sec, i) => {
    const sheetName = safeSheetName(sec.hotelName, i);
    const headerRows = sec.rows.length
      ? sec.rows
      : [{ [t.code]: "", [t.name]: t.noOccupant, [t.roomName]: "", [t.colCheckIn]: "", [t.colCheckOut]: "", [t.colCheckedBy]: "", [t.colChecked]: "" }];
    const ws = XLSX.utils.json_to_sheet(headerRows);
    const maxLen = {};
    headerRows.forEach(r => Object.entries(r).forEach(([k, v]) => {
      const l = String(v ?? "").length;
      maxLen[k] = Math.max(maxLen[k] || k.length, Math.min(l, 60));
    }));
    // ให้ Checked By กว้างพอเขียนชื่อได้ + Checked เป็นช่อง tick
    maxLen[t.colCheckedBy] = Math.max(maxLen[t.colCheckedBy] || 0, 14);
    maxLen[t.colChecked]   = Math.max(maxLen[t.colChecked]   || 0, 9);
    ws["!cols"] = Object.keys(headerRows[0]).map(k => ({ wch: (maxLen[k] || 10) + 2 }));
    if (sec.rows.length) ws["!merges"] = computeMerges(headerRows, 0);
    // borders + header style ทุกเซลล์ (header 1 row + data N rows)
    _applyBorders(ws, Object.keys(headerRows[0]).length, headerRows.length + 1, 0);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });

  // ─── 1 sheet ต่อ 1 รถบัส (Bus 1, Bus 2, ...) ───
  // Columns: Code | Name | PIN | Room | NATIONALITY | RELIGION | FOOD ALLERGY | T-SHIRT SIZE | RETURN FLIGHT | RETURN DATE
  state.buses.forEach((bus, busIdx) => {
    const sheetTitle = bus.bus_label
      ? `BUS ${bus.bus_no || busIdx + 1} ${bus.bus_label}`
      : `BUS ${bus.bus_no || busIdx + 1}`;
    const sheetName = safeSheetName(sheetTitle, sections.length + busIdx);
    const rows = _buildBusExportRows(bus);
    const headers = ["Code", "Name", "PIN", "Room", "NATIONALITY", "RELIGION", "FOOD ALLERGY", "T-SHIRT SIZE", "RETURN FLIGHT", "RETURN DATE"];
    // aoa: title row (merged) + header row + data rows
    const titleRow = [sheetTitle];
    while (titleRow.length < headers.length) titleRow.push("");
    const aoa = [titleRow, headers];
    if (!rows.length) {
      const empty = new Array(headers.length).fill("");
      empty[1] = lang === "en" ? "(No passengers assigned to this bus)" : "(ยังไม่มีผู้โดยสารในรถคันนี้)";
      aoa.push(empty);
    } else {
      rows.forEach(r => aoa.push(headers.map(h => r[h] ?? "")));
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [
      { wch: 10 }, { wch: 28 }, { wch: 14 }, { wch: 22 }, { wch: 14 },
      { wch: 14 }, { wch: 20 }, { wch: 12 }, { wch: 16 }, { wch: 14 },
    ];
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }];
    // Title style (row 0) — สีพื้นเหลือง
    const titleRef = "A1";
    if (!ws[titleRef]) ws[titleRef] = { v: sheetTitle, t: "s" };
    ws[titleRef].s = {
      font: { bold: true, sz: 13, color: { rgb: "111827" } },
      fill: { patternType: "solid", fgColor: { rgb: "FEF3C7" } },
      alignment: { vertical: "center", horizontal: "center" },
      border: {
        top:    { style: "thin", color: { rgb: "94A3B8" } },
        bottom: { style: "thin", color: { rgb: "94A3B8" } },
        left:   { style: "thin", color: { rgb: "94A3B8" } },
        right:  { style: "thin", color: { rgb: "94A3B8" } },
      },
    };
    // borders + header style — header row = row 1 (index 1)
    _applyBorders(ws, headers.length, aoa.length - 1, 1);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });

  const tripSlug = (state.trip?.trip_name || `trip${state.tripId}`).replace(/[^\w฀-๿-]+/g, "_");
  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `room_assign_${tripSlug}_${lang}_${today}.xlsx`);
  showToast(t.excelOk(sections.length), "success");
};

// Helper: สร้าง rows สำหรับ Bus sheet (เรียงตาม seat_no asc)
function _buildBusExportRows(bus) {
  const occMap = state.busOccupants[bus.bus_id] || {};
  const guideSeats = state.busGuideSeats[bus.bus_id] || {};
  const items = [];
  // Passenger rows
  Object.keys(occMap).forEach(seatNo => {
    const code = occMap[seatNo];
    const p = state.passengers.find(x => x.code === code);
    if (!p) return;
    items.push({ seatNo, kind: "pax", p, code });
  });
  // Guide rows (มี seat — รวมใน list ด้วยเพื่อให้รู้ว่าใครนั่ง seat ไหน)
  Object.keys(guideSeats).forEach(seatNo => {
    const guideId = guideSeats[seatNo];
    const g = state.guides.find(x => x.guide_id === guideId);
    if (!g) return;
    items.push({ seatNo, kind: "guide", g });
  });
  // sort by seat_no numeric ascending
  items.sort((a, b) => Number(a.seatNo) - Number(b.seatNo));

  return items.map(item => {
    if (item.kind === "guide") {
      const g = item.g;
      return {
        Code: "[GUIDE]",
        Name: g.full_name || "",
        PIN: "",
        Room: "",
        NATIONALITY: g.languages || "",
        RELIGION: "",
        "FOOD ALLERGY": "",
        "T-SHIRT SIZE": "",
        "RETURN FLIGHT": "",
        "RETURN DATE": "",
        _seat: item.seatNo,
      };
    }
    const p = item.p;
    const name = p.name || p._inheritedName || "";
    const pin = p.pin || p.passport_id || "";
    const rids = state.codeToRooms[p.code];
    const myRooms = (rids ? [...rids] : [])
      .map(rid => state.rooms.find(r => r.room_id === rid))
      .filter(Boolean)
      .sort((a, b) => (a.check_in_date || "").localeCompare(b.check_in_date || ""));
    const roomStr = myRooms.map(r => r.room_name || "").filter(Boolean).join(", ");
    return {
      Code: p.code || "",
      Name: name,
      PIN: pin,
      Room: roomStr,
      NATIONALITY: p.nationality || p._inheritedNat || "",
      RELIGION: p.religion || "",
      "FOOD ALLERGY": p.food_allergy || "",
      "T-SHIRT SIZE": p.tshirt_size || "",
      "RETURN FLIGHT": p.return_flight || "",
      "RETURN DATE": p.return_date || "",
      _seat: item.seatNo,
    };
  });
}

// helper: นับวัน inclusive (start..end)
function _daysInclusive(isoStart, isoEnd) {
  if (!isoStart || !isoEnd) return 0;
  const a = new Date(isoStart + "T00:00:00");
  const b = new Date(isoEnd + "T00:00:00");
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.round((b - a) / 86400000) + 1;
}
// helper: นับคืน (check-in → check-out)
function _nightsBetween(isoIn, isoOut) {
  if (!isoIn || !isoOut) return 0;
  const a = new Date(isoIn + "T00:00:00");
  const b = new Date(isoOut + "T00:00:00");
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

window.exportRaPdf = function (lang = "th") {
  const t = RA_I18N[lang] || RA_I18N.th;
  // Build print HTML — แยก section ต่อโรงแรม + ตารางคอลัมน์เดียวกับ Excel
  const tripName = state.trip?.trip_name || `Trip #${state.tripId}`;
  const tripDates = (state.trip?.start_date || state.trip?.end_date)
    ? `${state.trip?.start_date ? fmtDate(state.trip.start_date) : "—"} → ${state.trip?.end_date ? fmtDate(state.trip.end_date) : "—"}`
    : "";
  const tripDays = _daysInclusive(state.trip?.start_date, state.trip?.end_date);

  const sections = _buildExportSections(lang);
  const totalRows = sections.reduce((a, s) => a + s.rows.length, 0);
  const totalRooms = state.rooms.length;
  const totalPax = state.passengers.length;

  const sectionsHtml = sections.map(sec => {
    // หา sample room ของ section นี้เพื่อดึง check-in/out เพื่อคำนวณคืน
    const groupRooms = state.rooms.filter(r => {
      const hotel = state.hotels.find(h => h.place_id === r.place_id);
      const hotelName = hotel?.place_name || (r.place_id ? `Place #${r.place_id}` : "ไม่ระบุโรงแรม");
      const ci = r.check_in_date  ? fmtDate(r.check_in_date)  : "—";
      const co = r.check_out_date ? fmtDate(r.check_out_date) : "—";
      return `${hotelName} · ${r.room_type || ""} · ${ci}→${co}` === sec.title;
    });
    const sample = groupRooms[0];
    const nights = sample ? _nightsBetween(sample.check_in_date, sample.check_out_date) : 0;
    // คำนวณ rowspan สำหรับห้องที่ติดกัน
    const rowspans = new Array(sec.rows.length).fill(1);
    const isHead   = new Array(sec.rows.length).fill(false);
    let i = 0;
    while (i < sec.rows.length) {
      const cur = sec.rows[i][t.roomName];
      let j = i + 1;
      while (j < sec.rows.length && sec.rows[j][t.roomName] === cur && cur !== "") j++;
      isHead[i] = true;
      rowspans[i] = j - i;
      i = j;
    }
    const trs = sec.rows.map((r, idx) => `<tr>
      <td>${escapeHtml(r[t.code])}</td>
      <td>${escapeHtml(r[t.name])}</td>
      ${isHead[idx] ? `<td rowspan="${rowspans[idx]}" style="vertical-align:middle">${escapeHtml(r[t.roomName])}</td>
      <td rowspan="${rowspans[idx]}" style="vertical-align:middle">${escapeHtml(r[t.colCheckIn])}</td>
      <td rowspan="${rowspans[idx]}" style="vertical-align:middle">${escapeHtml(r[t.colCheckOut])}</td>` : ""}
      <td></td>
      <td style="text-align:center"></td>
    </tr>`).join("");
    return `<div class="ra-print-section">
      <h3>🏨 ${escapeHtml(sec.title)}
        <span style="color:#64748b;font-weight:400;font-size:12px"> · ${groupRooms.length} ${t.rooms} · ${sec.rows.length} ${t.people}${nights > 0 ? ` · ${nights} ${t.nights}` : ""}</span>
      </h3>
      <table>
        <thead><tr>
          <th style="width:11%">${t.code}</th>
          <th style="width:25%">${t.name}</th>
          <th style="width:18%">${t.roomName}</th>
          <th style="width:12%">${t.colCheckIn}</th>
          <th style="width:12%">${t.colCheckOut}</th>
          <th style="width:14%">${t.colCheckedBy}</th>
          <th style="width:8%">${t.colChecked}</th>
        </tr></thead>
        <tbody>${trs || `<tr><td colspan="7" style="text-align:center;color:#94a3b8">${t.noOccupantH}</td></tr>`}</tbody>
      </table>
    </div>`;
  }).join("");

  // Summary box ด้านบน
  const summaryHtml = `<div class="ra-print-section" style="background:#f8fafc;page-break-inside:avoid">
    <table>
      <thead><tr>
        <th>${t.colHotel}</th>
        <th>${t.colRooms}</th>
        <th>${t.colPax}</th>
        <th>${t.colDays}</th>
        <th>${t.colTotalRows}</th>
      </tr></thead>
      <tbody><tr style="font-size:13px;font-weight:700">
        <td style="text-align:center">${sections.length}</td>
        <td style="text-align:center">${totalRooms}</td>
        <td style="text-align:center">${totalPax}</td>
        <td style="text-align:center">${tripDays > 0 ? tripDays : "—"}</td>
        <td style="text-align:center">${totalRows}</td>
      </tr></tbody>
    </table>
  </div>`;

  // Bus sections
  const busHeaders = ["Code", "Name", "PIN", "Room", "NATIONALITY", "RELIGION", "FOOD ALLERGY", "T-SHIRT SIZE", "RETURN FLIGHT", "RETURN DATE"];
  const busSectionsHtml = state.buses.map((bus, busIdx) => {
    const title = bus.bus_label
      ? `BUS ${bus.bus_no || busIdx + 1} ${bus.bus_label}`
      : `BUS ${bus.bus_no || busIdx + 1}`;
    const rows = _buildBusExportRows(bus);
    const trs = rows.length
      ? rows.map(r => `<tr>
          <td>${escapeHtml(r.Code)}</td>
          <td>${escapeHtml(r.Name)}</td>
          <td>${escapeHtml(r.PIN)}</td>
          <td>${escapeHtml(r.Room)}</td>
          <td>${escapeHtml(r.NATIONALITY)}</td>
          <td>${escapeHtml(r.RELIGION)}</td>
          <td>${escapeHtml(r["FOOD ALLERGY"])}</td>
          <td>${escapeHtml(r["T-SHIRT SIZE"])}</td>
          <td>${escapeHtml(r["RETURN FLIGHT"])}</td>
          <td>${escapeHtml(r["RETURN DATE"])}</td>
        </tr>`).join("")
      : `<tr><td colspan="${busHeaders.length}" style="text-align:center;color:#94a3b8;padding:10px">— ยังไม่มีผู้โดยสาร —</td></tr>`;
    return `<div class="ra-print-section">
      <h3 style="background:#fef3c7;text-align:center;padding:6px;border:1px solid #fde68a;margin:6px 0 0">🚌 ${escapeHtml(title)}</h3>
      <table>
        <thead><tr>${busHeaders.map(h => `<th>${h}</th>`).join("")}</tr></thead>
        <tbody>${trs}</tbody>
      </table>
    </div>`;
  }).join("");

  const html = `<div class="ra-print-title">${t.title} — ${escapeHtml(tripName)}${tripDates ? ` · ${tripDates}` : ""}</div>
    <div style="font-size:11px;color:#64748b;margin:-6px 0 10px">${t.summary}</div>
    ${summaryHtml}
    ${sectionsHtml || `<div class="ra-print-section"><div style="text-align:center;color:#94a3b8;padding:20px">${t.noHotel}</div></div>`}
    ${busSectionsHtml ? `<div style="margin-top:18px;font-weight:700;font-size:13px;color:#0f4c75">🚌 รถบัส</div>${busSectionsHtml}` : ""}
    <div style="margin-top:20px;font-size:10px;color:#64748b">
      ${t.generated} ${new Date().toLocaleString(lang === "en" ? "en-US" : "th-TH", { timeZone: "Asia/Bangkok" })} · A4S-ERP
    </div>`;

  const area = document.getElementById("raPrintArea");
  if (!area) return;
  area.innerHTML = html;
  showToast(t.toastTh, "info");
  setTimeout(() => window.print(), 80);
};

// ── STATS REPORT MODAL ─────────────────────────────────────
window.openRaReport = function (type) {
  const titleEl = document.getElementById("raReportTitle");
  const bodyEl  = document.getElementById("raReportBody");
  const overlay = document.getElementById("raReportOverlay");
  if (!titleEl || !bodyEl || !overlay) return;
  let title = "", html = "";
  switch (type) {
    case "total":        title = "👥 ลูกค้าทั้งหมด";              html = renderReportTotal();        break;
    case "batchPending": title = "🏨 โรงแรมที่ยังจัดคนไม่ครบ";   html = renderReportBatchPending(); break;
    case "mixed":        title = "🚻 ห้องที่มีเพศปนกัน";         html = renderReportMixed();        break;
    case "hotelRooms":   title = "📊 โรงแรม | ห้องทั้งหมด";       html = renderReportHotelRooms();   break;
    default: return;
  }
  titleEl.textContent = title;
  bodyEl.innerHTML = html;
  overlay.classList.add("open");
};
window.closeRaReport = function (e) {
  if (e && e.target.id !== "raReportOverlay") return;
  document.getElementById("raReportOverlay")?.classList.remove("open");
};

// helper: format hotel + dates label สำหรับ section header
function _batchLabelHtml(rooms) {
  const r = rooms[0];
  const hotel = state.hotels.find(h => h.place_id === r.place_id);
  const hotelName = hotel?.place_name || (r.place_id ? `Place #${r.place_id}` : "ไม่ระบุโรงแรม");
  const ci = r.check_in_date  ? fmtDate(r.check_in_date)  : "?";
  const co = r.check_out_date ? fmtDate(r.check_out_date) : "?";
  return `🏨 ${escapeHtml(hotelName)} · ${escapeHtml(r.room_type || "")} · ${ci}→${co}`;
}

function renderReportTotal() {
  const rows = state.passengers.map(p => {
    const name = p.name || p._inheritedName || "—";
    const code = p.code || "—";
    const nat  = p.nationality || p._inheritedNat || "—";
    const g    = normGender(p.gender || p._inheritedGender);
    const gTag = g === "M" ? '<span class="ra-gender-tag ra-gender-M">♂ M</span>'
              : g === "F" ? '<span class="ra-gender-tag ra-gender-F">♀ F</span>' : "";
    const rooms = roomNamesForCode(p.code);
    const roomTag = rooms.length
      ? `<span class="ra-report-pill ok">🛏️ ${escapeHtml(rooms.join(", "))}</span>`
      : `<span class="ra-report-pill warn">ยังไม่มีห้อง</span>`;
    return `<div class="ra-report-row">
      <span class="ra-pax-code">${escapeHtml(code)}</span>
      <span style="flex:1;color:var(--text);font-weight:500">${escapeHtml(name)}</span>
      <span style="color:var(--text3);font-size:11px">${escapeHtml(nat)}</span>
      ${gTag}
      ${roomTag}
    </div>`;
  }).join("");
  return `<div style="font-size:12px;color:var(--text2);margin-bottom:8px">
    รวม ${state.passengers.length} คน
  </div>
  <div class="ra-report-list" style="max-height:60vh">${rows || `<div class="ra-report-empty">ไม่มีข้อมูล</div>`}</div>`;
}

function renderReportBatchPending() {
  // group rooms by groupKey
  const groups = {};
  state.rooms.forEach(r => {
    const k = groupKeyOf(r);
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  });
  const total = state.passengers.length;
  const sections = [];
  Object.keys(groups).forEach(k => {
    const rooms = groups[k];
    const codesIn = new Set();
    rooms.forEach(r => (state.occupants[r.room_id] || []).forEach(c => codesIn.add(c)));
    if (codesIn.size >= total) return; // ครบแล้ว ข้าม
    const missing = state.passengers.filter(p => !codesIn.has(p.code));
    const rowsHtml = missing.map(p => {
      const name = p.name || p._inheritedName || "—";
      const code = p.code || "—";
      const g = normGender(p.gender || p._inheritedGender);
      const gTag = g === "M" ? '<span class="ra-gender-tag ra-gender-M">♂ M</span>'
                : g === "F" ? '<span class="ra-gender-tag ra-gender-F">♀ F</span>' : "";
      return `<div class="ra-report-row">
        <span class="ra-pax-code">${escapeHtml(code)}</span>
        <span style="flex:1;color:var(--text)">${escapeHtml(name)}</span>
        ${gTag}
      </div>`;
    }).join("");
    sections.push(`<div class="ra-report-section">
      <div class="ra-report-section-hdr">
        ${_batchLabelHtml(rooms)}
        <span class="ra-report-pill warn">ยังขาด ${missing.length} คน</span>
        <span class="ra-report-pill">มีแล้ว ${codesIn.size}/${total}</span>
      </div>
      <div class="ra-report-list">${rowsHtml}</div>
    </div>`);
  });
  return sections.length ? sections.join("") : `<div class="ra-report-empty">✅ ทุกโรงแรมจัดครบหมดแล้ว</div>`;
}

function renderReportMixed() {
  const items = [];
  state.rooms.forEach(r => {
    const codes = state.occupants[r.room_id] || [];
    const occs = codes.map(c => state.passengers.find(x => x.code === c)).filter(Boolean);
    const genders = new Set();
    occs.forEach(p => {
      const g = normGender(p.gender || p._inheritedGender);
      if (g) genders.add(g);
    });
    if (genders.size <= 1) return;
    const occHtml = occs.map(p => {
      const name = p.name || p._inheritedName || "—";
      const code = p.code || "—";
      const g = normGender(p.gender || p._inheritedGender);
      const gTag = g === "M" ? '<span class="ra-gender-tag ra-gender-M">♂ M</span>'
                : g === "F" ? '<span class="ra-gender-tag ra-gender-F">♀ F</span>' : "";
      return `<div class="ra-report-row">
        <span class="ra-pax-code">${escapeHtml(code)}</span>
        <span style="flex:1;color:var(--text)">${escapeHtml(name)}</span>
        ${gTag}
      </div>`;
    }).join("");
    items.push(`<div class="ra-report-section">
      <div class="ra-report-section-hdr">
        ${_batchLabelHtml([r])}
        <span class="ra-report-pill err">🛏️ ${escapeHtml(r.room_name)}</span>
      </div>
      <div class="ra-report-list">${occHtml}</div>
    </div>`);
  });
  return items.length ? items.join("") : `<div class="ra-report-empty">✅ ไม่มีห้องที่มีเพศปนกัน</div>`;
}

function renderReportHotelRooms() {
  const groups = {};
  state.rooms.forEach(r => {
    const k = groupKeyOf(r);
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  });
  const sections = Object.keys(groups).map(k => {
    const rooms = groups[k];
    const totalCap = rooms.reduce((a, r) => a + (r.capacity || 0), 0);
    const totalOcc = rooms.reduce((a, r) => a + ((state.occupants[r.room_id] || []).length), 0);
    const roomList = rooms.map(r => {
      const occ = (state.occupants[r.room_id] || []).length;
      const cap = r.capacity || 0;
      const cls = occ === 0 ? "" : (occ >= cap ? "ok" : "warn");
      return `<span class="ra-report-pill ${cls}" title="${escapeAttr(r.room_name)} · ${occ}/${cap}">
        ${escapeHtml(r.room_name)} · ${occ}/${cap}
      </span>`;
    }).join(" ");
    return `<div class="ra-report-section">
      <div class="ra-report-section-hdr">
        ${_batchLabelHtml(rooms)}
        <span class="ra-report-pill">${rooms.length} ห้อง · ${totalOcc}/${totalCap} คน</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:5px">${roomList}</div>
    </div>`;
  });
  return sections.length ? sections.join("") : `<div class="ra-report-empty">ยังไม่มีห้อง</div>`;
}

// ── PASSENGER LIST (left) ──────────────────────────────────
// คน 1 คนอยู่ได้หลายห้อง (คนละช่วง) — return array ของชื่อห้อง
// ถ้าใส่ filterGroupKey → คืนแค่ห้องในกลุ่มนั้น (ใช้ตอนกรองตามโรงแรม)
function roomNamesForCode(code, filterGroupKey) {
  const rids = state.codeToRooms[code];
  if (!rids || !rids.size) return [];
  return [...rids]
    .filter(rid => {
      if (!filterGroupKey) return true;
      const room = state.rooms.find(x => x.room_id === rid);
      return room && groupKeyOf(room) === filterGroupKey;
    })
    .map(rid => roomNameById(rid))
    .filter(Boolean);
}

// จำนวน batch (group) ทั้งหมดของทริปนี้ — ใช้ตัดสินว่าคนถูก "จัดครบทุกช่วง" หรือยัง
function totalBatchCount() {
  const set = new Set();
  state.rooms.forEach(r => set.add(groupKeyOf(r)));
  return set.size;
}
// จำนวน batch ที่ code นี้ถูก assign แล้ว
function assignedBatchCount(code) {
  const rids = state.codeToRooms[code];
  if (!rids || !rids.size) return 0;
  const set = new Set();
  rids.forEach(rid => {
    const room = state.rooms.find(x => x.room_id === rid);
    if (room) set.add(groupKeyOf(room));
  });
  return set.size;
}

function renderPassengers() {
  const search = (document.getElementById("paxSearch")?.value || "").toLowerCase();
  const status = document.getElementById("paxFilterStatus")?.value || "missing_any";
  const gender = document.getElementById("paxFilterGender")?.value || "";
  const nat    = (document.getElementById("paxFilterNat")?.value || "").trim();

  const batchKey = document.getElementById("paxFilterBatch")?.value || "";
  const isBusMode = batchKey.startsWith("bus:");
  const busId = isBusMode ? parseInt(batchKey.slice(4), 10) : null;
  const totalB = totalBatchCount();

  // กันสับสน: ถ้ามีหลายโรงแรมแต่ user ยังไม่เลือก batch → ไม่แสดงรายชื่อ
  // (เฉพาะ filter ที่อิง batch — "no_seat" + "all" ไม่ต้องเลือก batch ก่อน)
  // bus mode ไม่ต้องเลือก hotel batch — ใช้ logic bus เลย
  const needsHotelBatch = !isBusMode && (status === "unassigned" || status === "assigned" || status === "missing_any");
  if (totalB > 1 && !batchKey && needsHotelBatch) {
    document.getElementById("paxFilteredCount").textContent = 0;
    const list = document.getElementById("paxList");
    if (list) {
      list.innerHTML = `<div class="ra-pax-empty" style="padding:30px 20px">
        🏨 เลือกโรงแรมหรือ🚌รถบัสก่อน<br>
        <span style="font-size:11px;color:var(--text3);margin-top:6px;display:inline-block">
          ทริปนี้มี ${totalB} ช่วงพัก — เลือกในกล่อง dropdown ด้านบน<br>
          หรือเปลี่ยน filter เป็น "ยังไม่ได้ที่นั่ง" / "ทั้งหมด"
        </span>
      </div>`;
    }
    return;
  }

  // hotel batch helper
  const isInBatch = (code) => {
    const rids = state.codeToRooms[code];
    if (!rids || !rids.size) return false;
    return [...rids].some(rid => {
      const room = state.rooms.find(x => x.room_id === rid);
      return room && groupKeyOf(room) === batchKey;
    });
  };
  // bus helper: code นี้นั่งใน bus นี้?
  const isOnBus = (code) => {
    const seat = state.codeToBusSeat[code];
    return seat && seat.bus_id === busId;
  };

  const filtered = state.passengers.filter(p => {
    const hasSeat = !!state.codeToBusSeat[p.code];
    if (isBusMode) {
      // bus mode: status semantics จำกัดในรถคันที่เลือก
      const onThisBus = isOnBus(p.code);
      if (status === "unassigned" || status === "no_seat" || status === "missing_any") {
        // คนที่ยังไม่นั่งคันนี้
        if (onThisBus) return false;
      } else if (status === "assigned") {
        if (!onThisBus) return false;
      }
      // status === "all" → ไม่กรอง
    } else if (status === "no_seat") {
      if (hasSeat) return false;
    } else if (status === "missing_any") {
      // ขาดอะไรอย่างน้อย 1: ห้องในช่วงนี้ หรือ ที่นั่ง
      const hasRoom = batchKey ? isInBatch(p.code) : (assignedBatchCount(p.code) >= totalB && totalB > 0);
      if (hasRoom && hasSeat) return false;
    } else if (batchKey) {
      const inB = isInBatch(p.code);
      if (status === "unassigned" && inB) return false;
      if (status === "assigned" && !inB) return false;
    } else {
      const aB = assignedBatchCount(p.code);
      if (status === "unassigned" && totalB > 0 && aB >= totalB) return false;
      if (status === "assigned" && (totalB === 0 || aB < totalB)) return false;
    }
    if (gender && normGender(p.gender) !== gender) return false;
    if (nat) {
      const pnat = (p.nationality || p._inheritedNat || "").trim();
      if (pnat !== nat) return false;
    }
    if (search) {
      const hay = `${p.code || ""} ${p.name || ""} ${p.group_name || ""}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  document.getElementById("paxFilteredCount").textContent = filtered.length;

  const list = document.getElementById("paxList");
  if (!filtered.length) {
    list.innerHTML = `<div class="ra-pax-empty">ไม่พบลูกค้า</div>`;
    return;
  }

  list.innerHTML = filtered.map(p => {
    // เมื่อกรองตามโรงแรม → แสดงเฉพาะห้องในโรงแรมนั้น (ไม่ปนกับช่วงอื่น)
    const rooms = roomNamesForCode(p.code, batchKey);
    const isAssigned = rooms.length > 0;
    const sel = state.selectedPaxCode === p.code ? " selected" : "";
    const ass = isAssigned ? " assigned" : "";
    const gNorm = normGender(p.gender || p._inheritedGender);
    const gTag = gNorm === "M" ? '<span class="ra-gender-tag ra-gender-M">♂ M</span>'
              : gNorm === "F" ? '<span class="ra-gender-tag ra-gender-F">♀ F</span>'
              : "";
    const roomTag = isAssigned
      ? (rooms.length === 1
          ? `🛏️ ${escapeHtml(rooms[0])}`
          : `🛏️ ${rooms.length} ห้อง · ${escapeHtml(rooms.join(", "))}`)
      : "";
    // bus seat tag (merged)
    const seatInfo = state.codeToBusSeat?.[p.code];
    let seatTag = "";
    if (seatInfo) {
      const bus = state.buses.find(b => b.bus_id === seatInfo.bus_id);
      const busLbl = bus ? (bus.bus_label || `คันที่ ${bus.bus_no || "?"}`) : `Bus ${seatInfo.bus_id}`;
      seatTag = `🚌 ${escapeHtml(busLbl)} · ที่นั่ง ${escapeHtml(seatInfo.seat_no)}`;
    }
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
      ${roomTag ? `<div class="ra-pax-room-tag" title="${escapeAttr(rooms.join(", "))}">${roomTag}</div>` : ""}
      ${seatTag ? `<div class="ra-pax-room-tag" style="background:#dcfce7;color:#15803d">${seatTag}</div>` : ""}
    </div>`;
  }).join("");
}

window.selectPax = function (code) {
  // toggle off if clicking same row
  state.selectedPaxCode = state.selectedPaxCode === code ? null : code;
  renderPassengers();
  updateSelectionHint();
  updateRoomCardsAssignableState();
  if (typeof updateSeatAssignableState === "function") updateSeatAssignableState();
};

window.clearPaxSelection = function () {
  state.selectedPaxCode = null;
  renderPassengers();
  updateSelectionHint();
  updateRoomCardsAssignableState();
  if (typeof updateSeatAssignableState === "function") updateSeatAssignableState();
};

function updateSelectionHint() {
  const hint = document.getElementById("selectedHint");
  const btn  = document.getElementById("btnClearSelection");
  if (state.selectedPaxCode) {
    const p = state.passengers.find(x => x.code === state.selectedPaxCode);
    const target = state.activeTab === "buses" ? "ที่นั่งรถบัส" : "ห้องพัก";
    hint.innerHTML = `เลือก: <b style="color:var(--accent)">${escapeHtml(p?.name || state.selectedPaxCode)}</b> — คลิก${target}ที่ต้องการ`;
    btn.style.display = "inline-flex";
  } else {
    hint.textContent = "ยังไม่ได้เลือกลูกค้า — คลิกชื่อด้านซ้ายเพื่อเริ่ม";
    btn.style.display = "none";
  }
}

function updateRoomCardsAssignableState() {
  document.querySelectorAll(".ra-room-card").forEach(card => {
    const rid = parseInt(card.dataset.roomId, 10);
    const r = state.rooms.find(x => x.room_id === rid);
    if (!r) return;
    const occCount = (state.occupants[rid] || []).length;
    const isFull = occCount >= r.capacity;
    card.classList.toggle("full", isFull);
    card.classList.toggle("assignable", !!state.selectedPaxCode && !isFull);
  });
}

// group key: hotel + room type + ช่วงวัน — ห้องคนละช่วงวัน = คนละกลุ่ม
function groupKeyOf(r) {
  return `${r.place_id || 0}|${r.room_type || "อื่นๆ"}|${r.check_in_date || ""}|${r.check_out_date || ""}`;
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

  // Group by place_id + room_type + dates — ห้องคนละช่วงวัน = คนละกลุ่ม
  const groups = {};
  state.rooms.forEach(r => {
    const k = groupKeyOf(r);
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  });

  // ใช้ state.occupants ที่ load จาก trip_room_occupants — รองรับ 1 คน × N ห้อง
  // resolve code → passenger row
  const paxByCode = {};
  state.passengers.forEach(p => { paxByCode[p.code] = p; });
  const occByRoom = {}; // { room_id: [passenger row, ...] }
  Object.keys(state.occupants).forEach(rid => {
    occByRoom[rid] = (state.occupants[rid] || [])
      .map(code => paxByCode[code])
      .filter(Boolean);
  });

  c.innerHTML = Object.keys(groups).map(groupKey => {
    const rooms = groups[groupKey];
    const placeId = rooms[0]?.place_id || null;
    const typeName = rooms[0]?.room_type || "อื่นๆ";
    const hotel = state.hotels.find(h => h.place_id === placeId);
    const hotelName = hotel?.place_name || (placeId ? `Place #${placeId}` : "ไม่ระบุโรงแรม");
    const totalCap = rooms.reduce((a, r) => a + (r.capacity || 0), 0);
    const totalOcc = rooms.reduce((a, r) => a + (occByRoom[r.room_id]?.length || 0), 0);
    // คนที่ "จัดแล้ว" ในกลุ่มนี้ = unique codes ที่มีห้องในกลุ่มนี้
    const assignedCodesInGroup = new Set();
    rooms.forEach(r => (state.occupants[r.room_id] || []).forEach(c => assignedCodesInGroup.add(c)));
    const unassignedInGroup = state.passengers.length - assignedCodesInGroup.size;

    const ridsCsv = rooms.map(r => r.room_id).join(",");
    // apply filter — show rooms ที่ยังไม่เต็ม (0 occupants OR partially filled)
    const visibleRooms = state.filterEmptyOnly
      ? rooms.filter(r => (occByRoom[r.room_id]?.length || 0) < (r.capacity || 0))
      : rooms;
    // เรียงห้องแบบ natural ASC (Twin-2 < Twin-3 < Twin-21 ไม่ใช่ Twin-1 → Twin-10 → Twin-2)
    visibleRooms.sort((a, b) =>
      (a.room_name || "").localeCompare(b.room_name || "", undefined, { numeric: true, sensitivity: "base" })
      || (a.room_id - b.room_id)
    );
    const hiddenCount = rooms.length - visibleRooms.length;

    // ช่วงวันที่ของกลุ่ม — ถ้าทุกห้องใช้ช่วงเดียวกัน แสดงครั้งเดียว, ถ้าต่างกันแสดง "หลายช่วง"
    const inSet  = new Set(rooms.map(r => r.check_in_date  || ""));
    const outSet = new Set(rooms.map(r => r.check_out_date || ""));
    let dateLabel = "";
    if (inSet.size === 1 && outSet.size === 1) {
      const ci = [...inSet][0], co = [...outSet][0];
      if (ci || co) dateLabel = `📅 ${ci ? fmtDate(ci) : "—"} → ${co ? fmtDate(co) : "—"}`;
    } else {
      dateLabel = `<span title="ห้องในกลุ่มนี้มีช่วงวันต่างกัน">📅 หลายช่วง</span>`;
    }

    const isCollapsed = state.collapsedGroups.has(groupKey);
    const activeBatchKey = document.getElementById("paxFilterBatch")?.value || "";
    const totalBatches = (() => {
      const s = new Set();
      state.rooms.forEach(r => s.add(groupKeyOf(r)));
      return s.size;
    })();
    const isLocked = totalBatches > 1 && !!activeBatchKey && groupKey !== activeBatchKey;
    return `<div class="ra-rooms-grp${isCollapsed ? " collapsed" : ""}${isLocked ? " locked" : ""}">
      <div class="ra-rooms-grp-hdr">
        <div class="ra-grp-title">
          <button class="ra-grp-toggle${isLocked ? " locked" : ""}"
            title="${isLocked ? "เปลี่ยนโรงแรมจาก dropdown ด้านซ้ายเพื่อขยาย" : (isCollapsed ? "ขยาย" : "ย่อ") + "กลุ่มนี้"}"
            onclick="window.toggleGroupCollapse('${escapeJs(groupKey)}')">${isLocked ? "🔒" : (isCollapsed ? "▸" : "▾")}</button>
          <span class="ra-grp-icon">🏨</span>
          <span class="ra-grp-hotel${placeId ? ' clickable' : ''}"
            ${placeId ? `title="คลิกดูรูปโรงแรม" onclick="window.viewHotelImages(${placeId})"` : ""}>${escapeHtml(hotelName)}</span>
          <span class="ra-grp-sep"> : </span>
          <span class="ra-grp-room${placeId ? ' clickable' : ''}"
            ${placeId ? `title="คลิกดูรูปประเภทห้อง" onclick="window.viewRoomTypeFromGroup(${placeId}, '${escapeJs(typeName)}')"` : ""}>${escapeHtml(typeName)}</span>
          <span class="ra-grp-sep"> : </span>
          <span class="ra-grp-count">${rooms.length} ห้อง</span>
          <span class="ra-grp-sep"> : </span>
          <span class="ra-grp-count">${totalOcc}/${totalCap} คน</span>
          <div class="ra-grp-line2">
            ${dateLabel ? `<span class="ra-grp-dates">${dateLabel}</span>` : ""}
            <span class="ra-grp-pill ra-grp-pill-ok"
              title="คนที่มีห้องในช่วงพักนี้แล้ว">✅ ${assignedCodesInGroup.size}</span>
            <span class="ra-grp-pill ra-grp-pill-warn"
              title="คนที่ยังไม่มีห้องในช่วงพักนี้">⏳ ${unassignedInGroup}</span>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px${isLocked ? ';visibility:hidden' : ''}">
          <button class="ra-toggle-empty ra-add-room"
            data-perm="trip_rooms_create"
            title="เพิ่ม 1 ห้องในกลุ่มนี้"
            onclick="window.addOneRoomToGroup('${escapeJs(groupKey)}')">
            ＋ ห้อง
          </button>
          <button class="ra-toggle-empty${state.filterEmptyOnly ? ' active' : ''}"
            title="ดูห้องที่ยังไม่เต็ม (ว่าง + อยู่ไม่ครบ)"
            onclick="window.toggleEmptyOnlyFilter(${!state.filterEmptyOnly})">
            ${state.filterEmptyOnly ? '✓' : '○'} ห้องว่าง
          </button>
          <div class="ra-grp-kebab-wrap" data-group="${escapeAttr(groupKey)}">
            <button class="ra-grp-kebab" title="ตัวเลือกเพิ่มเติม"
              onclick="window.toggleGroupKebab('${escapeJs(groupKey)}', event)">⋮</button>
            <div class="ra-grp-kebab-menu" onclick="event.stopPropagation()">
              <button onclick="window.duplicateRoomGroup('${escapeJs(groupKey)}');window.closeGroupKebabs()">
                <span class="ra-kebab-icon">📋</span> คัดลอก
              </button>
              <button data-perm="trip_rooms_edit"
                onclick="window.editRoomGroup('${escapeJs(groupKey)}');window.closeGroupKebabs()">
                <span class="ra-kebab-icon">✏️</span> แก้ไข
              </button>
              <button class="danger" data-perm="trip_rooms_delete"
                onclick="window.closeGroupKebabs();window.deleteRoomGroup('${escapeJs(hotelName + ' : ' + typeName)}', [${ridsCsv}], ${totalOcc})">
                <span class="ra-kebab-icon">🗑</span> ลบทั้งหมด
              </button>
            </div>
          </div>
        </div>
      </div>
      ${isCollapsed ? "" : `
        ${hiddenCount > 0 ? `<div style="font-size:11px;color:var(--text3);margin-bottom:6px">ซ่อน ${hiddenCount} ห้องที่จัดเต็มแล้ว</div>` : ""}
        <div class="ra-rooms-cards">
          ${visibleRooms.length ? visibleRooms.map(r => roomCardHtml(r, occByRoom[r.room_id] || [])).join("") : `<div class="ra-empty-rooms" style="grid-column:1/-1">ห้องในกลุ่มนี้ถูกจัดเต็มแล้ว</div>`}
        </div>
      `}
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
      <button class="ra-occ-remove" title="ย้ายออกจากห้องนี้" onclick="event.stopPropagation();window.unassignPax('${escapeJs(o.code)}', ${r.room_id})">×</button>
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

  const hasNote = !!(r.note && r.note.trim());
  return `<div class="ra-room-card" data-room-id="${r.room_id}" onclick="window.assignSelectedPax(${r.room_id})">
    <div class="ra-room-card-hdr">
      <input class="ra-room-name" value="${escapeAttr(r.room_name || "")}" data-room-id="${r.room_id}"
             onclick="event.stopPropagation()"
             onblur="window.renameRoom(${r.room_id}, this.value)"
             onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" />
      <div class="ra-room-actions" onclick="event.stopPropagation()">
        <button class="${hasNote ? "has-note" : ""}" title="${hasNote ? "หมายเหตุ: " + escapeAttr(r.note) : "เพิ่มหมายเหตุ"}"
                onclick="window.editRoomNote(${r.room_id})">📝</button>
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
    ${hasNote ? `<div class="ra-room-note" title="${escapeAttr(r.note)}">📝 ${escapeHtml(r.note)}</div>` : ""}
    ${occHtml ? `<div class="ra-room-occupants">${occHtml}</div>` : `<div style="font-size:11px;color:var(--text3);text-align:center;padding:8px 0">ห้องว่าง</div>`}
  </div>`;
}

// ── ASSIGN / UNASSIGN ──────────────────────────────────────
// helpers: mutate state.occupants + state.codeToRooms in pairs
function _addOccupant(roomId, code) {
  if (!state.occupants[roomId]) state.occupants[roomId] = [];
  if (!state.occupants[roomId].includes(code)) state.occupants[roomId].push(code);
  if (!state.codeToRooms[code]) state.codeToRooms[code] = new Set();
  state.codeToRooms[code].add(roomId);
}
function _removeOccupant(roomId, code) {
  if (state.occupants[roomId]) {
    state.occupants[roomId] = state.occupants[roomId].filter(c => c !== code);
    if (!state.occupants[roomId].length) delete state.occupants[roomId];
  }
  if (state.codeToRooms[code]) {
    state.codeToRooms[code].delete(roomId);
    if (!state.codeToRooms[code].size) delete state.codeToRooms[code];
  }
}

window.assignSelectedPax = async function (roomId) {
  if (!state.selectedPaxCode) {
    showToast("เลือกลูกค้าทางซ้ายก่อน", "info");
    return;
  }
  const r = state.rooms.find(x => x.room_id === roomId);
  if (!r) return;

  const code = state.selectedPaxCode;
  const p = state.passengers.find(x => x.code === code);
  if (!p) return;

  // 1 คนห้ามอยู่ 2 ห้องในกลุ่มเดียวกัน — เช็คห้องเดิมในกลุ่มนี้
  const targetGroupKey = groupKeyOf(r);
  const existingRoomsOfCode = [...(state.codeToRooms[code] || [])];
  const sameGroupExisting = existingRoomsOfCode.filter(rid => {
    const room = state.rooms.find(x => x.room_id === rid);
    return room && groupKeyOf(room) === targetGroupKey;
  });

  // Already in this exact room
  if (sameGroupExisting.includes(roomId)) {
    showToast(`${p.name || code} อยู่ใน "${r.room_name}" อยู่แล้ว`, "info");
    return;
  }

  // Capacity check
  const occCount = (state.occupants[roomId] || []).length;
  if (occCount >= r.capacity) {
    showToast(`ห้อง "${r.room_name}" เต็มแล้ว (${occCount}/${r.capacity})`, "error");
    return;
  }

  // Optimistic UI: ถ้าอยู่ห้องอื่นในกลุ่มนี้ → ย้าย (remove เก่า + add ใหม่), ไม่อย่างนั้น add อย่างเดียว
  const oldRoomId = sameGroupExisting[0] || null;
  if (oldRoomId) _removeOccupant(oldRoomId, code);
  _addOccupant(roomId, code);
  state.selectedPaxCode = null;
  renderStats();
  renderPassengers();
  renderRooms();
  updateSelectionHint();

  try {
    if (oldRoomId) {
      await sbFetch("trip_room_occupants",
        `?room_id=eq.${oldRoomId}&code=eq.${encodeURIComponent(code)}`,
        { method: "DELETE" });
    }
    await sbFetch("trip_room_occupants", "", {
      method: "POST",
      body: { room_id: roomId, code },
    });
    const oldRoom = oldRoomId ? state.rooms.find(x => x.room_id === oldRoomId) : null;
    const verb = oldRoom ? `ย้ายจาก "${oldRoom.room_name}" → "${r.room_name}"` : `→ ${r.room_name}`;
    showToast(`✅ ${p.name || code} ${verb}`, "success");
  } catch (e) {
    // revert
    _removeOccupant(roomId, code);
    if (oldRoomId) _addOccupant(oldRoomId, code);
    renderStats();
    renderPassengers();
    renderRooms();
    showToast("Assign ไม่สำเร็จ: " + e.message, "error");
  }
};

// unassign 1 คนออกจาก "ห้องเฉพาะห้องเดียว" — ต้องระบุ roomId เพราะคน 1 คนอยู่ได้หลายห้อง
window.unassignPax = async function (code, roomId) {
  const p = state.passengers.find(x => x.code === code);
  if (!p) return;
  if (roomId == null) {
    showToast("ต้องระบุห้องที่จะย้ายออก", "error");
    return;
  }
  const r = state.rooms.find(x => x.room_id === roomId);

  _removeOccupant(roomId, code);
  renderStats();
  renderPassengers();
  renderRooms();

  try {
    await sbFetch("trip_room_occupants",
      `?room_id=eq.${roomId}&code=eq.${encodeURIComponent(code)}`,
      { method: "DELETE" });
    showToast(`ย้ายออกจาก "${r?.room_name || "ห้อง"}" แล้ว: ${p.name || code}`, "success");
  } catch (e) {
    _addOccupant(roomId, code); // revert
    renderStats();
    renderPassengers();
    renderRooms();
    showToast("ย้ายออกไม่สำเร็จ: " + e.message, "error");
  }
};

// ── ROOM CRUD ──────────────────────────────────────────────
function populateHotelDropdown() {
  const sel = document.getElementById("rbHotel");
  if (!sel) return;
  const opts = ['<option value="">— เลือกโรงแรม —</option>'];
  state.hotels.forEach(h => {
    opts.push(`<option value="${h.place_id}">🏨 ${escapeHtml(h.place_name || "")}</option>`);
  });
  sel.innerHTML = opts.join("");
  sel.onchange = onHotelChange;
}

async function onHotelChange() {
  const sel = document.getElementById("rbHotel");
  const types = document.getElementById("rbRoomTypes");
  const placeId = parseInt(sel.value, 10);

  // toggle has-value class (เปลี่ยนสี orange → green)
  sel.classList.toggle("has-value", !!placeId);

  // reset selected room type ทุกครั้งที่เปลี่ยนโรงแรม
  state.rbSelectedHotelId = placeId || null;
  state.rbSelectedRoomTypeName = null;
  state.rbSelectedRoomTypeMaxGuests = 0;

  if (!placeId) {
    types.innerHTML = `<div class="rb-rt-empty">เลือกโรงแรมก่อน</div>`;
    return;
  }
  const hotel = state.hotels.find(h => h.place_id === placeId);
  if (!hotel) return;

  // Load room types (cached)
  if (!state.hotelRoomTypes[placeId]) {
    types.innerHTML = `<div class="rb-rt-empty">⏳ กำลังโหลดประเภทห้อง...</div>`;
    try {
      const rt = await sbFetch("place_room_types",
        `?place_id=eq.${placeId}&select=*&order=sort_order.asc`);
      state.hotelRoomTypes[placeId] = rt || [];
    } catch (e) {
      state.hotelRoomTypes[placeId] = [];
    }
  }
  renderRoomTypes(placeId);
}

function renderRoomTypes(placeId) {
  const container = document.getElementById("rbRoomTypes");
  const list = state.hotelRoomTypes[placeId] || [];
  if (!list.length) {
    container.innerHTML = `<div class="rb-rt-empty" style="background:#fef2f2;color:#991b1b">
      ⚠️ โรงแรมนี้ยังไม่ได้กำหนดประเภทห้อง<br>
      <a href="../event/events-place-form.html?id=${placeId}" target="_blank" style="color:#0f4c75;text-decoration:underline;font-weight:600">เพิ่มประเภทห้องที่หน้าสถานที่ →</a>
    </div>`;
    return;
  }
  container.innerHTML = `
    <div class="rb-rt-grid">
      ${list.map((rt, i) => {
        const bed = rt.bed_type === "SINGLE" ? "Single bed" : rt.bed_type === "DOUBLE" ? "Double bed" : "—";
        const cap = rt.max_guests || 2;
        const imgs = Array.isArray(rt.image_urls) ? rt.image_urls : [];
        const hasImg = imgs.length > 0;
        const cover = imgs[0] || "../../assets/images/NoImage.png";
        const price = rt.rate_per_night ? `${fmtMoney(rt.rate_per_night)} ฿/คืน` : "ราคา: —";
        const extraBed = rt.rate_extra_bed ? `Extra bed: ${fmtMoney(rt.rate_extra_bed)} ฿` : "Extra bed: —";
        return `<div class="rb-rt-card" data-rt-idx="${i}"
          onclick="window.pickRoomType(${i})">
          <img class="rb-rt-img${hasImg ? ' clickable' : ''}" src="${cover}" alt="${escapeAttr(rt.room_type_name || "")}"
            ${hasImg ? `onclick="event.stopPropagation();window.viewRoomTypeImages(${i})" title="คลิกดูรูปขยาย"` : ""}
            onerror="this.src='../../assets/images/NoImage.png';this.classList.remove('clickable');this.onclick=null;" />
          <div class="rb-rt-name">${escapeHtml(rt.room_type_name || "—")}</div>
          <div class="rb-rt-meta">${bed} · ${cap} คน${rt.breakfast_included ? " · อาหารเช้า" : ""}</div>
          <div class="rb-rt-price">${price}</div>
          <div class="rb-rt-extra">${extraBed}</div>
        </div>`;
      }).join("")}
    </div>`;
}

// คลิกชื่อโรงแรมที่ group header → เปิดรูปภาพรวมของโรงแรม
window.viewHotelImages = function (placeId) {
  const hotel = state.hotels.find(h => h.place_id === placeId);
  if (!hotel) { showToast("ไม่พบข้อมูลโรงแรม", "info"); return; }
  // image_urls อาจเป็น array (legacy) หรือ object {exterior, food} (ปัจจุบัน)
  const raw = hotel.image_urls;
  let imgs = [];
  if (Array.isArray(raw)) imgs = raw.filter(Boolean);
  else if (raw && typeof raw === "object") {
    imgs = [...(raw.exterior || []), ...(raw.food || [])].filter(Boolean);
  }
  if (!imgs.length) { showToast(`ยังไม่มีรูปของ ${hotel.place_name || ""}`, "info"); return; }
  const titles = imgs.map(() => hotel.place_name || "โรงแรม");
  if (typeof ImgPopup !== "undefined" && ImgPopup.open) {
    ImgPopup.open(imgs, 0, { titles });
  } else {
    window.open(imgs[0], "_blank");
  }
};

// คลิกชื่อประเภทห้องที่ group header → เปิดรูปของ room type นั้น
window.viewRoomTypeFromGroup = async function (placeId, roomTypeName) {
  if (!placeId || !roomTypeName) return;
  // โหลด cache ถ้ายังไม่มี
  if (!state.hotelRoomTypes[placeId]) {
    showLoading(true);
    try {
      const rt = await sbFetch("place_room_types",
        `?place_id=eq.${placeId}&select=*&order=sort_order.asc`);
      state.hotelRoomTypes[placeId] = rt || [];
    } catch (e) {
      state.hotelRoomTypes[placeId] = [];
    }
    showLoading(false);
  }
  const list = state.hotelRoomTypes[placeId] || [];
  const rt = list.find(x => (x.room_type_name || "") === roomTypeName);
  if (!rt) { showToast(`ไม่พบประเภทห้อง "${roomTypeName}" ของโรงแรมนี้`, "info"); return; }
  const imgs = Array.isArray(rt.image_urls) ? rt.image_urls.filter(Boolean) : [];
  if (!imgs.length) { showToast(`ยังไม่มีรูปของ ${roomTypeName}`, "info"); return; }
  const titles = imgs.map(() => rt.room_type_name || "ห้องพัก");
  if (typeof ImgPopup !== "undefined" && ImgPopup.open) {
    ImgPopup.open(imgs, 0, { titles });
  } else {
    window.open(imgs[0], "_blank");
  }
};

window.viewRoomTypeImages = function (i) {
  const placeId = state.rbSelectedHotelId;
  if (!placeId) return;
  const list = state.hotelRoomTypes[placeId] || [];
  const rt = list[i];
  if (!rt) return;
  const imgs = Array.isArray(rt.image_urls) ? rt.image_urls.filter(Boolean) : [];
  if (!imgs.length) return;
  const titles = imgs.map(() => rt.room_type_name || "ห้องพัก");
  if (typeof ImgPopup !== "undefined" && ImgPopup.open) {
    ImgPopup.open(imgs, 0, { titles });
  } else {
    window.open(imgs[0], "_blank");
  }
};

window.pickRoomType = function (idx) {
  const placeId = state.rbSelectedHotelId;
  const list = state.hotelRoomTypes[placeId] || [];
  const rt = list[idx];
  if (!rt) return;

  state.rbSelectedRoomTypeName = rt.room_type_name || "";
  state.rbSelectedRoomTypeMaxGuests = rt.max_guests || 2;

  // visual highlight on selected card
  document.querySelectorAll(".rb-rt-card").forEach(el => el.classList.remove("selected"));
  const target = document.querySelector(`.rb-rt-card[data-rt-idx="${idx}"]`);
  if (target) target.classList.add("selected");
};

// คำนวณส่วนต่างวัน (in → out) เพื่อ highlight chip ที่ตรงกับช่วงปัจจุบัน
function diffDays(isoIn, isoOut) {
  if (!isoIn || !isoOut) return null;
  const a = new Date(isoIn + "T00:00:00");
  const b = new Date(isoOut + "T00:00:00");
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

window.refreshDurationChips = function () {
  const inEl = document.getElementById("rbCheckIn");
  const outEl = document.getElementById("rbCheckOut");
  const d = diffDays(inEl?.value, outEl?.value);
  document.querySelectorAll("#rbDaysChips input[type='checkbox']").forEach(cb => {
    cb.checked = (d != null && parseInt(cb.dataset.days, 10) === d);
  });
};

window.setStayDays = function (days, cb) {
  // Single-select: uncheck others (เพราะ logic เหมือน radio)
  document.querySelectorAll("#rbDaysChips input[type='checkbox']").forEach(other => {
    if (other !== cb) other.checked = false;
  });
  if (!cb.checked) {
    // ผู้ใช้กดเอาออก → ไม่เปลี่ยน check-out
    return;
  }
  const inEl = document.getElementById("rbCheckIn");
  const outEl = document.getElementById("rbCheckOut");
  const inVal = inEl?.value;
  if (!inVal) {
    showToast("ใส่ Check-in ก่อน", "error");
    cb.checked = false;
    return;
  }
  const d = new Date(inVal + "T00:00:00");
  if (isNaN(d)) return;
  d.setDate(d.getDate() + days);
  // ISO format (YYYY-MM-DD)
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  outEl.value = `${yy}-${mm}-${dd}`;
};

window.openRoomBatchModal = function () {
  state.editingGroupKey = null;
  state.duplicateFromGroupKey = null;
  document.getElementById("rbModalTitle").textContent = "เพิ่มประเภทห้องพัก";
  document.getElementById("rbSaveBtn").innerHTML = "💾 สร้างห้อง";
  document.getElementById("rbCountWrap").style.display = "";
  document.getElementById("rbCountLabel").innerHTML = 'จำนวนห้อง <span class="req">*</span>';
  document.getElementById("rbCountHint").style.display = "none";
  const cnt = document.getElementById("rbCount");
  cnt.value = 1;
  cnt.readOnly = false;
  cnt.style.background = "";
  cnt.style.opacity = "";
  // default check-in/out จากช่วงวันของทริป
  document.getElementById("rbCheckIn").value  = state.trip?.start_date || "";
  document.getElementById("rbCheckOut").value = state.trip?.end_date   || "";
  window.refreshDurationChips();
  const sel = document.getElementById("rbHotel");
  if (sel) { sel.value = ""; sel.classList.remove("has-value"); }
  const types = document.getElementById("rbRoomTypes");
  if (types) types.innerHTML = `<div class="rb-rt-empty">เลือกโรงแรมก่อน</div>`;
  state.rbSelectedHotelId = null;
  state.rbSelectedRoomTypeName = null;
  state.rbSelectedRoomTypeMaxGuests = 0;
  document.getElementById("roomBatchOverlay").classList.add("open");
  setTimeout(() => document.getElementById("rbHotel")?.focus(), 50);
};

window.closeRoomBatchModal = function (e) {
  if (e && e.target.id !== "roomBatchOverlay") return;
  document.getElementById("roomBatchOverlay").classList.remove("open");
  state.editingGroupKey = null;
  state.duplicateFromGroupKey = null;
  // ปลดล็อก rbCount เผื่อโดน lock จาก duplicate mode
  const cnt = document.getElementById("rbCount");
  if (cnt) { cnt.readOnly = false; cnt.style.background = ""; cnt.style.opacity = ""; }
};

window.saveRoomBatch = async function () {
  if (!state.rbSelectedHotelId) {
    showToast("เลือกโรงแรมก่อน", "error");
    return;
  }
  if (!state.rbSelectedRoomTypeName) {
    showToast("เลือกประเภทห้องก่อน", "error");
    return;
  }
  const name = state.rbSelectedRoomTypeName;
  const cap = state.rbSelectedRoomTypeMaxGuests || 2;
  const checkIn  = document.getElementById("rbCheckIn").value  || null;
  const checkOut = document.getElementById("rbCheckOut").value || null;

  if (checkIn && checkOut && checkOut < checkIn) {
    showToast("Check-out ต้องไม่น้อยกว่า Check-in", "error");
    return;
  }

  // EDIT mode — PATCH ทุกห้องในกลุ่มเดิม + (ถ้า rbCount > 0) เพิ่มห้องใหม่
  if (state.editingGroupKey) {
    const targets = state.rooms.filter(r => groupKeyOf(r) === state.editingGroupKey);
    if (!targets.length) { showToast("ไม่พบกลุ่มที่จะแก้ไข", "error"); return; }
    const ids = targets.map(r => r.room_id);
    const body = {
      place_id: state.rbSelectedHotelId,
      room_type: name,
      capacity: cap,
      check_in_date: checkIn,
      check_out_date: checkOut,
      updated_at: new Date().toISOString(),
    };
    const addCount = Math.max(0, parseInt(document.getElementById("rbCount").value, 10) || 0);
    showLoading(true);
    try {
      await sbFetch("trip_rooms", `?room_id=in.(${ids.join(",")})`, { method: "PATCH", body });
      // อัปเดต room_name ให้ prefix ตาม room_type ใหม่ (Twin-1 → Suite-1 ฯลฯ)
      // แต่ถ้า room_type ไม่เปลี่ยน ก็ไม่ต้องยุ่ง — เช็คก่อน
      const oldType = targets[0].room_type;
      if (oldType !== name) {
        // rename ทีละห้อง (ตาม index เดิม)
        await Promise.all(targets.map((r, i) =>
          sbFetch("trip_rooms", `?room_id=eq.${r.room_id}`, {
            method: "PATCH",
            body: { room_name: `${name}-${i + 1}` },
          })
        ));
      }
      // เพิ่มห้องใหม่ในกลุ่มเดียวกัน (ใช้ check_in/out + place + type ใหม่)
      let addedMsg = "";
      if (addCount > 0) {
        const startIdx = nextRoomIdx(name, state.rbSelectedHotelId);
        const baseSort = state.rooms.length;
        const addPayload = [];
        for (let i = 0; i < addCount; i++) {
          addPayload.push({
            trip_id: state.tripId,
            place_id: state.rbSelectedHotelId,
            room_name: `${name}-${startIdx + i}`,
            room_type: name,
            capacity: cap,
            check_in_date: checkIn,
            check_out_date: checkOut,
            sort_order: baseSort + i,
          });
        }
        await sbFetch("trip_rooms", "", { method: "POST", body: addPayload });
        addedMsg = ` + เพิ่ม ${addCount} ห้อง`;
      }
      showToast(`บันทึกการแก้ไขแล้ว${addedMsg}`, "success");
      document.getElementById("roomBatchOverlay").classList.remove("open");
      state.editingGroupKey = null;
      await loadAll();
    } catch (e) {
      showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
    }
    showLoading(false);
    return;
  }

  // CREATE mode (รวม DUPLICATE mode = create + copy occupants จากต้นฉบับ)
  const isDup = !!state.duplicateFromGroupKey;
  const sourceRooms = isDup
    ? state.rooms.filter(r => groupKeyOf(r) === state.duplicateFromGroupKey)
    : [];

  // Duplicate: validate ว่าผู้ใช้เปลี่ยน hotel/type/dates อย่างน้อย 1 อย่าง
  if (isDup && sourceRooms.length) {
    const src = sourceRooms[0];
    const samePlace = state.rbSelectedHotelId === src.place_id;
    const sameType  = name === src.room_type;
    const sameDates = (checkIn || "") === (src.check_in_date || "")
                   && (checkOut || "") === (src.check_out_date || "");
    if (samePlace && sameType && sameDates) {
      showToast("ต้องเปลี่ยนโรงแรม/ประเภทห้อง/ช่วงวันอย่างน้อย 1 อย่าง", "error");
      return;
    }
  }

  // Duplicate: count ล็อก = ขนาดต้นฉบับ — ไม่อ่าน input
  const count = isDup
    ? sourceRooms.length
    : (parseInt(document.getElementById("rbCount").value, 10) || 1);
  if (count < 1) { showToast("จำนวนต้อง ≥ 1", "error"); return; }

  // หา start index จากเลข suffix สูงสุดของห้องประเภทเดียวกัน (เพื่อต่อเลข Twin-3 ถ้ามี Twin-1, Twin-2 อยู่)
  const startIdx = nextRoomIdx(name, state.rbSelectedHotelId);
  const baseSort = state.rooms.length;

  const payload = [];
  for (let i = 0; i < count; i++) {
    payload.push({
      trip_id: state.tripId,
      place_id: state.rbSelectedHotelId,
      room_name: `${name}-${startIdx + i}`,
      room_type: name,
      capacity: cap,
      check_in_date: checkIn,
      check_out_date: checkOut,
      sort_order: baseSort + i,
    });
  }

  showLoading(true);
  try {
    const created = await sbFetch("trip_rooms", "", { method: "POST", body: payload });

    // Duplicate: copy occupants จาก sourceRooms[i] → newRooms[i] (match ตาม sort_order)
    let dupMsg = "";
    if (isDup && sourceRooms.length) {
      const newRooms = Array.isArray(created) ? created : [];
      const sortedNew = [...newRooms].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      const occPayload = [];
      sourceRooms.forEach((src, i) => {
        const dst = sortedNew[i];
        if (!dst) return;
        const codes = state.occupants[src.room_id] || [];
        codes.forEach(code => occPayload.push({ room_id: dst.room_id, code }));
      });
      if (occPayload.length) {
        try {
          await sbFetch("trip_room_occupants", "", { method: "POST", body: occPayload });
          dupMsg = ` + คัดลอกคู่นอน ${occPayload.length} คน`;
        } catch (e) {
          console.warn("[room-assign] copy occupants failed:", e.message);
          showToast(`ห้องสร้างแล้ว แต่ copy คู่นอนไม่สำเร็จ: ${e.message}`, "error");
        }
      }
    }

    showToast(`${isDup ? "คัดลอกกลุ่ม" : "สร้าง"}ห้อง ${count} ห้องแล้ว${dupMsg}`, "success");
    document.getElementById("roomBatchOverlay").classList.remove("open");
    state.duplicateFromGroupKey = null;
    // ปลดล็อก rbCount
    const cnt = document.getElementById("rbCount");
    if (cnt) { cnt.readOnly = false; cnt.style.background = ""; cnt.style.opacity = ""; }
    await loadAll();
  } catch (e) {
    showToast(`${isDup ? "คัดลอก" : "สร้างห้อง"}ไม่สำเร็จ: ` + e.message, "error");
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

window.toggleEmptyOnlyFilter = function (val) {
  state.filterEmptyOnly = (typeof val === "boolean") ? val : !state.filterEmptyOnly;
  renderRooms();
};

window.toggleGroupCollapse = function (typeName) {
  // Lock: ถ้ามี >1 โรงแรม + เลือก batch ไว้ → ย่อ-ขยายได้เฉพาะ batch นั้น
  const activeKey = document.getElementById("paxFilterBatch")?.value || "";
  const totalB = totalBatchCount();
  if (totalB > 1 && activeKey && typeName !== activeKey) {
    showToast("เปลี่ยนโรงแรมที่ dropdown ด้านซ้ายเพื่อขยายกลุ่มนี้", "info");
    return;
  }
  if (state.collapsedGroups.has(typeName)) state.collapsedGroups.delete(typeName);
  else state.collapsedGroups.add(typeName);
  renderRooms();
};

// ── Kebab menu (per group) ──
window.closeGroupKebabs = function () {
  document.querySelectorAll(".ra-grp-kebab-wrap.open").forEach(el => el.classList.remove("open"));
};
window.toggleGroupKebab = function (groupKey, ev) {
  ev.stopPropagation();
  const wrap = document.querySelector(`.ra-grp-kebab-wrap[data-group="${cssEscape(groupKey)}"]`);
  if (!wrap) return;
  const isOpen = wrap.classList.contains("open");
  window.closeGroupKebabs();
  if (!isOpen) wrap.classList.add("open");
};
document.addEventListener("click", (ev) => {
  if (!ev.target.closest(".ra-grp-kebab-wrap")) window.closeGroupKebabs();
});

function cssEscape(s) {
  return String(s).replace(/[\\"]/g, "\\$&");
}

// หา index ถัดไปสำหรับชื่อห้อง "<roomType>-N" โดยอ้างอิงเลข suffix สูงสุดที่ใช้แล้ว
// (ไม่ใช่ length เพราะถ้าลบห้องตรงกลางจะชนชื่อ)
// usedNames = Set ของชื่อห้องที่ห้ามทับ (กันกรณี user rename ทับเลขใหม่)
function nextRoomIdx(roomType, placeId) {
  const prefix = `${roomType}-`;
  const sameType = state.rooms.filter(r =>
    (r.room_type || "") === roomType && r.place_id === placeId);
  const used = new Set(sameType.map(r => r.room_name || ""));
  let maxIdx = 0;
  sameType.forEach(r => {
    const name = r.room_name || "";
    if (name.startsWith(prefix)) {
      const n = parseInt(name.slice(prefix.length), 10);
      if (Number.isFinite(n) && n > maxIdx) maxIdx = n;
    }
  });
  let idx = maxIdx + 1;
  while (used.has(`${prefix}${idx}`)) idx++;
  return idx;
}

// ── Add 1 room to existing group ──
// ใช้ค่า hotel + room_type + dates + capacity จากต้นฉบับของกลุ่มนั้น
window.addOneRoomToGroup = async function (groupKey) {
  const rooms = state.rooms.filter(r => groupKeyOf(r) === groupKey);
  if (!rooms.length) return;
  const sample = rooms[0];
  const nextIdx = nextRoomIdx(sample.room_type, sample.place_id);
  showLoading(true);
  try {
    await sbFetch("trip_rooms", "", {
      method: "POST",
      body: [{
        trip_id: state.tripId,
        place_id: sample.place_id,
        room_name: `${sample.room_type}-${nextIdx}`,
        room_type: sample.room_type,
        capacity: sample.capacity,
        check_in_date: sample.check_in_date,
        check_out_date: sample.check_out_date,
        sort_order: state.rooms.length,
      }],
    });
    showToast(`เพิ่มห้อง ${sample.room_type}-${nextIdx} แล้ว`, "success");
    await loadAll();
  } catch (e) {
    showToast("เพิ่มห้องไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

// ── Duplicate group ──
// คัดลอก = เปิด modal "สร้างกลุ่มใหม่" โดย pre-fill ตามต้นฉบับ
// → user ต้องเปลี่ยนโรงแรม/ประเภท/วันก่อน save → ระบบ create กลุ่มใหม่ + copy ผู้พักจากต้นฉบับ
window.duplicateRoomGroup = async function (groupKey) {
  const rooms = state.rooms.filter(r => groupKeyOf(r) === groupKey);
  if (!rooms.length) return;
  const sample = rooms[0];

  state.editingGroupKey = null;
  state.duplicateFromGroupKey = groupKey;
  state.rbSelectedHotelId = sample.place_id || null;
  state.rbSelectedRoomTypeName = sample.room_type || "";
  state.rbSelectedRoomTypeMaxGuests = sample.capacity || 2;

  // Pre-fill hotel + room type
  const sel = document.getElementById("rbHotel");
  if (sel) {
    sel.value = String(sample.place_id || "");
    sel.classList.toggle("has-value", !!sample.place_id);
  }
  await onHotelChange();
  const list = state.hotelRoomTypes[sample.place_id] || [];
  const idx = list.findIndex(rt => (rt.room_type_name || "") === sample.room_type);
  if (idx >= 0) window.pickRoomType(idx);

  // Pre-fill dates
  document.getElementById("rbCheckIn").value  = sample.check_in_date  || "";
  document.getElementById("rbCheckOut").value = sample.check_out_date || "";
  window.refreshDurationChips();

  // Count = source size, lock (ผู้พักต้อง match จำนวนห้องเดิม)
  const cnt = document.getElementById("rbCount");
  cnt.value = rooms.length;
  cnt.readOnly = true;
  cnt.style.background = "#f1f5f9";
  cnt.style.opacity = ".75";

  // toggle UI to duplicate mode
  document.getElementById("rbModalTitle").textContent  = "คัดลอกกลุ่มห้อง — เปลี่ยนโรงแรม/วัน/ประเภท";
  document.getElementById("rbSaveBtn").innerHTML       = "💾 สร้างกลุ่มใหม่ (คัดลอกคู่นอนเดิม)";
  document.getElementById("rbCountWrap").style.display = "";
  document.getElementById("rbCountLabel").innerHTML    = `จำนวนห้อง <span style="color:var(--text3);font-weight:400">(เท่ากับต้นฉบับ — ล็อก)</span>`;
  document.getElementById("rbCountHint").style.display = "";
  document.getElementById("rbCountHint").innerHTML     = "💡 คู่นอนเดิมจะถูกคัดลอกเข้าห้องใหม่ที่ตรงตำแหน่งกัน — เปลี่ยนโรงแรม/ประเภทห้อง/ช่วงวันก่อนบันทึก";
  document.getElementById("roomBatchOverlay").classList.add("open");
};

// ── Edit group (open modal in edit mode) ──
window.editRoomGroup = async function (groupKey) {
  const rooms = state.rooms.filter(r => groupKeyOf(r) === groupKey);
  if (!rooms.length) return;
  const sample = rooms[0];

  state.editingGroupKey = groupKey;
  state.rbSelectedHotelId = sample.place_id || null;
  state.rbSelectedRoomTypeName = sample.room_type || "";
  state.rbSelectedRoomTypeMaxGuests = sample.capacity || 2;

  // Open modal manually (avoid resetting in openRoomBatchModal)
  const sel = document.getElementById("rbHotel");
  if (sel) {
    sel.value = String(sample.place_id || "");
    sel.classList.toggle("has-value", !!sample.place_id);
  }
  // Trigger hotel change to load room types + auto-pick the matching card
  await onHotelChange();
  // After room types loaded, click the matching room type card
  const list = state.hotelRoomTypes[sample.place_id] || [];
  const idx = list.findIndex(rt => (rt.room_type_name || "") === sample.room_type);
  if (idx >= 0) window.pickRoomType(idx);

  document.getElementById("rbCheckIn").value  = sample.check_in_date  || "";
  document.getElementById("rbCheckOut").value = sample.check_out_date || "";
  window.refreshDurationChips();
  // edit mode: input ตีความเป็น "เพิ่มอีกกี่ห้อง" (default 0)
  document.getElementById("rbCount").value = 0;

  // toggle UI to edit mode
  document.getElementById("rbModalTitle").textContent  = "แก้ไขกลุ่มห้องพัก";
  document.getElementById("rbSaveBtn").innerHTML = "💾 บันทึกการแก้ไข";
  document.getElementById("rbCountLabel").innerHTML = `เพิ่มห้องอีก <span style="color:var(--text3);font-weight:400">(ปัจจุบัน ${rooms.length} ห้อง)</span>`;
  document.getElementById("rbCountWrap").style.display = "";
  document.getElementById("rbCountHint").style.display = "";
  document.getElementById("roomBatchOverlay").classList.add("open");
};

window.deleteRoomGroup = function (typeName, roomIds, occCount) {
  if (!Array.isArray(roomIds) || roomIds.length === 0) return;
  const msg = occCount > 0
    ? `ลบห้องแบบ "${typeName}" ทั้งหมด ${roomIds.length} ห้อง?<br><span style="color:#b91c1c">มีผู้พัก ${occCount} คน-คืน ในกลุ่มนี้ — ผู้พักจะถูกย้ายออกจากกลุ่มนี้ (ห้องในช่วงอื่นไม่กระทบ)</span>`
    : `ลบห้องแบบ "${typeName}" ทั้งหมด ${roomIds.length} ห้อง?`;

  const opener = window.DeleteModal?.open || window.ConfirmModal?.open;
  const doDelete = async () => {
    showLoading(true);
    try {
      // FK ON DELETE CASCADE → trip_room_occupants ถูกลบตามอัตโนมัติ
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

window.editRoomNote = async function (roomId) {
  const r = state.rooms.find(x => x.room_id === roomId);
  if (!r) return;
  let val;
  if (window.PromptModal?.open) {
    val = await window.PromptModal.open({
      title: `หมายเหตุห้อง ${r.room_name}`,
      message: "เช่น: ห้องชั้น 5, connecting, มีระเบียง — เว้นว่าง = ลบหมายเหตุ",
      icon: "📝",
      tone: "primary",
      inputType: "text",
      defaultValue: r.note || "",
      placeholder: "พิมพ์หมายเหตุ...",
      okText: "บันทึก",
    });
  } else {
    val = prompt(`หมายเหตุห้อง ${r.room_name}:`, r.note || "");
  }
  if (val == null) return; // cancelled
  const newNote = val.trim() || null;
  if (newNote === (r.note || null)) return;

  try {
    await sbFetch("trip_rooms", `?room_id=eq.${roomId}`, {
      method: "PATCH",
      body: { note: newNote, updated_at: new Date().toISOString() },
    });
    r.note = newNote;
    renderRooms();
    showToast(newNote ? "บันทึกหมายเหตุแล้ว" : "ลบหมายเหตุแล้ว", "success");
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  }
};

window.deleteRoom = function (roomId) {
  const r = state.rooms.find(x => x.room_id === roomId);
  if (!r) return;
  const occCount = (state.occupants[roomId] || []).length;
  const msg = occCount > 0
    ? `ห้อง "${r.room_name}" มีผู้พักอยู่ ${occCount} คน — ลบแล้วผู้พักจะถูกย้ายออกจากห้องนี้ (ห้องในช่วงอื่นไม่กระทบ) ดำเนินการต่อ?`
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
// "YYYY-MM-DD" → "DD/MM/YYYY"
function fmtDate(iso) {
  if (window.DateFmt && window.DateFmt.formatDMY) return window.DateFmt.formatDMY(iso);
  if (!iso) return "";
  const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

// format number → "1,500"
function fmtMoney(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return "—";
  return num.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

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

// ════════════════════════════════════════════════════════════
//  BUS LOGIC (merged from bus-assign)
// ════════════════════════════════════════════════════════════
// switchTab / updateTabCounts ประกาศไว้ข้างบนแล้ว — ที่นี่จะใช้ BUS_PRESETS

function populateBusPresetDropdown() {
  const sel = document.getElementById("fBusPreset");
  if (!sel) return;
  sel.innerHTML = Object.keys(BUS_PRESETS).map(k =>
    `<option value="${k}">${BUS_PRESETS[k].label} · ${BUS_PRESETS[k].capacity} ที่นั่ง</option>`
  ).join("");
}

window.onBusPresetChange = function () {
  const sel = document.getElementById("fBusPreset");
  const key = sel?.value || "BUS_45_2_2";
  const preset = BUS_PRESETS[key];
  const previewEl = document.getElementById("busPresetPreview");
  if (!preset || !previewEl) return;
  previewEl.innerHTML = `
    <div style="font-weight:700;color:var(--text);font-size:12px">${escapeHtml(preset.label)}</div>
    <div style="font-size:11px;color:var(--text2);margin-bottom:6px">${escapeHtml(preset.description)} · ${preset.capacity} ที่นั่ง</div>
    ${renderSeatMapHtml(preset.rows, {}, { interactive: false })}
  `;
};

// ── RENDER BUSES ───────────────────────────────────────────
function renderBuses() {
  const c = document.getElementById("busesContainer");
  const summary = document.getElementById("busesSummary");
  if (!c) return;
  if (!state.buses.length) {
    c.innerHTML = `<div class="ba-empty-buses">
      ยังไม่มีรถบัส — กด "＋ เพิ่มรถบัส" ด้านบนเพื่อสร้าง
    </div>`;
    if (summary) summary.textContent = "";
    return;
  }
  // summary line
  const totalCap = state.buses.reduce((a, b) => a + (b.capacity || 0), 0);
  const totalUsed = Object.values(state.busOccupants)
    .reduce((a, m) => a + Object.keys(m || {}).length, 0);
  if (summary) {
    summary.textContent = ` · ${state.buses.length} คัน · ${totalUsed}/${totalCap} ที่นั่ง`;
  }

  c.innerHTML = state.buses.map(b => busCardHtml(b)).join("");
  updateSeatAssignableState();
}

function busCardHtml(b) {
  const preset = BUS_PRESETS[b.layout_preset] || BUS_PRESETS.BUS_45_2_2;
  const occMap = state.busOccupants[b.bus_id] || {};
  const usedCount = Object.keys(occMap).length;
  const cap = b.capacity || preset.capacity || 0;
  const availCount = Math.max(0, cap - usedCount);
  const isCollapsed = state.collapsedBuses.has(b.bus_id);
  const pctUsed = cap > 0 ? Math.round((usedCount / cap) * 100) : 0;
  const pillCls = usedCount === 0 ? "" : (usedCount >= cap ? "full" : (pctUsed >= 80 ? "warn" : "ok"));
  const busLabel = b.bus_label ? escapeHtml(b.bus_label) : "";
  const driverInfo = b.driver_name
    ? `<span>👤 ${escapeHtml(b.driver_name)}${b.driver_phone ? ` · ${escapeHtml(b.driver_phone)}` : ""}</span>`
    : "";
  const vendorInfo = b.vendor ? `<span>🏢 ${escapeHtml(b.vendor)}</span>` : "";
  const plateInfo = b.plate ? `<span>🚗 ${escapeHtml(b.plate)}</span>` : "";
  const noteInfo = b.note ? `<span title="${escapeAttr(b.note)}">📝 ${escapeHtml(b.note)}</span>` : "";
  return `<div class="ba-bus-card${isCollapsed ? " collapsed" : ""}" data-bus-id="${b.bus_id}">
    <div class="ba-bus-hdr">
      <div class="ba-bus-title">
        <button class="ba-bus-toggle"
          title="${isCollapsed ? "ขยาย" : "ย่อ"}คันนี้"
          onclick="window.toggleBusCollapse(${b.bus_id})">${isCollapsed ? "▸" : "▾"}</button>
        <span class="ba-bus-no-badge">คันที่ ${b.bus_no || "?"}</span>
        ${busLabel ? `<span class="ba-bus-label">${busLabel}</span>` : ""}
        <span class="ba-bus-meta-pill">${escapeHtml(preset.label)}</span>
        <span class="ba-bus-meta-pill ${pillCls}">💺 ${usedCount}/${cap}</span>
        ${availCount === 0 && cap > 0 ? '<span class="ba-bus-meta-pill full">เต็ม</span>' : ""}
      </div>
      <div class="ba-bus-actions">
        <div class="ba-bus-kebab-wrap" data-bus="${b.bus_id}">
          <button class="ba-bus-kebab" title="ตัวเลือกเพิ่มเติม"
            onclick="window.toggleBusKebab(${b.bus_id}, event)">⋮</button>
          <div class="ba-bus-kebab-menu" onclick="event.stopPropagation()">
            <button data-perm="trip_bus_edit"
              onclick="window.editBus(${b.bus_id});window.closeBusKebabs()">
              <span class="ba-kebab-icon">✏️</span> แก้ไขข้อมูลรถ
            </button>
            <button onclick="window.autoFillBus(${b.bus_id});window.closeBusKebabs()">
              <span class="ba-kebab-icon">⚡</span> เติมที่นั่งอัตโนมัติ
            </button>
            <button onclick="window.clearBus(${b.bus_id});window.closeBusKebabs()">
              <span class="ba-kebab-icon">🧹</span> ล้างทุกที่นั่ง
            </button>
            <button class="danger" data-perm="trip_bus_delete"
              onclick="window.closeBusKebabs();window.deleteBus(${b.bus_id})">
              <span class="ba-kebab-icon">🗑</span> ลบคันนี้
            </button>
          </div>
        </div>
      </div>
    </div>
    ${(vendorInfo || plateInfo || driverInfo || noteInfo) ? `
      <div class="ba-bus-info">
        ${vendorInfo}${vendorInfo && plateInfo ? '<span class="sep">·</span>' : ""}
        ${plateInfo}${(vendorInfo || plateInfo) && driverInfo ? '<span class="sep">·</span>' : ""}
        ${driverInfo}${(vendorInfo || plateInfo || driverInfo) && noteInfo ? '<span class="sep">·</span>' : ""}
        ${noteInfo}
      </div>
    ` : ""}
    ${guidesRowHtml(b.bus_id)}
    ${isCollapsed ? "" : renderSeatMapHtml(preset.rows, occMap, { interactive: true, busId: b.bus_id })}
  </div>`;
}

// Render แถวไกด์ของรถคันนี้
function guidesRowHtml(busId) {
  const entries = state.busGuides[busId] || [];
  const pills = entries.map(entry => {
    const g = state.guides.find(x => x.guide_id === entry.guide_id);
    if (!g) return "";
    const lang = g.languages ? ` <span style="opacity:.7;font-weight:500">(${escapeHtml(g.languages)})</span>` : "";
    const seatTag = entry.seat_no
      ? ` <span style="background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:4px;font-size:10.5px;font-weight:700">💺 ${escapeHtml(entry.seat_no)}</span>`
      : ` <span style="color:#dc2626;font-size:10.5px;font-weight:600">⚠ ไม่มีที่นั่ง</span>`;
    return `<button class="ba-guide-pill" data-perm="trip_guides_edit"
      onclick="event.stopPropagation();window.openGuideEditModal(${g.guide_id})"
      title="คลิกเพื่อแก้ไข">
      🧑‍🏫 ${escapeHtml(g.full_name)}${lang}${seatTag}
    </button>`;
  }).join("");
  return `<div class="ba-bus-guides">
    <span class="ba-bus-guides-label">🧑‍🏫 ไกด์:</span>
    ${pills || '<span style="color:var(--text3);font-size:11.5px">— ยังไม่มี —</span>'}
    <button class="ba-bus-guides-add" data-perm="trip_guides_assign"
      onclick="event.stopPropagation();window.openBusGuidesModal(${busId})"
      title="จัดการไกด์ของคันนี้">＋ จัดการไกด์</button>
  </div>`;
}

function renderSeatMapHtml(rows, occMap, opts = {}) {
  const { interactive = true, busId = 0 } = opts;
  const guideSeats = state.busGuideSeats?.[busId] || {};
  const rowsHtml = rows.map(row => {
    const cellsHtml = row.map(cell => {
      if (cell === "AISLE") return `<div class="ba-aisle"></div>`;
      if (cell === "EMPTY") return `<div class="ba-seat-empty"></div>`;
      const seatNo = String(cell);
      // Guide seat (ก่อน passenger เพราะ guide ครองที่ของไกด์)
      const guideId = guideSeats[seatNo];
      if (guideId) {
        const g = state.guides.find(x => x.guide_id === guideId);
        const gname = g?.full_name || `Guide #${guideId}`;
        const lang = g?.languages ? ` (${g.languages})` : "";
        return `<div class="ba-seat ba-seat-guide taken" data-seat="${seatNo}"
          title="🧑‍🏫 ${escapeAttr(gname + lang)} · คลิกเพื่อดูรายละเอียด · กด × เพื่อย้ายออกจาก seat"
          ${interactive ? `onclick="event.stopPropagation();window.viewGuideSeat(${busId}, '${escapeJs(seatNo)}')"` : ""}>
          <span class="ba-seat-num">${seatNo}</span>
          <span class="ba-seat-name">🧑‍🏫 ${escapeHtml(shortName(gname))}</span>
          ${interactive ? `<button class="ba-seat-remove" title="ย้ายไกด์ออกจาก seat นี้"
            onclick="event.stopPropagation();window.clearGuideSeatFromMap(${busId}, ${guideId})">×</button>` : ""}
        </div>`;
      }
      const code = occMap[seatNo];
      const passenger = code ? state.passengers.find(p => p.code === code) : null;
      if (passenger) {
        const gNorm = normGender(passenger.gender || passenger._inheritedGender);
        const gCls = gNorm === "M" ? "taken-M" : (gNorm === "F" ? "taken-F" : "taken-U");
        const dname = passenger.name || passenger._inheritedName || code;
        return `<div class="ba-seat taken ${gCls}" data-seat="${seatNo}"
          title="${escapeAttr(dname + ' (' + code + ')')} · คลิกเพื่อดูรายละเอียด · กด × เพื่อย้ายออก"
          ${interactive ? `onclick="event.stopPropagation();window.confirmUnassignSeat(${busId}, '${escapeJs(seatNo)}')"` : ""}>
          <span class="ba-seat-num">${seatNo}</span>
          <span class="ba-seat-name">${escapeHtml(shortName(dname))}</span>
          ${interactive ? `<button class="ba-seat-remove" title="ย้ายออก"
            onclick="event.stopPropagation();window.unassignSeat(${busId}, '${escapeJs(seatNo)}')">×</button>` : ""}
        </div>`;
      }
      return `<div class="ba-seat" data-seat="${seatNo}"
        ${interactive ? `onclick="window.assignSeat(${busId}, '${escapeJs(seatNo)}')"` : ""}>
        <span class="ba-seat-num">${seatNo}</span>
        <span class="ba-seat-name" style="opacity:.4;font-weight:500">ว่าง</span>
      </div>`;
    }).join("");
    return `<div class="ba-seat-row">${cellsHtml}</div>`;
  }).join("");
  return `<div class="ba-seat-map">
    <div class="ba-seat-driver">
      <span>🚪 ประตู</span>
      <span style="font-size:11px;color:var(--text3)">— หน้ารถ —</span>
      <span>🪑 คนขับ</span>
    </div>
    <div class="ba-seat-rows">${rowsHtml}</div>
  </div>`;
}

function shortName(name) {
  if (!name) return "";
  const trimmed = String(name).trim();
  // seat กว้าง ~140px มี ellipsis อัตโนมัติจาก CSS — return เต็มก็ได้
  // (truncate ที่นี่กันชื่อยาวมาก เผื่อ tooltip)
  return trimmed.length > 24 ? trimmed.slice(0, 22) + "…" : trimmed;
}

// คลิกที่นั่งที่มีคนนั่ง → เปิด seat-detail modal (รายละเอียด + passport)
window.confirmUnassignSeat = function (busId, seatNo) {
  const code = (state.busOccupants[busId] || {})[seatNo];
  if (!code) return;
  const p = state.passengers.find(x => x.code === code);
  if (!p) return;
  const bus = state.buses.find(b => b.bus_id === busId);

  const dname = p.name || p._inheritedName || code;
  const dnat  = p.nationality || p._inheritedNat || "—";
  const gNorm = normGender(p.gender || p._inheritedGender);
  const gLbl  = gNorm === "M" ? "♂ ชาย" : (gNorm === "F" ? "♀ หญิง" : "—");
  const busLbl = bus ? (bus.bus_label || `คันที่ ${bus.bus_no || "?"}`) : `Bus ${busId}`;
  const groupName = p.group_name || "—";
  const passId = p.passport_id || "";

  // เก็บ target context ไว้ใช้ตอนกด "ย้ายออก"
  state.sdContext = { kind: "passenger", busId, seatNo, code };

  // Modal title + side label + buttons
  document.getElementById("sdModalTitle").textContent = "💺 รายละเอียดที่นั่ง";
  document.getElementById("sdSideLabel").textContent = "📷 Passport / Visa";
  document.getElementById("sdEditBtn").style.display = "none";
  document.getElementById("sdRemoveBtn").textContent = "🗑 ย้ายออกจากที่นั่ง";

  // หาห้องพักของคนนี้ทั้งหมด — เรียงตาม check-in
  const rids = state.codeToRooms[code];
  const myRooms = (rids ? [...rids] : [])
    .map(rid => state.rooms.find(r => r.room_id === rid))
    .filter(Boolean)
    .sort((a, b) => (a.check_in_date || "").localeCompare(b.check_in_date || ""));
  let roomsValueHtml = "";
  if (myRooms.length) {
    roomsValueHtml = myRooms.map(r => {
      const hotel = state.hotels.find(h => h.place_id === r.place_id);
      const hname = hotel?.place_name || (r.place_id ? `Place #${r.place_id}` : "ไม่ระบุ");
      const ci = r.check_in_date ? fmtDate(r.check_in_date) : "?";
      const co = r.check_out_date ? fmtDate(r.check_out_date) : "?";
      return `<div style="margin-bottom:3px">🏨 ${escapeHtml(hname)} · <b>${escapeHtml(r.room_name || "—")}</b><br><span style="font-size:11px;color:var(--text2);font-weight:400">${ci} → ${co}</span></div>`;
    }).join("");
  } else {
    roomsValueHtml = `<span style="color:var(--text3);font-weight:400">— ยังไม่มีห้อง —</span>`;
  }

  // Info column
  document.getElementById("sdName").textContent = dname;
  const grid = document.getElementById("sdGrid");
  // text rows + ห้องพัก (HTML — render manually)
  const textRows = [
    ["รหัส",   code],
    ["กลุ่ม",  groupName],
    ["เพศ",    gLbl],
    ["สัญชาติ", dnat],
    passId ? ["Passport", passId] : null,
    ["รถ",     busLbl],
    ["ที่นั่ง",  seatNo],
  ].filter(Boolean).map(([k, v]) =>
    `<div class="sd-info-row">
       <span class="sd-info-k">${escapeHtml(k)}</span>
       <span class="sd-info-v">${escapeHtml(String(v))}</span>
     </div>`
  ).join("");
  const roomsRow = `<div class="sd-info-row" style="align-items:flex-start">
    <span class="sd-info-k">🛏 ห้องพัก</span>
    <span class="sd-info-v" style="text-align:right">${roomsValueHtml}</span>
  </div>`;
  grid.innerHTML = textRows + roomsRow;

  // Passport column — passport_image_url + visa_image_url
  const pass = p.passport_image_url || p._inheritedPassImg || null;
  const visa = p.visa_image_url     || p._inheritedVisaImg || null;
  const imgsEl = document.getElementById("sdImgs");
  const imgs = [
    pass ? { src: pass, label: "Passport" } : null,
    visa ? { src: visa, label: "Visa" } : null,
  ].filter(Boolean);
  if (!imgs.length) {
    imgsEl.innerHTML = `<div class="sd-no-img">ไม่มีรูป passport / visa</div>`;
  } else {
    imgsEl.innerHTML = imgs.map((img, i) => `
      <div>
        <img src="${escapeAttr(img.src)}" alt="${img.label}"
          onclick="window.viewPaxPassport('${escapeJs(code)}')"
          onerror="this.style.display='none';this.nextElementSibling.textContent='⚠ โหลดรูปไม่ได้'" />
        <div class="sd-img-caption">${img.label} — คลิกเพื่อขยาย</div>
      </div>
    `).join("");
  }

  document.getElementById("seatDetailOverlay").classList.add("open");
};

window.closeSeatDetail = function (e) {
  if (e && e.target.id !== "seatDetailOverlay") return;
  document.getElementById("seatDetailOverlay")?.classList.remove("open");
  state.sdContext = null;
};

window.doUnassignSeat = function () {
  const ctx = state.sdContext;
  if (!ctx) { window.closeSeatDetail(); return; }
  window.closeSeatDetail();
  if (ctx.kind === "guide") {
    // clear seat ของไกด์ (ไกด์ยังประจำคันรถอยู่ แค่ไม่มี seat)
    clearGuideSeatById(ctx.busId, ctx.guideId);
  } else {
    window.unassignSeat(ctx.busId, ctx.seatNo);
  }
};

// ปุ่ม "✏️ แก้ไขข้อมูล" — เปิด guide edit modal
window.doEditFromSeat = function () {
  const ctx = state.sdContext;
  if (!ctx || ctx.kind !== "guide") { window.closeSeatDetail(); return; }
  window.closeSeatDetail();
  window.openGuideEditModal(ctx.guideId);
};

// คลิก guide seat → เปิด seat-detail modal (info + contact)
window.viewGuideSeat = function (busId, seatNo) {
  const guideId = (state.busGuideSeats[busId] || {})[seatNo];
  if (!guideId) return;
  const g = state.guides.find(x => x.guide_id === guideId);
  if (!g) return;
  const bus = state.buses.find(b => b.bus_id === busId);
  const busLbl = bus ? (bus.bus_label || `คันที่ ${bus.bus_no || "?"}`) : `Bus ${busId}`;

  state.sdContext = { kind: "guide", busId, seatNo, guideId };

  // Modal title + side label + buttons
  document.getElementById("sdModalTitle").textContent = "🧑‍🏫 รายละเอียดไกด์";
  document.getElementById("sdSideLabel").textContent = "📞 ติดต่อ";
  document.getElementById("sdEditBtn").style.display = "";
  document.getElementById("sdRemoveBtn").textContent = "💺 ย้ายออกจากที่นั่ง";

  // Info column (ซ้าย)
  document.getElementById("sdName").textContent = g.full_name;
  const grid = document.getElementById("sdGrid");
  grid.innerHTML = [
    g.languages ? ["ภาษา", g.languages] : null,
    ["รถ",      busLbl],
    ["ที่นั่ง",  seatNo],
    g.note ? ["หมายเหตุ", g.note] : null,
  ].filter(Boolean).map(([k, v]) =>
    `<div class="sd-info-row">
       <span class="sd-info-k">${escapeHtml(k)}</span>
       <span class="sd-info-v">${escapeHtml(String(v))}</span>
     </div>`
  ).join("");

  // Contact column (ขวา) — แทน passport
  const contacts = [
    g.phone    ? { icon: "📞", label: "เบอร์โทร",   value: g.phone,    href: `tel:${g.phone}` } : null,
    g.line_id  ? { icon: "💬", label: "Line ID",    value: g.line_id,  href: null } : null,
    g.whatsapp ? { icon: "📱", label: "WhatsApp",   value: g.whatsapp, href: `https://wa.me/${String(g.whatsapp).replace(/[^\d]/g, "")}` } : null,
  ].filter(Boolean);
  const imgsEl = document.getElementById("sdImgs");
  if (!contacts.length) {
    imgsEl.innerHTML = `<div class="sd-no-img">ไม่มีข้อมูลติดต่อ</div>`;
  } else {
    imgsEl.innerHTML = contacts.map(c => {
      const valHtml = c.href
        ? `<a href="${escapeAttr(c.href)}" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none;font-weight:600">${escapeHtml(c.value)}</a>`
        : `<span style="font-weight:600;color:var(--text)">${escapeHtml(c.value)}</span>`;
      return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#f8fafc;border:1px solid var(--border);border-radius:8px">
        <span style="font-size:18px;flex-shrink:0">${c.icon}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:10.5px;color:var(--text2);text-transform:uppercase;letter-spacing:.3px">${c.label}</div>
          <div style="font-size:13.5px;margin-top:2px;word-break:break-all">${valHtml}</div>
        </div>
      </div>`;
    }).join("");
  }

  document.getElementById("seatDetailOverlay").classList.add("open");
};

// คลิก × ที่มุม guide seat → ล้าง seat ตรงๆ
window.clearGuideSeatFromMap = function (busId, guideId) {
  clearGuideSeatById(busId, guideId);
};

// ── helper: ล้าง seat_no ของไกด์ (ไกด์ยัง assign คันอยู่)
async function clearGuideSeatById(busId, guideId) {
  const entries = state.busGuides[busId] || [];
  const entry = entries.find(e => e.guide_id === guideId);
  if (!entry) return;
  const oldSeat = entry.seat_no;
  if (!oldSeat) return;

  // Optimistic
  entry.seat_no = null;
  if (state.busGuideSeats[busId]) delete state.busGuideSeats[busId][oldSeat];
  renderBuses();

  try {
    await sbFetch("trip_bus_guides",
      `?bus_id=eq.${busId}&guide_id=eq.${guideId}`,
      { method: "PATCH", body: { seat_no: null } });
    showToast("ย้ายไกด์ออกจากที่นั่งแล้ว", "success");
  } catch (e) {
    // revert
    entry.seat_no = oldSeat;
    if (!state.busGuideSeats[busId]) state.busGuideSeats[busId] = {};
    state.busGuideSeats[busId][oldSeat] = guideId;
    renderBuses();
    showToast("ย้ายออกไม่สำเร็จ: " + e.message, "error");
  }
}

function updateSeatAssignableState() {
  document.querySelectorAll(".ba-seat").forEach(el => {
    if (el.classList.contains("taken")) { el.classList.remove("assignable"); return; }
    el.classList.toggle("assignable", !!state.selectedPaxCode);
  });
}

// ── ASSIGN / UNASSIGN SEAT ─────────────────────────────────
window.assignSeat = async function (busId, seatNo) {
  if (!state.selectedPaxCode) {
    showToast("เลือกลูกค้าทางซ้ายก่อน", "info");
    return;
  }
  const bus = state.buses.find(b => b.bus_id === busId);
  if (!bus) return;
  const code = state.selectedPaxCode;
  const p = state.passengers.find(x => x.code === code);
  if (!p) return;

  if ((state.busOccupants[busId] || {})[seatNo]) {
    showToast(`ที่นั่ง ${seatNo} มีคนแล้ว — กดที่นั่งนั้นเพื่อย้ายออกก่อน`, "error");
    return;
  }
  // Block ถ้า seat ถูก guide ครอง
  if ((state.busGuideSeats[busId] || {})[seatNo]) {
    showToast(`ที่นั่ง ${seatNo} เป็นที่นั่งไกด์ — เลือกที่นั่งอื่น`, "error");
    return;
  }

  const existing = state.codeToBusSeat[code];

  // Optimistic
  if (existing) delete (state.busOccupants[existing.bus_id] || {})[existing.seat_no];
  if (!state.busOccupants[busId]) state.busOccupants[busId] = {};
  state.busOccupants[busId][seatNo] = code;
  state.codeToBusSeat[code] = { bus_id: busId, seat_no: seatNo };
  state.selectedPaxCode = null;
  renderStats();
  renderPassengers();
  renderBuses();
  updateSelectionHint();

  try {
    if (existing) {
      await sbFetch("trip_bus_occupants",
        `?bus_id=eq.${existing.bus_id}&seat_no=eq.${encodeURIComponent(existing.seat_no)}`,
        { method: "DELETE" });
    }
    await sbFetch("trip_bus_occupants", "", {
      method: "POST",
      body: { bus_id: busId, seat_no: seatNo, code },
    });
    const oldBus = existing ? state.buses.find(b => b.bus_id === existing.bus_id) : null;
    const verb = oldBus
      ? `ย้ายจาก ${oldBus.bus_label || `คันที่ ${oldBus.bus_no}`} ที่ ${existing.seat_no} → ${bus.bus_label || `คันที่ ${bus.bus_no}`} ที่ ${seatNo}`
      : `→ ${bus.bus_label || `คันที่ ${bus.bus_no}`} ที่นั่ง ${seatNo}`;
    showToast(`✅ ${p.name || code} ${verb}`, "success");
  } catch (e) {
    delete (state.busOccupants[busId] || {})[seatNo];
    if (existing) {
      if (!state.busOccupants[existing.bus_id]) state.busOccupants[existing.bus_id] = {};
      state.busOccupants[existing.bus_id][existing.seat_no] = code;
      state.codeToBusSeat[code] = existing;
    } else delete state.codeToBusSeat[code];
    renderStats(); renderPassengers(); renderBuses();
    showToast("Assign ไม่สำเร็จ: " + e.message, "error");
  }
};

window.unassignSeat = async function (busId, seatNo) {
  const code = (state.busOccupants[busId] || {})[seatNo];
  if (!code) return;
  const p = state.passengers.find(x => x.code === code);

  delete state.busOccupants[busId][seatNo];
  delete state.codeToBusSeat[code];
  renderStats(); renderPassengers(); renderBuses();

  try {
    await sbFetch("trip_bus_occupants",
      `?bus_id=eq.${busId}&seat_no=eq.${encodeURIComponent(seatNo)}`,
      { method: "DELETE" });
    showToast(`ย้ายออกจากที่นั่ง ${seatNo}: ${p?.name || code}`, "success");
  } catch (e) {
    if (!state.busOccupants[busId]) state.busOccupants[busId] = {};
    state.busOccupants[busId][seatNo] = code;
    state.codeToBusSeat[code] = { bus_id: busId, seat_no: seatNo };
    renderStats(); renderPassengers(); renderBuses();
    showToast("ย้ายออกไม่สำเร็จ: " + e.message, "error");
  }
};

// ── BUS CRUD ───────────────────────────────────────────────
window.openBusModal = function () {
  if (!document.getElementById("fBusPreset")?.options?.length) {
    populateBusPresetDropdown();
  }
  state.editingBusId = null;
  document.getElementById("busModalTitle").textContent = "เพิ่มรถบัส";
  document.getElementById("busSaveBtn").innerHTML = "💾 บันทึก";
  document.getElementById("fBusNo").value = (state.buses.length || 0) + 1;
  document.getElementById("fBusLabel").value = "";
  document.getElementById("fBusPreset").value = "BUS_45_2_2";
  document.getElementById("fBusVendor").value = "";
  document.getElementById("fBusPlate").value = "";
  document.getElementById("fBusDriver").value = "";
  document.getElementById("fBusDriverPhone").value = "";
  document.getElementById("fBusNote").value = "";
  window.onBusPresetChange();
  document.getElementById("busOverlay").classList.add("open");
  setTimeout(() => document.getElementById("fBusNo")?.focus(), 50);
};

window.closeBusModal = function (e) {
  if (e && e.target.id !== "busOverlay") return;
  document.getElementById("busOverlay").classList.remove("open");
  state.editingBusId = null;
};

window.editBus = function (busId) {
  if (!document.getElementById("fBusPreset")?.options?.length) {
    populateBusPresetDropdown();
  }
  const b = state.buses.find(x => x.bus_id === busId);
  if (!b) return;
  state.editingBusId = busId;
  document.getElementById("busModalTitle").textContent = "แก้ไขรถบัส";
  document.getElementById("busSaveBtn").innerHTML = "💾 บันทึกการแก้ไข";
  document.getElementById("fBusNo").value = b.bus_no || 1;
  document.getElementById("fBusLabel").value = b.bus_label || "";
  document.getElementById("fBusPreset").value = b.layout_preset || "BUS_45_2_2";
  document.getElementById("fBusVendor").value = b.vendor || "";
  document.getElementById("fBusPlate").value = b.plate || "";
  document.getElementById("fBusDriver").value = b.driver_name || "";
  document.getElementById("fBusDriverPhone").value = b.driver_phone || "";
  document.getElementById("fBusNote").value = b.note || "";
  window.onBusPresetChange();
  document.getElementById("busOverlay").classList.add("open");
};

window.saveBus = async function () {
  const busNo = parseInt(document.getElementById("fBusNo").value, 10);
  if (!Number.isFinite(busNo) || busNo < 1) {
    showToast("กรอกหมายเลขคัน (≥ 1)", "error");
    return;
  }
  const presetKey = document.getElementById("fBusPreset").value || "BUS_45_2_2";
  const preset = BUS_PRESETS[presetKey];
  if (!preset) { showToast("เลือก layout ที่ถูกต้อง", "error"); return; }

  const payload = {
    trip_id: state.tripId,
    bus_no: busNo,
    bus_label: document.getElementById("fBusLabel").value.trim() || null,
    layout_preset: presetKey,
    capacity: preset.capacity,
    vendor: document.getElementById("fBusVendor").value.trim() || null,
    plate: document.getElementById("fBusPlate").value.trim() || null,
    driver_name: document.getElementById("fBusDriver").value.trim() || null,
    driver_phone: document.getElementById("fBusDriverPhone").value.trim() || null,
    note: document.getElementById("fBusNote").value.trim() || null,
    updated_at: new Date().toISOString(),
  };

  showLoading(true);
  try {
    if (state.editingBusId) {
      // ที่นั่งที่ใช้อยู่อาจหายเมื่อเปลี่ยน layout — เตือน
      const oldBus = state.buses.find(b => b.bus_id === state.editingBusId);
      const occMap = state.busOccupants[state.editingBusId] || {};
      const occCount = Object.keys(occMap).length;
      if (oldBus && oldBus.layout_preset !== presetKey && occCount > 0) {
        const newSeats = new Set();
        preset.rows.forEach(row => row.forEach(c => { if (typeof c === "number") newSeats.add(String(c)); }));
        const lost = Object.keys(occMap).filter(s => !newSeats.has(s));
        if (lost.length) {
          const msg = `เปลี่ยน layout จะทำให้ที่นั่ง ${lost.join(", ")} (${lost.length} คน) ถูกย้ายออก — ดำเนินการต่อ?`;
          showLoading(false);
          const ok = window.ConfirmModal?.open
            ? await window.ConfirmModal.open({
                title: "เปลี่ยน layout",
                message: msg,
                icon: "⚠️",
                tone: "warning",
                okText: "ดำเนินการต่อ",
              })
            : confirm(msg);
          if (!ok) return;
          showLoading(true);
          await sbFetch("trip_bus_occupants",
            `?bus_id=eq.${state.editingBusId}&seat_no=in.(${lost.map(s => encodeURIComponent(s)).join(",")})`,
            { method: "DELETE" });
        }
      }
      await sbFetch("trip_buses", `?bus_id=eq.${state.editingBusId}`, { method: "PATCH", body: payload });
      showToast("แก้ไขรถแล้ว", "success");
    } else {
      payload.sort_order = state.buses.length;
      await sbFetch("trip_buses", "", { method: "POST", body: payload });
      showToast("เพิ่มรถแล้ว", "success");
    }
    document.getElementById("busOverlay").classList.remove("open");
    state.editingBusId = null;
    await loadAll();
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

window.deleteBus = async function (busId) {
  const b = state.buses.find(x => x.bus_id === busId);
  if (!b) return;
  const occCount = Object.keys(state.busOccupants[busId] || {}).length;
  const msg = occCount > 0
    ? `ลบรถ ${b.bus_label || `คันที่ ${b.bus_no}`} — มีคน ${occCount} คนนั่งอยู่ ผู้โดยสารจะถูกย้ายออกอัตโนมัติ`
    : `ลบรถ ${b.bus_label || `คันที่ ${b.bus_no}`}?`;

  // DeleteModal ใช้ (msg, callback) ส่วน ConfirmModal ใช้ object → ลอง DeleteModal ก่อน
  if (window.DeleteModal?.open) {
    window.DeleteModal.open(msg, async () => {
      showLoading(true);
      try {
        await sbFetch("trip_buses", `?bus_id=eq.${busId}`, { method: "DELETE" });
        showToast("ลบรถแล้ว", "success");
        await loadAll();
      } catch (e) {
        showToast("ลบไม่สำเร็จ: " + e.message, "error");
      }
      showLoading(false);
    });
    return;
  }
  const ok = window.ConfirmModal?.open
    ? await window.ConfirmModal.open({
        title: "ลบรถบัส",
        message: msg,
        icon: "🗑",
        tone: "danger",
        okText: "ลบ",
      })
    : confirm(msg);
  if (!ok) return;
  showLoading(true);
  try {
    await sbFetch("trip_buses", `?bus_id=eq.${busId}`, { method: "DELETE" });
    showToast("ลบรถแล้ว", "success");
    await loadAll();
  } catch (e) {
    showToast("ลบไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

window.clearBus = async function (busId) {
  const b = state.buses.find(x => x.bus_id === busId);
  if (!b) return;
  const occCount = Object.keys(state.busOccupants[busId] || {}).length;
  if (occCount === 0) { showToast("รถคันนี้ยังไม่มีคนนั่ง", "info"); return; }
  const ok = window.ConfirmModal?.open
    ? await window.ConfirmModal.open({
        title: "ล้างทุกที่นั่ง",
        message: `ล้างทุกที่นั่งของรถ ${b.bus_label || `คันที่ ${b.bus_no}`} (${occCount} คน)?`,
        icon: "🧹",
        tone: "warning",
        okText: "ล้าง",
      })
    : confirm(`ล้างทุกที่นั่งของรถ ${b.bus_label || `คันที่ ${b.bus_no}`} (${occCount} คน)?`);
  if (!ok) return;
  showLoading(true);
  try {
    await sbFetch("trip_bus_occupants", `?bus_id=eq.${busId}`, { method: "DELETE" });
    showToast(`ล้างที่นั่งของรถแล้ว (${occCount} คน)`, "success");
    await loadAll();
  } catch (e) { showToast("ล้างไม่สำเร็จ: " + e.message, "error"); }
  showLoading(false);
};

window.toggleBusCollapse = function (busId) {
  if (state.collapsedBuses.has(busId)) state.collapsedBuses.delete(busId);
  else state.collapsedBuses.add(busId);
  renderBuses();
};

window.closeBusKebabs = function () {
  document.querySelectorAll(".ba-bus-kebab-wrap.open").forEach(el => el.classList.remove("open"));
};
window.toggleBusKebab = function (busId, ev) {
  ev.stopPropagation();
  const wrap = document.querySelector(`.ba-bus-kebab-wrap[data-bus="${busId}"]`);
  if (!wrap) return;
  const isOpen = wrap.classList.contains("open");
  window.closeBusKebabs();
  if (!isOpen) wrap.classList.add("open");
};
document.addEventListener("click", (ev) => {
  if (!ev.target.closest(".ba-bus-kebab-wrap")) window.closeBusKebabs();
});

// ── AUTO-FILL ──────────────────────────────────────────────
window.autoFillBus = async function (busId) {
  const bus = state.buses.find(b => b.bus_id === busId);
  if (!bus) return;
  const preset = BUS_PRESETS[bus.layout_preset] || BUS_PRESETS.BUS_45_2_2;
  const occMap = state.busOccupants[busId] || {};
  const emptySeats = [];
  preset.rows.forEach(row => row.forEach(c => {
    if (typeof c === "number") {
      const s = String(c);
      if (!occMap[s]) emptySeats.push(s);
    }
  }));
  if (!emptySeats.length) { showToast("รถคันนี้เต็มแล้ว", "info"); return; }
  const candidates = state.passengers
    .filter(p => !state.codeToBusSeat[p.code])
    .slice()
    .sort((a, b) => {
      const ga = a.group_name || "";
      const gb = b.group_name || "";
      if (ga !== gb) return ga.localeCompare(gb);
      return (a.name || "").localeCompare(b.name || "");
    });
  if (!candidates.length) { showToast("ไม่มีคนที่ยังต้องจัดที่นั่ง", "info"); return; }
  const n = Math.min(emptySeats.length, candidates.length);
  const msg = `เติมคน ${n} คนลงรถ ${bus.bus_label || `คันที่ ${bus.bus_no}`} ที่ที่นั่งว่างถัดไป?`;
  const ok = window.ConfirmModal?.open
    ? await window.ConfirmModal.open({
        title: "เติมที่นั่งอัตโนมัติ",
        message: msg,
        icon: "⚡",
        tone: "primary",
        okText: "เติม",
      })
    : confirm(msg);
  if (!ok) return;
  showLoading(true);
  try {
    const payload = [];
    for (let i = 0; i < n; i++) {
      payload.push({ bus_id: busId, seat_no: emptySeats[i], code: candidates[i].code });
    }
    await sbFetch("trip_bus_occupants", "", { method: "POST", body: payload });
    showToast(`เติม ${n} คนลงที่นั่งแล้ว`, "success");
    await loadAll();
  } catch (e) { showToast("เติมที่นั่งไม่สำเร็จ: " + e.message, "error"); }
  showLoading(false);
};

// ── SYNC FROM ROOMS: นั่งติดกันตามคู่ห้องพัก ─────────────────
// ใช้ state.occupants (rooms ↔ codes) ที่มีอยู่แล้วใน room-assign — ไม่ต้องโหลดเพิ่ม
window.syncBusFromRooms = async function () {
  if (!state.buses.length) { showToast("เพิ่มรถบัสก่อน", "error"); return; }
  if (!Object.keys(state.occupants).length) {
    showToast("ทริปนี้ยังไม่มีคู่ห้องพัก — จัดห้องด้านบนก่อน", "error");
    return;
  }
  // เก็บคนตามห้อง (เฉพาะคนที่ยังไม่มีที่นั่ง)
  const pairs = [];
  Object.keys(state.occupants).forEach(rid => {
    const codes = (state.occupants[rid] || []).filter(c => !state.codeToBusSeat[c]);
    if (codes.length >= 1) pairs.push(codes);
  });
  if (!pairs.length) { showToast("ทุกคู่ห้องถูกจัดที่นั่งครบแล้ว", "info"); return; }

  // ที่นั่งคู่ติดกันในรถแต่ละคัน
  const adjacentPairs = [];
  state.buses.forEach(bus => {
    const preset = BUS_PRESETS[bus.layout_preset] || BUS_PRESETS.BUS_45_2_2;
    const occMap = state.busOccupants[bus.bus_id] || {};
    preset.rows.forEach(row => {
      const segments = []; let seg = [];
      row.forEach(c => {
        if (c === "AISLE") { if (seg.length) segments.push(seg); seg = []; }
        else if (typeof c === "number") seg.push(String(c));
        else { if (seg.length) segments.push(seg); seg = []; }
      });
      if (seg.length) segments.push(seg);
      segments.forEach(s => {
        for (let i = 0; i < s.length - 1; i++) {
          if (!occMap[s[i]] && !occMap[s[i + 1]]) {
            adjacentPairs.push({ bus_id: bus.bus_id, seats: [s[i], s[i + 1]] });
            i++;
          }
        }
      });
    });
  });
  const singleSeats = [];
  state.buses.forEach(bus => {
    const preset = BUS_PRESETS[bus.layout_preset] || BUS_PRESETS.BUS_45_2_2;
    const occMap = state.busOccupants[bus.bus_id] || {};
    preset.rows.forEach(row => row.forEach(c => {
      if (typeof c === "number" && !occMap[String(c)]) {
        singleSeats.push({ bus_id: bus.bus_id, seat: String(c) });
      }
    }));
  });

  const plan = [];
  const usedPairs = new Set();
  const usedSingles = new Set();
  const seatTaken = (b, s) => plan.some(x => x.bus_id === b && x.seat_no === s);
  pairs.forEach(group => {
    if (group.length >= 2) {
      for (let i = 0; i < group.length - 1; i += 2) {
        const pairIdx = adjacentPairs.findIndex((p, idx) =>
          !usedPairs.has(idx) && !seatTaken(p.bus_id, p.seats[0]) && !seatTaken(p.bus_id, p.seats[1]));
        if (pairIdx >= 0) {
          usedPairs.add(pairIdx);
          const pair = adjacentPairs[pairIdx];
          plan.push({ bus_id: pair.bus_id, seat_no: pair.seats[0], code: group[i] });
          plan.push({ bus_id: pair.bus_id, seat_no: pair.seats[1], code: group[i + 1] });
        } else {
          [group[i], group[i + 1]].forEach(code => {
            const sIdx = singleSeats.findIndex((s, si) => !usedSingles.has(si) && !seatTaken(s.bus_id, s.seat));
            if (sIdx >= 0) {
              usedSingles.add(sIdx);
              const slot = singleSeats[sIdx];
              plan.push({ bus_id: slot.bus_id, seat_no: slot.seat, code });
            }
          });
        }
      }
      if (group.length % 2 === 1) {
        const code = group[group.length - 1];
        const sIdx = singleSeats.findIndex((s, si) => !usedSingles.has(si) && !seatTaken(s.bus_id, s.seat));
        if (sIdx >= 0) {
          usedSingles.add(sIdx);
          const slot = singleSeats[sIdx];
          plan.push({ bus_id: slot.bus_id, seat_no: slot.seat, code });
        }
      }
    } else if (group.length === 1) {
      const code = group[0];
      const sIdx = singleSeats.findIndex((s, si) => !usedSingles.has(si) && !seatTaken(s.bus_id, s.seat));
      if (sIdx >= 0) {
        usedSingles.add(sIdx);
        const slot = singleSeats[sIdx];
        plan.push({ bus_id: slot.bus_id, seat_no: slot.seat, code });
      }
    }
  });

  if (!plan.length) { showToast("ที่นั่งว่างไม่พอ", "error"); return; }
  const placed = plan.length;
  const totalNeeded = pairs.reduce((a, g) => a + g.length, 0);
  const remaining = totalNeeded - placed;

  const ok = window.ConfirmModal?.open
    ? await window.ConfirmModal.open({
        title: "จัดที่นั่งตามคู่ห้องพัก",
        message: `จะจัด ${placed}/${totalNeeded} คนตามคู่ห้องพัก — ดำเนินการต่อ?`,
        icon: "🔗",
        tone: "primary",
        okText: "จัดที่นั่ง",
        note: remaining > 0
          ? `⚠️ เหลือ ${remaining} คนที่หาที่นั่งไม่ได้ (ที่นั่งว่างไม่พอ)`
          : null,
        noteTone: remaining > 0 ? "warning" : "",
      })
    : confirm(`จะจัด ${placed}/${totalNeeded} คนตามคู่ห้องพัก — ดำเนินการต่อ?`);
  if (!ok) return;

  showLoading(true);
  try {
    await sbFetch("trip_bus_occupants", "", { method: "POST", body: plan });
    showToast(`จัดที่นั่งตามคู่ห้องพักแล้ว ${placed} คน`, "success");
    await loadAll();
  } catch (e) { showToast("Sync ไม่สำเร็จ: " + e.message, "error"); }
  showLoading(false);
};

// ════════════════════════════════════════════════════════════
//  GUIDE LOGIC
// ════════════════════════════════════════════════════════════

// เปิด modal "จัดการไกด์ของรถคันนี้" — list ไกด์ใน trip + checkbox toggle
window.openBusGuidesModal = function (busId) {
  state.guideTargetBusId = busId;
  const bus = state.buses.find(b => b.bus_id === busId);
  document.getElementById("bgmTitle").textContent =
    `🧑‍🏫 ไกด์ของ ${bus ? (bus.bus_label || `คันที่ ${bus.bus_no}`) : "รถบัส"}`;
  renderBusGuidesList();
  document.getElementById("busGuidesOverlay").classList.add("open");
};

window.closeBusGuidesModal = function (e) {
  if (e && e.target.id !== "busGuidesOverlay") return;
  document.getElementById("busGuidesOverlay").classList.remove("open");
  state.guideTargetBusId = null;
};

function renderBusGuidesList() {
  const busId = state.guideTargetBusId;
  const list = document.getElementById("bgmList");
  if (!list) return;
  if (!state.guides.length) {
    list.innerHTML = `<div style="padding:14px;color:var(--text3);text-align:center;font-size:13px">
      ยังไม่มีไกด์ใน trip นี้ — กด "+ สร้างไกด์ใหม่" เพื่อเพิ่ม
    </div>`;
    return;
  }
  const entries = state.busGuides[busId] || [];
  const seatByGuide = {};
  entries.forEach(e => { seatByGuide[e.guide_id] = e.seat_no || null; });
  const assignedSet = new Set(entries.map(e => e.guide_id));

  // หา seat ที่ว่าง (ทั้ง passenger + guide ของรถคันนี้)
  const bus = state.buses.find(b => b.bus_id === busId);
  const preset = BUS_PRESETS[bus?.layout_preset] || BUS_PRESETS.BUS_45_2_2;
  const occMap = state.busOccupants[busId] || {};
  const guideSeats = state.busGuideSeats[busId] || {};
  const availableSeats = [];
  preset.rows.forEach(row => row.forEach(c => {
    if (typeof c === "number") {
      const s = String(c);
      if (!occMap[s] && !guideSeats[s]) availableSeats.push(s);
    }
  }));

  list.innerHTML = state.guides.map(g => {
    const checked = assignedSet.has(g.guide_id);
    const currentSeat = seatByGuide[g.guide_id];
    const lang = g.languages ? `<span class="bgm-row-lang">(${escapeHtml(g.languages)})</span>` : "";

    // dropdown seat — ที่ว่าง + seat ปัจจุบันของไกด์นี้
    let seatPicker = "";
    if (checked) {
      const opts = [`<option value="">— ยังไม่เลือก —</option>`];
      // เพิ่ม current ถ้ามี (เผื่อไม่อยู่ใน availableSeats เพราะถูกตัวเองครอง)
      if (currentSeat && !availableSeats.includes(currentSeat)) {
        opts.push(`<option value="${escapeAttr(currentSeat)}" selected>💺 ${escapeHtml(currentSeat)} (ปัจจุบัน)</option>`);
      }
      // sort numeric
      const sortedAvail = [...availableSeats].sort((a, b) => Number(a) - Number(b));
      sortedAvail.forEach(s => {
        const sel = s === currentSeat ? " selected" : "";
        opts.push(`<option value="${escapeAttr(s)}"${sel}>💺 ${escapeHtml(s)}</option>`);
      });
      seatPicker = `<select class="bgm-seat-select"
        onclick="event.stopPropagation()"
        onchange="event.stopPropagation();window.setGuideSeat(${g.guide_id}, this.value)">
        ${opts.join("")}
      </select>`;
    }

    return `<div class="bgm-row${checked ? " checked" : ""}"
      onclick="window.toggleGuideForBus(${g.guide_id})">
      <span class="bgm-row-check">${checked ? "✓" : ""}</span>
      <span class="bgm-row-name">${escapeHtml(g.full_name)}</span>
      ${lang}
      ${seatPicker}
      <button class="bgm-row-edit" title="แก้ไขข้อมูลไกด์"
        onclick="event.stopPropagation();window.openGuideEditModal(${g.guide_id})">✏️</button>
    </div>`;
  }).join("");
}

window.toggleGuideForBus = async function (guideId) {
  const busId = state.guideTargetBusId;
  if (!busId) return;
  const entries = state.busGuides[busId] || [];
  const existing = entries.find(e => e.guide_id === guideId);

  if (existing) {
    // unassign — ลบทั้ง guide + seat (ถ้ามี)
    state.busGuides[busId] = entries.filter(e => e.guide_id !== guideId);
    if (state.guideToBuses[guideId]) state.guideToBuses[guideId].delete(busId);
    if (existing.seat_no && state.busGuideSeats[busId]) {
      delete state.busGuideSeats[busId][existing.seat_no];
    }
  } else {
    // assign — เพิ่ม guide เปล่า (ยังไม่มี seat)
    state.busGuides[busId] = [...entries, { guide_id: guideId, seat_no: null }];
    if (!state.guideToBuses[guideId]) state.guideToBuses[guideId] = new Set();
    state.guideToBuses[guideId].add(busId);
  }
  renderBusGuidesList();
  renderBuses();

  try {
    if (existing) {
      await sbFetch("trip_bus_guides",
        `?bus_id=eq.${busId}&guide_id=eq.${guideId}`,
        { method: "DELETE" });
    } else {
      await sbFetch("trip_bus_guides", "", {
        method: "POST",
        body: { bus_id: busId, guide_id: guideId, seat_no: null },
      });
    }
  } catch (e) {
    // revert
    if (existing) {
      state.busGuides[busId] = [...(state.busGuides[busId] || []), existing];
      if (!state.guideToBuses[guideId]) state.guideToBuses[guideId] = new Set();
      state.guideToBuses[guideId].add(busId);
      if (existing.seat_no) {
        if (!state.busGuideSeats[busId]) state.busGuideSeats[busId] = {};
        state.busGuideSeats[busId][existing.seat_no] = guideId;
      }
    } else {
      state.busGuides[busId] = (state.busGuides[busId] || []).filter(e => e.guide_id !== guideId);
      if (state.guideToBuses[guideId]) state.guideToBuses[guideId].delete(busId);
    }
    renderBusGuidesList();
    renderBuses();
    showToast("ไม่สำเร็จ: " + e.message, "error");
  }
};

// เลือก seat ให้ไกด์ (หรือเปลี่ยน seat / เคลียร์)
window.setGuideSeat = async function (guideId, newSeat) {
  const busId = state.guideTargetBusId;
  if (!busId) return;
  const entries = state.busGuides[busId] || [];
  const entry = entries.find(e => e.guide_id === guideId);
  if (!entry) return;
  const oldSeat = entry.seat_no;
  const seatVal = newSeat || null;
  if (oldSeat === seatVal) return;

  // เช็คว่า seat ใหม่ถูกครองหรือยัง (passenger หรือ guide คนอื่น)
  if (seatVal) {
    if ((state.busOccupants[busId] || {})[seatVal]) {
      showToast(`ที่นั่ง ${seatVal} มีลูกค้านั่งอยู่`, "error");
      renderBusGuidesList();
      return;
    }
    const otherGuide = (state.busGuideSeats[busId] || {})[seatVal];
    if (otherGuide && otherGuide !== guideId) {
      showToast(`ที่นั่ง ${seatVal} เป็นที่นั่งของไกด์ท่านอื่น`, "error");
      renderBusGuidesList();
      return;
    }
  }

  // Optimistic update
  entry.seat_no = seatVal;
  if (oldSeat && state.busGuideSeats[busId]) delete state.busGuideSeats[busId][oldSeat];
  if (seatVal) {
    if (!state.busGuideSeats[busId]) state.busGuideSeats[busId] = {};
    state.busGuideSeats[busId][seatVal] = guideId;
  }
  renderBusGuidesList();
  renderBuses();

  try {
    await sbFetch("trip_bus_guides",
      `?bus_id=eq.${busId}&guide_id=eq.${guideId}`,
      { method: "PATCH", body: { seat_no: seatVal } });
    showToast(seatVal ? `จัดที่นั่ง ${seatVal} ให้ไกด์แล้ว` : "เคลียร์ที่นั่งไกด์แล้ว", "success");
  } catch (e) {
    // revert
    entry.seat_no = oldSeat;
    if (seatVal && state.busGuideSeats[busId]) delete state.busGuideSeats[busId][seatVal];
    if (oldSeat) {
      if (!state.busGuideSeats[busId]) state.busGuideSeats[busId] = {};
      state.busGuideSeats[busId][oldSeat] = guideId;
    }
    renderBusGuidesList();
    renderBuses();
    showToast("เปลี่ยน seat ไม่สำเร็จ: " + e.message, "error");
  }
};

// เปิด modal สร้าง/แก้ไขไกด์
window.openGuideEditModal = function (guideId) {
  state.editingGuideId = guideId;
  const g = guideId ? state.guides.find(x => x.guide_id === guideId) : null;
  document.getElementById("geTitle").textContent = g ? `🧑‍🏫 แก้ไขไกด์` : `🧑‍🏫 เพิ่มไกด์`;
  document.getElementById("fGuideName").value      = g?.full_name || "";
  document.getElementById("fGuideLanguages").value = g?.languages || "";
  document.getElementById("fGuidePhone").value     = g?.phone || "";
  document.getElementById("fGuideLine").value      = g?.line_id || "";
  document.getElementById("fGuideWhatsapp").value  = g?.whatsapp || "";
  document.getElementById("fGuideNote").value      = g?.note || "";
  document.getElementById("geDeleteBtn").style.display = g ? "" : "none";
  document.getElementById("guideEditOverlay").classList.add("open");
  setTimeout(() => document.getElementById("fGuideName")?.focus(), 50);
};

window.closeGuideEditModal = function (e) {
  if (e && e.target.id !== "guideEditOverlay") return;
  document.getElementById("guideEditOverlay").classList.remove("open");
  state.editingGuideId = null;
};

window.saveGuide = async function () {
  const name = document.getElementById("fGuideName").value.trim();
  if (!name) { showToast("กรอกชื่อไกด์", "error"); return; }
  const payload = {
    trip_id: state.tripId,
    full_name: name,
    languages: document.getElementById("fGuideLanguages").value.trim() || null,
    phone: document.getElementById("fGuidePhone").value.trim() || null,
    line_id: document.getElementById("fGuideLine").value.trim() || null,
    whatsapp: document.getElementById("fGuideWhatsapp").value.trim() || null,
    note: document.getElementById("fGuideNote").value.trim() || null,
    updated_at: new Date().toISOString(),
  };

  showLoading(true);
  try {
    let newId = null;
    if (state.editingGuideId) {
      await sbFetch("trip_guides", `?guide_id=eq.${state.editingGuideId}`, {
        method: "PATCH",
        body: payload,
      });
      showToast("แก้ไขไกด์แล้ว", "success");
    } else {
      payload.sort_order = state.guides.length;
      const res = await sbFetch("trip_guides", "", { method: "POST", body: payload });
      newId = Array.isArray(res) ? res[0]?.guide_id : res?.guide_id;
      showToast("เพิ่มไกด์แล้ว", "success");
    }
    document.getElementById("guideEditOverlay").classList.remove("open");
    state.editingGuideId = null;
    await loadAll();
    // ถ้าสร้างใหม่ + เปิด modal busGuides อยู่ → auto-assign ลงคันที่กำลังจัดการ
    if (newId && state.guideTargetBusId) {
      await window.toggleGuideForBus(newId);
    }
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

window.deleteGuide = async function () {
  if (!state.editingGuideId) return;
  const g = state.guides.find(x => x.guide_id === state.editingGuideId);
  if (!g) return;
  const assignedCount = state.guideToBuses[g.guide_id]?.size || 0;
  const msg = assignedCount > 0
    ? `ลบไกด์ "${g.full_name}" — ปัจจุบันประจำรถ ${assignedCount} คัน — ดำเนินการต่อ?`
    : `ลบไกด์ "${g.full_name}"?`;
  const ok = window.ConfirmModal?.open
    ? await window.ConfirmModal.open({
        title: "ลบไกด์",
        message: msg,
        icon: "🗑",
        tone: "danger",
        okText: "ลบ",
      })
    : confirm(msg);
  if (!ok) return;
  showLoading(true);
  try {
    await sbFetch("trip_guides", `?guide_id=eq.${state.editingGuideId}`, { method: "DELETE" });
    showToast("ลบไกด์แล้ว", "success");
    document.getElementById("guideEditOverlay").classList.remove("open");
    state.editingGuideId = null;
    await loadAll();
  } catch (e) {
    showToast("ลบไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

// ── START ──────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
