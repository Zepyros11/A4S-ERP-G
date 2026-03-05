// ============================================================
// STATE
// ============================================================
let SUPABASE_URL = localStorage.getItem('sb_url') || '';
let SUPABASE_KEY = localStorage.getItem('sb_key') || '';
let products = [], warehouses = [], stockBalance = [], stockMap = {};
let allMovements = [], filteredMovements = [];
let activeTypeFilter = 'ALL';
let selectedType = 'IN';
let displayLimit = 50;

const TC = {
  IN:       { label:'รับเข้า',   icon:'📥', badge:'badge-IN',       dot:'dot-IN',       border:'border-IN',       signClass:'qty-in',  sign:'+' },
  OUT:      { label:'จ่ายออก',   icon:'📤', badge:'badge-OUT',      dot:'dot-OUT',      border:'border-OUT',      signClass:'qty-out', sign:'-' },
  ADJUST:   { label:'ปรับยอด',   icon:'⚖️', badge:'badge-ADJUST',   dot:'dot-ADJUST',   border:'border-ADJUST',   signClass:'qty-adj', sign:'±' },
  INTERNAL: { label:'เบิก',      icon:'📋', badge:'badge-INTERNAL', dot:'dot-INTERNAL', border:'border-INTERNAL', signClass:'qty-out', sign:'-' },
  RETURN:   { label:'คืนสินค้า', icon:'↩',  badge:'badge-RETURN',   dot:'dot-RETURN',   border:'border-RETURN',   signClass:'qty-in',  sign:'+' },
};

// ============================================================
// SUPABASE
// ============================================================
async function sbFetch(table, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' }
  });
  if (!res.ok) throw new Error((await res.json()).message || 'Error');
  return res.json();
}

async function sbPost(table, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error((await res.json()).message || 'Error');
  return res.json();
}

// ============================================================
// LOAD
// ============================================================
async function loadAll() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  showLoading(true);
  try {
    const [prods, whs, sb] = await Promise.all([
      sbFetch('products', '?select=product_id,product_code,product_name&order=product_name'),
      sbFetch('warehouses', '?select=warehouse_id,warehouse_name&is_active=eq.true'),
      sbFetch('stock_balance', '?select=product_id,warehouse_id,qty_on_hand'),
    ]);
    products     = prods || [];
    warehouses   = whs   || [];
    stockBalance = sb    || [];
    stockMap = {};
    stockBalance.forEach(b => { stockMap[`${b.product_id}_${b.warehouse_id}`] = b.qty_on_hand || 0; });
    populateFilterDropdowns();
    populateModalDropdowns();
    await loadMovements();
  } catch(e) { showToast('โหลดไม่ได้: ' + e.message, 'error'); }
  showLoading(false);
}

async function loadMovements() {
  showLoading(true);
  try {
    const data = await sbFetch('stock_movements', '?select=*&order=moved_at.desc&limit=500');
    allMovements = data || [];
    applyFilters();
    updateStats();
  } catch(e) { showToast('โหลด movements ไม่ได้: ' + e.message, 'error'); }
  showLoading(false);
}

// ============================================================
// DROPDOWNS
// ============================================================
function populateFilterDropdowns() {
  const fp = document.getElementById('filterProduct');
  fp.innerHTML = '<option value="">ทุกสินค้า</option>';
  products.forEach(p => fp.insertAdjacentHTML('beforeend', `<option value="${p.product_id}">${p.product_code} — ${p.product_name}</option>`));

  const fw = document.getElementById('filterWarehouse');
  fw.innerHTML = '<option value="">ทุกคลัง</option>';
  warehouses.forEach(w => fw.insertAdjacentHTML('beforeend', `<option value="${w.warehouse_id}">${w.warehouse_name}</option>`));
}

function populateModalDropdowns() {
  const mp = document.getElementById('fProduct');
  mp.innerHTML = '<option value="">— เลือกสินค้า —</option>';
  products.forEach(p => mp.insertAdjacentHTML('beforeend', `<option value="${p.product_id}">${p.product_code} — ${p.product_name}</option>`));

  const mw = document.getElementById('fWarehouse');
  mw.innerHTML = '<option value="">— เลือกคลัง —</option>';
  warehouses.forEach(w => mw.insertAdjacentHTML('beforeend', `<option value="${w.warehouse_id}">${w.warehouse_name}</option>`));
}

// ============================================================
// FILTERS
// ============================================================
function setTypeFilter(type, el) {
  activeTypeFilter = type;
  document.querySelectorAll('.type-pill').forEach(p => p.className = 'type-pill');
  el.className = `type-pill active-${type}`;
  displayLimit = 50;
  applyFilters();
}

function applyFilters() {
  const search  = document.getElementById('searchInput').value.toLowerCase();
  const prodId  = document.getElementById('filterProduct').value;
  const whId    = document.getElementById('filterWarehouse').value;
  const dateFrom = document.getElementById('filterDateFrom').value;
  const dateTo   = document.getElementById('filterDateTo').value;

  filteredMovements = allMovements.filter(m => {
    const prod = products.find(p => p.product_id === m.product_id);
    const matchSearch = !search ||
      (prod?.product_name || '').toLowerCase().includes(search) ||
      (prod?.product_code || '').toLowerCase().includes(search) ||
      (m.ref_doc_id || '').toLowerCase().includes(search);
    const matchProd = !prodId || String(m.product_id) === prodId;
    const matchWh   = !whId  || String(m.warehouse_id) === whId;
    const d = m.moved_at?.substring(0, 10);
    const matchFrom = !dateFrom || d >= dateFrom;
    const matchTo   = !dateTo   || d <= dateTo;
    const matchType = activeTypeFilter === 'ALL' || m.movement_type === activeTypeFilter;
    return matchSearch && matchProd && matchWh && matchFrom && matchTo && matchType;
  });

  renderTimeline();
}

function resetFilters() {
  document.getElementById('searchInput').value = '';
  document.getElementById('filterProduct').value = '';
  document.getElementById('filterWarehouse').value = '';
  const now = new Date(), y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0');
  document.getElementById('filterDateFrom').value = `${y}-${m}-01`;
  document.getElementById('filterDateTo').value   = now.toISOString().substring(0, 10);
  activeTypeFilter = 'ALL';
  document.querySelectorAll('.type-pill').forEach(p => p.className = 'type-pill');
  document.querySelector('[data-type="ALL"]').className = 'type-pill active-all';
  displayLimit = 50;
  applyFilters();
}

// ============================================================
// TIMELINE RENDER
// ============================================================
function renderTimeline() {
  const container = document.getElementById('timelineContainer');
  const shown = filteredMovements.slice(0, displayLimit);
  const loadMoreWrap = document.getElementById('loadMoreWrap');
  loadMoreWrap.style.display = filteredMovements.length > displayLimit ? 'block' : 'none';

  if (!shown.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-text">ไม่พบรายการที่ตรงกับเงื่อนไข</div></div>`;
    return;
  }

  // Group by date
  const groups = {};
  shown.forEach(m => {
    const k = m.moved_at.substring(0, 10);
    if (!groups[k]) groups[k] = [];
    groups[k].push(m);
  });

  container.innerHTML = Object.entries(groups).map(([date, items]) => {
    const lbl = new Date(date + 'T00:00:00').toLocaleDateString('th-TH', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    return `<div class="date-group">
      <div class="date-label"><div class="date-dot"></div><span class="date-text">📅 ${lbl}</span></div>
      ${items.map(renderItem).join('')}
    </div>`;
  }).join('');
}

function renderItem(m) {
  const cfg  = TC[m.movement_type] || { label:m.movement_type, icon:'❓', badge:'badge-ADJUST', dot:'dot-ADJUST', border:'border-ADJUST', signClass:'qty-adj', sign:'' };
  const prod = products.find(p => p.product_id === m.product_id);
  const wh   = warehouses.find(w => w.warehouse_id === m.warehouse_id);
  const time = new Date(m.moved_at).toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit' });
  const qty  = Math.abs(m.qty);
  const bal  = m.qty_after != null ? `<div class="tl-balance">คงเหลือ: ${m.qty_after.toLocaleString()}</div>` : '';
  const refSpan = m.ref_doc_type ? `<span>📄 <span class="tl-ref">${m.ref_doc_type}${m.ref_doc_id ? ' #' + m.ref_doc_id : ''}</span></span>` : '';
  const noteSpan = m.note ? `<span>💬 ${m.note}</span>` : '';
  return `<div class="tl-item">
    <div class="tl-line-wrap"><div class="tl-dot ${cfg.dot}">${cfg.icon}</div></div>
    <div class="tl-card ${cfg.border}">
      <div class="tl-main">
        <span class="tl-type-badge ${cfg.badge}">${cfg.label}</span>
        <div class="tl-product">${prod?.product_name || 'Product #' + m.product_id}</div>
        <div class="tl-meta">
          <span>🏭 ${wh?.warehouse_name || '—'}</span>
          ${refSpan}
          ${noteSpan}
        </div>
      </div>
      <div class="tl-right">
        <div class="tl-qty ${cfg.signClass}">${cfg.sign}${qty.toLocaleString()}</div>
        ${bal}
        <div class="tl-time">${time}</div>
      </div>
    </div>
  </div>`;
}

function loadMore() { displayLimit += 50; renderTimeline(); }

function updateStats() {
  document.getElementById('statTotal').textContent = allMovements.length;
  document.getElementById('statIn').textContent    = allMovements.filter(m => m.movement_type === 'IN').length;
  document.getElementById('statOut').textContent   = allMovements.filter(m => m.movement_type === 'OUT').length;
  document.getElementById('statReq').textContent   = allMovements.filter(m => m.movement_type === 'INTERNAL').length;
  document.getElementById('statAdj').textContent   = allMovements.filter(m => m.movement_type === 'ADJUST').length;
}

// ============================================================
// MODAL
// ============================================================
function openModal() {
  selectedType = 'IN';
  document.querySelectorAll('.type-btn').forEach(b => b.className = 'type-btn');
  document.querySelector('[data-type="IN"]').classList.add('sel-IN');
  ['fProduct','fWarehouse','fRefType'].forEach(id => document.getElementById(id).value = '');
  ['fQty','fRefId','fNote'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('qtyHint').textContent = '';
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  document.getElementById('fMovedAt').value = now.toISOString().substring(0, 16);
  document.getElementById('modalOverlay').classList.add('open');
}

function closeModal() { document.getElementById('modalOverlay').classList.remove('open'); }
function closeModalOnBg(e) { if (e.target === document.getElementById('modalOverlay')) closeModal(); }

function setType(type, btn) {
  selectedType = type;
  document.querySelectorAll('.type-btn').forEach(b => b.className = 'type-btn');
  btn.classList.add(`sel-${type}`);
}

function onProductChange() { updateQtyHint(); }
function onWarehouseChange() { updateQtyHint(); }

function updateQtyHint() {
  const prodId = document.getElementById('fProduct').value;
  const whId   = document.getElementById('fWarehouse').value;
  if (prodId && whId) {
    const qty = stockMap[`${prodId}_${whId}`] || 0;
    document.getElementById('qtyHint').textContent = `คงเหลือปัจจุบัน: ${qty.toLocaleString()} ชิ้น`;
  } else {
    document.getElementById('qtyHint').textContent = '';
  }
}

async function saveMovement() {
  const prodId = document.getElementById('fProduct').value;
  const whId   = document.getElementById('fWarehouse').value;
  const qty    = parseFloat(document.getElementById('fQty').value);
  const movedAt = document.getElementById('fMovedAt').value;
  if (!prodId)         { showToast('กรุณาเลือกสินค้า', 'error');  return; }
  if (!whId)           { showToast('กรุณาเลือกคลัง', 'error');    return; }
  if (!qty || qty <= 0){ showToast('กรุณากรอกจำนวน', 'error');    return; }
  const payload = {
    product_id:    parseInt(prodId),
    warehouse_id:  parseInt(whId),
    movement_type: selectedType,
    qty,
    moved_at:      movedAt ? new Date(movedAt).toISOString() : new Date().toISOString(),
    ref_doc_type:  document.getElementById('fRefType').value || null,
    ref_doc_id:    document.getElementById('fRefId').value.trim() || null,
    note:          document.getElementById('fNote').value.trim() || null,
  };
  showLoading(true);
  try {
    await sbPost('stock_movements', payload);
    showToast('✅ บันทึกรายการสำเร็จ!', 'success');
    closeModal();
    await loadMovements();
  } catch(e) { showToast('บันทึกไม่ได้: ' + e.message, 'error'); }
  showLoading(false);
}

// ============================================================
// EXPORT CSV
// ============================================================
function exportCSV() {
  if (!filteredMovements.length) { showToast('ไม่มีข้อมูล', 'warning'); return; }
  const headers = ['วันที่','เวลา','ประเภท','รหัสสินค้า','ชื่อสินค้า','คลัง','จำนวน','คงเหลือ','เอกสาร','หมายเหตุ'];
  const rows = filteredMovements.map(m => {
    const prod = products.find(p => p.product_id === m.product_id);
    const wh   = warehouses.find(w => w.warehouse_id === m.warehouse_id);
    const dt   = new Date(m.moved_at);
    const cfg  = TC[m.movement_type];
    return [
      dt.toLocaleDateString('th-TH'),
      dt.toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit' }),
      cfg?.label || m.movement_type,
      prod?.product_code || '',
      prod?.product_name || '',
      wh?.warehouse_name || '',
      (cfg?.sign || '') + Math.abs(m.qty),
      m.qty_after ?? '',
      m.ref_doc_type ? `${m.ref_doc_type} ${m.ref_doc_id || ''}`.trim() : '',
      m.note || ''
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });
  const csv = '\uFEFF' + [headers.join(','), ...rows].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  a.download = `stock_movements_${new Date().toISOString().substring(0, 10)}.csv`;
  a.click();
  showToast(`✅ Export ${filteredMovements.length} รายการ`, 'success');
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

window.addEventListener('DOMContentLoaded', () => {
  const now = new Date(), y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0');
  document.getElementById('filterDateFrom').value = `${y}-${m}-01`;
  document.getElementById('filterDateTo').value   = now.toISOString().substring(0, 10);
  SUPABASE_URL = localStorage.getItem('sb_url') || '';
  SUPABASE_KEY = localStorage.getItem('sb_key') || '';
  if (SUPABASE_URL && SUPABASE_KEY) setTimeout(() => loadAll(), 50);
});