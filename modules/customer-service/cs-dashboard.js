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
function enumerateDays(from, to) { const out = []; let d = from, guard = 0; while (d <= to && guard++ < 400) { out.push(d); d = isoShift(d, 1); } return out; }

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
let state = { from: startOfMonth(todayIso()), to: todayIso(), preset: 'month', group: 'ALL' };
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
  syncPresetChips();
  loadAll();
}

function csdSetPreset(preset, silent) {
  const today = todayIso();
  if (preset === 'today') { state.from = today; state.to = today; }
  else if (preset === 'week') { state.from = startOfWeek(today); state.to = today; }
  else if (preset === 'month') { state.from = startOfMonth(today); state.to = today; }
  state.preset = preset;
  $('csdFrom').value = state.from;
  $('csdTo').value = state.to;
  syncPresetChips();
  if (!silent) loadAll();
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
  if (_lastData) render(_lastData.bills, _lastData.payMap);   // re-render จาก cache (ไม่ fetch ใหม่)
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
async function fetchBills() {
  const { from, to } = state;
  const today = todayIso();
  const sel = 'select=amount,bill_type,bill_no,branch,receive_branch,sale_date,business_date';
  let q;
  if (to >= today) {
    // ช่วงคลุมวันนี้ → รวมบิล pending (business_date = NULL) ด้วย
    q = `daily_sale_bills?or=(and(business_date.gte.${from},business_date.lte.${to}),business_date.is.null)&${sel}&limit=20000`;
  } else {
    q = `daily_sale_bills?business_date=gte.${from}&business_date=lte.${to}&${sel}&limit=20000`;
  }
  let bills = await sbGet(q);
  // บิล pending (business_date = NULL) เก็บเฉพาะที่ sale_date อยู่ในช่วง
  bills = bills.filter(b => {
    if (b.business_date) return true;
    const d = String(b.sale_date || '').slice(0, 10);
    return d >= from && d <= to;
  });
  return bills;
}

async function fetchPayments(bills) {
  const map = {};
  const nos = [...new Set(bills.map(b => b.bill_no).filter(Boolean))];
  const FIELDS = 'select=bill_no,cash,front_office,online,kbank,ktb,ewallet,gift_voucher,qr_payment,commission_deduct,arp_amount';
  for (let i = 0; i < nos.length; i += 200) {
    const inl = nos.slice(i, i + 200).map(b => `"${b}"`).join(',');
    const rows = await sbGet(`daily_sale_payments?bill_no=in.(${inl})&${FIELDS}`);
    rows.forEach(p => { map[p.bill_no] = p; });
  }
  return map;
}

async function loadAll() {
  showLoading(true);
  $('csdRangeLabel').textContent = state.from === state.to
    ? fmtDMY(state.from)
    : `${fmtDMY(state.from)} – ${fmtDMY(state.to)}`;
  try {
    const bills = await fetchBills();
    const payMap = await fetchPayments(bills);
    _lastData = { bills, payMap };
    render(bills, payMap);
  } catch (e) {
    console.error('CS Dashboard load failed:', e);
    toast('โหลดข้อมูลไม่สำเร็จ: ' + e.message, 'error');
  } finally {
    showLoading(false);
  }
}

/* ============================================================
   AGGREGATE + RENDER
   ============================================================ */
function blankChannels() { return { cash: 0, credit: 0, transfer: 0, ewallet: 0, gift: 0, qr: 0 }; }
function blankAgg() { return { sales: 0, bills: 0, arp: 0, ew: 0, ch: blankChannels() }; }

function render(bills, payMap) {
  // aggregate ต่อกลุ่มสาขา
  const agg = {}; GROUP_ORDER.forEach(g => agg[g] = blankAgg());
  const days = enumerateDays(state.from, state.to);
  const trend = {}; GROUP_ORDER.forEach(g => { trend[g] = {}; days.forEach(d => trend[g][d] = 0); });

  bills.forEach(b => {
    const g = branchGroupOf(b);
    const A = agg[g] || (agg[g] = blankAgg());
    if (isEwallet(b)) { A.ew++; return; }
    if (isRedemption(b)) { A.arp++; return; }
    const amt = Number(b.amount || 0);
    A.sales += amt; A.bills++;
    const d = effDate(b);
    if (trend[g] && d in trend[g]) trend[g][d] += amt;
    const p = payMap[b.bill_no] || {};
    A.ch.cash     += Number(p.cash || 0);
    A.ch.credit   += Number(p.front_office || 0) + Number(p.online || 0);
    A.ch.transfer += Number(p.kbank || 0) + Number(p.ktb || 0);
    A.ch.ewallet  += Number(p.ewallet || 0);
    A.ch.gift     += Number(p.gift_voucher || 0);
    A.ch.qr       += Number(p.qr_payment || 0);
  });

  const visible = state.group === 'ALL' ? GROUP_ORDER : [state.group];

  renderKPI(agg, visible);
  renderBranchCards(agg);
  renderBranchChart(agg);
  renderTrendChart(trend, days, visible);
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

function renderTrendChart(trend, days, visible) {
  const canvas = $('csdTrendChart');
  const anyData = visible.some(g => days.some(d => trend[g] && trend[g][d] > 0));
  $('csdTrendEmpty').style.display = anyData ? 'none' : 'block';
  canvas.style.display = anyData ? 'block' : 'none';
  $('csdTrendSub').textContent = days.length > 1 ? `${days.length} วัน` : '';
  if (charts.trend) { charts.trend.destroy(); charts.trend = null; }
  if (!anyData || !window.Chart) return;
  const labels = days.map(d => { const [, m, dd] = d.split('-'); return `${dd}/${m}`; });
  const datasets = visible.map(g => ({
    label: g,
    data: days.map(d => trend[g] ? trend[g][d] : 0),
    borderColor: GROUP_COLOR[g],
    backgroundColor: GROUP_COLOR[g] + '22',
    borderWidth: 2,
    pointRadius: days.length > 45 ? 0 : 3,
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
