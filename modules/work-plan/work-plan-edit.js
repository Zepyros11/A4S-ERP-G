/* ============================================================
   work-plan-edit.js — หน้าแก้ตารางแผนงาน (spreadsheet + autosave)
   URL: work-plan-edit.html?id={planId}&scope=event|cs|trip
============================================================ */

import {
  fetchPlan,
  updatePlan,
  deletePlan,
  fetchRows,
  createRow,
  updateRow,
  deleteRow,
  fetchDepartments,
  fetchStaffUsers,
  fetchPlaces,
} from "./work-plan-api.js";

/* ── Utils ─────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const toast = (msg, type = "info") => {
  const t = $("toast");
  if (!t) return;
  t.textContent = msg;
  t.className = `toast toast-${type} show`;
  setTimeout(() => (t.className = "toast"), 2500);
};
const qs = new URLSearchParams(location.search);
const PLAN_ID = parseInt(qs.get("id"), 10);
const SCOPE = ["event", "cs", "trip"].includes(qs.get("scope"))
  ? qs.get("scope")
  : "event";

/* ── State ─────────────────────────────────────────── */
const state = {
  plan: null,
  rows: [],
  departments: [],
  users: [],
  places: [],
  activeDay: 1,
  savingOps: 0,            // in-flight autosave operations
  rowDebouncers: new Map(), // rowId → timer
  planDebouncer: null,
};

/* ── Init ─────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", init);

async function init() {
  if (!PLAN_ID) {
    toast("ไม่พบ plan id", "error");
    return;
  }
  $("backLink").href = `./work-plan-list.html?scope=${SCOPE}`;
  $("wpHero").className = `wp-hero scope-${SCOPE}`;

  try {
    showLoading(true);
    const [plan, rows, depts, users, places] = await Promise.all([
      fetchPlan(PLAN_ID),
      fetchRows(PLAN_ID),
      fetchDepartments(SCOPE),
      fetchStaffUsers(),
      fetchPlaces().catch(() => []),
    ]);
    if (!plan) {
      toast("ไม่พบแผนงาน", "error");
      return;
    }
    state.plan = plan;
    state.rows = rows;
    state.departments = depts;
    state.users = users;
    state.places = places;
    renderPlaceDatalist();
    renderHeader();
    renderDayTabs();
    renderTable();
    setupRowDragDelegation();
  } catch (e) {
    console.error(e);
    toast("โหลดข้อมูลไม่สำเร็จ: " + e.message, "error");
  } finally {
    showLoading(false);
  }

  // Central Esc handler — topmost overlay/popup first
  document.addEventListener("keydown", onGlobalEsc);

  // Global click → close popovers
  document.addEventListener("click", (e) => {
    const pop = $("assigneePop");
    if (pop.style.display !== "none" && !pop.contains(e.target) && !e.target.closest(".wp-assignee-cell")) {
      pop.style.display = "none";
    }
    const cm = $("colMenuPop");
    if (cm.style.display !== "none" && !cm.contains(e.target) && !e.target.closest(".wp-col-menu-btn")) {
      cm.style.display = "none";
    }
  });

  // Header field autosave
  ["planNameInput", "planDeptInput", "planYearInput",
   "planStartInput", "planEndInput", "planLocationInput"].forEach((id) => {
    $(id).addEventListener("input", schedulePlanSave);
    $(id).addEventListener("change", schedulePlanSave);
  });
}

function showLoading(on) {
  $("loadingOverlay")?.classList.toggle("show", !!on);
}

/* ── Place datalist (autocomplete) ───────────────── */
function renderPlaceDatalist() {
  const list = $("placeList");
  if (!list) return;
  list.innerHTML = (state.places || [])
    .map((p) => {
      const label = p.place_type ? `${p.place_name} (${p.place_type})` : p.place_name;
      return `<option value="${escapeAttr(p.place_name)}" label="${escapeAttr(label)}"></option>`;
    })
    .join("");
}

/* ── Render header ─────────────────────────────────── */
function renderHeader() {
  const p = state.plan;
  $("heroTitle").textContent = p.plan_name || "ไม่มีชื่อ";
  $("planNameInput").value = p.plan_name || "";

  $("planDeptInput").innerHTML =
    `<option value="">-- ไม่ระบุแผนก --</option>` +
    state.departments
      .map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`)
      .join("");
  $("planDeptInput").value = p.dept_id || "";

  $("planYearInput").value = p.year || "";
  $("planStartInput").value = p.event_start || "";
  $("planEndInput").value = p.event_end || "";
  $("planLocationInput").value = p.location || "";
}

/* ── Day tabs ─────────────────────────────────────── */
function calcDayCount() {
  const p = state.plan;
  if (!p.event_start) return 1;
  if (!p.event_end || p.event_end === p.event_start) return 1;
  const a = new Date(p.event_start);
  const b = new Date(p.event_end);
  const days = Math.floor((b - a) / 86400000) + 1;
  return Math.max(1, Math.min(days, 7));
}
function renderDayTabs() {
  const count = calcDayCount();
  const wrap = $("dayTabs");
  if (count <= 1) {
    wrap.style.display = "none";
    state.activeDay = 1;
    return;
  }
  wrap.style.display = "flex";
  let html = "";
  for (let i = 1; i <= count; i++) {
    html += `<div class="wp-day-tab ${i === state.activeDay ? "active" : ""}" onclick="window.switchDay(${i})">วันที่ ${i}</div>`;
  }
  wrap.innerHTML = html;
}
window.switchDay = (d) => {
  state.activeDay = d;
  renderDayTabs();
  renderTable();
};

/* ── Render table ─────────────────────────────────── */
function renderTable() {
  const cols = state.plan.columns || [];
  const thead = $("wpThead");
  const tbody = $("wpTbody");

  // header
  let th = `<tr>
    <th class="wp-row-no">#</th>`;
  cols.forEach((c, i) => {
    th += `<th style="min-width:${c.width || 120}px">
      <div class="wp-col-header-wrap">
        <input class="wp-cell-input" style="font-weight:600;background:transparent"
               data-col-idx="${i}" data-col-attr="label"
               value="${escapeHtml(c.label)}" oninput="window.onColRename(${i}, this.value)" />
        <button class="wp-col-menu-btn" onclick="window.openColMenu(event, ${i})" title="ตัวเลือก">▾</button>
      </div>
    </th>`;
  });
  th += `<th style="min-width:170px">ผู้รับผิดชอบ</th>`;
  th += `<th class="wp-col-actions"></th></tr>`;
  thead.innerHTML = th;

  // body
  const dayRows = state.rows.filter((r) => (r.event_day || 1) === state.activeDay);
  if (!dayRows.length) {
    tbody.innerHTML = `<tr><td colspan="${cols.length + 3}" style="padding:24px;text-align:center;color:var(--text3)">ยังไม่มีแถว — กด <b>＋ เพิ่มแถว</b></td></tr>`;
    renderTotal([]);
    return;
  }

  tbody.innerHTML = dayRows
    .map((r, idx) => {
      let tds = `<td class="wp-row-no" draggable="true" title="ลากเพื่อจัดลำดับใหม่">
        <div class="wp-row-no-inner">
          <span class="wp-drag-handle">⋮⋮</span>
          <span class="wp-row-no-num">${idx + 1}</span>
        </div>
      </td>`;
      cols.forEach((c) => {
        const v = (r.data || {})[c.key] ?? "";
        const type = c.type || "text";
        if (type === "number") {
          tds += `<td><input class="wp-cell-input" type="number" value="${escapeHtml(v)}" data-row-id="${r.id}" data-col-key="${c.key}" oninput="window.onCellInput(${r.id}, '${c.key}', this.value, true)" /></td>`;
        } else if (type === "date") {
          tds += `<td><input class="wp-cell-input" type="date" value="${escapeHtml(v)}" data-row-id="${r.id}" data-col-key="${c.key}" oninput="window.onCellInput(${r.id}, '${c.key}', this.value, false)" /></td>`;
        } else if (type === "time") {
          const [ts, te] = parseTimeRange(v);
          tds += `<td><div class="wp-time-range" data-row-id="${r.id}" data-col-key="${escapeAttr(c.key)}">
            ${timePartHTML("start", ts)}
            <span class="wp-time-sep">–</span>
            ${timePartHTML("end", te)}
          </div></td>`;
        } else {
          tds += `<td><textarea class="wp-cell-input" rows="1" data-row-id="${r.id}" data-col-key="${c.key}" oninput="window.onCellInput(${r.id}, '${c.key}', this.value, false)">${escapeHtml(v)}</textarea></td>`;
        }
      });
      // Assignee cell
      tds += `<td><div class="wp-assignee-cell" onclick="window.openAssigneePicker(event, ${r.id})">${renderAssignees(r)}</div></td>`;
      // Actions
      tds += `<td class="wp-col-actions"><button title="ลบแถว" onclick="window.removeRow(${r.id})">🗑</button></td>`;
      return `<tr data-row-id="${r.id}">${tds}</tr>`;
    })
    .join("");

  renderTotal(dayRows);
}

function renderAssignees(row) {
  const chips = [];
  if (row.owner_user_id) {
    const u = state.users.find((x) => x.user_id === row.owner_user_id);
    if (u) {
      chips.push(
        `<span class="wp-chip owner" title="ผู้รับผิดชอบหลัก">${escapeHtml(u.full_name || u.username)}</span>`
      );
    }
  }
  (row.helper_user_ids || []).forEach((uid) => {
    const u = state.users.find((x) => x.user_id === uid);
    if (u) {
      chips.push(
        `<span class="wp-chip helper" title="ผู้ช่วย">${escapeHtml(u.full_name || u.username)}</span>`
      );
    }
  });
  if (!chips.length) {
    return `<span class="wp-assignee-placeholder">+ มอบหมาย</span>`;
  }
  return chips.join("");
}

function renderTotal(dayRows) {
  const cols = state.plan.columns || [];
  const minCol = cols.find((c) => c.type === "number" && /นาที|min|minute/i.test(c.label + c.key));
  if (!minCol) {
    $("wpTotal").style.display = "none";
    return;
  }
  const total = dayRows.reduce((sum, r) => {
    const v = parseFloat((r.data || {})[minCol.key]);
    return sum + (isNaN(v) ? 0 : v);
  }, 0);
  $("wpTotal").style.display = "block";
  $("wpTotal").textContent = `รวม ${total.toLocaleString()} ${minCol.label}`;
}

/* ── Time range helpers (custom HH:MM select) ──── */
const MINUTE_STEPS = ["00", "15", "30", "45"];

function parseTimeRange(v) {
  if (!v || typeof v !== "string") return ["", ""];
  const parts = v.split(/[-–—~]/);
  return [(parts[0] || "").trim(), (parts[1] || "").trim()];
}

function timePartHTML(side, value) {
  const [hh = "", mm = ""] = (value || "").split(":");
  const display = hh || mm ? `${hh || "--"}:${mm || "--"}` : "--:--";
  const empty = !hh && !mm ? " is-empty" : "";
  return `<div class="wp-time-part" data-side="${side}">
    <button type="button" class="wp-time-btn${empty}" data-hh="${hh}" data-mm="${mm}"
            onclick="window.openTimePicker(this)">${display}</button>
  </div>`;
}

/* ── Time picker popup (shared singleton) ─────── */
let _activeTimeBtn = null;

window.openTimePicker = (btn) => {
  _activeTimeBtn = btn;
  const pop = $("timePickerPop");
  if (!pop) return;

  const curHh = btn.dataset.hh || "";
  const curMm = btn.dataset.mm || "";

  // Build hour grid (24 cells — CSS = 2 cols × 12 rows)
  let hhHtml = "";
  for (let h = 0; h < 24; h++) {
    const v = String(h).padStart(2, "0");
    hhHtml += `<button type="button" class="wp-tp-cell${v === curHh ? " active" : ""}"
      onclick="window.pickTpHour('${v}')">${v}</button>`;
  }
  $("tpHh").innerHTML = hhHtml;

  let mmHtml = "";
  MINUTE_STEPS.forEach((m) => {
    mmHtml += `<button type="button" class="wp-tp-cell${m === curMm ? " active" : ""}"
      onclick="window.pickTpMinute('${m}')">${m}</button>`;
  });
  $("tpMm").innerHTML = mmHtml;

  // Position: below button, or above if no space
  pop.style.display = "block";
  const r = btn.getBoundingClientRect();
  const popH = pop.offsetHeight;
  const vh = window.innerHeight;
  pop.style.left = Math.min(r.left, window.innerWidth - pop.offsetWidth - 8) + "px";
  if (vh - r.bottom < popH + 20 && r.top > popH + 20) {
    pop.style.top = (r.top - popH - 4) + "px";
  } else {
    pop.style.top = (r.bottom + 4) + "px";
  }
};

window.pickTpHour = (hh) => {
  if (!_activeTimeBtn) return;
  _activeTimeBtn.dataset.hh = hh;
  updateTimeBtn(_activeTimeBtn);
  propagateTimeChange(_activeTimeBtn);
  highlightTpActive("tpHh", hh);
};

window.pickTpMinute = (mm) => {
  if (!_activeTimeBtn) return;
  _activeTimeBtn.dataset.mm = mm;
  updateTimeBtn(_activeTimeBtn);
  propagateTimeChange(_activeTimeBtn);
  highlightTpActive("tpMm", mm);
  // auto close after picking minute
  setTimeout(closeTimePicker, 120);
};

window.clearTimePicker = () => {
  if (!_activeTimeBtn) return;
  _activeTimeBtn.dataset.hh = "";
  _activeTimeBtn.dataset.mm = "";
  updateTimeBtn(_activeTimeBtn);
  propagateTimeChange(_activeTimeBtn);
  closeTimePicker();
};

function updateTimeBtn(btn) {
  const hh = btn.dataset.hh || "";
  const mm = btn.dataset.mm || "";
  if (!hh && !mm) {
    btn.textContent = "--:--";
    btn.classList.add("is-empty");
  } else {
    btn.textContent = `${hh || "--"}:${mm || "--"}`;
    btn.classList.remove("is-empty");
  }
}

function propagateTimeChange(btn) {
  const wrap = btn.closest(".wp-time-range");
  if (!wrap) return;
  const rowId = parseInt(wrap.dataset.rowId, 10);
  const key = wrap.dataset.colKey;

  const getPart = (side) => {
    const b = wrap.querySelector(`.wp-time-part[data-side="${side}"] .wp-time-btn`);
    if (!b) return "";
    const hh = b.dataset.hh || "";
    const mm = b.dataset.mm || "";
    if (!hh && !mm) return "";
    if (hh && !mm) return `${hh}:00`;
    if (!hh && mm) return `00:${mm}`;
    return `${hh}:${mm}`;
  };

  const start = getPart("start");
  const end = getPart("end");
  let combined;
  if (!start && !end) combined = "";
  else if (start && !end) combined = start;
  else if (!start && end) combined = `-${end}`;
  else combined = `${start}-${end}`;

  const row = state.rows.find((r) => r.id === rowId);
  if (!row) return;
  if (!row.data) row.data = {};
  row.data[key] = combined;
  scheduleRowSave(rowId, { data: row.data });
}

function highlightTpActive(containerId, value) {
  const wrap = $(containerId);
  if (!wrap) return;
  wrap.querySelectorAll(".wp-tp-cell").forEach((b) => {
    b.classList.toggle("active", b.textContent.trim() === value);
  });
}

function closeTimePicker() {
  const pop = $("timePickerPop");
  if (pop) pop.style.display = "none";
  _activeTimeBtn = null;
}

document.addEventListener("click", (e) => {
  const pop = $("timePickerPop");
  if (!pop || pop.style.display === "none") return;
  if (e.target.closest("#timePickerPop")) return;
  if (e.target.closest(".wp-time-btn")) return;
  closeTimePicker();
});
window.addEventListener("scroll", () => {
  if (_activeTimeBtn) closeTimePicker();
}, true);

/* ── Cell input / autosave ──────────────────────────── */
window.onCellInput = (rowId, key, value, isNumber) => {
  const row = state.rows.find((r) => r.id === rowId);
  if (!row) return;
  if (!row.data) row.data = {};
  row.data[key] = isNumber ? (value === "" ? null : parseFloat(value)) : value;
  scheduleRowSave(rowId, { data: row.data });
  // update total live (if minutes col)
  const dayRows = state.rows.filter((r) => (r.event_day || 1) === state.activeDay);
  renderTotal(dayRows);
};

function scheduleRowSave(rowId, patch) {
  // merge pending patch
  const existing = state.rowDebouncers.get(rowId);
  if (existing) {
    clearTimeout(existing.timer);
    existing.patch = { ...existing.patch, ...patch };
  }
  const ctx = state.rowDebouncers.get(rowId) || { patch: { ...patch } };
  ctx.patch = { ...(ctx.patch || {}), ...patch };
  ctx.timer = setTimeout(async () => {
    const p = ctx.patch;
    state.rowDebouncers.delete(rowId);
    try {
      setSaveState("saving");
      state.savingOps++;
      await updateRow(rowId, p);
    } catch (e) {
      console.error(e);
      toast("บันทึกแถวไม่สำเร็จ: " + e.message, "error");
      setSaveState("error");
    } finally {
      state.savingOps--;
      if (state.savingOps === 0) setSaveState("saved");
    }
  }, 600);
  state.rowDebouncers.set(rowId, ctx);
}

function schedulePlanSave() {
  clearTimeout(state.planDebouncer);
  state.planDebouncer = setTimeout(async () => {
    const p = state.plan;
    p.plan_name = $("planNameInput").value.trim();
    p.dept_id = $("planDeptInput").value ? parseInt($("planDeptInput").value) : null;
    p.year = parseInt($("planYearInput").value, 10) || p.year;
    p.event_start = $("planStartInput").value || null;
    p.event_end = $("planEndInput").value || null;
    p.location = $("planLocationInput").value.trim() || null;

    try {
      setSaveState("saving");
      state.savingOps++;
      await updatePlan(p.id, {
        plan_name: p.plan_name,
        dept_id: p.dept_id,
        year: p.year,
        event_start: p.event_start,
        event_end: p.event_end,
        location: p.location,
        columns: p.columns,
      });
      $("heroTitle").textContent = p.plan_name || "ไม่มีชื่อ";
      renderDayTabs();
    } catch (e) {
      console.error(e);
      toast("บันทึกแผนไม่สำเร็จ: " + e.message, "error");
      setSaveState("error");
    } finally {
      state.savingOps--;
      if (state.savingOps === 0) setSaveState("saved");
    }
  }, 600);
}

function setSaveState(st) {
  const el = $("saveState");
  el.className = `wp-save-state ${st}`;
  el.textContent =
    st === "saving" ? "💾 กำลังบันทึก…" :
    st === "saved"  ? "✓ บันทึกแล้ว" :
    st === "error"  ? "✗ บันทึกผิดพลาด" : "พร้อม";
}

/* ── Rows CRUD ────────────────────────────────────── */
window.addRow = async () => {
  try {
    const dayRows = state.rows.filter((r) => (r.event_day || 1) === state.activeDay);
    const nextOrder = dayRows.length
      ? Math.max(...dayRows.map((r) => r.row_order || 0)) + 1
      : 1;
    const row = await createRow({
      plan_id: PLAN_ID,
      event_day: state.activeDay,
      row_order: nextOrder,
      data: {},
    });
    state.rows.push(row);
    renderTable();
  } catch (e) {
    toast("เพิ่มแถวไม่สำเร็จ: " + e.message, "error");
  }
};

window.removeRow = (id) => {
  window.DeleteModal.open("ลบแถวนี้ออกจากตาราง ?", async () => {
    try {
      await deleteRow(id);
      state.rows = state.rows.filter((r) => r.id !== id);
      renderTable();
    } catch (e) {
      toast("ลบไม่สำเร็จ: " + e.message, "error");
    }
  });
};

/* ── Row reorder (drag + event delegation) ───────── */
let _dragRowId = null;
let _dragDropBelow = false; // drop ด้านล่างของ target?

function clearDragClasses() {
  document.querySelectorAll(".wp-row-dragging, .wp-row-drop-top, .wp-row-drop-bot")
    .forEach((el) => el.classList.remove("wp-row-dragging", "wp-row-drop-top", "wp-row-drop-bot"));
}

function setupRowDragDelegation() {
  const tbody = $("wpTbody");
  if (!tbody || tbody._dragBound) return;
  tbody._dragBound = true;

  tbody.addEventListener("dragstart", (e) => {
    const td = e.target.closest("td.wp-row-no");
    if (!td) { e.preventDefault(); return; }
    const tr = td.closest("tr[data-row-id]");
    if (!tr) return;
    _dragRowId = parseInt(tr.dataset.rowId, 10);
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", String(_dragRowId)); } catch (_) {}
    tr.classList.add("wp-row-dragging");
  });

  tbody.addEventListener("dragover", (e) => {
    if (!_dragRowId) return;
    const tr = e.target.closest("tr[data-row-id]");
    if (!tr) return;
    const targetId = parseInt(tr.dataset.rowId, 10);
    if (targetId === _dragRowId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    // clear previous highlights
    tbody.querySelectorAll(".wp-row-drop-top, .wp-row-drop-bot")
      .forEach((el) => el.classList.remove("wp-row-drop-top", "wp-row-drop-bot"));
    // decide top/bot
    const rect = tr.getBoundingClientRect();
    const below = (e.clientY - rect.top) > rect.height / 2;
    _dragDropBelow = below;
    tr.classList.add(below ? "wp-row-drop-bot" : "wp-row-drop-top");
  });

  tbody.addEventListener("dragleave", (e) => {
    // only remove if leaving to outside tbody
    if (!tbody.contains(e.relatedTarget)) {
      tbody.querySelectorAll(".wp-row-drop-top, .wp-row-drop-bot")
        .forEach((el) => el.classList.remove("wp-row-drop-top", "wp-row-drop-bot"));
    }
  });

  tbody.addEventListener("drop", (e) => {
    e.preventDefault();
    const tr = e.target.closest("tr[data-row-id]");
    const draggedId = _dragRowId;
    const below = _dragDropBelow;
    clearDragClasses();
    _dragRowId = null;
    if (!tr || !draggedId) return;
    const targetId = parseInt(tr.dataset.rowId, 10);
    if (targetId === draggedId) return;
    doReorder(draggedId, targetId, below);
  });

  tbody.addEventListener("dragend", () => {
    clearDragClasses();
    _dragRowId = null;
  });
}

async function doReorder(draggedId, targetId, below) {
  // 1) Move DOM ทันที (ไม่ re-render ทั้งตาราง) — visual feedback instant
  const tbody = $("wpTbody");
  const draggedTr = tbody?.querySelector(`tr[data-row-id="${draggedId}"]`);
  const targetTr = tbody?.querySelector(`tr[data-row-id="${targetId}"]`);
  if (!draggedTr || !targetTr) return;
  if (below) targetTr.after(draggedTr);
  else targetTr.before(draggedTr);

  // 2) Update row numbers in DOM + state (ยังไม่ save server)
  const dayRows = state.rows
    .filter((r) => (r.event_day || 1) === state.activeDay)
    .sort((a, b) => (a.row_order || 0) - (b.row_order || 0));
  const fromIdx = dayRows.findIndex((r) => r.id === draggedId);
  let toIdx = dayRows.findIndex((r) => r.id === targetId);
  if (fromIdx < 0 || toIdx < 0) return;
  const [moved] = dayRows.splice(fromIdx, 1);
  if (fromIdx < toIdx) toIdx -= 1;
  const insertAt = below ? toIdx + 1 : toIdx;
  dayRows.splice(insertAt, 0, moved);

  const patches = [];
  dayRows.forEach((r, i) => {
    const newOrder = i + 1;
    if (r.row_order !== newOrder) {
      r.row_order = newOrder;
      patches.push(r);
    }
    // update visible # number instantly
    const numEl = tbody.querySelector(`tr[data-row-id="${r.id}"] .wp-row-no-num`);
    if (numEl) numEl.textContent = newOrder;
  });

  // 3) Save only rows ที่ order เปลี่ยน (parallel)
  if (!patches.length) return;
  try {
    setSaveState("saving");
    state.savingOps++;
    await Promise.all(patches.map((r) => updateRow(r.id, { row_order: r.row_order })));
  } catch (e) {
    toast("บันทึกลำดับไม่สำเร็จ: " + e.message, "error");
  } finally {
    state.savingOps--;
    if (state.savingOps === 0) setSaveState("saved");
  }
}

/* ── Columns ──────────────────────────────────────── */
window.onColRename = (idx, val) => {
  const cols = state.plan.columns || [];
  if (!cols[idx]) return;
  cols[idx].label = val;
  schedulePlanSave();
};

window.addColumn = () => {
  // reset modal
  $("colNameInput").value = "";
  setColType("text");
  $("colModal").classList.add("open");
  setTimeout(() => $("colNameInput").focus(), 50);
};

window.closeColModal = () => $("colModal").classList.remove("open");

window.submitColModal = () => {
  const label = $("colNameInput").value.trim();
  if (!label) {
    $("colNameInput").focus();
    toast("กรอกชื่อคอลัมน์", "error");
    return;
  }
  const type = document.querySelector("#colTypePicker .wp-type-btn.active")?.dataset.type || "text";
  const key = "c" + Date.now().toString(36);
  state.plan.columns = [...(state.plan.columns || []), { key, label, type, width: 150 }];
  window.closeColModal();
  schedulePlanSave();
  renderTable();
};

function setColType(type) {
  document.querySelectorAll("#colTypePicker .wp-type-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.type === type);
  });
}

// hook up type picker + enter key (after DOMContentLoaded)
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("#colTypePicker .wp-type-btn").forEach((b) => {
    b.addEventListener("click", () => setColType(b.dataset.type));
  });
  $("colNameInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") window.submitColModal();
    if (e.key === "Escape") window.closeColModal();
  });
});

window.openColMenu = (ev, idx) => {
  ev.stopPropagation();
  const pop = $("colMenuPop");
  const cols = state.plan.columns || [];
  const c = cols[idx];
  if (!c) return;
  pop.innerHTML = `
    <div class="wp-colmenu-item" onclick="window.changeColType(${idx},'text')">📝 Text</div>
    <div class="wp-colmenu-item" onclick="window.changeColType(${idx},'number')">🔢 Number</div>
    <div class="wp-colmenu-item" onclick="window.changeColType(${idx},'date')">📅 Date</div>
    <div class="wp-colmenu-item" onclick="window.changeColType(${idx},'time')">⏰ Time</div>
    <div class="wp-colmenu-sep"></div>
    <div class="wp-colmenu-item" onclick="window.moveCol(${idx},-1)">◀ เลื่อนซ้าย</div>
    <div class="wp-colmenu-item" onclick="window.moveCol(${idx},1)">▶ เลื่อนขวา</div>
    <div class="wp-colmenu-sep"></div>
    <div class="wp-colmenu-item danger" onclick="window.removeCol(${idx})">🗑 ลบคอลัมน์</div>
  `;
  const rect = ev.target.getBoundingClientRect();
  pop.style.top = (rect.bottom + window.scrollY + 4) + "px";
  pop.style.left = (rect.left + window.scrollX) + "px";
  pop.style.display = "block";
};
window.changeColType = (idx, type) => {
  state.plan.columns[idx].type = type;
  $("colMenuPop").style.display = "none";
  schedulePlanSave();
  renderTable();
};
window.moveCol = (idx, dir) => {
  const cols = state.plan.columns;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= cols.length) return;
  [cols[idx], cols[newIdx]] = [cols[newIdx], cols[idx]];
  $("colMenuPop").style.display = "none";
  schedulePlanSave();
  renderTable();
};
window.removeCol = (idx) => {
  const cols = state.plan.columns;
  const c = cols[idx];
  if (!c) return;
  $("colMenuPop").style.display = "none";
  window.DeleteModal.open(
    `ลบคอลัมน์ "${c.label}" ? ข้อมูลในคอลัมน์นี้ทุกแถวจะหายไป`,
    () => {
      cols.splice(idx, 1);
      state.rows.forEach((r) => {
        if (r.data && c.key in r.data) {
          delete r.data[c.key];
          scheduleRowSave(r.id, { data: r.data });
        }
      });
      schedulePlanSave();
      renderTable();
    }
  );
};

/* ── Assignee picker ───────────────────────────────── */
window.openAssigneePicker = (ev, rowId) => {
  ev.stopPropagation();
  const row = state.rows.find((r) => r.id === rowId);
  if (!row) return;
  const pop = $("assigneePop");
  pop.innerHTML = `
    <input type="text" id="assigneeSearch" placeholder="ค้นหาชื่อ…" oninput="window.filterAssignees()" />
    <div class="wp-pop-section">ผู้รับผิดชอบ (1 คน)</div>
    <div id="assigneeOwnerList"></div>
    <div class="wp-pop-section">ผู้ช่วย (หลายคน)</div>
    <div id="assigneeHelperList"></div>
  `;
  pop.dataset.rowId = rowId;
  const rect = ev.currentTarget.getBoundingClientRect();
  pop.style.top = (rect.bottom + window.scrollY + 4) + "px";
  pop.style.left = (rect.left + window.scrollX) + "px";
  pop.style.display = "block";
  renderAssigneeLists();
  setTimeout(() => $("assigneeSearch").focus(), 30);
};

function renderAssigneeLists() {
  const pop = $("assigneePop");
  const rowId = parseInt(pop.dataset.rowId, 10);
  const row = state.rows.find((r) => r.id === rowId);
  if (!row) return;

  const q = ($("assigneeSearch")?.value || "").trim().toLowerCase();
  const filtered = state.users.filter((u) => {
    if (!q) return true;
    const s = `${u.full_name || ""} ${u.username || ""} ${u.role || ""}`.toLowerCase();
    return s.includes(q);
  });

  const vacantOwner = `<div class="wp-pop-item wp-pop-vacant ${!row.owner_user_id ? "selected" : ""}" onclick="window.pickOwner(null)">
    <span>⚪ ว่าง — ยังไม่กำหนด</span>
  </div>`;
  const ownerHtml = filtered
    .slice(0, 20)
    .map((u) => {
      const selected = row.owner_user_id === u.user_id;
      return `<div class="wp-pop-item ${selected ? "selected" : ""}" onclick="window.pickOwner(${u.user_id})">
        <span>👤 ${escapeHtml(u.full_name || u.username)}</span>
        <span class="role">${escapeHtml(u.role || "")}</span>
      </div>`;
    })
    .join("");
  $("assigneeOwnerList").innerHTML =
    vacantOwner + (ownerHtml || `<div style="padding:8px;color:var(--text3);font-size:12px">ไม่พบ</div>`);

  const hasHelpers = (row.helper_user_ids || []).length > 0;
  const vacantHelper = `<div class="wp-pop-item wp-pop-vacant ${!hasHelpers ? "selected" : ""}" onclick="window.clearHelpers()">
    <span>⚪ ว่าง — ${hasHelpers ? "ล้างผู้ช่วยทั้งหมด" : "ยังไม่กำหนด"}</span>
  </div>`;
  const helperHtml = filtered
    .slice(0, 20)
    .map((u) => {
      const selected = (row.helper_user_ids || []).includes(u.user_id);
      return `<div class="wp-pop-item ${selected ? "selected" : ""}" onclick="window.toggleHelper(${u.user_id})">
        <span>+ ${escapeHtml(u.full_name || u.username)}</span>
        <span class="act">${selected ? "✓" : ""}</span>
      </div>`;
    })
    .join("");
  $("assigneeHelperList").innerHTML =
    vacantHelper + (helperHtml || `<div style="padding:8px;color:var(--text3);font-size:12px">ไม่พบ</div>`);
}
window.filterAssignees = renderAssigneeLists;

window.pickOwner = (uid) => {
  const pop = $("assigneePop");
  const rowId = parseInt(pop.dataset.rowId, 10);
  const row = state.rows.find((r) => r.id === rowId);
  if (!row) return;
  // null = ว่าง, ตัวเลข = user_id (คลิกซ้ำคนเดิม → ว่าง)
  row.owner_user_id = (uid === null || row.owner_user_id === uid) ? null : uid;
  scheduleRowSave(rowId, { owner_user_id: row.owner_user_id });
  renderTable();
  renderAssigneeLists();
};
window.toggleHelper = (uid) => {
  const pop = $("assigneePop");
  const rowId = parseInt(pop.dataset.rowId, 10);
  const row = state.rows.find((r) => r.id === rowId);
  if (!row) return;
  const list = new Set(row.helper_user_ids || []);
  if (list.has(uid)) list.delete(uid);
  else list.add(uid);
  row.helper_user_ids = Array.from(list);
  scheduleRowSave(rowId, { helper_user_ids: row.helper_user_ids });
  renderTable();
  renderAssigneeLists();
};

window.clearHelpers = () => {
  const pop = $("assigneePop");
  const rowId = parseInt(pop.dataset.rowId, 10);
  const row = state.rows.find((r) => r.id === rowId);
  if (!row) return;
  row.helper_user_ids = [];
  scheduleRowSave(rowId, { helper_user_ids: [] });
  renderTable();
  renderAssigneeLists();
};

/* ── Export CSV ───────────────────────────────────── */
window.exportCSV = () => {
  if (!state.plan) return;
  const cols = state.plan.columns || [];
  const header = ["ลำดับ", "วัน"]
    .concat(cols.map((c) => c.label))
    .concat(["ผู้รับผิดชอบ", "ผู้ช่วย"]);

  const userName = (uid) => {
    const u = state.users.find((x) => x.user_id === uid);
    return u ? (u.full_name || u.username) : "";
  };

  const sortedRows = [...state.rows].sort((a, b) => {
    if ((a.event_day || 1) !== (b.event_day || 1)) return (a.event_day || 1) - (b.event_day || 1);
    return (a.row_order || 0) - (b.row_order || 0);
  });

  const rows = sortedRows.map((r, idx) => {
    const cells = [
      String(idx + 1),
      `วันที่ ${r.event_day || 1}`,
    ];
    cols.forEach((c) => {
      cells.push(String((r.data || {})[c.key] ?? ""));
    });
    cells.push(userName(r.owner_user_id));
    cells.push((r.helper_user_ids || []).map(userName).filter(Boolean).join(", "));
    return cells;
  });

  // Meta (2 แถวบนสุด)
  const p = state.plan;
  const metaLines = [
    [`แผนงาน: ${p.plan_name || ""}`],
    [`ปี: ${p.year || ""} | วันที่: ${p.event_start || ""} ${p.event_end && p.event_end !== p.event_start ? " – " + p.event_end : ""} | สถานที่: ${p.location || ""}`],
    [], // blank line
  ];

  const csvRows = [...metaLines, header, ...rows];
  const csv = csvRows.map((r) => r.map(csvEscape).join(",")).join("\r\n");

  // Add BOM for Excel Thai UTF-8 support
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sanitizeFilename(p.plan_name || "work-plan")}_${p.year || ""}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  toast("Export CSV สำเร็จ", "success");
};

function csvEscape(v) {
  const s = String(v ?? "");
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function sanitizeFilename(s) {
  return String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "export";
}

/* ── Print / PDF ──────────────────────────────────── */
window.printPlan = () => {
  if (!state.plan) return;
  const pop = $("timePickerPop");
  if (pop) pop.style.display = "none";

  // Build clean print header (replaces hero + edit-header in print view)
  injectPrintHeader();

  window.print();

  // Remove after printing
  setTimeout(() => {
    document.querySelector(".wp-print-header")?.remove();
  }, 800);
};

function injectPrintHeader() {
  const old = document.querySelector(".wp-print-header");
  if (old) old.remove();

  const p = state.plan;
  const dept = state.departments.find((d) => d.id === p.dept_id);

  const fmtDate = (s) => {
    if (!s) return "";
    const [y, m, d] = s.split("-");
    return `${d}/${m}/${y}`;
  };
  const dateStr = p.event_start
    ? (p.event_end && p.event_end !== p.event_start
        ? `${fmtDate(p.event_start)} – ${fmtDate(p.event_end)}`
        : fmtDate(p.event_start))
    : "—";

  const scopeLabel = { event: "Event", cs: "Customer Service", trip: "Trip" }[SCOPE] || SCOPE;

  const header = document.createElement("div");
  header.className = "wp-print-header";
  header.innerHTML = `
    <h1 class="wp-print-title">${escapeHtml(p.plan_name || "แผนงาน")}</h1>
    <div class="wp-print-meta">
      <div><span class="lbl">ประเภท:</span> <strong>${escapeHtml(scopeLabel)}</strong></div>
      ${dept ? `<div><span class="lbl">แผนก:</span> <strong>${escapeHtml(dept.name)}</strong></div>` : ""}
      <div><span class="lbl">ปี:</span> <strong>${escapeHtml(p.year || "")}</strong></div>
      <div><span class="lbl">วันที่:</span> <strong>${escapeHtml(dateStr)}</strong></div>
      ${p.location ? `<div><span class="lbl">สถานที่:</span> <strong>${escapeHtml(p.location)}</strong></div>` : ""}
    </div>
  `;

  const page = document.querySelector(".page");
  if (page) page.insertBefore(header, page.firstChild);
}

/* ── Delete plan ──────────────────────────────────── */
window.deletePlanFromEdit = () => {
  window.DeleteModal.open(
    `ลบแผน "${state.plan.plan_name}" ? แถวทั้งหมดจะถูกลบด้วย (ไม่สามารถย้อนกลับได้)`,
    async () => {
      try {
        await deletePlan(PLAN_ID);
        window.location.href = `./work-plan-list.html?scope=${SCOPE}`;
      } catch (e) {
        toast("ลบไม่สำเร็จ: " + e.message, "error");
      }
    }
  );
};

/* ── Central Esc handler (topmost first) ──────── */
function onGlobalEsc(e) {
  if (e.key !== "Escape") return;

  // 1) Time picker popup
  const tp = $("timePickerPop");
  if (tp && tp.style.display !== "none") {
    closeTimePicker();
    e.stopPropagation();
    return;
  }

  // 2) Assignee picker
  const ap = $("assigneePop");
  if (ap && ap.style.display !== "none") {
    ap.style.display = "none";
    e.stopPropagation();
    return;
  }

  // 3) Column menu
  const cm = $("colMenuPop");
  if (cm && cm.style.display !== "none") {
    cm.style.display = "none";
    e.stopPropagation();
    return;
  }

  // 4) Add-column modal
  if ($("colModal")?.classList.contains("open")) {
    window.closeColModal();
    e.stopPropagation();
    return;
  }
}

/* ── util ─────────────────────────────────────────── */
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
function escapeAttr(s) {
  return String(s ?? "").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
