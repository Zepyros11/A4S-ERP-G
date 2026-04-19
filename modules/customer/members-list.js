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
let decryptMode = false;
let decryptedCache = {};
let _searchDebounce = null;

const PKG_BADGE = {
  DM: '💎 DM', SI: '⭐ SI', PL: '💠 PL', MB: '🎁 MB', EM: '🌟 EM',
};

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
    const cols = 'member_code,member_name,full_name,email,phone,password_encrypted,national_id_encrypted,package,sponsor_code,upline_code,side,registered_at,country_code';
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

/* ── Public entry — โหลดตารางก่อน (เร็ว) แล้ว stats ตามหลัง ── */
async function loadData() {
  page = 1;
  await loadPage();
  loadStats();  // fire-and-forget — ไม่ block หน้า
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
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;padding:40px;color:var(--text3)">ไม่พบข้อมูล</td></tr>`;
    document.getElementById('paginate').innerHTML = '';
    return;
  }

  const rows = currentPage;

  tbody.innerHTML = rows.map(m => {
    const pkg = m.package ? `<span class="pkg-badge pkg-${m.package}">${PKG_BADGE[m.package] || m.package}</span>` : '';
    const flag = m.country_code === 'KH' ? '🇰🇭' : (m.country_code === 'TH' ? '🇹🇭' : '🌐');
    const pwCell = m.password_encrypted
      ? (decryptMode
          ? `<span class="mask" data-code="${m.member_code}" data-field="password">⏳</span>`
          : '<span class="mask">••••••</span>')
      : '<span class="mask">—</span>';
    const idCell = m.national_id_encrypted
      ? (decryptMode
          ? `<span class="mask" data-code="${m.member_code}" data-field="national_id">⏳</span>`
          : '<span class="mask">x-xxxx-xxxxx-xx-x</span>')
      : '<span class="mask">—</span>';

    return `<tr>
      <td><span class="mem-code">${m.member_code || '—'}</span></td>
      <td>
        <div class="mem-name">${escapeHtml(window.MemberFmt ? MemberFmt.displayName(m) : (m.full_name || m.member_name || '—'))}</div>
        ${m.email ? `<div class="mem-contact">${escapeHtml(m.email)}</div>` : ''}
      </td>
      <td><span class="mem-code">${escapeHtml(m.phone || '—')}</span></td>
      <td>${idCell}</td>
      <td>${pwCell}</td>
      <td>${pkg}</td>
      <td><span class="mem-code">${escapeHtml(m.sponsor_code || '—')}</span></td>
      <td><span class="mem-code">${escapeHtml(m.upline_code || '—')}</span></td>
      <td>${escapeHtml(m.side || '—')}</td>
      <td>${DateFmt.formatDMY(m.registered_at) || '—'}</td>
      <td>${flag} ${m.country_code || ''}</td>
    </tr>`;
  }).join('');

  renderPaginate();

  // Decrypt cells in viewport if mode on
  if (decryptMode) decryptVisibleCells(rows);
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

/* ── Decrypt mode ── */
async function toggleDecrypt() {
  if (decryptMode) {
    // ปิดโหมด
    decryptMode = false;
    decryptedCache = {};
    document.getElementById('btnDecrypt').textContent = '🔓 ถอดรหัส';
    render();
    return;
  }
  // เปิดโหมด — ถ้ามี key อยู่แล้ว verify เลย ถ้าไม่มี open modal
  if (window.ERPCrypto && ERPCrypto.hasMasterKey()) {
    const ok = await ERPCrypto.verifyMasterKey();
    if (ok) { _enableDecrypt(); return; }
  }
  openMKModal();
}

function _enableDecrypt() {
  decryptMode = true;
  document.getElementById('btnDecrypt').textContent = '🔒 ปิดถอดรหัส';
  render();
}

/* ── Backfill password_hash from password_encrypted ──────────
   ใช้ครั้งเดียวหลัง migration 028 — ต้องมี master key เพื่อ decrypt
   password_encrypted ก่อน hash และ update กลับ
============================================================ */
async function backfillPasswordHash() {
  if (!window.ERPCrypto || !ERPCrypto.hasMasterKey()) {
    showToast('ต้องกด 🔓 ถอดรหัส ก่อน (เพื่อใส่ master key)', 'error');
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

async function confirmBackfill() {
  closeBackfillModal();
  const progOverlay = document.getElementById('backfillProgressOverlay');
  try {
    // Fetch ทุกแถวที่มี password_encrypted แต่ยังไม่มี password_hash
    showLoading(true);
    const cols = 'member_code,password_encrypted';
    const qs = `password_encrypted=not.is.null&password_hash=is.null&select=${cols}&limit=50000`;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/members?${qs}`, {
      headers: _sbHeaders({ 'Range-Unit': 'items', Range: '0-49999' }),
    });
    if (!res.ok) throw new Error('โหลด members ไม่สำเร็จ (' + res.status + ')');
    const rows = await res.json();
    showLoading(false);

    if (!rows.length) {
      showToast('ไม่มีแถวที่ต้อง backfill — ทุกคนมี password_hash แล้ว', 'success');
      return;
    }

    // Open progress modal
    document.getElementById('bfProgIcon').textContent = '🔁';
    document.getElementById('bfProgTitle').textContent = 'กำลัง Backfill...';
    document.getElementById('bfProgSub').textContent = 'กรุณารอ อย่าปิดหน้านี้';
    progOverlay.classList.add('open');

    const total = rows.length;
    let ok = 0, fail = 0;
    const startedAt = Date.now();
    _bfUpdate({ done: 0, total, ok, fail, startedAt });

    for (let i = 0; i < rows.length; i++) {
      const m = rows[i];
      try {
        const plain = await ERPCrypto.decrypt(m.password_encrypted);
        if (!plain) { fail++; }
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
          if (patchRes.ok) ok++; else fail++;
        }
      } catch {
        fail++;
      }
      _bfUpdate({ done: i + 1, total, ok, fail, startedAt });
    }

    // Done — swap to success state briefly, then close
    document.getElementById('bfProgIcon').textContent = fail ? '⚠️' : '✅';
    document.getElementById('bfProgTitle').textContent = 'Backfill เสร็จแล้ว';
    document.getElementById('bfProgSub').textContent = fail
      ? `สำเร็จ ${ok} · ผิดพลาด ${fail}`
      : `สำเร็จทั้งหมด ${ok} คน`;
    setTimeout(() => {
      progOverlay.classList.remove('open');
      showToast(
        `Backfill เสร็จ: สำเร็จ ${ok} คน${fail ? ` · ผิดพลาด ${fail}` : ''}`,
        fail ? 'error' : 'success'
      );
    }, 1800);
  } catch (e) {
    progOverlay.classList.remove('open');
    showLoading(false);
    showToast('Error: ' + e.message, 'error');
  }
}
window.confirmBackfill = confirmBackfill;

/* ── Master Key Modal ── */
function openMKModal() {
  const overlay = document.getElementById('mkModalOverlay');
  overlay.classList.add('open');
  const input = document.getElementById('mkInput');
  input.value = '';
  input.type = 'password';
  document.getElementById('mkEye').textContent = '👁️';
  document.getElementById('mkError').classList.remove('show');
  setTimeout(() => input.focus(), 50);
}
function closeMKModal() {
  document.getElementById('mkModalOverlay').classList.remove('open');
}
function toggleMKEye() {
  const inp = document.getElementById('mkInput');
  const eye = document.getElementById('mkEye');
  if (inp.type === 'password') { inp.type = 'text';     eye.textContent = '🙈'; }
  else                         { inp.type = 'password'; eye.textContent = '👁️'; }
}
async function confirmMK() {
  const key = document.getElementById('mkInput').value;
  const err = document.getElementById('mkError');
  err.classList.remove('show');
  if (!key || key.length < 8) {
    err.textContent = '❌ ต้องยาวอย่างน้อย 8 ตัวอักษร';
    err.classList.add('show');
    return;
  }
  try { ERPCrypto.setMasterKey(key); }
  catch (e) { err.textContent = '❌ ' + e.message; err.classList.add('show'); return; }

  const ok = await ERPCrypto.verifyMasterKey();
  if (!ok) {
    err.textContent = '❌ Master Key ไม่ถูกต้อง — ลองอีกครั้ง';
    err.classList.add('show');
    ERPCrypto.clearMasterKey();
    return;
  }
  closeMKModal();
  _enableDecrypt();
  showToast('🔓 ปลดล็อกแล้ว', 'success');
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

/* ── Init ── */
window.addEventListener('DOMContentLoaded', loadData);
