// ============================================================
//  Events - Booking Room
// ============================================================

// --- Supabase API ---
function getSB() {
  return {
    url: localStorage.getItem("sb_url") || "",
    key: localStorage.getItem("sb_key") || "",
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
let rooms = [];
let roomEvents = []; // events from `events` table matching selected room's place_name
let selectedRoomId = null;
let selectedPlaceName = null;
let users = [];
let roomBookings = []; // room_booking_requests from Supabase

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

// --- Load events for selected room ---
async function loadRoomEvents() {
  if (!selectedPlaceName) { roomEvents = []; return; }
  const encoded = encodeURIComponent(selectedPlaceName);
  const data = await sbFetch(
    "events",
    `?location=eq.${encoded}&select=event_id,event_name,event_date,end_date,start_time,end_time,status,poster_url&order=event_date.asc,start_time.asc`
  );
  roomEvents = data || [];
}

// --- Render Room List ---
function renderRoomList(filter = "") {
  const list = document.getElementById("roomList");
  const filtered = rooms.filter((r) =>
    (r.place_name || "").toLowerCase().includes(filter.toLowerCase())
  );

  if (!filtered.length) {
    list.innerHTML = `<p class="text-xs text-slate-400 text-center mt-6 italic">ไม่พบห้องประชุม</p>`;
    return;
  }

  const today = todayStr(0);

  list.innerHTML = filtered.map((room) => {
    const isSelected = room.place_id === selectedRoomId;
    const isActive = room.status === "ACTIVE";

    // Show event count today if this is the selected room
    const todayEventCount = isSelected
      ? roomEvents.filter((e) => e.event_date === today && e.status !== "CANCELLED").length
      : 0;

    const statusLabel = !isActive
      ? `<span class="text-[10px] bg-slate-200 text-slate-500 px-2 py-0.5 rounded-full font-bold">ปิด</span>`
      : isSelected && todayEventCount > 0
        ? `<span class="text-[10px] bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full font-bold">มีงาน ${todayEventCount}</span>`
        : `<span class="text-[10px] bg-green-500 text-white px-2 py-0.5 rounded-full font-bold">ว่าง</span>`;

    const activeClass = isSelected
      ? "border-2 border-indigo-600 bg-indigo-50 active"
      : "border border-slate-100 bg-white hover:shadow-md";

    const meta = room.capacity ? `👥 ${room.capacity} คน` : "";
    const addressShort = room.address ? room.address.split("\n")[0].substring(0, 40) : "";

    return `
      <div class="room-item ${activeClass} p-4 rounded-2xl cursor-pointer shadow-sm" data-room-id="${room.place_id}" data-place-name="${room.place_name}">
        <div class="flex justify-between items-start">
          <h3 class="font-bold text-slate-900 text-sm leading-tight">${room.place_name}</h3>
          ${statusLabel}
        </div>
        ${meta ? `<p class="text-xs text-slate-500 mt-1">${meta}</p>` : ""}
        ${addressShort ? `<p class="text-[10px] text-slate-400 mt-0.5 truncate">${addressShort}</p>` : ""}
      </div>
    `;
  }).join("");

  list.querySelectorAll("[data-room-id]").forEach((el) => {
    el.addEventListener("click", async () => {
      selectedRoomId = el.dataset.roomId;
      selectedPlaceName = el.dataset.placeName;
      renderRoomList(filter);   // show active state immediately
      updateHeader();
      document.getElementById("timeline").innerHTML =
        `<p class="text-sm text-slate-400 text-center mt-10 italic">กำลังโหลดกิจกรรม...</p>`;
      await loadRoomEvents();
      renderTimeline();
      updateHeader();
      renderMiniCalendar();
    });
  });
}

// --- Update Header ---
function updateHeader() {
  const room = rooms.find((r) => String(r.place_id) === String(selectedRoomId));
  const name = room?.place_name || selectedPlaceName || "เลือกห้อง";
  document.getElementById("selectedRoomName").textContent = name;
  const upcoming = roomEvents.filter((e) => e.event_date >= todayStr(0) && e.status !== "CANCELLED").length;
  const detail = selectedPlaceName
    ? [room?.capacity ? `${room.capacity} คน` : "", upcoming ? `${upcoming} กิจกรรมที่กำลังจะมาถึง` : "ไม่มีกิจกรรม"].filter(Boolean).join(" • ")
    : "เลือกห้องเพื่อดูกิจกรรม";
  document.getElementById("selectedRoomDetail").textContent = detail;
  const modalName = document.getElementById("modalRoomName");
  if (modalName) modalName.textContent = name;
}

// --- Render Timeline ---
function renderTimeline() {
  const timeline = document.getElementById("timeline");
  if (!selectedRoomId) {
    timeline.innerHTML = `<p class="text-sm text-slate-400 text-center mt-10 italic">กรุณาเลือกห้องประชุม</p>`;
    return;
  }

  if (roomEvents.length === 0) {
    timeline.innerHTML = `
      <div class="flex flex-col items-center justify-center py-16 text-center">
        <span class="text-4xl mb-3">📭</span>
        <p class="text-sm font-bold text-slate-400">ยังไม่มีกิจกรรมในห้องนี้</p>
        <p class="text-xs text-slate-300 mt-1">กิจกรรมจาก Events List จะแสดงที่นี่</p>
      </div>
    `;
    return;
  }

  // Group events by date — exclude past dates
  const today = todayStr(0);
  const byDate = {};
  roomEvents.forEach((e) => {
    const d = e.event_date;
    if (d < today) return;
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(e);
  });

  const eventsById = Object.fromEntries(roomEvents.map((e) => [String(e.event_id), e]));

  timeline.innerHTML = Object.keys(byDate).sort().map((dateStr) => {
    const dayLabel = getDayLabel(dateStr);
    const dateLabel = formatDateThai(dateStr);
    const isToday = dateStr === today;
    const labelColorClass = isToday
      ? "text-indigo-600 bg-indigo-50"
      : "text-slate-500 bg-slate-100";

    const eventRows = byDate[dateStr].map((ev) => {
      const status = STATUS_MAP[ev.status] || STATUS_MAP.DRAFT;
      const timeStr = ev.start_time
        ? `${ev.start_time.slice(0, 5)}${ev.end_time ? " – " + ev.end_time.slice(0, 5) : ""}`
        : "ตลอดทั้งวัน";
      return `
        <div class="flex items-center gap-4 p-4 bg-white rounded-2xl border border-slate-100 shadow-sm cursor-pointer hover:border-indigo-200 hover:bg-indigo-50 transition" data-event-id="${ev.event_id}">
          <span class="text-xs font-bold text-slate-400 w-28 flex-shrink-0">${timeStr}</span>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-bold text-slate-800 truncate">${ev.event_name || "—"}</p>
          </div>
          <span class="text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${status.cls}">${status.label}</span>
        </div>
      `;
    }).join("");

    return `
      <section>
        <div class="flex items-center gap-4 mb-4">
          <span class="text-sm font-black ${labelColorClass} px-3 py-1 rounded-lg">${dateLabel}</span>
          <div class="h-[1px] flex-1 bg-slate-100"></div>
          <span class="text-xs font-bold text-slate-300 uppercase tracking-widest">${dayLabel}</span>
        </div>
        <div class="grid grid-cols-1 gap-2">
          ${eventRows}
        </div>
      </section>
    `;
  }).join("");

  // Bind click on event rows -> open poster popup
  timeline.querySelectorAll("[data-event-id]").forEach((el) => {
    el.addEventListener("click", () => {
      const ev = eventsById[el.dataset.eventId];
      if (ev) openPosterPopup(ev);
    });
  });
}

// --- Poster Popup (uses shared ImgPopup component) ---
function openPosterPopup(ev) {
  const timeStr = ev.start_time
    ? `${ev.start_time.slice(0, 5)}${ev.end_time ? " – " + ev.end_time.slice(0, 5) : ""}`
    : "";
  const subtitle = formatDateThai(ev.event_date) + (timeStr ? ` • ${timeStr}` : "");
  const imgUrl = ev.poster_url || "";

  if (!imgUrl) return;

  ImgPopup.open([imgUrl], 0, {
    titles: [ev.event_name || "—"],
    skus: [subtitle],
  });
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
function bindUserAutocomplete(textId, hiddenId, datalistId) {
  const dl = document.getElementById(datalistId);
  const textInput = document.getElementById(textId);
  const hiddenInput = document.getElementById(hiddenId);
  if (!dl || !textInput || !hiddenInput) return;

  dl.innerHTML = users.map((u) => `<option value="${u.full_name}"></option>`).join("");

  // remove old listener by replacing element clone
  const fresh = textInput.cloneNode(true);
  textInput.parentNode.replaceChild(fresh, textInput);
  fresh.addEventListener("input", () => {
    const match = users.find((u) => u.full_name === fresh.value);
    hiddenInput.value = match ? String(match.user_id) : "";
  });
}

function populateBookerDropdown() {
  bindUserAutocomplete("inputBookerText", "inputBooker", "bookerList");
  bindUserAutocomplete("inputCsText", "inputCs", "csList");
}

function openModal(date = "", start = "") {
  const modal = document.getElementById("bookingModal");
  const initStart = start || "09:00";
  const initEnd = nextHour(initStart, 1);
  document.getElementById("inputDate").value = date || todayStr(0);
  document.getElementById("inputStart").value = initStart;
  document.getElementById("inputEnd").value = initEnd;
  populateBookerDropdown();
  const bt = document.getElementById("inputBookerText");
  if (bt) bt.value = "";
  document.getElementById("inputBooker").value = "";
  const ct = document.getElementById("inputCsText");
  if (ct) ct.value = "";
  document.getElementById("inputCs").value = "";
  buildStartGrid(initStart);
  buildEndGrid(initEnd);
  updateHeader();
  modal.classList.remove("hidden");
}

function closeModal() {
  document.getElementById("bookingModal").classList.add("hidden");
}

async function confirmBooking() {
  const bookerText = (document.getElementById("inputBookerText")?.value || "").trim();
  const csText     = (document.getElementById("inputCsText")?.value || "").trim();
  const date  = document.getElementById("inputDate").value;
  const start = document.getElementById("inputStart").value;
  const end   = document.getElementById("inputEnd").value;

  if (!bookerText || !date || !start || !end) {
    alert("กรุณากรอกข้อมูลให้ครบถ้วน");
    return;
  }
  if (end !== "ALLDAY" && start >= end) {
    alert("เวลาสิ้นสุดต้องหลังเวลาเริ่มต้น");
    return;
  }

  // lookup user_ids at submit time (avoids datalist timing issues)
  const bookerUser = users.find((u) => u.full_name === bookerText);
  const csUser     = users.find((u) => u.full_name === csText);

  const room = rooms.find((r) => String(r.place_id) === String(selectedRoomId));
  const btn = document.getElementById("btnConfirmBook");
  btn.disabled = true;
  btn.textContent = "กำลังบันทึก...";

  try {
    const code = await autoGenerateBookingCode();
    const payload = {
      request_code: code,
      place_id: selectedRoomId ? Number(selectedRoomId) : null,
      place_name: room ? room.place_name : selectedPlaceName || "",
      booked_by: bookerUser ? bookerUser.user_id : null,
      cs_id: csUser ? csUser.user_id : null,
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
    "?select=request_id,request_code,place_name,booked_by,booking_date,start_time,end_time,status,created_at&order=created_at.desc&limit=20"
  )) || [];
}

// --- Event Listeners ---
document.getElementById("searchRoom").addEventListener("input", (e) => {
  renderRoomList(e.target.value);
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

  // Dates that have events for the selected room
  const eventDates = new Set(
    roomEvents.filter((e) => e.status !== "CANCELLED").map((e) => e.event_date)
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
    const hasEvent = eventDates.has(dateStr);
    const dow = (firstDay + d - 1) % 7;

    let cls = "text-[11px] w-6 h-6 mx-auto flex items-center justify-center rounded-full cursor-pointer transition ";
    if (isToday) cls += "bg-indigo-600 text-white font-bold ";
    else if (hasEvent) cls += "bg-orange-100 text-orange-600 font-bold ";
    else if (dow === 0) cls += "text-red-400 hover:bg-red-50 ";
    else cls += "text-slate-600 hover:bg-indigo-50 ";

    html += `<div><span class="${cls}" data-date="${dateStr}">${d}</span></div>`;
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

  badge.textContent = roomBookings.length;

  if (roomBookings.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-400 text-center mt-4 italic">ยังไม่มีรายการ</p>`;
    return;
  }

  const statusMap = {
    PENDING:  { label: "รอดำเนินการ", cls: "bg-yellow-100 text-yellow-600" },
    APPROVED: { label: "อนุมัติ",      cls: "bg-green-100 text-green-600" },
    REJECTED: { label: "ปฏิเสธ",       cls: "bg-red-100 text-red-500" },
    CANCELLED:{ label: "ยกเลิก",       cls: "bg-slate-100 text-slate-400" },
  };

  container.innerHTML = roomBookings.map((r) => {
    const s = statusMap[r.status] || statusMap.PENDING;
    const bookerName = (users.find((u) => String(u.user_id) === String(r.booked_by)) || {}).full_name || "—";
    const timeStr = r.end_time === "ALLDAY" ? "ตลอดทั้งวัน"
      : `${r.start_time || ""}–${r.end_time || ""}`;
    return `
      <div class="bg-white rounded-xl border border-slate-100 p-3 shadow-sm">
        <div class="flex justify-between items-start gap-2">
          <p class="text-xs font-bold text-slate-800 leading-tight">${bookerName}</p>
          <span class="text-[9px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${s.cls}">${s.label}</span>
        </div>
        <p class="text-[10px] text-slate-500 mt-0.5">${r.place_name}</p>
        <p class="text-[10px] text-slate-400">${r.booking_date} • ${timeStr}</p>
        <p class="text-[10px] text-indigo-400 font-mono mt-0.5">${r.request_code}</p>
      </div>
    `;
  }).join("");
}

// --- Init ---
async function loadData() {
  const list = document.getElementById("roomList");
  list.innerHTML = `<p class="text-xs text-slate-400 text-center mt-6 italic">กำลังโหลด...</p>`;

  [rooms, users] = await Promise.all([
    sbFetch("places", "?select=*&place_type=eq.MEETING_ROOM&status=eq.ACTIVE&order=place_name.asc"),
    sbFetch("users", "?select=user_id,full_name&is_active=eq.true&order=full_name.asc"),
  ]);
  rooms = rooms || [];
  users = users || [];

  if (rooms.length && !selectedRoomId) {
    selectedRoomId = String(rooms[0].place_id);
    selectedPlaceName = rooms[0].place_name;
    await loadRoomEvents();
  }

  await loadRoomBookings();

  renderRoomList();
  renderTimeline();
  updateHeader();
  renderMiniCalendar();
  renderRequestList();
}

loadData();
