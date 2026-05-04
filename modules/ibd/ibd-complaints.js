/* ============================================================
   ibd-complaints.js — Form 1 report
   Table: ibd_complaints
   ============================================================ */

const SB_URL = localStorage.getItem('sb_url') || '';
const SB_KEY = localStorage.getItem('sb_key') || '';
const PAGE_SIZE = 20;

const TOPIC_LABELS = {
  product_order:  'Product Order follow up',
  info_change:    'Member Information Change',
  password:       'Member Login Password',
  commission:     'Commission Checking & Payment',
  service:        'Service Complaint',
  wrong_sponsor:  'Wrong Sponsor / Team Placement',
  ethics:         'Ethics',
  other:          'Other',
};

let state = {
  page: 1,
  total: 0,
  rows: [],
  branches: [],
  caretakers: [],
  filters: { search: '', status: '', topic: '', branch: '' },
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
    const opts = { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' };
    return d.toLocaleString('en-GB', opts).replace(',', '');
  } catch { return iso; }
}
function statusBadge(status) {
  const map = {
    new:         { cls: 'new',      text: 'NEW' },
    in_progress: { cls: 'progress', text: 'IN PROGRESS' },
    resolved:    { cls: 'resolved', text: 'RESOLVED' },
    closed:      { cls: 'closed',   text: 'CLOSED' },
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

/* ── Load branches lookup ── */
async function loadBranches() {
  const res = await sbFetch('ibd_countries?select=code,name_en,flag_emoji,parent_country,is_branch&active=eq.true&order=display_order.asc');
  state.branches = await res.json();
  const sel = $('filtBranch');
  state.branches.filter(b => b.is_branch).forEach(b => {
    const opt = document.createElement('option');
    opt.value = b.code;
    opt.textContent = `${b.flag_emoji || ''} ${b.name_en}`;
    sel.appendChild(opt);
  });
}
function branchLabel(code) {
  const b = state.branches.find(x => x.code === code);
  return b ? `${b.flag_emoji || ''} ${b.name_en}` : code || '—';
}

async function loadCaretakers() {
  // เฉพาะคนแผนก IBD: role หลัก (slot 1) ต้องเป็น role ที่ key หรือ label ขึ้นต้นด้วย "IBD"
  const cfgRes = await sbFetch(`role_configs?select=role_key,label`);
  const cfgs = await cfgRes.json();
  const ibdKeys = (cfgs || [])
    .filter(c => /^IBD/i.test(c.role_key || '') || /^IBD/i.test(c.label || ''))
    .map(c => c.role_key);
  if (!ibdKeys.length) { state.caretakers = []; return; }
  const inList = ibdKeys.map(k => encodeURIComponent(k)).join(',');
  const res = await sbFetch(`users?select=user_id,full_name,role&is_active=eq.true&role=in.(${inList})&order=full_name.asc`);
  state.caretakers = await res.json();
}

/* ── Load list ── */
async function loadList() {
  showLoading(true);
  try {
    const f = state.filters;
    const conds = [];
    if (f.status) conds.push(`status=eq.${encodeURIComponent(f.status)}`);
    if (f.topic)  conds.push(`topic=eq.${encodeURIComponent(f.topic)}`);
    if (f.branch) conds.push(`branch_code=eq.${encodeURIComponent(f.branch)}`);
    if (f.search) {
      const q = encodeURIComponent(`%${f.search}%`);
      conds.push(`or=(member_code.ilike.${q},member_name.ilike.${q},details.ilike.${q},whatsapp_used.ilike.${q})`);
    }

    const offset = (state.page - 1) * PAGE_SIZE;
    const path = `ibd_complaints?select=*&${conds.join('&')}&order=pinned.desc,created_at.desc&limit=${PAGE_SIZE}&offset=${offset}`;
    const res = await sbFetch(path, { headers: { Prefer: 'count=exact' } });
    state.total = +res.headers.get('content-range')?.split('/')[1] || 0;
    state.rows = await res.json();

    renderTable();
    renderPaginate();
    await loadKpis();
  } catch (e) {
    console.error(e);
    toast('โหลดไม่สำเร็จ: ' + e.message, 'error');
    $('tbody').innerHTML = `<tr><td colspan="12" style="text-align:center;color:var(--text3);padding:30px 0">${escapeHtml(e.message)}</td></tr>`;
  } finally {
    showLoading(false);
  }
}

/* ── KPIs (วันนี้ Bangkok TZ) ── */
async function loadKpis() {
  const today = window.IBDExportModal ? IBDExportModal.todayBkk() : new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const dayFilter = window.IBDExportModal ? IBDExportModal.bkkRangeFilter(today, today) : '';

  async function count(extra) {
    const res = await sbFetch(`ibd_complaints?select=id&limit=1${extra ? '&' + extra : ''}${dayFilter}`, { headers: { Prefer: 'count=exact' } });
    return +res.headers.get('content-range')?.split('/')[1] || 0;
  }
  const [total, n, p, r, c] = await Promise.all([
    count(''),
    count('status=eq.new'),
    count('status=eq.in_progress'),
    count('status=eq.resolved'),
    count('status=eq.closed'),
  ]);
  $('kpiTotal').textContent = total;
  $('kpiNew').textContent = n;
  $('kpiProgress').textContent = p;
  $('kpiResolved').textContent = r;
  $('kpiClosed').textContent = c;
}

function renderTable() {
  const tbody = $('tbody');
  if (!state.rows.length) {
    tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;color:var(--text3);padding:30px 0">ยังไม่มีรายการ</td></tr>';
    return;
  }
  tbody.innerHTML = state.rows.map(r => {
    const fileCount = Array.isArray(r.attachment_urls) ? r.attachment_urls.length : 0;
    return `
      <tr class="${r.pinned ? 'pinned' : ''}" onclick="openDetail(${r.id})">
        <td>${statusBadge(r.status)}</td>
        <td style="white-space:nowrap;font-size:12px;color:var(--text2)">${fmtTime(r.created_at)}</td>
        <td>
          <div class="ibd-cell-name">${escapeHtml(r.member_name || '—')}</div>
          <div class="ibd-cell-mono">${escapeHtml(r.member_code || '—')}</div>
        </td>
        <td>${escapeHtml(TOPIC_LABELS[r.topic] || r.topic || '—')}${r.topic === 'other' && r.topic_other ? `<div class="ibd-cell-sub">${escapeHtml(r.topic_other)}</div>` : ''}</td>
        <td>${branchLabel(r.branch_code)}${r.branch_other ? `<div class="ibd-cell-sub">${escapeHtml(r.branch_other)}</div>` : ''}</td>
        <td style="font-family:'IBM Plex Mono',monospace;font-size:12px">${escapeHtml(r.whatsapp_used || '—')}</td>
        <td style="max-width:280px;font-size:12.5px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(r.details || '—')}</td>
        <td style="text-align:center">${fileCount ? `📎 ${fileCount}` : '—'}</td>
        <td onclick="event.stopPropagation()">${caretakerSelect(r)}</td>
        <td onclick="event.stopPropagation()">${progressSelect(r)}</td>
        <td onclick="event.stopPropagation()">${noteInput(r)}</td>
        <td style="text-align:center" onclick="event.stopPropagation()"><div class="ibd-action-group">${pinBtn(r)}${deleteBtn(r)}</div></td>
      </tr>`;
  }).join('');
  if (window.AuthZ) AuthZ.applyDomPerms(tbody);
}

function caretakerSelect(r) {
  const v = r.caretaker_user_id || '';
  const opts = ['<option value="">— ยังไม่ระบุ —</option>']
    .concat(state.caretakers.map(u => `<option value="${u.user_id}" ${String(u.user_id) === String(v) ? 'selected' : ''}>${escapeHtml(u.full_name)}</option>`))
    .join('');
  return `<select class="ibd-caretaker-select ${v ? 'assigned' : ''}" onchange="updateCaretaker(${r.id}, this)">${opts}</select>`;
}

window.updateCaretaker = async function (id, sel) {
  const v = sel.value ? Number(sel.value) : null;
  sel.classList.add('saving');
  try {
    await sbFetch(`ibd_complaints?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ caretaker_user_id: v }) });
    const row = state.rows.find(x => x.id === id); if (row) row.caretaker_user_id = v;
    sel.classList.remove('saving');
    sel.classList.toggle('assigned', !!v);
    sel.classList.add('saved');
    setTimeout(() => sel.classList.remove('saved'), 1200);
  } catch (e) {
    sel.classList.remove('saving');
    toast('บันทึกผู้ดูแลไม่สำเร็จ: ' + e.message, 'error');
  }
};

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
function isAdmin() {
  const u = window.ERP_USER || {};
  if (Array.isArray(u.roles) && u.roles.includes('ADMIN')) return true;
  return u.role === 'ADMIN';
}
function deleteBtn(r) {
  if (!isAdmin()) return '';
  return `<button class="ibd-del-btn" data-perm="ibd_complaints_delete" onclick="deleteRow(${r.id})" title="ลบรายการ">🗑️</button>`;
}

window.updateProgress = async function (id, sel) {
  const v = sel.value;
  sel.className = `ibd-prog-select ${v}`;
  try {
    await sbFetch(`ibd_complaints?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ progress_status: v }) });
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
      await sbFetch(`ibd_complaints?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ note: input.value }) });
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
    await sbFetch(`ibd_complaints?id=eq.${id}`, {
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
    title: 'ลบรายการ?',
    message: 'การลบเป็นการถาวร — ข้อมูลจะหายไปจาก database',
    icon: '🗑️',
    tone: 'danger',
    okText: 'ลบเลย',
    cancelText: 'ยกเลิก',
    details: {
      'Member': row.member_name || '—',
      'รหัส': row.member_code || '—',
      'Topic': TOPIC_LABELS[row.topic] || row.topic || '—',
    },
    note: 'ไฟล์แนบใน Storage จะถูกลบอัตโนมัติพร้อมกัน',
  });
  if (!ok) return;
  showLoading(true);
  try {
    const fileKeys = Array.isArray(row.attachment_urls) ? row.attachment_urls : [];
    await sbFetch(`ibd_complaints?id=eq.${id}`, { method: 'DELETE' });
    // cascade: ลบ in-app notification ที่อ้างถึง submission นี้
    sbFetch(`user_notifications?trigger_key=eq.ibd.complaint.created&payload_ref->>submission_id=eq.${id}`, { method: 'DELETE' }).catch(() => {});
    if (fileKeys.length) {
      const r = await IBDStorage.deleteFiles(fileKeys);
      if (r.failed) toast(`ลบ row แล้ว · ลบไฟล์ ${r.deleted}/${fileKeys.length} (${r.failed} ลบไม่สำเร็จ)`, 'error');
      else toast(`ลบรายการ + ${r.deleted} ไฟล์แล้ว`);
    } else {
      toast('ลบรายการแล้ว');
    }
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
  html += `<span class="pagination-info">${state.total} รายการ · หน้า ${state.page}/${totalPages}</span>`;
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

  $('modalTitle').textContent = `Complaint #${row.id} — ${row.member_name}`;

  const files = Array.isArray(row.attachment_urls) ? row.attachment_urls : [];
  const filesHtml = files.length
    ? renderAttachments(files, 'cFiles')
    : '<span style="color:var(--text3)">ไม่มีไฟล์แนบ</span>';

  $('modalBody').innerHTML = `
    <dl class="detail-list">
      <dt>วันที่ส่ง</dt>      <dd>${fmtTime(row.created_at)}</dd>
      <dt>Member ID</dt>     <dd class="ibd-cell-mono">${escapeHtml(row.member_code || '—')}</dd>
      <dt>Member Name</dt>   <dd>${escapeHtml(row.member_name || '—')}</dd>
      <dt>WhatsApp ที่ติดต่อ</dt><dd>${escapeHtml(row.whatsapp_used || '—')}</dd>
      <dt>CS WhatsApp</dt>   <dd>${escapeHtml(row.cs_whatsapp || '—')}</dd>
      <dt>Topic</dt>         <dd>${escapeHtml(TOPIC_LABELS[row.topic] || row.topic)}${row.topic === 'other' && row.topic_other ? ` — ${escapeHtml(row.topic_other)}` : ''}</dd>
      <dt>Branch</dt>        <dd>${branchLabel(row.branch_code)}${row.branch_other ? ` — ${escapeHtml(row.branch_other)}` : ''}</dd>
      <dt>Status</dt>        <dd>${statusBadge(row.status)}</dd>
      <dt>Language</dt>      <dd>${(row.language || 'en').toUpperCase()}</dd>
    </dl>

    <div class="ibd-section-divider">รายละเอียดเรื่องร้องเรียน</div>
    <div style="font-size:13.5px;line-height:1.55;color:var(--text);white-space:pre-wrap">${escapeHtml(row.details || '—')}</div>

    ${row.others ? `
      <div class="ibd-section-divider">Others</div>
      <div style="font-size:13px;color:var(--text2);white-space:pre-wrap">${escapeHtml(row.others)}</div>` : ''}

    <div class="ibd-section-divider">ไฟล์แนบ</div>
    ${filesHtml}

    ${row.resolution_note ? `
      <div class="ibd-section-divider">Resolution Note</div>
      <div style="font-size:13px;color:var(--text);white-space:pre-wrap;background:var(--surface);padding:10px;border-radius:6px">${escapeHtml(row.resolution_note)}</div>
      <div style="font-size:11.5px;color:var(--text3);margin-top:4px">ปิดเรื่องเมื่อ: ${fmtTime(row.resolved_at)}</div>` : ''}
  `;

  // Action buttons by status + permission
  const foot = $('modalFoot');
  let actions = '';
  if (row.status === 'new' || row.status === 'in_progress') {
    if (window.AuthZ?.hasPerm('ibd_complaints_assign')) {
      actions += row.status === 'new'
        ? `<button class="ibd-mbtn ibd-mbtn-warn" onclick="changeStatus('in_progress')">▶ เริ่มดำเนินการ</button>`
        : '';
    }
    if (window.AuthZ?.hasPerm('ibd_complaints_resolve')) {
      actions += `<button class="ibd-mbtn ibd-mbtn-success" onclick="resolveComplaint()">✓ ปิดเรื่อง (Resolved)</button>`;
    }
  } else if (row.status === 'resolved') {
    if (window.AuthZ?.hasPerm('ibd_complaints_resolve')) {
      actions += `<button class="ibd-mbtn ibd-mbtn-ghost" onclick="changeStatus('closed')">📁 Close</button>`;
      actions += `<button class="ibd-mbtn ibd-mbtn-warn" onclick="changeStatus('in_progress')">↩ เปิดใหม่</button>`;
    }
  }
  actions += `<button class="ibd-mbtn ibd-mbtn-ghost" onclick="closeModal()">ปิด</button>`;
  foot.innerHTML = actions;

  $('detailModal').classList.add('open');
  if (window.AuthZ) AuthZ.applyDomPerms(foot);
  hydrateAttachments(files, 'cFiles');
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
        <a class="ibd-img-thumb" data-key="${escapeHtml(k)}" data-idx="${i}" id="${idPrefix}-thumb-${i}" onclick="openLightbox('${idPrefix}', ${i});return false;">
          <div class="ibd-img-loading">⏳</div>
          <div class="ibd-img-thumb-label">${safeName}</div>
        </a>`;
    });
    html += '</div>';
  }
  if (others.length) {
    html += `<div class="ibd-attachments" id="${idPrefix}-other">`;
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

  // Image previews
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

  // Non-image chips → set href to signed URL
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

/* ── Lightbox ── */
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

window.changeStatus = async function (newStatus) {
  if (!state.current) return;
  const id = state.current.id;
  showLoading(true);
  try {
    const me = window.ERP_USER?.user_id || null;
    const body = { status: newStatus };
    if (newStatus === 'in_progress' && !state.current.assigned_to) body.assigned_to = me;
    await sbFetch(`ibd_complaints?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(body), headers: { Prefer: 'return=representation' } });
    toast('อัปเดตสถานะเรียบร้อย');
    closeModal();
    loadList();
  } catch (e) {
    toast('อัปเดตไม่สำเร็จ: ' + e.message, 'error');
  } finally {
    showLoading(false);
  }
};

window.resolveComplaint = async function () {
  if (!state.current) return;
  const note = await PromptModal.open({
    title: 'ปิดเรื่อง — Resolution Note',
    message: 'สรุปสิ่งที่ทำให้ลูกค้า / ผลสรุปการแก้ไข',
    icon: '✓',
    tone: 'success',
    okText: 'ปิดเรื่อง',
    multiline: true,
    placeholder: 'ระบุรายละเอียดผลสรุป...',
    required: true,
  });
  if (note === null) return;
  showLoading(true);
  try {
    await sbFetch(`ibd_complaints?id=eq.${state.current.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'resolved',
        resolution_note: note,
        resolved_at: new Date().toISOString(),
      }),
    });
    toast('ปิดเรื่องเรียบร้อย');
    closeModal();
    loadList();
  } catch (e) {
    toast('ปิดเรื่องไม่สำเร็จ: ' + e.message, 'error');
  } finally {
    showLoading(false);
  }
};

/* ── Export CSV (with date range modal) ── */
window.exportCsv = async function () {
  const range = await IBDExportModal.open({ title: 'ส่งออก Complaints', defaultPreset: 'today' });
  if (!range) return;

  showLoading(true);
  try {
    const f = state.filters;
    const conds = [];
    if (f.status) conds.push(`status=eq.${f.status}`);
    if (f.topic)  conds.push(`topic=eq.${f.topic}`);
    if (f.branch) conds.push(`branch_code=eq.${f.branch}`);
    const dateFilter = IBDExportModal.bkkRangeFilter(range.from, range.to);
    const path = `ibd_complaints?select=*&${conds.join('&')}&order=created_at.desc&limit=10000${dateFilter}`;
    const res = await sbFetch(path);
    const rows = await res.json();

    const headers = ['ID', 'Date', 'Member Code', 'Member Name', 'WhatsApp', 'Topic', 'Branch', 'Details', 'Status', 'Progress', 'Note', 'Pinned', 'Resolution'];
    const csvRows = [headers.join(',')];
    rows.forEach(r => {
      const cols = [
        r.id,
        fmtTime(r.created_at),
        r.member_code,
        r.member_name,
        r.whatsapp_used,
        TOPIC_LABELS[r.topic] || r.topic,
        branchLabel(r.branch_code).replace(/[🇳🇬🇨🇮🇨🇲🇹🇬🇺🇬🇿🇦🇬🇭🇹🇭🇱🇦]/g, '').trim(),
        r.details,
        r.status,
        r.progress_status,
        r.note,
        r.pinned ? 'YES' : '',
        r.resolution_note,
      ].map(v => `"${String(v ?? '').replace(/"/g, '""').replace(/\n/g, ' ')}"`);
      csvRows.push(cols.join(','));
    });
    const blob = new Blob(['﻿' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `ibd-complaints-${range.label}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast(`Export ${rows.length} รายการแล้ว`);
  } catch (e) {
    toast('Export ไม่สำเร็จ: ' + e.message, 'error');
  } finally {
    showLoading(false);
  }
};

/* ── Init ── */
async function init() {
  $('filtSearch').addEventListener('input', debounce(() => {
    state.filters.search = $('filtSearch').value.trim();
    state.page = 1;
    loadList();
  }, 300));
  ['filtStatus', 'filtTopic', 'filtBranch'].forEach(id => {
    $(id).addEventListener('change', () => {
      state.filters.status = $('filtStatus').value;
      state.filters.topic  = $('filtTopic').value;
      state.filters.branch = $('filtBranch').value;
      state.page = 1;
      loadList();
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if ($('lightbox').classList.contains('open')) { closeLightbox(); return; }
    if ($('detailModal').classList.contains('open')) closeModal();
  });

  await loadBranches();
  await loadCaretakers();
  await loadList();
  startAutoRefresh();
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// auto-refresh ทุก 30s — ข้ามถ้าหน้าโดนซ่อน, modal/lightbox เปิด, หรือผู้ใช้กำลังพิมพ์
function startAutoRefresh() {
  const AUTO_REFRESH_MS = 30000;
  setInterval(() => {
    if (document.hidden) return;
    if ($('detailModal')?.classList.contains('open')) return;
    if ($('lightbox')?.classList.contains('open')) return;
    if (document.querySelector('.cm-overlay.open, .pm-overlay.open')) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    loadList();
  }, AUTO_REFRESH_MS);
}

window.addEventListener('DOMContentLoaded', init);
