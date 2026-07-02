/* ============================================================
   trip-team.js — Controller for ทีมงาน Trip (Staff/Guide/Outsource)
   ============================================================ */

const state = {
  tripId: null,
  trip: null,
  team: [],             // trip_guides rows for this trip
  memberTypes: [],      // member_types master (global)
  selected: new Set(),  // selected guide_id for bulk delete
  editId: null,
  editingTypeKey: null, // type_key ที่กำลังแก้ไขใน manager
  sortKey: "sort_order",
  sortAsc: true,
};

// Fallback ถ้า DB load ไม่ได้
const DEFAULT_MEMBER_TYPES = [
  { type_key: "staff",     label: "Staff",     emoji: "👔",     color_bg: "#dbeafe", color_fg: "#1d4ed8", sort_order: 1, is_system: true },
  { type_key: "guide",     label: "ไกด์",      emoji: "🧑‍🏫",   color_bg: "#fef3c7", color_fg: "#92400e", sort_order: 2, is_system: true },
  { type_key: "outsource", label: "Outsource", emoji: "🤝",     color_bg: "#f3e8ff", color_fg: "#6b21a8", sort_order: 3, is_system: true },
];

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
      <tr class="r-card-plain"><td colspan="8">
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
    const [trips, team, types] = await Promise.all([
      sbFetch("trips", `?select=*&trip_id=eq.${state.tripId}`),
      sbFetch(
        "trip_guides",
        `?trip_id=eq.${state.tripId}&select=*&order=sort_order.asc.nullslast,guide_id.asc`
      ),
      sbFetch("member_types", "?select=*&order=sort_order.asc,type_key.asc").catch(() => null),
    ]);
    state.trip = (trips || [])[0] || null;
    state.team = team || [];
    state.memberTypes = (Array.isArray(types) && types.length) ? types : DEFAULT_MEMBER_TYPES;
    renderTripBanner();
    populateTypeDropdown();
    populateTypeFilter();
    updateStatCards();
    filterTable();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

// ── MEMBER TYPES HELPERS ───────────────────────────────────
function getMt(key) {
  return state.memberTypes.find((t) => t.type_key === key)
      || state.memberTypes.find((t) => t.type_key === "guide")
      || state.memberTypes[0];
}

function populateTypeDropdown() {
  const sel = document.getElementById("fType");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = state.memberTypes
    .map((t) => `<option value="${escapeAttr(t.type_key)}">${escapeHtml(t.emoji || "")} ${escapeHtml(t.label)}</option>`)
    .join("");
  // restore selection ถ้ายังมีอยู่
  if (current && state.memberTypes.some((t) => t.type_key === current)) {
    sel.value = current;
  } else if (state.memberTypes.some((t) => t.type_key === "guide")) {
    sel.value = "guide";
  }
}

function populateTypeFilter() {
  const sel = document.getElementById("filterType");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML =
    `<option value="">🧿 ทุกประเภท</option>` +
    state.memberTypes
      .map((t) => `<option value="${escapeAttr(t.type_key)}">${escapeHtml(t.emoji || "")} ${escapeHtml(t.label)}</option>`)
      .join("");
  if (current && state.memberTypes.some((t) => t.type_key === current)) sel.value = current;
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
  const mt = getMt(t);
  if (!mt) return `<span class="tt-type-pill">${escapeHtml(t || "?")}</span>`;
  return `<span class="tt-type-pill" style="background:${escapeAttr(mt.color_bg)};color:${escapeAttr(mt.color_fg)};border:1px solid ${escapeAttr(mt.color_fg)}33">
    ${escapeHtml(mt.emoji || "")} ${escapeHtml(mt.label)}
  </span>`;
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
  const tbody = document.getElementById("tableBody");
  document.getElementById("tableCount").textContent = `${rows.length} รายการ`;

  if (!rows.length) {
    tbody.innerHTML = `
      <tr class="r-card-plain"><td colspan="8">
        <div class="empty-state">
          <div class="empty-icon">🧑‍🤝‍🧑</div>
          <div class="empty-text">ยังไม่มีทีมงาน — กด "＋ เพิ่มสมาชิก" เพื่อเริ่ม</div>
        </div>
      </td></tr>`;
    return;
  }

  const sorted = [...rows].sort((a, b) => {
    let av = a[state.sortKey] ?? "";
    let bv = b[state.sortKey] ?? "";
    if (typeof av === "string") av = av.toLowerCase();
    if (typeof bv === "string") bv = bv.toLowerCase();
    if (av === bv) return 0;
    return state.sortAsc ? (av > bv ? 1 : -1) : av < bv ? 1 : -1;
  });

  tbody.innerHTML = sorted.map((m, i) => memberRowHtml(m, i + 1)).join("");

  if (window.AuthZ && typeof AuthZ.applyDomPerms === "function") {
    AuthZ.applyDomPerms(tbody);
  }
  refreshBulkBar();
}

function memberRowHtml(m, idx) {
  const selected = state.selected.has(m.guide_id);
  const compNote = [];
  if (m.company) compNote.push(`<div style="font-weight:600">${escapeHtml(m.company)}</div>`);
  if (m.note)    compNote.push(`<div style="color:var(--text3);font-size:11.5px">${escapeHtml(m.note)}</div>`);

  return `<tr>
    <td class="r-card-corner" style="text-align:center">
      <input type="checkbox" class="row-chk" data-id="${m.guide_id}"
        ${selected ? "checked" : ""}
        onclick="window.toggleRowSelect(${m.guide_id}, this.checked)" />
    </td>
    <td data-label="#" style="text-align:center;color:var(--text3);font-size:12px">${idx}</td>
    <td class="r-card-title">
      <div class="tt-name-cell">${escapeHtml(m.full_name || "—")}</div>
      ${m.role_title ? `<div class="tt-name-sub">${escapeHtml(m.role_title)}</div>` : ""}
    </td>
    <td class="col-center" data-label="ประเภท">${typeLabel(m.member_type)}</td>
    <td data-label="ภาษา">${m.languages ? `<span class="tt-langs">${escapeHtml(m.languages)}</span>` : `<span style="color:var(--text3)">—</span>`}</td>
    <td data-label="ติดต่อ">${contactCell(m)}</td>
    <td data-label="บริษัท / หมายเหตุ">${compNote.length ? compNote.join("") : `<span style="color:var(--text3)">—</span>`}</td>
    <td class="col-center" data-label="จัดการ" onclick="event.stopPropagation()">
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
  // ensure type dropdown options reflect latest types
  populateTypeDropdown();
  const initialType = m?.member_type || "guide";
  const typeSel = document.getElementById("fType");
  if (state.memberTypes.some((t) => t.type_key === initialType)) {
    typeSel.value = initialType;
  }
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

// ── MEMBER TYPES MANAGER (nested modal) ────────────────────
window.openMtManager = function () {
  renderMtManagerList();
  document.getElementById("mtMgrOverlay").classList.add("open");
};

window.closeMtManager = function (e) {
  if (e && e.target.id !== "mtMgrOverlay") return;
  document.getElementById("mtMgrOverlay").classList.remove("open");
};

function renderMtManagerList() {
  const list = document.getElementById("mtMgrList");
  if (!list) return;
  if (!state.memberTypes.length) {
    list.innerHTML = `<div style="padding:14px;text-align:center;color:var(--text3);font-size:13px">
      ยังไม่มีประเภท — กด "＋ เพิ่ม" เพื่อเริ่ม
    </div>`;
    return;
  }
  list.innerHTML = state.memberTypes
    .map((t) => {
      const usage = state.team.filter((m) => m.member_type === t.type_key).length;
      const sysBadge = t.is_system
        ? `<span style="font-size:10px;background:#f1f5f9;color:var(--text2);padding:1px 6px;border-radius:99px;border:1px solid var(--border)">SYSTEM</span>`
        : "";
      const deleteBtn = t.is_system
        ? `<button class="btn-icon" title="ประเภท System ลบไม่ได้" disabled
            style="font-size:14px;opacity:.35;cursor:not-allowed">🗑</button>`
        : `<button class="btn-icon danger" data-perm="member_types_delete" title="ลบประเภท"
            onclick="window.deleteMtDirect('${escapeJs(t.type_key)}')"
            style="font-size:14px">🗑</button>`;
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;background:#fff">
        <span style="font-size:22px;width:30px;text-align:center;flex-shrink:0">${escapeHtml(t.emoji || "🧑")}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;color:var(--text);font-size:14px">${escapeHtml(t.label)} ${sysBadge}</div>
          <div style="font-size:11px;color:var(--text3);font-family:monospace">${escapeHtml(t.type_key)}</div>
        </div>
        <span class="tt-type-pill" style="background:${escapeAttr(t.color_bg)};color:${escapeAttr(t.color_fg)};border:1px solid ${escapeAttr(t.color_fg)}33;font-size:11px">
          ${escapeHtml(t.emoji || "")} ${escapeHtml(t.label)}
        </span>
        <span style="font-size:11px;color:var(--text2);min-width:48px;text-align:right">${usage} คน</span>
        <div style="display:flex;gap:2px;flex-shrink:0">
          <button class="btn-icon" data-perm="member_types_edit" title="แก้ไข"
            onclick="window.openMtForm('${escapeJs(t.type_key)}')"
            style="font-size:14px">✏️</button>
          ${deleteBtn}
        </div>
      </div>`;
    })
    .join("");
  if (window.AuthZ?.applyDomPerms) AuthZ.applyDomPerms(list);
}

// ลบประเภทตรงจาก list (ไม่ต้องเปิดฟอร์ม edit ก่อน)
window.deleteMtDirect = async function (typeKey) {
  state.editingTypeKey = typeKey;
  await window.deleteMt();
};

window.openMtForm = function (typeKey) {
  state.editingTypeKey = typeKey || null;
  const t = typeKey ? state.memberTypes.find((x) => x.type_key === typeKey) : null;
  document.getElementById("mtFormTitle").textContent = t ? `แก้ไขประเภท: ${t.label}` : "เพิ่มประเภทใหม่";
  document.getElementById("fMtEmoji").value = t?.emoji || "🧑";
  document.getElementById("fMtLabel").value = t?.label || "";
  document.getElementById("fMtBg").value    = (t?.color_bg && /^#[0-9a-f]{6}$/i.test(t.color_bg)) ? t.color_bg : "#fef3c7";
  document.getElementById("fMtFg").value    = (t?.color_fg && /^#[0-9a-f]{6}$/i.test(t.color_fg)) ? t.color_fg : "#92400e";

  // ปุ่มลบ: ซ่อนถ้าเป็น system หรือเป็นการสร้างใหม่
  const delBtn = document.getElementById("mtFormDeleteBtn");
  delBtn.style.display = (t && !t.is_system) ? "" : "none";

  document.getElementById("mtFormOverlay").classList.add("open");
  bindMtPreview();
  updateMtPreview();
  setTimeout(() => document.getElementById("fMtLabel")?.focus(), 50);
};

window.closeMtForm = function (e) {
  if (e && e.target.id !== "mtFormOverlay") return;
  document.getElementById("mtFormOverlay").classList.remove("open");
  state.editingTypeKey = null;
};

function bindMtPreview() {
  ["fMtEmoji", "fMtLabel", "fMtBg", "fMtFg"].forEach((id) => {
    const el = document.getElementById(id);
    if (el && !el._mtPreviewBound) {
      el.addEventListener("input", updateMtPreview);
      el._mtPreviewBound = true;
    }
  });
}

function updateMtPreview() {
  const emo = document.getElementById("fMtEmoji").value || "🧑";
  const lbl = document.getElementById("fMtLabel").value.trim() || "ตัวอย่าง";
  const bg  = document.getElementById("fMtBg").value || "#fef3c7";
  const fg  = document.getElementById("fMtFg").value || "#92400e";
  const pill = document.getElementById("mtPreviewPill");
  pill.style.background = bg;
  pill.style.color = fg;
  pill.style.border = `1px solid ${fg}33`;
  pill.textContent = `${emo} ${lbl}`;
}

function slugify(s) {
  return String(s || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9฀-๿]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

window.saveMt = async function () {
  const emoji = document.getElementById("fMtEmoji").value.trim() || "🧑";
  const label = document.getElementById("fMtLabel").value.trim();
  const bg    = document.getElementById("fMtBg").value || "#fef3c7";
  const fg    = document.getElementById("fMtFg").value || "#92400e";
  if (!label) { showToast("กรุณากรอกชื่อประเภท", "error"); return; }

  const payload = {
    label, emoji, color_bg: bg, color_fg: fg,
    updated_at: new Date().toISOString(),
  };

  showLoading(true);
  try {
    if (state.editingTypeKey) {
      await sbFetch("member_types", `?type_key=eq.${encodeURIComponent(state.editingTypeKey)}`, {
        method: "PATCH", body: payload,
      });
      showToast("แก้ไขประเภทแล้ว", "success");
    } else {
      // auto-gen key from label (slug)
      let key = slugify(label);
      if (!key) key = "type_" + Date.now();
      // ensure unique
      let suffix = 1;
      const exists = (k) => state.memberTypes.some((x) => x.type_key === k);
      let finalKey = key;
      while (exists(finalKey)) { finalKey = `${key}_${++suffix}`; }
      payload.type_key   = finalKey;
      payload.sort_order = state.memberTypes.length + 1;
      payload.is_system  = false;
      await sbFetch("member_types", "", { method: "POST", body: payload });
      showToast("เพิ่มประเภทแล้ว", "success");
    }
    document.getElementById("mtFormOverlay").classList.remove("open");
    state.editingTypeKey = null;
    await loadAll();
    renderMtManagerList();
  } catch (e) {
    showToast("บันทึกไม่ได้: " + e.message, "error");
  }
  showLoading(false);
};

window.deleteMt = async function () {
  const key = state.editingTypeKey;
  if (!key) return;
  const t = state.memberTypes.find((x) => x.type_key === key);
  if (!t) return;
  if (t.is_system) { showToast("ประเภท System ลบไม่ได้", "error"); return; }
  const usage = state.team.filter((m) => m.member_type === key).length;
  const msg = usage > 0
    ? `ลบประเภท "${t.label}" — มีสมาชิก ${usage} คนใช้อยู่ ระบบจะย้ายไป "ไกด์" — ดำเนินการต่อ?`
    : `ลบประเภท "${t.label}"?`;
  const ok = window.ConfirmModal?.open
    ? await window.ConfirmModal.open({
        title: "ลบประเภท", message: msg, icon: "🗑", tone: "danger", okText: "ลบ",
      })
    : confirm(msg);
  if (!ok) return;
  showLoading(true);
  try {
    if (usage > 0) {
      await sbFetch("trip_guides", `?member_type=eq.${encodeURIComponent(key)}`, {
        method: "PATCH", body: { member_type: "guide" },
      });
    }
    await sbFetch("member_types", `?type_key=eq.${encodeURIComponent(key)}`, { method: "DELETE" });
    showToast("ลบประเภทแล้ว", "success");
    document.getElementById("mtFormOverlay").classList.remove("open");
    state.editingTypeKey = null;
    await loadAll();
    renderMtManagerList();
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
function escapeJs(s) {
  return String(s ?? "").replace(/[\\'"]/g, (c) => "\\" + c);
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
