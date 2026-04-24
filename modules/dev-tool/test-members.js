/* ============================================================
   test-members.js — CRUD สมาชิกจำลอง (mock) สำหรับ test flow
   - แยกจาก MLM members · schema เหมือนกัน
   - password เก็บทั้ง encrypted (AES-GCM) + hash (SHA-256)
   - ปุ่ม 🎲 สุ่มข้อมูล auto-fill
   ============================================================ */

const SUPABASE_URL = localStorage.getItem('sb_url') || '';
const SUPABASE_KEY = localStorage.getItem('sb_key') || '';

let allRows = [];           // all test members
let editingCode = null;     // null = create, string = edit
let decryptMode = false;
let decryptedCache = {};    // member_code → { password, national_id }

function _sbHeaders(extra = {}) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    ...extra,
  };
}

/* ============================================================
   LOAD / RENDER
   ============================================================ */
async function loadData() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    showToast('กรุณาตั้งค่า Supabase ก่อน', 'error');
    return;
  }
  showLoading(true);
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/test_members?select=*&order=created_at.desc`,
      { headers: _sbHeaders() }
    );
    if (!res.ok) throw new Error('โหลดไม่สำเร็จ (' + res.status + ')');
    allRows = await res.json();
    renderStats();
    renderTable();
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
    document.getElementById('tbody').innerHTML =
      `<tr><td colspan="9" class="tm-empty"><div class="tm-empty-icon">⚠️</div>${escapeHtml(e.message)}</td></tr>`;
  } finally {
    showLoading(false);
  }
}
window.loadData = loadData;

function renderStats() {
  const total = allRows.length;
  const withHash = allRows.filter(r => r.password_hash).length;
  const withUpline = allRows.filter(r => r.upline_code).length;
  const pkgSet = new Set(allRows.map(r => r.package).filter(Boolean));
  document.getElementById('statTotal').textContent = total.toLocaleString();
  document.getElementById('statWithHash').textContent = withHash.toLocaleString();
  document.getElementById('statWithUpline').textContent = withUpline.toLocaleString();
  document.getElementById('statPackages').textContent = pkgSet.size;
}

function renderTable() {
  const q = (document.getElementById('searchInput').value || '').trim().toLowerCase();
  const pkg = document.getElementById('filterPackage').value;

  let rows = allRows;
  if (pkg) rows = rows.filter(r => r.package === pkg);
  if (q) {
    rows = rows.filter(r => {
      const hay = [
        r.member_code, r.full_name, r.member_name, r.phone,
        r.sponsor_code, r.upline_code, r.email,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }

  const tbody = document.getElementById('tbody');
  if (!rows.length) {
    tbody.innerHTML =
      `<tr><td colspan="9" class="tm-empty"><div class="tm-empty-icon">🧪</div>` +
      (allRows.length ? 'ไม่พบรายการที่ตรงกับ filter' : 'ยังไม่มี test member — กด "➕ สร้าง Test Member"') +
      `</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const code    = escapeHtml(r.member_code);
    const name    = escapeHtml(r.full_name || r.member_name || '—');
    const phone   = escapeHtml(r.phone || '—');
    const sponsor = escapeHtml(r.sponsor_code || '—');
    const upline  = escapeHtml(r.upline_code || '—');
    const side    = escapeHtml(r.side || '—');
    const pkgHtml = r.package
      ? `<span class="tm-pkg tm-pkg-${r.package}">${escapeHtml(r.package)}</span>`
      : '—';

    let pwHtml = '<span class="tm-mask">—</span>';
    if (r.password_encrypted) {
      if (decryptMode && decryptedCache[r.member_code]?.password) {
        pwHtml = `<span class="tm-plain">${escapeHtml(decryptedCache[r.member_code].password)}</span>`;
      } else {
        pwHtml = '<span class="tm-mask">••••••••</span>';
      }
    }

    return `
      <tr>
        <td><span class="tm-code">${code}</span></td>
        <td><span class="tm-name">${name}</span></td>
        <td>${phone}</td>
        <td>${pwHtml}</td>
        <td>${pkgHtml}</td>
        <td><span class="tm-code">${sponsor}</span></td>
        <td><span class="tm-code">${upline}</span></td>
        <td>${side}</td>
        <td>
          <div class="tm-row-actions">
            <button class="tm-row-btn" title="แก้ไข" onclick="openEditModal('${encodeURIComponent(r.member_code)}')">✏️</button>
            <button class="tm-row-btn danger" title="ลบ" onclick="deleteMember('${encodeURIComponent(r.member_code)}')">🗑️</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}
window.renderTable = renderTable;

/* ============================================================
   DECRYPT TOGGLE
   ============================================================ */
async function toggleDecrypt() {
  if (decryptMode) {
    decryptMode = false;
    decryptedCache = {};
    document.getElementById('btnDecrypt').textContent = '🔓 ถอดรหัส';
    renderTable();
    return;
  }

  if (!ERPCrypto.hasMasterKey()) {
    showToast('❌ ยังไม่ได้ตั้ง Master Key — ไปตั้งที่หน้า "ข้อมูลสมาชิก" ก่อน', 'error');
    return;
  }
  const ok = await ERPCrypto.verifyMasterKey();
  if (!ok) {
    showToast('❌ Master Key ไม่ถูกต้อง', 'error');
    return;
  }

  showLoading(true);
  try {
    for (const r of allRows) {
      if (!r.password_encrypted) continue;
      try {
        const pw = await ERPCrypto.decrypt(r.password_encrypted);
        const nid = r.national_id_encrypted
          ? await ERPCrypto.decrypt(r.national_id_encrypted)
          : null;
        decryptedCache[r.member_code] = { password: pw, national_id: nid };
      } catch { /* skip row on error */ }
    }
    decryptMode = true;
    document.getElementById('btnDecrypt').textContent = '🔒 ซ่อนรหัส';
    renderTable();
  } finally {
    showLoading(false);
  }
}
window.toggleDecrypt = toggleDecrypt;

/* ============================================================
   FORM MODAL
   ============================================================ */
function _clearForm() {
  ['fCode','fFullName','fMemberName','fPhone','fEmail','fPassword','fNationalId','fSponsor','fUpline','fNote','fRegisteredAt']
    .forEach(id => document.getElementById(id).value = '');
  document.getElementById('fPackage').value = '';
  document.getElementById('fCountry').value = 'TH';
  document.getElementById('fSide').value = '';
}

function openCreateModal() {
  editingCode = null;
  _clearForm();
  document.getElementById('formTitle').textContent = '➕ สร้าง Test Member';
  document.getElementById('fCode').readOnly = false;
  document.getElementById('fRegisteredAt').value = _todayISO();
  document.getElementById('formOverlay').classList.add('open');
  setTimeout(() => document.getElementById('fCode').focus(), 60);
}
window.openCreateModal = openCreateModal;

async function openEditModal(codeEnc) {
  const code = decodeURIComponent(codeEnc);
  const r = allRows.find(x => x.member_code === code);
  if (!r) return;
  editingCode = code;
  _clearForm();

  document.getElementById('formTitle').textContent = '✏️ แก้ไข Test Member · ' + code;
  document.getElementById('fCode').value = r.member_code;
  document.getElementById('fCode').readOnly = true;
  document.getElementById('fFullName').value   = r.full_name || '';
  document.getElementById('fMemberName').value = r.member_name || '';
  document.getElementById('fPhone').value      = r.phone || '';
  document.getElementById('fEmail').value      = r.email || '';
  document.getElementById('fPackage').value    = r.package || '';
  document.getElementById('fCountry').value    = r.country_code || 'TH';
  document.getElementById('fSponsor').value    = r.sponsor_code || '';
  document.getElementById('fUpline').value     = r.upline_code || '';
  document.getElementById('fSide').value       = r.side || '';
  document.getElementById('fNote').value       = r.note || '';
  document.getElementById('fRegisteredAt').value = r.registered_at || '';

  // Try decrypt password/NID if master key set
  const pwEl  = document.getElementById('fPassword');
  const nidEl = document.getElementById('fNationalId');
  if (r.password_encrypted || r.national_id_encrypted) {
    if (ERPCrypto.hasMasterKey() && await ERPCrypto.verifyMasterKey()) {
      try {
        if (r.password_encrypted)    pwEl.value  = await ERPCrypto.decrypt(r.password_encrypted) || '';
        if (r.national_id_encrypted) nidEl.value = await ERPCrypto.decrypt(r.national_id_encrypted) || '';
      } catch {}
    } else {
      pwEl.placeholder  = '•••••••• (ตั้ง master key เพื่อ decrypt)';
      nidEl.placeholder = '••••••••••••• (ตั้ง master key เพื่อ decrypt)';
    }
  }

  document.getElementById('formOverlay').classList.add('open');
}
window.openEditModal = openEditModal;

function closeFormModal() {
  document.getElementById('formOverlay').classList.remove('open');
  editingCode = null;
}
window.closeFormModal = closeFormModal;

/* ============================================================
   SAVE (create / update)
   ============================================================ */
async function saveForm() {
  const code     = document.getElementById('fCode').value.trim();
  const pwPlain  = document.getElementById('fPassword').value;
  const nidPlain = document.getElementById('fNationalId').value.trim();

  if (!code) { showToast('กรอกรหัสสมาชิก', 'error'); return; }
  if (!editingCode && !pwPlain) { showToast('กรอกรหัสผ่าน', 'error'); return; }

  // Encryption requires master key (only if password or NID provided)
  const needEncrypt = !!(pwPlain || nidPlain);
  if (needEncrypt) {
    if (!ERPCrypto.hasMasterKey()) {
      showToast('❌ ต้องตั้ง Master Key ก่อน — ไปตั้งที่หน้า "ข้อมูลสมาชิก"', 'error');
      return;
    }
    if (!(await ERPCrypto.verifyMasterKey())) {
      showToast('❌ Master Key ไม่ถูกต้อง', 'error');
      return;
    }
  }

  const btn = document.getElementById('btnSaveForm');
  btn.disabled = true;
  btn.textContent = '⏳ กำลังบันทึก...';

  try {
    const payload = {
      member_code:    code,
      full_name:      document.getElementById('fFullName').value.trim() || null,
      member_name:    document.getElementById('fMemberName').value.trim() || null,
      phone:          document.getElementById('fPhone').value.trim() || null,
      email:          document.getElementById('fEmail').value.trim() || null,
      package:        document.getElementById('fPackage').value || null,
      country_code:   document.getElementById('fCountry').value || null,
      sponsor_code:   document.getElementById('fSponsor').value.trim() || null,
      upline_code:    document.getElementById('fUpline').value.trim() || null,
      side:           document.getElementById('fSide').value || null,
      registered_at:  document.getElementById('fRegisteredAt').value || null,
      note:           document.getElementById('fNote').value.trim() || null,
      member_type:    'TEST',
    };

    if (pwPlain) {
      payload.password_encrypted = await ERPCrypto.encrypt(pwPlain);
      payload.password_hash      = await ERPCrypto.hash(pwPlain);
    }
    if (nidPlain) {
      payload.national_id_encrypted = await ERPCrypto.encrypt(nidPlain);
    }

    let url, method;
    if (editingCode) {
      url = `${SUPABASE_URL}/rest/v1/test_members?member_code=eq.${encodeURIComponent(editingCode)}`;
      method = 'PATCH';
    } else {
      url = `${SUPABASE_URL}/rest/v1/test_members`;
      method = 'POST';
    }

    const res = await fetch(url, {
      method,
      headers: _sbHeaders({
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      }),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      if (res.status === 409 || errText.includes('duplicate')) {
        throw new Error('รหัสสมาชิก "' + code + '" ซ้ำแล้ว');
      }
      throw new Error(`Save ${res.status}: ${errText.slice(0, 200)}`);
    }

    showToast(editingCode ? '✅ อัพเดทแล้ว' : '✅ สร้างแล้ว', 'success');
    closeFormModal();
    await loadData();
  } catch (e) {
    showToast('❌ ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 บันทึก';
  }
}
window.saveForm = saveForm;

/* ============================================================
   DELETE
   ============================================================ */
async function deleteMember(codeEnc) {
  const code = decodeURIComponent(codeEnc);
  const r = allRows.find(x => x.member_code === code);
  if (!r) return;

  const ok = await ConfirmModal.open({
    title: 'ลบ Test Member?',
    message: `ยืนยันการลบสมาชิกทดสอบนี้?`,
    icon: '🗑️',
    okText: 'ลบ',
    cancelText: 'ยกเลิก',
    tone: 'danger',
    details: {
      'รหัส': r.member_code,
      'ชื่อ': r.full_name || r.member_name || '—',
      'เบอร์': r.phone || '—',
    },
  });
  if (!ok) return;

  showLoading(true);
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/test_members?member_code=eq.${encodeURIComponent(code)}`,
      { method: 'DELETE', headers: _sbHeaders() }
    );
    if (!res.ok) throw new Error('ลบไม่สำเร็จ (' + res.status + ')');
    showToast('🗑️ ลบแล้ว', 'success');
    await loadData();
  } catch (e) {
    showToast('❌ ' + e.message, 'error');
  } finally {
    showLoading(false);
  }
}
window.deleteMember = deleteMember;

/* ============================================================
   RANDOM DATA GENERATOR  🎲
   ============================================================ */
const _firstNamesTH = [
  'สมชาย','สมหญิง','อนันต์','ปิยะ','วิชัย','สุดารัตน์','ณัฐพงษ์','พิมพ์ชนก','ธีระศักดิ์','กัญญา',
  'ภูวดล','ชลธิชา','ณัฐวุฒิ','ศศิธร','กฤษณะ','มาลี','ปรีชา','นิภา','พงศกร','อรทัย',
  'สุพจน์','วิภา','รัชนก','ธนพล','ประไพ','ศักดิ์ชัย','จิราภรณ์','อุดม','เพ็ญศรี','เกรียงไกร',
];
const _lastNamesTH = [
  'ใจดี','รักเรียน','สุขสบาย','วงศ์ศรี','แก้วสว่าง','ทรัพย์มั่น','พงษ์เจริญ','ศรีสุข','กล้าหาญ','มีนา',
  'สายทอง','โชคดี','มีชัย','พรหมทอง','บุญมี','เรืองศรี','พุฒิพงศ์','อินทร์จันทร์','สุขเสรี','วารีนิล',
  'ทดสอบ','เทสเตอร์','จำลอง','สมมติ','ดัมมี่',
];
const _packages = ['DM','SI','PL','MB','EM'];
const _sides    = ['ซ้าย','ขวา'];
const _countries = ['TH','KH','LA','MM'];

function _pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function _randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function _randPhone() {
  const head = _pick(['08','09','06']);
  const rest = Array.from({length:8}, () => _randInt(0,9)).join('');
  return head + rest;
}
function _randNationalId() {
  return Array.from({length:13}, () => _randInt(0,9)).join('');
}
function _randCode() {
  return String(_randInt(1000, 9999));
}
function _todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function _randDateISO(daysAgo = 365) {
  const d = new Date(Date.now() - _randInt(0, daysAgo) * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function _randPassword() {
  return '1234';
}

function fillRandom() {
  const first = _pick(_firstNamesTH);
  const last  = _pick(_lastNamesTH);
  const full  = `${first} ${last}`;

  // Generate a code that doesn't collide with existing rows (best-effort)
  let code = _randCode();
  for (let i = 0; i < 5 && allRows.some(r => r.member_code === code); i++) {
    code = _randCode();
  }

  // Random sponsor/upline: pick from existing test members if any, else random code
  const pickExisting = allRows.length > 0 && Math.random() < 0.7;
  const sponsor = pickExisting ? _pick(allRows).member_code : _randCode();
  const upline  = pickExisting ? _pick(allRows).member_code : sponsor;

  // Only fill empty code field if creating (don't overwrite in edit mode)
  if (!editingCode) {
    document.getElementById('fCode').value = code;
  }
  document.getElementById('fFullName').value    = full;
  document.getElementById('fMemberName').value  = first;
  document.getElementById('fPhone').value       = _randPhone();
  document.getElementById('fEmail').value       = `test${_randInt(1000,9999)}@example.com`;
  document.getElementById('fPassword').value    = _randPassword();
  document.getElementById('fNationalId').value  = _randNationalId();
  document.getElementById('fPackage').value     = _pick(_packages);
  document.getElementById('fCountry').value     = _pick(_countries);
  document.getElementById('fSponsor').value     = sponsor;
  document.getElementById('fUpline').value      = upline;
  document.getElementById('fSide').value        = _pick(_sides);
  document.getElementById('fRegisteredAt').value = _randDateISO(365);
  document.getElementById('fNote').value        = '🎲 auto-generated mock';

  showToast('🎲 สุ่มข้อมูลแล้ว — กด "บันทึก" เพื่อสร้าง', 'info');
}
window.fillRandom = fillRandom;

/* ============================================================
   UTILS
   ============================================================ */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function showLoading(on) {
  document.getElementById('loadingOverlay').style.display = on ? 'flex' : 'none';
}
function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show toast-${type}`;
  setTimeout(() => (t.className = 'toast'), 3500);
}

/* ============================================================
   INIT
   ============================================================ */
(async () => {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    showToast('กรุณาตั้งค่า Supabase ก่อน', 'error');
    return;
  }
  await loadData();
})();
