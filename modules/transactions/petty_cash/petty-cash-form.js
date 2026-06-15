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

function getPcPrefix(d = new Date()) {
  const y  = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `PC-${y}-${mm}-`;
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
    <td><input type="date" class="td-input" id="date-${n}"></td>
    <td><input type="text" class="td-input" id="detail-${n}" placeholder="รายละเอียด..."></td>
    <td><input type="text" class="td-input" id="payee-${n}" placeholder="ผู้รับเงิน"></td>
    <td class="text-right"><input type="number" class="td-input text-right" id="in-${n}" placeholder="0.00" min="0" step="0.01" oninput="calcSummary()"></td>
    <td class="text-right"><input type="number" class="td-input text-right" id="out-${n}" placeholder="0.00" min="0" step="0.01" oninput="calcSummary()"></td>
    <td><button class="btn-remove" onclick="removeRow(${n})" title="ลบบรรทัด">✕</button></td>`;
  tbody.appendChild(tr);

  if (data) {
    if (data.line_date) document.getElementById(`date-${n}`).value = data.line_date;
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
    const date    = document.getElementById(`date-${n}`)?.value || '';
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

    document.getElementById('title').value      = book.title || '';
    document.getElementById('dateFrom').value   = book.date_from || '';
    document.getElementById('dateTo').value     = book.date_to || '';
    document.getElementById('preparedBy').value = book.prepared_by || '';
    document.getElementById('approvedBy').value = book.approved_by || '';
    document.getElementById('note').value       = book.note || '';

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
    title:       document.getElementById('title').value.trim() || null,
    date_from:   document.getElementById('dateFrom').value || null,
    date_to:     document.getElementById('dateTo').value || null,
    prepared_by: document.getElementById('preparedBy').value.trim() || null,
    approved_by: document.getElementById('approvedBy').value.trim() || null,
    note:        document.getElementById('note').value.trim() || null,
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
  document.getElementById('metaDocDate').value  = new Date().toISOString().split('T')[0];
  document.getElementById('metaPayee').value    = rows[0]?.payee || document.getElementById('preparedBy').value.trim() || '';
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
    docDate:  document.getElementById('metaDocDate').value,
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
  const c = getCompany();
  document.querySelectorAll('.pcdCompanyName').forEach(el => el.textContent = c.name);
  document.querySelectorAll('.pcdCompanyAddr').forEach(el => el.textContent = c.address);
  document.querySelectorAll('.pcdCompanyTel').forEach(el => el.textContent = c.phone ? ('Tel: ' + c.phone) : '');
  document.querySelectorAll('.pcdLogo').forEach(img => {
    img.src = c.logo;
    img.onerror = () => { img.style.display = 'none'; };
  });
  const cc = document.getElementById('certCompany');
  if (cc) cc.textContent = c.name;
}

// --- LEDGER ---
function renderLedger() {
  const rows = collectRows();
  const title = document.getElementById('title').value.trim();
  const from = document.getElementById('dateFrom').value;
  const to   = document.getElementById('dateTo').value;
  const range = fmtRange(from, to);
  document.getElementById('ldgSubtitle').textContent =
    [title, range && range !== '—' ? `(${range})` : ''].filter(Boolean).join(' ');

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

  document.getElementById('ldgPrep').textContent    = document.getElementById('preparedBy').value.trim() || '';
  document.getElementById('ldgApprove').textContent = document.getElementById('approvedBy').value.trim() || '';
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

  // ช่วงวันที่ — ใช้ของ book ถ้ามี ไม่งั้น min/max ของบรรทัดที่เลือก
  const dates = rows.map(r => r.date).filter(Boolean).sort();
  const from = document.getElementById('dateFrom').value || dates[0] || '';
  const to   = document.getElementById('dateTo').value || dates[dates.length - 1] || '';
  document.getElementById('certFrom').textContent = from ? fmtDate(from) : ' ';
  document.getElementById('certTo').textContent   = to ? fmtDate(to) : ' ';
}

// --- VOUCHER ---
function renderVoucher(meta, rows) {
  const total = rows.reduce((a, r) => a + r.amountOut, 0);
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
  document.getElementById('vchNote').innerHTML = escapeHtml(document.getElementById('note').value.trim()) || '&nbsp;';
}

// ============================================================
// PREVIEW
// ============================================================
function showPreview(docId, title) {
  document.querySelectorAll('.pc-doc').forEach(d => d.classList.remove('active'));
  document.getElementById(docId).classList.add('active');
  document.getElementById('previewTitle').textContent = title;
  document.getElementById('previewOverlay').classList.add('open');
}

function closePreview() {
  if (document.documentElement.classList.contains('headless')) { window.close(); return; }
  document.getElementById('previewOverlay').classList.remove('open');
}

function printDoc() { window.print(); }

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
  document.getElementById('title').value = '';
  document.getElementById('dateFrom').value = '';
  document.getElementById('dateTo').value = '';
  document.getElementById('preparedBy').value = '';
  document.getElementById('approvedBy').value = '';
  document.getElementById('note').value = '';
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

  // โหลดโลโก้บริษัทล่าสุดเข้าเอกสาร (cache → DB)
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

  if (editingBookId) {
    await loadBookForEdit(editingBookId);
  } else {
    await refreshNumber();
    addItemRow();
  }
  formDirty = false;
});
