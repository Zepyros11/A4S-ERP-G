/* ============================================================
   members-import.js — นำเข้าข้อมูลสมาชิกจาก Excel → Supabase
   ============================================================ */

let SUPABASE_URL = localStorage.getItem('sb_url') || '';
let SUPABASE_KEY = localStorage.getItem('sb_key') || '';

/* ── State ── */
let parsedRows = [];          // all rows from Excel
let parsedHeaders = [];       // header row (column names)
let currentFile = null;
let revealSecrets = false;    // toggle — แสดงรหัสผ่าน/บัตร ปปช. ใน preview

/* ── Column mapping — header ภาษาไทย → field ใน DB ── */
const HEADER_MAP = {
  'วันที่สมัคร': 'registered_at',
  'วันเกิด': 'birth_date',
  'รหัสสมาชิก': 'member_code',
  'ชื่อสมาชิก': 'member_name',
  'ชื่อบุคคล': 'full_name',
  'ชื่อบุคคลธรรมดา': 'full_name',
  'โทรศัพท์': 'phone',
  'รหัสผ่าน': '__password_plain',       // ⚠️ will be encrypted
  'บัตรประชาชน': '__national_id_plain',  // ⚠️ will be encrypted
  'เลขบัตรประชาชน': '__national_id_plain',
  'ชื่อผู้สมัครร่วม': 'co_applicant_name',
  'ประชาชน': 'co_applicant_id',
  'เลขบัตรประชาชนผู้สมัครร่วม': 'co_applicant_id',
  'Package': 'package',
  'ตำแหน่ง': 'position',
  'ตำแหน่ง สูงสุด': 'position_level',
  'รหัสผู้แนะนำ': 'sponsor_code',
  'รหัสอัพไลน์': 'upline_code',
  'ด้าน': 'side',
  'สถานะเอกสาร': 'doc_status',
  'SP': 'sp_flag',
  'TN': 'tn_flag',
  'E-mail': 'email',
  'ประเภทสมาชิก': 'member_type',
  'ประเภทบุคคล': 'person_type',
  'เข้ากระเป๋า': 'wallet_percent',
  'เข้ากระเป๋า A': 'wallet_percent',
  'ช่องทางสมัคร': 'channel',
  'สัญชาติ': 'nationality',
  'LB': 'country_code',
};

const SENSITIVE_FIELDS = ['__password_plain', '__national_id_plain'];

/* Fuzzy header matching (case + whitespace insensitive + substring patterns) */
function _normHeader(h) { return String(h || '').replace(/\s+/g, '').toLowerCase(); }
const HEADER_MAP_NORM = Object.fromEntries(Object.entries(HEADER_MAP).map(([k, v]) => [_normHeader(k), v]));
const HEADER_PATTERNS = [
  { re: /ชื่อบุคคล/,      field: 'full_name' },
  { re: /ชื่อสมาชิก/,     field: 'member_name' },
  { re: /รหัสสมาชิก/,     field: 'member_code' },
  { re: /โทรศัพท์|โทร/,   field: 'phone' },
  { re: /วันที่สมัคร/,    field: 'registered_at' },
  { re: /วันเกิด/,        field: 'birth_date' },
  { re: /ผู้แนะนำ/,       field: 'sponsor_code' },
  { re: /อัพไลน์/,        field: 'upline_code' },
  { re: /ด้าน/,           field: 'side' },
  { re: /^package$/i,     field: 'package' },
  { re: /^lb$/i,          field: 'country_code' },
];
function mapHeader(raw) {
  if (!raw) return null;
  if (HEADER_MAP[raw]) return HEADER_MAP[raw];
  const norm = _normHeader(raw);
  if (HEADER_MAP_NORM[norm]) return HEADER_MAP_NORM[norm];
  for (const { re, field } of HEADER_PATTERNS) if (re.test(raw)) return field;
  return null;
}

/* ── แปลง cell value → string "ปลอดภัย" (ไม่เป็น scientific) ── */
function toCleanString(val) {
  if (val === null || val === undefined || val === '') return '';
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return '';
    // Integer หรือเลขยาวๆ → format เต็ม ไม่ให้เป็น 3.4101E+12
    if (Number.isInteger(val) || Math.abs(val) >= 1e10) {
      return Math.round(val).toString();
    }
    return String(val);
  }
  if (val instanceof Date) {
    if (isNaN(val)) return '';
    return val.toISOString().slice(0, 10);
  }
  return String(val).trim();
}

/* ── Normalize รหัส (member_code, sponsor_code, upline_code) → ตัวเลขไม่มี leading zero ── */
function toNumericCode(val) {
  const s = toCleanString(val);
  if (!s) return '';
  // ถ้าเป็น digits ล้วน (อาจมี leading zero) → parse เป็น integer แล้ว toString
  if (/^\d+$/.test(s)) return String(parseInt(s, 10));
  // ถ้ามี non-digit (เช่น "A-1234", "ABC123") → เก็บตามเดิม
  return s;
}

/* ── Fields ที่ต้องเป็น numeric format ── */
const NUMERIC_CODE_FIELDS = new Set(['member_code', 'sponsor_code', 'upline_code']);

/* ── Init ── */
window.addEventListener('DOMContentLoaded', () => {
  // Check master key
  if (!window.ERPCrypto || !ERPCrypto.hasMasterKey()) {
    document.getElementById('keyMissing').style.display = 'block';
  }
  setStepActive(1);
});

/* ── Step indicator ── */
function setStepActive(n) {
  [1,2,3].forEach(i => {
    const el = document.getElementById('step'+i);
    el.classList.remove('active','done');
    if (i < n) el.classList.add('done');
    else if (i === n) el.classList.add('active');
  });
}

/* ── Drag & drop ── */
function onDrag(e, enter) {
  e.preventDefault();
  const dz = document.getElementById('dropZone');
  if (enter) dz.classList.add('dragover'); else dz.classList.remove('dragover');
}
function onDrop(e) {
  e.preventDefault();
  document.getElementById('dropZone').classList.remove('dragover');
  const f = e.dataTransfer.files[0];
  if (f) handleFile(f);
}
function onFilePick(e) {
  const f = e.target.files[0];
  if (f) handleFile(f);
}

/* ── Parse Excel ── */
async function handleFile(file) {
  if (!/\.(xlsx|xls)$/i.test(file.name)) {
    showToast('รองรับเฉพาะไฟล์ .xlsx หรือ .xls', 'error');
    return;
  }
  if (file.size > 50 * 1024 * 1024) {
    showToast('ไฟล์เกิน 50 MB', 'error');
    return;
  }

  currentFile = file;
  showLoading(true);
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    // raw:true → ได้ number/Date จริง (ไม่ scientific) — เราจัดการ format เอง
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });

    // Excel จาก answerforsuccess: header row อยู่ที่ row 7 (index 6)
    // หา row แรกที่ดูเหมือน header (มีคำว่า "รหัสสมาชิก" หรือ "member_code")
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      if (rows[i] && rows[i].some(c => c && String(c).includes('รหัสสมาชิก'))) {
        headerIdx = i; break;
      }
    }
    if (headerIdx === -1) {
      showToast('หา header row ไม่เจอ (ต้องมี column "รหัสสมาชิก")', 'error');
      showLoading(false); return;
    }

    parsedHeaders = rows[headerIdx].map(h => (h ? String(h).trim() : ''));
    parsedRows = rows.slice(headerIdx + 1).filter(r =>
      r && r.some(c => c !== null && c !== '' && c !== undefined)
    );

    updateUI();
    setStepActive(2);
  } catch (err) {
    showToast('parse ไฟล์ล้มเหลว: ' + err.message, 'error');
  }
  showLoading(false);
}

/* ── Update preview ── */
function updateUI() {
  document.getElementById('fileInfoWrap').style.display = 'block';
  document.getElementById('fileName').textContent = currentFile.name;
  document.getElementById('fileMeta').textContent =
    `${(currentFile.size/1024).toFixed(1)} KB · ${new Date(currentFile.lastModified).toLocaleString('th-TH')}`;
  document.getElementById('cfgRows').textContent = parsedRows.length.toLocaleString();
  document.getElementById('cfgCols').textContent = parsedHeaders.filter(Boolean).length;

  // Preview first 10 rows
  const wrap = document.getElementById('previewTable');
  let html = '<table><thead><tr>';
  parsedHeaders.forEach(h => {
    if (!h) return;
    const mapped = mapHeader(h);
    const isSensitive = SENSITIVE_FIELDS.includes(mapped);
    html += `<th title="raw:'${h}' → ${mapped || '(unmapped)'}">${h}${isSensitive ? ' 🔒' : ''}${mapped ? '' : ' ⚠️'}</th>`;
  });
  html += '</tr></thead><tbody>';
  parsedRows.slice(0, 10).forEach(r => {
    html += '<tr>';
    parsedHeaders.forEach((h, i) => {
      if (!h) return;
      const mapped = mapHeader(h);
      const val = r[i];
      let display;
      if (SENSITIVE_FIELDS.includes(mapped) && val) {
        display = revealSecrets ? toCleanString(val) : '••••••';
      } else if (mapped === 'registered_at' || mapped === 'birth_date') {
        const iso = parseDate(val);
        display = iso ? DateFmt.formatDMY(iso) : toCleanString(val);
      } else if (NUMERIC_CODE_FIELDS.has(mapped)) {
        display = toNumericCode(val);
      } else {
        display = toCleanString(val);
      }
      html += `<td>${escapeHtml(display)}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;
}

/* ── Transform row → DB object ── */
async function rowToRecord(row) {
  const rec = { source_file: currentFile.name };
  const extra = {};

  for (let i = 0; i < parsedHeaders.length; i++) {
    const h = parsedHeaders[i];
    if (!h) continue;
    const val = row[i];
    if (val === null || val === undefined || val === '') continue;

    const mapped = mapHeader(h);
    if (!mapped) { extra[h] = val; continue; }

    if (mapped === '__password_plain') {
      const plain = toCleanString(val);
      if (ERPCrypto.hasMasterKey())
        rec.password_encrypted = await ERPCrypto.encrypt(plain);
      // Always write hash (no master key needed) for cross-device verification
      rec.password_hash = await ERPCrypto.hash(plain);
      continue;
    }
    if (mapped === '__national_id_plain') {
      if (ERPCrypto.hasMasterKey())
        rec.national_id_encrypted = await ERPCrypto.encrypt(toCleanString(val));
      continue;
    }

    // Date fields
    if (mapped === 'registered_at' || mapped === 'birth_date') {
      rec[mapped] = parseDate(val);
      continue;
    }
    // Number fields
    if (mapped === 'wallet_percent') {
      const n = Number(val);
      rec[mapped] = Number.isFinite(n) ? n : null;
      continue;
    }

    // Code fields (member_code, sponsor_code, upline_code) → ตัด leading zero
    if (NUMERIC_CODE_FIELDS.has(mapped)) {
      rec[mapped] = toNumericCode(val);
      continue;
    }

    rec[mapped] = toCleanString(val);
  }

  if (Object.keys(extra).length) rec.extra_data = extra;
  return rec;
}

/* ── Validate ว่าเป็น date จริงๆ (เช่น 1974-09-31 → invalid เพราะ ก.ย. มี 30 วัน) ── */
function _validIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const [, y, mo, d] = m;
  const dt = new Date(`${iso}T00:00:00Z`);
  if (isNaN(dt)) return null;
  // round-trip check — ถ้าไม่ตรง = วันที่ไม่มีอยู่จริง (JS auto-rolls over)
  const roundtrip = dt.toISOString().slice(0, 10);
  if (roundtrip !== iso) return null;
  const year = Number(y);
  if (year < 1900 || year > 2100) return null;   // out of sane range
  return iso;
}

function parseDate(val) {
  if (val === null || val === undefined || val === '') return null;
  if (val instanceof Date) {
    if (isNaN(val)) return null;
    return _validIso(val.toISOString().slice(0, 10));
  }
  // Excel serial number
  if (typeof val === 'number' && Number.isFinite(val) && val > 20000 && val < 80000) {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    if (!isNaN(d)) return _validIso(d.toISOString().slice(0, 10));
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return _validIso(s.slice(0, 10));
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return _validIso(`${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`);
  }
  return null;
}

/* ── Start import ── */
async function startImport() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    showToast('ยังไม่ได้ตั้งค่า Supabase ใน Settings', 'error');
    return;
  }
  if (!parsedRows.length) return;

  setStepActive(3);
  document.getElementById('progressWrap').style.display = 'flex';
  document.getElementById('progressView').style.display = 'block';
  document.getElementById('doneActions').style.display = 'none';
  document.getElementById('btnStartImport').disabled = true;

  const batchSize = Number(document.getElementById('cfgBatchSize').value) || 500;
  const total = parsedRows.length;
  let done = 0, ok = 0, failed = 0;
  const startTime = Date.now();
  _progressStartTime = startTime;
  updateProgress(0, total);

  log(`📥 เริ่มนำเข้า ${total.toLocaleString()} แถว · batch size ${batchSize}`, '');

  // Create sync_log entry
  const logId = await createSyncLog(total);

  // Process in batches
  for (let i = 0; i < total; i += batchSize) {
    const chunk = parsedRows.slice(i, i + batchSize);
    try {
      const records = [];
      for (const r of chunk) {
        try { records.push(await rowToRecord(r)); }
        catch (e) { failed++; log(`  ⚠️ row ${i+records.length+1}: ${e.message}`, 'warn'); }
      }
      const inserted = await upsertBatch(records);
      ok += inserted;
      done += chunk.length;
      updateProgress(done, total);
      log(`  ✅ batch ${Math.floor(i/batchSize)+1}: ${inserted}/${chunk.length} rows`, 'ok');
    } catch (e) {
      failed += chunk.length;
      done += chunk.length;
      updateProgress(done, total);
      log(`  ❌ batch ${Math.floor(i/batchSize)+1} failed: ${e.message}`, 'err');
    }
  }

  const dur = Math.round((Date.now() - startTime) / 1000);
  log('', '');
  log(`🎉 เสร็จสิ้น · สำเร็จ ${ok} · ล้มเหลว ${failed} · ${dur}s`, failed ? 'warn' : 'ok');
  await finishSyncLog(logId, ok, failed, dur);

  document.getElementById('btnStartImport').disabled = false;
  showToast(`นำเข้า ${ok.toLocaleString()} แถว เสร็จใน ${dur}s`, failed ? 'warning' : 'success');

  // Switch running view → done view
  const summary = failed > 0
    ? `✅ สำเร็จ ${ok.toLocaleString()} · ⚠️ ล้ม ${failed.toLocaleString()} · ${dur}s`
    : `สำเร็จทั้งหมด ${ok.toLocaleString()} แถว · ${dur}s`;
  document.getElementById('doneSummary').textContent = summary;

  // Copy log to done view
  const logSrc = document.getElementById('importLog');
  const logDst = document.getElementById('importLogDone');
  if (logSrc && logDst) logDst.innerHTML = logSrc.innerHTML;

  document.getElementById('progressView').style.display = 'none';
  document.getElementById('doneActions').style.display = 'block';
}

/* ── Go to list page ── */
function gotoList() {
  window.location.href = './members-list.html';
}

/* ── Supabase upsert ──
   PostgREST (Supabase REST) requires ทุก object ใน array ต้องมี keys เดียวกัน
   ถ้า keys ไม่ match จะได้ error PGRST102 "All object keys must match"
   → normalize: union ของ keys ทั้งหมด แล้ว fill missing = null
*/
async function upsertBatch(records) {
  if (!records.length) return 0;

  const allKeys = new Set();
  records.forEach(r => Object.keys(r).forEach(k => allKeys.add(k)));
  const normalized = records.map(r => {
    const out = {};
    allKeys.forEach(k => { out[k] = (k in r) ? r[k] : null; });
    return out;
  });

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/members?on_conflict=member_code`,
    {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(normalized),
    }
  );
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`${res.status}: ${msg.slice(0, 120)}`);
  }
  return records.length;
}

/* ── sync_log ── */
async function createSyncLog(totalRows) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/sync_log`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify([{
        source: 'manual_import',
        rows_total: totalRows,
        status: 'running',
        file_name: currentFile?.name,
        triggered_by: window.ERP_USER?.user_id || 'anonymous',
      }]),
    });
    const data = await res.json();
    return data?.[0]?.id;
  } catch { return null; }
}
async function finishSyncLog(logId, ok, failed, dur) {
  if (!logId) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/sync_log?id=eq.${logId}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        finished_at: new Date().toISOString(),
        duration_sec: dur,
        rows_inserted: ok,
        rows_failed: failed,
        status: failed === 0 ? 'success' : (ok === 0 ? 'failed' : 'partial'),
      }),
    });
  } catch {}
}

/* ── Progress UI ── */
let _progressStartTime = 0;
const RING_CIRCUMFERENCE = 2 * Math.PI * 52;   // r=52 → ~326.7

function updateProgress(done, total) {
  const pct = total ? Math.round(done / total * 100) : 0;
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressPercent').textContent = pct + '%';
  document.getElementById('progressCount').textContent =
    `${done.toLocaleString()} / ${total.toLocaleString()}`;

  // Ring progress
  const ring = document.getElementById('progressRing');
  if (ring) ring.setAttribute('stroke-dashoffset',
    (RING_CIRCUMFERENCE * (1 - pct / 100)).toFixed(1));

  // ETA
  const etaEl = document.getElementById('progressEta');
  if (etaEl && _progressStartTime) {
    const elapsed = (Date.now() - _progressStartTime) / 1000;
    if (done > 0 && done < total) {
      const rate = done / elapsed;                 // rows/sec
      const remaining = (total - done) / rate;
      etaEl.textContent = remaining < 60
        ? `เหลือ ~${Math.ceil(remaining)}s`
        : `เหลือ ~${Math.ceil(remaining/60)} นาที`;
    } else if (done >= total) {
      etaEl.textContent = `ใช้เวลา ${elapsed.toFixed(1)}s`;
    }
  }
}

function toggleLogPanel() {
  const logs = document.querySelectorAll('.imp-log');
  const buttons = document.querySelectorAll('.imp-log-toggle');
  const isOpen = logs[0] && logs[0].classList.contains('open');
  logs.forEach(el => el.classList.toggle('open', !isOpen));
  buttons.forEach(b => b.classList.toggle('open', !isOpen));
}
function log(text, cls) {
  const el = document.getElementById('importLog');
  const line = document.createElement('div');
  line.className = 'imp-log-line' + (cls ? ' ' + cls : '');
  line.textContent = text || ' ';
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

/* ── Toggle reveal secrets in preview ── */
function toggleReveal() {
  revealSecrets = !revealSecrets;
  const btn = document.getElementById('btnToggleReveal');
  btn.textContent = revealSecrets ? '🙈 ซ่อนข้อมูลลับ' : '👁️ แสดงข้อมูลลับ';
  if (parsedRows.length) updateUI();
}

/* ── Reset ── */
function resetImport() {
  parsedRows = []; parsedHeaders = []; currentFile = null;
  revealSecrets = false;
  _progressStartTime = 0;
  const btn = document.getElementById('btnToggleReveal');
  if (btn) btn.textContent = '👁️ แสดงข้อมูลลับ';
  document.getElementById('fileInfoWrap').style.display = 'none';
  document.getElementById('progressWrap').style.display = 'none';
  document.getElementById('progressView').style.display = 'block';
  document.getElementById('doneActions').style.display = 'none';
  document.getElementById('importLog').innerHTML = '';
  const logDst = document.getElementById('importLogDone');
  if (logDst) logDst.innerHTML = '';
  document.getElementById('previewTable').innerHTML = '';
  document.getElementById('fileInput').value = '';
  // Reset ring
  const ring = document.getElementById('progressRing');
  if (ring) ring.setAttribute('stroke-dashoffset', RING_CIRCUMFERENCE.toFixed(1));
  setStepActive(1);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ── Master Key modal ── */
function openKeyModal() {
  document.getElementById('keyModalOverlay').classList.add('open');
  document.getElementById('fKey').value = '';
  document.getElementById('fKey2').value = '';
}
function closeKeyModal() {
  document.getElementById('keyModalOverlay').classList.remove('open');
}
function saveMasterKey() {
  const k1 = document.getElementById('fKey').value;
  const k2 = document.getElementById('fKey2').value;
  if (k1 !== k2) { showToast('Master Key ทั้งสองไม่ตรงกัน', 'error'); return; }
  try {
    ERPCrypto.setMasterKey(k1);
    closeKeyModal();
    document.getElementById('keyMissing').style.display = 'none';
    showToast('บันทึก Master Key แล้ว', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}

/* ── Utils ── */
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}
function showLoading(on) {
  document.getElementById('loadingOverlay').style.display = on ? 'flex' : 'none';
}
function showToast(msg, type='info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show toast-${type}`;
  setTimeout(() => t.className = 'toast', 3500);
}
