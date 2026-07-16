/* ============================================================
   events-calendar.js — Controller for Calendar page
============================================================ */

const SB_URL_DEFAULT = "https://dtiynydgkcqausqktreg.supabase.co";
const SB_KEY_DEFAULT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0aXlueWRna2NxYXVzcWt0cmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyNjEwNTcsImV4cCI6MjA4NzgzNzA1N30.DmXwvBBvx3zK7rw21179ro65mTm0B4lQ20ktVMpAUQE";

let allEvents = [];
let allCategories = [];
let allBookings = [];
let allRooms = []; // place_rooms — สำหรับ submenu เลือกห้องตอนกด "จองห้อง"
let _calSeriesMap = {};
let _calLevelMap = {};
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let activeCalCatId = "";
let _didFocusToday = false;

/* ── Chat Panel ── */
let _chatEventId = null;
let _chatPollTimer = null;
let _chatLastSig = "";

function getCalSenderName() {
  const u = window.ERP_USER;
  if (!u) return "Admin";
  return u.full_name || [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || "Admin";
}

/* ── Unread badge cache ── */
let _calChatCache = {}; // { [event_id]: { total, latest } }

async function refreshCalChatCounts() {
  if (!allEvents.length) return;
  const { url, key } = getSB();
  const ids = allEvents.map((e) => e.event_id).join(",");
  try {
    const res = await fetch(
      `${url}/rest/v1/event_chat_logs?event_id=in.(${ids})&select=event_id,created_at`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const logs = await res.json();
    const map = {};
    (logs || []).forEach((l) => {
      const id = l.event_id;
      if (!map[id]) map[id] = { total: 0, latest: "", timestamps: [] };
      map[id].total++;
      map[id].timestamps.push(l.created_at);
      if (l.created_at > map[id].latest) map[id].latest = l.created_at;
    });
    const prev = JSON.stringify(_calChatCache);
    _calChatCache = map;
    if (JSON.stringify(map) !== prev) renderCalendar();
  } catch {}
}

function getCalUnread(eventId) {
  const info = _calChatCache[eventId];
  if (!info || info.total === 0) return 0;
  const seenAt = localStorage.getItem(`evChat_cs_seen_${eventId}`) || "";
  return info.timestamps.filter(t => t > seenAt).length;
}
function getCalTotal(eventId) {
  const info = _calChatCache[eventId];
  return info ? info.total : 0;
}

function markCalChatRead(eventId, logs) {
  const latest = (logs || []).reduce((m, l) => (l.created_at > m ? l.created_at : m), "");
  localStorage.setItem(`evChat_cs_seen_${eventId}`, latest);
  if (!_calChatCache[eventId]) _calChatCache[eventId] = { total: 0, latest: "", timestamps: [] };
  _calChatCache[eventId].total = (logs || []).length;
  _calChatCache[eventId].timestamps = (logs || []).map(l => l.created_at);
  if (latest) _calChatCache[eventId].latest = latest;
}

const MONTHS_TH = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];

async function initPage() {
  // แสดงวันที่บน topbar
  const now = new Date();
  const dateEl = document.getElementById("calTopbarDate");
  if (dateEl) {
    dateEl.textContent = formatDate(toDateStr(now));
  }
  await Promise.all([loadEvents(), loadCategories(), loadBookings(), loadRooms()]);
  renderCalendar();
  await refreshCalChatCounts();
  setInterval(refreshCalChatCounts, 15000);
}

async function loadEvents() {
  showLoading(true);
  try {
    const { url, key } = getSB();
    const res = await fetch(
      `${url}/rest/v1/events?select=*&order=event_date.asc`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (res.status === 401 || res.status === 403) {
      showLoading(false);
      document.getElementById("noConfigBanner").style.display = "flex";
      showStatus("❌ Key ไม่ถูกต้อง — กรุณากรอกใหม่", "err");
      openSettings();
      return;
    }
    if (!res.ok) throw new Error("Fetch failed: " + res.status);
    allEvents = await res.json();
    // Load course series + levels
    try {
      const [sRes, lRes] = await Promise.all([
        fetch(`${url}/rest/v1/course_series?select=id,name,icon,color`, { headers: { apikey: key, Authorization: `Bearer ${key}` } }),
        fetch(`${url}/rest/v1/course_levels?select=id,series_id,level_name,level_order,prerequisite_level_id,description`, { headers: { apikey: key, Authorization: `Bearer ${key}` } }),
      ]);
      const series = sRes.ok ? await sRes.json() : [];
      const levels = lRes.ok ? await lRes.json() : [];
      _calSeriesMap = Object.fromEntries(series.map(s => [s.id, s]));
      _calLevelMap = Object.fromEntries(levels.map(l => [l.id, l]));
    } catch {}
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
    allEvents = [];
  }
  showLoading(false);
}

async function loadBookings() {
  try {
    const { url, key } = getSB();
    const res = await fetch(
      `${url}/rest/v1/room_booking_requests?status=eq.APPROVED&select=*&order=booking_date.asc`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (res.ok) allBookings = await res.json();
  } catch (_) {
    allBookings = [];
  }
}

async function loadRooms() {
  try {
    const { url, key } = getSB();
    const headers = { apikey: key, Authorization: `Bearer ${key}` };
    // เอาเฉพาะห้องของ "A4S สำนักงานใหญ่"
    const pRes = await fetch(`${url}/rest/v1/places?select=place_id,place_name`, { headers });
    const places = pRes.ok ? await pRes.json() : [];
    const hq = places.find((p) => /ใหญ่/.test(p.place_name || ""));
    if (!hq) {
      allRooms = [];
      return;
    }
    const res = await fetch(
      `${url}/rest/v1/place_rooms?place_id=eq.${hq.place_id}&select=room_id,room_name,place_id&order=room_name.asc`,
      { headers },
    );
    if (res.ok) allRooms = await res.json();
  } catch (_) {
    allRooms = [];
  }
}

function formatBookingTime(b) {
  if (b.end_time === "ALLDAY" || (!b.start_time && !b.end_time)) return "ตลอดทั้งวัน";
  const s = (b.start_time || "").slice(0, 5);
  const e = (b.end_time || "").slice(0, 5);
  if (s && e) return `${s} – ${e}`;
  return s || e || "—";
}

async function loadCategories() {
  try {
    const { url, key } = getSB();
    const res = await fetch(
      `${url}/rest/v1/event_categories?select=*&order=sort_order.asc`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (res.ok) allCategories = await res.json();
  } catch (_) {}

  // inject category dropdown menu
  const ddMenu = document.getElementById("calCatDDMenu");
  if (ddMenu) {
    const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const items = [
      `<button type="button" class="cal-dd-item" onclick="selectCatDD('','ทั้งหมด','')"><span class="epg-dot" style="background:#94a3b8"></span>ทั้งหมด</button>`,
    ];
    allCategories.forEach((cat) => {
      const label = `${cat.icon || ""} ${cat.category_name}`.trim();
      const color = cat.color || "#94a3b8";
      items.push(
        `<button type="button" class="cal-dd-item" onclick="selectCatDD('${cat.event_category_id}','${esc(label)}','${color}')"><span class="epg-dot" style="background:${color}"></span>${label}</button>`,
      );
    });
    ddMenu.innerHTML = items.join("");
  }

}

function toggleCatDD(e) {
  if (e) e.stopPropagation();
  document.getElementById("calCatDD")?.classList.toggle("open");
}
function selectCatDD(catId, label, color) {
  activeCalCatId = catId;
  const lbl = document.getElementById("calCatLabelSel");
  const dot = document.getElementById("calCatDotSel");
  if (lbl) lbl.textContent = label;
  if (dot) {
    if (catId) {
      dot.style.display = "";
      dot.style.background = color || "#94a3b8";
    } else {
      dot.style.display = "none";
    }
  }
  document.getElementById("calCatDD")?.classList.remove("open");
  renderCalendar();
}
// ปิด dropdown เมื่อคลิกนอกกรอบ
document.addEventListener("click", (e) => {
  const dd = document.getElementById("calCatDD");
  if (dd && !dd.contains(e.target)) dd.classList.remove("open");
});

function getCatStyle(event) {
  const cat = allCategories.find((c) => c.event_category_id === event.event_category_id);
  const color = cat?.color || "#5b8a6e";
  const icon = cat?.icon || "📌";
  const name = cat?.category_name || "อื่นๆ";
  return { color, icon, name };
}

function renderCalendar() {
  updateMonthLabel();
  const filtered = allEvents.filter(
    (e) =>
      e.status !== "CANCELLED" &&
      (!activeCalCatId || String(e.event_category_id) === activeCalCatId),
  );

  const _now = new Date();
  const todayStr = toDateStr(_now);

  // ── Build visible dates (fill to full weeks) ──────────────
  const firstDOW = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const visibleDates = [];

  for (let i = 0; i < firstDOW; i++) {
    const d = new Date(currentYear, currentMonth, 1 - (firstDOW - i));
    visibleDates.push({ dateStr: toDateStr(d), day: d.getDate(), inMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    visibleDates.push({
      dateStr: `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      day: d,
      inMonth: true,
    });
  }
  const totalCells = firstDOW + daysInMonth;
  const remaining = (7 - (totalCells % 7)) % 7;
  for (let d = 1; d <= remaining; d++) {
    const dt = new Date(currentYear, currentMonth + 1, d);
    visibleDates.push({ dateStr: toDateStr(dt), day: d, inMonth: false });
  }

  // ── Split into week rows ──────────────────────────────────
  const weeks = [];
  for (let i = 0; i < visibleDates.length; i += 7) {
    weeks.push(visibleDates.slice(i, i + 7));
  }

  let html = "";
  weeks.forEach((week) => {
    const weekStart = week[0].dateStr;
    const weekEnd = week[6].dateStr;

    // Multi-day events: end_date > event_date AND overlaps this week
    const multiDayAll = filtered.filter((e) => {
      const eEnd = e.end_date || e.event_date;
      return eEnd > e.event_date && e.event_date <= weekEnd && eEnd >= weekStart;
    });
    // แยกตามเวลา: เต็มวัน/คร่อมเที่ยง → แท่งยาวต่อเนื่อง · เช้า/บ่ายเฉพาะ → pill รายวันในช่องที่ถูก
    const multiDayEvts = []; // full → span bars
    const dayHalfMap = {}; // dateStr -> [event] (multi-day เช้า/บ่าย แยกต่อวัน)
    multiDayAll.forEach((e) => {
      if (dayItemSlot(e.start_time, e.end_time) === "full") {
        multiDayEvts.push(e);
        return;
      }
      const eEnd = e.end_date || e.event_date;
      week.forEach((d) => {
        if (d.dateStr >= e.event_date && d.dateStr <= eEnd) {
          if (!dayHalfMap[d.dateStr]) dayHalfMap[d.dateStr] = [];
          dayHalfMap[d.dateStr].push(e);
        }
      });
    });

    // Single-day events mapped by date
    const singleMap = {};
    filtered.forEach((e) => {
      const eEnd = e.end_date || e.event_date;
      if (eEnd === e.event_date && e.event_date >= weekStart && e.event_date <= weekEnd) {
        if (!singleMap[e.event_date]) singleMap[e.event_date] = [];
        singleMap[e.event_date].push(e);
      }
    });

    // Approved bookings by date (only when no category filter is active — bookings are orthogonal to event categories)
    const bookingMap = {};
    if (!activeCalCatId) {
      allBookings.forEach((b) => {
        const d = b.booking_date;
        if (!d || d < weekStart || d > weekEnd) return;
        if (!bookingMap[d]) bookingMap[d] = [];
        bookingMap[d].push(b);
      });
    }

    // Assign stacking lanes for multi-day bars
    const lanes = assignLanes(multiDayEvts, week);
    const numLanes = lanes.length;

    // ── Span bars (grid-row 1..numLanes) ────────────────────
    const barsHtml = lanes
      .flatMap((lane, laneIdx) =>
        lane.map(({ event: e, colStart, colEnd }) => {
          const { color, icon } = getCatStyle(e);
          const eEnd = e.end_date || e.event_date;
          const isStart = e.event_date >= weekStart;
          const isEnd = eEnd <= weekEnd;
          const rTL = isStart ? "8px" : "0";
          const rBL = isStart ? "8px" : "0";
          const rTR = isEnd ? "8px" : "0";
          const rBR = isEnd ? "8px" : "0";
          const barUnread = getCalUnread(e.event_id);
          const barTotal = getCalTotal(e.event_id);
          const barBadge = barUnread > 0
            ? `<span class="cal-unread-badge">${barUnread}</span>`
            : barTotal > 0
              ? `<span class="cal-unread-badge cal-read-badge">${barTotal}</span>`
              : "";
          // เลขห้อง — แสดงชิดขวา "ทุกวัน" ที่ bar พาดผ่านในสัปดาห์นี้
          const barRoomNo = extractRoomNo(e.location);
          const span = colEnd - colStart + 1;
          let barRoomChips = "";
          if (barRoomNo) {
            const rn = /^\d+$/.test(barRoomNo) ? " room-" + barRoomNo : "";
            for (let d = 0; d < span; d++) {
              const rightPct = ((span - d - 1) / span) * 100;
              barRoomChips += `<span class="cal-pill-room cal-bar-room${rn}" style="right:calc(${rightPct}% + 6px)">${barRoomNo}</span>`;
            }
          }
          // ช่วง bar ที่อยู่ในวันเดือนอื่นทั้งหมด → จางลง (เหมือน pill เดือนอื่น)
          const segDim = week.slice(colStart, colEnd + 1).every((d) => !d.inMonth);
          return `<div class="cal-span-bar${segDim ? " cal-dim" : ""}"
            style="grid-column:${colStart + 1}/${colEnd + 2};grid-row:${laneIdx + 2};
                   background:${color};color:#fff;
                   border-radius:${rTL} ${rTR} ${rBR} ${rBL};
                   margin:2px ${isEnd ? "10px" : "0"} 1px ${isStart ? "10px" : "0"};"
            onclick="openEventPanel(${e.event_id})"
            title="${e.event_name}">
            ${!isStart ? `<span class="cal-bar-cont cal-bar-cont-l">‹</span>` : ""}${isStart ? `<span class="cal-bar-text">${icon} ${eventLabel(e)}</span>` : ""}${barRoomChips}${!isEnd ? `<span class="cal-bar-cont cal-bar-cont-r">›</span>` : ""}${barBadge}
          </div>`;
        })
      )
      .join("");

    // ── Date-number header row (grid-row 1) — วันที่อยู่บนสุด ──
    const dateRowHtml = week
      .map(({ dateStr, day, inMonth }, colIdx) => {
        const isToday = dateStr === todayStr;
        const dow = new Date(dateStr + "T00:00:00").getDay();
        const isWeekend = dow === 0 || dow === 6;
        const cls = [
          "cal-daterow",
          !inMonth ? "other-month" : "",
          isToday ? "today" : "",
          isWeekend ? "weekend-cell" : "",
          colIdx === 6 ? "col-last" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return `<div class="${cls}" style="grid-column:${colIdx + 1};grid-row:1"><span class="cal-date-num">${day}</span></div>`;
      })
      .join("");

    // ── Day cells (grid-row = numLanes+2, below date row + bars) ──
    const cellRow = numLanes + 2;
    // pills fit per cell — derived from cell min-height (150px) minus date offset (32px) minus lane bars (24px each), at ~22px per pill
    const MAX_PILLS = numLanes >= 4 ? 1 : numLanes === 3 ? 2 : numLanes === 2 ? 3 : numLanes === 1 ? 4 : 5;
    const cellsHtml = week
      .map(({ dateStr, day, inMonth }, colIdx) => {
        const isToday = dateStr === todayStr;
        const dow = new Date(dateStr + "T00:00:00").getDay();
        const isWeekend = dow === 0 || dow === 6;
        // event รายวัน + multi-day เช้า/บ่าย (แยกต่อวัน)
        const dayEvents = [...(singleMap[dateStr] || []), ...(dayHalfMap[dateStr] || [])];
        const dayBookings = bookingMap[dateStr] || [];
        const cls = [
          "cal-cell",
          !inMonth ? "other-month" : "",
          isToday ? "today" : "",
          isWeekend ? "weekend-cell" : "",
          colIdx === 6 ? "col-last" : "",
        ]
          .filter(Boolean)
          .join(" ");
        // รวม event + booking → กำหนด slot เวลา (เช้า/บ่าย/เต็มวัน)
        const dayItems = [
          ...dayEvents.map((ev) => ({
            kind: "event", ev, room: extractRoomNo(ev.location),
            slot: dayItemSlot(ev.start_time, ev.end_time),
          })),
          ...dayBookings.map((b) => ({
            kind: "booking", b, room: extractRoomNo(b.room_name || b.place_name || ""),
            slot: dayItemSlot(b.start_time, b.end_time),
          })),
        ];
        // เรียงตามห้องภายในแต่ละกลุ่ม
        const byRoom = (a, z) => roomSortKey(a.room) - roomSortKey(z.room);
        const morning = dayItems.filter((i) => i.slot === "am").sort(byRoom);
        const afternoon = dayItems.filter((i) => i.slot === "pm").sort(byRoom);
        const fullDay = dayItems.filter((i) => i.slot === "full").sort(byRoom);

        // งบจำนวนแถว: เต็มวันกินเต็มแถว, เช้า/บ่ายวางคู่กัน (นับ 1 แถวต่อคู่)
        const fullShown = fullDay.slice(0, MAX_PILLS);
        const halfBudget = Math.max(0, MAX_PILLS - fullShown.length);
        const amShown = morning.slice(0, halfBudget);
        const pmShown = afternoon.slice(0, halfBudget);
        const extra = dayItems.length - fullShown.length - amShown.length - pmShown.length;

        const amHtml = amShown.map(renderDayPill).join("");
        const pmHtml = pmShown.map(renderDayPill).join("");
        const fullHtml = fullShown.map(renderDayPill).join("");
        const halvesHtml = amHtml || pmHtml
          ? `<div class="cal-half-row"><div class="cal-half cal-half-am">${amHtml}</div><div class="cal-half cal-half-pm">${pmHtml}</div></div>`
          : "";
        const moreHtml = extra > 0 ? `<div class="cal-more" onclick="openDayPopup('${dateStr}');event.stopPropagation()">+${extra}</div>` : "";
        return `<div class="${cls}" data-col="${colIdx + 1}" style="grid-column:${colIdx + 1};grid-row:${cellRow}"><button class="cal-add-btn" title="เพิ่ม" onclick="openCellMenu(event,'${dateStr}')">+</button><div class="cal-pills-wrap">${halvesHtml}${fullHtml}${moreHtml}</div></div>`;
      })
      .join("");

    // กรอบวันปัจจุบัน — เลเยอร์คลุมทั้งคอลัมน์ (วันที่ + bar + เนื้อหา) เป็นกรอบเดียว
    const todayCol = week.findIndex((d) => d.dateStr === todayStr);
    const todayLayerHtml = todayCol >= 0
      ? `<div class="cal-today-bg" style="grid-column:${todayCol + 1};grid-row:1/-1"></div>` +
        `<div class="cal-today-frame" style="grid-column:${todayCol + 1};grid-row:1/-1"></div>`
      : "";

    // Single grid: bars + cells share the same 7-col grid → perfect column alignment
    const rowTemplate = numLanes > 0
      ? `style="grid-template-rows:auto repeat(${numLanes},var(--cal-lane-h)) auto"`
      : `style="grid-template-rows:auto auto"`;
    html += `<div class="cal-week-row" ${rowTemplate}>${todayLayerHtml}${dateRowHtml}${barsHtml}${cellsHtml}</div>`;
  });

  document.getElementById("calGrid").innerHTML =
    html || `<div class="cal-empty">ไม่มีกิจกรรม</div>`;

  // ── First-load: scroll today into view + pulse animation ──
  if (!_didFocusToday) {
    const todayCell = document.querySelector(".cal-cell.today");
    if (todayCell) {
      _didFocusToday = true;
      requestAnimationFrame(() => {
        todayCell.scrollIntoView({ behavior: "smooth", block: "center" });
        todayCell.classList.add("focus-anim");
        setTimeout(() => todayCell.classList.remove("focus-anim"), 1800);
      });
    }
  }
}

// ── Helpers ────────────────────────────────────────────────
function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ดึงเลขห้องจาก location เช่น "A4S สนง.ใหญ่ — ห้อง 2" → "2"
function extractRoomNo(location) {
  if (!location) return "";
  const m = String(location).match(/ห้อง\s*(\S+)/);
  return m ? m[1] : "";
}

// ชื่อ event ยาว (≥3 คำ) → ย่อเป็นอักษรตัวขึ้นต้นของแต่ละคำ
// เช่น "UNLOCK THE WORLD : Online" → "UTWO" (ข้าม token ที่เป็นเครื่องหมายล้วน เช่น : &)
function eventShortName(name) {
  const words = String(name || "")
    .trim()
    .split(/\s+/)
    .filter((w) => /[A-Za-z0-9ก-๙]/.test(w));
  if (words.length < 3) return name; // สั้นอยู่แล้ว แสดงเต็ม
  return words.map((w) => w[0].toUpperCase()).join("");
}

// ข้อความบน pill/bar: type "วันหยุดบริษัท" → แสดงชื่อ type · อื่นๆ → ย่อชื่อ event
function eventLabel(ev) {
  const cat = allCategories.find((c) => c.event_category_id === ev.event_category_id);
  const catName = cat?.category_name || "";
  if (/วันหยุด/.test(catName)) return catName;
  return eventShortName(ev.event_name);
}

// ชิปเลขห้อง — ห้อง 1/2/3 ใช้สีต่างกัน (class room-N)
function roomChipHtml(roomNo) {
  if (!roomNo) return "";
  const cls = /^\d+$/.test(roomNo) ? ` room-${roomNo}` : "";
  return `<span class="cal-pill-room${cls}">${roomNo}</span>`;
}

// ลำดับห้องในเซลล์: ไม่ระบุห้อง → 1 → 2 → 3 (ห้องที่ไม่ใช่ตัวเลขไปท้ายสุด)
function roomSortKey(roomNo) {
  if (!roomNo) return -1;
  return /^\d+$/.test(roomNo) ? parseInt(roomNo, 10) : 9999;
}

// แบ่งช่วงเวลาในวัน: เช้า(am)/บ่าย(pm)/เต็มวัน(full) ตัดที่ 12:00
// จบถึง 12:00 = เช้า · เริ่มตั้งแต่ 12:00 = บ่าย · คร่อมเที่ยง/ทั้งวัน/ไม่ระบุ = เต็ม
function dayItemSlot(start, end) {
  if (!start || !end || end === "ALLDAY") return "full";
  const s = String(start).slice(0, 5);
  const e = String(end).slice(0, 5);
  if (!s || !e) return "full";
  if (e <= "12:00") return "am";
  if (s >= "12:00") return "pm";
  return "full";
}

// render pill เดียว (event หรือ booking) — ใช้ร่วมทุก slot
function renderDayPill(item) {
  if (item.kind === "event") {
    const ev = item.ev;
    const { color, icon } = getCatStyle(ev);
    const pillUnread = getCalUnread(ev.event_id);
    const pillTotal = getCalTotal(ev.event_id);
    const pillBadge = pillUnread > 0
      ? `<span class="cal-unread-badge">${pillUnread}</span>`
      : pillTotal > 0
        ? `<span class="cal-unread-badge cal-read-badge">${pillTotal}</span>`
        : "";
    const roomChip = roomChipHtml(item.room);
    return `<div class="cal-event-pill"
      style="background:${color};color:#fff;"
      onclick="openEventPanel(${ev.event_id});event.stopPropagation();"
      title="${ev.event_name}"><span class="cal-pill-text">${icon} ${eventLabel(ev)}</span>${roomChip}${pillBadge}</div>`;
  }
  const b = item.b;
  const label = b.room_name || b.place_name || "ห้องจอง";
  const roomNo = item.room;
  const booker = b.booked_by_name || "";
  let text, roomChip = "";
  if (roomNo) {
    text = booker || `ห้อง ${roomNo}`;
    roomChip = roomChipHtml(roomNo);
  } else {
    text = booker ? `${booker} (${label})` : label;
  }
  const tip = `${label} · ${formatBookingTime(b)}${booker ? " · " + booker : ""}`;
  return `<div class="cal-event-pill cal-booking-pill"
    onclick="openBookingPanel(${b.request_id});event.stopPropagation();"
    title="${tip}"><span class="cal-pill-text">${text}</span>${roomChip}</div>`;
}

function assignLanes(events, week) {
  if (!events.length) return [];
  const weekStart = week[0].dateStr;
  const weekEnd = week[6].dateStr;
  const sorted = [...events].sort((a, b) =>
    a.event_date.localeCompare(b.event_date)
  );
  const lanes = [];
  sorted.forEach((e) => {
    const eStart = e.event_date > weekStart ? e.event_date : weekStart;
    const eEnd =
      (e.end_date || e.event_date) < weekEnd
        ? e.end_date || e.event_date
        : weekEnd;
    const colStart = week.findIndex((d) => d.dateStr === eStart);
    const colEnd = week.findIndex((d) => d.dateStr === eEnd);
    if (colStart === -1 || colEnd === -1) return;
    let placed = false;
    for (let i = 0; i < lanes.length; i++) {
      const overlaps = lanes[i].some(
        (item) => !(item.colEnd < colStart || item.colStart > colEnd)
      );
      if (!overlaps) {
        lanes[i].push({ event: e, colStart, colEnd });
        placed = true;
        break;
      }
    }
    if (!placed) lanes.push([{ event: e, colStart, colEnd }]);
  });
  return lanes;
}

function updateMonthLabel() {
  document.getElementById("calMonthLabel").textContent =
    `${MONTHS_TH[currentMonth]} ${currentYear + 543}`;
}

function changeMonth(delta) {
  currentMonth += delta;
  if (currentMonth > 11) {
    currentMonth = 0;
    currentYear++;
  }
  if (currentMonth < 0) {
    currentMonth = 11;
    currentYear--;
  }
  renderCalendar();
}
function goToday() {
  currentYear = new Date().getFullYear();
  currentMonth = new Date().getMonth();
  _didFocusToday = false;
  renderCalendar();
}

function editEvent(eventId) {
  window.open(`../event-form.html?id=${eventId}`, "_blank", "noopener");
}

function openEventPanel(eventId) {
  const e = allEvents.find((ev) => ev.event_id === eventId);
  if (!e) return;
  document.getElementById("panelPoster").innerHTML = e.poster_url
    ? `<img src="${e.poster_url}" alt="${e.event_name}">`
    : `<img src="../../../assets/images/NoPoster.png" alt="No Poster">`;
  document.getElementById("panelName").textContent = e.event_name;
  document.getElementById("panelCode").textContent = e.event_code || "";
  document.getElementById("panelStatus").innerHTML =
    `<span class="event-status-badge status-${e.status}">${statusLabel(e.status)}</span>`;
  const { color: catColor, icon: catIcon, name: catName } = getCatStyle(e);
  document.getElementById("panelType").innerHTML =
    `<span class="event-type-badge" style="background:${catColor}22;color:${catColor};border:1px solid ${catColor}55">${catIcon} ${catName}</span>`;
  document.getElementById("panelDate").textContent =
    formatDate(e.event_date) +
    (e.end_date && e.end_date !== e.event_date
      ? ` — ${formatDate(e.end_date)}`
      : "");
  document.getElementById("panelTime").textContent =
    e.start_time && e.end_time
      ? `${e.start_time.slice(0, 5)} — ${e.end_time.slice(0, 5)} น.`
      : "—";
  document.getElementById("panelLocation").textContent = e.location || "—";
  document.getElementById("panelDesc").textContent = e.description || "—";

  // Registration badges
  const panelCode = document.getElementById("panelCode");
  if (panelCode) {
    let regHtml = '';
    if (e.registration_enabled) regHtml += `<a href="../attendees.html?event=${e.event_id}" target="_blank" rel="noopener" title="ดูรายชื่อผู้ลงทะเบียน" class="ev-reg-badge reg-on is-link">📋 กดลงทะเบียน</a>`;
    if (e.members_only) regHtml += '<span class="ev-reg-badge reg-mlm">👤 MLM Only</span>';
    regHtml += `<button class="ev-edit-btn" onclick="editEvent(${e.event_id})" title="แก้ไขกิจกรรม" aria-label="แก้ไข">✏️</button>`;
    panelCode.insertAdjacentHTML('beforeend', regHtml);
  }

  // Prereq accordion
  const prereqBox = document.getElementById("panelPrereq");
  if (e.series_id && e.level_id && _calLevelMap[e.level_id]) {
    const lv = _calLevelMap[e.level_id];
    const series = _calSeriesMap[e.series_id];
    const color = series?.color || '#3b82f6';
    const icon = (series?.icon && !series.icon.includes(':')) ? series.icon : '📚';
    let detailHtml = '';
    if (lv.prerequisite_level_id && _calLevelMap[lv.prerequisite_level_id]) {
      detailHtml += `<div style="padding:4px 0">🔒 ต้องผ่าน: <b>${_calLevelMap[lv.prerequisite_level_id].level_name}</b></div>`;
    }
    if (lv.description) detailHtml += `<div style="padding:4px 0">📝 ${lv.description}</div>`;
    if (!detailHtml) detailHtml = '<div style="padding:4px 0;color:#64748b">🟢 ไม่มีเงื่อนไขเพิ่มเติม</div>';
    prereqBox.innerHTML = `
      <div onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none';this.querySelector('.arr').textContent=this.nextElementSibling.style.display==='none'?'▾':'▴'"
        style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:6px;background:${color}12;border:1px solid ${color}30;cursor:pointer;font-size:11.5px;font-weight:600;color:${color};user-select:none">
        ${icon} ${series?.name || ''} · Lv.${lv.level_order} ${lv.level_name} <span class="arr" style="font-size:10px;margin-left:2px">▴</span>
      </div>
      <div style="margin-top:6px;padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:11.5px;line-height:1.7;color:#334155">${detailHtml}</div>`;
    prereqBox.style.display = "block";
  } else {
    prereqBox.style.display = "none";
  }

  const msgBtn = document.getElementById("panelBtnMsg");
  msgBtn.onclick = () => openChatPanel(e.event_id, e.event_name);
  const calUnread = getCalUnread(e.event_id);
  const calTotal = getCalTotal(e.event_id);
  msgBtn.innerHTML = calUnread > 0
    ? `💬 Message <span style="background:#ef4444;color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;margin-left:4px">${calUnread}</span>`
    : calTotal > 0
      ? `💬 Message <span style="background:#e2e8f0;color:#64748b;font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;margin-left:4px">${calTotal}</span>`
      : `💬 Message`;
  document.getElementById("evPanelOverlay").style.display = "flex";
  document.body.style.overflow = "hidden";

  // auto-open chat if there are messages
  if (calTotal > 0) {
    openChatPanel(e.event_id, e.event_name);
  }
}

/* ── Cell "+" menu: สร้าง Event / จองห้อง ── */
let _cellMenuDate = null;
function openCellMenu(ev, dateStr) {
  ev.stopPropagation();
  _cellMenuDate = dateStr;
  let menu = document.getElementById("cellAddMenu");
  if (!menu) {
    menu = document.createElement("div");
    menu.id = "cellAddMenu";
    menu.className = "cal-add-menu";
    document.body.appendChild(menu);
  }
  // ห้องที่ถูกจอง (APPROVED) ในวันนี้ → จุดแดง
  const bookedRoomIds = new Set(
    allBookings
      .filter((b) => b.booking_date === dateStr && b.room_id != null)
      .map((b) => String(b.room_id)),
  );
  // submenu รายชื่อห้อง (จาก place_rooms)
  const roomsHtml = allRooms
    .map((r) => {
      const dot = bookedRoomIds.has(String(r.room_id))
        ? `<span class="cam-dot" title="ถูกจองแล้ว"></span>`
        : "";
      return `<button onclick="cellBookRoom('${r.room_id ?? ""}')"><span class="cam-ico">🚪</span> ${r.room_name}${dot}</button>`;
    })
    .join("");
  menu.innerHTML =
    `<button onclick="cellCreateEvent()"><span class="cam-ico">📝</span> สร้าง Event</button>` +
    `<div class="cam-sub">` +
      `<button class="cam-parent"><span class="cam-ico">🚪</span> จองห้อง <span class="cam-caret">›</span></button>` +
      `<div class="cam-submenu">${roomsHtml}</div>` +
    `</div>`;
  const cell = ev.currentTarget.closest(".cal-cell");
  if (cell) {
    cell.appendChild(menu);
    // คอลัมน์ซ้ายสุด → submenu กางออกทางขวา (กันหลุดขอบซ้าย)
    const col = parseInt(cell.dataset.col || "0", 10);
    menu.classList.toggle("flip-right", col <= 2);
  }
  menu.style.display = "block";
}
function closeCellMenu() {
  const menu = document.getElementById("cellAddMenu");
  if (menu) menu.style.display = "none";
}
function cellCreateEvent() {
  const d = _cellMenuDate;
  closeCellMenu();
  window.open(`../event-form.html?date=${d}`, "_blank", "noopener");
}
function cellBookRoom(roomId) {
  const d = _cellMenuDate;
  closeCellMenu();
  const q = roomId ? `?date=${d}&room=${roomId}&embed=1` : `?date=${d}&embed=1`;
  openBookingFrame(`./events-bookingRoom.html${q}`);
}

/* ── Booking popup (iframe embed ของหน้า events-bookingRoom) ── */
function openBookingFrame(src) {
  closeBookingFrame();
  const wrap = document.createElement("div");
  wrap.id = "bookingFrameOverlay";
  wrap.className = "cal-bookframe-overlay";
  const frame = document.createElement("iframe");
  frame.className = "cal-bookframe";
  frame.src = src;
  frame.setAttribute("title", "จองห้องประชุม");
  wrap.appendChild(frame);
  document.body.appendChild(wrap);
  document.body.style.overflow = "hidden";
}
function closeBookingFrame() {
  const wrap = document.getElementById("bookingFrameOverlay");
  if (wrap) wrap.remove();
  document.body.style.overflow = "";
}
window.addEventListener("message", (e) => {
  const t = e.data && e.data.type;
  if (t === "a4s-booking-done") {
    closeBookingFrame();
    loadBookings().then(renderCalendar); // รีเฟรชการจองในปฏิทิน
  } else if (t === "a4s-booking-close") {
    closeBookingFrame();
  }
});
document.addEventListener("click", (e) => {
  const menu = document.getElementById("cellAddMenu");
  if (!menu || menu.style.display !== "block") return;
  if (menu.contains(e.target) || (e.target.classList && e.target.classList.contains("cal-add-btn"))) return;
  closeCellMenu();
});
// ปิด dropdown เปลี่ยนห้อง เมื่อคลิกนอกกรอบ
document.addEventListener("click", (e) => {
  const dd = document.getElementById("bkRoomDD");
  if (dd && !dd.contains(e.target)) dd.classList.remove("open");
});

/* ── Day-events popup (shows full list when "+N" clicked) ── */
function openDayPopup(dateStr) {
  const filtered = allEvents.filter(
    (e) =>
      e.status !== "CANCELLED" &&
      (!activeCalCatId || String(e.event_category_id) === activeCalCatId),
  );
  // events that overlap this date (single-day OR multi-day spans)
  const dayEvents = filtered.filter((e) => {
    const eEnd = e.end_date || e.event_date;
    return e.event_date <= dateStr && eEnd >= dateStr;
  });
  // bookings on this date (only when no category filter)
  const dayBookings = !activeCalCatId
    ? allBookings.filter((b) => b.booking_date === dateStr)
    : [];

  const overlay = document.getElementById("dayPopupOverlay");
  document.getElementById("dayPopupTitle").textContent = formatDate(dateStr);
  document.getElementById("dayPopupCount").textContent =
    `${dayEvents.length + dayBookings.length} รายการ`;

  const evHtml = dayEvents
    .map((e) => {
      const { color, icon, name } = getCatStyle(e);
      const eEnd = e.end_date || e.event_date;
      const isMulti = eEnd > e.event_date;
      const dateLabel = isMulti
        ? `${formatDate(e.event_date)} — ${formatDate(eEnd)}`
        : formatDate(e.event_date);
      const timeLabel = e.start_time && e.end_time
        ? `${e.start_time.slice(0, 5)} — ${e.end_time.slice(0, 5)}`
        : "";
      const unread = getCalUnread(e.event_id);
      const total = getCalTotal(e.event_id);
      const badge = unread > 0
        ? `<span class="day-pop-badge unread">${unread}</span>`
        : total > 0
          ? `<span class="day-pop-badge read">${total}</span>`
          : "";
      return `<div class="day-pop-item" style="border-left-color:${color}" data-poster-event="${e.event_id}"
        onclick="closeDayPopup();openEventPanel(${e.event_id})">
        <div class="day-pop-item-head">
          <span class="day-pop-item-icon" style="background:${color}22;color:${color}">${icon}</span>
          <span class="day-pop-item-name">${e.event_name}</span>
          ${badge}
        </div>
        <div class="day-pop-item-meta">
          <span class="day-pop-cat" style="background:${color}15;color:${color}">${name}</span>
          <span>📅 ${dateLabel}</span>
          ${timeLabel ? `<span>🕐 ${timeLabel}</span>` : ""}
          ${e.location ? `<span>📍 ${e.location}</span>` : ""}
        </div>
      </div>`;
    })
    .join("");

  const bkHtml = dayBookings
    .map((b) => {
      const label = b.room_name || b.place_name || "ห้องจอง";
      const time = formatBookingTime(b);
      const place = b.place_name && b.room_name && b.place_name !== b.room_name
        ? `${b.place_name} — ${b.room_name}`
        : (b.place_name || b.room_name || "—");
      return `<div class="day-pop-item" style="border-left-color:#8b5cf6"
        onclick="closeDayPopup();openBookingPanel(${b.request_id})">
        <div class="day-pop-item-head">
          <span class="day-pop-item-icon" style="background:#8b5cf622;color:#8b5cf6">🚪</span>
          <span class="day-pop-item-name">${label}</span>
        </div>
        <div class="day-pop-item-meta">
          <span class="day-pop-cat" style="background:#8b5cf615;color:#8b5cf6">ห้องจอง</span>
          <span>🕐 ${time}</span>
          <span>📍 ${place}</span>
          ${b.booked_by_name ? `<span>👤 ${b.booked_by_name}</span>` : ""}
        </div>
      </div>`;
    })
    .join("");

  document.getElementById("dayPopupBody").innerHTML =
    evHtml + bkHtml ||
    `<div class="day-pop-empty">ไม่มีรายการในวันนี้</div>`;

  overlay.classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeDayPopup() {
  const overlay = document.getElementById("dayPopupOverlay");
  if (!overlay) return;
  overlay.classList.remove("open");
  document.body.style.overflow = "";
  hidePosterPreview();
}

/* ── Poster hover preview (delegated from dayPopupBody) ── */
function showPosterPreview(eventId, anchorEl) {
  const tip = document.getElementById("posterPreview");
  const img = document.getElementById("posterPreviewImg");
  const ph = document.getElementById("posterPreviewPlaceholder");
  if (!tip || !img) return;
  const ev = allEvents.find((x) => String(x.event_id) === String(eventId));
  if (!ev) return;
  if (ev.poster_url) {
    // show placeholder until image loaded
    img.style.display = "none";
    if (ph) ph.style.display = "flex";
    img.onload = () => {
      img.style.display = "block";
      if (ph) ph.style.display = "none";
    };
    img.onerror = () => {
      img.style.display = "none";
      if (ph) ph.style.display = "flex";
    };
    if (img.src !== ev.poster_url) img.src = ev.poster_url;
    else if (img.complete) { img.style.display = "block"; if (ph) ph.style.display = "none"; }
  } else {
    img.removeAttribute("src");
    img.style.display = "none";
    if (ph) ph.style.display = "flex";
  }
  positionPosterPreview(anchorEl);
  tip.classList.add("show");
}
function hidePosterPreview() {
  const tip = document.getElementById("posterPreview");
  if (tip) tip.classList.remove("show");
}
function positionPosterPreview(anchorEl) {
  const tip = document.getElementById("posterPreview");
  if (!tip || !anchorEl) return;
  const r = anchorEl.getBoundingClientRect();
  const tipW = 280;
  const tipH = 380;
  const gap = 12;
  let left = r.left - tipW - gap;       // ด้านซ้ายของ item
  if (left < 8) left = r.right + gap;   // ถ้าชนขอบซ้าย → ย้ายไปขวา
  let top = r.top + r.height / 2 - tipH / 2;
  if (top < 8) top = 8;
  if (top + tipH > window.innerHeight - 8) top = window.innerHeight - tipH - 8;
  tip.style.left = left + "px";
  tip.style.top = top + "px";
}
document.addEventListener("DOMContentLoaded", () => {
  const body = document.getElementById("dayPopupBody");
  if (!body) return;
  body.addEventListener("mouseover", (ev) => {
    const item = ev.target.closest(".day-pop-item[data-poster-event]");
    if (!item) return;
    showPosterPreview(item.dataset.posterEvent, item);
  });
  body.addEventListener("mouseout", (ev) => {
    const item = ev.target.closest(".day-pop-item[data-poster-event]");
    if (!item) return;
    if (item.contains(ev.relatedTarget)) return;
    hidePosterPreview();
  });
});

function openBookingPanel(requestId) {
  const b = allBookings.find((x) => String(x.request_id) === String(requestId));
  if (!b) return;
  const overlay = document.getElementById("bookingPanelOverlay");
  const title = b.room_name || b.place_name || "ห้องจอง";
  const place = b.place_name && b.room_name && b.place_name !== b.room_name
    ? `${b.place_name} — ${b.room_name}`
    : (b.place_name || b.room_name || "—");
  const dateStr = b.booking_date ? formatDate(b.booking_date) : "—";
  const timeStr = formatBookingTime(b);
  const bookedAt = toBangkokParts(b.created_at);
  const bookedAtStr = bookedAt ? `${formatDate(bookedAt.date)} ${bookedAt.time}` : "—";
  const paxHtml = b.num_people
    ? `<div class="bk-panel-row"><div class="bk-panel-label">จำนวนคน</div><div class="bk-panel-value">${b.num_people} คน</div></div>`
    : "";
  const noteHtml = b.note
    ? `<div class="bk-panel-row bk-panel-row--full"><div class="bk-panel-label">หมายเหตุ</div><div class="bk-panel-value">${String(b.note).replace(/</g, "&lt;").replace(/\n/g, "<br>")}</div></div>`
    : "";
  // เมนูเปลี่ยนห้อง (จาก place_rooms ของ HQ) + จุดแดงถ้าห้องไม่ว่างช่วงเวลานี้
  const roomMenuHtml = allRooms
    .map((r) => {
      const rn = String(r.room_name || "").replace(/'/g, "\\'");
      const active = String(r.room_id) === String(b.room_id) ? " active" : "";
      const rNo = extractRoomNo(r.room_name);
      const busyBooking = allBookings.some((x) =>
        String(x.request_id) !== String(b.request_id) &&
        x.booking_date === b.booking_date &&
        String(x.room_id) === String(r.room_id) &&
        bookingsOverlap(b, x),
      );
      const busyEvent = rNo && allEvents.some((ev) =>
        ev.status !== "CANCELLED" &&
        extractRoomNo(ev.location) === rNo &&
        b.booking_date >= ev.event_date &&
        b.booking_date <= (ev.end_date || ev.event_date) &&
        bookingsOverlap(b, ev),
      );
      const dot = (busyBooking || busyEvent)
        ? `<span class="bk-room-dot" title="ไม่ว่างช่วงเวลานี้"></span>`
        : "";
      return `<button type="button" class="bk-room-item${active}" onclick="changeBookingRoom(${b.request_id},'${r.room_id}','${rn}')">🚪 ${r.room_name}${dot}</button>`;
    })
    .join("");
  const roomHead = allRooms.length
    ? `<span class="bk-room-dd" id="bkRoomDD">
         <button type="button" class="bk-panel-room bk-panel-room--btn" onclick="toggleBkRoomDD(event)" title="คลิกเพื่อเปลี่ยนห้อง">🚪 ${title}<span class="bk-room-caret">▾</span></button>
         <div class="bk-room-menu" id="bkRoomMenu">${roomMenuHtml}</div>
       </span>`
    : `<span class="bk-panel-room">🚪 ${title}</span>`;
  document.getElementById("bookingPanelBody").innerHTML = `
    <div class="bk-panel-head">
      <span class="bk-panel-eyebrow">รายละเอียดการจอง</span>
      ${roomHead}
      <span class="bk-panel-badge">✅ อนุมัติแล้ว</span>
      <span class="bk-panel-cs">👤 CS: ${b.cs_name || "—"}</span>
    </div>
    <div class="bk-panel-rows">
      <div class="bk-panel-row"><div class="bk-panel-label">วันที่<span class="bk-hl">ใช้</span>ห้อง</div><div class="bk-panel-value">${dateStr}</div></div>
      <div class="bk-panel-row"><div class="bk-panel-label">เวลา</div><div class="bk-panel-value">${timeStr}</div></div>
      <div class="bk-panel-row"><div class="bk-panel-label">วันที่<span class="bk-hl">จอง</span>ห้อง</div><div class="bk-panel-value">${bookedAtStr}</div></div>
      <div class="bk-panel-row"><div class="bk-panel-label">ผู้จอง</div><div class="bk-panel-value">${b.booked_by_name || "—"}</div></div>
      ${paxHtml}
      ${noteHtml}
    </div>
    <div class="bk-panel-actions">
      <button class="bk-panel-cancel-btn" onclick="cancelBooking(${b.request_id})">🚫 ยกเลิกการจองห้อง</button>
    </div>`;
  overlay.classList.add("open");
  document.body.style.overflow = "hidden";
}

/* ── เปลี่ยนห้องจาก popup รายละเอียด ── */
function toggleBkRoomDD(e) {
  if (e) e.stopPropagation();
  document.getElementById("bkRoomDD")?.classList.toggle("open");
}
function closeBkRoomDD() {
  document.getElementById("bkRoomDD")?.classList.remove("open");
}
// ช่วงเวลาสองบุ๊คกิ้งชนกันไหม (ALLDAY = ชนทั้งวัน)
function bookingsOverlap(a, b) {
  const allDay = (x) => x.end_time === "ALLDAY" || (!x.start_time && !x.end_time);
  if (allDay(a) || allDay(b)) return true;
  const as = (a.start_time || "").slice(0, 5), ae = (a.end_time || "").slice(0, 5);
  const bs = (b.start_time || "").slice(0, 5), be = (b.end_time || "").slice(0, 5);
  return as < be && bs < ae;
}
async function changeBookingRoom(requestId, roomId, roomName) {
  const b = allBookings.find((x) => String(x.request_id) === String(requestId));
  if (!b) return;
  closeBkRoomDD();
  if (String(b.room_id) === String(roomId)) return; // ห้องเดิม
  // เช็คชนเวลาในห้องใหม่ (วันเดียวกัน · เวลาทับ · เว้นบุ๊คกิ้งนี้เอง)
  const conflict = allBookings.find((x) =>
    String(x.request_id) !== String(requestId) &&
    x.booking_date === b.booking_date &&
    String(x.room_id) === String(roomId) &&
    bookingsOverlap(b, x),
  );
  if (conflict) {
    showToast(`เปลี่ยนไม่ได้ · ห้อง ${roomName} ถูกจองช่วงเวลานี้แล้ว (${conflict.booked_by_name || "—"})`, "error");
    return;
  }
  // เช็คชนกับ "กิจกรรม" (event) ที่ใช้ห้องเดียวกัน (match เลขห้องจาก location)
  const targetRoomNo = extractRoomNo(roomName);
  const evConflict = targetRoomNo && allEvents.find((ev) => {
    if (ev.status === "CANCELLED") return false;
    if (extractRoomNo(ev.location) !== targetRoomNo) return false;
    const evStart = ev.event_date;
    const evEnd = ev.end_date || ev.event_date;
    if (b.booking_date < evStart || b.booking_date > evEnd) return false; // ไม่ครอบวันจอง
    return bookingsOverlap(b, ev);
  });
  if (evConflict) {
    showToast(`เปลี่ยนไม่ได้ · ห้อง ${roomName} มีกิจกรรม “${evConflict.event_name}” ในเวลานี้แล้ว`, "error");
    return;
  }
  const ok = window.ConfirmModal
    ? await window.ConfirmModal.open({
        icon: "🚪",
        title: "เปลี่ยนห้อง",
        message: `ย้ายการจองนี้ไปที่ “${roomName}” ?`,
        details: {
          "จาก": b.room_name || "—",
          "ไป": roomName,
          "วันที่": b.booking_date ? formatDate(b.booking_date) : "—",
        },
        okText: "เปลี่ยนห้อง",
        cancelText: "ไม่ใช่",
      })
    : confirm(`เปลี่ยนไปห้อง ${roomName}?`);
  if (!ok) return;
  try {
    const { url, key } = getSB();
    const res = await fetch(
      `${url}/rest/v1/room_booking_requests?request_id=eq.${requestId}`,
      {
        method: "PATCH",
        headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ room_id: Number(roomId), room_name: roomName }),
      },
    );
    if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
    b.room_id = Number(roomId);
    b.room_name = roomName;
    renderCalendar();
    openBookingPanel(requestId); // re-render panel ด้วยห้องใหม่
    showToast(`เปลี่ยนเป็น ${roomName} แล้ว`, "success");
  } catch (e) {
    showToast("เปลี่ยนห้องไม่สำเร็จ: " + (e.message || ""), "error");
  }
}

async function cancelBooking(requestId) {
  const b = allBookings.find((x) => String(x.request_id) === String(requestId));
  if (!b) return;

  const place = b.place_name && b.room_name && b.place_name !== b.room_name
    ? `${b.place_name} — ${b.room_name}`
    : (b.place_name || b.room_name || "—");

  const ok = window.ConfirmModal
    ? await window.ConfirmModal.open({
        icon: "🚫",
        title: "ยกเลิกการจองห้อง",
        message: "ยกเลิกการจองห้องนี้? สถานะจะถูกเปลี่ยนเป็น “ยกเลิก”",
        details: {
          "ห้อง": place,
          "วันที่": b.booking_date ? formatDate(b.booking_date) : "—",
          "ผู้จอง": b.booked_by_name || "—",
        },
        okText: "ยกเลิกการจอง",
        cancelText: "ไม่ใช่",
        tone: "danger",
      })
    : confirm("ยกเลิกการจองห้องนี้?");
  if (!ok) return;

  try {
    const { url, key } = getSB();
    const res = await fetch(
      `${url}/rest/v1/room_booking_requests?request_id=eq.${requestId}`,
      {
        method: "PATCH",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "CANCELLED" }),
      },
    );
    if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));

    // Booking is no longer APPROVED → drop from calendar
    allBookings = allBookings.filter((x) => String(x.request_id) !== String(requestId));
    closeBookingPanel();
    renderCalendar();
    showToast("ยกเลิกการจองห้องแล้ว", "success");
  } catch (e) {
    showToast("ยกเลิกไม่สำเร็จ: " + (e.message || ""), "error");
  }
}
window.cancelBooking = cancelBooking;

function closeBookingPanel() {
  document.getElementById("bookingPanelOverlay").classList.remove("open");
  document.body.style.overflow = "";
}

/* ── Chat Panel Functions ── */
function openChatPanel(eventId, eventName) {
  _chatEventId = eventId;
  _chatLastSig = "";
  document.getElementById("chatPanelEventName").textContent = eventName || "—";
  document.getElementById("evPopup").classList.add("chat-open");
  // badge stays visible — only hidden after event date passes
  // show logged-in user name
  const senderEl = document.getElementById("calChatSenderName");
  if (senderEl) senderEl.textContent = getCalSenderName();
  loadEventLogs();
  _chatPollTimer = setInterval(() => loadEventLogs(true), 5000);
}

function closeChatPanel() {
  document.getElementById("evPopup").classList.remove("chat-open");
  clearInterval(_chatPollTimer);
  _chatEventId = null;
}


async function loadEventLogs(silent = false) {
  if (!_chatEventId) return;
  const { url, key } = getSB();
  if (!url || !key) return;
  const panel = document.getElementById("chatLogPanel");
  if (!silent) panel.innerHTML = `<p style="text-align:center;font-size:12px;color:#94a3b8;font-style:italic">กำลังโหลด...</p>`;
  try {
    const res = await fetch(`${url}/rest/v1/event_chat_logs?event_id=eq.${_chatEventId}&order=created_at.asc`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    const logs = await res.json();
    const sig = (logs || []).map(l => l.created_at).join("|");
    if (silent && sig === _chatLastSig) return;
    _chatLastSig = sig;
    const wasAtBottom = panel.scrollHeight - panel.scrollTop <= panel.clientHeight + 8;
    if (!logs || !logs.length) {
      panel.innerHTML = `<p style="text-align:center;font-size:12px;color:#94a3b8;font-style:italic;margin-top:16px">ยังไม่มีข้อความ</p>`;
      return;
    }
    const mySenderName = getCalSenderName();
    panel.innerHTML = logs.map(log => {
      const tp = toBangkokParts(log.created_at);
      const time = tp ? `${formatDate(tp.date)} ${tp.time}` : "";
      const author = log.created_by_name || "ระบบ";
      // right = my own messages, left = others
      const isRight = author === mySenderName;

      let bg, border, textColor;
      if (isRight) {
        bg = "#ede9fe"; border = "#c4b5fd"; textColor = "#4c1d95";
      } else {
        bg = "#fffbeb"; border = "#fcd34d"; textColor = "#92400e";
      }
      const br = isRight ? "14px 4px 14px 14px" : "4px 14px 14px 14px";

      return `<div style="display:flex;flex-direction:column;max-width:82%;align-self:${isRight ? "flex-end" : "flex-start"};align-items:${isRight ? "flex-end" : "flex-start"}">
        <div style="font-size:10px;font-weight:700;color:#94a3b8;margin-bottom:3px">${author}</div>
        <div style="background:${bg};border:1.5px solid ${border};border-radius:${br};padding:8px 12px;font-size:13px;line-height:1.5;color:${textColor};word-break:break-word">${log.message || ""}</div>
        <div style="font-size:10px;color:#94a3b8;margin-top:3px">${time}</div>
      </div>`;
    }).join("");
    markCalChatRead(_chatEventId, logs);
    if (!silent || wasAtBottom) panel.scrollTop = panel.scrollHeight;
  } catch(e) { if (!silent) panel.innerHTML = `<p style="text-align:center;color:#ef4444;font-size:12px">โหลดไม่ได้</p>`; }
}

async function submitEventLog() {
  const input = document.getElementById("chatInput");
  const message = (input.value || "").trim();
  if (!message || !_chatEventId) return;
  const { url, key } = getSB();
  const btn = document.getElementById("chatSubmitBtn");
  btn.disabled = true;
  try {
    await fetch(`${url}/rest/v1/event_chat_logs`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ event_id: _chatEventId, message, created_by_name: getCalSenderName() })
    });
    input.value = "";
    await loadEventLogs();
  } catch(e) {}
  btn.disabled = false;
}
function closeEventPanel() {
  closeChatPanel();
  document.getElementById("evPopup").classList.remove("chat-open");
  document.getElementById("evPanelOverlay").style.display = "none";
  document.body.style.overflow = "";
}

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
  if (!url || !key) {
    showStatus("กรุณากรอก URL และ Key ให้ครบ", "err");
    return;
  }
  localStorage.setItem("sb_url", url);
  localStorage.setItem("sb_key", key);
  showStatus("✅ บันทึกแล้ว — กำลังโหลดข้อมูล...", "ok");
  document.getElementById("noConfigBanner").style.display = "none";
  setTimeout(async () => {
    closeSettings();
    await Promise.all([loadEvents(), loadBookings()]);
    renderCalendar();
  }, 800);
}
async function testConnection() {
  const url = document.getElementById("inputSbUrl").value.trim();
  const key = document.getElementById("inputSbKey").value.trim();
  if (!url || !key) {
    showStatus("กรุณากรอก URL และ Key", "err");
    return;
  }
  showStatus("กำลังทดสอบ...", "ok");
  try {
    const res = await fetch(`${url}/rest/v1/events?select=event_id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
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

function getSB() {
  const storedUrl = localStorage.getItem("sb_url") || "";
  const storedKey = localStorage.getItem("sb_key") || "";
  const isValidKey = storedKey.startsWith("eyJ") && storedKey.length > 100;
  return {
    url: storedUrl || SB_URL_DEFAULT,
    key: isValidKey ? storedKey : SB_KEY_DEFAULT,
  };
}
// timestamptz จาก Supabase เป็น UTC — ต้องแปลงเป็นเวลาไทยก่อนแสดง
function toBangkokParts(ts) {
  if (!ts) return null;
  const s = /(Z|[+-]\d{2}:?\d{2})$/.test(ts) ? ts : ts.replace(" ", "T") + "Z";
  const d = new Date(s);
  if (isNaN(d)) return null;
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .formatToParts(d)
    .reduce((o, x) => ((o[x.type] = x.value), o), {});
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour === "24" ? "00" : p.hour}:${p.minute}`,
  };
}
function formatDate(d) {
  if (!d) return "—";
  const s = String(d).slice(0, 10);
  const [y, m, day] = s.split("-");
  if (!y || !m || !day) return d;
  return `${day}/${m}/${y}`;
}
function typeIcon(t) {
  return (
    {
      BOOTH: "🏪",
      MEETING: "👥",
      ONLINE: "💻",
      HYBRID: "🔀",
      CONFERENCE: "🎤",
      OTHER: "📌",
    }[t] || ""
  );
}
function typeLabel(t) {
  return (
    {
      BOOTH: "🏪 ออกบูธ",
      MEETING: "👥 ประชุม",
      ONLINE: "💻 Online",
      HYBRID: "🔀 Hybrid",
      CONFERENCE: "🎤 Conference",
      OTHER: "📌 อื่นๆ",
    }[t] || t
  );
}
function statusLabel(s) {
  return (
    {
      DRAFT: "📝 Draft",
      CONFIRMED: "✅ Confirmed",
      ONGOING: "▶️ Ongoing",
      DONE: "🏁 Done",
      CANCELLED: "❌ Cancelled",
    }[s] || s
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

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPage);
} else {
  initPage();
}

// ── ESC ปิด modal ──
document.addEventListener("keydown", function (e) {
  if (e.key !== "Escape") return;
  if (document.getElementById("settingsOverlay").classList.contains("open")) {
    closeSettings();
  } else if (
    document.getElementById("bookingPanelOverlay")?.classList.contains("open")
  ) {
    closeBookingPanel();
  } else if (
    document.getElementById("dayPopupOverlay")?.classList.contains("open")
  ) {
    closeDayPopup();
  } else if (
    document.getElementById("evPanelOverlay").style.display === "flex"
  ) {
    closeEventPanel();
  }
});
