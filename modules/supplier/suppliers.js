/* ============================================================
   suppliers.js — Logic สำหรับหน้าจัดการ Supplier
   ============================================================ */

let SUPABASE_URL = localStorage.getItem('sb_url') || '';
let SUPABASE_KEY = localStorage.getItem('sb_key') || '';
let allSuppliers = [];
let allPOs = [];
let selectedId = null;
let sortKey = 'supplier_code';
let sortAsc = true;

async function sbFetch(table, opts = {}) {
  const { method = 'GET', query = '', body } = opts;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method,
    headers: {
      'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : ''
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error((await res.json()).message || 'Error');
  return method !== 'DELETE' ? res.json().catch(() => null) : null;
}

async function loadData() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  showLoading(true);
  try {
    const [sups, pos] = await Promise.all([
      sbFetch('suppliers', { query: '?select=*&order=supplier_code' }),
      sbFetch('purchase_orders', { query: '?select=po_id,supplier_id,po_number,order_date,total_amount,status' }),
    ]);
    allSuppliers = sups || [];
    allPOs = pos || [];
    filterTable();
    updateStats();
  } catch(e) { showToast('โหลดไม่ได้: ' + e.message, 'error'); }
  showLoading(false);
}

function updateStats() {
  document.getElementById('statTotal').textContent   = allSuppliers.length;
  document.getElementById('statActive').textContent  = allSuppliers.filter(s => s.is_active).length;
  document.getElementById('statInactive').textContent= allSuppliers.filter(s => !s.is_active).length;
  document.getElementById('statWithPO').textContent  = new Set(allPOs.map(p => p.supplier_id)).size;
}

function filterTable() {
  const search = document.getElementById('searchInput').value.toLowerCase();
  const status = document.getElementById('filterStatus').value;
  let list = allSuppliers.filter(s => {
    const matchSearch = !search ||
      (s.supplier_name||'').toLowerCase().includes(search) ||
      (s.supplier_code||'').toLowerCase().includes(search) ||
      (s.phone||'').includes(search) ||
      (s.contact_person||'').toLowerCase().includes(search);
    return matchSearch && (status === '' || String(s.is_active) === status);
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

function renderTable(list) {
  document.getElementById('tableCount').textContent = `${list.length} รายการ`;
  const tbody = document.getElementById('tableBody');
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">🔍</div><div>ไม่พบ Supplier</div></div></td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(s => {
    const poCount = allPOs.filter(p => p.supplier_id === s.supplier_id).length;
    return `<tr class="${s.supplier_id === selectedId ? 'selected' : ''}" onclick="selectSupplier(${s.supplier_id})">
      <td><span class="sup-code">${s.supplier_code || '—'}</span></td>
      <td>
        <div class="sup-name">${s.supplier_name}</div>
        ${poCount > 0 ? `<div class="sup-contact">📦 ${poCount} PO</div>` : ''}
      </td>
      <td><span style="font-size:13px">${s.contact_person || '—'}</span></td>
      <td><span class="sup-code">${s.phone || '—'}</span></td>
      <td><span style="font-family:'IBM Plex Mono',monospace;font-size:13px">${s.credit_days ? s.credit_days + ' วัน' : '—'}</span></td>
      <td><span class="status-badge ${s.is_active ? 'status-active' : 'status-inactive'}">${s.is_active ? '● ใช้งาน' : '● ปิด'}</span></td>
    </tr>`;
  }).join('');
}

function selectSupplier(id) {
  selectedId = id;
  const s = allSuppliers.find(x => x.supplier_id === id);
  if (!s) return;
  document.querySelectorAll('.sup-table tr').forEach(r => r.classList.remove('selected'));
  event.currentTarget.classList.add('selected');

  document.getElementById('panelCode').textContent = s.supplier_code || '—';
  document.getElementById('panelName').textContent = s.supplier_name;
  document.getElementById('panelStatus').innerHTML = `<span class="status-badge ${s.is_active ? 'status-active' : 'status-inactive'}">${s.is_active ? '● ใช้งาน' : '● ปิด'}</span>`;
  document.getElementById('panelCredit').textContent  = s.credit_days ? s.credit_days + ' วัน' : '—';
  document.getElementById('panelContact').textContent = s.contact_person || '—';
  document.getElementById('panelTaxId').textContent   = s.tax_id || '—';
  document.getElementById('panelPhone').textContent   = s.phone || '—';
  document.getElementById('panelEmail').textContent   = s.email || '—';

  const webEl = document.getElementById('panelWebsite');
  if (s.website) {
    webEl.textContent = s.website;
    webEl.href = s.website.startsWith('http') ? s.website : 'https://' + s.website;
  } else { webEl.textContent = '—'; webEl.href = '#'; }

  document.getElementById('panelAddress').textContent = s.address || '—';

  const mapEl = document.getElementById('panelMap');
  if (s.map_url) { mapEl.textContent = 'เปิดแผนที่ 🗺️'; mapEl.href = s.map_url; }
  else { mapEl.textContent = '—'; mapEl.href = '#'; }

  const noteSection = document.getElementById('panelNoteSection');
  if (s.note) { document.getElementById('panelNote').textContent = s.note; noteSection.style.display = 'block'; }
  else noteSection.style.display = 'none';

  const pos = allPOs.filter(p => p.supplier_id === id).sort((a,b) => new Date(b.order_date) - new Date(a.order_date)).slice(0, 5);
  const poEl = document.getElementById('panelPOHistory');
  poEl.innerHTML = pos.length === 0
    ? `<div style="text-align:center;padding:16px;color:var(--text3);font-size:13px">ยังไม่มี PO</div>`
    : pos.map(p => `<div class="po-item">
        <div><div class="po-ref">${p.po_number}</div>
        <div class="po-date">${new Date(p.order_date).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'2-digit'})}</div></div>
        <span class="status-badge ${p.status==='APPROVED'||p.status==='RECEIVED'?'status-active':''}" style="font-size:10px">${p.status}</span>
        <div class="po-amount">฿${parseFloat(p.total_amount||0).toLocaleString('th-TH',{minimumFractionDigits:2})}</div>
      </div>`).join('');

  document.getElementById('sidePanel').classList.add('open');
}

function closePanel() {
  document.getElementById('sidePanel').classList.remove('open');
  document.querySelectorAll('.sup-table tr').forEach(r => r.classList.remove('selected'));
  selectedId = null;
}

function generateNextSupplierCode() {
  const codes = allSuppliers.map(s => (s.supplier_code || '').match(/^SUP-(\d+)$/)?.[1]).filter(Boolean).map(Number);
  const next = codes.length ? Math.max(...codes) + 1 : 1;
  return 'SUP-' + String(next).padStart(3, '0');
}

function openModal(data = null) {
  document.getElementById('modalTitle').textContent  = data ? 'แก้ไข Supplier' : 'เพิ่ม Supplier ใหม่';
  document.getElementById('editId').value    = data?.supplier_id || '';
  document.getElementById('fCode').value     = data?.supplier_code || (data ? '' : generateNextSupplierCode());
  document.getElementById('fName').value     = data?.supplier_name || '';
  document.getElementById('fContact').value  = data?.contact_person || '';
  document.getElementById('fPhone').value    = data?.phone || '';
  document.getElementById('fEmail').value    = data?.email || '';
  document.getElementById('fWebsite').value  = data?.website || '';
  document.getElementById('fTaxId').value    = data?.tax_id || '';
  document.getElementById('fCredit').value   = data?.credit_days || '';
  document.getElementById('fAddress').value  = data?.address || '';
  document.getElementById('fNote').value     = data?.note || '';
  document.getElementById('fStatus').value   = data ? String(data.is_active !== false) : 'true';
  document.getElementById('fMap').value      = data?.map_url || '';
  const parsed = parseLatLonFromUrl(data?.map_url || '');
  document.getElementById('fLat').value      = parsed?.lat || '';
  document.getElementById('fLon').value      = parsed?.lon || '';
  document.getElementById('supSearchInput').value = '';
  document.getElementById('supSearchResults').innerHTML = '';
  const mapEl = document.getElementById('mapPreview');
  mapEl.style.display = 'none';
  mapEl.innerHTML = '';
  supMap = null; supMarker = null;
  if (parsed?.lat && parsed?.lon) initSupMap(parsed.lat, parsed.lon);
  updateOpenMapLink();
  document.getElementById('modalOverlay').classList.add('open');
  setTimeout(() => document.getElementById('fName').focus(), 100);
}

function parseLatLonFromUrl(url) {
  if (!url) return null;
  const m = url.match(/[?&@]q?=?([-\d.]+),([-\d.]+)/) || url.match(/@([-\d.]+),([-\d.]+)/);
  if (m) return { lat: parseFloat(m[1]), lon: parseFloat(m[2]) };
  return null;
}

// ── Leaflet map preview ──
let supMap = null, supMarker = null;
function initSupMap(lat, lon) {
  if (typeof L === 'undefined') return;
  const el = document.getElementById('mapPreview');
  if (!el) return;
  el.style.display = 'block';
  if (!supMap) {
    supMap = L.map(el).setView([lat || 13.75, lon || 100.5], lat ? 15 : 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap', maxZoom: 19 }).addTo(supMap);
    supMap.on('click', (e) => {
      const { lat, lng } = e.latlng;
      setSupMarker(lat, lng);
      document.getElementById('fMap').value = `https://www.google.com/maps?q=${lat},${lng}`;
      updateOpenMapLink();
    });
  }
  if (lat && lon) { setSupMarker(lat, lon); supMap.setView([lat, lon], 15); }
  setTimeout(() => supMap.invalidateSize(), 100);
}
function setSupMarker(lat, lon) {
  if (!supMap) return;
  if (supMarker) supMarker.setLatLng([lat, lon]);
  else supMarker = L.marker([lat, lon]).addTo(supMap);
  document.getElementById('fLat').value = lat;
  document.getElementById('fLon').value = lon;
}
function updateOpenMapLink() {
  const url = document.getElementById('fMap').value.trim();
  const btn = document.getElementById('btnOpenMap');
  if (btn) btn.href = url || '#';
}

// ── Place search (Nominatim) ──
async function searchSupplierPlace() {
  const input = document.getElementById('supSearchInput');
  const results = document.getElementById('supSearchResults');
  const q = (input?.value || '').trim();
  if (!q) { results.innerHTML = ''; return; }
  results.innerHTML = '<div class="sup-search-loading">🔍 กำลังค้นหา...</div>';
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&addressdetails=1&limit=5&countrycodes=th&accept-language=th`;
    const res = await fetch(url, { headers: { 'User-Agent': 'A4S-ERP/1.0' } });
    const data = await res.json();
    if (!data.length) { results.innerHTML = '<div class="sup-search-loading">ไม่พบผลลัพธ์</div>'; return; }
    results.innerHTML = data.map((p, i) => {
      const fullAddr = p.display_name || '';
      const type = p.type ? p.type.replace(/_/g, ' ') : '';
      return `<div class="sup-result-item" data-idx="${i}">
        <div style="font-size:20px;flex-shrink:0;padding-top:2px">📍</div>
        <div style="flex:1;min-width:0">
          <div class="sup-result-name">${p.name || q}</div>
          <div class="sup-result-addr">${fullAddr}</div>
          ${type ? `<div class="sup-result-type">${type}</div>` : ''}
        </div></div>`;
    }).join('');
    results.querySelectorAll('[data-idx]').forEach((el) => {
      el.addEventListener('click', () => {
        fillSupplierFromSearch(data[parseInt(el.dataset.idx)]);
        results.innerHTML = '';
        input.value = '';
      });
    });
  } catch (e) {
    results.innerHTML = '<div class="sup-search-loading">เกิดข้อผิดพลาด: ' + e.message + '</div>';
  }
}

function fillSupplierFromSearch(p) {
  const addr = p.address || {};
  if (!document.getElementById('fName').value.trim()) document.getElementById('fName').value = p.name || '';
  const parts = [addr.road, addr.suburb, addr.town || addr.village, addr.city_district, addr.city, addr.state].filter(Boolean);
  const postcode = addr.postcode || '';
  document.getElementById('fAddress').value = parts.join(' ') + (postcode ? ' ' + postcode : '');
  if (p.lat && p.lon) {
    const lat = parseFloat(p.lat), lon = parseFloat(p.lon);
    document.getElementById('fMap').value = `https://www.google.com/maps?q=${lat},${lon}`;
    document.getElementById('fLat').value = lat;
    document.getElementById('fLon').value = lon;
    initSupMap(lat, lon);
    updateOpenMapLink();
  }
  if (p.osm_type && p.osm_id) {
    const typeChar = p.osm_type === 'relation' ? 'R' : p.osm_type === 'way' ? 'W' : 'N';
    fetch(`https://nominatim.openstreetmap.org/details?osmtype=${typeChar}&osmid=${p.osm_id}&format=json&addressdetails=1&extratags=1`, {
      headers: { 'User-Agent': 'A4S-ERP/1.0' }
    }).then(r => r.json()).then(detail => {
      const tags = detail.extratags || {};
      if (tags.phone && !document.getElementById('fPhone').value) document.getElementById('fPhone').value = tags.phone;
      if (tags.website && !document.getElementById('fWebsite').value) document.getElementById('fWebsite').value = tags.website;
      if (tags.email && !document.getElementById('fEmail').value) document.getElementById('fEmail').value = tags.email;
    }).catch(() => {});
  }
}
window.searchSupplierPlace = searchSupplierPlace;

function editSelected() { if (!selectedId) return; openModal(allSuppliers.find(s => s.supplier_id === selectedId)); }
function closeModal() { document.getElementById('modalOverlay').classList.remove('open'); }
function closeModalBg(e) { if (e.target === document.getElementById('modalOverlay')) closeModal(); }

async function saveSupplier() {
  const name = document.getElementById('fName').value.trim();
  if (!name) { showToast('กรุณากรอกชื่อ Supplier', 'error'); return; }
  if (!SUPABASE_URL || !SUPABASE_KEY) { showToast('กรุณาเชื่อมต่อ Supabase ก่อน', 'warning'); return; }

  const payload = {
    supplier_code:  document.getElementById('fCode').value.trim() || generateNextSupplierCode(),
    supplier_name:  name,
    contact_person: document.getElementById('fContact').value.trim() || null,
    phone:          document.getElementById('fPhone').value.trim() || null,
    email:          document.getElementById('fEmail').value.trim() || null,
    website:        document.getElementById('fWebsite').value.trim() || null,
    tax_id:         document.getElementById('fTaxId').value.trim() || null,
    credit_days:    parseInt(document.getElementById('fCredit').value) || null,
    address:        document.getElementById('fAddress').value.trim() || null,
    map_url:        document.getElementById('fMap').value.trim() || null,
    note:           document.getElementById('fNote').value.trim() || null,
    is_active:      document.getElementById('fStatus').value === 'true',
  };

  showLoading(true);
  try {
    const editId = document.getElementById('editId').value;
    if (editId) {
      await sbFetch('suppliers', { method:'PATCH', query:`?supplier_id=eq.${editId}`, body: payload });
      showToast('✅ แก้ไข Supplier สำเร็จ!', 'success');
    } else {
      await sbFetch('suppliers', { method:'POST', body: payload });
      showToast('✅ เพิ่ม Supplier สำเร็จ!', 'success');
    }
    closeModal(); await loadData();
  } catch(e) { showToast('เกิดข้อผิดพลาด: ' + e.message, 'error'); }
  showLoading(false);
}

async function deleteSelected() {
  if (!selectedId) return;
  const s = allSuppliers.find(x => x.supplier_id === selectedId);
  if (!confirm(`ลบ "${s?.supplier_name}" ออกจากระบบ?`)) return;
  showLoading(true);
  try {
    await sbFetch('suppliers', { method:'DELETE', query:`?supplier_id=eq.${selectedId}` });
    showToast('ลบ Supplier แล้ว', 'success');
    closePanel(); await loadData();
  } catch(e) { showToast('ลบไม่ได้: ' + e.message, 'error'); }
  showLoading(false);
}

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove('show'), 3000);
}
function showLoading(show) { document.getElementById('loadingOverlay').classList.toggle('show', show); }

window.addEventListener('DOMContentLoaded', () => {
  if (SUPABASE_URL && SUPABASE_KEY) setTimeout(() => loadData(), 50);

  const si = document.getElementById('supSearchInput');
  if (si) si.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); searchSupplierPlace(); }
  });
  const fm = document.getElementById('fMap');
  if (fm) fm.addEventListener('input', () => {
    updateOpenMapLink();
    const p = parseLatLonFromUrl(fm.value.trim());
    if (p) { document.getElementById('fLat').value = p.lat; document.getElementById('fLon').value = p.lon; initSupMap(p.lat, p.lon); }
  });
});