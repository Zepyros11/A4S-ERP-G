/* ============================================================
   events-booking.js — Room Booking Calendar
   แสดง events ที่ใช้สถานที่ประเภทห้องประชุม (places.place_type = MEETING_ROOM)
============================================================ */

const SB_URL_DEFAULT = "https://dtiynydgkcqausqktreg.supabase.co";
const SB_KEY_DEFAULT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0aXlueWRna2NxYXVzcWt0cmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyNjEwNTcsImV4cCI6MjA4NzgzNzA1N30.DmXwvBBvx3zK7rw21179ro65mTm0B4lQ20ktVMpAUQE";

// ── ROOM COLOR PALETTE ──────────────────────────────────────
const ROOM_COLORS = [
  "#6366f1", "#0ea5e9", "#10b981", "#f59e0b",
  "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6",
  "#f97316", "#84cc16",
];

// ── STATE ───────────────────────────────────────────────────
let allRooms     = [];   // places ที่ place_type = MEETING_ROOM
let allEvents    = [];   // events ที่ location ตรงกับห้องประชุม
let roomColorMap = {};   // { place_name: color }
let activeRoom   = "";   // place_name ที่ filter อยู่
let currentYear  = new Date().getFullYear();
let currentMonth = new Date().getMonth();

const MONTHS_TH = [
  "มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
  "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม",
];

// ── INIT ────────────────────────────────────────────────────
async function initPage() {
  await loadMeetingRooms();
  if (allRooms.length) {
    await loadEventsInRooms();
  }
  buildRoomColorMap();
  renderRoomChips();
  renderLegend();
  renderCalendar();
}

// ── DATA ────────────────────────────────────────────────────
async function loadMeetingRooms() {
  showLoading(true);
  try {
    const { url, key } = getSB();
    const res = await fetch(
      `${url}/rest/v1/places?select=*&place_type=eq.MEETING_ROOM&status=eq.ACTIVE&order=place_name.asc`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (res.status === 401 || res.status === 403) {
      showLoading(false);
      document.getElementById("noConfigBanner").style.display = "flex";
      openSettings();
      return;
    }
    if (!res.ok) throw new Error("Fetch failed: " + res.status);
    allRooms = await res.json();
  } catch (e) {
    showToast("โหลดห้องประชุมไม่ได้: " + e.message, "error");
    allRooms = [];
  }
  showLoading(false);
}

// ดึง events ทั้งหมด แล้ว filter client-side ตาม location = place_name
async function loadEventsInRooms() {
  try {
    const { url, key } = getSB();
    const res = await fetch(
      `${url}/rest/v1/events?select=*&order=event_date.asc`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!res.ok) throw new Error("Fetch failed: " + res.status);
    const allEvs = await res.json();

    const roomNames = new Set(allRooms.map(r => r.place_name));
    allEvents = allEvs.filter(e => e.location && roomNames.has(e.location));
  } catch (e) {
    showToast("โหลดกิจกรรมไม่ได้: " + e.message, "error");
    allEvents = [];
  }
}

// ── ROOM COLORS + CHIPS + LEGEND ────────────────────────────
function buildRoomColorMap() {
  allRooms.forEach((r, i) => {
    roomColorMap[r.place_name] = ROOM_COLORS[i % ROOM_COLORS.length];
  });
}

function renderRoomChips() {
  const wrap = document.getElementById("roomChips");
  const allBtn = wrap.querySelector('[data-room=""]');
  wrap.innerHTML = "";
  wrap.appendChild(allBtn);

  allRooms.forEach((r) => {
    const btn = document.createElement("button");
    btn.className = "epg-chip";
    btn.dataset.room = r.place_name;
    btn.textContent = `🏢 ${r.place_name}`;
    btn.onclick = () => setRoomFilter(btn, r.place_name);
    wrap.appendChild(btn);
  });
}

function renderLegend() {
  const legend = document.getElementById("roomLegend");
  legend.innerHTML = allRooms.map((r) => {
    const color = roomColorMap[r.place_name] || "#6366f1";
    const cap = r.capacity ? `${r.capacity} คน` : "";
    return `<div class="cal-legend-item">
      <div class="cal-legend-dot" style="background:${color}"></div>
      🏢 ${r.place_name}${cap ? ` <span style="color:#94a3b8">(${cap})</span>` : ""}
    </div>`;
  }).join("");
}

function setRoomFilter(btn, placeName) {
  document.querySelectorAll("#roomChips .epg-chip").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  activeRoom = placeName;
  renderCalendar();
}

// ── CALENDAR RENDER ──────────────────────────────────────────
function renderCalendar() {
  updateMonthLabel();
  const statusFilter = document.getElementById("filterStatus")?.value || "";

  const filtered = allEvents.filter((e) => {
    const matchRoom   = !activeRoom || e.location === activeRoom;
    const matchStatus = !statusFilter || e.status === statusFilter;
    return matchRoom && matchStatus;
  });

  // group by event_date
  const eventMap = {};
  filtered.forEach((e) => {
    const key = e.event_date; // YYYY-MM-DD
    if (!eventMap[key]) eventMap[key] = [];
    eventMap[key].push(e);
  });

  const firstDay    = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const _now  = new Date();
  const today = `${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,"0")}-${String(_now.getDate()).padStart(2,"0")}`;
  let cells = "";

  // leading empty cells
  for (let i = 0; i < firstDay; i++) {
    const prevDays = new Date(currentYear, currentMonth, 0).getDate();
    const d = prevDays - firstDay + i + 1;
    cells += `<div class="cal-cell other-month"><div class="cal-date-num">${d}</div></div>`;
  }

  // current month cells
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${currentYear}-${String(currentMonth+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
    const isToday   = dateStr === today;
    const dow       = new Date(currentYear, currentMonth, d).getDay();
    const isWeekend = dow === 0 || dow === 6;
    const dayEvs    = eventMap[dateStr] || [];

    const cls = ["cal-cell", isToday ? "today" : "", isWeekend ? "weekend-cell" : ""]
      .filter(Boolean).join(" ");

    const MAX_SHOW = 3;
    const shown = dayEvs.slice(0, MAX_SHOW);
    const extra = dayEvs.length - MAX_SHOW;

    const pillsHtml = shown.map((ev) => {
      const color   = roomColorMap[ev.location] || "#6366f1";
      const timeTxt = ev.start_time ? ev.start_time.slice(0,5) : "";
      const label   = ev.event_name || "—";
      return `<div class="bk-pill status-${ev.status}"
           style="background:${color}"
           onclick="openEventPanel(${ev.event_id});event.stopPropagation();"
           title="${label}">
           <div class="bk-pill-dot"></div>
           ${timeTxt ? `<span>${timeTxt}</span>` : ""}
           <span>${label}</span>
         </div>`;
    }).join("");

    const moreHtml = extra > 0
      ? `<div class="cal-more">+${extra} เพิ่มเติม</div>` : "";

    cells += `<div class="${cls}"><div class="cal-date-num">${d}</div><div class="cal-pills-wrap">${pillsHtml}${moreHtml}</div></div>`;
  }

  // trailing empty cells
  const totalCells = firstDay + daysInMonth;
  const remaining  = (7 - (totalCells % 7)) % 7;
  for (let d = 1; d <= remaining; d++) {
    cells += `<div class="cal-cell other-month"><div class="cal-date-num">${d}</div></div>`;
  }

  document.getElementById("calGrid").innerHTML = cells || `<div class="cal-empty">ไม่มีกิจกรรม</div>`;
}

function updateMonthLabel() {
  document.getElementById("calMonthLabel").textContent =
    `${MONTHS_TH[currentMonth]} ${currentYear + 543}`;
}

function changeMonth(delta) {
  currentMonth += delta;
  if (currentMonth > 11) { currentMonth = 0; currentYear++; }
  if (currentMonth < 0)  { currentMonth = 11; currentYear--; }
  renderCalendar();
}

function goToday() {
  currentYear  = new Date().getFullYear();
  currentMonth = new Date().getMonth();
  renderCalendar();
}

// ── EVENT DETAIL PANEL ───────────────────────────────────────
function openEventPanel(eventId) {
  const ev = allEvents.find(e => e.event_id === eventId);
  if (!ev) return;

  const color = roomColorMap[ev.location] || "#6366f1";

  // room bar
  document.getElementById("bkRoomBar").style.background = color;
  document.getElementById("bkRoomName").textContent = ev.location || "—";
  const room = allRooms.find(r => r.place_name === ev.location);
  const cap = room?.capacity ? `${room.capacity} คน` : "";
  document.getElementById("bkRoomMeta").textContent = cap;

  // event name
  document.getElementById("bkTopic").textContent = ev.event_name || "—";

  // status (event status)
  const statusLabels = {
    DRAFT: "📝 Draft", CONFIRMED: "✅ Confirmed",
    ONGOING: "🔄 Ongoing", DONE: "✔️ Done", CANCELLED: "❌ Cancelled",
  };
  document.getElementById("bkStatus").innerHTML =
    `<span class="bk-status-badge status-${ev.status}">${statusLabels[ev.status] || ev.status}</span>`;

  // date (รองรับ end_date)
  const dateText = ev.end_date && ev.end_date !== ev.event_date
    ? `${formatDate(ev.event_date)} — ${formatDate(ev.end_date)}`
    : formatDate(ev.event_date);
  document.getElementById("bkDate").textContent = dateText;

  // time
  const t1 = ev.start_time ? ev.start_time.slice(0,5) : "—";
  const t2 = ev.end_time   ? ev.end_time.slice(0,5)   : "";
  document.getElementById("bkTime").textContent = t2 ? `${t1} — ${t2} น.` : `${t1} น.`;

  // event type
  const evRow = document.getElementById("bkEventRow");
  if (ev.event_type) {
    document.getElementById("bkEvent").textContent = ev.event_type;
    evRow.style.display = "flex";
  } else {
    evRow.style.display = "none";
  }

  // description
  const noteRow = document.getElementById("bkNoteRow");
  if (ev.description) {
    document.getElementById("bkNote").textContent = ev.description;
    noteRow.style.display = "flex";
  } else {
    noteRow.style.display = "none";
  }

  document.getElementById("bkPanelOverlay").style.display = "flex";
  document.body.style.overflow = "hidden";
}

function closeBookingPanel() {
  document.getElementById("bkPanelOverlay").style.display = "none";
  document.body.style.overflow = "";
}

// ── SETTINGS ────────────────────────────────────────────────
function openSettings() {
  const { url, key } = getSB();
  document.getElementById("inputSbUrl").value = url;
  document.getElementById("inputSbKey").value = key;
  document.getElementById("settingsStatus").className = "settings-status";
  document.getElementById("settingsStatus").textContent = "";
  document.getElementById("settingsOverlay").classList.add("open");
}
function closeSettings() {
  document.getElementById("settingsOverlay").classList.remove("open");
}
function handleOverlayClick(e) {
  if (e.target === document.getElementById("settingsOverlay")) closeSettings();
}
function saveSettings() {
  const url = document.getElementById("inputSbUrl").value.trim();
  const key = document.getElementById("inputSbKey").value.trim();
  if (!url || !key) { showStatus("กรุณากรอก URL และ Key ให้ครบ", "err"); return; }
  localStorage.setItem("sb_url", url);
  localStorage.setItem("sb_key", key);
  showStatus("✅ บันทึกแล้ว — กำลังโหลดข้อมูล...", "ok");
  document.getElementById("noConfigBanner").style.display = "none";
  setTimeout(async () => {
    closeSettings();
    await loadMeetingRooms();
    await loadEventsInRooms();
    buildRoomColorMap();
    renderRoomChips();
    renderLegend();
    renderCalendar();
  }, 800);
}
async function testConnection() {
  const url = document.getElementById("inputSbUrl").value.trim();
  const key = document.getElementById("inputSbKey").value.trim();
  if (!url || !key) { showStatus("กรุณากรอก URL และ Key", "err"); return; }
  showStatus("กำลังทดสอบ...", "ok");
  try {
    const res = await fetch(`${url}/rest/v1/places?select=place_id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    if (res.ok) showStatus("✅ เชื่อมต่อสำเร็จ!", "ok");
    else showStatus(`❌ เชื่อมต่อไม่ได้ (${res.status})`, "err");
  } catch (e) {
    showStatus("❌ " + e.message, "err");
  }
}
function showStatus(msg, type) {
  const el = document.getElementById("settingsStatus");
  el.textContent = msg;
  el.className = `settings-status ${type}`;
}

// ── HELPERS ──────────────────────────────────────────────────
function getSB() {
  const storedUrl = localStorage.getItem("sb_url") || "";
  const storedKey = localStorage.getItem("sb_key") || "";
  const isValidKey = storedKey.startsWith("eyJ") && storedKey.length > 100;
  return {
    url: storedUrl || SB_URL_DEFAULT,
    key: isValidKey ? storedKey : SB_KEY_DEFAULT,
  };
}

function formatDate(d) {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  const months = ["","ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
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

// ── ESC ───────────────────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (document.getElementById("settingsOverlay").classList.contains("open")) {
    closeSettings();
  } else if (document.getElementById("bkPanelOverlay").style.display === "flex") {
    closeBookingPanel();
  }
});

// ── START ─────────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPage);
} else {
  initPage();
}
