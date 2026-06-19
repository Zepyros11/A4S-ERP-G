/* ============================================================
   campaign-calendar.js — ปฏิทินแคมเปญ
   แสดงแคมเปญเป็นแถบช่วงเวลา (start_date → end_date) บนปฏิทินรายเดือน
   กลไก grid mirror จาก cs-view/events-calendar.js
============================================================ */

const SB_URL_DEFAULT = "https://dtiynydgkcqausqktreg.supabase.co";
const SB_KEY_DEFAULT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0aXlueWRna2NxYXVzcWt0cmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyNjEwNTcsImV4cCI6MjA4NzgzNzA1N30.DmXwvBBvx3zK7rw21179ro65mTm0B4lQ20ktVMpAUQE";

const MONTHS_TH = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

const STATUS_META = {
  DRAFT:     { color: "#94a3b8", icon: "📝", label: "ร่าง" },
  ACTIVE:    { color: "#5b8a6e", icon: "▶️", label: "กำลังดำเนินการ" },
  ENDED:     { color: "#60a5fa", icon: "✅", label: "จบแล้ว" },
  CANCELLED: { color: "#f87171", icon: "❌", label: "ยกเลิก" },
};
const PLAT_ICON = { tiktok: "🎵", instagram: "📸", facebook: "👍" };

let allCampaigns = [];
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let activeStatus = "";
let _didFocusToday = false;

/* ── Supabase config (เหมือน pattern หน้าอื่น) ── */
function getSB() {
  const storedUrl = localStorage.getItem("sb_url") || "";
  const storedKey = localStorage.getItem("sb_key") || "";
  const isValidKey = storedKey.startsWith("eyJ") && storedKey.length > 100;
  return { url: storedUrl || SB_URL_DEFAULT, key: isValidKey ? storedKey : SB_KEY_DEFAULT };
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDMY = (d) => (window.DateFmt ? window.DateFmt.formatDMY(d) : (d || "—"));

function statusStyle(s) {
  return STATUS_META[s] || { color: "#94a3b8", icon: "📌", label: s || "—" };
}

/* ── INIT ── */
async function initPage() {
  await loadCampaigns();
  renderStatusChips();
  renderLegend();
  renderCalendar();
}

async function loadCampaigns() {
  showLoading(true);
  try {
    const { url, key } = getSB();
    const res = await fetch(
      `${url}/rest/v1/campaigns?select=campaign_id,name,description,cover_url,start_date,end_date,status,platforms,reward&order=start_date.asc`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!res.ok) throw new Error("HTTP " + res.status);
    allCampaigns = (await res.json()).filter((c) => c.start_date); // ต้องมีวันเริ่มถึงวางบนปฏิทินได้
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
    allCampaigns = [];
  }
  showLoading(false);
}

/* ── status filter chips ── */
function renderStatusChips() {
  const wrap = document.getElementById("calStatusChips");
  if (!wrap) return;
  const order = ["DRAFT", "ACTIVE", "ENDED", "CANCELLED"];
  wrap.innerHTML =
    `<button class="epg-chip active" data-st="" onclick="setStatusFilter(this,'')">ทั้งหมด</button>` +
    order
      .map((s) => {
        const m = STATUS_META[s];
        return `<button class="epg-chip" data-st="${s}" onclick="setStatusFilter(this,'${s}')">${m.icon} ${m.label}</button>`;
      })
      .join("");
}
function setStatusFilter(btn, st) {
  document.querySelectorAll("#calStatusChips .epg-chip").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  activeStatus = st;
  renderCalendar();
}

function renderLegend() {
  const el = document.getElementById("calLegend");
  if (!el) return;
  el.innerHTML = ["DRAFT", "ACTIVE", "ENDED", "CANCELLED"]
    .map((s) => {
      const m = STATUS_META[s];
      return `<div class="cal-legend-item"><div class="cal-legend-dot" style="background:${m.color}"></div>${m.icon} ${m.label}</div>`;
    })
    .join("");
}

/* ── CALENDAR RENDER (mirror events-calendar) ── */
function renderCalendar() {
  updateMonthLabel();
  const filtered = allCampaigns.filter((c) => !activeStatus || c.status === activeStatus);

  const todayStr = toDateStr(new Date());
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
      day: d, inMonth: true,
    });
  }
  const totalCells = firstDOW + daysInMonth;
  const remaining = (7 - (totalCells % 7)) % 7;
  for (let d = 1; d <= remaining; d++) {
    const dt = new Date(currentYear, currentMonth + 1, d);
    visibleDates.push({ dateStr: toDateStr(dt), day: d, inMonth: false });
  }

  const weeks = [];
  for (let i = 0; i < visibleDates.length; i += 7) weeks.push(visibleDates.slice(i, i + 7));

  let html = "";
  weeks.forEach((week) => {
    const weekStart = week[0].dateStr;
    const weekEnd = week[6].dateStr;

    const multiDay = filtered.filter((c) => {
      const cEnd = c.end_date || c.start_date;
      return cEnd > c.start_date && c.start_date <= weekEnd && cEnd >= weekStart;
    });
    const singleMap = {};
    filtered.forEach((c) => {
      const cEnd = c.end_date || c.start_date;
      if (cEnd === c.start_date && c.start_date >= weekStart && c.start_date <= weekEnd) {
        (singleMap[c.start_date] ||= []).push(c);
      }
    });

    const lanes = assignLanes(multiDay, week);
    const numLanes = lanes.length;

    const barsHtml = lanes
      .flatMap((lane, laneIdx) =>
        lane.map(({ item: c, colStart, colEnd }) => {
          const m = statusStyle(c.status);
          const cEnd = c.end_date || c.start_date;
          const isStart = c.start_date >= weekStart;
          const isEnd = cEnd <= weekEnd;
          const r = (on) => (on ? "6px" : "0");
          return `<div class="cal-span-bar"
            style="grid-column:${colStart + 1}/${colEnd + 2};grid-row:${laneIdx + 1};
                   background:${m.color};color:#fff;
                   border-radius:${r(isStart)} ${r(isEnd)} ${r(isEnd)} ${r(isStart)};
                   margin:2px ${isEnd ? "3px" : "0"} 1px ${isStart ? "3px" : "0"};"
            onclick="openCampPopup(${c.campaign_id})" title="${esc(c.name)}">
            ${isStart ? `<span class="cal-bar-text">${m.icon} ${esc(c.name)}</span>` : ""}
          </div>`;
        }),
      )
      .join("");

    const cellRow = numLanes + 1;
    const MAX_PILLS = numLanes >= 4 ? 1 : numLanes === 3 ? 2 : numLanes === 2 ? 3 : numLanes === 1 ? 4 : 5;
    const cellsHtml = week
      .map(({ dateStr, day, inMonth }, colIdx) => {
        const isToday = dateStr === todayStr;
        const dow = new Date(dateStr + "T00:00:00").getDay();
        const isWeekend = dow === 0 || dow === 6;
        const dayItems = singleMap[dateStr] || [];
        const cls = ["cal-cell", !inMonth ? "other-month" : "", isToday ? "today" : "",
          isWeekend ? "weekend-cell" : "", colIdx === 6 ? "col-last" : ""].filter(Boolean).join(" ");
        const shown = dayItems.slice(0, MAX_PILLS);
        const extra = dayItems.length - shown.length;
        const pills = shown
          .map((c) => {
            const m = statusStyle(c.status);
            return `<div class="cal-event-pill" style="background:${m.color};color:#fff"
              onclick="openCampPopup(${c.campaign_id});event.stopPropagation();"
              title="${esc(c.name)}">${m.icon} ${esc(c.name)}</div>`;
          })
          .join("");
        const more = extra > 0
          ? `<div class="cal-more" onclick="openCampPopup(${shown[0] ? shown[0].campaign_id : 0});event.stopPropagation()">+${extra}</div>`
          : "";
        return `<div class="${cls}" style="grid-column:${colIdx + 1};grid-row:${cellRow}">
          <div class="cal-date-num">${day}</div>
          <div class="cal-pills-wrap">${pills}${more}</div></div>`;
      })
      .join("");

    const rowTemplate = numLanes > 0 ? `style="grid-template-rows:repeat(${numLanes},24px) auto"` : "";
    html += `<div class="cal-week-row" ${rowTemplate}>${barsHtml}${cellsHtml}</div>`;
  });

  document.getElementById("calGrid").innerHTML = html || `<div class="cal-empty">ไม่มีแคมเปญในเดือนนี้</div>`;

  if (!_didFocusToday) {
    const todayCell = document.querySelector(".cal-cell.today");
    if (todayCell) {
      _didFocusToday = true;
      requestAnimationFrame(() => todayCell.scrollIntoView({ behavior: "smooth", block: "center" }));
    }
  }
}

/* ── helpers ── */
function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function assignLanes(items, week) {
  if (!items.length) return [];
  const weekStart = week[0].dateStr;
  const weekEnd = week[6].dateStr;
  const sorted = [...items].sort((a, b) => a.start_date.localeCompare(b.start_date));
  const lanes = [];
  sorted.forEach((c) => {
    const cStart = c.start_date > weekStart ? c.start_date : weekStart;
    const cEnd = (c.end_date || c.start_date) < weekEnd ? c.end_date || c.start_date : weekEnd;
    const colStart = week.findIndex((d) => d.dateStr === cStart);
    const colEnd = week.findIndex((d) => d.dateStr === cEnd);
    if (colStart === -1 || colEnd === -1) return;
    let placed = false;
    for (let i = 0; i < lanes.length; i++) {
      if (!lanes[i].some((it) => !(it.colEnd < colStart || it.colStart > colEnd))) {
        lanes[i].push({ item: c, colStart, colEnd });
        placed = true;
        break;
      }
    }
    if (!placed) lanes.push([{ item: c, colStart, colEnd }]);
  });
  return lanes;
}
function updateMonthLabel() {
  document.getElementById("calMonthLabel").textContent = `${MONTHS_TH[currentMonth]} ${currentYear + 543}`;
}
function changeMonth(delta) {
  currentMonth += delta;
  if (currentMonth > 11) { currentMonth = 0; currentYear++; }
  if (currentMonth < 0) { currentMonth = 11; currentYear--; }
  renderCalendar();
}
function goToday() {
  currentYear = new Date().getFullYear();
  currentMonth = new Date().getMonth();
  _didFocusToday = false;
  renderCalendar();
}

/* ── POPUP ── */
function openCampPopup(id) {
  const c = allCampaigns.find((x) => x.campaign_id === id);
  if (!c) return;
  const m = statusStyle(c.status);
  const cover = document.getElementById("popCover");
  if (c.cover_url) {
    cover.style.backgroundImage = `url('${encodeURI(c.cover_url)}')`;
    cover.textContent = "";
  } else {
    cover.style.backgroundImage = "";
    cover.textContent = "🚀";
  }
  document.getElementById("popName").textContent = c.name || "—";
  const plats = Array.isArray(c.platforms) ? c.platforms : [];
  document.getElementById("popBadges").innerHTML =
    `<span class="cmpcal-badge" style="background:${m.color}">${m.icon} ${m.label}</span>` +
    (plats.length
      ? `<span class="cmpcal-badge" style="background:#475569">${plats.map((p) => PLAT_ICON[p] || "").join(" ")}</span>`
      : "");
  const range = c.end_date && c.end_date !== c.start_date
    ? `${fmtDMY(c.start_date)} → ${fmtDMY(c.end_date)}`
    : fmtDMY(c.start_date);
  document.getElementById("popDate").textContent = range;
  document.getElementById("popRewardRow").style.display = c.reward ? "flex" : "none";
  document.getElementById("popReward").textContent = c.reward || "";
  document.getElementById("popDescRow").style.display = c.description ? "flex" : "none";
  document.getElementById("popDesc").textContent = c.description || "";
  document.getElementById("popOpenBtn").onclick = () => {
    window.location.href = `./campaign-detail.html?campaign_id=${c.campaign_id}`;
  };
  document.getElementById("campPopOverlay").classList.add("open");
}
function closeCampPopup() {
  document.getElementById("campPopOverlay").classList.remove("open");
}

/* ── toast / loading ── */
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

/* expose for inline handlers */
window.changeMonth = changeMonth;
window.goToday = goToday;
window.setStatusFilter = setStatusFilter;
window.openCampPopup = openCampPopup;
window.closeCampPopup = closeCampPopup;

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeCampPopup();
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPage);
} else {
  initPage();
}
