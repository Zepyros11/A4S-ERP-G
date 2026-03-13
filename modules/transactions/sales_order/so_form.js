// ============================================================
// STATE
// ============================================================
let SUPABASE_URL = localStorage.getItem('sb_url') || '';
let SUPABASE_KEY = localStorage.getItem('sb_key') || '';
let currentType  = 'SALE'; // 'SALE' | 'INTERNAL'
let products     = [];
let productUnits = {};
let discountType = 'pct'; // 'pct' | 'amt'
let rowCount     = 0;

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
      'Prefer':        method === 'POST' ? 'return=representation' : ''
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.message || 'Error'); }
  return method === 'GET' ? res.json() : res.json().catch(() => null);
}

// ============================================================
// ORDER TYPE
// ============================================================
function setOrderType(type) {
  currentType = type;
  const isSale = type === 'SALE';

  document.getElementById('btnSale').className     = 'type-btn' + (isSale ? ' active-SALE' : '');
  document.getElementById('btnInternal').className = 'type-btn' + (!isSale ? ' active-INTERNAL' : '');

  // Show/hide customer field
  document.getElementById('customerGroup').style.display = isSale ? '' : 'none';

  // Update prefix & display
  const year   = new Date().getFullYear();
  const prefix = isSale ? `SO-${year}-` : `INT-${year}-`;
  document.getElementById('soPrefix').textContent       = prefix;
  document.getElementById('soNumberDisplay').textContent = prefix + document.getElementById('soNumber').value;

  // VAT default: on for SALE, off for INTERNAL
  document.getElementById('vatToggle').checked = isSale;
  calcTotal();
}

// ============================================================
// LOAD DROPDOWNS
// ============================================================
async function loadDropdowns() {
  const [customers, warehouses, users, pos, prods, units] = await Promise.all([
    supabaseFetch('customers',     { query: '?select=customer_id,customer_name&is_active=eq.true&order=customer_name' }),
    supabaseFetch('warehouses',    { query: '?select=warehouse_id,warehouse_name&is_active=eq.true' }),
    supabaseFetch('users',         { query: '?select=user_id,first_name,last_name&is_active=eq.true' }),
    supabaseFetch('purchase_orders', { query: '?select=po_id,po_number,status&order=po_number.desc&limit=50' }),
    supabaseFetch('products',      { query: '?select=product_id,product_code,product_name,sale_price&is_active=eq.true&order=product_name' }),
    supabaseFetch('product_units', { query: '?select=unit_id,product_id,unit_name,conversion_qty' }),
  ]);

  const selCus = document.getElementById('customerId');
  selCus.innerHTML = '<option value="">— เลือกลูกค้า —</option>';
  customers?.forEach(c => selCus.insertAdjacentHTML('beforeend',
    `<option value="${c.customer_id}">${c.customer_name}</option>`));

  const selWH = document.getElementById('warehouseId');
  selWH.innerHTML = '<option value="">— เลือกคลัง —</option>';
  warehouses?.forEach(w => selWH.insertAdjacentHTML('beforeend',
    `<option value="${w.warehouse_id}">${w.warehouse_name}</option>`));

  const selUser = document.getElementById('createdBy');
  selUser.innerHTML = '<option value="">— เลือกผู้ใช้ —</option>';
  users?.forEach(u => selUser.insertAdjacentHTML('beforeend',
    `<option value="${u.user_id}">${u.first_name} ${u.last_name}</option>`));

  const selPO = document.getElementById('relatedPo');
  selPO.innerHTML = '<option value="">— เลือก PO ที่เกี่ยวข้อง (ถ้ามี) —</option>';
  pos?.forEach(p => selPO.insertAdjacentHTML('beforeend',
    `<option value="${p.po_id}">${p.po_number} [${p.status}]</option>`));

  products     = prods || [];
  productUnits = {};
  units?.forEach(u => {
    if (!productUnits[u.product_id]) productUnits[u.product_id] = [];
    productUnits[u.product_id].push(u);
  });

  document.querySelectorAll('.row-product-select').forEach(sel => {
    const cur = sel.value;
    populateProductSelect(sel);
    sel.value = cur;
  });

  showToast('✅ โหลดข้อมูลสำเร็จ', 'success');
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
    `<option value="${p.product_id}" data-price="${p.sale_price}">${p.product_code} — ${p.product_name}</option>`));
  sel.value = cur;
}

function onProductChange(sel, rowId) {
  const opt       = sel.options[sel.selectedIndex];
  const productId = parseInt(sel.value);
  const price     = parseFloat(opt?.dataset?.price || 0);
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
  const qty   = parseFloat(document.getElementById(`qty-${rowId}`)?.value   || 0);
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

// ============================================================
// DISCOUNT & TOTAL
// ============================================================
function toggleDiscount() {
  const on = document.getElementById('discountToggle').checked;
  document.getElementById('discountValue').disabled = !on;
  if (!on) document.getElementById('discountValue').value = '';
  calcTotal();
}

function setDiscountType(type) {
  discountType = type;
  document.getElementById('btnPct').className = 'discount-type-btn' + (type === 'pct' ? ' active' : '');
  document.getElementById('btnAmt').className = 'discount-type-btn' + (type === 'amt' ? ' active' : '');
  calcTotal();
}

function calcTotal() {
  let sub = 0;
  document.querySelectorAll('.subtotal-cell').forEach(el => {
    sub += parseFloat(el.textContent.replace('฿', '').replace(/,/g, '')) || 0;
  });

  // Discount
  let discount = 0;
  const discOn  = document.getElementById('discountToggle').checked;
  const discVal = parseFloat(document.getElementById('discountValue').value || 0);
  if (discOn && discVal > 0) {
    discount = discountType === 'pct' ? sub * (discVal / 100) : discVal;
    discount = Math.min(discount, sub);
  }
  const afterDiscount = sub - discount;

  // VAT
  const vatOn = document.getElementById('vatToggle').checked;
  const vat   = vatOn ? afterDiscount * 0.07 : 0;
  const total = afterDiscount + vat;

  document.getElementById('subtotalDisplay').textContent  = formatCurrency(sub);
  document.getElementById('discountDisplay').textContent  = discount > 0 ? '-' + formatCurrency(discount) : '-฿0.00';
  document.getElementById('vatRow').classList.toggle('vat-off', !vatOn);
  document.getElementById('vatDisplay').textContent       = vatOn ? formatCurrency(vat) : '—';
  document.getElementById('totalDisplay').textContent     = formatCurrency(total);
}

// ============================================================
// COLLECT & SUBMIT
// ============================================================
function collectFormData(validate = true) {
  const year     = new Date().getFullYear();
  const prefix   = currentType === 'SALE' ? `SO-${year}-` : `INT-${year}-`;
  const soNumber = prefix + document.getElementById('soNumber').value.trim();
  const customerId  = document.getElementById('customerId').value;
  const warehouseId = document.getElementById('warehouseId').value;
  const orderDate   = document.getElementById('orderDate').value;
  const deliveryDate = document.getElementById('deliveryDate').value;
  const createdBy   = document.getElementById('createdBy').value;
  const relatedPo   = document.getElementById('relatedPo').value;
  const note        = document.getElementById('note').value;

  if (validate) {
    if (currentType === 'SALE' && !customerId) { showToast('กรุณาเลือกลูกค้า', 'error');      return null; }
    if (!warehouseId)  { showToast('กรุณาเลือกคลัง', 'error');       return null; }
    if (!orderDate)    { showToast('กรุณาระบุวันที่', 'error');       return null; }
    if (!deliveryDate) { showToast('กรุณาระบุวันที่ส่งของ', 'error'); return null; }
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
  const discOn  = document.getElementById('discountToggle').checked;
  const discVal = parseFloat(document.getElementById('discountValue').value || 0);
  let discount  = 0;
  if (discOn && discVal > 0) discount = discountType === 'pct' ? sub * (discVal / 100) : discVal;
  const afterDiscount = sub - discount;
  const vatOn  = document.getElementById('vatToggle').checked;
  const total  = vatOn ? afterDiscount * 1.07 : afterDiscount;

  return { soNumber, customerId, warehouseId, orderDate, deliveryDate, createdBy, relatedPo, note, items, total, discount };
}

async function submitSO() {
  const data = collectFormData();
  if (!data) return;
  if (!SUPABASE_URL || !SUPABASE_KEY) { showToast('กรุณาเชื่อมต่อ Supabase ก่อน', 'warning'); return; }

  showLoading(true);
  try {
    const result = await supabaseFetch('sales_orders', {
      method: 'POST',
      body: {
        so_number:    data.soNumber,
        customer_id:  data.customerId  ? parseInt(data.customerId)  : null,
        warehouse_id: parseInt(data.warehouseId),
        order_type:   currentType,
        status:       'DRAFT',
        order_date:   data.orderDate,
        delivery_date: data.deliveryDate || null,
        total_amount: data.total,
        discount_amount: data.discount || 0,
        created_by:   data.createdBy ? parseInt(data.createdBy) : null,
        related_po_id: data.relatedPo ? parseInt(data.relatedPo) : null,
        note:         data.note || null,
      }
    });
    const soId = result[0].so_id;
    for (const item of data.items) {
      await supabaseFetch('so_items', {
        method: 'POST',
        body: {
          so_id:       soId,
          product_id:  parseInt(item.productId),
          unit_id:     item.unitId ? parseInt(item.unitId) : null,
          qty_ordered: parseFloat(item.qty),
          unit_price:  parseFloat(item.price),
        }
      });
    }
    showToast(`✅ บันทึก ${data.soNumber} สำเร็จ!`, 'success');
    setTimeout(() => resetForm(), 1500);
  } catch(e) { showToast('เกิดข้อผิดพลาด: ' + e.message, 'error'); }
  showLoading(false);
}

function saveDraft() { showToast('💾 บันทึก Draft แล้ว', 'success'); }

function previewSO() {
  const data = collectFormData(false);
  if (!data) return;
  const typeLabel = currentType === 'SALE' ? 'ใบขาย' : 'เบิกภายใน';
  const cus = document.getElementById('customerId');
  const cusName = currentType === 'SALE' ? (cus.options[cus.selectedIndex]?.text || '—') : 'ภายใน';
  alert(`📋 Preview ${typeLabel}\n\nเลขที่: ${data.soNumber}\nวันที่: ${data.orderDate}\nวันส่งของ: ${data.deliveryDate || '—'}\nลูกค้า: ${cusName}\nรายการ: ${data.items.length} รายการ\nยอดรวม: ${formatCurrency(data.total)}`);
}

function resetForm() {
  const year = new Date().getFullYear();
  setOrderType('SALE');
  document.getElementById('soNumber').value      = '001';
  document.getElementById('soNumberDisplay').textContent = `SO-${year}-001`;
  document.getElementById('orderDate').value     = new Date().toISOString().split('T')[0];
  document.getElementById('deliveryDate').value  = '';
  document.getElementById('customerId').value    = '';
  document.getElementById('warehouseId').value   = '';
  document.getElementById('createdBy').value     = '';
  document.getElementById('relatedPo').value     = '';
  document.getElementById('note').value          = '';
  document.getElementById('discountToggle').checked = false;
  document.getElementById('discountValue').value = '';
  document.getElementById('discountValue').disabled = true;
  document.getElementById('vatToggle').checked   = true;
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
  const year   = new Date().getFullYear();
  document.getElementById('soPrefix').textContent = `SO-${year}-`;
  document.getElementById('orderDate').value = new Date().toISOString().split('T')[0];
  addItemRow();
  if (SUPABASE_URL && SUPABASE_KEY) loadDropdowns().catch(console.error);
});