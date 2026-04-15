/* ============================================================
   members-sync.js — ตั้งค่า Auto-Sync + ดู sync_log
   ============================================================ */

let SUPABASE_URL = localStorage.getItem('sb_url') || '';
let SUPABASE_KEY = localStorage.getItem('sb_key') || '';

let config = {
  enabled: false,
  frequency: '24h',
  username_encrypted: null,
  password_encrypted: null,
  last_sync_at: null,
  next_sync_at: null,
};
let _credsDirty = false;   // flag — user พิมพ์ credentials ใหม่

/* ============================================================
   LOAD CONFIG + LOG
   ============================================================ */
async function loadConfig() {
  showLoading(true);
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/sync_config?id=eq.1&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    if (data?.[0]) config = { ...config, ...data[0] };
    await _populateCredsPreview();
    _renderUI();
  } catch (e) {
    showToast('โหลด config ไม่ได้: ' + e.message, 'error');
  }
  showLoading(false);
}

async function _populateCredsPreview() {
  // ถ้ามี encrypted creds + Master Key พร้อม → decrypt แสดง (masked)
  const userInput = document.getElementById('afsUsername');
  const pwInput   = document.getElementById('afsPassword');
  if (!config.username_encrypted && !config.password_encrypted) return;
  if (!ERPCrypto.hasMasterKey()) {
    userInput.placeholder = '(encrypted — ต้อง Master Key)';
    pwInput.placeholder   = '(encrypted — ต้อง Master Key)';
    return;
  }
  try {
    if (config.username_encrypted) {
      const u = await ERPCrypto.decrypt(config.username_encrypted);
      userInput.value = u || '';
    }
    if (config.password_encrypted) {
      const p = await ERPCrypto.decrypt(config.password_encrypted);
      pwInput.value = p || '';
    }
  } catch {
    userInput.placeholder = '(decrypt ล้มเหลว — Master Key ผิด?)';
    pwInput.placeholder = '(decrypt ล้มเหลว)';
  }
}

/* ============================================================
   RENDER UI
   ============================================================ */
function _renderUI() {
  // Hero status
  const hero = document.getElementById('syncHero');
  const status = document.getElementById('heroStatus');
  const title = document.getElementById('heroTitle');
  const sub = document.getElementById('heroSub');

  hero.classList.remove('disabled', 'failed');
  if (!config.enabled) {
    hero.classList.add('disabled');
    status.textContent = '⏸️ ปิดใช้งาน';
    title.textContent = 'Auto-Sync ยังไม่เปิด';
    sub.textContent = 'เปิด toggle ด้านล่างเพื่อเริ่มใช้งาน';
  } else {
    status.textContent = '🟢 ทำงานอยู่';
    title.textContent = `Auto-Sync ${_freqLabel(config.frequency)}`;
    sub.textContent = 'ระบบจะดึงข้อมูลสมาชิกจาก answerforsuccess.com ตามช่วงเวลาที่กำหนด';
  }

  // Last / Next
  document.getElementById('heroLast').textContent =
    config.last_sync_at ? DateFmt.formatDMYTime(config.last_sync_at) : '— ยังไม่เคย sync';
  document.getElementById('heroNext').textContent =
    config.enabled && config.next_sync_at
      ? _relativeTime(config.next_sync_at)
      : (config.enabled ? 'คำนวณหลัง sync ครั้งแรก' : '— (ปิดอยู่)');

  // Switch
  document.getElementById('swEnabled').classList.toggle('on', !!config.enabled);

  // Frequency pills
  document.querySelectorAll('.freq-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.freq === config.frequency);
  });
}

function _freqLabel(f) {
  return { '1h': 'ทุก 1 ชั่วโมง', '6h': 'ทุก 6 ชั่วโมง', '24h': 'ทุกวัน', 'weekly': 'ทุกสัปดาห์' }[f] || f;
}
function _relativeTime(iso) {
  const diff = (new Date(iso) - Date.now()) / 1000;
  if (diff < 0) return 'พร้อม sync แล้ว';
  if (diff < 60) return `ใน ${Math.ceil(diff)} วินาที`;
  if (diff < 3600) return `ใน ${Math.ceil(diff/60)} นาที`;
  if (diff < 86400) return `ใน ${Math.floor(diff/3600)} ชม. ${Math.floor((diff%3600)/60)} นาที`;
  return `ใน ${Math.floor(diff/86400)} วัน`;
}

/* ============================================================
   UI HANDLERS
   ============================================================ */
function toggleEnabled() {
  config.enabled = !config.enabled;
  _renderUI();
}
function setFreq(f) {
  config.frequency = f;
  _renderUI();
}
function togglePwEye() {
  const inp = document.getElementById('afsPassword');
  const eye = document.getElementById('pwEye');
  if (inp.type === 'password') { inp.type = 'text'; eye.textContent = '🙈'; }
  else                         { inp.type = 'password'; eye.textContent = '👁️'; }
}
document.addEventListener('input', (e) => {
  if (e.target.id === 'afsUsername' || e.target.id === 'afsPassword') _credsDirty = true;
});

/* ============================================================
   SAVE CONFIG
   ============================================================ */
async function saveConfig() {
  showLoading(true);
  try {
    const patch = {
      enabled: !!config.enabled,
      frequency: config.frequency,
      updated_at: new Date().toISOString(),
    };

    // ถ้า enable แล้วแต่ยังไม่มี credentials → บังคับต้องกรอก
    const u = document.getElementById('afsUsername').value.trim();
    const p = document.getElementById('afsPassword').value;

    if (_credsDirty) {
      if (!ERPCrypto.hasMasterKey()) {
        showLoading(false);
        showToast('ต้องตั้ง Master Key ก่อน (ไปหน้า Import)', 'error');
        return;
      }
      if (u) patch.username_encrypted = await ERPCrypto.encrypt(u);
      if (p) patch.password_encrypted = await ERPCrypto.encrypt(p);
    }

    // Compute next_sync_at
    if (config.enabled) {
      patch.next_sync_at = _computeNextSync(config.frequency);
    } else {
      patch.next_sync_at = null;
    }

    const res = await fetch(`${SUPABASE_URL}/rest/v1/sync_config?id=eq.1`, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(await res.text());
    _credsDirty = false;
    await loadConfig();
    showToast('✅ บันทึกแล้ว', 'success');
  } catch (e) {
    showToast('บันทึกไม่ได้: ' + e.message, 'error');
  }
  showLoading(false);
}

function _computeNextSync(freq) {
  const now = new Date();
  const ms = { '1h': 3600e3, '6h': 6*3600e3, '24h': 86400e3, 'weekly': 7*86400e3 }[freq] || 86400e3;
  return new Date(now.getTime() + ms).toISOString();
}

/* ============================================================
   SYNC NOW (mocked — บันทึก log แต่ไม่ได้ไป scrape จริง)
   ============================================================ */
async function syncNow() {
  if (!confirm('กด Sync Now ตอนนี้จะบันทึก log ว่าสั่ง sync — แต่ backend script ยังไม่ได้ตั้งค่า (Phase 2B/C) งานจริงจะยังไม่ทำ\n\nดำเนินต่อ?')) return;
  showLoading(true);
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/sync_log`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([{
        source: 'sync_now_requested',
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        duration_sec: 0,
        rows_total: 0,
        rows_failed: 0,
        status: 'failed',
        error_message: 'Backend script ยังไม่ทำงาน — Phase 2B/C ยังไม่ setup',
        triggered_by: window.ERP_USER?.user_id || 'unknown',
      }]),
    });
    showToast('📝 บันทึก sync request แล้ว (backend ยังไม่ทำงาน)', 'warning');
    await loadLog();
  } catch (e) {
    showToast('ไม่สำเร็จ: ' + e.message, 'error');
  }
  showLoading(false);
}

/* ============================================================
   TEST LOGIN (mocked — ยังไม่ได้ทดสอบจริง)
   ============================================================ */
async function testLogin() {
  const u = document.getElementById('afsUsername').value.trim();
  const p = document.getElementById('afsPassword').value;
  if (!u || !p) { showToast('กรอก username + password ก่อน', 'error'); return; }
  showToast('🧪 ฟีเจอร์นี้จะทำงานจริงใน Phase 2C (ต้องมี backend)', 'warning');
}

/* ============================================================
   LOAD SYNC LOG
   ============================================================ */
async function loadLog() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/sync_log?select=*&order=started_at.desc&limit=20`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!res.ok) throw new Error(await res.text());
    const logs = await res.json();
    _renderLog(logs);
  } catch (e) {
    document.getElementById('logBody').innerHTML =
      `<tr><td colspan="7" class="log-empty">โหลด log ไม่ได้: ${escapeHtml(e.message)}</td></tr>`;
  }
}

function _renderLog(logs) {
  const tb = document.getElementById('logBody');
  if (!logs.length) {
    tb.innerHTML = `<tr><td colspan="7" class="log-empty">ยังไม่มีประวัติการ sync</td></tr>`;
    return;
  }
  const SOURCE_LABEL = {
    manual_import: '📥 Import',
    auto_sync: '⚙️ Auto',
    sync_now_requested: '👆 Manual',
    purge_all: '🗑️ Purge',
  };
  tb.innerHTML = logs.map(l => {
    const srcLabel = SOURCE_LABEL[l.source] || l.source || '—';
    const rows = [l.rows_inserted, l.rows_updated, l.rows_failed]
      .filter(x => x != null && x !== 0)
      .map(x => String(x))
      .join(' · ') || (l.rows_total || 0);
    const dur = l.duration_sec != null ? `${l.duration_sec}s` : '—';
    const err = l.error_message ? escapeHtml(l.error_message).slice(0, 60) : '';
    return `<tr>
      <td style="font-family:'IBM Plex Mono',monospace;font-size:11.5px">${DateFmt.formatDMYTime(l.started_at)}</td>
      <td><span class="log-source-badge">${srcLabel}</span></td>
      <td><span class="log-status ${l.status || 'failed'}">${_statusLabel(l.status)}</span></td>
      <td style="text-align:right;font-variant-numeric:tabular-nums">${rows}</td>
      <td style="text-align:right;font-variant-numeric:tabular-nums;color:var(--text3)">${dur}</td>
      <td style="font-size:11.5px;color:var(--text3)">${escapeHtml(l.triggered_by || '—')}</td>
      <td style="font-size:11px;color:var(--danger);max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${err}">${err}</td>
    </tr>`;
  }).join('');
}

function _statusLabel(s) {
  return { success: '✅ success', failed: '❌ failed', partial: '⚠️ partial', running: '⏳ running' }[s] || s || '—';
}

/* ============================================================
   UTILS
   ============================================================ */
function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, m => ({
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

/* ── Init ── */
window.addEventListener('DOMContentLoaded', () => {
  loadConfig();
  loadLog();
});
