/* ============================================================
   petty-cash-form.js — สมุดเงินสดย่อย (Petty Cash) + ออกเอกสาร
   ------------------------------------------------------------
   • กรอก ledger (วันที่/รายละเอียด/เงินนำเข้า/ค่าใช้จ่าย)
   • บันทึกลง petty_cash_books + petty_cash_items
   • เลือกบรรทัด → ออก: สรุป Petty Cash / ใบรับรองแทนใบเสร็จ / ใบสำคัญเงินสดย่อย
   ============================================================ */

let SUPABASE_URL = localStorage.getItem('sb_url') || '';
let SUPABASE_KEY = localStorage.getItem('sb_key') || '';

let rowCount       = 0;
let editingBookId  = null;   // null = create · มีค่า = edit
let formDirty      = false;
let pendingDoc     = null;   // { type:'cert'|'voucher', rows:[...] } ระหว่างเปิด meta modal

// หัวกระดาษบริษัท — fallback ถ้า app_settings ยังไม่ตั้งค่า
const COMPANY_FALLBACK = Object.freeze({
  name:    'บริษัท เอโฟร์เอส แดน คอร์ปอเรชั่น จำกัด',
  address: '2639 อาคารอิมพีเรียล เวิลด์ ลาดพร้าว ชั้น 3 ห้อง เอ ที่ เอ-2-3 ซอยลาดพร้าว 81-83 ถนนลาดพร้าว แขวงคลองเจ้าคุณสิงห์ เขตวังทองหลาง กรุงเทพมหานคร 10310',
  phone:   '02 157 3013-14',
  logo:    '../../../assets/logo/logo-a4s.png',
});

function getCompany() {
  return {
    name:    (localStorage.getItem('company_name') || '').trim()    || COMPANY_FALLBACK.name,
    address: (localStorage.getItem('company_address') || '').trim() || COMPANY_FALLBACK.address,
    phone:   (localStorage.getItem('company_phone') || '').trim()   || COMPANY_FALLBACK.phone,
    logo:    (window.CompanyLogo?.logoUrl?.(COMPANY_FALLBACK.logo)) || COMPANY_FALLBACK.logo,
  };
}

// ============================================================
// SUPABASE
// ============================================================
async function supabaseFetch(table, options = {}) {
  const { method = 'GET', body, query = '' } = options;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method,
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        method === 'POST' || method === 'PATCH' ? 'return=representation' : '',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || 'Error'); }
  return method === 'DELETE' ? null : res.json().catch(() => null);
}

// ============================================================
// LETTERHEAD + RTE (port จาก trip-docs — ใช้ data ร่วม trip_doc_letterheads)
// ============================================================
const state = { letterheads: [], company: {}, editLhId: null };
let _lastRteRange = null, _lastArea = null;

const LETTERHEAD = {
  logoUrl: '../../../assets/logo/logo-a4s.png',
  nameEn: 'A4S Can Corporation Co., Ltd.',
  addr: 'Imperial World Ladprao 3rd Floor, Room AT 02-03, No. 2539 Khlong Chaokhun Sing,\nKhet Wang Thonglang, Bangkok 10310.',
};

function getSB() {
  return { url: localStorage.getItem('sb_url') || '', key: localStorage.getItem('sb_key') || '' };
}
async function sbFetch(table, query = '', opts = {}) {
  const { url, key } = getSB();
  const { method = 'GET', body } = opts;
  const res = await fetch(`${url}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
      Prefer: method === 'POST' || method === 'PATCH' ? 'return=representation' : '',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || 'API Error'); }
  return method === 'DELETE' ? null : res.json().catch(() => null);
}

function stripHtml(html) {
  if (!html) return '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.textContent || '').replace(/\s+/g, ' ').trim();
}

// โหลดหัวกระดาษ + ข้อมูลบริษัท (app_settings) → เติม dropdown
async function loadLetterheads() {
  try {
    const [lhs, comp] = await Promise.all([
      sbFetch('trip_doc_letterheads', '?select=*&order=letterhead_id').catch(() => []),
      sbFetch('app_settings', '?select=key,value&key=like.company_*').catch(() => []),
    ]);
    state.letterheads = lhs || [];
    state.company = Object.fromEntries((comp || []).map((r) => [r.key, r.value]));
    const def = state.letterheads.find((l) => l.is_default);
    fillLetterheadSelect('pcLetterhead', def ? def.letterhead_id : null);
  } catch (e) { console.warn('[loadLetterheads]', e); }
}

function fillLetterheadSelect(selId, selectedId) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  sel.innerHTML = `<option value="">— หัวเริ่มต้น —</option>` +
    state.letterheads.map((l) => `<option value="${l.letterhead_id}">${escapeHtml(l.name)}</option>`).join('');
  sel.value = selectedId != null ? String(selectedId) : '';
}
function selectedLetterheadId() { return document.getElementById('pcLetterhead')?.value || ''; }

function resolveLetterhead(id) {
  if (id) { const f = state.letterheads.find((l) => l.letterhead_id === +id); if (f) return f; }
  const def = state.letterheads.find((l) => l.is_default);
  if (def) return def;
  if (state.letterheads.length) return state.letterheads[0];
  return { logo_data: null, company_name: LETTERHEAD.nameEn, address: LETTERHEAD.addr };
}
function legacyLetterheadHtml(l) {
  return `<div style="font-weight:700;font-size:16px;color:#111">${escapeHtml(l.company_name || LETTERHEAD.nameEn)}</div>` +
    `<div style="font-size:12.5px;line-height:1.6;color:#222;white-space:pre-line">${escapeHtml(l.address || LETTERHEAD.addr)}</div>`;
}
function companyLogoUrl() { return (state.company && state.company.company_logo_url) || LETTERHEAD.logoUrl; }
function companyLetterheadHtml() {
  const c = state.company || {};
  const name = c.company_name_en || c.company_name || '';
  const addr = c.company_address_en || c.company_address || '';
  const contact = [
    c.company_phone ? `Tel: ${c.company_phone}` : '',
    c.company_email ? `Email: ${c.company_email}` : '',
    c.company_website ? `Website: ${c.company_website}` : '',
  ].filter(Boolean).join(' | ');
  return `<div style="font-weight:700;font-size:18px;color:#2e9e2e">${escapeHtml(name)}</div>` +
    (addr ? `<div style="font-size:13px;line-height:1.55;color:#222">${escapeHtml(addr)}</div>` : '') +
    (contact ? `<div style="font-size:13px;color:#222">${escapeHtml(contact)}</div>` : '');
}
function buildLetterheadHead(lh) {
  const logoSrc = lh.logo_data || companyLogoUrl();
  const contentHtml = lh.content_html && lh.content_html.trim() ? lh.content_html : legacyLetterheadHtml(lh);
  const pos = lh.logo_position || 'left';
  const lw = +lh.logo_width || 120;
  const logoImg = logoSrc
    ? `<img src="${logoSrc}" alt="logo" crossorigin="anonymous" style="max-width:${lw}px;max-height:${Math.round(lw * 0.8)}px;height:auto" onerror="this.style.display='none'" />`
    : '';
  const valign = lh.logo_valign || 'top';
  const ai = valign === 'center' ? 'center' : valign === 'bottom' ? 'flex-end' : 'flex-start';
  if (pos === 'top') {
    return `<div class="doc-letterhead" style="flex-direction:column;align-items:center;gap:8px"><div class="lh-logo" style="width:auto;text-align:center">${logoImg}</div><div class="lh-info" style="text-align:center">${contentHtml}</div></div>`;
  }
  const dir = pos === 'right' ? 'row-reverse' : 'row';
  return `<div class="doc-letterhead" style="flex-direction:${dir};align-items:${ai}"><div class="lh-logo" style="width:${lw}px">${logoImg}</div><div class="lh-info">${contentHtml}</div></div>`;
}

// ── RTE (contenteditable + execCommand) ──
function initRTE() {
  try { document.execCommand('styleWithCSS', false, true); } catch (e) {}
  document.querySelectorAll('.rte-toolbar button[data-cmd]').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => { document.execCommand(btn.dataset.cmd, false, null); updateLhSimulator(); });
  });
  document.querySelectorAll('.rte-toolbar button[data-font]').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => rteFont(btn.dataset.font === 'up' ? 2 : -2));
  });
  document.querySelectorAll('.rte-size').forEach((inp) => {
    inp.addEventListener('change', () => { const px = parseInt(inp.value, 10); if (!px || !_lastArea) return; _lastArea.focus(); restoreRteRange(); applyFontPx(px); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
  });
  document.querySelectorAll('.rte-color').forEach((inp) => {
    inp.addEventListener('input', () => { if (!_lastArea) return; _lastArea.focus(); restoreRteRange(); document.execCommand('foreColor', false, inp.value); updateLhSimulator(); });
  });
  document.addEventListener('selectionchange', onRteSelChange);
}
function anchorEl(sel) { const a = sel.anchorNode; return a && (a.nodeType === 3 ? a.parentElement : a); }
function onRteSelChange() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const el = anchorEl(sel);
  const area = el && el.closest && el.closest('.rte-area');
  if (!area) return;
  _lastRteRange = sel.getRangeAt(0).cloneRange();
  _lastArea = area;
  const cur = Math.round(parseFloat(getComputedStyle(el).fontSize) || 15);
  const box = area.parentElement.querySelector('.rte-size');
  if (box && document.activeElement !== box) box.value = cur;
}
function restoreRteRange() { if (!_lastRteRange) return; const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(_lastRteRange); }
function applyFontPx(px) {
  px = Math.min(96, Math.max(9, px | 0));
  document.execCommand('styleWithCSS', false, false);
  document.execCommand('fontSize', false, '7');
  document.querySelectorAll('.rte-area font[size="7"]').forEach((f) => { f.removeAttribute('size'); f.style.fontSize = px + 'px'; });
  document.execCommand('styleWithCSS', false, true);
  onRteSelChange();
  updateLhSimulator();
}
function rteFont(delta) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed) { showToast('เลือกข้อความที่ต้องการปรับขนาดก่อน', 'error'); return; }
  const el = anchorEl(sel);
  const cur = el ? parseFloat(getComputedStyle(el).fontSize) || 15 : 15;
  applyFontPx(Math.round(cur) + delta);
}
function getEditorHTML(id) { return document.getElementById(id)?.innerHTML || ''; }
function setEditorHTML(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html || ''; }

// ── Letterhead manager (⚙️ จัดการ) ──
window.openLetterheadManager = function () { resetLetterheadForm(); renderLetterheadList(); document.getElementById('lhMgrOverlay').classList.add('open'); };
window.closeLetterheadManager = function (e) {
  if (e && e.target.id !== 'lhMgrOverlay') return;
  document.getElementById('lhMgrOverlay').classList.remove('open');
  fillLetterheadSelect('pcLetterhead', document.getElementById('pcLetterhead')?.value || null);
};
function renderLetterheadList() {
  const wrap = document.getElementById('lhList');
  if (!wrap) return;
  if (!state.letterheads.length) { wrap.innerHTML = `<div style="padding:8px 0;color:var(--text3);font-size:12.5px">ยังไม่มีหัวกระดาษ — เพิ่มด้านขวา</div>`; return; }
  wrap.innerHTML = state.letterheads.map((l) => `<div class="lh-item${state.editLhId === l.letterhead_id ? ' active' : ''}" title="คลิกเพื่อแก้ไข" onclick="window.editLetterhead(${l.letterhead_id})">
      <img src="${l.logo_data || companyLogoUrl()}" alt="logo" onerror="this.style.display='none'" />
      <div class="lh-item-meta"><b title="${escapeHtml(l.name)}">${l.is_default ? '⭐ ' : ''}${escapeHtml(l.name)}</b><small>${escapeHtml(stripHtml(l.content_html) || l.company_name || '—')}</small></div>
      <div class="lh-item-acts"><button class="btn-icon danger" title="ลบ" onclick="event.stopPropagation(); window.deleteLetterhead(${l.letterhead_id})">🗑</button></div>
    </div>`).join('');
}
window.updateLhSimulator = function () {
  const box = document.getElementById('lhSimulator');
  if (!box) return;
  if (!document.getElementById('lhMgrOverlay')?.classList.contains('open')) return;
  const html = getEditorHTML('lhContent');
  const tempLh = {
    content_html: html && stripHtml(html) ? html : '',
    logo_position: document.getElementById('lhLogoPos').value || 'left',
    logo_valign: document.getElementById('lhLogoVAlign').value || 'top',
    logo_width: +document.getElementById('lhLogoWidth').value || 120,
    logo_data: null,
  };
  const head = buildLetterheadHead(tempLh);
  const paper = `<div class="doc-paper" style="width:666px;padding:0;margin:0;min-height:0;box-shadow:none;background:transparent">${head}</div>`;
  box.innerHTML = `<div class="lh-sim-scale" style="width:666px">${paper}</div>`;
  const wrap = box.querySelector('.lh-sim-scale');
  const band = wrap.firstElementChild;
  const avail = box.clientWidth - 28;
  const s = avail > 0 ? Math.min(1, avail / 666) : 0.72;
  wrap.style.transform = `scale(${s})`;
  box.style.height = Math.max(56, band.offsetHeight * s + 24) + 'px';
};
window.pullCompanyInfo = function () {
  if (!state.company || (!state.company.company_name && !state.company.company_name_en)) { showToast('ยังไม่มีข้อมูลบริษัท — ตั้งค่าที่หน้า ตั้งค่าบริษัท ก่อน', 'error'); return; }
  setEditorHTML('lhContent', companyLetterheadHtml());
  updateLhSimulator();
  showToast('ดึงข้อมูลบริษัทแล้ว — ปรับแต่งต่อได้เลย', 'success');
};
window.resetLetterheadForm = function () {
  state.editLhId = null;
  document.getElementById('lhName').value = '';
  setEditorHTML('lhContent', '');
  document.getElementById('lhDefault').checked = false;
  document.getElementById('lhLogoPos').value = 'left';
  document.getElementById('lhLogoVAlign').value = 'top';
  document.getElementById('lhLogoWidth').value = 120;
  document.getElementById('lhSaveBtn').textContent = '＋ เพิ่มหัวกระดาษ';
  document.getElementById('lhCancelEdit').style.display = 'none';
  renderLetterheadList();
  updateLhSimulator();
};
window.editLetterhead = function (id) {
  const l = state.letterheads.find((x) => x.letterhead_id === id);
  if (!l) return;
  state.editLhId = id;
  document.getElementById('lhName').value = l.name || '';
  setEditorHTML('lhContent', l.content_html || legacyLetterheadHtml(l));
  document.getElementById('lhDefault').checked = !!l.is_default;
  document.getElementById('lhLogoPos').value = l.logo_position || 'left';
  document.getElementById('lhLogoVAlign').value = l.logo_valign || 'top';
  document.getElementById('lhLogoWidth').value = l.logo_width || 120;
  document.getElementById('lhSaveBtn').textContent = '💾 บันทึกการแก้ไข';
  document.getElementById('lhCancelEdit').style.display = '';
  renderLetterheadList();
  updateLhSimulator();
};
window.saveLetterhead = async function () {
  const name = document.getElementById('lhName').value.trim();
  if (!name) { showToast('กรุณากรอกชื่อหัวกระดาษ', 'error'); return; }
  const isDefault = document.getElementById('lhDefault').checked;
  const payload = {
    name, content_html: getEditorHTML('lhContent'),
    logo_position: document.getElementById('lhLogoPos').value || 'left',
    logo_valign: document.getElementById('lhLogoVAlign').value || 'top',
    logo_width: parseInt(document.getElementById('lhLogoWidth').value, 10) || 120,
    is_default: isDefault, updated_at: new Date().toISOString(),
  };
  showLoading(true);
  try {
    let savedId = state.editLhId;
    if (state.editLhId) {
      await sbFetch('trip_doc_letterheads', `?letterhead_id=eq.${state.editLhId}`, { method: 'PATCH', body: payload });
      showToast('แก้ไขหัวกระดาษแล้ว', 'success');
    } else {
      const rows = await sbFetch('trip_doc_letterheads', '', { method: 'POST', body: payload });
      savedId = (Array.isArray(rows) ? rows[0] : rows)?.letterhead_id;
      showToast('เพิ่มหัวกระดาษแล้ว', 'success');
    }
    if (isDefault && savedId) {
      await sbFetch('trip_doc_letterheads', `?letterhead_id=neq.${savedId}`, { method: 'PATCH', body: { is_default: false } }).catch(() => {});
    }
    state.letterheads = (await sbFetch('trip_doc_letterheads', '?select=*&order=letterhead_id').catch(() => [])) || [];
    resetLetterheadForm();
    renderLetterheadList();
    fillLetterheadSelect('pcLetterhead', savedId || document.getElementById('pcLetterhead')?.value || null);
  } catch (e) { showToast('บันทึกไม่ได้: ' + e.message, 'error'); }
  showLoading(false);
};
window.deleteLetterhead = async function (id) {
  const l = state.letterheads.find((x) => x.letterhead_id === id);
  if (!l) return;
  const ok = (typeof ConfirmModal !== 'undefined' && ConfirmModal.open)
    ? await ConfirmModal.open({ title: 'ลบหัวกระดาษ', message: `ลบหัวกระดาษ "${l.name}" หรือไม่?`, icon: '🗑', okText: 'ลบ', tone: 'danger', note: 'เอกสารที่ใช้หัวนี้จะกลับไปใช้หัวเริ่มต้น' })
    : window.confirm(`ลบหัวกระดาษ "${l.name}"?`);
  if (!ok) return;
  showLoading(true);
  try {
    await sbFetch('trip_doc_letterheads', `?letterhead_id=eq.${id}`, { method: 'DELETE' });
    showToast('ลบหัวกระดาษแล้ว', 'success');
    state.letterheads = (await sbFetch('trip_doc_letterheads', '?select=*&order=letterhead_id').catch(() => [])) || [];
    if (state.editLhId === id) resetLetterheadForm();
    renderLetterheadList();
    fillLetterheadSelect('pcLetterhead', document.getElementById('pcLetterhead')?.value || null);
  } catch (e) { showToast('ลบไม่ได้: ' + e.message, 'error'); }
  showLoading(false);
};

function getPcPrefix(d = new Date()) {
  const y  = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `PC-${y}-${mm}-`;
}

// ============================================================
// DATE INPUT (free text — โชว์ตามที่พิมพ์เป๊ะ · รองรับ 21/01/69 และ 21/01/2026)
// เก็บใน DB เป็น text (line_date) เพื่อให้เอกสารพิมพ์ตรงต้นฉบับ (พ.ศ. ย่อ ได้)
// ============================================================
// ใส่ "/" อัตโนมัติระหว่างพิมพ์ → วว/ดด/ปป(ปป)
function onDateInput(el) {
  const d = el.value.replace(/\D/g, '').slice(0, 8);  // ddmmyy(yy)
  let out = d.slice(0, 2);
  if (d.length >= 3) out += '/' + d.slice(2, 4);
  if (d.length >= 5) out += '/' + d.slice(4, 8);
  el.value = out;
}

// ============================================================
// ITEMS TABLE
// ============================================================
function addItemRow(data = null) {
  rowCount++;
  const n = rowCount;
  const tbody = document.getElementById('itemsBody');
  const tr = document.createElement('tr');
  tr.id = `row-${n}`;
  tr.innerHTML = `
    <td class="text-center"><input type="checkbox" class="pc-row-check row-check" data-row="${n}"></td>
    <td class="text-center"><div class="item-num">${n}</div></td>
    <td><input type="text" class="td-input pc-date" id="date-${n}" placeholder="วว/ดด/ปปปป" maxlength="10" inputmode="numeric" oninput="onDateInput(this)"></td>
    <td><input type="text" class="td-input" id="detail-${n}" placeholder="รายละเอียด..."></td>
    <td><input type="text" class="td-input" id="payee-${n}" placeholder="ผู้รับเงิน"></td>
    <td class="text-right"><input type="number" class="td-input text-right" id="in-${n}" placeholder="0.00" min="0" step="0.01" oninput="calcSummary()"></td>
    <td class="text-right"><input type="number" class="td-input text-right" id="out-${n}" placeholder="0.00" min="0" step="0.01" oninput="calcSummary()"></td>
    <td><button class="btn-remove" onclick="removeRow(${n})" title="ลบบรรทัด">✕</button></td>`;
  tbody.appendChild(tr);

  if (data) {
    if (data.line_date) document.getElementById(`date-${n}`).value = fmtDate(data.line_date);
    document.getElementById(`detail-${n}`).value = data.detail || '';
    document.getElementById(`payee-${n}`).value  = data.payee || '';
    if (parseFloat(data.cash_in))    document.getElementById(`in-${n}`).value  = data.cash_in;
    if (parseFloat(data.amount_out)) document.getElementById(`out-${n}`).value = data.amount_out;
  }
  calcSummary();
  formDirty = true;
  return n;
}

function removeRow(n) {
  document.getElementById(`row-${n}`)?.remove();
  calcSummary();
  formDirty = true;
}

function toggleAllRows(el) {
  document.querySelectorAll('#itemsBody .row-check').forEach(cb => cb.checked = el.checked);
}

// อ่านทุกบรรทัด (ข้ามบรรทัดว่างสนิท) — renumber # ด้วย
function collectRows() {
  const rows = [];
  const trs = document.querySelectorAll('#itemsBody tr');
  let seq = 0;
  trs.forEach(tr => {
    const n = tr.id.replace('row-', '');
    const date    = (document.getElementById(`date-${n}`)?.value || '').trim();  // free text (โชว์ตามที่พิมพ์)
    const detail  = (document.getElementById(`detail-${n}`)?.value || '').trim();
    const payee   = (document.getElementById(`payee-${n}`)?.value || '').trim();
    const cashIn  = parseFloat(document.getElementById(`in-${n}`)?.value) || 0;
    const amountOut = parseFloat(document.getElementById(`out-${n}`)?.value) || 0;
    const checked = !!tr.querySelector('.row-check')?.checked;
    const empty = !date && !detail && !payee && !cashIn && !amountOut;
    if (empty) return;
    seq++;
    const numEl = tr.querySelector('.item-num');
    if (numEl) numEl.textContent = seq;
    rows.push({ n, date, detail, payee, cashIn, amountOut, checked });
  });
  return rows;
}

function calcSummary() {
  const rows = collectRows();
  const sumIn  = rows.reduce((a, r) => a + r.cashIn, 0);
  const sumOut = rows.reduce((a, r) => a + r.amountOut, 0);
  document.getElementById('sumIn').textContent      = fmtMoney(sumIn);
  document.getElementById('sumOut').textContent     = fmtMoney(sumOut);
  document.getElementById('sumBalance').textContent = fmtMoney(sumIn - sumOut);
  document.getElementById('itemCount').textContent  = `${rows.length} บรรทัด`;
}

// ============================================================
// EDIT MODE
// ============================================================
async function loadBookForEdit(bookId) {
  showLoading(true);
  try {
    const [bookRows, itemRows] = await Promise.all([
      supabaseFetch('petty_cash_books', { query: `?book_id=eq.${bookId}&select=*` }),
      supabaseFetch('petty_cash_items', { query: `?book_id=eq.${bookId}&select=*&order=sort_order,item_id` }),
    ]);
    const book = bookRows?.[0];
    if (!book) { showToast('ไม่พบ Petty Cash #' + bookId, 'error'); return; }

    // status badge
    const badge = document.getElementById('statusBadge');
    const st = String(book.status || 'DRAFT').toUpperCase();
    badge.textContent = '● ' + st;
    badge.className = 'pc-status-badge ' + (st === 'FINAL' ? 'badge-final' : 'badge-draft');

    // เลขที่ — split prefix + seq
    const full = book.book_no || '';
    const dash = full.lastIndexOf('-');
    if (dash > 0) {
      document.getElementById('pcPrefix').textContent = full.slice(0, dash + 1);
      document.getElementById('pcNumber').value       = full.slice(dash + 1);
    } else {
      document.getElementById('pcNumber').value = full;
    }

    document.getElementById('itemsBody').innerHTML = '';
    rowCount = 0;
    (itemRows || []).forEach(it => addItemRow(it));
    if (!itemRows?.length) addItemRow();
    calcSummary();
    showToast('โหลด Petty Cash เพื่อแก้ไข', 'success');
  } catch (e) {
    showToast('โหลดข้อมูลไม่สำเร็จ: ' + e.message, 'error');
  }
  showLoading(false);
}

// ============================================================
// SAVE
// ============================================================
async function fetchNextNumber() {
  const prefix = getPcPrefix();
  try {
    const rows = await supabaseFetch('petty_cash_books', {
      query: `?book_no=like.${encodeURIComponent(prefix + '%')}&select=book_no&order=book_no.desc&limit=1`,
    });
    const last = rows?.[0]?.book_no;
    if (!last) return '001';
    const seq = parseInt(last.slice(prefix.length), 10) || 0;
    return String(seq + 1).padStart(3, '0');
  } catch (e) { console.warn('[fetchNextNumber]', e); return '001'; }
}

async function refreshNumber() {
  document.getElementById('pcPrefix').textContent = getPcPrefix();
  document.getElementById('pcNumber').value = await fetchNextNumber();
}

async function saveBook() {
  const hasPerm = (k) => (window.AuthZ?.hasPerm ? window.AuthZ.hasPerm(k) : true);
  const needPerm = editingBookId ? 'petty_cash_edit' : 'petty_cash_create';
  if (!hasPerm(needPerm)) { showToast(`ไม่มีสิทธิ์ "${editingBookId ? 'แก้ไข' : 'สร้าง'}" Petty Cash`, 'error'); return; }
  if (!SUPABASE_URL || !SUPABASE_KEY) { showToast('กรุณาเชื่อมต่อ Supabase ก่อน', 'warning'); return; }

  const seq = document.getElementById('pcNumber').value.trim();
  if (!seq) { showToast('กรุณาระบุเลขที่', 'error'); return; }
  const book_no = document.getElementById('pcPrefix').textContent + seq;
  const rows = collectRows();
  if (!rows.length) { showToast('กรุณาเพิ่มรายการอย่างน้อย 1 บรรทัด', 'error'); return; }

  const header = {
    book_no,
    status:      'DRAFT',
    updated_at:  new Date().toISOString(),
  };
  if (window.ERP_USER?.user_id && !editingBookId) header.created_by = parseInt(window.ERP_USER.user_id) || null;

  showLoading(true);
  try {
    let bookId;
    if (editingBookId) {
      await supabaseFetch('petty_cash_books', { method: 'PATCH', query: `?book_id=eq.${editingBookId}`, body: header });
      bookId = editingBookId;
      await supabaseFetch('petty_cash_items', { method: 'DELETE', query: `?book_id=eq.${editingBookId}` });
    } else {
      let result;
      try {
        result = await supabaseFetch('petty_cash_books', { method: 'POST', body: header });
      } catch (e) {
        if (/duplicate key|unique/i.test(e.message || '')) {
          const nextSeq = await fetchNextNumber();
          header.book_no = getPcPrefix() + nextSeq;
          document.getElementById('pcNumber').value = nextSeq;
          showToast(`มีผู้ใช้อื่น claim เลขเดิม → เปลี่ยนเป็น ${header.book_no}`, 'warning');
          result = await supabaseFetch('petty_cash_books', { method: 'POST', body: header });
        } else { throw e; }
      }
      bookId = result[0].book_id;
    }

    // insert items (normalize keys ให้ตรงกันทุก row — กัน PGRST102)
    const itemsBody = rows.map((r, i) => ({
      book_id:    bookId,
      line_date:  r.date || null,
      detail:     r.detail || null,
      cash_in:    r.cashIn || 0,
      amount_out: r.amountOut || 0,
      payee:      r.payee || null,
      remark:     null,
      sort_order: i,
    }));
    if (itemsBody.length) await supabaseFetch('petty_cash_items', { method: 'POST', body: itemsBody });

    formDirty = false;
    showToast(`💾 บันทึก ${header.book_no} สำเร็จ`, 'success');
    setTimeout(() => { window.location.href = './petty-cash-list.html'; }, 1000);
  } catch (e) {
    showToast('บันทึกไม่สำเร็จ: ' + e.message, 'error');
  }
  showLoading(false);
}

// ============================================================
// DOCUMENT GENERATION
// ============================================================
function genDoc(type) {
  applyCompanyToDocs();
  if (type === 'ledger') {
    renderLedger();
    showPreview('docLedger', '📄 สรุป Petty Cash');
    return;
  }
  // cert / voucher — ต้องเลือกบรรทัดค่าใช้จ่าย
  const rows = collectRows().filter(r => r.checked && r.amountOut > 0);
  if (!rows.length) {
    showToast('กรุณาติ๊กเลือกบรรทัดค่าใช้จ่าย (ช่องซ้ายสุด) อย่างน้อย 1 บรรทัด', 'warning');
    return;
  }
  pendingDoc = { type, rows };
  openDocMeta(type, rows);
}

function openDocMeta(type, rows) {
  const isCert = type === 'cert';
  document.getElementById('docMetaTitle').textContent = isCert
    ? '📄 ออกใบรับรองแทนใบเสร็จรับเงิน'
    : '📄 ออกใบสำคัญเงินสดย่อย';
  document.getElementById('metaPositionWrap').style.display = isCert ? '' : 'none';
  document.getElementById('metaDocNo').value    = '';
  document.getElementById('metaDocDate').value  = fmtDate(new Date().toISOString().split('T')[0]);
  document.getElementById('metaPayee').value    = rows[0]?.payee || '';
  document.getElementById('metaPosition').value = '';
  document.getElementById('metaHint').textContent = `รวม ${rows.length} บรรทัด · ${fmtMoney(rows.reduce((a, r) => a + r.amountOut, 0))} บาท`;
  document.getElementById('docMetaOverlay').classList.add('open');
  document.getElementById('metaPayee').focus();
}

function closeDocMeta() {
  document.getElementById('docMetaOverlay').classList.remove('open');
}

function confirmDocMeta() {
  if (!pendingDoc) { closeDocMeta(); return; }
  const meta = {
    docNo:    document.getElementById('metaDocNo').value.trim(),
    docDate:  document.getElementById('metaDocDate').value.trim(),
    payee:    document.getElementById('metaPayee').value.trim(),
    position: document.getElementById('metaPosition').value.trim(),
  };
  closeDocMeta();
  if (pendingDoc.type === 'cert') {
    renderCert(meta, pendingDoc.rows);
    showPreview('docCert', '📄 ใบรับรองแทนใบเสร็จรับเงิน');
  } else {
    renderVoucher(meta, pendingDoc.rows);
    showPreview('docVoucher', '📄 ใบสำคัญเงินสดย่อย');
  }
}

function applyCompanyToDocs() {
  // หัวกระดาษ ledger/voucher render ผ่าน buildLetterheadHead แล้ว — ที่นี่เหลือแค่ชื่อบริษัทในย่อหน้าใบรับรอง
  const cc = document.getElementById('certCompany');
  if (cc) cc.textContent = (state.company && state.company.company_name) || getCompany().name;
}

// --- LEDGER ---
function renderLedger() {
  const rows = collectRows();
  document.getElementById('ldgSubtitle').textContent = '';
  // หัวแบบเรียบตามต้นฉบับ: โลโก้ซ้าย + ชื่อบริษัทไทยกึ่งกลาง (ไม่ใช้ letterhead เขียว)
  const cName = (state.company && state.company.company_name) || 'บริษัท เอโฟร์เอส แดน คอร์ปอเรชั่น จำกัด';
  document.getElementById('ldgLetterhead').innerHTML =
    `<div class="pcl-simplehead"><img class="pcl-logo" src="${companyLogoUrl()}" alt="logo" crossorigin="anonymous" onerror="this.style.display='none'"><div class="pcl-company">${escapeHtml(cName)}</div></div>`;

  const tbody = document.getElementById('ldgBody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#9aa5b1;padding:16px">— ไม่มีรายการ —</td></tr>`;
  } else {
    tbody.innerHTML = rows.map(r => `
      <tr>
        <td>${fmtDate(r.date)}</td>
        <td>${escapeHtml(r.detail)}</td>
        <td class="r">${r.cashIn ? fmtMoney(r.cashIn) : ''}</td>
        <td class="r">${r.amountOut ? fmtMoney(r.amountOut) : ''}</td>
      </tr>`).join('');
  }
  const sumIn  = rows.reduce((a, r) => a + r.cashIn, 0);
  const sumOut = rows.reduce((a, r) => a + r.amountOut, 0);
  document.getElementById('ldgFoot').innerHTML = `
    <tr><td></td><td class="pcl-foot-label"></td><td class="r">${fmtMoney(sumIn)}</td><td class="r"></td></tr>
    <tr><td colspan="3" class="pcl-foot-label">Reimbursement Petty Cash</td><td class="r">${fmtMoney(sumOut)}</td></tr>
    <tr><td colspan="3" class="pcl-foot-label">Balance</td><td class="r">${fmtMoney(sumIn - sumOut)}</td></tr>`;

  document.getElementById('ldgPrep').textContent    = '';
  document.getElementById('ldgApprove').textContent = '';
}

// --- CERTIFICATE ---
function renderCert(meta, rows) {
  const total = rows.reduce((a, r) => a + r.amountOut, 0);
  document.getElementById('certNo').textContent   = meta.docNo || ' ';
  document.getElementById('certDate').textContent = meta.docDate ? fmtDate(meta.docDate) : ' ';

  document.getElementById('certBody').innerHTML = rows.map(r => `
    <tr>
      <td class="c">${fmtDate(r.date)}</td>
      <td>${escapeHtml(r.detail)}</td>
      <td class="r">${fmtMoney(r.amountOut)}</td>
      <td></td>
    </tr>`).join('') || `<tr><td class="c">&nbsp;</td><td></td><td></td><td></td></tr>`;

  document.getElementById('certTotal').textContent    = fmtMoney(total);
  document.getElementById('certBahtText').textContent = window.BahtText ? window.BahtText(total) : '';

  const payee = meta.payee || ' ';
  document.getElementById('certPayee1').textContent = payee;
  document.getElementById('certPayee2').textContent = payee;
  document.getElementById('certPayee3').textContent = meta.payee || ' ';
  document.getElementById('certPosition').textContent = meta.position || ' ';

  // ช่วงวันที่ — min/max ของบรรทัดที่เลือก
  const dates = rows.map(r => r.date).filter(Boolean).sort();
  const from = dates[0] || '';
  const to   = dates[dates.length - 1] || '';
  document.getElementById('certFrom').textContent = from ? fmtDate(from) : ' ';
  document.getElementById('certTo').textContent   = to ? fmtDate(to) : ' ';
}

// --- VOUCHER ---
function renderVoucher(meta, rows) {
  const total = rows.reduce((a, r) => a + r.amountOut, 0);
  document.getElementById('vchLetterhead').innerHTML = buildLetterheadHead(resolveLetterhead(selectedLetterheadId()));
  document.getElementById('vchDate').textContent  = meta.docDate ? fmtDate(meta.docDate) : ' ';
  document.getElementById('vchNo').textContent    = meta.docNo || ' ';
  document.getElementById('vchPayee').textContent = meta.payee || ' ';

  const minRows = 9;
  const count = Math.max(minRows, rows.length);
  let html = '';
  for (let i = 0; i < count; i++) {
    const r = rows[i];
    html += `
      <tr>
        <td class="no">${i + 1}</td>
        <td>${r ? escapeHtml(r.detail) : '&nbsp;'}</td>
        <td class="amt">${r && r.amountOut ? fmtMoney(r.amountOut) : ''}</td>
      </tr>`;
  }
  document.getElementById('vchBody').innerHTML = html;
  document.getElementById('vchTotal').textContent    = fmtMoney(total);
  document.getElementById('vchBahtText').textContent = window.BahtText ? window.BahtText(total) : '';
  document.getElementById('vchNote').innerHTML = '&nbsp;';
}

// ============================================================
// PREVIEW
// ============================================================
let activeDocType = 'ledger';   // 'ledger' | 'cert' | 'voucher'

function showPreview(docId, title) {
  document.querySelectorAll('.pc-doc').forEach(d => d.classList.remove('active'));
  document.getElementById(docId).classList.add('active');
  document.getElementById('previewTitle').textContent = title;
  activeDocType = docId === 'docCert' ? 'cert' : docId === 'docVoucher' ? 'voucher' : 'ledger';
  // Excel เฉพาะใบสรุป (มีโครงตาราง) — cert/voucher ใช้ PDF/PNG
  const xbtn = document.getElementById('btnExportExcel');
  if (xbtn) xbtn.style.display = activeDocType === 'ledger' ? '' : 'none';
  document.getElementById('previewOverlay').classList.add('open');
}

function closePreview() {
  if (document.documentElement.classList.contains('headless')) { window.close(); return; }
  document.getElementById('previewOverlay').classList.remove('open');
}

function printDoc() { window.print(); }

// ── ชื่อไฟล์ export ──
function docFileName() {
  const no = (document.getElementById('pcPrefix').textContent + document.getElementById('pcNumber').value.trim())
    .replace(/[\\/:*?"<>|]/g, '-') || 'PettyCash';
  const suffix = activeDocType === 'cert' ? '_ใบรับรองแทนใบเสร็จ'
               : activeDocType === 'voucher' ? '_ใบสำคัญเงินสดย่อย'
               : '_PettyCash';
  return no + suffix;
}

// ── Export ใบสรุป Petty Cash จาก footer โดยตรง (ไม่ต้องเปิดพรีวิวก่อน) ──
async function exportLedger(fmt) {
  const rows = collectRows();
  if (!rows.length) { showToast('กรุณาเพิ่มรายการก่อน Export', 'warning'); return; }
  activeDocType = 'ledger';
  applyCompanyToDocs();
  renderLedger();
  if (fmt === 'excel') { exportExcel(); return; }
  // PDF/PNG ต้อง render doc ให้มองเห็นก่อน html2canvas → เปิดพรีวิวใบสรุป
  showPreview('docLedger', '📄 สรุป Petty Cash');
  await new Promise(r => setTimeout(r, 150));   // รอ layout + โลโก้พร้อม
  if (fmt === 'pdf') await exportPdf();
  else await exportPng();
}

// fetch รูป (โลโก้) → data URL สำหรับฝังลง xlsx
async function fetchAsDataURL(url) {
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error('โหลดโลโก้ไม่สำเร็จ');
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

// ── Export Excel (.xlsx) — ใบสรุป Petty Cash ตามฟอร์ม + ฝังโลโก้ (ExcelJS) ──
async function exportExcel() {
  if (typeof ExcelJS === 'undefined') { showToast('ไลบรารี Excel (ExcelJS) ยังโหลดไม่เสร็จ ลองใหม่อีกครั้ง', 'error'); return; }
  showLoading(true);
  try {
    const rows  = collectRows();
    const cName = (state.company && state.company.company_name) || getCompany().name;
    const MONEY = '#,##0.00';
    const sumIn  = rows.reduce((a, r) => a + r.cashIn, 0);
    const sumOut = rows.reduce((a, r) => a + r.amountOut, 0);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Petty Cash');
    ws.columns = [{ width: 13 }, { width: 46 }, { width: 16 }, { width: 16 }];

    const thin = { style: 'thin', color: { argb: 'FF999999' } };
    const allBorder = { top: thin, bottom: thin, left: thin, right: thin };

    // ── โลโก้ (ฝังจริงในไฟล์ Excel) มุมซ้ายบน ──
    try {
      const dataUrl = await fetchAsDataURL(companyLogoUrl());
      const mime = dataUrl.substring(dataUrl.indexOf('/') + 1, dataUrl.indexOf(';'));
      const ext = (mime === 'jpeg' || mime === 'jpg') ? 'jpeg' : (mime === 'gif' ? 'gif' : 'png');
      const imgId = wb.addImage({ base64: dataUrl, extension: ext });
      ws.addImage(imgId, { tl: { col: 0.1, row: 0.15 }, ext: { width: 136, height: 74 } });
    } catch (e) { console.warn('[exportExcel] ฝังโลโก้ไม่สำเร็จ:', e); }

    // ── หัว: ชื่อบริษัท (row1) + Petty Cash (row2) ──
    ws.mergeCells('A1:D1'); ws.mergeCells('A2:D2');
    ws.getRow(1).height = 30; ws.getRow(2).height = 24;
    Object.assign(ws.getCell('A1'), { value: cName });
    ws.getCell('A1').font = { bold: true, size: 16 };
    ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getCell('A2').value = 'Petty Cash';
    ws.getCell('A2').font = { bold: true, size: 13 };
    ws.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' };

    // ── header row 4 ──
    const HR = 4;
    ['Date', 'Detail', 'Petty Cash', 'Amount'].forEach((h, i) => {
      const cell = ws.getCell(HR, i + 1);
      cell.value = h;
      cell.font = { bold: true };
      cell.alignment = { horizontal: i >= 2 ? 'right' : 'left' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F3F5' } };
      cell.border = allBorder;
    });

    // ── data rows ──
    let r = HR + 1;
    rows.forEach(row => {
      const cD = ws.getCell(r, 1); cD.value = row.date || ''; cD.alignment = { horizontal: 'left' }; cD.border = allBorder;
      const cDet = ws.getCell(r, 2); cDet.value = row.detail || ''; cDet.alignment = { horizontal: 'left' }; cDet.border = allBorder;
      const cIn = ws.getCell(r, 3); if (row.cashIn) cIn.value = row.cashIn; cIn.numFmt = MONEY; cIn.alignment = { horizontal: 'right' }; cIn.border = allBorder;
      const cOut = ws.getCell(r, 4); if (row.amountOut) cOut.value = row.amountOut; cOut.numFmt = MONEY; cOut.alignment = { horizontal: 'right' }; cOut.border = allBorder;
      r++;
    });

    // ── total เงินนำเข้า ──
    const tot = ws.getCell(r, 3);
    tot.value = sumIn; tot.numFmt = MONEY; tot.font = { bold: true };
    tot.alignment = { horizontal: 'right' }; tot.border = { top: thin, bottom: thin };
    r++;

    // ── Reimbursement (label center B:C, amount D) ──
    ws.mergeCells(r, 2, r, 3);
    const reL = ws.getCell(r, 2); reL.value = 'Reimbursement Petty Cash'; reL.font = { bold: true }; reL.alignment = { horizontal: 'center' };
    const reV = ws.getCell(r, 4); reV.value = sumOut; reV.numFmt = MONEY; reV.font = { bold: true }; reV.alignment = { horizontal: 'right' }; reV.border = { bottom: thin };
    r++;

    // ── Balance (double underline) ──
    ws.mergeCells(r, 2, r, 3);
    const baL = ws.getCell(r, 2); baL.value = 'Balance'; baL.font = { bold: true }; baL.alignment = { horizontal: 'center' };
    const baV = ws.getCell(r, 4); baV.value = sumIn - sumOut; baV.numFmt = MONEY; baV.font = { bold: true }; baV.alignment = { horizontal: 'right' }; baV.border = { bottom: { style: 'double', color: { argb: 'FF333333' } } };
    r += 3;  // เว้น 2 บรรทัด

    // ── Prepare by / Approve by ──
    const sign = (rowIdx, label) => {
      ws.getCell(rowIdx, 1).value = label; ws.getCell(rowIdx, 1).font = { bold: true };
      ws.getCell(rowIdx, 2).border = { bottom: thin };
      ws.getCell(rowIdx, 3).value = 'Date';
      ws.getCell(rowIdx, 4).border = { bottom: thin };
    };
    sign(r, 'Prepare by :');
    sign(r + 2, 'Approve by :');

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = docFileName() + '.xlsx';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
    showToast('📊 Export Excel สำเร็จ', 'success');
  } catch (e) { showToast('Export Excel ไม่สำเร็จ: ' + e.message, 'error'); }
  showLoading(false);
}

// ── Export PDF / PNG — ภาพของ doc ที่กำลังแสดง (เหมือนฟอร์มเป๊ะ) ──
async function captureActiveDoc() {
  const el = document.querySelector('.pc-doc.active');
  if (!el) throw new Error('ไม่พบเอกสารที่แสดงอยู่');
  if (typeof html2canvas === 'undefined') throw new Error('ไลบรารี html2canvas ยังโหลดไม่เสร็จ');
  return html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
}

async function exportPdf() {
  if (!window.jspdf) { showToast('ไลบรารี PDF ยังโหลดไม่เสร็จ', 'error'); return; }
  showLoading(true);
  try {
    const canvas = await captureActiveDoc();
    const img = canvas.toDataURL('image/jpeg', 0.95);
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pw = 210, ph = 297;
    const h = canvas.height * pw / canvas.width;
    if (h <= ph) {
      pdf.addImage(img, 'JPEG', 0, 0, pw, h);
    } else {
      let pos = 0, remaining = h;
      while (remaining > 0) {
        pdf.addImage(img, 'JPEG', 0, pos, pw, h);
        remaining -= ph; pos -= ph;
        if (remaining > 0) pdf.addPage();
      }
    }
    pdf.save(docFileName() + '.pdf');
    showToast('📄 Export PDF สำเร็จ', 'success');
  } catch (e) { showToast('Export PDF ไม่สำเร็จ: ' + e.message, 'error'); }
  showLoading(false);
}

async function exportPng() {
  showLoading(true);
  try {
    const canvas = await captureActiveDoc();
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = docFileName() + '.png';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 5000);   // อย่า remove ทันที (Chromium cancel)
    showToast('🖼 Export PNG สำเร็จ', 'success');
  } catch (e) { showToast('Export PNG ไม่สำเร็จ: ' + e.message, 'error'); }
  showLoading(false);
}

// ============================================================
// MISC
// ============================================================
async function cancelEdit() {
  if (!formDirty) { window.location.href = './petty-cash-list.html'; return; }
  const ok = (typeof ConfirmModal !== 'undefined' && ConfirmModal.open)
    ? await ConfirmModal.open({ title: 'ยกเลิกการแก้ไข', message: 'ทิ้งการเปลี่ยนแปลงทั้งหมดและกลับไปหน้ารายการ?', icon: '✕', okText: 'ยืนยัน', cancelText: 'อยู่ต่อ', tone: 'warning' })
    : window.confirm('ทิ้งการเปลี่ยนแปลงทั้งหมด?');
  if (ok) window.location.href = './petty-cash-list.html';
}

function resetForm() {
  document.getElementById('itemsBody').innerHTML = '';
  rowCount = 0;
  addItemRow();
  calcSummary();
  refreshNumber().catch(console.error);
}

// ============================================================
// UTILS
// ============================================================
function fmtMoney(n) {
  return (parseFloat(n) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(iso) { return iso ? (window.DateFmt?.formatDMY?.(iso) || iso) : ''; }
function fmtRange(from, to) {
  const f = fmtDate(from), t = fmtDate(to);
  if (f && t) return f === t ? f : `${f} – ${t}`;
  return f || t || '—';
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove('show'), 3000);
}
function showLoading(show) { document.getElementById('loadingOverlay').classList.toggle('show', show); }

// ============================================================
// INIT
// ============================================================
document.addEventListener('input', (e) => { if (e.target.closest('.section-card')) formDirty = true; });
document.addEventListener('change', (e) => { if (e.target.closest('.section-card')) formDirty = true; });
window.addEventListener('beforeunload', (e) => {
  if (document.documentElement.classList.contains('headless')) return;
  if (!formDirty) return;
  e.preventDefault();
  e.returnValue = '';
});

window.addEventListener('DOMContentLoaded', async () => {
  SUPABASE_URL = localStorage.getItem('sb_url') || '';
  SUPABASE_KEY = localStorage.getItem('sb_key') || '';
  document.getElementById('pcPrefix').textContent = getPcPrefix();

  initRTE();                          // wire RTE ของตัวจัดการหัวกระดาษ (ครั้งเดียว)
  window.CompanyLogo?.onReady?.(() => applyCompanyToDocs());
  applyCompanyToDocs();

  const params = new URLSearchParams(window.location.search);
  const bid = parseInt(params.get('book_id'), 10);
  editingBookId = Number.isFinite(bid) ? bid : null;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    showToast('กรุณาเชื่อมต่อ Supabase ก่อน', 'warning');
    if (!editingBookId) addItemRow();
    return;
  }

  await loadLetterheads();           // โหลดหัวกระดาษ + บริษัท → เติม dropdown
  if (editingBookId) {
    await loadBookForEdit(editingBookId);
  } else {
    await refreshNumber();
    addItemRow();
  }
  formDirty = false;
});
