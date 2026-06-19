/* ============================================================
   program-tasks.js — เครื่องมือ "งาน (Task / Gantt)" ต่อ program
   list + gantt + CRUD บน program_tasks (filter ด้วย ?program_id=)
   ============================================================ */

const state = {
  programId: null,
  program: null,
  tasks: [],
  editId: null,
  view: "list",
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
      Prefer: method === "POST" || method === "PATCH" ? "return=representation" : "",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || "API Error");
  }
  return method === "DELETE" ? null : res.json().catch(() => null);
}

async function init() {
  const params = new URLSearchParams(location.search);
  state.programId = parseInt(params.get("program_id"), 10);
  document.getElementById("backLink").href = state.programId
    ? `./program-workspace.html?program_id=${state.programId}`
    : "./operations-hub.html";
  if (!state.programId) {
    document.getElementById("progName").textContent = "⚠️ ไม่พบ program_id";
    return;
  }
  const { url, key } = getSB();
  if (!url || !key) {
    showToast("ยังไม่ได้เชื่อมต่อ Supabase", "error");
    return;
  }
  await load();
}

async function load() {
  showLoading(true);
  try {
    const [prog, tasks] = await Promise.all([
      sbFetch("programs", `?program_id=eq.${state.programId}&select=*`),
      sbFetch("program_tasks", `?program_id=eq.${state.programId}&select=*&order=sort_order,task_id`),
    ]);
    state.program = prog && prog[0];
    state.tasks = tasks || [];
    renderHeader();
    renderStats();
    renderView();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

function renderHeader() {
  const p = state.program;
  if (!p) return;
  const type = p.program_type || "TRIP";
  document.getElementById("progType").textContent = type === "TRIP" ? "✈️ Trip" : "🎪 Event";
  document.getElementById("progName").textContent = `${p.name || "—"} · งาน (Task / Gantt)`;
}

function renderStats() {
  const t = state.tasks;
  document.getElementById("cTotal").textContent = t.length;
  document.getElementById("cTodo").textContent = t.filter((x) => x.status === "TODO").length;
  document.getElementById("cDoing").textContent = t.filter((x) => x.status === "DOING").length;
  document.getElementById("cDone").textContent = t.filter((x) => x.status === "DONE").length;
}

window.setView = function (v) {
  state.view = v;
  document.getElementById("btnList").classList.toggle("active", v === "list");
  document.getElementById("btnGantt").classList.toggle("active", v === "gantt");
  document.getElementById("listView").style.display = v === "list" ? "" : "none";
  document.getElementById("ganttView").style.display = v === "gantt" ? "" : "none";
  renderView();
};

function renderView() {
  if (state.view === "list") renderList();
  else renderGantt();
}

// ── LIST ───────────────────────────────────────────────────
function renderList() {
  const tbody = document.getElementById("taskBody");
  const fmt = (window.DateFmt && window.DateFmt.formatDMY) || ((s) => s || "");
  if (!state.tasks.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">ยังไม่มีงาน — กด "＋ เพิ่มงาน"</div></div></td></tr>`;
    return;
  }
  tbody.innerHTML = state.tasks
    .map((t, i) => {
      const range =
        t.start_date || t.due_date
          ? `${fmt(t.start_date) || "—"} → ${fmt(t.due_date) || "—"}`
          : `<span style="color:var(--text3)">—</span>`;
      const prog = Math.max(0, Math.min(100, t.progress || 0));
      return `<tr>
        <td style="text-align:center;color:var(--text3);font-size:12px">${i + 1}</td>
        <td>
          <div class="tk-title-cell">${escapeHtml(t.title || "—")}</div>
          ${t.note ? `<div class="tk-note">${escapeHtml(t.note)}</div>` : ""}
        </td>
        <td>${escapeHtml(t.assignee || "—")}</td>
        <td class="col-center" style="white-space:nowrap">${range}</td>
        <td class="col-center"><span class="tk-st tk-st-${t.status || "TODO"}">${statusLabel(t.status)}</span></td>
        <td class="col-center">
          <div class="tk-prog"><div class="tk-prog-fill" style="width:${prog}%"></div></div>
          <div class="tk-prog-num">${prog}%</div>
        </td>
        <td class="col-center" onclick="event.stopPropagation()">
          <div class="action-group">
            <button class="btn-icon" title="แก้ไข" data-perm="program_task_edit" onclick="window.openTaskModal(${t.task_id})">✏️</button>
            <button class="btn-icon danger" title="ลบ" data-perm="program_task_delete" onclick="window.deleteTask(${t.task_id})">🗑</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");
  if (window.AuthZ && typeof AuthZ.applyDomPerms === "function") AuthZ.applyDomPerms(tbody);
}

// ── GANTT ──────────────────────────────────────────────────
function parseDay(s) {
  if (!s) return null;
  const d = new Date(s + "T00:00:00");
  return isNaN(d.getTime()) ? null : d;
}
function dayDiff(a, b) {
  return Math.round((b - a) / 86400000);
}

function renderGantt() {
  const box = document.getElementById("ganttView");
  const fmt = (window.DateFmt && window.DateFmt.formatDMY) || ((s) => s || "");
  const dated = state.tasks.filter((t) => parseDay(t.start_date) && parseDay(t.due_date));
  const undated = state.tasks.filter((t) => !(parseDay(t.start_date) && parseDay(t.due_date)));

  if (!dated.length) {
    box.innerHTML = `<div class="gantt-nodate">ยังไม่มีงานที่ระบุวันเริ่ม+กำหนดเสร็จครบ — ใส่วันที่ให้งานเพื่อแสดง Gantt</div>`;
    return;
  }

  let min = parseDay(dated[0].start_date);
  let max = parseDay(dated[0].due_date);
  dated.forEach((t) => {
    const s = parseDay(t.start_date), d = parseDay(t.due_date);
    if (s < min) min = s;
    if (d > max) max = d;
  });
  const total = Math.max(1, dayDiff(min, max) + 1);

  const rows = dated
    .map((t) => {
      const s = parseDay(t.start_date), d = parseDay(t.due_date);
      const left = (dayDiff(min, s) / total) * 100;
      const width = Math.max(1.5, ((dayDiff(s, d) + 1) / total) * 100);
      const prog = Math.max(0, Math.min(100, t.progress || 0));
      return `<div class="gantt-row">
        <div class="gantt-label">${escapeHtml(t.title || "—")}${t.assignee ? `<div class="who">${escapeHtml(t.assignee)}</div>` : ""}</div>
        <div class="gantt-track">
          <div class="gantt-bar gantt-bar-${t.status || "TODO"}" style="left:${left}%;width:${width}%" title="${escapeHtml(t.title)} (${prog}%)">
            <div class="gantt-bar-fill" style="width:${prog}%"></div>
            <span class="gantt-bar-label">${prog}%</span>
          </div>
        </div>
      </div>`;
    })
    .join("");

  const undatedHtml = undated.length
    ? `<div class="gantt-nodate">⏳ ยังไม่ระบุวัน: ${undated.map((t) => escapeHtml(t.title)).join(" · ")}</div>`
    : "";

  box.innerHTML = `
    <div class="gantt-axis"><span>${fmt(toISO(min))}</span><span>${fmt(toISO(max))}</span></div>
    ${rows}
    ${undatedHtml}`;
}

function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function statusLabel(s) {
  return { TODO: "⚪ ยังไม่เริ่ม", DOING: "🔵 กำลังทำ", DONE: "✅ เสร็จแล้ว" }[s] || "⚪ ยังไม่เริ่ม";
}

// ── MODAL / CRUD ───────────────────────────────────────────
window.openTaskModal = function (taskId) {
  state.editId = taskId || null;
  const t = taskId ? state.tasks.find((x) => x.task_id === taskId) : null;
  document.getElementById("taskModalTitle").textContent = t ? "แก้ไขงาน" : "เพิ่มงาน";
  document.getElementById("fTitle").value = t?.title || "";
  document.getElementById("fAssignee").value = t?.assignee || "";
  document.getElementById("fStatus").value = t?.status || "TODO";
  document.getElementById("fStart").value = t?.start_date || "";
  document.getElementById("fDue").value = t?.due_date || "";
  const prog = t?.progress ?? 0;
  document.getElementById("fProgress").value = prog;
  document.getElementById("progLabel").textContent = prog;
  document.getElementById("fNote").value = t?.note || "";
  document.getElementById("taskOverlay").classList.add("open");
  setTimeout(() => document.getElementById("fTitle").focus(), 50);
};

window.closeTaskModal = function () {
  document.getElementById("taskOverlay").classList.remove("open");
  state.editId = null;
};

window.saveTask = async function () {
  const title = document.getElementById("fTitle").value.trim();
  if (!title) {
    showToast("กรุณากรอกชื่องาน", "error");
    return;
  }
  const start = document.getElementById("fStart").value || null;
  const due = document.getElementById("fDue").value || null;
  if (start && due && due < start) {
    showToast("กำหนดเสร็จต้องไม่น้อยกว่าวันเริ่ม", "error");
    return;
  }
  const payload = {
    program_id: state.programId,
    title,
    assignee: document.getElementById("fAssignee").value.trim() || null,
    status: document.getElementById("fStatus").value || "TODO",
    start_date: start,
    due_date: due,
    progress: parseInt(document.getElementById("fProgress").value, 10) || 0,
    note: document.getElementById("fNote").value.trim() || null,
    updated_at: new Date().toISOString(),
  };
  showLoading(true);
  try {
    if (state.editId) {
      await sbFetch("program_tasks", `?task_id=eq.${state.editId}`, { method: "PATCH", body: payload });
      showToast("แก้ไขงานแล้ว", "success");
    } else {
      await sbFetch("program_tasks", "", { method: "POST", body: payload });
      showToast("เพิ่มงานแล้ว", "success");
    }
    document.getElementById("taskOverlay").classList.remove("open");
    state.editId = null;
    await load();
  } catch (e) {
    showToast("บันทึกไม่ได้: " + e.message, "error");
  }
  showLoading(false);
};

window.deleteTask = function (taskId) {
  const t = state.tasks.find((x) => x.task_id === taskId);
  if (!t) return;
  const msg = `ลบงาน "${t.title}"?`;
  const opener = window.DeleteModal?.open || window.ConfirmModal?.open;
  const doIt = async () => {
    showLoading(true);
    try {
      await sbFetch("program_tasks", `?task_id=eq.${taskId}`, { method: "DELETE" });
      showToast("ลบแล้ว", "success");
      await load();
    } catch (e) {
      showToast("ลบไม่ได้: " + e.message, "error");
    }
    showLoading(false);
  };
  if (opener) opener(msg, doIt);
  else if (confirm(msg)) doIt();
};

// ── UTILS ──────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? "").replace(
    /[<>&"']/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]
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
