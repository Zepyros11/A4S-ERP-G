/* ============================================================
   pax-detail.js — ℹ️ ข้อมูลผู้เดินทาง (per-trip)
   อ่าน/แก้ไขข้อมูลส่วนตัวจาก tour_seat_check
   • Floating ✏️ button: toggle edit mode (รวม) — แบบเดียวกับ check-seat
   • แต่ละ field มี debounced auto-save → Supabase
   ============================================================ */

const PAX_SELECT_COLS = [
  "id", "code", "name", "instead", "gender", "nationality", "tel",
  "tshirt_size", "religion", "food_allergy",
  "medical_conditions", "daily_medication",
  "emergency_contact_name", "emergency_contact_phone", "emergency_contact_relation",
  "home_address", "line_id",
  "insurance_company", "insurance_policy_no", "special_requests",
  "is_sub_row", "parent_code",
].join(",");

const SHIRT_OPTIONS = ["", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL"];

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
        `?trip_id=eq.${state.tripId}&select=${PAX_SELECT_COLS}&order=name.asc.nullslast`
      ),
    ]);

    state.trip = (trips || [])[0] || null;
    state.pax = pax || [];

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

function renderTable(rows) {
  const tbody = document.getElementById("pd-tbody");
  document.getElementById("tableCount").textContent = `${rows.length} รายการ`;

  if (!rows.length) {
    tbody.innerHTML = `
      <tr><td colspan="19">
        <div class="empty-state">
          <div class="empty-icon">ℹ️</div>
          <div class="empty-text">${state.tripId == null ? "ต้องเปิดผ่านรายการทริป (?trip_id=X)" : "ไม่พบผู้เดินทาง"}</div>
        </div>
      </td></tr>`;
    return;
  }

  const e = state.globalEditing;
  tbody.innerHTML = rows.map((p, i) => renderRow(p, i, e)).join("");

  if (window.AuthZ && typeof AuthZ.applyDomPerms === "function") {
    AuthZ.applyDomPerms(tbody);
  }
}

function renderRow(p, i, e) {
  const sub = p.is_sub_row ? "sub-row" : "";
  const nameDisp = `${escapeHtml(p.name || "—")}${p.instead ? `<span class="pd-name-sub">↔ ${escapeHtml(p.instead)}</span>` : ""}`;
  const subPrefix = p.is_sub_row ? `<span class="pd-sub-prefix" title="ผู้ร่วมเดินทาง">↳</span>` : "";

  // Field renderer helpers
  const inp = (field, val, ph = "") =>
    `<input class="field-input" type="text" value="${escapeAttr(val || "")}" placeholder="${escapeAttr(ph)}"
       onchange="window.setField('${escapeAttr(p.code)}','${field}',this.value)" />`;
  const txt = (field, val, ph = "") =>
    `<textarea class="field-input" rows="1" placeholder="${escapeAttr(ph)}"
       onchange="window.setField('${escapeAttr(p.code)}','${field}',this.value)">${escapeHtml(val || "")}</textarea>`;
  const view = (val, alt = "—") =>
    val ? `<span class="field-view" title="${escapeAttr(val)}">${escapeHtml(val)}</span>`
        : `<span class="field-view empty">${alt}</span>`;
  const shirtSel = (val) =>
    `<select class="field-input" onchange="window.setField('${escapeAttr(p.code)}','tshirt_size',this.value)">
      ${SHIRT_OPTIONS.map((s) => `<option value="${s}" ${val === s ? "selected" : ""}>${s || "—"}</option>`).join("")}
    </select>`;
  // Canonical DB value = 'male'/'female' (lowercase, matching check-seat)
  // UI displays as ♂ ชาย / ♀ หญิง for nicer layout
  const genderSel = (val) => {
    // tolerate historical 'M'/'F' — normalize to compare
    const c = String(val || "").trim().charAt(0).toLowerCase();
    const norm = c === "m" ? "male" : c === "f" ? "female" : "";
    const opts = [["", "—"], ["male", "♂ ชาย"], ["female", "♀ หญิง"]];
    return `<select class="field-input" onchange="window.setField('${escapeAttr(p.code)}','gender',this.value)">
      ${opts.map(([v, l]) => `<option value="${v}" ${norm === v ? "selected" : ""}>${l}</option>`).join("")}
    </select>`;
  };
  const genderView = (val) => {
    // tolerate any historical format (male/Male/M)
    const c = String(val || "").trim().charAt(0).toUpperCase();
    if (c === "M") return `<span class="field-view">♂ ชาย</span>`;
    if (c === "F") return `<span class="field-view">♀ หญิง</span>`;
    return `<span class="field-view empty">—</span>`;
  };

  return `<tr class="${sub}">
    <td class="pd-col-no">${i + 1}</td>
    <td class="pd-col-code"><span class="pd-code-cell">${escapeHtml(p.code || "")}</span></td>
    <td class="pd-col-name">${subPrefix}<span class="pd-name-cell">${nameDisp}</span></td>
    <td class="pd-col-gender">${e ? genderSel(p.gender) : genderView(p.gender)}</td>
    <td class="pd-col-religion">${e ? inp("religion", p.religion, "พุทธ/คริสต์/อิสลาม") : view(p.religion)}</td>
    <td class="pd-col-nat">${e ? inp("nationality", p.nationality) : view(p.nationality)}</td>
    <td class="pd-col-shirt">${e ? shirtSel(p.tshirt_size) : view(p.tshirt_size)}</td>
    <td class="pd-col-allergy">${e ? inp("food_allergy", p.food_allergy, "แพ้ทะเล, มังสวิรัติ, ฮาลาล") : view(p.food_allergy)}</td>
    <td class="pd-col-medical">${e ? txt("medical_conditions", p.medical_conditions, "เบาหวาน/ความดัน...") : view(p.medical_conditions)}</td>
    <td class="pd-col-medic">${e ? txt("daily_medication", p.daily_medication, "ชื่อยา + ขนาด") : view(p.daily_medication)}</td>
    <td class="pd-col-tel">${e ? inp("tel", p.tel, "+66 8x-xxx-xxxx") : view(p.tel)}</td>
    <td class="pd-col-line">${e ? inp("line_id", p.line_id, "@username") : view(p.line_id)}</td>
    <td class="pd-col-addr">${e ? txt("home_address", p.home_address, "ที่อยู่ปัจจุบัน") : view(p.home_address)}</td>
    <td class="pd-col-em-name">${e ? inp("emergency_contact_name", p.emergency_contact_name, "ชื่อ-นามสกุล") : view(p.emergency_contact_name)}</td>
    <td class="pd-col-em-rel">${e ? inp("emergency_contact_relation", p.emergency_contact_relation, "สามี/ภรรยา") : view(p.emergency_contact_relation)}</td>
    <td class="pd-col-em-phone">${e ? inp("emergency_contact_phone", p.emergency_contact_phone, "+66 8x-xxx-xxxx") : view(p.emergency_contact_phone)}</td>
    <td class="pd-col-ins-co">${e ? inp("insurance_company", p.insurance_company, "ชื่อบริษัท") : view(p.insurance_company)}</td>
    <td class="pd-col-ins-no">${e ? inp("insurance_policy_no", p.insurance_policy_no, "เลขกรมธรรม์") : view(p.insurance_policy_no)}</td>
    <td class="pd-col-special">${e ? txt("special_requests", p.special_requests, "wheelchair, อื่นๆ") : view(p.special_requests)}</td>
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

  const payload = {
    gender: nullIfEmpty(p.gender),
    religion: nullIfEmpty(p.religion),
    nationality: nullIfEmpty(p.nationality),
    tshirt_size: nullIfEmpty(p.tshirt_size),
    food_allergy: nullIfEmpty(p.food_allergy),
    medical_conditions: nullIfEmpty(p.medical_conditions),
    daily_medication: nullIfEmpty(p.daily_medication),
    tel: nullIfEmpty(p.tel),
    line_id: nullIfEmpty(p.line_id),
    home_address: nullIfEmpty(p.home_address),
    emergency_contact_name: nullIfEmpty(p.emergency_contact_name),
    emergency_contact_relation: nullIfEmpty(p.emergency_contact_relation),
    emergency_contact_phone: nullIfEmpty(p.emergency_contact_phone),
    insurance_company: nullIfEmpty(p.insurance_company),
    insurance_policy_no: nullIfEmpty(p.insurance_policy_no),
    special_requests: nullIfEmpty(p.special_requests),
    updated_at: new Date().toISOString(),
  };

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

  const data = state.pax.map((p, i) => ({
    "#": i + 1,
    "Code": p.code || "",
    "Name": p.name || "",
    "Instead": p.instead || "",
    "Gender": p.gender || "",
    "Nationality": p.nationality || "",
    "Religion": p.religion || "",
    "T-Shirt Size": p.tshirt_size || "",
    "Food Allergy": p.food_allergy || "",
    "Medical Conditions": p.medical_conditions || "",
    "Daily Medication": p.daily_medication || "",
    "Tel / WhatsApp": p.tel || "",
    "LINE ID": p.line_id || "",
    "Home Address": p.home_address || "",
    "Emergency Contact": p.emergency_contact_name || "",
    "Emergency Relation": p.emergency_contact_relation || "",
    "Emergency Phone": p.emergency_contact_phone || "",
    "Insurance Company": p.insurance_company || "",
    "Insurance Policy No.": p.insurance_policy_no || "",
    "Special Requests": p.special_requests || "",
    "Sub Row": p.is_sub_row ? "ใช่" : "",
  }));

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
