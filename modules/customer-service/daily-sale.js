/* ============================================================
   daily-sale.js — Daily Sale CS module
   Data: daily_sale_bills + _payments + _topup_bills + _topup_details + _reconcile
   Sync trigger: GitHub Actions workflow_dispatch (ใช้ sync_config เดียวกับ members-sync)
   ============================================================ */

const SB_URL = localStorage.getItem('sb_url') || '';
const SB_KEY = localStorage.getItem('sb_key') || '';
const WORKFLOW = 'sync-daily-sale.yml';

let state = {
  date: todayIso(),
  branch: '',
  tab: 'sale',
  branches: [],
  config: null,
  sale: {},   // bill_no → { bill, payment } cache shared by sale + pending tabs
  branchChecks: {},  // (legacy — เปลี่ยนเป็น branchGroup radio แล้ว)
  branchGroup: 'BKK',  // radio default = BKK (ALL / BKK / HY / KK)
  saleChecked: new Set(),  // bill_no ที่ติ๊กไว้ (multi-select ลบ)
};

// วันที่ปัจจุบันตามเวลาไทย (Asia/Bangkok) — กัน UTC ทำให้ช่วงตี 0–7 โมงยังเป็นเมื่อวาน
function todayIso() { return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }); }
// เลื่อนวันจาก YYYY-MM-DD ไป n วัน (คำนวณ date-only แบบ UTC ไม่เพี้ยนข้าม TZ)
function isoShift(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

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
// ตัด boilerplate จาก import DATA_CS ออกจากช่องหมายเหตุ (ไม่ให้โชว์)
function dsCleanNote(s) { const t = String(s || ''); return /DATA_CS historical import/i.test(t) ? '' : t; }
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
async function sbDelete(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: 'return=minimal' },
  });
  if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}: ${(await res.text()).slice(0, 150)}`);
}
async function sbPatch(path, body) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path} → ${res.status}: ${(await res.text()).slice(0, 150)}`);
}

/* ============================================================
   LOAD — initial
   ============================================================ */
async function init() {
  $('dsDate').value = state.date;
  $('dsDate').addEventListener('change', (e) => { state.date = e.target.value; loadAll(); });

  try {
    const rows = await sbGet('sync_config?id=eq.1&limit=1');
    state.config = rows?.[0] || null;
  } catch {}

  try {
    const branches = await sbGet('branches?active=eq.true&order=display_order,branch_code');
    state.branches = branches || [];
    const sel = $('dsBranch');   // dropdown ถูกลบแล้ว (ใช้ radio กลุ่มสาขาแทน) — guard เผื่อ
    if (sel) branches.forEach(b => {
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

// ไฮไลต์ปุ่มวันนี้/เมื่อวานตามวันที่ที่เลือกจริง
function dsSyncDateChips() {
  const yest = isoShift(todayIso(), -1);
  const t = $('dsChipToday'), y = $('dsChipYesterday');
  if (t) t.classList.toggle('active', state.date === todayIso());
  if (y) y.classList.toggle('active', state.date === yest);
}

async function loadAll() {
  dsSyncDateChips();
  await Promise.all([loadKPI(), loadSale(), loadOnline(), loadReconcile()]);
}

/* ============================================================
   KPI (hero)
   ============================================================ */
async function loadKPI() {
  try {
    const group = state.branchGroup || 'ALL';
    if ($('dsKpiGroupLbl')) $('dsKpiGroupLbl').textContent = group === 'ALL' ? 'ทั้งหมด' : group;
    // report ตามกลุ่มสาขาที่เลือก · บิลวันนี้/ยอดขาย = DAILY SALE (ไม่รวม ARP/ewallet) · ARP/Ewallet = จำนวนรายการ
    const bills = await sbGet(`daily_sale_bills?${dateFilter()}&select=amount,bill_type,bill_no,branch,receive_branch&limit=8000`);
    let count = 0, amount = 0, arp = 0, ew = 0;
    bills.forEach(b => {
      if (group !== 'ALL' && branchGroupOf(b) !== group) return;
      if (isEwallet(b)) { ew++; return; }
      if (isRedemption(b)) { arp++; return; }
      count++; amount += Number(b.amount || 0);
    });
    $('dsKpiBills').textContent = count;
    $('dsKpiAmount').textContent = fmt(amount);
    $('dsKpiArp').textContent = arp;
    $('dsKpiEwallet').textContent = ew;
    $('dsKpiDate').textContent = fmtDMY(state.date);
  } catch (e) {
    console.error('KPI load failed:', e);
  }

  try {
    const logs = await sbGet(`sync_log?source=eq.daily_sale&order=started_at.desc&limit=1`);
    const r = logs?.[0];
    $('dsHeroStatus').textContent = r?.started_at ? `Sync ล่าสุด · ${r.status}` : 'ยังไม่เคย sync';
    if (r?.started_at) {
      // ข้อมูลวันที่ = วัน+เวลาที่ sync ล่าสุด (Asia/Bangkok)
      const time = new Date(r.started_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
      $('dsKpiDate').textContent = `${fmtDMY(r.started_at)} ${time}`;
    }
  } catch {}

  // สถานะ auto-sync (ดึงจริงจาก automation_tasks · ไม่ hardcode)
  try {
    const el = $('dsAutoStatus');
    if (el) {
      const SCHED = { manual: 'Manual', '1h': 'ทุก 1 ชม.', '3h': 'ทุก 3 ชม.', '6h': 'ทุก 6 ชม.', '12h': 'ทุก 12 ชม.', '24h': 'ทุกวัน', weekly: 'ทุกสัปดาห์' };
      const rows = await sbGet(`automation_tasks?workflow=eq.sync-daily-sale.yml&select=status,schedule&limit=1`);
      const t = rows?.[0];
      if (!t) el.textContent = '';
      else if (t.status === 'active') el.textContent = ` · 🟢 auto ${SCHED[t.schedule] || t.schedule || ''}`.trimEnd();
      else el.textContent = ' · ⚪ auto ปิด (ดึงเอง)';
    }
  } catch {}

  // สถานะปิดรอบของวันนี้
  try {
    const el = $('dsCloseStatus');
    if (el) {
      const rows = await sbGet(`daily_sale_day_close?close_date=eq.${todayIso()}&select=closed_at&limit=1`);
      if (rows?.[0]?.closed_at) {
        const t = new Date(rows[0].closed_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
        el.textContent = `· 🔒 ปิดรอบแล้ว ${t}`;
      } else { el.textContent = ''; }
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
// สาขาสำหรับ checkbox filter = กลุ่มสาขา (BKK / HY / KK)
function branchKey(b) { return branchGroupOf(b); }
function renderBranchChecks(keys) {
  const el = $('dsBranchChecks');
  if (!el) return;
  const opts = ['ALL', ...Object.keys(DS_BRANCH_GROUPS)];
  el.innerHTML = opts.map(g => {
    const on = (state.branchGroup || 'ALL') === g;
    const label = g === 'ALL' ? 'ทั้งหมด' : g;
    const tip = g === 'ALL' ? 'ทุกกลุ่ม' : (DS_BRANCH_GROUPS[g] || []).join(', ') || '(ยังไม่กำหนดสาขา)';
    return `<label class="ds-branch-chip${on ? ' on' : ''}" title="${tip}"><input type="radio" name="dsBranchGrp" ${on ? 'checked' : ''} onchange="dsSelectBranch('${g}')">${label}</label>`;
  }).join('') + `<button type="button" class="ds-grp-edit" title="แก้ไขกลุ่มสาขา" onclick="dsGroupOpen()">⚙️</button>`;
}
function dsSelectBranch(g) { state.branchGroup = g; loadKPI(); loadSale(); if (state.tab === 'online') loadOnline(); if (state.tab === 'reconcile') loadReconcile(); }

// แก้ไขกลุ่มสาขา (เก็บ localStorage)
function dsGroupOpen() {
  const ov = $('dsGroupOverlay');
  if (!ov) { toast('ไม่พบหน้าต่างแก้ไข — refresh หน้า (Ctrl+Shift+R)', 'error'); return; }
  ['BKK', 'HY', 'KK'].forEach(g => { const el = $('dsGrp' + g); if (el) el.value = (DS_BRANCH_GROUPS[g] || []).join(', '); });
  ov.classList.add('open');
}
function dsGroupClose() { $('dsGroupOverlay').classList.remove('open'); }
function dsGroupSave() {
  const parse = id => ($(id).value || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  DS_BRANCH_GROUPS = { BKK: parse('dsGrpBKK'), HY: parse('dsGrpHY'), KK: parse('dsGrpKK') };
  localStorage.setItem('ds_branch_groups', JSON.stringify(DS_BRANCH_GROUPS));
  dsGroupClose();
  toast('บันทึกกลุ่มสาขาแล้ว', 'success');
  loadSale();
}

// 3 ตารางตาม Google Sheet DailySaleCS — logic ตรงสูตร QUERY ของชีท
//   คอลัมน์จ่ายเงินเหมือนกันหมด ต่างแค่ label 3 ช่องท้าย + branch scope + ประเภทบิล
//   branches = สาขาที่นับเข้าตารางนั้น (สูตร: สาขารับ IN ... · ewallet ใช้ สาขา)
const DS_TABLES = [
  // tail = คอลัมน์ท้าย payment ที่ต่างกันต่อตาราง (Daily Sale ตัด หักค่าคอม/ARP ออก เหลือ QR)
  { key: 'sale',    title: '💰 Daily Sale',                                    branches: ['BKK01', 'NB', 'BUR'],
    tail: [{ label: 'QR Paymet', field: 'qr_payment', col: 'ds-col-qr' }] },
  { key: 'arp',     title: '🎁 แลกสินค้า ARP (POINT) · ARP EASY · ABB Online', branches: ['BKK01', 'NB', 'DP'], noFixed: true,  // redemption: ไม่มี Cash/Credit/Transfer/EW/Gift
    tail: [{ label: 'ARP (POINT)', field: 'qr_payment', col: 'ds-col-qr' }, { label: 'ARP EASY', field: 'commission_deduct', col: 'ds-col-comm' }, { label: 'ABB Online', field: 'arp_amount', col: 'ds-col-arp' }] },
  { key: 'ewallet', title: '👛 E-WALLET (THB)',                                branches: ['BKK01', 'BUR'], hideFixed: ['cash'],
    tail: [{ label: 'QR Paymet', field: 'qr_payment', col: 'ds-col-qr' }, { label: 'โอนค่าคอมเข้า E/W', field: 'commission_deduct', col: 'ds-col-comm' }, { label: 'ARP', field: 'arp_amount', col: 'ds-col-arp' }] },
];
const DS_TABLE_BY_KEY = Object.fromEntries(DS_TABLES.map(c => [c.key, c]));

// บล็อกผู้รับผิดชอบท้ายตารางบิลขาย (ตามชีท) — เก็บที่ daily_sale_reconcile.signoff (JSONB)
const DS_SIGNOFF_ROLES = [
  { key: 'bill_sorter',     label: 'ผู้เรียงบิล' },
  { key: 'online_summary',  label: 'ผู้สรุปยอด บิลออนไลน์' },
  { key: 'data_puller',     label: 'ผู้ดึงยอด' },
  { key: 'daily_entry',     label: 'ผู้หยอดบิลลงเดลี่' },
  { key: 'daily_print',     label: 'ผู้ปริ้นเดลี่ ประกบบิลขาย' },
  { key: 'final_check',     label: 'ผู้ตรวจสอบความเรียบร้อยก่อนส่งบัญชี' },
  { key: 'ewallet_summary', label: 'ผู้สรุปยอด E-WALLET' },
];
const DS_FIXED_FIELDS = ['cash', 'front_office', 'online', 'kbank', 'ktb', 'ewallet', 'gift_voucher'];  // payment cols ที่ทุกตารางมีเหมือนกัน

// dropdown "หมายเหตุ" ของบิลออนไลน์ (ค่าคงที่ตามชีท) + สีชิป · เก็บที่ daily_sale_bills.delivery_note (sync ไม่แตะ)
const DS_DELIVERY_OPTS = ['จัดส่ง กทม.', 'รับเอง กทม.', 'จัดส่ง DP', 'รับเอง DP', 'เรียกแกร็ป'];
const DS_DELIVERY_COLOR = { 'จัดส่ง กทม.': '#e9d5ff', 'รับเอง กทม.': '#f3e8ff', 'จัดส่ง DP': '#dbeafe', 'รับเอง DP': '#cffafe', 'เรียกแกร็ป': '#dcfce7' };

// สาขารับ: sync มี receive_branch · import เก่า/online = null → fallback branch → BKK01 (รับที่ HQ)
function recvBranch(b) { return (b.receive_branch || b.branch || 'BKK01').toUpperCase(); }

// กลุ่มสาขาสำหรับ filter (3 กลุ่ม · แก้ไขได้ · เก็บใน localStorage) · default = จากสูตร Google Sheet
function dsDefaultGroups() { return { BKK: ['BKK01', 'NB', 'BUR', 'DP'], HY: ['HY'], KK: ['KK'] }; }
function dsLoadGroups() {
  try { const s = JSON.parse(localStorage.getItem('ds_branch_groups')); if (s && typeof s === 'object' && Object.keys(s).length) return s; } catch {}
  return dsDefaultGroups();
}
let DS_BRANCH_GROUPS = dsLoadGroups();
function branchGroupOf(b) {
  const code = recvBranch(b);
  for (const g in DS_BRANCH_GROUPS) if (DS_BRANCH_GROUPS[g].includes(code)) return g;
  return 'BKK';   // สาขาอื่น/ไม่ทราบ → นับเป็น BKK
}
// ประเภทบิล 'แลกสินค้า' (sync) หรือ bill_type 'ARP' (import เก่า)
function isRedemption(b) { const t = (b.bill_type || '').trim(); return t === 'แลกสินค้า' || t.toUpperCase() === 'ARP'; }
// บิลเติมเงิน ewallet: bill_type EWALLET (import) หรือ prefix ETH
function isEwallet(b) { const t = (b.bill_type || '').toUpperCase(); return t === 'EWALLET' || String(b.bill_no || '').toUpperCase().startsWith('ETH'); }

// จัดบิลเข้าตาราง (ตามสูตร: ewallet ก่อน → แลกสินค้า=ARP → ที่เหลือ=ขายปกติ)
function billGroup(b) {
  if (isEwallet(b)) return 'ewallet';
  if (isRedemption(b)) return 'arp';
  return 'sale';
}
// เข้าเงื่อนไขตารางไหม (amount≠0 สำหรับ sale/arp ตามสูตร · branch คุมด้วย group checkbox แทน)
function inScope(b, cfg) {
  if (cfg.key !== 'ewallet' && Number(b.amount || 0) === 0) return false;
  return true;
}

function saleTableShell(cfg, canEdit) {
  const nf = !!cfg.noFixed;                           // noFixed = ตัด Cash/Credit/Transfer/EW/Gift (เช่น ARP redemption)
  const hide = new Set(cfg.hideFixed || []);          // ซ่อน fixed column แบบเจาะจง (cash/ewallet/gift_voucher)
  const hidden = ['cash', 'ewallet', 'gift_voucher'].filter(f => hide.has(f)).length;
  const rs = nf ? 2 : 3;                              // จำนวนแถว header (2 ถ้าไม่มี fixed)
  const payCount = (nf ? 0 : 7 - hidden) + cfg.tail.length;   // Cash + CreditCard(2) + Transfer(2) + EW + Gift + tail
  const totalCols = 10 + payCount + (canEdit ? 1 : 0);   // + checkbox col
  const tailTh = cfg.tail.map(t => `<th${nf ? '' : ' rowspan="2"'} class="ds-num ${t.col}">${t.label}</th>`).join('');
  const chkTh = canEdit ? `<th rowspan="${rs}" class="ds-chk-col"><input type="checkbox" class="ds-chk-all" title="เลือกทั้งหมด" onclick="dsToggleAll('${cfg.key}',this)"></th>` : '';
  // แถว header ของ fixed columns (เว้นถ้า noFixed · ซ่อนเฉพาะที่ hideFixed)
  const fixedR2 = nf ? '' : `
            ${hide.has('cash') ? '' : '<th rowspan="2" class="ds-num ds-col-cash">Cash</th>'}
            <th colspan="2" class="ds-grp ds-col-cc">Credit Card</th>
            <th colspan="2" class="ds-grp ds-col-tf">Tranfer Money</th>
            ${hide.has('ewallet') ? '' : '<th rowspan="2" class="ds-num ds-col-ew">E-WALLET</th>'}
            ${hide.has('gift_voucher') ? '' : '<th rowspan="2" class="ds-num ds-col-gift">Gift Voucher</th>'}`;
  const fixedR3 = nf ? '' : `
          <tr>
            <th class="ds-num ds-col-cc">Front Office</th>
            <th class="ds-num ds-col-cc">Online</th>
            <th class="ds-num ds-col-tf">KBANK</th>
            <th class="ds-num ds-col-tf">KTB</th>
          </tr>`;
  return `
  <div class="ds-table-wrap ds-sale-block">
    <div class="ds-table-title ds-title-${cfg.key}">${cfg.title}</div>
    <div style="overflow-x:auto">
      <table class="ds-table ds-table-sheet">
        <thead>
          <tr>
            ${chkTh}
            <th rowspan="${rs}" class="ds-hd-id">NO</th>
            <th rowspan="${rs}" class="ds-hd-id">วันที่</th>
            <th rowspan="${rs}" class="ds-hd-id">เลขออเดอร์</th>
            <th rowspan="${rs}" class="ds-hd-id">รหัส</th>
            <th rowspan="${rs}" class="ds-hd-id">Name</th>
            <th colspan="${payCount}" class="ds-grp ds-grp-pay">Payment (THB)</th>
            <th rowspan="${rs}" class="ds-num ds-hd-sys">ยอดในระบบ</th>
            <th rowspan="${rs}" class="ds-num ds-hd-sys">ผลต่าง</th>
            <th rowspan="${rs}" class="ds-hd-meta">ผู้บันทึก</th>
            <th rowspan="${rs}" class="ds-hd-meta">หมายเหตุเพิ่มเติม</th>
            <th rowspan="${rs}" class="ds-hd-meta"></th>
          </tr>
          <tr>
            ${fixedR2}
            ${tailTh}
          </tr>
          ${fixedR3}
        </thead>
        <tbody id="dsBody_${cfg.key}"><tr><td colspan="${totalCols}" class="ds-table-empty">กำลังโหลด...</td></tr></tbody>
        <tfoot id="dsFoot_${cfg.key}"></tfoot>
      </table>
    </div>
  </div>`;
}

function fillSaleTable(cfg, list, pMap, canEdit) {
  const key = cfg.key;
  const nf = !!cfg.noFixed;
  const hide = new Set(cfg.hideFixed || []);
  const hidden = ['cash', 'ewallet', 'gift_voucher'].filter(f => hide.has(f)).length;
  const fields = (nf ? [] : DS_FIXED_FIELDS.filter(f => !hide.has(f))).concat(cfg.tail.map(t => t.field));   // คอลัมน์ payment ของตารางนี้
  const totalCols = 10 + (nf ? 0 : 7 - hidden) + cfg.tail.length + (canEdit ? 1 : 0);
  const body = $(`dsBody_${key}`), foot = $(`dsFoot_${key}`);
  if (!body) return;
  if (!list.length) {
    body.innerHTML = `<tr><td colspan="${totalCols}" class="ds-table-empty">ไม่มีข้อมูล</td></tr>`;
    if (foot) foot.innerHTML = '';
    return;
  }
  const rows = [];
  let sumAmount = 0, sumDiff = 0;
  const tot = {}; fields.forEach(f => { tot[f] = 0; });

  list.forEach((b, i) => {
    const p = pMap[b.bill_no] || {};
    state.sale[b.bill_no] = { bill: b, payment: p };
    const amount = Number(b.amount || 0);
    const diff = fields.reduce((s, f) => s + Number(p[f] || 0), 0) - amount;
    sumAmount += amount;
    sumDiff += diff;
    fields.forEach(f => { tot[f] += Number(p[f] || 0); });

    const delBtn = canEdit
      ? `<button class="ds-del-btn" title="ลบบิลนี้" onclick="dsDeleteBill('${b.bill_no}')">🗑</button>` : '';
    const chkTd = canEdit
      ? `<td class="ds-chk-col"><input type="checkbox" class="ds-rowchk" data-bill="${b.bill_no}" ${state.saleChecked.has(b.bill_no) ? 'checked' : ''} onchange="dsToggleRow(this)"></td>` : '';
    const note = dsCleanNote(p.correction_notes || b.notes);
    const diffCls = Math.abs(diff) > 0.5 ? 'ds-num ds-diff-bad' : 'ds-num ds-diff-ok';
    // ผลต่าง ≠ 0 (บวก/ลบ) → ไฮไลต์ทั้งแถวสีแดง
    const rowClasses = [p.corrected ? 'ds-row-corrected' : '', Math.abs(diff) > 0.5 ? 'ds-row-diff' : ''].filter(Boolean).join(' ');
    // payment cell — คลิกแก้ inline ได้ (ถ้ามีสิทธิ์)
    const pc = (field, cls, val) => canEdit
      ? `<td class="ds-num ${cls} ds-editable" data-bill="${b.bill_no}" data-field="${field}" ondblclick="dsCellEdit(this)" title="ดับเบิลคลิกเพื่อแก้">${fmt0(val)}</td>`
      : `<td class="ds-num ${cls}">${fmt0(val)}</td>`;
    // note cell — คลิกแก้ข้อความได้
    const noteCell = canEdit
      ? `<td class="ds-editable ds-note-cell" data-bill="${b.bill_no}" data-field="correction_notes" data-type="text" ondblclick="dsCellEdit(this)" title="${escHtml(note) || 'ดับเบิลคลิกเพื่อแก้'}">${escHtml(note.slice(0, 40))}</td>`
      : `<td style="font-size:11.5px">${escHtml(note.slice(0, 40))}</td>`;

    rows.push(`
      <tr${rowClasses ? ` class="${rowClasses}"` : ''}>
        ${chkTd}
        <td class="ds-num">${i + 1}</td>
        <td>${fmtDMY(b.sale_date)}</td>
        <td><span class="ds-bill-no">${b.bill_no}</span></td>
        <td>${b.member_code || ''}</td>
        <td>${(b.member_name || '').slice(0, 40)}</td>
        ${nf ? '' : `${hide.has('cash') ? '' : pc('cash', 'ds-col-cash', p.cash)}
        ${pc('front_office', 'ds-col-cc', p.front_office)}
        ${pc('online', 'ds-col-cc', p.online)}
        ${pc('kbank', 'ds-col-tf', p.kbank)}
        ${pc('ktb', 'ds-col-tf', p.ktb)}
        ${hide.has('ewallet') ? '' : pc('ewallet', 'ds-col-ew', p.ewallet)}
        ${hide.has('gift_voucher') ? '' : pc('gift_voucher', 'ds-col-gift', p.gift_voucher)}`}
        ${cfg.tail.map(t => pc(t.field, t.col, p[t.field])).join('')}
        <td class="ds-num">${fmt(amount)}</td>
        <td class="${diffCls}">${diff === 0 ? '-' : fmt(diff)}</td>
        <td>${b.recorded_by || ''}</td>
        ${noteCell}
        <td class="ds-edit-cell">${delBtn}</td>
      </tr>`);
  });
  body.innerHTML = rows.join('');

  const c = (cls, v) => `<td class="ds-num ${cls}">${fmt(v)}</td>`;
  const tailTot = cfg.tail.map(t => c(t.col, tot[t.field])).join('');
  const fixedTot = nf ? '' : `${hide.has('cash') ? '' : c('ds-col-cash', tot.cash)}${c('ds-col-cc', tot.front_office)}${c('ds-col-cc', tot.online)}${c('ds-col-tf', tot.kbank)}${c('ds-col-tf', tot.ktb)}${hide.has('ewallet') ? '' : c('ds-col-ew', tot.ewallet)}${hide.has('gift_voucher') ? '' : c('ds-col-gift', tot.gift_voucher)}`;
  foot.innerHTML = `<tr class="ds-foot-total">
    <td colspan="${5 + (canEdit ? 1 : 0)}" style="text-align:right">รวม (${list.length})</td>
    ${fixedTot}${tailTot}
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
  if (wrap && !$('dsBody_sale')) wrap.innerHTML = DS_TABLES.map(cfg => saleTableShell(cfg, canEdit)).join('');
  try {
    const branchFilter = state.branch ? `&branch=eq.${state.branch}` : '';
    const bills = await sbGet(`daily_sale_bills?${dateFilter()}${branchFilter}&limit=3000`);
    bills.sort(saleSort);   // BKK ก่อน ONLIN · วันที่เก่าก่อน (client-side)

    // กรองตาม scope ของสูตร (branch + amount≠0) ก่อน → HY/KK/นอก scope ตกไปเอง
    const scoped = bills.filter(b => inScope(b, DS_TABLE_BY_KEY[billGroup(b)]));

    // Branch radio filter (ทั้งหมด / BKK / HY / KK)
    renderBranchChecks();
    const grp = state.branchGroup || 'ALL';
    const visible = scoped.filter(b => grp === 'ALL' || branchGroupOf(b) === grp);

    const pMap = visible.length ? await fetchPaymentsMap(visible.map(b => b.bill_no)) : {};

    const groups = { sale: [], arp: [], ewallet: [] };
    visible.forEach(b => groups[billGroup(b)].push(b));
    DS_TABLES.forEach(cfg => fillSaleTable(cfg, groups[cfg.key], pMap, canEdit));
    // ล้าง selection ของบิลที่ไม่แสดงแล้ว + refresh bulk bar
    const vis = new Set(visible.map(b => b.bill_no));
    [...state.saleChecked].forEach(bn => { if (!vis.has(bn)) state.saleChecked.delete(bn); });
    dsUpdateBulk();
    loadSignoff();   // บล็อกผู้รับผิดชอบท้ายตาราง
  } catch (e) {
    if (wrap) wrap.innerHTML = `<div class="ds-table-empty">❌ ${e.message}</div>`;
  }
}

/* ── บล็อกผู้รับผิดชอบ + หมายเหตุพิเศษ (ท้ายตารางบิลขาย · เก็บ daily_sale_reconcile) ── */
async function loadSignoff() {
  const el = $('dsSignoffBlock');
  if (!el) return;
  await dsLoadSigOptions();
  try {
    const rows = await sbGet(`daily_sale_reconcile?reconcile_date=eq.${state.date}&branch=eq.${encodeURIComponent(recBranchKey())}&select=signoff,special_notes&limit=1`);
    const r = rows?.[0] || {};
    renderSignoff(r.signoff || {}, r.special_notes || '');
  } catch { renderSignoff({}, ''); }
}
function renderSignoff(signoff, notes) {
  const el = $('dsSignoffBlock');
  if (!el) return;
  const canEdit = window.hasPerm ? hasPerm('daily_sale_reconcile') : true;
  const optHtml = cur => {
    const list = (cur && !DS_SIG_OPTS.includes(cur)) ? [cur, ...DS_SIG_OPTS] : DS_SIG_OPTS;
    return `<option value=""></option>` + list.map(o => `<option${o === cur ? ' selected' : ''}>${escHtml(o)}</option>`).join('');
  };
  const roleRows = DS_SIGNOFF_ROLES.map(r => {
    const cur = signoff[r.key] || '';
    const field = canEdit
      ? `<select data-role="${r.key}" onchange="dsSignoffSave()">${optHtml(cur)}</select>`
      : `<span class="ds-signoff-val">${escHtml(cur) || '—'}</span>`;
    return `<div class="ds-signoff-row"><label>${r.label}</label>${field}</div>`;
  }).join('');
  const notesField = canEdit
    ? `<textarea id="dsSignoffNotes" rows="7" onchange="dsSignoffSave()" placeholder="—">${escHtml(notes || '')}</textarea>`
    : `<div class="ds-signoff-noteview">${escHtml(notes || '—')}</div>`;
  el.innerHTML = `
    <div class="ds-signoff-grid">
      <div class="ds-signoff-roles">${roleRows}</div>
      <div class="ds-signoff-notes"><label>หมายเหตุ รายการพิเศษในวันนี้</label>${notesField}</div>
    </div>`;
}
async function dsSignoffSave() {
  const signoff = {};
  document.querySelectorAll('#dsSignoffBlock select[data-role]').forEach(s => { if (s.value) signoff[s.dataset.role] = s.value; });
  const record = {
    reconcile_date: state.date, branch: recBranchKey(),
    signoff, special_notes: $('dsSignoffNotes')?.value.trim() || null,
    created_by: window.ERP_USER?.user_id || 'unknown', updated_at: new Date().toISOString(),
  };
  try {
    await sbPost('daily_sale_reconcile?on_conflict=reconcile_date,branch', [record], 'resolution=merge-duplicates,return=minimal');
    toast('บันทึกแล้ว', 'success');
  } catch (e) { toast('บันทึกไม่สำเร็จ: ' + e.message, 'error'); }
}

/* ── Export Excel (.xls) รูปแบบ + สี เหมือนชีท DailySaleCS (HTML-table → Excel) ── */
async function dsExportExcel() {
  const group = state.branchGroup || 'ALL';
  const groupLabel = group === 'ALL' ? 'ทั้งหมด' : group;
  showLoading(true);
  try {
    const bills = await sbGet(`daily_sale_bills?${dateFilter()}&limit=5000`);
    const scoped = bills.filter(b => group === 'ALL' || branchGroupOf(b) === group).sort(saleSort);
    const pMap = scoped.length ? await fetchPaymentsMap(scoped.map(b => b.bill_no)) : {};
    const groups = { sale: [], arp: [], ewallet: [] };
    scoped.forEach(b => groups[billGroup(b)].push(b));

    const PAY = ['cash', 'front_office', 'online', 'kbank', 'ktb', 'ewallet', 'gift_voucher', 'qr_payment', 'commission_deduct', 'arp_amount'];
    const BG = { cash: '#FFF6D5', cc: '#E3F3E5', tf: '#ECE4F7', ew: '#DEEBFB', gift: '#D9F5F1', qr: '#ECECEC', comm: '#FBE2EA', arp: '#E5E6FB', sys: '#FDE9C7' };
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const B = 'border:1px solid #b0b0b0;padding:3px 6px;font-size:11px;';
    const NF = "mso-number-format:'\\#\\,\\#\\#0';";
    const th = (t, span = '', bg = '#e8eef0') => `<td ${span} style="${B}background:${bg};font-weight:bold;text-align:center">${esc(t)}</td>`;
    const numC = (v, bg) => { const n = Number(v || 0); return `<td style="${B}${NF}background:${bg || '#fff'};text-align:right">${n === 0 ? '' : n}</td>`; };
    const txtC = (v, bg, align) => `<td style="${B}background:${bg || '#fff'};text-align:${align || 'left'}">${esc(v)}</td>`;

    let body = '';
    const section = (title, list, tail) => {
      body += `<tr><td colspan="19" style="${B}background:#d7ecdd;font-weight:bold;text-align:center;font-size:13px">${esc(title)}</td></tr>`;
      body += `<tr>${th('NO', 'rowspan="3"')}${th('วันที่', 'rowspan="3"')}${th('เลขออเดอร์', 'rowspan="3"')}${th('รหัส', 'rowspan="3"')}${th('Name', 'rowspan="3"')}${th('Payment (THB)', 'colspan="10"', '#f6dfe8')}${th('ยอดในระบบ', 'rowspan="3"', BG.sys)}${th('ผลต่าง', 'rowspan="3"', BG.sys)}${th('ผู้บันทึก', 'rowspan="3"')}${th('หมายเหตุเพิ่มเติม', 'rowspan="3"')}</tr>`;
      body += `<tr>${th('Cash', 'rowspan="2"', BG.cash)}${th('Credit Card', 'colspan="2"', BG.cc)}${th('Tranfer Money', 'colspan="2"', BG.tf)}${th('E-WALLET', 'rowspan="2"', BG.ew)}${th('gift voucher', 'rowspan="2"', BG.gift)}${th('qr paymet', 'rowspan="2"', BG.qr)}${th(tail[0], 'rowspan="2"', BG.comm)}${th(tail[1], 'rowspan="2"', BG.arp)}</tr>`;
      body += `<tr>${th('Front Office', '', BG.cc)}${th('Online', '', BG.cc)}${th('KBANK', '', BG.tf)}${th('KTB', '', BG.tf)}</tr>`;
      const tot = {}; PAY.forEach(f => tot[f] = 0); let sa = 0, sd = 0;
      list.forEach((b, i) => {
        const p = pMap[b.bill_no] || {};
        const amt = Number(b.amount || 0);
        const diff = PAY.reduce((s, f) => s + Number(p[f] || 0), 0) - amt;
        PAY.forEach(f => tot[f] += Number(p[f] || 0)); sa += amt; sd += diff;
        body += `<tr>${txtC(i + 1, '', 'center')}${txtC(fmtDMY(b.sale_date))}${txtC(b.bill_no)}${txtC(b.member_code || '')}${txtC(b.member_name || '')}`
          + numC(p.cash, BG.cash) + numC(p.front_office, BG.cc) + numC(p.online, BG.cc) + numC(p.kbank, BG.tf) + numC(p.ktb, BG.tf)
          + numC(p.ewallet, BG.ew) + numC(p.gift_voucher, BG.gift) + numC(p.qr_payment, BG.qr) + numC(p.commission_deduct, BG.comm) + numC(p.arp_amount, BG.arp)
          + numC(amt, BG.sys) + `<td style="${B}${NF}background:${BG.sys};text-align:right;color:${Math.abs(diff) > 0.5 ? '#c00;font-weight:bold' : '#000'}">${diff === 0 ? '' : diff}</td>`
          + txtC(b.recorded_by || '') + txtC(dsCleanNote(p.correction_notes || b.notes)) + `</tr>`;
      });
      const tc = (f, bg) => `<td style="${B}${NF}background:${bg};font-weight:bold;text-align:right">${tot[f] === 0 ? '' : tot[f]}</td>`;
      body += `<tr><td colspan="4" style="${B}background:#f3d9a6"></td><td style="${B}background:#f3d9a6;font-weight:bold;text-align:right">รวม (${list.length})</td>`
        + tc('cash', BG.cash) + tc('front_office', BG.cc) + tc('online', BG.cc) + tc('kbank', BG.tf) + tc('ktb', BG.tf)
        + tc('ewallet', BG.ew) + tc('gift_voucher', BG.gift) + tc('qr_payment', BG.qr) + tc('commission_deduct', BG.comm) + tc('arp_amount', BG.arp)
        + `<td style="${B}${NF}background:#f3d9a6;font-weight:bold;text-align:right">${sa}</td><td style="${B}${NF}background:#f3d9a6;font-weight:bold;text-align:right">${sd === 0 ? '' : sd}</td><td colspan="2" style="${B}background:#f3d9a6"></td></tr>`;
      // แถวสรุปรวมใหญ่ (merged cell ยอดรวมทั้ง section · span E–Q ตามชีท)
      body += `<tr><td colspan="4" style="border:none"></td><td colspan="13" style="${B}${NF}background:#f7e2b0;font-weight:bold;text-align:center;font-size:15px">${sa}</td><td colspan="2" style="border:none"></td></tr>`;
      body += `<tr><td colspan="19" style="height:8px;border:none"></td></tr>`;
    };

    section('DAILY SALE', groups.sale, ['หักค่าคอม', 'ARP']);
    section('แลก ARP (POINT) · ARP EASY · ABB ONLINE', groups.arp, ['ARP EASY', 'ARP (USD)']);
    section('E-WALLET (THB)', groups.ewallet, ['หักค่าคอม', '']);

    // บล็อกลงชื่อผู้รับผิดชอบ + หมายเหตุพิเศษ
    try {
      const rows = await sbGet(`daily_sale_reconcile?reconcile_date=eq.${state.date}&branch=eq.${encodeURIComponent(recBranchKey())}&select=signoff,special_notes&limit=1`);
      const r = rows?.[0] || {}; const so = r.signoff || {};
      body += `<tr><td colspan="19" style="height:10px;border:none"></td></tr>`;
      const N = DS_SIGNOFF_ROLES.length;
      DS_SIGNOFF_ROLES.forEach((role, i) => {
        let row = `<tr><td colspan="3" style="border:none"></td>`;
        row += `<td colspan="2" style="${B}background:#dbeef0;font-weight:bold;text-align:right">${esc(role.label)}</td>`;
        row += `<td colspan="2" style="${B}text-align:center;color:#7c3aed;font-weight:bold">${esc(so[role.key] || '')}</td>`;
        row += `<td colspan="1" style="border:none"></td>`;   // ช่องว่างคั่น
        if (i === 0) {
          // กล่องหมายเหตุอยู่ขวา · span ครอบทุกแถวลงชื่อ (เหมือนชีท)
          row += `<td colspan="11" rowspan="${N}" style="${B}vertical-align:top;color:#c00;font-weight:bold">หมายเหตุ รายการพิเศษในวันนี้<div style="color:#000;font-weight:normal;margin-top:8px;white-space:pre-wrap">${esc(r.special_notes || '')}</div></td>`;
        }
        row += `</tr>`;
        body += row;
      });
    } catch { /* ignore */ }

    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
<head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>DailySale</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head>
<body><table border="1" style="border-collapse:collapse;font-family:'TH Sarabun New',Tahoma,sans-serif">
<tr><td colspan="19" style="font-size:15px;font-weight:bold;padding:8px;background:#2f6b4f;color:#fff;text-align:center">DAILY SALE — วันที่ ${esc(fmtDMY(state.date))} · สาขา ${esc(groupLabel)}</td></tr>
${body}</table></body></html>`;

    const blob = new Blob(['﻿' + html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `DailySale_${state.date}_${groupLabel}.xls`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast('Export Excel แล้ว', 'success');
  } catch (e) {
    toast('Export ไม่สำเร็จ: ' + e.message, 'error');
  }
  showLoading(false);
}

/* ============================================================
   Export รายเดือน — 1 ไฟล์ หลาย tab (วันละ tab) · SpreadsheetML 2003 (สี+merge จริง)
   ============================================================ */
const _SS_COL = { white: '#FFFFFF', cash: '#FFF6D5', cc: '#E3F3E5', tf: '#ECE4F7', ew: '#DEEBFB', gift: '#D9F5F1', qr: '#ECECEC', comm: '#FBE2EA', arp: '#E5E6FB', sys: '#FDE9C7', total: '#F3D9A6', grand: '#F7E2B0', sec: '#D7ECDD', pay: '#F6DFE8', sign: '#DBEEF0', title: '#FFFF00' };
const _SS_BORD = '<Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B0B0B0"/><Border ss:Position="Left" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B0B0B0"/><Border ss:Position="Right" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B0B0B0"/><Border ss:Position="Top" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#B0B0B0"/></Borders>';
function _ssX(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function _ssStyles() {
  let s = '';
  const mk = (id, align, color, o = {}) => {
    s += `<Style ss:ID="${id}"><Alignment ss:Horizontal="${align}" ss:Vertical="${o.top ? 'Top' : 'Center'}"${o.wrap ? ' ss:WrapText="1"' : ''}/>${_SS_BORD}<Interior ss:Color="${color}" ss:Pattern="Solid"/><Font ss:FontName="Tahoma" ss:Size="${o.size || 10}"${o.bold ? ' ss:Bold="1"' : ''}${o.fc ? ` ss:Color="${o.fc}"` : ''}/>${o.num ? '<NumberFormat ss:Format="#,##0"/>' : ''}</Style>`;
  };
  for (const k in _SS_COL) {
    mk(`h_${k}`, 'Center', _SS_COL[k], { bold: true, wrap: true });
    mk(`n_${k}`, 'Right', _SS_COL[k], { num: true });
    mk(`nb_${k}`, 'Right', _SS_COL[k], { num: true, bold: true });
    mk(`t_${k}`, 'Left', _SS_COL[k], {});
  }
  mk('title', 'Center', _SS_COL.title, { bold: true, size: 15 });
  mk('sectitle', 'Center', _SS_COL.sec, { bold: true, size: 13 });
  mk('grand', 'Center', _SS_COL.grand, { bold: true, size: 14, num: true });
  mk('tcenter', 'Center', _SS_COL.white, {});
  mk('nr_sys', 'Right', _SS_COL.sys, { num: true, bold: true, fc: '#CC0000' });
  mk('lbl_total', 'Right', _SS_COL.total, { bold: true });
  mk('signlabel', 'Right', _SS_COL.sign, { bold: true });
  mk('signval', 'Center', _SS_COL.white, { bold: true, fc: '#7C3AED' });
  mk('notes', 'Left', _SS_COL.white, { wrap: true, top: true, bold: true, fc: '#CC0000' });
  return `<Styles>${s}</Styles>`;
}
function _ssC(txt, sid, ma, md, idx) {
  const a = (idx ? ` ss:Index="${idx}"` : '') + (ma ? ` ss:MergeAcross="${ma}"` : '') + (md ? ` ss:MergeDown="${md}"` : '');
  return `<Cell ss:StyleID="${sid}"${a}><Data ss:Type="String">${_ssX(txt)}</Data></Cell>`;
}
function _ssN(val, sid, ma, md, idx) {
  const n = Number(val || 0);
  const a = (idx ? ` ss:Index="${idx}"` : '') + (ma ? ` ss:MergeAcross="${ma}"` : '') + (md ? ` ss:MergeDown="${md}"` : '');
  return n === 0 ? `<Cell ss:StyleID="${sid}"${a}/>` : `<Cell ss:StyleID="${sid}"${a}><Data ss:Type="Number">${n}</Data></Cell>`;
}
function _ssSection(title, list, tail, pMap) {
  const PAY = ['cash', 'front_office', 'online', 'kbank', 'ktb', 'ewallet', 'gift_voucher', 'qr_payment', 'commission_deduct', 'arp_amount'];
  const NC = ['n_cash', 'n_cc', 'n_cc', 'n_tf', 'n_tf', 'n_ew', 'n_gift', 'n_qr', 'n_comm', 'n_arp'];
  const NB = ['nb_cash', 'nb_cc', 'nb_cc', 'nb_tf', 'nb_tf', 'nb_ew', 'nb_gift', 'nb_qr', 'nb_comm', 'nb_arp'];
  let r = `<Row><Cell ss:StyleID="sectitle" ss:MergeAcross="18"><Data ss:Type="String">${_ssX(title)}</Data></Cell></Row>`;
  r += `<Row>${_ssC('NO', 'h_white', 0, 2)}${_ssC('วันที่', 'h_white', 0, 2)}${_ssC('เลขออเดอร์', 'h_white', 0, 2)}${_ssC('รหัส', 'h_white', 0, 2)}${_ssC('Name', 'h_white', 0, 2)}${_ssC('Payment (THB)', 'h_pay', 9, 0)}${_ssC('ยอดในระบบ', 'h_sys', 0, 2)}${_ssC('ผลต่าง', 'h_sys', 0, 2)}${_ssC('ผู้บันทึก', 'h_white', 0, 2)}${_ssC('หมายเหตุเพิ่มเติม', 'h_white', 0, 2)}</Row>`;
  r += `<Row>${_ssC('Cash', 'h_cash', 0, 1, 6)}${_ssC('Credit Card', 'h_cc', 1, 0)}${_ssC('Tranfer Money', 'h_tf', 1, 0)}${_ssC('E-WALLET', 'h_ew', 0, 1)}${_ssC('gift voucher', 'h_gift', 0, 1)}${_ssC('qr paymet', 'h_qr', 0, 1)}${_ssC(tail[0], 'h_comm', 0, 1)}${_ssC(tail[1], 'h_arp', 0, 1)}</Row>`;
  r += `<Row>${_ssC('Front Office', 'h_cc', 0, 0, 7)}${_ssC('Online', 'h_cc')}${_ssC('KBANK', 'h_tf')}${_ssC('KTB', 'h_tf')}</Row>`;
  const tot = {}; PAY.forEach(f => tot[f] = 0); let sa = 0, sd = 0;
  list.forEach((b, i) => {
    const p = pMap[b.bill_no] || {};
    const amt = Number(b.amount || 0);
    const diff = PAY.reduce((s, f) => s + Number(p[f] || 0), 0) - amt;
    PAY.forEach(f => tot[f] += Number(p[f] || 0)); sa += amt; sd += diff;
    r += `<Row>${_ssC(i + 1, 'tcenter')}${_ssC(fmtDMY(b.sale_date), 't_white')}${_ssC(b.bill_no, 't_white')}${_ssC(b.member_code || '', 't_white')}${_ssC(b.member_name || '', 't_white')}`
      + PAY.map((f, j) => _ssN(p[f], NC[j])).join('')
      + _ssN(amt, 'n_sys') + _ssN(diff, Math.abs(diff) > 0.5 ? 'nr_sys' : 'n_sys')
      + _ssC(b.recorded_by || '', 't_white') + _ssC(dsCleanNote(p.correction_notes || b.notes), 't_white') + `</Row>`;
  });
  r += `<Row>${_ssN(0, 'n_total')}${_ssN(0, 'n_total')}${_ssN(0, 'n_total')}${_ssN(0, 'n_total')}${_ssC(`รวม (${list.length})`, 'lbl_total')}`
    + PAY.map((f, j) => _ssN(tot[f], NB[j])).join('')
    + _ssN(sa, 'nb_total') + _ssN(sd, 'nb_total') + _ssN(0, 'n_total') + _ssN(0, 'n_total') + `</Row>`;
  r += `<Row><Cell ss:StyleID="grand" ss:Index="5" ss:MergeAcross="12"><Data ss:Type="Number">${sa}</Data></Cell></Row>`;
  return r;
}
function _ssSignoff(rec) {
  const so = rec.signoff || {}, notes = rec.special_notes || '';
  const N = DS_SIGNOFF_ROLES.length;
  let r = '';
  DS_SIGNOFF_ROLES.forEach((role, i) => {
    let row = `<Row>${_ssC(role.label, 'signlabel', 1, 0, 4)}${_ssC(so[role.key] || '', 'signval', 1, 0)}`;
    if (i === 0) {
      const t = _ssX('หมายเหตุ รายการพิเศษในวันนี้\n' + notes).replace(/\n/g, '&#10;');
      row += `<Cell ss:StyleID="notes" ss:Index="9" ss:MergeAcross="10" ss:MergeDown="${N - 1}"><Data ss:Type="String">${t}</Data></Cell>`;
    }
    r += row + `</Row>`;
  });
  return r;
}
function _ssDaySheet(date, list, pMap, rec, group) {
  const groups = { sale: [], arp: [], ewallet: [] };
  list.slice().sort(saleSort).forEach(b => groups[billGroup(b)].push(b));
  const [y, m, d] = date.split('-').map(Number);
  const name = `${d}-${m}-${(y + 543) % 100}`;
  const cols = [30, 55, 118, 45, 200, 52, 62, 55, 58, 55, 62, 62, 58, 58, 55, 68, 50, 62, 120].map(w => `<Column ss:Width="${w}"/>`).join('');
  let rows = `<Row ss:Height="26"><Cell ss:StyleID="title" ss:MergeAcross="18"><Data ss:Type="String">วันที่ ${_ssX(fmtDMY(date))} · สาขา ${_ssX(group === 'ALL' ? 'ทั้งหมด' : group)}</Data></Cell></Row>`;
  rows += _ssSection('DAILY SALE', groups.sale, ['หักค่าคอม', 'ARP'], pMap) + '<Row/>';
  rows += _ssSection('แลก ARP (POINT) · ARP EASY · ABB ONLINE', groups.arp, ['ARP EASY', 'ARP (USD)'], pMap) + '<Row/>';
  rows += _ssSection('E-WALLET (THB)', groups.ewallet, ['หักค่าคอม', ''], pMap) + '<Row/><Row/>';
  rows += _ssSignoff(rec);
  return `<Worksheet ss:Name="${_ssX(name)}"><Table>${cols}${rows}</Table></Worksheet>`;
}
async function dsExportMonth() {
  const group = state.branchGroup || 'ALL';
  const groupLabel = group === 'ALL' ? 'ทั้งหมด' : group;
  const ym = (state.recMonth || state.date || todayIso()).slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const days = new Date(y, m, 0).getDate();
  const start = `${ym}-01`, end = `${ym}-${String(days).padStart(2, '0')}`;
  showLoading(true);
  try {
    const bills = await sbGet(`daily_sale_bills?business_date=gte.${start}&business_date=lte.${end}&limit=20000`);
    const scoped = bills.filter(b => group === 'ALL' || branchGroupOf(b) === group);
    const pMap = scoped.length ? await fetchPaymentsMap(scoped.map(b => b.bill_no)) : {};
    let recMap = {};
    try {
      const recs = await sbGet(`daily_sale_reconcile?reconcile_date=gte.${start}&reconcile_date=lte.${end}&branch=eq.${encodeURIComponent(recBranchKey())}&select=reconcile_date,signoff,special_notes`);
      recMap = Object.fromEntries((recs || []).map(r => [r.reconcile_date, r]));
    } catch { /* ignore */ }
    const byDay = {};
    scoped.forEach(b => { (byDay[b.business_date] = byDay[b.business_date] || []).push(b); });

    let sheets = '', count = 0;
    for (let dd = 1; dd <= days; dd++) {
      const date = `${ym}-${String(dd).padStart(2, '0')}`;
      const list = byDay[date];
      if (!list || !list.length) continue;   // ข้ามวันที่ไม่มีบิล
      sheets += _ssDaySheet(date, list, pMap, recMap[date] || {}, group);
      count++;
    }
    if (!count) { toast('เดือนนี้ไม่มีข้อมูล', 'error'); showLoading(false); return; }

    const xml = `<?xml version="1.0"?>\n<?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" xmlns:html="http://www.w3.org/TR/REC-html40">${_ssStyles()}${sheets}</Workbook>`;
    const blob = new Blob(['﻿' + xml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `DailySale_${TH_MONTHS[m - 1]}${y + 543}_${groupLabel}.xls`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast(`Export ${count} วัน (${count} แท็บ) แล้ว`, 'success');
  } catch (e) {
    toast('Export ไม่สำเร็จ: ' + e.message, 'error');
  }
  showLoading(false);
}

/* reload ตารางของแท็บที่กำลังเปิด (edit/delete ใช้ร่วมทั้งบิลขาย + บิลออนไลน์) */
function dsReloadActive() { return state.tab === 'online' ? loadOnline() : loadSale(); }

/* ============================================================
   INLINE CELL EDIT — คลิกช่อง payment ในตารางแล้วแก้ได้เลย
   ============================================================ */
function dsCellEdit(td) {
  if (td.querySelector('input')) return;                 // กำลังแก้อยู่แล้ว
  const bill = td.dataset.bill, field = td.dataset.field, type = td.dataset.type || 'number';
  td.classList.add('ds-editing');
  if (type === 'text') {
    const cur = state.sale?.[bill]?.payment?.correction_notes || state.sale?.[bill]?.bill?.notes || '';
    const w = Math.max(td.offsetWidth - 10, 120);
    td.innerHTML = `<input type="text" class="ds-cell-input ds-cell-text" value="${String(cur).replace(/"/g, '&quot;')}" style="width:${w}px">`;
  } else {
    const cur = Number(state.sale?.[bill]?.payment?.[field] || 0);
    const w = Math.max(td.offsetWidth - 10, 48);
    td.innerHTML = `<input type="number" step="0.01" class="ds-cell-input" value="${cur || ''}" style="width:${w}px">`;
  }
  const inp = td.querySelector('input');
  inp.focus(); inp.select();
  let done = false;
  inp.addEventListener('blur', () => { if (!done) { done = true; dsCellSave(bill, field, inp.value, type); } });
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
    else if (e.key === 'Escape') { done = true; dsReloadActive(); }   // ยกเลิก = โหลดใหม่
  });
}

async function dsCellSave(bill, field, rawVal, type = 'number') {
  const rec = state.sale?.[bill];
  if (!rec) { dsReloadActive(); return; }
  const p = rec.payment || {};
  let record;

  if (type === 'text') {
    // หมายเหตุ — บันทึก correction_notes (ไม่ตั้ง corrected · ไม่แตะ split)
    const val = String(rawVal).trim() || null;
    if ((p.correction_notes || '') === (val || '')) { dsReloadActive(); return; }
    p.correction_notes = val;
    record = { bill_no: bill, sale_date: rec.bill?.sale_date || todayIso(), amount: Number(rec.bill?.amount || 0), correction_notes: val };
  } else {
    const val = Number(rawVal) || 0;
    if (Number(p[field] || 0) === val) { dsReloadActive(); return; }
    p[field] = val;
    record = {
      bill_no: bill,
      sale_date: rec.bill?.sale_date || todayIso(),
      amount: Number(rec.bill?.amount || 0),
      [field]: val,
      credit_card: Number(p.front_office || 0) + Number(p.online || 0),
      transfer: Number(p.kbank || 0) + Number(p.ktb || 0),
      corrected: true,                     // → 029/030 trigger จะไม่ทับ split
      corrected_by: window.ERP_USER?.user_id || 'unknown',
      corrected_at: new Date().toISOString(),
    };
  }

  showLoading(true);
  try {
    await sbPost('daily_sale_payments?on_conflict=bill_no', [record], 'resolution=merge-duplicates,return=minimal');
    toast('บันทึกแล้ว', 'success');
    await dsReloadActive();
  } catch (e) {
    toast('บันทึกล้มเหลว: ' + e.message, 'error');
    await dsReloadActive();
  }
  showLoading(false);
}

/* ============================================================
   DELETE BILL — ลบบิล (per-row 🗑 + multi-select bulk delete)
   ============================================================ */
function dsToggleRow(chk) {
  const bill = chk.dataset.bill;
  if (chk.checked) state.saleChecked.add(bill); else state.saleChecked.delete(bill);
  dsUpdateBulk();
}
function dsToggleAll(key, chk) {
  document.querySelectorAll(`#dsBody_${key} .ds-rowchk`).forEach(c => {
    c.checked = chk.checked;
    if (chk.checked) state.saleChecked.add(c.dataset.bill); else state.saleChecked.delete(c.dataset.bill);
  });
  dsUpdateBulk();
}
function dsClearSel() {
  state.saleChecked.clear();
  document.querySelectorAll('.ds-rowchk, .ds-chk-all').forEach(c => { c.checked = false; });
  dsUpdateBulk();
}
function dsUpdateBulk() {
  const bar = $('dsBulkBar'); if (!bar) return;
  const n = state.saleChecked.size;
  bar.style.display = n ? 'flex' : 'none';
  const cnt = $('dsBulkCount'); if (cnt) cnt.textContent = n;
}
async function dsDeleteBills(bills, msg) {
  const ok = await dsConfirm(msg, { title: 'ยืนยันลบบิล', icon: '🗑' });
  if (!ok) return;
  showLoading(true);
  try {
    for (let i = 0; i < bills.length; i += 100) {
      const inl = bills.slice(i, i + 100).map(b => `"${b}"`).join(',');
      await sbDelete(`daily_sale_bills?bill_no=in.(${inl})`);   // cascade → ลบ payment ด้วย
    }
    bills.forEach(b => state.saleChecked.delete(b));
    toast(`ลบ ${bills.length} บิลแล้ว`, 'success');
    await dsReloadActive();
  } catch (e) {
    toast('ลบไม่สำเร็จ: ' + e.message, 'error');
    await dsReloadActive();
  }
  showLoading(false);
}
function dsDeleteBill(bill) {
  const name = state.sale?.[bill]?.bill?.member_name || '';
  return dsDeleteBills([bill],
    `ลบบิล <b>${bill}</b>${name ? ' · ' + name : ''}?<br><span style="font-size:12px;color:var(--text3)">payment จะถูกลบด้วย · บิลจาก sync อาจกลับมารอบถัดไป</span>`);
}
function dsBulkDelete() {
  const bills = [...state.saleChecked];
  if (!bills.length) return;
  return dsDeleteBills(bills,
    `ลบ <b>${bills.length}</b> บิลที่เลือก?<br><span style="font-size:12px;color:var(--text3)">payment จะถูกลบด้วย · บิลจาก sync อาจกลับมารอบถัดไป</span>`);
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
    await Promise.all([loadSale(), loadKPI()]);
  } catch (e) {
    toast('บันทึกล้มเหลว: ' + e.message, 'error');
  }
  showLoading(false);
}

/* ============================================================
   TAB: บิลออนไลน์ (บิลขายที่เลขขึ้นต้น STHONLIN · จัดส่ง/นำเข้า DP)
   คอลัมน์เงินตามชีท: CREDIT / E-WALLET / QR / หักคอม / ARP (POINT) USD
   ============================================================ */
async function loadOnline() {
  const body = $('dsBody_online'), foot = $('dsFoot_online');
  if (!body) return;
  body.innerHTML = `<tr><td colspan="15" class="ds-table-empty">กำลังโหลด...</td></tr>`;
  if (foot) foot.innerHTML = '';
  try {
    const branchFilter = state.branch ? `&branch=eq.${state.branch}` : '';
    const bills = await sbGet(`daily_sale_bills?${dateFilter()}${branchFilter}&limit=3000`);

    // ตรงสูตรชีท: Where เลขบิล contains 'ONLIN' · Order by เลขบิล asc
    //   + กรองกลุ่มสาขาเหมือนแท็บบิลขาย
    const grp = state.branchGroup || 'ALL';
    const online = bills
      .filter(b => String(b.bill_no || '').toUpperCase().includes('ONLIN'))
      .filter(b => grp === 'ALL' || branchGroupOf(b) === grp)
      .sort((a, b) => String(a.bill_no) < String(b.bill_no) ? -1 : String(a.bill_no) > String(b.bill_no) ? 1 : 0);

    const canEdit = window.hasPerm ? hasPerm('daily_sale_reconcile') : true;
    if (!online.length) {
      body.innerHTML = `<tr><td colspan="15" class="ds-table-empty">ไม่มีบิลออนไลน์ในวันนี้</td></tr>`;
      if (foot) foot.innerHTML = '';
      dsUpdateBulk();
      return;
    }

    const pMap = await fetchPaymentsMap(online.map(b => b.bill_no));
    const rows = [];
    const tot = { credit: 0, ewallet: 0, qr: 0, comm: 0, arp: 0 };

    online.forEach((b, i) => {
      const p = pMap[b.bill_no] || {};
      state.sale[b.bill_no] = { bill: b, payment: p };   // ให้ dsCellEdit/dsDeleteBill อ่านค่าได้
      const credit = Number(p.online || 0);              // บิลออนไลน์: CREDIT = ช่อง online (แก้ได้)
      const ew = Number(p.ewallet || 0);
      const qr = Number(p.qr_payment || 0);
      const comm = Number(p.commission_deduct || 0);
      const arp = Number(p.arp_amount || 0);
      tot.credit += credit; tot.ewallet += ew; tot.qr += qr; tot.comm += comm; tot.arp += arp;
      const time = b.sale_datetime
        ? new Date(b.sale_datetime).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })
        : '';
      // money cell — ดับเบิลคลิกแก้ inline (ถ้ามีสิทธิ์)
      const pc = (field, cls, val) => canEdit
        ? `<td class="ds-num ${cls} ds-editable" data-bill="${b.bill_no}" data-field="${field}" ondblclick="dsCellEdit(this)" title="ดับเบิลคลิกเพื่อแก้">${fmt0(val)}</td>`
        : `<td class="ds-num ${cls}">${fmt0(val)}</td>`;
      // หมายเหตุ = dropdown จัดส่ง/รับเอง (เก็บที่ delivery_note)
      const dn = b.delivery_note || '';
      const noteCell = canEdit
        ? `<td class="ds-online-note"><select class="ds-delivery-sel" data-bill="${escHtml(b.bill_no)}" onchange="dsSaveDelivery(this)" style="background:${DS_DELIVERY_COLOR[dn] || '#fff'}">
             <option value=""></option>
             ${DS_DELIVERY_OPTS.map(o => `<option value="${o}"${o === dn ? ' selected' : ''}>${o}</option>`).join('')}
           </select></td>`
        : `<td style="font-size:11.5px"><span class="ds-delivery-chip" style="background:${DS_DELIVERY_COLOR[dn] || 'transparent'}">${escHtml(dn)}</span></td>`;
      const chkTd = canEdit
        ? `<td class="ds-chk-col"><input type="checkbox" class="ds-rowchk" data-bill="${b.bill_no}" ${state.saleChecked.has(b.bill_no) ? 'checked' : ''} onchange="dsToggleRow(this)"></td>`
        : '<td class="ds-chk-col"></td>';
      const delTd = canEdit
        ? `<td class="ds-edit-cell"><button class="ds-del-btn" title="ลบบิลนี้" onclick="dsDeleteBill('${b.bill_no}')">🗑</button></td>`
        : '<td></td>';
      rows.push(`
        <tr>
          ${chkTd}
          <td class="ds-num">${i + 1}</td>
          <td>${fmtDMY(b.sale_date)}</td>
          <td><span class="ds-bill-no">${b.bill_no}</span></td>
          <td>${b.member_code || ''}</td>
          <td>${(b.member_name || '').slice(0, 40)}</td>
          ${pc('online', 'ds-col-cc', credit)}
          ${pc('ewallet', 'ds-col-ew', ew)}
          ${pc('qr_payment', 'ds-col-qr', qr)}
          ${pc('commission_deduct', 'ds-col-comm', comm)}
          ${pc('arp_amount', 'ds-col-arp', arp)}
          <td>${b.branch || ''}</td>
          ${canEdit
            ? `<td class="ds-editable ds-time-cell" data-bill="${b.bill_no}" ondblclick="dsTimeEdit(this)" title="ดับเบิลคลิกเพื่อแก้เวลา">${time}</td>`
            : `<td>${time}</td>`}
          ${noteCell}
          ${delTd}
        </tr>`);
    });
    body.innerHTML = rows.join('');

    // ล้าง selection ของบิลที่ไม่แสดงแล้ว + refresh bulk bar
    const vis = new Set(online.map(b => b.bill_no));
    [...state.saleChecked].forEach(bn => { if (!vis.has(bn)) state.saleChecked.delete(bn); });
    dsUpdateBulk();

    const c = (cls, v) => `<td class="ds-num ${cls}">${fmt(v)}</td>`;
    foot.innerHTML = `<tr class="ds-foot-total">
      <td colspan="6" style="text-align:right">รวม (${online.length})</td>
      ${c('ds-col-cc', tot.credit)}${c('ds-col-ew', tot.ewallet)}${c('ds-col-qr', tot.qr)}${c('ds-col-comm', tot.comm)}${c('ds-col-arp', tot.arp)}
      <td colspan="4"></td>
    </tr>`;
  } catch (e) {
    body.innerHTML = `<tr><td colspan="15" class="ds-table-empty">❌ ${e.message}</td></tr>`;
  }
}

/* บันทึกหมายเหตุจัดส่ง (dropdown) → daily_sale_bills.delivery_note */
async function dsSaveDelivery(sel) {
  const bill = sel.dataset.bill, val = sel.value;
  sel.style.background = DS_DELIVERY_COLOR[val] || '#fff';
  try {
    await sbPatch(`daily_sale_bills?bill_no=eq.${encodeURIComponent(bill)}`, { delivery_note: val || null });
    if (state.sale[bill]?.bill) state.sale[bill].bill.delivery_note = val;
    toast('บันทึกหมายเหตุแล้ว', 'success');
  } catch (e) {
    toast('บันทึกไม่สำเร็จ: ' + e.message, 'error');
  }
}

/* ── แก้เวลา (double-click) → daily_sale_bills.sale_datetime ── */
function dsTimeEdit(td) {
  if (td.querySelector('input')) return;
  const bill = td.dataset.bill;
  td.classList.add('ds-editing');
  td.innerHTML = `<input type="time" class="ds-cell-input" value="${td.textContent.trim()}" style="width:104px">`;
  const inp = td.querySelector('input');
  inp.focus();
  let done = false;
  inp.addEventListener('blur', () => { if (!done) { done = true; dsTimeSave(bill, inp.value); } });
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
    else if (e.key === 'Escape') { done = true; dsReloadActive(); }
  });
}
async function dsTimeSave(bill, val) {
  const rec = state.sale?.[bill];
  const date = rec?.bill?.sale_date || todayIso();
  const dt = val ? `${date}T${val}:00` : null;
  showLoading(true);
  try {
    await sbPatch(`daily_sale_bills?bill_no=eq.${encodeURIComponent(bill)}`, { sale_datetime: dt });
    if (rec?.bill) rec.bill.sale_datetime = dt;
    toast('บันทึกเวลาแล้ว', 'success');
    await loadOnline();
  } catch (e) {
    toast('บันทึกไม่สำเร็จ: ' + e.message, 'error');
    await loadOnline();
  }
  showLoading(false);
}

/* ── เพิ่มบิลออนไลน์ (manual) ── */
function dsOnlineAddOpen() {
  const ov = $('dsOnlineAddOverlay');
  if (!ov) return;
  $('dsAddBillNo').value = '';
  $('dsAddDate').value = state.date || todayIso();
  $('dsAddCode').value = '';
  $('dsAddName').value = '';
  ['dsAddCredit', 'dsAddEwallet', 'dsAddQr', 'dsAddComm', 'dsAddArp'].forEach(id => { $(id).value = ''; });
  $('dsAddBranch').value = 'BKK01';
  const sel = $('dsAddDelivery');
  sel.innerHTML = `<option value=""></option>` + DS_DELIVERY_OPTS.map(o => `<option value="${o}">${o}</option>`).join('');
  ov.classList.add('open');
}
function dsOnlineAddClose() { $('dsOnlineAddOverlay').classList.remove('open'); }

async function dsOnlineAddSave() {
  const billNo = ($('dsAddBillNo').value || '').trim();
  const date = $('dsAddDate').value;
  if (!billNo) { toast('ใส่เลขที่บิลก่อน', 'error'); return; }
  if (!date) { toast('เลือกวันที่ก่อน', 'error'); return; }
  if (!billNo.toUpperCase().includes('ONLIN')) {
    const ok = await dsConfirm(
      'เลขบิลนี้ไม่มีคำว่า <b>ONLIN</b> → จะไม่แสดงในแท็บบิลออนไลน์<br><span style="font-size:12px;color:var(--text3)">ยืนยันบันทึกต่อ?</span>',
      { title: 'เลขบิลไม่ตรงรูปแบบออนไลน์', icon: '⚠️' });
    if (!ok) return;
  }
  const num = id => Number($(id).value) || 0;
  const credit = num('dsAddCredit'), ew = num('dsAddEwallet'), qr = num('dsAddQr'), comm = num('dsAddComm'), arp = num('dsAddArp');
  const amount = credit + ew + qr + comm + arp;
  const now = new Date().toISOString();
  const bill = {
    bill_no: billNo, sale_date: date, sale_datetime: `${date}T00:00:00`,
    business_date: date,                                 // ลงยอดทันที (ไม่ค้าง pending)
    member_code: ($('dsAddCode').value || '').trim() || null,
    member_name: ($('dsAddName').value || '').trim() || null,
    branch: ($('dsAddBranch').value || '').trim() || 'BKK01',
    amount, delivery_note: $('dsAddDelivery').value || null,
    recorded_by: window.ERP_USER?.full_name || window.ERP_USER?.user_id || null,
  };
  const pay = {
    bill_no: billNo, sale_date: date, amount,
    cash: 0, front_office: 0, online: credit, kbank: 0, ktb: 0,
    ewallet: ew, gift_voucher: 0, qr_payment: qr, commission_deduct: comm, arp_amount: arp,
    credit_card: credit, transfer: 0,
    corrected: true,                                     // manual → 030 trigger ไม่ทับ split
    corrected_by: window.ERP_USER?.user_id || 'manual', corrected_at: now,
  };
  showLoading(true);
  try {
    await sbPost('daily_sale_bills?on_conflict=bill_no', [bill], 'resolution=merge-duplicates,return=minimal');
    await sbPost('daily_sale_payments?on_conflict=bill_no', [pay], 'resolution=merge-duplicates,return=minimal');
    toast('เพิ่มบิลออนไลน์แล้ว', 'success');
    dsOnlineAddClose();
    await loadOnline();
  } catch (e) {
    toast('เพิ่มไม่สำเร็จ: ' + e.message, 'error');
  }
  showLoading(false);
}

/* ============================================================
   TAB: Reconcile
   ============================================================ */
const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
let DS_SIG_OPTS = ['เกษ', 'เหน่ง'];   // dropdown ผู้เซ็นตรวจบิล — default · โหลดชื่อคนแผนก CS ทับ (dsLoadSigOptions)
let _sigLoaded = false;
// ดึงชื่อพนักงานแผนก CS มาเป็นตัวเลือก Signature (users.department = dept_code ของแผนก CS)
async function dsLoadSigOptions() {
  if (_sigLoaded) return;
  _sigLoaded = true;
  try {
    const depts = await sbGet('departments?select=dept_code,dept_name');
    const cs = (depts || []).find(d => /cs|บริการลูกค้า/i.test(d.dept_name || ''));
    if (!cs) return;
    const users = await sbGet(`users?department=eq.${encodeURIComponent(cs.dept_code)}&select=full_name&order=full_name`);
    const names = (users || []).map(u => (u.full_name || '').trim()).filter(Boolean);
    if (names.length) DS_SIG_OPTS = names;
  } catch (e) { console.warn('load CS staff for signature failed:', e.message); }
}
const REC_ZERO = () => ({ amount: 0, cash: 0, front_office: 0, online: 0, kbank: 0, ktb: 0, ewallet: 0, gift_voucher: 0, qr_payment: 0, commission_deduct: 0, arp_amount: 0 });
// กลุ่มสาขาที่ใช้ตรวจบิล (ALL → default BKK)
function recGroup() { return state.branchGroup && state.branchGroup !== 'ALL' ? state.branchGroup : 'BKK'; }
// reconcile.branch มี FK → branches(branch_code) เก็บชื่อกลุ่มไม่ได้ · ใช้รหัสตัวแทนของกลุ่ม (BKK→BKK01)
function recBranchKey() { return (DS_BRANCH_GROUPS[recGroup()] || [])[0] || 'BKK01'; }
let _recSysMonth = {};   // cache: business_date → {count,value} ของเดือนที่แสดง
let _recDaily = null;    // ข้อมูลสรุปยอดรายวันล่าสุด (ให้ปุ่มคัดลอกใช้)

async function loadReconcile() {
  state.recMonth = (state.date || todayIso()).slice(0, 7);   // sync เดือนกับวันที่เลือก
  state.recDailyDate = state.date || todayIso();              // sync วันสรุปยอดขวา (เลือกเองได้ทีหลัง)
  await dsLoadSigOptions();
  await Promise.all([loadRecMonth(), loadRecDaily()]);
}

function dsRecDailyDateChange(val) { state.recDailyDate = val || todayIso(); loadRecDaily(); }

// คัดลอกสรุปยอดรายวันทั้งบล็อกเป็นข้อความ (เอาไปวาง LINE/chat)
async function dsRecCopyDaily() {
  if (!_recDaily) { toast('ยังไม่มีข้อมูล', 'error'); return; }
  const { ds, ew, group, date } = _recDaily;
  const b = v => `${fmt(v)} บาท`;
  const by = window.ERP_USER?.full_name || window.ERP_USER?.user_id || '';
  const text = [
    'DAILY SALE Payment (THB)',
    `${fmtDMY(date)} · สาขา ${group}`,
    `ยอดรวม = ${b(ds.amount)}`,
    `1) เงินสด = ${b(ds.cash)}`,
    `2) ยอดตัดบัตรเครดิตออนไลน์วันนี้ = ${b(ds.online)}`,
    `3) บัตรเครดิตกสิกร Can = ${b(ds.front_office)}`,
    `4) ยอดโอนกสิกร = ${b(ds.kbank)}`,
    `5) ยอดโอนกรุงไทย = ${b(ds.ktb)}`,
    `6) E-WALLET = ${b(ds.ewallet)}`,
    `7) ARP = ${b(ds.arp_amount)}`,
    `8) QR PAYMENT = ${b(ds.qr_payment)}`,
    `9) โอนค่าคอมเข้า E/W = ${b(ds.commission_deduct)}`,
    `10) คูปองเงินสด = ${b(ds.gift_voucher)}`,
    `11) ARP POINT (USD) = ------ USD`,
    `   - ARP EASY = ------`,
    `   - ABB Online = ------`,
    `12) การเติม E-WALLET จำนวน = ${b(ew.amount)}`,
    `   - ยอดเงินสด = ${b(ew.cash)}`,
    `   - บัตรเครดิตกสิกร Can = ${b(ew.front_office)}`,
    `   - Online = ${b(ew.online)}`,
    `   - K-Bank = ${b(ew.kbank)}`,
    `   - KTB = ${b(ew.ktb)}`,
    `   - E-WALLET = ${b(ew.ewallet)}`,
    `   - QR = ${b(ew.qr_payment)}`,
    `   - GIFT VOUCHER = ${b(ew.gift_voucher)}`,
    `   - โอนค่าคอมเข้า E/W = ${b(ew.commission_deduct)}`,
    `สรุปยอดโดย: ${by ? 'CS-' + by : '—'}`,
  ].join('\n');
  try {
    await navigator.clipboard.writeText(text);
    toast('คัดลอกแล้ว', 'success');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('คัดลอกแล้ว', 'success'); }
    catch { toast('คัดลอกไม่สำเร็จ', 'error'); }
    ta.remove();
  }
}

function dsRecMonthShift(delta) {
  const [y, m] = (state.recMonth || todayIso().slice(0, 7)).split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  state.recMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  loadRecMonth();
}

async function loadRecMonth() {
  const body = $('dsRecMonthBody');
  if (!body) return;
  const group = recGroup();
  const ym = state.recMonth || todayIso().slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const days = new Date(y, m, 0).getDate();
  const start = `${ym}-01`, end = `${ym}-${String(days).padStart(2, '0')}`;
  if ($('dsRecMonthLabel')) $('dsRecMonthLabel').textContent = `${TH_MONTHS[m - 1]} ${y + 543} · ${group}`;
  body.innerHTML = `<tr><td colspan="9" class="ds-table-empty">กำลังโหลด...</td></tr>`;
  try {
    // ในระบบ = บิล DAILY SALE (ไม่รวมเติม ewallet) group ตาม business_date
    const bills = await sbGet(`daily_sale_bills?business_date=gte.${start}&business_date=lte.${end}&select=business_date,amount,bill_type,bill_no,branch,receive_branch&limit=10000`);
    _recSysMonth = {};
    bills.forEach(b => {
      // ตรงสูตรชีท: Col20<>'ARP' and Col20<>'EWALLET' → ตัดทั้ง ARP + เติม E-Wallet
      if (isEwallet(b) || isRedemption(b) || branchGroupOf(b) !== group) return;
      const d = b.business_date;
      (_recSysMonth[d] = _recSysMonth[d] || { count: 0, value: 0 });
      _recSysMonth[d].count++; _recSysMonth[d].value += Number(b.amount || 0);
    });
    const recs = await sbGet(`daily_sale_reconcile?reconcile_date=gte.${start}&reconcile_date=lte.${end}&branch=eq.${encodeURIComponent(recBranchKey())}`);
    const recMap = Object.fromEntries(recs.map(r => [r.reconcile_date, r]));
    const canEdit = window.hasPerm ? hasPerm('daily_sale_reconcile') : true;
    const rows = [];
    for (let dd = 1; dd <= days; dd++) {
      const date = `${ym}-${String(dd).padStart(2, '0')}`;
      const s = _recSysMonth[date] || { count: 0, value: 0 };
      const r = recMap[date] || {};
      const has = s.count > 0;
      const cnt = has ? s.count : '';
      const val = has ? fmt(s.value) : '';   // มูลค่า = Sum(amount) · คงเหลือ = มูลค่า · ในระบบ = ค่าเดียวกัน
      const sig = r.signature || '';
      const opts = (sig && !DS_SIG_OPTS.includes(sig)) ? [sig, ...DS_SIG_OPTS] : DS_SIG_OPTS;   // เผื่อชื่อเก่าไม่อยู่ในลิสต์
      const sigCell = canEdit
        ? `<td class="ds-rec-edit"><select data-date="${date}" data-field="signature" onchange="dsRecCellSave(this)"><option value=""></option>${opts.map(o => `<option${o === sig ? ' selected' : ''}>${escHtml(o)}</option>`).join('')}</select></td>`
        : `<td>${escHtml(sig)}</td>`;
      const note = r.notes || '';
      const noteCell = canEdit
        ? `<td class="ds-rec-edit"><input type="text" data-date="${date}" data-field="notes" value="${escHtml(note).replace(/"/g, '&quot;')}" onchange="dsRecCellSave(this)"></td>`
        : `<td>${escHtml(note)}</td>`;
      rows.push(`<tr>
        <td class="ds-rec-day">${fmtDMY(date)}</td>
        <td class="ds-num ds-col-cash">${cnt}</td>
        <td class="ds-num ds-col-cash">${val}</td>
        <td class="ds-num ds-col-cash">${val}</td>
        <td class="ds-num ds-col-tf">${cnt}</td>
        <td class="ds-num ds-col-tf">${val}</td>
        <td class="ds-num">${has ? '0' : ''}</td>
        ${sigCell}
        ${noteCell}
      </tr>`);
    }
    body.innerHTML = rows.join('');
  } catch (e) {
    body.innerHTML = `<tr><td colspan="9" class="ds-table-empty">❌ ${e.message}</td></tr>`;
  }
}

async function dsRecCellSave(inp) {
  const date = inp.dataset.date, field = inp.dataset.field;   // signature / notes เท่านั้น
  const record = {
    reconcile_date: date, branch: recBranchKey(), [field]: inp.value.trim() || null,
    created_by: window.ERP_USER?.user_id || 'unknown', updated_at: new Date().toISOString(),
  };
  try {
    await sbPost('daily_sale_reconcile?on_conflict=reconcile_date,branch', [record], 'resolution=merge-duplicates,return=minimal');
    toast('บันทึกแล้ว', 'success');
  } catch (e) {
    toast('บันทึกไม่สำเร็จ: ' + e.message, 'error');
  }
}

// ── ขวา: สรุปยอดจ่ายรายวัน (DAILY SALE ข้อ 1-11 · เติม E-Wallet ข้อ 12) ──
async function loadRecDaily() {
  const el = $('dsRecDaily');
  if (!el) return;
  const group = recGroup();
  const date = state.recDailyDate || state.date || todayIso();
  el.innerHTML = `<div class="ds-table-empty">กำลังโหลด...</div>`;
  try {
    const bills = await sbGet(`daily_sale_bills?business_date=eq.${date}&select=*&limit=5000`);
    const scoped = bills.filter(b => branchGroupOf(b) === group);
    const pMap = scoped.length ? await fetchPaymentsMap(scoped.map(b => b.bill_no)) : {};
    const ds = REC_ZERO(), ew = REC_ZERO();   // ds = DAILY SALE (ไม่ใช่ ewallet) · ew = เติม E-Wallet
    scoped.forEach(b => {
      const p = pMap[b.bill_no] || {};
      let t;
      if (isEwallet(b)) t = ew;              // เติม E-Wallet → ข้อ 12
      else if (isRedemption(b)) return;      // ARP ไม่นับใน DAILY SALE (Col20<>'ARP')
      else t = ds;                           // DAILY SALE → ข้อ 1-11
      t.amount += Number(b.amount || 0);
      for (const f in REC_ZERO()) if (f !== 'amount') t[f] += Number(p[f] || 0);
    });
    _recDaily = { ds, ew, group, date };   // เก็บไว้ให้ปุ่มคัดลอกใช้
    el.innerHTML = renderRecDaily(ds, ew, group, date);
  } catch (e) {
    el.innerHTML = `<div class="ds-table-empty">❌ ${e.message}</div>`;
  }
}

function renderRecDaily(ds, ew, group, date) {
  const L = (label, val, dash) => `<div class="ds-recd-line"><span>${label}</span><b>${dash ? '------' : fmt(val)}${dash ? '' : ' บาท'}</b></div>`;
  const by = window.ERP_USER?.full_name || window.ERP_USER?.user_id || '';
  return `
    <div class="ds-recd-card">
      <div class="ds-recd-head">
        <div class="ds-recd-headrow">DAILY SALE Payment (THB)<button class="ds-recd-copy" onclick="dsRecCopyDaily()" title="คัดลอกทั้งบล็อก">📋 คัดลอก</button></div>
        <span><input type="date" class="ds-recd-datepick" value="${date}" onchange="dsRecDailyDateChange(this.value)"> · สาขา ${group}</span>
      </div>
      <div class="ds-recd-line total"><span>ยอดรวม</span><b>${fmt(ds.amount)} บาท</b></div>
      ${L('1) เงินสด', ds.cash)}
      ${L('2) ยอดตัดบัตรเครดิตออนไลน์วันนี้', ds.online)}
      ${L('3) บัตรเครดิตกสิกร Can', ds.front_office)}
      ${L('4) ยอดโอนกสิกร', ds.kbank)}
      ${L('5) ยอดโอนกรุงไทย', ds.ktb)}
      ${L('6) E-WALLET', ds.ewallet)}
      ${L('7) ARP', ds.arp_amount)}
      ${L('8) QR PAYMENT', ds.qr_payment)}
      ${L('9) โอนค่าคอมเข้า E/W', ds.commission_deduct)}
      ${L('10) คูปองเงินสด', ds.gift_voucher)}
      <div class="ds-recd-line"><span>11) ARP POINT (USD)</span><b>------ USD</b></div>
      <div class="ds-recd-sub">${L('- ARP EASY', 0, true)}${L('- ABB Online', 0, true)}</div>
      <div class="ds-recd-line total"><span>12) การเติม E-WALLET จำนวน</span><b>${fmt(ew.amount)} บาท</b></div>
      <div class="ds-recd-sub">
        ${L('- ยอดเงินสด', ew.cash)}
        ${L('- บัตรเครดิตกสิกร Can', ew.front_office)}
        ${L('- Online', ew.online)}
        ${L('- K-Bank', ew.kbank)}
        ${L('- KTB', ew.ktb)}
        ${L('- E-WALLET', ew.ewallet)}
        ${L('- QR', ew.qr_payment)}
        ${L('- GIFT VOUCHER', ew.gift_voucher)}
        ${L('- โอนค่าคอมเข้า E/W', ew.commission_deduct)}
      </div>
      <div class="ds-recd-by">สรุปยอดโดย: <b>${escHtml(by ? 'CS-' + by : '—')}</b></div>
    </div>`;
}

/* ============================================================
   TAB SWITCH
   ============================================================ */
/* ============================================================
   RAW DATA TABS — ดูข้อมูลดิบที่ sync download มา (4 ตาราง)
   ============================================================ */
const DS_RAW_TABS = {
  raw_bills:  { table: 'daily_sale_bills',         label: '📄 01 บิลการขายทั้งหมด' },
  raw_pay:    { table: 'daily_sale_payments',      label: '💳 01 รายงานช่องทางการชำระเงิน' },
  raw_topup:  { table: 'daily_sale_topup_bills',   label: '👛 08 บิลเติมเงิน Ewallet' },
  raw_detail: { table: 'daily_sale_topup_details', label: '📋 03 รายงานรายละเอียด Payment' },
};
function escHtml(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function fmtRawCell(v) {
  if (v === null || v === undefined || v === '') return '<span style="color:var(--text3)">·</span>';
  const s = String(v);
  return escHtml(s.length > 60 ? s.slice(0, 60) + '…' : s);
}
async function loadRaw(key) {
  const cfg = DS_RAW_TABS[key];
  const el = $(`dsRawBody_${key}`);
  if (!cfg || !el) return;
  el.innerHTML = `<div class="ds-table-empty">กำลังโหลด...</div>`;
  try {
    const rows = await sbGet(`${cfg.table}?sale_date=eq.${state.date}&select=*&limit=3000`);
    const headTxt = `<div class="ds-raw-head">${cfg.label} · ${fmtDMY(state.date)} · <b>${rows.length}</b> แถว · <code>${cfg.table}</code></div>`;
    if (!rows.length) { el.innerHTML = headTxt + `<div class="ds-table-empty">ไม่มีข้อมูลวันที่นี้ (ลองเปลี่ยนวันที่ด้านบน)</div>`; return; }
    const cols = Object.keys(rows[0]);
    const thead = cols.map(c => `<th>${escHtml(c)}</th>`).join('');
    const tbody = rows.map(r => `<tr>${cols.map(c => `<td>${fmtRawCell(r[c])}</td>`).join('')}</tr>`).join('');
    el.innerHTML = headTxt +
      `<div class="ds-table-wrap"><div style="overflow-x:auto">
         <table class="ds-table ds-raw-table"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>
       </div></div>`;
  } catch (e) { el.innerHTML = `<div class="ds-table-empty">❌ ${e.message}</div>`; }
}

function dsSwitchTab(tab) {
  if (tab !== state.tab) dsClearSel();   // กัน selection ค้างข้ามแท็บ (sale ↔ online)
  state.tab = tab;
  document.querySelectorAll('.page-tab[data-tab]').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
  $('dsPanelSale').style.display = tab === 'sale' ? '' : 'none';
  $('dsPanelOnline').style.display = tab === 'online' ? '' : 'none';
  $('dsPanelReconcile').style.display = tab === 'reconcile' ? '' : 'none';
  Object.keys(DS_RAW_TABS).forEach(k => { const el = $('dsPanel' + k); if (el) el.style.display = tab === k ? '' : 'none'; });
  if (DS_RAW_TABS[tab]) loadRaw(tab);
}

function dsShiftDate(delta) {
  state.date = (delta === 0) ? todayIso() : isoShift(state.date, delta);
  $('dsDate').value = state.date;
  loadAll();
}

/* ============================================================
   SYNC NOW — trigger GitHub workflow
   ============================================================ */
/* เปิด modal เลือกช่วงวันที่ · default = เมื่อวาน → วันนี้ */
function dsSyncModalOpen() {
  $('dsSyncFrom').value = isoShift(todayIso(), -1); // today-1
  $('dsSyncTo').value = todayIso();
  // reset โหมด → ยังไม่ปิดรอบ
  const r = document.querySelector('input[name="dsCloseMode"][value="open"]');
  if (r) { r.checked = true; dsCloseModeSel(r); }
  $('dsSyncOverlay').classList.add('open');
}
// ไฮไลต์ตัวเลือกที่เลือก (open/close)
function dsCloseModeSel() {
  document.querySelectorAll('input[name="dsCloseMode"]').forEach(x => x.closest('.ds-close-opt')?.classList.toggle('on', x.checked));
}
function dsSyncModalClose() { $('dsSyncOverlay').classList.remove('open'); }

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

  // อ่านช่วงวันที่จาก modal
  const from = $('dsSyncFrom')?.value;
  const to = $('dsSyncTo')?.value;
  if (!from || !to) { toast('เลือกช่วงวันที่ก่อน', 'error'); return; }
  if (from > to) { toast('วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด', 'error'); return; }

  const closeMode = document.querySelector('input[name="dsCloseMode"]:checked')?.value === 'close';

  dsSyncModalClose();
  showLoading(true);
  try {
    // ปิดรอบวันนี้: ลง marker (เวลาปิด = now) → trigger ตี business_date ให้บิลหลังเวลานี้เป็นวันถัดไป
    if (closeMode) {
      try {
        await sbPost('daily_sale_day_close?on_conflict=close_date',
          [{ close_date: todayIso(), closed_at: new Date().toISOString(), closed_by: window.ERP_USER?.user_id || 'unknown', updated_at: new Date().toISOString() }],
          'resolution=merge-duplicates,return=minimal');
      } catch (e) { toast('ปิดรอบไม่สำเร็จ: ' + e.message, 'error'); }
    }

    // ล้าง corrected ของบิล sync (ที่ CS แก้/ลบ) เฉพาะช่วงที่จะดึง
    // → sync download ทับ aggregate ใหม่ → trigger 030 derive split สด · ไม่แตะบิล import DATA_CS
    try {
      await sbPatch(
        `daily_sale_payments?corrected=eq.true&source_file=neq.DATA_CS-import&sale_date=gte.${from}&sale_date=lte.${to}`,
        { corrected: false, corrected_by: null, corrected_at: null }
      );
    } catch (e) { console.warn('reset corrected before sync:', e.message); }

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
      // force:true → คลิกเอง = run now (ข้าม gate) · backfill:true → tag business_date=sale_date
      // ต่อบิล (ลงยอดตามวันขายจริง · ไม่ค้าง pending) · date_from/to = ช่วงที่เลือก
      body: JSON.stringify({
        ref: c.github_branch || 'main',
        inputs: { force: 'true', backfill: 'true', date_from: from, date_to: to },
      }),
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
let _lastPct = 0;

/* หลอด % — monotonic (ไม่ถอยหลัง) · mode 'ok'=เขียว 'err'=แดง */
function _setProgress(pct, note, mode = '') {
  pct = Math.max(_lastPct, Math.min(100, Math.round(pct)));
  _lastPct = pct;
  const bar = $('spBar');
  if (bar) {
    bar.style.width = pct + '%';
    if (mode === 'err') bar.style.background = 'linear-gradient(90deg,#ef4444,#f87171)';
    else if (mode === 'ok') bar.style.background = 'linear-gradient(90deg,#22c55e,#4ade80)';
  }
  if ($('spPct')) $('spPct').textContent = pct + '%';
  if (note && $('spBarNote')) $('spBarNote').textContent = note;
  // avatar วิ่งตาม % (เกาะขอบหลอด)
  const rn = $('spRunner');
  if (rn) {
    rn.style.left = pct + '%';
    if (mode === 'ok' || mode === 'err') {
      // จบแล้ว → ซ่อน sprite/หยุดวิ่ง โชว์ emoji ฉลอง/พัง
      const img = rn.querySelector('.ds-runner-sprite');
      const emo = rn.querySelector('.ds-runner-emo');
      if (img) img.style.display = 'none';
      if (emo) {
        emo.style.display = 'inline-block';
        emo.style.animation = 'none';
        emo.style.transform = 'scaleX(1)';
        emo.textContent = mode === 'ok' ? '🎉' : '💥';
      }
    }
  }
}

/* % จาก step ของ workflow จริง (jobs API) · null = ดึงไม่ได้ให้ fallback เวลา */
async function _stepPct(pat, runId) {
  const c = state.config;
  const url = `https://api.github.com/repos/${c.github_owner}/${c.github_repo}/actions/runs/${runId}/jobs`;
  const res = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${pat}`, 'X-GitHub-Api-Version': '2022-11-28' },
  });
  const data = await res.json();
  const job = (data.jobs || [])[0];
  if (!job || !job.steps || !job.steps.length) return null;
  let score = 0;
  for (const s of job.steps) {
    if (s.status === 'completed') score += 1;
    else if (s.status === 'in_progress') score += 0.5;
  }
  return Math.min(95, 15 + (score / job.steps.length) * 80); // ช่วง 15→95 ระหว่างรัน
}

function _openSyncModal(pat) {
  $('spOverlay').style.display = 'flex';
  _spMsg('ซักครู่นะคะ');
  $('spStatus').textContent = 'queued';
  _startMs = Date.now();
  _lastPct = 0;
  const bar = $('spBar');
  if (bar) { bar.style.width = '0%'; bar.style.background = 'linear-gradient(90deg,var(--accent),var(--accent-light))'; }
  // reset avatar: ถ้ารูป mascot โหลดได้ใช้รูป · ไม่งั้น fallback emoji 🏃
  const rn = $('spRunner');
  if (rn) {
    const img = rn.querySelector('.ds-runner-sprite');
    const emo = rn.querySelector('.ds-runner-emo');
    if (emo) { emo.textContent = '🏃'; emo.style.animation = ''; emo.style.transform = ''; }
    if (img && img.complete && img.naturalWidth > 0) {
      img.style.display = '';
      if (emo) emo.style.display = 'none';
    } else if (emo) {
      emo.style.display = 'inline-block';
      if (img) img.style.display = 'none';
    }
  }
  _setProgress(6, 'ส่งคำสั่งไป GitHub...');
  _spLog('🚀 Dispatched to GitHub Actions', 'ok');
  _pollRun(pat);
}

function dsCloseSyncProgress() {
  $('spOverlay').style.display = 'none';
  if (_pollTimer) clearTimeout(_pollTimer);
  loadAll();
}

function _spLog() { /* กล่อง log ถูกเอาออกแล้ว — no-op */ }

// เปลี่ยนข้อความโหลด (หยุดจุดวิ่งเมื่อจบ)
function _spMsg(text, done) {
  const el = $('spLoadingMsg');
  if (!el) return;
  el.innerHTML = done ? text : `${text}<span class="ds-loading-dots"></span>`;
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
        _setProgress(100, 'สำเร็จ', 'ok');
        _spMsg('เสร็จเรียบร้อยค่ะ 🎉', true);
        // backfill=true tag business_date=sale_date ต่อบิลแล้ว → ไม่ต้อง close_day
        // (ไม่ไปตีบิล pending อื่นเป็นวันนี้)
        return;
      }
      if (run.conclusion === 'failure') { _setProgress(_lastPct, 'ล้มเหลว', 'err'); _spMsg('ดึงข้อมูลไม่สำเร็จ ❌', true); return; }
      if (run.status === 'completed' && run.conclusion) {
        _setProgress(100, run.conclusion, run.conclusion === 'success' ? 'ok' : 'err');
        _spLog(`Run ended: ${run.conclusion}`, run.conclusion === 'success' ? 'ok' : 'err');
        return;
      }
      // ยังรันอยู่ → คำนวณ % จาก step จริง (fallback: ประมาณตามเวลา)
      if (run.status === 'queued') {
        _setProgress(Math.min(15, 8 + elapsed * 0.4), 'อยู่ในคิว GitHub...');
      } else {
        let pct = null;
        try { pct = await _stepPct(pat, run.id); } catch { /* fallback below */ }
        if (pct == null) pct = 20 + 70 * (1 - Math.exp(-elapsed / 120)); // asymptotic → 90
        _setProgress(pct, 'กำลังดึง + ประมวลผลข้อมูล...');
      }
    } else {
      _setProgress(Math.min(12, 5 + elapsed * 0.5), 'รอ GitHub รับงาน...');
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
window.dsSyncModalOpen = dsSyncModalOpen;
window.dsSyncModalClose = dsSyncModalClose;
window.dsCloseModeSel = dsCloseModeSel;
window.dsCloseSyncProgress = dsCloseSyncProgress;
window.dsRecCellSave = dsRecCellSave;
window.dsRecMonthShift = dsRecMonthShift;
window.dsRecDailyDateChange = dsRecDailyDateChange;
window.dsRecCopyDaily = dsRecCopyDaily;
window.dsSignoffSave = dsSignoffSave;
window.dsExportExcel = dsExportExcel;
window.dsExportMonth = dsExportMonth;
window.dsConfirmResolve = dsConfirmResolve;
window.dsSelectBranch = dsSelectBranch;
window.dsGroupOpen = dsGroupOpen;
window.dsGroupClose = dsGroupClose;
window.dsGroupSave = dsGroupSave;
window.dsCellEdit = dsCellEdit;
window.dsToggleRow = dsToggleRow;
window.dsToggleAll = dsToggleAll;
window.dsClearSel = dsClearSel;
window.dsDeleteBill = dsDeleteBill;
window.dsSaveDelivery = dsSaveDelivery;
window.dsTimeEdit = dsTimeEdit;
window.dsOnlineAddOpen = dsOnlineAddOpen;
window.dsOnlineAddClose = dsOnlineAddClose;
window.dsOnlineAddSave = dsOnlineAddSave;
window.dsBulkDelete = dsBulkDelete;
window.dsEditOpen = dsEditOpen;
window.dsEditClose = dsEditClose;
window.dsEditRecalc = dsEditRecalc;
window.dsEditSave = dsEditSave;

document.addEventListener('DOMContentLoaded', init);
