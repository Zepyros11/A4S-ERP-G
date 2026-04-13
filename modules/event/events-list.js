/* ============================================================
   events-list.js — Controller for Events List page
============================================================ */

import {
  fetchEvents,
  fetchUsers,
  fetchEventCategories,
  removeEvent,
  updateEvent,
} from "./events-api.js";

let allEvents = [];
let allUsers = [];
let eventCategories = [];
let sortKey = "event_date";
let sortAsc = false;
let activeDateRange = "month";
let activeStatusFilter = "";

window._panelEventId = null;
let _panelChatPoll = null;
let _panelChatSig = "";

function getPanelSenderName() {
  const u = window.ERP_USER;
  if (!u) return "Admin";
  return u.full_name || [u.first_name, u.last_name].filter(Boolean).join(" ") || u.username || "Admin";
}
let _evChatCountCache = {}; // { [event_id]: { total, latest } }

/* ── Pin helpers ── */
function getPinnedIds() {
  try { return JSON.parse(localStorage.getItem("evPinned") || "[]"); } catch { return []; }
}
function isPinned(eventId) { return getPinnedIds().includes(eventId); }
window.togglePin = function (eventId, e) {
  e.stopPropagation();
  const pins = getPinnedIds();
  const idx = pins.indexOf(eventId);
  if (idx === -1) pins.push(eventId); else pins.splice(idx, 1);
  localStorage.setItem("evPinned", JSON.stringify(pins));
  filterTable();
};

/* ── Unread chat badge helpers ── */
async function refreshEvChatCounts() {
  if (!allEvents.length) return;
  const { url, key } = getSBLocal();
  if (!url || !key) return;
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
    const prev = JSON.stringify(_evChatCountCache);
    _evChatCountCache = map;
    if (JSON.stringify(map) !== prev) filterTable();
  } catch {}
}

function getEvChatUnread(eventId) {
  const info = _evChatCountCache[eventId];
  if (!info || info.total === 0) return 0;
  const seenAt = localStorage.getItem(`evChat_admin_seen_${eventId}`) || "";
  // count messages with timestamp strictly newer than last-seen — deletion-proof
  return info.timestamps.filter(t => t > seenAt).length;
}

function updatePanelChatTabBadge(eventId) {
  const badge = document.getElementById("panelChatTabBadge");
  if (!badge) return;
  const n = getEvChatUnread(eventId);
  if (n > 0) {
    badge.textContent = n;
    badge.style.display = "inline-flex";
  } else {
    badge.style.display = "none";
  }
}

function markEvChatRead(eventId, logs) {
  const latest = (logs || []).reduce((m, l) => (l.created_at > m ? l.created_at : m), "");
  // only track seenAt timestamp — count-based seenN removed (breaks after deletions)
  localStorage.setItem(`evChat_admin_seen_${eventId}`, latest);
  // sync cache with actual DB state
  if (!_evChatCountCache[eventId]) _evChatCountCache[eventId] = { total: 0, latest: "", timestamps: [] };
  _evChatCountCache[eventId].total = (logs || []).length;
  _evChatCountCache[eventId].timestamps = (logs || []).map(l => l.created_at);
  if (latest) _evChatCountCache[eventId].latest = latest;
  updatePanelChatTabBadge(eventId);
  filterTable();
}

/* ── Tab switching ── */
window.switchPanelTab = function (tab, btn) {
  ["detail", "chat", "history"].forEach((t) => {
    document.getElementById("tab" + t.charAt(0).toUpperCase() + t.slice(1)).style.display = "none";
  });
  document.querySelectorAll(".ev-panel-tab").forEach((b) => b.classList.remove("active"));
  document.getElementById("tab" + tab.charAt(0).toUpperCase() + tab.slice(1)).style.display = "flex";
  btn.classList.add("active");

  const footer = document.getElementById("panelFooter");
  if (footer) footer.style.display = tab === "detail" ? "flex" : "none";

  clearInterval(_panelChatPoll);
  // when leaving chat tab, immediately re-sync badge counts
  if (tab !== "chat") refreshEvChatCounts();
  if (tab === "chat") {
    // hide badge immediately when chat tab opens
    const tabBadge = document.getElementById("panelChatTabBadge");
    if (tabBadge) tabBadge.style.display = "none";
    const nameEl = document.getElementById("panelChatSenderName");
    if (nameEl) nameEl.textContent = getPanelSenderName();
    loadPanelChat();
    _panelChatPoll = setInterval(() => loadPanelChat(true), 5000);
  } else if (tab === "history") {
    loadPanelHistory();
  }
};

/* ── Load chat (event_chat_logs) ── */
async function loadPanelChat(silent = false) {
  if (!window._panelEventId) return;
  const { url, key } = getSBLocal();
  if (!url || !key) return;
  const log = document.getElementById("panelChatLog");
  if (!silent) log.innerHTML = `<p class="chat-empty">กำลังโหลด...</p>`;
  try {
    const res = await fetch(
      `${url}/rest/v1/event_chat_logs?event_id=eq.${window._panelEventId}&order=created_at.asc`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const logs = await res.json();
    const sig = (logs || []).map((l) => l.created_at).join("|");
    if (silent && sig === _panelChatSig) return;
    _panelChatSig = sig;

    const wasAtBottom = log.scrollHeight - log.scrollTop <= log.clientHeight + 8;
    if (!logs || !logs.length) {
      log.innerHTML = `<p class="chat-empty">ยังไม่มีข้อความ</p>`;
      return;
    }
    const senderName = getPanelSenderName();
    log.innerHTML = logs.map((l) => {
      const author = l.created_by_name || "CS";
      const isRight = author === senderName;
      const time = (l.created_at || "").slice(0, 16).replace("T", " ");
      const roleKey = ["CS","BRE","Admin"].includes(author) ? author : "Admin";
      return `<div class="bubble-row ${isRight ? "right" : "left"}" data-role="${roleKey}">
        <div class="bubble-author">${escapeHtml(author)}</div>
        <div class="bubble-wrap">
          <div class="bubble-body">${escapeHtml(l.message || "")}</div>
          <div class="bubble-actions">
            <button class="bubble-del-btn" onclick="window.deletePanelChat(${l.id})" title="ลบ">🗑</button>
          </div>
        </div>
        <div class="bubble-time">${time}</div>
      </div>`;
    }).join("");
    markEvChatRead(window._panelEventId, logs);
    if (!silent || wasAtBottom) log.scrollTop = log.scrollHeight;
  } catch {
    if (!silent) log.innerHTML = `<p class="chat-empty" style="color:#ef4444">โหลดไม่ได้</p>`;
  }
}

/* ── Submit chat ── */
window.submitPanelChat = async function () {
  const input = document.getElementById("panelChatInput");
  const message = (input.value || "").trim();
  if (!message || !window._panelEventId) return;
  const { url, key } = getSBLocal();
  const btn = document.getElementById("panelChatBtn");
  btn.disabled = true;
  try {
    await fetch(`${url}/rest/v1/event_chat_logs`, {
      method: "POST",
      headers: {
        apikey: key, Authorization: `Bearer ${key}`,
        "Content-Type": "application/json", Prefer: "return=minimal",
      },
      body: JSON.stringify({ event_id: window._panelEventId, message, created_by_name: getPanelSenderName() }),
    });
    input.value = "";
    await loadPanelChat();
  } catch {}
  btn.disabled = false;
};

/* ── Delete chat message ── */
window.deletePanelChat = function (logId) {
  DeleteModal.open("ต้องการลบข้อความนี้หรือไม่?", async () => {
    const { url, key } = getSBLocal();
    try {
      await fetch(`${url}/rest/v1/event_chat_logs?id=eq.${logId}`, {
        method: "DELETE",
        headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "return=minimal" },
      });
      await loadPanelChat();
      await refreshEvChatCounts();
    } catch {}
  });
};

/* ── Load history (event_logs) ── */
async function loadPanelHistory() {
  if (!window._panelEventId) return;
  const { url, key } = getSBLocal();
  if (!url || !key) return;
  const el = document.getElementById("panelHistoryLog");
  el.innerHTML = `<p class="chat-empty">กำลังโหลด...</p>`;
  try {
    const res = await fetch(
      `${url}/rest/v1/event_logs?event_id=eq.${window._panelEventId}&select=*,users(full_name)&order=created_at.desc`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const logs = await res.json();
    if (!logs || !logs.length) {
      el.innerHTML = `<p class="chat-empty">ยังไม่มีประวัติ</p>`;
      return;
    }
    el.innerHTML = logs.map((l) => {
      const actor = l.users?.full_name || "ระบบ";
      const initials = actor.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
      const time = (l.created_at || "").slice(0, 16).replace("T", " ");
      const actionMap = {
        CREATE: "สร้างกิจกรรม", UPDATE: "แก้ไขกิจกรรม",
        STATUS_CHANGE: "เปลี่ยนสถานะ", DELETE: "ลบกิจกรรม",
      };
      const action = actionMap[l.action] || l.action || "ดำเนินการ";
      return `<div class="timeline-item">
        <div class="timeline-dot">${initials}</div>
        <div class="timeline-content">
          <div class="timeline-header">
            <span class="timeline-actor">${escapeHtml(actor)}</span>
            <span class="timeline-time">${time}</span>
          </div>
          <div class="timeline-action">${action}</div>
          ${l.note ? `<div class="timeline-note">${escapeHtml(l.note)}</div>` : ""}
        </div>
      </div>`;
    }).join("");
  } catch {
    el.innerHTML = `<p class="chat-empty" style="color:#ef4444">โหลดไม่ได้</p>`;
  }
}

async function initPage() {
  await loadData();
  bindEvents();
  setInterval(refreshEvChatCounts, 5000);
}

async function loadData() {
  showLoading(true);
  try {
    const [evts, usrs, cats] = await Promise.all([
      fetchEvents(),
      fetchUsers(),
      fetchEventCategories(),
    ]);
    allEvents = evts || [];
    allUsers = usrs || [];
    eventCategories = cats || [];
    updatePanelTypeOptions();
    updatePanelAssigneeOptions();
    await autoUpdateStatuses();
    updateStatCards();
    filterTable();
    await refreshEvChatCounts();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

async function autoUpdateStatuses() {
  const now = new Date();
  const { url, key } = getSBLocal();
  if (!url || !key) return;

  const toUpdate = [];
  for (const e of allEvents) {
    if (e.status !== "CONFIRMED" && e.status !== "ONGOING") continue;

    const startDate = e.event_date;
    const endDate = e.end_date || e.event_date;
    const startTime = e.start_time ? e.start_time.slice(0, 5) : "00:00";
    const endTime = e.end_time ? e.end_time.slice(0, 5) : "23:59";
    const startDT = new Date(`${startDate}T${startTime}:00`);
    const endDT = new Date(`${endDate}T${endTime}:00`);

    let newStatus = null;
    if (now >= endDT) newStatus = "DONE";
    else if (now >= startDT && e.status === "CONFIRMED") newStatus = "ONGOING";

    if (newStatus && newStatus !== e.status) {
      toUpdate.push({ event_id: e.event_id, newStatus });
    }
  }

  if (!toUpdate.length) return;

  await Promise.all(
    toUpdate.map(({ event_id, newStatus }) =>
      fetch(`${url}/rest/v1/events?event_id=eq.${event_id}`, {
        method: "PATCH",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ status: newStatus }),
      }).then(() => {
        const ev = allEvents.find((item) => item.event_id === event_id);
        if (ev) ev.status = newStatus;
      }),
    ),
  );
}

function bindEvents() {
  document
    .getElementById("searchInput")
    ?.addEventListener("input", filterTable);

  document.getElementById("panelBtnSaveEdit")?.addEventListener("click", () => {
    window.savePanelEvent();
  });
  document.getElementById("panelBtnFullEdit")?.addEventListener("click", () => {
    if (!window._panelEventId) return;
    window.location.href = `./event-form.html?id=${window._panelEventId}`;
  });
  // panelBtnLog removed — now handled by tabs
}

function updateStatCards() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const monthStart = `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(y, m + 1, 0).getDate();
  const monthEnd = `${y}-${String(m + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  const day = now.getDay();
  const diffToMon = day === 0 ? 6 : day - 1;
  const mon = new Date(now); mon.setDate(now.getDate() - diffToMon);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const weekStart = mon.toISOString().split("T")[0];
  const weekEnd = sun.toISOString().split("T")[0];

  document.getElementById("cardMonth").textContent = allEvents.filter(
    (e) => e.event_date >= monthStart && e.event_date <= monthEnd,
  ).length;
  document.getElementById("cardWeek").textContent = allEvents.filter(
    (e) => e.event_date >= weekStart && e.event_date <= weekEnd,
  ).length;
  document.getElementById("cardOngoing").textContent = allEvents.filter(
    (e) => e.status === "ONGOING",
  ).length;
  document.getElementById("cardDraft").textContent = allEvents.filter(
    (e) => e.status === "DRAFT",
  ).length;
}

window.setDateFilter = function (btn, range) {
  document.querySelectorAll("#dateFilterChips .date-chip").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  activeDateRange = range;
  filterTable();
};

window.setStatusFilter = function (btn, status) {
  document.querySelectorAll("#statusFilterChips .date-chip").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  activeStatusFilter = status;
  filterTable();
};

function getDateRange() {
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  if (activeDateRange === "today") {
    return { start: todayStr, end: todayStr };
  }
  if (activeDateRange === "week") {
    const day = now.getDay();
    const diffToMon = day === 0 ? 6 : day - 1;
    const mon = new Date(now);
    mon.setDate(now.getDate() - diffToMon);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    return { start: mon.toISOString().split("T")[0], end: sun.toISOString().split("T")[0] };
  }
  if (activeDateRange === "month") {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
    return { start: `${y}-${m}-01`, end: `${y}-${m}-${String(lastDay).padStart(2, "0")}` };
  }
  return null;
}

function filterTable() {
  const search = (
    document.getElementById("searchInput")?.value || ""
  ).toLowerCase();
  const status = activeStatusFilter;
  const dateRange = getDateRange();

  const filtered = allEvents.filter((e) => {
    const matchSearch =
      !search ||
      (e.event_name || "").toLowerCase().includes(search) ||
      (e.location || "").toLowerCase().includes(search) ||
      (e.event_code || "").toLowerCase().includes(search);
    const matchStatus = !status || e.status === status;
    let matchDate = true;
    if (dateRange && e.event_date) {
      matchDate = e.event_date >= dateRange.start && e.event_date <= dateRange.end;
    }
    return matchSearch && matchStatus && matchDate;
  });

  renderTable(filtered);
}

window.sortTable = function (key) {
  if (sortKey === key) sortAsc = !sortAsc;
  else {
    sortKey = key;
    sortAsc = true;
  }
  filterTable();
};

function renderTable(events) {
  const sorted = [...events].sort((a, b) => {
    // pinned → top, then unread, then normal
    const pa = isPinned(a.event_id) ? 0 : 1;
    const pb = isPinned(b.event_id) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    const ua = getEvChatUnread(a.event_id) > 0 ? 0 : 1;
    const ub = getEvChatUnread(b.event_id) > 0 ? 0 : 1;
    if (ua !== ub) return ua - ub;

    let av = a[sortKey] || "";
    let bv = b[sortKey] || "";
    if (typeof av === "string") av = av.toLowerCase();
    if (typeof bv === "string") bv = bv.toLowerCase();
    return sortAsc ? (av > bv ? 1 : -1) : av < bv ? 1 : -1;
  });

  const tbody = document.getElementById("tableBody");
  const countEl = document.getElementById("tableCount");
  if (countEl) countEl.textContent = `${sorted.length} รายการ`;

  if (!sorted.length) {
    tbody.innerHTML = `
      <tr><td colspan="8">
        <div class="empty-state">
          <div class="empty-icon">📋</div>
          <div class="empty-text">ไม่พบกิจกรรม</div>
        </div>
      </td></tr>`;
    return;
  }

  const today = new Date().toISOString().split("T")[0];

  tbody.innerHTML = sorted
    .map((e) => {
      const user = allUsers.find((u) => u.user_id === e.assigned_to);
      const initials = user
        ? user.full_name
            .split(" ")
            .map((w) => w[0])
            .join("")
            .slice(0, 2)
            .toUpperCase()
        : "—";

      const imgs = Array.isArray(e.image_urls) && e.image_urls.length
        ? e.image_urls
        : (e.poster_url ? [e.poster_url] : []);
      const urlsJson = JSON.stringify(imgs).replaceAll('"', "&quot;");
      const posterCell = imgs.length
        ? `<div class="event-poster-wrap event-poster-multi">
            ${imgs.map((url, idx) =>
              `<img src="${escapeHtmlAttr(url)}" alt="${escapeHtmlAttr(e.event_name || "event")}"
                onclick="event.stopPropagation();ImgPopup.open(${urlsJson},${idx})"
                onerror="this.remove()">`
            ).join("")}
          </div>`
        : `<div class="event-poster-wrap"><img src="../../assets/images/NoPoster.png" alt="No Poster"></div>`;

      const dateEnd =
        e.end_date && e.end_date !== e.event_date
          ? `<div class="event-date-end">ถึง ${formatDate(e.end_date)}</div>`
          : "";

      const rowClass =
        e.status === "ONGOING"
          ? "row-ongoing"
          : e.status === "CONFIRMED" && e.event_date >= today
            ? "row-upcoming"
            : "";

      const unread = getEvChatUnread(e.event_id);
      const totalMsgs = _evChatCountCache[e.event_id]?.total || 0;
      const unreadBadge = unread > 0
        ? `<span class="chat-unread-pill">💬 ${unread}</span>`
        : totalMsgs > 0
          ? `<span class="chat-convo-pill">💬 ${totalMsgs}</span>`
          : "";
      const unreadRowClass = unread > 0 ? " row-has-unread" : "";
      const pinned = isPinned(e.event_id);
      const pinnedRowClass = pinned ? " row-pinned" : "";

      return `<tr class="${rowClass}${unreadRowClass}${pinnedRowClass}" onclick="window.location.href='./event-form.html?id=${e.event_id}'">
      <td style="text-align:center" onclick="event.stopPropagation()">
        <input type="checkbox" class="row-check" value="${e.event_id}" onchange="window.updateDeleteButton()">
      </td>
      <td>
        <div class="event-date-main">${formatDate(e.event_date)}</div>
        ${dateEnd}
      </td>
      <td>
        <div class="event-name">${escapeHtml(e.event_name || "—")}${unreadBadge}</div>
        <div class="event-code">${escapeHtml(e.event_code || "—")}</div>
      </td>
      <td>${escapeHtml(e.location || "—")}</td>
      <td>
        ${user ? `<div class="event-assignee"><div class="assignee-avatar">${initials}</div><span>${escapeHtml(user.full_name)}</span></div>` : "—"}
      </td>
      <td class="col-center">${posterCell}</td>
      <td class="col-center" onclick="event.stopPropagation()">
        ${buildStatusPill(e.event_id, e.status)}
      </td>
      <td class="col-center" onclick="event.stopPropagation()">
        <div class="action-group">
          <button class="btn-icon ${pinned ? "btn-pin-active" : "btn-pin"}" title="${pinned ? "ยกเลิกปักหมุด" : "ปักหมุด"}" onclick="window.togglePin(${e.event_id}, event)">📌</button>
          <button class="btn-icon" onclick="window.location.href='./event-form.html?id=${e.event_id}'">✏️</button>
          <button class="btn-icon danger" onclick="window.deleteEvent(${e.event_id})">🗑</button>
        </div>
      </td>
    </tr>`;
    })
    .join("");
}

function updatePanelTypeOptions() {
  const el = document.getElementById("peqEventType");
  if (!el) return;
  el.innerHTML = eventCategories.length
    ? eventCategories
        .map(
          (cat) =>
            `<option value="${cat.event_category_id}">${escapeHtml(
              `${cat.icon || ""} ${cat.category_name}`.trim(),
            )}</option>`,
        )
        .join("")
    : '<option value="">—</option>';
}

function updatePanelAssigneeOptions() {
  const el = document.getElementById("peqAssignee");
  if (!el) return;
  el.innerHTML = ['<option value="">— ไม่ระบุ —</option>']
    .concat(
      allUsers.map(
        (user) =>
          `<option value="${user.user_id}">${escapeHtml(user.full_name)}</option>`,
      ),
    )
    .join("");
}

window.openEventPanel = function (eventId) {
  const e = allEvents.find((item) => item.event_id === eventId);
  if (!e) return;

  window._panelEventId = eventId;

  document.getElementById("panelPoster").innerHTML = e.poster_url
    ? `<img src="${e.poster_url}" alt="${escapeHtmlAttr(e.event_name || "event")}">`
    : '<img src="../../assets/images/NoPoster.png" alt="No Poster">';

  document.getElementById("peqEventName").value = e.event_name || "";
  document.getElementById("peqEventCode").value = e.event_code || "";
  document.getElementById("peqEventType").value = e.event_category_id || "";
  document.getElementById("peqStatus").value = e.status || "DRAFT";
  document.getElementById("peqEventDate").value = e.event_date || "";
  document.getElementById("peqEndDate").value = e.end_date || "";
  document.getElementById("peqStartTime").value = toTimeValue(e.start_time);
  document.getElementById("peqEndTime").value = toTimeValue(e.end_time);
  document.getElementById("peqLocation").value = e.location || "";
  document.getElementById("peqMaxAttendees").value = e.max_attendees || "";
  document.getElementById("peqAssignee").value = e.assigned_to || "";
  document.getElementById("peqDesc").value = e.description || "";

  // reset to detail tab
  document.getElementById("tabDetail").style.display = "flex";
  document.getElementById("tabChat").style.display = "none";
  document.getElementById("tabHistory").style.display = "none";
  document.querySelectorAll(".ev-panel-tab").forEach((b) => b.classList.remove("active"));
  document.querySelector(".ev-panel-tab[data-tab='detail']").classList.add("active");
  document.getElementById("panelFooter").style.display = "flex";
  clearInterval(_panelChatPoll);

  // update chat tab badge
  updatePanelChatTabBadge(eventId);

  document.getElementById("evSidePanel").classList.add("open");
  document.getElementById("evPanelOverlay").style.display = "block";
};

window.closeEventPanel = function () {
  window._panelEventId = null;
  clearInterval(_panelChatPoll);
  document.getElementById("evSidePanel").classList.remove("open");
  document.getElementById("evPanelOverlay").style.display = "none";
  refreshEvChatCounts();
};

window.savePanelEvent = async function () {
  const eventId = window._panelEventId;
  if (!eventId) return;

  const eventName = document.getElementById("peqEventName").value.trim();
  if (!eventName) {
    showToast("กรุณาระบุชื่อกิจกรรม", "error");
    return;
  }

  const eventDate = document.getElementById("peqEventDate").value;
  if (!eventDate) {
    showToast("กรุณาระบุวันที่เริ่ม", "error");
    return;
  }

  const endDate = document.getElementById("peqEndDate").value || null;
  if (endDate && endDate < eventDate) {
    showToast("วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม", "error");
    return;
  }

  const payload = {
    event_name: eventName,
    event_category_id:
      parseInt(document.getElementById("peqEventType").value, 10) || null,
    status: document.getElementById("peqStatus").value,
    event_date: eventDate,
    end_date: endDate,
    start_time: document.getElementById("peqStartTime").value || null,
    end_time: document.getElementById("peqEndTime").value || null,
    location: document.getElementById("peqLocation").value.trim() || null,
    max_attendees:
      parseInt(document.getElementById("peqMaxAttendees").value, 10) || 0,
    assigned_to:
      parseInt(document.getElementById("peqAssignee").value, 10) || null,
    description: document.getElementById("peqDesc").value.trim() || null,
  };

  showLoading(true);
  try {
    const res = await updateEvent(eventId, payload);
    const updated = Array.isArray(res) ? res[0] : null;
    const index = allEvents.findIndex((item) => item.event_id === eventId);
    if (index >= 0) {
      allEvents[index] = {
        ...allEvents[index],
        ...payload,
        ...(updated || {}),
      };
    }

    showToast("บันทึกแล้ว", "success");
    updateStatCards();
    filterTable();
    window.closeEventPanel();
  } catch (err) {
    showToast("บันทึกไม่สำเร็จ: " + err.message, "error");
  }
  showLoading(false);
};

window.deleteEvent = function (eventId) {
  const e = allEvents.find((ev) => ev.event_id === eventId);
  if (!e) return;
  DeleteModal.open(`ต้องการลบกิจกรรม "${e.event_name}" หรือไม่?`, async () => {
    showLoading(true);
    try {
      await removeEvent(eventId);
      showToast("ลบกิจกรรมแล้ว", "success");
      await loadData();
      if (window._panelEventId === eventId) window.closeEventPanel();
    } catch (err) {
      showToast("ลบไม่สำเร็จ: " + err.message, "error");
    }
    showLoading(false);
  });
};

function getSelected() {
  return Array.from(document.querySelectorAll(".row-check:checked")).map((c) =>
    parseInt(c.value, 10),
  );
}

window.updateDeleteButton = function () {
  const btn = document.getElementById("btnDeleteSelected");
  if (btn) btn.style.display = getSelected().length ? "inline-flex" : "none";
};

window.toggleAllCheckbox = function (el) {
  document
    .querySelectorAll(".row-check")
    .forEach((c) => (c.checked = el.checked));
  window.updateDeleteButton();
};

window.deleteSelectedEvents = async function () {
  const ids = getSelected();
  if (!ids.length) return;
  DeleteModal.open(
    `ต้องการลบกิจกรรม ${ids.length} รายการ หรือไม่?`,
    async () => {
      showLoading(true);
      try {
        for (const id of ids) await removeEvent(id);
        showToast("ลบกิจกรรมที่เลือกแล้ว", "success");
        await loadData();
        if (ids.includes(window._panelEventId)) window.closeEventPanel();
      } catch (err) {
        showToast("ลบไม่สำเร็จ: " + err.message, "error");
      }
      showLoading(false);
    },
  );
};

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
  return `${parseInt(day, 10)} ${months[parseInt(m, 10)]} ${parseInt(y, 10) + 543}`;
}


function statusLabel(s) {
  return (
    {
      DRAFT: "📝 Draft",
      CONFIRMED: "✔️ Confirmed",
      ONGOING: "▶️ Ongoing",
      DONE: "✅ Done",
      CANCELLED: "❌ Cancelled",
    }[s] || s
  );
}

const STATUS_LIST = ["DRAFT", "CONFIRMED", "ONGOING", "DONE", "CANCELLED"];

function buildStatusPill(eventId, current) {
  const options = STATUS_LIST.map(
    (s) => `
    <div class="status-pill-option status-${s} ${s === current ? "active" : ""}"
         onmousedown="event.preventDefault();window.changeEventStatus(${eventId},'${s}',this)">
      ${statusLabel(s)}
    </div>`,
  ).join("");

  return `
  <div class="status-pill-wrap">
    <button class="status-pill-btn status-${current}" id="spb-${eventId}"
            onclick="window._toggleStatusPill(${eventId},event)">
      ${statusLabel(current)}<span class="pill-caret">▼</span>
    </button>
    <div class="status-pill-dropdown" id="spd-${eventId}">${options}</div>
  </div>`;
}

window._toggleStatusPill = function (eventId, e) {
  e.stopPropagation();
  const dd = document.getElementById(`spd-${eventId}`);
  const btn = document.getElementById(`spb-${eventId}`);
  const isOpen = dd.classList.contains("open");
  // ปิดทุก dropdown ก่อน
  document.querySelectorAll(".status-pill-dropdown.open").forEach((el) => el.classList.remove("open"));
  document.querySelectorAll(".status-pill-btn.open").forEach((el) => el.classList.remove("open"));
  if (!isOpen) {
    dd.classList.add("open");
    btn.classList.add("open");
  }
};

document.addEventListener("click", () => {
  document.querySelectorAll(".status-pill-dropdown.open").forEach((el) => el.classList.remove("open"));
  document.querySelectorAll(".status-pill-btn.open").forEach((el) => el.classList.remove("open"));
});

function toTimeValue(value) {
  return value ? value.slice(0, 5) : "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtmlAttr(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
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

window.changeEventStatus = async function (eventId, newStatus) {
  const oldStatus = allEvents.find((e) => e.event_id === eventId)?.status;

  // ปิด dropdown และอัปเดต pill ทันที
  const dd = document.getElementById(`spd-${eventId}`);
  const btn = document.getElementById(`spb-${eventId}`);
  if (dd) dd.classList.remove("open");
  if (btn) {
    btn.className = `status-pill-btn status-${newStatus}`;
    btn.innerHTML = `${statusLabel(newStatus)}<span class="pill-caret">▼</span>`;
  }

  try {
    const { url, key } = getSBLocal();
    await fetch(`${url}/rest/v1/events?event_id=eq.${eventId}`, {
      method: "PATCH",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ status: newStatus }),
    });

    const ev = allEvents.find((e) => e.event_id === eventId);
    if (ev) ev.status = newStatus;
    updateStatCards();
    showToast("อัปเดตสถานะแล้ว", "success");
  } catch (err) {
    // rollback pill
    if (btn) {
      btn.className = `status-pill-btn status-${oldStatus}`;
      btn.innerHTML = `${statusLabel(oldStatus)}<span class="pill-caret">▼</span>`;
    }
    showToast("อัปเดตไม่สำเร็จ: " + err.message, "error");
  }
};

function getSBLocal() {
  return {
    url: localStorage.getItem("sb_url") || "",
    key: localStorage.getItem("sb_key") || "",
  };
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPage);
} else {
  initPage();
}
