/* ============================================================
   program-staff.js — เครื่องมือ "ทีมงาน / Staff / ไกด์"
   CRUD roster บน program_staff (member_type: staff|guide|outsource)
   ============================================================ */

const state = { programId: null, program: null, staff: [], editId: null };

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
  document.getElementById("searchInput").addEventListener("input", renderList);
  await load();
}

async function load() {
  showLoading(true);
  try {
    const [prog, staff] = await Promise.all([
      sbFetch("programs", `?program_id=eq.${state.programId}&select=*`),
      sbFetch("program_staff", `?program_id=eq.${state.programId}&select=*&order=member_type,sort_order,staff_id`),
    ]);
    state.program = prog && prog[0];
    state.staff = staff || [];
    renderHeader(); renderStats(); renderList();
  } catch (e) { showToast("โหลดข้อมูลไม่ได้: " + e.message, "error"); }
  showLoading(false);
}

function renderHeader() {
  const p = state.program; if (!p) return;
  document.getElementById("progType").textContent = (p.program_type || "TRIP") === "TRIP" ? "✈️ Trip" : "🎪 Event";
  document.getElementById("progName").textContent = `${p.name || "—"} · ทีมงาน`;
}
function renderStats() {
  const s = state.staff;
  document.getElementById("cTotal").textContent = s.length;
  document.getElementById("cStaff").textContent = s.filter((x) => x.member_type === "staff").length;
  document.getElementById("cGuide").textContent = s.filter((x) => x.member_type === "guide").length;
  document.getElementById("cOut").textContent = s.filter((x) => x.member_type === "outsource").length;
}

function typeLabel(t) { return { staff: "👔 Staff", guide: "🎌 ไกด์", outsource: "🤝 Outsource" }[t] || "👔 Staff"; }

function renderList() {
  const q = (document.getElementById("searchInput")?.value || "").toLowerCase();
  const rows = state.staff.filter((x) => !q || (x.full_name || "").toLowerCase().includes(q));
  const tbody = document.getElementById("staffBody");
  document.getElementById("tableCount").textContent = `${rows.length} คน`;
  if (!rows.length) { tbody.innerHTML = `<tr class="r-card-plain"><td colspan="6"><div class="empty-state"><div class="empty-icon">🧑‍🤝‍🧑</div><div class="empty-text">ยังไม่มีทีมงาน — กด "＋ เพิ่มทีมงาน"</div></div></td></tr>`; return; }
  tbody.innerHTML = rows.map((x, i) => `<tr>
    <td class="r-card-corner" style="text-align:center;color:var(--text3);font-size:12px">${i + 1}</td>
    <td class="r-card-title" style="font-weight:600;color:var(--text)">${escapeHtml(x.full_name || "—")}</td>
    <td class="col-center" data-label="ประเภท"><span class="st-type st-type-${x.member_type || "staff"}">${typeLabel(x.member_type)}</span></td>
    <td class="col-center" data-label="โทร">${escapeHtml(x.phone || "—")}</td>
    <td data-label="ภาษา / หมายเหตุ">${escapeHtml([x.languages, x.note].filter(Boolean).join(" · ") || "—")}</td>
    <td class="col-center" data-label="จัดการ" onclick="event.stopPropagation()"><div class="action-group">
      <button class="btn-icon" title="แก้ไข" data-perm="program_staff_edit" onclick="window.openStaffModal(${x.staff_id})">✏️</button>
      <button class="btn-icon danger" title="ลบ" data-perm="program_staff_delete" onclick="window.deleteStaff(${x.staff_id})">🗑</button>
    </div></td>
  </tr>`).join("");
  if (window.AuthZ?.applyDomPerms) AuthZ.applyDomPerms(tbody);
}

window.openStaffModal = function (id) {
  state.editId = id || null;
  const x = id ? state.staff.find((s) => s.staff_id === id) : null;
  document.getElementById("staffModalTitle").textContent = x ? "แก้ไขทีมงาน" : "เพิ่มทีมงาน";
  document.getElementById("fName").value = x?.full_name || "";
  document.getElementById("fType").value = x?.member_type || "staff";
  document.getElementById("fPhone").value = x?.phone || "";
  document.getElementById("fLang").value = x?.languages || "";
  document.getElementById("fNote").value = x?.note || "";
  document.getElementById("staffOverlay").classList.add("open");
  setTimeout(() => document.getElementById("fName").focus(), 50);
};
window.closeStaffModal = function () { document.getElementById("staffOverlay").classList.remove("open"); state.editId = null; };
window.saveStaff = async function () {
  const name = document.getElementById("fName").value.trim();
  if (!name) { showToast("กรุณากรอกชื่อ", "error"); return; }
  const payload = {
    program_id: state.programId, full_name: name,
    member_type: document.getElementById("fType").value || "staff",
    phone: document.getElementById("fPhone").value.trim() || null,
    languages: document.getElementById("fLang").value.trim() || null,
    note: document.getElementById("fNote").value.trim() || null,
    updated_at: new Date().toISOString(),
  };
  showLoading(true);
  try {
    if (state.editId) await sbFetch("program_staff", `?staff_id=eq.${state.editId}`, { method: "PATCH", body: payload });
    else await sbFetch("program_staff", "", { method: "POST", body: payload });
    showToast("บันทึกแล้ว", "success");
    document.getElementById("staffOverlay").classList.remove("open"); state.editId = null; await load();
  } catch (e) { showToast("บันทึกไม่ได้: " + e.message, "error"); }
  showLoading(false);
};
window.deleteStaff = function (id) {
  const x = state.staff.find((s) => s.staff_id === id); if (!x) return;
  const opener = window.DeleteModal?.open || window.ConfirmModal?.open;
  const doIt = async () => { showLoading(true); try { await sbFetch("program_staff", `?staff_id=eq.${id}`, { method: "DELETE" }); showToast("ลบแล้ว", "success"); await load(); } catch (e) { showToast("ลบไม่ได้: " + e.message, "error"); } showLoading(false); };
  const msg = `ลบ "${x.full_name}" ออกจากทีมงาน?`;
  if (opener) opener(msg, doIt); else if (confirm(msg)) doIt();
};

function escapeHtml(s) { return String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]); }
function showToast(msg, type = "success") { const t = document.getElementById("toast"); if (!t) return; t.className = `toast toast-${type} show`; t.textContent = msg; setTimeout(() => t.classList.remove("show"), 3000); }
function showLoading(show) { document.getElementById("loadingOverlay")?.classList.toggle("show", show); }

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
