// ============================================================
// po-form.js — Purchase Order Form (create / edit / approve / print)
// ============================================================
let SUPABASE_URL      = localStorage.getItem('sb_url') || '';
let SUPABASE_KEY      = localStorage.getItem('sb_key') || '';
let products          = [];
let productsForPicker = [];
let productImageByPid = {};
let productUnits      = {};
let stockByWhPid      = {};
let userWarehouseIds  = [];
let warehouses        = [];
let suppliers         = [];
let rowCount          = 0;
let selectedSupplierId  = null;
let selectedWarehouseId = null;
let editingPoId       = null;
let editingPoRow      = null;
let formDirty         = false;

function getPoPrefix(d = new Date()) {
  const y  = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `PO-${y}-${mm}-`;
}

const NO_IMAGE_URL = '../../../assets/images/NoImage.png';

const COMPANY_PROFILE = Object.freeze({
  nameTh:  'บริษัทเอโฟร์เอส แคน คอร์ปอเรชั่น จำกัด',
  nameEn:  'A4S CAN CORPORATION CO., LTD.',
  logoUrl: '../../../assets/logo/logo-a4s.png',
});

// ============================================================
// SUPABASE FETCH
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

// signed qty (เหมือน stock-balance.js)
function poSignedQty(m) {
  const q = +m.qty || 0;
  return (m.movement_type === 'OUT' || m.movement_type === 'INTERNAL') ? -q : q;
}

// ============================================================
// LOAD DROPDOWNS
// ============================================================
async function loadDropdowns() {
  const [prods, units, images, whs, sups] = await Promise.all([
    supabaseFetch('products',      { query: '?select=product_id,product_code,product_name,parent_product_id&is_active=eq.true&order=product_id.asc' }),
    supabaseFetch('product_units', { query: '?select=unit_id,product_id,unit_name' }),
    supabaseFetch('product_images',{ query: '?select=product_id,url,sort_order&order=sort_order.asc' }),
    supabaseFetch('warehouses',    { query: '?select=warehouse_id,warehouse_name,country,parent_id&is_active=eq.true&order=country,warehouse_name' }),
    supabaseFetch('suppliers',     { query: '?select=supplier_id,supplier_code,supplier_name&is_active=eq.true&order=supplier_name' }),
  ]);

  // Products + variants
  products = prods || [];
  const parentIdsWithKids = new Set(products.filter(p => p.parent_product_id).map(c => c.parent_product_id));
  productsForPicker = products.filter(p => p.parent_product_id || !parentIdsWithKids.has(p.product_id));

  productUnits = {};
  units?.forEach(u => {
    if (!productUnits[u.product_id]) productUnits[u.product_id] = [];
    productUnits[u.product_id].push(u);
  });

  productImageByPid = {};
  (images || []).forEach(im => {
    if (!productImageByPid[im.product_id]) productImageByPid[im.product_id] = im.url;
  });

  // Warehouses
  warehouses = whs || [];
  await loadAndRenderWarehouses();

  // Suppliers
  suppliers = sups || [];
  renderSupplierCards(suppliers);

  // PO prefix + auto next number
  const prefix = getPoPrefix();
  document.getElementById('poPrefix').textContent = prefix;
  await refreshPoNumber();

  // Stock background load
  loadUserWarehouseStock().catch(err => console.warn('[loadUserWarehouseStock]', err));

  showToast('✅ โหลดข้อมูลสำเร็จ', 'success');
}

// ============================================================
// WAREHOUSE CARDS (filter by user country)
// ============================================================
async function loadAndRenderWarehouses() {
  const userId = window.ERP_USER?.user_id;
  let country = '';
  if (userId) {
    try {
      const rows = await supabaseFetch('users', { query: `?user_id=eq.${encodeURIComponent(userId)}&select=country` });
      country = (rows?.[0]?.country || '').trim().toUpperCase();
    } catch (e) { console.warn('[warehouse-cards]', e); }
  }
  const list = country
    ? warehouses.filter(w => (w.country || '').toUpperCase() === country)
    : warehouses;
  renderWarehouseCards(list);
}

function sortWarehousesParentFirst(list) {
  const byId = new Map(list.map(w => [w.warehouse_id, w]));
  const childrenOf = new Map();
  list.forEach(w => {
    const pid = (w.parent_id && byId.has(w.parent_id)) ? w.parent_id : null;
    if (!childrenOf.has(pid)) childrenOf.set(pid, []);
    childrenOf.get(pid).push(w);
  });
  const result = [];
  const walk = (parentId, depth) => {
    (childrenOf.get(parentId) || []).forEach(w => {
      result.push({ ...w, _depth: depth });
      walk(w.warehouse_id, depth + 1);
    });
  };
  walk(null, 0);
  return result;
}

function renderWarehouseCards(list) {
  const grid = document.getElementById('warehouseGrid');
  if (!grid) return;
  grid.innerHTML = '';
  if (!list.length) {
    grid.innerHTML = '<div class="warehouse-grid-empty">— ไม่มีคลังในประเทศของคุณ —</div>';
    return;
  }
  const sorted = sortWarehousesParentFirst(list);
  sorted.forEach(w => {
    const card = document.createElement('div');
    card.className  = 'warehouse-card' + (w._depth > 0 ? ' is-child' : '');
    card.dataset.id = w.warehouse_id;
    const icon = w._depth > 0 ? '↳' : '🏬';
    card.innerHTML  = `<span class="wh-icon">${icon}</span><span class="wh-label">${escapeHtml(w.warehouse_name || '')}</span>`;
    card.onclick = () => selectWarehouse(w.warehouse_id, card);
    grid.appendChild(card);
  });
  if (!selectedWarehouseId) {
    const first = grid.querySelector('.warehouse-card');
    if (first) selectWarehouse(+first.dataset.id, first);
  }
}

function selectWarehouse(id, card) {
  const isUserAction = selectedWarehouseId !== null && selectedWarehouseId !== id;
  selectedWarehouseId = id;
  document.getElementById('warehouseId').value = String(id);
  document.querySelectorAll('.warehouse-card').forEach(c => c.classList.remove('active'));
  card.classList.add('active');
  if (activeComboRow != null) comboRender(activeComboRow);
  updateAllRowStockBadges();
  if (isUserAction) formDirty = true;
}

// ============================================================
// SUPPLIER CARDS
// ============================================================
function renderSupplierCards(list) {
  const grid = document.getElementById('supplierGrid');
  if (!grid) return;
  grid.innerHTML = '';
  if (!list.length) {
    grid.innerHTML = '<div class="supplier-grid-empty">— ยังไม่มี supplier ในระบบ —</div>';
    return;
  }
  list.forEach(s => {
    const card = document.createElement('div');
    card.className = 'supplier-card';
    card.dataset.id = s.supplier_id;
    card.innerHTML = `
      <span class="sup-icon">🏭</span>
      <span class="sup-label">${escapeHtml(s.supplier_name || '')}</span>`;
    card.onclick = () => selectSupplier(s.supplier_id, card);
    grid.appendChild(card);
  });
}

function selectSupplier(id, card) {
  selectedSupplierId = id;
  document.getElementById('supplierId').value = String(id);
  document.querySelectorAll('.supplier-card').forEach(c => c.classList.remove('active'));
  card.classList.add('active');
  formDirty = true;
}

// ============================================================
// USER WAREHOUSE STOCK
// ============================================================
async function loadUserWarehouseStock() {
  const userId = window.ERP_USER?.user_id;
  if (!userId) return;
  const userRows = await supabaseFetch('users', { query: `?user_id=eq.${encodeURIComponent(userId)}&select=country` });
  const country = (userRows?.[0]?.country || '').trim();
  if (!country) return;
  const whs = await supabaseFetch('warehouses', {
    query: `?country=eq.${encodeURIComponent(country)}&is_active=eq.true&select=warehouse_id`,
  });
  userWarehouseIds = (whs || []).map(w => w.warehouse_id);
  if (!userWarehouseIds.length) return;
  const inList = userWarehouseIds.join(',');
  const moves = await supabaseFetch('stock_movements', {
    query: `?warehouse_id=in.(${inList})&select=product_id,warehouse_id,movement_type,qty`,
  });
  stockByWhPid = {};
  (moves || []).forEach(m => {
    if (m.product_id == null || m.warehouse_id == null) return;
    const bucket = (stockByWhPid[m.warehouse_id] ||= {});
    bucket[m.product_id] = (bucket[m.product_id] || 0) + poSignedQty(m);
  });
  if (activeComboRow != null) comboRender(activeComboRow);
  updateAllRowStockBadges();
}

function stockBadgeHtml(productId) {
  if (!selectedWarehouseId) return '';
  const bucket = stockByWhPid[selectedWarehouseId];
  if (!bucket) return '';
  const qty = bucket[productId] || 0;
  let cls = 'zero';
  if (qty < 0)       cls = 'neg';
  else if (qty === 0) cls = 'zero';
  else if (qty < 10) cls = 'low';
  else                cls = 'has';
  const display = Number.isInteger(qty) ? qty : qty.toFixed(2);
  return `<span class="combo-stock ${cls}" title="คงเหลือในคลังที่เลือก">${display}</span>`;
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
    <td class="text-center">
      <div class="prod-thumb" id="thumb-${rowCount}">
        <img src="${NO_IMAGE_URL}" alt="">
      </div>
    </td>
    <td>
      <div class="combo">
        <input type="text" class="td-input combo-input" id="combo-input-${rowCount}"
               placeholder="พิมพ์ค้นหาสินค้า..." autocomplete="off"
               onfocus="comboFocus(${rowCount})"
               oninput="comboInput(${rowCount})"
               onblur="comboBlur(${rowCount})"
               onkeydown="comboKey(event, ${rowCount})">
        <span class="row-stock-badge" id="row-stock-${rowCount}"></span>
        <input type="hidden" class="row-product-select" id="product-${rowCount}">
      </div>
    </td>
    <td class="text-center">
      <input type="number" class="td-input text-right" id="qty-ord-${rowCount}"
        placeholder="0" min="0" step="0.01" oninput="calcSummary()">
    </td>
    <td class="text-right">
      <input type="number" class="td-input text-right" id="price-${rowCount}"
        placeholder="0.00" min="0" step="0.01" oninput="calcSummary()">
    </td>
    <td class="text-right" id="line-total-${rowCount}">฿0.00</td>
    <td><button class="btn-remove" onclick="removeRow(${rowCount})">✕</button></td>`;
  tbody.appendChild(tr);
  calcSummary();
  document.getElementById(`combo-input-${rowCount}`).focus();
  formDirty = true;
}

// ============================================================
// COMBO (searchable product picker)
// ============================================================
let activeComboRow = null;
let comboKbdIdx    = -1;

function comboFocus(rowId) {
  activeComboRow = rowId;
  comboKbdIdx    = -1;
  comboRender(rowId);
  comboPosition(rowId);
}
function comboInput(rowId) {
  document.getElementById(`product-${rowId}`).value = '';
  const badge = document.getElementById(`row-stock-${rowId}`);
  if (badge) badge.innerHTML = '';
  const thumb = document.getElementById(`thumb-${rowId}`);
  if (thumb) {
    thumb.innerHTML = `<img src="${NO_IMAGE_URL}" alt="">`;
    thumb.classList.remove('is-clickable');
    thumb.onclick = null;
    thumb.title = '';
  }
  comboKbdIdx = -1;
  comboRender(rowId);
}
function comboBlur(rowId) {
  setTimeout(() => { if (activeComboRow === rowId) comboClose(); }, 150);
}
function comboClose() {
  document.getElementById('comboPortal')?.classList.remove('open');
  activeComboRow = null;
  comboKbdIdx    = -1;
}
function comboPosition(rowId) {
  const input  = document.getElementById(`combo-input-${rowId}`);
  const portal = document.getElementById('comboPortal');
  if (!input || !portal) return;
  const rect = input.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom;
  const openUp = spaceBelow < 200 && rect.top > 200;
  portal.style.left = `${rect.left}px`;
  portal.style.minWidth = `${Math.max(rect.width, 280)}px`;
  if (openUp) portal.style.top = `${rect.top - portal.offsetHeight - 2}px`;
  else portal.style.top = `${rect.bottom + 2}px`;
  portal.classList.add('open');
}
function comboRender(rowId) {
  const input  = document.getElementById(`combo-input-${rowId}`);
  const portal = document.getElementById('comboPortal');
  if (!input || !portal) return;
  const q = input.value.trim().toLowerCase();
  const matched = q
    ? productsForPicker.filter(p =>
        (p.product_code || '').toLowerCase().includes(q) ||
        (p.product_name || '').toLowerCase().includes(q))
    : productsForPicker;
  if (!matched.length) { portal.innerHTML = '<div class="combo-empty">— ไม่พบสินค้า —</div>'; return; }
  const rows = matched.slice(0, 80);
  portal.innerHTML = rows.map((p, i) => `
    <div class="combo-item${i === comboKbdIdx ? ' kbd-active' : ''}" data-id="${p.product_id}" data-idx="${i}">
      <span class="combo-name">${escapeHtml(p.product_name || '')}</span>
      ${stockBadgeHtml(p.product_id)}
    </div>`).join('');
  portal.querySelectorAll('.combo-item').forEach(item => {
    item.onmousedown = (e) => { e.preventDefault(); comboPick(rowId, +item.dataset.id); };
  });
}
function comboPick(rowId, productId) {
  const product = products.find(p => p.product_id == productId);
  if (!product) return;
  if (!productUnits[productId]?.length) {
    showToast(`สินค้า "${product.product_name}" ไม่มีหน่วยนับ — กรุณาตั้งหน่วยใน Master Product ก่อน`, 'error');
    return;
  }
  document.getElementById(`combo-input-${rowId}`).value = product.product_name || '';
  document.getElementById(`product-${rowId}`).value = productId;
  comboClose();
  updateRowThumb(rowId, productId);
  updateRowStockBadge(rowId);
  formDirty = true;
}
function comboKey(e, rowId) {
  const portal = document.getElementById('comboPortal');
  if (!portal?.classList.contains('open')) return;
  const items = portal.querySelectorAll('.combo-item');
  if (!items.length) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); comboKbdIdx = Math.min(comboKbdIdx + 1, items.length - 1); highlightKbd(items); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); comboKbdIdx = Math.max(comboKbdIdx - 1, 0); highlightKbd(items); }
  else if (e.key === 'Enter') { if (comboKbdIdx >= 0) { e.preventDefault(); comboPick(rowId, +items[comboKbdIdx].dataset.id); } }
  else if (e.key === 'Escape') { comboClose(); }
}
function highlightKbd(items) {
  items.forEach((it, i) => it.classList.toggle('kbd-active', i === comboKbdIdx));
  items[comboKbdIdx]?.scrollIntoView({ block: 'nearest' });
}
window.addEventListener('scroll', () => { if (activeComboRow !== null) comboPosition(activeComboRow); }, true);
window.addEventListener('resize', () => { if (activeComboRow !== null) comboPosition(activeComboRow); });

function updateRowThumb(rowId, productId) {
  const wrap = document.getElementById(`thumb-${rowId}`);
  if (!wrap) return;
  const realUrl = getProductImageUrl(productId);
  const url = realUrl || NO_IMAGE_URL;
  wrap.innerHTML = `<img src="${escapeAttr(url)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${NO_IMAGE_URL}'">`;
  if (realUrl) {
    wrap.classList.add('is-clickable');
    wrap.onclick = () => openProductImage(rowId);
    wrap.title = 'คลิกเพื่อดูภาพขยาย';
  } else {
    wrap.classList.remove('is-clickable');
    wrap.onclick = null;
    wrap.title = '';
  }
}
function getProductImageUrl(productId) {
  if (!productId) return '';
  const p = products.find(x => x.product_id == productId);
  if (!p) return '';
  const lookupId = p.parent_product_id || p.product_id;
  return productImageByPid[lookupId] || '';
}
function openProductImage(rowId) {
  const productId = document.getElementById(`product-${rowId}`)?.value;
  if (!productId) return;
  const url = getProductImageUrl(productId);
  if (!url) return;
  const product = products.find(p => p.product_id == productId);
  const title = product?.product_name || '';
  if (typeof ImgPopup !== 'undefined' && ImgPopup.open) ImgPopup.open([url], 0, { titles: [title] });
  else window.open(url, '_blank');
}
function updateRowStockBadge(rowId) {
  const badge = document.getElementById(`row-stock-${rowId}`);
  if (!badge) return;
  const pid = document.getElementById(`product-${rowId}`)?.value;
  badge.innerHTML = pid ? stockBadgeHtml(+pid) : '';
}
function updateAllRowStockBadges() {
  document.querySelectorAll('[id^="row-stock-"]').forEach(el => {
    const rowId = el.id.replace('row-stock-', '');
    updateRowStockBadge(rowId);
  });
}
function escapeAttr(s) { return String(s ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

function removeRow(rowId) {
  document.getElementById(`row-${rowId}`)?.remove();
  calcSummary();
  formDirty = true;
}

function calcSummary() {
  const rows = document.getElementById('itemsBody').querySelectorAll('tr');
  let totalQty = 0;
  let totalAmount = 0;
  rows.forEach(tr => {
    const rowId = tr.id.replace('row-', '');
    const qty   = parseFloat(document.getElementById(`qty-ord-${rowId}`)?.value || 0);
    const price = parseFloat(document.getElementById(`price-${rowId}`)?.value || 0);
    const line  = qty * price;
    totalQty    += qty;
    totalAmount += line;
    const cell = document.getElementById(`line-total-${rowId}`);
    if (cell) cell.textContent = '฿' + line.toLocaleString('th-TH', { minimumFractionDigits:2, maximumFractionDigits:2 });
  });
  document.getElementById('totalItemsDisplay').textContent = `${rows.length} รายการ`;
  document.getElementById('totalQtyDisplay').textContent   = `${totalQty.toLocaleString('th-TH')} ชิ้น`;
  document.getElementById('totalAmountDisplay').textContent = '฿' + totalAmount.toLocaleString('th-TH', { minimumFractionDigits:2, maximumFractionDigits:2 });
  document.getElementById('itemCount').textContent         = `${rows.length} รายการ`;
}

// ============================================================
// PO NUMBER (auto-increment)
// ============================================================
async function fetchNextPoNumber() {
  const prefix = getPoPrefix();
  try {
    const rows = await supabaseFetch('purchase_orders', {
      query: `?po_number=like.${encodeURIComponent(prefix + '%')}&select=po_number&order=po_number.desc&limit=1`
    });
    const last = rows?.[0]?.po_number;
    if (!last) return '001';
    const seq = parseInt(last.slice(prefix.length), 10) || 0;
    return String(seq + 1).padStart(3, '0');
  } catch (e) {
    console.warn('[fetchNextPoNumber]', e);
    return '001';
  }
}

async function refreshPoNumber() {
  const prefix = getPoPrefix();
  const next = await fetchNextPoNumber();
  document.getElementById('poNumber').value = next;
  document.getElementById('poNumberDisplay').textContent = prefix + next;
}

// ============================================================
// EDIT MODE — load existing PO into form
// ============================================================
async function loadPoForEdit(poId) {
  showLoading(true);
  try {
    const [poRows, itemRows] = await Promise.all([
      supabaseFetch('purchase_orders', { query: `?po_id=eq.${poId}&select=*` }),
      supabaseFetch('po_items', { query: `?po_id=eq.${poId}&select=*&order=po_item_id.asc` }),
    ]);
    const po = poRows?.[0];
    if (!po) { showToast('ไม่พบใบสั่งซื้อ #' + poId, 'error'); return; }
    editingPoRow = po;

    // status badge
    const badge = document.getElementById('statusBadge');
    if (badge) {
      const st = String(po.status || 'DRAFT').toUpperCase();
      const clsMap = {
        DRAFT:     'badge-draft',
        APPROVED:  'badge-approved',
        RECEIVED:  'badge-received',
        CANCELLED: 'badge-cancelled',
      };
      badge.textContent = '● ' + st;
      badge.className = 'po-status-badge ' + (clsMap[st] || 'badge-draft');
    }

    // PO number — split prefix + seq
    const fullNum = po.po_number || '';
    const dashIdx = fullNum.lastIndexOf('-');
    if (dashIdx > 0) {
      document.getElementById('poPrefix').textContent = fullNum.slice(0, dashIdx + 1);
      document.getElementById('poNumber').value       = fullNum.slice(dashIdx + 1);
    } else {
      document.getElementById('poNumber').value = fullNum;
    }
    document.getElementById('poNumberDisplay').textContent = fullNum;

    // dates
    if (po.order_date)    document.getElementById('orderDate').value    = po.order_date;
    if (po.expected_date) document.getElementById('expectedDate').value = po.expected_date;

    // supplier card
    if (po.supplier_id != null) {
      const card = document.querySelector(`.supplier-card[data-id="${po.supplier_id}"]`);
      if (card) selectSupplier(po.supplier_id, card);
    }

    // warehouse card
    if (po.warehouse_id != null) {
      const card = document.querySelector(`.warehouse-card[data-id="${po.warehouse_id}"]`);
      if (card) selectWarehouse(po.warehouse_id, card);
    }

    // items
    document.getElementById('itemsBody').innerHTML = '';
    rowCount = 0;
    (itemRows || []).forEach(it => {
      addItemRow();
      const rid = rowCount;
      const product = products.find(p => p.product_id == it.product_id);
      document.getElementById(`combo-input-${rid}`).value = product?.product_name || `#${it.product_id}`;
      document.getElementById(`product-${rid}`).value     = String(it.product_id);
      if (product) {
        updateRowThumb(rid, it.product_id);
        updateRowStockBadge(rid);
      }
      document.getElementById(`qty-ord-${rid}`).value = it.qty_ordered ?? '';
      document.getElementById(`price-${rid}`).value   = it.unit_price ?? '';
    });
    if (!itemRows?.length) addItemRow();
    calcSummary();
    showToast('โหลดใบสั่งซื้อเพื่อแก้ไข', 'success');
  } catch (e) {
    showToast('โหลดข้อมูลไม่สำเร็จ: ' + e.message, 'error');
  }
  showLoading(false);
}

// ============================================================
// COLLECT + SUBMIT
// ============================================================
function collectFormData(validate = true) {
  const poNumber  = getPoPrefix() + document.getElementById('poNumber').value.trim();
  const orderDate    = document.getElementById('orderDate').value;
  const expectedDate = document.getElementById('expectedDate').value || null;
  const supplierId   = document.getElementById('supplierId').value;
  const warehouseId  = document.getElementById('warehouseId').value;
  const createdBy    = window.ERP_USER?.user_id || '';

  if (validate) {
    if (!supplierId)   { showToast('กรุณาเลือก supplier', 'error'); return null; }
    if (!warehouseId)  { showToast('กรุณาเลือกคลังรับของ', 'error'); return null; }
    if (!orderDate)    { showToast('กรุณาระบุวันที่สั่งซื้อ', 'error'); return null; }
    if (!createdBy)    { showToast('ไม่พบข้อมูลผู้ใช้ที่ล็อกอิน', 'error'); return null; }
  }

  const items = [];
  let badRow = null;
  document.getElementById('itemsBody').querySelectorAll('tr').forEach((tr, idx) => {
    const rowId    = tr.id.replace('row-', '');
    const productId = tr.querySelector('.row-product-select')?.value;
    const qty      = document.getElementById(`qty-ord-${rowId}`)?.value;
    const price    = document.getElementById(`price-${rowId}`)?.value;
    const comboText = document.getElementById(`combo-input-${rowId}`)?.value?.trim();
    const unitId   = (productUnits[productId]?.[0]?.unit_id) || null;
    const qtyNum   = parseFloat(qty);
    const priceNum = parseFloat(price);
    if (!productId && !qty && !price && !comboText) return;
    if (validate && comboText && !productId) {
      badRow = badRow || { reason: `แถวที่ ${idx+1}: กรุณาเลือกสินค้าจากรายการ` };
      return;
    }
    if (validate && productId && (!qty || qtyNum <= 0)) {
      badRow = badRow || { reason: `แถวที่ ${idx+1}: กรุณากรอกจำนวนมากกว่า 0` };
      return;
    }
    if (validate && productId && (!price || priceNum < 0)) {
      badRow = badRow || { reason: `แถวที่ ${idx+1}: กรุณากรอกราคาต่อหน่วย` };
      return;
    }
    if (productId && qtyNum > 0) items.push({ productId, qty, price: priceNum, unitId });
  });

  if (validate && badRow)         { showToast(badRow.reason, 'error'); return null; }
  if (validate && !items.length)  { showToast('กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ', 'error'); return null; }

  const totalAmount = items.reduce((s, it) => s + (parseFloat(it.qty) * it.price), 0);
  return { poNumber, orderDate, expectedDate, supplierId, warehouseId, createdBy, totalAmount, items };
}

async function submitPO(autoApprove = false) {
  // Permission gate
  const hasPerm = (k) => (window.AuthZ?.hasPerm ? window.AuthZ.hasPerm(k) : true);
  const needPerm = editingPoId ? 'po_edit' : 'po_create';
  if (!hasPerm(needPerm)) { showToast(`ไม่มีสิทธิ์ "${editingPoId ? 'แก้ไข' : 'สร้าง'}" ใบสั่งซื้อ`, 'error'); return; }
  if (autoApprove && !hasPerm('po_approve')) { showToast('ไม่มีสิทธิ์ "อนุมัติ" ใบสั่งซื้อ', 'error'); return; }

  const data = collectFormData();
  if (!data) return;
  if (!SUPABASE_URL || !SUPABASE_KEY) { showToast('กรุณาเชื่อมต่อ Supabase ก่อน', 'warning'); return; }

  showLoading(true);
  try {
    let poId;
    const headerBody = {
      po_number:     data.poNumber,
      supplier_id:   parseInt(data.supplierId),
      warehouse_id:  parseInt(data.warehouseId),
      order_date:    data.orderDate,
      expected_date: data.expectedDate,
      total_amount:  data.totalAmount,
      created_by:    parseInt(data.createdBy),
      status:        autoApprove ? 'APPROVED' : 'DRAFT',
    };

    if (editingPoId) {
      await supabaseFetch('purchase_orders', {
        method: 'PATCH', query: `?po_id=eq.${editingPoId}`, body: headerBody,
      });
      poId = editingPoId;
      await supabaseFetch('po_items', { method: 'DELETE', query: `?po_id=eq.${editingPoId}` });
    } else {
      // POST + retry on UNIQUE conflict
      let result;
      try {
        result = await supabaseFetch('purchase_orders', { method: 'POST', body: headerBody });
      } catch (e) {
        if (/duplicate key|unique/i.test(e.message || '')) {
          const nextSeq = await fetchNextPoNumber();
          const newNumber = getPoPrefix() + nextSeq;
          headerBody.po_number = newNumber;
          data.poNumber = newNumber;
          document.getElementById('poNumber').value = nextSeq;
          showToast(`มี user อื่น claim เลขเดิมไป → เปลี่ยนเป็น ${newNumber}`, 'warning');
          result = await supabaseFetch('purchase_orders', { method: 'POST', body: headerBody });
        } else { throw e; }
      }
      poId = result[0].po_id;
    }

    // Insert items
    for (const item of data.items) {
      if (!item.unitId) throw new Error(`สินค้า ID ${item.productId} ไม่มีหน่วยนับ — กรุณาตั้งหน่วยใน Master Product ก่อน`);
      await supabaseFetch('po_items', {
        method: 'POST',
        body: {
          po_id:       poId,
          product_id:  parseInt(item.productId),
          unit_id:     parseInt(item.unitId),
          qty_ordered: parseFloat(item.qty),
          unit_price:  parseFloat(item.price),
        }
      });
    }

    // หมายเหตุ: PO อนุมัติแล้ว = รอ supplier ส่งของ ยังไม่ insert stock_movements
    // stock IN จะเกิดตอน "รับของ" (receivePO) ในหน้า list เท่านั้น

    const verb = editingPoId ? 'อัปเดต' : 'บันทึก';
    const msg = autoApprove
      ? `✅ ${verb} + อนุมัติ ${data.poNumber} สำเร็จ — รอรับของจาก supplier`
      : `💾 ${verb} Draft ${data.poNumber} สำเร็จ`;
    formDirty = false;
    showToast(msg, 'success');
    setTimeout(() => { window.location.href = './po-list.html'; }, 1200);
  } catch (e) {
    showToast('เกิดข้อผิดพลาด: ' + e.message, 'error');
  }
  showLoading(false);
}

// ============================================================
// PREVIEW / PRINT
// ============================================================
function previewPO() {
  const data = collectFormData(false);
  if (!data) return;
  const supplier = suppliers.find(s => String(s.supplier_id) === String(data.supplierId));
  const warehouse = warehouses.find(w => String(w.warehouse_id) === String(data.warehouseId));
  const fmtDate = (iso) => (window.DateFmt?.formatDMY?.(iso)) || iso || '—';
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  setText('docCompanyTh', COMPANY_PROFILE.nameTh);
  setText('docCompanyEn', COMPANY_PROFILE.nameEn);
  const logoEl = document.getElementById('docLogo');
  if (logoEl) {
    logoEl.src = COMPANY_PROFILE.logoUrl;
    logoEl.onerror = () => {
      logoEl.style.display = 'none';
      const parent = logoEl.parentElement;
      if (parent && !parent.querySelector('.logo-fallback')) {
        const fb = document.createElement('div');
        fb.className = 'logo-fallback';
        fb.textContent = 'A4S';
        fb.style.cssText = 'font-weight:800;font-size:18px;color:#3d6b4f;letter-spacing:1px;';
        parent.appendChild(fb);
      }
    };
  }

  setText('docNumber', data.poNumber);
  setText('docSupplier', supplier?.supplier_name || '—');
  setText('docWarehouse', warehouse?.warehouse_name || '—');
  setText('docOrderDate', fmtDate(data.orderDate));
  setText('docExpectedDate', fmtDate(data.expectedDate));

  const tbody = document.getElementById('docItemsBody');
  tbody.innerHTML = '';
  let totalAmt = 0;
  if (!data.items.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:#9aa5b1">— ไม่มีรายการ —</td></tr>';
  } else {
    data.items.forEach((item, idx) => {
      const product = products.find(p => String(p.product_id) === String(item.productId));
      const productLabel = product?.product_name || '—';
      const qty = parseFloat(item.qty) || 0;
      const price = parseFloat(item.price) || 0;
      const line = qty * price;
      totalAmt += line;
      const imgUrl = getProductImageUrl(item.productId) || NO_IMAGE_URL;
      tbody.insertAdjacentHTML('beforeend', `
        <tr>
          <td class="text-center">${idx + 1}</td>
          <td class="text-center"><div class="prod-thumb"><img src="${escapeAttr(imgUrl)}" alt="" onerror="this.onerror=null;this.src='${NO_IMAGE_URL}'"></div></td>
          <td>${escapeHtml(productLabel)}</td>
          <td class="text-right">${qty.toLocaleString('th-TH')}</td>
          <td class="text-right">฿${price.toLocaleString('th-TH', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
          <td class="text-right">฿${line.toLocaleString('th-TH', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
        </tr>`);
    });
  }
  setText('docTotalAmount', '฿' + totalAmt.toLocaleString('th-TH', {minimumFractionDigits:2, maximumFractionDigits:2}));
  setText('docPrintedAt',
    window.DateFmt?.formatDMYTime?.(new Date().toISOString()) || new Date().toLocaleString('th-TH'));

  document.getElementById('previewOverlay').classList.add('open');
}

function closePreview() {
  if (document.documentElement.classList.contains('headless')) { window.close(); return; }
  document.getElementById('previewOverlay').classList.remove('open');
}

function printPO() { window.print(); }

// ============================================================
// CANCEL / RESET
// ============================================================
async function cancelEdit() {
  if (!formDirty) { window.location.href = './po-list.html'; return; }
  const proceed = (typeof ConfirmModal !== 'undefined' && ConfirmModal.open)
    ? await ConfirmModal.open({
        title: 'ยกเลิกการแก้ไข',
        message: 'ทิ้งการเปลี่ยนแปลงทั้งหมดและกลับไปหน้ารายการ?',
        icon: '✕', okText: 'ยืนยัน', cancelText: 'อยู่ต่อ', tone: 'warning',
      })
    : window.confirm('ทิ้งการเปลี่ยนแปลงทั้งหมดและกลับไปหน้ารายการ?');
  if (proceed) window.location.href = './po-list.html';
}

function resetForm() {
  const prefix = getPoPrefix();
  document.getElementById('poPrefix').textContent = prefix;
  document.getElementById('poNumber').value = '001';
  document.getElementById('poNumberDisplay').textContent = prefix + '001';
  refreshPoNumber().catch(console.error);
  document.getElementById('orderDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('expectedDate').value = '';

  document.getElementById('supplierId').value = '';
  selectedSupplierId = null;
  document.querySelectorAll('.supplier-card').forEach(c => c.classList.remove('active'));

  document.getElementById('warehouseId').value = '';
  selectedWarehouseId = null;
  document.querySelectorAll('.warehouse-card').forEach(c => c.classList.remove('active'));
  const firstWh = document.querySelector('.warehouse-card');
  if (firstWh) selectWarehouse(+firstWh.dataset.id, firstWh);

  document.getElementById('itemsBody').innerHTML = '';
  rowCount = 0;
  calcSummary();
  addItemRow();
}

// ============================================================
// UTILS
// ============================================================
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove('show'), 3000);
}
function showLoading(show) { document.getElementById('loadingOverlay').classList.toggle('show', show); }

// Catch-all dirty flag
document.addEventListener('input', (e) => { if (e.target.closest('.section-card')) formDirty = true; });
document.addEventListener('change', (e) => { if (e.target.closest('.section-card')) formDirty = true; });

// Browser back / close guard
window.addEventListener('beforeunload', (e) => {
  if (document.documentElement.classList.contains('headless')) return;
  if (!formDirty) return;
  e.preventDefault();
  e.returnValue = '';
});

// ============================================================
// INIT
// ============================================================
window.addEventListener('DOMContentLoaded', async () => {
  SUPABASE_URL = localStorage.getItem('sb_url') || '';
  SUPABASE_KEY = localStorage.getItem('sb_key') || '';

  const prefix = getPoPrefix();
  document.getElementById('poPrefix').textContent = prefix;
  document.getElementById('poNumberDisplay').textContent = prefix + '001';
  document.getElementById('orderDate').value = new Date().toISOString().split('T')[0];

  const params  = new URLSearchParams(window.location.search);
  const editId  = parseInt(params.get('po_id'), 10);
  const autoPrint = params.get('print') === '1';
  const headless  = params.get('headless') === '1';
  editingPoId = Number.isFinite(editId) ? editId : null;

  if (!editingPoId) addItemRow();

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn('[PO] Supabase not configured');
    return;
  }

  try {
    await loadDropdowns();
    if (editingPoId) await loadPoForEdit(editingPoId);
    formDirty = false;
    if (autoPrint) {
      setTimeout(() => {
        previewPO();
        if (headless) {
          setTimeout(() => {
            window.addEventListener('afterprint', () => window.close(), { once: true });
            window.print();
          }, 300);
        }
      }, 200);
    }
  } catch (e) { console.error(e); }
});
