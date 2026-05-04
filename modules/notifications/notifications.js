/* ============================================================
   notifications.js — In-app inbox (per-user)
   Table: user_notifications
   ============================================================ */

const SB_URL = localStorage.getItem('sb_url') || '';
const SB_KEY = localStorage.getItem('sb_key') || '';
const PAGE_SIZE = 30;

const BASE_PATH = window.location.hostname.includes('github.io')
  ? '/' + window.location.pathname.split('/')[1]
  : '';

let state = {
  page: 1,
  total: 0,
  rows: [],
  triggers: [],   // distinct trigger_keys ของ user (สำหรับ filter dropdown)
  filters: { search: '', status: '', trigger: '' },
  userId: null,
};

function $(id) { return document.getElementById(id); }
function showLoading(on) { const el = $('loadingOverlay'); if (el) el.style.display = on ? 'flex' : 'none'; }
function toast(msg, type = 'success') {
  const el = $('toast'); if (!el) return alert(msg);
  el.textContent = msg; el.className = `toast show toast-${type}`;
  setTimeout(() => el.classList.remove('show'), 3000);
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }).replace(',', '');
  } catch { return iso; }
}

async function sbFetch(path, opts = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

function _getUserId() {
  try {
    const raw = localStorage.getItem('erp_session') || sessionStorage.getItem('erp_session');
    const u = raw ? JSON.parse(raw) : null;
    return u?.user_id || null;
  } catch { return null; }
}

function _triggerCategory(triggerKey) {
  if (triggerKey?.startsWith('ibd.'))     return 'ibd';
  if (triggerKey?.startsWith('event.'))   return 'event';
  if (triggerKey?.startsWith('booking.')) return 'booking';
  return '';
}
function _triggerLabel(triggerKey) {
  const map = {
    'ibd.complaint.created':   'IBD Complaint',
    'ibd.ewallet.created':     'IBD E-Wallet',
    'ibd.relocation.created':  'IBD Relocation',
    'event.confirmed':         'Event Confirmed',
    'event.scheduled':         'Event Scheduled',
    'booking.approved':        'Booking Approved',
    'booking.scheduled':       'Booking Scheduled',
    'booking.before_start':    'Booking Soon',
  };
  return map[triggerKey] || triggerKey || '—';
}

async function loadList() {
  showLoading(true);
  try {
    const f = state.filters;
    const conds = [`user_id=eq.${state.userId}`];
    if (f.status === 'unread') conds.push('read_at=is.null');
    else if (f.status === 'read') conds.push('read_at=not.is.null');
    if (f.trigger) conds.push(`trigger_key=eq.${encodeURIComponent(f.trigger)}`);
    if (f.search) {
      const q = encodeURIComponent(`%${f.search}%`);
      conds.push(`title=ilike.${q}`);
    }
    const offset = (state.page - 1) * PAGE_SIZE;
    const path = `user_notifications?select=*&${conds.join('&')}&order=created_at.desc&limit=${PAGE_SIZE}&offset=${offset}`;
    const res = await sbFetch(path, { headers: { Prefer: 'count=exact' } });
    state.total = +res.headers.get('content-range')?.split('/')[1] || 0;
    state.rows = await res.json();
    renderTable();
    renderPaginate();
    await loadKpis();
  } catch (e) {
    console.error(e);
    toast('โหลดไม่สำเร็จ: ' + e.message, 'error');
    $('tbody').innerHTML = `<tr><td colspan="5" class="ibd-empty">${escapeHtml(e.message)}</td></tr>`;
  } finally {
    showLoading(false);
  }
}

async function loadKpis() {
  async function count(extra) {
    const path = `user_notifications?select=id&user_id=eq.${state.userId}&limit=1${extra ? '&' + extra : ''}`;
    const res = await sbFetch(path, { headers: { Prefer: 'count=exact' } });
    return +res.headers.get('content-range')?.split('/')[1] || 0;
  }
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const [total, unread, read, last7] = await Promise.all([
    count(''),
    count('read_at=is.null'),
    count('read_at=not.is.null'),
    count(`created_at=gte.${encodeURIComponent(sevenDaysAgo)}`),
  ]);
  $('kpiTotal').textContent = total;
  $('kpiUnread').textContent = unread;
  $('kpiRead').textContent = read;
  $('kpi7d').textContent = last7;
}

async function loadTriggerOptions() {
  // โหลด distinct trigger_keys ที่ user เคยได้รับ
  try {
    const res = await sbFetch(
      `user_notifications?select=trigger_key&user_id=eq.${state.userId}&limit=500`
    );
    const rows = await res.json();
    const set = new Set();
    rows.forEach(r => r.trigger_key && set.add(r.trigger_key));
    const sel = $('filtTrigger');
    [...set].sort().forEach(k => {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = _triggerLabel(k);
      sel.appendChild(o);
    });
  } catch (_) { /* silent */ }
}

function renderTable() {
  const tbody = $('tbody');
  if (!state.rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="ibd-empty">ยังไม่มีรายการ</td></tr>';
    return;
  }
  tbody.innerHTML = state.rows.map(r => {
    const unread = !r.read_at;
    const cat = _triggerCategory(r.trigger_key);
    return `
      <tr class="notif-row ${unread ? 'unread' : ''}" onclick="openNotif(${r.id})">
        <td style="white-space:nowrap;font-size:12px;color:var(--text2)">${fmtTime(r.created_at)}</td>
        <td><span class="notif-trigger ${cat}">${escapeHtml(_triggerLabel(r.trigger_key))}</span></td>
        <td><div class="notif-title">${escapeHtml(r.title || '—')}</div></td>
        <td style="text-align:center"><span class="notif-status ${unread ? 'unread' : 'read'}">${unread ? '● ใหม่' : '✓ อ่านแล้ว'}</span></td>
        <td style="text-align:center" onclick="event.stopPropagation()">
          <button class="ibd-del-btn" onclick="deleteOne(${r.id})" title="ลบ">🗑️</button>
        </td>
      </tr>`;
  }).join('');
}

window.openNotif = async function (id) {
  const row = state.rows.find(r => r.id === id);
  if (!row) return;
  // mark read
  if (!row.read_at) {
    try {
      await sbFetch(`user_notifications?id=eq.${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ read_at: new Date().toISOString() }),
      });
    } catch (_) {}
  }
  if (row.link_url) {
    window.location.href = BASE_PATH + row.link_url;
  } else {
    loadList();
  }
};

window.deleteOne = async function (id) {
  const ok = await ConfirmModal.open({
    title: 'ลบแจ้งเตือน?',
    message: 'ลบรายการนี้ออกจากกล่องของคุณ',
    icon: '🗑️',
    tone: 'danger',
    okText: 'ลบ',
    cancelText: 'ยกเลิก',
  });
  if (!ok) return;
  try {
    await sbFetch(`user_notifications?id=eq.${id}`, { method: 'DELETE' });
    toast('ลบแล้ว');
    loadList();
  } catch (e) { toast('ลบไม่สำเร็จ: ' + e.message, 'error'); }
};

window.markAllRead = async function () {
  try {
    await sbFetch(`user_notifications?user_id=eq.${state.userId}&read_at=is.null`, {
      method: 'PATCH',
      body: JSON.stringify({ read_at: new Date().toISOString() }),
    });
    toast('อ่านทั้งหมดแล้ว');
    loadList();
  } catch (e) { toast('ทำไม่สำเร็จ: ' + e.message, 'error'); }
};

function renderPaginate() {
  const totalPages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
  const root = $('paginate');
  if (state.total === 0) { root.innerHTML = ''; return; }
  let html = `<button onclick="gotoPage(${state.page - 1})" ${state.page <= 1 ? 'disabled' : ''}>‹</button>`;
  const start = Math.max(1, state.page - 2);
  const end   = Math.min(totalPages, start + 4);
  for (let p = start; p <= end; p++) {
    html += `<button class="${p === state.page ? 'active' : ''}" onclick="gotoPage(${p})">${p}</button>`;
  }
  html += `<button onclick="gotoPage(${state.page + 1})" ${state.page >= totalPages ? 'disabled' : ''}>›</button>`;
  html += `<span class="pagination-info">${state.total} รายการ · หน้า ${state.page}/${totalPages}</span>`;
  root.innerHTML = html;
}

window.gotoPage = function (p) {
  const totalPages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
  state.page = Math.min(Math.max(1, p), totalPages);
  loadList();
};

window.reload = function () { state.page = 1; loadList(); };

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

async function init() {
  state.userId = _getUserId();
  if (!state.userId) {
    $('tbody').innerHTML = '<tr><td colspan="5" class="ibd-empty">กรุณาเข้าสู่ระบบ</td></tr>';
    return;
  }

  $('filtSearch').addEventListener('input', debounce(() => {
    state.filters.search = $('filtSearch').value.trim();
    state.page = 1;
    loadList();
  }, 300));
  ['filtStatus', 'filtTrigger'].forEach(id => {
    $(id).addEventListener('change', () => {
      state.filters.status  = $('filtStatus').value;
      state.filters.trigger = $('filtTrigger').value;
      state.page = 1;
      loadList();
    });
  });

  await loadTriggerOptions();
  await loadList();
}

window.addEventListener('DOMContentLoaded', init);
