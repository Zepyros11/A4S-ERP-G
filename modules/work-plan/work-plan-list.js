/* ============================================================
   work-plan-list.js — หน้า list แผนงาน
   URL: work-plan-list.html?scope=event|cs|trip
============================================================ */

import {
  fetchDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  fetchPlans,
  createPlan,
  updatePlan,
  deletePlan,
  countRowsByPlan,
  fetchPlaces,
} from "./work-plan-api.js";

/* ── Helpers ─────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);
const toast = (msg, type = "info") => {
  const t = $("toast");
  if (!t) return;
  t.textContent = msg;
  t.className = `toast toast-${type} show`;
  setTimeout(() => (t.className = "toast"), 2500);
};
const qs = new URLSearchParams(location.search);
const SCOPE = ["event", "cs", "trip"].includes(qs.get("scope"))
  ? qs.get("scope")
  : "event";
const SCOPE_META = {
  event: { title: "📋 แผนงาน — Event", sub: "วางแผนกิจกรรม (Event) เป็นตาราง" },
  cs:    { title: "📋 แผนงาน — CS",    sub: "วางแผนงานฝั่ง Customer Service" },
  trip:  { title: "📋 แผนงาน — Trip",  sub: "วางแผนทริป/ทัวร์" },
};

/* ── State ───────────────────────────────────────────── */
const state = {
  departments: [],
  plans: [],
  places: [],
  rowCounts: {},
  editingPlanId: null,
  editingDeptId: null,
};

/* ── Init ───────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", init);

async function init() {
  $("heroTitle").textContent = SCOPE_META[SCOPE].title;
  $("heroSub").textContent = SCOPE_META[SCOPE].sub;
  $("wpHero").className = `wp-hero scope-${SCOPE}`;

  // init year select
  const yearSel = $("filterYear");
  const thisYear = new Date().getFullYear() + 543; // พ.ศ.
  yearSel.innerHTML = `<option value="">-- ทุกปี --</option>`;
  for (let y = thisYear + 1; y >= thisYear - 4; y--) {
    yearSel.innerHTML += `<option value="${y}" ${y === thisYear ? "selected" : ""}>${y}</option>`;
  }
  $("planYearInput").value = thisYear;

  await Promise.all([loadDepartments(), loadPlaces(), loadPlans()]);
}

/* ── Load places for location autocomplete ─────────── */
async function loadPlaces() {
  try {
    state.places = await fetchPlaces();
  } catch (e) {
    console.warn("fetchPlaces:", e.message);
  }
}

/* ── Place combobox (custom autocomplete) ─────────── */
const PLACE_ICON = {
  HOTEL: "🏨",
  MEETING_ROOM: "🏢",
  EVENT_SPACE: "🎪",
  RESTAURANT: "🍽️",
  OUTDOOR: "🌳",
  OTHER: "📍",
};
const PLACE_LABEL = {
  HOTEL: "โรงแรม",
  MEETING_ROOM: "ห้องประชุม",
  EVENT_SPACE: "Event Space",
  RESTAURANT: "ร้านอาหาร",
  OUTDOOR: "กลางแจ้ง",
  OTHER: "อื่น ๆ",
};

window.onPlaceFocus = () => renderPlacePop($("planLocationInput").value);
window.onPlaceInput = () => renderPlacePop($("planLocationInput").value);

function renderPlacePop(q) {
  const pop = $("placePop");
  if (!pop) return;
  const query = (q || "").trim().toLowerCase();
  const list = state.places || [];
  const filtered = query
    ? list.filter(
        (p) =>
          (p.place_name || "").toLowerCase().includes(query) ||
          (p.address || "").toLowerCase().includes(query)
      )
    : list;

  if (!list.length) {
    pop.innerHTML = `<div class="wp-combo-empty">
      ยังไม่มีสถานที่ในระบบ<br/>
      <a href="../event/events-place-list.html" target="_blank" rel="noopener">＋ เพิ่มสถานที่ใหม่</a>
    </div>`;
    pop.style.display = "block";
    return;
  }

  let html = "";
  if (filtered.length) {
    html += `<div class="wp-combo-section">${filtered.length} รายการ</div>`;
    html += filtered
      .slice(0, 30)
      .map((p) => {
        const t = p.place_type || "OTHER";
        const icon = PLACE_ICON[t] || "📍";
        const typeLabel = PLACE_LABEL[t] || t;
        return `<div class="wp-combo-item" onclick="window.pickPlace('${escapeAttr(p.place_name)}')">
          <div class="wp-combo-icon t-${t}">${icon}</div>
          <div class="wp-combo-name">${escapeHtml(p.place_name)}</div>
          <div class="wp-combo-type">${escapeHtml(typeLabel)}</div>
        </div>`;
      })
      .join("");
  } else {
    html += `<div class="wp-combo-empty">
      ไม่พบ "${escapeHtml(query)}"<br/>
      <span style="font-size:11.5px">กด Enter เพื่อใช้ชื่อนี้ หรือ <a href="../event/events-place-list.html" target="_blank" rel="noopener">＋ เพิ่มใหม่</a></span>
    </div>`;
  }

  pop.innerHTML = html;
  pop.style.display = "block";
  positionPlacePop();
}

function positionPlacePop() {
  const input = $("planLocationInput");
  const pop = $("placePop");
  if (!input || !pop) return;
  const r = input.getBoundingClientRect();
  const vh = window.innerHeight;
  const spaceBelow = vh - r.bottom;
  pop.style.left = r.left + "px";
  pop.style.width = r.width + "px";
  // ถ้าไม่พอด้านล่าง → แสดงเหนือ input
  if (spaceBelow < 200 && r.top > 280) {
    pop.style.top = (r.top - pop.offsetHeight - 6) + "px";
  } else {
    pop.style.top = (r.bottom + 4) + "px";
  }
}

window.pickPlace = (name) => {
  $("planLocationInput").value = name;
  $("placePop").style.display = "none";
};

/* close combo popup on outside click */
document.addEventListener("click", (e) => {
  const pop = $("placePop");
  if (!pop || pop.style.display === "none") return;
  if (e.target.closest(".wp-combo")) return;
  pop.style.display = "none";
});
/* reposition on scroll/resize */
window.addEventListener("scroll", () => {
  const pop = $("placePop");
  if (pop && pop.style.display !== "none") positionPlacePop();
}, true);
window.addEventListener("resize", () => {
  const pop = $("placePop");
  if (pop && pop.style.display !== "none") positionPlacePop();
});
/* Enter key → close popup (allow free text) */
document.addEventListener("keydown", (e) => {
  const pop = $("placePop");
  if (!pop || pop.style.display === "none") return;
  if (e.key === "Escape" || e.key === "Enter") {
    if (e.target === $("planLocationInput")) {
      e.preventDefault();
      pop.style.display = "none";
    }
  }
});

/* ── Load departments ───────────────────────────────── */
async function loadDepartments() {
  try {
    state.departments = await fetchDepartments(SCOPE);
    renderDeptDropdowns();
    renderDeptList();
  } catch (e) {
    console.error(e);
    toast("โหลดแผนกไม่สำเร็จ: " + e.message, "error");
  }
}
function renderDeptDropdowns() {
  const opts = state.departments
    .map((d) => `<option value="${d.id}">${d.name}</option>`)
    .join("");
  $("filterDept").innerHTML = `<option value="">-- ทุกแผนก --</option>${opts}`;
  $("planDeptInput").innerHTML = `<option value="">-- ไม่ระบุ --</option>${opts}`;
}
function renderDeptList() {
  const wrap = $("deptList");
  if (!state.departments.length) {
    wrap.innerHTML = `<div style="color:var(--text3);font-size:12px;text-align:center;padding:14px">ยังไม่มีแผนก</div>`;
    return;
  }
  wrap.innerHTML = state.departments
    .map(
      (d) => `
    <div style="display:flex;gap:6px;align-items:center;padding:6px;border:1px solid var(--border);border-radius:6px">
      <span style="width:18px;height:18px;border-radius:50%;background:${d.color};flex-shrink:0"></span>
      <input data-dept-id="${d.id}" class="form-input wp-dept-name" type="text" value="${escapeHtml(d.name)}" style="flex:1;padding:4px 8px;font-size:13px" />
      <input data-dept-id="${d.id}" class="wp-dept-color" type="color" value="${d.color}" style="width:32px;height:28px;border:1px solid var(--border);border-radius:4px;cursor:pointer" />
      <button onclick="window.saveDept(${d.id})" style="padding:4px 8px;border:none;background:#059669;color:#fff;border-radius:4px;cursor:pointer;font-size:12px">💾</button>
      <button onclick="window.removeDept(${d.id})" style="padding:4px 8px;border:none;background:#ef4444;color:#fff;border-radius:4px;cursor:pointer;font-size:12px">🗑</button>
    </div>`
    )
    .join("");
}

/* ── Load plans ─────────────────────────────────────── */
async function loadPlans() {
  try {
    const deptId = $("filterDept").value || null;
    const year = $("filterYear").value || null;
    state.plans = await fetchPlans({ scope: SCOPE, year, deptId });

    const ids = state.plans.map((p) => p.id);
    state.rowCounts = await countRowsByPlan(ids);
    renderCards();
  } catch (e) {
    console.error(e);
    toast("โหลดแผนงานไม่สำเร็จ: " + e.message, "error");
  }
}

function renderCards() {
  const grid = $("wpGrid");
  const search = $("filterSearch").value.trim().toLowerCase();
  const deptMap = Object.fromEntries(state.departments.map((d) => [d.id, d]));

  const filtered = state.plans.filter((p) => {
    if (!search) return true;
    return (
      (p.plan_name || "").toLowerCase().includes(search) ||
      (p.location || "").toLowerCase().includes(search)
    );
  });

  if (!filtered.length) {
    grid.innerHTML = "";
    $("wpEmpty").style.display = "block";
    return;
  }
  $("wpEmpty").style.display = "none";

  grid.innerHTML = filtered
    .map((p) => {
      const dept = deptMap[p.dept_id];
      const deptBadge = dept
        ? `<span class="wp-card-dept" style="background:${dept.color}">${escapeHtml(dept.name)}</span>`
        : "";
      const dateStr = formatPlanDate(p.event_start, p.event_end);
      const rowCount = state.rowCounts[p.id] || 0;
      const borderColor = dept ? dept.color : "#4a90e2";
      return `
        <div class="wp-card" style="border-left-color:${borderColor}" onclick="window.openPlan(${p.id})">
          <div class="wp-card-name">${escapeHtml(p.plan_name || "ไม่มีชื่อ")}</div>
          <div class="wp-card-meta">
            ${deptBadge}
            <span>📅 ${p.year}</span>
            ${dateStr ? `<span>🗓 ${dateStr}</span>` : ""}
          </div>
          ${p.location ? `<div class="wp-card-meta">📍 ${escapeHtml(p.location)}</div>` : ""}
          <div class="wp-card-footer">
            <div class="wp-card-rows">${rowCount} แถว</div>
            <div class="wp-card-actions" onclick="event.stopPropagation()">
              <button title="แก้ข้อมูล" onclick="window.editPlanInfo(${p.id})">✏️</button>
              <button title="ลบ" onclick="window.removePlan(${p.id})">🗑</button>
            </div>
          </div>
        </div>`;
    })
    .join("");
}

function formatPlanDate(start, end) {
  if (!start) return "";
  const fmt = (s) => {
    if (!s) return "";
    const [y, m, d] = s.split("-");
    return `${d}/${m}/${y}`;
  };
  if (!end || end === start) return fmt(start);
  return `${fmt(start)} – ${fmt(end)}`;
}

/* ── Filter handler ────────────────────────────────── */
window.onFilterChange = () => {
  clearTimeout(window._wpDebounce);
  window._wpDebounce = setTimeout(loadPlans, 200);
};

/* ── Plan modal ─────────────────────────────────────── */
window.openPlanModal = () => {
  state.editingPlanId = null;
  $("planModalTitle").textContent = "สร้างแผนงานใหม่";
  $("planNameInput").value = "";
  $("planDeptInput").value = "";
  $("planYearInput").value = new Date().getFullYear() + 543;
  $("planStartInput").value = "";
  $("planEndInput").value = "";
  $("planLocationInput").value = "";
  syncDurationChips();
  $("planModal").classList.add("open");
  setTimeout(() => $("planNameInput").focus(), 50);
};
window.editPlanInfo = (id) => {
  const p = state.plans.find((x) => x.id === id);
  if (!p) return;
  state.editingPlanId = id;
  $("planModalTitle").textContent = "แก้ไขแผนงาน";
  $("planNameInput").value = p.plan_name || "";
  $("planDeptInput").value = p.dept_id || "";
  $("planYearInput").value = p.year || "";
  $("planStartInput").value = p.event_start || "";
  $("planEndInput").value = p.event_end || "";
  $("planLocationInput").value = p.location || "";
  syncDurationChips();
  $("planModal").classList.add("open");
};
window.closePlanModal = () => $("planModal").classList.remove("open");

/* ── Duration quick-pick ──────────────────────────── */
window.setDuration = (days) => {
  let start = $("planStartInput").value;
  if (!start) {
    // default วันนี้
    const t = new Date();
    start = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    $("planStartInput").value = start;
  }
  const d = new Date(start);
  d.setDate(d.getDate() + (days - 1));
  const end = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  $("planEndInput").value = end;
  syncDurationChips();
};
window.onStartDateChange = () => {
  const start = $("planStartInput").value;
  const end = $("planEndInput").value;
  // ถ้า end ว่าง หรือ end < start → set end = start (1 วัน)
  if (start && (!end || end < start)) {
    $("planEndInput").value = start;
  }
  syncDurationChips();
};
function syncDurationChips() {
  const start = $("planStartInput").value;
  const end = $("planEndInput").value;
  let activeDays = 0;
  if (start && end) {
    const ms = new Date(end) - new Date(start);
    activeDays = Math.floor(ms / 86400000) + 1;
  }
  document.querySelectorAll(".wp-chip-btn[data-days]").forEach((b) => {
    b.classList.toggle("active", parseInt(b.dataset.days) === activeDays);
  });
}

window.savePlan = async () => {
  const name = $("planNameInput").value.trim();
  const year = parseInt($("planYearInput").value, 10);
  if (!name || !year) {
    toast("กรอกชื่อและปี", "error");
    return;
  }
  const payload = {
    scope: SCOPE,
    plan_name: name,
    year,
    dept_id: $("planDeptInput").value || null,
    event_start: $("planStartInput").value || null,
    event_end: $("planEndInput").value || null,
    location: $("planLocationInput").value.trim() || null,
  };
  if (!state.editingPlanId && window.ERP_USER?.user_id) {
    payload.created_by = window.ERP_USER.user_id;
  }
  try {
    if (state.editingPlanId) {
      await updatePlan(state.editingPlanId, payload);
      toast("แก้ไขสำเร็จ", "success");
    } else {
      const row = await createPlan(payload);
      toast("สร้างแผนสำเร็จ", "success");
      window.closePlanModal();
      // เปิดหน้าแก้ทันที
      window.location.href = `./work-plan-edit.html?id=${row.id}&scope=${SCOPE}`;
      return;
    }
    window.closePlanModal();
    await loadPlans();
  } catch (e) {
    console.error(e);
    toast("บันทึกไม่สำเร็จ: " + e.message, "error");
  }
};

window.openPlan = (id) => {
  window.location.href = `./work-plan-edit.html?id=${id}&scope=${SCOPE}`;
};

window.removePlan = (id) => {
  const p = state.plans.find((x) => x.id === id);
  if (!p) return;
  window.DeleteModal.open(
    `ลบแผน "${p.plan_name}" ? แถวทั้งหมดจะถูกลบด้วย`,
    async () => {
      try {
        await deletePlan(id);
        toast("ลบแล้ว", "success");
        await loadPlans();
      } catch (e) {
        toast("ลบไม่สำเร็จ: " + e.message, "error");
      }
    }
  );
};

/* ── Department modal ─────────────────────────────── */
window.openDeptModal = () => $("deptModal").classList.add("open");
window.closeDeptModal = () => $("deptModal").classList.remove("open");

window.addDept = async () => {
  const name = $("newDeptName").value.trim();
  const color = $("newDeptColor").value;
  if (!name) {
    toast("กรอกชื่อแผนก", "error");
    return;
  }
  try {
    await createDepartment({
      scope: SCOPE,
      name,
      color,
      sort_order: state.departments.length + 1,
    });
    $("newDeptName").value = "";
    toast("เพิ่มแล้ว", "success");
    await loadDepartments();
  } catch (e) {
    toast("เพิ่มไม่สำเร็จ: " + e.message, "error");
  }
};
window.saveDept = async (id) => {
  const nameEl = document.querySelector(`.wp-dept-name[data-dept-id="${id}"]`);
  const colorEl = document.querySelector(`.wp-dept-color[data-dept-id="${id}"]`);
  try {
    await updateDepartment(id, {
      name: nameEl.value.trim(),
      color: colorEl.value,
    });
    toast("บันทึกแล้ว", "success");
    await loadDepartments();
    await loadPlans();
  } catch (e) {
    toast("บันทึกไม่สำเร็จ: " + e.message, "error");
  }
};
window.removeDept = (id) => {
  const d = state.departments.find((x) => x.id === id);
  if (!d) return;
  window.DeleteModal.open(
    `ลบแผนก "${d.name}" ? แผนงานที่ใช้แผนกนี้จะถูก unlink (ไม่ถูกลบ)`,
    async () => {
      try {
        await deleteDepartment(id);
        toast("ลบแล้ว", "success");
        await loadDepartments();
        await loadPlans();
      } catch (e) {
        toast("ลบไม่สำเร็จ: " + e.message, "error");
      }
    }
  );
};

/* ── util ─────────────────────────────────────────── */
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
function escapeAttr(s) {
  return String(s ?? "").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
