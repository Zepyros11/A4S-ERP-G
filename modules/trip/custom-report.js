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
// คอลัมน์กลุ่ม "checkseat" + "detail" (src:"pax") ดึงจาก catalog กลาง
// (js/shared/pax-fields.js) → เพิ่มคอลัมน์ใหม่ที่ catalog ที่เดียวก็โผล่ที่นี่เอง
// กลุ่ม calc (ห้อง/รถ/บิน/ทีม) ยัง hardcode เพราะเป็นค่าที่ join/คำนวณเอง
const COLUMN_GROUPS = [
  {
    id: "checkseat", label: "🪑 Check Seat",
    cols: window.PaxFields.crCols("checkseat"),
  },
  {
    id: "room", label: "🛏️ ห้องพัก",
    cols: [
      { key: "_hotel",    label: "โรงแรม",       src: "calc" },
      { key: "_room",     label: "ชื่อห้อง",      src: "calc" },
      { key: "_checkin",  label: "เช็คอิน",       src: "calc" },
      { key: "_checkout", label: "เช็คเอาท์",     src: "calc" },
    ],
  },
  {
    id: "bus", label: "🚌 รถบัส",
    cols: [
      { key: "_bus",      label: "รถบัส",         src: "calc" },
      { key: "_busseat",  label: "ที่นั่งรถบัส",   src: "calc" },
    ],
  },
  {
    id: "flight", label: "✈️ เครื่องบิน",
    cols: [
      { key: "_flticket",     label: "ตั๋วเครื่องบิน",   src: "calc" },
      { key: "_flflight",     label: "Flight (ขาไป)",    src: "calc" },
      { key: "_flport",       label: "Port",             src: "calc" },
      { key: "_fldep",        label: "ออก (Departure)",  src: "calc" },
      { key: "_flarr",        label: "ถึง (Arrival)",    src: "calc" },
      { key: "_flcomeback",   label: "Flight (ขากลับ)",  src: "calc" },
      { key: "_flcomebackdt", label: "วันเวลากลับ",      src: "calc" },
    ],
  },
  {
    id: "detail", label: "📋 Detail",
    cols: window.PaxFields.crCols("detail"),
  },
  {
    id: "team", label: "👔 ทีมงาน",
    cols: [
      { key: "_teamtype",   label: "ประเภท",          src: "calc" },  // Staff/ไกด์/Outsource (ทีมงานเท่านั้น)
      { key: "_role_title", label: "ตำแหน่งทีม",      src: "calc" },
      { key: "_languages",  label: "ภาษา (ทีม)",      src: "calc" },
      { key: "_team_phone", label: "เบอร์ทีม",        src: "calc" },
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
  merged: {},      // col key -> true ถ้าเปิด "ผสานเซลซ้ำ" (rowspan แถวที่ติดกันค่าเท่ากัน)
  hidden: {},      // col key -> true ถ้า "ซ่อนจากรายงาน" (ยังใช้เรียง/กรอง แต่ไม่ออกใน Print/Excel/PDF)
  rowsPerPage: "auto",  // print: แถวต่อ A4 (table mode) — "auto" | number
  cardsPerPage: 2, // print: การ์ดต่อ A4 (card mode)
  orientation: "landscape", // print: landscape | portrait
  layout: "table", // "table" | "card" — รูปแบบรายงาน
  cardFieldPos: "top", // card mode: ตำแหน่งกล่องข้อมูลในการ์ด — "top" | "center" | "bottom"
  groupBy: "",     // "" = ไม่แบ่ง · "_flightseg" = ช่วงเที่ยวบิน · หรือ column key ที่เลือก
  showTotal: false, // แสดงแถว Total ท้ายแต่ละกลุ่ม + grand total
  flightById: {},  // flight_id -> trip_flights record (ใช้สร้างหัวกลุ่มช่วงเที่ยวบิน)
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

// ── i18n helper ────────────────────────────────────────────
// T(key) / T(key,"ไทย fallback") / T(key,{n:..}) — ดู js/core/i18n.js
const T = (k, opt) => (window.I18n ? window.I18n.t(k, opt) : (typeof opt === "string" ? opt : k));
// label คอลัมน์/กลุ่ม — ใช้คำแปลถ้ามี ไม่งั้น fallback เป็น label เดิม (ไทย) ใน COLUMN_GROUPS
// label: lang pack (cr.col.*) ชนะก่อน → ไม่งั้น fallback เป็น en/th จาก catalog
function colLabel(c) {
  const fallback = (curLang() === "en" && c.en) ? c.en : c.label;
  return T("cr.col." + c.key, fallback);
}
function grpLabel(g) { return T("cr.grp." + g.id, g.label); }
function curLang() { return window.I18n ? window.I18n.getLang() : "th"; }

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
    showToast(T("cr.toast.noTripId"), "error");
    setTimeout(() => (location.href = "./trip-list.html"), 1500);
    return;
  }
  state.tripId = tid;
  const { url, key } = getSB();
  if (!url || !key) {
    showLoading(false);
    showToast(T("cr.toast.noSupabase"), "error");
    return;
  }
  await loadAll();
}

async function loadAll() {
  showLoading(true);
  try {
    const [trip, pax, rooms, buses, flights, templates, team, memberTypes] = await Promise.all([
      sbFetch("trips", `?trip_id=eq.${state.tripId}&select=trip_id,trip_name,start_date,end_date`).then(r => r?.[0] || null),
      sbFetch("tour_seat_check", `?trip_id=eq.${state.tripId}&select=*&order=group_name.asc.nullslast,name.asc`),
      sbFetch("trip_rooms", `?trip_id=eq.${state.tripId}&select=room_id,room_name,place_id,check_in_date,check_out_date`),
      sbFetch("trip_buses", `?trip_id=eq.${state.tripId}&select=bus_id,bus_no,bus_label`).catch(() => []),
      sbFetch("trip_flights", `?trip_id=eq.${state.tripId}&select=*`).catch(() => []),
      sbFetch("trip_report_templates", "?select=*&order=name.asc").catch(() => []),
      sbFetch("trip_guides", `?trip_id=eq.${state.tripId}&select=*&order=sort_order.asc,guide_id.asc`).catch(() => []),
      sbFetch("member_types", "?select=type_key,label,emoji&order=sort_order.asc").catch(() => []),
    ]);
    state.trip = trip;
    // member_type → label map สำหรับแสดงประเภททีมงานใน report
    state.memberTypeLabel = {};
    (memberTypes || []).forEach(mt => {
      state.memberTypeLabel[mt.type_key] = (mt.emoji ? mt.emoji + " " : "") + (mt.label || mt.type_key);
    });
    // รวมทุกแถว (parent + sub-row) — 1 แถว = 1 ที่นั่ง เหมือน check-seat/room-assign
    // sub-row สืบทอดจาก parent "เฉพาะ field ระบุตัวตน" (ชื่อ/เพศ/สัญชาติ) เผื่อแถวว่างเปล่า
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
    // เพิ่มแถวทีมงาน (Staff/ไกด์/Outsource) ต่อท้าย — code = "g:<guide_id>"
    // ฟิลด์ลูกค้าที่ไม่เกี่ยว (passport, gender, ฯลฯ) เว้นว่าง — โชว์เฉพาะ ชื่อ + ประเภท
    const teamRows = (team || []).map(g => ({
      code: `g:${g.guide_id}`,
      name: g.full_name || "",
      __isTeam: true,
      __memberType: g.member_type || "",
      // เก็บฟิลด์ทีม raw ไว้เผื่อใช้ใน future columns (role/lang/phone)
      role_title: g.role_title || "",
      languages: g.languages || "",
      phone: g.phone || "",
      whatsapp: g.whatsapp || "",
      line_id: g.line_id || "",
    }));
    state.pax = [...allRows, ...teamRows];
    state.teamCount = teamRows.length;
    state.paxCount  = allRows.length;
    state.templates = templates || [];

    await buildCalc(rooms || [], buses || [], flights || []);

    renderTripBanner();
    renderTemplates();
    renderPicker();
    renderAll();
  } catch (e) {
    showToast(T("cr.toast.loadFail", { msg: e.message }), "error");
  }
  showLoading(false);
}

// สร้าง state.calc[code] — join ห้องพัก/รถ ให้แต่ละคน
async function buildCalc(rooms, buses, flights = []) {
  const roomIds = rooms.map(r => r.room_id);
  const busIds = buses.map(b => b.bus_id);
  const flightIds = flights.map(f => f.flight_id);
  const [roomOccs, busOccs, flightTks, places] = await Promise.all([
    roomIds.length
      ? sbFetch("trip_room_occupants", `?room_id=in.(${roomIds.join(",")})&select=room_id,code`)
      : Promise.resolve([]),
    busIds.length
      ? sbFetch("trip_bus_occupants", `?bus_id=in.(${busIds.join(",")})&select=bus_id,seat_no,code`)
      : Promise.resolve([]),
    flightIds.length
      ? sbFetch("trip_flight_tickets", `?flight_id=in.(${flightIds.join(",")})&select=ticket_id,flight_id`).catch(() => [])
      : Promise.resolve([]),
    sbFetch("places", "?place_type=eq.HOTEL&select=place_id,place_name").catch(() => []),
  ]);
  // คน 1 Ticket มีได้หลายคน → ดึง occupant ต่อ ticket แล้ว map code → flight
  const ticketToFlight = {};
  (flightTks || []).forEach(t => { ticketToFlight[t.ticket_id] = t.flight_id; });
  const ticketIds = (flightTks || []).map(t => t.ticket_id);
  const flightOccs = ticketIds.length
    ? (await sbFetch("trip_flight_ticket_occupants",
        `?ticket_id=in.(${ticketIds.join(",")})&select=ticket_id,code`).catch(() => []) || [])
        .map(o => ({ flight_id: ticketToFlight[o.ticket_id], code: o.code }))
    : [];

  const roomById = {};
  rooms.forEach(r => { roomById[r.room_id] = r; });
  const placeById = {};
  (places || []).forEach(p => { placeById[p.place_id] = p.place_name; });
  const busById = {};
  buses.forEach(b => { busById[b.bus_id] = b; });
  const flightById = {};
  flights.forEach(f => { flightById[f.flight_id] = f; });
  state.flightById = flightById; // เก็บไว้สร้างหัวกลุ่ม "ช่วงเที่ยวบิน"

  const codeRooms = {}; // code -> [room]
  (roomOccs || []).forEach(o => {
    const r = roomById[o.room_id];
    if (r) (codeRooms[o.code] = codeRooms[o.code] || []).push(r);
  });
  const codeBus = {}; // code -> { bus, seat }
  (busOccs || []).forEach(o => {
    if (busById[o.bus_id]) codeBus[o.code] = { bus: busById[o.bus_id], seat: o.seat_no };
  });
  const codeFlight = {}; // code -> flight record
  (flightOccs || []).forEach(o => {
    if (flightById[o.flight_id]) codeFlight[o.code] = flightById[o.flight_id];
  });
  const fmtDTcell = (s) => s ? String(s).replace("T", " ") : "";

  state.calc = {};
  state.pax.forEach(p => {
    const rs = (codeRooms[p.code] || []).slice()
      .sort((a, b) => (a.room_name || "").localeCompare(b.room_name || "", undefined, { numeric: true }));
    const uniq = arr => [...new Set(arr.filter(Boolean))];
    const bus = codeBus[p.code];
    const fl = codeFlight[p.code];

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
      _bus:      bus ? (bus.bus.bus_label || T("cr.bus.no", { n: bus.bus.bus_no || "?" })) : "",
      _busseat:  bus ? String(bus.seat ?? "") : "",
      _flticket:     fl ? (fl.flight_label || fl.flight || T("cr.flight.ticketNo", { id: fl.flight_id })) : "",
      _flflight:     fl ? (fl.flight || "") : "",
      _flport:       fl ? (fl.port || p.port || "") : "",
      _fldep:        fl ? fmtDTcell(fl.departure_datetime) : "",
      _flarr:        fl ? fmtDTcell(fl.arrival_datetime) : "",
      _flcomeback:   fl ? (fl.comeback || "") : "",
      _flcomebackdt: fl ? fmtDTcell(fl.comeback_datetime) : "",
      _flid:     fl ? fl.flight_id : null, // group key ของ "ช่วงเที่ยวบิน"
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
  if (!wrap) { console.warn("[picker] #crPicker not found"); return; }
  wrap.innerHTML = COLUMN_GROUPS.map(g => {
    const opts = g.cols.map(c => `
      <label class="cr-opt">
        <input type="checkbox" value="${c.key}" ${state.selected.includes(c.key) ? "checked" : ""}
          onchange="window.toggleColumn('${c.key}', this.checked)">
        <span>${escapeHtml(colLabel(c))}</span>
      </label>`).join("");
    return `<div class="cr-group${state.collapsed[g.id] ? " collapsed" : ""}" data-gid="${escapeHtml(g.id)}">
      <div class="cr-group-hdr" data-toggle-gid="${escapeHtml(g.id)}" onclick="window.crToggleGroup('${escapeHtml(g.id)}')">
        <span>${escapeHtml(grpLabel(g))}</span>
        <span class="cr-group-caret">${state.collapsed[g.id] ? "▸" : "▾"}</span>
      </div>
      <div class="cr-group-body">${opts}</div>
    </div>`;
  }).join("");
}
// Note: inline onclick="window.crToggleGroup(...)" ใน renderPicker จัดการคลิกเอง
// (เคยใส่ document capture listener ที่นี่ → double-toggle กลับเป็นเดิมทันที — ลบทิ้งแล้ว)

function renderChips() {
  const wrap = document.getElementById("crChips");
  if (!state.selected.length) { wrap.innerHTML = ""; return; }
  wrap.innerHTML = state.selected.map((k, i) => {
    const c = COL_BY_KEY[k];
    if (!c) return "";
    const hidden = !!state.hidden[k];
    return `<span class="cr-chip${hidden ? " cr-chip-hidden" : ""}">
      <button class="cr-chip-move" title="${escapeHtml(T("cr.chip.moveLeft"))}" onclick="window.moveColumn('${k}',-1)"
        ${i === 0 ? "disabled style='opacity:.25'" : ""}>◀</button>
      ${escapeHtml(colLabel(c))}
      <button class="cr-chip-move" title="${escapeHtml(T("cr.chip.moveRight"))}" onclick="window.moveColumn('${k}',1)"
        ${i === state.selected.length - 1 ? "disabled style='opacity:.25'" : ""}>▶</button>
      <button class="cr-chip-eye" onclick="window.toggleHideColumn('${k}')"
        title="${escapeHtml(hidden ? T("cr.chip.hideTip") : T("cr.chip.showTip"))}">${hidden ? "🙈" : "👁"}</button>
      <button title="${escapeHtml(T("cr.chip.remove"))}" onclick="window.toggleColumn('${k}', false)">✕</button>
    </span>`;
  }).join("");
}

function cellValue(row, col) {
  if (col.src === "calc") {
    // virtual columns ของทีมงาน — โชว์ค่าเฉพาะ row ที่เป็นทีมงาน
    if (col.key === "_teamtype") {
      if (!row.__isTeam) return "";
      return state.memberTypeLabel?.[row.__memberType] || row.__memberType || T("cr.team.default");
    }
    if (col.key === "_role_title") return row.__isTeam ? (row.role_title || "") : "";
    if (col.key === "_languages")  return row.__isTeam ? (row.languages || "") : "";
    if (col.key === "_team_phone") {
      if (!row.__isTeam) return "";
      return [row.phone, row.whatsapp, row.line_id].filter(Boolean).join(" · ");
    }
    if (row.__stay && col.key in row.__stay) return row.__stay[col.key];
    return state.calc[row.code]?.[col.key] || "";
  }
  // ทีมงาน — column ของลูกค้า (passport/gender/pin/etc) คืน "" ทั้งหมด เพราะไม่เกี่ยว
  // ยกเว้น name (set ไว้แล้วใน loadAll) และ code (มี "g:<id>" — แสดงก็ได้)
  if (row.__isTeam) {
    const passOnly = ["name", "code"];
    if (!passOnly.includes(col.key)) return "";
  }
  let v = row[col.key];
  if (v == null || v === "") return "";
  if (col.fmt === "date") return fmtDate(v);
  if (col.fmt === "gender") {
    const g = String(v).toLowerCase();
    return g === "male" ? T("cr.gender.male") : g === "female" ? T("cr.gender.female") : String(v);
  }
  // image → คืน URL ดิบ (ใช้ทั้ง Excel/Print/preview แต่ preview จะ render เป็น <img>)
  if (col.fmt === "image") {
    const s = String(v).trim();
    return s.startsWith("http") ? s : "";  // ทิ้ง data: URL — แสดงไม่ได้ใน Excel
  }
  return String(v);
}

// render เซลเป็น HTML — image คอลัมน์แสดง thumbnail (click เปิดเต็ม); อื่นๆ escape ปกติ
function cellHtml(row, col) {
  const v = cellValue(row, col);
  if (!v) return "";
  if (col.fmt === "image") {
    const u = escapeHtml(v);
    return `<img src="${u}" alt="" class="cr-img-thumb" loading="lazy"
      title="${escapeHtml(T("cr.img.zoomTip"))}" onclick="window.crOpenImg(this)">`;
  }
  return escapeHtml(v);
}

// ค่าใช้เปรียบเทียบตอน sort — pin ใช้ rank, date ใช้ค่า ISO ดิบ, อื่นๆ ใช้ string
function sortValue(row, col) {
  if (col.key === "pin") return pinRank(row.pin);
  if (col.src === "pax" && col.fmt === "date") return row[col.key] || ""; // ISO → string sort ถูก
  return cellValue(row, col).toLowerCase();
}

// sentinel แทน "ค่าว่าง" ใน filter set — ใช้ string ที่ไม่น่าซ้ำกับข้อมูลจริง
const BLANK_VAL = "__BLANK__";
// sentinel สำหรับคอลัมน์รูป (image) — filter แบบ binary: มีภาพ / ไม่มีภาพ
// (URL รูปแต่ละใบไม่ซ้ำกัน → กรองตาม URL ไม่มีประโยชน์ จึงยุบเป็น 2 ตัวเลือก)
const HAS_IMG_VAL = "__HAS_IMG__";
// ป้าย "(ว่าง)" — เป็น function เพราะต้องเปลี่ยนตามภาษาปัจจุบัน
function blankLabel() { return T("cr.blank"); }

// คืน distinct values ของคอลัมน์ — ใช้ทั้งเช็คว่ามี filter ได้ไหม + populate dropdown
// คำนวณจาก expandedPax (ก่อน apply filter) เพื่อให้เห็นทุก option เสมอ
// ถ้าคอลัมน์มีแถวที่ค่าว่าง → ใส่ BLANK_VAL ไว้ท้าย list ให้ filter ได้ด้วย
// คอลัมน์รูป → ยุบเป็น 2 ตัวเลือก: HAS_IMG_VAL (มีภาพ) + BLANK_VAL (ไม่มีภาพ)
function distinctValuesFor(key) {
  const col = COL_BY_KEY[key];
  if (!col) return [];
  if (col.fmt === "image") {
    let hasImg = false, hasBlank = false;
    expandedPax().forEach(row => {
      if (cellValue(row, col)) hasImg = true; else hasBlank = true;
    });
    const arr = [];
    if (hasImg) arr.push(HAS_IMG_VAL);
    if (hasBlank) arr.push(BLANK_VAL);
    return arr;
  }
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
// ปุ่ม 🔽 header แสดงเมื่อ: filter ใช้ได้ (2..50 distinct) "หรือ" คอลัมน์มีค่าซ้ำ (n < rows)
// — ให้ผู้ใช้กดเปิด popover เพื่อใช้ "ผสานเซล" ได้แม้ distinct จะเยอะเกิน 50
function hasFilterButton(key) {
  const n = distinctValuesFor(key).length;
  if (n < 2) return false;
  if (n <= FILTER_MAX_DISTINCT) return true;
  return n < expandedPax().length;
}
// คอลัมน์ "ผสานเซลได้" = อย่างน้อยมี 1 ค่าซ้ำใน rows (n < rows count)
function isMergeable(key) {
  const n = distinctValuesFor(key).length;
  if (n < 2) return false;
  return n < expandedPax().length;
}

// คำนวณ rowspan ของแต่ละเซลเมื่อเปิด merge
// hierarchical: คอลัมน์ขวาผสานต่อได้ก็ต่อเมื่อคอลัมน์ "ที่ merge อยู่" ทางซ้ายค่ายังเท่ากันด้วย
// คืน: rowspans[colIdx][rowIdx] = N (>=1 = render cell with rowspan, 0 = skip cell)
function computeRowspans(rows, cols) {
  const rs = cols.map(() => new Array(rows.length).fill(1));
  cols.forEach((c, ci) => {
    if (!state.merged[c.key]) return;
    let r = 0;
    while (r < rows.length) {
      let end = r + 1;
      while (end < rows.length) {
        if (cellValue(rows[end], c) !== cellValue(rows[r], c)) break;
        // เคารพ boundary ของคอลัมน์ merge ทางซ้าย (ถ้าทางซ้ายเปลี่ยนกลุ่ม → ตัด)
        let groupBreak = false;
        for (let pj = 0; pj < ci; pj++) {
          const pc = cols[pj];
          if (state.merged[pc.key] && cellValue(rows[end], pc) !== cellValue(rows[r], pc)) {
            groupBreak = true; break;
          }
        }
        if (groupBreak) break;
        end++;
      }
      const span = end - r;
      rs[ci][r] = span;
      for (let k = r + 1; k < end; k++) rs[ci][k] = 0;
      r = end;
    }
  });
  return rs;
}

function filterRows(rows) {
  const active = Object.entries(state.filters).filter(([_, s]) => s && s.size);
  if (!active.length) return rows;
  return rows.filter(row =>
    active.every(([key, set]) => {
      const col = COL_BY_KEY[key];
      if (!col) return true;
      const v = cellValue(row, col);
      // คอลัมน์รูป: เทียบ binary มีภาพ/ไม่มีภาพ (ไม่เทียบ URL)
      if (col.fmt === "image") return set.has(v ? HAS_IMG_VAL : BLANK_VAL);
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

// ── GROUPING (แบ่ง section + Total) ────────────────────────
// groupBy: "" = ไม่แบ่ง · "_flightseg" = ตามช่วงเที่ยวบิน · หรือ column key
// คืน group key ของแถว — null ถ้าไม่แบ่ง
function groupKeyOf(row) {
  if (!state.groupBy) return null;
  if (state.groupBy === "_flightseg") {
    const k = state.calc[row.code]?._flid;
    return k != null ? "f:" + k : "f:none";
  }
  const col = COL_BY_KEY[state.groupBy];
  if (!col) return null;
  const v = cellValue(row, col);
  return "v:" + (v || BLANK_VAL);
}
// หัวกลุ่มช่วงเที่ยวบิน (ใช้ trip_flights record) — รูปแบบเหมือนจดหมายขออนุมัติตั๋ว
function flightSegHeader(flid) {
  const en = curLang() === "en";
  if (flid === "none") return en ? "✈️ No flight assigned" : "✈️ ยังไม่กำหนดเที่ยวบิน";
  const fl = state.flightById[flid];
  if (!fl) return en ? "✈️ Flight" : "✈️ เที่ยวบิน";
  const dep = fl.departure_datetime ? fmtDate(fl.departure_datetime) : "";
  const ret = fl.comeback_datetime ? fmtDate(fl.comeback_datetime) : "";
  const port = fl.port || "";
  const out = fl.flight || "";
  const back = fl.comeback || "";
  const l1 = `${en ? "Departure flight from" : "เที่ยวบินขาไป"} ${escapeHtml(port)}${out ? " " + escapeHtml(out) : ""}${dep ? ` : ${en ? "Date" : "วันที่"} ${escapeHtml(dep)}` : ""}`;
  const l2 = `${en ? "Return flight" : "เที่ยวบินขากลับ"}${back ? " " + escapeHtml(back) : ""}${ret ? ` : ${en ? "Date" : "วันที่"} ${escapeHtml(ret)}` : ""}`;
  return `${l1}<br>${l2}`;
}
// หัวกลุ่ม (label) ของ key
function groupHeaderHtml(key) {
  if (state.groupBy === "_flightseg") return flightSegHeader(key.slice(2));
  const col = COL_BY_KEY[state.groupBy];
  const raw = key.slice(2);
  const val = raw === BLANK_VAL ? blankLabel() : raw;
  return `${escapeHtml(col ? colLabel(col) : "")}: ${escapeHtml(val)}`;
}
// แบ่ง rows เป็นกลุ่ม — รักษาลำดับ row เดิม (sorted) ภายในกลุ่ม
// คืน [{ key, headerHtml, rows }]  · ถ้าไม่แบ่ง → [{ key:null, headerHtml:"", rows }]
function getGroups(rows) {
  if (!state.groupBy) return [{ key: null, headerHtml: "", rows }];
  const order = [];
  const byKey = new Map();
  rows.forEach(r => {
    const k = groupKeyOf(r);
    if (!byKey.has(k)) { byKey.set(k, []); order.push(k); }
    byKey.get(k).push(r);
  });
  return order.map(k => ({ key: k, headerHtml: groupHeaderHtml(k), rows: byKey.get(k) }));
}
// ป้าย "Total N seats" / "รวม N ที่นั่ง"
function totalLabel(n) {
  return curLang() === "en" ? `Total ${n} seats` : `รวม ${n} ที่นั่ง`;
}

window.setGroupBy = function (v) {
  state.groupBy = v || "";
  renderPreview();
};
window.setShowTotal = function (on) {
  state.showTotal = !!on;
  renderPreview();
};
// เติม <option> ของ dropdown group-by ตามคอลัมน์ที่เลือกอยู่ (+ ช่วงเที่ยวบิน)
function renderGroupBy() {
  const sel = document.getElementById("crGroupBy");
  if (!sel) return;
  const en = curLang() === "en";
  const cur = state.groupBy;
  const opts = [`<option value="">${en ? "— No grouping —" : "— ไม่แบ่งกลุ่ม —"}</option>`,
    `<option value="_flightseg">${en ? "✈️ By flight segment" : "✈️ ตามช่วงเที่ยวบิน"}</option>`];
  state.selected.forEach(k => {
    const c = COL_BY_KEY[k];
    if (c) opts.push(`<option value="${escapeHtml(k)}">${escapeHtml(colLabel(c))}</option>`);
  });
  sel.innerHTML = opts.join("");
  // ถ้า groupBy เดิมเป็นคอลัมน์ที่ถูกเอาออก → reset
  if (cur && cur !== "_flightseg" && !state.selected.includes(cur)) state.groupBy = "";
  sel.value = state.groupBy;
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
    ? values.filter(v => (v === BLANK_VAL ? blankLabel() : String(v)).toLowerCase().includes(q))
    : values;
  const listEl = _popState.el.querySelector(".cr-fpop-list");
  if (!shown.length) {
    listEl.innerHTML = `<div class="cr-fpop-empty">${escapeHtml(T("cr.fpop.notFound"))}</div>`;
    return;
  }
  const isImgCol = COL_BY_KEY[key]?.fmt === "image";
  listEl.innerHTML = shown.map(v => {
    const id = "_crf_" + Math.random().toString(36).slice(2, 9);
    const checked = draft.has(v) ? "checked" : "";
    const isBlank = v === BLANK_VAL;
    let display;
    if (v === HAS_IMG_VAL) display = `<span>${escapeHtml(T("cr.img.has"))}</span>`;
    else if (isBlank) display = `<span style="font-style:italic;color:var(--text3)">${escapeHtml(isImgCol ? T("cr.img.none") : blankLabel())}</span>`;
    else display = `<span>${escapeHtml(v)}</span>`;
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
  const canFilter = isFilterable(key);
  const canMerge  = isMergeable(key);
  const mergeChecked = !!state.merged[key] ? "checked" : "";
  const el = document.createElement("div");
  el.className = "cr-fpop";
  const mergeBlock = canMerge ? `
    <label class="cr-fpop-merge" title="${escapeHtml(T("cr.fpop.mergeTitle"))}">
      <input type="checkbox" ${mergeChecked} onchange="window._crMergeToggle(this.checked)">
      <span>${escapeHtml(T("cr.fpop.merge"))}</span>
    </label>` : "";
  const filterBlock = canFilter ? `
    <input class="cr-fpop-search" type="search" placeholder="${escapeHtml(T("cr.fpop.searchPh"))}" oninput="window._crFilterSearch(this.value)">
    <div class="cr-fpop-acts">
      <button onclick="window._crFilterAll(true)">${escapeHtml(T("cr.fpop.selectAll"))}</button>
      <button onclick="window._crFilterAll(false)">${escapeHtml(T("cr.fpop.clear"))}</button>
    </div>
    <div class="cr-fpop-list"></div>
    <div class="cr-fpop-foot">
      <button onclick="window._crFilterClear()">${escapeHtml(T("cr.fpop.removeFilter"))}</button>
      <button class="primary" onclick="window._crFilterApply()">${escapeHtml(T("cr.fpop.apply"))}</button>
    </div>` : `
    <div class="cr-fpop-msg">${escapeHtml(T("cr.fpop.tooMany", { n: FILTER_MAX_DISTINCT }))}
      ${canMerge ? "" : T("cr.fpop.noMerge")}
    </div>`;
  el.innerHTML = mergeBlock + (mergeBlock && canFilter ? `<div class="cr-fpop-divider"></div>` : "") + filterBlock;
  document.body.appendChild(el);
  _popState = {
    key, el, anchor: anchorEl, draft, search: "", canFilter,
    closer: (ev) => { if (!el.contains(ev.target) && ev.target !== anchorEl) closeFilterPopover(); },
    escCloser: (ev) => { if (ev.key === "Escape") closeFilterPopover(); },
    repos: repositionPopover,
  };
  document.addEventListener("mousedown", _popState.closer, true);
  document.addEventListener("keydown", _popState.escCloser, true);
  window.addEventListener("resize", _popState.repos, true);
  window.addEventListener("scroll", _popState.repos, true);
  if (canFilter) renderFilterPopoverBody();
  repositionPopover();
  el.querySelector(".cr-fpop-search")?.focus();
};
// merge toggle apply ทันที — ไม่ต้องกด "ใช้"
// เปิด merge → auto-sort คอลัมน์นั้นขึ้นหน้า sort chain เพื่อให้ค่าซ้ำมาติดกันแล้วผสานได้ครบ
// ปิด merge → คงตำแหน่ง sort เดิมไว้ (user ไปลบ sort เองได้)
window._crMergeToggle = function (on) {
  if (!_popState) return;
  if (on) state.merged[_popState.key] = true;
  else delete state.merged[_popState.key];
  rebuildSortForMerge();
  renderPreview();
};

// ดัน "คอลัมน์ merge" ทั้งหมดไปอยู่หน้า sort chain ตามลำดับใน state.selected (display order)
// — หลัก: rowspan เกิดได้เฉพาะแถวติดกัน → ต้อง sort by merged-col ก่อน
// — hierarchical: merged-col ที่อยู่ซ้ายใน display ต้องมา prio สูงกว่าใน sort เพื่อให้ boundary ใช้ได้
function rebuildSortForMerge() {
  const mergedKeys = state.selected.filter(k => state.merged[k]);
  const others = state.sort.filter(s => !state.merged[s.key]);
  const prefix = mergedKeys.map(k => {
    const existing = state.sort.find(s => s.key === k);
    return existing ? existing : { key: k, dir: 1 };
  });
  state.sort = [...prefix, ...others];
}
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
  // print settings (รูปแบบ/แถว-การ์ด/A4 + orientation) แสดงเมื่อมีคอลัมน์เลือก
  const ps = document.getElementById("crPrintSettings");
  if (ps) ps.style.display = cols.length ? "inline-flex" : "none";
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
  const splitNote = expanded.length !== state.pax.length ? ` ${T("cr.count.split", { n: expanded.length })}` : "";
  const filterNote = hasFilter ? ` · ${T("cr.count.filter", { n: rows.length })}` : "";
  const teamNote = state.teamCount ? ` ${T("cr.count.team", { n: state.teamCount })}` : "";
  const hiddenCount = cols.filter(c => state.hidden[c.key]).length;
  const hiddenNote = hiddenCount ? ` · ${T("cr.count.hidden", { n: hiddenCount })}` : "";
  count.textContent = `· ${T("cr.count.people", { n: state.paxCount || state.pax.length })}${teamNote}${splitNote}${filterNote} · ${T("cr.count.columns", { n: cols.length })}${hiddenNote}`;
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
      const baseTip = c.key === "pin" ? T("cr.th.pinTip") : "";
      const sortTip = `${baseTip}${T("cr.th.sortTip")}`;
      const showBtn = hasFilterButton(c.key);
      const fActive = state.filters[c.key] && state.filters[c.key].size > 0;
      const mActive = !!state.merged[c.key];
      const anyActive = fActive || mActive;
      const tipParts = [];
      if (fActive) tipParts.push(T("cr.th.filterCount", { n: state.filters[c.key].size }));
      if (mActive) tipParts.push(T("cr.th.mergeOn"));
      const fBtn = showBtn
        ? `<button class="cr-th-fbtn${anyActive ? " active" : ""}"
            title="${escapeHtml(tipParts.length ? tipParts.join(" · ") + T("cr.th.clickEdit") : T("cr.th.filterMergeTip"))}"
            onclick="event.stopPropagation();window.openFilter('${c.key}',this)">🔽${mActive ? '<span class="cr-th-mbadge">≣</span>' : ''}</button>`
        : "";
      const hidden = !!state.hidden[c.key];
      const eyeBtn = `<button class="cr-th-eye${hidden ? " off" : ""}"
        title="${escapeHtml(hidden ? T("cr.th.eyeHiddenTip") : T("cr.th.eyeShownTip"))}"
        onclick="event.stopPropagation();window.toggleHideColumn('${c.key}')">${hidden ? "🙈" : "👁"}</button>`;
      return `<th class="${hidden ? "cr-col-hidden" : ""}" style="user-select:none">
        <div class="cr-th-flex">
          <span class="cr-th-lbl" title="${escapeHtml(sortTip)}"
            onclick="window.sortBy('${c.key}')">${escapeHtml(colLabel(c))}${hidden ? ` <span class="cr-th-hidetag">${escapeHtml(T("cr.th.hideTag"))}</span>` : ''}${ind}</span>
          ${eyeBtn}${fBtn}
        </div>
      </th>`;
    }).join("");
  // group-aware tbody: หัวกลุ่ม + แถว (merge ภายในกลุ่ม) + Total ต่อกลุ่ม + grand total
  const groups = getGroups(rows);
  const span0 = cols.length + 1; // colspan เต็มแถว (# + ทุกคอลัมน์)
  const en = curLang() === "en";
  let html = "";
  groups.forEach(g => {
    if (g.key !== null) html += `<tr class="cr-grouphdr"><td colspan="${span0}">${g.headerHtml}</td></tr>`;
    const grsp = computeRowspans(g.rows, cols);
    g.rows.forEach((row, i) => {
      html += `<tr><td style="color:var(--text3)">${i + 1}</td>` +
        cols.map((c, ci) => {
          const span = grsp[ci][i];
          if (span === 0) return ""; // ถูกผสานเข้า cell ด้านบน
          const cls = (span > 1 ? "cr-merged " : "") + (c.fmt === "image" ? "cr-cell-img " : "") + (state.hidden[c.key] ? "cr-col-hidden" : "");
          const attrs = (span > 1 ? ` rowspan="${span}"` : "") + (cls.trim() ? ` class="${cls.trim()}"` : "");
          return `<td${attrs}>${cellHtml(row, c)}</td>`;
        }).join("") + `</tr>`;
    });
    if (state.showTotal) html += `<tr class="cr-totalrow"><td colspan="${span0}">${escapeHtml(totalLabel(g.rows.length))}</td></tr>`;
  });
  if (state.showTotal && state.groupBy && groups.length > 1) {
    html += `<tr class="cr-grandtotal"><td colspan="${span0}">${escapeHtml((en ? "Grand total " : "รวมทั้งหมด ") + rows.length + (en ? " seats" : " ที่นั่ง"))}</td></tr>`;
  }
  document.getElementById("crTbody").innerHTML = html;
}

function renderTemplates() {
  const sel = document.getElementById("presetSelect");
  const cur = sel.value;
  sel.innerHTML = `<option value="">${escapeHtml(T("cr.preset.placeholder"))}</option>` +
    state.templates.map(t =>
      `<option value="${t.template_id}">${escapeHtml(t.name)}</option>`).join("");
  if (cur && state.templates.some(t => String(t.template_id) === cur)) sel.value = cur;
}

function renderAll() {
  renderChips();
  renderGroupBy();
  renderPreview();
}

// ── COLUMN PICK ────────────────────────────────────────────
// ใช้ชื่อ crToggleGroup กันชนกับ sidebar.js ที่จอง window.toggleGroup ไว้ (load หลังไฟล์นี้)
window.crToggleGroup = function (gid) {
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
    delete state.merged[key];  // ทิ้ง merge ของคอลัมน์ที่ถูกเอาออก
    delete state.hidden[key];  // ทิ้งสถานะซ่อนของคอลัมน์ที่ถูกเอาออก
  }
  if (typeof closeFilterPopover === "function") closeFilterPopover();
  renderPicker();
  renderAll();
};
// 👁 ซ่อน/แสดงคอลัมน์ในรายงาน (Print/Excel/PDF) — ยังคงใช้เรียง/กรอง/ผสานได้
// ใช้กรณีต้องการ "เรียงตาม X แต่ไม่โชว์คอลัมน์ X" เช่น เรียงภาพตามรถบัส แต่ไม่เอาคอลัมน์รถบัส
window.toggleHideColumn = function (key) {
  if (!COL_BY_KEY[key]) return;
  if (state.hidden[key]) delete state.hidden[key];
  else state.hidden[key] = true;
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
  // ทิ้ง filter/merge ของคอลัมน์ที่ไม่อยู่ใน preset
  Object.keys(state.filters).forEach(k => {
    if (!state.selected.includes(k)) delete state.filters[k];
  });
  Object.keys(state.merged).forEach(k => {
    if (!state.selected.includes(k)) delete state.merged[k];
  });
  Object.keys(state.hidden).forEach(k => {
    if (!state.selected.includes(k)) delete state.hidden[k];
  });
  if (typeof closeFilterPopover === "function") closeFilterPopover();
  renderPicker();
  renderAll();
  showToast(T("cr.toast.presetApplied", { name: tpl.name }), "success");
};

window.savePreset = async function () {
  if (!state.selected.length) { showToast(T("cr.toast.selectColsSave"), "info"); return; }
  const name = await PromptModal.open({
    title: T("cr.prompt.saveTitle"),
    message: T("cr.prompt.saveMsg"),
    icon: "💾",
    okText: T("cr.btn.save"),
    cancelText: T("cr.btn.cancel"),
    placeholder: T("cr.prompt.savePlaceholder"),
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
      showToast(T("cr.toast.presetUpdated", { name: trimmed }), "success");
    } else {
      await sbFetch("trip_report_templates", "", { method: "POST", body });
      showToast(T("cr.toast.presetSaved", { name: trimmed }), "success");
    }
    state.templates = await sbFetch("trip_report_templates", "?select=*&order=name.asc");
    renderTemplates();
    const match = state.templates.find(t => t.name.toLowerCase() === trimmed.toLowerCase());
    if (match) document.getElementById("presetSelect").value = match.template_id;
  } catch (e) {
    showToast(T("cr.toast.saveFail", { msg: e.message }), "error");
  }
  showLoading(false);
};

window.deletePreset = async function () {
  const id = document.getElementById("presetSelect").value;
  if (!id) { showToast(T("cr.toast.selectPresetDelete"), "info"); return; }
  const tpl = state.templates.find(t => String(t.template_id) === String(id));
  if (!tpl) return;
  const ok = window.ConfirmModal?.open
    ? await window.ConfirmModal.open({
        title: T("cr.confirm.deleteTitle"),
        message: T("cr.confirm.deleteMsg", { name: tpl.name }),
        icon: "🗑", tone: "danger", okText: T("cr.btn.delete"),
      })
    : confirm(T("cr.confirm.deleteMsg", { name: tpl.name }));
  if (!ok) return;
  showLoading(true);
  try {
    await sbFetch("trip_report_templates", `?template_id=eq.${id}`, { method: "DELETE" });
    state.templates = state.templates.filter(t => String(t.template_id) !== String(id));
    renderTemplates();
    showToast(T("cr.toast.presetDeleted", { name: tpl.name }), "success");
  } catch (e) {
    showToast(T("cr.toast.deleteFail", { msg: e.message }), "error");
  }
  showLoading(false);
};

// ── EXPORT ─────────────────────────────────────────────────
function selectedCols() {
  return state.selected.map(k => COL_BY_KEY[k]).filter(Boolean);
}
// คอลัมน์ที่ "ออกในรายงานจริง" (Print/Excel/PDF/Card) — ตัดคอลัมน์ที่กดซ่อน 🙈 ออก
function outputCols() {
  return state.selected.map(k => COL_BY_KEY[k]).filter(c => c && !state.hidden[c.key]);
}
function tripTitle() {
  return state.trip?.trip_name || `Trip #${state.tripId}`;
}

window.exportReportExcel = function () {
  if (!state.selected.length) { showToast(T("cr.toast.selectColsExport"), "info"); return; }
  const cols = outputCols();
  if (!cols.length) { showToast(T("cr.toast.allHidden"), "info"); return; }
  if (typeof XLSX === "undefined") { showToast(T("cr.toast.xlsxLoading"), "error"); return; }
  if (state.layout === "card") {
    showToast(T("cr.toast.cardExcel"), "info");
  }
  const rows = getRows();
  const rspan = computeRowspans(rows, cols);
  // สร้าง AOA (header + data) — เซลที่ถูก merge ตั้งเป็น "" (เซลล่างใน merge range)
  const aoa = [cols.map(c => colLabel(c))];
  rows.forEach((row, i) => {
    aoa.push(cols.map((c, ci) => rspan[ci][i] === 0 ? "" : cellValue(row, c)));
  });
  if (!rows.length) aoa.push(cols.map(() => ""));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = cols.map(c => ({ wch: Math.max(colLabel(c).length + 2, 14) }));
  // merge ranges — header อยู่แถว 0, data เริ่มแถว 1
  const merges = [];
  cols.forEach((_, ci) => {
    rows.forEach((_, i) => {
      const span = rspan[ci][i];
      if (span > 1) {
        merges.push({ s: { r: i + 1, c: ci }, e: { r: i + span, c: ci } });
      }
    });
  });
  if (merges.length) ws["!merges"] = merges;
  const wb = XLSX.utils.book_new();
  const sheet = tripTitle().replace(/[\\\/\?\*\[\]:]/g, "_").slice(0, 31) || "Report";
  XLSX.utils.book_append_sheet(wb, ws, sheet);
  XLSX.writeFile(wb, `Custom-Report_${tripTitle().replace(/\s+/g, "-")}.xlsx`);
  showToast(T("cr.toast.excelDone"), "success");
};

window.setRowsPerPage = function (v) {
  if (v === "auto") { state.rowsPerPage = "auto"; return; }
  const n = parseInt(v, 10);
  state.rowsPerPage = (Number.isFinite(n) && n >= 1) ? n : "auto";
};

// แปลง state.rowsPerPage ("auto" | number) → จำนวน rows จริงต่อหน้า A4
// auto: เลือกตาม hasImage + orientation เพื่อให้หน้าเต็มโดยประมาณ
//   มีรูป  landscape  8 | portrait 12  (ต้องเผื่อพื้นที่ภาพ)
//   text ล้วน landscape 24 | portrait 38 (row สูง ~6mm แค่ตัวอักษร)
function resolveRowsPerPage(hasImage) {
  if (state.rowsPerPage !== "auto") {
    const n = parseInt(state.rowsPerPage, 10);
    return Number.isFinite(n) && n >= 1 ? n : 8;
  }
  const isLandscape = state.orientation === "landscape";
  if (hasImage) return isLandscape ? 8 : 12;
  return isLandscape ? 24 : 38;
}
window.setCardsPerPage = function (v) {
  const n = parseInt(v, 10);
  state.cardsPerPage = (Number.isFinite(n) && n >= 1) ? n : 2;
};
window.setCardFieldPos = function (v) {
  state.cardFieldPos = ["top", "center", "bottom"].includes(v) ? v : "top";
};
window.setOrientation = function (v) {
  state.orientation = (v === "portrait") ? "portrait" : "landscape";
};
window.setLayout = function (v) {
  state.layout = (v === "card") ? "card" : "table";
  // toggle ตัวเลือก แถว/A4 vs การ์ด/A4
  const rw = document.getElementById("crRowsPerPageWrap");
  const cw = document.getElementById("crCardsPerPageWrap");
  if (rw) rw.style.display = state.layout === "card" ? "none" : "";
  if (cw) cw.style.display = state.layout === "card" ? "" : "none";
};

// คำนวณ max-height/width ของภาพใน print ตาม rowsPerPage + orientation
// A4 landscape = 297×210mm, portrait = 210×297mm · margin 10mm รอบ · header ~22mm
function computePrintImgSize() {
  const isLandscape = state.orientation === "landscape";
  const pageH = isLandscape ? 210 : 297; // mm
  const pageW = isLandscape ? 297 : 210; // mm
  const usableH = pageH - 20 - 22;       // หัก margin + title/sub
  const usableW = pageW - 20;
  const rows = resolveRowsPerPage(true); // ถูกเรียกเฉพาะกรณีมี image col
  const rowH = usableH / rows;
  const imgH = Math.max(8, rowH - 3);
  const imgW = Math.min(usableW * 0.5, imgH * 1.5);
  return { imgH, imgW };
}

// คำนวณ grid layout ของ card mode: cols/rows ในหน้า + ขนาดภาพในแต่ละการ์ด
// cardsPerPage แตกเป็น (cols × rows) ตาม orientation:
//   1 → 1×1, 2 → 2×1 (landscape) หรือ 1×2 (portrait), 4 → 2×2, 6 → 3×2 (landscape) หรือ 2×3 (portrait)
function computeCardLayout() {
  const isLandscape = state.orientation === "landscape";
  const pageH = isLandscape ? 210 : 297;
  const pageW = isLandscape ? 297 : 210;
  const usableH = pageH - 16 - 14; // padding 8mm รอบ + title ~14mm
  const usableW = pageW - 16;
  const n = Math.max(1, state.cardsPerPage || 2);
  let cols, rows;
  if (n === 1) { cols = 1; rows = 1; }
  else if (n === 2) { cols = isLandscape ? 2 : 1; rows = isLandscape ? 1 : 2; }
  else if (n === 4) { cols = 2; rows = 2; }
  else { cols = isLandscape ? 3 : 2; rows = isLandscape ? 2 : 3; } // 6
  const cardW = (usableW - (cols - 1) * 4) / cols; // 4mm gap
  const cardH = (usableH - (rows - 1) * 4) / rows;
  // ภาพอยู่ขวาของการ์ด: ใช้พื้นที่ ~45% ของ cardW, สูงเกือบเต็ม cardH
  const imgW = Math.max(20, cardW * 0.45 - 6);
  const imgH = Math.max(20, cardH - 8);
  return { cols, rows, cardW, cardH, imgW, imgH };
}

// สร้าง HTML 1 การ์ด — ฝั่งซ้าย label:value ของคอลัมน์ที่ไม่ใช่ภาพ, ฝั่งขวา ภาพ stacked
// row ทีมงาน: ไม่มีภาพ → placeholder "— ไม่มีภาพ —" + badge ระบุประเภท
// กรณีพิเศษ: เลือกเฉพาะคอลัมน์ภาพ (ไม่มีฟิลด์ข้อความ) → ภาพเต็มการ์ด/เต็มหน้า ไม่มีช่องว่าง
function buildCardHtml(row, cols, idx) {
  const fieldCols = cols.filter(c => c.fmt !== "image");
  const imageCols = cols.filter(c => c.fmt === "image");
  const teamBadge = row.__isTeam
    ? `<span class="cr-pcard-team-badge">👔 ${escapeHtml(state.memberTypeLabel?.[row.__memberType] || T("cr.team.default"))}</span>`
    : "";

  // ── โหมดภาพเต็ม: ไม่มีฟิลด์ข้อความเลย → ภาพ fill การ์ดทั้งใบ (contain — โชว์ภาพครบไม่ครอป) ──
  if (!fieldCols.length && imageCols.length) {
    const n = imageCols.length;
    let imgs = imageCols.map(c => {
      const url = cellValue(row, c);
      if (!url) return "";
      return `<img src="${escapeHtml(url)}" alt="${escapeHtml(colLabel(c))}" loading="lazy"
        style="height:calc(var(--cr-card-full-h,60mm)/${n})">`;
    }).join("");
    if (!imgs) {
      imgs = `<div class="cr-pcard-img-placeholder">${escapeHtml(T("cr.card.noImage"))}${
        row.__isTeam ? `<br><span style="font-size:9px;opacity:.7">${escapeHtml(T("cr.team.default"))}</span>` : ""}</div>`;
    }
    return `<div class="cr-pcard cr-pcard-full${row.__isTeam ? " cr-pcard-team" : ""}">
      <span class="cr-pcard-full-num">#${idx}${teamBadge}</span>
      <div class="cr-pcard-full-imgs">${imgs}</div>
    </div>`;
  }

  const fieldsHtml = fieldCols.map(c => {
    const v = cellValue(row, c);
    if (!v) return ""; // ซ่อนค่าว่าง
    return `<div class="cr-pcard-field">
      <span class="cr-pcard-label">${escapeHtml(colLabel(c))}</span>
      <span class="cr-pcard-value">${escapeHtml(v)}</span>
    </div>`;
  }).join("");
  let imagesHtml = imageCols.map(c => {
    const url = cellValue(row, c);
    if (!url) return "";
    return `<img src="${escapeHtml(url)}" alt="${escapeHtml(colLabel(c))}" loading="lazy">`;
  }).join("");
  // ทีมงาน + เลือก image column แต่ไม่มีรูปจริง → placeholder
  if (!imagesHtml && imageCols.length && row.__isTeam) {
    imagesHtml = `<div class="cr-pcard-img-placeholder">${escapeHtml(T("cr.card.noImage"))}<br><span style="font-size:9px;opacity:.7">${escapeHtml(T("cr.team.default"))}</span></div>`;
  }
  const numBadge = `<span class="cr-pcard-label" style="min-width:auto;color:#94a3b8">#${idx}${teamBadge}</span>`;
  return `<div class="cr-pcard${row.__isTeam ? " cr-pcard-team" : ""}">
    <div class="cr-pcard-fields">${numBadge}${fieldsHtml}</div>
    ${imagesHtml ? `<div class="cr-pcard-images">${imagesHtml}</div>` : ""}
  </div>`;
}

// ตั้ง CSS vars ของ card mode บน element ที่ส่งมา
function applyCardStyles(targetEl) {
  const lay = computeCardLayout();
  targetEl.style.setProperty("--cr-card-cols", lay.cols);
  // ตำแหน่งกล่องข้อมูลในการ์ด (top/center/bottom) → justify-content ของ flex column
  const vpos = { top: "flex-start", center: "center", bottom: "flex-end" }[state.cardFieldPos] || "flex-start";
  targetEl.style.setProperty("--cr-card-vpos", vpos);
  targetEl.style.setProperty("--cr-card-img-h", `${lay.imgH.toFixed(1)}mm`);
  targetEl.style.setProperty("--cr-card-img-w", `${lay.imgW.toFixed(1)}mm`);
  // โหมดภาพเต็ม (image-only) — กล่องภาพใช้พื้นที่การ์ดเกือบเต็ม
  targetEl.style.setProperty("--cr-card-full-h", `${Math.max(20, lay.cardH - 2).toFixed(1)}mm`);
  targetEl.style.setProperty("--cr-card-full-w", `${Math.max(20, lay.cardW - 2).toFixed(1)}mm`);
}

// คืนค่า: { html, cols, rows, hasImageCol } — ใช้ทั้ง preview และ print/export
function buildPrintPayload() {
  const cols = outputCols();
  if (!cols.length) return null;
  const ci = state.trip?.start_date ? fmtDate(state.trip.start_date) : "";
  const co = state.trip?.end_date ? fmtDate(state.trip.end_date) : "";
  const dates = (ci || co) ? ` · ${ci || "—"} → ${co || "—"}` : "";
  const thead = `<th>#</th>` + cols.map(c => `<th>${escapeHtml(colLabel(c))}</th>`).join("");
  const rows = getRows();
  const rspan = computeRowspans(rows, cols);
  const tbody = rows.map((row, i) =>
    `<tr><td>${i + 1}</td>` +
    cols.map((c, ci) => {
      const span = rspan[ci][i];
      if (span === 0) return "";
      const cls = c.fmt === "image" ? ' class="cr-cell-img"' : "";
      const attrs = (span > 1 ? ` rowspan="${span}"` : "") + cls;
      return `<td${attrs}>${cellHtml(row, c)}</td>`;
    }).join("") +
    `</tr>`).join("");
  const gen = new Date().toLocaleString(curLang() === "en" ? "en-GB" : "th-TH", { timeZone: "Asia/Bangkok" });
  const extra = rows.length !== state.pax.length ? ` ${T("cr.print.extraSplit", { n: rows.length })}` : "";
  const teamNote = state.teamCount ? ` ${T("cr.count.team", { n: state.teamCount })}` : "";
  const html = `
    <div class="cr-print-title">📊 Custom Report — ${escapeHtml(tripTitle())}${dates}</div>
    <div class="cr-print-sub">${T("cr.count.people", { n: state.paxCount || state.pax.length })}${teamNote}${extra} · ${T("cr.count.columns", { n: cols.length })} · ${T("cr.print.printedAt", { when: gen })}</div>
    <table><thead><tr>${thead}</tr></thead><tbody>${tbody ||
      `<tr><td colspan="${cols.length + 1}" style="text-align:center;color:#94a3b8">${escapeHtml(T("cr.print.noData"))}</td></tr>`
    }</tbody></table>`;
  return { html, cols, rows, hasImageCol: cols.some(c => c.fmt === "image") };
}

// ตั้ง CSS vars สำหรับขนาดภาพ + override @page orientation บน element ที่ส่งมา
function applyPrintStyles(targetEl, hasImageCol) {
  if (hasImageCol) {
    const { imgH, imgW } = computePrintImgSize();
    targetEl.style.setProperty("--cr-img-h", `${imgH.toFixed(1)}mm`);
    targetEl.style.setProperty("--cr-img-w", `${imgW.toFixed(1)}mm`);
  } else {
    targetEl.style.removeProperty("--cr-img-h");
    targetEl.style.removeProperty("--cr-img-w");
  }
}

// รอให้ <img> ทุกใบใน container โหลดเสร็จ (หรือ error) ก่อนพิมพ์
// เหตุ: print area ถูกซ่อนบนจอ (แสดงเฉพาะ @media print) + img เป็น loading="lazy"
//   → เบราว์เซอร์ไม่โหลดจนกว่าจะเข้า viewport ทำให้ตอนพิมพ์ภาพว่าง
//   ปลด lazy เป็น eager เพื่อบังคับโหลดทันที แล้วรอ load/error ค่อย print
function waitForImages(container, timeoutMs = 10000) {
  const imgs = Array.from(container.querySelectorAll("img"));
  imgs.forEach(img => { img.loading = "eager"; });
  const pending = imgs.filter(img => !img.complete);
  if (!pending.length) return Promise.resolve();
  return new Promise(resolve => {
    let left = pending.length;
    const done = () => { if (--left <= 0) resolve(); };
    pending.forEach(img => {
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
    });
    setTimeout(resolve, timeoutMs); // fallback กันค้างถ้ารูปบางใบโหลดไม่จบ
  });
}

window.exportReportPrint = function () {
  if (!state.selected.length) { showToast(T("cr.toast.selectColsPrint"), "info"); return; }
  const cols = outputCols();
  if (!cols.length) { showToast(T("cr.toast.allHidden"), "info"); return; }
  const printArea = document.getElementById("cr-print-area");
  const pageStyle = document.getElementById("crPageStyle");
  if (pageStyle) pageStyle.textContent = `@page{size:${state.orientation};margin:10mm}`;

  if (state.layout === "card") {
    // Card mode — แบ่งเป็นหน้า A4 ชัดเจน (1 หน้า = perPage การ์ด) แล้วบังคับ page-break
    // เพื่อกันหน้าว่างจาก grid ต่อเนื่องที่ browser ตัดหน้าเอง (cardH ~เต็มหน้า → ล้นไปหน้าถัดไป)
    const rows = getRows();
    applyCardStyles(printArea);
    printArea.style.removeProperty("--cr-img-h");
    printArea.style.removeProperty("--cr-img-w");
    printArea.classList.add("cr-print-card");
    // card mode คุม margin ผ่าน padding ภายใน .cr-print-page เอง → @page margin:0
    if (pageStyle) pageStyle.textContent = `@page{size:${state.orientation};margin:0}`;
    const isLandscape = state.orientation !== "portrait";
    const pageH = isLandscape ? 210 : 297;
    const ciD = state.trip?.start_date ? fmtDate(state.trip.start_date) : "";
    const coD = state.trip?.end_date ? fmtDate(state.trip.end_date) : "";
    const dates = (ciD || coD) ? ` · ${ciD || "—"} → ${coD || "—"}` : "";
    const teamNote = state.teamCount ? ` ${T("cr.count.team", { n: state.teamCount })}` : "";
    const perPage = Math.max(1, state.cardsPerPage || 2);
    const totalPages = Math.max(1, Math.ceil(rows.length / perPage));
    let pagesHtml = "";
    for (let p = 0; p < totalPages; p++) {
      const start = p * perPage;
      const pageRows = rows.slice(start, start + perPage);
      const header = p === 0
        ? `<div class="cr-print-title">📊 Custom Report — ${escapeHtml(tripTitle())}${dates}</div>
           <div class="cr-print-sub">${T("cr.count.people", { n: state.paxCount || state.pax.length })}${teamNote} · ${T("cr.count.fields", { n: cols.length })}</div>`
        : "";
      const cardsHtml = pageRows.map((row, i) => buildCardHtml(row, cols, start + i + 1)).join("");
      pagesHtml += `<div class="cr-print-page" style="height:${pageH}mm">${header}<div class="cr-pcards-grid">${cardsHtml}</div></div>`;
    }
    printArea.innerHTML = pagesHtml;
  } else {
    // Table mode (เดิม)
    printArea.classList.remove("cr-print-card");
    const payload = buildPrintPayload();
    if (!payload) return;
    applyPrintStyles(printArea, payload.hasImageCol);
    printArea.innerHTML = payload.html;
  }
  showToast(T("cr.toast.printOpen"), "info");
  // รอภาพโหลดเสร็จก่อนพิมพ์ (lazy + print area ซ่อน → ภาพว่างถ้าพิมพ์เร็วไป)
  waitForImages(printArea).then(() => window.print());
};

// จำนวนหน้า A4 สูงสุดที่จะ render ใน preview — กันช้ากรณีรายงานใหญ่
const PREVIEW_MAX_PAGES = 5;

// สร้าง HTML ของหนึ่งหน้า A4 — header (เฉพาะหน้าแรก) + table ของ rows ในช่วงนั้น
function buildOnePagePreview(cols, rows, startIdx, pageNum, totalPages, isFirstPage) {
  const rspan = computeRowspans(rows, cols);
  const ci = state.trip?.start_date ? fmtDate(state.trip.start_date) : "";
  const co = state.trip?.end_date ? fmtDate(state.trip.end_date) : "";
  const dates = (ci || co) ? ` · ${ci || "—"} → ${co || "—"}` : "";
  const teamNote = state.teamCount ? ` ${T("cr.count.team", { n: state.teamCount })}` : "";
  const headerHtml = isFirstPage
    ? `<div class="cr-print-title">📊 Custom Report — ${escapeHtml(tripTitle())}${dates}</div>
       <div class="cr-print-sub">${T("cr.count.people", { n: state.paxCount || state.pax.length })}${teamNote} · ${T("cr.count.columns", { n: cols.length })}</div>`
    : "";
  const thead = `<th style="width:32px">#</th>` + cols.map(c => `<th>${escapeHtml(colLabel(c))}</th>`).join("");
  const tbody = rows.map((row, i) =>
    `<tr><td>${startIdx + i + 1}</td>` +
    cols.map((c, ci2) => {
      const span = rspan[ci2][i];
      if (span === 0) return "";
      const cls = c.fmt === "image" ? ' class="cr-cell-img"' : "";
      const attrs = (span > 1 ? ` rowspan="${span}"` : "") + cls;
      return `<td${attrs}>${cellHtml(row, c)}</td>`;
    }).join("") +
    `</tr>`).join("");
  return `${headerHtml}
    <table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>
    <div class="cr-preview-page-num">${escapeHtml(T("cr.preview.pageNum", { p: pageNum, total: totalPages }))}</div>`;
}

// สร้าง HTML 1 หน้า A4 ในโหมด card — title (หน้าแรก) + grid ของ card
function buildOnePageCardPreview(cols, rows, startIdx, pageNum, totalPages, isFirstPage) {
  const ci = state.trip?.start_date ? fmtDate(state.trip.start_date) : "";
  const co = state.trip?.end_date ? fmtDate(state.trip.end_date) : "";
  const dates = (ci || co) ? ` · ${ci || "—"} → ${co || "—"}` : "";
  const teamNote = state.teamCount ? ` ${T("cr.count.team", { n: state.teamCount })}` : "";
  const headerHtml = isFirstPage
    ? `<div class="cr-print-title">📊 Custom Report — ${escapeHtml(tripTitle())}${dates}</div>
       <div class="cr-print-sub">${T("cr.count.people", { n: state.paxCount || state.pax.length })}${teamNote} · ${T("cr.count.fields", { n: cols.length })}</div>`
    : "";
  const cardsHtml = rows.map((row, i) => buildCardHtml(row, cols, startIdx + i + 1)).join("");
  return `${headerHtml}
    <div class="cr-pcards-grid">${cardsHtml}</div>
    <div class="cr-preview-page-num">${escapeHtml(T("cr.preview.pageNum", { p: pageNum, total: totalPages }))}</div>`;
}

// 👁 Preview — แสดง layout A4 หลายหน้าซ้อนใน modal ก่อน export
// table mode → ตัด rows ตาม rowsPerPage · card mode → ตัด rows ตาม cardsPerPage
window.previewReportPrint = function () {
  if (!state.selected.length) { showToast(T("cr.toast.selectColsPreview"), "info"); return; }
  const cols = outputCols();
  if (!cols.length) { showToast(T("cr.toast.allHidden"), "info"); return; }
  const allRows = getRows();
  const total = allRows.length;
  const isCard = state.layout === "card";
  const hasImageCol = cols.some(c => c.fmt === "image");
  const perPage = Math.max(1, isCard ? (state.cardsPerPage || 2) : resolveRowsPerPage(hasImageCol));
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const showPages = Math.min(PREVIEW_MAX_PAGES, totalPages);
  const ori = state.orientation === "portrait" ? "portrait" : "landscape";

  const scroll = document.getElementById("crPreviewScroll");
  scroll.innerHTML = "";
  for (let p = 0; p < showPages; p++) {
    const start = p * perPage;
    const pageRows = allRows.slice(start, start + perPage);
    const paper = document.createElement("div");
    paper.className = `cr-preview-paper ${ori}${isCard ? " cr-mode-card" : ""}`;
    if (isCard) applyCardStyles(paper);
    else applyPrintStyles(paper, hasImageCol);
    paper.innerHTML = isCard
      ? buildOnePageCardPreview(cols, pageRows, start, p + 1, totalPages, p === 0)
      : buildOnePagePreview(cols, pageRows, start, p + 1, totalPages, p === 0);
    scroll.appendChild(paper);
  }
  if (totalPages > showPages) {
    const more = document.createElement("div");
    more.className = "cr-preview-more";
    const unit = isCard ? T("cr.unit.cards") : T("cr.unit.rows");
    more.textContent = T("cr.preview.more", { shown: showPages, total: totalPages, n: total, unit });
    scroll.appendChild(more);
  }

  const meta = document.getElementById("crPreviewMeta");
  if (meta) {
    const oriLbl = state.orientation === "portrait" ? T("cr.ori.portrait") : T("cr.ori.landscape");
    const modeLbl = isCard ? T("cr.layout.card") : T("cr.layout.table");
    const autoTag = (!isCard && state.rowsPerPage === "auto") ? T("cr.preview.autoTag") : "";
    const perLbl = isCard ? T("cr.preview.cardsPer", { n: perPage }) : `${autoTag}${T("cr.preview.rowsPer", { n: perPage })}`;
    const unitLbl = isCard ? T("cr.unit.cards") : T("cr.unit.rows");
    meta.textContent = `· ${modeLbl} · A4 ${oriLbl} · ${perLbl} · ${total} ${unitLbl} / ${T("cr.preview.pages", { n: totalPages })}`;
  }
  document.getElementById("crPreviewModal").style.display = "flex";
  scroll.scrollTop = 0;
};
window.closePreview = function () {
  const modal = document.getElementById("crPreviewModal");
  if (modal) modal.style.display = "none";
};
// ── CREATE LETTER DOC (handoff → trip-docs) ────────────────
// สร้าง binding object จาก state ปัจจุบัน (filters Set → array) — ใช้ทั้ง preview/create/refresh
function currentBinding() {
  const filters = {};
  Object.entries(state.filters).forEach(([k, set]) => { if (set && set.size) filters[k] = [...set]; });
  return {
    source: "custom_report", trip_id: state.tripId, columns: state.selected,
    hidden: state.hidden, merged: state.merged, sort: state.sort, filters,
    groupBy: state.groupBy, showTotal: state.showTotal,
  };
}

// ปุ่ม "📄 สร้างเป็นจดหมาย" — สร้าง trip_documents (body=ตาราง + scaffold เปิด/ปิด) → เปิดใน trip-docs
// ตาราง build ผ่าน engine กลาง TripReportData → ตรงกับตอน 🔄 รีเฟรชใน trip-docs เป๊ะ
window.createLetterDoc = async function () {
  if (!state.selected.length) { showToast(T("cr.toast.selectColsExport"), "info"); return; }
  const en = curLang() === "en";
  if (!window.TripReportData) { showToast("โหลด engine ไม่สำเร็จ (report-data-source.js)", "error"); return; }
  const hasText = state.selected.some(k => { const c = COL_BY_KEY[k]; return c && !state.hidden[k] && c.fmt !== "image"; });
  if (!hasText) { showToast(en ? "Pick at least 1 text column (not image)" : "เลือกคอลัมน์ข้อความอย่างน้อย 1 (รูปจะไม่ออกในจดหมาย)", "info"); return; }
  // เปิดแท็บใหม่ทันที (ใน user-gesture) กัน popup blocker → ใส่ URL หลังสร้างเสร็จ
  const win = window.open("", "_blank");
  const binding = currentBinding();
  showLoading(true);
  let tableHtml;
  try {
    tableHtml = (await window.TripReportData.buildLetterTable(binding)).html;
  } catch (e) {
    showLoading(false);
    if (win) win.close();
    showToast((en ? "Build table failed: " : "สร้างตารางไม่สำเร็จ: ") + e.message, "error");
    return;
  }
  // ห่อตารางด้วย marker → trip-docs รีเฟรชแทนที่เฉพาะส่วนนี้ (ไม่แตะข้อความเปิด/ปิด)
  tableHtml = `<div data-doc-datablock="1">${tableHtml}</div>`;
  // scaffold เปิด/ปิด (placeholder — แก้ต่อใน trip-docs ได้) · ใช้ {{...}} ที่ระบบ placeholder เดิมรองรับ
  const intro = en
    ? `<p>Subject : Request for approval — ${escapeHtml(tripTitle())}</p><p>Dear {{ผู้รับ}},</p><p>We respectfully request your kind approval for the following participants.</p>`
    : `<p>เรื่อง : ขออนุมัติ — ${escapeHtml(tripTitle())}</p><p>เรียน {{ผู้รับ}}</p><p>ด้วยทางบริษัทขออนุมัติรายชื่อดังต่อไปนี้</p>`;
  const closing = en
    ? `<p style="margin-top:10px">We kindly seek your approval to proceed. Thank you for your consideration.</p><p style="margin-top:14px">Sincerely,</p>`
    : `<p style="margin-top:10px">จึงเรียนมาเพื่อโปรดพิจารณาอนุมัติ จักขอบคุณยิ่ง</p><p style="margin-top:14px">ขอแสดงความนับถือ</p>`;
  const body = intro + tableHtml + closing;
  try {
    const res = await sbFetch("trip_documents", "", {
      method: "POST",
      body: {
        template_id: null,
        title: `${tripTitle()} — ${en ? "Approval letter" : "จดหมายขออนุมัติ"}`,
        status: "DRAFT",
        field_values: {},
        body,
        data_bindings: binding,
        updated_at: new Date().toISOString(),
      },
    });
    const created = Array.isArray(res) ? res[0] : res;
    if (!created?.doc_id) throw new Error("no doc_id returned");
    const url = new URL(`./doc-editor.html?doc_id=${created.doc_id}`, location.href).href;
    if (win) { win.location.href = url; }       // เปิดในแท็บใหม่
    else { window.open(url, "_blank") || (location.href = url); } // popup ถูกบล็อก → fallback
    showLoading(false);
    showToast(en ? "Document created — opened in new tab" : "สร้างเอกสารแล้ว — เปิดในแท็บใหม่", "success");
  } catch (e) {
    showLoading(false);
    if (win) win.close();
    const hint = /data_bindings/.test(e.message || "") ? (en ? " (run sql/136)" : " (ยังไม่ได้รัน sql/136)") : "";
    showToast((en ? "Create failed: " : "สร้างไม่สำเร็จ: ") + e.message + hint, "error");
  }
};

// ── IMAGE LIGHTBOX (click thumbnail → ภาพขยาย) ──────────────
window.crOpenImg = function (el) {
  const m = document.getElementById("cr-img-modal");
  if (!m) return;
  const src = typeof el === "string" ? el : (el && el.src) || "";
  if (!src) return;
  document.getElementById("cr-img-modal-img").src = src;
  m.classList.add("open");
};
window.crCloseImg = function () {
  const m = document.getElementById("cr-img-modal");
  if (!m) return;
  m.classList.remove("open");
  document.getElementById("cr-img-modal-img").src = "";
};

// ESC ปิด preview / lightbox
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape") return;
  const lb = document.getElementById("cr-img-modal");
  if (lb && lb.classList.contains("open")) { window.crCloseImg(); return; }
  const modal = document.getElementById("crPreviewModal");
  if (modal && modal.style.display !== "none") window.closePreview();
});

// ── i18n: re-render เมื่อสลับภาษา ──────────────────────────
// เรียกจาก I18n.onChange (ผูกไว้ใน HTML) — สร้าง UI ที่ generate ด้วย JS ใหม่
// (ข้อความ static ใน HTML ถูก I18n.apply() จัดการให้แล้ว)
window.crRerenderForLang = function () {
  if (typeof closeFilterPopover === "function") closeFilterPopover();
  renderTripBanner();
  renderTemplates();
  renderPicker();
  renderAll();
  // ถ้า preview modal เปิดอยู่ → สร้างใหม่ให้เป็นภาษาปัจจุบัน
  const pv = document.getElementById("crPreviewModal");
  if (pv && pv.style.display !== "none" && typeof window.previewReportPrint === "function") {
    window.previewReportPrint();
  }
};

// ── BOOT ───────────────────────────────────────────────────
init();
