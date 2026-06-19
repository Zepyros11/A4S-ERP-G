/* ============================================================
   operations-hub.js — Controller for Operations Hub
   ------------------------------------------------------------
   ทุกอย่างใน hub = row ใน `programs`:
     • native  : source_type = NULL (สร้างใหม่จาก hub)
     • wrapper : source_type = 'trip'|'event' (ครอบ legacy เดิม
                 — เลือกเครื่องมือ/workspace ได้ + ลิงก์ไปเครื่องมือเดิม)
   "นำเข้าระบบเดิม" = INSERT program wrapper · ของเดิมไม่ถูกแตะ
   ============================================================ */

const state = {
  programs: [],
  items: [], // normalized
  editId: null,
  formType: "TRIP",
  sortKey: "start",
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
    const programs = await sbFetch("programs", "?select=*").catch(() => []);
    // ซ่อน Sandbox ทดสอบ (จาก operations-tools simulator) ออกจาก Hub จริง
    state.programs = (programs || []).filter((p) => !String(p.name || "").startsWith("🧪 Sandbox"));
    normalize();
    updateStatCards();
    filterTable();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

function bindEvents() {
  document.getElementById("searchInput")?.addEventListener("input", filterTable);
  document.getElementById("filterView")?.addEventListener("change", filterTable);
  document.getElementById("filterStatus")?.addEventListener("change", filterTable);
}

// ── NORMALIZE (programs → list) ────────────────────────────
function normalize() {
  state.items = state.programs.map((p) => ({
    id: p.program_id,
    type: p.program_type || "TRIP",
    name: p.name,
    code: p.code || "",
    start: p.start_date || null,
    end: p.end_date || null,
    status: p.status || "ACTIVE",
    wrapped: !!p.source_type, // true = ครอบ legacy เดิม
    sourceType: p.source_type || null,
    sourceId: p.source_id || null,
    openUrl: `./program-workspace.html?program_id=${p.program_id}`,
  }));
}

// ── STATS ──────────────────────────────────────────────────
function updateStatCards() {
  const it = state.items;
  document.getElementById("cardTotal").textContent = it.length;
  document.getElementById("cardTrips").textContent = it.filter((x) => x.type === "TRIP").length;
  document.getElementById("cardEvents").textContent = it.filter((x) => x.type === "EVENT").length;
  document.getElementById("cardActive").textContent = it.filter((x) => x.status === "ACTIVE").length;
}

// ── FILTER + SORT + RENDER ─────────────────────────────────
function filterTable() {
  const search = (document.getElementById("searchInput")?.value || "").toLowerCase();
  const view = document.getElementById("filterView")?.value || "";
  const status = document.getElementById("filterStatus")?.value || "";

  const filtered = state.items.filter((it) => {
    const matchSearch =
      !search ||
      (it.name || "").toLowerCase().includes(search) ||
      (it.code || "").toLowerCase().includes(search);
    const matchView =
      !view ||
      (view === "TRIP" && it.type === "TRIP") ||
      (view === "EVENT" && it.type === "EVENT");
    const matchStatus = !status || it.status === status;
    return matchSearch && matchView && matchStatus;
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
      <tr><td colspan="6">
        <div class="empty-state">
          <div class="empty-icon">🧭</div>
          <div class="empty-text">ยังไม่มีรายการ — กด "＋ สร้างใหม่" หรือ "📥 นำเข้าระบบเดิม"</div>
        </div>
      </td></tr>`;
    return;
  }

  const fmt = (window.DateFmt && window.DateFmt.formatDMY) || ((s) => s || "");

  tbody.innerHTML = sorted
    .map((it, i) => {
      const dateRange =
        it.start || it.end
          ? `<span>${fmt(it.start) || "—"}</span><span class="sep">→</span><span>${fmt(it.end) || "—"}</span>`
          : `<span style="color:var(--text3)">—</span>`;

      const delTitle = it.wrapped ? "นำออกจาก Operations (ไม่ลบของเดิม)" : "ลบ";

      const actions = `
        <button class="op-open-btn" onclick="window.openNew('${it.openUrl}')">เปิด</button>
        <button class="btn-icon" title="แก้ไข / เลือกเครื่องมือ" data-perm="program_edit" onclick="window.editProgram(${it.id})">✏️</button>
        <button class="btn-icon danger" title="${delTitle}" data-perm="program_delete" onclick="window.deleteProgram(${it.id})">🗑</button>`;

      return `<tr>
        <td style="text-align:center;color:var(--text3);font-size:12px">${i + 1}</td>
        <td>
          <div class="op-name-cell">${escapeHtml(it.name || "—")}</div>
          ${it.code ? `<div style="font-size:12px;color:var(--text3);font-family:'IBM Plex Mono',monospace">${escapeHtml(it.code)}</div>` : ""}
        </td>
        <td class="col-center">
          <span class="op-type op-type-${it.type}">${it.type === "TRIP" ? "✈️ Trip" : "🎪 Event"}</span>
        </td>
        <td class="col-center"><div class="op-date-range">${dateRange}</div></td>
        <td class="col-center"><span class="op-status op-status-${it.status || ""}">${statusLabel(it.status)}</span></td>
        <td class="col-center" onclick="event.stopPropagation()">
          <div class="action-group">${actions}</div>
        </td>
      </tr>`;
    })
    .join("");

  if (window.AuthZ && typeof AuthZ.applyDomPerms === "function") {
    AuthZ.applyDomPerms(tbody);
  }
}

function statusLabel(s) {
  return (
    {
      ACTIVE: "🟢 ดำเนินการ",
      ONGOING: "🟢 ดำเนินการ",
      CONFIRMED: "🔵 ยืนยัน",
      DONE: "✅ เสร็จสิ้น",
      CANCELLED: "❌ ยกเลิก",
      DRAFT: "📝 ร่าง",
    }[s] || (s || "—")
  );
}

window.openNew = function (url) {
  window.location.href = url;
};

// ── CREATE / EDIT MODAL ────────────────────────────────────
function renderToolsGrid(type, checkedKeys) {
  const grid = document.getElementById("toolsGrid");
  if (!grid || !window.ProgramTools) return;
  const tools = ProgramTools.availableFor(type);
  const checked = checkedKeys || ProgramTools.defaultsFor(type);
  grid.innerHTML = tools
    .map(
      (t) => `
      <label class="op-tool-chk">
        <input type="checkbox" value="${t.key}" ${checked.includes(t.key) ? "checked" : ""} />
        <span class="ic">${t.icon}</span><span>${escapeHtml(t.label)}</span>
      </label>`
    )
    .join("");
}

window.pickType = function (type) {
  state.formType = type;
  document.querySelectorAll("#typeToggle .op-tt").forEach((b) =>
    b.classList.toggle("active", b.dataset.type === type)
  );
  renderToolsGrid(type);
};

window.openProgramModal = function (programId) {
  state.editId = programId || null;
  const p = programId ? state.programs.find((x) => x.program_id === programId) : null;
  const type = p ? p.program_type || "TRIP" : "TRIP";
  state.formType = type;

  document.getElementById("progModalTitle").textContent = p ? "แก้ไข" : "สร้างใหม่";
  document.querySelectorAll("#typeToggle .op-tt").forEach((b) => {
    b.classList.toggle("active", b.dataset.type === type);
    b.disabled = !!p; // แก้ไข = ไม่เปลี่ยน type (โดยเฉพาะ wrapper ที่ผูกกับ legacy)
  });
  document.getElementById("fName").value = p?.name || "";
  document.getElementById("fStartDate").value = p?.start_date || "";
  document.getElementById("fEndDate").value = p?.end_date || "";
  document.getElementById("fStatus").value = p?.status || "ACTIVE";
  document.getElementById("fDescription").value = p?.description || "";
  renderToolsGrid(type, p ? p.enabled_tools || [] : null);

  document.getElementById("progOverlay").classList.add("open");
  setTimeout(() => document.getElementById("fName").focus(), 50);
};

window.editProgram = function (programId) {
  window.openProgramModal(programId);
};

window.closeProgramModal = function (e) {
  if (e && e.target.id !== "progOverlay") return;
  document.getElementById("progOverlay").classList.remove("open");
  state.editId = null;
};

window.saveProgram = async function () {
  const name = document.getElementById("fName").value.trim();
  if (!name) {
    showToast("กรุณากรอกชื่อ", "error");
    return;
  }
  const startDate = document.getElementById("fStartDate").value || null;
  const endDate = document.getElementById("fEndDate").value || null;
  if (startDate && endDate && endDate < startDate) {
    showToast("วันที่สิ้นสุดต้องไม่น้อยกว่าวันที่เริ่ม", "error");
    return;
  }
  const tools = [...document.querySelectorAll("#toolsGrid input:checked")].map((c) => c.value);

  // source_type/source_id ไม่อยู่ใน payload → PATCH ไม่แตะ (wrapper คงลิงก์เดิม)
  const payload = {
    program_type: state.formType,
    name,
    start_date: startDate,
    end_date: endDate,
    status: document.getElementById("fStatus").value || "ACTIVE",
    enabled_tools: tools,
    description: document.getElementById("fDescription").value.trim() || null,
    updated_at: new Date().toISOString(),
  };

  showLoading(true);
  try {
    if (state.editId) {
      await sbFetch("programs", `?program_id=eq.${state.editId}`, {
        method: "PATCH",
        body: payload,
      });
      showToast("แก้ไขแล้ว", "success");
    } else {
      await sbFetch("programs", "", { method: "POST", body: payload });
      showToast("สร้างแล้ว", "success");
    }
    document.getElementById("progOverlay").classList.remove("open");
    state.editId = null;
    await loadAll();
  } catch (e) {
    showToast("บันทึกไม่ได้: " + e.message, "error");
  }
  showLoading(false);
};

// ── DELETE / นำออก ─────────────────────────────────────────
window.deleteProgram = function (programId) {
  const p = state.programs.find((x) => x.program_id === programId);
  if (!p) return;
  const warn = p.source_type
    ? `นำ "${p.name}" ออกจาก Operations? (ลบเฉพาะ workspace+การตั้งค่าเครื่องมือ — ${p.source_type === "trip" ? "trip" : "event"} เดิมและข้อมูลไม่ถูกลบ)`
    : `ต้องการลบ "${p.name}" หรือไม่? (ข้อมูลผู้เข้าร่วม/เครื่องมือในโปรแกรมนี้จะถูกลบด้วย)`;
  const opener = window.DeleteModal?.open || window.ConfirmModal?.open;
  const doDelete = async () => {
    showLoading(true);
    try {
      await sbFetch("programs", `?program_id=eq.${programId}`, { method: "DELETE" });
      showToast(p.source_type ? "นำออกแล้ว" : "ลบแล้ว", "success");
      await loadAll();
    } catch (e) {
      showToast("ลบไม่ได้: " + e.message, "error");
    }
    showLoading(false);
  };
  if (opener) opener(warn, doDelete);
  else if (confirm(warn)) doDelete();
};

// ── IMPORT FROM LEGACY (สร้าง program wrapper) ─────────────
const importState = { items: [] };

window.openImportModal = async function () {
  const overlay = document.getElementById("importOverlay");
  const list = document.getElementById("importList");
  list.innerHTML = `<div class="op-import-empty">กำลังโหลด...</div>`;
  overlay.classList.add("open");
  const search = document.getElementById("importSearch");
  if (search) {
    search.value = "";
    search.oninput = renderImportList;
  }
  try {
    const [trips, events, programs] = await Promise.all([
      sbFetch("trips", "?select=*").catch(() => []),
      sbFetch("events", "?select=*").catch(() => []),
      sbFetch("programs", "?select=source_type,source_id").catch(() => []),
    ]);
    // legacy ที่มี wrapper อยู่แล้ว → ไม่ให้นำเข้าซ้ำ
    const wrapped = new Set(
      (programs || [])
        .filter((p) => p.source_type)
        .map((p) => `${p.source_type}:${p.source_id}`)
    );
    const out = [];
    (trips || []).forEach((t) => {
      if (wrapped.has(`trip:${t.trip_id}`)) return;
      out.push({ type: "TRIP", id: t.trip_id, name: t.trip_name, code: "", start: t.start_date, end: t.end_date, status: t.status });
    });
    (events || []).forEach((e) => {
      if (wrapped.has(`event:${e.event_id}`)) return;
      out.push({ type: "EVENT", id: e.event_id, name: e.event_name, code: e.event_code || "", start: e.event_date, end: e.end_date, status: e.status });
    });
    importState.items = out;
    renderImportList();
  } catch (e) {
    list.innerHTML = `<div class="op-import-empty">โหลดไม่ได้: ${escapeHtml(e.message)}</div>`;
  }
};

function renderImportList() {
  const list = document.getElementById("importList");
  const q = (document.getElementById("importSearch")?.value || "").toLowerCase();
  const fmt = (window.DateFmt && window.DateFmt.formatDMY) || ((s) => s || "");
  const rows = importState.items.filter((it) => !q || (it.name || "").toLowerCase().includes(q));
  if (!rows.length) {
    list.innerHTML = `<div class="op-import-empty">ไม่มีรายการให้นำเข้า (นำเข้าครบแล้ว หรือไม่พบที่ค้นหา)</div>`;
    return;
  }
  list.innerHTML = rows
    .map((it) => {
      const badge = it.type === "TRIP" ? "✈️" : "🎪";
      return `<label class="op-import-row">
        <input type="checkbox" value="${it.type}:${it.id}" />
        <span>${badge}</span>
        <span class="nm">${escapeHtml(it.name || "—")}</span>
        <span class="dt">${fmt(it.start) || "—"}</span>
      </label>`;
    })
    .join("");
}

window.closeImportModal = function () {
  document.getElementById("importOverlay").classList.remove("open");
};

function mapStatus(s) {
  return s === "DONE" || s === "CANCELLED" ? s : "ACTIVE";
}

window.doImport = async function () {
  const checked = [...document.querySelectorAll("#importList input:checked")].map((c) => c.value);
  if (!checked.length) {
    showToast("ยังไม่ได้เลือกรายการ", "error");
    return;
  }
  // สร้าง program wrapper 1 ตัวต่อ legacy ที่เลือก (key เหมือนกันทุก row → batch POST ได้)
  const payloads = checked
    .map((v) => {
      const [type, id] = v.split(":");
      const it = importState.items.find((x) => `${x.type}:${x.id}` === v);
      if (!it) return null;
      return {
        program_type: type,
        name: it.name || "—",
        code: it.code || null,
        start_date: it.start || null,
        end_date: it.end || null,
        status: mapStatus(it.status),
        enabled_tools: window.ProgramTools ? ProgramTools.defaultsFor(type) : [],
        source_type: type === "TRIP" ? "trip" : "event",
        source_id: parseInt(id, 10),
      };
    })
    .filter(Boolean);

  showLoading(true);
  try {
    await sbFetch("programs", "", { method: "POST", body: payloads });
    showToast(`นำเข้า ${payloads.length} รายการแล้ว`, "success");
    document.getElementById("importOverlay").classList.remove("open");
    await loadAll();
  } catch (e) {
    showToast("นำเข้าไม่ได้: " + e.message, "error");
  }
  showLoading(false);
};

// ── UTILS ──────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? "").replace(
    /[<>&"']/g,
    (c) =>
      ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]
  );
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
