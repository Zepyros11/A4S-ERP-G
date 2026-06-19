/* ============================================================
   program-rooming.js — เครื่องมือ "จัดห้องพัก" (2-pane เหมือน room-assign)
   program_rooms (CRUD) + program_room_occupants (assign participant)
   ------------------------------------------------------------
   UX: เลือกคนฝั่งซ้าย (หลายคนได้) → คลิกการ์ดห้องฝั่งขวา = จัดเข้าห้องนั้น
   ============================================================ */

const state = {
  programId: null, program: null,
  rooms: [], occupants: [], pax: [],
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
    const [prog, rooms, pax] = await Promise.all([
      sbFetch("programs", `?program_id=eq.${state.programId}&select=*`),
      sbFetch("program_rooms", `?program_id=eq.${state.programId}&select=*&order=sort_order,room_id`),
      sbFetch("program_participants", `?program_id=eq.${state.programId}&select=participant_id,name,gender,person_role&order=person_role,participant_id`),
    ]);
    state.program = prog && prog[0];
    state.rooms = rooms || [];
    state.pax = pax || [];
    const ids = state.rooms.map((r) => r.room_id);
    state.occupants = ids.length
      ? (await sbFetch("program_room_occupants", `?room_id=in.(${ids.join(",")})&select=room_id,participant_id`).catch(() => [])) || []
      : [];
    const valid = new Set(state.pax.map((p) => p.participant_id));
    state.selected.forEach((pid) => { if (!valid.has(pid)) state.selected.delete(pid); });
    renderHeader(); renderStats(); renderPax(); renderRooms(); updateSelUI();
  } catch (e) { showToast("โหลดข้อมูลไม่ได้: " + e.message, "error"); }
  showLoading(false);
}

function occByParticipant() { const m = {}; state.occupants.forEach((o) => (m[o.participant_id] = o.room_id)); return m; }
function paxName(pid) { const p = state.pax.find((x) => x.participant_id === pid); return p ? p.name : "—"; }
function roleLabel(r) { return ({ primary: "หลัก", co_applicant: "ผู้ร่วม", guest: "แขก" })[r] || ""; }
function genderPrefBadge(g) {
  if (g === "M") return '<span class="a2p-gender m">♂ ชาย</span>';
  if (g === "F") return '<span class="a2p-gender f">♀ หญิง</span>';
  if (g === "MIXED") return '<span class="a2p-role">รวม</span>';
  return "";
}

function renderHeader() {
  const p = state.program; if (!p) return;
  document.getElementById("progType").textContent = (p.program_type || "TRIP") === "TRIP" ? "✈️ Trip" : "🎪 Event";
  document.getElementById("progName").textContent = p.name || "—";
}
function renderStats() {
  document.getElementById("cRooms").textContent = state.rooms.length;
  document.getElementById("cCap").textContent = state.rooms.reduce((a, r) => a + (r.capacity || 0), 0);
  document.getElementById("cAssigned").textContent = state.occupants.length;
  document.getElementById("cUnassigned").textContent = Math.max(0, state.pax.length - state.occupants.length);
  document.getElementById("paxCount").textContent = state.pax.length;
  document.getElementById("roomCount").textContent = state.rooms.length;
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
    if (filter === "male" && x.gender !== "male") return false;
    if (filter === "female" && x.gender !== "female") return false;
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
    const rid = cur[x.participant_id];
    const room = rid != null ? state.rooms.find((r) => r.room_id === rid) : null;
    const selected = state.selected.has(x.participant_id);
    const g = x.gender === "male" ? '<span class="a2p-gender m">♂</span>' : x.gender === "female" ? '<span class="a2p-gender f">♀</span>' : "";
    const role = roleLabel(x.person_role);
    return `<div class="a2p-pax${selected ? " selected" : ""}${room ? " assigned" : ""}" onclick="window.togglePax(${x.participant_id})">
      <input type="checkbox" class="a2p-pax-check" ${selected ? "checked" : ""} tabindex="-1" />
      <div class="a2p-pax-main">
        <div class="a2p-pax-name">${escapeHtml(x.name || "—")}</div>
        ${room ? `<div class="a2p-pax-sub"><span class="a2p-pax-tag">🛏️ ${escapeHtml(room.room_name)}</span></div>` : ""}
      </div>
      ${g}${role ? `<span class="a2p-role">${role}</span>` : ""}
    </div>`;
  }).join("");
}

/* ── RIGHT: การ์ดห้อง ── */
function renderRooms() {
  const grid = document.getElementById("roomGrid");
  if (!state.rooms.length) {
    grid.innerHTML = `<div class="a2p-empty">ยังไม่มีห้อง — กด "＋ เพิ่มห้อง" เพื่อเริ่ม</div>`;
    return;
  }
  const byRoom = {}; state.occupants.forEach((o) => { (byRoom[o.room_id] = byRoom[o.room_id] || []).push(o.participant_id); });
  const selN = state.selected.size;
  grid.innerHTML = state.rooms.map((r) => {
    const occ = byRoom[r.room_id] || [];
    const cap = r.capacity || 0;
    const full = occ.length >= cap;
    const canAssign = selN > 0 && !full;
    return `<div class="a2p-card${full ? " full" : ""}${canAssign ? " assignable" : ""}" ${canAssign ? `onclick="window.assignSelectedTo(${r.room_id})"` : ""}>
      <div class="a2p-card-top">
        <div class="a2p-card-name">${escapeHtml(r.room_name)}${r.room_type ? ` <small>${escapeHtml(r.room_type)}</small>` : ""} ${genderPrefBadge(r.gender_pref)}</div>
        <span class="a2p-card-cap">${occ.length}/${cap}</span>
      </div>
      <div class="a2p-occ">${occ.length
        ? occ.map((pid) => `<span class="a2p-pill">${escapeHtml(paxName(pid))}<button title="เอาออก" onclick="event.stopPropagation();window.removeFromRoom(${pid})">✕</button></span>`).join("")
        : '<span class="a2p-occ-empty">ว่าง — เลือกคนซ้ายแล้วคลิกที่นี่</span>'}</div>
      <div class="a2p-card-acts" onclick="event.stopPropagation()">
        <button class="a2p-assign-btn" data-perm="program_room_assign" ${canAssign ? "" : "disabled"} onclick="window.assignSelectedTo(${r.room_id})">⬆️ เข้าห้อง${selN ? ` (${selN})` : ""}</button>
        <button class="btn-icon" title="แก้ไข" data-perm="program_room_edit" onclick="window.openRoomModal(${r.room_id})">✏️</button>
        <button class="btn-icon danger" title="ลบ" data-perm="program_room_delete" onclick="window.deleteRoom(${r.room_id})">🗑</button>
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
  const hint = document.getElementById("roomHint");
  if (hint) hint.innerHTML = n ? `เลือก <b>${n}</b> คน — คลิกการ์ดห้องเพื่อจัดเข้า` : "";
}

/* ── interaction ── */
window.togglePax = function (pid) {
  if (state.selected.has(pid)) state.selected.delete(pid); else state.selected.add(pid);
  renderPax(); renderRooms(); updateSelUI();
};
window.onPaxSearch = function () { state.paxTerm = document.getElementById("paxSearch").value; renderPax(); };
window.renderPax = renderPax;
window.clearSel = function () { state.selected.clear(); renderPax(); renderRooms(); updateSelUI(); };

window.assignSelectedTo = async function (roomId) {
  const room = state.rooms.find((r) => r.room_id === roomId); if (!room) return;
  const sel = [...state.selected]; if (!sel.length) return;
  const occNow = state.occupants.filter((o) => o.room_id === roomId).map((o) => o.participant_id);
  const finalCount = new Set([...occNow, ...sel]).size;
  if (finalCount > (room.capacity || 0)) {
    showToast(`เกินความจุห้อง "${room.room_name}" (${room.capacity} คน)`, "error");
    return;
  }
  showLoading(true);
  try {
    await sbFetch("program_room_occupants", `?participant_id=in.(${sel.join(",")})`, { method: "DELETE" });
    await sbFetch("program_room_occupants", "", { method: "POST", body: sel.map((pid) => ({ room_id: roomId, participant_id: pid })) });
    state.selected.clear();
    showToast(`จัด ${sel.length} คนเข้า "${room.room_name}" แล้ว`, "success");
    await load();
  } catch (e) { showToast("จัดห้องไม่ได้: " + e.message, "error"); showLoading(false); }
};

window.removeFromRoom = async function (pid) {
  showLoading(true);
  try { await sbFetch("program_room_occupants", `?participant_id=eq.${pid}`, { method: "DELETE" }); await load(); }
  catch (e) { showToast("เอาออกไม่ได้: " + e.message, "error"); showLoading(false); }
};

/* ── room CRUD modal ── */
window.openRoomModal = function (id) {
  state.editId = id || null;
  const r = id ? state.rooms.find((x) => x.room_id === id) : null;
  document.getElementById("roomModalTitle").textContent = r ? "แก้ไขห้อง" : "เพิ่มห้อง";
  document.getElementById("fRoomName").value = r?.room_name || "";
  document.getElementById("fRoomType").value = r?.room_type || "";
  document.getElementById("fCapacity").value = r?.capacity ?? 2;
  document.getElementById("fGenderPref").value = r?.gender_pref || "";
  document.getElementById("roomOverlay").classList.add("open");
  setTimeout(() => document.getElementById("fRoomName").focus(), 50);
};
window.closeRoomModal = function () { document.getElementById("roomOverlay").classList.remove("open"); state.editId = null; };
window.saveRoom = async function () {
  const name = document.getElementById("fRoomName").value.trim();
  if (!name) { showToast("กรุณากรอกชื่อห้อง", "error"); return; }
  const payload = {
    program_id: state.programId, room_name: name,
    room_type: document.getElementById("fRoomType").value.trim() || null,
    capacity: parseInt(document.getElementById("fCapacity").value, 10) || 1,
    gender_pref: document.getElementById("fGenderPref").value || null,
    updated_at: new Date().toISOString(),
  };
  showLoading(true);
  try {
    if (state.editId) await sbFetch("program_rooms", `?room_id=eq.${state.editId}`, { method: "PATCH", body: payload });
    else await sbFetch("program_rooms", "", { method: "POST", body: payload });
    showToast("บันทึกห้องแล้ว", "success");
    document.getElementById("roomOverlay").classList.remove("open"); state.editId = null; await load();
  } catch (e) { showToast("บันทึกไม่ได้: " + e.message, "error"); }
  showLoading(false);
};
window.deleteRoom = function (id) {
  const r = state.rooms.find((x) => x.room_id === id); if (!r) return;
  const opener = window.DeleteModal?.open || window.ConfirmModal?.open;
  const doIt = async () => { showLoading(true); try { await sbFetch("program_rooms", `?room_id=eq.${id}`, { method: "DELETE" }); showToast("ลบห้องแล้ว", "success"); await load(); } catch (e) { showToast("ลบไม่ได้: " + e.message, "error"); } showLoading(false); };
  const msg = `ลบห้อง "${r.room_name}"? (คนในห้องจะกลับเป็นยังไม่จัด)`;
  if (opener) opener(msg, doIt); else if (confirm(msg)) doIt();
};

function escapeHtml(s) { return String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]); }
function showToast(msg, type = "success") { const t = document.getElementById("toast"); if (!t) return; t.className = `toast toast-${type} show`; t.textContent = msg; setTimeout(() => t.classList.remove("show"), 3000); }
function showLoading(show) { document.getElementById("loadingOverlay")?.classList.toggle("show", show); }

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
