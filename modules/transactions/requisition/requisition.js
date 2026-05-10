// ============================================================
// STATE
// ============================================================
let SUPABASE_URL      = localStorage.getItem('sb_url') || '';
let SUPABASE_KEY      = localStorage.getItem('sb_key') || '';
let products          = [];     // full list (สำหรับ lookup ตาม id)
let productsForPicker = [];     // filtered: variants + standalones (ตัด parent ที่มี variants)
let productImageByPid = {};     // pid → primary image url (variant ใช้ของ parent)
let productUnits      = {};
let rowCount          = 0;
let selectedPurposeId = null;

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
// LOAD DROPDOWNS
// ============================================================
async function loadDropdowns() {
  const [depts, users, prods, units, purposes, images] = await Promise.all([
    supabaseFetch('departments',          { query: '?select=dept_id,dept_code,dept_name&order=sort_order,dept_code' }),
    supabaseFetch('users',                { query: '?select=user_id,full_name&is_active=eq.true&order=full_name.asc' }),
    supabaseFetch('products',             { query: '?select=product_id,product_code,product_name,parent_product_id&is_active=eq.true&order=product_id.asc' }),
    supabaseFetch('product_units',        { query: '?select=unit_id,product_id,unit_name' }),
    supabaseFetch('requisition_purposes', { query: '?select=purpose_id,purpose_code,purpose_name,purpose_type&is_active=eq.true' }),
    supabaseFetch('product_images',       { query: '?select=product_id,url,sort_order&order=sort_order.asc' }),
  ]);

  // Departments — ใส่ data-dept-code เพื่อให้ autoFillUserDept match ได้
  console.log('[loadDropdowns] departments:', depts);
  const selDept = document.getElementById('deptId');
  selDept.innerHTML = '<option value="">— เลือกแผนก —</option>';
  depts?.forEach(d => selDept.insertAdjacentHTML('beforeend',
    `<option value="${d.dept_id}" data-dept-code="${d.dept_code || ''}">${d.dept_name}</option>`));
  await autoFillUserDept();

  // Users → requestedBy + approvedBy
  ['requestedBy', 'approvedBy'].forEach(id => {
    const sel = document.getElementById(id);
    sel.innerHTML = `<option value="">— ${id === 'requestedBy' ? 'เลือกผู้ขอเบิก' : 'เลือกผู้อนุมัติ'} —</option>`;
    users?.forEach(u => sel.insertAdjacentHTML('beforeend',
      `<option value="${u.user_id}">${u.full_name || ''}</option>`));
  });

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

  // Purpose cards — DB first, fallback to defaults
  const purposeData = purposes?.length
    ? purposes.map(p => ({ ...p, icon: PURPOSE_ICONS[p.purpose_type] || '📌' }))
    : DEFAULT_PURPOSES;
  renderPurposeCards(purposeData);

  // (combo อ่านจาก global products array ตรงๆ — ไม่ต้อง re-populate per row)

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
  // เริ่มพิมพ์ใหม่ → invalidate การเลือกเดิม
  document.getElementById(`product-${rowId}`).value = '';
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
    </div>`).join('');
  portal.querySelectorAll('.combo-item').forEach(item => {
    item.onmousedown = (e) => {
      e.preventDefault();   // กัน blur input ก่อน click ติด
      comboPick(rowId, +item.dataset.id);
    };
  });
}

function comboPick(rowId, productId) {
  const product = products.find(p => p.product_id == productId);
  if (!product) return;
  const label = product.product_name || '';
  document.getElementById(`combo-input-${rowId}`).value = label;
  const hidden = document.getElementById(`product-${rowId}`);
  hidden.value = productId;
  comboClose();
  updateRowThumb(rowId, productId);
  onProductChange(hidden, rowId);
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
  const requestedBy = document.getElementById('requestedBy').value;
  const approvedBy  = document.getElementById('approvedBy').value;
  const note        = document.getElementById('note').value;

  if (validate) {
    if (!selectedPurposeId) { showToast('กรุณาเลือกวัตถุประสงค์การเบิก', 'error'); return null; }
    if (!deptId)             { showToast('กรุณาเลือกแผนก', 'error');                return null; }
    if (!reqDate)            { showToast('กรุณาระบุวันที่เบิก', 'error');           return null; }
    if (!requestedBy)        { showToast('กรุณาเลือกผู้ขอเบิก', 'error');           return null; }
  }

  const items = [];
  document.getElementById('itemsBody').querySelectorAll('tr').forEach(tr => {
    const rowId     = tr.id.replace('row-', '');
    const productId = tr.querySelector('.row-product-select')?.value;
    const qty       = document.getElementById(`qty-req-${rowId}`)?.value;
    const itemNote  = document.getElementById(`note-${rowId}`)?.value;
    // qty_actual ไม่เก็บใน DB — เซ็นด้วยมือบนใบที่พิมพ์ออก
    if (productId && qty) items.push({ productId, qty, note: itemNote });
  });

  if (validate && items.length === 0) {
    showToast('กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ', 'error');
    return null;
  }

  return { reqNumber, reqDate, deptId,
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
  const requesterName  = selectText(document.getElementById('requestedBy'));
  const approverName   = data.approvedBy ? selectText(document.getElementById('approvedBy')) : '—';

  const fmtDate = (iso) => (window.DateFmt?.formatDMY?.(iso)) || iso || '—';

  // Header (internal-use form — แสดงแค่ชื่อบริษัท ไม่ใส่ที่อยู่/Tax/โทร/email)
  document.getElementById('docCompanyTh').textContent = COMPANY_PROFILE.nameTh;
  document.getElementById('docCompanyEn').textContent = COMPANY_PROFILE.nameEn;
  const logoEl = document.getElementById('docLogo');
  logoEl.style.backgroundImage = `url("${COMPANY_PROFILE.logoUrl}")`;

  document.getElementById('docNumber').textContent  = data.reqNumber;
  document.getElementById('docDate').textContent    = fmtDate(data.reqDate);
  document.getElementById('docStatus').textContent  = 'DRAFT';

  // Info grid (metadata only — ผู้ขอเบิก/ผู้อนุมัติ อยู่ในช่องลายเซ็นด้านล่างแทน)
  document.getElementById('docPurpose').textContent = purposeType ? `${purposeName} (${purposeType})` : purposeName;
  document.getElementById('docDept').textContent    = deptName;
  document.getElementById('docDate2').textContent   = fmtDate(data.reqDate);

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