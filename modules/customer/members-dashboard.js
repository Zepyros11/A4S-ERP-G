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
    { icon: '📝', label: 'ขาดชื่อบุคคล (full_name)', val: s.any_missing_fullname || 0 },
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
  body.innerHTML = `<tr><td colspan="7" class="dq-empty">⏳ กำลังโหลด...</td></tr>`;

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
      body.innerHTML = `<tr><td colspan="7" class="dq-empty"><div class="dq-empty-icon">✅</div>ไม่พบข้อมูลที่ตรงกับเงื่อนไข</td></tr>`;
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
        <td class="dq-actions">
          <button class="dq-btn" onclick="gotoMember('${r.member_code}')">👁️ ดู</button>
          <button class="dq-btn primary" onclick="gotoTree('${r.member_code}')">🌳 Tree</button>
        </td>
      </tr>`;
    }).join('');

    renderPaginate(totalIssueCount);
  } catch (e) {
    body.innerHTML = `<tr><td colspan="7" class="dq-empty">❌ ${escapeHtml(e.message)}</td></tr>`;
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

/* ── Init ── */
(async () => {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    showToast('กรุณาตั้งค่า Supabase ก่อน', 'error');
    return;
  }
  showLoading(true);
  await Promise.all([loadStats(), loadIssues(1)]);
  showLoading(false);
})();
