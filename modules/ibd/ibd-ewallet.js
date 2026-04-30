/* ============================================================
   ibd-ewallet.js — Form 2 report (Commission to E-Wallet)
   Table: ibd_ewallet_requests
   ============================================================ */

const SB_URL = localStorage.getItem('sb_url') || '';
const SB_KEY = localStorage.getItem('sb_key') || '';
const PAGE_SIZE = 20;

let state = {
  page: 1,
  total: 0,
  rows: [],
  filters: { search: '', status: '' },
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
function statusBadge(status) {
  const map = {
    pending:  { cls: 'pending',  text: 'PENDING' },
    approved: { cls: 'approved', text: 'APPROVED' },
    paid:     { cls: 'paid',     text: 'PAID' },
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

async function loadList() {
  showLoading(true);
  try {
    const f = state.filters;
    const conds = [];
    if (f.status) conds.push(`status=eq.${encodeURIComponent(f.status)}`);
    if (f.search) {
      const q = encodeURIComponent(`%${f.search}%`);
      conds.push(`or=(member_code.ilike.${q},member_full_name.ilike.${q},whatsapp.ilike.${q},email.ilike.${q})`);
    }

    const offset = (state.page - 1) * PAGE_SIZE;
    const path = `ibd_ewallet_requests?select=*&${conds.join('&')}&order=created_at.desc&limit=${PAGE_SIZE}&offset=${offset}`;
    const res = await sbFetch(path, { headers: { Prefer: 'count=exact' } });
    state.total = +res.headers.get('content-range')?.split('/')[1] || 0;
    state.rows = await res.json();

    renderTable();
    renderPaginate();
    await loadKpis();
  } catch (e) {
    console.error(e);
    toast('โหลดไม่สำเร็จ: ' + e.message, 'error');
    $('tbody').innerHTML = `<tr><td colspan="8" class="ibd-empty">${escapeHtml(e.message)}</td></tr>`;
  } finally {
    showLoading(false);
  }
}

async function loadKpis() {
  async function count(extra) {
    const res = await sbFetch(`ibd_ewallet_requests?select=id&limit=1${extra ? '&' + extra : ''}`, { headers: { Prefer: 'count=exact' } });
    return +res.headers.get('content-range')?.split('/')[1] || 0;
  }
  const [total, p, a, paid, r] = await Promise.all([
    count(''),
    count('status=eq.pending'),
    count('status=eq.approved'),
    count('status=eq.paid'),
    count('status=eq.rejected'),
  ]);
  $('kpiTotal').textContent = total;
  $('kpiPending').textContent = p;
  $('kpiApproved').textContent = a;
  $('kpiPaid').textContent = paid;
  $('kpiRejected').textContent = r;
}

function renderTable() {
  const tbody = $('tbody');
  if (!state.rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="ibd-empty">ยังไม่มีรายการ</td></tr>';
    return;
  }
  tbody.innerHTML = state.rows.map(r => {
    const docCount = Array.isArray(r.id_document_urls) ? r.id_document_urls.length : 0;
    return `
      <tr onclick="openDetail(${r.id})">
        <td style="white-space:nowrap;font-size:12px;color:var(--text2)">${fmtTime(r.created_at)}</td>
        <td>
          <div class="ibd-cell-name">${escapeHtml(r.member_full_name || '—')}</div>
          <div class="ibd-cell-mono">${escapeHtml(r.member_code || '—')}</div>
        </td>
        <td style="font-family:'IBM Plex Mono',monospace;font-size:12px">${escapeHtml(r.whatsapp || '—')}</td>
        <td style="font-size:12px">${escapeHtml(r.email || '—')}</td>
        <td style="text-align:center">${docCount ? `📎 ${docCount}` : '—'}</td>
        <td style="text-align:center">${r.holding_photo_url ? '🖼️' : '—'}</td>
        <td style="text-align:center">${r.confirmed && r.accepted ? '✅' : '⚠️'}</td>
        <td>${statusBadge(r.status)}</td>
      </tr>`;
  }).join('');
}

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

/* ── Detail Modal ── */
window.openDetail = function (id) {
  const row = state.rows.find(r => r.id === id);
  if (!row) return;
  state.current = row;

  $('modalTitle').textContent = `E-Wallet Request #${row.id} — ${row.member_full_name}`;

  const docs = Array.isArray(row.id_document_urls) ? row.id_document_urls : [];
  const docHtml = docs.length
    ? renderAttachments(docs, 'eDocs')
    : '<span style="color:var(--text3)">ไม่มีเอกสาร</span>';
  const photos = row.holding_photo_url ? [row.holding_photo_url] : [];
  const photoHtml = photos.length
    ? renderAttachments(photos, 'eHold')
    : '<span style="color:var(--text3)">ไม่มีภาพ</span>';

  $('modalBody').innerHTML = `
    <dl class="ibd-dl">
      <dt>วันที่ส่ง</dt>      <dd>${fmtTime(row.created_at)}</dd>
      <dt>A4S ID</dt>        <dd class="ibd-cell-mono">${escapeHtml(row.member_code || '—')}</dd>
      <dt>ชื่อตอนสมัคร</dt>   <dd>${escapeHtml(row.member_full_name || '—')}</dd>
      <dt>WhatsApp</dt>      <dd>${escapeHtml(row.whatsapp || '—')}</dd>
      <dt>Email</dt>         <dd>${escapeHtml(row.email || '—')}</dd>
      <dt>Confirmed</dt>     <dd>${row.confirmed ? '✅ Yes — รับเข้า E-Wallet' : '❌ ยังไม่ confirm'}</dd>
      <dt>Accepted (final)</dt><dd>${row.accepted ? '✅ ยอมรับเงื่อนไข 3-7 วัน' : '❌ ยังไม่ยอมรับ'}</dd>
      <dt>Status</dt>        <dd>${statusBadge(row.status)}</dd>
      <dt>Language</dt>      <dd>${(row.language || 'en').toUpperCase()}</dd>
    </dl>

    <div class="ibd-section-divider">เอกสาร NIN / National ID / Passport</div>
    ${docHtml}

    <div class="ibd-section-divider">ภาพถือเอกสาร</div>
    ${photoHtml}

    ${row.ref_no || row.paid_at ? `
      <div class="ibd-section-divider">การโอน</div>
      <dl class="ibd-dl">
        <dt>เลขอ้างอิง</dt>   <dd class="ibd-cell-mono">${escapeHtml(row.ref_no || '—')}</dd>
        <dt>โอนเมื่อ</dt>      <dd>${fmtTime(row.paid_at)}</dd>
      </dl>` : ''}

    ${row.reject_reason ? `
      <div class="ibd-section-divider">เหตุผลที่ปฏิเสธ</div>
      <div style="font-size:13px;color:#991b1b;background:#fef2f2;padding:10px;border-radius:6px;white-space:pre-wrap">${escapeHtml(row.reject_reason)}</div>` : ''}

    ${row.notes ? `
      <div class="ibd-section-divider">Internal Notes</div>
      <div style="font-size:13px;color:var(--text2);white-space:pre-wrap">${escapeHtml(row.notes)}</div>` : ''}
  `;

  // Action buttons
  const foot = $('modalFoot');
  let actions = '';
  if (row.status === 'pending') {
    if (window.AuthZ?.hasPerm('ibd_ewallet_approve')) actions += `<button class="ibd-mbtn ibd-mbtn-success" onclick="approveReq()">✓ Approve</button>`;
    if (window.AuthZ?.hasPerm('ibd_ewallet_reject'))  actions += `<button class="ibd-mbtn ibd-mbtn-danger" onclick="rejectReq()">✗ Reject</button>`;
  } else if (row.status === 'approved') {
    if (window.AuthZ?.hasPerm('ibd_ewallet_mark_paid')) actions += `<button class="ibd-mbtn ibd-mbtn-success" onclick="markPaid()">💸 Mark as Paid</button>`;
    if (window.AuthZ?.hasPerm('ibd_ewallet_reject'))    actions += `<button class="ibd-mbtn ibd-mbtn-danger" onclick="rejectReq()">✗ Reject</button>`;
  }
  actions += `<button class="ibd-mbtn ibd-mbtn-ghost" onclick="closeModal()">ปิด</button>`;
  foot.innerHTML = actions;

  $('detailModal').classList.add('open');
  if (window.AuthZ) AuthZ.applyDomPerms(foot);
  hydrateAttachments(docs, 'eDocs');
  hydrateAttachments(photos, 'eHold');
};

/* ── Attachment rendering (lazy signed URL) ── */
function renderAttachments(keys, idPrefix) {
  const images = keys.filter(k => IBDStorage.isImage(k));
  const others = keys.filter(k => !IBDStorage.isImage(k));
  let html = '';
  if (images.length) {
    html += `<div class="ibd-img-grid" id="${idPrefix}-img">`;
    images.forEach((k, i) => {
      const safeName = escapeHtml(IBDStorage.fileName(k));
      html += `
        <a class="ibd-img-thumb" data-key="${escapeHtml(k)}" id="${idPrefix}-thumb-${i}" onclick="openLightbox('${idPrefix}', ${i});return false;">
          <div class="ibd-img-loading">⏳</div>
          <div class="ibd-img-thumb-label">${safeName}</div>
        </a>`;
    });
    html += '</div>';
  }
  if (others.length) {
    html += `<div class="ibd-attachments">`;
    others.forEach((k, i) => {
      const safeName = escapeHtml(IBDStorage.fileName(k));
      const icon = IBDStorage.fileIcon(k);
      html += `<a class="ibd-att-chip" data-key="${escapeHtml(k)}" id="${idPrefix}-chip-${i}" href="#" target="_blank" rel="noopener">${icon} ${safeName}</a>`;
    });
    html += '</div>';
  }
  return html;
}

async function hydrateAttachments(keys, idPrefix) {
  const images = keys.filter(k => IBDStorage.isImage(k));
  const others = keys.filter(k => !IBDStorage.isImage(k));

  await Promise.all(images.map(async (k, i) => {
    const thumb = document.getElementById(`${idPrefix}-thumb-${i}`);
    if (!thumb) return;
    try {
      const url = await IBDStorage.getSignedUrl(k);
      thumb.href = url;
      thumb.target = '_blank';
      thumb.dataset.url = url;
      const loading = thumb.querySelector('.ibd-img-loading');
      const label = thumb.querySelector('.ibd-img-thumb-label');
      const img = document.createElement('img');
      img.src = url;
      img.alt = IBDStorage.fileName(k);
      thumb.insertBefore(img, label);
      if (loading) loading.remove();
    } catch (e) {
      thumb.innerHTML = `<div style="padding:6px;font-size:10px;color:#dc2626">โหลดไม่ได้</div>`;
    }
  }));

  await Promise.all(others.map(async (k, i) => {
    const chip = document.getElementById(`${idPrefix}-chip-${i}`);
    if (!chip) return;
    try {
      const url = await IBDStorage.getSignedUrl(k);
      chip.href = url;
    } catch (e) {
      chip.style.color = '#dc2626';
      chip.title = 'โหลดไม่ได้';
    }
  }));
}

window.openLightbox = function (idPrefix, idx) {
  const thumb = document.getElementById(`${idPrefix}-thumb-${idx}`);
  if (!thumb || !thumb.dataset.url) return;
  const url = thumb.dataset.url;
  const name = thumb.querySelector('.ibd-img-thumb-label')?.textContent || '';
  $('lightboxImg').src = url;
  $('lightboxInfo').innerHTML = `${escapeHtml(name)} <a class="ibd-lightbox-download" href="${escapeHtml(url)}" download target="_blank">⬇ ดาวน์โหลด</a>`;
  $('lightbox').classList.add('open');
};
window.closeLightbox = function () {
  $('lightbox').classList.remove('open');
  $('lightboxImg').src = '';
};

window.closeModal = function () { $('detailModal').classList.remove('open'); state.current = null; };

window.approveReq = async function () {
  if (!state.current) return;
  showLoading(true);
  try {
    const me = window.ERP_USER?.user_id || null;
    await sbFetch(`ibd_ewallet_requests?id=eq.${state.current.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'approved', approved_by: me, approved_at: new Date().toISOString() }),
    });
    toast('อนุมัติเรียบร้อย');
    closeModal(); loadList();
  } catch (e) { toast('อนุมัติไม่สำเร็จ: ' + e.message, 'error'); }
  finally { showLoading(false); }
};

window.markPaid = async function () {
  if (!state.current) return;
  const ref = await PromptModal.open({
    title: 'บันทึกการโอน',
    message: 'กรอกเลขอ้างอิงการโอน (Ref No)',
    icon: '💸',
    tone: 'success',
    okText: 'บันทึกโอนแล้ว',
    placeholder: 'เช่น TXN-20260430-001',
    required: true,
  });
  if (ref === null) return;
  showLoading(true);
  try {
    await sbFetch(`ibd_ewallet_requests?id=eq.${state.current.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'paid', paid_at: new Date().toISOString(), ref_no: ref }),
    });
    toast('บันทึกการโอนเรียบร้อย');
    closeModal(); loadList();
  } catch (e) { toast('บันทึกไม่สำเร็จ: ' + e.message, 'error'); }
  finally { showLoading(false); }
};

window.rejectReq = async function () {
  if (!state.current) return;
  const reason = await PromptModal.open({
    title: 'ปฏิเสธคำขอ',
    message: 'ระบุเหตุผลที่ปฏิเสธ (จะแสดงให้ลูกค้าทราบ)',
    icon: '✗',
    tone: 'danger',
    okText: 'ปฏิเสธ',
    multiline: true,
    placeholder: 'เช่น เอกสารไม่ชัดเจน, ID ไม่ตรง...',
    required: true,
  });
  if (!reason) return;
  showLoading(true);
  try {
    await sbFetch(`ibd_ewallet_requests?id=eq.${state.current.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'rejected', reject_reason: reason }),
    });
    toast('ปฏิเสธเรียบร้อย');
    closeModal(); loadList();
  } catch (e) { toast('ปฏิเสธไม่สำเร็จ: ' + e.message, 'error'); }
  finally { showLoading(false); }
};

window.exportCsv = async function () {
  showLoading(true);
  try {
    const f = state.filters;
    const conds = [];
    if (f.status) conds.push(`status=eq.${f.status}`);
    const path = `ibd_ewallet_requests?select=*&${conds.join('&')}&order=created_at.desc&limit=10000`;
    const res = await sbFetch(path);
    const rows = await res.json();

    const headers = ['ID', 'Date', 'Member Code', 'Full Name', 'WhatsApp', 'Email', 'Confirmed', 'Accepted', 'Status', 'Ref No', 'Paid At', 'Reject Reason'];
    const csvRows = [headers.join(',')];
    rows.forEach(r => {
      const cols = [r.id, fmtTime(r.created_at), r.member_code, r.member_full_name, r.whatsapp, r.email, r.confirmed, r.accepted, r.status, r.ref_no, fmtTime(r.paid_at), r.reject_reason]
        .map(v => `"${String(v ?? '').replace(/"/g, '""').replace(/\n/g, ' ')}"`);
      csvRows.push(cols.join(','));
    });
    const blob = new Blob(['﻿' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `ibd-ewallet-${new Date().toISOString().slice(0, 10)}.csv`;
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
  $('filtStatus').addEventListener('change', () => {
    state.filters.status = $('filtStatus').value;
    state.page = 1;
    loadList();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if ($('lightbox').classList.contains('open')) { closeLightbox(); return; }
    if ($('detailModal').classList.contains('open')) closeModal();
  });

  await loadList();
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

window.addEventListener('DOMContentLoaded', init);
