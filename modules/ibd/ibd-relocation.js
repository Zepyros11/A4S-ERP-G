/* ============================================================
   ibd-relocation.js — Form 3 report (Changing Location Base)
   Table: ibd_relocation_requests
   ============================================================ */

const SB_URL = localStorage.getItem('sb_url') || '';
const SB_KEY = localStorage.getItem('sb_key') || '';
const PAGE_SIZE = 20;

let state = {
  page: 1,
  total: 0,
  rows: [],
  countries: [],
  filters: { search: '', status: '', from: '', to: '' },
  current: null,
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
function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}
function statusBadge(status) {
  const map = {
    pending:  { cls: 'pending',  text: 'PENDING' },
    approved: { cls: 'approved', text: 'APPROVED' },
    rejected: { cls: 'rejected', text: 'REJECTED' },
  };
  const m = map[status] || { cls: 'closed', text: status };
  return `<span class="ibd-badge ibd-badge-${m.cls}">${m.text}</span>`;
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

async function loadCountries() {
  const res = await sbFetch('ibd_countries?select=code,name_en,flag_emoji,is_branch&active=eq.true&order=display_order.asc');
  state.countries = await res.json();
  // เลือกเฉพาะที่เป็นประเทศ (ไม่ใช่เมือง) สำหรับ relocation
  const opts = state.countries.filter(c => !c.code.includes('-'));
  ['filtFrom', 'filtTo'].forEach(id => {
    const sel = $(id);
    opts.forEach(c => {
      const o = document.createElement('option');
      o.value = c.code;
      o.textContent = `${c.flag_emoji || ''} ${c.name_en}`;
      sel.appendChild(o);
    });
  });
}
function countryLabel(code) {
  const c = state.countries.find(x => x.code === code);
  return c ? `${c.flag_emoji || ''} ${c.name_en}` : code || '—';
}

async function loadList() {
  showLoading(true);
  try {
    const f = state.filters;
    const conds = [];
    if (f.status) conds.push(`status=eq.${encodeURIComponent(f.status)}`);
    if (f.from)   conds.push(`from_country=eq.${encodeURIComponent(f.from)}`);
    if (f.to)     conds.push(`to_country=eq.${encodeURIComponent(f.to)}`);
    if (f.search) {
      const q = encodeURIComponent(`%${f.search}%`);
      conds.push(`or=(member_code.ilike.${q},member_name.ilike.${q},whatsapp.ilike.${q},email.ilike.${q})`);
    }

    const offset = (state.page - 1) * PAGE_SIZE;
    const path = `ibd_relocation_requests?select=*&${conds.join('&')}&order=pinned.desc,created_at.desc&limit=${PAGE_SIZE}&offset=${offset}`;
    const res = await sbFetch(path, { headers: { Prefer: 'count=exact' } });
    state.total = +res.headers.get('content-range')?.split('/')[1] || 0;
    state.rows = await res.json();

    renderTable();
    renderPaginate();
    await loadKpis();
  } catch (e) {
    console.error(e);
    toast('โหลดไม่สำเร็จ: ' + e.message, 'error');
    $('tbody').innerHTML = `<tr><td colspan="11" class="ibd-empty">${escapeHtml(e.message)}</td></tr>`;
  } finally {
    showLoading(false);
  }
}

async function loadKpis() {
  const today = window.IBDExportModal ? IBDExportModal.todayBkk() : new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const dayFilter = window.IBDExportModal ? IBDExportModal.bkkRangeFilter(today, today) : '';

  async function count(extra) {
    const res = await sbFetch(`ibd_relocation_requests?select=id&limit=1${extra ? '&' + extra : ''}${dayFilter}`, { headers: { Prefer: 'count=exact' } });
    return +res.headers.get('content-range')?.split('/')[1] || 0;
  }
  const [total, p, a, r] = await Promise.all([
    count(''),
    count('status=eq.pending'),
    count('status=eq.approved'),
    count('status=eq.rejected'),
  ]);
  $('kpiTotal').textContent = total;
  $('kpiPending').textContent = p;
  $('kpiApproved').textContent = a;
  $('kpiRejected').textContent = r;
}

function renderTable() {
  const tbody = $('tbody');
  if (!state.rows.length) {
    tbody.innerHTML = '<tr><td colspan="11" class="ibd-empty">ยังไม่มีรายการ</td></tr>';
    return;
  }
  tbody.innerHTML = state.rows.map(r => `
    <tr class="${r.pinned ? 'pinned' : ''}" onclick="openDetail(${r.id})">
      <td>${statusBadge(r.status)}</td>
      <td style="white-space:nowrap;font-size:12px;color:var(--text2)">${fmtTime(r.created_at)}</td>
      <td>
        <div class="ibd-cell-name">${escapeHtml(r.member_name || '—')}</div>
        <div class="ibd-cell-mono">${escapeHtml(r.member_code || '—')}</div>
      </td>
      <td>${countryLabel(r.from_country)} <span style="color:var(--text3)">→</span> <strong>${countryLabel(r.to_country)}</strong></td>
      <td style="font-family:'IBM Plex Mono',monospace;font-size:12px">${escapeHtml(r.whatsapp || '—')}</td>
      <td style="font-size:12px">${escapeHtml(r.email || '—')}</td>
      <td style="text-align:center">${r.acknowledged ? '✅' : '❌'}</td>
      <td>${fmtDate(r.effective_date)}</td>
      <td onclick="event.stopPropagation()">${progressSelect(r)}</td>
      <td onclick="event.stopPropagation()">${noteInput(r)}</td>
      <td style="text-align:center" onclick="event.stopPropagation()"><div class="ibd-action-group">${pinBtn(r)}${deleteBtn(r)}</div></td>
    </tr>`).join('');
}

/* ── Progress dropdown / Note input / Pin button ── */
const PROG_LABELS = { pending: 'รอดำเนินการ', in_progress: 'ดำเนินการแล้ว', stuck: 'ติดปัญหา' };
function progressSelect(r) {
  const v = r.progress_status || 'pending';
  const opts = Object.keys(PROG_LABELS).map(k => `<option value="${k}" ${k === v ? 'selected' : ''}>${PROG_LABELS[k]}</option>`).join('');
  return `<select class="ibd-prog-select ${v}" onchange="updateProgress(${r.id}, this)">${opts}</select>`;
}
function noteInput(r) {
  return `<input type="text" class="ibd-note-input" id="note-${r.id}" value="${escapeHtml(r.note || '')}" placeholder="เพิ่มหมายเหตุ..." oninput="onNoteInput(${r.id}, this)" onclick="event.stopPropagation()" />`;
}
function pinBtn(r) {
  return `<button class="ibd-pin-btn ${r.pinned ? 'pinned' : ''}" onclick="togglePin(${r.id}, this)" title="${r.pinned ? 'ยกเลิกปักหมุด' : 'ปักหมุด'}">${r.pinned ? '📍' : '📌'}</button>`;
}
function deleteBtn(r) {
  if (window.AuthZ && !AuthZ.hasPerm('ibd_relocation_delete')) return '';
  return `<button class="ibd-del-btn" onclick="deleteRow(${r.id})" title="ลบรายการ">🗑️</button>`;
}

window.updateProgress = async function (id, sel) {
  const v = sel.value;
  sel.className = `ibd-prog-select ${v}`;
  try {
    await sbFetch(`ibd_relocation_requests?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ progress_status: v }) });
    const row = state.rows.find(x => x.id === id); if (row) row.progress_status = v;
  } catch (e) { toast('บันทึกไม่สำเร็จ: ' + e.message, 'error'); }
};

const noteTimers = new Map();
window.onNoteInput = function (id, input) {
  if (noteTimers.has(id)) clearTimeout(noteTimers.get(id));
  input.classList.remove('saved');
  noteTimers.set(id, setTimeout(async () => {
    input.classList.add('saving');
    try {
      await sbFetch(`ibd_relocation_requests?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ note: input.value }) });
      const row = state.rows.find(x => x.id === id); if (row) row.note = input.value;
      input.classList.remove('saving');
      input.classList.add('saved');
      setTimeout(() => input.classList.remove('saved'), 1200);
    } catch (e) {
      input.classList.remove('saving');
      toast('บันทึกหมายเหตุไม่สำเร็จ', 'error');
    }
  }, 600));
};

window.togglePin = async function (id, btn) {
  const row = state.rows.find(x => x.id === id); if (!row) return;
  const newVal = !row.pinned;
  btn.disabled = true;
  try {
    await sbFetch(`ibd_relocation_requests?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ pinned: newVal, pinned_at: newVal ? new Date().toISOString() : null }),
    });
    loadList();
  } catch (e) {
    btn.disabled = false;
    toast('ปักหมุดไม่สำเร็จ: ' + e.message, 'error');
  }
};

window.deleteRow = async function (id) {
  const row = state.rows.find(x => x.id === id); if (!row) return;
  const ok = await ConfirmModal.open({
    title: 'ลบคำขอย้ายฐาน?',
    message: 'การลบเป็นการถาวร — ข้อมูลจะหายไปจาก database',
    icon: '🗑️',
    tone: 'danger',
    okText: 'ลบเลย',
    cancelText: 'ยกเลิก',
    details: {
      'Member': row.member_name || '—',
      'รหัส': row.member_code || '—',
      'จาก → ไป': `${countryLabel(row.from_country)} → ${countryLabel(row.to_country)}`,
    },
  });
  if (!ok) return;
  showLoading(true);
  try {
    await sbFetch(`ibd_relocation_requests?id=eq.${id}`, { method: 'DELETE' });
    toast('ลบรายการแล้ว');
    loadList();
  } catch (e) {
    toast('ลบไม่สำเร็จ: ' + e.message, 'error');
  } finally {
    showLoading(false);
  }
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
  html += `<span class="ibd-paginate-info">${state.total} รายการ · หน้า ${state.page}/${totalPages}</span>`;
  root.innerHTML = html;
}

window.gotoPage = function (p) {
  const totalPages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
  state.page = Math.min(Math.max(1, p), totalPages);
  loadList();
};
window.reload = function () { state.page = 1; loadList(); };

window.openDetail = function (id) {
  const row = state.rows.find(r => r.id === id);
  if (!row) return;
  state.current = row;

  $('modalTitle').textContent = `Relocation #${row.id} — ${row.member_name}`;

  $('modalBody').innerHTML = `
    <dl class="ibd-dl">
      <dt>วันที่ส่ง</dt>      <dd>${fmtTime(row.created_at)}</dd>
      <dt>Member ID</dt>     <dd class="ibd-cell-mono">${escapeHtml(row.member_code || '—')}</dd>
      <dt>Member Name</dt>   <dd>${escapeHtml(row.member_name || '—')}</dd>
      <dt>WhatsApp</dt>      <dd>${escapeHtml(row.whatsapp || '—')}</dd>
      <dt>Email</dt>         <dd>${escapeHtml(row.email || '—')}</dd>
      <dt>From base</dt>     <dd>${countryLabel(row.from_country)}</dd>
      <dt>To base</dt>       <dd><strong>${countryLabel(row.to_country)}</strong></dd>
      <dt>Acknowledged</dt>  <dd>${row.acknowledged ? '✅ ลูกค้ารับทราบเงื่อนไข 7 วัน' : '❌ ยังไม่รับทราบ'}</dd>
      <dt>Status</dt>        <dd>${statusBadge(row.status)}</dd>
      <dt>Language</dt>      <dd>${(row.language || 'en').toUpperCase()}</dd>
    </dl>

    ${row.reason ? `
      <div class="ibd-section-divider">เหตุผลในการย้าย</div>
      <div style="font-size:13px;color:var(--text);white-space:pre-wrap">${escapeHtml(row.reason)}</div>` : ''}

    ${row.status === 'approved' && row.effective_date ? `
      <div class="ibd-section-divider">การอนุมัติ</div>
      <dl class="ibd-dl">
        <dt>Effective Date</dt><dd>${fmtDate(row.effective_date)}</dd>
        <dt>อนุมัติเมื่อ</dt>   <dd>${fmtTime(row.approved_at)}</dd>
      </dl>` : ''}

    ${row.reject_reason ? `
      <div class="ibd-section-divider">เหตุผลที่ปฏิเสธ</div>
      <div style="font-size:13px;color:#991b1b;background:#fef2f2;padding:10px;border-radius:6px;white-space:pre-wrap">${escapeHtml(row.reject_reason)}</div>` : ''}

    ${row.notes ? `
      <div class="ibd-section-divider">Internal Notes</div>
      <div style="font-size:13px;color:var(--text2);white-space:pre-wrap">${escapeHtml(row.notes)}</div>` : ''}
  `;

  const foot = $('modalFoot');
  let actions = '';
  if (row.status === 'pending') {
    if (window.AuthZ?.hasPerm('ibd_relocation_approve')) actions += `<button class="ibd-mbtn ibd-mbtn-success" onclick="approveReq()">✓ Approve</button>`;
    if (window.AuthZ?.hasPerm('ibd_relocation_reject'))  actions += `<button class="ibd-mbtn ibd-mbtn-danger" onclick="rejectReq()">✗ Reject</button>`;
  }
  actions += `<button class="ibd-mbtn ibd-mbtn-ghost" onclick="closeModal()">ปิด</button>`;
  foot.innerHTML = actions;

  $('detailModal').classList.add('open');
  if (window.AuthZ) AuthZ.applyDomPerms(foot);
};

window.closeModal = function () { $('detailModal').classList.remove('open'); state.current = null; };

window.approveReq = async function () {
  if (!state.current) return;
  const eff = await PromptModal.open({
    title: 'อนุมัติย้ายฐานประเทศ',
    message: 'เลือกวันที่มีผลย้ายฐาน (Effective Date)',
    icon: '✓',
    tone: 'success',
    okText: 'อนุมัติ',
    inputType: 'date',
    defaultValue: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    required: true,
  });
  if (!eff) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eff)) { toast('รูปแบบวันที่ไม่ถูกต้อง', 'error'); return; }
  showLoading(true);
  try {
    const me = window.ERP_USER?.user_id || null;
    await sbFetch(`ibd_relocation_requests?id=eq.${state.current.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'approved', approved_by: me, approved_at: new Date().toISOString(), effective_date: eff }),
    });
    toast('อนุมัติเรียบร้อย');
    closeModal(); loadList();
  } catch (e) { toast('อนุมัติไม่สำเร็จ: ' + e.message, 'error'); }
  finally { showLoading(false); }
};

window.rejectReq = async function () {
  if (!state.current) return;
  const reason = await PromptModal.open({
    title: 'ปฏิเสธคำขอย้ายฐาน',
    message: 'ระบุเหตุผลที่ปฏิเสธ (จะแสดงให้ลูกค้าทราบ)',
    icon: '✗',
    tone: 'danger',
    okText: 'ปฏิเสธ',
    multiline: true,
    placeholder: 'เช่น ระยะเวลาสมัครยังไม่ครบ, ขาดเอกสาร...',
    required: true,
  });
  if (!reason) return;
  showLoading(true);
  try {
    await sbFetch(`ibd_relocation_requests?id=eq.${state.current.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'rejected', reject_reason: reason }),
    });
    toast('ปฏิเสธเรียบร้อย');
    closeModal(); loadList();
  } catch (e) { toast('ปฏิเสธไม่สำเร็จ: ' + e.message, 'error'); }
  finally { showLoading(false); }
};

window.exportCsv = async function () {
  const range = await IBDExportModal.open({ title: 'ส่งออก Relocation Requests', defaultPreset: 'today' });
  if (!range) return;

  showLoading(true);
  try {
    const f = state.filters;
    const conds = [];
    if (f.status) conds.push(`status=eq.${f.status}`);
    if (f.from)   conds.push(`from_country=eq.${f.from}`);
    if (f.to)     conds.push(`to_country=eq.${f.to}`);
    const dateFilter = IBDExportModal.bkkRangeFilter(range.from, range.to);
    const path = `ibd_relocation_requests?select=*&${conds.join('&')}&order=created_at.desc&limit=10000${dateFilter}`;
    const res = await sbFetch(path);
    const rows = await res.json();

    const headers = ['ID', 'Date', 'Member Code', 'Name', 'From', 'To', 'WhatsApp', 'Email', 'Acknowledged', 'Status', 'Progress', 'Note', 'Pinned', 'Effective Date', 'Reject Reason'];
    const csvRows = [headers.join(',')];
    rows.forEach(r => {
      const cols = [r.id, fmtTime(r.created_at), r.member_code, r.member_name, r.from_country, r.to_country, r.whatsapp, r.email, r.acknowledged, r.status, r.progress_status, r.note, r.pinned ? 'YES' : '', fmtDate(r.effective_date), r.reject_reason]
        .map(v => `"${String(v ?? '').replace(/"/g, '""').replace(/\n/g, ' ')}"`);
      csvRows.push(cols.join(','));
    });
    const blob = new Blob(['﻿' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `ibd-relocation-${range.label}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`Export ${rows.length} รายการแล้ว`);
  } catch (e) { toast('Export ไม่สำเร็จ: ' + e.message, 'error'); }
  finally { showLoading(false); }
};

async function init() {
  $('filtSearch').addEventListener('input', debounce(() => {
    state.filters.search = $('filtSearch').value.trim();
    state.page = 1;
    loadList();
  }, 300));
  ['filtStatus', 'filtFrom', 'filtTo'].forEach(id => {
    $(id).addEventListener('change', () => {
      state.filters.status = $('filtStatus').value;
      state.filters.from   = $('filtFrom').value;
      state.filters.to     = $('filtTo').value;
      state.page = 1;
      loadList();
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('detailModal').classList.contains('open')) closeModal();
  });

  await loadCountries();
  await loadList();
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

window.addEventListener('DOMContentLoaded', init);
