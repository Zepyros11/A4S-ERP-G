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

// ลำดับ sort ของคอลัมน์ "ตำแหน่ง" (pin) — ไม่ใช่ ASC/DESC ตามตัวอักษร
// แต่เรียงตามชั้นยศ: SVP → VP → AVP → SD → DR (ค่าอื่น/ว่าง = ท้ายสุด)
const PIN_RANK = { SVP: 0, VP: 1, AVP: 2, SD: 3, DR: 4 };
function pinRank(v) {
  const r = PIN_RANK[String(v || "").trim().toUpperCase()];
  return r === undefined ? 99 : r;
}

const state = {
  tripId: null,
  trip: null,
  pax: [],          // tour_seat_check rows (รวม sub-row — sub สืบทอด field ว่างจาก parent)
  calc: {},         // code -> { _hotel, _room, _checkin, _checkout, _bus, _busseat }
  templates: [],    // trip_report_templates
  selected: [],     // column keys เรียงตามลำดับแสดง
  collapsed: {},     // group id -> true ถ้ายุบ
  sort: [],         // multi-sort chain: [{key, dir:1|-1}, ...] — ลำดับใน array = ลำดับ priority
  filters: {},      // col key -> Set([selected values])  (empty/missing = ไม่กรองคอลัมน์นั้น)
};

// คอลัมน์ที่จะมี header-filter ได้ — distinct ค่าต้อง 2..FILTER_MAX_DISTINCT
// (>50 ค่า = ไม่ใช่ enum, dropdown ยาวเกินใช้ไม่สนุก)
const FILTER_MAX_DISTINCT = 50;

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
    // รวมทุกแถว (parent + sub-row) — 1 แถว = 1 ที่นั่ง เหมือน check-seat/room-assign
    // sub-row สืบทอดจาก parent "เฉพาะ field ระบุตัวตน" (ชื่อ/เพศ/สัญชาติ) เผื่อแถวว่างเปล่า
    // — ไม่สืบทอด ตำแหน่ง/passport/ที่นั่ง ฯลฯ เพราะเป็นข้อมูลเฉพาะบุคคล
    //   ถ้า sub-row เว้นว่าง = ว่างจริง ต้องแสดงว่าง (ห้ามก๊อปของ parent)
    const INHERIT_FIELDS = ["name", "gender", "nationality"];
    const allRows = pax || [];
    const byCode = {};
    allRows.forEach(r => { byCode[r.code] = r; });
    allRows.forEach(r => {
      if (!r.is_sub_row || !r.parent_code) return;
      const parent = byCode[r.parent_code];
      if (!parent) return;
      INHERIT_FIELDS.forEach(k => {
        if (r[k] === null || r[k] === undefined || r[k] === "") r[k] = parent[k];
      });
    });
    state.pax = allRows;
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

    // จัดกลุ่มห้องตามโรงแรม — 1 stay = 1 โรงแรม (ห้อง/เช็คอินในโรงแรมเดียวกันรวม comma)
    // ใช้ตอน expand รายงานเป็น 1 แถวต่อ (คน × โรงแรม) เมื่อเลือกคอลัมน์โรงแรม/ห้อง
    const stayMap = new Map();
    rs.forEach(r => {
      const hotel = placeById[r.place_id] || "";
      if (!stayMap.has(hotel)) stayMap.set(hotel, { _hotel: hotel, rooms: [], cins: [], couts: [] });
      const s = stayMap.get(hotel);
      s.rooms.push(r.room_name);
      s.cins.push(fmtDate(r.check_in_date));
      s.couts.push(fmtDate(r.check_out_date));
    });
    const stays = [...stayMap.values()].map(s => ({
      _hotel:    s._hotel,
      _room:     uniq(s.rooms).join(", "),
      _checkin:  uniq(s.cins).join(", "),
      _checkout: uniq(s.couts).join(", "),
    }));

    state.calc[p.code] = {
      _hotel:    uniq(rs.map(r => placeById[r.place_id])).join(", "),
      _room:     uniq(rs.map(r => r.room_name)).join(", "),
      _checkin:  uniq(rs.map(r => fmtDate(r.check_in_date))).join(", "),
      _checkout: uniq(rs.map(r => fmtDate(r.check_out_date))).join(", "),
      _bus:      bus ? (bus.bus.bus_label || `คันที่ ${bus.bus.bus_no || "?"}`) : "",
      _busseat:  bus ? String(bus.seat ?? "") : "",
      _stays:    stays,
    };
  });
}

// คอลัมน์ที่ trigger split-by-hotel — เลือกอย่างน้อย 1 → 1 คน × N โรงแรม = N แถว
const ROOM_SPLIT_COLS = ["_hotel", "_room", "_checkin", "_checkout"];

// คืน pax หลัง expand: ถ้าคนนอนหลายโรงแรม → แตกเป็นหลายแถว (override _hotel/_room/_checkin/_checkout)
function expandedPax() {
  const needsSplit = state.selected.some(k => ROOM_SPLIT_COLS.includes(k));
  if (!needsSplit) return state.pax;
  const out = [];
  state.pax.forEach(p => {
    const stays = state.calc[p.code]?._stays || [];
    if (stays.length <= 1) { out.push(p); return; }
    stays.forEach(s => out.push({ ...p, __stay: s }));
  });
  return out;
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
  if (col.src === "calc") {
    if (row.__stay && col.key in row.__stay) return row.__stay[col.key];
    return state.calc[row.code]?.[col.key] || "";
  }
  let v = row[col.key];
  if (v == null || v === "") return "";
  if (col.fmt === "date") return fmtDate(v);
  if (col.fmt === "gender") {
    const g = String(v).toLowerCase();
    return g === "male" ? "ชาย" : g === "female" ? "หญิง" : String(v);
  }
  return String(v);
}

// ค่าใช้เปรียบเทียบตอน sort — pin ใช้ rank, date ใช้ค่า ISO ดิบ, อื่นๆ ใช้ string
function sortValue(row, col) {
  if (col.key === "pin") return pinRank(row.pin);
  if (col.src === "pax" && col.fmt === "date") return row[col.key] || ""; // ISO → string sort ถูก
  return cellValue(row, col).toLowerCase();
}

// sentinel แทน "ค่าว่าง" ใน filter set — ใช้ string ที่ไม่น่าซ้ำกับข้อมูลจริง
const BLANK_VAL = " __BLANK__ ";
const BLANK_LABEL = "(ว่าง)";

// คืน distinct values ของคอลัมน์ — ใช้ทั้งเช็คว่ามี filter ได้ไหม + populate dropdown
// คำนวณจาก expandedPax (ก่อน apply filter) เพื่อให้เห็นทุก option เสมอ
// ถ้าคอลัมน์มีแถวที่ค่าว่าง → ใส่ BLANK_VAL ไว้ท้าย list ให้ filter ได้ด้วย
function distinctValuesFor(key) {
  const col = COL_BY_KEY[key];
  if (!col) return [];
  const set = new Set();
  let hasBlank = false;
  expandedPax().forEach(row => {
    const v = cellValue(row, col);
    if (v === "" || v == null) hasBlank = true;
    else set.add(v);
  });
  const arr = [...set].sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" }));
  if (hasBlank) arr.push(BLANK_VAL);
  return arr;
}
function isFilterable(key) {
  const n = distinctValuesFor(key).length;
  return n >= 2 && n <= FILTER_MAX_DISTINCT;
}

function filterRows(rows) {
  const active = Object.entries(state.filters).filter(([_, s]) => s && s.size);
  if (!active.length) return rows;
  return rows.filter(row =>
    active.every(([key, set]) => {
      const col = COL_BY_KEY[key];
      if (!col) return true;
      const v = cellValue(row, col);
      if (v === "" || v == null) return set.has(BLANK_VAL);
      return set.has(v);
    }));
}

// คืน rows ตามลำดับ sort ปัจจุบัน (ไม่แก้ state.pax เดิม)
// ถ้าเลือกคอลัมน์โรงแรม/ห้อง → expand เป็น 1 แถว/โรงแรม ก่อน sort
// pipeline: expand → filter → sort
// multi-sort: เรียงตาม chain ใน state.sort (priority ตามลำดับใน array)
function getRows() {
  const filtered = filterRows(expandedPax());
  const chain = state.sort.map(s => ({ col: COL_BY_KEY[s.key], dir: s.dir })).filter(x => x.col);
  if (!chain.length) return filtered;
  return [...filtered].sort((a, b) => {
    for (const { col, dir } of chain) {
      const va = sortValue(a, col), vb = sortValue(b, col);
      let cmp;
      if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
      else cmp = String(va).localeCompare(String(vb), undefined, { numeric: true });
      if (cmp !== 0) return cmp * dir;
    }
    return 0;
  });
}

// ── HEADER FILTER POPOVER ──────────────────────────────────
// 1 popover ทั่วโลก — เปิด-ปิดที่ document.body เพื่อให้ลอยเหนือ table overflow
let _popState = null; // { key, el, search, draft:Set, closer }
function closeFilterPopover() {
  if (!_popState) return;
  _popState.el?.remove();
  document.removeEventListener("mousedown", _popState.closer, true);
  document.removeEventListener("keydown", _popState.escCloser, true);
  window.removeEventListener("resize", _popState.repos, true);
  window.removeEventListener("scroll", _popState.repos, true);
  _popState = null;
}
function repositionPopover() {
  if (!_popState) return;
  const { el, anchor } = _popState;
  const r = anchor.getBoundingClientRect();
  const popW = el.offsetWidth || 240;
  const left = Math.max(8, Math.min(window.innerWidth - popW - 8, r.right - popW));
  const top = Math.min(window.innerHeight - el.offsetHeight - 8, r.bottom + 4);
  el.style.left = left + "px";
  el.style.top = top + "px";
}
function renderFilterPopoverBody() {
  if (!_popState) return;
  const { key, draft, search } = _popState;
  const values = distinctValuesFor(key);
  const q = search.trim().toLowerCase();
  const shown = q
    ? values.filter(v => (v === BLANK_VAL ? BLANK_LABEL : String(v)).toLowerCase().includes(q))
    : values;
  const listEl = _popState.el.querySelector(".cr-fpop-list");
  if (!shown.length) {
    listEl.innerHTML = `<div class="cr-fpop-empty">ไม่พบค่าที่ตรงกัน</div>`;
    return;
  }
  listEl.innerHTML = shown.map(v => {
    const id = "_crf_" + Math.random().toString(36).slice(2, 9);
    const checked = draft.has(v) ? "checked" : "";
    const isBlank = v === BLANK_VAL;
    const display = isBlank
      ? `<span style="font-style:italic;color:var(--text3)">${BLANK_LABEL}</span>`
      : `<span>${escapeHtml(v)}</span>`;
    return `<label><input type="checkbox" id="${id}" ${checked} data-val="${escapeHtml(v)}"
        onchange="window._crFilterToggle(this)">${display}</label>`;
  }).join("");
}
window._crFilterToggle = function (cb) {
  if (!_popState) return;
  const v = cb.getAttribute("data-val");
  if (cb.checked) _popState.draft.add(v); else _popState.draft.delete(v);
};
window.openFilter = function (key, anchorEl) {
  // คลิก icon ซ้ำ → ปิด
  if (_popState && _popState.key === key) { closeFilterPopover(); return; }
  closeFilterPopover();
  const current = state.filters[key] instanceof Set ? state.filters[key] : new Set();
  const draft = new Set(current);
  const el = document.createElement("div");
  el.className = "cr-fpop";
  el.innerHTML = `
    <input class="cr-fpop-search" type="search" placeholder="ค้นหาค่า…" oninput="window._crFilterSearch(this.value)">
    <div class="cr-fpop-acts">
      <button onclick="window._crFilterAll(true)">เลือกทั้งหมด</button>
      <button onclick="window._crFilterAll(false)">ล้าง</button>
    </div>
    <div class="cr-fpop-list"></div>
    <div class="cr-fpop-foot">
      <button onclick="window._crFilterClear()">เอา filter ออก</button>
      <button class="primary" onclick="window._crFilterApply()">ใช้</button>
    </div>`;
  document.body.appendChild(el);
  _popState = {
    key, el, anchor: anchorEl, draft, search: "",
    closer: (ev) => { if (!el.contains(ev.target) && ev.target !== anchorEl) closeFilterPopover(); },
    escCloser: (ev) => { if (ev.key === "Escape") closeFilterPopover(); },
    repos: repositionPopover,
  };
  document.addEventListener("mousedown", _popState.closer, true);
  document.addEventListener("keydown", _popState.escCloser, true);
  window.addEventListener("resize", _popState.repos, true);
  window.addEventListener("scroll", _popState.repos, true);
  renderFilterPopoverBody();
  repositionPopover();
  el.querySelector(".cr-fpop-search")?.focus();
};
window._crFilterSearch = function (v) {
  if (!_popState) return;
  _popState.search = v || "";
  renderFilterPopoverBody();
};
window._crFilterAll = function (sel) {
  if (!_popState) return;
  const values = distinctValuesFor(_popState.key);
  const q = _popState.search.trim().toLowerCase();
  const target = q ? values.filter(v => String(v).toLowerCase().includes(q)) : values;
  if (sel) target.forEach(v => _popState.draft.add(v));
  else target.forEach(v => _popState.draft.delete(v));
  renderFilterPopoverBody();
};
window._crFilterApply = function () {
  if (!_popState) return;
  const { key, draft } = _popState;
  const values = distinctValuesFor(key);
  // ถ้าเลือกครบทุกค่า หรือไม่เลือกอะไรเลย = ไม่กรอง (เก็บเป็น state ว่าง)
  if (draft.size === 0 || draft.size === values.length) delete state.filters[key];
  else state.filters[key] = new Set(draft);
  closeFilterPopover();
  renderPreview();
};
window._crFilterClear = function () {
  if (!_popState) return;
  delete state.filters[_popState.key];
  closeFilterPopover();
  renderPreview();
};

// คลิกคอลัมน์ → cycle: (ไม่อยู่ใน chain) เพิ่มเข้าท้าย asc → desc → ลบออก
window.sortBy = function (key) {
  if (!COL_BY_KEY[key]) return;
  const i = state.sort.findIndex(s => s.key === key);
  if (i < 0) state.sort.push({ key, dir: 1 });
  else if (state.sort[i].dir === 1) state.sort[i].dir = -1;
  else state.sort.splice(i, 1);
  renderPreview();
};

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
  const rows = getRows();
  const expanded = expandedPax();
  const hasFilter = Object.values(state.filters).some(s => s && s.size);
  const splitNote = expanded.length !== state.pax.length ? ` (แยกตามโรงแรม ${expanded.length} แถว)` : "";
  const filterNote = hasFilter ? ` · 🔽 หลัง filter ${rows.length} แถว` : "";
  count.textContent = `· ${state.pax.length} คน${splitNote}${filterNote} · ${cols.length} คอลัมน์`;
  const multi = state.sort.length > 1;
  document.getElementById("crThead").innerHTML =
    `<th style="width:40px">#</th>` + cols.map(c => {
      const idx = state.sort.findIndex(s => s.key === c.key);
      const active = idx >= 0;
      const arrow = active ? (state.sort[idx].dir === 1 ? "▲" : "▼") : "";
      const badge = active && multi
        ? ` <span style="display:inline-block;min-width:14px;padding:0 4px;background:var(--accent);color:#fff;border-radius:7px;font-size:9.5px;font-weight:700;line-height:13px;vertical-align:1px">${idx + 1}</span>`
        : "";
      const ind = active ? ` ${arrow}${badge}` : ` <span style="opacity:.3">↕</span>`;
      const baseTip = c.key === "pin" ? "เรียงตามชั้นยศ SVP→VP→AVP→SD→DR — " : "";
      const sortTip = `${baseTip}คลิก: asc → desc → ลบออก · กดหลายคอลัมน์ = multi-sort (ลำดับ priority ตามลำดับการกด)`;
      const canFilter = isFilterable(c.key);
      const fActive = state.filters[c.key] && state.filters[c.key].size > 0;
      const fBtn = canFilter
        ? `<button class="cr-th-fbtn${fActive ? " active" : ""}"
            title="${fActive ? "filter: " + state.filters[c.key].size + " ค่า — คลิกเพื่อแก้/ล้าง" : "กรองค่า"}"
            onclick="event.stopPropagation();window.openFilter('${c.key}',this)">🔽</button>`
        : "";
      return `<th style="user-select:none">
        <div class="cr-th-flex">
          <span class="cr-th-lbl" title="${escapeHtml(sortTip)}"
            onclick="window.sortBy('${c.key}')">${escapeHtml(c.label)}${ind}</span>
          ${fBtn}
        </div>
      </th>`;
    }).join("");
  document.getElementById("crTbody").innerHTML = rows.map((row, i) =>
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
  else if (!checked && idx >= 0) {
    state.selected.splice(idx, 1);
    delete state.filters[key]; // ทิ้ง filter ของคอลัมน์ที่ถูกเอาออก
  }
  if (typeof closeFilterPopover === "function") closeFilterPopover();
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
  // ทิ้ง filter ของคอลัมน์ที่ไม่อยู่ใน preset
  Object.keys(state.filters).forEach(k => {
    if (!state.selected.includes(k)) delete state.filters[k];
  });
  if (typeof closeFilterPopover === "function") closeFilterPopover();
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
  const data = getRows().map(row => {
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
  const rows = getRows();
  const tbody = rows.map((row, i) =>
    `<tr><td>${i + 1}</td>` +
    cols.map(c => `<td>${escapeHtml(cellValue(row, c))}</td>`).join("") +
    `</tr>`).join("");
  const gen = new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
  const extra = rows.length !== state.pax.length ? ` · ${rows.length} แถว (แยกตามโรงแรม)` : "";
  document.getElementById("cr-print-area").innerHTML = `
    <div class="cr-print-title">📊 Custom Report — ${escapeHtml(tripTitle())}${dates}</div>
    <div class="cr-print-sub">${state.pax.length} คน${extra} · ${cols.length} คอลัมน์ · พิมพ์เมื่อ ${gen}</div>
    <table><thead><tr>${thead}</tr></thead><tbody>${tbody ||
      `<tr><td colspan="${cols.length + 1}" style="text-align:center;color:#94a3b8">ไม่มีข้อมูล</td></tr>`
    }</tbody></table>`;
  showToast("เปิดหน้าต่าง print — เลือก 'Save as PDF' ได้", "info");
  setTimeout(() => window.print(), 80);
};

// ── BOOT ───────────────────────────────────────────────────
init();
