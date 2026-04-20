/* ============================================================
   line-members.js — Dashboard รายชื่อสมาชิกที่เชื่อม LINE แล้ว
   (ไม่ผูกกับ event / check-in / payment — แยกจาก attendees)
   ============================================================ */

const SB_URL = localStorage.getItem('sb_url') || '';
const SB_KEY = localStorage.getItem('sb_key') || '';

let _rows = [];
let _filtered = [];
let _page = 1;
const PAGE_SIZE = 50;
let _totalMembers = 0;
let _searchDebounce = null;

function _sbHeaders(extra = {}) {
  return { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, ...extra };
}

async function _sbGet(path, opts = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: _sbHeaders(opts.extra || {}) });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text().catch(() => '')}`);
  return res.json();
}

/* ── Load all linked members from Supabase ── */
async function loadData() {
  if (!SB_URL || !SB_KEY) {
    showToast('ยังไม่ได้ตั้งค่า Supabase', 'error');
    return;
  }
  showLoading(true);
  try {
    // 1) Fetch members with line_user_id (primary/current)
    //    Join with member_line_accounts for last_active_at
    const cols = 'member_code,full_name,member_name,phone,line_user_id,line_display_name,line_picture_url,line_linked_at';
    const rows = await _sbGet(
      `members?line_user_id=not.is.null&select=${cols}&order=line_linked_at.desc.nullslast&limit=5000`,
    );
    _rows = rows || [];

    // 2) Fetch last_active_at from member_line_accounts for those members
    if (_rows.length) {
      const codes = _rows.map(r => r.member_code).filter(Boolean);
      const inList = codes.map(c => encodeURIComponent(c)).join(',');
      try {
        const lastActive = await _sbGet(
          `member_line_accounts?member_code=in.(${inList})&is_active=eq.true&select=member_code,line_user_id,last_active_at&order=last_active_at.desc`,
        );
        // Map by (member_code, line_user_id)
        const mapKey = (a, b) => `${a}:${b}`;
        const byKey = {};
        (lastActive || []).forEach(r => {
          const k = mapKey(r.member_code, r.line_user_id);
          if (!byKey[k]) byKey[k] = r.last_active_at;
        });
        _rows.forEach(r => {
          r.last_active_at = byKey[mapKey(r.member_code, r.line_user_id)] || r.line_linked_at;
        });
      } catch (e) {
        console.warn('load last_active failed:', e.message);
      }
    }

    // 3) Fetch total members count (exact)
    try {
      const countRes = await fetch(`${SB_URL}/rest/v1/members?select=member_code`, {
        headers: _sbHeaders({ Prefer: 'count=exact', Range: '0-0' }),
      });
      const range = countRes.headers.get('content-range') || '*/0';
      _totalMembers = parseInt(range.split('/')[1], 10) || 0;
    } catch {}

    _page = 1;
    applyFilter();
    updateStats();
  } catch (e) {
    showToast('โหลดข้อมูลไม่ได้: ' + e.message, 'error');
  }
  showLoading(false);
}

/* ── Stats update ── */
function updateStats() {
  document.getElementById('lmTotalLinked').textContent = _rows.length.toLocaleString();

  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const recent = _rows.filter(r => {
    if (!r.line_linked_at) return false;
    return (now - new Date(r.line_linked_at).getTime()) < sevenDays;
  }).length;
  document.getElementById('lmRecent7').textContent = recent.toLocaleString();

  document.getElementById('lmTotalMembers').textContent = _totalMembers.toLocaleString();
  const coverage = _totalMembers ? ((_rows.length / _totalMembers) * 100).toFixed(2) : '—';
  document.getElementById('lmCoverage').textContent = `${coverage}% ของสมาชิกทั้งหมด`;
}

/* ── Filter + search ── */
function applyFilter() {
  const q = (document.getElementById('lmSearchInput').value || '').trim().toLowerCase();
  _filtered = !q ? _rows.slice() : _rows.filter(r =>
    (r.member_code || '').toLowerCase().includes(q) ||
    (r.full_name || '').toLowerCase().includes(q) ||
    (r.member_name || '').toLowerCase().includes(q) ||
    (r.line_display_name || '').toLowerCase().includes(q) ||
    (r.phone || '').toLowerCase().includes(q)
  );
  _page = 1;
  render();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('lmSearchInput').addEventListener('input', (e) => {
    const btn = document.getElementById('lmSearchClear');
    btn.classList.toggle('show', !!e.target.value);
    clearTimeout(_searchDebounce);
    _searchDebounce = setTimeout(applyFilter, 200);
  });
  loadData();
});

window.clearSearch = function () {
  document.getElementById('lmSearchInput').value = '';
  document.getElementById('lmSearchClear').classList.remove('show');
  applyFilter();
};

window.refresh = function () {
  loadData();
};

/* ── Render table + paginate ── */
function render() {
  const tbody = document.getElementById('lmTableBody');
  if (!_filtered.length) {
    tbody.innerHTML = `
      <tr><td colspan="7">
        <div class="lm-empty">
          <div class="lm-empty-icon">💬</div>
          <div style="font-size:14px;font-weight:600;color:var(--text2)">ยังไม่มีสมาชิกที่เชื่อม LINE</div>
          <div style="font-size:12px;margin-top:4px">บอกสมาชิกให้ add @949bctau แล้วส่งรหัสสมาชิกในแชท</div>
        </div>
      </td></tr>`;
    document.getElementById('lmPaginate').innerHTML = '';
    return;
  }

  const totalPages = Math.max(1, Math.ceil(_filtered.length / PAGE_SIZE));
  if (_page > totalPages) _page = totalPages;
  const start = (_page - 1) * PAGE_SIZE;
  const pageRows = _filtered.slice(start, start + PAGE_SIZE);

  tbody.innerHTML = pageRows.map(r => {
    const name = esc(r.full_name || r.member_name || '—');
    const avatar = r.line_picture_url
      ? `<img src="${escAttr(r.line_picture_url)}" alt="">`
      : (r.line_display_name || name).charAt(0).toUpperCase();
    return `<tr>
      <td><div class="lm-avatar">${avatar}</div></td>
      <td><span class="lm-member-code">${esc(r.member_code || '')}</span></td>
      <td><div class="lm-name">${name}</div></td>
      <td><span class="lm-line-name">${esc(r.line_display_name || '—')}</span></td>
      <td><span class="lm-phone">${esc(r.phone || '—')}</span></td>
      <td>
        <div class="lm-date">${formatDateThai(r.line_linked_at)}</div>
        ${r.last_active_at ? `<div class="lm-relative ${isStale(r.last_active_at) ? 'stale' : ''}">Active: ${relativeTime(r.last_active_at)}</div>` : ''}
      </td>
      <td><button class="lm-action" onclick="copyUserId('${escAttr(r.line_user_id)}')" title="Copy LINE User ID">📋 ID</button></td>
    </tr>`;
  }).join('');

  renderPaginate(totalPages);
}

function renderPaginate(totalPages) {
  const el = document.getElementById('lmPaginate');
  if (totalPages <= 1) { el.innerHTML = `<div class="lm-paginate-info">แสดง ${_filtered.length} รายการ</div>`; return; }
  const btns = [];
  btns.push(`<button ${_page === 1 ? 'disabled' : ''} onclick="goPage(1)">«</button>`);
  btns.push(`<button ${_page === 1 ? 'disabled' : ''} onclick="goPage(${_page - 1})">‹</button>`);
  const maxBtns = 5;
  let startP = Math.max(1, _page - Math.floor(maxBtns / 2));
  let endP = Math.min(totalPages, startP + maxBtns - 1);
  startP = Math.max(1, endP - maxBtns + 1);
  for (let i = startP; i <= endP; i++) {
    btns.push(`<button class="${i === _page ? 'active' : ''}" onclick="goPage(${i})">${i}</button>`);
  }
  btns.push(`<button ${_page === totalPages ? 'disabled' : ''} onclick="goPage(${_page + 1})">›</button>`);
  btns.push(`<button ${_page === totalPages ? 'disabled' : ''} onclick="goPage(${totalPages})">»</button>`);
  btns.push(`<span class="lm-paginate-info">หน้า ${_page}/${totalPages} · รวม ${_filtered.length.toLocaleString()} รายการ</span>`);
  el.innerHTML = btns.join('');
}

window.goPage = function (p) {
  _page = p;
  render();
};

window.copyUserId = async function (uid) {
  try {
    await navigator.clipboard.writeText(uid);
    showToast('Copy LINE User ID แล้ว 📋', 'success');
  } catch {
    showToast('Copy ไม่ได้', 'error');
  }
};

/* ── Export CSV ── */
window.exportCsv = function () {
  if (!_filtered.length) { showToast('ไม่มีข้อมูลจะ export', 'error'); return; }
  const headers = ['member_code', 'full_name', 'line_display_name', 'line_user_id', 'phone', 'line_linked_at', 'last_active_at'];
  const esc = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
  const csv = [
    headers.join(','),
    ..._filtered.map(r => [
      esc(r.member_code),
      esc(r.full_name || r.member_name),
      esc(r.line_display_name),
      esc(r.line_user_id),
      esc(r.phone),
      esc(r.line_linked_at),
      esc(r.last_active_at),
    ].join(',')),
  ].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `line-members_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast(`Export ${_filtered.length} รายการแล้ว 📥`, 'success');
};

/* ── Helpers ── */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escAttr(s) { return esc(s).replace(/\n/g, ' '); }

function formatDateThai(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (window.DateFmt?.formatDMY) return DateFmt.formatDMY(iso) + ' ' + d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('th-TH') + ' ' + d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function relativeTime(iso) {
  if (!iso) return '—';
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = now - then;
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'เมื่อสักครู่';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} นาทีที่แล้ว`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ชม.ที่แล้ว`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} วันที่แล้ว`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} เดือนที่แล้ว`;
  return `${Math.floor(mo / 12)} ปีที่แล้ว`;
}

function isStale(iso) {
  if (!iso) return true;
  const days = (Date.now() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000);
  return days > 30;
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
