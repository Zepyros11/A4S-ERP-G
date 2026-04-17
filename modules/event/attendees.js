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
  // Exclude "วันหยุดบริษัท" category events
  const [events, cats] = await Promise.all([
    sbFetch("events", "?select=event_id,event_name,event_code,max_attendees,event_category_id,price&order=event_date.desc"),
    sbFetch("event_categories", "?select=event_category_id,category_name"),
  ]);
  const holidayIds = (cats || []).filter(c => c.category_name === "วันหยุดบริษัท").map(c => c.event_category_id);
  return (events || []).filter(e => !holidayIds.includes(e.event_category_id));
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

// Inline new rows (not yet saved)
let newRows = [];
let activeSearchRowId = null; // ID of new-row currently showing member suggest

function makeEmptyNewRow() {
  const evPrice = parseFloat(currentEvent?.price || 0);
  return {
    id: "nr-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
    name: "",
    phone: "",
    memberCode: "",
    positionLevel: "",
    paymentStatus: evPrice > 0 ? "UNPAID" : "COMPLIMENTARY",
    prereq: null, // { ok, msg }
    saving: false,
  };
}
function ensureTrailingEmptyRow() {
  if (!newRows.length) { newRows = [makeEmptyNewRow()]; return; }
  const last = newRows[newRows.length - 1];
  if (last.name || last.phone || last.memberCode) {
    newRows.push(makeEmptyNewRow());
  }
}

// ── INIT ──────────────────────────────────────────────────
async function initPage() {
  showLoading(true);
  try {
    allEvents = (await fetchEvents()) || [];
    populateEventSelect();

    const params = new URLSearchParams(window.location.search);
    const urlEventId = params.get("event_id") || params.get("event");
    if (urlEventId) {
      document.getElementById("eventSelect").value = urlEventId;
      await loadAttendees(parseInt(urlEventId));
      // Lock to this event: hide selector, show event name big in hero
      const ev = allEvents.find(e => e.event_id === parseInt(urlEventId));
      if (ev) {
        const wrap = document.getElementById("eventSelectWrap");
        if (wrap) wrap.style.display = "none";
        const title = document.getElementById("heroTitle");
        if (title) {
          title.innerHTML = `👥 ${ev.event_name}`;
          title.style.fontSize = "24px";
        }
        const sub = document.getElementById("heroSubtitle");
        if (sub) sub.textContent = "ผู้เข้าร่วมกิจกรรม · ลงทะเบียน · Check-in";
      }
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
  // Reset inline new-rows when switching events
  newRows = [makeEmptyNewRow()];
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

  const filtered = allAttendees.filter((a) => {
    const matchSearch =
      !search ||
      (a.name || "").toLowerCase().includes(search) ||
      (a.phone || "").toLowerCase().includes(search) ||
      (a.member_code || "").toLowerCase().includes(search) ||
      (a.ticket_no || "").toLowerCase().includes(search);
    const matchCheckin = !checkin || String(a.checked_in) === checkin;
    const matchPayment = !payment || a.payment_status === payment;
    return matchSearch && matchCheckin && matchPayment;
  });

  renderTable(filtered);
}

function renderTable(list) {
  const tbody = document.getElementById("attTableBody");
  const countEl = document.getElementById("attCount");
  if (countEl) countEl.textContent = `${list.length} คน`;

  ensureTrailingEmptyRow();

  const newRowsHtml = newRows.map(renderNewRow).join("");
  const savedRowsHtml = list.length
    ? list.map(renderSavedRow).join("")
    : `<tr><td colspan="6"><div class="empty-state" style="padding:20px">
        <div class="empty-icon" style="font-size:28px">👥</div>
        <div class="empty-text" style="font-size:12px">ยังไม่มีผู้เข้าร่วม — พิมพ์ที่แถวบนเพื่อเพิ่ม</div>
      </div></td></tr>`;

  tbody.innerHTML = newRowsHtml + savedRowsHtml;
}

function renderNewRow(r) {
  const posBadge = r.positionLevel
    ? `<span class="cell-member-pos">⭐ ${escapeHtml(r.positionLevel)}</span>`
    : `<span style="color:var(--text3);font-size:11px">—</span>`;
  const prereq = r.prereq
    ? `<div class="prereq-warn-inline ${r.prereq.ok ? "ok" : ""}">${r.prereq.ok ? "✅" : "⚠️"} ${escapeHtml(r.prereq.msg)}</div>`
    : "";
  const codeChip = r.memberCode
    ? `<span class="member-chip-code" style="margin-right:6px" title="คลิก ✕ เพื่อยกเลิก">${escapeHtml(r.memberCode)}</span>
       <button class="member-chip-close" onclick="window.clearNewRowMember('${r.id}')" title="ยกเลิกสมาชิก" style="margin-right:4px">✕</button>`
    : "";
  return `<tr class="new-row" data-nrid="${r.id}">
    <td>
      <div style="display:flex;align-items:center;gap:4px;flex-wrap:nowrap">
        ${codeChip}
        <input class="inline-input" placeholder="🔍 รหัสสมาชิก / ชื่อ..." autocomplete="off"
          value="${escapeHtml(r.name)}"
          oninput="window.onNewRowNameInput('${r.id}', this.value)"
          onkeydown="window.onNewRowKey(event, '${r.id}')"
          onfocus="window.onNewRowFocus('${r.id}')"
          data-role="search"
          style="flex:1">
      </div>
      ${prereq}
    </td>
    <td class="col-center">${posBadge}</td>
    <td class="col-center"><span class="cell-ticket">auto</span></td>
    <td class="col-center">
      <select class="inline-select" onchange="window.onNewRowPayment('${r.id}', this.value)">
        <option value="UNPAID" ${r.paymentStatus === "UNPAID" ? "selected" : ""}>⏳ ยังไม่ชำระ</option>
        <option value="PAID" ${r.paymentStatus === "PAID" ? "selected" : ""}>💳 ชำระแล้ว</option>
        <option value="COMPLIMENTARY" ${r.paymentStatus === "COMPLIMENTARY" ? "selected" : ""}>🎫 ฟรี</option>
      </select>
    </td>
    <td class="col-center"><span style="color:var(--text3);font-size:11px">—</span></td>
    <td class="col-center">
      <button class="inline-save-btn" ${!r.name || r.saving ? "disabled" : ""} onclick="window.saveNewRow('${r.id}')">
        ${r.saving ? "⏳" : "💾"}
      </button>
    </td>
  </tr>`;
}

function renderSavedRow(a) {
  return `<tr class="saved-row" data-aid="${a.attendee_id}">
    <td>
      <div class="cell-name-wrap" data-field="name" onclick="window.startEditCell(${a.attendee_id},'name',this)">
        <div style="font-weight:600;cursor:text" title="คลิกเพื่อแก้ไข">
          ${a.member_code ? `<span style="font-family:'IBM Plex Mono',monospace;font-size:10px;background:#1e40af;color:#fff;padding:2px 7px;border-radius:10px;font-weight:700;margin-right:6px">${escapeHtml(a.member_code)}</span>` : ""}${escapeHtml(a.name)}
        </div>
        ${a.phone ? `<div style="font-size:11px;color:var(--text3)">📱 ${escapeHtml(a.phone)}</div>` : ""}
      </div>
    </td>
    <td class="col-center">
      ${a.position_level ? `<span class="cell-member-pos">⭐ ${escapeHtml(a.position_level)}</span>` : '<span style="color:var(--text3);font-size:11px">—</span>'}
    </td>
    <td class="col-center">
      <div class="cell-ticket">${a.ticket_no || "—"}</div>
    </td>
    <td class="col-center">
      <span class="pay-badge pay-${a.payment_status || "COMPLIMENTARY"}"
        onclick="window.startEditCell(${a.attendee_id},'payment_status',this)"
        style="cursor:pointer" title="คลิกเพื่อเปลี่ยน">
        ${payLabel(a.payment_status)}
      </span>
      ${parseFloat(a.paid_amount || 0) > 0 ? `<div style="font-size:11px;color:var(--text3);margin-top:2px">฿${formatNum(a.paid_amount)}</div>` : ""}
    </td>
    <td class="col-center">
      <button class="btn-checkin ${a.checked_in ? "undo-checkin" : "do-checkin"}"
        onclick="window.toggleCheckin(${a.attendee_id}, ${a.checked_in})">
        ${a.checked_in ? "✅ เข้างานแล้ว" : "⬜ Check-in"}
      </button>
      ${a.check_in_at ? `<div style="font-size:10px;color:var(--text3);margin-top:2px">${formatDateTime(a.check_in_at)}</div>` : ""}
    </td>
    <td class="col-center">
      <button class="btn-icon danger" onclick="window.deleteAttendee(${a.attendee_id})" title="ลบ">🗑</button>
    </td>
  </tr>`;
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

// ── INLINE NEW-ROW HANDLERS ───────────────────────────────
function _findRow(id) { return newRows.find(r => r.id === id); }

window.onNewRowNameInput = function (id, val) {
  const r = _findRow(id); if (!r) return;
  r.name = val;
  activeSearchRowId = id;
  // If member is already linked, skip member search — user is just tweaking the display name
  if (!r.memberCode) {
    window.searchMember(val, id);
  }
  // Auto-add trailing empty row if this is the last row
  const isLast = newRows[newRows.length - 1].id === id;
  if (isLast && val.trim()) {
    ensureTrailingEmptyRow();
    filterTable();
    requestAnimationFrame(() => {
      const input = document.querySelector(`tr[data-nrid="${id}"] input[data-role="search"]`);
      if (input) { input.focus(); input.setSelectionRange(val.length, val.length); }
    });
  } else {
    _updateSaveBtn(id);
  }
};

window.onNewRowPayment = function (id, val) {
  const r = _findRow(id); if (!r) return;
  r.paymentStatus = val;
};

window.onNewRowFocus = function (id) {
  activeSearchRowId = id;
};

window.onNewRowKey = function (ev, id) {
  // Delegate arrow/enter/escape to member-suggest handler if dropdown is open
  const sug = document.getElementById("memberSuggest");
  const open = sug && sug.style.display !== "none" && _lastMemberResults.length;
  if (open && (ev.key === "ArrowDown" || ev.key === "ArrowUp" || ev.key === "Enter" || ev.key === "Escape")) {
    window._onMemberSearchKey(ev);
    return;
  }
  if (ev.key === "Enter") {
    ev.preventDefault();
    window.saveNewRow(id);
  }
};

window.clearNewRowMember = function (id) {
  const r = _findRow(id); if (!r) return;
  r.memberCode = "";
  r.positionLevel = "";
  r.name = "";
  r.phone = "";
  r.prereq = null;
  filterTable();
};

function _updateSaveBtn(id) {
  const btn = document.querySelector(`tr[data-nrid="${id}"] .inline-save-btn`);
  const r = _findRow(id); if (!btn || !r) return;
  btn.disabled = !r.name || r.saving;
}

// Called from selectMember when user picks from dropdown
function _applyMemberToRow(rowId, code, name, phone, positionLevel) {
  const r = _findRow(rowId); if (!r) return;
  r.memberCode = code;
  r.name = name || "";
  r.phone = phone || "";
  r.positionLevel = positionLevel || "";
  r.prereq = null;
  // Pre-check prerequisite
  _checkPrereqForRow(r);
  filterTable();
}

async function _checkPrereqForRow(r) {
  if (!r.memberCode || !currentEventId) return;
  try {
    const { url, key } = getSB();
    const h = { apikey: key, Authorization: `Bearer ${key}` };
    const evRes = await fetch(`${url}/rest/v1/events?select=series_id,level_id&event_id=eq.${currentEventId}`, { headers: h });
    const ev = (await evRes.json())[0];
    if (!ev?.series_id || !ev?.level_id) return;
    const lvRes = await fetch(`${url}/rest/v1/course_levels?select=*&id=eq.${ev.level_id}`, { headers: h });
    const level = (await lvRes.json())[0];
    if (!level?.prerequisite_level_id) return;
    const prRes = await fetch(`${url}/rest/v1/course_levels?select=level_name&id=eq.${level.prerequisite_level_id}`, { headers: h });
    const prereqLevel = (await prRes.json())[0];
    const aRes = await fetch(`${url}/rest/v1/event_attendees?select=event_id&member_code=eq.${r.memberCode}&checked_in=eq.true`, { headers: h });
    const attended = await aRes.json();
    let passed = false;
    if (attended?.length) {
      const ids = attended.map(a => a.event_id).join(",");
      const evCheck = await fetch(`${url}/rest/v1/events?select=event_id&series_id=eq.${ev.series_id}&level_id=eq.${level.prerequisite_level_id}&event_id=in.(${ids})`, { headers: h });
      passed = (await evCheck.json()).length > 0;
    }
    r.prereq = {
      ok: passed,
      msg: passed
        ? `ผ่าน ${prereqLevel?.level_name || "level ก่อนหน้า"} แล้ว`
        : `ต้องเรียน ${prereqLevel?.level_name || "level ก่อนหน้า"} ก่อน`,
    };
    filterTable();
  } catch (e) { console.warn("prereq:", e); }
}

window.saveNewRow = async function (id) {
  const r = _findRow(id); if (!r) return;
  const name = (r.name || "").trim();
  if (!name) { showToast("กรุณาระบุชื่อ", "error"); return; }
  if (r.saving) return;
  r.saving = true; _updateSaveBtn(id);

  try {
    const evPrice = parseFloat(currentEvent?.price || 0);
    const payload = {
      event_id: currentEventId,
      name,
      phone: r.phone || null,
      position_level: r.positionLevel || null,
      paid_amount: evPrice,
      payment_status: r.paymentStatus,
      member_code: r.memberCode || null,
    };
    const blocked = await _enforceRegistration(payload);
    if (blocked) { r.saving = false; _updateSaveBtn(id); return; }
    payload.ticket_no = await generateTicketNo(currentEventId);
    await createAttendee(payload);
    showToast("เพิ่มผู้เข้าร่วมแล้ว 👤", "success");
    // Remove this row from newRows, then ensure trailing empty
    newRows = newRows.filter(x => x.id !== id);
    ensureTrailingEmptyRow();
    allAttendees = await fetchAttendees(currentEventId);
    updateStats();
    filterTable();
    // Focus first empty new row's search input
    requestAnimationFrame(() => {
      const input = document.querySelector("tr.new-row input[data-role='search']");
      input?.focus();
    });
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
    r.saving = false;
    _updateSaveBtn(id);
  }
};

// ── INLINE CELL EDIT (saved rows) ─────────────────────────
window.startEditCell = function (attId, field, cellEl) {
  const a = allAttendees.find(x => x.attendee_id === attId);
  if (!a) return;
  if (cellEl.querySelector("input,select")) return; // already editing

  const current = a[field] || "";
  if (field === "payment_status") {
    const sel = document.createElement("select");
    sel.className = "inline-select";
    sel.innerHTML = `
      <option value="UNPAID" ${current === "UNPAID" ? "selected" : ""}>⏳ ยังไม่ชำระ</option>
      <option value="PAID" ${current === "PAID" ? "selected" : ""}>💳 ชำระแล้ว</option>
      <option value="COMPLIMENTARY" ${current === "COMPLIMENTARY" ? "selected" : ""}>🎫 ฟรี</option>`;
    const save = async () => {
      if (sel.value === current) { filterTable(); return; }
      await _patchAttendee(attId, { payment_status: sel.value });
    };
    sel.onchange = save;
    sel.onblur = save;
    cellEl.innerHTML = "";
    cellEl.appendChild(sel);
    sel.focus();
  } else {
    const inp = document.createElement("input");
    inp.className = "inline-input";
    inp.value = current;
    inp.placeholder = field === "phone" ? "0XX-XXX-XXXX" : "ชื่อ";
    const save = async () => {
      const v = inp.value.trim();
      if (v === (current || "").trim()) { filterTable(); return; }
      if (field === "name" && !v) { showToast("ชื่อห้ามว่าง", "error"); filterTable(); return; }
      await _patchAttendee(attId, { [field]: v || null });
    };
    inp.onblur = save;
    inp.onkeydown = (e) => {
      if (e.key === "Enter") { e.preventDefault(); inp.blur(); }
      else if (e.key === "Escape") { filterTable(); }
    };
    cellEl.innerHTML = "";
    cellEl.appendChild(inp);
    inp.focus();
    inp.select();
  }
};

async function _patchAttendee(id, patch) {
  try {
    await updateAttendee(id, patch);
    const a = allAttendees.find(x => x.attendee_id === id);
    if (a) Object.assign(a, patch);
    updateStats();
    filterTable();
    showToast("บันทึกแล้ว", "success");
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
    filterTable();
  }
}

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
    "รหัสสมาชิก",
    "ตำแหน่งสูงสุด",
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
    a.member_code || "",
    a.position_level || "",
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
function payLabel(s) {
  return (
    {
      PAID: "💳 ชำระแล้ว",
      UNPAID: "⏳ ยังไม่ชำระ",
      COMPLIMENTARY: "🎫 ฟรี / ยกเว้น",
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

// ── ENFORCE REGISTRATION RULES ──────────────────────────────
let _currentEvent = null;

async function _loadCurrentEvent() {
  if (_currentEvent && _currentEvent.event_id === currentEventId) return _currentEvent;
  try {
    const rows = await sbFetch("events", `?event_id=eq.${currentEventId}&select=*&limit=1`);
    _currentEvent = rows?.[0] || null;
  } catch { _currentEvent = null; }
  return _currentEvent;
}

async function _enforceRegistration(payload) {
  const ev = await _loadCurrentEvent();
  if (!ev) return false;

  // 1. Check max_attendees
  if (ev.max_attendees && ev.max_attendees > 0) {
    const currentCount = allAttendees.length;
    if (currentCount >= ev.max_attendees) {
      showToast(`❌ เต็มแล้ว — จำกัด ${ev.max_attendees} คน (ลงทะเบียนแล้ว ${currentCount})`, "error");
      return true;
    }
  }

  // 2. Check members_only
  if (ev.members_only && !payload.member_code) {
    showToast("❌ Event นี้สำหรับสมาชิก MLM เท่านั้น — กรุณาเลือกสมาชิกก่อน", "error");
    return true;
  }

  // 3. Check prerequisite (if member selected + event has series/level)
  if (payload.member_code && ev.series_id && ev.level_id) {
    try {
      const { url, key } = getSB();
      const h = { apikey: key, Authorization: `Bearer ${key}` };

      // Get level → prerequisite
      const lvRes = await fetch(`${url}/rest/v1/course_levels?select=*&id=eq.${ev.level_id}`, { headers: h });
      const lvRows = lvRes.ok ? await lvRes.json() : [];
      const level = lvRows[0];

      if (level?.prerequisite_level_id) {
        // Get prerequisite level name
        const prRes = await fetch(`${url}/rest/v1/course_levels?select=*&id=eq.${level.prerequisite_level_id}`, { headers: h });
        const prereqLevel = (prRes.ok ? await prRes.json() : [])[0];

        // Check if member passed prerequisite
        const attRes = await fetch(`${url}/rest/v1/event_attendees?select=attendee_id,event_id&member_code=eq.${payload.member_code}&checked_in=eq.true`, { headers: h });
        const attended = attRes.ok ? await attRes.json() : [];

        let passed = false;
        if (attended.length) {
          const eventIds = attended.map(a => a.event_id).join(',');
          const evCheck = await fetch(`${url}/rest/v1/events?select=event_id&series_id=eq.${ev.series_id}&level_id=eq.${level.prerequisite_level_id}&event_id=in.(${eventIds})`, { headers: h });
          passed = (evCheck.ok ? await evCheck.json() : []).length > 0;
        }

        if (!passed) {
          showToast(`❌ ยังไม่ผ่าน prerequisite — ต้องเรียน ${prereqLevel?.level_name || 'level ก่อนหน้า'} ก่อน`, "error");
          return true;
        }
      }
    } catch (e) {
      console.warn('prereq check:', e);
    }
  }

  return false; // not blocked
}

// ── MEMBER SEARCH + PREREQUISITE CHECK ─────────────────────
let _memberSearchTimer = null;

let _lastMemberResults = [];
let _memberHighlight = 0;

function _positionSuggestUnderActiveRow() {
  if (!activeSearchRowId) return;
  const input = document.querySelector(`tr[data-nrid="${activeSearchRowId}"] input[data-role="search"]`);
  const sug = document.getElementById("memberSuggest");
  if (!input || !sug) return;
  const rect = input.getBoundingClientRect();
  sug.style.top = (rect.bottom + window.scrollY + 2) + "px";
  sug.style.left = (rect.left + window.scrollX) + "px";
  sug.style.width = rect.width + "px";
}

window.searchMember = function (q, rowId) {
  if (rowId) activeSearchRowId = rowId;
  clearTimeout(_memberSearchTimer);
  const sug = document.getElementById("memberSuggest");
  q = (q || "").trim();
  if (!q) { sug.style.display = "none"; _lastMemberResults = []; return; }

  // Show loading state
  sug.innerHTML = '<div style="padding:10px 12px;color:var(--text3,#94a3b8);font-size:12px">🔍 กำลังค้นหา...</div>';
  sug.style.display = "block";
  _positionSuggestUnderActiveRow();

  _memberSearchTimer = setTimeout(async () => {
    try {
      const { url, key } = getSB();
      const esc = q.replace(/[,()*]/g, '');
      const isDigits = /^\d+$/.test(esc);
      // Digits → exact member_code match only · Text → search names
      const filter = isDigits
        ? `member_code=eq.${encodeURIComponent(esc)}`
        : `or=(member_name.ilike.*${esc}*,full_name.ilike.*${esc}*)`;
      const res = await fetch(
        `${url}/rest/v1/members?select=member_code,member_name,full_name,phone,country_code,position_level&${filter}&limit=8`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.warn('searchMember API error:', res.status, errText);
        sug.innerHTML = `<div style="padding:10px 12px;color:#dc2626;font-size:12px">⚠️ ค้นหาไม่สำเร็จ (${res.status})</div>`;
        return;
      }
      const rows = await res.json();
      if (!rows || !rows.length) {
        _lastMemberResults = [];
        sug.innerHTML = '<div style="padding:10px 12px;color:var(--text3,#94a3b8);font-size:12px">ไม่พบสมาชิก</div>';
        return;
      }
      _lastMemberResults = rows;
      _memberHighlight = 0;
      _renderMemberSuggest();
    } catch (e) {
      console.warn('searchMember:', e);
      sug.innerHTML = `<div style="padding:10px 12px;color:#dc2626;font-size:12px">⚠️ ${e.message || 'error'}</div>`;
    }
  }, 250);
};

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function _renderMemberSuggest() {
  const sug = document.getElementById("memberSuggest");
  if (!_lastMemberResults.length) { sug.style.display = "none"; return; }
  _positionSuggestUnderActiveRow();
  sug.innerHTML = _lastMemberResults.map((m, i) => {
    const name = m.full_name || m.member_name || '—';
    const safeName = escapeHtml(name).replace(/'/g, "&#39;");
    const hl = i === _memberHighlight;
    const bg = hl ? '#dbeafe' : 'transparent';
    return `<div data-idx="${i}" onclick="selectMember('${m.member_code}','${safeName}','${m.phone||''}','${m.position_level||''}')" style="padding:9px 12px;cursor:pointer;border-bottom:1px solid var(--border,#e2e8f0);font-size:12.5px;transition:background .1s;display:flex;align-items:center;gap:8px;background:${bg}" onmouseover="window._setMemberHL(${i})" onmouseout="">
      <span style="font-family:'IBM Plex Mono',monospace;color:#1e40af;font-weight:700;background:#dbeafe;padding:2px 7px;border-radius:5px;font-size:11.5px">${m.member_code}</span>
      <span style="flex:1;color:#0f172a">${escapeHtml(name)}</span>
      ${m.position_level ? `<span style="font-size:10.5px;color:#92400e;background:#fef3c7;padding:1px 6px;border-radius:4px;font-weight:700">⭐ ${escapeHtml(m.position_level)}</span>` : ''}
      ${m.country_code ? `<span style="font-size:10.5px;color:var(--text3,#94a3b8);background:#f1f5f9;padding:1px 6px;border-radius:4px">${m.country_code}</span>` : ''}
    </div>`;
  }).join('');
  sug.style.display = "block";
}

window._setMemberHL = function (i) {
  _memberHighlight = i;
  _renderMemberSuggest();
};

window._onMemberSearchKey = function (ev) {
  const sug = document.getElementById("memberSuggest");
  const open = sug && sug.style.display !== "none" && _lastMemberResults.length;
  if (ev.key === "Escape") {
    if (open) { ev.preventDefault(); sug.style.display = "none"; }
    return;
  }
  if (!open) return;
  if (ev.key === "ArrowDown") {
    ev.preventDefault();
    _memberHighlight = (_memberHighlight + 1) % _lastMemberResults.length;
    _renderMemberSuggest();
    _scrollHighlightIntoView();
  } else if (ev.key === "ArrowUp") {
    ev.preventDefault();
    _memberHighlight = (_memberHighlight - 1 + _lastMemberResults.length) % _lastMemberResults.length;
    _renderMemberSuggest();
    _scrollHighlightIntoView();
  } else if (ev.key === "Enter") {
    ev.preventDefault();
    ev.stopPropagation();
    const m = _lastMemberResults[_memberHighlight];
    if (m) {
      const name = m.full_name || m.member_name || '—';
      window.selectMember(m.member_code, name, m.phone || '', m.position_level || '');
    }
  }
};

function _scrollHighlightIntoView() {
  const sug = document.getElementById("memberSuggest");
  const el = sug?.querySelector(`[data-idx="${_memberHighlight}"]`);
  if (el?.scrollIntoView) el.scrollIntoView({ block: "nearest" });
}

window.selectMember = function (code, name, phone, positionLevel) {
  document.getElementById("memberSuggest").style.display = "none";
  _lastMemberResults = [];
  if (!activeSearchRowId) return;
  _applyMemberToRow(activeSearchRowId, code, name, phone || "", positionLevel || "");
  // Focus save button (user can press Enter to save immediately)
  requestAnimationFrame(() => {
    const saveBtn = document.querySelector(`tr[data-nrid="${activeSearchRowId}"] .inline-save-btn`);
    saveBtn?.focus();
  });
};

// Close member suggest on click outside any new-row search input
document.addEventListener("click", (e) => {
  const sug = document.getElementById("memberSuggest");
  if (!sug) return;
  if (e.target.closest("#memberSuggest")) return;
  if (e.target.matches("tr.new-row input[data-role='search']")) return;
  sug.style.display = "none";
});

// Reposition dropdown on scroll/resize
window.addEventListener("scroll", () => {
  const sug = document.getElementById("memberSuggest");
  if (sug && sug.style.display !== "none") _positionSuggestUnderActiveRow();
}, true);
window.addEventListener("resize", () => {
  const sug = document.getElementById("memberSuggest");
  if (sug && sug.style.display !== "none") _positionSuggestUnderActiveRow();
});

// ── START ─────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPage);
} else {
  initPage();
}
