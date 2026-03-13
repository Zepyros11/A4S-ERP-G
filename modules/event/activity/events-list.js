/* ============================================================
   events-list.js — Controller for Events List page
============================================================ */

import { fetchEvents, fetchUsers, removeEvent } from "./events-api.js";

// ── STATE ──────────────────────────────────────────────────
let allEvents = [];
let allUsers = [];
let sortKey = "event_date";
let sortAsc = true;

// ── INIT ───────────────────────────────────────────────────
async function initPage() {
  await loadData();
  bindEvents();
}

async function loadData() {
  showLoading(true);
  try {
    const [evts, usrs] = await Promise.all([fetchEvents(), fetchUsers()]);
    allEvents = evts || [];
    allUsers = usrs || [];
    updateStatCards();
    filterTable();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

// ── BIND EVENTS ────────────────────────────────────────────
function bindEvents() {
  document
    .getElementById("searchInput")
    ?.addEventListener("input", filterTable);
  document
    .getElementById("filterType")
    ?.addEventListener("change", filterTable);
  document
    .getElementById("filterStatus")
    ?.addEventListener("change", filterTable);
}

// ── STAT CARDS ─────────────────────────────────────────────
function updateStatCards() {
  const today = new Date().toISOString().split("T")[0];
  const total = allEvents.length;
  const upcoming = allEvents.filter(
    (e) => e.event_date > today && e.status === "CONFIRMED",
  ).length;
  const ongoing = allEvents.filter((e) => e.status === "ONGOING").length;
  const done = allEvents.filter((e) => e.status === "DONE").length;

  document.getElementById("cardTotal").textContent = total;
  document.getElementById("cardUpcoming").textContent = upcoming;
  document.getElementById("cardOngoing").textContent = ongoing;
  document.getElementById("cardDone").textContent = done;
}

// ── FILTER ─────────────────────────────────────────────────
function filterTable() {
  const search =
    document.getElementById("searchInput")?.value.toLowerCase() || "";
  const type = document.getElementById("filterType")?.value || "";
  const status = document.getElementById("filterStatus")?.value || "";

  const filtered = allEvents.filter((e) => {
    const matchSearch =
      !search ||
      (e.event_name || "").toLowerCase().includes(search) ||
      (e.location || "").toLowerCase().includes(search) ||
      (e.event_code || "").toLowerCase().includes(search);
    const matchType = !type || e.event_type === type;
    const matchStatus = !status || e.status === status;
    return matchSearch && matchType && matchStatus;
  });

  renderTable(filtered);
}

// ── SORT ───────────────────────────────────────────────────
window.sortTable = function (key) {
  if (sortKey === key) sortAsc = !sortAsc;
  else {
    sortKey = key;
    sortAsc = true;
  }
  filterTable();
};

// ── RENDER TABLE ───────────────────────────────────────────
function renderTable(events) {
  const sorted = [...events].sort((a, b) => {
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
      <tr><td colspan="9">
        <div class="empty-state">
          <div class="empty-icon">🗓️</div>
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

      // poster cell
      const posterCell = e.poster_url
        ? `<div class="event-poster-wrap">
           <img src="${e.poster_url}" alt="${e.event_name}"
             onclick="event.stopPropagation();ImgPopup.open(['${e.poster_url}'],0)"
             onerror="this.parentElement.innerHTML='<span class=\\'event-poster-placeholder\\'>🗓️</span>'">
         </div>`
        : `<div class="event-poster-wrap">
           <span class="event-poster-placeholder">🗓️</span>
         </div>`;

      // date cell
      const dateEnd =
        e.end_date && e.end_date !== e.event_date
          ? `<div class="event-date-end">ถึง ${formatDate(e.end_date)}</div>`
          : "";

      // row highlight
      const rowClass =
        e.status === "ONGOING"
          ? "row-ongoing"
          : e.status === "CONFIRMED" && e.event_date >= today
            ? "row-upcoming"
            : "";

      return `<tr class="${rowClass}" onclick="window.openEventPanel(${e.event_id})">
      <td style="text-align:center" onclick="event.stopPropagation()">
        <input type="checkbox" class="row-check" value="${e.event_id}"
          onchange="window.updateDeleteButton()">
      </td>
      <td>
        <div class="event-date-main">${formatDate(e.event_date)}</div>
        ${dateEnd}
      </td>
      <td>
        <div class="event-name">${e.event_name}</div>
        <div class="event-code">${e.event_code || "—"}</div>
      </td>
      <td class="col-center">
        <span class="event-type-badge type-${e.event_type}">
          ${typeLabel(e.event_type)}
        </span>
      </td>
      <td>${e.location || "—"}</td>
      <td>
        ${
          user
            ? `<div class="event-assignee">
               <div class="assignee-avatar">${initials}</div>
               <span>${user.full_name}</span>
             </div>`
            : "—"
        }
      </td>
      <td class="col-center">${posterCell}</td>
      <td class="col-center">
        <span class="event-status-badge status-${e.status}">
          ${statusLabel(e.status)}
        </span>
      </td>
      <td class="col-center" onclick="event.stopPropagation()">
        <div class="action-group">
          <button class="btn-icon"
            onclick="window.openEventPanel(${e.event_id})">✏️</button>
          <button class="btn-icon danger"
            onclick="window.deleteEvent(${e.event_id})">🗑</button>
        </div>
      </td>
    </tr>`;
    })
    .join("");
}

// ── SIDE PANEL ─────────────────────────────────────────────
window.openEventPanel = function (eventId) {
  const e = allEvents.find((ev) => ev.event_id === eventId);
  if (!e) return;
  const user = allUsers.find((u) => u.user_id === e.assigned_to);

  document.getElementById("panelPoster").innerHTML = e.poster_url
    ? `<img src="${e.poster_url}" alt="${e.event_name}">`
    : `<span class="ev-panel-poster-placeholder">🗓️</span>`;

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
  document.getElementById("panelAttendees").textContent = e.max_attendees
    ? `${e.max_attendees} ท่าน`
    : "—";
  document.getElementById("panelAssignee").textContent = user
    ? user.full_name
    : "—";
  document.getElementById("panelDesc").textContent = e.description || "—";

  // ปุ่ม footer
  document.getElementById("panelBtnEdit").onclick = () =>
    (window.location.href = `./event-form.html?id=${e.event_id}`);
  document.getElementById("panelBtnLog").onclick = () =>
    (window.location.href = `./event-log.html?id=${e.event_id}`);

  document.getElementById("evSidePanel").classList.add("open");
  document.getElementById("evPanelOverlay").style.display = "block";
};

window.closeEventPanel = function () {
  document.getElementById("evSidePanel").classList.remove("open");
  document.getElementById("evPanelOverlay").style.display = "none";
};

// ── DELETE ─────────────────────────────────────────────────
window.deleteEvent = function (eventId) {
  const e = allEvents.find((ev) => ev.event_id === eventId);
  if (!e) return;
  DeleteModal.open(`ต้องการลบกิจกรรม "${e.event_name}" หรือไม่?`, async () => {
    showLoading(true);
    try {
      await removeEvent(eventId);
      showToast("ลบกิจกรรมแล้ว", "success");
      await loadData();
    } catch (err) {
      showToast("ลบไม่สำเร็จ: " + err.message, "error");
    }
    showLoading(false);
  });
};

// ── BULK DELETE ────────────────────────────────────────────
function getSelected() {
  return Array.from(document.querySelectorAll(".row-check:checked")).map((c) =>
    parseInt(c.value),
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
      } catch (err) {
        showToast("ลบไม่สำเร็จ: " + err.message, "error");
      }
      showLoading(false);
    },
  );
};

// ── HELPERS ────────────────────────────────────────────────
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

// ── START ──────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPage);
} else {
  initPage();
}
