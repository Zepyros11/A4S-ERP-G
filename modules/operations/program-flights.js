/* ============================================================
   program-flights.js — เครื่องมือ "เที่ยวบิน / ตั๋ว" (2-pane เหมือน room-assign)
   program_flights (CRUD) + program_flight_occupants (assign participant)
   ------------------------------------------------------------
   UX: เลือกคนฝั่งซ้าย (หลายคนได้) → คลิกการ์ดเที่ยวบินฝั่งขวา = จัดขึ้นเครื่องนั้น
   (เที่ยวบินไม่จำกัดจำนวน — ไม่มี capacity)
   ============================================================ */

const state = {
  programId: null, program: null,
  flights: [], occupants: [], pax: [],
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
    const [prog, flights, pax] = await Promise.all([
      sbFetch("programs", `?program_id=eq.${state.programId}&select=*`),
      sbFetch("program_flights", `?program_id=eq.${state.programId}&select=*&order=sort_order,flight_id`),
      sbFetch("program_participants", `?program_id=eq.${state.programId}&select=participant_id,name,person_role&order=person_role,participant_id`),
    ]);
    state.program = prog && prog[0];
    state.flights = flights || [];
    state.pax = pax || [];
    const ids = state.flights.map((f) => f.flight_id);
    state.occupants = ids.length ? (await sbFetch("program_flight_occupants", `?flight_id=in.(${ids.join(",")})&select=flight_id,participant_id`).catch(() => [])) || [] : [];
    const valid = new Set(state.pax.map((p) => p.participant_id));
    state.selected.forEach((pid) => { if (!valid.has(pid)) state.selected.delete(pid); });
    renderHeader(); renderStats(); renderPax(); renderFlights(); updateSelUI();
  } catch (e) { showToast("โหลดข้อมูลไม่ได้: " + e.message, "error"); }
  showLoading(false);
}

function occByParticipant() { const m = {}; state.occupants.forEach((o) => (m[o.participant_id] = o.flight_id)); return m; }
function paxName(pid) { const p = state.pax.find((x) => x.participant_id === pid); return p ? p.name : "—"; }
function roleLabel(r) { return ({ primary: "หลัก", co_applicant: "ผู้ร่วม", guest: "แขก" })[r] || ""; }
function fmtDT(s) {
  if (!s) return "";
  const fmt = (window.DateFmt && window.DateFmt.formatDMY) || ((d) => d);
  return `${fmt(s.slice(0, 10))} ${s.slice(11, 16)}`.trim();
}

function renderHeader() {
  const p = state.program; if (!p) return;
  document.getElementById("progType").textContent = (p.program_type || "TRIP") === "TRIP" ? "✈️ Trip" : "🎪 Event";
  document.getElementById("progName").textContent = p.name || "—";
}
function renderStats() {
  document.getElementById("cFlights").textContent = state.flights.length;
  document.getElementById("cAssigned").textContent = state.occupants.length;
  document.getElementById("cUnassigned").textContent = Math.max(0, state.pax.length - state.occupants.length);
  document.getElementById("cTotal").textContent = state.pax.length;
  document.getElementById("paxCount").textContent = state.pax.length;
  document.getElementById("flightCount").textContent = state.flights.length;
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
    const fid = cur[x.participant_id];
    const fl = fid != null ? state.flights.find((f) => f.flight_id === fid) : null;
    const selected = state.selected.has(x.participant_id);
    const role = roleLabel(x.person_role);
    return `<div class="a2p-pax${selected ? " selected" : ""}${fl ? " assigned" : ""}" onclick="window.togglePax(${x.participant_id})">
      <input type="checkbox" class="a2p-pax-check" ${selected ? "checked" : ""} tabindex="-1" />
      <div class="a2p-pax-main">
        <div class="a2p-pax-name">${escapeHtml(x.name || "—")}</div>
        ${fl ? `<div class="a2p-pax-sub"><span class="a2p-pax-tag">✈️ ${escapeHtml(fl.flight_name)}</span></div>` : ""}
      </div>
      ${role ? `<span class="a2p-role">${role}</span>` : ""}
    </div>`;
  }).join("");
}

/* ── RIGHT: การ์ดเที่ยวบิน ── */
function renderFlights() {
  const grid = document.getElementById("flightGrid");
  if (!state.flights.length) {
    grid.innerHTML = `<div class="a2p-empty">ยังไม่มีเที่ยวบิน — กด "＋ เพิ่มเที่ยวบิน" เพื่อเริ่ม</div>`;
    return;
  }
  const byFlight = {}; state.occupants.forEach((o) => { (byFlight[o.flight_id] = byFlight[o.flight_id] || []).push(o.participant_id); });
  const selN = state.selected.size;
  grid.innerHTML = state.flights.map((f) => {
    const occ = byFlight[f.flight_id] || [];
    const meta = [f.flight_no, f.route, f.depart_datetime ? "ไป " + fmtDT(f.depart_datetime) : ""].filter(Boolean).join(" · ");
    const canAssign = selN > 0;
    return `<div class="a2p-card${canAssign ? " assignable" : ""}" ${canAssign ? `onclick="window.assignSelectedTo(${f.flight_id})"` : ""}>
      <div class="a2p-card-top">
        <div class="a2p-card-name">${escapeHtml(f.flight_name)}${meta ? `<br><small>${escapeHtml(meta)}</small>` : ""}</div>
        <span class="a2p-card-cap">${occ.length} คน</span>
      </div>
      <div class="a2p-occ">${occ.length
        ? occ.map((pid) => `<span class="a2p-pill">${escapeHtml(paxName(pid))}<button title="เอาออก" onclick="event.stopPropagation();window.removeFromFlight(${pid})">✕</button></span>`).join("")
        : '<span class="a2p-occ-empty">ว่าง — เลือกคนซ้ายแล้วคลิกที่นี่</span>'}</div>
      <div class="a2p-card-acts" onclick="event.stopPropagation()">
        <button class="a2p-assign-btn" data-perm="program_flight_assign" ${canAssign ? "" : "disabled"} onclick="window.assignSelectedTo(${f.flight_id})">⬆️ ขึ้นเครื่อง${selN ? ` (${selN})` : ""}</button>
        <button class="btn-icon" title="แก้ไข" data-perm="program_flight_edit" onclick="window.openFlightModal(${f.flight_id})">✏️</button>
        <button class="btn-icon danger" title="ลบ" data-perm="program_flight_delete" onclick="window.deleteFlight(${f.flight_id})">🗑</button>
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
  const hint = document.getElementById("flightHint");
  if (hint) hint.innerHTML = n ? `เลือก <b>${n}</b> คน — คลิกการ์ดเที่ยวบินเพื่อจัดขึ้น` : "";
}

/* ── interaction ── */
window.togglePax = function (pid) {
  if (state.selected.has(pid)) state.selected.delete(pid); else state.selected.add(pid);
  renderPax(); renderFlights(); updateSelUI();
};
window.onPaxSearch = function () { state.paxTerm = document.getElementById("paxSearch").value; renderPax(); };
window.renderPax = renderPax;
window.clearSel = function () { state.selected.clear(); renderPax(); renderFlights(); updateSelUI(); };

window.assignSelectedTo = async function (flightId) {
  const fl = state.flights.find((f) => f.flight_id === flightId); if (!fl) return;
  const sel = [...state.selected]; if (!sel.length) return;
  showLoading(true);
  try {
    await sbFetch("program_flight_occupants", `?participant_id=in.(${sel.join(",")})`, { method: "DELETE" });
    await sbFetch("program_flight_occupants", "", { method: "POST", body: sel.map((pid) => ({ flight_id: flightId, participant_id: pid })) });
    state.selected.clear();
    showToast(`จัด ${sel.length} คนขึ้น "${fl.flight_name}" แล้ว`, "success");
    await load();
  } catch (e) { showToast("จัดเที่ยวบินไม่ได้: " + e.message, "error"); showLoading(false); }
};

window.removeFromFlight = async function (pid) {
  showLoading(true);
  try { await sbFetch("program_flight_occupants", `?participant_id=eq.${pid}`, { method: "DELETE" }); await load(); }
  catch (e) { showToast("เอาออกไม่ได้: " + e.message, "error"); showLoading(false); }
};

/* ── flight CRUD modal ── */
window.openFlightModal = function (id) {
  state.editId = id || null;
  const f = id ? state.flights.find((x) => x.flight_id === id) : null;
  document.getElementById("flightModalTitle").textContent = f ? "แก้ไขเที่ยวบิน" : "เพิ่มเที่ยวบิน";
  document.getElementById("fFlightName").value = f?.flight_name || "";
  document.getElementById("fFlightNo").value = f?.flight_no || "";
  document.getElementById("fRoute").value = f?.route || "";
  document.getElementById("fDepart").value = f?.depart_datetime ? f.depart_datetime.slice(0, 16) : "";
  document.getElementById("fReturn").value = f?.return_datetime ? f.return_datetime.slice(0, 16) : "";
  document.getElementById("fNote").value = f?.note || "";
  document.getElementById("flightOverlay").classList.add("open");
  setTimeout(() => document.getElementById("fFlightName").focus(), 50);
};
window.closeFlightModal = function () { document.getElementById("flightOverlay").classList.remove("open"); state.editId = null; };
window.saveFlight = async function () {
  const name = document.getElementById("fFlightName").value.trim();
  if (!name) { showToast("กรุณากรอกชื่อกลุ่ม/เที่ยวบิน", "error"); return; }
  const payload = {
    program_id: state.programId, flight_name: name,
    flight_no: document.getElementById("fFlightNo").value.trim() || null,
    route: document.getElementById("fRoute").value.trim() || null,
    depart_datetime: document.getElementById("fDepart").value || null,
    return_datetime: document.getElementById("fReturn").value || null,
    note: document.getElementById("fNote").value.trim() || null,
    updated_at: new Date().toISOString(),
  };
  showLoading(true);
  try {
    if (state.editId) await sbFetch("program_flights", `?flight_id=eq.${state.editId}`, { method: "PATCH", body: payload });
    else await sbFetch("program_flights", "", { method: "POST", body: payload });
    showToast("บันทึกเที่ยวบินแล้ว", "success");
    document.getElementById("flightOverlay").classList.remove("open"); state.editId = null; await load();
  } catch (e) { showToast("บันทึกไม่ได้: " + e.message, "error"); }
  showLoading(false);
};
window.deleteFlight = function (id) {
  const f = state.flights.find((x) => x.flight_id === id); if (!f) return;
  const opener = window.DeleteModal?.open || window.ConfirmModal?.open;
  const doIt = async () => { showLoading(true); try { await sbFetch("program_flights", `?flight_id=eq.${id}`, { method: "DELETE" }); showToast("ลบเที่ยวบินแล้ว", "success"); await load(); } catch (e) { showToast("ลบไม่ได้: " + e.message, "error"); } showLoading(false); };
  const msg = `ลบเที่ยวบิน "${f.flight_name}"? (คนในเที่ยวบินจะกลับเป็นยังไม่จัด)`;
  if (opener) opener(msg, doIt); else if (confirm(msg)) doIt();
};

function escapeHtml(s) { return String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]); }
function showToast(msg, type = "success") { const t = document.getElementById("toast"); if (!t) return; t.className = `toast toast-${type} show`; t.textContent = msg; setTimeout(() => t.classList.remove("show"), 3000); }
function showLoading(show) { document.getElementById("loadingOverlay")?.classList.toggle("show", show); }

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
