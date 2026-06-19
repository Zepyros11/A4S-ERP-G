/* ============================================================
   program-workspace.js — เปิด program 1 ตัว แล้ว render ปุ่มเครื่องมือ
   ตาม programs.enabled_tools + catalog (program-tools.js)
   MVP: ปุ่มเป็น stub "เร็วๆ นี้" (พิสูจน์ routing + capability)
   ============================================================ */

const state = { programId: null, program: null };

function getSB() {
  return {
    url: localStorage.getItem("sb_url") || "",
    key: localStorage.getItem("sb_key") || "",
  };
}

async function sbFetch(table, query = "") {
  const { url, key } = getSB();
  const res = await fetch(`${url}/rest/v1/${table}${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error("API Error");
  return res.json().catch(() => null);
}

async function init() {
  const params = new URLSearchParams(location.search);
  state.programId = parseInt(params.get("program_id"), 10);
  if (!state.programId) {
    renderError("ไม่พบ program_id");
    return;
  }
  const { url, key } = getSB();
  if (!url || !key) {
    showToast("ยังไม่ได้เชื่อมต่อ Supabase", "error");
    return;
  }
  // sync permission ล่าสุดจาก DB → เครื่องมือที่เพิ่ง add perm จะโผล่เลย (ไม่ต้อง re-login)
  if (window.AuthZ?.refresh) { try { await AuthZ.refresh(); } catch (e) {} }
  showLoading(true);
  try {
    const rows = await sbFetch("programs", `?program_id=eq.${state.programId}&select=*`);
    state.program = rows && rows[0];
    if (!state.program) {
      renderError("ไม่พบโปรแกรมนี้ (อาจถูกลบไปแล้ว)");
    } else {
      renderHead();
      renderTools();
    }
  } catch (e) {
    renderError("โหลดข้อมูลไม่ได้: " + e.message);
  }
  showLoading(false);
}

function renderHead() {
  const p = state.program;
  const fmt = (window.DateFmt && window.DateFmt.formatDMY) || ((s) => s || "");
  const type = p.program_type || "TRIP";
  const dateRange =
    p.start_date || p.end_date
      ? `${fmt(p.start_date) || "—"} → ${fmt(p.end_date) || "—"}`
      : "—";

  const legacyLink = p.source_type
    ? `<a class="ws-legacy-link" target="_blank" rel="noopener" href="${legacyUrl(p)}">📂 เปิดเครื่องมือระบบเดิม ↗</a>`
    : "";

  document.getElementById("wsHead").innerHTML = `
    <span class="ws-type ws-type-${type}">${type === "TRIP" ? "✈️ Trip" : "🎪 Event"}</span>
    <h1 class="ws-title">${escapeHtml(p.name || "—")}</h1>
    <div class="ws-meta">
      <span>📅 ${dateRange}</span>
      <span class="ws-status ws-status-${p.status || "ACTIVE"}">${statusLabel(p.status)}</span>
      ${legacyLink}
    </div>`;
}

// ลิงก์ไปเครื่องมือระบบเดิม (สำหรับ program ที่ครอบ legacy)
function legacyUrl(p) {
  if (p.source_type === "trip") return `../trip/check-seat.html?trip_id=${p.source_id}`;
  if (p.source_type === "event") return `../event/attendees.html?event=${p.source_id}`;
  return "";
}

function renderTools() {
  const grid = document.getElementById("wsTools");
  const p = state.program;
  const tools = window.ProgramTools
    ? ProgramTools.toolsFor(p) // กรองตาม type + enabled_tools (perm กรองด้วย data-perm ด้านล่าง)
    : [];

  const note = p.source_type
    ? `<div class="ws-legacy-note">ℹ️ โปรแกรมนี้ครอบงาน "ระบบเดิม" — ข้อมูลผู้เข้าร่วม/ห้อง/ตั๋วยังอยู่ในระบบเดิม กดปุ่ม "เปิดเครื่องมือระบบเดิม" ด้านบนเพื่อจัดการ · เครื่องมือใหม่ด้านล่างจะทยอยเปิดใช้</div>`
    : "";

  if (!tools.length) {
    grid.innerHTML = note + `<div class="ws-empty">ยังไม่ได้เปิดเครื่องมือใดในโปรแกรมนี้ — กด ✏️ แก้ไขที่หน้า Operations เพื่อเลือกเครื่องมือ</div>`;
    return;
  }

  grid.innerHTML = note + tools
    .map((t) => {
      const soon = t.ready ? "" : `<span class="op-soon">เร็วๆ นี้</span>`;
      const click = t.ready ? `onclick="window.openTool('${t.path}')"` : "disabled";
      return `
      <button class="op-tool-card" data-perm="${t.perm}" ${click}>
        <div class="op-tool-ic">${t.icon}</div>
        <div class="op-tool-body">
          <div class="op-tool-label">${escapeHtml(t.label)} ${soon}</div>
          <div class="op-tool-desc">${escapeHtml(t.desc || "")}</div>
        </div>
      </button>`;
    })
    .join("");

  if (window.AuthZ && typeof AuthZ.applyDomPerms === "function") {
    AuthZ.applyDomPerms(grid);
  }
}

// เปิดเครื่องมือ (ใช้ตอน tool พร้อม ready:true) — แนบ program_id ไปด้วยเสมอ
window.openTool = function (path) {
  if (!path) return;
  const sep = path.includes("?") ? "&" : "?";
  window.location.href = `${path}${sep}program_id=${state.programId}`;
};

function renderError(msg) {
  document.getElementById("wsHead").innerHTML = `<h1 class="ws-title">⚠️ ${escapeHtml(msg)}</h1>`;
  document.getElementById("wsTools").innerHTML = "";
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

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
