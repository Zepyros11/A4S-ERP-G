/* ============================================================
   report-data-source.js — engine กลางสร้าง "ตารางจดหมาย" จาก binding
   ใช้ร่วมกัน:
     • custom-report.js  → ตอนกดปุ่ม "สร้างเป็นจดหมาย" (create)
     • trip-docs.js       → ตอนกดปุ่ม 🔄 รีเฟรชข้อมูล (refresh in-place)
   ทั้งสองเรียก TripReportData.buildLetterTable(binding) → ได้ HTML ตารางเดียวกันเป๊ะ

   binding = { source, trip_id, columns[], hidden{}, merged{}, sort[], filters{key:[..]}, groupBy, showTotal }

   ⚠️ COLUMN_GROUPS ต้องตรงกับใน custom-report.js (keys/labels) — ถ้าเพิ่มคอลัมน์ใหม่ แก้ทั้งสองที่
   ============================================================ */
(function (global) {
  "use strict";

  // ── COLUMN CATALOG (ตรงกับ custom-report.js) ───────────────
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
        { key: "passport_image_url", label: "ภาพ passport",    src: "pax", fmt: "image" },
        { key: "visa_image_url",     label: "ภาพสลิป/วีซ่า",    src: "pax", fmt: "image" },
        { key: "tshirt_size",       label: "ไซส์เสื้อ",         src: "pax" },
        { key: "religion",          label: "ศาสนา",            src: "pax" },
        { key: "food_allergy",      label: "อาหารที่แพ้",       src: "pax" },
        { key: "return_flight",     label: "ไฟลท์ขากลับ",       src: "pax" },
        { key: "return_date",       label: "วันขากลับ",         src: "pax", fmt: "date" },
      ],
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
    {
      id: "team", label: "👔 ทีมงาน",
      cols: [
        { key: "_teamtype",   label: "ประเภท",          src: "calc" },
        { key: "_role_title", label: "ตำแหน่งทีม",      src: "calc" },
        { key: "_languages",  label: "ภาษา (ทีม)",      src: "calc" },
        { key: "_team_phone", label: "เบอร์ทีม",        src: "calc" },
      ],
    },
  ];
  const COL_BY_KEY = {};
  COLUMN_GROUPS.forEach(g => g.cols.forEach(c => { COL_BY_KEY[c.key] = c; }));

  const PIN_RANK = { SVP: 0, VP: 1, AVP: 2, SD: 3, DR: 4 };
  function pinRank(v) {
    const r = PIN_RANK[String(v || "").trim().toUpperCase()];
    return r === undefined ? 99 : r;
  }
  const ROOM_SPLIT_COLS = ["_hotel", "_room", "_checkin", "_checkout"];
  const BLANK_VAL = "__BLANK__";
  const HAS_IMG_VAL = "__HAS_IMG__";

  // ── helpers ────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmtDate(v) {
    if (!v) return "";
    const f = global.DateFmt && global.DateFmt.formatDMY;
    return f ? (f(v) || "") : String(v);
  }
  function curLang() { return global.I18n ? global.I18n.getLang() : "th"; }
  function colLabel(c) {
    return global.I18n ? global.I18n.t("cr.col." + c.key, c.label) : c.label;
  }

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
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.message || "API Error");
    }
    return res.json().catch(() => null);
  }

  // ── fetch + build ctx (port ของ loadAll + buildCalc) ───────
  async function loadCtx(tripId) {
    const [trip, pax, rooms, buses, flights, team, memberTypes] = await Promise.all([
      sbFetch("trips", `?trip_id=eq.${tripId}&select=trip_id,trip_name,start_date,end_date`).then(r => r?.[0] || null),
      sbFetch("tour_seat_check", `?trip_id=eq.${tripId}&select=*&order=group_name.asc.nullslast,name.asc`),
      sbFetch("trip_rooms", `?trip_id=eq.${tripId}&select=room_id,room_name,place_id,check_in_date,check_out_date`).catch(() => []),
      sbFetch("trip_buses", `?trip_id=eq.${tripId}&select=bus_id,bus_no,bus_label`).catch(() => []),
      sbFetch("trip_flights", `?trip_id=eq.${tripId}&select=*`).catch(() => []),
      sbFetch("trip_guides", `?trip_id=eq.${tripId}&select=*&order=sort_order.asc,guide_id.asc`).catch(() => []),
      sbFetch("member_types", "?select=type_key,label,emoji&order=sort_order.asc").catch(() => []),
    ]);
    const ctx = { trip, calc: {}, flightById: {}, memberTypeLabel: {} };
    (memberTypes || []).forEach(mt => {
      ctx.memberTypeLabel[mt.type_key] = (mt.emoji ? mt.emoji + " " : "") + (mt.label || mt.type_key);
    });
    // pax + sub-row inherit + team rows (ตรงกับ custom-report.loadAll)
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
    const teamRows = (team || []).map(g => ({
      code: `g:${g.guide_id}`, name: g.full_name || "", __isTeam: true,
      __memberType: g.member_type || "", role_title: g.role_title || "",
      languages: g.languages || "", phone: g.phone || "", whatsapp: g.whatsapp || "", line_id: g.line_id || "",
    }));
    ctx.pax = [...allRows, ...teamRows];
    ctx.teamCount = teamRows.length;
    ctx.paxCount = allRows.length;
    await buildCalc(ctx, rooms || [], buses || [], flights || []);
    return ctx;
  }

  async function buildCalc(ctx, rooms, buses, flights) {
    const roomIds = rooms.map(r => r.room_id);
    const busIds = buses.map(b => b.bus_id);
    const flightIds = flights.map(f => f.flight_id);
    const [roomOccs, busOccs, flightTks, places] = await Promise.all([
      roomIds.length ? sbFetch("trip_room_occupants", `?room_id=in.(${roomIds.join(",")})&select=room_id,code`) : Promise.resolve([]),
      busIds.length ? sbFetch("trip_bus_occupants", `?bus_id=in.(${busIds.join(",")})&select=bus_id,seat_no,code`) : Promise.resolve([]),
      flightIds.length ? sbFetch("trip_flight_tickets", `?flight_id=in.(${flightIds.join(",")})&select=ticket_id,flight_id`).catch(() => []) : Promise.resolve([]),
      sbFetch("places", "?place_type=eq.HOTEL&select=place_id,place_name").catch(() => []),
    ]);
    const ticketToFlight = {};
    (flightTks || []).forEach(t => { ticketToFlight[t.ticket_id] = t.flight_id; });
    const ticketIds = (flightTks || []).map(t => t.ticket_id);
    const flightOccs = ticketIds.length
      ? (await sbFetch("trip_flight_ticket_occupants", `?ticket_id=in.(${ticketIds.join(",")})&select=ticket_id,code`).catch(() => []) || [])
          .map(o => ({ flight_id: ticketToFlight[o.ticket_id], code: o.code }))
      : [];
    const roomById = {}; rooms.forEach(r => { roomById[r.room_id] = r; });
    const placeById = {}; (places || []).forEach(p => { placeById[p.place_id] = p.place_name; });
    const busById = {}; buses.forEach(b => { busById[b.bus_id] = b; });
    const flightById = {}; flights.forEach(f => { flightById[f.flight_id] = f; });
    ctx.flightById = flightById;

    const codeRooms = {};
    (roomOccs || []).forEach(o => { const r = roomById[o.room_id]; if (r) (codeRooms[o.code] = codeRooms[o.code] || []).push(r); });
    const codeBus = {};
    (busOccs || []).forEach(o => { if (busById[o.bus_id]) codeBus[o.code] = { bus: busById[o.bus_id], seat: o.seat_no }; });
    const codeFlight = {};
    (flightOccs || []).forEach(o => { if (flightById[o.flight_id]) codeFlight[o.code] = flightById[o.flight_id]; });
    const fmtDTcell = (s) => s ? String(s).replace("T", " ") : "";
    const busNo = (n) => global.I18n ? global.I18n.t("cr.bus.no", { n }) : ("รถ " + n);

    ctx.calc = {};
    ctx.pax.forEach(p => {
      const rs = (codeRooms[p.code] || []).slice()
        .sort((a, b) => (a.room_name || "").localeCompare(b.room_name || "", undefined, { numeric: true }));
      const uniq = arr => [...new Set(arr.filter(Boolean))];
      const bus = codeBus[p.code];
      const fl = codeFlight[p.code];
      const stayMap = new Map();
      rs.forEach(r => {
        const hotel = placeById[r.place_id] || "";
        if (!stayMap.has(hotel)) stayMap.set(hotel, { _hotel: hotel, rooms: [], cins: [], couts: [] });
        const s = stayMap.get(hotel);
        s.rooms.push(r.room_name); s.cins.push(fmtDate(r.check_in_date)); s.couts.push(fmtDate(r.check_out_date));
      });
      const stays = [...stayMap.values()].map(s => ({
        _hotel: s._hotel, _room: uniq(s.rooms).join(", "),
        _checkin: uniq(s.cins).join(", "), _checkout: uniq(s.couts).join(", "),
      }));
      ctx.calc[p.code] = {
        _hotel: uniq(rs.map(r => placeById[r.place_id])).join(", "),
        _room: uniq(rs.map(r => r.room_name)).join(", "),
        _checkin: uniq(rs.map(r => fmtDate(r.check_in_date))).join(", "),
        _checkout: uniq(rs.map(r => fmtDate(r.check_out_date))).join(", "),
        _bus: bus ? (bus.bus.bus_label || busNo(bus.bus.bus_no || "?")) : "",
        _busseat: bus ? String(bus.seat ?? "") : "",
        _flticket: fl ? (fl.flight_label || fl.flight || ("Ticket " + fl.flight_id)) : "",
        _flflight: fl ? (fl.flight || "") : "",
        _flport: fl ? (fl.port || p.port || "") : "",
        _fldep: fl ? fmtDTcell(fl.departure_datetime) : "",
        _flarr: fl ? fmtDTcell(fl.arrival_datetime) : "",
        _flcomeback: fl ? (fl.comeback || "") : "",
        _flcomebackdt: fl ? fmtDTcell(fl.comeback_datetime) : "",
        _flid: fl ? fl.flight_id : null,
        _stays: stays,
      };
    });
  }

  // ── value/format (port ของ cellValue) ─────────────────────
  function teamLabel(ctx, mt) {
    return ctx.memberTypeLabel[mt] || mt || (global.I18n ? global.I18n.t("cr.team.default") : "ทีมงาน");
  }
  function cellValue(ctx, row, col) {
    if (col.src === "calc") {
      if (col.key === "_teamtype") return row.__isTeam ? teamLabel(ctx, row.__memberType) : "";
      if (col.key === "_role_title") return row.__isTeam ? (row.role_title || "") : "";
      if (col.key === "_languages") return row.__isTeam ? (row.languages || "") : "";
      if (col.key === "_team_phone") return row.__isTeam ? [row.phone, row.whatsapp, row.line_id].filter(Boolean).join(" · ") : "";
      if (row.__stay && col.key in row.__stay) return row.__stay[col.key];
      return ctx.calc[row.code]?.[col.key] || "";
    }
    if (row.__isTeam && !["name", "code"].includes(col.key)) return "";
    let v = row[col.key];
    if (v == null || v === "") return "";
    if (col.fmt === "date") return fmtDate(v);
    if (col.fmt === "gender") {
      const g = String(v).toLowerCase();
      const t = (k, f) => global.I18n ? global.I18n.t(k, f) : f;
      return g === "male" ? t("cr.gender.male", "ชาย") : g === "female" ? t("cr.gender.female", "หญิง") : String(v);
    }
    if (col.fmt === "image") { const s = String(v).trim(); return s.startsWith("http") ? s : ""; }
    return String(v);
  }

  // ── pipeline: expand → filter → sort → group ───────────────
  function expandedPax(ctx, selected) {
    const needsSplit = selected.some(k => ROOM_SPLIT_COLS.includes(k));
    if (!needsSplit) return ctx.pax;
    const out = [];
    ctx.pax.forEach(p => {
      const stays = ctx.calc[p.code]?._stays || [];
      if (stays.length <= 1) { out.push(p); return; }
      stays.forEach(s => out.push({ ...p, __stay: s }));
    });
    return out;
  }
  function filterRows(ctx, rows, filters) {
    const active = Object.entries(filters || {}).filter(([_, arr]) => Array.isArray(arr) && arr.length);
    if (!active.length) return rows;
    const sets = active.map(([k, arr]) => [k, new Set(arr)]);
    return rows.filter(row => sets.every(([key, set]) => {
      const col = COL_BY_KEY[key];
      if (!col) return true;
      const v = cellValue(ctx, row, col);
      if (col.fmt === "image") return set.has(v ? HAS_IMG_VAL : BLANK_VAL);
      if (v === "" || v == null) return set.has(BLANK_VAL);
      return set.has(v);
    }));
  }
  function sortValue(ctx, row, col) {
    if (col.key === "pin") return pinRank(row.pin);
    if (col.src === "pax" && col.fmt === "date") return row[col.key] || "";
    return cellValue(ctx, row, col).toLowerCase();
  }
  function getRows(ctx, binding) {
    const filtered = filterRows(ctx, expandedPax(ctx, binding.columns || []), binding.filters);
    const chain = (binding.sort || []).map(s => ({ col: COL_BY_KEY[s.key], dir: s.dir })).filter(x => x.col);
    if (!chain.length) return filtered;
    return [...filtered].sort((a, b) => {
      for (const { col, dir } of chain) {
        const va = sortValue(ctx, a, col), vb = sortValue(ctx, b, col);
        let cmp;
        if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
        else cmp = String(va).localeCompare(String(vb), undefined, { numeric: true });
        if (cmp !== 0) return cmp * dir;
      }
      return 0;
    });
  }

  // ── grouping + headers ─────────────────────────────────────
  function blankLabel() { return global.I18n ? global.I18n.t("cr.blank", "(ว่าง)") : "(ว่าง)"; }
  function groupKeyOf(ctx, binding, row) {
    if (!binding.groupBy) return null;
    if (binding.groupBy === "_flightseg") {
      const k = ctx.calc[row.code]?._flid;
      return k != null ? "f:" + k : "f:none";
    }
    const col = COL_BY_KEY[binding.groupBy];
    if (!col) return null;
    return "v:" + (cellValue(ctx, row, col) || BLANK_VAL);
  }
  function flightSegHeader(ctx, flid) {
    const en = curLang() === "en";
    if (flid === "none") return en ? "✈️ No flight assigned" : "✈️ ยังไม่กำหนดเที่ยวบิน";
    const fl = ctx.flightById[flid];
    if (!fl) return en ? "✈️ Flight" : "✈️ เที่ยวบิน";
    const dep = fl.departure_datetime ? fmtDate(fl.departure_datetime) : "";
    const ret = fl.comeback_datetime ? fmtDate(fl.comeback_datetime) : "";
    const l1 = `${en ? "Departure flight from" : "เที่ยวบินขาไป"} ${escapeHtml(fl.port || "")}${fl.flight ? " " + escapeHtml(fl.flight) : ""}${dep ? ` : ${en ? "Date" : "วันที่"} ${escapeHtml(dep)}` : ""}`;
    const l2 = `${en ? "Return flight" : "เที่ยวบินขากลับ"}${fl.comeback ? " " + escapeHtml(fl.comeback) : ""}${ret ? ` : ${en ? "Date" : "วันที่"} ${escapeHtml(ret)}` : ""}`;
    return `${l1}<br>${l2}`;
  }
  function groupHeaderHtml(ctx, binding, key) {
    if (binding.groupBy === "_flightseg") return flightSegHeader(ctx, key.slice(2));
    const col = COL_BY_KEY[binding.groupBy];
    const raw = key.slice(2);
    const val = raw === BLANK_VAL ? blankLabel() : raw;
    return `${escapeHtml(col ? colLabel(col) : "")}: ${escapeHtml(val)}`;
  }
  function getGroups(ctx, binding, rows) {
    if (!binding.groupBy) return [{ key: null, headerHtml: "", rows }];
    const order = [], byKey = new Map();
    rows.forEach(r => {
      const k = groupKeyOf(ctx, binding, r);
      if (!byKey.has(k)) { byKey.set(k, []); order.push(k); }
      byKey.get(k).push(r);
    });
    return order.map(k => ({ key: k, headerHtml: groupHeaderHtml(ctx, binding, k), rows: byKey.get(k) }));
  }
  function totalLabel(n) {
    return curLang() === "en" ? `Total ${n} seats` : `รวม ${n} ที่นั่ง`;
  }

  // rowspan (port ของ computeRowspans) — merged map จาก binding.merged
  function computeRowspans(ctx, rows, cols, merged) {
    const rs = cols.map(() => new Array(rows.length).fill(1));
    cols.forEach((c, ci) => {
      if (!merged[c.key]) return;
      let r = 0;
      while (r < rows.length) {
        let end = r + 1;
        while (end < rows.length) {
          if (cellValue(ctx, rows[end], c) !== cellValue(ctx, rows[r], c)) break;
          let groupBreak = false;
          for (let pj = 0; pj < ci; pj++) {
            const pc = cols[pj];
            if (merged[pc.key] && cellValue(ctx, rows[end], pc) !== cellValue(ctx, rows[r], pc)) { groupBreak = true; break; }
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

  // ── สร้าง HTML ตาราง (inline-style · ฝังใน trip-docs body) ──
  function letterCols(binding) {
    return (binding.columns || [])
      .map(k => COL_BY_KEY[k])
      .filter(c => c && !(binding.hidden && binding.hidden[c.key]) && c.fmt !== "image");
  }
  function renderTableHtml(ctx, binding) {
    const cols = letterCols(binding);
    if (!cols.length) return { html: "", rowCount: 0 };
    const rows = getRows(ctx, binding);
    const groups = getGroups(ctx, binding, rows);
    const merged = binding.merged || {};
    const showTotal = !!binding.showTotal;
    const en = curLang() === "en";
    const TH = 'style="border:1px solid #000;padding:3px 7px;text-align:left;font-weight:700;font-size:12px"';
    const TD = 'style="border:1px solid #000;padding:3px 7px;font-size:12px"';
    const span0 = cols.length + 1;
    const thead = `<tr><th style="border:1px solid #000;padding:3px 7px;text-align:center;font-weight:700;font-size:12px;width:34px">${en ? "NO." : "ลำดับ"}</th>` +
      cols.map(c => `<th ${TH}>${escapeHtml(colLabel(c))}</th>`).join("") + `</tr>`;
    let html = "";
    groups.forEach(g => {
      if (g.key !== null) html += `<p style="font-weight:600;margin:12px 0 3px;font-size:12.5px">${g.headerHtml}</p>`;
      const grsp = computeRowspans(ctx, g.rows, cols, merged);
      const body = g.rows.map((row, i) =>
        `<tr><td style="border:1px solid #000;padding:3px 7px;text-align:center;font-size:12px">${i + 1}</td>` +
        cols.map((c, ci) => {
          const sp = grsp[ci][i];
          if (sp === 0) return "";
          const attr = sp > 1 ? ` rowspan="${sp}"` : "";
          return `<td ${TD}${attr}>${escapeHtml(cellValue(ctx, row, c))}</td>`;
        }).join("") + `</tr>`).join("");
      const totalRow = showTotal
        ? `<tr><td colspan="${span0}" style="border:1px solid #000;padding:3px 7px;text-align:right;font-weight:700;font-size:12px;background:#f1f5f9">${escapeHtml(totalLabel(g.rows.length))}</td></tr>`
        : "";
      html += `<table style="border-collapse:collapse;width:100%;margin:2px 0 6px">${thead}${body}${totalRow}</table>`;
    });
    if (showTotal && binding.groupBy && groups.length > 1) {
      html += `<p style="text-align:right;font-weight:700;margin:6px 0;font-size:12.5px">${escapeHtml((en ? "Grand total " : "รวมทั้งหมด ") + rows.length + (en ? " seats" : " ที่นั่ง"))}</p>`;
    }
    return { html, rowCount: rows.length };
  }

  // ── PUBLIC API ─────────────────────────────────────────────
  // buildLetterTable(binding) → { html, rowCount } (fetch สดจาก trip_id)
  async function buildLetterTable(binding) {
    if (!binding || !binding.trip_id) throw new Error("binding.trip_id ว่าง");
    const ctx = await loadCtx(binding.trip_id);
    return renderTableHtml(ctx, binding);
  }

  global.TripReportData = { COLUMN_GROUPS, COL_BY_KEY, buildLetterTable };
})(window);
