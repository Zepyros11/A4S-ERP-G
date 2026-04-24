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
  fetchEventById,
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
const EVENT_ID = qs.get("event_id") ? parseInt(qs.get("event_id"), 10) : null;
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
  linkedEvent: null, // event ที่ filter อยู่ (ถ้ามี)
};

/* ── Init ───────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", init);

async function init() {
  $("heroTitle").textContent = SCOPE_META[SCOPE].title;
  $("heroSub").textContent = SCOPE_META[SCOPE].sub;
  $("wpHero").className = `wp-hero scope-${SCOPE}`;

  // Scope-aware data-perm for static hero buttons (TRIP only)
  if (SCOPE === "trip") {
    document.querySelector('[onclick="window.openPlanModal()"]')?.setAttribute("data-perm", "trip_wp_create");
    document.querySelector('[onclick="window.openDeptModal()"]')?.setAttribute("data-perm", "trip_wp_edit");
    window.AuthZ?.applyDomPerms();
  }

  // Central Esc handler — closes topmost overlay/modal first
  document.addEventListener("keydown", onGlobalEsc);

  // init year select
  const yearSel = $("filterYear");
  const thisYear = new Date().getFullYear() + 543; // พ.ศ.
  yearSel.innerHTML = `<option value="">-- ทุกปี --</option>`;
  for (let y = thisYear + 1; y >= thisYear - 4; y--) {
    yearSel.innerHTML += `<option value="${y}" ${y === thisYear ? "selected" : ""}>${y}</option>`;
  }
  $("planYearInput").value = thisYear;

  // ถ้ามาจาก events-list (มี event_id) → auto-flow
  if (EVENT_ID) {
    await loadLinkedEvent();
    await handleEventFlow();
    return; // จบที่นี่ (redirect หรือรอ user ใน list)
  }

  await Promise.all([loadDepartments(), loadPlaces(), loadPlans()]);
}

/* ── Auto-flow เมื่อมาจาก events-list ──────────────── */
async function handleEventFlow() {
  if (!state.linkedEvent) {
    // event ไม่เจอ — กลับไปหน้า events
    toast("ไม่พบ event นี้", "error");
    setTimeout(() => (window.location.href = "../event/events-list.html"), 1500);
    return;
  }
  showLoading(true);
  try {
    let plans;
    try {
      plans = await fetchPlans({ scope: SCOPE, eventId: EVENT_ID });
    } catch (err) {
      if (/event_id/.test(err.message || "")) {
        showLoading(false);
        toast("ยังไม่ได้รัน migration — กรุณา run sql/026_work_plans_event_link.sql", "error");
        console.error("Migration 026 not applied:", err);
        return;
      }
      throw err;
    }
    if (plans.length === 1) {
      // มีแผนเดียว → เปิดหน้า edit เลย
      window.location.href = `./work-plan-edit.html?id=${plans[0].id}&scope=${SCOPE}`;
      return;
    }
    if (plans.length > 1) {
      // หลายแผน → โชว์ list ให้เลือก
      state.plans = plans;
      state.rowCounts = {};
      plans.forEach((p) => {
        state.rowCounts[p.id] = p.work_plan_rows?.[0]?.count || 0;
      });
      await loadDepartments();
      renderCards();
      showLoading(false);
      return;
    }
    // ไม่มีแผน → สร้างใหม่อัตโนมัติ แล้วเด้งเข้าหน้าแก้
    await autoCreatePlanForEvent();
  } catch (e) {
    console.error(e);
    toast("ไม่สามารถดึงข้อมูลแผนได้: " + e.message, "error");
    showLoading(false);
  }
}

async function autoCreatePlanForEvent() {
  const ev = state.linkedEvent;
  // รองรับ column name หลายแบบ (ขึ้นกับ schema events ที่มีอยู่)
  const startDate = ev.event_date || ev.start_date || null;
  const endDate = ev.event_end_date || ev.end_date || ev.event_date_end || startDate;
  // ใช้เฉพาะ event_name เป็นชื่อแผน (ไม่ต้องใส่ event_code/SKU prefix)
  const planName = ev.event_name;
  const year = startDate
    ? new Date(startDate).getFullYear() + 543
    : new Date().getFullYear() + 543;
  const payload = {
    scope: SCOPE,
    event_id: EVENT_ID,
    plan_name: planName,
    year,
    event_start: startDate,
    event_end: endDate,
  };
  // default แผนก = BRE สำหรับหน้า Event (ถ้ามีแผนกชื่อ BRE ในระบบ)
  if (SCOPE === "event") {
    if (!state.departments.length) await loadDepartments();
    const bre = findDeptByName("BRE");
    if (bre) payload.dept_id = bre.id;
  }
  if (window.ERP_USER?.user_id) payload.created_by = window.ERP_USER.user_id;
  try {
    const row = await createPlan(payload);
    toast("สร้างแผนงานให้อัตโนมัติ", "success");
    window.location.href = `./work-plan-edit.html?id=${row.id}&scope=${SCOPE}`;
  } catch (e) {
    toast("สร้างแผนไม่สำเร็จ: " + e.message, "error");
    showLoading(false);
  }
}

async function loadLinkedEvent() {
  try {
    state.linkedEvent = await fetchEventById(EVENT_ID);
    if (!state.linkedEvent) {
      console.warn(`Event ${EVENT_ID} not found (no row returned)`);
    } else {
      renderEventBanner();
    }
  } catch (e) {
    console.error("loadLinkedEvent error:", e);
    toast("โหลดข้อมูล event ไม่สำเร็จ: " + e.message, "error");
  }
}

function renderEventBanner() {
  const ev = state.linkedEvent;
  if (!ev) return;
  // inject banner ใต้ hero
  const existing = document.querySelector(".wp-event-banner");
  if (existing) existing.remove();
  const banner = document.createElement("div");
  banner.className = "wp-event-banner";
  banner.innerHTML = `
    <div class="wp-event-banner-icon">🎯</div>
    <div class="wp-event-banner-body">
      <div class="wp-event-banner-lbl">แผนงานของ Event</div>
      <div class="wp-event-banner-name">${escapeHtml(ev.event_name)}${ev.event_code ? ` <span style="opacity:.6;font-size:12px">(${escapeHtml(ev.event_code)})</span>` : ""}</div>
    </div>
    <a href="./events-list.html" style="padding:6px 12px;background:#fff;color:#1e40af;border-radius:16px;font-weight:600;font-size:12px;text-decoration:none">← กลับ Events</a>
  `;
  banner.querySelector("a").setAttribute("href", "../event/events-list.html");
  const filter = document.querySelector(".wp-filter");
  filter.parentNode.insertBefore(banner, filter);
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
/* Enter key on location input → close popup (allow free text) */
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const pop = $("placePop");
  if (!pop || pop.style.display === "none") return;
  if (e.target === $("planLocationInput")) {
    e.preventDefault();
    pop.style.display = "none";
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
  showLoading(true);
  try {
    const deptId = $("filterDept").value || null;
    const year = $("filterYear").value || null;
    state.plans = await fetchPlans({ scope: SCOPE, year, deptId, eventId: EVENT_ID });

    // Row count ถูก embed มาใน response แล้ว (work_plan_rows: [{count}])
    state.rowCounts = {};
    state.plans.forEach((p) => {
      const c = p.work_plan_rows?.[0]?.count || 0;
      state.rowCounts[p.id] = c;
    });
    renderCards();
  } catch (e) {
    console.error(e);
    toast("โหลดแผนงานไม่สำเร็จ: " + e.message, "error");
  } finally {
    showLoading(false);
  }
}

function showLoading(on) {
  $("loadingOverlay")?.classList.toggle("show", !!on);
}

function renderCards() {
  const body = $("wpListBody");
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
    body.innerHTML = "";
    document.querySelector(".wp-list-wrap").style.display = "none";
    $("wpEmpty").style.display = "block";
    return;
  }
  document.querySelector(".wp-list-wrap").style.display = "block";
  $("wpEmpty").style.display = "none";

  const editPerm   = SCOPE === "trip" ? ` data-perm="trip_wp_edit"`   : "";
  const deletePerm = SCOPE === "trip" ? ` data-perm="trip_wp_delete"` : "";

  body.innerHTML = filtered
    .map((p, idx) => {
      const dept = deptMap[p.dept_id];
      const deptBadge = dept
        ? `<span class="wp-dept-pill" style="background:${dept.color}">${escapeHtml(dept.name)}</span>`
        : `<span style="color:var(--text3);font-size:12px">—</span>`;
      const dateStr = formatPlanDate(p.event_start, p.event_end);
      const rowCount = state.rowCounts[p.id] || 0;
      return `
        <tr class="wp-list-row" onclick="window.openPlan(${p.id})">
          <td class="wp-list-no">${idx + 1}</td>
          <td class="wp-list-name">${escapeHtml(p.plan_name || "ไม่มีชื่อ")}</td>
          <td>${deptBadge}</td>
          <td style="text-align:center">${escapeHtml(p.year || "")}</td>
          <td>${dateStr ? `<span class="wp-list-date">${dateStr}</span>` : `<span style="color:var(--text3)">—</span>`}</td>
          <td>${p.location ? `<span class="wp-list-loc">📍 ${escapeHtml(p.location)}</span>` : `<span style="color:var(--text3)">—</span>`}</td>
          <td style="text-align:center"><span class="wp-list-count">${rowCount}</span></td>
          <td class="wp-list-actions" onclick="event.stopPropagation()">
            <button title="แก้ข้อมูล" onclick="window.editPlanInfo(${p.id})"${editPerm}>✏️</button>
            <button title="ลบ" onclick="window.removePlan(${p.id})"${deletePerm}>🗑</button>
          </td>
        </tr>`;
    })
    .join("");

  if (SCOPE === "trip") window.AuthZ?.applyDomPerms(body);
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
  // default แผนก = BRE สำหรับหน้า Event
  let defaultDeptId = "";
  if (SCOPE === "event") {
    const bre = findDeptByName("BRE");
    if (bre) defaultDeptId = String(bre.id);
  }
  $("planDeptInput").value = defaultDeptId;
  $("planYearInput").value = new Date().getFullYear() + 543;
  $("planStartInput").value = "";
  $("planEndInput").value = "";
  $("planLocationInput").value = "";
  syncDurationChips();
  renderScopeBadge();
  $("planModal").classList.add("open");
  setTimeout(() => $("planNameInput").focus(), 50);
};

function renderScopeBadge() {
  const badge = $("planScopeBadge");
  if (!badge) return;
  const meta = {
    event: { icon: "🗓️", label: "Event", cls: "scope-event" },
    cs:    { icon: "🎁", label: "CS", cls: "scope-cs" },
    trip:  { icon: "✈️", label: "Trip", cls: "scope-trip" },
  }[SCOPE];
  badge.className = `wp-scope-badge ${meta.cls}`;
  badge.innerHTML = `
    <span class="wp-scope-badge-icon">${meta.icon}</span>
    <div class="wp-scope-badge-body">
      <div class="wp-scope-badge-label">ประเภท</div>
      <div class="wp-scope-badge-value">${meta.label}</div>
    </div>
    <span class="wp-scope-badge-hint">จาก sidebar — เปลี่ยนได้จากเมนู</span>
  `;
}
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
  renderScopeBadge();
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
  if (!state.editingPlanId) {
    // ถ้ามาจาก events-list → link กับ event_id
    if (EVENT_ID) payload.event_id = EVENT_ID;
    if (window.ERP_USER?.user_id) payload.created_by = window.ERP_USER.user_id;
  }
  try {
    if (state.editingPlanId) {
      await updatePlan(state.editingPlanId, payload);
      toast("แก้ไขสำเร็จ", "success");
      window.closePlanModal();
      await loadPlans();
    } else {
      const row = await createPlan(payload);
      toast("สร้างแผนสำเร็จ", "success");
      window.closePlanModal();
      window.location.href = `./work-plan-edit.html?id=${row.id}&scope=${SCOPE}`;
    }
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

/* ── Central Esc handler (topmost first) ──────── */
function onGlobalEsc(e) {
  if (e.key !== "Escape") return;

  // 1) Place autocomplete popup (topmost)
  const placePop = $("placePop");
  if (placePop && placePop.style.display !== "none") {
    placePop.style.display = "none";
    e.stopPropagation();
    return;
  }

  // 2) Department modal
  if ($("deptModal")?.classList.contains("open")) {
    window.closeDeptModal();
    e.stopPropagation();
    return;
  }

  // 3) Plan modal
  if ($("planModal")?.classList.contains("open")) {
    window.closePlanModal();
    e.stopPropagation();
    return;
  }
}

/* ── util ─────────────────────────────────────────── */
function findDeptByName(name) {
  const key = String(name || "").trim().toUpperCase();
  return (
    state.departments.find(
      (d) => String(d.name || "").trim().toUpperCase() === key
    ) || null
  );
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
function escapeAttr(s) {
  return String(s ?? "").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
