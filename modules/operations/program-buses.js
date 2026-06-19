/* ============================================================
   program-buses.js — เครื่องมือ "จัดรถบัส" (2-pane เหมือน room-assign)
   program_buses (CRUD) + program_bus_occupants (assign participant)
   ------------------------------------------------------------
   UX: เลือกคนฝั่งซ้าย (หลายคนได้) → คลิกการ์ดรถฝั่งขวา = จัดขึ้นรถนั้น
   ============================================================ */

const state = {
  programId: null, program: null,
  buses: [], occupants: [], pax: [],
  selected: new Set(),    // participant_id ที่เลือกอยู่
  paxTerm: "", editId: null,
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
    const [prog, buses, pax] = await Promise.all([
      sbFetch("programs", `?program_id=eq.${state.programId}&select=*`),
      sbFetch("program_buses", `?program_id=eq.${state.programId}&select=*&order=sort_order,bus_id`),
      sbFetch("program_participants", `?program_id=eq.${state.programId}&select=participant_id,name,person_role&order=person_role,participant_id`),
    ]);
    state.program = prog && prog[0];
    state.buses = buses || [];
    state.pax = pax || [];
    const ids = state.buses.map((b) => b.bus_id);
    state.occupants = ids.length ? (await sbFetch("program_bus_occupants", `?bus_id=in.(${ids.join(",")})&select=bus_id,participant_id`).catch(() => [])) || [] : [];
    // ตัด selected ที่ไม่มีในรายชื่อแล้ว (กันค้าง)
    const valid = new Set(state.pax.map((p) => p.participant_id));
    state.selected.forEach((pid) => { if (!valid.has(pid)) state.selected.delete(pid); });
    renderHeader(); renderStats(); renderPax(); renderBuses(); updateSelUI();
  } catch (e) { showToast("โหลดข้อมูลไม่ได้: " + e.message, "error"); }
  showLoading(false);
}

function occByParticipant() { const m = {}; state.occupants.forEach((o) => (m[o.participant_id] = o.bus_id)); return m; }
function paxName(pid) { const p = state.pax.find((x) => x.participant_id === pid); return p ? p.name : "—"; }
function roleLabel(r) { return ({ primary: "หลัก", co_applicant: "ผู้ร่วม", guest: "แขก" })[r] || ""; }

function renderHeader() {
  const p = state.program; if (!p) return;
  document.getElementById("progType").textContent = (p.program_type || "TRIP") === "TRIP" ? "✈️ Trip" : "🎪 Event";
  document.getElementById("progName").textContent = p.name || "—";
}
function renderStats() {
  document.getElementById("cBuses").textContent = state.buses.length;
  document.getElementById("cCap").textContent = state.buses.reduce((a, b) => a + (b.capacity || 0), 0);
  document.getElementById("cAssigned").textContent = state.occupants.length;
  document.getElementById("cUnassigned").textContent = Math.max(0, state.pax.length - state.occupants.length);
  document.getElementById("paxCount").textContent = state.pax.length;
  document.getElementById("busCount").textContent = state.buses.length;
}

/* ── LEFT: รายชื่อคน ── */
function renderPax() {
  const list = document.getElementById("paxList");
  const cur = occByParticipant();
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
    const busId = cur[x.participant_id];
    const bus = busId != null ? state.buses.find((b) => b.bus_id === busId) : null;
    const selected = state.selected.has(x.participant_id);
    const role = roleLabel(x.person_role);
    return `<div class="a2p-pax${selected ? " selected" : ""}${bus ? " assigned" : ""}" onclick="window.togglePax(${x.participant_id})">
      <input type="checkbox" class="a2p-pax-check" ${selected ? "checked" : ""} tabindex="-1" />
      <div class="a2p-pax-main">
        <div class="a2p-pax-name">${escapeHtml(x.name || "—")}</div>
        ${bus ? `<div class="a2p-pax-sub"><span class="a2p-pax-tag">🚌 ${escapeHtml(bus.bus_name)}</span></div>` : ""}
      </div>
      ${role ? `<span class="a2p-role">${role}</span>` : ""}
    </div>`;
  }).join("");
}

/* ── RIGHT: การ์ดรถ ── */
function renderBuses() {
  const grid = document.getElementById("busGrid");
  if (!state.buses.length) {
    grid.innerHTML = `<div class="a2p-empty">ยังไม่มีรถ — กด "＋ เพิ่มรถ" เพื่อเริ่ม</div>`;
    return;
  }
  const byBus = {}; state.occupants.forEach((o) => { (byBus[o.bus_id] = byBus[o.bus_id] || []).push(o.participant_id); });
  const selN = state.selected.size;
  grid.innerHTML = state.buses.map((b) => {
    const occ = byBus[b.bus_id] || [];
    const cap = b.capacity || 0;
    const full = occ.length >= cap;
    const canAssign = selN > 0 && !full;
    return `<div class="a2p-card${full ? " full" : ""}${canAssign ? " assignable" : ""}" ${canAssign ? `onclick="window.assignSelectedTo(${b.bus_id})"` : ""}>
      <div class="a2p-card-top">
        <div class="a2p-card-name">${escapeHtml(b.bus_name)}${b.bus_type ? ` <small>${escapeHtml(b.bus_type)}</small>` : ""}</div>
        <span class="a2p-card-cap">${occ.length}/${cap}</span>
      </div>
      <div class="a2p-occ">${occ.length
        ? occ.map((pid) => `<span class="a2p-pill">${escapeHtml(paxName(pid))}<button title="เอาออก" onclick="event.stopPropagation();window.removeFromBus(${pid})">✕</button></span>`).join("")
        : '<span class="a2p-occ-empty">ว่าง — เลือกคนซ้ายแล้วคลิกที่นี่</span>'}</div>
      <div class="a2p-card-acts" onclick="event.stopPropagation()">
        <button class="a2p-assign-btn" data-perm="program_bus_assign" ${canAssign ? "" : "disabled"} onclick="window.assignSelectedTo(${b.bus_id})">⬆️ ขึ้นรถ${selN ? ` (${selN})` : ""}</button>
        <button class="btn-icon" title="แก้ไข" data-perm="program_bus_edit" onclick="window.openBusModal(${b.bus_id})">✏️</button>
        <button class="btn-icon danger" title="ลบ" data-perm="program_bus_delete" onclick="window.deleteBus(${b.bus_id})">🗑</button>
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
  const hint = document.getElementById("busHint");
  if (hint) hint.innerHTML = n ? `เลือก <b>${n}</b> คน — คลิกการ์ดรถเพื่อจัดขึ้น` : "";
}

/* ── interaction ── */
window.togglePax = function (pid) {
  if (state.selected.has(pid)) state.selected.delete(pid); else state.selected.add(pid);
  renderPax(); renderBuses(); updateSelUI();
};
window.onPaxSearch = function () { state.paxTerm = document.getElementById("paxSearch").value; renderPax(); };
window.renderPax = renderPax;
window.clearSel = function () { state.selected.clear(); renderPax(); renderBuses(); updateSelUI(); };

window.assignSelectedTo = async function (busId) {
  const bus = state.buses.find((b) => b.bus_id === busId); if (!bus) return;
  const sel = [...state.selected]; if (!sel.length) return;
  const occNow = state.occupants.filter((o) => o.bus_id === busId).map((o) => o.participant_id);
  const finalCount = new Set([...occNow, ...sel]).size;
  if (finalCount > (bus.capacity || 0)) {
    showToast(`เกินความจุรถ "${bus.bus_name}" (${bus.capacity} ที่นั่ง)`, "error");
    return;
  }
  showLoading(true);
  try {
    // ย้ายคนที่เลือกออกจากรถเดิมทั้งหมด แล้วใส่ลงรถนี้
    await sbFetch("program_bus_occupants", `?participant_id=in.(${sel.join(",")})`, { method: "DELETE" });
    await sbFetch("program_bus_occupants", "", { method: "POST", body: sel.map((pid) => ({ bus_id: busId, participant_id: pid })) });
    state.selected.clear();
    showToast(`จัด ${sel.length} คนขึ้น "${bus.bus_name}" แล้ว`, "success");
    await load();
  } catch (e) { showToast("จัดรถไม่ได้: " + e.message, "error"); showLoading(false); }
};

window.removeFromBus = async function (pid) {
  showLoading(true);
  try { await sbFetch("program_bus_occupants", `?participant_id=eq.${pid}`, { method: "DELETE" }); await load(); }
  catch (e) { showToast("เอาออกไม่ได้: " + e.message, "error"); showLoading(false); }
};

/* ── bus CRUD modal ── */
window.openBusModal = function (id) {
  state.editId = id || null;
  const b = id ? state.buses.find((x) => x.bus_id === id) : null;
  document.getElementById("busModalTitle").textContent = b ? "แก้ไขรถ" : "เพิ่มรถ";
  document.getElementById("fBusName").value = b?.bus_name || "";
  document.getElementById("fBusType").value = b?.bus_type || "";
  document.getElementById("fCapacity").value = b?.capacity ?? 45;
  document.getElementById("fNote").value = b?.note || "";
  document.getElementById("busOverlay").classList.add("open");
  setTimeout(() => document.getElementById("fBusName").focus(), 50);
};
window.closeBusModal = function () { document.getElementById("busOverlay").classList.remove("open"); state.editId = null; };
window.saveBus = async function () {
  const name = document.getElementById("fBusName").value.trim();
  if (!name) { showToast("กรุณากรอกชื่อรถ", "error"); return; }
  const payload = { program_id: state.programId, bus_name: name, bus_type: document.getElementById("fBusType").value.trim() || null, capacity: parseInt(document.getElementById("fCapacity").value, 10) || 1, note: document.getElementById("fNote").value.trim() || null, updated_at: new Date().toISOString() };
  showLoading(true);
  try {
    if (state.editId) await sbFetch("program_buses", `?bus_id=eq.${state.editId}`, { method: "PATCH", body: payload });
    else await sbFetch("program_buses", "", { method: "POST", body: payload });
    showToast("บันทึกรถแล้ว", "success");
    document.getElementById("busOverlay").classList.remove("open"); state.editId = null; await load();
  } catch (e) { showToast("บันทึกไม่ได้: " + e.message, "error"); }
  showLoading(false);
};
window.deleteBus = function (id) {
  const b = state.buses.find((x) => x.bus_id === id); if (!b) return;
  const opener = window.DeleteModal?.open || window.ConfirmModal?.open;
  const doIt = async () => { showLoading(true); try { await sbFetch("program_buses", `?bus_id=eq.${id}`, { method: "DELETE" }); showToast("ลบรถแล้ว", "success"); await load(); } catch (e) { showToast("ลบไม่ได้: " + e.message, "error"); } showLoading(false); };
  const msg = `ลบรถ "${b.bus_name}"? (คนบนรถจะกลับเป็นยังไม่จัด)`;
  if (opener) opener(msg, doIt); else if (confirm(msg)) doIt();
};

function escapeHtml(s) { return String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]); }
function showToast(msg, type = "success") { const t = document.getElementById("toast"); if (!t) return; t.className = `toast toast-${type} show`; t.textContent = msg; setTimeout(() => t.classList.remove("show"), 3000); }
function showLoading(show) { document.getElementById("loadingOverlay")?.classList.toggle("show", show); }

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
