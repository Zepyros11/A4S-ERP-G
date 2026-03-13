// ============================================================
// STATE
// ============================================================
let SUPABASE_URL      = localStorage.getItem('sb_url') || '';
let SUPABASE_KEY      = localStorage.getItem('sb_key') || '';
let products          = [];
let productUnits      = {};
let rowCount          = 0;
let selectedPurposeId = null;

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
// LOAD DROPDOWNS
// ============================================================
async function loadDropdowns() {
  const [depts, warehouses, users, prods, units, purposes] = await Promise.all([
    supabaseFetch('departments',          { query: '?select=dept_id,dept_name&is_active=eq.true&order=dept_name' }),
    supabaseFetch('warehouses',           { query: '?select=warehouse_id,warehouse_name&is_active=eq.true' }),
    supabaseFetch('users',                { query: '?select=user_id,first_name,last_name&is_active=eq.true' }),
    supabaseFetch('products',             { query: '?select=product_id,product_code,product_name&is_active=eq.true&order=product_name' }),
    supabaseFetch('product_units',        { query: '?select=unit_id,product_id,unit_name' }),
    supabaseFetch('requisition_purposes', { query: '?select=purpose_id,purpose_code,purpose_name,purpose_type&is_active=eq.true' }),
  ]);

  // Departments
  const selDept = document.getElementById('deptId');
  selDept.innerHTML = '<option value="">— เลือกแผนก —</option>';
  depts?.forEach(d => selDept.insertAdjacentHTML('beforeend',
    `<option value="${d.dept_id}">${d.dept_name}</option>`));

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
      `<option value="${u.user_id}">${u.first_name} ${u.last_name}</option>`));
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

  // Update REQ prefix with current year
  const year   = new Date().getFullYear();
  const prefix = `REQ-${year}-`;
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
  const year      = new Date().getFullYear();
  const reqNumber = `REQ-${year}-` + document.getElementById('reqNumber').value.trim();
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

function previewREQ() {
  const data = collectFormData(false);
  if (!data) return;
  const purposeCard = document.querySelector('.purpose-card.active');
  const purposeName = purposeCard
    ? purposeCard.querySelector('.purpose-label').textContent : '—';
  const dept = document.getElementById('deptId');
  const deptName = dept.options[dept.selectedIndex]?.text || '—';
  alert(`📋 Preview ใบเบิก\n\nเลขที่: ${data.reqNumber}\nวันที่: ${data.reqDate}\nแผนก: ${deptName}\nวัตถุประสงค์: ${purposeName}\nรายการ: ${data.items.length} รายการ`);
}

function resetForm() {
  const year   = new Date().getFullYear();
  const prefix = `REQ-${year}-`;
  document.getElementById('reqPrefix').textContent        = prefix;
  document.getElementById('reqNumber').value              = '001';
  document.getElementById('reqNumberDisplay').textContent = prefix + '001';
  document.getElementById('reqDate').value                = new Date().toISOString().split('T')[0];
  document.getElementById('deptId').value                 = '';
  document.getElementById('warehouseId').value            = '';
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
  const year   = new Date().getFullYear();
  document.getElementById('reqPrefix').textContent        = `REQ-${year}-`;
  document.getElementById('reqNumberDisplay').textContent = `REQ-${year}-001`;
  document.getElementById('reqDate').value = new Date().toISOString().split('T')[0];
  renderPurposeCards(DEFAULT_PURPOSES);
  addItemRow();
  if (SUPABASE_URL && SUPABASE_KEY) loadDropdowns().catch(console.error);
});