/* ============================================================
   pax-detail.js — ℹ️ ข้อมูลผู้เดินทาง (per-trip)
   อ่าน/แก้ไขข้อมูลส่วนตัวจาก tour_seat_check
   • Floating ✏️ button: toggle edit mode (รวม) — แบบเดียวกับ check-seat
   • แต่ละ field มี debounced auto-save → Supabase
   ============================================================ */

// คอลัมน์ที่แสดง/แก้ไข ดึงจาก catalog กลาง (js/shared/pax-fields.js)
// เพิ่มคอลัมน์ใหม่ = แก้ที่ catalog ที่เดียว (FIELDS + PAX_DETAIL_ORDER)
const PAX_COLUMNS = window.PaxFields.paxColumns();
// 2 = checkbox + ลำดับ (#) ที่อยู่หน้าสุด
const PAX_COLSPAN = PAX_COLUMNS.length + 2;

const state = {
  tripId: null,
  trip: null,
  pax: [],          // tour_seat_check rows for this trip
  globalEditing: false,
};

// debounce per-row save timers
const _saveTimers = new Map();   // code → timeout id
const _saveErrorCooldown = { last: 0 };

// ── SUPABASE ───────────────────────────────────────────────
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

// ── INIT ───────────────────────────────────────────────────
async function init() {
  const { url, key } = getSB();
  if (!url || !key) {
    showToast("ยังไม่ได้เชื่อมต่อ Supabase", "error");
    return;
  }
  const qs = new URLSearchParams(location.search);
  const tid = parseInt(qs.get("trip_id"), 10);
  state.tripId = Number.isFinite(tid) ? tid : null;

  bindEvents();
  await loadAll();
}

function bindEvents() {
  document.getElementById("searchInput")?.addEventListener("input", filterTable);
  document.getElementById("filterCompleteness")?.addEventListener("change", filterTable);
}

// ── LOAD ───────────────────────────────────────────────────
async function loadAll() {
  showLoading(true);
  try {
    if (state.tripId == null) {
      showTripBannerError();
      state.pax = [];
      renderTable([]);
      updateStats();
      return;
    }

    const [trips, pax] = await Promise.all([
      sbFetch("trips", `?trip_id=eq.${state.tripId}&select=*`),
      sbFetch(
        "tour_seat_check",
        `?trip_id=eq.${state.tripId}&select=*&order=name.asc.nullslast`
      ),
    ]);

    state.trip = (trips || [])[0] || null;
    state.pax = groupParentsWithSubs(pax || []);

    updateTripBanner();
    updateStats();
    filterTable();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

function updateTripBanner() {
  const banner = document.getElementById("pdTripBanner");
  if (!state.trip) {
    showTripBannerError();
    return;
  }
  banner.style.display = "";
  document.getElementById("pdTripName").textContent = state.trip.trip_name || "—";
  const fmt = (window.DateFmt && window.DateFmt.formatDMY) || ((s) => s || "");
  const sd = fmt(state.trip.start_date);
  const ed = fmt(state.trip.end_date);
  document.getElementById("pdTripDates").textContent =
    (sd || ed) ? ` · ${sd || "—"} → ${ed || "—"}` : "";
}

/* จัดเรียงให้ sub-rows (is_sub_row=true) ติดอยู่ใต้ parent ของมัน
   — แบบเดียวกับ check-seat
   — parents sort ตามชื่อ (case-insensitive), sub-rows คงลำดับมาจาก API */
function groupParentsWithSubs(rows) {
  const parents = rows.filter((r) => !r.is_sub_row);
  const subsByParent = {};
  rows.forEach((r) => {
    if (r.is_sub_row && r.parent_code) {
      (subsByParent[r.parent_code] ||= []).push(r);
    }
  });

  // sort parents ตาม code ASC แบบ natural (numeric-aware)
  // "80952" < "81916" < "101713" < "AGRI" < "STAFF"
  parents.sort((a, b) =>
    String(a.code || "").localeCompare(String(b.code || ""), "en", { numeric: true, sensitivity: "base" })
  );

  const out = [];
  parents.forEach((p) => {
    out.push(p);
    const subs = subsByParent[p.code];
    if (subs && subs.length) {
      // sub-rows ภายในกลุ่มเรียงตาม code (เผื่อมีหลายตัว: -1, -2)
      subs.sort((a, b) => String(a.code || "").localeCompare(String(b.code || "")));
      subs.forEach((s) => out.push(s));
    }
  });

  // orphan sub-rows (parent_code ชี้ไป code ที่ไม่อยู่ใน list) → ต่อท้าย
  const seen = new Set(out.map((r) => r.code));
  rows.forEach((r) => { if (!seen.has(r.code)) out.push(r); });

  return out;
}

function showTripBannerError() {
  const banner = document.getElementById("pdTripBanner");
  banner.style.display = "";
  document.getElementById("pdTripName").textContent = "(ไม่พบทริป)";
  document.getElementById("pdTripDates").textContent = "";
}

// ── STATS ──────────────────────────────────────────────────
function updateStats() {
  const list = state.pax;
  const has = (v) => v != null && String(v).trim() !== "";

  document.getElementById("statTotal").textContent = list.length;
  document.getElementById("statShirt").textContent = list.filter((p) => has(p.tshirt_size)).length;
  document.getElementById("statAllergy").textContent = list.filter((p) => has(p.food_allergy)).length;
  document.getElementById("statMedical").textContent = list.filter(
    (p) => has(p.medical_conditions) || has(p.daily_medication)
  ).length;
  document.getElementById("statEmergency").textContent = list.filter(
    (p) => has(p.emergency_contact_name) && has(p.emergency_contact_phone)
  ).length;
  document.getElementById("statInsurance").textContent = list.filter(
    (p) => has(p.insurance_company) || has(p.insurance_policy_no)
  ).length;
}

// ── FILTER + RENDER ────────────────────────────────────────
function filterTable() {
  const search = (document.getElementById("searchInput")?.value || "").trim().toLowerCase();
  const cf = document.getElementById("filterCompleteness")?.value || "";
  const has = (v) => v != null && String(v).trim() !== "";

  const filtered = state.pax.filter((p) => {
    if (search) {
      const hay = [
        p.code, p.name, p.tel, p.line_id, p.emergency_contact_name, p.emergency_contact_phone,
      ].map((x) => (x || "").toLowerCase()).join(" ");
      if (!hay.includes(search)) return false;
    }
    if (cf === "missing_allergy" && has(p.food_allergy)) return false;
    if (cf === "missing_shirt"   && has(p.tshirt_size))  return false;
    if (cf === "missing_emergency" && (has(p.emergency_contact_name) && has(p.emergency_contact_phone))) return false;
    if (cf === "missing_insurance" && (has(p.insurance_company) || has(p.insurance_policy_no))) return false;
    if (cf === "has_medical" && !(has(p.medical_conditions) || has(p.daily_medication))) return false;
    return true;
  });

  renderTable(filtered);
}

// สร้างหัวตารางจาก catalog (ครั้งเดียว) — cb + # นำหน้า แล้วตามด้วยคอลัมน์ data
function renderHeader() {
  const row = document.getElementById("pd-thead-row");
  if (!row) return;
  const dataTh = PAX_COLUMNS.map(
    (f) => `<th class="pd-col-${f.pax.cls}">${escapeHtml(f.pax.header)}</th>`
  ).join("");
  row.innerHTML =
    `<th class="pd-col-cb"></th><th class="pd-col-no">#</th>` + dataTh;
}

function renderTable(rows) {
  const tbody = document.getElementById("pd-tbody");
  document.getElementById("tableCount").textContent = `${rows.length} รายการ`;
  renderHeader();

  if (!rows.length) {
    tbody.innerHTML = `
      <tr><td colspan="${PAX_COLSPAN}">
        <div class="empty-state">
          <div class="empty-icon">ℹ️</div>
          <div class="empty-text">${state.tripId == null ? "ต้องเปิดผ่านรายการทริป (?trip_id=X)" : "ไม่พบผู้เดินทาง"}</div>
        </div>
      </td></tr>`;
    return;
  }

  const e = state.globalEditing;
  // Number parents sequentially; sub-rows show blank # (match check-seat)
  let parentIdx = 0;
  tbody.innerHTML = rows.map((p) => {
    const num = p.is_sub_row ? "" : ++parentIdx;
    return renderRow(p, num, e);
  }).join("");

  if (window.AuthZ && typeof AuthZ.applyDomPerms === "function") {
    AuthZ.applyDomPerms(tbody);
  }
}

// ── Field renderer helpers (standalone — รับ code เป็น param) ──
function fInput(code, field, val, ph = "") {
  return `<input class="field-input" type="text" value="${escapeAttr(val || "")}" placeholder="${escapeAttr(ph)}"
       onchange="window.setField('${escapeAttr(code)}','${field}',this.value)" />`;
}
function fTextarea(code, field, val, ph = "") {
  return `<textarea class="field-input" rows="1" placeholder="${escapeAttr(ph)}"
       onchange="window.setField('${escapeAttr(code)}','${field}',this.value)">${escapeHtml(val || "")}</textarea>`;
}
function fView(val, alt = "—") {
  return val
    ? `<span class="field-view" title="${escapeAttr(val)}">${escapeHtml(val)}</span>`
    : `<span class="field-view empty">${alt}</span>`;
}
function fSelect(code, field, val, options) {
  return `<select class="field-input" onchange="window.setField('${escapeAttr(code)}','${field}',this.value)">
      ${options.map((s) => `<option value="${escapeAttr(s)}" ${val === s ? "selected" : ""}>${escapeHtml(s) || "—"}</option>`).join("")}
    </select>`;
}
// Canonical DB value = 'male'/'female' (lowercase, matching check-seat)
// UI displays as ♂ ชาย / ♀ หญิง for nicer layout
function fGenderSel(code, val) {
  // tolerate historical 'M'/'F' — normalize to compare
  const c = String(val || "").trim().charAt(0).toLowerCase();
  const norm = c === "m" ? "male" : c === "f" ? "female" : "";
  const opts = [["", "—"], ["male", "♂ ชาย"], ["female", "♀ หญิง"]];
  return `<select class="field-input" onchange="window.setField('${escapeAttr(code)}','gender',this.value)">
      ${opts.map(([v, l]) => `<option value="${v}" ${norm === v ? "selected" : ""}>${l}</option>`).join("")}
    </select>`;
}
function fGenderView(val) {
  // tolerate any historical format (male/Male/M)
  const c = String(val || "").trim().charAt(0).toUpperCase();
  if (c === "M") return `<span class="field-view">♂ ชาย</span>`;
  if (c === "F") return `<span class="field-view">♀ หญิง</span>`;
  return `<span class="field-view empty">—</span>`;
}

// สร้าง 1 cell ตาม config ของ field ใน catalog
function renderCell(p, f, e) {
  const cls = `pd-col-${f.pax.cls}`;
  const v = p[f.key];
  const t = f.pax.input;

  if (t === "code") {
    const codeClass = p.is_sub_row ? "pd-code-cell sub-indent" : "pd-code-cell";
    return `<td class="${cls}"><span class="${codeClass}">${escapeHtml(p.code || "")}</span></td>`;
  }
  if (t === "name") {
    const nameDisp = `${escapeHtml(p.name || "—")}${p.instead ? `<span class="pd-name-sub">↔ ${escapeHtml(p.instead)}</span>` : ""}`;
    return `<td class="${cls}"><span class="pd-name-cell">${nameDisp}</span></td>`;
  }
  if (t === "gender") {
    return `<td class="${cls}">${e ? fGenderSel(p.code, v) : fGenderView(v)}</td>`;
  }
  // non-editable fields → view เสมอ
  if (!e || f.pax.edit === false) return `<td class="${cls}">${fView(v)}</td>`;
  if (t === "select") return `<td class="${cls}">${fSelect(p.code, f.key, v, f.pax.options)}</td>`;
  if (t === "textarea") return `<td class="${cls}">${fTextarea(p.code, f.key, v, f.pax.ph)}</td>`;
  return `<td class="${cls}">${fInput(p.code, f.key, v, f.pax.ph)}</td>`;
}

function renderRow(p, num, e) {
  const trClasses = [
    p.is_sub_row ? "sub-row" : "",
    p.highlighted ? "row-highlighted" : "",
  ].filter(Boolean).join(" ");

  // Checkbox cell — input ใน edit mode, dot เมื่อ highlight (ตอนไม่ edit)
  const cbCell = e
    ? `<input type="checkbox" class="pd-row-cb" ${p.highlighted ? "checked" : ""}
         onchange="window.toggleHighlight('${escapeAttr(p.code)}',this)" />`
    : (p.highlighted ? `<span class="pd-cb-dot"></span>` : "");

  const dataCells = PAX_COLUMNS.map((f) => renderCell(p, f, e)).join("");

  return `<tr class="${trClasses}">
    <td class="pd-col-cb"><div class="pd-cb-wrap">${cbCell}</div></td>
    <td class="pd-col-no">${num}</td>
    ${dataCells}
  </tr>`;
}

// ── GLOBAL EDIT TOGGLE ─────────────────────────────────────
window.toggleGlobalEdit = function () {
  state.globalEditing = !state.globalEditing;
  const btn = document.getElementById("global-edit-btn");
  if (state.globalEditing) {
    btn.innerHTML = "💾";
    btn.dataset.tip = "Save All (เซฟเสร็จแล้วในแต่ละช่อง)";
    btn.classList.add("saving");
  } else {
    btn.innerHTML = "✏️";
    btn.dataset.tip = "Edit All";
    btn.classList.remove("saving");
    // Flush any pending debounced saves immediately
    flushAllPendingSaves();
  }
  filterTable();
};

// ── TOGGLE HIGHLIGHT (yellow row) ──────────────────────────
window.toggleHighlight = function (code, cbEl) {
  const p = state.pax.find((x) => x.code === code);
  if (!p) return;
  p.highlighted = !!cbEl.checked;
  // อัพเดท UI ทันที (toggle class ที่ <tr> โดยตรงผ่าน checkbox element)
  const tr = cbEl.closest("tr");
  if (tr) tr.classList.toggle("row-highlighted", p.highlighted);
  scheduleRowSave(code);
};

// ── FIELD UPDATE + DEBOUNCED SAVE ──────────────────────────
window.setField = function (code, field, value) {
  const p = state.pax.find((x) => x.code === code);
  if (!p) return;
  p[field] = (value == null ? "" : value);
  scheduleRowSave(code);
  // live-update stats without re-render (avoid losing input focus)
  updateStats();
};

function scheduleRowSave(code, delay = 600) {
  if (_saveTimers.has(code)) clearTimeout(_saveTimers.get(code));
  _saveTimers.set(code, setTimeout(() => {
    _saveTimers.delete(code);
    saveRow(code);
  }, delay));
}

function flushAllPendingSaves() {
  const codes = Array.from(_saveTimers.keys());
  codes.forEach((c) => {
    clearTimeout(_saveTimers.get(c));
    _saveTimers.delete(c);
    saveRow(c);
  });
}

async function saveRow(code) {
  const p = state.pax.find((x) => x.code === code);
  if (!p || state.tripId == null) return;

  // payload สร้างจาก field ที่แก้ไขได้ใน catalog (auto ครอบคลุมคอลัมน์ใหม่)
  const payload = { highlighted: !!p.highlighted, updated_at: new Date().toISOString() };
  window.PaxFields.paxEditableKeys().forEach((k) => { payload[k] = nullIfEmpty(p[k]); });

  showSaveIndicator(true);
  try {
    const q = `?code=eq.${encodeURIComponent(code)}&trip_id=eq.${state.tripId}`;
    await sbFetch("tour_seat_check", q, { method: "PATCH", body: payload });
  } catch (e) {
    const now = Date.now();
    if (now - _saveErrorCooldown.last > 3000) {
      _saveErrorCooldown.last = now;
      showToast("บันทึกล้มเหลว: " + e.message, "error");
    }
    console.error("auto-save failed:", e, "code:", code);
  } finally {
    showSaveIndicator(false);
  }
}

function nullIfEmpty(v) {
  return v == null || String(v).trim() === "" ? null : String(v).trim();
}

function showSaveIndicator(show) {
  const el = document.getElementById("pd-save-indicator");
  if (!el) return;
  if (show) {
    el.classList.add("show");
  } else {
    setTimeout(() => el.classList.remove("show"), 400);
  }
}

// ── EXPORT EXCEL ───────────────────────────────────────────
window.exportPaxExcel = function () {
  if (!state.pax.length) {
    showToast("ไม่มีข้อมูลให้ Export", "error");
    return;
  }
  if (typeof XLSX === "undefined") {
    showToast("SheetJS ยังโหลดไม่เสร็จ ลองใหม่", "error");
    return;
  }

  // คอลัมน์ Excel สร้างจาก catalog (header = xlsx → en → th) + Instead/Sub Row
  const data = state.pax.map((p, i) => {
    const row = { "#": i + 1 };
    PAX_COLUMNS.forEach((f) => {
      row[f.xlsx || f.en || f.th] = p[f.key] || "";
    });
    row["Instead"] = p.instead || "";
    row["Sub Row"] = p.is_sub_row ? "ใช่" : "";
    return row;
  });

  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  const sheetName = (state.trip?.trip_name || "Pax Detail").slice(0, 28);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  const ts = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "");
  const tripSlug = (state.trip?.trip_name || `trip-${state.tripId || "x"}`)
    .replace(/[^a-zA-Z0-9ก-๙\- ]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 40);
  XLSX.writeFile(wb, `pax-detail_${tripSlug}_${ts}.xlsx`);
  showToast("Export Excel สำเร็จ", "success");
};

// ── UTILS ──────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? "").replace(/[<>&"']/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;",
  })[c]);
}
function escapeAttr(s) {
  return String(s ?? "").replace(/[<>&"']/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;",
  })[c]);
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

// Flush pending saves on page unload (in case user leaves while debounced)
window.addEventListener("beforeunload", () => {
  if (_saveTimers.size > 0) flushAllPendingSaves();
});

// ── START ──────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
