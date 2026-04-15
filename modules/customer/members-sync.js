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
  github_owner: null,
  github_repo: null,
  github_workflow: null,
  github_branch: 'main',
  github_pat_encrypted: null,
  github_pat_expires_at: null,
  line_token_encrypted: null,
  line_target_id: null,
  line_target_type: 'group',
  line_notify_on_success: false,
};
let _credsDirty = false;   // flag — user พิมพ์ AFS credentials ใหม่
let _patDirty = false;     // flag — user พิมพ์ PAT ใหม่
let _lineDirty = false;    // flag — user พิมพ์ LINE token ใหม่

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
  // AFS credentials
  const userInput = document.getElementById('afsUsername');
  const pwInput   = document.getElementById('afsPassword');

  // GitHub fields (plain)
  document.getElementById('ghOwner').value    = config.github_owner    || '';
  document.getElementById('ghRepo').value     = config.github_repo     || '';
  document.getElementById('ghWorkflow').value = config.github_workflow || '';
  document.getElementById('ghBranch').value   = config.github_branch   || 'main';
  document.getElementById('ghPatExpires').value = config.github_pat_expires_at || '';
  _renderPatExpiryBadge();

  // LINE fields
  document.getElementById('lineType').value     = config.line_target_type || 'group';
  document.getElementById('lineTargetId').value = config.line_target_id   || '';
  document.getElementById('lineSuccess').checked = !!config.line_notify_on_success;

  if (!ERPCrypto.hasMasterKey()) {
    if (config.username_encrypted)      userInput.placeholder = '(encrypted — ต้อง Master Key)';
    if (config.password_encrypted)      pwInput.placeholder   = '(encrypted — ต้อง Master Key)';
    if (config.github_pat_encrypted)    document.getElementById('ghPat').placeholder = '(encrypted — ต้อง Master Key)';
    return;
  }
  try {
    if (config.username_encrypted)
      userInput.value = (await ERPCrypto.decrypt(config.username_encrypted)) || '';
    if (config.password_encrypted)
      pwInput.value = (await ERPCrypto.decrypt(config.password_encrypted)) || '';
    if (config.github_pat_encrypted)
      document.getElementById('ghPat').value = (await ERPCrypto.decrypt(config.github_pat_encrypted)) || '';
    if (config.line_token_encrypted)
      document.getElementById('lineToken').value = (await ERPCrypto.decrypt(config.line_token_encrypted)) || '';
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
  if (e.target.id === 'ghPat') _patDirty = true;
  if (e.target.id === 'lineToken') _lineDirty = true;
});

function toggleLineEye() {
  const inp = document.getElementById('lineToken');
  const eye = document.getElementById('lineTokenEye');
  if (inp.type === 'password') { inp.type = 'text'; eye.textContent = '🙈'; }
  else                         { inp.type = 'password'; eye.textContent = '👁️'; }
}

/* ── Quick-fill PAT expiry: today + N days ── */
function _setExpiresIn(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const iso = d.toISOString().slice(0, 10);
  const inp = document.getElementById('ghPatExpires');
  inp.value = iso;
  // Sync into config so badge updates instantly
  config.github_pat_expires_at = iso;
  _renderPatExpiryBadge();
}

function togglePatEye() {
  const inp = document.getElementById('ghPat');
  const eye = document.getElementById('patEye');
  if (inp.type === 'password') { inp.type = 'text'; eye.textContent = '🙈'; }
  else                         { inp.type = 'password'; eye.textContent = '👁️'; }
}

/* ── Render PAT expiry badge (countdown + color) ── */
function _renderPatExpiryBadge() {
  const badge = document.getElementById('patExpiryBadge');
  const expIso = config.github_pat_expires_at;
  if (!expIso) {
    badge.style.display = 'none';
    return;
  }
  const exp = new Date(expIso + 'T23:59:59');
  const days = Math.floor((exp - Date.now()) / 86400000);

  let cls, text;
  if (days < 0) {
    cls = 'expired';
    text = `❌ หมดอายุแล้ว ${Math.abs(days)} วัน`;
  } else if (days === 0) {
    cls = 'expired';
    text = `⚠️ หมดอายุวันนี้!`;
  } else if (days <= 7) {
    cls = 'expired';
    text = `⚠️ เหลือ ${days} วัน — ใกล้หมดอายุ!`;
  } else if (days <= 30) {
    cls = 'warn';
    text = `⏰ เหลือ ${days} วัน`;
  } else {
    cls = 'fresh';
    text = `✓ เหลือ ${days} วัน · ${DateFmt.formatDMY(expIso)}`;
  }
  badge.className = `pat-badge ${cls}`;
  badge.textContent = text;
  badge.style.display = 'inline-flex';
}

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
   SAVE GITHUB CONFIG
   ============================================================ */
async function saveGithub() {
  const owner    = document.getElementById('ghOwner').value.trim();
  const repo     = document.getElementById('ghRepo').value.trim();
  const workflow = document.getElementById('ghWorkflow').value.trim();
  const branch   = document.getElementById('ghBranch').value.trim() || 'main';
  const pat      = document.getElementById('ghPat').value;

  if (!owner || !repo || !workflow) {
    showToast('กรอก owner / repo / workflow ก่อน', 'error');
    return;
  }

  showLoading(true);
  try {
    const expires = document.getElementById('ghPatExpires').value || null;
    const patch = {
      github_owner: owner,
      github_repo: repo,
      github_workflow: workflow,
      github_branch: branch,
      github_pat_expires_at: expires,
      updated_at: new Date().toISOString(),
    };
    if (_patDirty && pat) {
      if (!ERPCrypto.hasMasterKey()) {
        showToast('ต้องตั้ง Master Key ก่อน', 'error'); showLoading(false); return;
      }
      patch.github_pat_encrypted = await ERPCrypto.encrypt(pat);
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
    _patDirty = false;
    await loadConfig();
    showToast('✅ บันทึก GitHub config แล้ว', 'success');
  } catch (e) {
    showToast('บันทึกไม่ได้: ' + e.message, 'error');
  }
  showLoading(false);
}

/* ============================================================
   SAVE LINE CONFIG
   ============================================================ */
async function saveLine() {
  const token        = document.getElementById('lineToken').value;
  const targetType   = document.getElementById('lineType').value;
  const targetId     = document.getElementById('lineTargetId').value.trim();
  const notifyOnSucc = document.getElementById('lineSuccess').checked;

  if (targetType !== 'broadcast' && !targetId) {
    showToast('ใส่ Group ID หรือ User ID ก่อน', 'error');
    return;
  }

  showLoading(true);
  try {
    const patch = {
      line_target_type: targetType,
      line_target_id: targetType === 'broadcast' ? null : targetId,
      line_notify_on_success: notifyOnSucc,
      updated_at: new Date().toISOString(),
    };
    if (_lineDirty && token) {
      if (!ERPCrypto.hasMasterKey()) {
        showToast('ต้องตั้ง Master Key ก่อน', 'error'); showLoading(false); return;
      }
      patch.line_token_encrypted = await ERPCrypto.encrypt(token);
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
    _lineDirty = false;
    await loadConfig();
    showToast('✅ บันทึก LINE config แล้ว', 'success');
  } catch (e) {
    showToast('บันทึกไม่ได้: ' + e.message, 'error');
  }
  showLoading(false);
}

/* ============================================================
   TEST LINE — Trigger CI workflow with TEST_LINE flag
   (LINE API ไม่รองรับ CORS — fetch ตรงจาก browser ไม่ได้
    แก้: ให้ Github workflow ส่งให้แทน — server-side ไม่มี CORS)
   ============================================================ */
async function testLine() {
  if (!config.line_token_encrypted) {
    showToast('กดบันทึก LINE config ก่อน — แล้วค่อย Test', 'error');
    return;
  }
  if (!config.github_pat_encrypted) {
    showToast('ต้องตั้ง GitHub PAT ก่อน (CI ส่ง LINE ให้แทน)', 'error');
    return;
  }
  if (!ERPCrypto.hasMasterKey()) {
    showToast('ต้องตั้ง Master Key ก่อน', 'error');
    return;
  }

  if (!confirm(
    `ส่ง Test message ผ่าน GitHub Actions\n` +
    `(LINE API ห้าม fetch จาก browser — ต้องผ่าน CI server)\n\n` +
    `Workflow จะใช้เวลา ~30 วินาที — ทำต่อ?`
  )) return;

  showLoading(true);
  try {
    const pat = await ERPCrypto.decrypt(config.github_pat_encrypted);
    const ghUrl = `https://api.github.com/repos/${config.github_owner}/${config.github_repo}/actions/workflows/${config.github_workflow}/dispatches`;

    const ghRes = await fetch(ghUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${pat}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ref: config.github_branch || 'main',
        inputs: { test_line: 'true' },
      }),
    });

    if (ghRes.status === 204) {
      showToast('🚀 ส่งคำสั่ง test ไป GitHub แล้ว — รอ ~30 วิ ดูใน LINE', 'success');
      window.open(`https://github.com/${config.github_owner}/${config.github_repo}/actions`, '_blank');
    } else {
      const err = await ghRes.text();
      throw new Error(`${ghRes.status}: ${err.slice(0, 150)}`);
    }
  } catch (e) {
    showToast('ส่งไม่ได้: ' + e.message, 'error');
  }
  showLoading(false);
}

/* ============================================================
   SYNC NOW — ยิง GitHub workflow_dispatch
   ============================================================ */
async function syncNow() {
  // Validate config
  if (!config.github_owner || !config.github_repo || !config.github_workflow) {
    showToast('ต้องตั้งค่า GitHub Integration ก่อน', 'error');
    return;
  }
  if (!config.github_pat_encrypted) {
    showToast('ต้องใส่ GitHub PAT ก่อน', 'error');
    return;
  }
  if (!ERPCrypto.hasMasterKey()) {
    showToast('ต้องตั้ง Master Key ก่อน', 'error');
    return;
  }

  if (!confirm(
    `ส่งคำสั่ง Sync Now ไป GitHub Actions?\n\n` +
    `Repo: ${config.github_owner}/${config.github_repo}\n` +
    `Workflow: ${config.github_workflow}\n` +
    `Branch: ${config.github_branch}\n\n` +
    `Workflow จะรันบน GitHub server (~10-15 นาที)`
  )) return;

  showLoading(true);
  let logId = null;
  try {
    // Decrypt PAT
    const pat = await ERPCrypto.decrypt(config.github_pat_encrypted);
    if (!pat) throw new Error('decrypt PAT ล้มเหลว');

    // Start sync_log entry
    const lr = await fetch(`${SUPABASE_URL}/rest/v1/sync_log`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json', 'Prefer': 'return=representation',
      },
      body: JSON.stringify([{
        source: 'sync_now_dispatched',
        started_at: new Date().toISOString(),
        status: 'running',
        triggered_by: window.ERP_USER?.user_id || 'unknown',
      }]),
    });
    const data = await lr.json();
    logId = data?.[0]?.id;

    // Trigger GitHub workflow
    const ghUrl = `https://api.github.com/repos/${config.github_owner}/${config.github_repo}/actions/workflows/${config.github_workflow}/dispatches`;
    const ghRes = await fetch(ghUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${pat}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: config.github_branch || 'main' }),
    });

    if (ghRes.status === 204) {
      // Success — workflow triggered
      if (logId) {
        await fetch(`${SUPABASE_URL}/rest/v1/sync_log?id=eq.${logId}`, {
          method: 'PATCH',
          headers: {
            apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            finished_at: new Date().toISOString(),
            status: 'success',
            error_message: 'Dispatched to GitHub — actual sync running on CI',
          }),
        });
      }
      showToast('🚀 Sync Now ส่งคำสั่งไป GitHub แล้ว — ดูผลที่ Actions tab', 'success');
      // Open GitHub Actions in new tab
      window.open(`https://github.com/${config.github_owner}/${config.github_repo}/actions`, '_blank');
    } else {
      const errText = await ghRes.text();
      throw new Error(`GitHub API ${ghRes.status}: ${errText.slice(0, 150)}`);
    }
  } catch (e) {
    if (logId) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/sync_log?id=eq.${logId}`, {
          method: 'PATCH',
          headers: {
            apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            finished_at: new Date().toISOString(),
            status: 'failed',
            error_message: e.message.slice(0, 200),
          }),
        });
      } catch {}
    }
    showToast('ไม่สำเร็จ: ' + e.message, 'error');
  }
  await loadLog();
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
