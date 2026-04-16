/* ============================================================
   members-dashboard.js — Customer data quality dashboard
   - Summary stats (company vs individual, missing data)
   - Issue list: company name + empty full_name
   - Server-side pagination + search + CSV export
   ============================================================ */

const SUPABASE_URL = localStorage.getItem('sb_url') || '';
const SUPABASE_KEY = localStorage.getItem('sb_key') || '';

const PAGE_SIZE = 25;
let currentPage = 1;
let currentSearch = '';
let totalIssueCount = 0;
let _searchDebounce = null;

/* ── REST helpers ── */
async function sb(path, extraHeaders = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
      ...extraHeaders,
    },
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 120)}`);
  return { res, json: await res.json() };
}

/* ── Load summary stats ── */
async function loadStats() {
  try {
    const { json } = await sb('v_data_quality_summary?select=*');
    const s = json[0] || {};
    const total = s.total || 0;
    const pct = (n) => total ? ((n || 0) / total * 100).toFixed(1) + '%' : '0%';

    document.getElementById('sTotal').textContent      = total.toLocaleString();
    document.getElementById('sCompany').textContent    = (s.company_count || 0).toLocaleString();
    document.getElementById('sCompanyPct').textContent = pct(s.company_count);
    document.getElementById('sIndividual').textContent = (s.individual_count || 0).toLocaleString();
    document.getElementById('sIndividualPct').textContent = pct(s.individual_count);
    document.getElementById('sProblem').textContent    = (s.company_missing_fullname || 0).toLocaleString();

    renderDonut(s.company_count || 0, s.individual_count || 0);
    renderMissList(s);
  } catch (e) {
    console.error(e);
    showToast('โหลด stats ไม่ได้: ' + e.message, 'error');
  }
}

function renderDonut(company, individual) {
  const total = company + individual;
  if (!total) return;
  const companyPct = (company / total) * 100;
  const gap = 1;
  const r = 60, cx = 80, cy = 80, c = 2 * Math.PI * r;
  const companyLen = (companyPct / 100) * c - gap;
  const individualLen = c - companyLen - gap * 2;

  const wrap = document.getElementById('donutWrap');
  wrap.innerHTML = `
    <svg viewBox="0 0 160 160" style="width:100%;height:100%">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e5e7eb" stroke-width="22"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#f59e0b" stroke-width="22"
        stroke-dasharray="${companyLen} ${c - companyLen}" stroke-dashoffset="0"
        transform="rotate(-90 ${cx} ${cy})" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#10b981" stroke-width="22"
        stroke-dasharray="${individualLen} ${c - individualLen}" stroke-dashoffset="${-companyLen - gap}"
        transform="rotate(-90 ${cx} ${cy})" stroke-linecap="round"/>
    </svg>
    <div class="donut-center">
      <div class="big">${total.toLocaleString()}</div>
      <div class="small">รวม</div>
    </div>`;
  document.getElementById('donutLegend').innerHTML = `
    <div class="row"><span class="dot" style="background:#f59e0b"></span>บริษัท<span class="num">${company.toLocaleString()} (${companyPct.toFixed(1)}%)</span></div>
    <div class="row"><span class="dot" style="background:#10b981"></span>บุคคลธรรมดา<span class="num">${individual.toLocaleString()} (${(100 - companyPct).toFixed(1)}%)</span></div>
  `;
}

function renderMissList(s) {
  const total = s.total || 1;
  const items = [
    { icon: '🏢', label: 'บริษัทขาดชื่อบุคคลธรรมดา', val: s.company_missing_fullname || 0 },
    { icon: '📞', label: 'ขาดเบอร์โทร', val: s.missing_phone || 0 },
  ];
  document.getElementById('missList').innerHTML = items.map(it => {
    const pct = ((it.val / total) * 100).toFixed(1);
    const barW = Math.min(100, pct);
    return `<div style="padding:8px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:baseline">
        <span>${it.icon} ${it.label}</span>
        <span style="font-weight:700;font-variant-numeric:tabular-nums">${it.val.toLocaleString()} <span style="color:var(--text3);font-weight:400;font-size:11px">(${pct}%)</span></span>
      </div>
      <div style="height:5px;background:var(--surface2);border-radius:3px;margin-top:5px;overflow:hidden">
        <div style="height:100%;background:linear-gradient(90deg,#f59e0b,#ef4444);width:${barW}%"></div>
      </div>
    </div>`;
  }).join('');
}

/* ── Load issue list (paginated) ── */
async function loadIssues(page = 1) {
  currentPage = page;
  const offset = (page - 1) * PAGE_SIZE;
  const from = offset, to = offset + PAGE_SIZE - 1;

  let filter = 'is_company=eq.true&full_name_empty=eq.true';
  if (currentSearch) {
    const esc = currentSearch.replace(/[,()*]/g, '');
    if (/^\d+$/.test(esc)) {
      filter += `&member_code=ilike.*${esc}*`;
    } else {
      filter += `&member_name=ilike.*${esc}*`;
    }
  }

  const body = document.getElementById('dqBody');
  body.innerHTML = `<tr><td colspan="6" class="dq-empty">⏳ กำลังโหลด...</td></tr>`;

  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/v_member_data_quality?select=member_code,member_name,full_name,country_code,package,registered_at&${filter}&order=registered_at.desc.nullslast&limit=${PAGE_SIZE}&offset=${offset}`,
      {
        headers: {
          apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
          Prefer: 'count=exact', Range: `${from}-${to}`,
        },
      }
    );
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 120)}`);
    const rows = await res.json();
    const range = res.headers.get('content-range') || '*/0';
    totalIssueCount = parseInt(range.split('/')[1], 10) || 0;

    document.getElementById('issueCount').textContent = totalIssueCount.toLocaleString();

    if (!rows.length) {
      body.innerHTML = `<tr><td colspan="6" class="dq-empty"><div class="dq-empty-icon">✅</div>ไม่พบข้อมูลที่ตรงกับเงื่อนไข</td></tr>`;
      renderPaginate(0);
      return;
    }

    body.innerHTML = rows.map(r => {
      const flag = _flag(r.country_code);
      return `<tr>
        <td><span class="dq-code" onclick="gotoMember('${r.member_code}')">${r.member_code}</span></td>
        <td style="font-weight:600">${escapeHtml(r.member_name || '—')}</td>
        <td><span class="dq-empty-cell">— ว่าง —</span></td>
        <td>${flag} ${r.country_code || ''}</td>
        <td>${r.package ? `<span class="pkg-badge pkg-${r.package}">${r.package}</span>` : '—'}</td>
        <td style="color:var(--text3);font-size:12px">${r.registered_at ? DateFmt.formatDMY(r.registered_at) : '—'}</td>
      </tr>`;
    }).join('');

    renderPaginate(totalIssueCount);
  } catch (e) {
    body.innerHTML = `<tr><td colspan="6" class="dq-empty">❌ ${escapeHtml(e.message)}</td></tr>`;
  }
}

function renderPaginate(total) {
  const pages = Math.ceil(total / PAGE_SIZE) || 1;
  const p = currentPage;
  const el = document.getElementById('dqPaginate');
  if (pages <= 1) { el.innerHTML = ''; return; }

  const btn = (label, pg, disabled, active) =>
    `<button ${disabled ? 'disabled' : ''} ${active ? 'class="active"' : ''} onclick="loadIssues(${pg})">${label}</button>`;

  let html = btn('«', 1, p === 1) + btn('‹', Math.max(1, p - 1), p === 1);
  const start = Math.max(1, p - 2);
  const end = Math.min(pages, p + 2);
  if (start > 1) html += '<span style="color:var(--text3)">…</span>';
  for (let i = start; i <= end; i++) html += btn(i, i, false, i === p);
  if (end < pages) html += '<span style="color:var(--text3)">…</span>';
  html += btn('›', Math.min(pages, p + 1), p === pages);
  html += btn('»', pages, p === pages);
  html += `<span class="paginate-info">หน้า ${p} / ${pages} · รวม ${total.toLocaleString()} รายการ</span>`;

  el.innerHTML = html;
}

/* ── Search ── */
document.getElementById('dqSearch').addEventListener('input', (e) => {
  clearTimeout(_searchDebounce);
  _searchDebounce = setTimeout(() => {
    currentSearch = e.target.value.trim();
    loadIssues(1);
  }, 350);
});

/* ── Export CSV (all rows, no pagination) ── */
async function exportCSV() {
  showLoading(true);
  try {
    let filter = 'is_company=eq.true&full_name_empty=eq.true';
    if (currentSearch) {
      const esc = currentSearch.replace(/[,()*]/g, '');
      if (/^\d+$/.test(esc)) filter += `&member_code=ilike.*${esc}*`;
      else filter += `&member_name=ilike.*${esc}*`;
    }
    const { json } = await sb(`v_member_data_quality?select=member_code,member_name,full_name,country_code,package,registered_at,phone,email&${filter}&order=registered_at.desc.nullslast&limit=10000`);

    if (!json.length) { showToast('ไม่มีข้อมูลให้ export', 'info'); showLoading(false); return; }

    const headers = ['member_code', 'member_name', 'full_name', 'country_code', 'package', 'registered_at', 'phone', 'email'];
    const csv = [headers.join(',')];
    for (const r of json) {
      csv.push(headers.map(h => {
        const val = r[h] == null ? '' : String(r[h]);
        return `"${val.replace(/"/g, '""')}"`;
      }).join(','));
    }
    const blob = new Blob(['\uFEFF' + csv.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `customer-data-quality-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`📥 Export ${json.length.toLocaleString()} แถวสำเร็จ`, 'success');
  } catch (e) {
    showToast('Export ไม่ได้: ' + e.message, 'error');
  }
  showLoading(false);
}

/* ── Navigation ── */
function gotoMember(code) {
  location.href = `./members-list.html?code=${encodeURIComponent(code)}`;
}
function gotoTree(code) {
  location.href = `./members-tree.html?code=${encodeURIComponent(code)}`;
}

/* ── Utils ── */
function _flag(c) { return c === 'TH' ? '🇹🇭' : c === 'KH' ? '🇰🇭' : '🌐'; }
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}
function showLoading(on) {
  document.getElementById('loadingOverlay').style.display = on ? 'flex' : 'none';
}
function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show toast-${type}`;
  setTimeout(() => t.className = 'toast', 3500);
}

/* ============================================================
   REPORTS SECTION
   ============================================================ */

const RPT_COLORS = ['bar-blue','bar-green','bar-amber','bar-purple','bar-pink','bar-teal','bar-red','bar-indigo'];
const RPT_RAW = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#ec4899','#14b8a6','#ef4444','#6366f1'];
const FLAGS = {TH:'🇹🇭',KH:'🇰🇭',CIV:'🇨🇮',NG:'🇳🇬',CM:'🇨🇲',BJ:'🇧🇯',SN:'🇸🇳',BF:'🇧🇫',ML:'🇲🇱',TG:'🇹🇬',GN:'🇬🇳',NE:'🇳🇪',CD:'🇨🇩',GH:'🇬🇭','N/A':'🌐'};

async function rpc(fn, params = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`${fn}: ${res.status}`);
  return res.json();
}

/* ── Date filter ── */
function _rptRange() {
  const from = document.getElementById('rptFrom').value || '2015-01-01';
  const to = document.getElementById('rptTo').value || new Date().toISOString().slice(0, 10);
  return { p_from: from, p_to: to };
}

function setRptPreset(key) {
  const now = new Date();
  const toEl = document.getElementById('rptTo');
  const fromEl = document.getElementById('rptFrom');
  if (key === 'thisYear') {
    fromEl.value = `${now.getFullYear()}-01-01`;
    toEl.value = now.toISOString().slice(0, 10);
  } else if (key === 'lastYear') {
    fromEl.value = `${now.getFullYear() - 1}-01-01`;
    toEl.value = `${now.getFullYear() - 1}-12-31`;
  } else if (key === 'last6m') {
    const d = new Date(now); d.setMonth(d.getMonth() - 6);
    fromEl.value = d.toISOString().slice(0, 10);
    toEl.value = now.toISOString().slice(0, 10);
  } else if (key === 'last30d') {
    const d = new Date(now); d.setDate(d.getDate() - 30);
    fromEl.value = d.toISOString().slice(0, 10);
    toEl.value = now.toISOString().slice(0, 10);
  }
  loadReports();
}
function applyReport() { loadReports(); }
function resetReport() {
  document.getElementById('rptFrom').value = '';
  document.getElementById('rptTo').value = '';
  loadReports();
}

/* ── Load all reports ── */
async function loadReports() {
  const range = _rptRange();
  try {
    const [monthly, pkg, country, sponsors, uplines, side, channel, gc] = await Promise.all([
      rpc('member_report_monthly', range),
      rpc('member_report_package', range),
      rpc('member_report_country', range),
      rpc('member_report_top_sponsors', { ...range, p_limit: 15 }),
      rpc('member_report_top_uplines', { ...range, p_limit: 15 }),
      rpc('member_report_side', range),
      rpc('member_report_channel', range),
      rpc('member_report_growth_by_country', range),
    ]);
    _renderGrowth(monthly);
    _renderBar('pkgChart', pkg, 'package', 'pkgTotal');
    _renderBar('countryChart', country, 'country_code', 'countryTotal', true);
    _renderDonutReport('sideChart', side, 'side');
    _renderBar('channelChart', channel, 'channel');
    _renderRank('sponsorTable', sponsors, 'sponsor_code', 'sponsor_name');
    _renderRank('uplineTable', uplines, 'upline_code', 'upline_name');
    _renderGrowthCountry(gc);
  } catch (e) {
    console.error('Reports error:', e);
    showToast('โหลดรายงานไม่ได้: ' + e.message, 'error');
  }
}

/* ── Render: Monthly growth ── */
function _renderGrowth(data) {
  const el = document.getElementById('growthChart');
  if (!data.length) { el.innerHTML = '<div class="report-empty">ไม่มีข้อมูล</div>'; return; }
  const max = Math.max(...data.map(d => d.cnt));
  const total = data.reduce((s, d) => s + Number(d.cnt), 0);
  document.getElementById('growthTotal').textContent = total.toLocaleString() + ' คน';
  el.innerHTML = data.map(d => {
    const pct = max ? (d.cnt / max * 100) : 0;
    return `<div class="growth-bar-wrap">
      <div class="growth-bar bar-blue" style="height:${Math.max(pct, 2)}%">
        <div class="growth-tooltip">${d.month}: ${Number(d.cnt).toLocaleString()}</div>
      </div>
      <div class="growth-bar-label">${d.month.slice(2)}</div>
    </div>`;
  }).join('');
}

/* ── Render: Horizontal bar chart ── */
function _renderBar(elId, data, labelKey, totalBadgeId, showFlag) {
  const el = document.getElementById(elId);
  if (!data.length) { el.innerHTML = '<div class="report-empty">ไม่มีข้อมูล</div>'; return; }
  const max = Math.max(...data.map(d => d.cnt));
  const total = data.reduce((s, d) => s + Number(d.cnt), 0);
  if (totalBadgeId) document.getElementById(totalBadgeId).textContent = total.toLocaleString() + ' คน';
  el.innerHTML = '<div class="bar-chart">' + data.map((d, i) => {
    const pct = max ? (d.cnt / max * 100) : 0;
    const flag = showFlag ? (FLAGS[d[labelKey]] || '🌐') + ' ' : '';
    const label = flag + (d[labelKey] || 'N/A');
    return `<div class="bar-row">
      <div class="bar-label" title="${label}">${label}</div>
      <div class="bar-track"><div class="bar-fill ${RPT_COLORS[i % RPT_COLORS.length]}" style="width:${Math.max(pct, 1)}%"></div></div>
      <div class="bar-val">${Number(d.cnt).toLocaleString()}</div>
    </div>`;
  }).join('') + '</div>';
}

/* ── Render: Donut (side balance) ── */
function _renderDonutReport(elId, data, labelKey) {
  const el = document.getElementById(elId);
  if (!data.length) { el.innerHTML = '<div class="report-empty">ไม่มีข้อมูล</div>'; return; }
  const total = data.reduce((s, d) => s + Number(d.cnt), 0);
  if (!total) { el.innerHTML = '<div class="report-empty">ไม่มีข้อมูล</div>'; return; }
  const r = 60, cx = 80, cy = 80, c = 2 * Math.PI * r, gap = 1;
  let offset = 0;
  const circles = data.map((d, i) => {
    const pct = d.cnt / total;
    const len = pct * c - gap;
    if (len <= 0) return '';
    const svg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${RPT_RAW[i % RPT_RAW.length]}" stroke-width="22"
      stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-offset}"
      transform="rotate(-90 ${cx} ${cy})" stroke-linecap="round"/>`;
    offset += pct * c;
    return svg;
  }).join('');
  const legend = data.map((d, i) => {
    const pct = ((d.cnt / total) * 100).toFixed(1);
    return `<div class="row"><span class="dot" style="background:${RPT_RAW[i % RPT_RAW.length]}"></span>${d[labelKey] || 'N/A'}<span class="num">${Number(d.cnt).toLocaleString()} (${pct}%)</span></div>`;
  }).join('');
  el.innerHTML = `<div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap;">
    <div class="donut-wrap">
      <svg viewBox="0 0 160 160" style="width:100%;height:100%">
        <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e5e7eb" stroke-width="22"/>
        ${circles}
      </svg>
      <div class="donut-center"><div class="big">${total.toLocaleString()}</div><div class="small">รวม</div></div>
    </div>
    <div class="donut-legend">${legend}</div>
  </div>`;
}

/* ── Render: Ranking table ── */
function _renderRank(elId, data, codeKey, nameKey) {
  const el = document.getElementById(elId);
  if (!data.length) { el.innerHTML = '<div class="report-empty">ไม่มีข้อมูล</div>'; return; }
  const max = Math.max(...data.map(d => d.cnt));
  el.innerHTML = `<table class="rank-table">
    <thead><tr><th>#</th><th>รหัส</th><th>ชื่อ</th><th>จำนวน</th><th style="width:40%"></th></tr></thead>
    <tbody>${data.map((d, i) => {
      const rc = i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : 'rank-default';
      const pct = max ? (d.cnt / max * 100) : 0;
      return `<tr>
        <td><span class="rank-num ${rc}">${i + 1}</span></td>
        <td><span class="rank-code">${escapeHtml(d[codeKey] || '—')}</span></td>
        <td>${escapeHtml(d[nameKey] || '—')}</td>
        <td class="rank-cnt">${Number(d.cnt).toLocaleString()}</td>
        <td><div class="bar-track"><div class="bar-fill ${RPT_COLORS[i % RPT_COLORS.length]}" style="width:${pct}%"></div></div></td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

/* ── Render: Growth by Country (stacked bars) ── */
function _renderGrowthCountry(data) {
  const el = document.getElementById('growthCountryChart');
  const legendEl = document.getElementById('growthCountryLegend');
  if (!data.length) { el.innerHTML = '<div class="report-empty">ไม่มีข้อมูล</div>'; legendEl.innerHTML = ''; return; }
  const pivot = {}, monthSet = [];
  const countries = new Set();
  for (const d of data) {
    if (!pivot[d.month]) { pivot[d.month] = {}; monthSet.push(d.month); }
    pivot[d.month][d.country_code] = Number(d.cnt);
    countries.add(d.country_code);
  }
  const months = [...new Set(monthSet)];
  const cList = [...countries];
  const maxTotal = Math.max(...months.map(m => cList.reduce((s, c) => s + (pivot[m][c] || 0), 0)));

  el.innerHTML = months.map(m => {
    const mTotal = cList.reduce((s, c) => s + (pivot[m][c] || 0), 0);
    const pct = maxTotal ? (mTotal / maxTotal * 100) : 0;
    const segs = cList.map((c, i) => {
      const val = pivot[m][c] || 0;
      if (!val) return '';
      const sp = mTotal ? (val / mTotal * 100) : 0;
      return `<div style="height:${sp}%;background:${RPT_RAW[i % RPT_RAW.length]};min-height:${val?1:0}px;" title="${c}: ${val.toLocaleString()}"></div>`;
    }).join('');
    return `<div class="growth-bar-wrap">
      <div style="width:100%;height:${Math.max(pct, 2)}%;display:flex;flex-direction:column;justify-content:flex-end;border-radius:4px 4px 0 0;overflow:hidden;cursor:pointer;position:relative;">
        ${segs}
        <div class="growth-tooltip">${m}: ${mTotal.toLocaleString()}</div>
      </div>
      <div class="growth-bar-label">${m.slice(2)}</div>
    </div>`;
  }).join('');

  legendEl.innerHTML = cList.slice(0, 8).map((c, i) =>
    `<span style="display:inline-flex;align-items:center;gap:4px;margin-right:12px;font-size:11px;">
      <span style="width:10px;height:10px;border-radius:50%;background:${RPT_RAW[i % RPT_RAW.length]};display:inline-block;"></span>
      ${FLAGS[c] || '🌐'} ${c}
    </span>`
  ).join('');
}

/* ── Init ── */
(async () => {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    showToast('กรุณาตั้งค่า Supabase ก่อน', 'error');
    return;
  }
  showLoading(true);

  // Default report range: ปีนี้
  const now = new Date();
  document.getElementById('rptFrom').value = `${now.getFullYear()}-01-01`;
  document.getElementById('rptTo').value = now.toISOString().slice(0, 10);

  await Promise.all([loadStats(), loadIssues(1), loadReports()]);
  showLoading(false);
})();
