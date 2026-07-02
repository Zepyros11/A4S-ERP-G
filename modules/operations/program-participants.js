/* ============================================================
   program-participants.js — เครื่องมือ "รายชื่อผู้เข้าร่วม" (spine)
   CRUD บน program_participants · member picker (member_persons) ·
   wrapper: ดึงรายชื่อจากระบบเดิม (event_attendees / tour_seat_check)
   ============================================================ */

const state = { programId: null, program: null, pax: [], editId: null };

function getSB() {
  return { url: localStorage.getItem("sb_url") || "", key: localStorage.getItem("sb_key") || "" };
}
async function sbFetch(table, query = "", opts = {}) {
  const { url, key } = getSB();
  const { method = "GET", body } = opts;
  const res = await fetch(`${url}/rest/v1/${table}${query}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json",
      Prefer: method === "POST" || method === "PATCH" ? "return=representation" : "" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || "API Error"); }
  return method === "DELETE" ? null : res.json().catch(() => null);
}

async function init() {
  const params = new URLSearchParams(location.search);
  state.programId = parseInt(params.get("program_id"), 10);
  document.getElementById("backLink").href = state.programId
    ? `./program-workspace.html?program_id=${state.programId}` : "./operations-hub.html";
  if (!state.programId) { document.getElementById("progName").textContent = "⚠️ ไม่พบ program_id"; return; }
  const { url, key } = getSB();
  if (!url || !key) { showToast("ยังไม่ได้เชื่อมต่อ Supabase", "error"); return; }
  document.getElementById("searchInput").addEventListener("input", renderList);
  await load();
}

async function load() {
  showLoading(true);
  try {
    const [prog, pax] = await Promise.all([
      sbFetch("programs", `?program_id=eq.${state.programId}&select=*`),
      sbFetch("program_participants", `?program_id=eq.${state.programId}&select=*&order=person_role,participant_id`),
    ]);
    state.program = prog && prog[0];
    state.pax = pax || [];
    renderHeader();
    renderStats();
    renderList();
  } catch (e) { showToast("โหลดข้อมูลไม่ได้: " + e.message, "error"); }
  showLoading(false);
}

function renderHeader() {
  const p = state.program;
  if (!p) return;
  const type = p.program_type || "TRIP";
  document.getElementById("progType").textContent = type === "TRIP" ? "✈️ Trip" : "🎪 Event";
  document.getElementById("progName").textContent = p.name || "—";

  // wrapper → ปุ่มดึงจากระบบเดิม + ลิงก์
  const noteBox = document.getElementById("legacyNote");
  if (p.source_type) {
    const legacyUrl = p.source_type === "trip"
      ? `../trip/check-seat.html?trip_id=${p.source_id}`
      : `../event/attendees.html?event=${p.source_id}`;
    noteBox.innerHTML = `<div class="pp-legacy-note">
      <span>ℹ️ งานนี้ครอบ "ระบบเดิม" — รายชื่อตัวจริงอยู่ในระบบเดิม · ดึงเข้ามาเพื่อใช้จัดห้อง/ที่นั่งใน operations ได้</span>
      <button class="btn btn-primary" data-perm="program_participant_create" onclick="window.pullFromLegacy()">📥 ดึงรายชื่อจากระบบเดิม</button>
      <a class="btn btn-ghost" target="_blank" rel="noopener" href="${legacyUrl}">เปิดเครื่องมือเดิม ↗</a>
    </div>`;
    if (window.AuthZ?.applyDomPerms) AuthZ.applyDomPerms(noteBox);
  } else {
    noteBox.innerHTML = "";
  }
}

function renderStats() {
  const p = state.pax;
  document.getElementById("cTotal").textContent = p.length;
  document.getElementById("cMember").textContent = p.filter((x) => x.member_code).length;
  document.getElementById("cGuest").textContent = p.filter((x) => !x.member_code).length;
  document.getElementById("cChecked").textContent = p.filter((x) => x.checked_in).length;
}

function renderList() {
  const q = (document.getElementById("searchInput")?.value || "").toLowerCase();
  const rows = state.pax.filter((x) => !q || (x.name || "").toLowerCase().includes(q) || (x.member_code || "").toLowerCase().includes(q));
  const tbody = document.getElementById("paxBody");
  document.getElementById("tableCount").textContent = `${rows.length} คน`;
  if (!rows.length) {
    tbody.innerHTML = `<tr class="r-card-plain"><td colspan="7"><div class="empty-state"><div class="empty-icon">👥</div><div class="empty-text">ยังไม่มีรายชื่อ — กด "＋ เพิ่มคน"${state.program?.source_type ? ' หรือ "📥 ดึงรายชื่อจากระบบเดิม"' : ""}</div></div></td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((x, i) => `<tr>
    <td class="r-card-corner" style="text-align:center;color:var(--text3);font-size:12px">${i + 1}</td>
    <td class="r-card-title" style="font-weight:600;color:var(--text)">${escapeHtml(x.name || "—")}</td>
    <td class="col-center" data-label="บทบาท"><span class="pp-role pp-role-${x.person_role || "primary"}">${roleLabel(x.person_role)}</span></td>
    <td class="col-center pp-code" data-label="รหัสสมาชิก">${escapeHtml(x.member_code || "—")}</td>
    <td class="col-center" data-label="เพศ">${x.gender === "male" ? "ชาย" : x.gender === "female" ? "หญิง" : "—"}</td>
    <td class="col-center" data-label="เช็คอิน">${x.checked_in ? "✅" : "—"}</td>
    <td class="col-center" data-label="จัดการ" onclick="event.stopPropagation()"><div class="action-group">
      <button class="btn-icon" title="แก้ไข" data-perm="program_participant_edit" onclick="window.openPaxModal(${x.participant_id})">✏️</button>
      <button class="btn-icon danger" title="ลบ" data-perm="program_participant_delete" onclick="window.deletePax(${x.participant_id})">🗑</button>
    </div></td>
  </tr>`).join("");
  if (window.AuthZ?.applyDomPerms) AuthZ.applyDomPerms(tbody);
}

function roleLabel(r) {
  return { primary: "หลัก", co_applicant: "ผู้ร่วม", guest: "แขก" }[r] || "หลัก";
}

// ── MEMBER SEARCH (in modal) ───────────────────────────────
window.toggleMemberSearch = function () {
  const inp = document.getElementById("memSearch");
  inp.style.display = inp.style.display === "none" ? "" : "none";
  if (inp.style.display !== "none") inp.focus();
  else { document.getElementById("memResults").classList.remove("show"); }
};

let _memTimer = null;
window.searchMembers = function () {
  clearTimeout(_memTimer);
  _memTimer = setTimeout(doSearchMembers, 280);
};
async function doSearchMembers() {
  const q = document.getElementById("memSearch").value.trim();
  const box = document.getElementById("memResults");
  if (q.length < 2) { box.classList.remove("show"); box.innerHTML = ""; return; }
  try {
    const enc = encodeURIComponent(`*${q}*`);
    const rows = await sbFetch("member_persons", `?or=(person_name.ilike.${enc},member_code.ilike.${enc})&limit=20`);
    if (!rows || !rows.length) { box.innerHTML = `<div class="pp-result"><span class="nm" style="color:var(--text3)">ไม่พบ</span></div>`; box.classList.add("show"); return; }
    box.innerHTML = rows.map((r) =>
      `<div class="pp-result" onclick="window.pickMember('${encodeURIComponent(r.person_name || "")}','${r.member_code || ""}','${r.person_role || "primary"}')">
        <span class="nm">${escapeHtml(r.person_name || "—")}</span>
        <span class="cd">${escapeHtml(r.member_code || "")}</span>
        <span class="pp-role pp-role-${r.person_role || "primary"}">${roleLabel(r.person_role)}</span>
      </div>`).join("");
    box.classList.add("show");
  } catch (e) { box.innerHTML = `<div class="pp-result"><span class="nm" style="color:var(--danger)">ค้นไม่ได้</span></div>`; box.classList.add("show"); }
}
window.pickMember = function (nameEnc, code, role) {
  document.getElementById("fName").value = decodeURIComponent(nameEnc);
  document.getElementById("fMemberCode").value = code;
  if (role) document.getElementById("fRole").value = role;
  document.getElementById("memResults").classList.remove("show");
  document.getElementById("memSearch").value = "";
  document.getElementById("memSearch").style.display = "none";
};

// ── MODAL / CRUD ───────────────────────────────────────────
window.openPaxModal = function (id) {
  state.editId = id || null;
  const x = id ? state.pax.find((p) => p.participant_id === id) : null;
  document.getElementById("paxModalTitle").textContent = x ? "แก้ไขคน" : "เพิ่มคน";
  document.getElementById("fName").value = x?.name || "";
  document.getElementById("fMemberCode").value = x?.member_code || "";
  document.getElementById("fRole").value = x?.person_role || "primary";
  document.getElementById("fGender").value = x?.gender || "";
  document.getElementById("fChecked").checked = !!x?.checked_in;
  document.getElementById("memSearch").style.display = "none";
  document.getElementById("memSearch").value = "";
  document.getElementById("memResults").classList.remove("show");
  document.getElementById("paxOverlay").classList.add("open");
  setTimeout(() => document.getElementById("fName").focus(), 50);
};
window.closePaxModal = function () { document.getElementById("paxOverlay").classList.remove("open"); state.editId = null; };

window.savePax = async function () {
  const name = document.getElementById("fName").value.trim();
  if (!name) { showToast("กรุณากรอกชื่อ", "error"); return; }
  const payload = {
    program_id: state.programId,
    name,
    member_code: document.getElementById("fMemberCode").value.trim() || null,
    person_role: document.getElementById("fRole").value || "primary",
    gender: document.getElementById("fGender").value || null,
    checked_in: document.getElementById("fChecked").checked,
    updated_at: new Date().toISOString(),
  };
  showLoading(true);
  try {
    if (state.editId) {
      await sbFetch("program_participants", `?participant_id=eq.${state.editId}`, { method: "PATCH", body: payload });
      showToast("แก้ไขแล้ว", "success");
    } else {
      await sbFetch("program_participants", "", { method: "POST", body: payload });
      showToast("เพิ่มแล้ว", "success");
    }
    document.getElementById("paxOverlay").classList.remove("open");
    state.editId = null;
    await load();
  } catch (e) { showToast("บันทึกไม่ได้: " + e.message, "error"); }
  showLoading(false);
};

window.deletePax = function (id) {
  const x = state.pax.find((p) => p.participant_id === id);
  if (!x) return;
  const opener = window.DeleteModal?.open || window.ConfirmModal?.open;
  const doIt = async () => {
    showLoading(true);
    try { await sbFetch("program_participants", `?participant_id=eq.${id}`, { method: "DELETE" }); showToast("ลบแล้ว", "success"); await load(); }
    catch (e) { showToast("ลบไม่ได้: " + e.message, "error"); }
    showLoading(false);
  };
  const msg = `ลบ "${x.name}" ออกจากรายชื่อ?`;
  if (opener) opener(msg, doIt); else if (confirm(msg)) doIt();
};

// ── PULL FROM LEGACY (wrapper only) ────────────────────────
window.pullFromLegacy = async function () {
  const p = state.program;
  if (!p?.source_type) return;
  showLoading(true);
  try {
    let legacy = [];
    if (p.source_type === "event") {
      const rows = await sbFetch("event_attendees", `?event_id=eq.${p.source_id}&select=name,member_code,person_role`).catch(() => []);
      legacy = (rows || []).map((r) => ({ name: r.name, member_code: r.member_code || null, person_role: r.person_role || "primary" }));
    } else {
      const rows = await sbFetch("tour_seat_check", `?trip_id=eq.${p.source_id}&select=name,code`).catch(() => []);
      legacy = (rows || []).map((r) => ({ name: r.name, member_code: null, person_role: "primary" }));
    }
    legacy = legacy.filter((r) => r.name && r.name.trim());
    // dedupe vs existing (member_code || name)
    const seen = new Set(state.pax.map((x) => (x.member_code || x.name || "").trim().toLowerCase()));
    const fresh = legacy.filter((r) => !seen.has((r.member_code || r.name || "").trim().toLowerCase()));
    if (!fresh.length) { showToast("ไม่มีรายชื่อใหม่ให้ดึง (ดึงครบแล้ว)", "success"); showLoading(false); return; }
    const payloads = fresh.map((r) => ({ program_id: state.programId, name: r.name.trim(), member_code: r.member_code, person_role: r.person_role }));
    await sbFetch("program_participants", "", { method: "POST", body: payloads });
    showToast(`ดึงเข้ามา ${payloads.length} คน`, "success");
    await load();
  } catch (e) { showToast("ดึงไม่ได้: " + e.message, "error"); }
  showLoading(false);
};

// ── UTILS ──────────────────────────────────────────────────
function escapeHtml(s) { return String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]); }
function showToast(msg, type = "success") { const t = document.getElementById("toast"); if (!t) return; t.className = `toast toast-${type} show`; t.textContent = msg; setTimeout(() => t.classList.remove("show"), 3000); }
function showLoading(show) { document.getElementById("loadingOverlay")?.classList.toggle("show", show); }

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
