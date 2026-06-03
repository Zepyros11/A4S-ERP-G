// ============================================================
// STATE
// ============================================================
let SUPABASE_URL      = localStorage.getItem('sb_url') || '';
let SUPABASE_KEY      = localStorage.getItem('sb_key') || '';
let products          = [];     // full list (สำหรับ lookup ตาม id)
let productsForPicker = [];     // filtered: variants + standalones (ตัด parent ที่มี variants)
let productImageByPid = {};     // pid → primary image url (variant ใช้ของ parent)
let productUnits      = {};
let stockByWhPid      = {};     // { warehouseId: { product_id: qty } } — on-hand แยกตามคลัง
let userWarehouseIds  = [];     // คลังของ country ที่ user สังกัด
let warehouses        = [];     // full list (สำหรับ renderWarehouseCards)
let rowCount          = 0;
let selectedPurposeId = null;
let purposesCache     = [];      // [{purpose_id, purpose_code, purpose_name, purpose_type, icon}] — สำหรับ manager modal
let selectedWarehouseId = null;
let editingReqId      = null;    // ถ้ามีค่า = edit mode (PATCH); null = create mode (POST)
let editingReqRow     = null;    // เก็บ row เดิม (เผื่อเปรียบเทียบ status approved)
let formDirty         = false;   // true เมื่อ user แก้ field ใด ๆ — ใช้ตอน cancelEdit

// signed qty (เหมือน stock-balance.js)
function reqSignedQty(m) {
  const q = +m.qty || 0;
  return (m.movement_type === 'OUT' || m.movement_type === 'INTERNAL') ? -q : q;
}

function getReqPrefix(d = new Date()) {
  const y  = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `REQ-${y}-${mm}-`;
}

const NO_IMAGE_URL = '../../../assets/images/NoImage.png';

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
// WAREHOUSE CARDS (filter by user country)
// ============================================================
async function loadAndRenderWarehouses() {
  const userId = window.ERP_USER?.user_id;
  let country = '';
  if (userId) {
    try {
      const rows = await supabaseFetch('users', {
        query: `?user_id=eq.${encodeURIComponent(userId)}&select=country`
      });
      country = (rows?.[0]?.country || '').trim().toUpperCase();
    } catch (e) { console.warn('[warehouse-cards] fetch user.country failed:', e); }
  }
  const list = country
    ? warehouses.filter(w => (w.country || '').toUpperCase() === country)
    : warehouses;   // fallback: ทุกคลัง
  if (!country) console.warn('[warehouse-cards] user.country ว่าง — แสดงทุกคลัง');
  renderWarehouseCards(list);
}

// เรียง parent → children (DFS) เพื่อให้ parent แสดงก่อน children ของมัน
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
  walk(null, 0);   // root = no parent (or parent not in current list)
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
    card.innerHTML  = `
      <span class="wh-icon">${icon}</span>
      <span class="wh-label">${escapeHtml(w.warehouse_name || '')}</span>`;
    card.onclick = () => selectWarehouse(w.warehouse_id, card);
    grid.appendChild(card);
  });
  // auto-select คลังแรกถ้ายังไม่ได้เลือก
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
  // re-render combo ที่เปิดอยู่เพื่อให้ badge อัปเดตตามคลังใหม่
  if (activeComboRow != null) comboRender(activeComboRow);
  // อัปเดต badge ใน items rows ที่มีสินค้าเลือกไว้แล้ว
  updateAllRowStockBadges();
  if (isUserAction) formDirty = true;
}

// ============================================================
// LOAD DROPDOWNS
// ============================================================
async function loadDropdowns() {
  const [depts, prods, units, purposes, images, whs] = await Promise.all([
    supabaseFetch('departments',          { query: '?select=dept_id,dept_code,dept_name&order=sort_order,dept_code' }),
    supabaseFetch('products',             { query: '?select=product_id,product_code,product_name,parent_product_id&is_active=eq.true&order=product_id.asc' }),
    supabaseFetch('product_units',        { query: '?select=unit_id,product_id,unit_name' }),
    supabaseFetch('requisition_purposes', { query: '?select=purpose_id,purpose_code,purpose_name,purpose_type&is_active=eq.true' }),
    supabaseFetch('product_images',       { query: '?select=product_id,url,sort_order&order=sort_order.asc' }),
    supabaseFetch('warehouses',           { query: '?select=warehouse_id,warehouse_name,country,parent_id&is_active=eq.true&order=country,warehouse_name' }),
  ]);

  // Departments — ใส่ data-dept-code เพื่อให้ autoFillUserDept match ได้
  console.log('[loadDropdowns] departments:', depts);
  const selDept = document.getElementById('deptId');
  selDept.innerHTML = '<option value="">— เลือกแผนก —</option>';
  depts?.forEach(d => selDept.insertAdjacentHTML('beforeend',
    `<option value="${d.dept_id}" data-dept-code="${d.dept_code || ''}">${d.dept_name}</option>`));
  await autoFillUserDept();

  // Warehouses — เก็บ list ไว้แล้ว render เป็น cards (filter ตาม user.country)
  warehouses = whs || [];
  await loadAndRenderWarehouses();

  // Products & Units
  products = prods || [];
  // SKU = leaf (มี parent) หรือ standalone (ไม่มี parent + ไม่มี child) — pattern เดียวกับ stock-balance
  const parentIdsWithKids = new Set(
    products.filter(p => p.parent_product_id).map(c => c.parent_product_id)
  );
  productsForPicker = products.filter(p =>
    p.parent_product_id || !parentIdsWithKids.has(p.product_id)
  );

  productUnits = {};
  units?.forEach(u => {
    if (!productUnits[u.product_id]) productUnits[u.product_id] = [];
    productUnits[u.product_id].push(u);
  });

  // Image map — sort_order ASC อยู่แล้ว เก็บแค่รูปแรกของแต่ละ product
  productImageByPid = {};
  (images || []).forEach(im => {
    if (!productImageByPid[im.product_id]) productImageByPid[im.product_id] = im.url;
  });

  // Purpose cards — DB only (auto-seed ถ้าตารางว่างเพื่อให้ FK ถูกต้อง)
  let purposeRows = purposes || [];
  if (!purposeRows.length) {
    try {
      const seedBody = DEFAULT_PURPOSES.map(p => ({
        purpose_code: p.purpose_code,
        purpose_name: p.purpose_name,
        purpose_type: p.purpose_type,
        is_active:    true,
      }));
      const inserted = await supabaseFetch('requisition_purposes', {
        method: 'POST',
        body:   seedBody,
      });
      purposeRows = inserted || [];
      console.log('[seed purposes] inserted', purposeRows.length, 'rows');
    } catch (e) {
      console.warn('[seed purposes] failed:', e);
      showToast('ไม่พบประเภทการเบิกใน DB และ seed ไม่สำเร็จ', 'error');
    }
  }
  const purposeData = purposeRows.map(p => ({ ...p, icon: PURPOSE_ICONS[p.purpose_type] || '📌' }));
  purposesCache = purposeData;
  renderPurposeCards(purposeData);

  // (combo อ่านจาก global products array ตรงๆ — ไม่ต้อง re-populate per row)

  // Update REQ prefix with current year/month + เลขถัดไปจาก DB
  const prefix = getReqPrefix();
  document.getElementById('reqPrefix').textContent       = prefix;
  await refreshReqNumber();

  // โหลด stock per product สำหรับคลังที่ user สังกัด (background, ไม่ block UI)
  loadUserWarehouseStock().catch(err => console.warn('[loadUserWarehouseStock]', err));

  showToast('✅ โหลดข้อมูลสำเร็จ', 'success');
}

// ============================================================
// USER WAREHOUSE STOCK
//   users.country → warehouses ใน country นั้น → stock_movements → on-hand
//   ใช้ pattern เดียวกับ stock-balance.js (signed sum)
// ============================================================
async function loadUserWarehouseStock() {
  const userId = window.ERP_USER?.user_id;
  if (!userId) return;

  // 1) อ่าน country ของ user
  const userRows = await supabaseFetch('users', {
    query: `?user_id=eq.${encodeURIComponent(userId)}&select=country`
  });
  const country = (userRows?.[0]?.country || '').trim();
  if (!country) {
    console.warn('[stock-badge] user.country ว่าง — ไม่แสดง stock badge');
    return;
  }

  // 2) warehouses ของ country นี้ (active)
  const whs = await supabaseFetch('warehouses', {
    query: `?country=eq.${encodeURIComponent(country)}&is_active=eq.true&select=warehouse_id`
  });
  userWarehouseIds = (whs || []).map(w => w.warehouse_id);
  if (!userWarehouseIds.length) {
    console.warn('[stock-badge] ไม่พบ warehouses ของ country', country);
    return;
  }

  // 3) stock_movements ของ warehouses เหล่านี้
  const inList = userWarehouseIds.join(',');
  const moves = await supabaseFetch('stock_movements', {
    query: `?warehouse_id=in.(${inList})&select=product_id,warehouse_id,movement_type,qty`
  });

  // 4) bucket per warehouse + product
  stockByWhPid = {};
  (moves || []).forEach(m => {
    if (m.product_id == null || m.warehouse_id == null) return;
    const bucket = (stockByWhPid[m.warehouse_id] ||= {});
    bucket[m.product_id] = (bucket[m.product_id] || 0) + reqSignedQty(m);
  });

  // 5) re-render combo dropdown ที่เปิดอยู่ + badge ใน rows
  if (activeComboRow != null) comboRender(activeComboRow);
  updateAllRowStockBadges();
}

// Pre-check stock ก่อน auto-approve — return รายการที่ขาด
async function preCheckStock(data) {
  const whId = parseInt(data.warehouseId);
  if (!whId || !data.items?.length) return [];
  // รวม qty ของ product เดียวกัน (เผื่อมีหลาย row)
  const reqByPid = new Map();
  data.items.forEach(it => {
    const pid = parseInt(it.productId);
    reqByPid.set(pid, (reqByPid.get(pid) || 0) + parseFloat(it.qty));
  });
  const pids = [...reqByPid.keys()];
  if (!pids.length) return [];
  // fetch movements
  const moves = await supabaseFetch('stock_movements', {
    query: `?warehouse_id=eq.${whId}&product_id=in.(${pids.join(',')})&select=product_id,movement_type,qty`
  });
  const onHand = new Map();
  (moves || []).forEach(m => {
    const sign = (m.movement_type === 'OUT' || m.movement_type === 'INTERNAL') ? -1 : 1;
    onHand.set(m.product_id, (onHand.get(m.product_id) || 0) + sign * (parseFloat(m.qty) || 0));
  });
  const shortages = [];
  for (const [pid, requested] of reqByPid) {
    const available = onHand.get(pid) || 0;
    if (requested > available) {
      const p = products.find(x => x.product_id == pid);
      shortages.push({
        product_id: pid,
        name: p?.product_name || `Product #${pid}`,
        requested,
        available,
        short: requested - available,
      });
    }
  }
  return shortages;
}

// helper: format stock qty + class (อ่านจากคลังที่เลือก)
function stockBadgeHtml(productId) {
  if (!selectedWarehouseId) return '';
  const bucket = stockByWhPid[selectedWarehouseId];
  if (!bucket) return '';   // stock ยังโหลดไม่เสร็จ หรือคลังนี้ไม่มี movement
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
// PURPOSE CARDS
// ============================================================
function renderPurposeCards(purposes) {
  const grid = document.getElementById('purposeGrid');
  grid.innerHTML = '';
  // reset selection ถ้า id เดิมไม่อยู่ใน list ใหม่ (กัน stale ID จาก fallback)
  const validIds = new Set(purposes.map(p => p.purpose_id));
  if (selectedPurposeId != null && !validIds.has(selectedPurposeId)) selectedPurposeId = null;
  purposes.forEach(p => {
    const card = document.createElement('div');
    card.className   = 'purpose-card';
    card.dataset.id  = p.purpose_id;
    if (p.purpose_id === selectedPurposeId) card.classList.add('active');
    card.innerHTML   = `
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
  formDirty = true;
}

// ============================================================
// PURPOSE MANAGER (in-context CRUD — ⚙️ จัดการ)
// auto-gen purpose_code · soft-delete (is_active=false กัน FK กับ requisitions เดิม)
// ============================================================
function openPurposeManager() {
  renderPurposeMgrList();
  document.getElementById('purposeMgrOverlay').classList.add('open');
  document.getElementById('ppNewName').focus();
}
function closePurposeManager() {
  document.getElementById('purposeMgrOverlay').classList.remove('open');
}
function closePurposeManagerBg(e) {
  if (e.target === document.getElementById('purposeMgrOverlay')) closePurposeManager();
}

// auto-gen purpose_code: P001, P002, ... — ไม่ชนของเดิม (รวม seed MKT/PROMO/…)
function generatePurposeCode() {
  let max = 0;
  for (const p of purposesCache) {
    const m = /^P(\d+)$/.exec(p.purpose_code || '');
    if (m) max = Math.max(max, parseInt(m[1], 10) || 0);
  }
  return 'P' + String(max + 1).padStart(3, '0');
}

function renderPurposeMgrList() {
  const list = document.getElementById('ppList');
  if (!list) return;
  if (!purposesCache.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">🎯</div><div>ยังไม่มีวัตถุประสงค์</div></div>`;
    return;
  }
  list.innerHTML = purposesCache.map(p => `
    <div class="pp-row" data-id="${p.purpose_id}">
      <input class="form-control" data-edit="${p.purpose_id}" value="${escapeHtml(p.purpose_name || '')}" />
      <div class="pp-row-actions">
        <button class="btn-icon" title="บันทึกชื่อ" onclick="savePurposeName(${p.purpose_id})">💾</button>
        <button class="btn-icon danger" title="ลบ" onclick="deletePurpose(${p.purpose_id})">🗑</button>
      </div>
    </div>`).join('');
}

async function addPurpose() {
  const nameEl = document.getElementById('ppNewName');
  const purpose_name = nameEl.value.trim();
  if (!purpose_name) { showToast('กรุณากรอกชื่อวัตถุประสงค์', 'error'); return; }
  if (purposesCache.some(p => (p.purpose_name || '').toLowerCase() === purpose_name.toLowerCase())) {
    showToast(`วัตถุประสงค์ "${purpose_name}" มีอยู่แล้ว`, 'error'); return;
  }
  const purpose_code = generatePurposeCode();
  try {
    const created = await supabaseFetch('requisition_purposes', {
      method: 'POST',
      body: { purpose_code, purpose_name, purpose_type: 'OTHER', is_active: true },
    });
    const row = (Array.isArray(created) && created[0])
      ? created[0]
      : { purpose_id: null, purpose_code, purpose_name, purpose_type: 'OTHER' };
    purposesCache.push({ ...row, icon: PURPOSE_ICONS[row.purpose_type] || '📌' });
    nameEl.value = '';
    nameEl.focus();
    renderPurposeMgrList();
    renderPurposeCards(purposesCache);
    showToast('✅ เพิ่มวัตถุประสงค์แล้ว', 'success');
  } catch (e) {
    showToast('เพิ่มไม่ได้: ' + e.message, 'error');
  }
}

async function savePurposeName(id) {
  const input = document.querySelector(`#ppList input[data-edit="${id}"]`);
  if (!input) return;
  const purpose_name = input.value.trim();
  if (!purpose_name) { showToast('ชื่อวัตถุประสงค์ห้ามว่าง', 'error'); return; }
  try {
    await supabaseFetch('requisition_purposes', {
      method: 'PATCH',
      query: `?purpose_id=eq.${id}`,
      body: { purpose_name },
    });
    const p = purposesCache.find(x => x.purpose_id === id);
    if (p) p.purpose_name = purpose_name;
    renderPurposeCards(purposesCache);
    showToast('✅ บันทึกชื่อแล้ว', 'success');
  } catch (e) {
    showToast('บันทึกไม่ได้: ' + e.message, 'error');
  }
}

async function deletePurpose(id) {
  const p = purposesCache.find(x => x.purpose_id === id);
  if (!p) return;
  const ok = await ConfirmModal.open({
    title: 'ลบวัตถุประสงค์',
    message: `ลบ "${p.purpose_name}" ออกจากรายการหรือไม่?`,
    icon: '🗑',
    okText: 'ลบ',
    tone: 'danger',
    note: 'ใบเบิกเดิมที่อ้างอิงวัตถุประสงค์นี้จะยังคงอยู่ (เก็บประวัติไว้)',
  });
  if (!ok) return;
  try {
    // soft-delete — กัน FK violation กับ requisitions ที่อ้าง purpose_id นี้อยู่
    await supabaseFetch('requisition_purposes', {
      method: 'PATCH',
      query: `?purpose_id=eq.${id}`,
      body: { is_active: false },
    });
    purposesCache = purposesCache.filter(x => x.purpose_id !== id);
    if (selectedPurposeId === id) selectedPurposeId = null;
    renderPurposeMgrList();
    renderPurposeCards(purposesCache);
    showToast('ลบวัตถุประสงค์แล้ว', 'success');
  } catch (e) {
    showToast('ลบไม่ได้: ' + e.message, 'error');
  }
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
      <input type="number" class="td-input text-right" id="qty-req-${rowCount}"
        placeholder="0" min="0" step="0.01"
        oninput="calcSummary()">
    </td>
    <td class="text-center">
      <span class="hand-write-line" title="ช่องว่างสำหรับเขียนมือบนใบที่พิมพ์ออก"></span>
    </td>
    <td>
      <input type="text" class="td-input" id="note-${rowCount}" placeholder="หมายเหตุ...">
    </td>
    <td><button class="btn-remove" onclick="removeRow(${rowCount})">✕</button></td>`;
  tbody.appendChild(tr);

  calcSummary();
  document.getElementById(`combo-input-${rowCount}`).focus();
  formDirty = true;   // safe: init/load reset formDirty=false หลังเรียบร้อย
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
  // เริ่มพิมพ์ใหม่ → invalidate การเลือกเดิม (clear product id + thumb + stock badge)
  document.getElementById(`product-${rowId}`).value = '';
  const badge = document.getElementById(`row-stock-${rowId}`);
  if (badge) badge.innerHTML = '';
  // reset thumb เป็น placeholder
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
  // delay ให้ click event บน item ทำงานก่อน
  setTimeout(() => {
    if (activeComboRow === rowId) comboClose();
  }, 150);
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
  // เปิดด้านล่างถ้ามีที่ว่าง > 200px ไม่งั้นเปิดด้านบน
  const spaceBelow = window.innerHeight - rect.bottom;
  const openUp = spaceBelow < 200 && rect.top > 200;
  portal.style.left = `${rect.left}px`;
  portal.style.minWidth = `${Math.max(rect.width, 280)}px`;
  if (openUp) {
    portal.style.top = `${rect.top - portal.offsetHeight - 2}px`;
  } else {
    portal.style.top = `${rect.bottom + 2}px`;
  }
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

  if (!matched.length) {
    portal.innerHTML = '<div class="combo-empty">— ไม่พบสินค้า —</div>';
    return;
  }
  const rows = matched.slice(0, 80);
  portal.innerHTML = rows.map((p, i) => `
    <div class="combo-item${i === comboKbdIdx ? ' kbd-active' : ''}" data-id="${p.product_id}" data-idx="${i}">
      <span class="combo-name">${escapeHtml(p.product_name || '')}</span>
      ${stockBadgeHtml(p.product_id)}
    </div>`).join('');
  portal.querySelectorAll('.combo-item').forEach(item => {
    item.onmousedown = (e) => {
      e.preventDefault();   // กัน blur input ก่อน click ติด
      comboPick(rowId, +item.dataset.id);
    };
  });
}

// หน่วยนับเก็บที่ parent — variant (S/M/L) ใช้ร่วมกับ parent → fallback ไป parent
function unitsForProduct(productId) {
  const own = productUnits[productId];
  if (own?.length) return own;
  const p = products.find(x => x.product_id == productId);
  const parentId = p?.parent_product_id;
  if (parentId && productUnits[parentId]?.length) return productUnits[parentId];
  return own || [];
}

function comboPick(rowId, productId) {
  const product = products.find(p => p.product_id == productId);
  if (!product) return;
  // เช็คว่า product มีหน่วยนับใน DB ไหม — กันไม่ให้ user เลือก แล้วเจอ error ตอน save
  if (!unitsForProduct(productId).length) {
    showToast(`สินค้า "${product.product_name}" ไม่มีหน่วยนับ — กรุณาตั้งหน่วยใน Master Product ก่อน`, 'error');
    return;
  }
  const label = product.product_name || '';
  document.getElementById(`combo-input-${rowId}`).value = label;
  const hidden = document.getElementById(`product-${rowId}`);
  hidden.value = productId;
  comboClose();
  updateRowThumb(rowId, productId);
  updateRowStockBadge(rowId);
  onProductChange(hidden, rowId);
  formDirty = true;
}

// แสดง stock badge ใน row หลังจากเลือกสินค้าแล้ว — อัปเดตเมื่อเปลี่ยนคลังด้วย
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

// ดึง URL รูปสินค้า — variant ใช้ของ parent
function getProductImageUrl(productId) {
  if (!productId) return '';
  const p = products.find(x => x.product_id == productId);
  if (!p) return '';
  const lookupId = p.parent_product_id || p.product_id;
  return productImageByPid[lookupId] || '';
}

function updateRowThumb(rowId, productId) {
  const wrap = document.getElementById(`thumb-${rowId}`);
  if (!wrap) return;
  const realUrl = getProductImageUrl(productId);
  const url = realUrl || NO_IMAGE_URL;
  wrap.innerHTML = `<img src="${escapeAttr(url)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='${NO_IMAGE_URL}'">`;
  // เปิดดูภาพขยายได้เฉพาะเมื่อมีรูปจริง (ไม่ใช่ NoImage placeholder)
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

function openProductImage(rowId) {
  const productId = document.getElementById(`product-${rowId}`)?.value;
  if (!productId) return;
  const url = getProductImageUrl(productId);
  if (!url) return;
  const product = products.find(p => p.product_id == productId);
  const title = product?.product_name || '';
  if (typeof ImgPopup !== 'undefined' && ImgPopup.open) {
    ImgPopup.open([url], 0, { titles: [title] });
  } else {
    window.open(url, '_blank');   // fallback ถ้า ImgPopup โหลดไม่สำเร็จ
  }
}

function escapeAttr(s) {
  return String(s ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function comboKey(e, rowId) {
  const portal = document.getElementById('comboPortal');
  if (!portal?.classList.contains('open')) return;
  const items = portal.querySelectorAll('.combo-item');
  if (!items.length) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    comboKbdIdx = Math.min(comboKbdIdx + 1, items.length - 1);
    highlightKbd(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    comboKbdIdx = Math.max(comboKbdIdx - 1, 0);
    highlightKbd(items);
  } else if (e.key === 'Enter') {
    if (comboKbdIdx >= 0) {
      e.preventDefault();
      comboPick(rowId, +items[comboKbdIdx].dataset.id);
    }
  } else if (e.key === 'Escape') {
    comboClose();
  }
}

function highlightKbd(items) {
  items.forEach((it, i) => it.classList.toggle('kbd-active', i === comboKbdIdx));
  items[comboKbdIdx]?.scrollIntoView({ block: 'nearest' });
}

// reposition on scroll/resize ขณะ portal เปิดอยู่
window.addEventListener('scroll', () => {
  if (activeComboRow !== null) comboPosition(activeComboRow);
}, true);
window.addEventListener('resize', () => {
  if (activeComboRow !== null) comboPosition(activeComboRow);
});

function onProductChange(sel, rowId) {
  // หน่วยถูกถอดออกจากฟอร์มแล้ว — เก็บ hook ไว้เผื่อใช้ในอนาคต (เช่น auto-update qty default)
}

// กด ✓ → เติม qty_actual = qty_requested (= "จ่ายเต็ม")
function fillFullQty(rowId) {
  const qtyReq = document.getElementById(`qty-req-${rowId}`)?.value;
  const input  = document.getElementById(`qty-actual-${rowId}`);
  if (!input) return;
  if (qtyReq && parseFloat(qtyReq) > 0) {
    input.value = qtyReq;
  } else {
    input.value = '';
  }
  checkFullStatus(rowId);
}

// อัพเดทสีปุ่ม: เขียวเข้มเมื่อ qty_actual === qty_requested (= จ่ายเต็ม)
function checkFullStatus(rowId) {
  const btn    = document.getElementById(`fill-btn-${rowId}`);
  const qtyReq = parseFloat(document.getElementById(`qty-req-${rowId}`)?.value) || 0;
  const qtyAct = parseFloat(document.getElementById(`qty-actual-${rowId}`)?.value) || 0;
  if (btn) btn.classList.toggle('is-full', qtyReq > 0 && qtyAct === qtyReq);
}

function removeRow(rowId) {
  document.getElementById(`row-${rowId}`)?.remove();
  calcSummary();
  formDirty = true;
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
// EDIT MODE — load existing requisition into form
// ============================================================
async function loadRequisitionForEdit(reqId) {
  showLoading(true);
  try {
    const [reqRows, itemRows] = await Promise.all([
      supabaseFetch('requisitions', { query: `?req_id=eq.${reqId}&select=*` }),
      supabaseFetch('requisition_items', { query: `?req_id=eq.${reqId}&select=*&order=req_item_id.asc` }),
    ]);
    const req = reqRows?.[0];
    if (!req) { showToast('ไม่พบใบเบิก #' + reqId, 'error'); return; }
    editingReqRow = req;

    // Update page hero — แสดง status เดิม + req_number ที่กำลังแก้
    const badge = document.getElementById('statusBadge');
    if (badge) {
      const st = String(req.status || 'DRAFT').toUpperCase();
      const clsMap = {
        DRAFT:     'badge-draft',
        PENDING:   'badge-pending',
        APPROVED:  'badge-approved',
        ISSUED:    'badge-issued',
        CANCELLED: 'badge-cancelled',
      };
      badge.textContent = '● ' + st;
      badge.className = 'req-status-badge ' + (clsMap[st] || 'badge-draft');
    }
    // เลขที่ REQ — split prefix + sequence
    const fullNum = req.req_number || '';
    const dashIdx = fullNum.lastIndexOf('-');
    if (dashIdx > 0) {
      document.getElementById('reqPrefix').textContent = fullNum.slice(0, dashIdx + 1);
      document.getElementById('reqNumber').value       = fullNum.slice(dashIdx + 1);
    } else {
      document.getElementById('reqNumber').value = fullNum;
    }
    document.getElementById('reqNumberDisplay').textContent = fullNum;

    // Date / dept / note
    if (req.req_date) document.getElementById('reqDate').value = req.req_date;
    if (req.dept_id != null) document.getElementById('deptId').value = String(req.dept_id);
    document.getElementById('note').value = req.note || '';

    // Purpose — click matching card
    if (req.purpose_id != null) {
      const card = document.querySelector(`.purpose-card[data-id="${req.purpose_id}"]`);
      if (card) selectPurpose(req.purpose_id, card);
    }

    // Warehouse — click matching card
    if (req.warehouse_id != null) {
      const card = document.querySelector(`.warehouse-card[data-id="${req.warehouse_id}"]`);
      if (card) selectWarehouse(req.warehouse_id, card);
    }

    // Items — clear existing empty row, then add one row per saved item
    document.getElementById('itemsBody').innerHTML = '';
    rowCount = 0;
    (itemRows || []).forEach(it => {
      addItemRow();
      const rid = rowCount;
      // populate product — แม้ product ไม่อยู่ใน list ที่ active แล้ว ก็ยังต้องคงค่าไว้
      const product = products.find(p => p.product_id == it.product_id);
      document.getElementById(`combo-input-${rid}`).value = product?.product_name || `#${it.product_id}`;
      document.getElementById(`product-${rid}`).value     = String(it.product_id);
      if (product) {
        updateRowThumb(rid, it.product_id);
        updateRowStockBadge(rid);
      }
      document.getElementById(`qty-req-${rid}`).value = it.qty_requested ?? '';
      document.getElementById(`note-${rid}`).value    = it.note || '';
    });
    if (!itemRows?.length) addItemRow();
    calcSummary();
    showToast('โหลดใบเบิกเพื่อแก้ไข', 'success');
  } catch (e) {
    showToast('โหลดข้อมูลไม่สำเร็จ: ' + e.message, 'error');
  }
  showLoading(false);
}

// ============================================================
// COLLECT & SUBMIT
// ============================================================
function collectFormData(validate = true) {
  const reqNumber = getReqPrefix() + document.getElementById('reqNumber').value.trim();
  const reqDate     = document.getElementById('reqDate').value;
  const deptId      = document.getElementById('deptId').value;
  const warehouseId = document.getElementById('warehouseId').value;
  const requestedBy = window.ERP_USER?.user_id || '';
  const approvedBy  = '';
  const note        = document.getElementById('note').value.trim();

  if (validate) {
    if (!selectedPurposeId) { showToast('กรุณาเลือกวัตถุประสงค์การเบิก', 'error'); return null; }
    if (!deptId)             { showToast('กรุณาเลือกแผนก', 'error');                return null; }
    if (!warehouseId)        { showToast('กรุณาเลือกคลังที่จะเบิก', 'error');        return null; }
    if (!reqDate)            { showToast('กรุณาระบุวันที่เบิก', 'error');           return null; }
    if (!requestedBy)        { showToast('ไม่พบข้อมูลผู้ใช้ที่ล็อกอิน', 'error');     return null; }
    if (!note)               { showToast('กรุณาระบุรายละเอียดเพิ่มเติม', 'error');  return null; }
  }

  const items = [];
  let badRowFound = null;   // { rowIdx, reason }
  document.getElementById('itemsBody').querySelectorAll('tr').forEach((tr, idx) => {
    const rowId     = tr.id.replace('row-', '');
    const productId = tr.querySelector('.row-product-select')?.value;
    const qty       = document.getElementById(`qty-req-${rowId}`)?.value;
    const itemNote  = document.getElementById(`note-${rowId}`)?.value;
    const comboText = document.getElementById(`combo-input-${rowId}`)?.value?.trim();
    const unitId    = (unitsForProduct(productId)[0]?.unit_id) || null;   // default = หน่วยแรก (variant→parent)
    const qtyNum    = parseFloat(qty);

    // Empty row (no product chosen, no qty) — silently skip
    if (!productId && !qty && !comboText) return;

    // Validate row that has SOME data filled
    if (validate && comboText && !productId) {
      badRowFound = badRowFound || { idx: idx + 1, reason: `แถวที่ ${idx + 1}: กรุณาเลือกสินค้าจากรายการที่ปรากฏ` };
      return;
    }
    if (validate && productId && (!qty || qtyNum <= 0)) {
      badRowFound = badRowFound || { idx: idx + 1, reason: `แถวที่ ${idx + 1}: กรุณากรอกจำนวนมากกว่า 0` };
      return;
    }
    if (productId && qtyNum > 0) items.push({ productId, qty, note: itemNote, unitId });
  });

  if (validate && badRowFound) {
    showToast(badRowFound.reason, 'error');
    return null;
  }
  if (validate && items.length === 0) {
    showToast('กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ', 'error');
    return null;
  }

  return { reqNumber, reqDate, deptId, warehouseId,
    purposeId: selectedPurposeId, requestedBy, approvedBy, note, items };
}

async function submitREQ(autoApprove = false) {
  // Permission gate — UI ถูกซ่อนแล้วใน list/sidebar แต่ submit ต้องเช็คซ้ำ (defense in depth)
  const hasPerm = (k) => (window.AuthZ?.hasPerm ? window.AuthZ.hasPerm(k) : true);
  const needPerm = editingReqId ? 'req_edit' : 'req_create';
  if (!hasPerm(needPerm)) {
    showToast(`ไม่มีสิทธิ์ "${editingReqId ? 'แก้ไข' : 'สร้าง'}" ใบเบิก`, 'error');
    return;
  }
  if (autoApprove && !hasPerm('req_approve')) {
    showToast('ไม่มีสิทธิ์ "อนุมัติ" ใบเบิก', 'error');
    return;
  }

  const data = collectFormData();
  if (!data) return;
  if (!SUPABASE_URL || !SUPABASE_KEY) { showToast('กรุณาเชื่อมต่อ Supabase ก่อน', 'warning'); return; }

  // Stock pre-check (เฉพาะตอน "บันทึก+อนุมัติ" เพราะจะหัก stock จริง)
  if (autoApprove) {
    const shortages = await preCheckStock(data);
    if (shortages.length) {
      const lines = shortages.map(s =>
        `<li>${escapeHtml(s.name)} — ต้องการ <b>${s.requested.toLocaleString('th-TH')}</b> · มี ${s.available.toLocaleString('th-TH')} · <span style="color:#991b1b">ขาด ${s.short.toLocaleString('th-TH')}</span></li>`
      ).join('');
      const proceed = (typeof ConfirmModal !== 'undefined' && ConfirmModal.open)
        ? await ConfirmModal.open({
            title: 'สินค้าไม่พอในคลัง',
            message: `มีสินค้าไม่พอ ${shortages.length} รายการ`,
            icon: '⚠️',
            okText: 'อนุมัติต่อ (stock จะติดลบ)',
            cancelText: 'ยกเลิก',
            tone: 'warning',
            note: `<ul style="margin:6px 0 0 18px;padding:0;font-size:12.5px;line-height:1.7;">${lines}</ul>`,
          })
        : window.confirm(`สินค้าไม่พอ ${shortages.length} รายการ — อนุมัติต่อ?`);
      if (!proceed) return;
    }
  }

  showLoading(true);
  try {
    let reqId;
    const wasApproved = String(editingReqRow?.status || '').toUpperCase() === 'APPROVED';
    const headerBody = {
      req_number:    data.reqNumber,
      req_date:      data.reqDate,
      dept_id:       parseInt(data.deptId),
      warehouse_id:  parseInt(data.warehouseId),
      purpose_id:    parseInt(data.purposeId),
      requested_by:  parseInt(data.requestedBy),
      approved_by:   autoApprove ? parseInt(data.requestedBy) : null,
      approved_at:   autoApprove ? new Date().toISOString() : null,
      status:        autoApprove ? 'APPROVED' : 'DRAFT',
      note:          data.note || null,
    };

    if (editingReqId) {
      // PATCH header
      await supabaseFetch('requisitions', {
        method: 'PATCH',
        query:  `?req_id=eq.${editingReqId}`,
        body:   headerBody,
      });
      reqId = editingReqId;
      // ลบ items เดิม + insert ใหม่ทั้งชุด (ง่าย+เชื่อถือได้)
      await supabaseFetch('requisition_items', {
        method: 'DELETE',
        query:  `?req_id=eq.${editingReqId}`,
      });
      // ลบ stock_movements เดิมที่ออกจาก REQ นี้ (ถ้ามี)
      await supabaseFetch('stock_movements', {
        method: 'DELETE',
        query:  `?ref_doc_type=eq.REQ&ref_doc_id=eq.${editingReqId}`,
      }).catch(() => null);
    } else {
      // POST new — retry once on UNIQUE(req_number) conflict (race condition กับ user อื่น)
      let result;
      try {
        result = await supabaseFetch('requisitions', { method: 'POST', body: headerBody });
      } catch (e) {
        if (/duplicate key|unique/i.test(e.message || '')) {
          const nextSeq = await fetchNextReqNumber();
          const newNumber = getReqPrefix() + nextSeq;
          headerBody.req_number = newNumber;
          data.reqNumber = newNumber;
          document.getElementById('reqNumber').value = nextSeq;
          showToast(`มี user อื่น claim เลขเดิมไป → เปลี่ยนเป็น ${newNumber}`, 'warning');
          result = await supabaseFetch('requisitions', { method: 'POST', body: headerBody });
        } else { throw e; }
      }
      reqId = result[0].req_id;
    }

    // INSERT items (ทั้ง create + edit ใช้ทางเดียวกัน — เพราะ edit ลบของเก่าแล้ว)
    for (const item of data.items) {
      if (!item.unitId) throw new Error(`สินค้า ID ${item.productId} ไม่มีหน่วยนับ — กรุณาตั้งหน่วยใน Master Product ก่อน`);
      await supabaseFetch('requisition_items', {
        method: 'POST',
        body: {
          req_id:        reqId,
          product_id:    parseInt(item.productId),
          unit_id:       parseInt(item.unitId),
          qty_requested: parseFloat(item.qty),
          note:          item.note || null,
        }
      });
    }

    // หัก stock เฉพาะตอน "บันทึก+อนุมัติ"
    if (autoApprove) {
      const movedAt = new Date().toISOString();
      for (const item of data.items) {
        await supabaseFetch('stock_movements', {
          method: 'POST',
          body: {
            product_id:    parseInt(item.productId),
            warehouse_id:  parseInt(data.warehouseId),
            movement_type: 'OUT',
            qty:           parseFloat(item.qty),
            moved_at:      movedAt,
            ref_doc_type:  'REQ',
            ref_doc_id:    reqId,
            note:          `REQ ${data.reqNumber}`,
          }
        });
      }
    }

    // ── กระดิ่ง (in-app): แจ้งทีม Stock เมื่อมีใบเบิกใหม่ (เฉพาะตอนสร้าง ไม่ใช่แก้ไข) ──
    if (!editingReqId) {
      try {
        let requester = '';
        try {
          const s = JSON.parse(localStorage.getItem('erp_session') || sessionStorage.getItem('erp_session') || 'null');
          requester = s?.full_name || s?.username || '';
        } catch (_) {}
        const purposeCard = document.querySelector('.purpose-card.active');
        const purpose = purposeCard ? (purposeCard.querySelector('.purpose-label')?.textContent.trim() || '') : '';
        window.Notify?.notifyBell?.('stock.req.created', {
          req_number: data.reqNumber,
          requester,
          dept:       selectText(document.getElementById('deptId')),
          purpose,
          item_count: data.items.length,
          req_date:   (window.DateFmt?.formatDMY?.(data.reqDate)) || data.reqDate || '',
          req_id:     reqId,
        });
      } catch (_) {}
    }

    const verb = editingReqId ? 'อัปเดต' : 'บันทึก';
    const msg = autoApprove
      ? `✅ ${verb} + อนุมัติ ${data.reqNumber} สำเร็จ (หัก stock แล้ว)`
      : `💾 ${verb} Draft ${data.reqNumber} สำเร็จ (รออนุมัติ)`;
    formDirty = false;   // กัน beforeunload เตือนตอน redirect หลัง save สำเร็จ
    showToast(msg, 'success');
    setTimeout(() => { window.location.href = './requisition-list.html'; }, 1200);
  } catch(e) { showToast('เกิดข้อผิดพลาด: ' + e.message, 'error'); }
  showLoading(false);
}

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

  const deptName       = selectText(document.getElementById('deptId'));
  // requesterName/approverName ไม่ใช้ใน preview แล้ว — ลายเซ็นเป็นช่องว่างเขียนมือ

  const fmtDate = (iso) => (window.DateFmt?.formatDMY?.(iso)) || iso || '—';

  // helper — กัน null reference เผื่อ HTML/JS sync ไม่ทัน (browser cache)
  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  // Header (internal-use form — แสดงแค่ชื่อบริษัท ไม่ใส่ที่อยู่/Tax/โทร/email)
  setText('docCompanyTh', COMPANY_PROFILE.nameTh);
  setText('docCompanyEn', COMPANY_PROFILE.nameEn);
  const logoEl = document.getElementById('docLogo');
  if (logoEl) {
    logoEl.src = COMPANY_PROFILE.logoUrl;
    logoEl.onerror = () => {   // ถ้าโหลด logo ไม่ได้ → ซ่อนแล้วใช้ตัวอักษร "A4S" แทน
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

  setText('docNumber', data.reqNumber);

  // Info grid (metadata only — ผู้ขอเบิก/ผู้อนุมัติ อยู่ในช่องลายเซ็นด้านล่างแทน)
  setText('docPurpose', purposeName);
  setText('docDept',    deptName);
  setText('docDate2',   fmtDate(data.reqDate));

  // Items
  const tbody = document.getElementById('docItemsBody');
  tbody.innerHTML = '';
  let totalQty = 0;
  if (data.items.length === 0) {
    tbody.innerHTML = '<tr class="req-doc-empty-row"><td colspan="6">— ไม่มีรายการ —</td></tr>';
  } else {
    data.items.forEach((item, idx) => {
      const product = products.find(p => String(p.product_id) === String(item.productId));
      const productLabel = product?.product_name || '—';
      const qty = parseFloat(item.qty) || 0;
      totalQty += qty;
      const imgUrl = getProductImageUrl(item.productId) || NO_IMAGE_URL;
      const thumbHtml = `<div class="prod-thumb"><img src="${escapeAttr(imgUrl)}" alt="" onerror="this.onerror=null;this.src='${NO_IMAGE_URL}'"></div>`;
      tbody.insertAdjacentHTML('beforeend', `
        <tr>
          <td class="text-center">${idx + 1}</td>
          <td class="text-center">${thumbHtml}</td>
          <td>${escapeHtml(productLabel)}</td>
          <td class="text-right">${qty.toLocaleString('th-TH')}</td>
          <td class="doc-handwrite-cell"></td>
          <td>${escapeHtml(item.note || '')}</td>
        </tr>`);
    });
  }
  setText('docTotalQty',   totalQty.toLocaleString('th-TH'));
  setText('docTotalItems', `${data.items.length} รายการ`);

  // Note (signatures = ช่องว่างให้เซ็นมือบนใบที่พิมพ์ออก)
  setText('docNote', data.note?.trim() || '—');
  setText('docPrintedAt',
    window.DateFmt?.formatDMYTime?.(new Date().toISOString()) || new Date().toLocaleString('th-TH'));

  document.getElementById('previewOverlay').classList.add('open');
}

function closePreview() {
  // ถ้าอยู่ใน headless popup → close window ไปเลย (ไม่มี chrome ให้กลับไป)
  if (document.documentElement.classList.contains('headless')) { window.close(); return; }
  document.getElementById('previewOverlay').classList.remove('open');
}

function printREQ() {
  window.print();
}

// ยกเลิก → กลับหน้า list (ถาม confirm เฉพาะเมื่อมีการแก้ไขจริง)
async function cancelEdit() {
  if (!formDirty) {
    window.location.href = './requisition-list.html';
    return;
  }
  const proceed = (typeof ConfirmModal !== 'undefined' && ConfirmModal.open)
    ? await ConfirmModal.open({
        title: 'ยกเลิกการแก้ไข',
        message: 'ทิ้งการเปลี่ยนแปลงทั้งหมดและกลับไปหน้ารายการ?',
        icon: '✕',
        okText: 'ยืนยัน',
        cancelText: 'อยู่ต่อ',
        tone: 'warning',
      })
    : window.confirm('ทิ้งการเปลี่ยนแปลงทั้งหมดและกลับไปหน้ารายการ?');
  if (proceed) window.location.href = './requisition-list.html';
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
  ));
}

// คำนวณเลข REQ ถัดไปสำหรับเดือนปัจจุบัน (ดู max ใน DB → +1)
async function fetchNextReqNumber() {
  const prefix = getReqPrefix();
  try {
    const rows = await supabaseFetch('requisitions', {
      query: `?req_number=like.${encodeURIComponent(prefix + '%')}&select=req_number&order=req_number.desc&limit=1`
    });
    const last = rows?.[0]?.req_number;
    if (!last) return '001';
    const seq = parseInt(last.slice(prefix.length), 10) || 0;
    return String(seq + 1).padStart(3, '0');
  } catch (e) {
    console.warn('[fetchNextReqNumber]', e);
    return '001';
  }
}

async function refreshReqNumber() {
  const prefix = getReqPrefix();
  const next = await fetchNextReqNumber();
  document.getElementById('reqNumber').value              = next;
  document.getElementById('reqNumberDisplay').textContent = prefix + next;
}

function resetForm() {
  const prefix = getReqPrefix();
  document.getElementById('reqPrefix').textContent        = prefix;
  document.getElementById('reqNumber').value              = '001';
  document.getElementById('reqNumberDisplay').textContent = prefix + '001';
  // เลข REQ ถัดไป (รอจาก DB — set ทันทีเป็น 001 แล้ว update เมื่อ DB ตอบ)
  refreshReqNumber().catch(console.error);
  document.getElementById('reqDate').value                = new Date().toISOString().split('T')[0];
  document.getElementById('deptId').value                 = '';
  autoFillUserDept().catch(console.error);
  document.getElementById('warehouseId').value            = '';
  selectedWarehouseId = null;
  document.querySelectorAll('.warehouse-card').forEach(c => c.classList.remove('active'));
  // re-auto-select คลังแรกที่ render อยู่
  const firstWh = document.querySelector('.warehouse-card');
  if (firstWh) selectWarehouse(+firstWh.dataset.id, firstWh);
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
// Catch-all dirty flag: trigger when ANY input/select inside form changes
document.addEventListener('input', (e) => {
  if (e.target.closest('.section-card')) formDirty = true;
});
document.addEventListener('change', (e) => {
  if (e.target.closest('.section-card')) formDirty = true;
});

// Browser back / close tab guard — เตือนถ้าฟอร์มมีการแก้ไขที่ยังไม่ save
window.addEventListener('beforeunload', (e) => {
  // headless print popup ข้าม guard (จะปิดเองหลังพิมพ์)
  if (document.documentElement.classList.contains('headless')) return;
  if (!formDirty) return;
  e.preventDefault();
  e.returnValue = '';   // จำเป็นสำหรับ Chrome/Edge
});

window.addEventListener('DOMContentLoaded', async () => {
  SUPABASE_URL = localStorage.getItem('sb_url') || '';
  SUPABASE_KEY = localStorage.getItem('sb_key') || '';
  const prefix = getReqPrefix();
  document.getElementById('reqPrefix').textContent        = prefix;
  document.getElementById('reqNumberDisplay').textContent = prefix + '001';
  document.getElementById('reqDate').value = new Date().toISOString().split('T')[0];

  // ตรวจ edit mode จาก URL ?req_id=X (+ optional ?print=1 = เปิด preview อัตโนมัติ, ?headless=1 = ซ่อน chrome)
  const params  = new URLSearchParams(window.location.search);
  const editId  = parseInt(params.get('req_id'), 10);
  const autoPrint = params.get('print') === '1';
  const headless  = params.get('headless') === '1';
  editingReqId = Number.isFinite(editId) ? editId : null;
  // headless class ตั้งไว้ที่ <html> แล้วโดย inline script ใน <head> (ก่อน sidebar.js evaluate)

  if (!editingReqId) addItemRow();   // create mode → start with 1 empty row

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn('[REQ] Supabase not configured — sb_url/sb_key missing in localStorage. Dropdowns will be empty.');
    return;
  }

  try {
    await loadDropdowns();
    if (editingReqId) await loadRequisitionForEdit(editingReqId);
    // ตอนนี้ฟอร์มเพิ่งโหลดเสร็จ — reset dirty flag (auto-fill ไม่นับเป็น user change)
    formDirty = false;
    if (autoPrint) {
      // เปิด preview overlay ก่อน แล้วเรียก window.print() ทันที (browser print dialog)
      setTimeout(() => {
        previewREQ();
        // ใน headless mode → trigger native print dialog ทันที + close popup หลังพิมพ์/ยกเลิก
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