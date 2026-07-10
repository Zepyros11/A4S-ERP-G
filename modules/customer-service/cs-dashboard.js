/* ============================================================
   cs-dashboard.js — CS Sales Dashboard (ยอดขายตามสาขา)
   Data: daily_sale_bills + daily_sale_payments
   กลุ่มสาขา (BKK / HY / KK) ใช้ config ร่วมกับหน้า Daily Sale
   (localStorage key = ds_branch_groups) เพื่อให้เงื่อนไขตรงกัน
   ============================================================ */

const SB_URL = localStorage.getItem('sb_url') || '';
const SB_KEY = localStorage.getItem('sb_key') || '';

/* ── tiny helpers ── */
function $(id) { return document.getElementById(id); }
function fmt(n) { return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
function fmtInt(n) { return Number(n || 0).toLocaleString('en-US'); }
function fmtDMY(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
function toast(msg, type = 'success') {
  const el = $('toast');
  if (!el) return alert(msg);
  el.textContent = msg;
  el.className = `toast show toast-${type}`;
  setTimeout(() => el.classList.remove('show'), 3000);
}
function showLoading(on) {
  const el = $('loadingOverlay');
  if (el) el.style.display = on ? 'flex' : 'none';
}

/* ── date helpers (Asia/Bangkok) ── */
function todayIso() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }); }
function isoShift(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function startOfWeek(iso) { const d = new Date(iso + 'T00:00:00Z'); const wd = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - wd); return d.toISOString().slice(0, 10); }  // จันทร์
function startOfMonth(iso) { return iso.slice(0, 7) + '-01'; }
function startOfYear(iso) { return iso.slice(0, 4) + '-01-01'; }
function enumerateDays(from, to) { const out = []; let d = from, guard = 0; while (d <= to && guard++ < 400) { out.push(d); d = isoShift(d, 1); } return out; }
const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const TH_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
// รายการเดือน YYYY-MM ตั้งแต่ from ถึง to (ใช้ย่อยกราฟแนวโน้มเมื่อช่วงยาว)
function enumerateMonths(from, to) {
  const out = [];
  let y = +from.slice(0, 4), m = +from.slice(5, 7);
  const ey = +to.slice(0, 4), em = +to.slice(5, 7);
  let guard = 0;
  while ((y < ey || (y === ey && m <= em)) && guard++ < 240) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
// ป้ายกำกับ "เดือนที่เลือก" ต่อท้ายหัวข้อ — รองรับช่วงข้ามเดือน/ข้ามปี
function csdMonthLabel() {
  const [fy, fm] = state.from.split('-').map(Number);
  const [ty, tm] = state.to.split('-').map(Number);
  if (state.preset === 'year') return ` ปี ${fy}`;
  if (fy === ty && fm === tm) return ` เดือน ${TH_MONTHS[fm - 1]} ${fy}`;
  if (fy === ty) return ` เดือน ${TH_MONTHS[fm - 1]}–${TH_MONTHS[tm - 1]} ${fy}`;
  return ` ${TH_MONTHS[fm - 1]} ${fy} – ${TH_MONTHS[tm - 1]} ${ty}`;
}
function updateMonthLabels() {
  document.querySelectorAll('.csd-title-month').forEach(el => { el.textContent = csdMonthLabel(); });
}
// ป้ายช่วงเวลาปัจจุบัน (สำหรับตัวเลื่อนล่าง) — อ่านง่ายตาม preset
function csdPeriodText() {
  const [fy, fm] = state.from.split('-').map(Number);
  if (state.preset === 'year') return `ปี ${fy}`;
  if (state.preset === 'month') return `${TH_MONTHS[fm - 1]} ${fy}`;
  if (state.preset === 'today') return fmtDMY(state.from);
  return state.from === state.to ? fmtDMY(state.from) : `${fmtDMY(state.from)} – ${fmtDMY(state.to)}`;
}

/* ── Supabase fetch ── */
async function sbGet(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

/* ── กลุ่มสาขา (ใช้ร่วมกับ Daily Sale · เก็บ localStorage) ── */
const GROUP_ORDER = ['BKK', 'HY', 'KK'];
const GROUP_COLOR = { BKK: '#3d6b4f', HY: '#1d4ed8', KK: '#b45309' };   // sage · blue · amber
const GROUP_CLASS = { BKK: 'green', HY: 'blue', KK: 'amber' };
const GROUP_ICON  = { BKK: '🟢', HY: '🔵', KK: '🟠' };

function csdDefaultGroups() { return { BKK: ['BKK01', 'NB', 'BUR', 'DP'], HY: ['HY'], KK: ['KK'] }; }
function csdLoadGroups() {
  try { const s = JSON.parse(localStorage.getItem('ds_branch_groups')); if (s && typeof s === 'object' && Object.keys(s).length) return s; } catch {}
  return csdDefaultGroups();
}
let BRANCH_GROUPS = csdLoadGroups();

// สาขารับ: sync มี receive_branch · import เก่า/online = null → fallback branch → BKK01
function recvBranch(b) { return (b.receive_branch || b.branch || 'BKK01').toUpperCase(); }
function branchGroupOf(b) {
  const code = recvBranch(b);
  for (const g in BRANCH_GROUPS) if ((BRANCH_GROUPS[g] || []).includes(code)) return g;
  return 'BKK';   // สาขาอื่น/ไม่ทราบ → นับเป็น BKK (เหมือน Daily Sale)
}
// ประเภทบิล 'แลกสินค้า' (sync) หรือ bill_type 'ARP' (import เก่า)
function isRedemption(b) { const t = (b.bill_type || '').trim(); return t === 'แลกสินค้า' || t.toUpperCase() === 'ARP'; }
// บิลเติมเงิน ewallet: bill_type EWALLET หรือ prefix ETH
function isEwallet(b) { const t = (b.bill_type || '').toUpperCase(); return t === 'EWALLET' || String(b.bill_no || '').toUpperCase().startsWith('ETH'); }
// วันที่จริงของบิล = business_date (ปิดรอบแล้ว) หรือ sale_date (pending วันนี้)
function effDate(b) { return b.business_date || String(b.sale_date || '').slice(0, 10); }

/* ── Fix Chart.js hover/tooltip ให้ตรงกับตำแหน่งเมาส์ใต้ CSS zoom ──
   แอปตั้ง :root{zoom:.65} (desktop density) แต่ Chart.js อ่านพิกัดจาก offsetX/offsetY
   ซึ่งไม่ผ่านการ map ของ zoom → hitbox/tooltip เลื่อนออกจากช่องจริง.
   แก้โดยคำนวณตำแหน่งใหม่จากสัดส่วน getBoundingClientRect (คงที่ไม่ขึ้นกับ zoom).
   ทำงานได้ทุกค่า zoom — ไม่ต้อง hardcode 0.65 (ก๊อปแนวเดียวกับ modules/dashboard/dashboard.js) */
const ChartZoomHoverFix = {
  id: 'zoomHoverFix',
  beforeEvent(chart, args) {
    const e = args.event;
    const ne = e && e.native;
    if (!ne || ne.clientX == null) return;
    const rect = chart.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    e.x = (ne.clientX - rect.left) / rect.width  * chart.width;
    e.y = (ne.clientY - rect.top)  / rect.height * chart.height;
  },
};
if (typeof Chart !== 'undefined') Chart.register(ChartZoomHoverFix);

/* ── state ── */
let state = { from: startOfMonth(todayIso()), to: todayIso(), preset: 'month', offset: 0, group: 'ALL' };

// คำนวณช่วง from–to จากหน่วย (วัน/สัปดาห์/เดือน/ปี) + offset (0 = ปัจจุบัน, -1 = ย้อน 1, +1 = หน้า 1)
function computePeriod(gran, offset) {
  const today = todayIso();
  offset = offset || 0;
  if (gran === 'today') { const d = isoShift(today, offset); return { from: d, to: d }; }
  if (gran === 'week') {
    const from = startOfWeek(isoShift(today, offset * 7));
    return { from, to: offset === 0 ? today : isoShift(from, 6) };
  }
  if (gran === 'month') {
    const [y, m] = today.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1 + offset, 1));
    const yy = dt.getUTCFullYear(), mm = dt.getUTCMonth() + 1;
    const from = `${yy}-${String(mm).padStart(2, '0')}-01`;
    const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    return { from, to: offset === 0 ? today : `${yy}-${String(mm).padStart(2, '0')}-${String(last).padStart(2, '0')}` };
  }
  if (gran === 'year') {
    const y = Number(today.slice(0, 4)) + offset;
    return { from: `${y}-01-01`, to: offset === 0 ? today : `${y}-12-31` };
  }
  return { from: today, to: today };
}
let charts = { branch: null, trend: null };
let _lastData = null;   // เก็บบิล+payment ล่าสุด เพื่อ re-render ตอนสลับ filter สาขาโดยไม่ต้อง fetch ใหม่

/* ============================================================
   INIT
   ============================================================ */
function init() {
  if (window.Chart) {
    Chart.defaults.font.family = "'Sarabun', sans-serif";
    Chart.defaults.color = '#6a635b';
  }
  csdSetPreset('month', true);        // ตั้งช่วงเริ่มต้น = เดือนนี้ (ไม่ยิงซ้ำ)
  $('csdFrom').addEventListener('change', csdOnDateInput);
  $('csdTo').addEventListener('change', csdOnDateInput);
  renderBranchChips();
  loadAll();

  // topbar/sidebar โหลดแบบ async แล้วหด .page หลัง chart วาดเสร็จ → บังคับ Chart.js
  // วัดขนาด canvas ใหม่ ไม่งั้น hit-test (hover/tooltip) จะเพี้ยนตามความกว้างที่เปลี่ยน
  const kickResize = () => { if (charts.branch) charts.branch.resize(); if (charts.trend) charts.trend.resize(); };
  window.addEventListener('load', kickResize);
  window.addEventListener('resize', kickResize);
}

function csdOnDateInput() {
  state.from = $('csdFrom').value || todayIso();
  state.to = $('csdTo').value || state.from;
  if (state.from > state.to) { const t = state.from; state.from = state.to; state.to = t; $('csdFrom').value = state.from; $('csdTo').value = state.to; }
  state.preset = 'custom';
  state.offset = 0;
  syncPresetChips();
  loadAll();
}

function csdSetPreset(preset, silent) {
  state.preset = preset;
  state.offset = 0;                      // เลือกหน่วยใหม่ → กลับมาช่วงปัจจุบันเสมอ
  const p = computePeriod(preset, 0);
  state.from = p.from; state.to = p.to;
  $('csdFrom').value = state.from;
  $('csdTo').value = state.to;
  syncPresetChips();
  if (!silent) loadAll();
}

// ‹ / › เลื่อนช่วงไป-กลับ 1 หน่วยตาม preset ที่เลือก (custom = เลื่อนเท่าความกว้างช่วง)
function csdShiftPeriod(dir) {
  if (['today', 'week', 'month', 'year'].includes(state.preset)) {
    state.offset = (state.offset || 0) + dir;
    const p = computePeriod(state.preset, state.offset);
    state.from = p.from; state.to = p.to;
  } else {
    const span = Math.round((Date.parse(state.to) - Date.parse(state.from)) / 86400000) + 1;
    state.from = isoShift(state.from, dir * span);
    state.to = isoShift(state.to, dir * span);
  }
  $('csdFrom').value = state.from;
  $('csdTo').value = state.to;
  loadAll();
}

function syncPresetChips() {
  document.querySelectorAll('#csdPresetChips .filter-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.preset === state.preset);
  });
}

/* ── Branch filter chips (ALL / BKK / HY / KK) + gear ── */
function renderBranchChips() {
  const el = $('csdBranchChips');
  if (!el) return;
  const opts = ['ALL', ...GROUP_ORDER];
  el.innerHTML = opts.map(g => {
    const on = state.group === g;
    const label = g === 'ALL' ? 'ทั้งหมด' : g;
    const tip = g === 'ALL' ? 'ทุกกลุ่ม' : (BRANCH_GROUPS[g] || []).join(', ') || '(ยังไม่กำหนดสาขา)';
    return `<label class="csd-branch-chip${on ? ' on' : ''}" title="${tip}"><input type="radio" name="csdBranchGrp" ${on ? 'checked' : ''} onchange="csdSelectBranch('${g}')">${label}</label>`;
  }).join('') + `<button type="button" class="csd-grp-edit" title="แก้ไขกลุ่มสาขา" onclick="csdGroupOpen()">⚙️</button>`;
}
function csdSelectBranch(g) {
  state.group = g;
  renderBranchChips();
  if (_lastData && _lastData.bills) {
    renderSales(_lastData.bills);                              // re-render จาก cache (ไม่ fetch ใหม่)
    if (_lastData.payMap) renderPay(_lastData.bills, _lastData.payMap);
  }
}

/* ── แก้ไขกลุ่มสาขา (sync localStorage เดียวกับ Daily Sale) ── */
function csdGroupOpen() {
  GROUP_ORDER.forEach(g => { const el = $('csdGrp' + g); if (el) el.value = (BRANCH_GROUPS[g] || []).join(', '); });
  $('csdGroupOverlay').classList.add('open');
}
function csdGroupClose() { $('csdGroupOverlay').classList.remove('open'); }
function csdGroupSave() {
  const parse = id => ($(id).value || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  BRANCH_GROUPS = { BKK: parse('csdGrpBKK'), HY: parse('csdGrpHY'), KK: parse('csdGrpKK') };
  localStorage.setItem('ds_branch_groups', JSON.stringify(BRANCH_GROUPS));
  csdGroupClose();
  renderBranchChips();
  toast('บันทึกกลุ่มสาขาแล้ว', 'success');
  loadAll();
}

/* ============================================================
   LOAD
   ============================================================ */
// PostgREST คืนสูงสุด 1000 แถว/request (max-rows) → ต้องดึงทีละหน้า (offset) จนครบ
const SB_PAGE = 1000;
// ดึงหน้าแรกพร้อมนับ total (count=exact) แล้วยิงหน้าที่เหลือ "ขนานกันทั้งหมด" → เร็วกว่าวนทีละหน้ามาก
// ถ้าอ่าน Content-Range ไม่ได้ (CORS ไม่ expose) → fallback วน sequential (กันข้อมูลตกหล่น)
async function sbGetAll(base) {
  const res = await fetch(`${SB_URL}/rest/v1/${base}&limit=${SB_PAGE}&offset=0`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: 'count=exact' },
  });
  if (!res.ok) throw new Error(`GET ${base} → ${res.status}`);
  const first = await res.json();
  if (first.length < SB_PAGE) return first;                          // หน้าเดียวจบ
  const total = Number((res.headers.get('content-range') || '').split('/')[1]);
  if (!Number.isFinite(total)) {                                     // อ่าน count ไม่ได้ → วนต่อทีละหน้า
    const all = first.slice();
    for (let offset = SB_PAGE, guard = 0; guard < 100; guard++, offset += SB_PAGE) {
      const rows = await sbGet(`${base}&limit=${SB_PAGE}&offset=${offset}`);
      all.push(...rows);
      if (rows.length < SB_PAGE) break;
    }
    return all;
  }
  const pages = Math.ceil(total / SB_PAGE);                          // ยิงหน้าที่เหลือขนานกัน
  const rest = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) => sbGet(`${base}&limit=${SB_PAGE}&offset=${(i + 1) * SB_PAGE}`))
  );
  return first.concat(...rest);
}

async function fetchBills() {
  const { from, to } = state;
  const today = todayIso();
  const sel = 'select=amount,bill_type,bill_no,branch,receive_branch,sale_date,business_date';
  // order คงที่ (bill_no) เพื่อให้ paginate ด้วย offset ไม่ซ้ำ/ไม่ตกหล่น
  const where = (to >= today)
    // ช่วงคลุมวันนี้ → รวมบิล pending (business_date = NULL) ด้วย
    ? `or=(and(business_date.gte.${from},business_date.lte.${to}),business_date.is.null)`
    : `business_date=gte.${from}&business_date=lte.${to}`;
  const rows = await sbGetAll(`daily_sale_bills?${where}&${sel}&order=bill_no.asc`);
  // บิล pending (business_date = NULL) เก็บเฉพาะที่ sale_date อยู่ในช่วง
  return rows.filter(b => {
    if (b.business_date) return true;
    const d = String(b.sale_date || '').slice(0, 10);
    return d >= from && d <= to;
  });
}

// payments สำหรับตารางช่องทางชำระ — ดึงตามช่วง sale_date (paginate) แทนยิงทีละ 200 bill_no
// เร็วกว่ามาก (5 requests แทน ~25) และไม่ต้องรอ bills → ยิงขนานกับ fetchBills ได้
async function fetchPaymentRows() {
  const FIELDS = 'select=bill_no,cash,front_office,online,kbank,ktb,ewallet,gift_voucher,qr_payment';
  const from = isoShift(state.from, -3), to = isoShift(state.to, 3);   // เผื่อขอบวันเล็กน้อย
  return sbGetAll(`daily_sale_payments?sale_date=gte.${from}&sale_date=lte.${to}&${FIELDS}&order=bill_no.asc`);
}

async function loadAll() {
  // โหลดแบบเนียน: หรี่จาง content เดิมไว้ (ไม่บังทั้งจอ) + spinner เล็กที่ปุ่มรีเฟรช
  const body = $('csdBody'), busy = $('csdBusy');
  if (body) body.classList.add('is-loading');
  if (busy) busy.style.display = 'inline-flex';
  $('csdRangeLabel').textContent = state.from === state.to
    ? fmtDMY(state.from)
    : `${fmtDMY(state.from)} – ${fmtDMY(state.to)}`;
  updateMonthLabels();
  { const el = $('csdPeriodLabel'); if (el) el.textContent = csdPeriodText(); }
  try {
    // ยิง bills + payments พร้อมกัน (payments ดึงตามช่วงวันที่ ไม่ต้องรอ bills)
    const billsP = fetchBills();
    const payP = fetchPaymentRows().catch(e => { console.warn('payments load failed:', e); return []; });
    const bills = await billsP;
    _lastData = { bills, payMap: null };
    renderSales(bills);                          // KPI/การ์ด/กราฟ แสดงทันทีที่ได้ bills
    if (body) body.classList.remove('is-loading');
    // เติมตารางช่องทางชำระเมื่อ payments มา (map เฉพาะบิลในชุด)
    const payRows = await payP;
    const need = new Set(bills.map(b => b.bill_no));
    const payMap = {};
    payRows.forEach(p => { if (need.has(p.bill_no)) payMap[p.bill_no] = p; });
    _lastData.payMap = payMap;
    renderPay(bills, payMap);
  } catch (e) {
    console.error('CS Dashboard load failed:', e);
    toast('โหลดข้อมูลไม่สำเร็จ: ' + e.message, 'error');
  } finally {
    if (body) body.classList.remove('is-loading');
    if (busy) busy.style.display = 'none';
  }
}

/* ============================================================
   AGGREGATE + RENDER
   ============================================================ */
function blankChannels() { return { cash: 0, credit: 0, transfer: 0, ewallet: 0, gift: 0, qr: 0 }; }
function blankAgg() { return { sales: 0, bills: 0, arp: 0, ew: 0, ch: blankChannels() }; }

let _agg = null;   // agg ล่าสุด (sales/bills/arp/ew) — renderPay เติม channel ต่อ

// จาก bills อย่างเดียว: KPI · การ์ดสาขา · กราฟเทียบ · กราฟแนวโน้ม · โครงตาราง (ช่องทาง = 0 ก่อน)
function renderSales(bills) {
  const agg = {}; GROUP_ORDER.forEach(g => agg[g] = blankAgg());
  // แกนเวลาของกราฟแนวโน้ม: ช่วงยาว (>62 วัน เช่น "ปีนี้") ย่อยเป็นรายเดือน · สั้นกว่านั้นรายวัน
  const monthly = enumerateDays(state.from, state.to).length > 62;
  const buckets = monthly ? enumerateMonths(state.from, state.to) : enumerateDays(state.from, state.to);
  const trend = {}; GROUP_ORDER.forEach(g => { trend[g] = {}; buckets.forEach(k => trend[g][k] = 0); });

  bills.forEach(b => {
    const g = branchGroupOf(b);
    const A = agg[g] || (agg[g] = blankAgg());
    if (isEwallet(b)) { A.ew++; return; }
    if (isRedemption(b)) { A.arp++; return; }
    const amt = Number(b.amount || 0);
    A.sales += amt; A.bills++;
    const key = monthly ? effDate(b).slice(0, 7) : effDate(b);
    if (trend[g] && key in trend[g]) trend[g][key] += amt;
  });
  _agg = agg;
  const visible = state.group === 'ALL' ? GROUP_ORDER : [state.group];
  renderKPI(agg, visible);
  renderBranchCards(agg);
  renderBranchChart(agg);
  renderTrendChart(trend, buckets, visible, monthly);
  renderPayTable(agg, visible);   // ยอดบิล/จำนวนบิล แสดงได้เลย · ช่องทาง = 0 (เติมใน renderPay)
}

// เติม channel sums จาก payments แล้ว re-render เฉพาะตารางช่องทางชำระ
function renderPay(bills, payMap) {
  const agg = _agg; if (!agg) return;
  GROUP_ORDER.forEach(g => { if (agg[g]) agg[g].ch = blankChannels(); });
  bills.forEach(b => {
    if (isEwallet(b) || isRedemption(b)) return;   // เฉพาะบิลขายปกติ
    const g = branchGroupOf(b);
    if (!agg[g]) return;
    const p = payMap[b.bill_no] || {};
    const C = agg[g].ch;
    C.cash     += Number(p.cash || 0);
    C.credit   += Number(p.front_office || 0) + Number(p.online || 0);
    C.transfer += Number(p.kbank || 0) + Number(p.ktb || 0);
    C.ewallet  += Number(p.ewallet || 0);
    C.gift     += Number(p.gift_voucher || 0);
    C.qr       += Number(p.qr_payment || 0);
  });
  const visible = state.group === 'ALL' ? GROUP_ORDER : [state.group];
  renderPayTable(agg, visible);
}

function renderKPI(agg, visible) {
  let sales = 0, bills = 0, arp = 0, ew = 0;
  visible.forEach(g => { const A = agg[g] || blankAgg(); sales += A.sales; bills += A.bills; arp += A.arp; ew += A.ew; });
  $('csdKpiGrp').textContent = state.group === 'ALL' ? 'รวม' : state.group;
  $('csdKpiSales').textContent = fmt(sales);
  $('csdKpiBills').textContent = fmtInt(bills);
  $('csdKpiAvg').textContent = bills ? fmt(sales / bills) : '—';
  $('csdKpiArp').textContent = fmtInt(arp);
  $('csdKpiEwallet').textContent = fmtInt(ew);
}

function renderBranchCards(agg) {
  const wrap = $('csdBranchCards');
  const totalSales = GROUP_ORDER.reduce((s, g) => s + (agg[g] ? agg[g].sales : 0), 0);
  wrap.innerHTML = GROUP_ORDER.map(g => {
    const A = agg[g] || blankAgg();
    const pct = totalSales > 0 ? Math.round(A.sales / totalSales * 100) : 0;
    const active = state.group === 'ALL' || state.group === g;
    const branches = (BRANCH_GROUPS[g] || []).join(', ') || '—';
    return `
      <div class="stat-card ${GROUP_CLASS[g]} is-clickable csd-branch-card${active ? '' : ' is-dimmed'}"
           onclick="csdSelectBranch('${state.group === g ? 'ALL' : g}')"
           title="สาขา: ${branches} — คลิกเพื่อ${state.group === g ? 'ยกเลิกตัวกรอง' : 'ดูเฉพาะ ' + g}">
        <div class="stat-icon">${GROUP_ICON[g]}</div>
        <div class="stat-info">
          <div class="stat-label">${g} · <span class="csd-card-pct">${pct}%</span></div>
          <div class="stat-value">${fmt(A.sales)}</div>
          <div class="stat-sub">${fmtInt(A.bills)} บิล${A.arp ? ` · ARP ${fmtInt(A.arp)}` : ''}${A.ew ? ` · E-Wallet ${fmtInt(A.ew)}` : ''}</div>
        </div>
      </div>`;
  }).join('');
}

function renderBranchChart(agg) {
  const canvas = $('csdBranchChart');
  const data = GROUP_ORDER.map(g => (agg[g] ? agg[g].sales : 0));
  const empty = data.every(v => v === 0);
  $('csdBranchEmpty').style.display = empty ? 'block' : 'none';
  canvas.style.display = empty ? 'none' : 'block';
  $('csdBarSub').textContent = empty ? '' : `รวม ${fmt(data.reduce((a, b) => a + b, 0))} THB`;
  if (charts.branch) { charts.branch.destroy(); charts.branch = null; }
  if (empty || !window.Chart) return;
  charts.branch = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: GROUP_ORDER,
      datasets: [{
        label: 'ยอดขาย (THB)',
        data,
        backgroundColor: GROUP_ORDER.map(g => GROUP_COLOR[g]),
        borderRadius: 6,
        maxBarThickness: 90,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: c => ' ' + fmt(c.parsed.y) + ' THB' } },
      },
      scales: {
        y: { beginAtZero: true, ticks: { callback: v => fmtInt(v) }, grid: { color: 'rgba(0,0,0,.05)' } },
        x: { grid: { display: false } },
      },
    },
  });
}

function renderTrendChart(trend, buckets, visible, monthly) {
  const canvas = $('csdTrendChart');
  const anyData = visible.some(g => buckets.some(k => trend[g] && trend[g][k] > 0));
  $('csdTrendEmpty').style.display = anyData ? 'none' : 'block';
  canvas.style.display = anyData ? 'block' : 'none';
  $('csdTrendSub').textContent = buckets.length > 1 ? `${buckets.length} ${monthly ? 'เดือน' : 'วัน'}` : '';
  if (charts.trend) { charts.trend.destroy(); charts.trend = null; }
  if (!anyData || !window.Chart) return;
  let labels;
  if (monthly) {
    const multiYear = new Set(buckets.map(b => b.slice(0, 4))).size > 1;
    labels = buckets.map(b => { const [y, m] = b.split('-'); return TH_MONTHS_SHORT[+m - 1] + (multiYear ? ' ' + y.slice(2) : ''); });
  } else {
    labels = buckets.map(d => { const [, m, dd] = d.split('-'); return `${dd}/${m}`; });
  }
  const datasets = visible.map(g => ({
    label: g,
    data: buckets.map(k => trend[g] ? trend[g][k] : 0),
    borderColor: GROUP_COLOR[g],
    backgroundColor: GROUP_COLOR[g] + '22',
    borderWidth: 2,
    pointRadius: buckets.length > 45 ? 0 : 3,
    pointHoverRadius: 5,
    tension: 0.3,
    fill: visible.length === 1,
  }));
  charts.trend = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: visible.length > 1, position: 'top', labels: { boxWidth: 12, boxHeight: 12, usePointStyle: true } },
        tooltip: { callbacks: { label: c => ` ${c.dataset.label}: ${fmt(c.parsed.y)} THB` } },
      },
      scales: {
        y: { beginAtZero: true, ticks: { callback: v => fmtInt(v) }, grid: { color: 'rgba(0,0,0,.05)' } },
        x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 16 } },
      },
    },
  });
}

function renderPayTable(agg, visible) {
  const body = $('csdPayBody');
  const foot = $('csdPayFoot');
  const cell = v => `<td class="csd-num">${Number(v || 0) === 0 ? '<span class="csd-zero">–</span>' : fmt(v)}</td>`;
  const rows = visible.map(g => {
    const A = agg[g] || blankAgg();
    const chSum = A.ch.cash + A.ch.credit + A.ch.transfer + A.ch.ewallet + A.ch.gift + A.ch.qr;
    return `<tr>
      <td class="csd-td-branch"><span class="csd-dot" style="background:${GROUP_COLOR[g]}"></span>${g}</td>
      ${cell(A.ch.cash)}${cell(A.ch.credit)}${cell(A.ch.transfer)}${cell(A.ch.ewallet)}${cell(A.ch.gift)}${cell(A.ch.qr)}
      <td class="csd-num csd-col-total">${fmt(chSum)}</td>
      <td class="csd-num csd-col-total">${fmt(A.sales)}</td>
      <td class="csd-num csd-col-total">${fmtInt(A.bills)}</td>
    </tr>`;
  }).join('');
  body.innerHTML = rows || `<tr><td colspan="10" class="csd-table-empty">ไม่มีข้อมูล</td></tr>`;

  // total row
  const T = blankAgg();
  visible.forEach(g => {
    const A = agg[g] || blankAgg();
    T.sales += A.sales; T.bills += A.bills;
    Object.keys(T.ch).forEach(k => T.ch[k] += A.ch[k]);
  });
  const tSum = T.ch.cash + T.ch.credit + T.ch.transfer + T.ch.ewallet + T.ch.gift + T.ch.qr;
  const tcell = v => `<td class="csd-num">${Number(v || 0) === 0 ? '<span class="csd-zero">–</span>' : fmt(v)}</td>`;
  foot.innerHTML = `<tr class="csd-total-row">
    <td class="csd-td-branch">รวม (${visible.length} สาขา)</td>
    ${tcell(T.ch.cash)}${tcell(T.ch.credit)}${tcell(T.ch.transfer)}${tcell(T.ch.ewallet)}${tcell(T.ch.gift)}${tcell(T.ch.qr)}
    <td class="csd-num csd-col-total">${fmt(tSum)}</td>
    <td class="csd-num csd-col-total">${fmt(T.sales)}</td>
    <td class="csd-num csd-col-total">${fmtInt(T.bills)}</td>
  </tr>`;
}

document.addEventListener('DOMContentLoaded', init);
