/* ============================================================
   daily-sale.js — Daily Sale CS module
   Data: daily_sale_bills + _payments + _topup_bills + _topup_details + _reconcile
   Sync trigger: GitHub Actions workflow_dispatch (ใช้ sync_config เดียวกับ members-sync)
   ============================================================ */

const SB_URL = localStorage.getItem('sb_url') || '';
const SB_KEY = localStorage.getItem('sb_key') || '';
const WORKFLOW = 'sync-daily-sale.yml';

let state = {
  date: new Date().toISOString().slice(0, 10),
  branch: '',
  tab: 'sale',
  branches: [],
  config: null,
  sale: {},   // bill_no → { bill, payment } cache shared by sale + pending tabs
  branchChecks: {},  // branchKey → bool (checkbox filter, sale tab · persists across reloads)
};

function todayIso() { return new Date().toISOString().slice(0, 10); }

// Filter clause: ถ้าเลือก "วันนี้" → รวม business_date = today + NULL (pending)
//                ถ้าย้อนหลัง → business_date = selected_date (finalized แล้ว)
function dateFilter(field = 'business_date') {
  if (state.date === todayIso()) {
    return `or=(${field}.eq.${state.date},${field}.is.null)`;
  }
  return `${field}=eq.${state.date}`;
}

/* ── tiny helpers ── */
function $(id) { return document.getElementById(id); }
function fmt(n) { return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 }); }
function fmtDMY(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
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

/* Custom confirm dialog — returns Promise<boolean> */
let _dsConfirmResolver = null;
function dsConfirm(msg, opts = {}) {
  const modal = $('dsConfirm');
  $('dsConfirmTitle').textContent = opts.title || 'ยืนยัน';
  $('dsConfirmMsg').innerHTML = msg;
  $('dsConfirmIcon').textContent = opts.icon || '⚠️';
  modal.classList.add('open');
  return new Promise(resolve => { _dsConfirmResolver = resolve; });
}
function dsConfirmResolve(result) {
  $('dsConfirm').classList.remove('open');
  if (_dsConfirmResolver) { _dsConfirmResolver(result); _dsConfirmResolver = null; }
}
document.addEventListener('keydown', (e) => {
  if (!$('dsConfirm')?.classList.contains('open')) return;
  if (e.key === 'Escape') dsConfirmResolve(false);
  if (e.key === 'Enter') dsConfirmResolve(true);
});

async function sbGet(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}
async function sbPost(path, body, prefer = 'return=representation') {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: prefer,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json().catch(() => null);
}

/* ============================================================
   LOAD — initial
   ============================================================ */
async function init() {
  $('dsDate').value = state.date;
  $('dsDate').addEventListener('change', (e) => { state.date = e.target.value; loadAll(); });
  $('dsBranch').addEventListener('change', (e) => { state.branch = e.target.value; loadAll(); });

  try {
    const rows = await sbGet('sync_config?id=eq.1&limit=1');
    state.config = rows?.[0] || null;
  } catch {}

  try {
    const branches = await sbGet('branches?active=eq.true&order=display_order,branch_code');
    state.branches = branches || [];
    const sel = $('dsBranch');
    branches.forEach(b => {
      const o = document.createElement('option');
      o.value = b.branch_code;
      o.textContent = `${b.branch_code} · ${b.branch_name}`;
      sel.appendChild(o);
    });
  } catch (e) {
    console.warn('Load branches failed:', e);
  }

  await loadAll();
}

async function loadAll() {
  $('dsRecDateLabel').textContent = fmtDMY(state.date);
  await Promise.all([loadKPI(), loadPending(), loadSale(), loadTopup(), loadReconcile(), loadReconcileList()]);
}

/* ============================================================
   KPI (hero)
   ============================================================ */
async function loadKPI() {
  const branchFilter = state.branch ? `&branch=eq.${state.branch}` : '';
  try {
    // view column aliased: business_date AS sale_date
    const rows = await sbGet(`daily_sale_summary?${dateFilter('sale_date')}${branchFilter}`);
    let bills = 0, amount = 0, cash = 0, transfer = 0, credit = 0, ewallet = 0;
    rows.forEach(r => {
      bills += r.bill_count || 0;
      amount += Number(r.total_amount || 0);
      cash += Number(r.total_cash || 0);
      transfer += Number(r.total_transfer || 0);
      credit += Number(r.total_credit_card || 0);
      ewallet += Number(r.total_ewallet || 0);
    });
    $('dsKpiBills').textContent = bills;
    $('dsKpiAmount').textContent = fmt(amount);
    $('dsKpiCash').textContent = fmt(cash);
    $('dsKpiTransfer').textContent = fmt(transfer);
    $('dsKpiCredit').textContent = fmt(credit);
    $('dsKpiEwallet').textContent = fmt(ewallet);
  } catch (e) {
    console.error('KPI load failed:', e);
  }

  try {
    const logs = await sbGet(`sync_log?source=eq.daily_sale&order=started_at.desc&limit=1`);
    const r = logs?.[0];
    if (r?.started_at) {
      const d = new Date(r.started_at);
      $('dsKpiSync').textContent = `${d.toLocaleDateString('th-TH')} ${d.toTimeString().slice(0, 5)}`;
      $('dsHeroStatus').textContent = `Sync ล่าสุด · ${r.status}`;
    } else {
      $('dsHeroStatus').textContent = 'ยังไม่เคย sync';
    }
  } catch {}
}

/* ============================================================
   TAB: Sale (bills + payments)
   ============================================================ */
// Payment channels shown in the sale table (order = Google Sheet DAILY SALE)
const DS_CH = ['cash', 'front_office', 'online', 'kbank', 'ktb', 'ewallet', 'gift_voucher', 'qr_payment', 'commission_deduct', 'arp_amount'];
// blank a zero so the sheet stays readable (matches Google Sheet: empty cell for 0)
function fmt0(n) { return Number(n || 0) === 0 ? '' : fmt(n); }
function channelSum(p) { return DS_CH.reduce((s, k) => s + Number(p[k] || 0), 0); }
// prefix ตัวอักษรของเลขบิล (STHBKK.. → "BKK", STHONLIN.. → "ONLIN") ใช้จัดกลุ่มก่อนเรียง
function billPrefix(bn) { return (String(bn || '').replace(/^STH/i, '').match(/^[A-Za-z]+/)?.[0] || '').toUpperCase(); }
// เรียง: prefix (BKK<HY<KK<ONLIN) → วันที่เก่าก่อน → เลขบิล
function saleSort(a, b) {
  const pa = billPrefix(a.bill_no), pb = billPrefix(b.bill_no);
  if (pa !== pb) return pa < pb ? -1 : 1;
  const da = a.sale_date || '', db = b.sale_date || '';
  if (da !== db) return da < db ? -1 : 1;
  return String(a.bill_no) < String(b.bill_no) ? -1 : 1;
}
// สาขาของบิลสำหรับ checkbox filter: บิลออนไลน์ → ONLINE, ที่เหลือใช้ branch column (BKK01/HY/KK)
function branchKey(b) {
  const p = billPrefix(b.bill_no);
  if (p === 'ONLIN' || p === 'ETHONLIN') return 'ONLINE';
  return b.branch || p || '—';
}
function renderBranchChecks(keys) {
  const el = $('dsBranchChecks');
  if (!el) return;
  el.innerHTML = keys.map(k => {
    const on = state.branchChecks[k] !== false;
    return `<label class="ds-branch-chip${on ? ' on' : ''}"><input type="checkbox" ${on ? 'checked' : ''} onchange="dsToggleBranch('${k}')">${k}</label>`;
  }).join('');
}
function dsToggleBranch(k) {
  state.branchChecks[k] = (state.branchChecks[k] === false);  // flip (default true → false → true)
  loadSale();
}

// 3 ตารางตาม Google Sheet — คอลัมน์เดียวกันหมด ต่างแค่ label 3 ช่องท้าย (qr/comm/arp)
const DS_TABLES = [
  { key: 'sale',    title: '💰 บิลขายปกติ',                                       l: ['QR Paymet', 'หักค่าคอม', 'ARP'] },
  { key: 'arp',     title: '🎁 แลกสินค้า ARP (POINT) · ARP EASY · ABB Online',    l: ['ARP (POINT)', 'ARP EASY', 'ABB Online'] },
  { key: 'ewallet', title: '👛 E-WALLET (THB)',                                    l: ['QR Paymet', 'โอนค่าคอมเข้า E/W', 'ARP'] },
];
// จัดบิลเข้าตาราง: ARP (bill_type) / EWALLET (bill_type หรือ prefix ETH) / ที่เหลือ = ขายปกติ
function billGroup(b) {
  const t = (b.bill_type || '').toUpperCase();
  if (t === 'ARP') return 'arp';
  if (t === 'EWALLET' || String(b.bill_no || '').toUpperCase().startsWith('ETH')) return 'ewallet';
  return 'sale';
}

function saleTableShell(cfg) {
  const [l8, l9, l10] = cfg.l;
  return `
  <div class="ds-table-wrap ds-sale-block">
    <div class="ds-table-title">${cfg.title}</div>
    <div style="overflow-x:auto">
      <table class="ds-table ds-table-sheet">
        <thead>
          <tr>
            <th rowspan="3" class="ds-hd-id">NO</th>
            <th rowspan="3" class="ds-hd-id">วันที่</th>
            <th rowspan="3" class="ds-hd-id">เลขออเดอร์</th>
            <th rowspan="3" class="ds-hd-id">รหัส</th>
            <th rowspan="3" class="ds-hd-id">Name</th>
            <th colspan="10" class="ds-grp ds-grp-pay">Payment (THB)</th>
            <th rowspan="3" class="ds-num ds-hd-sys">ยอดในระบบ</th>
            <th rowspan="3" class="ds-num ds-hd-sys">ผลต่าง</th>
            <th rowspan="3" class="ds-hd-meta">ผู้บันทึก</th>
            <th rowspan="3" class="ds-hd-meta">หมายเหตุเพิ่มเติม</th>
            <th rowspan="3" class="ds-hd-meta"></th>
          </tr>
          <tr>
            <th rowspan="2" class="ds-num ds-col-cash">Cash</th>
            <th colspan="2" class="ds-grp ds-col-cc">Credit Card</th>
            <th colspan="2" class="ds-grp ds-col-tf">Tranfer Money</th>
            <th rowspan="2" class="ds-num ds-col-ew">E-WALLET</th>
            <th rowspan="2" class="ds-num ds-col-gift">Gift Voucher</th>
            <th rowspan="2" class="ds-num ds-col-qr">${l8}</th>
            <th rowspan="2" class="ds-num ds-col-comm">${l9}</th>
            <th rowspan="2" class="ds-num ds-col-arp">${l10}</th>
          </tr>
          <tr>
            <th class="ds-num ds-col-cc">Front Office</th>
            <th class="ds-num ds-col-cc">Online</th>
            <th class="ds-num ds-col-tf">KBANK</th>
            <th class="ds-num ds-col-tf">KTB</th>
          </tr>
        </thead>
        <tbody id="dsBody_${cfg.key}"><tr><td colspan="20" class="ds-table-empty">กำลังโหลด...</td></tr></tbody>
        <tfoot id="dsFoot_${cfg.key}"></tfoot>
      </table>
    </div>
  </div>`;
}

function fillSaleTable(key, list, pMap, canEdit) {
  const body = $(`dsBody_${key}`), foot = $(`dsFoot_${key}`);
  if (!body) return;
  if (!list.length) {
    body.innerHTML = `<tr><td colspan="20" class="ds-table-empty">ไม่มีข้อมูล</td></tr>`;
    if (foot) foot.innerHTML = '';
    return;
  }
  const rows = [];
  let sumAmount = 0, sumDiff = 0;
  const tot = Object.fromEntries(DS_CH.map(k => [k, 0]));

  list.forEach((b, i) => {
    const p = pMap[b.bill_no] || {};
    state.sale[b.bill_no] = { bill: b, payment: p };
    const amount = Number(b.amount || 0);
    const diff = channelSum(p) - amount;
    sumAmount += amount;
    sumDiff += diff;
    DS_CH.forEach(k => { tot[k] += Number(p[k] || 0); });

    const correctedBadge = p.corrected
      ? ` <span class="ds-corrected-badge" title="ช่องทางชำระถูกแก้ใน ERP — sync จะไม่เขียนทับ">✏️</span>` : '';
    const editBtn = canEdit
      ? `<button class="ds-edit-btn" title="แก้ช่องทางชำระ" onclick="dsEditOpen('${b.bill_no}')">✏️</button>` : '';
    const note = b.notes || p.correction_notes || '';
    const diffCls = Math.abs(diff) > 0.5 ? 'ds-num ds-diff-bad' : 'ds-num ds-diff-ok';

    rows.push(`
      <tr${p.corrected ? ' class="ds-row-corrected"' : ''}>
        <td class="ds-num">${i + 1}</td>
        <td>${fmtDMY(b.sale_date)}</td>
        <td><span class="ds-bill-no">${b.bill_no}</span>${correctedBadge}</td>
        <td>${b.member_code || ''}</td>
        <td>${(b.member_name || '').slice(0, 40)}</td>
        <td class="ds-num ds-col-cash">${fmt0(p.cash)}</td>
        <td class="ds-num ds-col-cc">${fmt0(p.front_office)}</td>
        <td class="ds-num ds-col-cc">${fmt0(p.online)}</td>
        <td class="ds-num ds-col-tf">${fmt0(p.kbank)}</td>
        <td class="ds-num ds-col-tf">${fmt0(p.ktb)}</td>
        <td class="ds-num ds-col-ew">${fmt0(p.ewallet)}</td>
        <td class="ds-num ds-col-gift">${fmt0(p.gift_voucher)}</td>
        <td class="ds-num ds-col-qr">${fmt0(p.qr_payment)}</td>
        <td class="ds-num ds-col-comm">${fmt0(p.commission_deduct)}</td>
        <td class="ds-num ds-col-arp">${fmt0(p.arp_amount)}</td>
        <td class="ds-num">${fmt(amount)}</td>
        <td class="${diffCls}">${diff === 0 ? '-' : fmt(diff)}</td>
        <td>${b.recorded_by || ''}</td>
        <td style="font-size:11.5px">${note.slice(0, 40)}</td>
        <td class="ds-edit-cell">${editBtn}</td>
      </tr>`);
  });
  body.innerHTML = rows.join('');

  const c = (cls, v) => `<td class="ds-num ${cls}">${fmt(v)}</td>`;
  foot.innerHTML = `<tr class="ds-foot-total">
    <td colspan="5" style="text-align:right">รวม (${list.length})</td>
    ${c('ds-col-cash', tot.cash)}${c('ds-col-cc', tot.front_office)}${c('ds-col-cc', tot.online)}${c('ds-col-tf', tot.kbank)}${c('ds-col-tf', tot.ktb)}${c('ds-col-ew', tot.ewallet)}${c('ds-col-gift', tot.gift_voucher)}${c('ds-col-qr', tot.qr_payment)}${c('ds-col-comm', tot.commission_deduct)}${c('ds-col-arp', tot.arp_amount)}
    <td class="ds-num">${fmt(sumAmount)}</td>
    <td class="ds-num ${sumDiff === 0 ? '' : 'ds-diff-bad'}">${sumDiff === 0 ? '-' : fmt(sumDiff)}</td>
    <td colspan="3"></td>
  </tr>`;
}

// fetch payments in chunks (in.() list stays short even for a big day)
async function fetchPaymentsMap(billNos) {
  const pMap = {};
  for (let i = 0; i < billNos.length; i += 200) {
    const inl = billNos.slice(i, i + 200).map(b => `"${b}"`).join(',');
    const rows = await sbGet(`daily_sale_payments?bill_no=in.(${inl})&select=*`);
    rows.forEach(p => { pMap[p.bill_no] = p; });
  }
  return pMap;
}

async function loadSale() {
  const canEdit = window.hasPerm ? hasPerm('daily_sale_reconcile') : true;
  const wrap = $('dsSaleTables');
  if (wrap && !$('dsBody_sale')) wrap.innerHTML = DS_TABLES.map(saleTableShell).join('');
  try {
    const branchFilter = state.branch ? `&branch=eq.${state.branch}` : '';
    const bills = await sbGet(`daily_sale_bills?${dateFilter()}${branchFilter}&limit=3000`);
    bills.sort(saleSort);   // BKK ก่อน ONLIN · วันที่เก่าก่อน (client-side)

    // Branch checkbox filter — render จาก set เต็ม (สาขาใหม่ default ติ๊ก) แล้วค่อยกรอง
    const allKeys = [...new Set(bills.map(branchKey))].sort();
    allKeys.forEach(k => { if (!(k in state.branchChecks)) state.branchChecks[k] = true; });
    renderBranchChecks(allKeys);
    const visible = bills.filter(b => state.branchChecks[branchKey(b)] !== false);

    const pMap = visible.length ? await fetchPaymentsMap(visible.map(b => b.bill_no)) : {};

    const groups = { sale: [], arp: [], ewallet: [] };
    visible.forEach(b => groups[billGroup(b)].push(b));
    DS_TABLES.forEach(cfg => fillSaleTable(cfg.key, groups[cfg.key], pMap, canEdit));
  } catch (e) {
    if (wrap) wrap.innerHTML = `<div class="ds-table-empty">❌ ${e.message}</div>`;
  }
}

/* ============================================================
   EDIT CHANNEL — แก้ช่องทางชำระต่อบิล (Forward: ERP = source of truth)
   ============================================================ */
// Split channels — ตรงกับคอลัมน์ Google Sheet (CS จำแนก Front Office/Online, KBANK/KTB ที่นี่)
const DS_EDIT_FIELDS = [
  { key: 'cash',              label: 'เงินสด (Cash)' },
  { key: 'front_office',      label: 'บัตร · Front Office' },
  { key: 'online',            label: 'บัตร · Online' },
  { key: 'kbank',             label: 'โอน · KBANK' },
  { key: 'ktb',               label: 'โอน · KTB' },
  { key: 'ewallet',           label: 'E-Wallet' },
  { key: 'gift_voucher',      label: 'Gift Voucher' },
  { key: 'qr_payment',        label: 'QR Payment' },
  { key: 'commission_deduct', label: 'หักค่าคอม' },
  { key: 'arp_amount',        label: 'ARP' },
];

let _dsEditBillNo = null;

function dsEditOpen(billNo) {
  const rec = state.sale?.[billNo];
  if (!rec) { toast('ไม่พบข้อมูลบิล', 'error'); return; }
  _dsEditBillNo = billNo;
  const { bill, payment } = rec;

  $('dsEditBillNo').textContent = billNo;
  $('dsEditMember').textContent = `${bill.member_code || ''} · ${bill.member_name || '—'}`;
  $('dsEditAmount').textContent = fmt(bill.amount);
  $('dsEditAmountRaw').value = Number(bill.amount || 0);

  const grid = $('dsEditGrid');
  grid.innerHTML = DS_EDIT_FIELDS.map(f => `
    <div class="ds-edit-field">
      <label>${f.label}</label>
      <input type="number" step="0.01" id="dsEdit_${f.key}"
             value="${Number(payment[f.key] || 0)}" oninput="dsEditRecalc()" />
    </div>
  `).join('');

  $('dsEditMethod').value = payment.payment_method || '';
  $('dsEditNotes').value = payment.correction_notes || '';
  $('dsEditOverlay').classList.add('open');
  dsEditRecalc();
}

function dsEditClose() {
  $('dsEditOverlay').classList.remove('open');
  _dsEditBillNo = null;
}

// Live compare: sum of channels vs bill amount (soft warning, doesn't block save)
function dsEditRecalc() {
  let sum = 0;
  for (const f of DS_EDIT_FIELDS) {
    sum += Number($(`dsEdit_${f.key}`)?.value || 0);
  }
  const amount = Number($('dsEditAmountRaw').value || 0);
  const diff = sum - amount;
  const el = $('dsEditSumCheck');
  if (Math.abs(diff) < 0.005) {
    el.className = 'ds-edit-sumcheck ok';
    el.textContent = `✓ รวมช่องทาง ${fmt(sum)} = ยอดบิล`;
  } else {
    el.className = 'ds-edit-sumcheck warn';
    el.innerHTML = `⚠️ รวมช่องทาง <b>${fmt(sum)}</b> · ยอดบิล <b>${fmt(amount)}</b> · ต่าง <b>${fmt(diff)}</b>`;
  }
}

async function dsEditSave() {
  if (!_dsEditBillNo) return;
  const billNo = _dsEditBillNo;
  const rec = state.sale?.[billNo];
  const record = {
    bill_no: billNo,
    sale_date: rec?.bill?.sale_date || todayIso(),
    amount: Number($('dsEditAmountRaw').value || 0),
    payment_method: $('dsEditMethod').value.trim() || null,
    correction_notes: $('dsEditNotes').value.trim() || null,
    corrected: true,
    corrected_by: window.ERP_USER?.user_id || 'unknown',
    corrected_at: new Date().toISOString(),
  };
  for (const f of DS_EDIT_FIELDS) {
    record[f.key] = Number($(`dsEdit_${f.key}`)?.value || 0);
  }
  // Keep aggregates in sync (summary view + KPIs still read credit_card/transfer)
  record.credit_card = record.front_office + record.online;
  record.transfer = record.kbank + record.ktb;

  showLoading(true);
  try {
    await sbPost(
      'daily_sale_payments?on_conflict=bill_no',
      [record],
      'resolution=merge-duplicates,return=minimal'
    );
    dsEditClose();
    toast('บันทึกช่องทางชำระแล้ว · sync จะไม่เขียนทับบิลนี้', 'success');
    await Promise.all([loadSale(), loadPending(), loadKPI()]);
  } catch (e) {
    toast('บันทึกล้มเหลว: ' + e.message, 'error');
  }
  showLoading(false);
}

/* ============================================================
   TAB: Pending review — บิลใหม่รอตรวจ (business_date IS NULL)
   บิลที่ sync เข้ามาแต่ยังไม่ปิดยอด = โผล่หลังปิดรอบก่อน · CS ตรวจ+แก้ channel
   แล้วค่อยกด Sync Now → close_day ตีตราเป็นวัน
   ============================================================ */
function channelSummary(p) {
  const map = { cash: 'เงินสด', transfer: 'โอน', credit_card: 'บัตร', ewallet: 'E-Wallet', gift_voucher: 'Gift', qr_payment: 'QR', arp_amount: 'ARP' };
  const parts = [];
  for (const k in map) { if (Number(p[k] || 0) > 0) parts.push(`${map[k]} ${fmt(p[k])}`); }
  if (Number(p.commission_deduct || 0) > 0) parts.push(`หักคอม ${fmt(p.commission_deduct)}`);
  return parts.join(' · ') || '—';
}

function updatePendingBadge(n) {
  const badge = $('dsPendingBadge');
  if (!badge) return;
  if (n > 0) { badge.textContent = n; badge.style.display = ''; }
  else { badge.style.display = 'none'; }
}

async function loadPending() {
  const body = $('dsPendingBody');
  const canEdit = window.hasPerm ? hasPerm('daily_sale_reconcile') : true;
  body.innerHTML = `<tr><td colspan="8" class="ds-table-empty">กำลังโหลด...</td></tr>`;
  try {
    const branchFilter = state.branch ? `&branch=eq.${state.branch}` : '';
    const bills = await sbGet(
      `daily_sale_bills?business_date=is.null${branchFilter}&order=sale_datetime.desc&limit=1000`
    );
    updatePendingBadge(bills.length);
    if (!bills.length) {
      body.innerHTML = `<tr><td colspan="8" class="ds-table-empty">✓ ไม่มีบิลค้างตรวจ — ปิดยอดครบแล้ว</td></tr>`;
      $('dsPendingSummary').style.display = 'none';
      return;
    }

    const billNos = bills.map(b => `"${b.bill_no}"`).join(',');
    const payments = await sbGet(`daily_sale_payments?bill_no=in.(${billNos})&select=*`);
    const pMap = Object.fromEntries(payments.map(p => [p.bill_no, p]));

    const rows = [];
    let sumAmount = 0, correctedCount = 0;
    for (const b of bills) {
      const p = pMap[b.bill_no] || {};
      state.sale[b.bill_no] = { bill: b, payment: p };
      sumAmount += Number(b.amount || 0);
      if (p.corrected) correctedCount++;

      const time = b.sale_datetime
        ? new Date(b.sale_datetime).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '—';
      const status = p.corrected
        ? `<span class="ds-corrected-badge">✏️ แก้แล้ว</span>`
        : `<span class="ds-pending-badge">รอตรวจ</span>`;
      const editBtn = canEdit
        ? `<button class="ds-edit-btn" title="แก้ช่องทางชำระ" onclick="dsEditOpen('${b.bill_no}')">✏️</button>`
        : '';

      rows.push(`
        <tr${p.corrected ? ' class="ds-row-corrected"' : ''}>
          <td><span class="ds-bill-no">${b.bill_no}</span></td>
          <td style="font-size:11.5px;white-space:nowrap">${time}</td>
          <td>${b.member_code || ''} · ${(b.member_name || '').slice(0, 24)}</td>
          <td class="ds-num">${fmt(b.amount)}</td>
          <td style="font-size:11.5px">${channelSummary(p)}</td>
          <td>${b.branch || '—'}</td>
          <td>${status}</td>
          <td class="ds-edit-cell">${editBtn}</td>
        </tr>
      `);
    }
    body.innerHTML = rows.join('');
    $('dsPendCount').textContent = bills.length;
    $('dsPendCorrected').textContent = correctedCount;
    $('dsPendAmount').textContent = fmt(sumAmount);
    $('dsPendingSummary').style.display = 'flex';
  } catch (e) {
    body.innerHTML = `<tr><td colspan="8" class="ds-table-empty">❌ ${e.message}</td></tr>`;
  }
}

/* ============================================================
   TAB: Topup (topup_bills + details)
   ============================================================ */
async function loadTopup() {
  const body = $('dsTopupBody');
  body.innerHTML = `<tr><td colspan="10" class="ds-table-empty">กำลังโหลด...</td></tr>`;
  try {
    const branchFilter = state.branch ? `&branch=eq.${state.branch}` : '';
    const bills = await sbGet(
      `daily_sale_topup_bills?${dateFilter()}${branchFilter}&order=sale_date.desc&limit=1000`
    );
    if (!bills.length) {
      body.innerHTML = `<tr><td colspan="10" class="ds-table-empty">ไม่มีบิลเติม E-Wallet ในวันนี้</td></tr>`;
      $('dsTopupSummary').style.display = 'none';
      return;
    }

    const billNos = bills.map(b => `"${b.bill_no}"`).join(',');
    const details = await sbGet(`daily_sale_topup_details?bill_no=in.(${billNos})&select=*`);
    const dMap = {};
    details.forEach(d => { (dMap[d.bill_no] = dMap[d.bill_no] || []).push(d); });

    const rows = [];
    let sumAmount = 0;
    for (const b of bills) {
      sumAmount += Number(b.amount || 0);
      const d = dMap[b.bill_no] || [];
      const detailText = d.map(x => `${x.payment_channel || '—'}${x.payment_format ? ` (${x.payment_format})` : ''}${x.reference ? ` · ${x.reference}` : ''}`).join(' · ') || '—';
      rows.push(`
        <tr>
          <td><span class="ds-bill-no">${b.bill_no}</span></td>
          <td>${b.member_code || ''} · ${(b.member_name || '').slice(0, 28)}</td>
          <td class="ds-num">${fmt(b.amount)}</td>
          <td class="ds-num">${fmt(b.cash)}</td>
          <td class="ds-num">${fmt(b.transfer)}</td>
          <td class="ds-num">${fmt(b.credit_card)}</td>
          <td class="ds-num">${fmt(b.gift_voucher)}</td>
          <td style="font-size:11px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${detailText}">${detailText}</td>
          <td>${b.branch || '—'}</td>
          <td>${b.channel || '—'}</td>
        </tr>
      `);
    }
    body.innerHTML = rows.join('');
    $('dsTupCount').textContent = bills.length;
    $('dsTupAmount').textContent = fmt(sumAmount);
    $('dsTopupSummary').style.display = 'flex';
  } catch (e) {
    body.innerHTML = `<tr><td colspan="10" class="ds-table-empty">❌ ${e.message}</td></tr>`;
  }
}

/* ============================================================
   TAB: Reconcile
   ============================================================ */
async function loadReconcile() {
  const branch = state.branch || 'BKK01';
  try {
    const rows = await sbGet(
      `daily_sale_reconcile?reconcile_date=eq.${state.date}&branch=eq.${branch}&limit=1`
    );
    const r = rows?.[0];
    if (r) {
      $('dsRecBillCount').value = r.bill_count || 0;
      $('dsRecBillValue').value = r.bill_value || 0;
      $('dsRecRemaining').value = r.remaining || 0;
      $('dsRecSystemCount').value = r.system_count || 0;
      $('dsRecSystemValue').value = r.system_value || 0;
      $('dsRecSignature').value = r.signature || '';
      $('dsRecNotes').value = r.notes || '';
      _renderRecDiff(r.diff_count, r.diff_value);
    } else {
      await dsRecPrefill();    // no record yet — prefill from ERP
    }
  } catch (e) {
    console.error('Reconcile load failed:', e);
  }
}

async function dsRecPrefill() {
  const branch = state.branch || 'BKK01';
  try {
    const rows = await sbGet(
      `daily_sale_summary?sale_date=eq.${state.date}&branch=eq.${branch}`
    );
    const r = rows?.[0];
    const count = r?.bill_count || 0;
    const amount = Number(r?.total_amount || 0);

    $('dsRecBillCount').value = count;
    $('dsRecBillValue').value = amount;
    $('dsRecRemaining').value = amount;
    $('dsRecSystemCount').value = count;
    $('dsRecSystemValue').value = amount;
    _renderRecDiff(0, 0);
    toast('Prefill จาก ERP แล้ว', 'info');
  } catch (e) {
    toast('Prefill ล้มเหลว: ' + e.message, 'error');
  }
}

function _renderRecDiff(diffCount, diffValue) {
  const el = $('dsRecDiff');
  const dc = Number(diffCount || 0);
  const dv = Number(diffValue || 0);
  if (dc === 0 && dv === 0) {
    el.className = 'ds-rec-diff ok';
    el.textContent = '✓ ตรงกับระบบทุกช่อง';
  } else {
    el.className = 'ds-rec-diff diff';
    el.innerHTML = `⚠️ ผลต่าง — จำนวน: <b>${dc}</b> · มูลค่า: <b>${fmt(dv)} THB</b>`;
  }
}

async function dsRecSave() {
  const branch = state.branch || 'BKK01';
  const record = {
    reconcile_date: state.date,
    branch,
    bill_count: parseInt($('dsRecBillCount').value || '0', 10),
    bill_value: parseFloat($('dsRecBillValue').value || '0'),
    remaining: parseFloat($('dsRecRemaining').value || '0'),
    system_count: parseInt($('dsRecSystemCount').value || '0', 10),
    system_value: parseFloat($('dsRecSystemValue').value || '0'),
    signature: $('dsRecSignature').value.trim(),
    notes: $('dsRecNotes').value.trim(),
    created_by: window.ERP_USER?.user_id || 'unknown',
    updated_at: new Date().toISOString(),
  };

  showLoading(true);
  try {
    await sbPost('daily_sale_reconcile?on_conflict=reconcile_date,branch', [record], 'resolution=merge-duplicates,return=minimal');
    toast('บันทึกตรวจบิลสำเร็จ', 'success');
    await loadReconcile();
    await loadReconcileList();
  } catch (e) {
    toast('บันทึกล้มเหลว: ' + e.message, 'error');
  }
  showLoading(false);
}

async function loadReconcileList() {
  const el = $('dsRecList');
  el.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text3);grid-column:1/-1">กำลังโหลด...</div>`;
  try {
    const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const rows = await sbGet(
      `daily_sale_reconcile?reconcile_date=gte.${since}&order=reconcile_date.desc&limit=30`
    );
    if (!rows.length) {
      el.innerHTML = `<div style="text-align:center;padding:30px;color:var(--text3);grid-column:1/-1">ยังไม่มีประวัติการตรวจบิล</div>`;
      return;
    }
    el.innerHTML = rows.map(r => `
      <div class="ds-rec-card-item" onclick="dsRecOpen('${r.reconcile_date}','${r.branch}')">
        <div class="ds-rec-card-head">
          <div class="ds-rec-card-date">${fmtDMY(r.reconcile_date)} · ${r.branch}</div>
          <div class="ds-rec-card-sig">${r.signature || '—'}</div>
        </div>
        <div class="ds-rec-card-stats">
          <span>📄 <b>${r.bill_count || 0}</b></span>
          <span>💰 <b>${fmt(r.bill_value)}</b></span>
          ${r.diff_value && Number(r.diff_value) !== 0
            ? `<span style="color:#dc2626">⚠ <b>Δ ${fmt(r.diff_value)}</b></span>`
            : `<span style="color:#059669">✓ ตรง</span>`}
        </div>
      </div>
    `).join('');
  } catch (e) {
    el.innerHTML = `<div style="text-align:center;padding:30px;color:#dc2626;grid-column:1/-1">❌ ${e.message}</div>`;
  }
}

function dsRecOpen(date, branch) {
  state.date = date;
  state.branch = branch;
  $('dsDate').value = date;
  $('dsBranch').value = branch;
  loadAll();
}

/* ============================================================
   TAB SWITCH
   ============================================================ */
function dsSwitchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.page-tab[data-tab]').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  $('dsPanelPending').style.display = tab === 'pending' ? '' : 'none';
  $('dsPanelSale').style.display = tab === 'sale' ? '' : 'none';
  $('dsPanelTopup').style.display = tab === 'topup' ? '' : 'none';
  $('dsPanelReconcile').style.display = tab === 'reconcile' ? '' : 'none';
}

function dsShiftDate(delta) {
  const d = new Date(state.date);
  d.setDate(d.getDate() + delta);
  if (delta === 0) state.date = new Date().toISOString().slice(0, 10);
  else state.date = d.toISOString().slice(0, 10);
  $('dsDate').value = state.date;
  loadAll();
}

/* ============================================================
   SYNC NOW — trigger GitHub workflow
   ============================================================ */
async function dsSyncNow() {
  const c = state.config;
  if (!c?.github_owner || !c?.github_repo || !c?.github_pat_encrypted) {
    toast('ต้องตั้งค่า GitHub Integration ก่อน (ไปที่ Web Automation)', 'error');
    return;
  }
  if (!window.ERPCrypto || !ERPCrypto.hasMasterKey()) {
    toast('ต้องตั้ง Master Key ก่อน', 'error');
    return;
  }

  const ok = await dsConfirm('สั่ง GitHub Actions sync Daily Sale ตอนนี้?', {
    title: 'ยืนยันการ Sync',
    icon: '🔄',
  });
  if (!ok) return;

  showLoading(true);
  try {
    const pat = await ERPCrypto.decrypt(c.github_pat_encrypted);
    if (!pat) throw new Error('decrypt PAT failed');

    const ghUrl = `https://api.github.com/repos/${c.github_owner}/${c.github_repo}/actions/workflows/${WORKFLOW}/dispatches`;
    const res = await fetch(ghUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${pat}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      // force:true → manual "Sync Now" always runs, bypassing the schedule/pause
      // gate in gateScheduledRun (a user click is an explicit "run now" intent).
      body: JSON.stringify({ ref: c.github_branch || 'main', inputs: { force: 'true' } }),
    });
    if (res.status !== 204) throw new Error(`GitHub API ${res.status}: ${(await res.text()).slice(0, 150)}`);

    showLoading(false);
    _openSyncModal(pat);
  } catch (e) {
    showLoading(false);
    toast('ไม่สำเร็จ: ' + e.message, 'error');
  }
}

/* ── Simple progress modal with polling ── */
let _pollTimer = null;
let _startMs = 0;

function _openSyncModal(pat) {
  $('spOverlay').style.display = 'flex';
  $('spLog').innerHTML = '';
  $('spStatus').textContent = 'queued';
  _startMs = Date.now();
  _spLog('🚀 Dispatched to GitHub Actions', 'ok');
  _pollRun(pat);
}

function dsCloseSyncProgress() {
  $('spOverlay').style.display = 'none';
  if (_pollTimer) clearTimeout(_pollTimer);
  loadAll();
}

function _spLog(msg, type = '') {
  const el = $('spLog');
  const ts = new Date().toTimeString().slice(0, 8);
  const color = type === 'ok' ? '#4ade80' : type === 'err' ? '#f87171' : '#e2e8f0';
  el.innerHTML += `<div><span style="color:#64748b;margin-right:6px">${ts}</span><span style="color:${color}">${msg}</span></div>`;
  el.scrollTop = el.scrollHeight;
}

async function _pollRun(pat) {
  const c = state.config;
  const elapsed = Math.floor((Date.now() - _startMs) / 1000);
  $('spElapsed').textContent = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed/60)}m ${elapsed%60}s`;

  try {
    const url = `https://api.github.com/repos/${c.github_owner}/${c.github_repo}/actions/runs?per_page=5&branch=${encodeURIComponent(c.github_branch || 'main')}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${pat}`, 'X-GitHub-Api-Version': '2022-11-28' },
    });
    const data = await res.json();
    const run = (data.workflow_runs || []).find(r =>
      r.event === 'workflow_dispatch' && Date.parse(r.created_at) >= _startMs - 15000 && r.name === 'Sync Daily Sale CS'
    );
    if (run) {
      $('spGhLink').href = run.html_url;
      $('spStatus').textContent = run.status;
      if (run.conclusion === 'success') {
        _spLog('✅ Sync สำเร็จ', 'ok');
        // ปิดวัน: tag บิลที่ business_date = NULL ให้เป็นวันนี้
        try {
          const closed = await sbPost('rpc/daily_sale_close_day', { p_date: todayIso() });
          const r = Array.isArray(closed) ? closed[0] : closed;
          if (r && (r.bills_closed || r.topup_closed)) {
            _spLog(`🔒 ปิดวัน: ${r.bills_closed} bills + ${r.topup_closed} topup`, 'ok');
          }
        } catch (e) {
          _spLog(`⚠️ close_day error: ${e.message}`, 'err');
        }
        return;
      }
      if (run.conclusion === 'failure') { _spLog('❌ Sync ล้มเหลว', 'err'); return; }
      if (run.status === 'completed' && run.conclusion) {
        _spLog(`Run ended: ${run.conclusion}`, run.conclusion === 'success' ? 'ok' : 'err');
        return;
      }
    }
  } catch (e) {
    _spLog(`poll error: ${e.message}`, 'err');
  }
  _pollTimer = setTimeout(() => _pollRun(pat), 8000);
}

/* ============================================================
   EXPOSE + INIT
   ============================================================ */
window.dsSwitchTab = dsSwitchTab;
window.dsShiftDate = dsShiftDate;
window.dsSyncNow = dsSyncNow;
window.dsCloseSyncProgress = dsCloseSyncProgress;
window.dsRecPrefill = dsRecPrefill;
window.dsRecSave = dsRecSave;
window.dsRecOpen = dsRecOpen;
window.dsConfirmResolve = dsConfirmResolve;
window.dsToggleBranch = dsToggleBranch;
window.dsEditOpen = dsEditOpen;
window.dsEditClose = dsEditClose;
window.dsEditRecalc = dsEditRecalc;
window.dsEditSave = dsEditSave;

document.addEventListener('DOMContentLoaded', init);
