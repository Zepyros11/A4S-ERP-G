/* ============================================================
   trip-list.js — Controller for รายการทริป page
   ============================================================ */

const state = {
  trips: [],
  seatCounts: {},   // { [trip_id]: number }
  editId: null,
  sortKey: "start_date",
  sortAsc: false,
};

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
    throw new Error(e.message || "API Error");
  }
  return method === "DELETE" ? null : res.json().catch(() => null);
}

// ── INIT ───────────────────────────────────────────────────
async function init() {
  const { url, key } = getSB();
  if (!url || !key) {
    showToast("ยังไม่ได้เชื่อมต่อ Supabase", "error");
    return;
  }
  bindEvents();
  await loadAll();
}

async function loadAll() {
  showLoading(true);
  try {
    const [trips, seats] = await Promise.all([
      sbFetch("trips", "?select=*&order=start_date.desc.nullslast,trip_id.desc"),
      sbFetch("tour_seat_check", "?select=trip_id&trip_id=not.is.null").catch(() => []),
    ]);
    state.trips = trips || [];
    state.seatCounts = {};
    (seats || []).forEach((r) => {
      if (r.trip_id != null) {
        state.seatCounts[r.trip_id] = (state.seatCounts[r.trip_id] || 0) + 1;
      }
    });
    updateStatCards();
    filterTable();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

function bindEvents() {
  document.getElementById("searchInput")?.addEventListener("input", filterTable);
  document.getElementById("filterStatus")?.addEventListener("change", filterTable);
}

// ── STATS ──────────────────────────────────────────────────
function updateStatCards() {
  document.getElementById("cardTotal").textContent = state.trips.length;
  document.getElementById("cardActive").textContent =
    state.trips.filter((t) => t.status === "ACTIVE").length;
  document.getElementById("cardDone").textContent =
    state.trips.filter((t) => t.status === "DONE").length;
  const totalSeats = Object.values(state.seatCounts).reduce((a, b) => a + b, 0);
  document.getElementById("cardSeats").textContent = totalSeats;
}

// ── FILTER + SORT + RENDER ─────────────────────────────────
function filterTable() {
  const search = (document.getElementById("searchInput")?.value || "").toLowerCase();
  const status = document.getElementById("filterStatus")?.value || "";

  const filtered = state.trips.filter((t) => {
    const matchSearch =
      !search || (t.trip_name || "").toLowerCase().includes(search);
    const matchStatus = !status || t.status === status;
    return matchSearch && matchStatus;
  });

  renderTable(filtered);
}

window.sortTable = function (key) {
  if (state.sortKey === key) state.sortAsc = !state.sortAsc;
  else {
    state.sortKey = key;
    state.sortAsc = true;
  }
  filterTable();
};

function renderTable(rows) {
  const sorted = [...rows].sort((a, b) => {
    let av = a[state.sortKey] ?? "";
    let bv = b[state.sortKey] ?? "";
    if (typeof av === "string") av = av.toLowerCase();
    if (typeof bv === "string") bv = bv.toLowerCase();
    if (av === bv) return 0;
    return state.sortAsc ? (av > bv ? 1 : -1) : av < bv ? 1 : -1;
  });

  const tbody = document.getElementById("tableBody");
  document.getElementById("tableCount").textContent = `${sorted.length} รายการ`;

  if (!sorted.length) {
    tbody.innerHTML = `
      <tr class="r-card-plain"><td colspan="6">
        <div class="empty-state">
          <div class="empty-icon">✈️</div>
          <div class="empty-text">ยังไม่มีทริป — กด "＋ สร้างทริป" เพื่อเริ่ม</div>
        </div>
      </td></tr>`;
    return;
  }

  const fmt = (window.DateFmt && window.DateFmt.formatDMY) || ((s) => s || "");

  tbody.innerHTML = sorted
    .map((t, i) => {
      const seatCount = state.seatCounts[t.trip_id] || 0;
      const dateRange = (t.start_date || t.end_date)
        ? `<span>${fmt(t.start_date) || "—"}</span><span class="sep">→</span><span>${fmt(t.end_date) || "—"}</span>`
        : `<span style="color:var(--text3)">—</span>`;

      return `<tr>
        <td data-label="#" style="text-align:center;color:var(--text3);font-size:12px">${i + 1}</td>
        <td class="r-card-title">
          <div class="trip-name-cell">${escapeHtml(t.trip_name || "—")}</div>
          ${t.description ? `<div style="font-size:12px;color:var(--text3);margin-top:2px">${escapeHtml(t.description)}</div>` : ""}
        </td>
        <td class="col-center" data-label="ช่วงวันที่"><div class="trip-date-range" style="white-space:nowrap">${dateRange}</div></td>
        <td class="col-center" data-label="ลูกค้า">
          <span class="trip-seat-badge${seatCount > 0 ? " has" : ""}">${seatCount} คน</span>
        </td>
        <td class="col-center" data-label="สถานะ">
          <span class="trip-status-pill trip-status-${t.status || "ACTIVE"}">
            ${statusLabel(t.status)}
          </span>
        </td>
        <td class="col-center" data-label="จัดการ" onclick="event.stopPropagation()">
          <div class="action-group">
            <!-- กลุ่ม 1: ข้อมูลปฏิบัติการของทริป -->
            <button class="btn-icon" title="Check Seat (เปิดแท็บใหม่)"
              data-perm="trip_check_seat_view"
              onclick="window.open('./check-seat.html?trip_id=${t.trip_id}', '_blank')">💺</button>
            <button class="btn-icon" title="จัดห้องพัก + รถบัส + เครื่องบิน (เปิดแท็บใหม่)"
              data-perm="trip_rooms_view"
              onclick="window.open('./room-assign.html?trip_id=${t.trip_id}', '_blank')">🧳</button>
            <button class="btn-icon" title="ทีมงาน (Staff/ไกด์/Outsource) — เปิดแท็บใหม่"
              data-perm="trip_team_view"
              onclick="window.open('./trip-team.html?trip_id=${t.trip_id}', '_blank')">🧑‍🤝‍🧑</button>
            <button class="btn-icon" title="ข้อมูลผู้เดินทาง (เปิดแท็บใหม่)"
              data-perm="trip_pax_detail_view"
              onclick="window.open('./pax-detail.html?trip_id=${t.trip_id}', '_blank')">ℹ️</button>
            <span class="action-divider" aria-hidden="true">|</span>
            <!-- กลุ่ม 2: รายงาน -->
            <button class="btn-icon" title="Custom Report (เปิดแท็บใหม่)"
              data-perm="trip_pax_detail_view"
              onclick="window.open('./custom-report.html?trip_id=${t.trip_id}', '_blank')">📊</button>
            <span class="action-divider" aria-hidden="true">|</span>
            <!-- กลุ่ม 3: จัดการทริป (CRUD) -->
            <button class="btn-icon" title="แก้ไข"
              data-perm="trip_list_edit"
              onclick="window.openTripModal(${t.trip_id})">✏️</button>
            <button class="btn-icon danger" title="ลบ"
              data-perm="trip_list_delete"
              onclick="window.deleteTrip(${t.trip_id})">🗑</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");

  // Re-apply permission filtering on freshly-rendered buttons
  if (window.AuthZ && typeof AuthZ.applyDomPerms === "function") {
    AuthZ.applyDomPerms(tbody);
  }
}

function statusLabel(s) {
  return (
    {
      ACTIVE: "🟢 ดำเนินการ",
      DONE: "✅ เสร็จสิ้น",
      CANCELLED: "❌ ยกเลิก",
    }[s] || (s || "ACTIVE")
  );
}

// ── MODAL ──────────────────────────────────────────────────
window.openTripModal = function (tripId) {
  state.editId = tripId || null;
  const t = tripId ? state.trips.find((x) => x.trip_id === tripId) : null;

  document.getElementById("tripModalTitle").textContent = t
    ? "แก้ไขทริป"
    : "สร้างทริป";
  document.getElementById("fTripName").value = t?.trip_name || "";
  document.getElementById("fStartDate").value = t?.start_date || "";
  document.getElementById("fEndDate").value = t?.end_date || "";
  document.getElementById("fStatus").value = t?.status || "ACTIVE";
  document.getElementById("fDescription").value = t?.description || "";

  document.getElementById("tripOverlay").classList.add("open");
  setTimeout(() => document.getElementById("fTripName").focus(), 50);
};

window.closeTripModal = function (e) {
  if (e && e.target.id !== "tripOverlay") return;
  document.getElementById("tripOverlay").classList.remove("open");
  state.editId = null;
};

window.saveTrip = async function () {
  const name = document.getElementById("fTripName").value.trim();
  if (!name) {
    showToast("กรุณากรอกชื่อทริป", "error");
    return;
  }
  const startDate = document.getElementById("fStartDate").value || null;
  const endDate = document.getElementById("fEndDate").value || null;
  if (startDate && endDate && endDate < startDate) {
    showToast("วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่ม", "error");
    return;
  }

  const payload = {
    trip_name: name,
    start_date: startDate,
    end_date: endDate,
    status: document.getElementById("fStatus").value || "ACTIVE",
    description: document.getElementById("fDescription").value.trim() || null,
    updated_at: new Date().toISOString(),
  };

  showLoading(true);
  try {
    if (state.editId) {
      await sbFetch("trips", `?trip_id=eq.${state.editId}`, {
        method: "PATCH",
        body: payload,
      });
      showToast("แก้ไขทริปแล้ว", "success");
    } else {
      await sbFetch("trips", "", { method: "POST", body: payload });
      showToast("สร้างทริปแล้ว", "success");
    }
    document.getElementById("tripOverlay").classList.remove("open");
    state.editId = null;
    await loadAll();
  } catch (e) {
    showToast("บันทึกไม่ได้: " + e.message, "error");
  }
  showLoading(false);
};

// ── DELETE ─────────────────────────────────────────────────
window.deleteTrip = function (tripId) {
  const t = state.trips.find((x) => x.trip_id === tripId);
  if (!t) return;
  const seatCount = state.seatCounts[tripId] || 0;
  const warn = seatCount > 0
    ? `ทริป "${t.trip_name}" มีลูกค้า ${seatCount} คน — ลบทริปแล้วรายชื่อจะคงอยู่แต่ไม่ถูกผูกกับทริปใด ดำเนินการต่อ?`
    : `ต้องการลบทริป "${t.trip_name}" หรือไม่?`;

  const opener = window.DeleteModal?.open || window.ConfirmModal?.open;
  const doDelete = async () => {
    showLoading(true);
    try {
      await sbFetch("trips", `?trip_id=eq.${tripId}`, { method: "DELETE" });
      showToast("ลบทริปแล้ว", "success");
      await loadAll();
    } catch (e) {
      showToast("ลบไม่ได้: " + e.message, "error");
    }
    showLoading(false);
  };
  if (opener) opener(warn, doDelete);
  else if (confirm(warn)) doDelete();
};

// ── UTILS ──────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? "").replace(/[<>&"']/g, (c) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

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

// ── START ──────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
