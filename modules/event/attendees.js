/* ============================================================
   attendees.js — Controller for Attendees page
============================================================ */

// ── API ───────────────────────────────────────────────────
function getSB() {
  return {
    url: localStorage.getItem("sb_url") || "",
    key: localStorage.getItem("sb_key") || "",
  };
}
async function sbFetch(table, query = "", opts = {}) {
  const { url, key } = getSB();
  const { method = "GET", body } = opts;
  const res = await fetch(`${url}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer:
        method === "POST" || method === "PATCH" ? "return=representation" : "",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || "Error");
  }
  return method === "DELETE" ? null : res.json().catch(() => null);
}

async function fetchEvents() {
  return (
    sbFetch(
      "events",
      "?select=event_id,event_name,event_code,max_attendees&order=event_date.desc",
    ) || []
  );
}
async function fetchAttendees(eventId) {
  return (
    sbFetch(
      "event_attendees",
      `?event_id=eq.${eventId}&order=created_at.asc`,
    ) || []
  );
}
async function generateTicketNo(eventId) {
  const { url, key } = getSB();
  const prefix = `TK-${eventId}-`;
  const res = await fetch(
    `${url}/rest/v1/event_attendees?ticket_no=like.${prefix}*&select=ticket_no`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  const rows = await res.json().catch(() => []);
  let maxSeq = 0;
  (rows || []).forEach((r) => {
    const parts = (r.ticket_no || "").split("-");
    const n = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(n) && n > maxSeq) maxSeq = n;
  });
  return `${prefix}${String(maxSeq + 1).padStart(4, "0")}`;
}
async function createAttendee(data) {
  const res = await sbFetch("event_attendees", "", {
    method: "POST",
    body: data,
  });
  return res?.[0];
}
async function updateAttendee(id, data) {
  return sbFetch("event_attendees", `?attendee_id=eq.${id}`, {
    method: "PATCH",
    body: data,
  });
}
async function removeAttendee(id) {
  return sbFetch("event_attendees", `?attendee_id=eq.${id}`, {
    method: "DELETE",
  });
}

// ── STATE ─────────────────────────────────────────────────
let allEvents = [];
let currentEventId = null;
let currentEvent = null;
let allAttendees = [];
let editingAttId = null;

// ── INIT ──────────────────────────────────────────────────
async function initPage() {
  showLoading(true);
  try {
    allEvents = (await fetchEvents()) || [];
    populateEventSelect();

    const params = new URLSearchParams(window.location.search);
    const urlEventId = params.get("event_id");
    if (urlEventId) {
      document.getElementById("eventSelect").value = urlEventId;
      await loadAttendees(parseInt(urlEventId));
    }
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);

  document
    .getElementById("searchInput")
    ?.addEventListener("input", filterTable);
  document
    .getElementById("filterCheckin")
    ?.addEventListener("change", filterTable);
  document
    .getElementById("filterPayment")
    ?.addEventListener("change", filterTable);
  document
    .getElementById("filterAttendType")
    ?.addEventListener("change", filterTable);
}

function populateEventSelect() {
  const sel = document.getElementById("eventSelect");
  sel.innerHTML = '<option value="">-- เลือกกิจกรรม --</option>';
  allEvents.forEach((e) =>
    sel.insertAdjacentHTML(
      "beforeend",
      `<option value="${e.event_id}">[${e.event_code}] ${e.event_name}</option>`,
    ),
  );
}

// ── EVENT CHANGE ──────────────────────────────────────────
window.onEventChange = async function () {
  const val = document.getElementById("eventSelect").value;
  if (!val) {
    currentEventId = null;
    showSections(false);
    return;
  }
  await loadAttendees(parseInt(val));
};

async function loadAttendees(eventId) {
  currentEventId = eventId;
  currentEvent = allEvents.find((e) => e.event_id === eventId);
  showLoading(true);
  try {
    allAttendees = (await fetchAttendees(eventId)) || [];
    showSections(true);
    updateStats();
    filterTable();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

function showSections(show) {
  ["attStatsSection", "attToolbar", "attTableSection"].forEach((id) => {
    document.getElementById(id).style.display = show ? "block" : "none";
  });
  document.getElementById("noEventState").style.display = show
    ? "none"
    : "block";
  document.getElementById("eventActionBtns").style.display = show
    ? "flex"
    : "none";
}

// ── STATS ─────────────────────────────────────────────────
function updateStats() {
  const total = allAttendees.length;
  const checkedIn = allAttendees.filter((a) => a.checked_in).length;
  const paid = allAttendees.filter((a) => a.payment_status === "PAID").length;
  const revenue = allAttendees
    .filter((a) => a.payment_status === "PAID")
    .reduce((sum, a) => sum + parseFloat(a.paid_amount || 0), 0);

  document.getElementById("statTotal").textContent = total;
  document.getElementById("statCheckedIn").textContent = checkedIn;
  document.getElementById("statNotCheckedIn").textContent = total - checkedIn;
  document.getElementById("statPaid").textContent = paid;
  document.getElementById("statRevenue").textContent = formatNum(revenue);
}

// ── FILTER + RENDER ───────────────────────────────────────
function filterTable() {
  const search =
    document.getElementById("searchInput")?.value.toLowerCase() || "";
  const checkin = document.getElementById("filterCheckin")?.value || "";
  const payment = document.getElementById("filterPayment")?.value || "";
  const attendType = document.getElementById("filterAttendType")?.value || "";

  const filtered = allAttendees.filter((a) => {
    const matchSearch =
      !search ||
      (a.name || "").toLowerCase().includes(search) ||
      (a.email || "").toLowerCase().includes(search) ||
      (a.company || "").toLowerCase().includes(search) ||
      (a.ticket_no || "").toLowerCase().includes(search);
    const matchCheckin = !checkin || String(a.checked_in) === checkin;
    const matchPayment = !payment || a.payment_status === payment;
    const matchAttend = !attendType || a.attend_type === attendType;
    return matchSearch && matchCheckin && matchPayment && matchAttend;
  });

  renderTable(filtered);
}

function renderTable(list) {
  const tbody = document.getElementById("attTableBody");
  const countEl = document.getElementById("attCount");
  if (countEl) countEl.textContent = `${list.length} คน`;

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6">
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <div class="empty-text">ไม่พบผู้เข้าร่วม</div>
      </div></td></tr>`;
    return;
  }

  tbody.innerHTML = list
    .map(
      (a) => `
    <tr>
      <td>
        <div style="font-weight:600">${a.name}</div>
        <div style="font-size:11px;color:var(--text3)">
          ${[a.email, a.phone].filter(Boolean).join(" · ")}
        </div>
        ${
          a.company
            ? `<div style="font-size:11px;color:var(--text3)">${a.company}</div>`
            : ""
        }
      </td>
      <td class="col-center">
        <span class="attend-badge attend-${a.attend_type || "ONSITE"}">
          ${attendLabel(a.attend_type)}
        </span>
      </td>
      <td class="col-center">
        <div style="font-family:'IBM Plex Mono',monospace;font-size:11px">
          ${a.ticket_no || "—"}
        </div>
        ${
          a.ticket_type
            ? `<span class="ticket-badge">${a.ticket_type}</span>`
            : ""
        }
      </td>
      <td class="col-center">
        <span class="pay-badge pay-${a.payment_status || "FREE"}">
          ${payLabel(a.payment_status)}
        </span>
        ${
          parseFloat(a.paid_amount || 0) > 0
            ? `<div style="font-size:11px;color:var(--text3);margin-top:2px">
              ฿${formatNum(a.paid_amount)}</div>`
            : ""
        }
      </td>
      <td class="col-center">
        <button class="btn-checkin ${a.checked_in ? "undo-checkin" : "do-checkin"}"
          onclick="window.toggleCheckin(${a.attendee_id}, ${a.checked_in})">
          ${a.checked_in ? "✅ Check-in แล้ว" : "⬜ Check-in"}
        </button>
        ${
          a.check_in_at
            ? `<div style="font-size:10px;color:var(--text3);margin-top:2px">
              ${formatDateTime(a.check_in_at)}</div>`
            : ""
        }
      </td>
      <td style="text-align:center">
        <div class="action-group">
          <button class="btn-icon"
            onclick="window.openAttModal(${a.attendee_id})">✏️</button>
          <button class="btn-icon danger"
            onclick="window.deleteAttendee(${a.attendee_id})">🗑</button>
        </div>
      </td>
    </tr>`,
    )
    .join("");
}

// ── CHECK-IN TOGGLE ───────────────────────────────────────
window.toggleCheckin = async function (id, isCheckedIn) {
  showLoading(true);
  try {
    await updateAttendee(id, {
      checked_in: !isCheckedIn,
      check_in_at: !isCheckedIn ? new Date().toISOString() : null,
    });
    const a = allAttendees.find((x) => x.attendee_id === id);
    if (a) {
      a.checked_in = !isCheckedIn;
      a.check_in_at = !isCheckedIn ? new Date().toISOString() : null;
    }
    updateStats();
    filterTable();
    showToast(
      !isCheckedIn ? "Check-in สำเร็จ ✅" : "ยกเลิก Check-in แล้ว",
      "success",
    );
  } catch (e) {
    showToast("เกิดข้อผิดพลาด: " + e.message, "error");
  }
  showLoading(false);
};

// ── ATTENDEE MODAL ────────────────────────────────────────
window.openAttModal = function (id = null) {
  editingAttId = id;
  document.getElementById("attModalTitle").textContent = id
    ? "✏️ แก้ไขผู้เข้าร่วม"
    : "👤 เพิ่มผู้เข้าร่วม";

  [
    "fAttId",
    "fAttName",
    "fAttEmail",
    "fAttPhone",
    "fAttCompany",
    "fTicketType",
    "fAttNote",
  ].forEach((f) => (document.getElementById(f).value = ""));
  document.getElementById("fPaidAmount").value = "";
  document.getElementById("fAttendType").value = "ONSITE";
  document.getElementById("fPaymentStatus").value = "FREE";

  if (id) {
    const a = allAttendees.find((x) => x.attendee_id === id);
    if (a) {
      document.getElementById("fAttId").value = a.attendee_id;
      document.getElementById("fAttName").value = a.name || "";
      document.getElementById("fAttEmail").value = a.email || "";
      document.getElementById("fAttPhone").value = a.phone || "";
      document.getElementById("fAttCompany").value = a.company || "";
      document.getElementById("fAttendType").value = a.attend_type || "ONSITE";
      document.getElementById("fTicketType").value = a.ticket_type || "";
      document.getElementById("fPaidAmount").value = a.paid_amount || "";
      document.getElementById("fPaymentStatus").value =
        a.payment_status || "FREE";
      document.getElementById("fAttNote").value = a.note || "";
    }
  }
  document.getElementById("attModalOverlay").classList.add("open");
};

window.closeAttModal = function () {
  document.getElementById("attModalOverlay").classList.remove("open");
  editingAttId = null;
};

window.saveAttendee = async function () {
  const name = document.getElementById("fAttName").value.trim();
  if (!name) {
    showToast("กรุณาระบุชื่อ", "error");
    return;
  }

  showLoading(true);
  try {
    const payload = {
      event_id: currentEventId,
      name,
      email: document.getElementById("fAttEmail").value || null,
      phone: document.getElementById("fAttPhone").value || null,
      company: document.getElementById("fAttCompany").value || null,
      attend_type: document.getElementById("fAttendType").value,
      ticket_type: document.getElementById("fTicketType").value || null,
      paid_amount:
        parseFloat(document.getElementById("fPaidAmount").value) || 0,
      payment_status: document.getElementById("fPaymentStatus").value,
      note: document.getElementById("fAttNote").value || null,
    };

    if (editingAttId) {
      await updateAttendee(editingAttId, payload);
      showToast("แก้ไขข้อมูลแล้ว", "success");
    } else {
      // สร้าง ticket_no อัตโนมัติ
      payload.ticket_no = await generateTicketNo(currentEventId);
      await createAttendee(payload);
      showToast("เพิ่มผู้เข้าร่วมแล้ว 👤", "success");
    }

    window.closeAttModal();
    allAttendees = await fetchAttendees(currentEventId);
    updateStats();
    filterTable();
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

// ── DELETE ────────────────────────────────────────────────
window.deleteAttendee = function (id) {
  const a = allAttendees.find((x) => x.attendee_id === id);
  if (!a) return;
  DeleteModal.open(`ต้องการลบ "${a.name}" ออกจากรายชื่อหรือไม่?`, async () => {
    showLoading(true);
    try {
      await removeAttendee(id);
      showToast("ลบผู้เข้าร่วมแล้ว", "success");
      allAttendees = await fetchAttendees(currentEventId);
      updateStats();
      filterTable();
    } catch (e) {
      showToast("ลบไม่สำเร็จ: " + e.message, "error");
    }
    showLoading(false);
  });
};

// ── EXPORT CSV ────────────────────────────────────────────
window.exportCSV = function () {
  if (!allAttendees.length) {
    showToast("ไม่มีข้อมูลให้ Export", "error");
    return;
  }
  const headers = [
    "Ticket No",
    "ชื่อ",
    "อีเมล",
    "โทร",
    "บริษัท",
    "ประเภท",
    "Ticket Type",
    "ชำระ",
    "ยอด(฿)",
    "Check-in",
    "เวลา Check-in",
  ];
  const rows = allAttendees.map((a) => [
    a.ticket_no || "",
    a.name || "",
    a.email || "",
    a.phone || "",
    a.company || "",
    attendLabel(a.attend_type),
    a.ticket_type || "",
    payLabel(a.payment_status),
    a.paid_amount || 0,
    a.checked_in ? "Yes" : "No",
    a.check_in_at ? formatDateTime(a.check_in_at) : "",
  ]);

  const csv = [headers, ...rows]
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const ev = allEvents.find((e) => e.event_id === currentEventId);
  a.href = url;
  a.download = `attendees_${ev?.event_code || currentEventId}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("Export CSV สำเร็จ 📥", "success");
};

// ── HELPERS ───────────────────────────────────────────────
function attendLabel(t) {
  return (
    { ONSITE: "🏢 Onsite", ONLINE: "💻 Online", VIP: "⭐ VIP" }[t] || t || "—"
  );
}
function payLabel(s) {
  return (
    {
      PAID: "💳 ชำระแล้ว",
      PENDING: "⏳ รอชำระ",
      FREE: "🆓 ฟรี",
      WAIVED: "🎫 ยกเว้น",
    }[s] ||
    s ||
    "—"
  );
}
function formatNum(n) {
  return parseFloat(n || 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
function formatDateTime(dt) {
  if (!dt) return "";
  const d = new Date(dt);
  return d.toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

// ── START ─────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPage);
} else {
  initPage();
}
