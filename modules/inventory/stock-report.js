/* ============================================================
   stock-report.js — 📦 Stock Report (เลือกคอลัมน์เอง → preview → export)
   ------------------------------------------------------------
   blueprint: docs/templates/REPORT-MODULE-TEMPLATE.md
   • 1 SKU (leaf/singleton) = 1 แถว · ยอด On-hand / Reserved / Available
     คำนวณแบบเดียวกับ stock-balance.js (signed sum ของ stock_movements)
   • catalog คอลัมน์อยู่ที่ js/shared/stock-fields.js (single source of truth)
   • pipeline กลาง: filter → search → sort → group → (merge rowspan)
   • export: 📥 Excel (SheetJS) · 👁 Preview A4 · 🖨 Print/PDF
   • preset ชุดคอลัมน์เก็บใน localStorage (ไม่ต้องสร้างตาราง DB)
   ============================================================ */

// ── COLUMN GROUPS (จาก catalog กลาง) ───────────────────────
const COLUMN_GROUPS = window.StockFields.GROUPS.map((g) => ({
  id: g.id,
  label: g.label,
  cols: window.StockFields.crCols(g.id),
}));
const COL_BY_KEY = {};
COLUMN_GROUPS.forEach((g) => g.cols.forEach((c) => { COL_BY_KEY[c.key] = c; }));

const NUMERIC_FMTS = new Set(["number", "money"]);
const PRESET_LS_KEY = "stockReportPresets";
const FILTER_MAX_DISTINCT = 50;
const EXPIRING_SOON_DAYS = 30;
const PREVIEW_MAX_PAGES = 5;

// sentinel ค่าว่าง / มีรูป (mirror custom-report)
const BLANK_VAL = "__BLANK__";
const HAS_IMG_VAL = "__HAS_IMG__";

// ลำดับ sort ของคอลัมน์ "สถานะ" — ปัญหาเด่นก่อน
const STATUS_RANK = { "ติดลบ": 0, "หมด": 1, "ใกล้สั่ง": 2, "ปกติ": 3 };

const state = {
  // raw data
  products: [], categories: [], warehouses: [], movements: [],
  reservedSO: [], reservedREQ: [], productImages: [],
  // computed report rows (1 SKU/แถว)
  rows: [],
  // user selection (mirror template state shape)
  selected: [], collapsed: {}, sort: [], search: "",
  filters: {}, merged: {}, hidden: {},
  warehouseId: "",            // ขอบเขตยอด (scope)
  rowsPerPage: "auto", orientation: "landscape",
  groupBy: "", showTotal: false,
  templates: [],              // preset (localStorage)
};

// ── SUPABASE (GET only) ────────────────────────────────────
function getSB() {
  return {
    url: localStorage.getItem("sb_url") || "",
    key: localStorage.getItem("sb_key") || "",
  };
}
async function sbFetch(table, query = "") {
  const { url, key } = getSB();
  const res = await fetch(`${url}/rest/v1/${table}${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || "API Error");
  }
  return res.json();
}

// ── UTIL ───────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function fmtNum(n, decimals = 0) {
  return parseFloat(n || 0).toLocaleString("th-TH", {
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  });
}
function fmtDate(v) {
  if (!v) return "";
  const f = window.DateFmt && window.DateFmt.formatDMY;
  return f ? (f(v) || "") : String(v);
}
function colLabel(c) { return c.label; }
function showLoading(on) { document.getElementById("loadingOverlay")?.classList.toggle("show", !!on); }
function showToast(msg, type = "info") {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.className = "toast toast-" + type + " show";
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove("show"), 3000);
}

// ── INIT / LOAD ────────────────────────────────────────────
async function init() {
  const { url, key } = getSB();
  if (!url || !key) { showLoading(false); showToast("ยังไม่ได้เชื่อมต่อ Supabase", "error"); return; }
  loadPresets();
  await loadAll();
}
window.refreshReport = () => loadAll();

async function loadAll() {
  showLoading(true);
  try {
    const [prods, cats, whs, mvs, soRes, reqRes, imgs] = await Promise.all([
      sbFetch("products", "?select=product_id,product_code,product_name,category_id,reorder_point,parent_product_id,disable_stock_alert,cost_price&is_active=eq.true"),
      sbFetch("categories", "?select=category_id,category_name,icon"),
      sbFetch("warehouses", "?select=warehouse_id,warehouse_name,country&is_active=eq.true"),
      sbFetch("stock_movements", "?select=movement_id,product_id,warehouse_id,movement_type,qty,lot_no,expiry_date").catch((e) => {
        // fallback ถ้ายังไม่ migrate lot_no/expiry_date
        if (/column .* does not exist/i.test(e.message))
          return sbFetch("stock_movements", "?select=movement_id,product_id,warehouse_id,movement_type,qty");
        throw e;
      }),
      loadReservedSO(),
      loadReservedREQ(),
      sbFetch("product_images", "?select=product_id,url&order=sort_order.asc").catch(() => []),
    ]);
    state.products = prods || [];
    state.categories = cats || [];
    state.warehouses = whs || [];
    state.movements = mvs || [];
    state.reservedSO = soRes || [];
    state.reservedREQ = reqRes || [];
    state.productImages = imgs || [];

    populateWarehouses();
    buildRows();
    renderPicker();
    renderTemplates();
    renderAll();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

async function loadReservedSO() {
  try {
    const headers = await sbFetch("sales_orders", "?select=so_id,warehouse_id,status&status=eq.CONFIRMED");
    if (!headers.length) return [];
    const ids = headers.map((h) => h.so_id).join(",");
    const items = await sbFetch("so_items", `?select=so_id,product_id,qty_ordered,qty_delivered&so_id=in.(${ids})`);
    const whBySo = {};
    headers.forEach((h) => (whBySo[h.so_id] = h.warehouse_id));
    return items
      .map((it) => ({ product_id: it.product_id, warehouse_id: whBySo[it.so_id], qty: Math.max(0, (+it.qty_ordered || 0) - (+it.qty_delivered || 0)) }))
      .filter((r) => r.qty > 0);
  } catch (e) { console.warn("[stock-report] reserved SO failed:", e.message); return []; }
}
async function loadReservedREQ() {
  try {
    const headers = await sbFetch("requisitions", "?select=req_id,warehouse_id,status&status=eq.APPROVED");
    if (!headers.length) return [];
    const ids = headers.map((h) => h.req_id).join(",");
    const items = await sbFetch("requisition_items", `?select=req_id,product_id,qty_approved,qty_issued&req_id=in.(${ids})`);
    const whByReq = {};
    headers.forEach((h) => (whByReq[h.req_id] = h.warehouse_id));
    return items
      .map((it) => ({ product_id: it.product_id, warehouse_id: whByReq[it.req_id], qty: Math.max(0, (+it.qty_approved || 0) - (+it.qty_issued || 0)) }))
      .filter((r) => r.qty > 0);
  } catch (e) { console.warn("[stock-report] reserved REQ failed:", e.message); return []; }
}

// ── COMPUTE ROWS ───────────────────────────────────────────
// signed qty per movement type (sync กับ stock-balance/dashboard)
function signedQty(m) {
  const q = +m.qty || 0;
  return (m.movement_type === "OUT" || m.movement_type === "INTERNAL") ? -q : q;
}

function buildIndexes() {
  const productsById = {}, categoriesById = {}, warehousesById = {};
  state.products.forEach((p) => (productsById[p.product_id] = p));
  state.categories.forEach((c) => (categoriesById[c.category_id] = c));
  state.warehouses.forEach((w) => (warehousesById[w.warehouse_id] = w));

  const parentIdsWithKids = new Set(state.products.filter((p) => p.parent_product_id).map((c) => c.parent_product_id));
  const isSku = (p) => p.parent_product_id || !parentIdsWithKids.has(p.product_id);

  // On-hand: pid → { whId: qty }
  const onHandByPidWh = {};
  state.movements.forEach((m) => {
    if (m.product_id == null || m.warehouse_id == null) return;
    const bucket = (onHandByPidWh[m.product_id] ||= {});
    bucket[m.warehouse_id] = (bucket[m.warehouse_id] || 0) + signedQty(m);
  });

  // Reserved: pid → { whId: qty } (SO + REQ)
  const reservedByPidWh = {};
  [...state.reservedSO, ...state.reservedREQ].forEach((r) => {
    if (r.product_id == null) return;
    const bucket = (reservedByPidWh[r.product_id] ||= {});
    const wh = r.warehouse_id ?? "_unknown";
    bucket[wh] = (bucket[wh] || 0) + (+r.qty || 0);
  });

  // Lots (เฉพาะ movement ที่มี lot_no) → ใกล้หมดอายุ
  const lotsByPid = {};
  state.movements.forEach((m) => {
    if (m.product_id == null || !m.lot_no) return;
    const bucket = (lotsByPid[m.product_id] ||= {});
    const k = `${m.warehouse_id || 0}::${m.lot_no}`;
    if (!bucket[k]) bucket[k] = { warehouse_id: m.warehouse_id, in: 0, out: 0, expiry_date: m.expiry_date || null };
    const sign = signedQty(m);
    if (sign >= 0) bucket[k].in += sign; else bucket[k].out += -sign;
    if (m.expiry_date && !bucket[k].expiry_date) bucket[k].expiry_date = m.expiry_date;
  });

  // รูปต่อ product (fallback ไป parent)
  const imagesByPid = {};
  state.productImages.forEach((im) => {
    if (im.product_id == null || !im.url) return;
    (imagesByPid[im.product_id] ||= []).push(im.url);
  });
  const resolveImage = (pid) => {
    if (imagesByPid[pid]?.length) return imagesByPid[pid][0];
    const p = productsById[pid];
    if (p?.parent_product_id && imagesByPid[p.parent_product_id]?.length) return imagesByPid[p.parent_product_id][0];
    return "";
  };

  return { productsById, categoriesById, warehousesById, isSku, onHandByPidWh, reservedByPidWh, lotsByPid, resolveImage };
}

// ยอดตาม scope (state.warehouseId) — ว่าง = รวมทุกคลัง
function sumScoped(bucket) {
  if (!bucket) return 0;
  if (state.warehouseId) return bucket[state.warehouseId] || 0;
  return Object.values(bucket).reduce((s, v) => s + v, 0);
}
function expiringScoped(lotBucket) {
  if (!lotBucket) return 0;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() + EXPIRING_SOON_DAYS);
  let qty = 0;
  Object.values(lotBucket).forEach((lot) => {
    if (!lot.expiry_date) return;
    if (state.warehouseId && String(lot.warehouse_id) !== String(state.warehouseId)) return;
    const exp = new Date(lot.expiry_date + "T00:00:00");
    if (exp <= cutoff) qty += Math.max(0, lot.in - lot.out);
  });
  return qty;
}

function statusOf(available, reorder, disableAlert) {
  if (available < 0) return "ติดลบ";
  if (available <= 0) return "หมด";
  if (available <= reorder && !disableAlert) return "ใกล้สั่ง";
  return "ปกติ";
}

// build flat report rows (1 SKU/แถว) — เคารพ scope คลังปัจจุบัน
function buildRows() {
  const idx = buildIndexes();
  const skus = state.products.filter(idx.isSku);
  state.rows = skus.map((p) => {
    const onHand = sumScoped(idx.onHandByPidWh[p.product_id]);
    const reserved = sumScoped(idx.reservedByPidWh[p.product_id]);
    const available = onHand - reserved;
    const reorder = p.reorder_point || 0;
    const disableAlert = !!p.disable_stock_alert;
    const cost = +p.cost_price || 0;
    const cat = idx.categoriesById[p.category_id];
    const parent = p.parent_product_id ? idx.productsById[p.parent_product_id] : null;
    // คลังที่มีของ (ตาม scope) — เฉพาะคลังที่ยอด != 0
    const whBucket = idx.onHandByPidWh[p.product_id] || {};
    const whNames = Object.entries(whBucket)
      .filter(([wid, q]) => q !== 0 && (!state.warehouseId || String(wid) === String(state.warehouseId)))
      .map(([wid]) => idx.warehousesById[wid]?.warehouse_name)
      .filter(Boolean);
    return {
      product_id: p.product_id,
      product_code: p.product_code || "",
      product_name: p.product_name || "",
      parent_name: parent?.product_name || "",
      category: cat ? `${cat.icon || "📦"} ${cat.category_name}` : "",
      warehouse_names: [...new Set(whNames)].join(", "),
      image: idx.resolveImage(p.product_id),
      onHand, reserved, available, reorder,
      status: statusOf(available, reorder, disableAlert),
      expQty: expiringScoped(idx.lotsByPid[p.product_id]),
      cost_price: cost,
      stock_value: onHand * cost,
    };
  });
}

// ── CELL VALUE (จุดเดียวที่แปลง row+col → string) ──────────
function cellValue(row, col) {
  const v = row[col.key];
  if (col.fmt === "image") {
    const s = String(v || "").trim();
    return s.startsWith("http") ? s : "";
  }
  if (v == null || v === "") return col.fmt === "number" || col.fmt === "money" ? "0" : "";
  if (col.fmt === "number") return fmtNum(v, 0);
  if (col.fmt === "money") return fmtNum(v, 2);
  if (col.fmt === "date") return fmtDate(v);
  return String(v);
}
function cellHtml(row, col) {
  const v = cellValue(row, col);
  if (!v) return "";
  if (col.fmt === "image") {
    return `<img src="${escapeHtml(v)}" alt="" class="cr-img-thumb" loading="lazy"
      title="คลิกเพื่อดูภาพขยาย" onclick="window.crOpenImg(this)">`;
  }
  return escapeHtml(v);
}
function isNumCol(col) { return NUMERIC_FMTS.has(col.fmt); }
function sortValue(row, col) {
  if (col.key === "status") return STATUS_RANK[row.status] ?? 99;
  if (isNumCol(col)) return Number(row[col.key]) || 0;
  return cellValue(row, col).toLowerCase();
}

// ── DISTINCT / FILTERABILITY ───────────────────────────────
function distinctValuesFor(key) {
  const col = COL_BY_KEY[key];
  if (!col) return [];
  if (col.fmt === "image") {
    let hasImg = false, hasBlank = false;
    state.rows.forEach((row) => { if (cellValue(row, col)) hasImg = true; else hasBlank = true; });
    const arr = [];
    if (hasImg) arr.push(HAS_IMG_VAL);
    if (hasBlank) arr.push(BLANK_VAL);
    return arr;
  }
  const set = new Set();
  let hasBlank = false;
  state.rows.forEach((row) => {
    const v = cellValue(row, col);
    if (v === "" || v == null) hasBlank = true; else set.add(v);
  });
  const arr = [...set].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" }));
  if (hasBlank) arr.push(BLANK_VAL);
  return arr;
}
function isFilterable(key) {
  const n = distinctValuesFor(key).length;
  return n >= 2 && n <= FILTER_MAX_DISTINCT;
}
function hasFilterButton(key) {
  const n = distinctValuesFor(key).length;
  if (n < 2) return false;
  if (n <= FILTER_MAX_DISTINCT) return true;
  return n < state.rows.length;
}
function isMergeable(key) {
  const n = distinctValuesFor(key).length;
  if (n < 2) return false;
  return n < state.rows.length;
}
function blankLabel() { return "(ว่าง)"; }

// ── PIPELINE: filter → search → sort ───────────────────────
function filterRows(rows) {
  const active = Object.entries(state.filters).filter(([_, s]) => s && s.size);
  if (!active.length) return rows;
  return rows.filter((row) =>
    active.every(([key, set]) => {
      const col = COL_BY_KEY[key];
      if (!col) return true;
      const v = cellValue(row, col);
      if (col.fmt === "image") return set.has(v ? HAS_IMG_VAL : BLANK_VAL);
      if (v === "" || v == null) return set.has(BLANK_VAL);
      return set.has(v);
    }));
}
function searchRows(rows) {
  const q = (state.search || "").trim().toLowerCase();
  if (!q) return rows;
  const tokens = q.split(/\s+/);
  const cols = state.selected.map((k) => COL_BY_KEY[k]).filter(Boolean);
  if (!cols.length) return rows;
  return rows.filter((row) => {
    const hay = cols.map((c) => cellValue(row, c)).join(" ").toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
}
function getRows() {
  const filtered = searchRows(filterRows(state.rows));
  const chain = state.sort.map((s) => ({ col: COL_BY_KEY[s.key], dir: s.dir })).filter((x) => x.col);
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

// ── GROUPING ───────────────────────────────────────────────
function groupKeyOf(row) {
  if (!state.groupBy) return null;
  const col = COL_BY_KEY[state.groupBy];
  if (!col) return null;
  const v = cellValue(row, col);
  return "v:" + (v || BLANK_VAL);
}
function groupHeaderHtml(key) {
  const col = COL_BY_KEY[state.groupBy];
  const raw = key.slice(2);
  const val = raw === BLANK_VAL ? blankLabel() : raw;
  return `${escapeHtml(col ? colLabel(col) : "")}: ${escapeHtml(val)}`;
}
function getGroups(rows) {
  if (!state.groupBy) return [{ key: null, headerHtml: "", rows }];
  const order = [], byKey = new Map();
  rows.forEach((r) => {
    const k = groupKeyOf(r);
    if (!byKey.has(k)) { byKey.set(k, []); order.push(k); }
    byKey.get(k).push(r);
  });
  return order.map((k) => ({ key: k, headerHtml: groupHeaderHtml(k), rows: byKey.get(k) }));
}

// ── MERGE (rowspan) ────────────────────────────────────────
function computeRowspans(rows, cols) {
  const rs = cols.map(() => new Array(rows.length).fill(1));
  cols.forEach((c, ci) => {
    if (!state.merged[c.key]) return;
    let r = 0;
    while (r < rows.length) {
      let end = r + 1;
      while (end < rows.length) {
        if (cellValue(rows[end], c) !== cellValue(rows[r], c)) break;
        let groupBreak = false;
        for (let pj = 0; pj < ci; pj++) {
          const pc = cols[pj];
          if (state.merged[pc.key] && cellValue(rows[end], pc) !== cellValue(rows[r], pc)) { groupBreak = true; break; }
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

// ── อนุพันธ์: รวมยอดของคอลัมน์ตัวเลข (Total rows) ──────────
function numericTotals(cols, rows) {
  const totals = {};
  cols.forEach((c) => { if (isNumCol(c)) totals[c.key] = rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0); });
  return totals;
}
function totalRowHtml(cols, rows, label, cls) {
  const totals = numericTotals(cols, rows);
  // เซลแรก (#) = label, คอลัมน์ตัวเลขแสดงผลรวม, อื่นๆ ว่าง
  let html = `<tr class="${cls}"><td>${escapeHtml(label)}</td>`;
  cols.forEach((c) => {
    if (isNumCol(c)) html += `<td class="cr-num">${escapeHtml(fmtNum(totals[c.key], c.fmt === "money" ? 2 : 0))}</td>`;
    else html += `<td></td>`;
  });
  return html + `</tr>`;
}

// สร้าง <tr> array (group-aware) — ใช้ทั้ง print + preview
function buildGroupedTrs(cols, rows) {
  const groups = getGroups(rows);
  const span0 = cols.length + 1;
  const trs = [];
  groups.forEach((g) => {
    if (g.key !== null) trs.push(`<tr class="cr-grouphdr"><td colspan="${span0}">${g.headerHtml}</td></tr>`);
    const grsp = computeRowspans(g.rows, cols);
    g.rows.forEach((row, i) => {
      trs.push(`<tr><td>${i + 1}</td>` +
        cols.map((c, ci) => {
          const span = grsp[ci][i];
          if (span === 0) return "";
          const clsList = (c.fmt === "image" ? "cr-cell-img " : "") + (isNumCol(c) ? "cr-num" : "");
          const attrs = (span > 1 ? ` rowspan="${span}"` : "") + (clsList.trim() ? ` class="${clsList.trim()}"` : "");
          return `<td${attrs}>${cellHtml(row, c)}</td>`;
        }).join("") + `</tr>`);
    });
    if (state.showTotal) trs.push(totalRowHtml(cols, g.rows, `รวม ${g.rows.length} รายการ`, "cr-totalrow"));
  });
  if (state.showTotal && state.groupBy && groups.length > 1) {
    trs.push(totalRowHtml(cols, rows, `รวมทั้งหมด ${rows.length} รายการ`, "cr-grandtotal"));
  }
  return trs;
}

// ── RENDER: picker / chips / preview ───────────────────────
function renderPicker() {
  const wrap = document.getElementById("crPicker");
  if (!wrap) return;
  wrap.innerHTML = COLUMN_GROUPS.map((g) => {
    const opts = g.cols.map((c) => `
      <label class="cr-opt">
        <input type="checkbox" value="${c.key}" ${state.selected.includes(c.key) ? "checked" : ""}
          onchange="window.toggleColumn('${c.key}', this.checked)">
        <span>${escapeHtml(colLabel(c))}</span>
      </label>`).join("");
    return `<div class="cr-group${state.collapsed[g.id] ? " collapsed" : ""}">
      <div class="cr-group-hdr" onclick="window.crToggleGroup('${escapeHtml(g.id)}')">
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
    const hidden = !!state.hidden[k];
    return `<span class="cr-chip${hidden ? " cr-chip-hidden" : ""}">
      <button class="cr-chip-move" title="ย้ายซ้าย" onclick="window.moveColumn('${k}',-1)" ${i === 0 ? "disabled style='opacity:.25'" : ""}>◀</button>
      ${escapeHtml(colLabel(c))}
      <button class="cr-chip-move" title="ย้ายขวา" onclick="window.moveColumn('${k}',1)" ${i === state.selected.length - 1 ? "disabled style='opacity:.25'" : ""}>▶</button>
      <button class="cr-chip-eye" onclick="window.toggleHideColumn('${k}')" title="${hidden ? "คอลัมน์นี้ถูกซ่อนจาก export" : "ซ่อนคอลัมน์นี้จาก export"}">${hidden ? "🙈" : "👁"}</button>
      <button title="เอาออก" onclick="window.toggleColumn('${k}', false)">✕</button>
    </span>`;
  }).join("");
}

function renderGroupBy() {
  const sel = document.getElementById("crGroupBy");
  if (!sel) return;
  const cur = state.groupBy;
  const opts = [`<option value="">— ไม่แบ่งกลุ่ม —</option>`];
  state.selected.forEach((k) => {
    const c = COL_BY_KEY[k];
    if (c && c.fmt !== "image" && !isNumCol(c)) opts.push(`<option value="${escapeHtml(k)}">${escapeHtml(colLabel(c))}</option>`);
  });
  sel.innerHTML = opts.join("");
  if (cur && !state.selected.includes(cur)) state.groupBy = "";
  sel.value = state.groupBy;
}

function renderPreview() {
  const table = document.getElementById("crTable");
  const empty = document.getElementById("crEmpty");
  const count = document.getElementById("crRowCount");
  const cols = state.selected.map((k) => COL_BY_KEY[k]).filter(Boolean);
  const ps = document.getElementById("crPrintSettings");
  if (ps) ps.style.display = cols.length ? "inline-flex" : "none";
  if (!cols.length) {
    table.style.display = "none"; empty.style.display = "block"; count.textContent = ""; return;
  }
  empty.style.display = "none"; table.style.display = "";
  const rows = getRows();
  const hasFilter = Object.values(state.filters).some((s) => s && s.size);
  const hasSearch = !!(state.search || "").trim();
  const filterNote = (hasFilter || hasSearch) ? ` · แสดง ${rows.length}` : "";
  const hiddenCount = cols.filter((c) => state.hidden[c.key]).length;
  const hiddenNote = hiddenCount ? ` · ซ่อน ${hiddenCount} คอลัมน์` : "";
  count.textContent = `· ${state.rows.length} SKU${filterNote} · ${cols.length} คอลัมน์${hiddenNote}`;

  const multi = state.sort.length > 1;
  document.getElementById("crThead").innerHTML =
    `<th style="width:40px">#</th>` + cols.map((c) => {
      const idx = state.sort.findIndex((s) => s.key === c.key);
      const active = idx >= 0;
      const arrow = active ? (state.sort[idx].dir === 1 ? "▲" : "▼") : "";
      const badge = active && multi
        ? ` <span style="display:inline-block;min-width:14px;padding:0 4px;background:var(--accent);color:#fff;border-radius:7px;font-size:9.5px;font-weight:700;line-height:13px;vertical-align:1px">${idx + 1}</span>`
        : "";
      const ind = active ? ` ${arrow}${badge}` : ` <span style="opacity:.3">↕</span>`;
      const showBtn = hasFilterButton(c.key);
      const fActive = state.filters[c.key] && state.filters[c.key].size > 0;
      const mActive = !!state.merged[c.key];
      const anyActive = fActive || mActive;
      const tipParts = [];
      if (fActive) tipParts.push(`กรอง ${state.filters[c.key].size} ค่า`);
      if (mActive) tipParts.push("ผสานเซลเปิดอยู่");
      const fBtn = showBtn
        ? `<button class="cr-th-fbtn${anyActive ? " active" : ""}" title="${escapeHtml(tipParts.length ? tipParts.join(" · ") : "กรอง / ผสานเซล")}"
            onclick="event.stopPropagation();window.openFilter('${c.key}',this)">🔽${mActive ? '<span class="cr-th-mbadge">≣</span>' : ""}</button>`
        : "";
      const hidden = !!state.hidden[c.key];
      const eyeBtn = `<button class="cr-th-eye${hidden ? " off" : ""}" title="${hidden ? "ซ่อนอยู่ — คลิกเพื่อแสดง" : "คลิกเพื่อซ่อนจาก export"}"
        onclick="event.stopPropagation();window.toggleHideColumn('${c.key}')">${hidden ? "🙈" : "👁"}</button>`;
      const numCls = isNumCol(c) ? " cr-num" : "";
      return `<th class="${hidden ? "cr-col-hidden" : ""}${numCls}" style="user-select:none">
        <div class="cr-th-flex">
          <span class="cr-th-lbl" title="คลิกเพื่อเรียง (เพิ่ม/สลับ/ออก)" onclick="window.sortBy('${c.key}')">${escapeHtml(colLabel(c))}${hidden ? ` <span class="cr-th-hidetag">ซ่อน</span>` : ""}${ind}</span>
          ${eyeBtn}${fBtn}
        </div>
      </th>`;
    }).join("");

  const groups = getGroups(rows);
  const span0 = cols.length + 1;
  let html = "";
  groups.forEach((g) => {
    if (g.key !== null) html += `<tr class="cr-grouphdr"><td colspan="${span0}">${g.headerHtml}</td></tr>`;
    const grsp = computeRowspans(g.rows, cols);
    g.rows.forEach((row, i) => {
      html += `<tr><td style="color:var(--text3)">${i + 1}</td>` +
        cols.map((c, ci) => {
          const span = grsp[ci][i];
          if (span === 0) return "";
          const clsList = (span > 1 ? "cr-merged " : "") + (c.fmt === "image" ? "cr-cell-img " : "") + (isNumCol(c) ? "cr-num " : "") + (state.hidden[c.key] ? "cr-col-hidden" : "");
          const attrs = (span > 1 ? ` rowspan="${span}"` : "") + (clsList.trim() ? ` class="${clsList.trim()}"` : "");
          return `<td${attrs}>${cellHtml(row, c)}</td>`;
        }).join("") + `</tr>`;
    });
    if (state.showTotal) html += totalRowHtml(cols, g.rows, `รวม ${g.rows.length} รายการ`, "cr-totalrow");
  });
  if (state.showTotal && state.groupBy && groups.length > 1) {
    html += totalRowHtml(cols, rows, `รวมทั้งหมด ${rows.length} รายการ`, "cr-grandtotal");
  }
  document.getElementById("crTbody").innerHTML = html;
}

function renderAll() { renderChips(); renderGroupBy(); renderPreview(); }

// ── HEADER FILTER POPOVER (mirror custom-report) ───────────
let _popState = null;
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
  const shown = q ? values.filter((v) => (v === BLANK_VAL ? blankLabel() : String(v)).toLowerCase().includes(q)) : values;
  const listEl = _popState.el.querySelector(".cr-fpop-list");
  if (!shown.length) { listEl.innerHTML = `<div class="cr-fpop-empty">ไม่พบค่า</div>`; return; }
  const isImgCol = COL_BY_KEY[key]?.fmt === "image";
  listEl.innerHTML = shown.map((v) => {
    const id = "_crf_" + Math.random().toString(36).slice(2, 9);
    const checked = draft.has(v) ? "checked" : "";
    let display;
    if (v === HAS_IMG_VAL) display = `<span>🖼️ มีรูป</span>`;
    else if (v === BLANK_VAL) display = `<span style="font-style:italic;color:var(--text3)">${escapeHtml(isImgCol ? "ไม่มีรูป" : blankLabel())}</span>`;
    else display = `<span>${escapeHtml(v)}</span>`;
    return `<label><input type="checkbox" id="${id}" ${checked} data-val="${escapeHtml(v)}" onchange="window._crFilterToggle(this)">${display}</label>`;
  }).join("");
}
window._crFilterToggle = function (cb) {
  if (!_popState) return;
  const v = cb.getAttribute("data-val");
  if (cb.checked) _popState.draft.add(v); else _popState.draft.delete(v);
};
window.openFilter = function (key, anchorEl) {
  if (_popState && _popState.key === key) { closeFilterPopover(); return; }
  closeFilterPopover();
  const current = state.filters[key] instanceof Set ? state.filters[key] : new Set();
  const draft = new Set(current);
  const canFilter = isFilterable(key);
  const canMerge = isMergeable(key);
  const mergeChecked = state.merged[key] ? "checked" : "";
  const el = document.createElement("div");
  el.className = "cr-fpop";
  const mergeBlock = canMerge ? `
    <label class="cr-fpop-merge" title="ผสานเซลที่มีค่าซ้ำติดกัน (rowspan)">
      <input type="checkbox" ${mergeChecked} onchange="window._crMergeToggle(this.checked)">
      <span>≣ ผสานเซลซ้ำ</span>
    </label>` : "";
  const filterBlock = canFilter ? `
    <input class="cr-fpop-search" type="search" placeholder="ค้นหาค่า..." oninput="window._crFilterSearch(this.value)">
    <div class="cr-fpop-acts">
      <button onclick="window._crFilterAll(true)">เลือกทั้งหมด</button>
      <button onclick="window._crFilterAll(false)">ล้าง</button>
    </div>
    <div class="cr-fpop-list"></div>
    <div class="cr-fpop-foot">
      <button onclick="window._crFilterClear()">เอาตัวกรองออก</button>
      <button class="primary" onclick="window._crFilterApply()">ใช้</button>
    </div>` : `
    <div class="cr-fpop-msg">ค่าหลากหลายเกิน ${FILTER_MAX_DISTINCT} แบบ จึงกรองไม่ได้${canMerge ? "" : " · ผสานเซลก็ไม่ได้"}</div>`;
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
window._crMergeToggle = function (on) {
  if (!_popState) return;
  if (on) state.merged[_popState.key] = true; else delete state.merged[_popState.key];
  rebuildSortForMerge();
  renderPreview();
};
function rebuildSortForMerge() {
  const mergedKeys = state.selected.filter((k) => state.merged[k]);
  const others = state.sort.filter((s) => !state.merged[s.key]);
  const prefix = mergedKeys.map((k) => state.sort.find((s) => s.key === k) || { key: k, dir: 1 });
  state.sort = [...prefix, ...others];
}
window._crFilterSearch = function (v) { if (!_popState) return; _popState.search = v || ""; renderFilterPopoverBody(); };
window._crFilterAll = function (sel) {
  if (!_popState) return;
  const values = distinctValuesFor(_popState.key);
  const q = _popState.search.trim().toLowerCase();
  const target = q ? values.filter((v) => String(v).toLowerCase().includes(q)) : values;
  if (sel) target.forEach((v) => _popState.draft.add(v)); else target.forEach((v) => _popState.draft.delete(v));
  renderFilterPopoverBody();
};
window._crFilterApply = function () {
  if (!_popState) return;
  const { key, draft } = _popState;
  const values = distinctValuesFor(key);
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

// ── COLUMN PICK / SORT / SETTINGS ──────────────────────────
window.crToggleGroup = function (gid) { state.collapsed[gid] = !state.collapsed[gid]; renderPicker(); };
window.toggleColumn = function (key, checked) {
  if (!COL_BY_KEY[key]) return;
  const idx = state.selected.indexOf(key);
  if (checked && idx < 0) state.selected.push(key);
  else if (!checked && idx >= 0) {
    state.selected.splice(idx, 1);
    delete state.filters[key]; delete state.merged[key]; delete state.hidden[key];
  }
  closeFilterPopover();
  renderPicker();
  renderAll();
};
window.toggleHideColumn = function (key) {
  if (!COL_BY_KEY[key]) return;
  if (state.hidden[key]) delete state.hidden[key]; else state.hidden[key] = true;
  renderAll();
};
window.moveColumn = function (key, dir) {
  const i = state.selected.indexOf(key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= state.selected.length) return;
  [state.selected[i], state.selected[j]] = [state.selected[j], state.selected[i]];
  renderAll();
};
window.sortBy = function (key) {
  if (!COL_BY_KEY[key]) return;
  const i = state.sort.findIndex((s) => s.key === key);
  if (i < 0) state.sort.push({ key, dir: 1 });
  else if (state.sort[i].dir === 1) state.sort[i].dir = -1;
  else state.sort.splice(i, 1);
  renderPreview();
};
window.crSearch = function (v) {
  state.search = v || "";
  const clr = document.getElementById("crSearchClear");
  if (clr) clr.style.display = state.search ? "" : "none";
  renderPreview();
};
window.crSearchClear = function () {
  state.search = "";
  const inp = document.getElementById("crSearch");
  if (inp) inp.value = "";
  const clr = document.getElementById("crSearchClear");
  if (clr) clr.style.display = "none";
  renderPreview();
};
window.setWarehouse = function (v) { state.warehouseId = v || ""; buildRows(); renderAll(); };
window.setRowsPerPage = function (v) {
  if (v === "auto") { state.rowsPerPage = "auto"; return; }
  const n = parseInt(v, 10);
  state.rowsPerPage = (Number.isFinite(n) && n >= 1) ? n : "auto";
};
window.setOrientation = function (v) { state.orientation = v === "portrait" ? "portrait" : "landscape"; };
window.setGroupBy = function (v) { state.groupBy = v || ""; renderPreview(); };
window.setShowTotal = function (on) { state.showTotal = !!on; renderPreview(); };

// ── PRESETS (localStorage) ─────────────────────────────────
function loadPresets() {
  try { state.templates = JSON.parse(localStorage.getItem(PRESET_LS_KEY) || "[]"); }
  catch { state.templates = []; }
  if (!Array.isArray(state.templates)) state.templates = [];
}
function savePresetsLS() { localStorage.setItem(PRESET_LS_KEY, JSON.stringify(state.templates)); }
function renderTemplates() {
  const sel = document.getElementById("presetSelect");
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = `<option value="">— เลือกชุดที่บันทึกไว้ —</option>` +
    state.templates.map((t) => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)}</option>`).join("");
  if (cur && state.templates.some((t) => t.name === cur)) sel.value = cur;
}
window.applyPreset = function (name) {
  if (!name) return;
  const tpl = state.templates.find((t) => t.name === name);
  if (!tpl) return;
  state.selected = (tpl.columns || []).filter((k) => COL_BY_KEY[k]);
  Object.keys(state.filters).forEach((k) => { if (!state.selected.includes(k)) delete state.filters[k]; });
  Object.keys(state.merged).forEach((k) => { if (!state.selected.includes(k)) delete state.merged[k]; });
  Object.keys(state.hidden).forEach((k) => { if (!state.selected.includes(k)) delete state.hidden[k]; });
  closeFilterPopover();
  renderPicker();
  renderAll();
  showToast(`ใช้ชุด "${tpl.name}" แล้ว`, "success");
};
window.savePreset = async function () {
  if (!state.selected.length) { showToast("เลือกคอลัมน์ก่อนบันทึกชุด", "info"); return; }
  const name = window.PromptModal
    ? await window.PromptModal.open({ title: "บันทึกชุดคอลัมน์", message: "ตั้งชื่อชุดคอลัมน์นี้", icon: "💾", okText: "บันทึก", cancelText: "ยกเลิก", placeholder: "เช่น รายงานยอดคงเหลือ", required: true })
    : prompt("ตั้งชื่อชุดคอลัมน์");
  if (name === null) return;
  const trimmed = String(name).trim();
  if (!trimmed) return;
  const existing = state.templates.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) existing.columns = [...state.selected];
  else state.templates.push({ name: trimmed, columns: [...state.selected] });
  state.templates.sort((a, b) => a.name.localeCompare(b.name));
  savePresetsLS();
  renderTemplates();
  document.getElementById("presetSelect").value = trimmed;
  showToast(`บันทึกชุด "${trimmed}" แล้ว`, "success");
};
window.deletePreset = async function () {
  const name = document.getElementById("presetSelect").value;
  if (!name) { showToast("เลือกชุดที่จะลบก่อน", "info"); return; }
  const ok = window.ConfirmModal
    ? await window.ConfirmModal.open({ title: "ลบชุดคอลัมน์", message: `ลบชุด "${name}"?`, icon: "🗑", tone: "danger", okText: "ลบ" })
    : confirm(`ลบชุด "${name}"?`);
  if (!ok) return;
  state.templates = state.templates.filter((t) => t.name !== name);
  savePresetsLS();
  renderTemplates();
  showToast(`ลบชุด "${name}" แล้ว`, "success");
};

// ── EXPORT helpers ─────────────────────────────────────────
function outputCols() { return state.selected.map((k) => COL_BY_KEY[k]).filter((c) => c && !state.hidden[c.key]); }
function reportTitle() { return "Stock Report"; }
function scopeLabel() {
  if (!state.warehouseId) return "ทุกคลัง";
  const w = state.warehouses.find((w) => String(w.warehouse_id) === String(state.warehouseId));
  return "คลัง: " + (w?.warehouse_name || "—");
}

// ── EXPORT EXCEL ───────────────────────────────────────────
window.exportReportExcel = function () {
  if (!state.selected.length) { showToast("เลือกคอลัมน์ก่อน export", "info"); return; }
  const cols = outputCols();
  if (!cols.length) { showToast("ทุกคอลัมน์ถูกซ่อนอยู่", "info"); return; }
  if (typeof XLSX === "undefined") { showToast("กำลังโหลด XLSX — ลองใหม่อีกครั้ง", "error"); return; }
  const rows = getRows();
  const rspan = computeRowspans(rows, cols);
  const aoa = [cols.map((c) => colLabel(c))];
  rows.forEach((row, i) => {
    aoa.push(cols.map((c, ci) => {
      if (rspan[ci][i] === 0) return "";
      // ส่งเป็นตัวเลขดิบให้ Excel (sort/sum ได้) สำหรับคอลัมน์ตัวเลข
      if (isNumCol(c)) return Number(row[c.key]) || 0;
      return cellValue(row, c);
    }));
  });
  if (state.showTotal && rows.length) {
    const totals = numericTotals(cols, rows);
    aoa.push(cols.map((c, ci) => {
      if (ci === 0) return `รวม ${rows.length} รายการ`;
      return isNumCol(c) ? totals[c.key] : "";
    }));
  }
  if (!rows.length) aoa.push(cols.map(() => ""));
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = cols.map((c) => ({ wch: Math.max(colLabel(c).length + 2, 14) }));
  const merges = [];
  cols.forEach((_, ci) => rows.forEach((_, i) => {
    const span = rspan[ci][i];
    if (span > 1) merges.push({ s: { r: i + 1, c: ci }, e: { r: i + span, c: ci } });
  }));
  if (merges.length) ws["!merges"] = merges;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Stock Report");
  XLSX.writeFile(wb, `Stock-Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
  showToast("Export Excel แล้ว", "success");
};

// ── PRINT / PDF ────────────────────────────────────────────
function resolveRowsPerPage() {
  if (state.rowsPerPage !== "auto") {
    const n = parseInt(state.rowsPerPage, 10);
    return Number.isFinite(n) && n >= 1 ? n : 15;
  }
  const isLandscape = state.orientation === "landscape";
  const hasImage = outputCols().some((c) => c.fmt === "image");
  if (hasImage) return isLandscape ? 8 : 12;
  const pageH = isLandscape ? 210 : 297;
  const usableH = pageH - 20 - 14;
  const rows = Math.floor(usableH / 7.8) - 1;
  return Math.max(1, rows);
}
function computePrintImgSize() {
  const isLandscape = state.orientation === "landscape";
  const pageH = isLandscape ? 210 : 297;
  const pageW = isLandscape ? 297 : 210;
  const usableH = pageH - 20 - 22;
  const usableW = pageW - 20;
  const rows = resolveRowsPerPage();
  const rowH = usableH / rows;
  const imgH = Math.max(8, rowH - 3);
  const imgW = Math.min(usableW * 0.5, imgH * 1.5);
  return { imgH, imgW };
}
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
function waitForImages(container, timeoutMs = 10000) {
  const imgs = Array.from(container.querySelectorAll("img"));
  imgs.forEach((img) => { img.loading = "eager"; });
  const pending = imgs.filter((img) => !img.complete);
  if (!pending.length) return Promise.resolve();
  return new Promise((resolve) => {
    let left = pending.length;
    const done = () => { if (--left <= 0) resolve(); };
    pending.forEach((img) => {
      img.addEventListener("load", done, { once: true });
      img.addEventListener("error", done, { once: true });
    });
    setTimeout(resolve, timeoutMs);
  });
}
function buildReportHeaderHtml(cols, rows) {
  const gen = new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
  return `<div class="cr-print-title">📦 Stock Report · ${escapeHtml(scopeLabel())}</div>
    <div class="cr-print-sub">${rows.length} รายการ · ${cols.length} คอลัมน์ · พิมพ์เมื่อ ${escapeHtml(gen)}</div>`;
}
window.exportReportPrint = function () {
  if (!state.selected.length) { showToast("เลือกคอลัมน์ก่อนพิมพ์", "info"); return; }
  const cols = outputCols();
  if (!cols.length) { showToast("ทุกคอลัมน์ถูกซ่อนอยู่", "info"); return; }
  const printArea = document.getElementById("cr-print-area");
  const pageStyle = document.getElementById("crPageStyle");
  if (pageStyle) pageStyle.textContent = `@page{size:${state.orientation};margin:10mm}`;
  const rows = getRows();
  const hasImageCol = cols.some((c) => c.fmt === "image");
  applyPrintStyles(printArea, hasImageCol);
  const thead = `<th>#</th>` + cols.map((c) => `<th${isNumCol(c) ? ' class="cr-num"' : ""}>${escapeHtml(colLabel(c))}</th>`).join("");
  const tbody = buildGroupedTrs(cols, rows).join("") ||
    `<tr><td colspan="${cols.length + 1}" style="text-align:center;color:#94a3b8">ไม่มีข้อมูล</td></tr>`;
  printArea.innerHTML = `${buildReportHeaderHtml(cols, rows)}
    <table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;
  showToast("กำลังเปิดหน้าต่างพิมพ์...", "info");
  waitForImages(printArea).then(() => window.print());
};

// ── PREVIEW (A4 paginated) ─────────────────────────────────
function buildOnePagePreview(cols, trsHtml, pageNum, totalPages, isFirstPage, rowCount) {
  const headerHtml = isFirstPage ? buildReportHeaderHtml(cols, { length: rowCount }) : "";
  const thead = `<th style="width:32px">#</th>` + cols.map((c) => `<th${isNumCol(c) ? ' class="cr-num"' : ""}>${escapeHtml(colLabel(c))}</th>`).join("");
  return `${headerHtml}
    <table><thead><tr>${thead}</tr></thead><tbody>${trsHtml.join("")}</tbody></table>
    <div class="cr-preview-page-num">หน้า ${pageNum} / ${totalPages}</div>`;
}
window.previewReportPrint = function () {
  if (!state.selected.length) { showToast("เลือกคอลัมน์ก่อนดูตัวอย่าง", "info"); return; }
  const cols = outputCols();
  if (!cols.length) { showToast("ทุกคอลัมน์ถูกซ่อนอยู่", "info"); return; }
  const allRows = getRows();
  const hasImageCol = cols.some((c) => c.fmt === "image");
  const trs = buildGroupedTrs(cols, allRows);
  const perPage = Math.max(1, resolveRowsPerPage());
  const totalPages = Math.max(1, Math.ceil(trs.length / perPage));
  const showPages = Math.min(PREVIEW_MAX_PAGES, totalPages);
  const ori = state.orientation === "portrait" ? "portrait" : "landscape";

  const scroll = document.getElementById("crPreviewScroll");
  scroll.innerHTML = "";
  for (let p = 0; p < showPages; p++) {
    const start = p * perPage;
    const paper = document.createElement("div");
    paper.className = `cr-preview-paper ${ori}`;
    applyPrintStyles(paper, hasImageCol);
    paper.innerHTML = buildOnePagePreview(cols, trs.slice(start, start + perPage), p + 1, totalPages, p === 0, allRows.length);
    scroll.appendChild(paper);
  }
  if (totalPages > showPages) {
    const more = document.createElement("div");
    more.className = "cr-preview-more";
    more.textContent = `แสดง ${showPages}/${totalPages} หน้า · รวม ${allRows.length} รายการ (พิมพ์จริงจะออกครบทุกหน้า)`;
    scroll.appendChild(more);
  }
  const meta = document.getElementById("crPreviewMeta");
  if (meta) {
    const oriLbl = state.orientation === "portrait" ? "แนวตั้ง" : "แนวนอน";
    const autoTag = state.rowsPerPage === "auto" ? "อัตโนมัติ " : "";
    meta.textContent = `· A4 ${oriLbl} · ${autoTag}${perPage} แถว/หน้า · รวม ${allRows.length} รายการ / ${totalPages} หน้า`;
  }
  document.getElementById("crPreviewModal").style.display = "flex";
  scroll.scrollTop = 0;
};
window.closePreview = function () {
  const modal = document.getElementById("crPreviewModal");
  if (modal) modal.style.display = "none";
};

// ── IMAGE LIGHTBOX ─────────────────────────────────────────
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
document.addEventListener("keydown", (ev) => {
  if (ev.key !== "Escape") return;
  const lb = document.getElementById("cr-img-modal");
  if (lb && lb.classList.contains("open")) { window.crCloseImg(); return; }
  const modal = document.getElementById("crPreviewModal");
  if (modal && modal.style.display !== "none") window.closePreview();
});

// ── WAREHOUSE DROPDOWN ─────────────────────────────────────
function populateWarehouses() {
  const sel = document.getElementById("crWarehouse");
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = `<option value="">ทุกคลัง</option>` +
    state.warehouses.map((w) => `<option value="${w.warehouse_id}">🏭 ${escapeHtml(w.warehouse_name)}</option>`).join("");
  if (cur) sel.value = cur;
}

// ── BOOT ───────────────────────────────────────────────────
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
