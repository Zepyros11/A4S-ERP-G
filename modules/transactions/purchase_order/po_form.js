let SUPABASE_URL = localStorage.getItem('sb_url') || '';
let SUPABASE_KEY = localStorage.getItem('sb_key') || '';
let products = [];
let productUnits = {};
let rowCount = 0;
const DEFAULT_COMPANY_PROFILE = Object.freeze({
  nameTh: 'บริษัทเอโฟร์เอส แคน คอร์ปอเรชั่น จำกัด',
  nameEn: 'A4S CAN CORPORATION CO., LTD.',
  address: '88/88 ถนนตัวอย่าง แขวงตัวอย่าง เขตตัวอย่าง กรุงเทพมหานคร 10200',
  taxId: '0105559999999',
  phone: '02-123-4567',
  email: 'procurement@a4scan.example'
});

async function supabaseFetch(table, options = {}) {
  const { method = 'GET', body, query = '' } = options;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: method === 'POST' ? 'return=representation' : ''
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.message || 'Error');
  }

  return method === 'GET' ? res.json() : res.json().catch(() => null);
}

function getUserLabel(user) {
  if (!user) return '';
  if (user.full_name) return user.full_name;
  return [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
}

function syncPoNumber(value) {
  const poCode = `${document.getElementById('poPrefix').textContent}${(value || '').trim()}`;
  document.getElementById('poNumberDisplay').textContent = poCode;
}

function setDefaultDates() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('orderDate').value = today;
  document.getElementById('preparedDate').value = today;
}

function getBuyerDefaults() {
  return {
    buyerCompany: DEFAULT_COMPANY_PROFILE.nameTh,
    buyerContact: [DEFAULT_COMPANY_PROFILE.phone, DEFAULT_COMPANY_PROFILE.email].filter(Boolean).join(' / '),
    buyerAddress: DEFAULT_COMPANY_PROFILE.address,
    buyerTaxId: DEFAULT_COMPANY_PROFILE.taxId
  };
}

function renderCompanyProfile() {
  document.getElementById('companyNameDisplay').textContent = DEFAULT_COMPANY_PROFILE.nameTh;
  document.getElementById('companyNameEnDisplay').textContent = DEFAULT_COMPANY_PROFILE.nameEn;
  document.getElementById('companyAddressDisplay').textContent = DEFAULT_COMPANY_PROFILE.address;
  document.getElementById('companyTaxIdDisplay').textContent = DEFAULT_COMPANY_PROFILE.taxId;
  document.getElementById('companyPhoneDisplay').textContent = DEFAULT_COMPANY_PROFILE.phone;
  document.getElementById('companyEmailDisplay').textContent = DEFAULT_COMPANY_PROFILE.email;
}

async function loadDropdowns() {
  const [suppliers, warehouses, users, prods, units] = await Promise.all([
    supabaseFetch('suppliers', { query: '?select=supplier_id,supplier_name,phone,contact_name,payment_terms&is_active=eq.true&order=supplier_name' }),
    supabaseFetch('warehouses', { query: '?select=warehouse_id,warehouse_name&is_active=eq.true&order=warehouse_name' }),
    supabaseFetch('users', { query: '?select=user_id,first_name,last_name&is_active=eq.true&order=user_id.desc' }),
    supabaseFetch('products', { query: '?select=product_id,product_code,product_name,cost_price&is_active=eq.true&order=product_name' }),
    supabaseFetch('product_units', { query: '?select=unit_id,product_id,unit_name,conversion_qty' })
  ]);

  const supplierSelect = document.getElementById('supplierId');
  supplierSelect.innerHTML = '<option value="">เลือก Supplier</option>';
  (suppliers || []).forEach((supplier) => {
    const option = document.createElement('option');
    option.value = supplier.supplier_id;
    option.textContent = supplier.supplier_name;
    option.dataset.phone = supplier.phone || '';
    option.dataset.contact = supplier.contact_name || '';
    option.dataset.paymentTerms = supplier.payment_terms || '';
    supplierSelect.appendChild(option);
  });

  const warehouseSelect = document.getElementById('warehouseId');
  warehouseSelect.innerHTML = '<option value="">เลือกคลัง</option>';
  (warehouses || []).forEach((warehouse) => {
    warehouseSelect.insertAdjacentHTML('beforeend', `<option value="${warehouse.warehouse_id}">${warehouse.warehouse_name}</option>`);
  });

  const createdBySelect = document.getElementById('createdBy');
  const approvedBySelect = document.getElementById('approvedBy');
  createdBySelect.innerHTML = '<option value="">เลือกผู้ใช้งาน</option>';
  approvedBySelect.innerHTML = '<option value="">เลือกผู้อนุมัติ</option>';
  (users || []).forEach((user) => {
    const label = getUserLabel(user);
    if (!label) return;
    createdBySelect.insertAdjacentHTML('beforeend', `<option value="${user.user_id}">${label}</option>`);
    approvedBySelect.insertAdjacentHTML('beforeend', `<option value="${user.user_id}">${label}</option>`);
  });

  products = prods || [];
  productUnits = {};
  (units || []).forEach((unit) => {
    if (!productUnits[unit.product_id]) productUnits[unit.product_id] = [];
    productUnits[unit.product_id].push(unit);
  });

  document.querySelectorAll('.row-product-select').forEach((select) => {
    const current = select.value;
    populateProductSelect(select);
    select.value = current;
  });

  showToast('โหลดข้อมูลสำหรับใบสั่งซื้อสำเร็จ', 'success');
}

function handleSupplierChange() {
  const supplierSelect = document.getElementById('supplierId');
  const option = supplierSelect.options[supplierSelect.selectedIndex];
  if (!option || !option.value) return;

  const vendorName = document.getElementById('vendorName');
  const vendorContact = document.getElementById('vendorContact');
  const paymentMethod = document.getElementById('paymentMethod');

  if (!vendorName.value.trim()) vendorName.value = option.textContent.trim();
  if (!vendorContact.value.trim()) {
    vendorContact.value = [option.dataset.contact, option.dataset.phone].filter(Boolean).join(' / ');
  }
  if (!paymentMethod.value.trim() && option.dataset.paymentTerms) {
    paymentMethod.value = option.dataset.paymentTerms;
  }
}

function handlePaymentTermChange() {
  const paymentTermType = document.getElementById('paymentTermType').value;
  const creditDaysInput = document.getElementById('creditDays');
  const isCredit = paymentTermType === 'เครดิต';
  creditDaysInput.disabled = !isCredit;
  if (!isCredit) creditDaysInput.value = '0';
}

function addItemRow(shouldFocus = true) {
  rowCount += 1;
  const tbody = document.getElementById('itemsBody');
  const tr = document.createElement('tr');
  tr.id = `row-${rowCount}`;
  tr.innerHTML = `
    <td><div class="item-num">${rowCount}</div></td>
    <td>
      <div class="item-product-cell">
        <select class="td-input row-product-select" onchange="onProductChange(this, ${rowCount})">
          <option value="">เลือกสินค้า</option>
        </select>
        <input type="text" class="td-input item-description" id="desc-${rowCount}" placeholder="รายละเอียดเพิ่มเติมของสินค้า / บริการ">
      </div>
    </td>
    <td>
      <input type="number" class="td-input text-right" id="qty-${rowCount}" placeholder="0" min="0" step="0.01" value="1" oninput="calcRow(${rowCount})">
    </td>
    <td>
      <select class="td-input row-unit-select" id="unit-${rowCount}" onchange="calcRow(${rowCount})">
        <option value="">เลือกหน่วย</option>
      </select>
    </td>
    <td>
      <input type="number" class="td-input text-right" id="price-${rowCount}" placeholder="0.00" min="0" step="0.01" oninput="calcRow(${rowCount})">
    </td>
    <td><div class="subtotal-cell" id="sub-${rowCount}">฿0.00</div></td>
    <td><button class="btn-remove" type="button" onclick="removeRow(${rowCount})">✕</button></td>`;
  tbody.appendChild(tr);

  const productSelect = tr.querySelector('.row-product-select');
  if (products.length > 0) populateProductSelect(productSelect);
  updateItemCount();
  calcRow(rowCount);
  if (shouldFocus) productSelect.focus();
}

function populateProductSelect(select) {
  const current = select.value;
  select.innerHTML = '<option value="">เลือกสินค้า</option>';
  products.forEach((product) => {
    select.insertAdjacentHTML(
      'beforeend',
      `<option value="${product.product_id}" data-price="${product.cost_price || 0}" data-name="${product.product_name}">${product.product_code} - ${product.product_name}</option>`
    );
  });
  select.value = current;
}

function onProductChange(select, rowId) {
  const option = select.options[select.selectedIndex];
  const productId = parseInt(select.value, 10);
  const price = parseFloat(option?.dataset?.price || 0);
  const descriptionInput = document.getElementById(`desc-${rowId}`);
  const priceInput = document.getElementById(`price-${rowId}`);
  const unitSelect = document.getElementById(`unit-${rowId}`);

  if (option?.dataset?.name && !descriptionInput.value.trim()) {
    descriptionInput.value = option.dataset.name;
  }
  if (price > 0) {
    priceInput.value = price.toFixed(2);
  }

  unitSelect.innerHTML = '<option value="">เลือกหน่วย</option>';
  const units = productUnits[productId] || [];
  units.forEach((unit) => {
    unitSelect.insertAdjacentHTML('beforeend', `<option value="${unit.unit_id}">${unit.unit_name}</option>`);
  });
  if (units.length > 0) unitSelect.value = units[0].unit_id;

  calcRow(rowId);
}

function calcRow(rowId) {
  const qty = parseFloat(document.getElementById(`qty-${rowId}`)?.value || 0);
  const price = parseFloat(document.getElementById(`price-${rowId}`)?.value || 0);
  const subtotal = qty * price;
  document.getElementById(`sub-${rowId}`).textContent = formatCurrency(subtotal);
  calcTotal();
}

function removeRow(rowId) {
  const rows = document.querySelectorAll('#itemsBody tr');
  if (rows.length <= 1) {
    showToast('ควรมีอย่างน้อย 1 รายการสินค้า', 'warning');
    return;
  }

  document.getElementById(`row-${rowId}`)?.remove();
  updateItemCount();
  calcTotal();
}

function updateItemCount() {
  const count = document.querySelectorAll('#itemsBody tr').length;
  document.getElementById('itemCount').textContent = `${count} รายการ`;
}

function calcTotal() {
  let subtotal = 0;
  document.querySelectorAll('.subtotal-cell').forEach((cell) => {
    subtotal += parseCurrency(cell.textContent);
  });

  const discount = Math.max(0, parseFloat(document.getElementById('additionalDiscount')?.value || 0));
  const netBeforeVat = Math.max(0, subtotal - discount);
  const vatEnabled = document.getElementById('vatToggle').checked;
  const vat = vatEnabled ? netBeforeVat * 0.07 : 0;
  const total = netBeforeVat + vat;

  document.getElementById('vatRow').classList.toggle('vat-off', !vatEnabled);
  document.getElementById('subtotalDisplay').textContent = formatCurrency(subtotal);
  document.getElementById('vatDisplay').textContent = vatEnabled ? formatCurrency(vat) : '—';
  document.getElementById('totalDisplay').textContent = formatCurrency(total);

  return { subtotal, discount, vat, total };
}

function collectFormData(validate = true) {
  const poSuffix = document.getElementById('poNumber').value.trim();
  const orderDate = document.getElementById('orderDate').value;
  const expectedDate = document.getElementById('expectedDate').value;
  const preparedDate = document.getElementById('preparedDate').value;
  const supplierId = document.getElementById('supplierId').value;
  const warehouseId = document.getElementById('warehouseId').value;
  const createdBy = document.getElementById('createdBy').value;
  const approvedBy = document.getElementById('approvedBy').value;

  if (validate) {
    if (!poSuffix) {
      showToast('กรุณาระบุเลขที่เอกสาร', 'error');
      return null;
    }
    if (!orderDate) {
      showToast('กรุณาระบุวันที่ออกเอกสาร', 'error');
      return null;
    }
    if (!supplierId) {
      showToast('กรุณาเลือก Supplier', 'error');
      return null;
    }
    if (!warehouseId) {
      showToast('กรุณาเลือกคลังรับสินค้า', 'error');
      return null;
    }
  }

  const items = [];
  document.querySelectorAll('#itemsBody tr').forEach((tr) => {
    const rowId = tr.id.replace('row-', '');
    const productId = tr.querySelector('.row-product-select')?.value;
    const unitId = tr.querySelector('.row-unit-select')?.value;
    const description = document.getElementById(`desc-${rowId}`)?.value?.trim() || '';
    const qty = parseFloat(document.getElementById(`qty-${rowId}`)?.value || 0);
    const price = parseFloat(document.getElementById(`price-${rowId}`)?.value || 0);

    if (productId && qty > 0) {
      items.push({
        productId,
        unitId,
        description,
        qty,
        price,
        subtotal: qty * price
      });
    }
  });

  if (validate && items.length === 0) {
    showToast('กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ', 'error');
    return null;
  }

  const totals = calcTotal();
  const buyerDefaults = getBuyerDefaults();

  return {
    poNumber: `${document.getElementById('poPrefix').textContent}${poSuffix}`,
    orderDate,
    expectedDate,
    preparedDate,
    supplierId,
    warehouseId,
    createdBy,
    approvedBy,
    ...buyerDefaults,
    vendorName: document.getElementById('vendorName').value.trim(),
    vendorAddress: document.getElementById('vendorAddress').value.trim(),
    vendorContact: document.getElementById('vendorContact').value.trim(),
    vendorTaxId: document.getElementById('vendorTaxId').value.trim(),
    deliveryLocation: document.getElementById('deliveryLocation').value.trim(),
    deliveryMethod: document.getElementById('deliveryMethod').value.trim(),
    receivedBy: document.getElementById('receivedBy').value.trim(),
    paymentTermType: document.getElementById('paymentTermType').value,
    creditDays: parseInt(document.getElementById('creditDays').value || '0', 10) || 0,
    paymentMethod: document.getElementById('paymentMethod').value.trim(),
    specialConditions: document.getElementById('specialConditions').value.trim(),
    note: document.getElementById('note').value.trim(),
    approvedDate: document.getElementById('approvedDate').value,
    items,
    ...totals
  };
}

function buildSubmissionNote(data) {
  const sections = [];

  if (data.specialConditions) sections.push(`เงื่อนไขพิเศษ: ${data.specialConditions}`);
  if (data.note) sections.push(`หมายเหตุ: ${data.note}`);

  const buyerInfo = [data.buyerCompany, data.buyerContact, data.buyerTaxId, data.buyerAddress].filter(Boolean).join(' | ');
  if (buyerInfo) sections.push(`ข้อมูลผู้ซื้อ: ${buyerInfo}`);

  const vendorInfo = [data.vendorName, data.vendorContact, data.vendorTaxId, data.vendorAddress].filter(Boolean).join(' | ');
  if (vendorInfo) sections.push(`ข้อมูลผู้ขาย: ${vendorInfo}`);

  const deliveryInfo = [data.deliveryLocation, data.deliveryMethod, data.receivedBy].filter(Boolean).join(' | ');
  if (deliveryInfo) sections.push(`การจัดส่ง: ${deliveryInfo}`);

  const paymentInfo = [
    data.paymentTermType,
    data.paymentTermType === 'เครดิต' ? `${data.creditDays} วัน` : '',
    data.paymentMethod
  ].filter(Boolean).join(' | ');
  if (paymentInfo) sections.push(`การชำระเงิน: ${paymentInfo}`);

  const approvalInfo = [data.preparedDate, data.approvedDate].filter(Boolean).join(' | ');
  if (approvalInfo) sections.push(`วันที่เอกสาร/อนุมัติ: ${approvalInfo}`);

  return sections.join('\n');
}

async function submitPO() {
  const data = collectFormData(true);
  if (!data) return;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    showToast('กรุณาเชื่อมต่อ Supabase ก่อน', 'warning');
    return;
  }

  showLoading(true);
  try {
    const result = await supabaseFetch('purchase_orders', {
      method: 'POST',
      body: {
        po_number: data.poNumber,
        supplier_id: parseInt(data.supplierId, 10),
        warehouse_id: parseInt(data.warehouseId, 10),
        status: 'DRAFT',
        order_date: data.orderDate,
        expected_date: data.expectedDate || null,
        total_amount: data.total,
        created_by: data.createdBy ? parseInt(data.createdBy, 10) : null,
        note: buildSubmissionNote(data) || null
      }
    });

    const poId = result?.[0]?.po_id;
    for (const item of data.items) {
      await supabaseFetch('po_items', {
        method: 'POST',
        body: {
          po_id: poId,
          product_id: parseInt(item.productId, 10),
          unit_id: item.unitId ? parseInt(item.unitId, 10) : null,
          qty_ordered: item.qty,
          unit_price: item.price
        }
      });
    }

    showToast(`บันทึก ${data.poNumber} สำเร็จ`, 'success');
    setTimeout(() => resetForm(), 1200);
  } catch (error) {
    showToast(`เกิดข้อผิดพลาด: ${error.message}`, 'error');
  } finally {
    showLoading(false);
  }
}

function saveDraft() {
  calcTotal();
  showToast('บันทึก Draft เรียบร้อยแล้ว', 'success');
}

function previewPO() {
  const data = collectFormData(false);
  if (!data) return;

  const supplierName = document.getElementById('supplierId').selectedOptions[0]?.textContent || '—';
  alert(
    `Preview PO\n\n` +
    `เลขที่เอกสาร: ${data.poNumber}\n` +
    `วันที่ออกเอกสาร: ${data.orderDate || '—'}\n` +
    `ผู้ขาย: ${data.vendorName || supplierName}\n` +
    `สถานที่จัดส่ง: ${data.deliveryLocation || '—'}\n` +
    `จำนวนรายการ: ${data.items.length} รายการ\n` +
    `ยอดสุทธิ: ${formatCurrency(data.total)}`
  );
}

function resetForm() {
  rowCount = 0;
  document.getElementById('poNumber').value = '001';
  document.getElementById('expectedDate').value = '';
  document.getElementById('supplierId').value = '';
  document.getElementById('warehouseId').value = '';
  document.getElementById('createdBy').value = '';
  document.getElementById('approvedBy').value = '';
  document.getElementById('approvedDate').value = '';
  document.getElementById('vendorName').value = '';
  document.getElementById('vendorAddress').value = '';
  document.getElementById('vendorContact').value = '';
  document.getElementById('vendorTaxId').value = '';
  document.getElementById('deliveryLocation').value = '';
  document.getElementById('deliveryMethod').value = '';
  document.getElementById('receivedBy').value = '';
  document.getElementById('paymentTermType').value = 'เงินสด';
  document.getElementById('creditDays').value = '0';
  document.getElementById('paymentMethod').value = '';
  document.getElementById('specialConditions').value = '';
  document.getElementById('note').value = '';
  document.getElementById('additionalDiscount').value = '0';
  document.getElementById('vatToggle').checked = true;
  document.getElementById('itemsBody').innerHTML = '';

  syncPoNumber('001');
  setDefaultDates();
  handlePaymentTermChange();
  addItemRow(false);
  calcTotal();
  updateItemCount();
}

function formatCurrency(value) {
  return '฿' + parseFloat(value || 0).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function parseCurrency(value) {
  return parseFloat(String(value || '0').replace('฿', '').replace(/,/g, '')) || 0;
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.className = `toast toast-${type} show`;
  toast.textContent = message;
  setTimeout(() => toast.classList.remove('show'), 3000);
}

function showLoading(show) {
  document.getElementById('loadingOverlay').classList.toggle('show', show);
}

window.addEventListener('DOMContentLoaded', () => {
  SUPABASE_URL = localStorage.getItem('sb_url') || '';
  SUPABASE_KEY = localStorage.getItem('sb_key') || '';

  const year = new Date().getFullYear();
  document.getElementById('poPrefix').textContent = `PO-${year}-`;
  renderCompanyProfile();
  setDefaultDates();
  syncPoNumber('001');
  handlePaymentTermChange();
  addItemRow(false);
  calcTotal();

  document.getElementById('supplierId').addEventListener('change', handleSupplierChange);
  document.getElementById('paymentTermType').addEventListener('change', handlePaymentTermChange);
  document.getElementById('orderDate').addEventListener('change', () => {
    if (!document.getElementById('preparedDate').value) {
      document.getElementById('preparedDate').value = document.getElementById('orderDate').value;
    }
  });

  if (SUPABASE_URL && SUPABASE_KEY) {
    loadDropdowns().catch((error) => {
      console.error(error);
      showToast('โหลดข้อมูลอ้างอิงไม่สำเร็จ', 'warning');
    });
  }
});

