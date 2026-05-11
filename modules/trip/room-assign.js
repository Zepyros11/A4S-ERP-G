/* ============================================================
   room-assign.js — จัดห้องพัก (per-trip room assignment)
   ============================================================ */

const state = {
  tripId: null,
  trip: null,
  passengers: [],   // tour_seat_check rows for this trip
  totalSeats: 0,    // total rows including sub-rows (= seat count)
  rooms: [],        // trip_rooms for this trip
  // 1 คน × N ห้อง — รองรับ trip หลายช่วงพัก (เปลี่ยนโรงแรมตามวัน)
  occupants: {},      // { [room_id]: [code, code, ...] }
  codeToRooms: {},    // { [code]: Set<room_id> }   reverse lookup
  selectedPaxCode: null,  // currently selected passenger code (single-select)
  hotels: [],       // places with place_type='HOTEL' (for modal helper)
  hotelRoomTypes: {}, // { [place_id]: [room_type_rows...] } cache
  // global room filter — true = แสดงเฉพาะห้องว่าง
  filterEmptyOnly: false,
  // groups ที่ถูกย่อ (collapsed) — เก็บ groupKey ของกลุ่มที่ย่ออยู่
  collapsedGroups: new Set(),
  // edit mode: ถ้าไม่ null = กำลังแก้ไขกลุ่มนี้ (แทนที่จะสร้างใหม่)
  editingGroupKey: null,
  // duplicate mode: ถ้าไม่ null = สร้างกลุ่มใหม่โดยใช้ผู้พักจากกลุ่มต้นฉบับนี้
  duplicateFromGroupKey: null,
  // Modal state
  rbSelectedHotelId: null,
  rbSelectedRoomTypeName: null,
  rbSelectedRoomTypeMaxGuests: 0,
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
      Prefer:
        method === "POST" || method === "PATCH" ? "return=representation" : "",
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
    showToast("ยังไม่ได้เชื่อมต่อ Supabase", "error");
    return;
  }

  bindEvents();
  await loadAll();
}

async function loadAll() {
  showLoading(true);
  try {
    const [trip, paxs, rooms, hotels] = await Promise.all([
      sbFetch("trips", `?trip_id=eq.${state.tripId}&select=*`).then(r => r?.[0] || null),
      sbFetch("tour_seat_check",
        `?trip_id=eq.${state.tripId}&select=code,name,gender,nationality,passport_image_url,visa_image_url,passport_id,passport_exp_date,group_name,seat,is_sub_row,parent_code&order=group_name.asc.nullslast,name.asc`),
      sbFetch("trip_rooms",
        `?trip_id=eq.${state.tripId}&select=*&order=sort_order.asc,room_id.asc`),
      sbFetch("places",
        "?place_type=eq.HOTEL&select=*&order=place_name.asc").catch((e) => { console.warn("[room-assign] load hotels:", e.message); return []; }),
    ]);
    state.hotels = hotels || [];
    populateHotelDropdown();
    state.trip = trip;
    // แสดงทุกแถว (รวม sub-row) — แต่ละแถว = 1 ที่นั่ง = 1 ช่อง assign ให้ห้องได้
    // sub-row ที่ไม่มี name → ใช้ชื่อ parent + ป้าย "ที่นั่งที่ N" เป็น fallback
    const allRows = paxs || [];
    const byCode = {};
    allRows.forEach(r => { byCode[r.code] = r; });
    allRows.forEach(r => {
      if (r.is_sub_row && r.parent_code) {
        const parent = byCode[r.parent_code];
        if (parent) {
          if (!r.name && parent.name) r._inheritedName = parent.name;
          if (!r.nationality && parent.nationality) r._inheritedNat = parent.nationality;
          if (!r.gender && parent.gender) r._inheritedGender = parent.gender;
          if (!r.passport_image_url && parent.passport_image_url) r._inheritedPassImg = parent.passport_image_url;
          if (!r.visa_image_url && parent.visa_image_url) r._inheritedVisaImg = parent.visa_image_url;
        }
      }
    });
    state.totalSeats = allRows.length;
    state.passengers = allRows;
    state.rooms = rooms || [];

    // Load occupants (1 คน × N ห้อง)
    state.occupants = {};
    state.codeToRooms = {};
    const roomIds = state.rooms.map(r => r.room_id);
    if (roomIds.length) {
      const occRows = await sbFetch("trip_room_occupants",
        `?room_id=in.(${roomIds.join(",")})&select=room_id,code`);
      (occRows || []).forEach(o => {
        if (!state.occupants[o.room_id]) state.occupants[o.room_id] = [];
        state.occupants[o.room_id].push(o.code);
        if (!state.codeToRooms[o.code]) state.codeToRooms[o.code] = new Set();
        state.codeToRooms[o.code].add(o.room_id);
      });
    }

    renderTripBanner();
    populateBatchFilter();
    syncCollapsedWithBatch();
    renderStats();
    renderPassengers();
    renderRooms();
  } catch (e) {
    showToast("โหลดข้อมูลไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
}

function bindEvents() {
  document.getElementById("paxSearch")?.addEventListener("input", renderPassengers);
  document.getElementById("paxFilterStatus")?.addEventListener("change", renderPassengers);
  document.getElementById("paxFilterGender")?.addEventListener("change", renderPassengers);
  document.getElementById("paxFilterBatch")?.addEventListener("change", (ev) => {
    ev.target.classList.toggle("has-value", !!ev.target.value);
    syncCollapsedWithBatch();
    renderPassengers();
    renderRooms();
  });
}

// sync collapse state ตาม batch filter
// — มี >1 โรงแรม + ยังไม่เลือก → ย่อทุกกลุ่ม
// — เลือกแล้ว → ขยายเฉพาะโรงแรมนั้น, อื่น ๆ ย่อ + lock
function syncCollapsedWithBatch() {
  const sel = document.getElementById("paxFilterBatch");
  const activeKey = sel?.value || "";
  const allKeys = new Set();
  state.rooms.forEach(r => allKeys.add(groupKeyOf(r)));
  if (allKeys.size <= 1) {
    state.collapsedGroups = new Set();
    return;
  }
  if (activeKey) {
    state.collapsedGroups = new Set([...allKeys].filter(k => k !== activeKey));
  } else {
    state.collapsedGroups = new Set(allKeys);
  }
}

// dropdown "ช่วงพัก" — แสดงรายการ batch (group key) ทั้งหมดของทริปนี้
function populateBatchFilter() {
  const sel = document.getElementById("paxFilterBatch");
  if (!sel) return;
  const prev = sel.value;
  // distinct batches โดยเรียงตาม sort_order ของห้องตัวแรกที่เจอ
  const seen = new Map(); // key → { hotel, type, ci, co, sort }
  state.rooms.forEach(r => {
    const k = groupKeyOf(r);
    if (seen.has(k)) return;
    const hotel = state.hotels.find(h => h.place_id === r.place_id);
    seen.set(k, {
      key: k,
      hotelName: hotel?.place_name || (r.place_id ? `Place #${r.place_id}` : "ไม่ระบุโรงแรม"),
      type: r.room_type || "อื่นๆ",
      ci: r.check_in_date || "",
      co: r.check_out_date || "",
      sort: r.sort_order || 0,
    });
  });
  const batches = [...seen.values()].sort((a, b) => a.sort - b.sort);
  const opts = ['<option value="">🏨 เลือกโรงแรม</option>'];
  batches.forEach(b => {
    const dates = (b.ci || b.co) ? `${b.ci ? fmtDate(b.ci) : "?"}→${b.co ? fmtDate(b.co) : "?"}` : "";
    const label = `🏨 ${b.hotelName}${dates ? " · " + dates : ""}`;
    opts.push(`<option value="${escapeAttr(b.key)}">${escapeHtml(label)}</option>`);
  });
  sel.innerHTML = opts.join("");
  // คงค่าเดิมถ้า batch ยังอยู่
  if (prev && [...seen.keys()].includes(prev)) {
    sel.value = prev;
  } else if (batches.length === 1) {
    // ทริปมีโรงแรมเดียว → auto-select เพื่อใช้ห้องเดียวเลย
    sel.value = batches[0].key;
  }
  // toggle สี (ส้ม=ยังไม่เลือก, เขียว=เลือกแล้ว)
  sel.classList.toggle("has-value", !!sel.value);
}

// ── TRIP BANNER ────────────────────────────────────────────
function renderTripBanner() {
  if (!state.trip) return;
  const fmt = (window.DateFmt && window.DateFmt.formatDMY) || (s => s || "");
  document.getElementById("raTripName").textContent = "✈️ " + (state.trip.trip_name || `Trip #${state.tripId}`);
  const dates = (state.trip.start_date || state.trip.end_date)
    ? `${fmt(state.trip.start_date) || "—"} → ${fmt(state.trip.end_date) || "—"}`
    : "";
  document.getElementById("raTripDates").textContent = dates;
  document.getElementById("raTripBanner").style.display = "inline-flex";
  document.title = `${state.trip.trip_name || "Trip"} — จัดห้องพัก — A4S-ERP`;
}

// ── STATS ──────────────────────────────────────────────────
function setStatTone(cardId, level) {
  const el = document.getElementById(cardId);
  if (!el) return;
  el.classList.remove("ra-stat--ok", "ra-stat--warn", "ra-stat--err");
  if (level) el.classList.add(`ra-stat--${level}`);
}

function renderStats() {
  const total = state.passengers.length;
  document.getElementById("statTotal").textContent = total;

  // 2) โรงแรมที่ยังมีคนเหลือ — batch ที่ยังมีลูกค้าไม่ได้ห้อง
  const groupedRooms = {};
  state.rooms.forEach(r => {
    const k = groupKeyOf(r);
    if (!groupedRooms[k]) groupedRooms[k] = [];
    groupedRooms[k].push(r);
  });
  let batchPending = 0;
  Object.values(groupedRooms).forEach(rooms => {
    const codesInBatch = new Set();
    rooms.forEach(r => (state.occupants[r.room_id] || []).forEach(c => codesInBatch.add(c)));
    if (codesInBatch.size < total) batchPending++;
  });
  document.getElementById("statBatchPending").textContent = batchPending;
  setStatTone("statBatchPendingCard", batchPending > 0 ? "warn" : "ok");

  // 3) เพศปนกัน — ห้องที่มีทั้ง M และ F
  let mixedRooms = 0;
  state.rooms.forEach(r => {
    const codes = state.occupants[r.room_id] || [];
    const genders = new Set();
    for (const c of codes) {
      const p = state.passengers.find(x => x.code === c);
      if (!p) continue;
      const g = normGender(p.gender || p._inheritedGender);
      if (g) genders.add(g);
      if (genders.size > 1) break;
    }
    if (genders.size > 1) mixedRooms++;
  });
  document.getElementById("statMixed").textContent = mixedRooms;
  setStatTone("statMixedCard", mixedRooms > 0 ? "err" : "ok");

  // 4) โรงแรม | ห้องทั้งหมด — informational
  document.getElementById("statHotelCount").textContent = totalBatchCount();
  document.getElementById("statRoomCount").textContent = state.rooms.length;
}

// ── EXPORT (Excel / PDF) ───────────────────────────────────
window.toggleRaExport = function (ev) {
  ev?.stopPropagation?.();
  const wrap = document.getElementById("raExportWrap");
  if (!wrap) return;
  wrap.classList.toggle("open");
};
window.closeRaExport = function () {
  document.getElementById("raExportWrap")?.classList.remove("open");
};
document.addEventListener("click", (ev) => {
  if (!ev.target.closest("#raExportWrap")) window.closeRaExport();
});

// สร้าง sections สำหรับ export — แยกตาม batch (โรงแรม + ประเภท + ช่วงวัน)
// แต่ละ section มี rows: 1 (คน × ห้อง) = 1 แถว
function _buildExportSections() {
  const groups = {};
  state.rooms.forEach(r => {
    const k = groupKeyOf(r);
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  });
  // sort batch by sort_order ของห้องแรกในกลุ่ม
  const orderedKeys = Object.keys(groups).sort((a, b) => {
    const aSort = Math.min(...groups[a].map(r => r.sort_order || 0));
    const bSort = Math.min(...groups[b].map(r => r.sort_order || 0));
    return aSort - bSort;
  });
  return orderedKeys.map(k => {
    const rooms = groups[k];
    const sample = rooms[0];
    const hotel = state.hotels.find(h => h.place_id === sample.place_id);
    const hotelName = hotel?.place_name || (sample.place_id ? `Place #${sample.place_id}` : "ไม่ระบุโรงแรม");
    const ci = sample.check_in_date  ? fmtDate(sample.check_in_date)  : "—";
    const co = sample.check_out_date ? fmtDate(sample.check_out_date) : "—";
    const title = `${hotelName} · ${sample.room_type || ""} · ${ci}→${co}`;
    const rows = [];
    rooms.forEach(r => {
      (state.occupants[r.room_id] || []).forEach(code => {
        const p = state.passengers.find(x => x.code === code);
        const name = (p?.name || p?._inheritedName || "—");
        rows.push({
          "รหัส": code || "",
          "ชื่อ": name,
          "ชื่อห้อง": r.room_name || "",
          "Check-in": r.check_in_date  ? fmtDate(r.check_in_date)  : "",
          "Check-out": r.check_out_date ? fmtDate(r.check_out_date) : "",
          _room: r.room_name || "",
          _code: code || "",
        });
      });
    });
    // เรียงตามชื่อห้อง ASC (natural sort: Twin-2 < Twin-3 < Twin-21) แล้วตาม code ใน ห้องเดียวกัน
    rows.sort((a, b) =>
      a._room.localeCompare(b._room, undefined, { numeric: true, sensitivity: "base" })
      || a._code.localeCompare(b._code)
    );
    return {
      title,
      hotelName,
      rows: rows.map(({ _room, _code, ...rest }) => rest),
    };
  });
}

// helper: ทาขอบทุกเซลล์ในช่วง + ใส่ header style ที่แถวบนสุด
function _applyBorders(ws, nCols, nRows, headerRowIdx = 0) {
  const border = {
    top:    { style: "thin", color: { rgb: "94A3B8" } },
    bottom: { style: "thin", color: { rgb: "94A3B8" } },
    left:   { style: "thin", color: { rgb: "94A3B8" } },
    right:  { style: "thin", color: { rgb: "94A3B8" } },
  };
  for (let r = headerRowIdx; r < headerRowIdx + nRows; r++) {
    for (let c = 0; c < nCols; c++) {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (!ws[ref]) ws[ref] = { v: "", t: "s" };
      ws[ref].s = ws[ref].s || {};
      ws[ref].s.border = border;
      ws[ref].s.alignment = ws[ref].s.alignment || { vertical: "center", wrapText: false };
      if (r === headerRowIdx) {
        ws[ref].s.font = { bold: true, sz: 11 };
        ws[ref].s.fill = { patternType: "solid", fgColor: { rgb: "F1F5F9" } };
        ws[ref].s.alignment = { vertical: "center", horizontal: "center" };
      }
    }
  }
  // ขยาย worksheet range เพื่อให้เซลล์เปล่าที่เราเพิ่งสร้างถูก export ด้วย
  ws["!ref"] = XLSX.utils.encode_range({ s: { c: 0, r: headerRowIdx }, e: { c: nCols - 1, r: headerRowIdx + nRows - 1 } });
}

window.exportRaExcel = function () {
  if (typeof XLSX === "undefined") {
    showToast("XLSX library ยังโหลดไม่เสร็จ — ลองใหม่อีกครั้ง", "error");
    return;
  }
  const sections = _buildExportSections();
  if (!sections.length) { showToast("ยังไม่มีห้องให้ export", "info"); return; }

  const wb = XLSX.utils.book_new();
  const used = new Set();
  // sanitize sheet name: remove forbidden chars, max 31 chars, must be unique
  const safeSheetName = (raw, idx) => {
    let name = String(raw || `Sheet ${idx + 1}`).replace(/[\\\/\?\*\[\]:]/g, "_").slice(0, 31).trim();
    if (!name) name = `Sheet ${idx + 1}`;
    let unique = name, n = 2;
    while (used.has(unique)) {
      const suffix = ` (${n++})`;
      unique = name.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(unique);
    return unique;
  };

  // ─── สรุป sheet (อยู่หน้าสุด) ───
  const tripName  = state.trip?.trip_name || `Trip #${state.tripId}`;
  const tripStart = state.trip?.start_date ? fmtDate(state.trip.start_date) : "—";
  const tripEnd   = state.trip?.end_date   ? fmtDate(state.trip.end_date)   : "—";
  const tripDays  = _daysInclusive(state.trip?.start_date, state.trip?.end_date);
  const totalRooms = state.rooms.length;
  const totalPax   = state.passengers.length;
  const totalRows  = sections.reduce((a, s) => a + s.rows.length, 0);

  // sheet 2D array — header + data + spacing + per-hotel breakdown
  const aoa = [
    [`🛏️ จัดห้องพัก — ${tripName}`],
    [`ทริป: ${tripStart} → ${tripEnd}${tripDays > 0 ? ` (${tripDays} วัน)` : ""}`],
    [],
    ["📊 สรุปทั้งทริป"],
    ["โรงแรม", "ห้อง", "คน", "วันทริป", "รวมแถว"],
    [sections.length, totalRooms, totalPax, tripDays || "—", totalRows],
    [],
    ["🏨 สรุปต่อโรงแรม"],
    ["#", "โรงแรม", "ประเภทห้อง", "Check-in", "Check-out", "คืน", "ห้อง", "ผู้พัก"],
  ];
  sections.forEach((sec, i) => {
    // หาห้องของ section นี้เพื่อดึง dates+capacity
    const groupRooms = state.rooms.filter(r => {
      const hotel = state.hotels.find(h => h.place_id === r.place_id);
      const hotelName = hotel?.place_name || (r.place_id ? `Place #${r.place_id}` : "ไม่ระบุโรงแรม");
      const ci = r.check_in_date  ? fmtDate(r.check_in_date)  : "—";
      const co = r.check_out_date ? fmtDate(r.check_out_date) : "—";
      return `${hotelName} · ${r.room_type || ""} · ${ci}→${co}` === sec.title;
    });
    const sample = groupRooms[0] || {};
    const ci = sample.check_in_date  ? fmtDate(sample.check_in_date)  : "—";
    const co = sample.check_out_date ? fmtDate(sample.check_out_date) : "—";
    const nights = _nightsBetween(sample.check_in_date, sample.check_out_date);
    aoa.push([
      i + 1,
      sec.hotelName,
      sample.room_type || "",
      ci, co,
      nights || 0,
      groupRooms.length,
      sec.rows.length,
    ]);
  });

  const summaryWs = XLSX.utils.aoa_to_sheet(aoa);
  // กำหนดความกว้างคอลัมน์
  summaryWs["!cols"] = [
    { wch: 4 }, { wch: 28 }, { wch: 16 }, { wch: 12 }, { wch: 12 },
    { wch: 6 }, { wch: 8 }, { wch: 8 },
  ];
  // merge title rows
  summaryWs["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 7 } },
    { s: { r: 3, c: 0 }, e: { r: 3, c: 7 } },
    { s: { r: 7, c: 0 }, e: { r: 7, c: 7 } },
  ];
  // borders: ตาราง "สรุปทั้งทริป" (row 4-5, col 0-4) + ตาราง "สรุปต่อโรงแรม" (row 8 ลงมา, col 0-7)
  _applyBorders(summaryWs, 5, 2, 4);
  _applyBorders(summaryWs, 8, sections.length + 1, 8);
  // header styles for title rows (row 0,1,3,7) — bold + center
  ["A1", "A2", "A4", "A8"].forEach(ref => {
    if (!summaryWs[ref]) summaryWs[ref] = { v: "", t: "s" };
    summaryWs[ref].s = {
      font: { bold: true, sz: ref === "A1" ? 14 : 12 },
      alignment: { vertical: "center", horizontal: "left" },
    };
  });
  used.add("สรุป");
  XLSX.utils.book_append_sheet(wb, summaryWs, "สรุป");

  // ─── 1 sheet ต่อ 1 โรงแรม ───
  // คอลัมน์: 0=รหัส 1=ชื่อ 2=ชื่อห้อง 3=Check-in 4=Check-out
  // merge cell ของ col 2,3,4 สำหรับแถวที่ "ชื่อห้อง" ติดกันและเหมือนกัน
  const computeMerges = (rows, headerRowIdx = 0) => {
    const merges = [];
    let i = 0;
    while (i < rows.length) {
      const cur = rows[i]["ชื่อห้อง"];
      let j = i + 1;
      while (j < rows.length && rows[j]["ชื่อห้อง"] === cur && cur !== "") j++;
      if (j - i > 1) {
        const r1 = headerRowIdx + 1 + i;
        const r2 = headerRowIdx + j;
        // merge ชื่อห้อง (col 2), Check-in (col 3), Check-out (col 4)
        [2, 3, 4].forEach(c => merges.push({ s: { r: r1, c }, e: { r: r2, c } }));
      }
      i = j;
    }
    return merges;
  };
  sections.forEach((sec, i) => {
    const sheetName = safeSheetName(sec.hotelName, i);
    const headerRows = sec.rows.length
      ? sec.rows
      : [{ "รหัส": "", "ชื่อ": "(ยังไม่มีผู้พัก)", "ชื่อห้อง": "", "Check-in": "", "Check-out": "" }];
    const ws = XLSX.utils.json_to_sheet(headerRows);
    const maxLen = {};
    headerRows.forEach(r => Object.entries(r).forEach(([k, v]) => {
      const l = String(v ?? "").length;
      maxLen[k] = Math.max(maxLen[k] || k.length, Math.min(l, 60));
    }));
    ws["!cols"] = Object.keys(headerRows[0]).map(k => ({ wch: (maxLen[k] || 10) + 2 }));
    if (sec.rows.length) ws["!merges"] = computeMerges(headerRows, 0);
    // borders + header style ทุกเซลล์ (header 1 row + data N rows)
    _applyBorders(ws, Object.keys(headerRows[0]).length, headerRows.length + 1, 0);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });

  const tripSlug = (state.trip?.trip_name || `trip${state.tripId}`).replace(/[^\w฀-๿-]+/g, "_");
  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `room_assign_${tripSlug}_${today}.xlsx`);
  showToast(`ดาวน์โหลด Excel แล้ว (${sections.length} โรงแรม + สรุป)`, "success");
};

// helper: นับวัน inclusive (start..end)
function _daysInclusive(isoStart, isoEnd) {
  if (!isoStart || !isoEnd) return 0;
  const a = new Date(isoStart + "T00:00:00");
  const b = new Date(isoEnd + "T00:00:00");
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.round((b - a) / 86400000) + 1;
}
// helper: นับคืน (check-in → check-out)
function _nightsBetween(isoIn, isoOut) {
  if (!isoIn || !isoOut) return 0;
  const a = new Date(isoIn + "T00:00:00");
  const b = new Date(isoOut + "T00:00:00");
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86400000));
}

window.exportRaPdf = function () {
  // Build print HTML — แยก section ต่อโรงแรม + ตารางคอลัมน์เดียวกับ Excel
  const tripName = state.trip?.trip_name || `Trip #${state.tripId}`;
  const tripDates = (state.trip?.start_date || state.trip?.end_date)
    ? `${state.trip?.start_date ? fmtDate(state.trip.start_date) : "—"} → ${state.trip?.end_date ? fmtDate(state.trip.end_date) : "—"}`
    : "";
  const tripDays = _daysInclusive(state.trip?.start_date, state.trip?.end_date);

  const sections = _buildExportSections();
  const totalRows = sections.reduce((a, s) => a + s.rows.length, 0);
  const totalRooms = state.rooms.length;
  const totalPax = state.passengers.length;

  const sectionsHtml = sections.map(sec => {
    // หา sample room ของ section นี้เพื่อดึง check-in/out เพื่อคำนวณคืน
    const groupRooms = state.rooms.filter(r => {
      const hotel = state.hotels.find(h => h.place_id === r.place_id);
      const hotelName = hotel?.place_name || (r.place_id ? `Place #${r.place_id}` : "ไม่ระบุโรงแรม");
      const ci = r.check_in_date  ? fmtDate(r.check_in_date)  : "—";
      const co = r.check_out_date ? fmtDate(r.check_out_date) : "—";
      return `${hotelName} · ${r.room_type || ""} · ${ci}→${co}` === sec.title;
    });
    const sample = groupRooms[0];
    const nights = sample ? _nightsBetween(sample.check_in_date, sample.check_out_date) : 0;
    // คำนวณ rowspan สำหรับห้องที่ติดกัน
    const rowspans = new Array(sec.rows.length).fill(1);
    const isHead   = new Array(sec.rows.length).fill(false);
    let i = 0;
    while (i < sec.rows.length) {
      const cur = sec.rows[i]["ชื่อห้อง"];
      let j = i + 1;
      while (j < sec.rows.length && sec.rows[j]["ชื่อห้อง"] === cur && cur !== "") j++;
      isHead[i] = true;
      rowspans[i] = j - i;
      i = j;
    }
    const trs = sec.rows.map((r, idx) => `<tr>
      <td>${escapeHtml(r["รหัส"])}</td>
      <td>${escapeHtml(r["ชื่อ"])}</td>
      ${isHead[idx] ? `<td rowspan="${rowspans[idx]}" style="vertical-align:middle">${escapeHtml(r["ชื่อห้อง"])}</td>
      <td rowspan="${rowspans[idx]}" style="vertical-align:middle">${escapeHtml(r["Check-in"])}</td>
      <td rowspan="${rowspans[idx]}" style="vertical-align:middle">${escapeHtml(r["Check-out"])}</td>` : ""}
    </tr>`).join("");
    return `<div class="ra-print-section">
      <h3>🏨 ${escapeHtml(sec.title)}
        <span style="color:#64748b;font-weight:400;font-size:12px"> · ${groupRooms.length} ห้อง · ${sec.rows.length} คน${nights > 0 ? ` · ${nights} คืน` : ""}</span>
      </h3>
      <table>
        <thead><tr>
          <th style="width:14%">รหัส</th>
          <th style="width:34%">ชื่อ</th>
          <th style="width:22%">ชื่อห้อง</th>
          <th style="width:15%">Check-in</th>
          <th style="width:15%">Check-out</th>
        </tr></thead>
        <tbody>${trs || `<tr><td colspan="5" style="text-align:center;color:#94a3b8">ยังไม่มีผู้พักในโรงแรมนี้</td></tr>`}</tbody>
      </table>
    </div>`;
  }).join("");

  // Summary box ด้านบน
  const summaryHtml = `<div class="ra-print-section" style="background:#f8fafc;page-break-inside:avoid">
    <table>
      <thead><tr>
        <th>โรงแรม</th>
        <th>ห้อง</th>
        <th>คน</th>
        <th>วันทริป</th>
        <th>รวมแถว</th>
      </tr></thead>
      <tbody><tr style="font-size:13px;font-weight:700">
        <td style="text-align:center">${sections.length}</td>
        <td style="text-align:center">${totalRooms}</td>
        <td style="text-align:center">${totalPax}</td>
        <td style="text-align:center">${tripDays > 0 ? tripDays : "—"}</td>
        <td style="text-align:center">${totalRows}</td>
      </tr></tbody>
    </table>
  </div>`;

  const html = `<div class="ra-print-title">🛏️ จัดห้องพัก — ${escapeHtml(tripName)}${tripDates ? ` · ${tripDates}` : ""}</div>
    <div style="font-size:11px;color:#64748b;margin:-6px 0 10px">📊 สรุปทั้งทริป</div>
    ${summaryHtml}
    ${sectionsHtml || `<div class="ra-print-section"><div style="text-align:center;color:#94a3b8;padding:20px">ยังไม่มีโรงแรม</div></div>`}
    <div style="margin-top:20px;font-size:10px;color:#64748b">
      Generated ${new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })} · A4S-ERP
    </div>`;

  const area = document.getElementById("raPrintArea");
  if (!area) return;
  area.innerHTML = html;
  showToast("เปิดหน้าต่าง print — เลือก 'Save as PDF'", "info");
  setTimeout(() => window.print(), 80);
};

// ── STATS REPORT MODAL ─────────────────────────────────────
window.openRaReport = function (type) {
  const titleEl = document.getElementById("raReportTitle");
  const bodyEl  = document.getElementById("raReportBody");
  const overlay = document.getElementById("raReportOverlay");
  if (!titleEl || !bodyEl || !overlay) return;
  let title = "", html = "";
  switch (type) {
    case "total":        title = "👥 ลูกค้าทั้งหมด";              html = renderReportTotal();        break;
    case "batchPending": title = "🏨 โรงแรมที่ยังจัดคนไม่ครบ";   html = renderReportBatchPending(); break;
    case "mixed":        title = "🚻 ห้องที่มีเพศปนกัน";         html = renderReportMixed();        break;
    case "hotelRooms":   title = "📊 โรงแรม | ห้องทั้งหมด";       html = renderReportHotelRooms();   break;
    default: return;
  }
  titleEl.textContent = title;
  bodyEl.innerHTML = html;
  overlay.classList.add("open");
};
window.closeRaReport = function (e) {
  if (e && e.target.id !== "raReportOverlay") return;
  document.getElementById("raReportOverlay")?.classList.remove("open");
};

// helper: format hotel + dates label สำหรับ section header
function _batchLabelHtml(rooms) {
  const r = rooms[0];
  const hotel = state.hotels.find(h => h.place_id === r.place_id);
  const hotelName = hotel?.place_name || (r.place_id ? `Place #${r.place_id}` : "ไม่ระบุโรงแรม");
  const ci = r.check_in_date  ? fmtDate(r.check_in_date)  : "?";
  const co = r.check_out_date ? fmtDate(r.check_out_date) : "?";
  return `🏨 ${escapeHtml(hotelName)} · ${escapeHtml(r.room_type || "")} · ${ci}→${co}`;
}

function renderReportTotal() {
  const rows = state.passengers.map(p => {
    const name = p.name || p._inheritedName || "—";
    const code = p.code || "—";
    const nat  = p.nationality || p._inheritedNat || "—";
    const g    = normGender(p.gender || p._inheritedGender);
    const gTag = g === "M" ? '<span class="ra-gender-tag ra-gender-M">♂ M</span>'
              : g === "F" ? '<span class="ra-gender-tag ra-gender-F">♀ F</span>' : "";
    const rooms = roomNamesForCode(p.code);
    const roomTag = rooms.length
      ? `<span class="ra-report-pill ok">🛏️ ${escapeHtml(rooms.join(", "))}</span>`
      : `<span class="ra-report-pill warn">ยังไม่มีห้อง</span>`;
    return `<div class="ra-report-row">
      <span class="ra-pax-code">${escapeHtml(code)}</span>
      <span style="flex:1;color:var(--text);font-weight:500">${escapeHtml(name)}</span>
      <span style="color:var(--text3);font-size:11px">${escapeHtml(nat)}</span>
      ${gTag}
      ${roomTag}
    </div>`;
  }).join("");
  return `<div style="font-size:12px;color:var(--text2);margin-bottom:8px">
    รวม ${state.passengers.length} คน
  </div>
  <div class="ra-report-list" style="max-height:60vh">${rows || `<div class="ra-report-empty">ไม่มีข้อมูล</div>`}</div>`;
}

function renderReportBatchPending() {
  // group rooms by groupKey
  const groups = {};
  state.rooms.forEach(r => {
    const k = groupKeyOf(r);
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  });
  const total = state.passengers.length;
  const sections = [];
  Object.keys(groups).forEach(k => {
    const rooms = groups[k];
    const codesIn = new Set();
    rooms.forEach(r => (state.occupants[r.room_id] || []).forEach(c => codesIn.add(c)));
    if (codesIn.size >= total) return; // ครบแล้ว ข้าม
    const missing = state.passengers.filter(p => !codesIn.has(p.code));
    const rowsHtml = missing.map(p => {
      const name = p.name || p._inheritedName || "—";
      const code = p.code || "—";
      const g = normGender(p.gender || p._inheritedGender);
      const gTag = g === "M" ? '<span class="ra-gender-tag ra-gender-M">♂ M</span>'
                : g === "F" ? '<span class="ra-gender-tag ra-gender-F">♀ F</span>' : "";
      return `<div class="ra-report-row">
        <span class="ra-pax-code">${escapeHtml(code)}</span>
        <span style="flex:1;color:var(--text)">${escapeHtml(name)}</span>
        ${gTag}
      </div>`;
    }).join("");
    sections.push(`<div class="ra-report-section">
      <div class="ra-report-section-hdr">
        ${_batchLabelHtml(rooms)}
        <span class="ra-report-pill warn">ยังขาด ${missing.length} คน</span>
        <span class="ra-report-pill">มีแล้ว ${codesIn.size}/${total}</span>
      </div>
      <div class="ra-report-list">${rowsHtml}</div>
    </div>`);
  });
  return sections.length ? sections.join("") : `<div class="ra-report-empty">✅ ทุกโรงแรมจัดครบหมดแล้ว</div>`;
}

function renderReportMixed() {
  const items = [];
  state.rooms.forEach(r => {
    const codes = state.occupants[r.room_id] || [];
    const occs = codes.map(c => state.passengers.find(x => x.code === c)).filter(Boolean);
    const genders = new Set();
    occs.forEach(p => {
      const g = normGender(p.gender || p._inheritedGender);
      if (g) genders.add(g);
    });
    if (genders.size <= 1) return;
    const occHtml = occs.map(p => {
      const name = p.name || p._inheritedName || "—";
      const code = p.code || "—";
      const g = normGender(p.gender || p._inheritedGender);
      const gTag = g === "M" ? '<span class="ra-gender-tag ra-gender-M">♂ M</span>'
                : g === "F" ? '<span class="ra-gender-tag ra-gender-F">♀ F</span>' : "";
      return `<div class="ra-report-row">
        <span class="ra-pax-code">${escapeHtml(code)}</span>
        <span style="flex:1;color:var(--text)">${escapeHtml(name)}</span>
        ${gTag}
      </div>`;
    }).join("");
    items.push(`<div class="ra-report-section">
      <div class="ra-report-section-hdr">
        ${_batchLabelHtml([r])}
        <span class="ra-report-pill err">🛏️ ${escapeHtml(r.room_name)}</span>
      </div>
      <div class="ra-report-list">${occHtml}</div>
    </div>`);
  });
  return items.length ? items.join("") : `<div class="ra-report-empty">✅ ไม่มีห้องที่มีเพศปนกัน</div>`;
}

function renderReportHotelRooms() {
  const groups = {};
  state.rooms.forEach(r => {
    const k = groupKeyOf(r);
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  });
  const sections = Object.keys(groups).map(k => {
    const rooms = groups[k];
    const totalCap = rooms.reduce((a, r) => a + (r.capacity || 0), 0);
    const totalOcc = rooms.reduce((a, r) => a + ((state.occupants[r.room_id] || []).length), 0);
    const roomList = rooms.map(r => {
      const occ = (state.occupants[r.room_id] || []).length;
      const cap = r.capacity || 0;
      const cls = occ === 0 ? "" : (occ >= cap ? "ok" : "warn");
      return `<span class="ra-report-pill ${cls}" title="${escapeAttr(r.room_name)} · ${occ}/${cap}">
        ${escapeHtml(r.room_name)} · ${occ}/${cap}
      </span>`;
    }).join(" ");
    return `<div class="ra-report-section">
      <div class="ra-report-section-hdr">
        ${_batchLabelHtml(rooms)}
        <span class="ra-report-pill">${rooms.length} ห้อง · ${totalOcc}/${totalCap} คน</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:5px">${roomList}</div>
    </div>`;
  });
  return sections.length ? sections.join("") : `<div class="ra-report-empty">ยังไม่มีห้อง</div>`;
}

// ── PASSENGER LIST (left) ──────────────────────────────────
// คน 1 คนอยู่ได้หลายห้อง (คนละช่วง) — return array ของชื่อห้อง
// ถ้าใส่ filterGroupKey → คืนแค่ห้องในกลุ่มนั้น (ใช้ตอนกรองตามโรงแรม)
function roomNamesForCode(code, filterGroupKey) {
  const rids = state.codeToRooms[code];
  if (!rids || !rids.size) return [];
  return [...rids]
    .filter(rid => {
      if (!filterGroupKey) return true;
      const room = state.rooms.find(x => x.room_id === rid);
      return room && groupKeyOf(room) === filterGroupKey;
    })
    .map(rid => roomNameById(rid))
    .filter(Boolean);
}

// จำนวน batch (group) ทั้งหมดของทริปนี้ — ใช้ตัดสินว่าคนถูก "จัดครบทุกช่วง" หรือยัง
function totalBatchCount() {
  const set = new Set();
  state.rooms.forEach(r => set.add(groupKeyOf(r)));
  return set.size;
}
// จำนวน batch ที่ code นี้ถูก assign แล้ว
function assignedBatchCount(code) {
  const rids = state.codeToRooms[code];
  if (!rids || !rids.size) return 0;
  const set = new Set();
  rids.forEach(rid => {
    const room = state.rooms.find(x => x.room_id === rid);
    if (room) set.add(groupKeyOf(room));
  });
  return set.size;
}

function renderPassengers() {
  const search = (document.getElementById("paxSearch")?.value || "").toLowerCase();
  const status = document.getElementById("paxFilterStatus")?.value || "unassigned";
  const gender = document.getElementById("paxFilterGender")?.value || "";

  const batchKey = document.getElementById("paxFilterBatch")?.value || "";
  const totalB = totalBatchCount();

  // กันสับสน: ถ้ามีหลายโรงแรมแต่ user ยังไม่เลือก → ไม่แสดงรายชื่อ
  if (totalB > 1 && !batchKey) {
    document.getElementById("paxFilteredCount").textContent = 0;
    const list = document.getElementById("paxList");
    if (list) {
      list.innerHTML = `<div class="ra-pax-empty" style="padding:30px 20px">
        🏨 เลือกโรงแรมก่อน<br>
        <span style="font-size:11px;color:var(--text3);margin-top:6px;display:inline-block">
          ทริปนี้มี ${totalB} ช่วงพัก — เลือกช่วงที่ต้องการจัดห้องด้านบน
        </span>
      </div>`;
    }
    return;
  }

  // ถ้า batchKey ระบุ → "ยังไม่จัด/จัดแล้ว" หมายถึงเฉพาะใน batch นั้น
  // ถ้าไม่ระบุ (เพราะมี batch เดียว) → ใช้ semantics รวม
  const isInBatch = (code) => {
    const rids = state.codeToRooms[code];
    if (!rids || !rids.size) return false;
    return [...rids].some(rid => {
      const room = state.rooms.find(x => x.room_id === rid);
      return room && groupKeyOf(room) === batchKey;
    });
  };
  const filtered = state.passengers.filter(p => {
    if (batchKey) {
      const inB = isInBatch(p.code);
      if (status === "unassigned" && inB) return false;
      if (status === "assigned" && !inB) return false;
    } else {
      const aB = assignedBatchCount(p.code);
      if (status === "unassigned" && totalB > 0 && aB >= totalB) return false;
      if (status === "assigned" && (totalB === 0 || aB < totalB)) return false;
    }
    if (gender && normGender(p.gender) !== gender) return false;
    if (search) {
      const hay = `${p.code || ""} ${p.name || ""} ${p.group_name || ""}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  document.getElementById("paxFilteredCount").textContent = filtered.length;

  const list = document.getElementById("paxList");
  if (!filtered.length) {
    list.innerHTML = `<div class="ra-pax-empty">ไม่พบลูกค้า</div>`;
    return;
  }

  list.innerHTML = filtered.map(p => {
    // เมื่อกรองตามโรงแรม → แสดงเฉพาะห้องในโรงแรมนั้น (ไม่ปนกับช่วงอื่น)
    const rooms = roomNamesForCode(p.code, batchKey);
    const isAssigned = rooms.length > 0;
    const sel = state.selectedPaxCode === p.code ? " selected" : "";
    const ass = isAssigned ? " assigned" : "";
    const gNorm = normGender(p.gender || p._inheritedGender);
    const gTag = gNorm === "M" ? '<span class="ra-gender-tag ra-gender-M">♂ M</span>'
              : gNorm === "F" ? '<span class="ra-gender-tag ra-gender-F">♀ F</span>'
              : "";
    const roomTag = isAssigned
      ? (rooms.length === 1
          ? `🛏️ ${escapeHtml(rooms[0])}`
          : `🛏️ ${rooms.length} ห้อง · ${escapeHtml(rooms.join(", "))}`)
      : "";
    // sub-row → fallback เป็น parent
    const displayName = p.name || p._inheritedName || "—";
    const displayNat  = p.nationality || p._inheritedNat || "—";
    const codeText    = p.code || "—";
    const hasImg      = !!(p.passport_image_url || p._inheritedPassImg || p.visa_image_url || p._inheritedVisaImg);
    return `<div class="ra-pax-row${sel}${ass}${p.is_sub_row ? " sub" : ""}" data-code="${escapeAttr(p.code)}" onclick="window.selectPax('${escapeJs(p.code)}')">
      <div class="ra-pax-row-top">
        <span class="ra-pax-code">${escapeHtml(codeText)}</span>
        <span class="ra-pax-nat">${escapeHtml(displayNat)}</span>
      </div>
      <div class="ra-pax-row-bot">
        <span class="ra-pax-name${hasImg ? ' clickable' : ''}"
          ${hasImg ? `title="คลิกดูรูป passport" onclick="event.stopPropagation();window.viewPaxPassport('${escapeJs(p.code)}')"` : ""}>
          ${escapeHtml(displayName)}${hasImg ? ' <span class="ra-pax-img-ind">📷</span>' : ''}
        </span>
        ${gTag || '<span></span>'}
      </div>
      ${roomTag ? `<div class="ra-pax-room-tag" title="${escapeAttr(rooms.join(", "))}">${roomTag}</div>` : ""}
    </div>`;
  }).join("");
}

window.selectPax = function (code) {
  // toggle off if clicking same row
  state.selectedPaxCode = state.selectedPaxCode === code ? null : code;
  renderPassengers();
  updateSelectionHint();
  updateRoomCardsAssignableState();
};

window.clearPaxSelection = function () {
  state.selectedPaxCode = null;
  renderPassengers();
  updateSelectionHint();
  updateRoomCardsAssignableState();
};

function updateSelectionHint() {
  const hint = document.getElementById("selectedHint");
  const btn  = document.getElementById("btnClearSelection");
  if (state.selectedPaxCode) {
    const p = state.passengers.find(x => x.code === state.selectedPaxCode);
    hint.innerHTML = `เลือก: <b style="color:var(--accent)">${escapeHtml(p?.name || state.selectedPaxCode)}</b> — คลิกห้องที่ต้องการ`;
    btn.style.display = "inline-flex";
  } else {
    hint.textContent = "ยังไม่ได้เลือกลูกค้า — คลิกชื่อด้านซ้ายเพื่อเริ่ม";
    btn.style.display = "none";
  }
}

function updateRoomCardsAssignableState() {
  document.querySelectorAll(".ra-room-card").forEach(card => {
    const rid = parseInt(card.dataset.roomId, 10);
    const r = state.rooms.find(x => x.room_id === rid);
    if (!r) return;
    const occCount = (state.occupants[rid] || []).length;
    const isFull = occCount >= r.capacity;
    card.classList.toggle("full", isFull);
    card.classList.toggle("assignable", !!state.selectedPaxCode && !isFull);
  });
}

// group key: hotel + room type + ช่วงวัน — ห้องคนละช่วงวัน = คนละกลุ่ม
function groupKeyOf(r) {
  return `${r.place_id || 0}|${r.room_type || "อื่นๆ"}|${r.check_in_date || ""}|${r.check_out_date || ""}`;
}

// ── ROOMS (right) ──────────────────────────────────────────
function roomNameById(rid) {
  const r = state.rooms.find(x => x.room_id === rid);
  return r ? r.room_name : "";
}

function renderRooms() {
  const c = document.getElementById("roomsContainer");
  if (!state.rooms.length) {
    c.innerHTML = `<div class="ra-empty-rooms">
      ยังไม่มีห้องพัก — กด "＋ เพิ่มประเภทห้อง" เพื่อสร้าง
    </div>`;
    return;
  }

  // Group by place_id + room_type + dates — ห้องคนละช่วงวัน = คนละกลุ่ม
  const groups = {};
  state.rooms.forEach(r => {
    const k = groupKeyOf(r);
    if (!groups[k]) groups[k] = [];
    groups[k].push(r);
  });

  // ใช้ state.occupants ที่ load จาก trip_room_occupants — รองรับ 1 คน × N ห้อง
  // resolve code → passenger row
  const paxByCode = {};
  state.passengers.forEach(p => { paxByCode[p.code] = p; });
  const occByRoom = {}; // { room_id: [passenger row, ...] }
  Object.keys(state.occupants).forEach(rid => {
    occByRoom[rid] = (state.occupants[rid] || [])
      .map(code => paxByCode[code])
      .filter(Boolean);
  });

  c.innerHTML = Object.keys(groups).map(groupKey => {
    const rooms = groups[groupKey];
    const placeId = rooms[0]?.place_id || null;
    const typeName = rooms[0]?.room_type || "อื่นๆ";
    const hotel = state.hotels.find(h => h.place_id === placeId);
    const hotelName = hotel?.place_name || (placeId ? `Place #${placeId}` : "ไม่ระบุโรงแรม");
    const totalCap = rooms.reduce((a, r) => a + (r.capacity || 0), 0);
    const totalOcc = rooms.reduce((a, r) => a + (occByRoom[r.room_id]?.length || 0), 0);
    // คนที่ "จัดแล้ว" ในกลุ่มนี้ = unique codes ที่มีห้องในกลุ่มนี้
    const assignedCodesInGroup = new Set();
    rooms.forEach(r => (state.occupants[r.room_id] || []).forEach(c => assignedCodesInGroup.add(c)));
    const unassignedInGroup = state.passengers.length - assignedCodesInGroup.size;

    const ridsCsv = rooms.map(r => r.room_id).join(",");
    // apply filter — show rooms ที่ยังไม่เต็ม (0 occupants OR partially filled)
    const visibleRooms = state.filterEmptyOnly
      ? rooms.filter(r => (occByRoom[r.room_id]?.length || 0) < (r.capacity || 0))
      : rooms;
    const hiddenCount = rooms.length - visibleRooms.length;

    // ช่วงวันที่ของกลุ่ม — ถ้าทุกห้องใช้ช่วงเดียวกัน แสดงครั้งเดียว, ถ้าต่างกันแสดง "หลายช่วง"
    const inSet  = new Set(rooms.map(r => r.check_in_date  || ""));
    const outSet = new Set(rooms.map(r => r.check_out_date || ""));
    let dateLabel = "";
    if (inSet.size === 1 && outSet.size === 1) {
      const ci = [...inSet][0], co = [...outSet][0];
      if (ci || co) dateLabel = `📅 ${ci ? fmtDate(ci) : "—"} → ${co ? fmtDate(co) : "—"}`;
    } else {
      dateLabel = `<span title="ห้องในกลุ่มนี้มีช่วงวันต่างกัน">📅 หลายช่วง</span>`;
    }

    const isCollapsed = state.collapsedGroups.has(groupKey);
    const activeBatchKey = document.getElementById("paxFilterBatch")?.value || "";
    const totalBatches = (() => {
      const s = new Set();
      state.rooms.forEach(r => s.add(groupKeyOf(r)));
      return s.size;
    })();
    const isLocked = totalBatches > 1 && !!activeBatchKey && groupKey !== activeBatchKey;
    return `<div class="ra-rooms-grp${isCollapsed ? " collapsed" : ""}${isLocked ? " locked" : ""}">
      <div class="ra-rooms-grp-hdr">
        <div class="ra-grp-title">
          <button class="ra-grp-toggle${isLocked ? " locked" : ""}"
            title="${isLocked ? "เปลี่ยนโรงแรมจาก dropdown ด้านซ้ายเพื่อขยาย" : (isCollapsed ? "ขยาย" : "ย่อ") + "กลุ่มนี้"}"
            onclick="window.toggleGroupCollapse('${escapeJs(groupKey)}')">${isLocked ? "🔒" : (isCollapsed ? "▸" : "▾")}</button>
          <span class="ra-grp-icon">🏨</span>
          <span class="ra-grp-hotel${placeId ? ' clickable' : ''}"
            ${placeId ? `title="คลิกดูรูปโรงแรม" onclick="window.viewHotelImages(${placeId})"` : ""}>${escapeHtml(hotelName)}</span>
          <span class="ra-grp-sep"> : </span>
          <span class="ra-grp-room${placeId ? ' clickable' : ''}"
            ${placeId ? `title="คลิกดูรูปประเภทห้อง" onclick="window.viewRoomTypeFromGroup(${placeId}, '${escapeJs(typeName)}')"` : ""}>${escapeHtml(typeName)}</span>
          <span class="ra-grp-sep"> : </span>
          <span class="ra-grp-count">${rooms.length} ห้อง</span>
          <span class="ra-grp-sep"> : </span>
          <span class="ra-grp-count">${totalOcc}/${totalCap} คน</span>
          <div class="ra-grp-line2">
            ${dateLabel ? `<span class="ra-grp-dates">${dateLabel}</span>` : ""}
            <span class="ra-grp-pill ra-grp-pill-ok"
              title="คนที่มีห้องในช่วงพักนี้แล้ว">✅ ${assignedCodesInGroup.size}</span>
            <span class="ra-grp-pill ra-grp-pill-warn"
              title="คนที่ยังไม่มีห้องในช่วงพักนี้">⏳ ${unassignedInGroup}</span>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px${isLocked ? ';visibility:hidden' : ''}">
          <button class="ra-toggle-empty ra-add-room"
            data-perm="trip_rooms_create"
            title="เพิ่ม 1 ห้องในกลุ่มนี้"
            onclick="window.addOneRoomToGroup('${escapeJs(groupKey)}')">
            ＋ ห้อง
          </button>
          <button class="ra-toggle-empty${state.filterEmptyOnly ? ' active' : ''}"
            title="ดูห้องที่ยังไม่เต็ม (ว่าง + อยู่ไม่ครบ)"
            onclick="window.toggleEmptyOnlyFilter(${!state.filterEmptyOnly})">
            ${state.filterEmptyOnly ? '✓' : '○'} ห้องว่าง
          </button>
          <div class="ra-grp-kebab-wrap" data-group="${escapeAttr(groupKey)}">
            <button class="ra-grp-kebab" title="ตัวเลือกเพิ่มเติม"
              onclick="window.toggleGroupKebab('${escapeJs(groupKey)}', event)">⋮</button>
            <div class="ra-grp-kebab-menu" onclick="event.stopPropagation()">
              <button onclick="window.duplicateRoomGroup('${escapeJs(groupKey)}');window.closeGroupKebabs()">
                <span class="ra-kebab-icon">📋</span> คัดลอก
              </button>
              <button data-perm="trip_rooms_edit"
                onclick="window.editRoomGroup('${escapeJs(groupKey)}');window.closeGroupKebabs()">
                <span class="ra-kebab-icon">✏️</span> แก้ไข
              </button>
              <button class="danger" data-perm="trip_rooms_delete"
                onclick="window.closeGroupKebabs();window.deleteRoomGroup('${escapeJs(hotelName + ' : ' + typeName)}', [${ridsCsv}], ${totalOcc})">
                <span class="ra-kebab-icon">🗑</span> ลบทั้งหมด
              </button>
            </div>
          </div>
        </div>
      </div>
      ${isCollapsed ? "" : `
        ${hiddenCount > 0 ? `<div style="font-size:11px;color:var(--text3);margin-bottom:6px">ซ่อน ${hiddenCount} ห้องที่จัดเต็มแล้ว</div>` : ""}
        <div class="ra-rooms-cards">
          ${visibleRooms.length ? visibleRooms.map(r => roomCardHtml(r, occByRoom[r.room_id] || [])).join("") : `<div class="ra-empty-rooms" style="grid-column:1/-1">ห้องในกลุ่มนี้ถูกจัดเต็มแล้ว</div>`}
        </div>
      `}
    </div>`;
  }).join("");

  updateRoomCardsAssignableState();
}

function roomCardHtml(r, occupants) {
  const occCount = occupants.length;
  const cap = r.capacity || 0;
  const pct = cap > 0 ? Math.min(100, (occCount / cap) * 100) : 0;
  const fullCls = occCount >= cap ? " full" : (pct >= 70 ? " warn" : "");
  const occHtml = occupants.map(o => {
    const gn = normGender(o.gender || o._inheritedGender);
    const gT = gn === "M" ? '<span class="ra-gender-tag ra-gender-M">♂ M</span>'
            : gn === "F" ? '<span class="ra-gender-tag ra-gender-F">♀ F</span>'
            : "";
    const dName = o.name || o._inheritedName || "—";
    const dNat  = o.nationality || o._inheritedNat || "—";
    const hasImg = !!(o.passport_image_url || o._inheritedPassImg || o.visa_image_url || o._inheritedVisaImg);
    return `<div class="ra-occ">
      <button class="ra-occ-remove" title="ย้ายออกจากห้องนี้" onclick="event.stopPropagation();window.unassignPax('${escapeJs(o.code)}', ${r.room_id})">×</button>
      <div class="ra-pax-row-top">
        <span class="ra-pax-code">${escapeHtml(o.code || "—")}</span>
        <span class="ra-pax-nat">${escapeHtml(dNat)}</span>
      </div>
      <div class="ra-pax-row-bot">
        <span class="ra-pax-name${hasImg ? ' clickable' : ''}"
          ${hasImg ? `title="คลิกดูรูป passport" onclick="event.stopPropagation();window.viewPaxPassport('${escapeJs(o.code)}')"` : ""}>
          ${escapeHtml(dName)}${hasImg ? ' <span class="ra-pax-img-ind">📷</span>' : ''}
        </span>
        ${gT || '<span></span>'}
      </div>
    </div>`;
  }).join("");

  const hasNote = !!(r.note && r.note.trim());
  return `<div class="ra-room-card" data-room-id="${r.room_id}" onclick="window.assignSelectedPax(${r.room_id})">
    <div class="ra-room-card-hdr">
      <input class="ra-room-name" value="${escapeAttr(r.room_name || "")}" data-room-id="${r.room_id}"
             onclick="event.stopPropagation()"
             onblur="window.renameRoom(${r.room_id}, this.value)"
             onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}" />
      <div class="ra-room-actions" onclick="event.stopPropagation()">
        <button class="${hasNote ? "has-note" : ""}" title="${hasNote ? "หมายเหตุ: " + escapeAttr(r.note) : "เพิ่มหมายเหตุ"}"
                onclick="window.editRoomNote(${r.room_id})">📝</button>
        <button class="danger" title="ลบห้องนี้" data-perm="trip_rooms_delete"
                onclick="window.deleteRoom(${r.room_id})">🗑</button>
      </div>
    </div>
    <div class="ra-room-meta" onclick="event.stopPropagation()">
      <div class="ra-cap-bar"><div class="ra-cap-fill${fullCls}" style="width:${pct}%"></div></div>
      <div class="ra-cap-text">
        ${occCount}/<span class="ra-cap-edit" title="คลิกเพื่อแก้ความจุ (เผื่อ extra bed)"
          onclick="window.editRoomCapacity(${r.room_id}, ${cap}, ${occCount})"
          style="cursor:pointer;border-bottom:1px dashed var(--text3);padding:0 2px">${cap}</span>
      </div>
    </div>
    ${hasNote ? `<div class="ra-room-note" title="${escapeAttr(r.note)}">📝 ${escapeHtml(r.note)}</div>` : ""}
    ${occHtml ? `<div class="ra-room-occupants">${occHtml}</div>` : `<div style="font-size:11px;color:var(--text3);text-align:center;padding:8px 0">ห้องว่าง</div>`}
  </div>`;
}

// ── ASSIGN / UNASSIGN ──────────────────────────────────────
// helpers: mutate state.occupants + state.codeToRooms in pairs
function _addOccupant(roomId, code) {
  if (!state.occupants[roomId]) state.occupants[roomId] = [];
  if (!state.occupants[roomId].includes(code)) state.occupants[roomId].push(code);
  if (!state.codeToRooms[code]) state.codeToRooms[code] = new Set();
  state.codeToRooms[code].add(roomId);
}
function _removeOccupant(roomId, code) {
  if (state.occupants[roomId]) {
    state.occupants[roomId] = state.occupants[roomId].filter(c => c !== code);
    if (!state.occupants[roomId].length) delete state.occupants[roomId];
  }
  if (state.codeToRooms[code]) {
    state.codeToRooms[code].delete(roomId);
    if (!state.codeToRooms[code].size) delete state.codeToRooms[code];
  }
}

window.assignSelectedPax = async function (roomId) {
  if (!state.selectedPaxCode) {
    showToast("เลือกลูกค้าทางซ้ายก่อน", "info");
    return;
  }
  const r = state.rooms.find(x => x.room_id === roomId);
  if (!r) return;

  const code = state.selectedPaxCode;
  const p = state.passengers.find(x => x.code === code);
  if (!p) return;

  // 1 คนห้ามอยู่ 2 ห้องในกลุ่มเดียวกัน — เช็คห้องเดิมในกลุ่มนี้
  const targetGroupKey = groupKeyOf(r);
  const existingRoomsOfCode = [...(state.codeToRooms[code] || [])];
  const sameGroupExisting = existingRoomsOfCode.filter(rid => {
    const room = state.rooms.find(x => x.room_id === rid);
    return room && groupKeyOf(room) === targetGroupKey;
  });

  // Already in this exact room
  if (sameGroupExisting.includes(roomId)) {
    showToast(`${p.name || code} อยู่ใน "${r.room_name}" อยู่แล้ว`, "info");
    return;
  }

  // Capacity check
  const occCount = (state.occupants[roomId] || []).length;
  if (occCount >= r.capacity) {
    showToast(`ห้อง "${r.room_name}" เต็มแล้ว (${occCount}/${r.capacity})`, "error");
    return;
  }

  // Optimistic UI: ถ้าอยู่ห้องอื่นในกลุ่มนี้ → ย้าย (remove เก่า + add ใหม่), ไม่อย่างนั้น add อย่างเดียว
  const oldRoomId = sameGroupExisting[0] || null;
  if (oldRoomId) _removeOccupant(oldRoomId, code);
  _addOccupant(roomId, code);
  state.selectedPaxCode = null;
  renderStats();
  renderPassengers();
  renderRooms();
  updateSelectionHint();

  try {
    if (oldRoomId) {
      await sbFetch("trip_room_occupants",
        `?room_id=eq.${oldRoomId}&code=eq.${encodeURIComponent(code)}`,
        { method: "DELETE" });
    }
    await sbFetch("trip_room_occupants", "", {
      method: "POST",
      body: { room_id: roomId, code },
    });
    const oldRoom = oldRoomId ? state.rooms.find(x => x.room_id === oldRoomId) : null;
    const verb = oldRoom ? `ย้ายจาก "${oldRoom.room_name}" → "${r.room_name}"` : `→ ${r.room_name}`;
    showToast(`✅ ${p.name || code} ${verb}`, "success");
  } catch (e) {
    // revert
    _removeOccupant(roomId, code);
    if (oldRoomId) _addOccupant(oldRoomId, code);
    renderStats();
    renderPassengers();
    renderRooms();
    showToast("Assign ไม่สำเร็จ: " + e.message, "error");
  }
};

// unassign 1 คนออกจาก "ห้องเฉพาะห้องเดียว" — ต้องระบุ roomId เพราะคน 1 คนอยู่ได้หลายห้อง
window.unassignPax = async function (code, roomId) {
  const p = state.passengers.find(x => x.code === code);
  if (!p) return;
  if (roomId == null) {
    showToast("ต้องระบุห้องที่จะย้ายออก", "error");
    return;
  }
  const r = state.rooms.find(x => x.room_id === roomId);

  _removeOccupant(roomId, code);
  renderStats();
  renderPassengers();
  renderRooms();

  try {
    await sbFetch("trip_room_occupants",
      `?room_id=eq.${roomId}&code=eq.${encodeURIComponent(code)}`,
      { method: "DELETE" });
    showToast(`ย้ายออกจาก "${r?.room_name || "ห้อง"}" แล้ว: ${p.name || code}`, "success");
  } catch (e) {
    _addOccupant(roomId, code); // revert
    renderStats();
    renderPassengers();
    renderRooms();
    showToast("ย้ายออกไม่สำเร็จ: " + e.message, "error");
  }
};

// ── ROOM CRUD ──────────────────────────────────────────────
function populateHotelDropdown() {
  const sel = document.getElementById("rbHotel");
  if (!sel) return;
  const opts = ['<option value="">— เลือกโรงแรม —</option>'];
  state.hotels.forEach(h => {
    opts.push(`<option value="${h.place_id}">🏨 ${escapeHtml(h.place_name || "")}</option>`);
  });
  sel.innerHTML = opts.join("");
  sel.onchange = onHotelChange;
}

async function onHotelChange() {
  const sel = document.getElementById("rbHotel");
  const types = document.getElementById("rbRoomTypes");
  const placeId = parseInt(sel.value, 10);

  // toggle has-value class (เปลี่ยนสี orange → green)
  sel.classList.toggle("has-value", !!placeId);

  // reset selected room type ทุกครั้งที่เปลี่ยนโรงแรม
  state.rbSelectedHotelId = placeId || null;
  state.rbSelectedRoomTypeName = null;
  state.rbSelectedRoomTypeMaxGuests = 0;

  if (!placeId) {
    types.innerHTML = `<div class="rb-rt-empty">เลือกโรงแรมก่อน</div>`;
    return;
  }
  const hotel = state.hotels.find(h => h.place_id === placeId);
  if (!hotel) return;

  // Load room types (cached)
  if (!state.hotelRoomTypes[placeId]) {
    types.innerHTML = `<div class="rb-rt-empty">⏳ กำลังโหลดประเภทห้อง...</div>`;
    try {
      const rt = await sbFetch("place_room_types",
        `?place_id=eq.${placeId}&select=*&order=sort_order.asc`);
      state.hotelRoomTypes[placeId] = rt || [];
    } catch (e) {
      state.hotelRoomTypes[placeId] = [];
    }
  }
  renderRoomTypes(placeId);
}

function renderRoomTypes(placeId) {
  const container = document.getElementById("rbRoomTypes");
  const list = state.hotelRoomTypes[placeId] || [];
  if (!list.length) {
    container.innerHTML = `<div class="rb-rt-empty" style="background:#fef2f2;color:#991b1b">
      ⚠️ โรงแรมนี้ยังไม่ได้กำหนดประเภทห้อง<br>
      <a href="../event/events-place-form.html?id=${placeId}" target="_blank" style="color:#0f4c75;text-decoration:underline;font-weight:600">เพิ่มประเภทห้องที่หน้าสถานที่ →</a>
    </div>`;
    return;
  }
  container.innerHTML = `
    <div class="rb-rt-grid">
      ${list.map((rt, i) => {
        const bed = rt.bed_type === "SINGLE" ? "Single bed" : rt.bed_type === "DOUBLE" ? "Double bed" : "—";
        const cap = rt.max_guests || 2;
        const imgs = Array.isArray(rt.image_urls) ? rt.image_urls : [];
        const hasImg = imgs.length > 0;
        const cover = imgs[0] || "../../assets/images/NoImage.png";
        const price = rt.rate_per_night ? `${fmtMoney(rt.rate_per_night)} ฿/คืน` : "ราคา: —";
        const extraBed = rt.rate_extra_bed ? `Extra bed: ${fmtMoney(rt.rate_extra_bed)} ฿` : "Extra bed: —";
        return `<div class="rb-rt-card" data-rt-idx="${i}"
          onclick="window.pickRoomType(${i})">
          <img class="rb-rt-img${hasImg ? ' clickable' : ''}" src="${cover}" alt="${escapeAttr(rt.room_type_name || "")}"
            ${hasImg ? `onclick="event.stopPropagation();window.viewRoomTypeImages(${i})" title="คลิกดูรูปขยาย"` : ""}
            onerror="this.src='../../assets/images/NoImage.png';this.classList.remove('clickable');this.onclick=null;" />
          <div class="rb-rt-name">${escapeHtml(rt.room_type_name || "—")}</div>
          <div class="rb-rt-meta">${bed} · ${cap} คน${rt.breakfast_included ? " · อาหารเช้า" : ""}</div>
          <div class="rb-rt-price">${price}</div>
          <div class="rb-rt-extra">${extraBed}</div>
        </div>`;
      }).join("")}
    </div>`;
}

// คลิกชื่อโรงแรมที่ group header → เปิดรูปภาพรวมของโรงแรม
window.viewHotelImages = function (placeId) {
  const hotel = state.hotels.find(h => h.place_id === placeId);
  if (!hotel) { showToast("ไม่พบข้อมูลโรงแรม", "info"); return; }
  // image_urls อาจเป็น array (legacy) หรือ object {exterior, food} (ปัจจุบัน)
  const raw = hotel.image_urls;
  let imgs = [];
  if (Array.isArray(raw)) imgs = raw.filter(Boolean);
  else if (raw && typeof raw === "object") {
    imgs = [...(raw.exterior || []), ...(raw.food || [])].filter(Boolean);
  }
  if (!imgs.length) { showToast(`ยังไม่มีรูปของ ${hotel.place_name || ""}`, "info"); return; }
  const titles = imgs.map(() => hotel.place_name || "โรงแรม");
  if (typeof ImgPopup !== "undefined" && ImgPopup.open) {
    ImgPopup.open(imgs, 0, { titles });
  } else {
    window.open(imgs[0], "_blank");
  }
};

// คลิกชื่อประเภทห้องที่ group header → เปิดรูปของ room type นั้น
window.viewRoomTypeFromGroup = async function (placeId, roomTypeName) {
  if (!placeId || !roomTypeName) return;
  // โหลด cache ถ้ายังไม่มี
  if (!state.hotelRoomTypes[placeId]) {
    showLoading(true);
    try {
      const rt = await sbFetch("place_room_types",
        `?place_id=eq.${placeId}&select=*&order=sort_order.asc`);
      state.hotelRoomTypes[placeId] = rt || [];
    } catch (e) {
      state.hotelRoomTypes[placeId] = [];
    }
    showLoading(false);
  }
  const list = state.hotelRoomTypes[placeId] || [];
  const rt = list.find(x => (x.room_type_name || "") === roomTypeName);
  if (!rt) { showToast(`ไม่พบประเภทห้อง "${roomTypeName}" ของโรงแรมนี้`, "info"); return; }
  const imgs = Array.isArray(rt.image_urls) ? rt.image_urls.filter(Boolean) : [];
  if (!imgs.length) { showToast(`ยังไม่มีรูปของ ${roomTypeName}`, "info"); return; }
  const titles = imgs.map(() => rt.room_type_name || "ห้องพัก");
  if (typeof ImgPopup !== "undefined" && ImgPopup.open) {
    ImgPopup.open(imgs, 0, { titles });
  } else {
    window.open(imgs[0], "_blank");
  }
};

window.viewRoomTypeImages = function (i) {
  const placeId = state.rbSelectedHotelId;
  if (!placeId) return;
  const list = state.hotelRoomTypes[placeId] || [];
  const rt = list[i];
  if (!rt) return;
  const imgs = Array.isArray(rt.image_urls) ? rt.image_urls.filter(Boolean) : [];
  if (!imgs.length) return;
  const titles = imgs.map(() => rt.room_type_name || "ห้องพัก");
  if (typeof ImgPopup !== "undefined" && ImgPopup.open) {
    ImgPopup.open(imgs, 0, { titles });
  } else {
    window.open(imgs[0], "_blank");
  }
};

window.pickRoomType = function (idx) {
  const placeId = state.rbSelectedHotelId;
  const list = state.hotelRoomTypes[placeId] || [];
  const rt = list[idx];
  if (!rt) return;

  state.rbSelectedRoomTypeName = rt.room_type_name || "";
  state.rbSelectedRoomTypeMaxGuests = rt.max_guests || 2;

  // visual highlight on selected card
  document.querySelectorAll(".rb-rt-card").forEach(el => el.classList.remove("selected"));
  const target = document.querySelector(`.rb-rt-card[data-rt-idx="${idx}"]`);
  if (target) target.classList.add("selected");
};

// คำนวณส่วนต่างวัน (in → out) เพื่อ highlight chip ที่ตรงกับช่วงปัจจุบัน
function diffDays(isoIn, isoOut) {
  if (!isoIn || !isoOut) return null;
  const a = new Date(isoIn + "T00:00:00");
  const b = new Date(isoOut + "T00:00:00");
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((b - a) / 86400000);
}

window.refreshDurationChips = function () {
  const inEl = document.getElementById("rbCheckIn");
  const outEl = document.getElementById("rbCheckOut");
  const d = diffDays(inEl?.value, outEl?.value);
  document.querySelectorAll("#rbDaysChips input[type='checkbox']").forEach(cb => {
    cb.checked = (d != null && parseInt(cb.dataset.days, 10) === d);
  });
};

window.setStayDays = function (days, cb) {
  // Single-select: uncheck others (เพราะ logic เหมือน radio)
  document.querySelectorAll("#rbDaysChips input[type='checkbox']").forEach(other => {
    if (other !== cb) other.checked = false;
  });
  if (!cb.checked) {
    // ผู้ใช้กดเอาออก → ไม่เปลี่ยน check-out
    return;
  }
  const inEl = document.getElementById("rbCheckIn");
  const outEl = document.getElementById("rbCheckOut");
  const inVal = inEl?.value;
  if (!inVal) {
    showToast("ใส่ Check-in ก่อน", "error");
    cb.checked = false;
    return;
  }
  const d = new Date(inVal + "T00:00:00");
  if (isNaN(d)) return;
  d.setDate(d.getDate() + days);
  // ISO format (YYYY-MM-DD)
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  outEl.value = `${yy}-${mm}-${dd}`;
};

window.openRoomBatchModal = function () {
  state.editingGroupKey = null;
  state.duplicateFromGroupKey = null;
  document.getElementById("rbModalTitle").textContent = "เพิ่มประเภทห้องพัก";
  document.getElementById("rbSaveBtn").innerHTML = "💾 สร้างห้อง";
  document.getElementById("rbCountWrap").style.display = "";
  document.getElementById("rbCountLabel").innerHTML = 'จำนวนห้อง <span class="req">*</span>';
  document.getElementById("rbCountHint").style.display = "none";
  const cnt = document.getElementById("rbCount");
  cnt.value = 1;
  cnt.readOnly = false;
  cnt.style.background = "";
  cnt.style.opacity = "";
  // default check-in/out จากช่วงวันของทริป
  document.getElementById("rbCheckIn").value  = state.trip?.start_date || "";
  document.getElementById("rbCheckOut").value = state.trip?.end_date   || "";
  window.refreshDurationChips();
  const sel = document.getElementById("rbHotel");
  if (sel) { sel.value = ""; sel.classList.remove("has-value"); }
  const types = document.getElementById("rbRoomTypes");
  if (types) types.innerHTML = `<div class="rb-rt-empty">เลือกโรงแรมก่อน</div>`;
  state.rbSelectedHotelId = null;
  state.rbSelectedRoomTypeName = null;
  state.rbSelectedRoomTypeMaxGuests = 0;
  document.getElementById("roomBatchOverlay").classList.add("open");
  setTimeout(() => document.getElementById("rbHotel")?.focus(), 50);
};

window.closeRoomBatchModal = function (e) {
  if (e && e.target.id !== "roomBatchOverlay") return;
  document.getElementById("roomBatchOverlay").classList.remove("open");
  state.editingGroupKey = null;
  state.duplicateFromGroupKey = null;
  // ปลดล็อก rbCount เผื่อโดน lock จาก duplicate mode
  const cnt = document.getElementById("rbCount");
  if (cnt) { cnt.readOnly = false; cnt.style.background = ""; cnt.style.opacity = ""; }
};

window.saveRoomBatch = async function () {
  if (!state.rbSelectedHotelId) {
    showToast("เลือกโรงแรมก่อน", "error");
    return;
  }
  if (!state.rbSelectedRoomTypeName) {
    showToast("เลือกประเภทห้องก่อน", "error");
    return;
  }
  const name = state.rbSelectedRoomTypeName;
  const cap = state.rbSelectedRoomTypeMaxGuests || 2;
  const checkIn  = document.getElementById("rbCheckIn").value  || null;
  const checkOut = document.getElementById("rbCheckOut").value || null;

  if (checkIn && checkOut && checkOut < checkIn) {
    showToast("Check-out ต้องไม่น้อยกว่า Check-in", "error");
    return;
  }

  // EDIT mode — PATCH ทุกห้องในกลุ่มเดิม + (ถ้า rbCount > 0) เพิ่มห้องใหม่
  if (state.editingGroupKey) {
    const targets = state.rooms.filter(r => groupKeyOf(r) === state.editingGroupKey);
    if (!targets.length) { showToast("ไม่พบกลุ่มที่จะแก้ไข", "error"); return; }
    const ids = targets.map(r => r.room_id);
    const body = {
      place_id: state.rbSelectedHotelId,
      room_type: name,
      capacity: cap,
      check_in_date: checkIn,
      check_out_date: checkOut,
      updated_at: new Date().toISOString(),
    };
    const addCount = Math.max(0, parseInt(document.getElementById("rbCount").value, 10) || 0);
    showLoading(true);
    try {
      await sbFetch("trip_rooms", `?room_id=in.(${ids.join(",")})`, { method: "PATCH", body });
      // อัปเดต room_name ให้ prefix ตาม room_type ใหม่ (Twin-1 → Suite-1 ฯลฯ)
      // แต่ถ้า room_type ไม่เปลี่ยน ก็ไม่ต้องยุ่ง — เช็คก่อน
      const oldType = targets[0].room_type;
      if (oldType !== name) {
        // rename ทีละห้อง (ตาม index เดิม)
        await Promise.all(targets.map((r, i) =>
          sbFetch("trip_rooms", `?room_id=eq.${r.room_id}`, {
            method: "PATCH",
            body: { room_name: `${name}-${i + 1}` },
          })
        ));
      }
      // เพิ่มห้องใหม่ในกลุ่มเดียวกัน (ใช้ check_in/out + place + type ใหม่)
      let addedMsg = "";
      if (addCount > 0) {
        const sameType = state.rooms.filter(r =>
          (r.room_type || "") === name && r.place_id === state.rbSelectedHotelId);
        const startIdx = sameType.length + 1;
        const baseSort = state.rooms.length;
        const addPayload = [];
        for (let i = 0; i < addCount; i++) {
          addPayload.push({
            trip_id: state.tripId,
            place_id: state.rbSelectedHotelId,
            room_name: `${name}-${startIdx + i}`,
            room_type: name,
            capacity: cap,
            check_in_date: checkIn,
            check_out_date: checkOut,
            sort_order: baseSort + i,
          });
        }
        await sbFetch("trip_rooms", "", { method: "POST", body: addPayload });
        addedMsg = ` + เพิ่ม ${addCount} ห้อง`;
      }
      showToast(`บันทึกการแก้ไขแล้ว${addedMsg}`, "success");
      document.getElementById("roomBatchOverlay").classList.remove("open");
      state.editingGroupKey = null;
      await loadAll();
    } catch (e) {
      showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
    }
    showLoading(false);
    return;
  }

  // CREATE mode (รวม DUPLICATE mode = create + copy occupants จากต้นฉบับ)
  const isDup = !!state.duplicateFromGroupKey;
  const sourceRooms = isDup
    ? state.rooms.filter(r => groupKeyOf(r) === state.duplicateFromGroupKey)
    : [];

  // Duplicate: validate ว่าผู้ใช้เปลี่ยน hotel/type/dates อย่างน้อย 1 อย่าง
  if (isDup && sourceRooms.length) {
    const src = sourceRooms[0];
    const samePlace = state.rbSelectedHotelId === src.place_id;
    const sameType  = name === src.room_type;
    const sameDates = (checkIn || "") === (src.check_in_date || "")
                   && (checkOut || "") === (src.check_out_date || "");
    if (samePlace && sameType && sameDates) {
      showToast("ต้องเปลี่ยนโรงแรม/ประเภทห้อง/ช่วงวันอย่างน้อย 1 อย่าง", "error");
      return;
    }
  }

  // Duplicate: count ล็อก = ขนาดต้นฉบับ — ไม่อ่าน input
  const count = isDup
    ? sourceRooms.length
    : (parseInt(document.getElementById("rbCount").value, 10) || 1);
  if (count < 1) { showToast("จำนวนต้อง ≥ 1", "error"); return; }

  // หา start index จากห้องประเภทเดียวกัน (เพื่อต่อเลข Twin-3 ถ้ามี Twin-1, Twin-2 อยู่)
  const sameTypeRooms = state.rooms.filter(r => (r.room_type || "") === name && r.place_id === state.rbSelectedHotelId);
  const startIdx = sameTypeRooms.length + 1;
  const baseSort = state.rooms.length;

  const payload = [];
  for (let i = 0; i < count; i++) {
    payload.push({
      trip_id: state.tripId,
      place_id: state.rbSelectedHotelId,
      room_name: `${name}-${startIdx + i}`,
      room_type: name,
      capacity: cap,
      check_in_date: checkIn,
      check_out_date: checkOut,
      sort_order: baseSort + i,
    });
  }

  showLoading(true);
  try {
    const created = await sbFetch("trip_rooms", "", { method: "POST", body: payload });

    // Duplicate: copy occupants จาก sourceRooms[i] → newRooms[i] (match ตาม sort_order)
    let dupMsg = "";
    if (isDup && sourceRooms.length) {
      const newRooms = Array.isArray(created) ? created : [];
      const sortedNew = [...newRooms].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
      const occPayload = [];
      sourceRooms.forEach((src, i) => {
        const dst = sortedNew[i];
        if (!dst) return;
        const codes = state.occupants[src.room_id] || [];
        codes.forEach(code => occPayload.push({ room_id: dst.room_id, code }));
      });
      if (occPayload.length) {
        try {
          await sbFetch("trip_room_occupants", "", { method: "POST", body: occPayload });
          dupMsg = ` + คัดลอกคู่นอน ${occPayload.length} คน`;
        } catch (e) {
          console.warn("[room-assign] copy occupants failed:", e.message);
          showToast(`ห้องสร้างแล้ว แต่ copy คู่นอนไม่สำเร็จ: ${e.message}`, "error");
        }
      }
    }

    showToast(`${isDup ? "คัดลอกกลุ่ม" : "สร้าง"}ห้อง ${count} ห้องแล้ว${dupMsg}`, "success");
    document.getElementById("roomBatchOverlay").classList.remove("open");
    state.duplicateFromGroupKey = null;
    // ปลดล็อก rbCount
    const cnt = document.getElementById("rbCount");
    if (cnt) { cnt.readOnly = false; cnt.style.background = ""; cnt.style.opacity = ""; }
    await loadAll();
  } catch (e) {
    showToast(`${isDup ? "คัดลอก" : "สร้างห้อง"}ไม่สำเร็จ: ` + e.message, "error");
  }
  showLoading(false);
};

window.renameRoom = async function (roomId, newName) {
  const r = state.rooms.find(x => x.room_id === roomId);
  if (!r) return;
  const trimmed = (newName || "").trim();
  if (!trimmed || trimmed === r.room_name) {
    // restore previous if blank
    if (!trimmed) renderRooms();
    return;
  }
  try {
    await sbFetch("trip_rooms", `?room_id=eq.${roomId}`, {
      method: "PATCH",
      body: { room_name: trimmed, updated_at: new Date().toISOString() },
    });
    r.room_name = trimmed;
    showToast("เปลี่ยนชื่อห้องแล้ว", "success");
  } catch (e) {
    showToast("เปลี่ยนชื่อไม่ได้: " + e.message, "error");
    renderRooms();
  }
};

window.editRoomCapacity = async function (roomId, currentCap, occCount) {
  let newVal;
  if (window.PromptModal?.open) {
    newVal = await window.PromptModal.open({
      title: "แก้ไขความจุห้อง",
      message: `ความจุปัจจุบัน ${currentCap} คน${occCount > 0 ? ` · มีคนอยู่ ${occCount} คน` : ""} — เพิ่ม = extra bed, ลด = ลบเตียง`,
      icon: "🛏️",
      tone: "primary",
      inputType: "number",
      defaultValue: String(currentCap),
      placeholder: "ใส่จำนวนใหม่",
      okText: "บันทึก",
      required: true,
    });
  } else {
    newVal = prompt(`ความจุห้องใหม่ (ปัจจุบัน ${currentCap}):`, String(currentCap));
  }
  if (newVal == null) return; // cancelled

  const n = parseInt(newVal, 10);
  if (!Number.isFinite(n) || n < 1) {
    showToast("ความจุต้องเป็นตัวเลข ≥ 1", "error");
    return;
  }
  if (n < occCount) {
    showToast(`ห้องนี้มีคนอยู่ ${occCount} คน — ลดต่ำกว่านี้ไม่ได้`, "error");
    return;
  }
  if (n === currentCap) return;

  try {
    await sbFetch("trip_rooms", `?room_id=eq.${roomId}`, {
      method: "PATCH",
      body: { capacity: n, updated_at: new Date().toISOString() },
    });
    const r = state.rooms.find(x => x.room_id === roomId);
    if (r) r.capacity = n;
    renderStats();
    renderRooms();
    showToast(`ปรับความจุเป็น ${n}${n > currentCap ? " (+ extra bed)" : ""}`, "success");
  } catch (e) {
    showToast("แก้ไขไม่สำเร็จ: " + e.message, "error");
  }
};

window.viewPaxPassport = function (code) {
  const p = state.passengers.find(x => x.code === code);
  if (!p) return;
  const pass = p.passport_image_url || p._inheritedPassImg || null;
  const visa = p.visa_image_url     || p._inheritedVisaImg || null;
  const imgs = [pass, visa].filter(Boolean);
  if (!imgs.length) {
    showToast("ไม่มีรูป passport / visa", "info");
    return;
  }
  const titles = [];
  if (pass) titles.push(`Passport — ${p.name || p._inheritedName || code}`);
  if (visa) titles.push(`Visa — ${p.name || p._inheritedName || code}`);
  const skus = imgs.map(() => `${code}${p.passport_id ? ' · ' + p.passport_id : ''}`);
  // ImgPopup เป็น `const` (script-scope) — ไม่อยู่บน window — ใช้ typeof เช็ค
  if (typeof ImgPopup !== "undefined" && ImgPopup.open) {
    ImgPopup.open(imgs, 0, { titles, skus });
  } else {
    window.open(imgs[0], "_blank");
  }
};

window.toggleEmptyOnlyFilter = function (val) {
  state.filterEmptyOnly = (typeof val === "boolean") ? val : !state.filterEmptyOnly;
  renderRooms();
};

window.toggleGroupCollapse = function (typeName) {
  // Lock: ถ้ามี >1 โรงแรม + เลือก batch ไว้ → ย่อ-ขยายได้เฉพาะ batch นั้น
  const activeKey = document.getElementById("paxFilterBatch")?.value || "";
  const totalB = totalBatchCount();
  if (totalB > 1 && activeKey && typeName !== activeKey) {
    showToast("เปลี่ยนโรงแรมที่ dropdown ด้านซ้ายเพื่อขยายกลุ่มนี้", "info");
    return;
  }
  if (state.collapsedGroups.has(typeName)) state.collapsedGroups.delete(typeName);
  else state.collapsedGroups.add(typeName);
  renderRooms();
};

// ── Kebab menu (per group) ──
window.closeGroupKebabs = function () {
  document.querySelectorAll(".ra-grp-kebab-wrap.open").forEach(el => el.classList.remove("open"));
};
window.toggleGroupKebab = function (groupKey, ev) {
  ev.stopPropagation();
  const wrap = document.querySelector(`.ra-grp-kebab-wrap[data-group="${cssEscape(groupKey)}"]`);
  if (!wrap) return;
  const isOpen = wrap.classList.contains("open");
  window.closeGroupKebabs();
  if (!isOpen) wrap.classList.add("open");
};
document.addEventListener("click", (ev) => {
  if (!ev.target.closest(".ra-grp-kebab-wrap")) window.closeGroupKebabs();
});

function cssEscape(s) {
  return String(s).replace(/[\\"]/g, "\\$&");
}

// ── Add 1 room to existing group ──
// ใช้ค่า hotel + room_type + dates + capacity จากต้นฉบับของกลุ่มนั้น
window.addOneRoomToGroup = async function (groupKey) {
  const rooms = state.rooms.filter(r => groupKeyOf(r) === groupKey);
  if (!rooms.length) return;
  const sample = rooms[0];
  // หา index ต่อจากห้องประเภท+โรงแรมเดียวกัน (เช่น Twin-1..2 อยู่ → ห้องใหม่ = Twin-3)
  const sameType = state.rooms.filter(r =>
    (r.room_type || "") === sample.room_type && r.place_id === sample.place_id);
  const nextIdx = sameType.length + 1;
  showLoading(true);
  try {
    await sbFetch("trip_rooms", "", {
      method: "POST",
      body: [{
        trip_id: state.tripId,
        place_id: sample.place_id,
        room_name: `${sample.room_type}-${nextIdx}`,
        room_type: sample.room_type,
        capacity: sample.capacity,
        check_in_date: sample.check_in_date,
        check_out_date: sample.check_out_date,
        sort_order: state.rooms.length,
      }],
    });
    showToast(`เพิ่มห้อง ${sample.room_type}-${nextIdx} แล้ว`, "success");
    await loadAll();
  } catch (e) {
    showToast("เพิ่มห้องไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

// ── Duplicate group ──
// คัดลอก = เปิด modal "สร้างกลุ่มใหม่" โดย pre-fill ตามต้นฉบับ
// → user ต้องเปลี่ยนโรงแรม/ประเภท/วันก่อน save → ระบบ create กลุ่มใหม่ + copy ผู้พักจากต้นฉบับ
window.duplicateRoomGroup = async function (groupKey) {
  const rooms = state.rooms.filter(r => groupKeyOf(r) === groupKey);
  if (!rooms.length) return;
  const sample = rooms[0];

  state.editingGroupKey = null;
  state.duplicateFromGroupKey = groupKey;
  state.rbSelectedHotelId = sample.place_id || null;
  state.rbSelectedRoomTypeName = sample.room_type || "";
  state.rbSelectedRoomTypeMaxGuests = sample.capacity || 2;

  // Pre-fill hotel + room type
  const sel = document.getElementById("rbHotel");
  if (sel) {
    sel.value = String(sample.place_id || "");
    sel.classList.toggle("has-value", !!sample.place_id);
  }
  await onHotelChange();
  const list = state.hotelRoomTypes[sample.place_id] || [];
  const idx = list.findIndex(rt => (rt.room_type_name || "") === sample.room_type);
  if (idx >= 0) window.pickRoomType(idx);

  // Pre-fill dates
  document.getElementById("rbCheckIn").value  = sample.check_in_date  || "";
  document.getElementById("rbCheckOut").value = sample.check_out_date || "";
  window.refreshDurationChips();

  // Count = source size, lock (ผู้พักต้อง match จำนวนห้องเดิม)
  const cnt = document.getElementById("rbCount");
  cnt.value = rooms.length;
  cnt.readOnly = true;
  cnt.style.background = "#f1f5f9";
  cnt.style.opacity = ".75";

  // toggle UI to duplicate mode
  document.getElementById("rbModalTitle").textContent  = "คัดลอกกลุ่มห้อง — เปลี่ยนโรงแรม/วัน/ประเภท";
  document.getElementById("rbSaveBtn").innerHTML       = "💾 สร้างกลุ่มใหม่ (คัดลอกคู่นอนเดิม)";
  document.getElementById("rbCountWrap").style.display = "";
  document.getElementById("rbCountLabel").innerHTML    = `จำนวนห้อง <span style="color:var(--text3);font-weight:400">(เท่ากับต้นฉบับ — ล็อก)</span>`;
  document.getElementById("rbCountHint").style.display = "";
  document.getElementById("rbCountHint").innerHTML     = "💡 คู่นอนเดิมจะถูกคัดลอกเข้าห้องใหม่ที่ตรงตำแหน่งกัน — เปลี่ยนโรงแรม/ประเภทห้อง/ช่วงวันก่อนบันทึก";
  document.getElementById("roomBatchOverlay").classList.add("open");
};

// ── Edit group (open modal in edit mode) ──
window.editRoomGroup = async function (groupKey) {
  const rooms = state.rooms.filter(r => groupKeyOf(r) === groupKey);
  if (!rooms.length) return;
  const sample = rooms[0];

  state.editingGroupKey = groupKey;
  state.rbSelectedHotelId = sample.place_id || null;
  state.rbSelectedRoomTypeName = sample.room_type || "";
  state.rbSelectedRoomTypeMaxGuests = sample.capacity || 2;

  // Open modal manually (avoid resetting in openRoomBatchModal)
  const sel = document.getElementById("rbHotel");
  if (sel) {
    sel.value = String(sample.place_id || "");
    sel.classList.toggle("has-value", !!sample.place_id);
  }
  // Trigger hotel change to load room types + auto-pick the matching card
  await onHotelChange();
  // After room types loaded, click the matching room type card
  const list = state.hotelRoomTypes[sample.place_id] || [];
  const idx = list.findIndex(rt => (rt.room_type_name || "") === sample.room_type);
  if (idx >= 0) window.pickRoomType(idx);

  document.getElementById("rbCheckIn").value  = sample.check_in_date  || "";
  document.getElementById("rbCheckOut").value = sample.check_out_date || "";
  window.refreshDurationChips();
  // edit mode: input ตีความเป็น "เพิ่มอีกกี่ห้อง" (default 0)
  document.getElementById("rbCount").value = 0;

  // toggle UI to edit mode
  document.getElementById("rbModalTitle").textContent  = "แก้ไขกลุ่มห้องพัก";
  document.getElementById("rbSaveBtn").innerHTML = "💾 บันทึกการแก้ไข";
  document.getElementById("rbCountLabel").innerHTML = `เพิ่มห้องอีก <span style="color:var(--text3);font-weight:400">(ปัจจุบัน ${rooms.length} ห้อง)</span>`;
  document.getElementById("rbCountWrap").style.display = "";
  document.getElementById("rbCountHint").style.display = "";
  document.getElementById("roomBatchOverlay").classList.add("open");
};

window.deleteRoomGroup = function (typeName, roomIds, occCount) {
  if (!Array.isArray(roomIds) || roomIds.length === 0) return;
  const msg = occCount > 0
    ? `ลบห้องแบบ "${typeName}" ทั้งหมด ${roomIds.length} ห้อง?<br><span style="color:#b91c1c">มีผู้พัก ${occCount} คน-คืน ในกลุ่มนี้ — ผู้พักจะถูกย้ายออกจากกลุ่มนี้ (ห้องในช่วงอื่นไม่กระทบ)</span>`
    : `ลบห้องแบบ "${typeName}" ทั้งหมด ${roomIds.length} ห้อง?`;

  const opener = window.DeleteModal?.open || window.ConfirmModal?.open;
  const doDelete = async () => {
    showLoading(true);
    try {
      // FK ON DELETE CASCADE → trip_room_occupants ถูกลบตามอัตโนมัติ
      await sbFetch("trip_rooms", `?room_id=in.(${roomIds.join(",")})`, { method: "DELETE" });
      showToast(`ลบห้องแบบ "${typeName}" ${roomIds.length} ห้องแล้ว`, "success");
      await loadAll();
    } catch (e) {
      showToast("ลบไม่สำเร็จ: " + e.message, "error");
    }
    showLoading(false);
  };
  if (opener) opener(msg, doDelete);
  else if (confirm(msg.replace(/<[^>]+>/g, ""))) doDelete();
};

window.editRoomNote = async function (roomId) {
  const r = state.rooms.find(x => x.room_id === roomId);
  if (!r) return;
  let val;
  if (window.PromptModal?.open) {
    val = await window.PromptModal.open({
      title: `หมายเหตุห้อง ${r.room_name}`,
      message: "เช่น: ห้องชั้น 5, connecting, มีระเบียง — เว้นว่าง = ลบหมายเหตุ",
      icon: "📝",
      tone: "primary",
      inputType: "text",
      defaultValue: r.note || "",
      placeholder: "พิมพ์หมายเหตุ...",
      okText: "บันทึก",
    });
  } else {
    val = prompt(`หมายเหตุห้อง ${r.room_name}:`, r.note || "");
  }
  if (val == null) return; // cancelled
  const newNote = val.trim() || null;
  if (newNote === (r.note || null)) return;

  try {
    await sbFetch("trip_rooms", `?room_id=eq.${roomId}`, {
      method: "PATCH",
      body: { note: newNote, updated_at: new Date().toISOString() },
    });
    r.note = newNote;
    renderRooms();
    showToast(newNote ? "บันทึกหมายเหตุแล้ว" : "ลบหมายเหตุแล้ว", "success");
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  }
};

window.deleteRoom = function (roomId) {
  const r = state.rooms.find(x => x.room_id === roomId);
  if (!r) return;
  const occCount = (state.occupants[roomId] || []).length;
  const msg = occCount > 0
    ? `ห้อง "${r.room_name}" มีผู้พักอยู่ ${occCount} คน — ลบแล้วผู้พักจะถูกย้ายออกจากห้องนี้ (ห้องในช่วงอื่นไม่กระทบ) ดำเนินการต่อ?`
    : `ลบห้อง "${r.room_name}" หรือไม่?`;

  const opener = window.DeleteModal?.open || window.ConfirmModal?.open;
  const doDelete = async () => {
    showLoading(true);
    try {
      await sbFetch("trip_rooms", `?room_id=eq.${roomId}`, { method: "DELETE" });
      showToast("ลบห้องแล้ว", "success");
      await loadAll();
    } catch (e) {
      showToast("ลบไม่สำเร็จ: " + e.message, "error");
    }
    showLoading(false);
  };
  if (opener) opener(msg, doDelete);
  else if (confirm(msg)) doDelete();
};

// ── UTILS ──────────────────────────────────────────────────
// "YYYY-MM-DD" → "DD/MM/YYYY"
function fmtDate(iso) {
  if (window.DateFmt && window.DateFmt.formatDMY) return window.DateFmt.formatDMY(iso);
  if (!iso) return "";
  const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

// format number → "1,500"
function fmtMoney(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return "—";
  return num.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

// แปลง gender ที่อาจเก็บเป็น "M" / "F" / "male" / "female" / "MALE" → "M" | "F" | ""
function normGender(g) {
  const c = String(g || "").trim().charAt(0).toUpperCase();
  return c === "M" || c === "F" ? c : "";
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[<>&"']/g, c => ({
    "<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&#39;",
  })[c]);
}
function escapeAttr(s) { return escapeHtml(s); }
function escapeJs(s) {
  return String(s ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
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

// ── START ──────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
