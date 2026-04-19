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
  const rows = await sbFetch(
    "event_attendees",
    `?event_id=eq.${eventId}&order=created_at.asc`,
  ) || [];
  // Enrich with CURRENT primary line_user_id from members (latest LIFF login across ALL events)
  // This lets admin-added attendees (never went through LIFF) still receive LINE if their member linked on another event
  await _enrichWithMemberLineId(rows);
  return rows;
}

async function _enrichWithMemberLineId(attendees) {
  if (!attendees.length) return;
  const codes = [...new Set(attendees.map(a => a.member_code).filter(Boolean))];
  if (!codes.length) return;
  try {
    const inList = codes.map(c => encodeURIComponent(c)).join(",");
    const rows = await sbFetch(
      "members",
      `?member_code=in.(${inList})&select=member_code,line_user_id,line_display_name,line_picture_url,line_linked_at`,
    );
    if (!rows?.length) return;
    const byCode = {};
    rows.forEach(r => { byCode[r.member_code] = r; });
    attendees.forEach(a => {
      const m = byCode[a.member_code];
      if (!m) return;
      // Prefer members.line_user_id (latest); fallback to event_attendees value for legacy data
      if (m.line_user_id) {
        a.line_user_id = m.line_user_id;
        a.line_display_name = m.line_display_name || a.line_display_name;
        a.line_picture_url = m.line_picture_url || a.line_picture_url;
      }
    });
  } catch (e) {
    console.warn("enrich line_user_id:", e.message);
  }
}
async function fetchTiers(eventId) {
  try {
    const rows = await sbFetch(
      "event_ticket_tiers",
      `?event_id=eq.${eventId}&select=*&order=sort_order.asc,valid_from.asc.nullsfirst`,
    );
    return rows || [];
  } catch (e) {
    // Table may not exist yet — degrade gracefully (no tiers = use events.price)
    console.warn("fetchTiers:", e.message);
    return [];
  }
}
async function fetchDefaultGrace() {
  try {
    const rows = await sbFetch(
      "app_settings",
      "?key=eq.default_grace_days&select=value",
    );
    const v = parseInt(rows?.[0]?.value);
    return isNaN(v) ? 3 : v;
  } catch {
    return 3;
  }
}
async function uploadSlip(eventId, file) {
  const { url, key } = getSB();
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `slips/${eventId}_${Date.now()}.${ext}`;
  const res = await fetch(
    `${url}/storage/v1/object/event-files/${path}`,
    {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": file.type || "image/jpeg",
        "x-upsert": "true",
      },
      body: file,
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Slip upload failed");
  }
  return `${url}/storage/v1/object/public/event-files/${path}`;
}
// Generate short event code from event_name (initials) — fallback to event_code tail / event_id
function getEventShortCode(ev) {
  if (!ev) return "";
  const name = (ev.event_name || "").trim();
  if (name) {
    const initials = name
      .split(/\s+/)
      .map((w) => {
        const clean = w.replace(/[^A-Za-z0-9\u0E00-\u0E7F]/g, "");
        return clean ? clean.charAt(0) : "";
      })
      .filter(Boolean)
      .join("")
      .toUpperCase();
    if (initials) return initials;
  }
  const parts = (ev.event_code || "").split("-");
  const tail = parts[parts.length - 1];
  return tail || String(ev.event_id || "");
}

async function generateTicketNo(eventId) {
  const { url, key } = getSB();
  const ev = currentEvent || allEvents.find((e) => e.event_id === eventId);
  const shortCode = getEventShortCode(ev) || String(eventId);
  const newPrefix = `A4S-${shortCode}-`;
  // Query ALL tickets for this event (any prefix) so running number stays continuous
  // even when legacy tickets used different prefixes (TK-, A4S-<eventId>-, etc.)
  const res = await fetch(
    `${url}/rest/v1/event_attendees?event_id=eq.${eventId}&select=ticket_no`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  const rows = await res.json().catch(() => []);
  let maxSeq = 0;
  (rows || []).forEach((r) => {
    const parts = (r.ticket_no || "").split("-");
    const n = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(n) && n > maxSeq) maxSeq = n;
  });
  return `${newPrefix}${String(maxSeq + 1).padStart(4, "0")}`;
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
let currentTiers = [];       // Tiers สำหรับ event ปัจจุบัน
let currentTiersById = {};   // lookup tier_id → tier
let defaultGraceDays = 3;    // จาก app_settings.default_grace_days
let _paymentModalAtt = null; // attendee object while modal open
let _qrModalAtt = null;      // attendee object while QR modal open

// Inline new rows (not yet saved)
let newRows = [];
let activeSearchRowId = null; // ID of new-row currently showing member suggest
let _searchKeyword = "";       // live keyword จาก new-row input (ใช้ filter ด้วย)
let _autoCheckin = false;      // โหมดหน้างาน: save แล้ว check-in ทันที

// ── DEADLINE / EXPIRED HELPERS ────────────────────────────
function getEventGraceDays() {
  const g = currentEvent?.grace_days;
  if (g == null || g === "" || isNaN(g)) return defaultGraceDays;
  return parseInt(g);
}
function computeDeadlineISO(graceDays) {
  const d = new Date();
  d.setDate(d.getDate() + (graceDays || 0));
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}
function isAttendeeExpired(a) {
  if (a.payment_status !== "UNPAID") return false;
  if (!a.payment_deadline) return false;
  const today = new Date().toISOString().slice(0, 10);
  return a.payment_deadline < today;
}
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date().toISOString().slice(0, 10);
  const diff = Math.ceil((new Date(dateStr) - new Date(today)) / 86400000);
  return diff;
}
function formatDMYShort(isoDate) {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

// หา tier ที่ active ณ วันนี้ — เลือกตาม sort_order น้อยสุดถ้ามี overlap
function getActiveTier() {
  if (!currentTiers?.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  const match = currentTiers.filter((t) => {
    if (t.valid_from && today < t.valid_from) return false;
    if (t.valid_to && today > t.valid_to) return false;
    return true;
  });
  match.sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.tier_id - b.tier_id,
  );
  return match[0] || null;
}

// ราคาปัจจุบัน — tier ถ้ามี, fallback events.price
function getCurrentPrice() {
  const t = getActiveTier();
  if (t) return parseFloat(t.price || 0);
  return parseFloat(currentEvent?.price || 0);
}

function makeEmptyNewRow() {
  const evPrice = getCurrentPrice();
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
    defaultGraceDays = await fetchDefaultGrace();
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
    .getElementById("filterCheckin")
    ?.addEventListener("change", filterTable);
  document
    .getElementById("filterPayment")
    ?.addEventListener("change", filterTable);
  document
    .getElementById("filterTag")
    ?.addEventListener("change", filterTable);

  // File input change → preview slip
  document
    .getElementById("paySlipFile")
    ?.addEventListener("change", _onSlipFileChange);
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
    const [atts, tiers] = await Promise.all([
      fetchAttendees(eventId),
      fetchTiers(eventId),
    ]);
    allAttendees = atts || [];
    currentTiers = tiers || [];
    currentTiersById = {};
    currentTiers.forEach((t) => { currentTiersById[t.tier_id] = t; });
    // Reset inline new-rows (ราคา default ขึ้นกับ active tier)
    newRows = [makeEmptyNewRow()];
    showSections(true);
    renderTierBanner();
    populateTagFilter();
    _loadAutoCheckinState();
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

// ── TIER INFO BANNER ──────────────────────────────────────
function renderTierBanner() {
  const el = document.getElementById("tierInfoBanner");
  if (!el || !currentEvent) {
    if (el) { el.style.display = "none"; el.innerHTML = ""; }
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const fmt = (d) => (d ? d.split("-").reverse().join("/") : "");
  const daysTo = (d) => {
    if (!d) return null;
    return Math.ceil((new Date(d) - new Date(today)) / 86400000);
  };

  const active = getActiveTier();
  const effectiveGrace = getEventGraceDays();
  const soldCount = allAttendees.length;
  const maxCap = currentEvent.max_attendees || 0;

  const tierStatus = (t) => {
    if (t.valid_from && today < t.valid_from) return "upcoming";
    if (t.valid_to && today > t.valid_to) return "ended";
    return "active";
  };
  const statusBadge = {
    active: '<span class="tier-pill tier-pill-active">● ACTIVE</span>',
    upcoming: '<span class="tier-pill tier-pill-upcoming">⏭ UPCOMING</span>',
    ended: '<span class="tier-pill tier-pill-ended">✕ ENDED</span>',
  };

  const priceHdr = active
    ? `<b>${escapeHtml(active.tier_name)}</b> — <b style="color:#059669">฿${formatNum(active.price)}</b>`
    : currentTiers.length
    ? `<span style="color:#92400e">ไม่อยู่ในช่วง Tier — ใช้ราคามาตรฐาน <b>฿${formatNum(currentEvent.price || 0)}</b></span>`
    : `<b style="color:#059669">฿${formatNum(currentEvent.price || 0)}</b> <span style="color:var(--text3);font-size:11.5px">(ไม่มี Tier)</span>`;

  // Build cells ตามที่มีข้อมูลจริงเท่านั้น
  const hasPrice = (currentEvent.price || 0) > 0 || active;
  const hasCustomGrace = currentEvent.grace_days != null;
  const hasSeatLimit = maxCap > 0;

  const cells = [];
  if (hasPrice) {
    cells.push(`<div class="info-cell">
      <div class="info-label">💰 ราคาปัจจุบัน</div>
      <div class="info-value">${priceHdr}</div>
      ${active && active.valid_to ? `<div class="info-sub">สิ้นสุด ${fmt(active.valid_to)} · เหลืออีก ${daysTo(active.valid_to)} วัน</div>` : ""}
    </div>`);
  }
  if (hasCustomGrace) {
    cells.push(`<div class="info-cell">
      <div class="info-label">⏳ Grace Period</div>
      <div class="info-value">${effectiveGrace} วัน</div>
    </div>`);
  }
  if (hasSeatLimit) {
    cells.push(`<div class="info-cell">
      <div class="info-label">🎫 ที่นั่ง</div>
      <div class="info-value">${soldCount} / ${maxCap}</div>
      <div class="info-sub">เหลือ ${Math.max(0, maxCap - soldCount)} ที่</div>
    </div>`);
  }

  // ถ้าไม่มีข้อมูลเลยและไม่มี tier → ไม่แสดง panel
  if (!cells.length && !currentTiers.length) {
    el.style.display = "none";
    el.innerHTML = "";
    return;
  }

  let html = `<div class="info-panel">`;
  if (cells.length) {
    html += `<div class="info-panel-grid" style="grid-template-columns:repeat(${cells.length},1fr)${currentTiers.length ? ";border-bottom:1px solid var(--border,#e2e8f0);padding-bottom:12px" : ";border:none;padding:0"}">${cells.join("")}</div>`;
  }

  if (currentTiers.length) {
    html += `<div class="info-tier-list">
      <div class="info-tier-hdr">🎟️ ระดับราคาทั้งหมด (${currentTiers.length})</div>
      <div class="info-tier-rows">`;
    currentTiers.forEach((t) => {
      const s = tierStatus(t);
      const soldInTier = allAttendees.filter((a) => a.tier_id === t.tier_id).length;
      const seatInfo = t.seat_limit
        ? ` · <span style="color:${soldInTier >= t.seat_limit ? "#991b1b" : "var(--text3)"}">${soldInTier}/${t.seat_limit} ที่</span>`
        : soldInTier
        ? ` · <span style="color:var(--text3)">${soldInTier} คน</span>`
        : "";
      const dateRange =
        (t.valid_from ? fmt(t.valid_from) : "—") +
        " → " +
        (t.valid_to ? fmt(t.valid_to) : "—");
      html += `<div class="info-tier-row ${s === "active" ? "is-active" : ""}">
        <div class="info-tier-left">
          ${statusBadge[s]}
          <b>${escapeHtml(t.tier_name)}</b>
          <span class="info-tier-price">฿${formatNum(t.price)}</span>
        </div>
        <div class="info-tier-right">${dateRange}${seatInfo}</div>
      </div>`;
    });
    html += `</div></div>`;
  }

  html += `</div>`;
  el.innerHTML = html;
  el.style.display = "block";
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
  const search = (_searchKeyword || "").toLowerCase();
  const checkin = document.getElementById("filterCheckin")?.value || "";
  const payment = document.getElementById("filterPayment")?.value || "";
  const tagFilter = document.getElementById("filterTag")?.value || "";

  const filtered = allAttendees.filter((a) => {
    const matchSearch =
      !search ||
      (a.name || "").toLowerCase().includes(search) ||
      (a.phone || "").toLowerCase().includes(search) ||
      (a.member_code || "").toLowerCase().includes(search) ||
      (a.ticket_no || "").toLowerCase().includes(search) ||
      (a.tags || []).some((t) => (t || "").toLowerCase().includes(search));
    const matchCheckin = !checkin || String(a.checked_in) === checkin;
    const matchPayment =
      !payment ||
      (payment === "EXPIRED"
        ? isAttendeeExpired(a)
        : a.payment_status === payment);
    const matchTag = !tagFilter || (a.tags || []).includes(tagFilter);
    return matchSearch && matchCheckin && matchPayment && matchTag;
  });

  renderTable(filtered);
}

function renderTable(list) {
  const tbody = document.getElementById("attTableBody");
  const countEl = document.getElementById("attCount");
  if (countEl) countEl.textContent = `${list.length} คน`;

  ensureTrailingEmptyRow();

  const newRowsHtml = newRows.map(renderNewRow).join("");
  tbody.innerHTML = newRowsHtml + _buildSavedRowsHtml(list);
}

function _buildSavedRowsHtml(list) {
  return list.length
    ? list.map(renderSavedRow).join("")
    : `<tr class="empty-state-row"><td colspan="6"><div class="empty-state" style="padding:20px">
        <div class="empty-icon" style="font-size:28px">👥</div>
        <div class="empty-text" style="font-size:12px">ยังไม่มีผู้เข้าร่วมที่ตรง — พิมพ์ที่แถวบนเพื่อเพิ่ม</div>
      </div></td></tr>`;
}

// Re-render เฉพาะ saved rows ไม่แตะ new-row → ไม่เสีย focus ตอนพิมพ์
function renderSavedRowsOnly(list) {
  const tbody = document.getElementById("attTableBody");
  if (!tbody) return;
  // ลบ saved-row + empty-state-row ทั้งหมด
  tbody
    .querySelectorAll("tr.saved-row, tr.empty-state-row")
    .forEach((tr) => tr.remove());
  tbody.insertAdjacentHTML("beforeend", _buildSavedRowsHtml(list));
  const countEl = document.getElementById("attCount");
  if (countEl) countEl.textContent = `${list.length} คน`;
}

// filter + update เฉพาะ saved rows (ใช้ตอนพิมพ์ใน new-row)
function filterTableSavedOnly() {
  const search = (_searchKeyword || "").toLowerCase();
  const checkin = document.getElementById("filterCheckin")?.value || "";
  const payment = document.getElementById("filterPayment")?.value || "";
  const tagFilter = document.getElementById("filterTag")?.value || "";

  const filtered = allAttendees.filter((a) => {
    const matchSearch =
      !search ||
      (a.name || "").toLowerCase().includes(search) ||
      (a.phone || "").toLowerCase().includes(search) ||
      (a.member_code || "").toLowerCase().includes(search) ||
      (a.ticket_no || "").toLowerCase().includes(search) ||
      (a.tags || []).some((t) => (t || "").toLowerCase().includes(search));
    const matchCheckin = !checkin || String(a.checked_in) === checkin;
    const matchPayment =
      !payment ||
      (payment === "EXPIRED"
        ? isAttendeeExpired(a)
        : a.payment_status === payment);
    const matchTag = !tagFilter || (a.tags || []).includes(tagFilter);
    return matchSearch && matchCheckin && matchPayment && matchTag;
  });
  renderSavedRowsOnly(filtered);
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
        <input class="inline-input" placeholder="🔍 พิมพ์รหัส/ชื่อ — เพื่อเพิ่ม หรือ filter รายการด้านล่าง" autocomplete="off"
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
  const expired = isAttendeeExpired(a);
  const displayPayStatus = expired ? "EXPIRED" : (a.payment_status || "COMPLIMENTARY");
  const tierName = a.tier_id && currentTiersById[a.tier_id]
    ? currentTiersById[a.tier_id].tier_name
    : null;
  return `<tr class="saved-row" data-aid="${a.attendee_id}">
    <td>
      <div class="cell-name-wrap" data-field="name" onclick="window.startEditCell(${a.attendee_id},'name',this)">
        <div style="font-weight:600;cursor:text" title="คลิกเพื่อแก้ไข">
          ${a.member_code ? `<span style="font-family:'IBM Plex Mono',monospace;font-size:10px;background:#1e40af;color:#fff;padding:2px 7px;border-radius:10px;font-weight:700;margin-right:6px">${escapeHtml(a.member_code)}</span>` : ""}${escapeHtml(a.name)}
        </div>
        ${a.phone ? `<div style="font-size:11px;color:var(--text3)">📱 ${escapeHtml(a.phone)}</div>` : ""}
        ${renderTagsInline(a)}
      </div>
    </td>
    <td class="col-center">
      ${a.position_level ? `<span class="cell-member-pos">⭐ ${escapeHtml(a.position_level)}</span>` : '<span style="color:var(--text3);font-size:11px">—</span>'}
    </td>
    <td class="col-center">
      <div class="cell-ticket">${a.ticket_no || "—"}</div>
    </td>
    <td class="col-center">
      <span class="pay-badge pay-${displayPayStatus}"
        onclick="window.startEditCell(${a.attendee_id},'payment_status',this)"
        style="cursor:pointer" title="คลิกเพื่อบันทึกการชำระ">
        ${payLabel(displayPayStatus)}
      </span>
      ${parseFloat(a.paid_amount || 0) > 0 ? `<div style="font-size:11px;color:var(--text3);margin-top:2px">฿${formatNum(a.paid_amount)}</div>` : ""}
      ${tierName ? `<div class="tier-chip" title="ราคาที่ lock ตอนลงทะเบียน">🎟️ ${escapeHtml(tierName)}</div>` : ""}
      ${a.payment_method ? `<div class="tier-chip" style="background:#dbeafe;color:#1e40af" title="วิธีชำระ">${paymentMethodIcon(a.payment_method)}</div>` : ""}
      ${renderDeadlineChip(a)}
    </td>
    <td class="col-center">
      <button class="btn-checkin ${a.checked_in ? "undo-checkin" : "do-checkin"}"
        onclick="window.toggleCheckin(${a.attendee_id}, ${a.checked_in})">
        ${a.checked_in ? "✅ เข้างานแล้ว" : "⬜ Check-in"}
      </button>
      ${a.check_in_at ? `<div style="font-size:10px;color:var(--text3);margin-top:2px">${formatDateTime(a.check_in_at)}</div>` : ""}
    </td>
    <td class="col-center">
      <div style="display:inline-flex;gap:4px;align-items:center">
        <button class="btn-qr" onclick="window.openQrModal(${a.attendee_id})" title="ดู QR บัตร">🎫</button>
        <button class="btn-icon danger" onclick="window.deleteAttendee(${a.attendee_id})" title="ลบ">🗑</button>
      </div>
    </td>
  </tr>`;
}

function paymentMethodIcon(m) {
  return {
    slip_kbank: "🏦 K+",
    slip_ktb: "🏦 KTB",
    cash: "💵 เงินสด",
    credit_card: "💳 CC",
  }[m] || m;
}

function renderDeadlineChip(a) {
  if (a.payment_status !== "UNPAID" || !a.payment_deadline) return "";
  const d = daysUntil(a.payment_deadline);
  if (d == null) return "";
  const cls = d < 0 ? "expired" : d <= 1 ? "near" : "ok";
  const icon = d < 0 ? "⌛" : "⏳";
  const label = d < 0
    ? `เกิน ${Math.abs(d)} วัน`
    : d === 0
    ? "วันนี้"
    : `อีก ${d} วัน`;
  return `<div class="deadline-chip ${cls}" title="ครบกำหนด ${formatDMYShort(a.payment_deadline)}">${icon} ${label}</div>`;
}

function renderTagsInline(a) {
  const tags = a.tags || [];
  const chips = tags
    .map(
      (t) => `<span class="tag-chip">${escapeHtml(t)}<span class="tag-chip-remove"
        onclick="event.stopPropagation();window.removeAttendeeTag(${a.attendee_id},'${escapeJS(t)}')">✕</span></span>`,
    )
    .join("");
  return `<div class="tag-chips" onclick="event.stopPropagation()">
    ${chips}
    <button class="tag-chip" style="background:#e2e8f0;color:#475569;border:none;cursor:pointer;font-size:10px"
      onclick="event.stopPropagation();window.promptAddTag(${a.attendee_id})">+ tag</button>
  </div>`;
}
function escapeJS(s) {
  return String(s || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
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
  // ใช้ input นี้เป็น filter ของรายชื่อด้านล่างด้วย
  _searchKeyword = val || "";
  // If member is already linked, skip member search — user is just tweaking the display name
  if (!r.memberCode) {
    window.searchMember(val, id);
  }
  // Update saved-rows filter ทันที (ไม่แตะ new-row → ไม่เสีย focus)
  filterTableSavedOnly();
  // Auto-add trailing empty row เฉพาะตอนเริ่มพิมพ์ในแถวสุดท้าย
  const isLast = newRows[newRows.length - 1].id === id;
  const prevCount = newRows.length;
  if (isLast && val.trim()) {
    ensureTrailingEmptyRow();
    // Append เฉพาะ trailing row ใหม่ — ไม่ไปแตะแถวที่ user กำลังพิมพ์
    if (newRows.length !== prevCount) {
      _appendLastNewRow();
    }
  }
  _updateSaveBtn(id);
};

// Insert เฉพาะ trailing empty row ที่เพิ่มล่าสุด ไปต่อท้าย new-rows (ไม่แตะของเดิม)
function _appendLastNewRow() {
  const tbody = document.getElementById("attTableBody");
  if (!tbody) return;
  const last = newRows[newRows.length - 1];
  if (!last) return;
  const html = renderNewRow(last);
  // Insert ก่อน saved-row ตัวแรก (หรือ empty-state-row)
  const firstSavedOrEmpty = tbody.querySelector("tr.saved-row, tr.empty-state-row");
  if (firstSavedOrEmpty) {
    firstSavedOrEmpty.insertAdjacentHTML("beforebegin", html);
  } else {
    tbody.insertAdjacentHTML("beforeend", html);
  }
}

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
  let name = (r.name || "").trim();
  if (!name) { showToast("กรุณาระบุชื่อ", "error"); return; }
  if (r.saving) return;
  r.saving = true; _updateSaveBtn(id);

  // Auto-link member if user typed a code but didn't pick from dropdown
  if (!r.memberCode && /^\d{3,10}$/.test(name)) {
    try {
      const { url, key } = getSB();
      const res = await fetch(
        `${url}/rest/v1/members?select=member_code,full_name,member_name,phone,position_level&member_code=eq.${encodeURIComponent(name)}&limit=1`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` } }
      );
      if (res.ok) {
        const rows = await res.json();
        const m = rows?.[0];
        if (m) {
          r.memberCode = m.member_code;
          r.name = m.full_name || m.member_name || name;
          r.phone = m.phone || r.phone || "";
          r.positionLevel = m.position_level || "";
          name = r.name;
        }
      }
    } catch (e) { console.warn("auto-link:", e); }
  }

  // Duplicate check up-front → if dup, clear row & let user continue
  if (r.memberCode) {
    const dup = allAttendees.find(a => a.member_code === r.memberCode);
    if (dup) {
      showToast(`❌ สมาชิก ${r.memberCode} (${dup.name}) ลงทะเบียนแล้ว — Ticket: ${dup.ticket_no || "—"}`, "error");
      r.memberCode = ""; r.name = ""; r.phone = "";
      r.positionLevel = ""; r.prereq = null; r.saving = false;
      filterTable();
      requestAnimationFrame(() => {
        const input = document.querySelector(`tr[data-nrid="${id}"] input[data-role="search"]`);
        input?.focus();
      });
      return;
    }
  }

  try {
    const activeTier = getActiveTier();
    const price = getCurrentPrice();
    const grace = getEventGraceDays();
    const needsPayment = r.paymentStatus === "UNPAID";
    const payload = {
      event_id: currentEventId,
      name,
      phone: r.phone || null,
      position_level: r.positionLevel || null,
      paid_amount: price,
      payment_status: r.paymentStatus,
      member_code: r.memberCode || null,
      tier_id: activeTier?.tier_id || null,
      payment_deadline: needsPayment ? computeDeadlineISO(grace) : null,
      checked_in: _autoCheckin ? true : false,
      check_in_at: _autoCheckin ? new Date().toISOString() : null,
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
    _searchKeyword = ""; // เคลียร์ filter หลัง save
    populateTagFilter();
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

  // Payment cell → open full modal (method, slip, ref)
  if (field === "payment_status") {
    window.openPaymentModal(attId);
    return;
  }

  const current = a[field] || "";
  {
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
      EXPIRED: "⌛ เกินกำหนด",
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

  // 1b. Check tier seat_limit (ถ้ามี tier_id + tier กำหนด limit)
  if (payload.tier_id) {
    const tier = currentTiersById[payload.tier_id];
    if (tier?.seat_limit && tier.seat_limit > 0) {
      const usedInTier = allAttendees.filter((a) => a.tier_id === tier.tier_id).length;
      if (usedInTier >= tier.seat_limit) {
        showToast(`❌ Tier "${tier.tier_name}" เต็มแล้ว (${tier.seat_limit} ที่นั่ง)`, "error");
        return true;
      }
    }
  }

  // 2. Check members_only
  if (ev.members_only && !payload.member_code) {
    showToast("❌ Event นี้สำหรับสมาชิก MLM เท่านั้น — กรุณาเลือกสมาชิกก่อน", "error");
    return true;
  }

  // 2.5 Check duplicate member registration (same event, same member_code)
  if (payload.member_code) {
    const dup = allAttendees.find(a => a.member_code === payload.member_code);
    if (dup) {
      showToast(`❌ สมาชิก ${payload.member_code} (${dup.name}) ลงทะเบียนแล้ว — Ticket: ${dup.ticket_no || "—"}`, "error");
      return true;
    }
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
      const rowId = activeSearchRowId;
      window.selectMember(m.member_code, name, m.phone || '', m.position_level || '');
      // Auto-save immediately after Enter-selecting a member
      if (rowId) {
        requestAnimationFrame(() => window.saveNewRow(rowId));
      }
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

// ============================================================
// ── TAG POPULATE + CRUD ───────────────────────────────────
// ============================================================
function populateTagFilter() {
  const sel = document.getElementById("filterTag");
  if (!sel) return;
  const allTags = new Set();
  allAttendees.forEach((a) => (a.tags || []).forEach((t) => allTags.add(t)));
  const current = sel.value;
  sel.innerHTML =
    '<option value="">🏷️ ทุก tag</option>' +
    [...allTags]
      .sort()
      .map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`)
      .join("");
  if (current && allTags.has(current)) sel.value = current;
}

window.promptAddTag = async function (attendeeId) {
  const tag = prompt("เพิ่ม tag ใหม่ (เช่น เข็มทอง, VIP, โทฟี่):");
  if (!tag) return;
  const t = tag.trim();
  if (!t) return;
  const a = allAttendees.find((x) => x.attendee_id === attendeeId);
  if (!a) return;
  const current = a.tags || [];
  if (current.includes(t)) {
    showToast("มี tag นี้อยู่แล้ว", "error");
    return;
  }
  const next = [...current, t];
  try {
    await updateAttendee(attendeeId, { tags: next });
    a.tags = next;
    populateTagFilter();
    filterTable();
    showToast(`+ tag "${t}" 🏷️`, "success");
  } catch (e) {
    showToast("เพิ่ม tag ไม่สำเร็จ: " + e.message, "error");
  }
};

window.removeAttendeeTag = async function (attendeeId, tag) {
  const a = allAttendees.find((x) => x.attendee_id === attendeeId);
  if (!a) return;
  const next = (a.tags || []).filter((t) => t !== tag);
  try {
    await updateAttendee(attendeeId, { tags: next.length ? next : null });
    a.tags = next;
    populateTagFilter();
    filterTable();
    showToast(`- tag "${tag}"`, "success");
  } catch (e) {
    showToast("ลบ tag ไม่สำเร็จ: " + e.message, "error");
  }
};

// ============================================================
// ── PAYMENT MODAL ─────────────────────────────────────────
// ============================================================
window.openPaymentModal = function (attendeeId) {
  const a = allAttendees.find((x) => x.attendee_id === attendeeId);
  if (!a) return;
  _paymentModalAtt = a;

  const infoEl = document.getElementById("payAttendeeInfo");
  const tierName =
    a.tier_id && currentTiersById[a.tier_id]
      ? currentTiersById[a.tier_id].tier_name
      : null;
  const deadlineStr = a.payment_deadline ? formatDMYShort(a.payment_deadline) : "—";
  infoEl.innerHTML = `
    <div><b>${escapeHtml(a.name)}</b> ${a.member_code ? `· ${escapeHtml(a.member_code)}` : ""}</div>
    <div>🎫 Ticket: <b>${a.ticket_no || "—"}</b> · ราคา <b>฿${formatNum(a.paid_amount)}</b>${tierName ? ` · Tier <b>${escapeHtml(tierName)}</b>` : ""}</div>
    <div>⏳ Deadline: <b>${deadlineStr}</b></div>`;

  // Preset fields from attendee
  document.querySelectorAll('input[name="payStatus"]').forEach((el) => {
    el.checked = el.value === (a.payment_status || "UNPAID");
  });
  document.querySelectorAll('input[name="payMethod"]').forEach((el) => {
    el.checked = el.value === a.payment_method;
  });
  document.getElementById("payRef").value = a.payment_ref || "";
  const preview = document.getElementById("paySlipPreview");
  preview.innerHTML = a.slip_url
    ? `<a href="${a.slip_url}" target="_blank"><img src="${a.slip_url}" style="max-width:100%;max-height:160px;border-radius:8px;border:1px solid var(--border)"></a>`
    : "";
  document.getElementById("paySlipFile").value = "";

  _syncPayMethodBlocks();
  document.querySelectorAll('input[name="payStatus"]').forEach((el) => {
    el.onchange = _syncPayMethodBlocks;
  });
  document.querySelectorAll('input[name="payMethod"]').forEach((el) => {
    el.onchange = _syncPayMethodBlocks;
  });

  document.getElementById("paymentModal").classList.add("open");
};

window.closePaymentModal = function () {
  document.getElementById("paymentModal").classList.remove("open");
  _paymentModalAtt = null;
};

function _syncPayMethodBlocks() {
  const status =
    document.querySelector('input[name="payStatus"]:checked')?.value ||
    "UNPAID";
  const method =
    document.querySelector('input[name="payMethod"]:checked')?.value || "";
  const needsMethod = status === "PAID";
  const isSlip = method === "slip_kbank" || method === "slip_ktb";
  document.getElementById("payMethodBlock").style.display = needsMethod
    ? "flex"
    : "none";
  document.getElementById("paySlipBlock").style.display =
    needsMethod && isSlip ? "flex" : "none";
  document.getElementById("payRefBlock").style.display = needsMethod
    ? "flex"
    : "none";
}

let _pendingSlipFile = null;
function _onSlipFileChange(ev) {
  const f = ev.target.files?.[0];
  _pendingSlipFile = f || null;
  const preview = document.getElementById("paySlipPreview");
  if (!f) {
    preview.innerHTML = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    preview.innerHTML = `<img src="${reader.result}" style="max-width:100%;max-height:160px;border-radius:8px;border:1px solid var(--border)">`;
  };
  reader.readAsDataURL(f);
}

window.savePayment = async function () {
  if (!_paymentModalAtt) return;
  const a = _paymentModalAtt;
  const status =
    document.querySelector('input[name="payStatus"]:checked')?.value || "UNPAID";
  const method =
    document.querySelector('input[name="payMethod"]:checked')?.value || null;
  const ref = document.getElementById("payRef").value.trim() || null;

  if (status === "PAID" && !method) {
    showToast("กรุณาเลือกช่องทางการชำระ", "error");
    return;
  }

  showLoading(true);
  try {
    // Upload slip ถ้ามี file + method เป็น slip
    let slipUrl = a.slip_url || null;
    if (_pendingSlipFile && (method === "slip_kbank" || method === "slip_ktb")) {
      slipUrl = await uploadSlip(currentEventId, _pendingSlipFile);
      _pendingSlipFile = null;
    }

    const session = JSON.parse(
      localStorage.getItem("erp_session") ||
        sessionStorage.getItem("erp_session") ||
        "{}",
    );

    const patch = {
      payment_status: status,
      payment_method: status === "PAID" ? method : null,
      payment_ref: status === "PAID" ? ref : null,
      slip_url: status === "PAID" && (method === "slip_kbank" || method === "slip_ktb")
        ? slipUrl
        : null,
      paid_at: status === "PAID" ? new Date().toISOString() : null,
      verified_by: status === "PAID" ? session?.user_id || null : null,
      // Clear deadline when PAID or COMPLIMENTARY
      payment_deadline: status === "UNPAID" ? a.payment_deadline : null,
    };

    await updateAttendee(a.attendee_id, patch);
    Object.assign(a, patch);
    showToast("บันทึกการชำระแล้ว 💰", "success");
    window.closePaymentModal();
    updateStats();
    filterTable();
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

// ============================================================
// ── QR MODAL ──────────────────────────────────────────────
// ============================================================
window.openQrModal = function (attendeeId) {
  const a = allAttendees.find((x) => x.attendee_id === attendeeId);
  if (!a) return;
  _qrModalAtt = a;

  document.getElementById("qrInfo").innerHTML = `
    <div class="qr-name">${escapeHtml(a.name)}</div>
    ${a.member_code ? `<div class="qr-member">${escapeHtml(a.member_code)}</div>` : ""}
    ${currentEvent?.event_name ? `<div class="qr-event">${escapeHtml(currentEvent.event_name)}</div>` : ""}`;
  document.getElementById("qrTicketNo").textContent = a.ticket_no || `ID-${a.attendee_id}`;

  // QR payload = ticket_no (หรือ fallback attendee_id) — scanner ใช้เทียบกับ DB
  const wrap = document.getElementById("qrCodeWrap");
  wrap.innerHTML = "";
  try {
    new QRCode(wrap, {
      text: a.ticket_no || `A4S-ATT-${a.attendee_id}`,
      width: 200,
      height: 200,
      correctLevel: QRCode.CorrectLevel.M,
    });
  } catch (e) {
    wrap.textContent = "QR library ยังไม่โหลด — รีเฟรชหน้าอีกครั้ง";
  }

  document.getElementById("qrModal").classList.add("open");
};

window.closeQrModal = function () {
  document.getElementById("qrModal").classList.remove("open");
  _qrModalAtt = null;
};

window.printQr = function () {
  window.print();
};

// ============================================================
// ── BULK MESSAGE MODAL ────────────────────────────────────
// ============================================================
window.openCheckinPage = function () {
  if (!currentEventId) return;
  window.open(`check-in.html?event_id=${currentEventId}`, "_blank");
};

// ── SHARE REGISTER LINK (LIFF + plain URL) ─────────────────
function _buildPlainRegisterUrl() {
  if (!currentEventId) return "";
  // Prefer channel's LIFF endpoint if set (เผื่อ deploy บน domain อื่น), fallback to current origin
  const base = `${location.origin}${location.pathname.replace(/attendees\.html.*$/, "register.html")}`;
  return `${base}?event=${currentEventId}`;
}

function _buildLiffUrl(liffId) {
  if (!liffId || !currentEventId) return "";
  return `https://liff.line.me/${liffId}?event=${currentEventId}`;
}

window.openShareRegisterModal = async function () {
  if (!currentEventId || !currentEvent) {
    showToast("เลือก event ก่อน", "error");
    return;
  }

  // Resolve channel (per-event or default) to get liff_id + endpoint
  let channel = null;
  try {
    if (window.LineAPI) {
      channel = await window.LineAPI.getChannelForEvent(currentEvent);
    }
  } catch (e) {
    console.warn("get channel:", e.message);
  }

  const liffId = channel?.liff_id || null;
  const liffUrl = _buildLiffUrl(liffId);
  const plainUrl = channel?.liff_endpoint
    ? `${channel.liff_endpoint.replace(/\/+$/, "").replace(/\?.*$/, "")}?event=${currentEventId}`
    : _buildPlainRegisterUrl();

  // Fill modal
  document.getElementById("shareRegEventName").textContent = currentEvent.event_name || "Event";
  document.getElementById("shareRegEventSub").textContent =
    `[${currentEvent.event_code || ""}] ${currentEvent.location || ""}`;
  document.getElementById("shareRegLiffInput").value = liffUrl || "— ไม่มี LIFF (ตั้งค่าใน channel ก่อน)";
  document.getElementById("shareRegPlainInput").value = plainUrl;

  // Build QR — prefer LIFF URL, fallback to plain
  const qrWrap = document.getElementById("shareRegQrWrap");
  qrWrap.innerHTML = "";
  try {
    const qrText = liffUrl || plainUrl;
    new QRCode(qrWrap, {
      text: qrText,
      width: 220,
      height: 220,
      correctLevel: QRCode.CorrectLevel.M,
    });
  } catch (e) {
    qrWrap.textContent = "QR library ยังไม่โหลด — refresh หน้า";
  }

  // Disable copy button if no LIFF
  const liffBtn = document.querySelector('#shareRegLiffInput + button');
  if (liffBtn) liffBtn.disabled = !liffUrl;

  document.getElementById("shareRegisterModal").classList.add("open");
};

window.closeShareRegisterModal = function () {
  document.getElementById("shareRegisterModal").classList.remove("open");
};

window.copyShareRegisterUrl = async function (type) {
  const id = type === "liff" ? "shareRegLiffInput" : "shareRegPlainInput";
  const input = document.getElementById(id);
  const url = input.value;
  if (!url || url.startsWith("—")) { showToast("ไม่มี URL ให้ copy", "error"); return; }
  try {
    await navigator.clipboard.writeText(url);
    showToast(`✅ คัดลอก ${type === "liff" ? "LIFF" : "Plain"} URL แล้ว`, "success");
  } catch {
    input.select();
    document.execCommand("copy");
    showToast(`✅ คัดลอกแล้ว`, "success");
  }
};

// ── AUTO CHECK-IN TOGGLE ──────────────────────────────────
function _loadAutoCheckinState() {
  const key = `autoCheckin_${currentEventId}`;
  _autoCheckin = localStorage.getItem(key) === "1";
  const input = document.getElementById("autoCheckinInput");
  if (input) input.checked = _autoCheckin;
  _syncAutoCheckinUi();
}

function _syncAutoCheckinUi() {
  const toggle = document.getElementById("autoCheckinToggle");
  const label = document.getElementById("autoCheckinLabel");
  if (!toggle || !label) return;
  if (_autoCheckin) {
    toggle.style.background = "rgba(16,185,129,.95)";
    toggle.style.border = "1.5px solid #10b981";
    toggle.style.boxShadow = "0 0 0 3px rgba(16,185,129,.25)";
    label.textContent = "⚡ โหมดหน้างาน: ON";
  } else {
    toggle.style.background = "rgba(255,255,255,.12)";
    toggle.style.border = "1.5px solid rgba(255,255,255,.25)";
    toggle.style.boxShadow = "none";
    label.textContent = "⚡ โหมดหน้างาน";
  }
}

window.onAutoCheckinToggle = function (checked) {
  _autoCheckin = !!checked;
  const key = `autoCheckin_${currentEventId}`;
  localStorage.setItem(key, _autoCheckin ? "1" : "0");
  _syncAutoCheckinUi();
  showToast(
    _autoCheckin ? "โหมดหน้างาน: ON — save แล้ว check-in ทันที" : "โหมดหน้างาน: OFF",
    _autoCheckin ? "success" : "info",
  );
};

window.openBulkMsgModal = function () {
  _refreshBulkMsgTags();
  // Load last template from localStorage (per event)
  const key = `bulkMsgTpl_${currentEventId}`;
  const saved = localStorage.getItem(key) || "";
  document.getElementById("bulkMsgTpl").value = saved;
  document.getElementById("bulkMsgTagFilter").value = "__ALL__";
  window.onBulkMsgFilterChange();
  document.getElementById("bulkMsgModal").classList.add("open");
};

window.closeBulkMsgModal = function () {
  document.getElementById("bulkMsgModal").classList.remove("open");
};

function _refreshBulkMsgTags() {
  const sel = document.getElementById("bulkMsgTagFilter");
  if (!sel) return;
  // Keep 3 system options, append tag options
  const systemOpts = `
    <option value="__ALL__">👥 ทุกคน</option>
    <option value="__UNPAID__">⏳ ยังไม่ชำระ</option>
    <option value="__EXPIRED__">⌛ เกิน grace period</option>`;
  const allTags = new Set();
  allAttendees.forEach((a) => (a.tags || []).forEach((t) => allTags.add(t)));
  const tagOpts = [...allTags]
    .sort()
    .map((t) => `<option value="tag:${escapeHtml(t)}">🏷️ ${escapeHtml(t)}</option>`)
    .join("");
  sel.innerHTML = systemOpts + tagOpts;
}

function _bulkMsgTargets() {
  const val = document.getElementById("bulkMsgTagFilter").value;
  if (val === "__ALL__") return allAttendees;
  if (val === "__UNPAID__")
    return allAttendees.filter((a) => a.payment_status === "UNPAID");
  if (val === "__EXPIRED__") return allAttendees.filter(isAttendeeExpired);
  if (val.startsWith("tag:")) {
    const tag = val.slice(4);
    return allAttendees.filter((a) => (a.tags || []).includes(tag));
  }
  return [];
}

function _fillBulkTemplate(tpl, a) {
  const tierName =
    a.tier_id && currentTiersById[a.tier_id]
      ? currentTiersById[a.tier_id].tier_name
      : "";
  return String(tpl || "")
    .replace(/\{ชื่อ\}/g, a.name || "")
    .replace(/\{รหัส\}/g, a.member_code || "")
    .replace(/\{ตำแหน่ง\}/g, a.position_level || "")
    .replace(/\{ราคา\}/g, formatNum(a.paid_amount || 0))
    .replace(/\{tier\}/g, tierName)
    .replace(/\{deadline\}/g, a.payment_deadline ? formatDMYShort(a.payment_deadline) : "—")
    .replace(/\{ticket\}/g, a.ticket_no || "");
}

window.onBulkMsgFilterChange = function () {
  const targets = _bulkMsgTargets();
  document.getElementById("bulkMsgCount").textContent =
    `จะส่งถึง ${targets.length} คน`;
  const linkedCount = targets.filter(a => a.line_user_id).length;
  const el = document.getElementById("bulkLineLinked");
  if (el) el.textContent = `${linkedCount} / ${targets.length}`;
  const pushBtn = document.getElementById("btnBulkLinePush");
  if (pushBtn) pushBtn.disabled = linkedCount === 0;
  const flexBtn = document.getElementById("btnBulkTicketFlex");
  if (flexBtn) flexBtn.disabled = linkedCount === 0;
  window.onBulkMsgTplChange();
};

window.onBulkMsgTplChange = function () {
  const tpl = document.getElementById("bulkMsgTpl").value;
  // Persist per event
  if (currentEventId) {
    localStorage.setItem(`bulkMsgTpl_${currentEventId}`, tpl);
  }
  const targets = _bulkMsgTargets();
  const sample = targets[0];
  const preview = document.getElementById("bulkMsgPreview");
  if (!tpl.trim()) {
    preview.textContent = "— พิมพ์ข้อความด้านบนเพื่อดูตัวอย่าง —";
    return;
  }
  if (!sample) {
    preview.textContent = "(ไม่มีคนตรงกับ filter นี้)";
    return;
  }
  preview.textContent = _fillBulkTemplate(tpl, sample);
};

window.copyBulkMessages = async function () {
  const tpl = document.getElementById("bulkMsgTpl").value.trim();
  if (!tpl) {
    showToast("กรุณาพิมพ์ข้อความ", "error");
    return;
  }
  const targets = _bulkMsgTargets();
  if (!targets.length) {
    showToast("ไม่มีคนตรงกับ filter", "error");
    return;
  }
  const messages = targets
    .map((a) => {
      const phone = a.phone ? ` (📱 ${a.phone})` : "";
      return `─── ${a.name}${phone} ───\n${_fillBulkTemplate(tpl, a)}`;
    })
    .join("\n\n");
  try {
    await navigator.clipboard.writeText(messages);
    showToast(`Copy แล้ว ${targets.length} ข้อความ 📋`, "success");
  } catch (e) {
    // Fallback
    const ta = document.createElement("textarea");
    ta.value = messages;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    showToast(`Copy แล้ว ${targets.length} ข้อความ 📋`, "success");
  }
};

// ── Build Flex ticket message ────────────────────────────────
function _qrImageUrl(text) {
  // Use qrserver.com as a free QR-image service (no auth, HTTPS, served directly)
  return `https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=20&data=${encodeURIComponent(text)}`;
}

function _fmtDateTH(d) {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return d;
  }
}

function buildTicketFlex(event, attendee) {
  const poster = (event?.image_urls?.[0]) || event?.poster_url || "";
  const ticketNo = attendee.ticket_no || `A4S-${event?.event_id || ""}-${attendee.attendee_id}`;
  const qrUrl = _qrImageUrl(ticketNo);
  const eventName = event?.event_name || "Event";
  const dateText = _fmtDateTH(event?.event_date);
  const timeText = (event?.start_time && event?.end_time)
    ? `${event.start_time.slice(0, 5)} — ${event.end_time.slice(0, 5)} น.`
    : "";
  const loc = event?.location || "";
  const memberCode = attendee.member_code ? `[${attendee.member_code}] ` : "";

  const bubble = {
    type: "bubble",
    size: "kilo",
    ...(poster ? {
      hero: {
        type: "image",
        url: poster,
        size: "full",
        aspectRatio: "20:13",
        aspectMode: "cover",
      },
    } : {}),
    body: {
      type: "box",
      layout: "vertical",
      spacing: "md",
      contents: [
        { type: "text", text: "🎫 บัตรเข้างาน", size: "xs", color: "#6B7280", weight: "bold" },
        { type: "text", text: eventName, weight: "bold", size: "xl", wrap: true, color: "#0f172a" },
        { type: "separator", margin: "sm" },
        {
          type: "box", layout: "vertical", spacing: "sm", margin: "md",
          contents: [
            {
              type: "box", layout: "baseline", spacing: "sm",
              contents: [
                { type: "text", text: "👤", size: "sm", flex: 1 },
                { type: "text", text: `${memberCode}${attendee.name || ""}`, size: "sm", flex: 10, weight: "bold", wrap: true, color: "#0f172a" },
              ],
            },
            ...(dateText ? [{
              type: "box", layout: "baseline", spacing: "sm",
              contents: [
                { type: "text", text: "📅", size: "sm", flex: 1 },
                { type: "text", text: dateText + (timeText ? `  ·  ${timeText}` : ""), size: "sm", flex: 10, color: "#334155" },
              ],
            }] : []),
            ...(loc ? [{
              type: "box", layout: "baseline", spacing: "sm",
              contents: [
                { type: "text", text: "📍", size: "sm", flex: 1 },
                { type: "text", text: loc, size: "sm", flex: 10, color: "#334155", wrap: true },
              ],
            }] : []),
          ],
        },
        {
          type: "box", layout: "vertical", margin: "lg",
          backgroundColor: "#f8fafc", cornerRadius: "md", paddingAll: "md",
          contents: [
            {
              type: "image",
              url: qrUrl,
              aspectMode: "fit",
              size: "full",
            },
            { type: "text", text: ticketNo, align: "center", weight: "bold", size: "lg", color: "#1e40af", margin: "md" },
          ],
        },
      ],
    },
    footer: {
      type: "box", layout: "vertical",
      contents: [
        { type: "text", text: "📱 สแกน QR นี้เมื่อถึงงาน", size: "xs", color: "#6B7280", align: "center" },
      ],
    },
  };

  return {
    type: "flex",
    altText: `🎫 Ticket: ${ticketNo} — ${eventName}`,
    contents: bubble,
  };
}

// ── Send Ticket Flex to each attendee (personalized) ──────────
window.sendBulkTicketFlex = async function () {
  if (!window.LineAPI) { showToast("LINE module ยังไม่โหลด — refresh หน้า", "error"); return; }
  if (!window.ERPCrypto?.hasMasterKey()) { showToast("ตั้ง Master Key ในหน้า settings ก่อน", "error"); return; }

  const targets = _bulkMsgTargets().filter(a => a.line_user_id);
  if (!targets.length) { showToast("ไม่มีคนที่เชื่อม LINE", "error"); return; }

  const ok = await (window.ConfirmModal
    ? window.ConfirmModal.open({
        icon: "🎫",
        title: "ส่ง Ticket (Flex) ผ่าน LINE OA",
        message: `จะส่งบัตร + QR ให้ ${targets.length} คน — ยืนยัน?`,
        okText: "ส่งบัตร",
        cancelText: "ยกเลิก",
        tone: "primary",
      })
    : Promise.resolve(confirm(`ส่ง Ticket Flex ให้ ${targets.length} คน?`)));
  if (!ok) return;

  const btn = document.getElementById("btnBulkTicketFlex");
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = `⏳ 0/${targets.length}`;

  try {
    const channel = await window.LineAPI.getChannelForEvent(currentEvent);
    if (!channel) throw new Error("ไม่พบ LINE channel");

    const sendTargets = targets.map(a => ({
      userId: a.line_user_id,
      message: buildTicketFlex(currentEvent, a),
    }));

    const result = await window.LineAPI.sendPersonalized({
      channel,
      targets: sendTargets,
      onProgress: ({ done, total }) => { btn.textContent = `⏳ ${done}/${total}`; },
    });

    if (result.fail === 0) {
      showToast(`✅ ส่งบัตรสำเร็จ ${result.ok}/${targets.length} คน`, "success");
    } else {
      showToast(`⚠️ สำเร็จ ${result.ok} · ล้มเหลว ${result.fail} — ดู console`, "error");
      console.warn("LINE flex errors:", result.errors);
    }
  } catch (e) {
    showToast("ส่งไม่ได้: " + e.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
};

// ── Broadcast to all friends of the OA ───────────────────────
window.sendBulkLineBroadcast = async function () {
  const tpl = document.getElementById("bulkMsgTpl").value.trim();
  if (!tpl) { showToast("กรุณาพิมพ์ข้อความ", "error"); return; }
  if (!window.LineAPI) { showToast("LINE module ยังไม่โหลด", "error"); return; }
  if (!window.ERPCrypto?.hasMasterKey()) { showToast("ตั้ง Master Key ก่อน", "error"); return; }

  const ok = await (window.ConfirmModal
    ? window.ConfirmModal.open({
        icon: "📢",
        title: "Broadcast ให้ทุกเพื่อน OA",
        message: `ส่งข้อความให้ทุก friends ของ OA — ไม่สามารถเจาะจงคนได้\n\n⚠️ ข้อความไม่สามารถ personalize ได้ (placeholder เช่น {ชื่อ} จะไม่ถูกแทน)`,
        okText: "Broadcast",
        cancelText: "ยกเลิก",
        tone: "warning",
      })
    : Promise.resolve(confirm(`Broadcast ให้ทุก friends ของ OA?`)));
  if (!ok) return;

  const btn = document.getElementById("btnBulkLineBroadcast");
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = `⏳ กำลังส่ง...`;

  try {
    const channel = await window.LineAPI.getChannelForEvent(currentEvent);
    if (!channel) throw new Error("ไม่พบ LINE channel");
    // Broadcast doesn't support personalization — send template as-is with placeholders intact
    await window.LineAPI.broadcast({ channel, message: tpl });
    showToast(`✅ Broadcast สำเร็จ`, "success");
  } catch (e) {
    showToast("Broadcast ไม่ได้: " + e.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
};

// ── Send via LINE OA (per-user push) ─────────────────────────
window.sendBulkLinePush = async function () {
  const tpl = document.getElementById("bulkMsgTpl").value.trim();
  if (!tpl) { showToast("กรุณาพิมพ์ข้อความ", "error"); return; }
  if (!window.LineAPI) { showToast("LINE module ยังไม่โหลด — refresh หน้า", "error"); return; }
  if (!window.ERPCrypto?.hasMasterKey()) { showToast("ตั้ง Master Key ในหน้า settings ก่อน", "error"); return; }

  const targets = _bulkMsgTargets().filter(a => a.line_user_id);
  if (!targets.length) { showToast("ไม่มีคนที่เชื่อม LINE", "error"); return; }

  const btn = document.getElementById("btnBulkLinePush");
  const ok = await (window.ConfirmModal
    ? window.ConfirmModal.open({
        icon: "📱",
        title: "ส่งข้อความผ่าน LINE OA",
        message: `จะส่งให้ ${targets.length} คนที่เชื่อม LINE แล้ว — ยืนยัน?`,
        okText: "ส่งเลย",
        cancelText: "ยกเลิก",
        tone: "success",
      })
    : Promise.resolve(confirm(`ส่งข้อความผ่าน LINE OA ให้ ${targets.length} คน?`)));
  if (!ok) return;

  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = `⏳ 0/${targets.length}`;

  try {
    // Resolve channel for this event
    const channel = await window.LineAPI.getChannelForEvent(currentEvent);
    if (!channel) throw new Error("ไม่พบ LINE channel — ตั้งค่าในหน้า settings");

    const sendTargets = targets.map(a => ({
      userId: a.line_user_id,
      message: _fillBulkTemplate(tpl, a),
    }));

    const result = await window.LineAPI.sendPersonalized({
      channel,
      targets: sendTargets,
      onProgress: ({ done, total, ok, fail }) => {
        btn.textContent = `⏳ ${done}/${total}`;
      },
    });

    if (result.fail === 0) {
      showToast(`✅ ส่งสำเร็จ ${result.ok}/${targets.length} คน`, "success");
    } else {
      showToast(`⚠️ สำเร็จ ${result.ok} · ล้มเหลว ${result.fail} คน — ดู console`, "error");
      console.warn("LINE push errors:", result.errors);
    }
  } catch (e) {
    showToast("ส่งไม่ได้: " + e.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
};

// ═══════════════════════════════════════════════════════════
// AUTO-REFRESH — poll Supabase ทุก 20 วิ + เมื่อ tab โฟกัสกลับมา
// ข้ามการ refresh ถ้าผู้ใช้กำลังแก้ไข/เปิด modal/save ค้าง
// ═══════════════════════════════════════════════════════════
const AUTO_REFRESH_MS = 20000;
let _autoRefreshTimer = null;
let _refreshInFlight = false;

function startAutoRefresh() {
  if (_autoRefreshTimer) return;
  _autoRefreshTimer = setInterval(refreshAttendeesSilent, AUTO_REFRESH_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshAttendeesSilent();
  });
  window.addEventListener("focus", refreshAttendeesSilent);
}

function _isUserBusy() {
  // 1) Any modal/overlay open → skip
  if (document.querySelector('[class*="-overlay"].open, [class*="-overlay"].show')) return true;
  // 2) User typing in a new-row (ยังไม่กด save)
  if (newRows.some((r) => r.name || r.phone || r.memberCode || r.saving)) return true;
  // 3) Focused input inside the saved-rows table (filter/edit)
  const act = document.activeElement;
  if (act && act.tagName === "INPUT" && act.closest("tbody")) return true;
  return false;
}

function _snapshotAttendees(arr) {
  return (arr || [])
    .map((a) =>
      [
        a.attendee_id,
        a.name || "",
        a.ticket_no || "",
        a.member_code || "",
        a.phone || "",
        a.payment_status || "",
        a.paid_amount || 0,
        a.position_level || "",
        a.checked_in ? 1 : 0,
        a.check_in_at || "",
        (a.tags || []).join("|"),
      ].join("¦"),
    )
    .join("‖");
}

async function refreshAttendeesSilent() {
  if (!currentEventId) return;
  if (_refreshInFlight) return;
  if (document.visibilityState === "hidden") return;
  if (_isUserBusy()) return;

  _refreshInFlight = true;
  try {
    const fresh = await fetchAttendees(currentEventId);
    if (!fresh) return;
    if (_snapshotAttendees(fresh) === _snapshotAttendees(allAttendees)) return;
    // Re-check busy before clobbering (user may have started editing mid-fetch)
    if (_isUserBusy()) return;

    const prevCheckedCount = allAttendees.filter((a) => a.checked_in).length;
    allAttendees = fresh;
    populateTagFilter();
    updateStats();
    filterTable();

    const newCheckedCount = fresh.filter((a) => a.checked_in).length;
    if (newCheckedCount > prevCheckedCount) {
      showToast(`🔄 มีคน check-in เพิ่ม (+${newCheckedCount - prevCheckedCount})`, "success");
    }
  } catch (e) {
    console.warn("auto-refresh failed:", e.message || e);
  } finally {
    _refreshInFlight = false;
  }
}

// ── START ─────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => initPage().then(startAutoRefresh));
} else {
  initPage().then(startAutoRefresh);
}
