/* ============================================================
   program-seating.js — เครื่องมือ "จัดที่นั่ง / ผังโต๊ะ" (2-pane เหมือน room-assign)
   program_seating_tables (CRUD) + program_seating_assignments (assign participant)
   ------------------------------------------------------------
   UX: เลือกคนฝั่งซ้าย (หลายคนได้) → คลิกการ์ดโต๊ะฝั่งขวา = จัดเข้าโต๊ะนั้น
   ============================================================ */

const state = {
  programId: null, program: null,
  tables: [], assigns: [], pax: [],
  selected: new Set(), paxTerm: "", editId: null,
};

function getSB() { return { url: localStorage.getItem("sb_url") || "", key: localStorage.getItem("sb_key") || "" }; }
async function sbFetch(table, query = "", opts = {}) {
  const { url, key } = getSB(); const { method = "GET", body } = opts;
  const res = await fetch(`${url}/rest/v1/${table}${query}`, {
    method, headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json",
      Prefer: method === "POST" || method === "PATCH" ? "return=representation" : "" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || "API Error"); }
  return method === "DELETE" ? null : res.json().catch(() => null);
}

async function init() {
  const params = new URLSearchParams(location.search);
  state.programId = parseInt(params.get("program_id"), 10);
  document.getElementById("backLink").href = state.programId ? `./program-workspace.html?program_id=${state.programId}` : "./operations-hub.html";
  if (!state.programId) { document.getElementById("progName").textContent = "⚠️ ไม่พบ program_id"; return; }
  const { url, key } = getSB();
  if (!url || !key) { showToast("ยังไม่ได้เชื่อมต่อ Supabase", "error"); return; }
  await load();
}

async function load() {
  showLoading(true);
  try {
    const [prog, tables, pax] = await Promise.all([
      sbFetch("programs", `?program_id=eq.${state.programId}&select=*`),
      sbFetch("program_seating_tables", `?program_id=eq.${state.programId}&select=*&order=sort_order,table_id`),
      sbFetch("program_participants", `?program_id=eq.${state.programId}&select=participant_id,name,person_role&order=person_role,participant_id`),
    ]);
    state.program = prog && prog[0];
    state.tables = tables || [];
    state.pax = pax || [];
    const ids = state.tables.map((t) => t.table_id);
    state.assigns = ids.length
      ? (await sbFetch("program_seating_assignments", `?table_id=in.(${ids.join(",")})&select=table_id,participant_id`).catch(() => [])) || []
      : [];
    const valid = new Set(state.pax.map((p) => p.participant_id));
    state.selected.forEach((pid) => { if (!valid.has(pid)) state.selected.delete(pid); });
    renderHeader(); renderStats(); renderPax(); renderTables(); updateSelUI();
  } catch (e) { showToast("โหลดข้อมูลไม่ได้: " + e.message, "error"); }
  showLoading(false);
}

function asgByParticipant() { const m = {}; state.assigns.forEach((a) => (m[a.participant_id] = a.table_id)); return m; }
function paxName(pid) { const p = state.pax.find((x) => x.participant_id === pid); return p ? p.name : "—"; }
function roleLabel(r) { return ({ primary: "หลัก", co_applicant: "ผู้ร่วม", guest: "แขก" })[r] || ""; }

function renderHeader() {
  const p = state.program; if (!p) return;
  document.getElementById("progType").textContent = (p.program_type || "TRIP") === "TRIP" ? "✈️ Trip" : "🎪 Event";
  document.getElementById("progName").textContent = p.name || "—";
}
function renderStats() {
  document.getElementById("cTables").textContent = state.tables.length;
  document.getElementById("cCap").textContent = state.tables.reduce((a, t) => a + (t.capacity || 0), 0);
  document.getElementById("cAssigned").textContent = state.assigns.length;
  document.getElementById("cUnassigned").textContent = Math.max(0, state.pax.length - state.assigns.length);
  document.getElementById("paxCount").textContent = state.pax.length;
  document.getElementById("tableCountTab").textContent = state.tables.length;
}

/* ── LEFT: รายชื่อคน ── */
function renderPax() {
  const list = document.getElementById("paxList");
  const cur = asgByParticipant();
  const filter = document.getElementById("paxFilter")?.value || "all";
  const term = state.paxTerm.trim().toLowerCase();
  const rows = state.pax.filter((x) => {
    const assigned = cur[x.participant_id] != null;
    if (filter === "assigned" && !assigned) return false;
    if (filter === "unassigned" && assigned) return false;
    if (term && !(x.name || "").toLowerCase().includes(term)) return false;
    return true;
  });
  if (!rows.length) {
    list.innerHTML = `<div class="a2p-empty">${state.pax.length
      ? "ไม่พบรายชื่อตามตัวกรอง"
      : 'ยังไม่มีรายชื่อ — เพิ่มที่<br>"รายชื่อผู้เข้าร่วม" ก่อน'}</div>`;
    return;
  }
  list.innerHTML = rows.map((x) => {
    const tid = cur[x.participant_id];
    const tbl = tid != null ? state.tables.find((t) => t.table_id === tid) : null;
    const selected = state.selected.has(x.participant_id);
    const role = roleLabel(x.person_role);
    return `<div class="a2p-pax${selected ? " selected" : ""}${tbl ? " assigned" : ""}" onclick="window.togglePax(${x.participant_id})">
      <input type="checkbox" class="a2p-pax-check" ${selected ? "checked" : ""} tabindex="-1" />
      <div class="a2p-pax-main">
        <div class="a2p-pax-name">${escapeHtml(x.name || "—")}</div>
        ${tbl ? `<div class="a2p-pax-sub"><span class="a2p-pax-tag">🪑 ${escapeHtml(tbl.table_name)}</span></div>` : ""}
      </div>
      ${role ? `<span class="a2p-role">${role}</span>` : ""}
    </div>`;
  }).join("");
}

/* ── RIGHT: การ์ดโต๊ะ ── */
function renderTables() {
  const grid = document.getElementById("tableGrid");
  if (!state.tables.length) {
    grid.innerHTML = `<div class="a2p-empty">ยังไม่มีโต๊ะ — กด "＋ เพิ่มโต๊ะ" เพื่อเริ่ม</div>`;
    return;
  }
  const byTable = {}; state.assigns.forEach((a) => { (byTable[a.table_id] = byTable[a.table_id] || []).push(a.participant_id); });
  const selN = state.selected.size;
  grid.innerHTML = state.tables.map((t) => {
    const occ = byTable[t.table_id] || [];
    const cap = t.capacity || 0;
    const full = occ.length >= cap;
    const canAssign = selN > 0 && !full;
    return `<div class="a2p-card${full ? " full" : ""}${canAssign ? " assignable" : ""}" ${canAssign ? `onclick="window.assignSelectedTo(${t.table_id})"` : ""}>
      <div class="a2p-card-top">
        <div class="a2p-card-name">${escapeHtml(t.table_name)}${t.note ? ` <small>${escapeHtml(t.note)}</small>` : ""}</div>
        <span class="a2p-card-cap">${occ.length}/${cap}</span>
      </div>
      <div class="a2p-occ">${occ.length
        ? occ.map((pid) => `<span class="a2p-pill">${escapeHtml(paxName(pid))}<button title="เอาออก" onclick="event.stopPropagation();window.removeFromTable(${pid})">✕</button></span>`).join("")
        : '<span class="a2p-occ-empty">ว่าง — เลือกคนซ้ายแล้วคลิกที่นี่</span>'}</div>
      <div class="a2p-card-acts" onclick="event.stopPropagation()">
        <button class="a2p-assign-btn" data-perm="program_seating_assign" ${canAssign ? "" : "disabled"} onclick="window.assignSelectedTo(${t.table_id})">⬆️ นั่งโต๊ะนี้${selN ? ` (${selN})` : ""}</button>
        <button class="btn-icon" title="แก้ไข" data-perm="program_seating_edit" onclick="window.openTableModal(${t.table_id})">✏️</button>
        <button class="btn-icon danger" title="ลบ" data-perm="program_seating_delete" onclick="window.deleteTable(${t.table_id})">🗑</button>
      </div>
    </div>`;
  }).join("");
  if (window.AuthZ?.applyDomPerms) AuthZ.applyDomPerms(grid);
}

function updateSelUI() {
  const n = state.selected.size;
  const c = document.getElementById("selCount");
  const clr = document.getElementById("clearSelBtn");
  if (c) { c.style.display = n ? "" : "none"; c.textContent = `${n} เลือก`; }
  if (clr) clr.style.display = n ? "" : "none";
  const hint = document.getElementById("tableHint");
  if (hint) hint.innerHTML = n ? `เลือก <b>${n}</b> คน — คลิกการ์ดโต๊ะเพื่อจัดเข้า` : "";
}

/* ── interaction ── */
window.togglePax = function (pid) {
  if (state.selected.has(pid)) state.selected.delete(pid); else state.selected.add(pid);
  renderPax(); renderTables(); updateSelUI();
};
window.onPaxSearch = function () { state.paxTerm = document.getElementById("paxSearch").value; renderPax(); };
window.renderPax = renderPax;
window.clearSel = function () { state.selected.clear(); renderPax(); renderTables(); updateSelUI(); };

window.assignSelectedTo = async function (tableId) {
  const tbl = state.tables.find((t) => t.table_id === tableId); if (!tbl) return;
  const sel = [...state.selected]; if (!sel.length) return;
  const occNow = state.assigns.filter((a) => a.table_id === tableId).map((a) => a.participant_id);
  const finalCount = new Set([...occNow, ...sel]).size;
  if (finalCount > (tbl.capacity || 0)) {
    showToast(`เกินจำนวนที่นั่งโต๊ะ "${tbl.table_name}" (${tbl.capacity} ที่)`, "error");
    return;
  }
  showLoading(true);
  try {
    await sbFetch("program_seating_assignments", `?participant_id=in.(${sel.join(",")})`, { method: "DELETE" });
    await sbFetch("program_seating_assignments", "", { method: "POST", body: sel.map((pid) => ({ table_id: tableId, participant_id: pid })) });
    state.selected.clear();
    showToast(`จัด ${sel.length} คนเข้า "${tbl.table_name}" แล้ว`, "success");
    await load();
  } catch (e) { showToast("จัดโต๊ะไม่ได้: " + e.message, "error"); showLoading(false); }
};

window.removeFromTable = async function (pid) {
  showLoading(true);
  try { await sbFetch("program_seating_assignments", `?participant_id=eq.${pid}`, { method: "DELETE" }); await load(); }
  catch (e) { showToast("เอาออกไม่ได้: " + e.message, "error"); showLoading(false); }
};

/* ── table CRUD modal ── */
window.openTableModal = function (id) {
  state.editId = id || null;
  const t = id ? state.tables.find((x) => x.table_id === id) : null;
  document.getElementById("tableModalTitle").textContent = t ? "แก้ไขโต๊ะ" : "เพิ่มโต๊ะ";
  document.getElementById("fTableName").value = t?.table_name || "";
  document.getElementById("fCapacity").value = t?.capacity ?? 10;
  document.getElementById("fNote").value = t?.note || "";
  document.getElementById("tableOverlay").classList.add("open");
  setTimeout(() => document.getElementById("fTableName").focus(), 50);
};
window.closeTableModal = function () { document.getElementById("tableOverlay").classList.remove("open"); state.editId = null; };
window.saveTable = async function () {
  const name = document.getElementById("fTableName").value.trim();
  if (!name) { showToast("กรุณากรอกชื่อโต๊ะ", "error"); return; }
  const payload = { program_id: state.programId, table_name: name, capacity: parseInt(document.getElementById("fCapacity").value, 10) || 1, note: document.getElementById("fNote").value.trim() || null, updated_at: new Date().toISOString() };
  showLoading(true);
  try {
    if (state.editId) await sbFetch("program_seating_tables", `?table_id=eq.${state.editId}`, { method: "PATCH", body: payload });
    else await sbFetch("program_seating_tables", "", { method: "POST", body: payload });
    showToast("บันทึกโต๊ะแล้ว", "success");
    document.getElementById("tableOverlay").classList.remove("open"); state.editId = null; await load();
  } catch (e) { showToast("บันทึกไม่ได้: " + e.message, "error"); }
  showLoading(false);
};
window.deleteTable = function (id) {
  const t = state.tables.find((x) => x.table_id === id); if (!t) return;
  const opener = window.DeleteModal?.open || window.ConfirmModal?.open;
  const doIt = async () => { showLoading(true); try { await sbFetch("program_seating_tables", `?table_id=eq.${id}`, { method: "DELETE" }); showToast("ลบโต๊ะแล้ว", "success"); await load(); } catch (e) { showToast("ลบไม่ได้: " + e.message, "error"); } showLoading(false); };
  const msg = `ลบโต๊ะ "${t.table_name}"? (คนบนโต๊ะจะกลับเป็นยังไม่จัด)`;
  if (opener) opener(msg, doIt); else if (confirm(msg)) doIt();
};

function escapeHtml(s) { return String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]); }
function showToast(msg, type = "success") { const t = document.getElementById("toast"); if (!t) return; t.className = `toast toast-${type} show`; t.textContent = msg; setTimeout(() => t.classList.remove("show"), 3000); }
function showLoading(show) { document.getElementById("loadingOverlay")?.classList.toggle("show", show); }

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
