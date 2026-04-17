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
};

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
  await Promise.all([loadKPI(), loadSale(), loadTopup(), loadReconcile(), loadReconcileList()]);
}

/* ============================================================
   KPI (hero)
   ============================================================ */
async function loadKPI() {
  const branchFilter = state.branch ? `&branch=eq.${state.branch}` : '';
  try {
    const rows = await sbGet(`daily_sale_summary?sale_date=eq.${state.date}${branchFilter}`);
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
async function loadSale() {
  const body = $('dsSaleBody');
  body.innerHTML = `<tr><td colspan="11" class="ds-table-empty">กำลังโหลด...</td></tr>`;
  try {
    const branchFilter = state.branch ? `&branch=eq.${state.branch}` : '';
    const bills = await sbGet(
      `daily_sale_bills?sale_date=eq.${state.date}${branchFilter}&order=sale_datetime.desc&limit=1000`
    );
    if (!bills.length) {
      body.innerHTML = `<tr><td colspan="11" class="ds-table-empty">ไม่มีบิลในวันนี้</td></tr>`;
      $('dsSaleSummary').style.display = 'none';
      return;
    }

    // Fetch payments for these bills
    const billNos = bills.map(b => `"${b.bill_no}"`).join(',');
    const payments = await sbGet(`daily_sale_payments?bill_no=in.(${billNos})&select=*`);
    const pMap = Object.fromEntries(payments.map(p => [p.bill_no, p]));

    const rows = [];
    let sumAmount = 0, sumCash = 0, sumTransfer = 0, sumCredit = 0, sumEwallet = 0, sumGift = 0;

    for (const b of bills) {
      const p = pMap[b.bill_no] || {};
      sumAmount += Number(b.amount || 0);
      sumCash += Number(p.cash || 0);
      sumTransfer += Number(p.transfer || 0);
      sumCredit += Number(p.credit_card || 0);
      sumEwallet += Number(p.ewallet || 0);
      sumGift += Number(p.gift_voucher || 0);

      rows.push(`
        <tr>
          <td><span class="ds-bill-no">${b.bill_no}</span></td>
          <td>${b.member_code || ''} · ${(b.member_name || '').slice(0, 28)}</td>
          <td><span class="ds-badge sale">${b.bill_type || '—'}</span></td>
          <td class="ds-num">${fmt(b.amount)}</td>
          <td class="ds-num">${fmt(p.cash)}</td>
          <td class="ds-num">${fmt(p.transfer)}</td>
          <td class="ds-num">${fmt(p.credit_card)}</td>
          <td class="ds-num">${fmt(p.ewallet)}</td>
          <td class="ds-num">${fmt(p.gift_voucher)}</td>
          <td style="font-size:11.5px">${p.payment_method || '—'}</td>
          <td>${b.branch || '—'}</td>
        </tr>
      `);
    }
    body.innerHTML = rows.join('');

    $('dsSumCount').textContent = bills.length;
    $('dsSumAmount').textContent = fmt(sumAmount);
    $('dsSumCash').textContent = fmt(sumCash);
    $('dsSumTransfer').textContent = fmt(sumTransfer);
    $('dsSumCredit').textContent = fmt(sumCredit);
    $('dsSumEwallet').textContent = fmt(sumEwallet);
    $('dsSumGift').textContent = fmt(sumGift);
    $('dsSaleSummary').style.display = 'flex';
  } catch (e) {
    body.innerHTML = `<tr><td colspan="11" class="ds-table-empty">❌ ${e.message}</td></tr>`;
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
      `daily_sale_topup_bills?sale_date=eq.${state.date}${branchFilter}&order=sale_date.desc&limit=1000`
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
  document.querySelectorAll('.ds-tab').forEach(el => el.classList.toggle('active', el.dataset.tab === tab));
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

  if (!confirm('สั่ง GitHub Actions sync Daily Sale ตอนนี้?')) return;

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
      body: JSON.stringify({ ref: c.github_branch || 'main' }),
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
      if (run.conclusion === 'success') { _spLog('✅ Sync สำเร็จ', 'ok'); return; }
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

document.addEventListener('DOMContentLoaded', init);
