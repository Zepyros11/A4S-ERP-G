/* ============================================================
   settings.js — System settings page logic
   ============================================================ */

let SUPABASE_URL = localStorage.getItem('sb_url') || '';
let SUPABASE_KEY = localStorage.getItem('sb_key') || '';

// Auth guard — allow if no supabase yet (first setup)
const _hasSession  = localStorage.getItem('erp_session') || sessionStorage.getItem('erp_session');
const _hasSupabase = localStorage.getItem('sb_url');
if (_hasSupabase && !_hasSession) {
  sessionStorage.setItem('erp_redirect', window.location.pathname);
  window.location.replace('/login.html');
}
if (_hasSession) window.ERP_USER = JSON.parse(_hasSession);

window.addEventListener('DOMContentLoaded', () => {
  if (SUPABASE_URL) document.getElementById('inputUrl').value = SUPABASE_URL;
  if (SUPABASE_KEY) document.getElementById('inputKey').value = SUPABASE_KEY;
  document.getElementById('companyName').value    = localStorage.getItem('company_name') || '';
  document.getElementById('taxId').value          = localStorage.getItem('tax_id') || '';
  document.getElementById('companyAddress').value = localStorage.getItem('company_address') || '';
  document.getElementById('companyPhone').value   = localStorage.getItem('company_phone') || '';
  document.getElementById('companyEmail').value   = localStorage.getItem('company_email') || '';
  document.getElementById('prefixPo').value  = localStorage.getItem('prefix_po')  || 'PO-2025-';
  document.getElementById('prefixSo').value  = localStorage.getItem('prefix_so')  || 'SO-2025-';
  document.getElementById('prefixReq').value = localStorage.getItem('prefix_req') || 'REQ-2025-';
  if (SUPABASE_URL && SUPABASE_KEY) testConnection(true);
});

async function supabaseFetch(table, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

async function saveAndConnect() {
  const url = document.getElementById('inputUrl').value.trim().replace(/\/$/, '');
  const key = document.getElementById('inputKey').value.trim();
  if (!url || !key) { showToast('กรุณากรอก URL และ Key ให้ครบ', 'error'); return; }
  SUPABASE_URL = url;
  SUPABASE_KEY = key;
  localStorage.setItem('sb_url', url);
  localStorage.setItem('sb_key', key);
  await testConnection();
}

async function testConnection(silent = false) {
  if (!SUPABASE_URL || !SUPABASE_KEY) { showToast('กรุณากรอก URL และ Key ก่อน', 'warning'); return; }
  showLoading(true);
  try {
    const [products, warehouses, suppliers, customers] = await Promise.all([
      supabaseFetch('products',   '?select=product_id'),
      supabaseFetch('warehouses', '?select=warehouse_id'),
      supabaseFetch('suppliers',  '?select=supplier_id'),
      supabaseFetch('customers',  '?select=customer_id'),
    ]);
    document.getElementById('connStatus').className = 'status-dot dot-connected';
    document.getElementById('connStatus').innerHTML = '<span class="dot-pulse"></span> เชื่อมต่อแล้ว';
    document.getElementById('countProducts').textContent   = products.length;
    document.getElementById('countWarehouses').textContent = warehouses.length;
    document.getElementById('countSuppliers').textContent  = suppliers.length;
    document.getElementById('countCustomers').textContent  = customers.length;
    document.getElementById('dbInfo').style.display = 'block';
    if (!silent) showToast(`✅ เชื่อมต่อสำเร็จ! พบข้อมูล ${products.length} สินค้า`, 'success');
    await loadCategories();
  } catch(e) {
    document.getElementById('connStatus').className = 'status-dot dot-disconnected';
    document.getElementById('connStatus').innerHTML = '<span class="dot-pulse"></span> เชื่อมต่อไม่ได้';
    document.getElementById('dbInfo').style.display = 'none';
    if (!silent) showToast('เชื่อมต่อไม่ได้: ' + e.message, 'error');
  }
  showLoading(false);
}

function clearCredentials() {
  if (!confirm('ลบ Supabase Key ออกจากเครื่องนี้?')) return;
  localStorage.removeItem('sb_url'); localStorage.removeItem('sb_key');
  document.getElementById('inputUrl').value = '';
  document.getElementById('inputKey').value = '';
  document.getElementById('connStatus').className = 'status-dot dot-disconnected';
  document.getElementById('connStatus').innerHTML = '<span class="dot-pulse"></span> ยังไม่เชื่อมต่อ';
  document.getElementById('dbInfo').style.display = 'none';
  SUPABASE_URL = ''; SUPABASE_KEY = '';
  showToast('ล้าง Key แล้ว', 'success');
}

function toggleKeyVisibility() {
  const input = document.getElementById('inputKey');
  const btn   = document.getElementById('keyToggleBtn');
  input.type  = input.type === 'password' ? 'text' : 'password';
  btn.textContent = input.type === 'password' ? '👁' : '🙈';
}

function saveCompanyInfo() {
  localStorage.setItem('company_name',    document.getElementById('companyName').value);
  localStorage.setItem('tax_id',          document.getElementById('taxId').value);
  localStorage.setItem('company_address', document.getElementById('companyAddress').value);
  localStorage.setItem('company_phone',   document.getElementById('companyPhone').value);
  localStorage.setItem('company_email',   document.getElementById('companyEmail').value);
  showToast('✅ บันทึกข้อมูลบริษัทแล้ว', 'success');
}

function savePrefixes() {
  localStorage.setItem('prefix_po',  document.getElementById('prefixPo').value);
  localStorage.setItem('prefix_so',  document.getElementById('prefixSo').value);
  localStorage.setItem('prefix_req', document.getElementById('prefixReq').value);
  showToast('✅ บันทึก Prefix แล้ว', 'success');
}

// ── CATEGORIES ──
let categories = [];
let editingCatId = null;

async function loadCategories() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    categories = (await supabaseFetch('categories', '?select=*&order=category_name')) || [];
    renderCategoryList();
  } catch(e) { console.error('loadCategories:', e); }
}

function renderCategoryList() {
  const el = document.getElementById('catList');
  if (!categories.length) {
    el.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text3)"><div style="font-size:28px;margin-bottom:8px">🏷️</div><div style="font-size:13px">ยังไม่มีหมวดหมู่ — กด + เพิ่มหมวดหมู่</div></div>`;
    return;
  }
  el.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13.5px">
    <thead><tr>
      <th style="padding:9px 14px;text-align:left;font-size:11px;font-weight:700;letter-spacing:.8px;color:var(--text3);border-bottom:2px solid var(--border);background:var(--surface2)">ชื่อหมวดหมู่</th>
      <th style="padding:9px 14px;text-align:left;font-size:11px;font-weight:700;letter-spacing:.8px;color:var(--text3);border-bottom:2px solid var(--border);background:var(--surface2)">คำอธิบาย</th>
      <th style="padding:9px 14px;width:120px;border-bottom:2px solid var(--border);background:var(--surface2)"></th>
    </tr></thead>
    <tbody>${categories.map(c => `
      <tr style="border-bottom:1px solid var(--border)">
        <td style="padding:10px 14px;font-weight:500">${c.category_name}</td>
        <td style="padding:10px 14px;color:var(--text2);font-size:13px">${c.description || '—'}</td>
        <td style="padding:10px 14px;text-align:right">
          <button onclick="editCategory(${c.category_id})" class="btn btn-outline" style="padding:4px 10px;font-size:12px;margin-right:4px">✏️ แก้ไข</button>
          <button onclick="deleteCategory(${c.category_id},'${c.category_name}')" class="btn-sm-danger">🗑</button>
        </td>
      </tr>`).join('')}
    </tbody></table>`;
}

function openCatForm(cat = null) {
  editingCatId = cat?.category_id || null;
  document.getElementById('catName').value = cat?.category_name || '';
  document.getElementById('catDesc').value = cat?.description || '';
  document.getElementById('catEditId').value = editingCatId || '';
  document.getElementById('catForm').style.display = 'block';
  document.getElementById('catName').focus();
}

function closeCatForm() {
  document.getElementById('catForm').style.display = 'none';
  editingCatId = null;
}

function editCategory(id) {
  const cat = categories.find(c => c.category_id === id);
  if (cat) openCatForm(cat);
}

async function saveCategory() {
  const name = document.getElementById('catName').value.trim();
  const desc = document.getElementById('catDesc').value.trim();
  if (!name) { showToast('กรุณาระบุชื่อหมวดหมู่', 'error'); return; }
  if (!SUPABASE_URL || !SUPABASE_KEY) { showToast('กรุณาเชื่อมต่อ Supabase ก่อน', 'warning'); return; }
  showLoading(true);
  try {
    if (editingCatId) {
      await fetch(`${SUPABASE_URL}/rest/v1/categories?category_id=eq.${editingCatId}`, {
        method:'PATCH', headers:{'apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`,'Content-Type':'application/json'},
        body: JSON.stringify({ category_name:name, description:desc || null })
      });
      showToast('✅ แก้ไขหมวดหมู่แล้ว', 'success');
    } else {
      await fetch(`${SUPABASE_URL}/rest/v1/categories`, {
        method:'POST', headers:{'apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`,'Content-Type':'application/json','Prefer':'return=representation'},
        body: JSON.stringify({ category_name:name, description:desc || null })
      });
      showToast('✅ เพิ่มหมวดหมู่แล้ว', 'success');
    }
    closeCatForm();
    await loadCategories();
  } catch(e) { showToast('เกิดข้อผิดพลาด: ' + e.message, 'error'); }
  showLoading(false);
}

async function deleteCategory(id, name) {
  if (!confirm(`ลบหมวดหมู่ "${name}" ?\n(สินค้าในหมวดนี้จะไม่ถูกลบ)`)) return;
  showLoading(true);
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/categories?category_id=eq.${id}`, {
      method:'DELETE', headers:{'apikey':SUPABASE_KEY,'Authorization':`Bearer ${SUPABASE_KEY}`}
    });
    showToast('ลบหมวดหมู่แล้ว', 'success');
    await loadCategories();
  } catch(e) { showToast('ลบไม่ได้: ' + e.message, 'error'); }
  showLoading(false);
}

function confirmClearAll() {
  if (!confirm('ล้าง localStorage ทั้งหมด?\n(ข้อมูลใน Database จะไม่หาย)')) return;
  localStorage.clear();
  showToast('ล้าง localStorage เรียบร้อย — กรุณากรอก Key ใหม่', 'warning');
  setTimeout(() => location.reload(), 1500);
}

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove('show'), 3500);
}
function showLoading(show) { document.getElementById('loadingOverlay').classList.toggle('show', show); }