/* ============================================================
   trip-team.js — Controller for ทีมงาน Trip (Staff/Guide/Outsource)
   ============================================================ */

const state = {
  tripId: null,
  trip: null,
  team: [],             // trip_guides rows for this trip
  selected: new Set(),  // selected guide_id for bulk delete
  editId: null,
  sortKey: "sort_order",
  sortAsc: true,
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
function getTripIdFromUrl() {
  const u = new URLSearchParams(location.search);
  const id = parseInt(u.get("trip_id"), 10);
  return Number.isFinite(id) ? id : null;
}

async function init() {
  const { url, key } = getSB();
  if (!url || !key) {
    showToast("ยังไม่ได้เชื่อมต่อ Supabase", "error");
    return;
  }
  state.tripId = getTripIdFromUrl();
  if (!state.tripId) {
    showToast("ต้องส่ง trip_id มาในลิงก์", "error");
    document.getElementById("tableBody").innerHTML = `
      <tr><td colspan="8">
        <div class="empty-state">
          <div class="empty-icon">⚠️</div>
          <div class="empty-text">ไม่มี trip_id — กลับ <a href="./trip-list.html">รายการทริป</a></div>
        </div>
      </td></tr>`;
    return;
  }
  bindEvents();
  await loadAll();
}

async function loadAll() {
  showLoading(true);
  try {
    const [trips, team] = await Promise.all([
      sbFetch("trips", `?select=*&trip_id=eq.${state.tripId}`),
      sbFetch(
        "trip_guides",
        `?trip_id=eq.${state.tripId}&select=*&order=sort_order.asc.nullslast,guide_id.asc`
      ),
    ]);
    state.trip = (trips || [])[0] || null;
    state.team = team || [];
    renderTripBanner();
    updateStatCards();
    filterTable();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

function renderTripBanner() {
  const banner = document.getElementById("ttTripBanner");
  if (!state.trip) return;
  banner.style.display = "";
  document.getElementById("ttTripName").textContent = state.trip.trip_name || "—";
  const fmt = (window.DateFmt && window.DateFmt.formatDMY) || ((s) => s || "");
  const sd = fmt(state.trip.start_date), ed = fmt(state.trip.end_date);
  document.getElementById("ttTripDates").textContent =
    sd || ed ? `${sd || "—"} → ${ed || "—"}` : "";
}

function bindEvents() {
  document.getElementById("searchInput")?.addEventListener("input", filterTable);
  document.getElementById("filterType")?.addEventListener("change", filterTable);
}

// ── STATS ──────────────────────────────────────────────────
function updateStatCards() {
  const t = state.team;
  document.getElementById("cardTotal").textContent = t.length;
  document.getElementById("cardStaff").textContent = t.filter((x) => x.member_type === "staff").length;
  document.getElementById("cardGuide").textContent = t.filter((x) => x.member_type === "guide" || !x.member_type).length;
  document.getElementById("cardOutsource").textContent = t.filter((x) => x.member_type === "outsource").length;
}

// ── FILTER + SORT + RENDER ─────────────────────────────────
function filterTable() {
  const search = (document.getElementById("searchInput")?.value || "").toLowerCase();
  const type = document.getElementById("filterType")?.value || "";

  const filtered = state.team.filter((m) => {
    const matchType = !type || (m.member_type || "guide") === type;
    if (!matchType) return false;
    if (!search) return true;
    const hay = [
      m.full_name, m.phone, m.line_id, m.whatsapp,
      m.company, m.role_title, m.languages, m.note,
    ].map((s) => (s || "").toString().toLowerCase()).join(" ");
    return hay.includes(search);
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

function typeLabel(t) {
  return ({
    staff:     `<span class="tt-type-pill tt-type-staff">👔 Staff</span>`,
    guide:     `<span class="tt-type-pill tt-type-guide">🧑‍🏫 ไกด์</span>`,
    outsource: `<span class="tt-type-pill tt-type-outsource">🤝 Outsource</span>`,
  }[t || "guide"]);
}

function contactCell(m) {
  const parts = [];
  if (m.phone)    parts.push(`📞 <a href="tel:${escapeAttr(m.phone)}">${escapeHtml(m.phone)}</a>`);
  if (m.line_id)  parts.push(`💬 ${escapeHtml(m.line_id)}`);
  if (m.whatsapp) parts.push(`📱 ${escapeHtml(m.whatsapp)}`);
  return parts.length
    ? `<div class="tt-contact">${parts.join("<br>")}</div>`
    : `<span style="color:var(--text3)">—</span>`;
}

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
      <tr><td colspan="8">
        <div class="empty-state">
          <div class="empty-icon">🧑‍🤝‍🧑</div>
          <div class="empty-text">ยังไม่มีทีมงาน — กด "＋ เพิ่มสมาชิก" เพื่อเริ่ม</div>
        </div>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = sorted
    .map((m, i) => {
      const selected = state.selected.has(m.guide_id);
      const meta = [];
      if (m.role_title) meta.push(escapeHtml(m.role_title));
      if (m.languages)  meta.push(`<span class="tt-langs">${escapeHtml(m.languages)}</span>`);
      const compNote = [];
      if (m.company) compNote.push(`<div style="font-weight:600">${escapeHtml(m.company)}</div>`);
      if (m.note)    compNote.push(`<div style="color:var(--text3);font-size:11.5px">${escapeHtml(m.note)}</div>`);

      return `<tr>
        <td style="text-align:center">
          <input type="checkbox" class="row-chk" data-id="${m.guide_id}"
            ${selected ? "checked" : ""}
            onclick="window.toggleRowSelect(${m.guide_id}, this.checked)" />
        </td>
        <td style="text-align:center;color:var(--text3);font-size:12px">${i + 1}</td>
        <td>
          <div class="tt-name-cell">${escapeHtml(m.full_name || "—")}</div>
          ${m.role_title ? `<div class="tt-name-sub">${escapeHtml(m.role_title)}</div>` : ""}
        </td>
        <td class="col-center">${typeLabel(m.member_type)}</td>
        <td>${meta.length ? meta.join("<br>") : `<span style="color:var(--text3)">—</span>`}</td>
        <td>${contactCell(m)}</td>
        <td>${compNote.length ? compNote.join("") : `<span style="color:var(--text3)">—</span>`}</td>
        <td class="col-center" onclick="event.stopPropagation()">
          <div class="action-group">
            <button class="btn-icon" title="แก้ไข"
              data-perm="trip_team_edit"
              onclick="window.openTeamModal(${m.guide_id})">✏️</button>
            <button class="btn-icon danger" title="ลบ"
              data-perm="trip_team_delete"
              onclick="window.deleteOne(${m.guide_id})">🗑</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");

  // Re-apply permission filtering on freshly-rendered buttons
  if (window.AuthZ && typeof AuthZ.applyDomPerms === "function") {
    AuthZ.applyDomPerms(tbody);
  }
  refreshBulkBar();
}

// ── SELECTION (multi-select + bulk delete) ─────────────────
window.toggleRowSelect = function (id, checked) {
  if (checked) state.selected.add(id);
  else state.selected.delete(id);
  refreshBulkBar();
  syncChkAll();
};

window.toggleSelectAll = function (checked) {
  document.querySelectorAll("#tableBody .row-chk").forEach((cb) => {
    const id = parseInt(cb.dataset.id, 10);
    cb.checked = checked;
    if (checked) state.selected.add(id);
    else state.selected.delete(id);
  });
  refreshBulkBar();
};

window.clearSelection = function () {
  state.selected.clear();
  document.querySelectorAll("#tableBody .row-chk").forEach((cb) => (cb.checked = false));
  refreshBulkBar();
  syncChkAll();
};

function refreshBulkBar() {
  const n = state.selected.size;
  const bar = document.getElementById("bulkBar");
  bar.classList.toggle("show", n > 0);
  document.getElementById("bulkCount").textContent = `${n} รายการ`;
}

function syncChkAll() {
  const chk = document.getElementById("chkAll");
  const rows = document.querySelectorAll("#tableBody .row-chk");
  if (!chk || !rows.length) {
    if (chk) chk.checked = false;
    return;
  }
  const checked = Array.from(rows).every((cb) => cb.checked);
  chk.checked = checked;
}

window.bulkDelete = async function () {
  const ids = [...state.selected];
  if (!ids.length) return;
  const ok = window.ConfirmModal?.open
    ? await window.ConfirmModal.open({
        title: "ลบทีมงาน",
        message: `ต้องการลบทีมงานที่เลือก ${ids.length} คน?  ระบบจะลบการ assign ออกจากรถบัสที่ผูกอยู่ด้วย`,
        icon: "🗑",
        tone: "danger",
        okText: "ลบทั้งหมด",
      })
    : confirm(`ลบ ${ids.length} คน?`);
  if (!ok) return;

  showLoading(true);
  try {
    await sbFetch("trip_guides", `?guide_id=in.(${ids.join(",")})`, { method: "DELETE" });
    showToast(`ลบ ${ids.length} คนแล้ว`, "success");
    state.selected.clear();
    await loadAll();
  } catch (e) {
    showToast("ลบไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

// ── MODAL ──────────────────────────────────────────────────
window.openTeamModal = function (id) {
  state.editId = id || null;
  const m = id ? state.team.find((x) => x.guide_id === id) : null;

  document.getElementById("teamModalTitle").textContent = m ? "แก้ไขสมาชิกทีม" : "เพิ่มสมาชิกทีม";
  document.getElementById("fType").value       = m?.member_type || "guide";
  document.getElementById("fFullName").value   = m?.full_name || "";
  document.getElementById("fRoleTitle").value  = m?.role_title || "";
  document.getElementById("fCompany").value    = m?.company || "";
  document.getElementById("fLanguages").value  = m?.languages || "";
  document.getElementById("fPhone").value      = m?.phone || "";
  document.getElementById("fLine").value       = m?.line_id || "";
  document.getElementById("fWhatsapp").value   = m?.whatsapp || "";
  document.getElementById("fNote").value       = m?.note || "";
  document.getElementById("ttDeleteBtn").style.display = m ? "" : "none";

  document.getElementById("teamOverlay").classList.add("open");
  setTimeout(() => document.getElementById("fFullName").focus(), 50);
};

window.closeTeamModal = function (e) {
  if (e && e.target.id !== "teamOverlay") return;
  document.getElementById("teamOverlay").classList.remove("open");
  state.editId = null;
};

window.saveTeamMember = async function () {
  const name = document.getElementById("fFullName").value.trim();
  if (!name) {
    showToast("กรุณากรอกชื่อ", "error");
    return;
  }
  const payload = {
    trip_id: state.tripId,
    member_type: document.getElementById("fType").value || "guide",
    full_name: name,
    role_title: document.getElementById("fRoleTitle").value.trim() || null,
    company:   document.getElementById("fCompany").value.trim() || null,
    languages: document.getElementById("fLanguages").value.trim() || null,
    phone:     document.getElementById("fPhone").value.trim() || null,
    line_id:   document.getElementById("fLine").value.trim() || null,
    whatsapp:  document.getElementById("fWhatsapp").value.trim() || null,
    note:      document.getElementById("fNote").value.trim() || null,
    updated_at: new Date().toISOString(),
  };

  showLoading(true);
  try {
    if (state.editId) {
      await sbFetch("trip_guides", `?guide_id=eq.${state.editId}`, {
        method: "PATCH",
        body: payload,
      });
      showToast("แก้ไขแล้ว", "success");
    } else {
      payload.sort_order = state.team.length;
      await sbFetch("trip_guides", "", { method: "POST", body: payload });
      showToast("เพิ่มสมาชิกแล้ว", "success");
    }
    document.getElementById("teamOverlay").classList.remove("open");
    state.editId = null;
    await loadAll();
  } catch (e) {
    showToast("บันทึกไม่ได้: " + e.message, "error");
  }
  showLoading(false);
};

window.deleteTeamMember = async function () {
  if (!state.editId) return;
  const m = state.team.find((x) => x.guide_id === state.editId);
  if (!m) return;
  const ok = window.ConfirmModal?.open
    ? await window.ConfirmModal.open({
        title: "ลบสมาชิกทีม",
        message: `ลบ "${m.full_name}"?  ระบบจะลบการ assign รถบัสที่ผูกอยู่ด้วย`,
        icon: "🗑",
        tone: "danger",
        okText: "ลบ",
      })
    : confirm(`ลบ "${m.full_name}"?`);
  if (!ok) return;
  showLoading(true);
  try {
    await sbFetch("trip_guides", `?guide_id=eq.${state.editId}`, { method: "DELETE" });
    showToast("ลบแล้ว", "success");
    document.getElementById("teamOverlay").classList.remove("open");
    state.editId = null;
    await loadAll();
  } catch (e) {
    showToast("ลบไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

window.deleteOne = async function (id) {
  const m = state.team.find((x) => x.guide_id === id);
  if (!m) return;
  const ok = window.ConfirmModal?.open
    ? await window.ConfirmModal.open({
        title: "ลบสมาชิกทีม",
        message: `ลบ "${m.full_name}"?  ระบบจะลบการ assign รถบัสที่ผูกอยู่ด้วย`,
        icon: "🗑",
        tone: "danger",
        okText: "ลบ",
      })
    : confirm(`ลบ "${m.full_name}"?`);
  if (!ok) return;
  showLoading(true);
  try {
    await sbFetch("trip_guides", `?guide_id=eq.${id}`, { method: "DELETE" });
    showToast("ลบแล้ว", "success");
    state.selected.delete(id);
    await loadAll();
  } catch (e) {
    showToast("ลบไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

// ── UTILS ──────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? "").replace(/[<>&"']/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;",
  })[c]);
}
function escapeAttr(s) {
  return String(s ?? "").replace(/["'<>&]/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;",
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
