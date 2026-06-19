/* ============================================================
   program-namecard.js — เครื่องมือ "ป้ายชื่อ"
   พิมพ์ป้ายชื่อจาก program_participants (ชื่อใหญ่ + งาน + บทบาท)
   ============================================================ */

const state = { programId: null, program: null, pax: [] };

function getSB() { return { url: localStorage.getItem("sb_url") || "", key: localStorage.getItem("sb_key") || "" }; }
async function sbFetch(table, query = "") {
  const { url, key } = getSB();
  const res = await fetch(`${url}/rest/v1/${table}${query}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error("API Error");
  return res.json().catch(() => null);
}

async function init() {
  const params = new URLSearchParams(location.search);
  state.programId = parseInt(params.get("program_id"), 10);
  document.getElementById("backLink").href = state.programId ? `./program-workspace.html?program_id=${state.programId}` : "./operations-hub.html";
  if (!state.programId) { document.getElementById("progName").textContent = "⚠️ ไม่พบ program_id"; return; }
  const { url, key } = getSB();
  if (!url || !key) { showToast("ยังไม่ได้เชื่อมต่อ Supabase", "error"); return; }
  showLoading(true);
  try {
    const [prog, pax] = await Promise.all([
      sbFetch("programs", `?program_id=eq.${state.programId}&select=*`),
      sbFetch("program_participants", `?program_id=eq.${state.programId}&select=name,member_code,person_role&order=person_role,participant_id`),
    ]);
    state.program = prog && prog[0];
    state.pax = pax || [];
    document.getElementById("progType").textContent = (state.program?.program_type || "TRIP") === "TRIP" ? "✈️ Trip" : "🎪 Event";
    document.getElementById("progName").textContent = `${state.program?.name || "—"} · ป้ายชื่อ`;
    render();
  } catch (e) { showToast("โหลดข้อมูลไม่ได้: " + e.message, "error"); }
  showLoading(false);
}

window.render = function () {
  const grid = document.getElementById("ncGrid");
  const showRole = document.getElementById("optRole").checked;
  const showCode = document.getElementById("optCode").checked;
  const cols = document.getElementById("optCols").value || "2";
  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  document.getElementById("cnt").textContent = `${state.pax.length} ป้าย`;
  const prog = escapeHtml(state.program?.name || "");
  if (!state.pax.length) { grid.innerHTML = `<div style="color:var(--text3);font-size:13px;grid-column:1/-1">ยังไม่มีรายชื่อ — เพิ่มที่เครื่องมือ "รายชื่อผู้เข้าร่วม" ก่อน</div>`; return; }
  grid.innerHTML = state.pax.map((x) => `<div class="nc-tag">
    <div class="nc-prog">${prog}</div>
    <div class="nc-name">${escapeHtml(x.name || "—")}</div>
    ${showCode && x.member_code ? `<div class="nc-sub">${escapeHtml(x.member_code)}</div>` : ""}
    ${showRole ? `<div class="nc-role">${roleLabel(x.person_role)}</div>` : ""}
  </div>`).join("");
};

function roleLabel(r) { return { primary: "ผู้เข้าร่วม", co_applicant: "ผู้ร่วม", guest: "แขก" }[r] || "ผู้เข้าร่วม"; }
function escapeHtml(s) { return String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]); }
function showToast(msg, type = "success") { const t = document.getElementById("toast"); if (!t) return; t.className = `toast toast-${type} show`; t.textContent = msg; setTimeout(() => t.classList.remove("show"), 3000); }
function showLoading(show) { document.getElementById("loadingOverlay")?.classList.toggle("show", show); }

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
