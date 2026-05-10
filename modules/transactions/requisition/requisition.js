// ============================================================
// STATE
// ============================================================
let SUPABASE_URL      = localStorage.getItem('sb_url') || '';
let SUPABASE_KEY      = localStorage.getItem('sb_key') || '';
let products          = [];
let productUnits      = {};
let rowCount          = 0;
let selectedPurposeId = null;

function getReqPrefix(d = new Date()) {
  const y  = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `REQ-${y}-${mm}-`;
}

const COMPANY_PROFILE = Object.freeze({
  nameTh:  'บริษัทเอโฟร์เอส แคน คอร์ปอเรชั่น จำกัด',
  nameEn:  'A4S CAN CORPORATION CO., LTD.',
  address: '88/88 ถนนตัวอย่าง แขวงตัวอย่าง เขตตัวอย่าง กรุงเทพมหานคร 10200',
  taxId:   '0105559999999',
  phone:   '02-123-4567',
  email:   'info@a4scan.example',
  logoUrl: '../../../assets/logo/logo-a4s.png',
});

// ============================================================
// PURPOSE DEFINITIONS  (static fallback — overridden by DB)
// ============================================================
const DEFAULT_PURPOSES = [
  { purpose_id:1, purpose_code:'MKT',    purpose_name:'การตลาด',           purpose_type:'MARKETING', icon:'📣' },
  { purpose_id:2, purpose_code:'PROMO',  purpose_name:'โปรโมชั่น',         purpose_type:'PROMOTION', icon:'🎁' },
  { purpose_id:3, purpose_code:'SAMPLE', purpose_name:'Sample ลูกค้า',     purpose_type:'SAMPLE',    icon:'🧪' },
  { purpose_id:4, purpose_code:'INT',    purpose_name:'ใช้ภายในสำนักงาน',  purpose_type:'INTERNAL',  icon:'🏢' },
  { purpose_id:5, purpose_code:'DMG',    purpose_name:'ชำรุด / สูญหาย',   purpose_type:'DAMAGE',    icon:'⚠️' },
];

const PURPOSE_ICONS = {
  MARKETING:'📣', PROMOTION:'🎁', SAMPLE:'🧪',
  INTERNAL:'🏢',  DAMAGE:'⚠️',   OTHER:'📌',
};

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
      'Prefer':        method === 'POST' ? 'return=representation' : '',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.message || 'Error'); }
  return method === 'GET' ? res.json() : res.json().catch(() => null);
}

// ============================================================
// AUTO-FILL DEPT FROM USER
// users.department (dept_code) → match กับ option ใน dropdown
// (option มี data-dept-code attribute ที่ตั้งจากตอน loadDropdowns)
// ============================================================
async function autoFillUserDept() {
  const sel = document.getElementById('deptId');
  if (!sel) { console.warn('[autoFillDept] no #deptId element'); return; }
  if (sel.value) { console.log('[autoFillDept] already has value, skip'); return; }
  const userId = window.ERP_USER?.user_id;
  if (!userId) { console.warn('[autoFillDept] no ERP_USER.user_id'); return; }

  console.log('[autoFillDept] fetching department for user', userId, '...');
  try {
    const rows = await supabaseFetch('users', {
      query: `?user_id=eq.${encodeURIComponent(userId)}&select=department`
    });
    console.log('[autoFillDept] users response:', rows);

    const deptCode = (rows?.[0]?.department || '').trim();
    if (!deptCode) {
      console.warn('[autoFillDept] users.department is empty for user', userId,
        '— ตรวจว่า column "department" มีและ user คนนี้ตั้งค่าไว้แล้วหรือยัง');
      return;
    }

    const codeUp = deptCode.toUpperCase();
    const opts = Array.from(sel.options);
    console.log('[autoFillDept] dept dropdown options:',
      opts.slice(1).map(o => ({ id: o.value, code: o.dataset.deptCode, name: o.text })));

    // case-insensitive match by code, fallback by name
    let match = opts.find(o => (o.dataset.deptCode || '').toUpperCase() === codeUp);
    if (!match) match = opts.find(o => o.text.toUpperCase() === codeUp);

    if (match) {
      sel.value = match.value;
      console.log('[autoFillDept] ✅ matched dept_code', deptCode, '→ dept_id', match.value);
    } else {
      console.warn('[autoFillDept] ❌ no dropdown option matches dept_code', deptCode);
    }
  } catch (e) {
    console.warn('[autoFillDept] fetch failed:', e);
  }
}

// ============================================================
// LOAD DROPDOWNS
// ============================================================
async function loadDropdowns() {
  const [depts, warehouses, users, prods, units, purposes] = await Promise.all([
    supabaseFetch('departments',          { query: '?select=dept_id,dept_code,dept_name&order=sort_order,dept_code' }),
    supabaseFetch('warehouses',           { query: '?select=warehouse_id,warehouse_name&is_active=eq.true' }),
    supabaseFetch('users',                { query: '?select=user_id,full_name&is_active=eq.true&order=full_name.asc' }),
    supabaseFetch('products',             { query: '?select=product_id,product_code,product_name&is_active=eq.true&order=product_name' }),
    supabaseFetch('product_units',        { query: '?select=unit_id,product_id,unit_name' }),
    supabaseFetch('requisition_purposes', { query: '?select=purpose_id,purpose_code,purpose_name,purpose_type&is_active=eq.true' }),
  ]);

  // Departments — ใส่ data-dept-code เพื่อให้ autoFillUserDept match ได้
  console.log('[loadDropdowns] departments:', depts);
  const selDept = document.getElementById('deptId');
  selDept.innerHTML = '<option value="">— เลือกแผนก —</option>';
  depts?.forEach(d => selDept.insertAdjacentHTML('beforeend',
    `<option value="${d.dept_id}" data-dept-code="${d.dept_code || ''}">${d.dept_name}</option>`));
  await autoFillUserDept();

  // Warehouses
  const selWH = document.getElementById('warehouseId');
  selWH.innerHTML = '<option value="">— เลือกคลัง —</option>';
  warehouses?.forEach(w => selWH.insertAdjacentHTML('beforeend',
    `<option value="${w.warehouse_id}">${w.warehouse_name}</option>`));

  // Users → requestedBy + approvedBy
  ['requestedBy', 'approvedBy'].forEach(id => {
    const sel = document.getElementById(id);
    sel.innerHTML = `<option value="">— ${id === 'requestedBy' ? 'เลือกผู้ขอเบิก' : 'เลือกผู้อนุมัติ'} —</option>`;
    users?.forEach(u => sel.insertAdjacentHTML('beforeend',
      `<option value="${u.user_id}">${u.full_name || ''}</option>`));
  });

  // Products & Units
  products     = prods || [];
  productUnits = {};
  units?.forEach(u => {
    if (!productUnits[u.product_id]) productUnits[u.product_id] = [];
    productUnits[u.product_id].push(u);
  });

  // Purpose cards — DB first, fallback to defaults
  const purposeData = purposes?.length
    ? purposes.map(p => ({ ...p, icon: PURPOSE_ICONS[p.purpose_type] || '📌' }))
    : DEFAULT_PURPOSES;
  renderPurposeCards(purposeData);

  // Update any existing item rows
  document.querySelectorAll('.row-product-select').forEach(sel => {
    const cur = sel.value;
    populateProductSelect(sel);
    sel.value = cur;
  });

  // Update REQ prefix with current year/month
  const prefix = getReqPrefix();
  document.getElementById('reqPrefix').textContent       = prefix;
  document.getElementById('reqNumberDisplay').textContent = prefix + document.getElementById('reqNumber').value;

  showToast('✅ โหลดข้อมูลสำเร็จ', 'success');
}

// ============================================================
// PURPOSE CARDS
// ============================================================
function renderPurposeCards(purposes) {
  const grid = document.getElementById('purposeGrid');
  grid.innerHTML = '';
  purposes.forEach(p => {
    const card = document.createElement('div');
    card.className   = 'purpose-card';
    card.dataset.id  = p.purpose_id;
    card.innerHTML   = `
      <span class="purpose-icon">${p.icon}</span>
      <span class="purpose-label">${p.purpose_name}</span>
      <span class="purpose-type">${p.purpose_type}</span>`;
    card.onclick = () => selectPurpose(p.purpose_id, card);
    grid.appendChild(card);
  });
}

function selectPurpose(id, card) {
  selectedPurposeId = id;
  document.querySelectorAll('.purpose-card').forEach(c => c.classList.remove('active'));
  card.classList.add('active');
}

// ============================================================
// ITEMS TABLE
// ============================================================
function addItemRow() {
  rowCount++;
  const tbody = document.getElementById('itemsBody');
  const tr    = document.createElement('tr');
  tr.id = `row-${rowCount}`;
  tr.innerHTML = `
    <td><div class="item-num">${rowCount}</div></td>
    <td>
      <select class="td-input row-product-select" onchange="onProductChange(this,${rowCount})" style="min-width:180px">
        <option value="">— เลือกสินค้า —</option>
      </select>
    </td>
    <td>
      <select class="td-input row-unit-select" id="unit-${rowCount}">
        <option value="">—</option>
      </select>
    </td>
    <td>
      <input type="number" class="td-input text-right" id="qty-req-${rowCount}"
        placeholder="0" min="0" step="0.01" oninput="calcSummary()">
    </td>
    <td>
      <input type="number" class="td-input text-right" id="qty-app-${rowCount}"
        placeholder="—" min="0" step="0.01" style="color:var(--text3)">
    </td>
    <td>
      <input type="number" class="td-input text-right" id="qty-actual-${rowCount}"
        placeholder="—" min="0" step="0.01" style="color:var(--text3)">
    </td>
    <td>
      <input type="text" class="td-input" id="note-${rowCount}" placeholder="หมายเหตุ...">
    </td>
    <td><button class="btn-remove" onclick="removeRow(${rowCount})">✕</button></td>`;
  tbody.appendChild(tr);

  const sel = tr.querySelector('.row-product-select');
  if (products.length > 0) populateProductSelect(sel);
  calcSummary();
  sel.focus();
}

function populateProductSelect(sel) {
  const cur = sel.value;
  sel.innerHTML = '<option value="">— เลือกสินค้า —</option>';
  products.forEach(p => sel.insertAdjacentHTML('beforeend',
    `<option value="${p.product_id}">${p.product_code} — ${p.product_name}</option>`));
  sel.value = cur;
}

function onProductChange(sel, rowId) {
  const productId = parseInt(sel.value);
  const unitSel   = document.getElementById(`unit-${rowId}`);
  unitSel.innerHTML = '<option value="">—</option>';
  const pUnits = productUnits[productId] || [];
  pUnits.forEach(u => unitSel.insertAdjacentHTML('beforeend',
    `<option value="${u.unit_id}">${u.unit_name}</option>`));
  if (pUnits.length > 0) unitSel.value = pUnits[0].unit_id;
}

function removeRow(rowId) {
  document.getElementById(`row-${rowId}`)?.remove();
  calcSummary();
}

function calcSummary() {
  const rows = document.getElementById('itemsBody').querySelectorAll('tr');
  let totalQty = 0;
  rows.forEach(tr => {
    const rowId = tr.id.replace('row-', '');
    totalQty += parseFloat(document.getElementById(`qty-req-${rowId}`)?.value || 0);
  });
  document.getElementById('totalItemsDisplay').textContent = `${rows.length} รายการ`;
  document.getElementById('totalQtyDisplay').textContent   = `${totalQty.toLocaleString()} ชิ้น`;
  document.getElementById('itemCount').textContent         = `${rows.length} รายการ`;
}

// ============================================================
// COLLECT & SUBMIT
// ============================================================
function collectFormData(validate = true) {
  const reqNumber = getReqPrefix() + document.getElementById('reqNumber').value.trim();
  const reqDate     = document.getElementById('reqDate').value;
  const deptId      = document.getElementById('deptId').value;
  const warehouseId = document.getElementById('warehouseId').value;
  const requestedBy = document.getElementById('requestedBy').value;
  const approvedBy  = document.getElementById('approvedBy').value;
  const note        = document.getElementById('note').value;

  if (validate) {
    if (!selectedPurposeId) { showToast('กรุณาเลือกวัตถุประสงค์การเบิก', 'error'); return null; }
    if (!deptId)             { showToast('กรุณาเลือกแผนก', 'error');                return null; }
    if (!warehouseId)        { showToast('กรุณาเลือกคลัง', 'error');                return null; }
    if (!reqDate)            { showToast('กรุณาระบุวันที่เบิก', 'error');           return null; }
    if (!requestedBy)        { showToast('กรุณาเลือกผู้ขอเบิก', 'error');           return null; }
  }

  const items = [];
  document.getElementById('itemsBody').querySelectorAll('tr').forEach(tr => {
    const rowId     = tr.id.replace('row-', '');
    const productId = tr.querySelector('.row-product-select')?.value;
    const unitId    = document.getElementById(`unit-${rowId}`)?.value;
    const qty       = document.getElementById(`qty-req-${rowId}`)?.value;
    const itemNote  = document.getElementById(`note-${rowId}`)?.value;
    if (productId && qty) items.push({ productId, unitId, qty, note: itemNote });
  });

  if (validate && items.length === 0) {
    showToast('กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ', 'error');
    return null;
  }

  return { reqNumber, reqDate, deptId, warehouseId,
    purposeId: selectedPurposeId, requestedBy, approvedBy, note, items };
}

async function submitREQ() {
  const data = collectFormData();
  if (!data) return;
  if (!SUPABASE_URL || !SUPABASE_KEY) { showToast('กรุณาเชื่อมต่อ Supabase ก่อน', 'warning'); return; }

  showLoading(true);
  try {
    const result = await supabaseFetch('requisitions', {
      method: 'POST',
      body: {
        req_number:    data.reqNumber,
        req_date:      data.reqDate,
        warehouse_id:  parseInt(data.warehouseId),
        dept_id:       parseInt(data.deptId),
        purpose_id:    parseInt(data.purposeId),
        requested_by:  parseInt(data.requestedBy),
        approved_by:   data.approvedBy ? parseInt(data.approvedBy) : null,
        status:        'PENDING',
        note:          data.note || null,
      }
    });
    const reqId = result[0].req_id;
    for (const item of data.items) {
      await supabaseFetch('requisition_items', {
        method: 'POST',
        body: {
          req_id:        reqId,
          product_id:    parseInt(item.productId),
          unit_id:       item.unitId ? parseInt(item.unitId) : null,
          qty_requested: parseFloat(item.qty),
          note:          item.note || null,
        }
      });
    }
    showToast(`✅ ส่งอนุมัติ ${data.reqNumber} สำเร็จ!`, 'success');
    setTimeout(() => resetForm(), 1500);
  } catch(e) { showToast('เกิดข้อผิดพลาด: ' + e.message, 'error'); }
  showLoading(false);
}

function saveDraft() { showToast('💾 บันทึก Draft แล้ว', 'success'); }

// ============================================================
// FORMAL PREVIEW / PRINT
// ============================================================
function selectText(selectEl) {
  if (!selectEl) return '—';
  return selectEl.options[selectEl.selectedIndex]?.text?.trim() || '—';
}

function previewREQ() {
  const data = collectFormData(false);
  if (!data) return;

  const purposeCard = document.querySelector('.purpose-card.active');
  const purposeName = purposeCard
    ? purposeCard.querySelector('.purpose-label').textContent.trim() : '—';
  const purposeType = purposeCard
    ? purposeCard.querySelector('.purpose-type')?.textContent.trim() : '';

  const deptName       = selectText(document.getElementById('deptId'));
  const warehouseName  = selectText(document.getElementById('warehouseId'));
  const requesterName  = selectText(document.getElementById('requestedBy'));
  const approverName   = data.approvedBy ? selectText(document.getElementById('approvedBy')) : '—';

  const fmtDate = (iso) => (window.DateFmt?.formatDMY?.(iso)) || iso || '—';

  // Header
  document.getElementById('docCompanyTh').textContent   = COMPANY_PROFILE.nameTh;
  document.getElementById('docCompanyEn').textContent   = COMPANY_PROFILE.nameEn;
  document.getElementById('docCompanyAddr').textContent = COMPANY_PROFILE.address;
  document.getElementById('docCompanyMeta').textContent =
    `เลขผู้เสียภาษี ${COMPANY_PROFILE.taxId} · โทร ${COMPANY_PROFILE.phone} · ${COMPANY_PROFILE.email}`;
  const logoEl = document.getElementById('docLogo');
  logoEl.style.backgroundImage = `url("${COMPANY_PROFILE.logoUrl}")`;

  document.getElementById('docNumber').textContent  = data.reqNumber;
  document.getElementById('docDate').textContent    = fmtDate(data.reqDate);
  document.getElementById('docStatus').textContent  = 'DRAFT';

  // Info grid (metadata only — ผู้ขอเบิก/ผู้อนุมัติ อยู่ในช่องลายเซ็นด้านล่างแทน)
  document.getElementById('docPurpose').textContent   = purposeType ? `${purposeName} (${purposeType})` : purposeName;
  document.getElementById('docDept').textContent      = deptName;
  document.getElementById('docWarehouse').textContent = warehouseName;
  document.getElementById('docDate2').textContent     = fmtDate(data.reqDate);

  // Items
  const tbody = document.getElementById('docItemsBody');
  tbody.innerHTML = '';
  let totalQty = 0;
  if (data.items.length === 0) {
    tbody.innerHTML = '<tr class="req-doc-empty-row"><td colspan="7">— ไม่มีรายการ —</td></tr>';
  } else {
    data.items.forEach((item, idx) => {
      const product = products.find(p => String(p.product_id) === String(item.productId));
      const productLabel = product
        ? `${product.product_code} — ${product.product_name}` : '—';
      const unitName = (productUnits[item.productId] || [])
        .find(u => String(u.unit_id) === String(item.unitId))?.unit_name || '—';
      const rowId       = document.querySelectorAll('#itemsBody tr')[idx]?.id?.replace('row-','');
      const qtyApproved = rowId ? document.getElementById(`qty-app-${rowId}`)?.value : '';
      const qtyActual   = rowId ? document.getElementById(`qty-actual-${rowId}`)?.value : '';
      const qty = parseFloat(item.qty) || 0;
      totalQty += qty;
      tbody.insertAdjacentHTML('beforeend', `
        <tr>
          <td class="text-center">${idx + 1}</td>
          <td>${escapeHtml(productLabel)}</td>
          <td class="text-center">${escapeHtml(unitName)}</td>
          <td class="text-right">${qty.toLocaleString('th-TH')}</td>
          <td class="text-right">${qtyApproved ? parseFloat(qtyApproved).toLocaleString('th-TH') : '—'}</td>
          <td class="text-right">${qtyActual ? parseFloat(qtyActual).toLocaleString('th-TH') : '—'}</td>
          <td>${escapeHtml(item.note || '')}</td>
        </tr>`);
    });
  }
  document.getElementById('docTotalQty').textContent   = totalQty.toLocaleString('th-TH');
  document.getElementById('docTotalItems').textContent = `${data.items.length} รายการ`;

  // Note + signatures
  document.getElementById('docNote').textContent       = data.note?.trim() || '—';
  document.getElementById('sigRequester').textContent  = requesterName;
  document.getElementById('sigApprover').textContent   = approverName;
  document.getElementById('docPrintedAt').textContent  =
    window.DateFmt?.formatDMYTime?.(new Date().toISOString()) || new Date().toLocaleString('th-TH');

  document.getElementById('previewOverlay').classList.add('open');
}

function closePreview() {
  document.getElementById('previewOverlay').classList.remove('open');
}

function printREQ() {
  window.print();
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
  ));
}

function resetForm() {
  const prefix = getReqPrefix();
  document.getElementById('reqPrefix').textContent        = prefix;
  document.getElementById('reqNumber').value              = '001';
  document.getElementById('reqNumberDisplay').textContent = prefix + '001';
  document.getElementById('reqDate').value                = new Date().toISOString().split('T')[0];
  document.getElementById('deptId').value                 = '';
  document.getElementById('warehouseId').value            = '';
  autoFillUserDept().catch(console.error);
  document.getElementById('requestedBy').value            = '';
  document.getElementById('approvedBy').value             = '';
  document.getElementById('note').value                   = '';
  document.getElementById('itemsBody').innerHTML          = '';
  document.querySelectorAll('.purpose-card').forEach(c => c.classList.remove('active'));
  selectedPurposeId = null;
  rowCount          = 0;
  calcSummary();
  addItemRow();
}

// ============================================================
// UTILS
// ============================================================
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
window.addEventListener('DOMContentLoaded', () => {
  SUPABASE_URL = localStorage.getItem('sb_url') || '';
  SUPABASE_KEY = localStorage.getItem('sb_key') || '';
  const prefix = getReqPrefix();
  document.getElementById('reqPrefix').textContent        = prefix;
  document.getElementById('reqNumberDisplay').textContent = prefix + '001';
  document.getElementById('reqDate').value = new Date().toISOString().split('T')[0];
  renderPurposeCards(DEFAULT_PURPOSES);
  addItemRow();
  if (SUPABASE_URL && SUPABASE_KEY) {
    loadDropdowns().catch(console.error);
  } else {
    console.warn('[REQ] Supabase not configured — sb_url/sb_key missing in localStorage. Dropdowns will be empty.');
  }
});