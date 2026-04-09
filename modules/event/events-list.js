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

window._panelEventId = null;

async function initPage() {
  await loadData();
  bindEvents();
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
  document
    .getElementById("filterType")
    ?.addEventListener("change", filterTable);
  document
    .getElementById("filterStatus")
    ?.addEventListener("change", filterTable);

  document.getElementById("panelBtnSaveEdit")?.addEventListener("click", () => {
    window.savePanelEvent();
  });
  document.getElementById("panelBtnFullEdit")?.addEventListener("click", () => {
    if (!window._panelEventId) return;
    window.location.href = `./event-form.html?id=${window._panelEventId}`;
  });
  document.getElementById("panelBtnLog")?.addEventListener("click", () => {
    if (!window._panelEventId) return;
    window.location.href = `./event-log.html?id=${window._panelEventId}`;
  });
}

function updateStatCards() {
  const today = new Date().toISOString().split("T")[0];
  document.getElementById("cardTotal").textContent = allEvents.length;
  document.getElementById("cardUpcoming").textContent = allEvents.filter(
    (e) => e.event_date > today && e.status === "CONFIRMED",
  ).length;
  document.getElementById("cardOngoing").textContent = allEvents.filter(
    (e) => e.status === "ONGOING",
  ).length;
  document.getElementById("cardDone").textContent = allEvents.filter(
    (e) => e.status === "DONE",
  ).length;
}

function filterTable() {
  const search = (
    document.getElementById("searchInput")?.value || ""
  ).toLowerCase();
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
        : `<div class="event-poster-wrap"><span class="event-poster-placeholder">📋</span></div>`;

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

      return `<tr class="${rowClass}" onclick="window.openEventPanel(${e.event_id})">
      <td style="text-align:center" onclick="event.stopPropagation()">
        <input type="checkbox" class="row-check" value="${e.event_id}" onchange="window.updateDeleteButton()">
      </td>
      <td>
        <div class="event-date-main">${formatDate(e.event_date)}</div>
        ${dateEnd}
      </td>
      <td>
        <div class="event-name">${escapeHtml(e.event_name || "—")}</div>
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
          <button class="btn-icon" onclick="window.openEventPanel(${e.event_id})">✏️</button>
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
    : '<span class="ev-panel-poster-placeholder">📋</span>';

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

  document.getElementById("evSidePanel").classList.add("open");
  document.getElementById("evPanelOverlay").style.display = "block";
};

window.closeEventPanel = function () {
  window._panelEventId = null;
  document.getElementById("evSidePanel").classList.remove("open");
  document.getElementById("evPanelOverlay").style.display = "none";
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
