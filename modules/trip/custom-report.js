/* ============================================================
   custom-report.js — 📊 Custom Report (per-trip)
   ผู้ใช้เลือกคอลัมน์เองจาก 3 กลุ่ม → preview สด → Excel / Print
   • Check Seat + Detail = คอลัมน์ใน tour_seat_check
   • ห้องพัก + รถ        = join จาก trip_rooms / trip_buses (by code)
   • preset คอลัมน์เก็บใน trip_report_templates (ใช้ซ้ำได้ทุกทริป)
   ============================================================ */

// ── COLUMN CATALOG ─────────────────────────────────────────
// src: "pax"  = field ตรงใน tour_seat_check
//      "calc" = ค่าที่คำนวณ/join เอง (เก็บใน state.calc[code])
// fmt: "date" | "gender" (optional)
const COLUMN_GROUPS = [
  {
    id: "checkseat", label: "🪑 Check Seat",
    cols: [
      { key: "code",              label: "รหัส",             src: "pax" },
      { key: "name",              label: "ชื่อ",              src: "pax" },
      { key: "gender",            label: "เพศ",              src: "pax", fmt: "gender" },
      { key: "nationality",       label: "สัญชาติ",          src: "pax" },
      { key: "pin",               label: "ตำแหน่ง",          src: "pax" },
      { key: "group_name",        label: "กลุ่ม",            src: "pax" },
      { key: "seat",              label: "ที่นั่งเครื่องบิน", src: "pax" },
      { key: "passport_id",       label: "เลขพาสปอร์ต",      src: "pax" },
      { key: "passport_exp_date", label: "พาสปอร์ตหมดอายุ",  src: "pax", fmt: "date" },
      { key: "tshirt_size",       label: "ไซส์เสื้อ",         src: "pax" },
      { key: "religion",          label: "ศาสนา",            src: "pax" },
      { key: "food_allergy",      label: "อาหารที่แพ้",       src: "pax" },
      { key: "return_flight",     label: "ไฟลท์ขากลับ",       src: "pax" },
      { key: "return_date",       label: "วันขากลับ",         src: "pax", fmt: "date" },
    ],
  },
  {
    id: "booking", label: "🛏️ ห้องพัก + รถ",
    cols: [
      { key: "_hotel",    label: "โรงแรม",       src: "calc" },
      { key: "_room",     label: "ชื่อห้อง",      src: "calc" },
      { key: "_checkin",  label: "เช็คอิน",       src: "calc" },
      { key: "_checkout", label: "เช็คเอาท์",     src: "calc" },
      { key: "_bus",      label: "รถบัส",         src: "calc" },
      { key: "_busseat",  label: "ที่นั่งรถบัส",   src: "calc" },
    ],
  },
  {
    id: "detail", label: "📋 Detail",
    cols: [
      { key: "tel",                        label: "เบอร์โทร",         src: "pax" },
      { key: "line_id",                    label: "LINE ID",          src: "pax" },
      { key: "home_address",               label: "ที่อยู่",           src: "pax" },
      { key: "medical_conditions",         label: "โรคประจำตัว",       src: "pax" },
      { key: "daily_medication",           label: "ยาที่ใช้ประจำ",     src: "pax" },
      { key: "emergency_contact_name",     label: "ผู้ติดต่อฉุกเฉิน",   src: "pax" },
      { key: "emergency_contact_phone",    label: "เบอร์ฉุกเฉิน",      src: "pax" },
      { key: "emergency_contact_relation", label: "ความสัมพันธ์",      src: "pax" },
      { key: "insurance_company",          label: "บริษัทประกัน",      src: "pax" },
      { key: "insurance_policy_no",        label: "เลขกรมธรรม์",       src: "pax" },
      { key: "special_requests",           label: "คำขอพิเศษ",         src: "pax" },
    ],
  },
];
const COL_BY_KEY = {};
COLUMN_GROUPS.forEach(g => g.cols.forEach(c => { COL_BY_KEY[c.key] = c; }));

const state = {
  tripId: null,
  trip: null,
  pax: [],          // tour_seat_check rows (ไม่รวม sub-row)
  calc: {},         // code -> { _hotel, _room, _checkin, _checkout, _bus, _busseat }
  templates: [],    // trip_report_templates
  selected: [],     // column keys เรียงตามลำดับแสดง
  collapsed: {},     // group id -> true ถ้ายุบ
};

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

// ── UTIL ───────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtDate(v) {
  if (!v) return "";
  const f = window.DateFmt && window.DateFmt.formatDMY;
  return f ? (f(v) || "") : String(v);
}
function showLoading(on) {
  const el = document.getElementById("loadingOverlay");
  if (el) el.classList.toggle("show", !!on);
}
function showToast(msg, type = "info") {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.className = "toast toast-" + type + " show";
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove("show"), 3000);
}

// ── INIT ───────────────────────────────────────────────────
async function init() {
  const qs = new URLSearchParams(location.search);
  const tid = parseInt(qs.get("trip_id"), 10);
  if (!Number.isFinite(tid) || tid <= 0) {
    showToast("ไม่พบ trip_id ใน URL", "error");
    setTimeout(() => (location.href = "./trip-list.html"), 1500);
    return;
  }
  state.tripId = tid;
  const { url, key } = getSB();
  if (!url || !key) {
    showLoading(false);
    showToast("ยังไม่ได้เชื่อมต่อ Supabase", "error");
    return;
  }
  await loadAll();
}

async function loadAll() {
  showLoading(true);
  try {
    const [trip, pax, rooms, buses, templates] = await Promise.all([
      sbFetch("trips", `?trip_id=eq.${state.tripId}&select=trip_id,trip_name,start_date,end_date`).then(r => r?.[0] || null),
      sbFetch("tour_seat_check", `?trip_id=eq.${state.tripId}&select=*&order=group_name.asc.nullslast,name.asc`),
      sbFetch("trip_rooms", `?trip_id=eq.${state.tripId}&select=room_id,room_name,place_id,check_in_date,check_out_date`),
      sbFetch("trip_buses", `?trip_id=eq.${state.tripId}&select=bus_id,bus_no,bus_label`).catch(() => []),
      sbFetch("trip_report_templates", "?select=*&order=name.asc").catch(() => []),
    ]);
    state.trip = trip;
    state.pax = (pax || []).filter(r => !r.is_sub_row);
    state.templates = templates || [];

    await buildCalc(rooms || [], buses || []);

    renderTripBanner();
    renderTemplates();
    renderPicker();
    renderAll();
  } catch (e) {
    showToast("โหลดข้อมูลไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
}

// สร้าง state.calc[code] — join ห้องพัก/รถ ให้แต่ละคน
async function buildCalc(rooms, buses) {
  const roomIds = rooms.map(r => r.room_id);
  const busIds = buses.map(b => b.bus_id);
  const [roomOccs, busOccs, places] = await Promise.all([
    roomIds.length
      ? sbFetch("trip_room_occupants", `?room_id=in.(${roomIds.join(",")})&select=room_id,code`)
      : Promise.resolve([]),
    busIds.length
      ? sbFetch("trip_bus_occupants", `?bus_id=in.(${busIds.join(",")})&select=bus_id,seat_no,code`)
      : Promise.resolve([]),
    sbFetch("places", "?place_type=eq.HOTEL&select=place_id,place_name").catch(() => []),
  ]);

  const roomById = {};
  rooms.forEach(r => { roomById[r.room_id] = r; });
  const placeById = {};
  (places || []).forEach(p => { placeById[p.place_id] = p.place_name; });
  const busById = {};
  buses.forEach(b => { busById[b.bus_id] = b; });

  const codeRooms = {}; // code -> [room]
  (roomOccs || []).forEach(o => {
    const r = roomById[o.room_id];
    if (r) (codeRooms[o.code] = codeRooms[o.code] || []).push(r);
  });
  const codeBus = {}; // code -> { bus, seat }
  (busOccs || []).forEach(o => {
    if (busById[o.bus_id]) codeBus[o.code] = { bus: busById[o.bus_id], seat: o.seat_no };
  });

  state.calc = {};
  state.pax.forEach(p => {
    const rs = (codeRooms[p.code] || []).slice()
      .sort((a, b) => (a.room_name || "").localeCompare(b.room_name || "", undefined, { numeric: true }));
    const uniq = arr => [...new Set(arr.filter(Boolean))];
    const bus = codeBus[p.code];
    state.calc[p.code] = {
      _hotel:    uniq(rs.map(r => placeById[r.place_id])).join(", "),
      _room:     uniq(rs.map(r => r.room_name)).join(", "),
      _checkin:  uniq(rs.map(r => fmtDate(r.check_in_date))).join(", "),
      _checkout: uniq(rs.map(r => fmtDate(r.check_out_date))).join(", "),
      _bus:      bus ? (bus.bus.bus_label || `คันที่ ${bus.bus.bus_no || "?"}`) : "",
      _busseat:  bus ? String(bus.seat ?? "") : "",
    };
  });
}

// ── RENDER ─────────────────────────────────────────────────
function renderTripBanner() {
  const banner = document.getElementById("crTripBanner");
  if (!banner || !state.trip) return;
  document.getElementById("crTripName").textContent =
    state.trip.trip_name || `Trip #${state.tripId}`;
  const ci = state.trip.start_date ? fmtDate(state.trip.start_date) : "";
  const co = state.trip.end_date ? fmtDate(state.trip.end_date) : "";
  document.getElementById("crTripDates").textContent =
    (ci || co) ? `${ci || "—"} → ${co || "—"}` : "";
  banner.style.display = "inline-flex";
  document.title = `📊 Custom Report — ${state.trip.trip_name || ""} — A4S-ERP`;
}

function renderPicker() {
  const wrap = document.getElementById("crPicker");
  wrap.innerHTML = COLUMN_GROUPS.map(g => {
    const opts = g.cols.map(c => `
      <label class="cr-opt">
        <input type="checkbox" value="${c.key}" ${state.selected.includes(c.key) ? "checked" : ""}
          onchange="window.toggleColumn('${c.key}', this.checked)">
        <span>${escapeHtml(c.label)}</span>
      </label>`).join("");
    return `<div class="cr-group${state.collapsed[g.id] ? " collapsed" : ""}">
      <div class="cr-group-hdr" onclick="window.toggleGroup('${g.id}')">
        <span>${escapeHtml(g.label)}</span>
        <span class="cr-group-caret">${state.collapsed[g.id] ? "▸" : "▾"}</span>
      </div>
      <div class="cr-group-body">${opts}</div>
    </div>`;
  }).join("");
}

function renderChips() {
  const wrap = document.getElementById("crChips");
  if (!state.selected.length) { wrap.innerHTML = ""; return; }
  wrap.innerHTML = state.selected.map((k, i) => {
    const c = COL_BY_KEY[k];
    if (!c) return "";
    return `<span class="cr-chip">
      <button class="cr-chip-move" title="เลื่อนซ้าย" onclick="window.moveColumn('${k}',-1)"
        ${i === 0 ? "disabled style='opacity:.25'" : ""}>◀</button>
      ${escapeHtml(c.label)}
      <button class="cr-chip-move" title="เลื่อนขวา" onclick="window.moveColumn('${k}',1)"
        ${i === state.selected.length - 1 ? "disabled style='opacity:.25'" : ""}>▶</button>
      <button title="เอาออก" onclick="window.toggleColumn('${k}', false)">✕</button>
    </span>`;
  }).join("");
}

function cellValue(row, col) {
  if (col.src === "calc") return state.calc[row.code]?.[col.key] || "";
  let v = row[col.key];
  if (v == null || v === "") return "";
  if (col.fmt === "date") return fmtDate(v);
  if (col.fmt === "gender") {
    const g = String(v).toLowerCase();
    return g === "male" ? "ชาย" : g === "female" ? "หญิง" : String(v);
  }
  return String(v);
}

function renderPreview() {
  const table = document.getElementById("crTable");
  const empty = document.getElementById("crEmpty");
  const count = document.getElementById("crRowCount");
  const cols = state.selected.map(k => COL_BY_KEY[k]).filter(Boolean);
  if (!cols.length) {
    table.style.display = "none";
    empty.style.display = "block";
    count.textContent = "";
    return;
  }
  empty.style.display = "none";
  table.style.display = "";
  count.textContent = `· ${state.pax.length} คน · ${cols.length} คอลัมน์`;
  document.getElementById("crThead").innerHTML =
    `<th style="width:40px">#</th>` + cols.map(c => `<th>${escapeHtml(c.label)}</th>`).join("");
  document.getElementById("crTbody").innerHTML = state.pax.map((row, i) =>
    `<tr><td style="color:var(--text3)">${i + 1}</td>` +
    cols.map(c => `<td>${escapeHtml(cellValue(row, c))}</td>`).join("") +
    `</tr>`).join("");
}

function renderTemplates() {
  const sel = document.getElementById("presetSelect");
  const cur = sel.value;
  sel.innerHTML = `<option value="">— เลือก preset —</option>` +
    state.templates.map(t =>
      `<option value="${t.template_id}">${escapeHtml(t.name)}</option>`).join("");
  if (cur && state.templates.some(t => String(t.template_id) === cur)) sel.value = cur;
}

function renderAll() {
  renderChips();
  renderPreview();
}

// ── COLUMN PICK ────────────────────────────────────────────
window.toggleGroup = function (gid) {
  state.collapsed[gid] = !state.collapsed[gid];
  renderPicker();
};
window.toggleColumn = function (key, checked) {
  if (!COL_BY_KEY[key]) return;
  const idx = state.selected.indexOf(key);
  if (checked && idx < 0) state.selected.push(key);
  else if (!checked && idx >= 0) state.selected.splice(idx, 1);
  renderPicker();
  renderAll();
};
window.moveColumn = function (key, dir) {
  const i = state.selected.indexOf(key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= state.selected.length) return;
  [state.selected[i], state.selected[j]] = [state.selected[j], state.selected[i]];
  renderAll();
};

// ── PRESETS ────────────────────────────────────────────────
window.applyPreset = function (id) {
  if (!id) return;
  const tpl = state.templates.find(t => String(t.template_id) === String(id));
  if (!tpl) return;
  const cols = Array.isArray(tpl.columns) ? tpl.columns : [];
  state.selected = cols.filter(k => COL_BY_KEY[k]); // กรอง key ที่ไม่มีแล้วทิ้ง
  renderPicker();
  renderAll();
  showToast(`ใช้ preset "${tpl.name}" แล้ว`, "success");
};

window.savePreset = async function () {
  if (!state.selected.length) { showToast("เลือกคอลัมน์ก่อนบันทึก preset", "info"); return; }
  const name = await PromptModal.open({
    title: "บันทึกชุดคอลัมน์เป็น preset",
    message: "ตั้งชื่อ preset — ใช้ซ้ำได้กับทุกทริป",
    icon: "💾",
    okText: "บันทึก",
    cancelText: "ยกเลิก",
    placeholder: "เช่น รายงานห้องพัก, รายงาน passport",
    required: true,
  });
  if (name === null) return;
  const trimmed = name.trim();
  if (!trimmed) return;
  showLoading(true);
  try {
    const body = {
      name: trimmed,
      columns: state.selected,
      created_by: window.ERP_USER?.user_id ?? null,
      updated_at: new Date().toISOString(),
    };
    const existing = state.templates.find(t => t.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      await sbFetch("trip_report_templates", `?template_id=eq.${existing.template_id}`,
        { method: "PATCH", body: { columns: state.selected, updated_at: body.updated_at } });
      showToast(`อัปเดต preset "${trimmed}" แล้ว`, "success");
    } else {
      await sbFetch("trip_report_templates", "", { method: "POST", body });
      showToast(`บันทึก preset "${trimmed}" แล้ว`, "success");
    }
    state.templates = await sbFetch("trip_report_templates", "?select=*&order=name.asc");
    renderTemplates();
    const match = state.templates.find(t => t.name.toLowerCase() === trimmed.toLowerCase());
    if (match) document.getElementById("presetSelect").value = match.template_id;
  } catch (e) {
    showToast("บันทึก preset ไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

window.deletePreset = async function () {
  const id = document.getElementById("presetSelect").value;
  if (!id) { showToast("เลือก preset ที่จะลบก่อน", "info"); return; }
  const tpl = state.templates.find(t => String(t.template_id) === String(id));
  if (!tpl) return;
  const ok = window.ConfirmModal?.open
    ? await window.ConfirmModal.open({
        title: "ลบ preset",
        message: `ลบ preset "${tpl.name}"?`,
        icon: "🗑", tone: "danger", okText: "ลบ",
      })
    : confirm(`ลบ preset "${tpl.name}"?`);
  if (!ok) return;
  showLoading(true);
  try {
    await sbFetch("trip_report_templates", `?template_id=eq.${id}`, { method: "DELETE" });
    state.templates = state.templates.filter(t => String(t.template_id) !== String(id));
    renderTemplates();
    showToast(`ลบ preset "${tpl.name}" แล้ว`, "success");
  } catch (e) {
    showToast("ลบ preset ไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

// ── EXPORT ─────────────────────────────────────────────────
function selectedCols() {
  return state.selected.map(k => COL_BY_KEY[k]).filter(Boolean);
}
function tripTitle() {
  return state.trip?.trip_name || `Trip #${state.tripId}`;
}

window.exportReportExcel = function () {
  const cols = selectedCols();
  if (!cols.length) { showToast("เลือกคอลัมน์ก่อน export", "info"); return; }
  if (typeof XLSX === "undefined") { showToast("XLSX ยังโหลดไม่เสร็จ — ลองใหม่", "error"); return; }
  const data = state.pax.map(row => {
    const o = {};
    cols.forEach(c => { o[c.label] = cellValue(row, c); });
    return o;
  });
  const ws = XLSX.utils.json_to_sheet(data.length ? data : [Object.fromEntries(cols.map(c => [c.label, ""]))]);
  ws["!cols"] = cols.map(c => ({ wch: Math.max(c.label.length + 2, 14) }));
  const wb = XLSX.utils.book_new();
  const sheet = tripTitle().replace(/[\\\/\?\*\[\]:]/g, "_").slice(0, 31) || "Report";
  XLSX.utils.book_append_sheet(wb, ws, sheet);
  XLSX.writeFile(wb, `Custom-Report_${tripTitle().replace(/\s+/g, "-")}.xlsx`);
  showToast("ดาวน์โหลด Excel แล้ว", "success");
};

window.exportReportPrint = function () {
  const cols = selectedCols();
  if (!cols.length) { showToast("เลือกคอลัมน์ก่อน print", "info"); return; }
  const ci = state.trip?.start_date ? fmtDate(state.trip.start_date) : "";
  const co = state.trip?.end_date ? fmtDate(state.trip.end_date) : "";
  const dates = (ci || co) ? ` · ${ci || "—"} → ${co || "—"}` : "";
  const thead = `<th>#</th>` + cols.map(c => `<th>${escapeHtml(c.label)}</th>`).join("");
  const tbody = state.pax.map((row, i) =>
    `<tr><td>${i + 1}</td>` +
    cols.map(c => `<td>${escapeHtml(cellValue(row, c))}</td>`).join("") +
    `</tr>`).join("");
  const gen = new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
  document.getElementById("cr-print-area").innerHTML = `
    <div class="cr-print-title">📊 Custom Report — ${escapeHtml(tripTitle())}${dates}</div>
    <div class="cr-print-sub">${state.pax.length} คน · ${cols.length} คอลัมน์ · พิมพ์เมื่อ ${gen}</div>
    <table><thead><tr>${thead}</tr></thead><tbody>${tbody ||
      `<tr><td colspan="${cols.length + 1}" style="text-align:center;color:#94a3b8">ไม่มีข้อมูล</td></tr>`
    }</tbody></table>`;
  showToast("เปิดหน้าต่าง print — เลือก 'Save as PDF' ได้", "info");
  setTimeout(() => window.print(), 80);
};

// ── BOOT ───────────────────────────────────────────────────
init();
