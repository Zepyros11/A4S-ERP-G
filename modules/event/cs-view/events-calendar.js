/* ============================================================
   events-calendar.js — Controller for Calendar page
============================================================ */

const SB_URL_DEFAULT = "https://dtiynydgkcqausqktreg.supabase.co";
const SB_KEY_DEFAULT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0aXlueWRna2NxYXVzcWt0cmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyNjEwNTcsImV4cCI6MjA4NzgzNzA1N30.DmXwvBBvx3zK7rw21179ro65mTm0B4lQ20ktVMpAUQE";

let allEvents = [];
let allCategories = [];
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let activeCalCatId = "";

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
  // Always show badge if event has messages & event hasn't ended yet
  const ev = allEvents.find(e => e.event_id === eventId);
  if (ev) {
    const endDate = ev.end_date || ev.event_date;
    const today = toDateStr(new Date());
    if (endDate < today) return 0; // event already passed — hide badge
  }
  return info.total;
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
    dateEl.textContent = now.toLocaleDateString("th-TH", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
  await Promise.all([loadEvents(), loadCategories()]);
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
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
    allEvents = [];
  }
  showLoading(false);
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

  // inject category chips
  const chipsWrap = document.getElementById("calCatChips");
  if (chipsWrap) {
    const allBtn = chipsWrap.querySelector('[data-cat=""]');
    chipsWrap.innerHTML = "";
    chipsWrap.appendChild(allBtn);
    allCategories.forEach((cat) => {
      const btn = document.createElement("button");
      btn.className = "epg-chip";
      btn.dataset.cat = cat.event_category_id;
      btn.textContent = `${cat.icon || ""} ${cat.category_name}`.trim();
      btn.onclick = () => setCalCatFilter(btn, String(cat.event_category_id));
      chipsWrap.appendChild(btn);
    });
  }

  // inject category select (mobile)
  const catSelect = document.getElementById("calCatSelect");
  if (catSelect) {
    catSelect.innerHTML = '<option value="">ทั้งหมด</option>';
    allCategories.forEach((cat) => {
      const opt = document.createElement("option");
      opt.value = cat.event_category_id;
      opt.textContent = `${cat.icon || ""} ${cat.category_name}`.trim();
      catSelect.appendChild(opt);
    });
  }

  // inject legend
  const legend = document.getElementById("calLegend");
  if (legend) {
    legend.innerHTML = allCategories.map(c =>
      `<div class="cal-legend-item">
        <div class="cal-legend-dot" style="background:${c.color || "#6366f1"}"></div>
        ${c.icon || ""} ${c.category_name}
      </div>`
    ).join("");
  }
}

function setCalCatFilter(btn, catId) {
  document.querySelectorAll("#calCatChips .epg-chip").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  activeCalCatId = catId;
  const sel = document.getElementById("calCatSelect");
  if (sel) sel.value = catId;
  renderCalendar();
}

function setCalCatFromSelect(sel) {
  activeCalCatId = sel.value;
  document.querySelectorAll("#calCatChips .epg-chip").forEach((b) => {
    b.classList.toggle("active", b.dataset.cat === sel.value);
  });
  renderCalendar();
}

function getCatStyle(event) {
  const cat = allCategories.find((c) => c.event_category_id === event.event_category_id);
  const color = cat?.color || "#6366f1";
  const icon = cat?.icon || "📌";
  const name = cat?.category_name || "อื่นๆ";
  return { color, icon, name };
}

function renderCalendar() {
  updateMonthLabel();
  const filtered = allEvents.filter(
    (e) => !activeCalCatId || String(e.event_category_id) === activeCalCatId,
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
    const multiDayEvts = filtered.filter((e) => {
      const eEnd = e.end_date || e.event_date;
      return eEnd > e.event_date && e.event_date <= weekEnd && eEnd >= weekStart;
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
          const rTL = isStart ? "6px" : "0";
          const rBL = isStart ? "6px" : "0";
          const rTR = isEnd ? "6px" : "0";
          const rBR = isEnd ? "6px" : "0";
          const barUnread = getCalUnread(e.event_id);
          const barBadge = barUnread > 0
            ? `<span class="cal-unread-badge">${barUnread}</span>`
            : "";
          return `<div class="cal-span-bar"
            style="grid-column:${colStart + 1}/${colEnd + 2};grid-row:${laneIdx + 1};
                   background:${color};color:#fff;
                   border-radius:${rTL} ${rTR} ${rBR} ${rBL};
                   margin:2px ${isEnd ? "3px" : "0"} 1px ${isStart ? "3px" : "0"};"
            onclick="openEventPanel(${e.event_id})"
            title="${e.event_name}">
            ${isStart ? `<span class="cal-bar-text">${icon} ${e.event_name}</span>${barBadge}` : ""}
          </div>`;
        })
      )
      .join("");

    // ── Day cells (grid-row = numLanes+1) ────────────────────
    const cellRow = numLanes + 1;
    const MAX_PILLS = numLanes >= 2 ? 1 : numLanes === 1 ? 2 : 3;
    const cellsHtml = week
      .map(({ dateStr, day, inMonth }, colIdx) => {
        const isToday = dateStr === todayStr;
        const dow = new Date(dateStr + "T00:00:00").getDay();
        const isWeekend = dow === 0 || dow === 6;
        const dayEvents = singleMap[dateStr] || [];
        const cls = [
          "cal-cell",
          !inMonth ? "other-month" : "",
          isToday ? "today" : "",
          isWeekend ? "weekend-cell" : "",
          colIdx === 6 ? "col-last" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const shown = dayEvents.slice(0, MAX_PILLS);
        const extra = dayEvents.length - MAX_PILLS;
        const pillsHtml = shown
          .map((ev) => {
            const { color, icon } = getCatStyle(ev);
            const pillUnread = getCalUnread(ev.event_id);
            const pillBadge = pillUnread > 0
              ? `<span class="cal-unread-badge">${pillUnread}</span>`
              : "";
            return `<div class="cal-event-pill"
              style="background:${color};color:#fff;"
              onclick="openEventPanel(${ev.event_id});event.stopPropagation();"
              title="${ev.event_name}">${icon} ${ev.event_name}${pillBadge}</div>`;
          })
          .join("");
        const moreHtml = extra > 0 ? `<div class="cal-more">+${extra}</div>` : "";
        return `<div class="${cls}" style="grid-column:${colIdx + 1};grid-row:${cellRow}"><div class="cal-date-num">${day}</div><div class="cal-pills-wrap">${pillsHtml}${moreHtml}</div></div>`;
      })
      .join("");

    // Single grid: bars + cells share the same 7-col grid → perfect column alignment
    const rowTemplate = numLanes > 0
      ? `style="grid-template-rows:repeat(${numLanes},24px) auto"`
      : "";
    html += `<div class="cal-week-row" ${rowTemplate}>${barsHtml}${cellsHtml}</div>`;
  });

  document.getElementById("calGrid").innerHTML =
    html || `<div class="cal-empty">ไม่มีกิจกรรม</div>`;
}

// ── Helpers ────────────────────────────────────────────────
function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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
  renderCalendar();
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
  const msgBtn = document.getElementById("panelBtnMsg");
  msgBtn.onclick = () => openChatPanel(e.event_id, e.event_name);
  const calUnread = getCalUnread(e.event_id);
  msgBtn.innerHTML = calUnread > 0
    ? `💬 Message <span style="background:#ef4444;color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;margin-left:4px">${calUnread}</span>`
    : `💬 Message`;
  document.getElementById("evPanelOverlay").style.display = "flex";
  document.body.style.overflow = "hidden";
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
      const time = (log.created_at || "").slice(0, 16).replace("T", " ");
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
