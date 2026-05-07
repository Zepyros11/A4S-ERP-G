/* ============================================================
   members-list.js — ตารางข้อมูลสมาชิก (server-side pagination)
   ============================================================ */

let SUPABASE_URL = localStorage.getItem('sb_url') || '';
let SUPABASE_KEY = localStorage.getItem('sb_key') || '';

let currentPage = [];         // rows ของหน้าปัจจุบัน (server-side paginated)
let allMembers = [];          // alias — ใช้ชื่อเดิมใน purge function
let totalRows = 0;            // total count จาก DB (หลัง filter)
let sortKey = 'registered_at';
let sortAsc = false;
let page = 1;
const PAGE_SIZE = 50;
let decryptedCache = {};

/* ── ถอดรหัสได้หรือไม่ — มี perm + master key ใน localStorage แล้ว ── */
function _canDecrypt() {
  return !!(window.AuthZ && AuthZ.hasPerm('member_decrypt')
         && window.ERPCrypto && ERPCrypto.hasMasterKey());
}
let _searchDebounce = null;
let activePositions = new Set();   // multi-select: empty = ทั้งหมด

const PKG_BADGE = {
  DM: '💎 DM', SI: '⭐ SI', PL: '💠 PL', MB: '🎁 MB', EM: '🌟 EM',
};

/* ── Country code → flag emoji + ชื่อภาษาไทย ── */
const COUNTRY_INFO = {
  TH:  { flag: '🇹🇭', name: 'ไทย' },
  KH:  { flag: '🇰🇭', name: 'Cambodia' },
  LA:  { flag: '🇱🇦', name: 'Laos' },
  MM:  { flag: '🇲🇲', name: 'Myanmar' },
  VN:  { flag: '🇻🇳', name: 'Vietnam' },
  MY:  { flag: '🇲🇾', name: 'Malaysia' },
  SG:  { flag: '🇸🇬', name: 'Singapore' },
  ID:  { flag: '🇮🇩', name: 'Indonesia' },
  PH:  { flag: '🇵🇭', name: 'Philippines' },
  CN:  { flag: '🇨🇳', name: 'China' },
  HK:  { flag: '🇭🇰', name: 'Hong Kong' },
  TW:  { flag: '🇹🇼', name: 'Taiwan' },
  JP:  { flag: '🇯🇵', name: 'Japan' },
  KR:  { flag: '🇰🇷', name: 'Korea' },
  IN:  { flag: '🇮🇳', name: 'India' },
  US:  { flag: '🇺🇸', name: 'USA' },
  GB:  { flag: '🇬🇧', name: 'UK' },
  AU:  { flag: '🇦🇺', name: 'Australia' },
  NG:  { flag: '🇳🇬', name: 'Nigeria' },
  CIV: { flag: '🇨🇮', name: 'Côte d\'Ivoire' },
  CI:  { flag: '🇨🇮', name: 'Côte d\'Ivoire' },
  GH:  { flag: '🇬🇭', name: 'Ghana' },
  KE:  { flag: '🇰🇪', name: 'Kenya' },
  ZA:  { flag: '🇿🇦', name: 'South Africa' },
  EG:  { flag: '🇪🇬', name: 'Egypt' },
  AE:  { flag: '🇦🇪', name: 'UAE' },
};
function _countryFlag(code) {
  return COUNTRY_INFO[code]?.flag || '🌐';
}
function _countryName(code) {
  return COUNTRY_INFO[code]?.name || code;
}

/* ── Supabase helper ── */
function _sbHeaders(extra = {}) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    ...extra,
  };
}

/* ── Build filter string จาก UI controls ── */
function _buildFilterQuery() {
  const parts = [];
  const q = (document.getElementById('searchInput').value || '').trim();
  const mode = document.getElementById('searchMode')?.dataset.value || 'all';
  const country = document.getElementById('filterCountry').value;
  const pkg = document.getElementById('filterPackage').value;

  if (country) parts.push(`country_code=eq.${encodeURIComponent(country)}`);
  if (pkg) parts.push(`package=eq.${encodeURIComponent(pkg)}`);
  if (activePositions.size > 0) {
    const list = Array.from(activePositions).map(encodeURIComponent).join(',');
    parts.push(`position_level=in.(${list})`);
  }

  if (q) {
    const esc = q.replace(/[,()*]/g, '');
    const like = `*${esc}*`;
    if (mode === 'all') {
      parts.push(`or=(member_code.ilike.${like},full_name.ilike.${like},member_name.ilike.${like},phone.ilike.${like},email.ilike.${like},sponsor_code.ilike.${like},upline_code.ilike.${like})`);
    } else if (mode === 'full_name') {
      // ชื่อ — ค้นทั้ง full_name + member_name
      parts.push(`or=(full_name.ilike.${like},member_name.ilike.${like})`);
    } else if (mode === 'member_code') {
      // รหัสสมาชิก — exact match
      parts.push(`member_code=eq.${encodeURIComponent(esc)}`);
    } else {
      // Specific field — sponsor_code / upline_code / phone / email
      parts.push(`${mode}=ilike.${like}`);
    }
  }
  return parts.join('&');
}

/* ── Custom search mode dropdown ── */
function toggleSearchMode(e) {
  if (e) e.stopPropagation();
  document.getElementById('searchMode').classList.toggle('open');
}
function selectSearchMode(btn) {
  const value = btn.dataset.value;
  const icon  = btn.dataset.icon;
  const label = btn.dataset.label;
  const wrap  = document.getElementById('searchMode');
  wrap.dataset.value = value;
  wrap.classList.remove('open');
  wrap.querySelector('.search-mode-icon').textContent = icon;
  wrap.querySelector('.search-mode-label').textContent = label;
  wrap.querySelectorAll('.search-mode-option').forEach(o => {
    o.classList.toggle('active', o.dataset.value === value);
  });
  applyFilter();
}
// Close dropdown on outside click
document.addEventListener('click', (e) => {
  const dd = document.getElementById('searchMode');
  if (dd && !dd.contains(e.target)) dd.classList.remove('open');
});

/* ── Clear search ── */
function clearSearch() {
  document.getElementById('searchInput').value = '';
  _updateSearchClearBtn();
  page = 1;
  loadPage();
  loadStats();
}
function _updateSearchClearBtn() {
  const btn = document.getElementById('searchClear');
  const hasValue = document.getElementById('searchInput').value.trim().length > 0;
  btn.classList.toggle('show', hasValue);
}

/* ── Load stats via RPC (single SQL call, fast) ── */
async function loadStats() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/member_stats`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const s = await res.json();
    document.getElementById('statTotal').textContent    = (s.total || 0).toLocaleString();
    document.getElementById('statTH').textContent       = (s.th || 0).toLocaleString();
    document.getElementById('statKH').textContent       = (s.kh || 0).toLocaleString();
    document.getElementById('statThisYear').textContent = (s.this_year || 0).toLocaleString();
    totalRows = s.total || 0;
    renderPaginate();
  } catch {
    // Fallback: ใช้ reltuples (approximate, instant)
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/member_stats_fast`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
      if (res.ok) {
        const s = await res.json();
        document.getElementById('statTotal').textContent = (s.total || 0).toLocaleString();
        totalRows = s.total || 0;
        renderPaginate();
      }
    } catch {}
  }
}

/* ── Load current page (50 rows) ── */
async function loadPage() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    showToast('ยังไม่ได้ตั้งค่า Supabase', 'error');
    return;
  }
  showLoading(true);
  try {
    const filter = _buildFilterQuery();
    const from = (page - 1) * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const cols = 'member_code,member_name,full_name,co_applicant_name,email,phone,password_encrypted,national_id_encrypted,package,position_level,sponsor_code,upline_code,side,registered_at,country_code';
    const url = `${SUPABASE_URL}/rest/v1/members?select=${cols}${filter ? '&' + filter : ''}&order=${sortKey}.${sortAsc ? 'asc' : 'desc'}`;

    const res = await fetch(url + `&limit=${PAGE_SIZE}&offset=${from}`, {
      headers: _sbHeaders(),
    });
    if (!res.ok) throw new Error(await res.text());
    currentPage = await res.json();
    allMembers = currentPage;
    render();
  } catch (e) {
    showToast('โหลดไม่ได้: ' + e.message, 'error');
  }
  showLoading(false);
}

/* ── โหลดประเทศที่มีจริงใน DB → populate dropdown ── */
async function loadCountries() {
  const sel = document.getElementById('filterCountry');
  if (!sel) return;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/member_countries`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    if (!res.ok) return;
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) return;
    const prev = sel.value;
    const opts = ['<option value="">ทุกประเทศ</option>'];
    for (const r of rows) {
      const code = r.code;
      const name = _countryName(code);
      const flag = _countryFlag(code);
      const cnt  = (r.cnt || 0).toLocaleString();
      opts.push(`<option value="${escapeHtml(code)}">${flag} ${escapeHtml(name)} (${cnt})</option>`);
    }
    sel.innerHTML = opts.join('');
    if (prev) sel.value = prev;
  } catch {}
}

/* ── Load last-run date ของ automation "Export All Member" ── */
async function loadLastSyncInfo() {
  const el = document.getElementById('lastSyncDate');
  const box = document.getElementById('syncInfo');
  if (!el) return;
  try {
    const url = `${SUPABASE_URL}/rest/v1/automation_tasks?select=last_run_at&name=eq.Export%20All%20Member&limit=1`;
    const res = await fetch(url, { headers: _sbHeaders() });
    if (!res.ok) return;
    const rows = await res.json();
    const iso = rows?.[0]?.last_run_at;
    if (iso) {
      el.textContent = DateFmt.formatDMYTime(iso);
      // เตือนถ้า > 36 ชั่วโมง (automation รันทุก 24h)
      const hrs = (Date.now() - new Date(iso).getTime()) / 36e5;
      if (box) box.classList.toggle('stale', hrs > 36);
    } else {
      el.textContent = 'ยังไม่เคยรัน';
      if (box) box.classList.add('stale');
    }
  } catch {}
}

/* ── Public entry — โหลดตารางก่อน (เร็ว) แล้ว stats ตามหลัง ── */
async function loadData() {
  page = 1;
  await loadPage();
  loadStats();          // fire-and-forget
  loadCountries();      // fire-and-forget — populate filter dropdown
  loadLastSyncInfo();   // fire-and-forget — last run ของ Export All Member
}

/* ── Search / filter handlers (server-side) ── */
function onSearch() {
  _updateSearchClearBtn();
  clearTimeout(_searchDebounce);
  _searchDebounce = setTimeout(() => { page = 1; loadPage(); loadStats(); }, 300);
}
function applyFilter() {
  page = 1;
  loadPage();
  loadStats();
}

function sortBy(key) {
  if (sortKey === key) sortAsc = !sortAsc;
  else { sortKey = key; sortAsc = true; }
  loadPage();
}

function gotoPage(n) {
  const newPage = Math.max(1, n);
  if (totalRows > 0) {
    const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
    if (newPage > totalPages) return;
  }
  if (newPage === page) return;
  page = newPage;
  loadPage();
}

/* ── Render table ── */
function render() {
  const tbody = document.getElementById('tbody');
  if (!currentPage.length) {
    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:40px;color:var(--text3)">ไม่พบข้อมูล</td></tr>`;
    document.getElementById('paginate').innerHTML = '';
    return;
  }

  const rows = currentPage;
  const canDecrypt = _canDecrypt();

  tbody.innerHTML = rows.map(m => {
    const pos = m.position_level ? `<span class="pkg-badge pos-badge">⭐ ${escapeHtml(m.position_level)}</span>` : '';
    const flag = _countryFlag(m.country_code);
    const pwCell = m.password_encrypted
      ? (canDecrypt
          ? `<span class="mask" data-code="${m.member_code}" data-field="password">⏳</span>`
          : '<span class="mask">••••••</span>')
      : '<span class="mask">—</span>';
    const idCell = m.national_id_encrypted
      ? (canDecrypt
          ? `<span class="mask" data-code="${m.member_code}" data-field="national_id">⏳</span>`
          : '<span class="mask">x-xxxx-xxxxx-xx-x</span>')
      : '<span class="mask">—</span>';

    return `<tr>
      <td><span class="mem-code">${m.member_code || '—'}</span></td>
      <td>
        <div class="mem-name">${escapeHtml(window.MemberFmt ? MemberFmt.displayName(m) : (m.full_name || m.member_name || '—'))}</div>
        ${m.email ? `<div class="mem-contact">${escapeHtml(m.email)}</div>` : ''}
      </td>
      <td>${m.co_applicant_name ? `<span class="mem-name">${escapeHtml(m.co_applicant_name)}</span>` : '<span class="mask">—</span>'}</td>
      <td><span class="mem-code">${escapeHtml(m.phone || '—')}</span></td>
      <td>${idCell}</td>
      <td>${pwCell}</td>
      <td>${pos}</td>
      <td><span class="mem-code">${escapeHtml(m.sponsor_code || '—')}</span></td>
      <td><span class="mem-code">${escapeHtml(m.upline_code || '—')}</span></td>
      <td>${escapeHtml(m.side || '—')}</td>
      <td>${DateFmt.formatDMY(m.registered_at) || '—'}</td>
      <td>${flag} ${m.country_code || ''}</td>
    </tr>`;
  }).join('');

  renderPaginate();

  // Auto-decrypt cells if user has permission + master key
  if (canDecrypt) decryptVisibleCells(rows);
}

function renderPaginate() {
  const pag = document.getElementById('paginate');
  const hasMore = currentPage.length >= PAGE_SIZE;

  // ถ้า totalRows ยังไม่รู้ (RPC ยังไม่เสร็จ) ใช้ next/prev อย่างเดียว
  if (totalRows > 0) {
    const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
    if (totalPages <= 1 && page === 1) { pag.innerHTML = ''; return; }
    const parts = [];
    parts.push(`<button onclick="gotoPage(1)" ${page===1?'disabled':''}>« แรก</button>`);
    parts.push(`<button onclick="gotoPage(${page-1})" ${page===1?'disabled':''}>‹ ก่อน</button>`);
    parts.push(`<span class="paginate-info">หน้า ${page} / ${totalPages.toLocaleString()} · ทั้งหมด ${totalRows.toLocaleString()}</span>`);
    parts.push(`<button onclick="gotoPage(${page+1})" ${page>=totalPages?'disabled':''}>ถัด ›</button>`);
    parts.push(`<button onclick="gotoPage(${totalPages})" ${page>=totalPages?'disabled':''}>ท้าย »</button>`);
    pag.innerHTML = parts.join('');
  } else {
    // Fallback: next/prev only
    if (page === 1 && !hasMore) { pag.innerHTML = ''; return; }
    const parts = [];
    parts.push(`<button onclick="gotoPage(${page-1})" ${page===1?'disabled':''}>‹ ก่อน</button>`);
    parts.push(`<span class="paginate-info">หน้า ${page}</span>`);
    parts.push(`<button onclick="gotoPage(${page+1})" ${!hasMore?'disabled':''}>ถัด ›</button>`);
    pag.innerHTML = parts.join('');
  }
}

/* ── Backfill password_hash from password_encrypted ──────────
   ใช้ครั้งเดียวหลัง migration 028 — ต้องมี master key เพื่อ decrypt
   password_encrypted ก่อน hash และ update กลับ
============================================================ */
async function backfillPasswordHash() {
  if (!window.ERPCrypto || !ERPCrypto.hasMasterKey()) {
    showToast('ยังไม่ได้ตั้ง master key — ตั้งที่หน้า import ก่อน', 'error');
    return;
  }
  const okKey = await ERPCrypto.verifyMasterKey();
  if (!okKey) {
    showToast('Master key ไม่ถูกต้อง', 'error');
    return;
  }
  document.getElementById('backfillModalOverlay').classList.add('open');
}
window.backfillPasswordHash = backfillPasswordHash;

function closeBackfillModal() {
  document.getElementById('backfillModalOverlay').classList.remove('open');
}
window.closeBackfillModal = closeBackfillModal;

function _bfFmtEta(ms) {
  if (!isFinite(ms) || ms <= 0) return '—';
  const s = Math.ceil(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60), sec = s % 60;
  return `${m}m ${sec}s`;
}

function _bfUpdate({ done, total, ok, fail, startedAt }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  document.getElementById('bfProgBar').style.width = pct + '%';
  document.getElementById('bfProgCount').textContent = `${done} / ${total}`;
  document.getElementById('bfProgPct').textContent = pct + '%';
  document.getElementById('bfProgOk').textContent = ok;
  document.getElementById('bfProgFail').textContent = fail;
  if (done > 0 && done < total) {
    const elapsed = Date.now() - startedAt;
    const avg = elapsed / done;
    document.getElementById('bfProgEta').textContent = _bfFmtEta(avg * (total - done));
  } else {
    document.getElementById('bfProgEta').textContent = done >= total ? '0s' : '—';
  }
}

let _bfCancelled = false;

async function _bfFetchTotalCount() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/members?password_encrypted=not.is.null&password_hash=is.null&select=member_code`,
    { headers: _sbHeaders({ Prefer: 'count=exact', Range: '0-0' }) }
  );
  const range = res.headers.get('content-range') || '*/0';
  return parseInt(range.split('/')[1], 10) || 0;
}

async function _bfFetchBatch(limit = 1000) {
  const cols = 'member_code,password_encrypted';
  const qs = `password_encrypted=not.is.null&password_hash=is.null&select=${cols}&limit=${limit}&order=member_code.asc`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/members?${qs}`, {
    headers: _sbHeaders(),
  });
  if (!res.ok) throw new Error('โหลด batch ไม่สำเร็จ (' + res.status + ')');
  return res.json();
}

async function confirmBackfill() {
  closeBackfillModal();
  const progOverlay = document.getElementById('backfillProgressOverlay');
  _bfCancelled = false;

  try {
    showLoading(true);
    const total = await _bfFetchTotalCount();
    showLoading(false);

    if (!total) {
      showToast('ไม่มีแถวที่ต้อง backfill — ทุกคนมี password_hash แล้ว', 'success');
      return;
    }

    // Open progress modal
    document.getElementById('bfProgIcon').textContent = '🔁';
    document.getElementById('bfProgTitle').textContent = `กำลัง Backfill... (auto-loop)`;
    document.getElementById('bfProgSub').textContent = `รวม ${total.toLocaleString()} คน · อย่าปิด/refresh หน้านี้`;
    progOverlay.classList.add('open');
    _ensureCancelBtn();

    let overallDone = 0, overallOk = 0, overallFail = 0;
    const startedAt = Date.now();
    _bfUpdate({ done: 0, total, ok: 0, fail: 0, startedAt });

    // Auto-loop through batches of 1000 until empty
    while (!_bfCancelled) {
      const rows = await _bfFetchBatch(1000);
      if (!rows.length) break;                    // nothing left — done

      for (let i = 0; i < rows.length && !_bfCancelled; i++) {
        const m = rows[i];
        try {
          const plain = await ERPCrypto.decrypt(m.password_encrypted);
          if (!plain) { overallFail++; }
          else {
            const h = await ERPCrypto.hash(plain);
            const patchRes = await fetch(
              `${SUPABASE_URL}/rest/v1/members?member_code=eq.${encodeURIComponent(m.member_code)}`,
              {
                method: 'PATCH',
                headers: _sbHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ password_hash: h }),
              }
            );
            if (patchRes.ok) overallOk++; else overallFail++;
          }
        } catch {
          overallFail++;
        }
        overallDone++;
        if (overallDone % 10 === 0 || overallDone === total) {
          _bfUpdate({ done: overallDone, total, ok: overallOk, fail: overallFail, startedAt });
        }
      }
      // final update per batch
      _bfUpdate({ done: overallDone, total, ok: overallOk, fail: overallFail, startedAt });
    }

    // Done (or cancelled)
    const finalIcon = _bfCancelled ? '🛑' : (overallFail ? '⚠️' : '✅');
    const finalTitle = _bfCancelled ? 'ยกเลิกแล้ว' : 'Backfill เสร็จแล้ว';
    document.getElementById('bfProgIcon').textContent = finalIcon;
    document.getElementById('bfProgTitle').textContent = finalTitle;
    document.getElementById('bfProgSub').textContent = overallFail
      ? `สำเร็จ ${overallOk.toLocaleString()} · ผิดพลาด ${overallFail.toLocaleString()}`
      : `สำเร็จทั้งหมด ${overallOk.toLocaleString()} คน`;
    setTimeout(() => {
      progOverlay.classList.remove('open');
      showToast(
        `Backfill ${_bfCancelled ? 'ยกเลิก' : 'เสร็จ'}: สำเร็จ ${overallOk.toLocaleString()}${overallFail ? ` · ผิดพลาด ${overallFail}` : ''}`,
        overallFail ? 'error' : 'success'
      );
    }, 2000);
  } catch (e) {
    progOverlay.classList.remove('open');
    showLoading(false);
    showToast('Error: ' + e.message, 'error');
  }
}
window.confirmBackfill = confirmBackfill;

function _ensureCancelBtn() {
  if (document.getElementById('bfCancelBtn')) return;
  const sub = document.getElementById('bfProgSub');
  if (!sub) return;
  const btn = document.createElement('button');
  btn.id = 'bfCancelBtn';
  btn.textContent = '🛑 หยุด';
  btn.style.cssText = 'margin-top:12px;padding:6px 14px;border:none;border-radius:8px;background:#fee2e2;color:#991b1b;font-weight:700;cursor:pointer;font-size:12px';
  btn.onclick = () => {
    _bfCancelled = true;
    btn.textContent = '⏳ กำลังหยุด...';
    btn.disabled = true;
  };
  sub.parentElement.appendChild(btn);
}

async function decryptVisibleCells(rows) {
  for (const m of rows) {
    const code = m.member_code;
    if (!decryptedCache[code]) decryptedCache[code] = {};
    if (m.password_encrypted && decryptedCache[code].password === undefined) {
      try { decryptedCache[code].password = await ERPCrypto.decrypt(m.password_encrypted); }
      catch { decryptedCache[code].password = '⚠️ error'; }
    }
    if (m.national_id_encrypted && decryptedCache[code].national_id === undefined) {
      try { decryptedCache[code].national_id = await ERPCrypto.decrypt(m.national_id_encrypted); }
      catch { decryptedCache[code].national_id = '⚠️ error'; }
    }
    document.querySelectorAll(`[data-code="${CSS.escape(code)}"]`).forEach(el => {
      const field = el.getAttribute('data-field');
      el.textContent = decryptedCache[code][field] ?? '—';
      el.classList.remove('mask');
    });
  }
}

/* ── Utils ── */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}
function showLoading(on) {
  document.getElementById('loadingOverlay').style.display = on ? 'flex' : 'none';
}
function showToast(msg, type='info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show toast-${type}`;
  setTimeout(() => t.className = 'toast', 3500);
}

/* ============================================================
   PURGE ALL MEMBERS
   ============================================================ */
const PURGE_CONFIRM_TEXT = 'ลบทั้งหมด';

function openPurgeModal() {
  document.getElementById('pgCount').textContent = totalRows.toLocaleString();
  const inp = document.getElementById('pgConfirmInput');
  inp.value = '';
  inp.classList.remove('match');
  document.getElementById('btnConfirmPurge').disabled = true;
  document.getElementById('purgeModalOverlay').classList.add('open');
  setTimeout(() => inp.focus(), 50);
}
function closePurgeModal() {
  document.getElementById('purgeModalOverlay').classList.remove('open');
}
function onPgInput() {
  const inp = document.getElementById('pgConfirmInput');
  const match = inp.value.trim() === PURGE_CONFIRM_TEXT;
  inp.classList.toggle('match', match);
  document.getElementById('btnConfirmPurge').disabled = !match;
}
async function confirmPurge() {
  const btn = document.getElementById('btnConfirmPurge');
  const countBeforeDelete = totalRows;
  btn.disabled = true;
  btn.textContent = '⏳ กำลังลบ...';
  showLoading(true);

  // sync_log: start
  let logId = null;
  try {
    const lr = await fetch(`${SUPABASE_URL}/rest/v1/sync_log`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json', 'Prefer': 'return=representation',
      },
      body: JSON.stringify([{
        source: 'purge_all',
        rows_total: countBeforeDelete,
        status: 'running',
        triggered_by: window.ERP_USER?.user_id || 'unknown',
      }]),
    });
    const d = await lr.json();
    logId = d?.[0]?.id;
  } catch {}

  const startTime = Date.now();
  let deleted = 0, err = null;
  try {
    // DELETE all — PostgREST requires a filter; use "neq.__impossible_value__"
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/members?member_code=neq.__never_exists__`,
      {
        method: 'DELETE',
        headers: {
          apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
          'Prefer': 'return=minimal',
        },
      }
    );
    if (!res.ok) throw new Error(await res.text());
    deleted = countBeforeDelete;
  } catch (e) {
    err = e.message;
  }
  const dur = Math.round((Date.now() - startTime) / 1000);

  // sync_log: finish
  if (logId) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/sync_log?id=eq.${logId}`, {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          finished_at: new Date().toISOString(),
          duration_sec: dur,
          rows_inserted: 0,
          rows_failed: err ? 1 : 0,
          status: err ? 'failed' : 'success',
          error_message: err,
        }),
      });
    } catch {}
  }

  showLoading(false);
  closePurgeModal();

  if (err) {
    showToast('ลบไม่สำเร็จ: ' + err.slice(0, 100), 'error');
  } else {
    currentPage = [];
    allMembers = [];
    totalRows = 0;
    page = 1;
    await loadData();
    showToast(`🗑️ ลบ ${deleted.toLocaleString()} สมาชิก เสร็จใน ${dur}s`, 'success');
  }
  btn.textContent = '🗑️ ลบทั้งหมด';
}

/* ============================================================
   POSITION FILTER (multi-select chips)
   ============================================================ */
function togglePos(btn, pos) {
  if (pos === '') {
    activePositions.clear();
  } else {
    if (activePositions.has(pos)) activePositions.delete(pos);
    else activePositions.add(pos);
  }
  _updatePosChips();
  applyFilter();
}
window.togglePos = togglePos;

function _updatePosChips() {
  document.querySelectorAll('.pos-chip').forEach(b => {
    const p = b.dataset.pos;
    if (p === '') b.classList.toggle('active', activePositions.size === 0);
    else b.classList.toggle('active', activePositions.has(p));
  });
  const cnt = document.getElementById('posFilterCount');
  if (cnt) {
    cnt.textContent = activePositions.size > 0
      ? `เลือก ${activePositions.size} ตำแหน่ง: ${Array.from(activePositions).join(', ')}`
      : '';
  }
}

/* ============================================================
   EXPORT EXCEL — ใช้ filter ปัจจุบัน, paginate ทุก row
   ============================================================ */
async function exportExcel() {
  if (typeof XLSX === 'undefined') {
    showToast('XLSX library ยังไม่โหลด — ลองรีเฟรช', 'error');
    return;
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    showToast('ยังไม่ได้ตั้งค่า Supabase', 'error');
    return;
  }

  const btn = document.getElementById('btnExport');
  const oldLabel = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '⏳ นับจำนวน...'; }
  showLoading(true);

  try {
    const filter = _buildFilterQuery();
    const cols = 'member_code,member_name,full_name,co_applicant_name,phone,email,package,position_level,position,sponsor_code,upline_code,side,registered_at,country_code';
    const baseUrl = `${SUPABASE_URL}/rest/v1/members?select=${cols}${filter ? '&' + filter : ''}&order=${sortKey}.${sortAsc ? 'asc' : 'desc'}`;

    // Count จริงตาม filter ก่อน (ใช้ count=exact + Range 0-0)
    const countRes = await fetch(`${baseUrl}&limit=1`, {
      headers: _sbHeaders({ Prefer: 'count=exact', Range: '0-0' }),
    });
    if (!countRes.ok) throw new Error(await countRes.text());
    const range = countRes.headers.get('content-range') || '*/0';
    const filteredCount = parseInt(range.split('/')[1], 10) || 0;

    if (!filteredCount) {
      showToast('ไม่มีข้อมูลให้ export', 'error');
      return;
    }

    // Confirm ถ้า > 5,000 row
    if (filteredCount > 5000 && window.ConfirmModal) {
      showLoading(false);
      if (btn) btn.innerHTML = oldLabel;
      const ok = await ConfirmModal.open({
        title: '📤 Export Excel',
        message: `จะ export สมาชิก ${filteredCount.toLocaleString()} รายการ\nอาจใช้เวลาหลายวินาที`,
        icon: '📤',
        okText: 'ดำเนินการต่อ',
        tone: 'primary',
      });
      if (!ok) {
        if (btn) btn.disabled = false;
        return;
      }
      showLoading(true);
      if (btn) { btn.disabled = true; btn.innerHTML = '⏳ กำลังโหลด...'; }
    }

    const BATCH = 1000;
    let from = 0;
    const rows = [];
    while (true) {
      const res = await fetch(`${baseUrl}&limit=${BATCH}&offset=${from}`, { headers: _sbHeaders() });
      if (!res.ok) throw new Error(await res.text());
      const batch = await res.json();
      rows.push(...batch);
      if (btn) btn.innerHTML = `⏳ ${rows.length.toLocaleString()} / ${filteredCount.toLocaleString()}`;
      if (batch.length < BATCH) break;
      from += BATCH;
    }

    if (!rows.length) {
      showToast('ไม่มีข้อมูลให้ export', 'error');
      return;
    }

    const out = rows.map(m => ({
      'รหัสสมาชิก'    : m.member_code || '',
      'ชื่อ-นามสกุล'   : window.MemberFmt ? MemberFmt.displayName(m) : (m.full_name || m.member_name || ''),
      'ชื่อคู่สมัคร'   : m.co_applicant_name || '',
      'เบอร์โทร'      : m.phone || '',
      'Email'         : m.email || '',
      'Package'       : m.package || '',
      'ตำแหน่งสูงสุด' : m.position_level || '',
      'ตำแหน่งปัจจุบัน': m.position || '',
      'Sponsor'       : m.sponsor_code || '',
      'Upline'        : m.upline_code || '',
      'ด้าน'          : m.side || '',
      'วันที่สมัคร'    : (window.DateFmt && DateFmt.formatDMY(m.registered_at)) || m.registered_at || '',
      'ประเทศ'        : m.country_code || '',
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(out);
    ws['!cols'] = [
      {wch:12},{wch:32},{wch:32},{wch:14},{wch:26},{wch:8},
      {wch:14},{wch:14},{wch:12},{wch:12},{wch:8},
      {wch:12},{wch:8},
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Members');

    // ตั้งชื่อไฟล์ — date + filter summary
    const today = new Date().toISOString().slice(0, 10);
    const tag = [];
    if (activePositions.size > 0) tag.push(Array.from(activePositions).join('-'));
    const country = document.getElementById('filterCountry')?.value;
    const pkg = document.getElementById('filterPackage')?.value;
    if (country) tag.push(country);
    if (pkg) tag.push(pkg);
    const suffix = tag.length ? '_' + tag.join('_') : '';

    XLSX.writeFile(wb, `members_${today}${suffix}.xlsx`);
    showToast(`📤 Export ${rows.length.toLocaleString()} รายการสำเร็จ`, 'success');
  } catch (e) {
    showToast('Export ไม่สำเร็จ: ' + (e.message || e), 'error');
  } finally {
    showLoading(false);
    if (btn) { btn.disabled = false; btn.innerHTML = oldLabel; }
  }
}
window.exportExcel = exportExcel;

/* ── Init ── */
window.addEventListener('DOMContentLoaded', loadData);
