/* ============================================================
   customers.js — Logic สำหรับหน้าจัดการลูกค้า
   ============================================================ */

let SUPABASE_URL = localStorage.getItem('sb_url') || '';
let SUPABASE_KEY = localStorage.getItem('sb_key') || '';
let allCustomers = [];
let allSOs = [];
let selectedId = null;
let sortKey = 'customer_code';
let sortAsc = true;

const TYPE_CFG = {
  RETAIL:    { label:'🛒 Retail',     cls:'type-retail' },
  WHOLESALE: { label:'📦 Wholesale',  cls:'type-wholesale' },
  CORPORATE: { label:'🏢 Corporate',  cls:'type-corporate' },
};

/* ── Supabase Helper ── */
async function sbFetch(table, opts = {}) {
  const { method='GET', query='', body } = opts;
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
  if (!res.ok) throw new Error((await res.json()).message || 'Error');
  return method !== 'DELETE' ? res.json().catch(() => null) : null;
}

/* ── Load Data ── */
async function loadData() {
  if (!SUPABASE_URL || !SUPABASE_KEY) { renderTable([]); return; }
  showLoading(true);
  try {
    const [cus, sos] = await Promise.all([
      sbFetch('customers', { query:'?select=*&order=customer_code' }),
      sbFetch('sales_orders', { query:'?select=so_id,customer_id,so_number,order_date,total_amount,status' }),
    ]);
    allCustomers = cus || [];
    allSOs = sos || [];
    filterTable();
    updateStats();
  } catch(e) { showToast('โหลดไม่ได้: ' + e.message, 'error'); }
  showLoading(false);
}

/* ── Stats ── */
function updateStats() {
  document.getElementById('statTotal').textContent  = allCustomers.length;
  document.getElementById('statActive').textContent = allCustomers.filter(c => c.is_active !== false).length;
  document.getElementById('statRetail').textContent = allCustomers.filter(c => c.customer_type === 'RETAIL').length;
  document.getElementById('statWithSO').textContent = new Set(allSOs.map(s => s.customer_id)).size;
}

/* ── Filter & Sort ── */
function filterTable() {
  const search = document.getElementById('searchInput').value.toLowerCase();
  const type   = document.getElementById('filterType').value;
  const status = document.getElementById('filterStatus').value;

  let list = allCustomers.filter(c => {
    const q = `${c.customer_name||''} ${c.customer_code||''} ${c.phone||''} ${c.contact_person||''}`.toLowerCase();
    return (!search || q.includes(search)) &&
           (!type   || c.customer_type === type) &&
           (status === '' || String(c.is_active !== false) === status);
  });

  list.sort((a, b) => {
    let av = a[sortKey] ?? '', bv = b[sortKey] ?? '';
    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();
    return sortAsc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
  });

  renderTable(list);
}

function sortBy(key) {
  if (sortKey === key) sortAsc = !sortAsc; else { sortKey = key; sortAsc = true; }
  filterTable();
}

/* ── Render Table ── */
function renderTable(list) {
  document.getElementById('tableCount').textContent = `${list.length} รายการ`;
  const tbody = document.getElementById('tableBody');
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">🔍</div><div>ไม่พบลูกค้า</div></div></td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(c => {
    const typeCfg = TYPE_CFG[c.customer_type] || { label: c.customer_type, cls:'type-retail' };
    const soCount = allSOs.filter(s => s.customer_id === c.customer_id).length;
    const isActive = c.is_active !== false;
    return `<tr class="${c.customer_id === selectedId ? 'selected' : ''}" onclick="selectCustomer(${c.customer_id})">
      <td><span class="cus-code">${c.customer_code || '—'}</span></td>
      <td>
        <div style="font-weight:600">${c.customer_name}</div>
        ${soCount > 0 ? `<div style="font-size:12px;color:var(--text3)">📄 ${soCount} SO</div>` : ''}
      </td>
      <td><span class="cus-type-badge ${typeCfg.cls}">${typeCfg.label}</span></td>
      <td>
        <div style="font-size:13px">${c.contact_person || '—'}</div>
        <div class="cus-code">${c.phone || ''}</div>
      </td>
      <td><span style="font-family:'IBM Plex Mono',monospace;font-size:13px">${c.credit_days ? c.credit_days + ' วัน' : '—'}</span></td>
      <td><span class="status-badge ${isActive ? 'status-active' : 'status-inactive'}">${isActive ? '● ใช้งาน' : '● ปิด'}</span></td>
    </tr>`;
  }).join('');
}

/* ── Select Customer (Side Panel) ── */
function selectCustomer(id) {
  selectedId = id;
  const c = allCustomers.find(x => x.customer_id === id);
  if (!c) return;

  document.querySelectorAll('.cus-table tr').forEach(r => r.classList.remove('selected'));
  event.currentTarget.classList.add('selected');

  const typeCfg = TYPE_CFG[c.customer_type] || { label: c.customer_type, cls:'type-retail' };
  const isActive = c.is_active !== false;

  document.getElementById('panelCode').textContent = c.customer_code || '—';
  document.getElementById('panelName').textContent = c.customer_name;
  document.getElementById('panelType').innerHTML = `<span class="cus-type-badge ${typeCfg.cls}">${typeCfg.label}</span>`;
  document.getElementById('panelStatus').innerHTML = `<span class="status-badge ${isActive?'status-active':'status-inactive'}">${isActive?'● ใช้งาน':'● ปิด'}</span>`;
  document.getElementById('panelContact').textContent = c.contact_person || '—';
  document.getElementById('panelTaxId').textContent = c.tax_id || '—';
  document.getElementById('panelCredit').textContent = c.credit_days ? c.credit_days + ' วัน' : '—';
  document.getElementById('panelCreditLimit').textContent = c.credit_limit ? '฿' + parseFloat(c.credit_limit).toLocaleString() : '—';
  document.getElementById('panelPhone').textContent = c.phone || '—';
  document.getElementById('panelEmail').textContent = c.email || '—';
  document.getElementById('panelAddress').textContent = c.address || '—';

  const noteSection = document.getElementById('panelNoteSection');
  if (c.note) { document.getElementById('panelNote').textContent = c.note; noteSection.style.display = 'block'; }
  else noteSection.style.display = 'none';

  const sos = allSOs.filter(s => s.customer_id === id).sort((a, b) => new Date(b.order_date) - new Date(a.order_date)).slice(0, 5);
  const soEl = document.getElementById('panelSOHistory');
  if (sos.length === 0) {
    soEl.innerHTML = `<div style="text-align:center;padding:16px;color:var(--text3);font-size:13px">ยังไม่มี SO</div>`;
  } else {
    soEl.innerHTML = sos.map(s => `
      <div class="so-item">
        <div><div class="so-ref">${s.so_number}</div>
        <div class="so-date">${new Date(s.order_date).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'2-digit'})}</div></div>
        <span class="status-badge ${s.status==='APPROVED'||s.status==='DELIVERED'?'status-active':''}" style="font-size:10px">${s.status}</span>
        <div class="so-amount">฿${parseFloat(s.total_amount||0).toLocaleString('th-TH',{minimumFractionDigits:2})}</div>
      </div>`).join('');
  }

  document.getElementById('sidePanel').classList.add('open');
}

function closePanel() {
  document.getElementById('sidePanel').classList.remove('open');
  document.querySelectorAll('.cus-table tr').forEach(r => r.classList.remove('selected'));
  selectedId = null;
}

/* ── Modal ── */
function openModal(data = null) {
  document.getElementById('modalTitle').textContent = data ? 'แก้ไขลูกค้า' : 'เพิ่มลูกค้าใหม่';
  document.getElementById('editId').value       = data?.customer_id || '';
  document.getElementById('fCode').value        = data?.customer_code || '';
  document.getElementById('fName').value        = data?.customer_name || '';
  document.getElementById('fContact').value     = data?.contact_person || '';
  document.getElementById('fPhone').value       = data?.phone || '';
  document.getElementById('fEmail').value       = data?.email || '';
  document.getElementById('fAddress').value     = data?.address || '';
  document.getElementById('fTaxId').value       = data?.tax_id || '';
  document.getElementById('fCredit').value      = data?.credit_days || '';
  document.getElementById('fCreditLimit').value = data?.credit_limit || '';
  document.getElementById('fNote').value        = data?.note || '';
  document.getElementById('fType').value        = data?.customer_type || 'RETAIL';
  document.getElementById('fStatus').value      = data ? String(data.is_active !== false) : 'true';
  document.getElementById('modalOverlay').classList.add('open');
  setTimeout(() => document.getElementById('fCode').focus(), 100);
}

function editSelected() { if (selectedId) openModal(allCustomers.find(c => c.customer_id === selectedId)); }
function closeModal() { document.getElementById('modalOverlay').classList.remove('open'); }
function closeModalBg(e) { if (e.target === document.getElementById('modalOverlay')) closeModal(); }

/* ── Save Customer ── */
async function saveCustomer() {
  const name = document.getElementById('fName').value.trim();
  const code = document.getElementById('fCode').value.trim();
  if (!name) { showToast('กรุณากรอกชื่อลูกค้า', 'error'); return; }
  if (!SUPABASE_URL || !SUPABASE_KEY) { showToast('กรุณาเชื่อมต่อ Supabase ก่อน', 'warning'); return; }

  const payload = {
    customer_code:  code || null,
    customer_name:  name,
    customer_type:  document.getElementById('fType').value,
    contact_person: document.getElementById('fContact').value.trim() || null,
    phone:          document.getElementById('fPhone').value.trim() || null,
    email:          document.getElementById('fEmail').value.trim() || null,
    address:        document.getElementById('fAddress').value.trim() || null,
    tax_id:         document.getElementById('fTaxId').value.trim() || null,
    credit_days:    parseInt(document.getElementById('fCredit').value) || null,
    credit_limit:   parseFloat(document.getElementById('fCreditLimit').value) || null,
    note:           document.getElementById('fNote').value.trim() || null,
    is_active:      document.getElementById('fStatus').value === 'true',
  };

  showLoading(true);
  try {
    const editId = document.getElementById('editId').value;
    if (editId) {
      await sbFetch('customers', { method:'PATCH', query:`?customer_id=eq.${editId}`, body: payload });
      showToast('✅ แก้ไขลูกค้าสำเร็จ!', 'success');
    } else {
      await sbFetch('customers', { method:'POST', body: payload });
      showToast('✅ เพิ่มลูกค้าสำเร็จ!', 'success');
    }
    closeModal();
    await loadData();
  } catch(e) { showToast('เกิดข้อผิดพลาด: ' + e.message, 'error'); }
  showLoading(false);
}

/* ── Delete ── */
async function deleteSelected() {
  if (!selectedId) return;
  const c = allCustomers.find(x => x.customer_id === selectedId);
  if (!confirm(`ลบ "${c?.customer_name}" ออกจากระบบ?`)) return;
  showLoading(true);
  try {
    await sbFetch('customers', { method:'DELETE', query:`?customer_id=eq.${selectedId}` });
    showToast('ลบลูกค้าแล้ว', 'success');
    closePanel();
    await loadData();
  } catch(e) { showToast('ลบไม่ได้: ' + e.message, 'error'); }
  showLoading(false);
}

/* ── UI Helpers ── */
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove('show'), 3000);
}

function showLoading(show) {
  document.getElementById('loadingOverlay').classList.toggle('show', show);
}

/* ── Init ── */
window.addEventListener('DOMContentLoaded', () => {
  if (SUPABASE_URL && SUPABASE_KEY) setTimeout(() => loadData(), 50);
});