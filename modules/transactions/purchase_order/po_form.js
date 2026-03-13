// ============================================================
// STATE
// ============================================================
let SUPABASE_URL = localStorage.getItem('sb_url') || '';
let SUPABASE_KEY = localStorage.getItem('sb_key') || '';
let products = [];
let productUnits = {};
let rowCount = 0;

// ============================================================
// SUPABASE
// ============================================================
async function supabaseFetch(table, options = {}) {
  const { method = 'GET', body, query = '' } = options;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : ''
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.message || 'Error'); }
  return method === 'GET' ? res.json() : res.json().catch(() => null);
}

// ============================================================
// LOAD DROPDOWNS
// ============================================================
async function loadDropdowns() {
  const [suppliers, warehouses, users, prods, units] = await Promise.all([
    supabaseFetch('suppliers',     { query: '?select=supplier_id,supplier_name&is_active=eq.true&order=supplier_name' }),
    supabaseFetch('warehouses',    { query: '?select=warehouse_id,warehouse_name&is_active=eq.true' }),
    supabaseFetch('users',         { query: '?select=user_id,first_name,last_name&is_active=eq.true' }),
    supabaseFetch('products',      { query: '?select=product_id,product_code,product_name,cost_price&is_active=eq.true&order=product_name' }),
    supabaseFetch('product_units', { query: '?select=unit_id,product_id,unit_name,conversion_qty' }),
  ]);

  const selSup = document.getElementById('supplierId');
  selSup.innerHTML = '<option value="">— เลือก Supplier —</option>';
  suppliers?.forEach(s => selSup.insertAdjacentHTML('beforeend', `<option value="${s.supplier_id}">${s.supplier_name}</option>`));

  const selWH = document.getElementById('warehouseId');
  selWH.innerHTML = '<option value="">— เลือกคลัง —</option>';
  warehouses?.forEach(w => selWH.insertAdjacentHTML('beforeend', `<option value="${w.warehouse_id}">${w.warehouse_name}</option>`));

  const selUser = document.getElementById('createdBy');
  selUser.innerHTML = '<option value="">— เลือกผู้ใช้ —</option>';
  users?.forEach(u => selUser.insertAdjacentHTML('beforeend', `<option value="${u.user_id}">${u.first_name} ${u.last_name}</option>`));

  products = prods || [];
  productUnits = {};
  units?.forEach(u => {
    if (!productUnits[u.product_id]) productUnits[u.product_id] = [];
    productUnits[u.product_id].push(u);
  });

  // update existing rows if any
  document.querySelectorAll('.row-product-select').forEach(sel => {
    const cur = sel.value;
    populateProductSelect(sel);
    sel.value = cur;
  });

  // set PO prefix with current year
  const year = new Date().getFullYear();
  const prefix = `PO-${year}-`;
  document.getElementById('poPrefix').textContent = prefix;
  document.getElementById('poNumberDisplay').textContent = prefix + document.getElementById('poNumber').value;

  showToast('✅ โหลดข้อมูลสำเร็จ', 'success');
}

// ============================================================
// ITEMS TABLE
// ============================================================
function addItemRow() {
  rowCount++;
  const tbody = document.getElementById('itemsBody');
  const tr = document.createElement('tr');
  tr.id = `row-${rowCount}`;
  tr.innerHTML = `
    <td><div class="item-num">${rowCount}</div></td>
    <td>
      <select class="td-input row-product-select" onchange="onProductChange(this,${rowCount})" style="min-width:180px">
        <option value="">— เลือกสินค้า —</option>
      </select>
    </td>
    <td>
      <select class="td-input row-unit-select" id="unit-${rowCount}" onchange="calcRow(${rowCount})">
        <option value="">—</option>
      </select>
    </td>
    <td>
      <input type="number" class="td-input text-right" id="qty-${rowCount}"
        placeholder="0" min="0" step="0.01" oninput="calcRow(${rowCount})">
    </td>
    <td>
      <input type="number" class="td-input text-right" id="price-${rowCount}"
        placeholder="0.00" min="0" step="0.01" oninput="calcRow(${rowCount})">
    </td>
    <td><div class="subtotal-cell" id="sub-${rowCount}">฿0.00</div></td>
    <td><button class="btn-remove" onclick="removeRow(${rowCount})">✕</button></td>`;
  tbody.appendChild(tr);
  const sel = tr.querySelector('.row-product-select');
  if (products.length > 0) populateProductSelect(sel);
  updateItemCount();
  sel.focus();
}

function populateProductSelect(sel) {
  const cur = sel.value;
  sel.innerHTML = '<option value="">— เลือกสินค้า —</option>';
  products.forEach(p => sel.insertAdjacentHTML('beforeend',
    `<option value="${p.product_id}" data-price="${p.cost_price}">${p.product_code} — ${p.product_name}</option>`));
  sel.value = cur;
}

function onProductChange(sel, rowId) {
  const opt      = sel.options[sel.selectedIndex];
  const productId = parseInt(sel.value);
  const price    = parseFloat(opt?.dataset?.price || 0);
  const priceInput = document.getElementById(`price-${rowId}`);
  if (price > 0) priceInput.value = price.toFixed(2);
  const unitSel = document.getElementById(`unit-${rowId}`);
  unitSel.innerHTML = '<option value="">—</option>';
  const pUnits = productUnits[productId] || [];
  pUnits.forEach(u => unitSel.insertAdjacentHTML('beforeend',
    `<option value="${u.unit_id}">${u.unit_name}</option>`));
  if (pUnits.length > 0) unitSel.value = pUnits[0].unit_id;
  calcRow(rowId);
}

function calcRow(rowId) {
  const qty   = parseFloat(document.getElementById(`qty-${rowId}`)?.value || 0);
  const price = parseFloat(document.getElementById(`price-${rowId}`)?.value || 0);
  document.getElementById(`sub-${rowId}`).textContent = formatCurrency(qty * price);
  calcTotal();
}

function removeRow(rowId) {
  document.getElementById(`row-${rowId}`)?.remove();
  updateItemCount();
  calcTotal();
}

function updateItemCount() {
  const count = document.getElementById('itemsBody').querySelectorAll('tr').length;
  document.getElementById('itemCount').textContent = `${count} รายการ`;
}

function calcTotal() {
  let sub = 0;
  document.querySelectorAll('.subtotal-cell').forEach(el => {
    sub += parseFloat(el.textContent.replace('฿', '').replace(/,/g, '')) || 0;
  });
  const vatOn = document.getElementById('vatToggle').checked;
  const vat   = vatOn ? sub * 0.07 : 0;
  const total = sub + vat;
  document.getElementById('vatRow').classList.toggle('vat-off', !vatOn);
  document.getElementById('subtotalDisplay').textContent = formatCurrency(sub);
  document.getElementById('vatDisplay').textContent      = vatOn ? formatCurrency(vat) : '—';
  document.getElementById('totalDisplay').textContent    = formatCurrency(total);
}

// ============================================================
// ACTIONS
// ============================================================
function collectFormData(validate = true) {
  const year     = new Date().getFullYear();
  const poNumber = `PO-${year}-` + document.getElementById('poNumber').value.trim();
  const supplierId  = document.getElementById('supplierId').value;
  const warehouseId = document.getElementById('warehouseId').value;
  const orderDate   = document.getElementById('orderDate').value;
  const expectedDate = document.getElementById('expectedDate').value;
  const createdBy   = document.getElementById('createdBy').value;
  const note        = document.getElementById('note').value;

  if (validate) {
    if (!supplierId)  { showToast('กรุณาเลือก Supplier', 'error');       return null; }
    if (!warehouseId) { showToast('กรุณาเลือกคลัง', 'error');            return null; }
    if (!orderDate)   { showToast('กรุณาระบุวันที่สั่งซื้อ', 'error');   return null; }
  }

  const items = [];
  document.getElementById('itemsBody').querySelectorAll('tr').forEach(tr => {
    const rowId    = tr.id.replace('row-', '');
    const productId = tr.querySelector('.row-product-select')?.value;
    const unitId   = tr.querySelector('.row-unit-select')?.value;
    const qty      = document.getElementById(`qty-${rowId}`)?.value;
    const price    = document.getElementById(`price-${rowId}`)?.value;
    if (productId && qty && price) items.push({ productId, unitId, qty, price });
  });

  if (validate && items.length === 0) {
    showToast('กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ', 'error');
    return null;
  }

  let sub = 0;
  items.forEach(i => sub += parseFloat(i.qty) * parseFloat(i.price));
  const vatOn = document.getElementById('vatToggle').checked;
  const total = vatOn ? sub * 1.07 : sub;

  return { poNumber, supplierId, warehouseId, orderDate, expectedDate, createdBy, note, items, total };
}

async function submitPO() {
  const poData = collectFormData();
  if (!poData) return;
  if (!SUPABASE_URL || !SUPABASE_KEY) { showToast('กรุณาเชื่อมต่อ Supabase ก่อน', 'warning'); return; }
  showLoading(true);
  try {
    const result = await supabaseFetch('purchase_orders', {
      method: 'POST',
      body: {
        po_number:     poData.poNumber,
        supplier_id:   parseInt(poData.supplierId),
        warehouse_id:  parseInt(poData.warehouseId),
        status:        'DRAFT',
        order_date:    poData.orderDate,
        expected_date: poData.expectedDate || null,
        total_amount:  poData.total,
        created_by:    poData.createdBy ? parseInt(poData.createdBy) : null,
        note:          poData.note || null,
      }
    });
    const poId = result[0].po_id;
    for (const item of poData.items) {
      await supabaseFetch('po_items', {
        method: 'POST',
        body: {
          po_id:       poId,
          product_id:  parseInt(item.productId),
          unit_id:     item.unitId ? parseInt(item.unitId) : null,
          qty_ordered: parseFloat(item.qty),
          unit_price:  parseFloat(item.price),
        }
      });
    }
    showToast(`✅ บันทึก ${poData.poNumber} สำเร็จ!`, 'success');
    setTimeout(() => resetForm(), 1500);
  } catch(e) { showToast('เกิดข้อผิดพลาด: ' + e.message, 'error'); }
  showLoading(false);
}

function saveDraft() { showToast('💾 บันทึก Draft แล้ว', 'success'); }

function previewPO() {
  const data = collectFormData(false);
  if (!data) return;
  const sup = document.getElementById('supplierId');
  const supName = sup.options[sup.selectedIndex]?.text || '—';
  alert(`📋 Preview PO\n\nเลขที่: ${data.poNumber}\nวันที่: ${data.orderDate}\nSupplier: ${supName}\nรายการ: ${data.items.length} รายการ\nยอดรวม: ${formatCurrency(data.total)}`);
}

function resetForm() {
  const year = new Date().getFullYear();
  document.getElementById('poNumber').value    = '001';
  document.getElementById('poNumberDisplay').textContent = `PO-${year}-001`;
  document.getElementById('orderDate').value   = new Date().toISOString().split('T')[0];
  document.getElementById('expectedDate').value = '';
  document.getElementById('supplierId').value  = '';
  document.getElementById('warehouseId').value = '';
  document.getElementById('createdBy').value   = '';
  document.getElementById('note').value        = '';
  document.getElementById('itemsBody').innerHTML = '';
  rowCount = 0;
  calcTotal();
  updateItemCount();
  addItemRow();
}

// ============================================================
// UTILS
// ============================================================
function formatCurrency(n) {
  return '฿' + parseFloat(n || 0).toLocaleString('th-TH', { minimumFractionDigits:2, maximumFractionDigits:2 });
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
window.addEventListener('DOMContentLoaded', () => {
  SUPABASE_URL = localStorage.getItem('sb_url') || '';
  SUPABASE_KEY = localStorage.getItem('sb_key') || '';
  document.getElementById('orderDate').value = new Date().toISOString().split('T')[0];
  const year = new Date().getFullYear();
  document.getElementById('poPrefix').textContent = `PO-${year}-`;
  addItemRow();
  if (SUPABASE_URL && SUPABASE_KEY) loadDropdowns().catch(console.error);
});