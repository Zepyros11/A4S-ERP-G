/* ============================================================
   company-settings.js — หน้า "ตั้งค่าบริษัท"
   เก็บข้อมูลบริษัท + โลโก้ใน DB (app_settings + bucket company-assets)
   → ใช้ร่วมกันทุกเครื่อง · localStorage = cache สำหรับแสดงผลทันที
   ============================================================ */

let SUPABASE_URL = localStorage.getItem('sb_url') || '';
let SUPABASE_KEY = localStorage.getItem('sb_key') || '';

// Auth guard — เหมือนหน้าตั้งค่าอื่นๆ
const _hasSession  = localStorage.getItem('erp_session') || sessionStorage.getItem('erp_session');
const _hasSupabase = localStorage.getItem('sb_url');
if (_hasSupabase && !_hasSession) {
  sessionStorage.setItem('erp_redirect', window.location.pathname);
  window.location.replace('/login.html');
}
if (_hasSession) window.ERP_USER = JSON.parse(_hasSession);

const COMPANY_BUCKET = 'company-assets';
// input element id → app_settings key (= localStorage cache key)
const COMPANY_FIELDS = {
  companyName:      'company_name',
  companyNameEn:    'company_name_en',
  taxId:            'company_tax_id',
  companyWebsite:   'company_website',
  companyAddress:   'company_address',
  companyAddressEn: 'company_address_en',
  companyPhone:     'company_phone',
  companyEmail:     'company_email',
};
let companyLogoUrl = '';

window.addEventListener('DOMContentLoaded', () => {
  paintCompanyFromCache();
  if (SUPABASE_URL && SUPABASE_KEY) {
    loadCompanyInfo();
  } else {
    document.getElementById('noConn').style.display = 'block';
  }
});

async function supabaseFetch(table, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

// Instant paint from localStorage cache (falls back to legacy un-prefixed keys)
function paintCompanyFromCache() {
  const legacy = { company_tax_id: 'tax_id' };  // old key names before migration 135
  for (const [elId, key] of Object.entries(COMPANY_FIELDS)) {
    const el = document.getElementById(elId);
    if (el) el.value = localStorage.getItem(key) || (legacy[key] ? localStorage.getItem(legacy[key]) : '') || '';
  }
  companyLogoUrl = localStorage.getItem('company_logo_url') || '';
  renderLogoPreview();
}

// Pull company info from DB (app_settings) → fill form + refresh cache
async function loadCompanyInfo() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    const rows = await supabaseFetch('app_settings', '?select=key,value&key=like.company_*');
    const map = {};
    (rows || []).forEach(r => { map[r.key] = r.value || ''; });
    // Apply DB value only when it's non-empty — protects legacy localStorage data
    // on the first connect after migration 135 (seeded rows are blank).
    for (const [elId, key] of Object.entries(COMPANY_FIELDS)) {
      const val = map[key];
      if (val) {
        const el = document.getElementById(elId);
        if (el) el.value = val;
        localStorage.setItem(key, val);
      }
    }
    if (map['company_logo_url']) {
      companyLogoUrl = map['company_logo_url'];
      localStorage.setItem('company_logo_url', companyLogoUrl);
      renderLogoPreview();
    }
    const pill = document.getElementById('companyStatus');
    if (pill) {
      pill.style.display = '';
      pill.className = 'status-dot dot-connected';
      pill.innerHTML = '<span class="dot-pulse"></span> โหลดจากฐานข้อมูล';
    }
  } catch(e) { console.error('loadCompanyInfo:', e); }
}

// Batch upsert into app_settings (key = PK). Only key+value sent → description preserved.
async function upsertSettings(rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/app_settings?on_conflict=key`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => 'HTTP ' + res.status));
}

async function saveCompanyInfo() {
  if (!SUPABASE_URL || !SUPABASE_KEY) { showToast('กรุณาเชื่อมต่อ Supabase ก่อน (หน้าตั้งค่าระบบ)', 'warning'); return; }
  showLoading(true);
  try {
    const rows = [];
    for (const [elId, key] of Object.entries(COMPANY_FIELDS)) {
      const val = (document.getElementById(elId).value || '').trim();
      rows.push({ key, value: val });
      localStorage.setItem(key, val);
    }
    rows.push({ key: 'company_logo_url', value: companyLogoUrl || '' });
    localStorage.setItem('company_logo_url', companyLogoUrl || '');
    await upsertSettings(rows);
    showToast('✅ บันทึกข้อมูลบริษัทแล้ว', 'success');
  } catch(e) { showToast('บันทึกไม่ได้: ' + e.message, 'error'); }
  showLoading(false);
}

// ── Company logo ──
function renderLogoPreview() {
  const box = document.getElementById('logoPreview');
  const rm  = document.getElementById('logoRemoveBtn');
  if (!box) return;
  if (companyLogoUrl) {
    box.innerHTML = `<img src="${companyLogoUrl}" alt="โลโก้บริษัท">`;
    if (rm) rm.style.display = '';
  } else {
    box.innerHTML = `<span class="logo-placeholder">ยังไม่มีโลโก้</span>`;
    if (rm) rm.style.display = 'none';
  }
}

// Resize a logo to keep egress small while preserving transparency.
// PNG/WebP → PNG (keeps alpha) · others → JPEG q0.85 · SVG → as-is.
function resizeLogo(file) {
  return new Promise((resolve, reject) => {
    if (file.type === 'image/svg+xml') { resolve({ blob: file, ext: 'svg' }); return; }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 600;
      let { width: w, height: h } = img;
      if (w > MAX || h > MAX) { const s = Math.min(MAX / w, MAX / h); w = Math.round(w * s); h = Math.round(h * s); }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const keepAlpha = /png|webp/.test(file.type);
      const mime = keepAlpha ? 'image/png' : 'image/jpeg';
      const ext  = keepAlpha ? 'png' : 'jpg';
      canvas.toBlob(b => b ? resolve({ blob: b, ext }) : reject(new Error('แปลงรูปไม่สำเร็จ')), mime, keepAlpha ? undefined : 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('อ่านไฟล์ภาพไม่สำเร็จ')); };
    img.src = url;
  });
}

function logoObjectPath(url) {
  const m = String(url || '').match(/\/company-assets\/(.+)$/);
  return m ? m[1].split('?')[0] : null;
}

async function deleteLogoObject(url) {
  const path = logoObjectPath(url);
  if (!path) return;
  try {
    await fetch(`${SUPABASE_URL}/storage/v1/object/${COMPANY_BUCKET}/${path}`, {
      method: 'DELETE', headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    });
  } catch(_) { /* best-effort cleanup */ }
}

async function onLogoSelected(ev) {
  const file = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  if (!SUPABASE_URL || !SUPABASE_KEY) { showToast('กรุณาเชื่อมต่อ Supabase ก่อน (หน้าตั้งค่าระบบ)', 'warning'); return; }
  if (!/^image\//.test(file.type)) { showToast('รับเฉพาะไฟล์ภาพ', 'error'); return; }
  showLoading(true);
  try {
    const { blob, ext } = await resizeLogo(file);
    const path = `logo-${Date.now()}.${ext}`;
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${COMPANY_BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': blob.type || 'image/png', 'x-upsert': 'true',
      },
      body: blob,
    });
    if (!res.ok) {
      if (res.status === 404 || res.status === 405) throw new Error('ยังไม่ได้สร้าง bucket "company-assets" — รัน sql/135_company_assets_bucket.sql ใน Supabase');
      if (res.status === 403) throw new Error('Permission denied — เช็ค RLS policy (รัน sql/135 ใหม่)');
      if (res.status === 413) throw new Error('ไฟล์ใหญ่เกิน 10 MB');
      throw new Error('HTTP ' + res.status);
    }
    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${COMPANY_BUCKET}/${path}`;
    const prev = companyLogoUrl;
    companyLogoUrl = publicUrl;
    renderLogoPreview();
    await upsertSettings([{ key: 'company_logo_url', value: publicUrl }]);
    localStorage.setItem('company_logo_url', publicUrl);
    if (prev && prev !== publicUrl) deleteLogoObject(prev);
    showToast('✅ อัปโหลดโลโก้แล้ว', 'success');
  } catch(e) { showToast('อัปโหลดไม่ได้: ' + e.message, 'error'); }
  showLoading(false);
}

async function removeLogo() {
  if (!companyLogoUrl) return;
  const ok = await ConfirmModal.open({
    title: 'ลบโลโก้', message: 'ลบโลโก้บริษัทออก?', icon: '🗑️',
    okText: 'ลบ', tone: 'danger',
  });
  if (!ok) return;
  showLoading(true);
  try {
    const prev = companyLogoUrl;
    companyLogoUrl = '';
    renderLogoPreview();
    await upsertSettings([{ key: 'company_logo_url', value: '' }]);
    localStorage.setItem('company_logo_url', '');
    deleteLogoObject(prev);
    showToast('ลบโลโก้แล้ว', 'success');
  } catch(e) { showToast('ลบไม่ได้: ' + e.message, 'error'); }
  showLoading(false);
}

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove('show'), 3500);
}
function showLoading(show) { document.getElementById('loadingOverlay').classList.toggle('show', show); }
