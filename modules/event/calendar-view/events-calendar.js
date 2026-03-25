/* ============================================================
   events-calendar.js — Controller for Calendar page
============================================================ */

const SB_URL_DEFAULT = "https://dtiynydgkcqausqktreg.supabase.co";
const SB_KEY_DEFAULT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0aXlueWRna2NxYXVzcWt0cmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyNjEwNTcsImV4cCI6MjA4NzgzNzA1N30.DmXwvBBvx3zK7rw21179ro65mTm0B4lQ20ktVMpAUQE";

let allEvents = [];
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();

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
    dateEl.textContent = now.toLocaleDateString("th-TH", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
  await loadEvents();
  renderCalendar();
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
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
    allEvents = [];
  }
  showLoading(false);
}

function renderCalendar() {
  updateMonthLabel();
  const typeFilter = document.getElementById("calFilterType")?.value || "";
  const statusFilter = document.getElementById("calFilterStatus")?.value || "";

  const filtered = allEvents.filter(
    (e) =>
      (!typeFilter || e.event_type === typeFilter) &&
      (!statusFilter || e.status === statusFilter),
  );

  const eventMap = {};
  filtered.forEach((e) => {
    const start = e.event_date;
    const end = e.end_date || start;
    let d = new Date(start + "T00:00:00");
    const endD = new Date(end + "T00:00:00");
    while (d <= endD) {
      const key = d.toISOString().split("T")[0];
      if (!eventMap[key]) eventMap[key] = [];
      if (!eventMap[key].find((x) => x.event_id === e.event_id))
        eventMap[key].push(e);
      d.setDate(d.getDate() + 1);
    }
  });

  const firstDay = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const today = new Date().toISOString().split("T")[0];
  let cells = "";

  for (let i = 0; i < firstDay; i++) {
    const prevDays = new Date(currentYear, currentMonth, 0).getDate();
    const d = prevDays - firstDay + i + 1;
    cells += `<div class="cal-cell other-month"><div class="cal-date-num">${d}</div></div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const isToday = dateStr === today;
    const dow = new Date(currentYear, currentMonth, d).getDay();
    const isWeekend = dow === 0 || dow === 6;
    const dayEvents = eventMap[dateStr] || [];
    const cls = [
      "cal-cell",
      isToday ? "today" : "",
      isWeekend ? "weekend-cell" : "",
    ]
      .filter(Boolean)
      .join(" ");

    const MAX_SHOW = 3;
    const shown = dayEvents.slice(0, MAX_SHOW);
    const extra = dayEvents.length - MAX_SHOW;

    const pillsHtml = shown
      .map(
        (ev) =>
          `<div class="cal-event-pill type-${ev.event_type}"
               onclick="openEventPanel(${ev.event_id});event.stopPropagation();"
               title="${ev.event_name}">
               ${typeIcon(ev.event_type)} ${ev.event_name}
             </div>`,
      )
      .join("");

    const moreHtml =
      extra > 0 ? `<div class="cal-more">+${extra} เพิ่มเติม</div>` : "";

    cells += `<div class="${cls}"><div class="cal-date-num">${d}</div><div class="cal-pills-wrap">${pillsHtml}${moreHtml}</div></div>`;
  }

  const totalCells = firstDay + daysInMonth;
  const remaining = (7 - (totalCells % 7)) % 7;
  for (let d = 1; d <= remaining; d++) {
    cells += `<div class="cal-cell other-month"><div class="cal-date-num">${d}</div></div>`;
  }

  document.getElementById("calGrid").innerHTML =
    cells || `<div class="cal-empty">ไม่มีกิจกรรม</div>`;
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
  renderCalendar();
}

function openEventPanel(eventId) {
  const e = allEvents.find((ev) => ev.event_id === eventId);
  if (!e) return;
  document.getElementById("panelPoster").innerHTML = e.poster_url
    ? `<img src="${e.poster_url}" alt="${e.event_name}">`
    : `<span class="ev-popup-placeholder">🗓️</span>`;
  document.getElementById("panelName").textContent = e.event_name;
  document.getElementById("panelCode").textContent = e.event_code || "";
  document.getElementById("panelStatus").innerHTML =
    `<span class="event-status-badge status-${e.status}">${statusLabel(e.status)}</span>`;
  document.getElementById("panelType").innerHTML =
    `<span class="event-type-badge type-${e.event_type}">${typeLabel(e.event_type)}</span>`;
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
  document.getElementById("panelBtnEdit").onclick = () =>
    (window.location.href = `../activity/event-form.html?id=${e.event_id}`);
  document.getElementById("evPanelOverlay").style.display = "flex";
  document.body.style.overflow = "hidden";
}
function closeEventPanel() {
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
    await loadEvents();
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
    document.getElementById("evPanelOverlay").style.display === "flex"
  ) {
    closeEventPanel();
  }
});
