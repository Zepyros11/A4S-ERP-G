// ============================================================
//  Events - Booking Room
// ============================================================

// --- Supabase API ---
function getSB() {
  return {
    url: localStorage.getItem("sb_url") || "https://dtiynydgkcqausqktreg.supabase.co",
    key: localStorage.getItem("sb_key") || "sb_publishable_erMV0G_pNtPTYq-3frqv1Q_sIJ7KILD",
  };
}
async function sbFetch(table, query = "", opts = {}) {
  const { url, key } = getSB();
  if (!url || !key) return [];
  const { method = "GET", body } = opts;
  try {
    const res = await fetch(`${url}/rest/v1/${table}${query}`, {
      method,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(method === "POST" ? { Prefer: "return=representation" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) return [];
    return res.json().catch(() => []);
  } catch {
    return [];
  }
}

async function autoGenerateBookingCode() {
  const { url, key } = getSB();
  const now = new Date();
  const prefix = `RBKQ-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}-`;
  try {
    const res = await fetch(
      `${url}/rest/v1/room_booking_requests?request_code=like.${prefix}*&select=request_code`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const rows = await res.json().catch(() => []);
    let maxSeq = 0;
    (rows || []).forEach((r) => {
      const n = parseInt((r.request_code || "").split("-").pop(), 10);
      if (!isNaN(n) && n > maxSeq) maxSeq = n;
    });
    return `${prefix}${String(maxSeq + 1).padStart(3, "0")}`;
  } catch {
    return `${prefix}001`;
  }
}

// --- State ---
let places = [];           // สถานที่ที่มีห้องประชุม
let placeRoomsMap = {};    // { place_id: [room1, room2, ...] }
let rooms = [];            // flat list ของ place_rooms ทั้งหมด (compat)
let roomEvents = [];
let holidayEvents = [];
let holidayCatId = null;
let selectedPlaceId = null;
let selectedRoomId = null;    // room_id จาก place_rooms
let selectedPlaceName = null;
let selectedRoomName = null;
let users = [];
let roomBookings = [];
let _logCountCache = {};
let _requestFilter = "ALL";
let _datePicker = null;

// --- Helpers ---
function todayStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split("T")[0];
}

function formatDateThai(dateStr) {
  const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

function getDayLabel(dateStr) {
  const today = todayStr(0);
  const tomorrow = todayStr(1);
  if (dateStr === today) return "วันนี้";
  if (dateStr === tomorrow) return "พรุ่งนี้";
  const days = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัส", "ศุกร์", "เสาร์"];
  return days[new Date(dateStr + "T00:00:00").getDay()];
}

const STATUS_MAP = {
  DRAFT:      { label: "ร่าง",    cls: "bg-slate-100 text-slate-500" },
  CONFIRMED:  { label: "ยืนยัน",  cls: "bg-blue-100 text-blue-600" },
  ONGOING:    { label: "กำลังจัด", cls: "bg-green-100 text-green-600" },
  DONE:       { label: "เสร็จสิ้น", cls: "bg-slate-100 text-slate-400" },
  CANCELLED:  { label: "ยกเลิก",  cls: "bg-red-100 text-red-500" },
};

// --- Load holiday category ID ---
async function loadHolidayCatId() {
  if (holidayCatId) return;
  const cats = await sbFetch("event_categories", "?select=event_category_id,category_name");
  const found = (cats || []).find((c) => c.category_name === "วันหยุดบริษัท");
  if (found) holidayCatId = found.event_category_id;
}

// --- Load company holiday events (all rooms) ---
async function loadHolidayEvents() {
  if (!holidayCatId) { holidayEvents = []; return; }
  const data = await sbFetch(
    "events",
    `?event_category_id=eq.${holidayCatId}&select=event_id,event_name,event_date,end_date,start_time,end_time,status,poster_url&order=event_date.asc,start_time.asc`
  );
  holidayEvents = (data || []).filter((e) => e.status !== "CANCELLED");
}

// --- Load events for selected room ---
async function loadRoomEvents() {
  if (!selectedPlaceName) { roomEvents = []; return; }
  const fields = "select=event_id,event_name,event_date,end_date,start_time,end_time,status,poster_url,event_category_id&order=event_date.asc,start_time.asc";
  let searchTerm;
  if (selectedRoomName && selectedRoomName !== selectedPlaceName) {
    // search for "place — room" or "place — room" (various dash types)
    searchTerm = `%${selectedPlaceName}%${selectedRoomName}%`;
  } else {
    searchTerm = `%${selectedPlaceName}%`;
  }
  const encoded = encodeURIComponent(searchTerm);
  const data = await sbFetch("events", `?location=like.${encoded}&${fields}`);
  roomEvents = data || [];
}

// --- Render Room List (2-level: Place → Rooms) ---
function renderRoomList(filter = "") {
  const list = document.getElementById("roomList");
  const q = filter.toLowerCase();
  const filteredPlaces = places.filter((p) => {
    if (!q) return true;
    if ((p.place_name || "").toLowerCase().includes(q)) return true;
    const pRooms = placeRoomsMap[p.place_id] || [];
    return pRooms.some((r) => (r.room_name || "").toLowerCase().includes(q));
  });

  if (!filteredPlaces.length) {
    list.innerHTML = `<p class="text-xs text-slate-400 text-center mt-6 italic">ไม่พบห้องประชุม</p>`;
    return;
  }

  const today = todayStr(0);

  list.innerHTML = filteredPlaces.map((place) => {
    const isPlaceSelected = String(place.place_id) === String(selectedPlaceId);
    const pRooms = placeRoomsMap[place.place_id] || [];
    const addressShort = place.address ? place.address.split("\n")[0].substring(0, 40) : "";

    // Unread count for entire place
    const placeUnread = roomBookings
      .filter((b) => String(b.place_id) === String(place.place_id))
      .reduce((sum, b) => sum + getUnreadCount(b.request_id), 0);
    const unreadBadge = placeUnread > 0
      ? `<span style="display:inline-flex;align-items:center;gap:2px;background:#f97316;color:#fff;font-size:9px;font-weight:700;padding:1px 6px;border-radius:999px;line-height:1.6">💬 ${placeUnread}</span>`
      : "";

    const placeClass = isPlaceSelected
      ? "border-2 border-indigo-600 bg-indigo-50"
      : "border border-slate-100 bg-white hover:shadow-md";

    // Sub-rooms HTML
    let roomsHtml = "";
    if (pRooms.length > 0 && isPlaceSelected) {
      roomsHtml = pRooms.map((r) => {
        const isRoomActive = String(r.room_id) === String(selectedRoomId);
        const roomClass = isRoomActive
          ? "bg-indigo-600 text-white"
          : "bg-slate-50 text-slate-700 hover:bg-indigo-50";
        const cap = r.capacity ? `👥 ${r.capacity}` : "";
        return `
          <div class="sub-room-item ${roomClass} px-3 py-2 rounded-lg cursor-pointer text-xs font-semibold" data-sub-room-id="${r.room_id}" data-sub-room-name="${r.room_name}" data-sub-place-id="${place.place_id}" data-sub-place-name="${place.place_name}">
            <div class="flex justify-between items-center">
              <span>🚪 ${r.room_name}</span>
              ${cap ? `<span class="opacity-70">${cap}</span>` : ""}
            </div>
          </div>
        `;
      }).join("");
      roomsHtml = `<div class="sub-room-list flex flex-col gap-1 mt-2 ml-2 pl-2" style="border-left:2px solid #c7d2fe">${roomsHtml}</div>`;
    } else if (pRooms.length === 0) {
      // Place without sub-rooms (backward compat)
      roomsHtml = "";
    }

    return `
      <div class="place-group mb-2">
        <div class="room-item ${placeClass} pl-5 pr-4 py-3 rounded-2xl cursor-pointer shadow-sm" data-place-id="${place.place_id}" data-place-name="${place.place_name}">
          <div class="flex justify-between items-center">
            <h3 class="font-bold text-sm leading-tight truncate">${place.place_name}</h3>
            <div class="flex items-center gap-1 flex-shrink-0 ml-2">${unreadBadge}
              ${pRooms.length > 0 ? `<span class="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">${pRooms.length} ห้อง</span>` : ""}
            </div>
          </div>
          ${addressShort ? `<p class="text-[10px] text-slate-400 mt-0.5 truncate">${addressShort}</p>` : ""}
        </div>
        ${roomsHtml}
      </div>
    `;
  }).join("");

  // Bind place click → expand/select
  list.querySelectorAll("[data-place-id]").forEach((el) => {
    el.addEventListener("click", async () => {
      const placeId = el.dataset.placeId;
      const placeName = el.dataset.placeName;
      const pRooms = placeRoomsMap[placeId] || [];

      selectedPlaceId = placeId;
      selectedPlaceName = placeName;

      if (pRooms.length > 0) {
        // Auto-select first room
        selectedRoomId = String(pRooms[0].room_id);
        selectedRoomName = pRooms[0].room_name;
      } else {
        selectedRoomId = null;
        selectedRoomName = placeName;
      }

      renderRoomList(filter);
      updateHeader();
      document.getElementById("timeline").innerHTML =
        `<p class="text-sm text-slate-400 text-center mt-10 italic">กำลังโหลดกิจกรรม...</p>`;
      await loadRoomEvents();
      renderTimeline();
      updateHeader();
      renderMiniCalendar();
      renderRequestList();
      if (typeof window._onRoomSelected === "function") window._onRoomSelected();
    });
  });

  // Bind sub-room click
  list.querySelectorAll("[data-sub-room-id]").forEach((el) => {
    el.addEventListener("click", async (e) => {
      e.stopPropagation();
      selectedPlaceId = el.dataset.subPlaceId;
      selectedPlaceName = el.dataset.subPlaceName;
      selectedRoomId = el.dataset.subRoomId;
      selectedRoomName = el.dataset.subRoomName;

      renderRoomList(filter);
      updateHeader();
      document.getElementById("timeline").innerHTML =
        `<p class="text-sm text-slate-400 text-center mt-10 italic">กำลังโหลดกิจกรรม...</p>`;
      await loadRoomEvents();
      renderTimeline();
      updateHeader();
      renderMiniCalendar();
      renderRequestList();
      if (typeof window._onRoomSelected === "function") window._onRoomSelected();
    });
  });
}

// --- Update Header ---
function updateHeader() {
  const displayName = selectedRoomName
    ? (selectedPlaceName !== selectedRoomName ? `${selectedPlaceName} — ${selectedRoomName}` : selectedRoomName)
    : selectedPlaceName || "เลือกห้อง";
  document.getElementById("selectedRoomName").textContent = displayName;
  const upcoming = roomEvents.filter((e) => e.event_date >= todayStr(0) && e.status !== "CANCELLED").length;

  // find capacity from place_rooms or place
  let cap = null;
  if (selectedRoomId) {
    const pRooms = placeRoomsMap[selectedPlaceId] || [];
    const subRoom = pRooms.find((r) => String(r.room_id) === String(selectedRoomId));
    cap = subRoom?.capacity;
  }
  if (!cap) {
    const place = places.find((p) => String(p.place_id) === String(selectedPlaceId));
    cap = place?.capacity;
  }

  const detail = selectedPlaceName
    ? [cap ? `${cap} คน` : "", upcoming ? `${upcoming} กิจกรรมที่กำลังจะมาถึง` : "ไม่มีกิจกรรม"].filter(Boolean).join(" • ")
    : "เลือกห้องเพื่อดูกิจกรรม";
  document.getElementById("selectedRoomDetail").textContent = detail;
  const modalName = document.getElementById("modalRoomName");
  if (modalName) modalName.textContent = displayName;
}

// --- Render Timeline ---
function renderTimeline() {
  const timeline = document.getElementById("timeline");
  if (!selectedPlaceId) {
    timeline.innerHTML = `<p class="text-sm text-slate-400 text-center mt-10 italic">กรุณาเลือกห้องประชุม</p>`;
    return;
  }

  const today = todayStr(0);

  // Approved bookings for selected room (future only)
  const approvedBookings = roomBookings.filter((b) => {
    if (b.status !== "APPROVED" || b.booking_date < today) return false;
    // match by room_id if available, fallback to place_id
    if (selectedRoomId && b.room_id) return String(b.room_id) === String(selectedRoomId);
    return String(b.place_id) === String(selectedPlaceId);
  });

  // Filter out holiday events from roomEvents to avoid duplicates (they come from holidayEvents)
  const nonHolidayRoomEvents = holidayCatId
    ? roomEvents.filter((e) => e.event_category_id !== holidayCatId)
    : roomEvents;

  if (nonHolidayRoomEvents.length === 0 && holidayEvents.length === 0 && approvedBookings.length === 0) {
    timeline.innerHTML = `
      <div class="flex flex-col items-center justify-center py-16 text-center">
        <span class="text-4xl mb-3">📭</span>
        <p class="text-sm font-bold text-slate-400">ยังไม่มีกิจกรรมในห้องนี้</p>
        <p class="text-xs text-slate-300 mt-1">กิจกรรมจาก Events List และการจองห้องจะแสดงที่นี่</p>
      </div>
    `;
    return;
  }

  // Group by date
  const byDate = {};

  // Helper to expand multi-day event into byDate
  function expandEventIntoDates(e, type) {
    if (e.status === "CANCELLED") return;
    const start = e.event_date;
    const end = e.end_date || start;
    if (e.status === "DONE" && end < today) return;
    let cur = new Date(start + "T00:00:00");
    const endD = new Date(end + "T00:00:00");
    while (cur <= endD) {
      const d = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
      if (d >= today) {
        if (!byDate[d]) byDate[d] = [];
        if (!byDate[d].some((x) => x._type === type && String(x.event_id) === String(e.event_id))) {
          byDate[d].push({ _type: type, _sort: e.start_time || "00:00", ...e });
        }
      }
      cur.setDate(cur.getDate() + 1);
    }
  }

  nonHolidayRoomEvents.forEach((e) => expandEventIntoDates(e, "event"));
  holidayEvents.forEach((e) => expandEventIntoDates(e, "holiday"));

  approvedBookings.forEach((b) => {
    const d = b.booking_date;
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push({ _type: "booking", _sort: b.end_time === "ALLDAY" ? "00:00" : (b.start_time || "00:00"), ...b });
  });

  const eventsById = Object.fromEntries([...roomEvents, ...holidayEvents].map((e) => [String(e.event_id), e]));
  const bookingsById = Object.fromEntries(approvedBookings.map((b) => [String(b.request_id), b]));

  if (Object.keys(byDate).length === 0) {
    timeline.innerHTML = `
      <div class="flex flex-col items-center justify-center py-16 text-center">
        <span class="text-4xl mb-3">📭</span>
        <p class="text-sm font-bold text-slate-400">ยังไม่มีกิจกรรมในห้องนี้</p>
        <p class="text-xs text-slate-300 mt-1">กิจกรรมจาก Events List และการจองห้องจะแสดงที่นี่</p>
      </div>
    `;
    return;
  }

  timeline.innerHTML = Object.keys(byDate).sort().map((dateStr) => {
    const dayLabel = getDayLabel(dateStr);
    const dateLabel = formatDateThai(dateStr);
    const isToday = dateStr === today;
    const items = byDate[dateStr].sort((a, b) => a._sort.localeCompare(b._sort));
    const hasHolidayOnDate = items.some((i) => i._type === "holiday");
    const labelColorClass = isToday ? "text-indigo-600 bg-indigo-50"
      : hasHolidayOnDate ? "text-red-600 bg-red-50"
      : "text-slate-500 bg-slate-100";

    const rows = items.map((item) => {
      if (item._type === "holiday") {
        const timeStr = item.start_time
          ? `${item.start_time.slice(0, 5)}${item.end_time ? " – " + item.end_time.slice(0, 5) : ""}`
          : "ตลอดทั้งวัน";
        return `
          <div class="flex items-center gap-4 p-4 bg-red-50 rounded-2xl border border-red-100 border-l-4 border-l-red-400 shadow-sm cursor-pointer hover:bg-red-100 transition" data-event-id="${item.event_id}">
            <span class="text-xs font-bold text-red-400 w-28 flex-shrink-0">${timeStr}</span>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-bold text-red-700 truncate">🏖️ ${item.event_name || "วันหยุด"}</p>
            </div>
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 bg-red-100 text-red-500">วันหยุด</span>
          </div>`;
      } else if (item._type === "event") {
        const status = STATUS_MAP[item.status] || STATUS_MAP.DRAFT;
        const timeStr = item.start_time
          ? `${item.start_time.slice(0, 5)}${item.end_time ? " – " + item.end_time.slice(0, 5) : ""}`
          : "ตลอดทั้งวัน";
        return `
          <div class="flex items-center gap-4 p-4 bg-sky-50 rounded-2xl border border-sky-100 border-l-4 border-l-sky-500 shadow-sm cursor-pointer hover:bg-sky-100 transition" data-event-id="${item.event_id}">
            <span class="text-xs font-bold text-sky-500 w-28 flex-shrink-0">${timeStr}</span>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-bold text-slate-800 truncate">🗓️ ${item.event_name || "—"}</p>
            </div>
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${status.cls}">${status.label}</span>
          </div>`;
      } else {
        // Approved booking
        const timeStr = item.end_time === "ALLDAY" ? "ตลอดทั้งวัน"
          : `${(item.start_time || "").slice(0, 5)} – ${(item.end_time || "").slice(0, 5)}`;
        const csText = item.cs_name ? `<p class="text-[10px] text-violet-400 truncate">CS: ${item.cs_name}</p>` : "";
        return `
          <div class="flex items-center gap-4 p-4 bg-violet-50 rounded-2xl border border-violet-100 border-l-4 border-l-violet-500 shadow-sm cursor-pointer hover:bg-violet-100 transition" data-booking-id="${item.request_id}">
            <span class="text-xs font-bold text-violet-500 w-28 flex-shrink-0">${timeStr}</span>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-bold text-violet-900 truncate">🔖 ${item.booked_by_name || "—"}</p>
              ${csText}
            </div>
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 bg-violet-500 text-white">จองห้อง</span>
          </div>`;
      }
    }).join("");

    return `
      <section>
        <div class="flex items-center gap-4 mb-4">
          <span class="text-sm font-black ${labelColorClass} px-3 py-1 rounded-lg">${dateLabel}</span>
          <div class="h-[1px] flex-1 bg-slate-100"></div>
          <span class="text-xs font-bold text-slate-300 uppercase tracking-widest">${dayLabel}</span>
        </div>
        <div class="grid grid-cols-1 gap-2">${rows}</div>
      </section>`;
  }).join("");

  // Bind events
  timeline.querySelectorAll("[data-event-id]").forEach((el) => {
    el.addEventListener("click", () => {
      const ev = eventsById[el.dataset.eventId];
      if (ev) openPosterPopup(ev);
    });
  });
  timeline.querySelectorAll("[data-booking-id]").forEach((el) => {
    el.addEventListener("click", () => {
      const bk = bookingsById[el.dataset.bookingId];
      if (bk) openRequestDetail(bk);
    });
  });
}

// --- Poster Popup (uses shared ImgPopup component) ---
function openPosterPopup(ev) {
  const timeStr = ev.start_time
    ? `${ev.start_time.slice(0, 5)}${ev.end_time ? " – " + ev.end_time.slice(0, 5) : ""}`
    : "ตลอดทั้งวัน";
  const subtitle = formatDateThai(ev.event_date) + (timeStr ? ` • ${timeStr}` : "");
  const imgUrl = ev.poster_url || "";

  if (imgUrl) {
    ImgPopup.open([imgUrl], 0, {
      titles: [ev.event_name || "—"],
      skus: [subtitle],
    });
  } else {
    // no poster — open event form instead
    window.open(`../event-form.html?id=${ev.event_id}`, "_blank");
  }
}

// --- Time Slot Helpers ---
// Start time: 09:00–18:00 in 30-min steps, displayed in 3 column-groups
const START_SLOTS = ["09:00","09:30","10:00","10:30","11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30"];

// End time: special presets + 13:00–18:00
const END_PRESETS = [
  { label: "ทั้งวัน",        value: "ALLDAY" },
  { label: "จนปิดบริษัท",   value: "18:00"  },
];
const END_SLOTS = ["13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00","17:30","18:00"];

function timeBtnCls(active) {
  const base = "text-xs font-semibold py-1.5 px-1 rounded-lg border transition text-center w-full";
  return active
    ? `${base} border-indigo-500 bg-indigo-600 text-white`
    : `${base} border-slate-200 text-slate-600 hover:border-indigo-400 hover:bg-indigo-50`;
}

function buildStartGrid(selectedVal) {
  const grid = document.getElementById("startTimeGrid");
  if (!grid) return;

  grid.className = "mt-1 grid grid-cols-2 gap-1 max-h-52 overflow-y-auto";
  grid.innerHTML = START_SLOTS.map((t) =>
    `<button type="button" class="${timeBtnCls(t === selectedVal)}" data-time="${t}">${t}</button>`
  ).join("");

  grid.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById("inputStart").value = btn.dataset.time;
      buildStartGrid(btn.dataset.time);
      // reset end if now invalid
      const endVal = document.getElementById("inputEnd").value;
      if (endVal !== "ALLDAY" && endVal <= btn.dataset.time) {
        const newEnd = nextHour(btn.dataset.time, 1);
        document.getElementById("inputEnd").value = newEnd;
        buildEndGrid(newEnd);
      } else {
        buildEndGrid(endVal);
      }
    });
  });
}

function buildEndGrid(selectedVal) {
  const grid = document.getElementById("endTimeGrid");
  if (!grid) return;

  const presetBtns = END_PRESETS.map((p) =>
    `<button type="button" class="${timeBtnCls(p.value === selectedVal)} col-span-2" data-time="${p.value}">${p.label}</button>`
  ).join("");

  const slotBtns = END_SLOTS.map((t) =>
    `<button type="button" class="${timeBtnCls(t === selectedVal)}" data-time="${t}">${t}</button>`
  ).join("");

  grid.className = "mt-1 grid grid-cols-2 gap-1 max-h-52 overflow-y-auto";
  grid.innerHTML = presetBtns + slotBtns;

  grid.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById("inputEnd").value = btn.dataset.time;
      buildEndGrid(btn.dataset.time);
    });
  });
}

function nextHour(timeStr, hours = 1) {
  const [h, m] = timeStr.split(":").map(Number);
  const total = h * 60 + m + hours * 60;
  const nh = Math.min(Math.floor(total / 60), 18);
  const nm = total % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

// --- Modal ---
function populateBookerDropdown() {
  // no-op: using plain text inputs now
}

function checkAllDayConflicts(date) {
  const conflicts = [];
  const checkDate = date || todayStr(0);

  // Holiday on this date
  holidayEvents.forEach((e) => {
    const eStart = e.event_date;
    const eEnd = e.end_date || eStart;
    if (checkDate >= eStart && checkDate <= eEnd) {
      conflicts.push(`🏖️ ${e.event_name} (วันหยุดบริษัท)`);
    }
  });

  // All-day room events (no start_time = all day)
  roomEvents.forEach((e) => {
    if (e.status === "CANCELLED") return;
    if (holidayCatId && e.event_category_id === holidayCatId) return;
    const eStart = e.event_date;
    const eEnd = e.end_date || eStart;
    if (checkDate < eStart || checkDate > eEnd) return;
    if (!e.start_time) {
      conflicts.push(`🗓️ ${e.event_name} (ตลอดทั้งวัน)`);
    }
  });

  // All-day approved bookings
  roomBookings.forEach((b) => {
    if (b.status !== "APPROVED") return;
    if (b.booking_date !== checkDate) return;
    if (selectedRoomId && b.room_id) {
      if (String(b.room_id) !== String(selectedRoomId)) return;
    } else {
      if (String(b.place_id) !== String(selectedPlaceId)) return;
    }
    if (b.end_time === "ALLDAY") {
      conflicts.push(`🔖 ${b.booked_by_name || "จองห้อง"} (ตลอดทั้งวัน)`);
    }
  });

  return conflicts;
}

function openModal(date = "", start = "") {
  const checkDate = date || todayStr(0);

  // Block immediately if there are all-day conflicts
  const allDayConflicts = checkAllDayConflicts(checkDate);
  if (allDayConflicts.length > 0) {
    showConflictModal(allDayConflicts);
    return;
  }

  const modal = document.getElementById("bookingModal");
  const initStart = start || "09:00";
  const initEnd = nextHour(initStart, 1);
  if (_datePicker) _datePicker.setDate(checkDate, true);
  else document.getElementById("inputDate").value = checkDate;
  document.getElementById("inputStart").value = initStart;
  document.getElementById("inputEnd").value = initEnd;
  const bn = document.getElementById("inputBookerName");
  const cn = document.getElementById("inputCsName");
  if (bn) bn.value = "";
  if (cn) cn.value = "";
  buildStartGrid(initStart);
  buildEndGrid(initEnd);
  updateHeader();
  modal.classList.remove("hidden");
}

function closeModal() {
  document.getElementById("bookingModal").classList.add("hidden");
}

function showConflictModal(items) {
  const modal = document.getElementById("conflictModal");
  const body = document.getElementById("conflictBody");
  const iconMap = { "🗓️": "bg-sky-100 text-sky-600", "🔖": "bg-violet-100 text-violet-600", "🏖️": "bg-red-100 text-red-600" };
  body.innerHTML = items.map((txt) => {
    const icon = txt.slice(0, 2);
    const label = txt.slice(3);
    const cls = iconMap[icon] || "bg-slate-100 text-slate-600";
    return `<div class="flex items-center gap-3 p-3 rounded-xl ${cls}">
      <span class="text-lg flex-shrink-0">${icon}</span>
      <span class="text-sm font-semibold">${label}</span>
    </div>`;
  }).join("");
  modal.classList.remove("hidden");
}

document.getElementById("conflictOk").addEventListener("click", () => {
  document.getElementById("conflictModal").classList.add("hidden");
});
document.getElementById("conflictModal").addEventListener("click", (e) => {
  if (e.target.id === "conflictModal") e.target.classList.add("hidden");
});
// Esc close for conflictModal handled by modalManager.js

async function confirmBooking() {
  const bookerName = (document.getElementById("inputBookerName")?.value || "").trim();
  const csName     = (document.getElementById("inputCsName")?.value || "").trim();
  const date  = document.getElementById("inputDate").value;
  const start = document.getElementById("inputStart").value;
  const end   = document.getElementById("inputEnd").value;

  if (!bookerName || !date || !start || !end) {
    alert("กรุณากรอกข้อมูลให้ครบถ้วน");
    return;
  }
  if (end !== "ALLDAY" && start >= end) {
    alert("เวลาสิ้นสุดต้องหลังเวลาเริ่มต้น");
    return;
  }

  // --- Check time conflict with existing events & bookings ---
  const conflictNames = [];

  // Check room events (non-holiday) on the same date
  roomEvents.forEach((e) => {
    if (e.status === "CANCELLED") return;
    if (holidayCatId && e.event_category_id === holidayCatId) return;
    const eStart = e.event_date;
    const eEnd = e.end_date || eStart;
    if (date < eStart || date > eEnd) return; // not on this date
    // All-day event always conflicts
    if (!e.start_time) { conflictNames.push(`🗓️ ${e.event_name}`); return; }
    // Time overlap check
    const eS = e.start_time.slice(0, 5);
    const eE = (e.end_time || "23:59").slice(0, 5);
    if (end === "ALLDAY" || (start < eE && end > eS)) {
      conflictNames.push(`🗓️ ${e.event_name} (${eS}–${eE})`);
    }
  });

  // Check approved bookings on the same date & room
  roomBookings.forEach((b) => {
    if (b.status !== "APPROVED") return;
    if (b.booking_date !== date) return;
    // match by room_id if available, fallback to place_id
    if (selectedRoomId && b.room_id) {
      if (String(b.room_id) !== String(selectedRoomId)) return;
    } else {
      if (String(b.place_id) !== String(selectedPlaceId)) return;
    }
    // All-day booking always conflicts
    if (b.end_time === "ALLDAY") { conflictNames.push(`🔖 ${b.booked_by_name || "จองห้อง"} (ตลอดทั้งวัน)`); return; }
    const bS = (b.start_time || "").slice(0, 5);
    const bE = (b.end_time || "23:59").slice(0, 5);
    if (end === "ALLDAY" || (start < bE && end > bS)) {
      conflictNames.push(`🔖 ${b.booked_by_name || "จองห้อง"} (${bS}–${bE})`);
    }
  });

  // Check holiday events on the same date
  holidayEvents.forEach((e) => {
    const eStart = e.event_date;
    const eEnd = e.end_date || eStart;
    if (date >= eStart && date <= eEnd) {
      conflictNames.push(`🏖️ ${e.event_name} (วันหยุดบริษัท)`);
    }
  });

  if (conflictNames.length > 0) {
    showConflictModal(conflictNames);
    return;
  }

  const bookerUser = users.find((u) => u.full_name === bookerName);
  const csUser     = csName ? users.find((u) => u.full_name === csName) : null;
  const resolvedBookerId = bookerUser ? bookerUser.user_id : null;
  const resolvedCsId     = csUser     ? csUser.user_id     : null;

  const btn = document.getElementById("btnConfirmBook");
  btn.disabled = true;
  btn.textContent = "กำลังบันทึก...";

  try {
    const code = await autoGenerateBookingCode();
    const payload = {
      request_code: code,
      place_id: selectedPlaceId ? Number(selectedPlaceId) : null,
      place_name: selectedPlaceName || "",
      room_id: selectedRoomId ? Number(selectedRoomId) : null,
      room_name: selectedRoomName || null,
      booked_by: resolvedBookerId,
      cs_id: resolvedCsId,
      booked_by_name: bookerName || null,
      cs_name: csName || null,
      booking_date: date,
      start_time: start,
      end_time: end,
      status: "PENDING",
    };
    await sbFetch("room_booking_requests", "", { method: "POST", body: payload });
    closeModal();
    await loadRoomBookings();
    renderRequestList();
  } catch (e) {
    alert("บันทึกไม่สำเร็จ: " + (e.message || "กรุณาลองใหม่"));
  } finally {
    btn.disabled = false;
    btn.textContent = "ยืนยันการจอง";
  }
}

async function loadRoomBookings() {
  roomBookings = (await sbFetch(
    "room_booking_requests",
    "?select=request_id,request_code,place_id,place_name,room_id,room_name,booked_by,cs_id,booked_by_name,cs_name,booking_date,start_time,end_time,status,created_at&order=created_at.desc"
  )) || [];
  populateNameDatalist();
}

// --- Custom Name Dropdown ---
function setupNameDropdown(inputId, panelId, getOptions) {
  const input = document.getElementById(inputId);
  const panel = document.getElementById(panelId);
  if (!input || !panel) return;

  function renderOptions(q) {
    const opts = getOptions().filter(n => !q || n.toLowerCase().includes(q.toLowerCase()));
    if (!opts.length) { panel.classList.add("hidden"); return; }
    panel.innerHTML = opts.map(n => `
      <div class="px-4 py-2.5 text-sm text-slate-700 cursor-pointer hover:bg-indigo-50 hover:text-indigo-700 border-b border-slate-50 last:border-0"
           data-val="${n}">${n}</div>`).join("");
    panel.classList.remove("hidden");
    panel.querySelectorAll("[data-val]").forEach(el => {
      el.addEventListener("mousedown", (e) => {
        e.preventDefault();
        input.value = el.dataset.val;
        panel.classList.add("hidden");
      });
    });
  }

  input.addEventListener("focus", () => renderOptions(input.value));
  input.addEventListener("input", () => renderOptions(input.value));
  input.addEventListener("blur",  () => setTimeout(() => panel.classList.add("hidden"), 150));
}

function populateNameDatalist() {
  // re-bind dropdowns whenever bookings reload (options may change)
  setupNameDropdown("inputBookerName", "bookerDropdownPanel",
    () => [...new Set(roomBookings.map(r => r.booked_by_name).filter(Boolean))]);
  setupNameDropdown("inputCsName", "csDropdownPanel",
    () => [...new Set(roomBookings.map(r => r.cs_name).filter(Boolean))]);
}

// --- Event Listeners ---
document.getElementById("searchRoom").addEventListener("input", (e) => {
  renderRoomList(e.target.value);
});

document.getElementById("requestFilterTabs").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-filter]");
  if (btn) {
    _requestFilter = btn.dataset.filter;
    renderRequestList();
  }
});


document.getElementById("btnBook").addEventListener("click", () => openModal());
document.getElementById("closeModal").addEventListener("click", closeModal);
document.getElementById("btnConfirmBook").addEventListener("click", confirmBooking);
document.getElementById("bookingModal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) closeModal();
});

// --- Mini Calendar ---
let calViewYear = new Date().getFullYear();
let calViewMonth = new Date().getMonth();

function renderMiniCalendar() {
  const container = document.getElementById("miniCalendar");
  if (!container) return;

  const today = new Date();
  const firstDay = new Date(calViewYear, calViewMonth, 1).getDay();
  const daysInMonth = new Date(calViewYear, calViewMonth + 1, 0).getDate();
  const monthNames = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
  const dayNames = ["อา","จ","อ","พ","พฤ","ศ","ส"];

  // Dates that have events or approved bookings for the selected room (expand multi-day events)
  const eventDates = new Set();
  roomEvents.filter((e) => e.status !== "CANCELLED").forEach((e) => {
    const start = e.event_date;
    const end = e.end_date || start;
    let cur = new Date(start + "T00:00:00");
    const endD = new Date(end + "T00:00:00");
    while (cur <= endD) {
      eventDates.add(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`);
      cur.setDate(cur.getDate() + 1);
    }
  });
  // Holiday dates
  const holidayDates = new Set();
  holidayEvents.forEach((e) => {
    const start = e.event_date;
    const end = e.end_date || start;
    let cur = new Date(start + "T00:00:00");
    const endD = new Date(end + "T00:00:00");
    while (cur <= endD) {
      holidayDates.add(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`);
      cur.setDate(cur.getDate() + 1);
    }
  });
  const bookingDates = new Set(
    roomBookings
      .filter((b) => {
        if (b.status !== "APPROVED") return false;
        if (selectedRoomId && b.room_id) return String(b.room_id) === String(selectedRoomId);
        return String(b.place_id) === String(selectedPlaceId);
      })
      .map((b) => b.booking_date)
  );

  let html = `
    <div class="text-center text-xs font-black text-slate-700 mb-3">${monthNames[calViewMonth]} ${calViewYear + 543}</div>
    <div class="grid grid-cols-7 gap-px text-center mb-1">
      ${dayNames.map((d, i) => `<div class="text-[9px] font-bold ${i === 0 ? "text-red-400" : "text-slate-400"}">${d}</div>`).join("")}
    </div>
    <div class="grid grid-cols-7 gap-px text-center">
  `;

  for (let i = 0; i < firstDay; i++) html += `<div></div>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calViewYear}-${String(calViewMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const isToday = d === today.getDate() && calViewMonth === today.getMonth() && calViewYear === today.getFullYear();
    const hasEvent   = eventDates.has(dateStr);
    const hasBooking = bookingDates.has(dateStr);
    const isHoliday  = holidayDates.has(dateStr);
    const dow = (firstDay + d - 1) % 7;

    const isPast = dateStr < todayStr(0);

    let cls = "text-[11px] w-6 h-6 mx-auto flex items-center justify-center rounded-full transition ";
    if (isPast) {
      cls += "text-slate-300 line-through cursor-default ";
    } else if (isToday) {
      cls += "bg-rose-500 text-white font-bold cursor-pointer ";
    } else if (isHoliday) {
      cls += "bg-red-100 text-red-600 font-bold cursor-pointer ring-2 ring-red-300 ";
    } else if (hasEvent && hasBooking) {
      cls += "bg-sky-100 text-sky-600 font-bold ring-2 ring-violet-400 cursor-pointer ";
    } else if (hasBooking) {
      cls += "bg-violet-100 text-violet-700 font-bold cursor-pointer ";
    } else if (hasEvent) {
      cls += "bg-sky-100 text-sky-600 font-bold cursor-pointer ";
    } else if (dow === 0) {
      cls += "text-red-400 hover:bg-red-50 cursor-pointer ";
    } else {
      cls += "text-slate-600 hover:bg-indigo-50 cursor-pointer ";
    }

    html += `<div><span class="${cls}" ${isPast ? "" : `data-date="${dateStr}"`}>${d}</span></div>`;
  }

  html += `</div>`;
  container.innerHTML = html;

  container.querySelectorAll("[data-date]").forEach((el) => {
    el.addEventListener("click", () => openModal(el.dataset.date, "09:00"));
  });
}

document.getElementById("calPrev").addEventListener("click", () => {
  calViewMonth--;
  if (calViewMonth < 0) { calViewMonth = 11; calViewYear--; }
  renderMiniCalendar();
});
document.getElementById("calNext").addEventListener("click", () => {
  calViewMonth++;
  if (calViewMonth > 11) { calViewMonth = 0; calViewYear++; }
  renderMiniCalendar();
});

// --- Request List ---
function renderRequestList() {
  const container = document.getElementById("requestList");
  const badge = document.getElementById("requestCount");
  if (!container) return;

  const today = todayStr(0);
  // Only upcoming bookings (today onwards), filtered by selected room
  let upcoming = roomBookings.filter((r) => r.booking_date >= today);
  if (selectedPlaceId) {
    upcoming = upcoming.filter((r) => {
      if (selectedRoomId && r.room_id) return String(r.room_id) === String(selectedRoomId);
      return String(r.place_id) === String(selectedPlaceId);
    });
  }
  // Status filter
  const filtered = _requestFilter === "ALL"
    ? upcoming
    : upcoming.filter((r) => r.status === _requestFilter);

  badge.textContent = upcoming.length;
  // Update mobile bottom nav badge
  const mobBadge = document.getElementById("mobReqBadge");
  if (mobBadge) {
    const totalUnread = upcoming.reduce((sum, r) => sum + getUnreadCount(r.request_id), 0);
    mobBadge.textContent = totalUnread;
    mobBadge.style.display = totalUnread > 0 ? "flex" : "none";
  }

  // Update status tab styles
  document.querySelectorAll(".req-filter-btn").forEach((btn) => {
    const isActive = btn.dataset.filter === _requestFilter;
    btn.className = `req-filter-btn text-[10px] font-bold px-2.5 py-1 rounded-lg transition ${
      isActive ? "bg-indigo-600 text-white" : "text-slate-500 hover:bg-slate-100"
    }`;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-400 text-center mt-4 italic">ไม่มีรายการ</p>`;
    return;
  }

  const statusMap = {
    PENDING:  { label: "รอดำเนินการ", cls: "bg-yellow-100 text-yellow-600" },
    APPROVED: { label: "อนุมัติ",      cls: "bg-green-100 text-green-600" },
    REJECTED: { label: "ปฏิเสธ",       cls: "bg-red-100 text-red-500" },
    CANCELLED:{ label: "ยกเลิก",       cls: "bg-slate-100 text-slate-400" },
  };

  container.innerHTML = filtered.map((r) => {
    const s = statusMap[r.status] || statusMap.PENDING;
    const bookerName = r.booked_by_name || (users.find((u) => String(u.user_id) === String(r.booked_by)) || {}).full_name || "—";
    const timeStr = r.end_time === "ALLDAY" ? "ตลอดทั้งวัน"
      : `${r.start_time || ""}–${r.end_time || ""}`;
    const unread = getUnreadCount(r.request_id);
    const unreadBadge = unread > 0
      ? `<span style="display:inline-flex;align-items:center;gap:2px;background:#f97316;color:#fff;font-size:9px;font-weight:700;padding:1px 5px;border-radius:999px;line-height:1.4">💬 ${unread}</span>`
      : "";
    return `
      <div class="bg-white rounded-xl border border-slate-100 p-3 shadow-sm cursor-pointer hover:border-indigo-200 hover:shadow-md transition" data-request-id="${r.request_id}">
        <div class="flex justify-between items-start gap-2">
          <p class="text-xs font-bold text-slate-800 leading-tight">${bookerName}</p>
          <div class="flex items-center gap-1 flex-shrink-0">${unreadBadge}<span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full ${s.cls}">${s.label}</span></div>
        </div>
        <p class="text-[10px] text-slate-500 mt-0.5">${r.place_name}</p>
        <p class="text-[10px] text-slate-400">${r.booking_date} • ${timeStr}</p>
        <p class="text-[10px] text-indigo-400 font-mono mt-0.5">${r.request_code}</p>
      </div>
    `;
  }).join("");

  container.querySelectorAll("[data-request-id]").forEach((el) => {
    el.addEventListener("click", () => {
      const req = roomBookings.find((r) => String(r.request_id) === el.dataset.requestId);
      if (req) openRequestDetail(req);
    });
  });
}

// --- Unread Log Counts ---
// _logCountCache[id] = { total, latest } where latest = newest created_at string
async function refreshLogCounts() {
  if (!roomBookings.length) return;
  const ids = roomBookings.map(r => r.request_id).join(",");
  const logs = await sbFetch("room_booking_logs", `?request_id=in.(${ids})&select=request_id,created_at`);
  const map = {};
  (logs || []).forEach(l => {
    const id = l.request_id;
    if (!map[id]) map[id] = { total: 0, latest: "" };
    map[id].total++;
    if (l.created_at > map[id].latest) map[id].latest = l.created_at;
  });
  const prev = JSON.stringify(_logCountCache);
  _logCountCache = map;
  if (JSON.stringify(map) !== prev) { renderRequestList(); renderRoomList(); }
}

function getUnreadCount(requestId) {
  const info   = _logCountCache[requestId];
  if (!info || info.total === 0) return 0;
  const seenAt = localStorage.getItem(`lsLogBRE_${requestId}`) || "";
  return seenAt >= info.latest ? 0 : info.total - parseInt(localStorage.getItem(`lsLogNBRE_${requestId}`) || "0", 10);
}

function markLogsRead(requestId, logs) {
  const latest = (logs || []).reduce((m, l) => l.created_at > m ? l.created_at : m, "");
  localStorage.setItem(`lsLogBRE_${requestId}`, latest);
  localStorage.setItem(`lsLogNBRE_${requestId}`, (logs || []).length);
  if (!_logCountCache[requestId]) _logCountCache[requestId] = { total: 0, latest: "" };
  _logCountCache[requestId].total  = Math.max(_logCountCache[requestId].total,  (logs||[]).length);
  _logCountCache[requestId].latest = latest || _logCountCache[requestId].latest;
  renderRequestList();
}

// --- Request Detail Modal ---
let detailCurrentRequestId = null;
let _logPollTimer = null;
let _lastLogSig   = "";

function startLogPolling(requestId) {
  stopLogPolling();
  _logPollTimer = setInterval(() => loadRequestLogs(requestId, true), 4000);
}
function stopLogPolling() {
  if (_logPollTimer) { clearInterval(_logPollTimer); _logPollTimer = null; }
  _lastLogSig = "";
}

const REQ_STATUS_MAP = {
  PENDING:   { label: "รอดำเนินการ", cls: "bg-yellow-100 text-yellow-600" },
  APPROVED:  { label: "อนุมัติ",      cls: "bg-green-100 text-green-600" },
  REJECTED:  { label: "ปฏิเสธ",       cls: "bg-red-100 text-red-500" },
  CANCELLED: { label: "ยกเลิก",       cls: "bg-slate-100 text-slate-400" },
};

function openRequestDetail(req) {
  detailCurrentRequestId = req.request_id;

  // Header code
  document.getElementById("detailModalCode").textContent = req.request_code || "—";

  // Info panel
  const s = REQ_STATUS_MAP[req.status] || REQ_STATUS_MAP.PENDING;
  const bookerName = req.booked_by_name || (users.find((u) => String(u.user_id) === String(req.booked_by)) || {}).full_name || "—";
  const csName = req.cs_name || (req.cs_id ? (users.find((u) => String(u.user_id) === String(req.cs_id)) || {}).full_name : null) || "—";
  const timeStr = req.end_time === "ALLDAY" ? "ตลอดทั้งวัน" : `${req.start_time || ""}–${req.end_time || ""}`;
  const createdAt = req.created_at ? req.created_at.slice(0, 16).replace("T", " ") : "—";

  document.getElementById("detailInfoPanel").innerHTML = `
    <div class="flex items-start justify-between gap-2 mb-4">
      <div>
        <p class="text-base font-black text-slate-900 leading-tight">${req.place_name || "—"}${req.room_name ? ` — ${req.room_name}` : ""}</p>
        <p class="text-xs text-indigo-400 font-mono mt-0.5">${req.request_code || "—"}</p>
      </div>
      <span class="text-xs font-bold px-3 py-1 rounded-full flex-shrink-0 ${s.cls}">${s.label}</span>
    </div>

    <div class="divide-y divide-slate-100">
      ${infoRow("ผู้จอง", bookerName)}
      ${infoRow("CS", csName)}
      ${infoRow("วันที่", req.booking_date || "—")}
      ${infoRow("เวลา", timeStr)}
      ${infoRow("สร้างเมื่อ", createdAt)}
    </div>
  `;

  // Set chat panel header
  const subEl = document.getElementById("bkrChatSubtitle");
  if (subEl) subEl.textContent = req.request_code || "—";
  const senderEl = document.getElementById("bkrSenderName");
  if (senderEl) senderEl.textContent = window.ERP_USER?.full_name || window.ERP_USER?.username || "Admin";

  // Show modal then load logs
  document.getElementById("requestDetailModal").classList.remove("hidden");
  document.getElementById("logInput").value = "";
  loadRequestLogs(req.request_id);
  startLogPolling(req.request_id);
}

function infoRow(label, value) {
  return `
    <div class="flex items-center justify-between py-2.5 gap-4">
      <span class="text-xs text-slate-400 flex-shrink-0">${label}</span>
      <span class="text-sm font-medium text-slate-800 text-right">${value}</span>
    </div>
  `;
}

async function loadRequestLogs(requestId, silent = false) {
  const panel = document.getElementById("detailLogPanel");
  if (!silent) {
    panel.innerHTML = `<p class="text-xs text-slate-400 text-center italic">กำลังโหลด...</p>`;
    _lastLogSig = "";
  }

  const logs = await sbFetch(
    "room_booking_logs",
    `?request_id=eq.${requestId}&order=created_at.asc`
  );

  const sig = (logs || []).map(l => l.created_at).join("|");
  if (silent && sig === _lastLogSig) return;
  _lastLogSig = sig;

  // Mark as read only when user actively opens the detail (not background polling)
  if (!silent) markLogsRead(requestId, logs);

  if (!logs || logs.length === 0) {
    panel.innerHTML = `<p class="text-xs text-slate-400 text-center italic mt-4">ยังไม่มี log</p>`;
    return;
  }

  const wasAtBottom = panel.scrollHeight - panel.scrollTop <= panel.clientHeight + 8;

  const myName = window.ERP_USER?.full_name || window.ERP_USER?.username || "";
  panel.innerHTML = logs.map((log) => {
    const time = log.created_at ? log.created_at.slice(0, 16).replace("T", " ") : "";
    const author = log.created_by_name || "ระบบ";
    const isMe = author === myName;
    let bg, border, textColor;
    if (isMe) { bg="#ede9fe"; border="#c4b5fd"; textColor="#4c1d95"; }
    else      { bg="#fffbeb"; border="#fcd34d"; textColor="#92400e"; }
    const br = isMe ? "14px 4px 14px 14px" : "4px 14px 14px 14px";
    return `<div style="display:flex;flex-direction:column;max-width:82%;align-self:${isMe?"flex-end":"flex-start"};align-items:${isMe?"flex-end":"flex-start"}">
      <div style="font-size:10px;font-weight:700;color:#94a3b8;margin-bottom:3px">${author}</div>
      <div style="background:${bg};border:1.5px solid ${border};border-radius:${br};padding:8px 12px;font-size:13px;line-height:1.5;color:${textColor};word-break:break-word">${log.message || ""}</div>
      <div style="font-size:10px;color:#94a3b8;margin-top:3px">${time}</div>
    </div>`;
  }).join("");

  if (!silent || wasAtBottom) panel.scrollTop = panel.scrollHeight;
}

async function submitRequestLog() {
  const input = document.getElementById("logInput");
  const message = (input.value || "").trim();
  if (!message || !detailCurrentRequestId) return;

  const btn = document.getElementById("logSubmit");
  btn.disabled = true;

  await sbFetch("room_booking_logs", "", {
    method: "POST",
    body: {
      request_id: detailCurrentRequestId,
      message,
      created_by_name: (window.ERP_USER?.full_name || window.ERP_USER?.username || "Admin"),
    },
  });

  input.value = "";
  btn.disabled = false;
  await loadRequestLogs(detailCurrentRequestId);
}

// Detail modal event listeners
document.getElementById("closeDetailModal").addEventListener("click", () => {
  document.getElementById("requestDetailModal").classList.add("hidden");
  detailCurrentRequestId = null;
  stopLogPolling();
});
document.getElementById("requestDetailModal").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) {
    document.getElementById("requestDetailModal").classList.add("hidden");
    detailCurrentRequestId = null;
    stopLogPolling();
  }
});
document.getElementById("logSubmit").addEventListener("click", submitRequestLog);

// ESC to close any open modal
// Esc close handled by modalManager.js; cleanup side effects via MutationObserver
const _detailModal = document.getElementById("requestDetailModal");
if (_detailModal) {
  new MutationObserver(() => {
    if (_detailModal.classList.contains("hidden")) {
      detailCurrentRequestId = null;
      stopLogPolling();
    }
  }).observe(_detailModal, { attributes: true, attributeFilter: ["class"] });
}
document.getElementById("logInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitRequestLog();
});

// --- Init ---
async function loadData() {
  const list = document.getElementById("roomList");
  list.innerHTML = `<p class="text-xs text-slate-400 text-center mt-6 italic">กำลังโหลด...</p>`;

  // ดึง places ที่มีห้องประชุม + users
  let allPlaces;
  [allPlaces, users] = await Promise.all([
    sbFetch("places", "?select=*&status=eq.ACTIVE&order=place_name.asc"),
    sbFetch("users", "?select=user_id,full_name&is_active=eq.true&order=full_name.asc"),
  ]);
  allPlaces = allPlaces || [];
  users = users || [];

  // ดึง place_rooms ของทุก place
  const allRooms = (await sbFetch("place_rooms", "?select=*&order=room_name.asc")) || [];
  placeRoomsMap = {};
  allRooms.forEach((r) => {
    if (!placeRoomsMap[r.place_id]) placeRoomsMap[r.place_id] = [];
    placeRoomsMap[r.place_id].push(r);
  });

  // เฉพาะ places ที่มี place_rooms หรือเป็น MEETING_ROOM
  places = allPlaces.filter((p) =>
    placeRoomsMap[p.place_id]?.length > 0 || p.place_type === "MEETING_ROOM"
  );

  // สร้าง flat rooms list สำหรับ backward compat
  rooms = [];
  places.forEach((p) => {
    const pRooms = placeRoomsMap[p.place_id] || [];
    if (pRooms.length > 0) {
      pRooms.forEach((r) => {
        rooms.push({ ...r, _place: p, place_name: p.place_name });
      });
    } else {
      // place เดี่ยวที่ไม่มี sub-rooms (backward compat)
      rooms.push({ room_id: null, room_name: p.place_name, place_id: p.place_id, capacity: p.capacity, _place: p, place_name: p.place_name });
    }
  });

  // Load holiday category + events
  await loadHolidayCatId();
  await loadHolidayEvents();

  // Auto-select first room
  if (places.length && !selectedPlaceId) {
    const firstPlace = places[0];
    selectedPlaceId = String(firstPlace.place_id);
    selectedPlaceName = firstPlace.place_name;
    const firstRooms = placeRoomsMap[firstPlace.place_id] || [];
    if (firstRooms.length > 0) {
      selectedRoomId = String(firstRooms[0].room_id);
      selectedRoomName = firstRooms[0].room_name;
    } else {
      selectedRoomId = null;
      selectedRoomName = firstPlace.place_name;
    }
    await loadRoomEvents();
  }

  await loadRoomBookings();

  renderRoomList();
  renderTimeline();
  updateHeader();
  renderMiniCalendar();
  renderRequestList();
}

loadData().then(() => refreshLogCounts());

// --- Flatpickr for date input (dd/mm/yyyy) ---
_datePicker = flatpickr("#inputDate", {
  dateFormat: "Y-m-d",
  altInput: true,
  altFormat: "d/m/Y",
  allowInput: false,
  clickOpens: true,
  onReady(_, __, fp) {
    if (fp.altInput) {
      fp.altInput.classList.add(
        "mt-1", "w-full", "px-4", "py-2.5", "rounded-xl",
        "border", "border-slate-200", "text-sm",
        "focus:outline-none", "focus:ring-2", "focus:ring-indigo-300",
        "cursor-pointer"
      );
      fp.altInput.setAttribute("readonly", "readonly");
    }
  },
});

// Auto-refresh request list + timeline + calendar every 10s
let _bookingPollSig = "";
setInterval(async () => {
  const prev = roomBookings.map(b => `${b.request_id}:${b.status}`).join("|");
  await loadRoomBookings();
  const next = roomBookings.map(b => `${b.request_id}:${b.status}`).join("|");
  if (next !== prev) {
    renderRequestList();
    renderTimeline();
    renderMiniCalendar();
  }
  await refreshLogCounts(); // always refresh unread counts (re-renders list if changed)
}, 10000);
