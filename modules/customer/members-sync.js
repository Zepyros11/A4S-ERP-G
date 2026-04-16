/* ============================================================
   members-sync.js — ตั้งค่า Auto-Sync + ดู sync_log
   ============================================================ */

/* ── Custom confirm modal (replaces native confirm()) ── */
function uiConfirm(opts) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('uiConfirmOverlay');
    const iconEl    = document.getElementById('uiConfirmIcon');
    const titleEl   = document.getElementById('uiConfirmTitle');
    const msgEl     = document.getElementById('uiConfirmMessage');
    const detailsEl = document.getElementById('uiConfirmDetails');
    const noteEl    = document.getElementById('uiConfirmNote');
    const okBtn     = document.getElementById('uiConfirmOK');
    const cancelBtn = document.getElementById('uiConfirmCancel');

    iconEl.textContent  = opts.icon    || '🚀';
    titleEl.textContent = opts.title   || 'ยืนยัน?';
    msgEl.textContent   = opts.message || '';

    if (opts.details && Object.keys(opts.details).length) {
      detailsEl.innerHTML = Object.entries(opts.details)
        .map(([k, v]) => `<div class="row"><span class="k">${k}</span><span class="v">${String(v)}</span></div>`)
        .join('');
      detailsEl.style.display = 'block';
    } else detailsEl.style.display = 'none';

    if (opts.note) {
      noteEl.innerHTML = opts.note;
      noteEl.style.display = 'block';
    } else noteEl.style.display = 'none';

    okBtn.textContent = opts.okText     || 'ยืนยัน';
    cancelBtn.textContent = opts.cancelText || 'ยกเลิก';
    okBtn.className = 'ui-confirm-btn ' + (opts.danger ? 'danger' : 'ok');

    const close = (val) => {
      overlay.classList.remove('show');
      okBtn.onclick = cancelBtn.onclick = overlay.onclick = null;
      document.removeEventListener('keydown', onKey);
      setTimeout(() => resolve(val), 150);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
      else if (e.key === 'Enter') close(true);
    };
    okBtn.onclick     = () => close(true);
    cancelBtn.onclick = () => close(false);
    overlay.onclick   = (e) => { if (e.target === overlay) close(false); };
    document.addEventListener('keydown', onKey);
    overlay.classList.add('show');
    setTimeout(() => okBtn.focus(), 60);
  });
}

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
  // Credentials moved to dev-tool/automation task modal — nothing to populate here
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
/* ============================================================
   SAVE CONFIG (Automation toggle + frequency only)
   Credentials moved to dev-tool/automation task modal
   ============================================================ */
async function saveConfig() {
  showLoading(true);
  try {
    const patch = {
      enabled: !!config.enabled,
      frequency: config.frequency,
      updated_at: new Date().toISOString(),
    };

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
   SYNC NOW — ยิง GitHub workflow_dispatch
   (GitHub + LINE config ย้ายไปที่ dev-tool/settings.js)
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

  const ok = await uiConfirm({
    icon: '🔄',
    title: 'ยืนยัน Sync Now',
    message: 'ส่งคำสั่งให้ GitHub Actions ดาวน์โหลด Excel ล่าสุด แล้วนำเข้าเข้า Supabase',
    details: {
      'Repo':     `${config.github_owner}/${config.github_repo}`,
      'Workflow': config.github_workflow,
      'Branch':   config.github_branch || 'main',
    },
    note: '⏱️ Workflow จะรันบน GitHub server <b>~10-15 นาที</b> — จะแสดงความคืบหน้าในหน้านี้แบบ real-time',
    okText: '🚀 เริ่ม Sync',
    cancelText: 'ยกเลิก',
  });
  if (!ok) return;

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
      showLoading(false);
      // Open in-page progress modal instead of redirecting
      trackSyncProgress(pat, new Date());
      return;
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
   SYNC PROGRESS TRACKER — poll GitHub API + sync_log
   ============================================================ */
let _spPolling = false;
let _spPollTimer = null;

function _spSetStep(stepName, state) {
  const el = document.querySelector(`.sp-step[data-step="${stepName}"]`);
  if (!el) return;
  el.classList.remove('active', 'done', 'fail');
  if (state) el.classList.add(state);
}
function _spAdvanceSteps(phase) {
  const order = ['dispatch', 'queue', 'login', 'import', 'done'];
  const idx = order.indexOf(phase);
  if (idx < 0) return;
  for (let i = 0; i < order.length; i++) {
    if (i < idx) _spSetStep(order[i], 'done');
    else if (i === idx) _spSetStep(order[i], 'active');
    else _spSetStep(order[i], null);
  }
}
function _spLog(msg, type = '') {
  const el = document.getElementById('spLog');
  const ts = new Date().toTimeString().slice(0, 8);
  const line = document.createElement('div');
  line.innerHTML = `<span class="ts">${ts}</span><span class="msg ${type}">${msg}</span>`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}
function _spFmtElapsed(sec) {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}m ${s}s`;
}

function openSyncProgressModal() {
  document.getElementById('spOverlay').classList.add('show');
  document.getElementById('spHero').className = 'sp-hero';
  document.getElementById('spSpinner').className = 'sp-spinner loading';
  document.getElementById('spSpinner').textContent = '🔄';
  document.getElementById('spTitle').textContent = 'กำลัง Sync ข้อมูล';
  document.getElementById('spPhase').textContent = 'รอเริ่ม workflow...';
  document.getElementById('spElapsed').textContent = '0s';
  document.getElementById('spStatus').textContent = 'queued';
  document.getElementById('spRows').textContent = '—';
  document.getElementById('spLog').innerHTML = '';
  document.getElementById('spClose').textContent = 'ปิด (รัน background ต่อ)';
  document.getElementById('spClose').className = 'sp-close';
  _spAdvanceSteps('queue');
  _spLog('🚀 Dispatched to GitHub Actions', 'ok');
}
function closeSyncProgress() {
  document.getElementById('spOverlay').classList.remove('show');
  _spPolling = false;
  if (_spPollTimer) clearTimeout(_spPollTimer);
}

async function _fetchLatestRun(pat, sinceMs) {
  const url = `https://api.github.com/repos/${config.github_owner}/${config.github_repo}/actions/runs?per_page=5&branch=${encodeURIComponent(config.github_branch || 'main')}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${pat}`, 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  const data = await res.json();
  // Find newest workflow_dispatch run created after our sinceMs (with a small leeway)
  return (data.workflow_runs || []).find(r =>
    r.event === 'workflow_dispatch' && Date.parse(r.created_at) >= sinceMs - 15000
  );
}
async function _fetchRun(pat, runId) {
  const res = await fetch(`https://api.github.com/repos/${config.github_owner}/${config.github_repo}/actions/runs/${runId}`, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${pat}`, 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status}`);
  return res.json();
}
async function _fetchRunJobs(pat, runId) {
  const res = await fetch(`https://api.github.com/repos/${config.github_owner}/${config.github_repo}/actions/runs/${runId}/jobs`, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${pat}`, 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!res.ok) return null;
  return res.json();
}
async function _fetchLatestSyncLog(sinceMs) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/sync_log?source=eq.auto_sync&order=started_at.desc&limit=1`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  const row = rows?.[0];
  if (!row) return null;
  if (Date.parse(row.started_at) < sinceMs - 15000) return null;
  return row;
}

async function trackSyncProgress(pat, startedAt) {
  const startMs = startedAt instanceof Date ? startedAt.getTime() : Date.now();
  openSyncProgressModal();
  document.getElementById('spGhLink').href = `https://github.com/${config.github_owner}/${config.github_repo}/actions`;

  _spPolling = true;
  let githubRunId = null;
  let lastStep = 'queue';

  const tick = async () => {
    if (!_spPolling) return;

    // Update elapsed
    const elapsedSec = Math.floor((Date.now() - startMs) / 1000);
    document.getElementById('spElapsed').textContent = _spFmtElapsed(elapsedSec);

    try {
      // Find the run if we haven't yet
      if (!githubRunId) {
        const run = await _fetchLatestRun(pat, startMs);
        if (run) {
          githubRunId = run.id;
          document.getElementById('spGhLink').href = run.html_url;
          _spLog(`✅ Found workflow run #${run.run_number}`, 'ok');
        }
      }

      if (githubRunId) {
        const run = await _fetchRun(pat, githubRunId);
        document.getElementById('spStatus').textContent = run.status;

        if (run.status === 'completed') {
          _spPolling = false;
          if (run.conclusion === 'success') {
            _spAdvanceSteps('done');
            _spSetStep('done', 'done');
            document.getElementById('spHero').className = 'sp-hero success';
            document.getElementById('spSpinner').className = 'sp-spinner';
            document.getElementById('spSpinner').textContent = '✅';
            document.getElementById('spTitle').textContent = 'Sync สำเร็จ!';
            document.getElementById('spPhase').textContent = `เสร็จใน ${_spFmtElapsed(elapsedSec)}`;
            document.getElementById('spClose').textContent = '✅ เสร็จสิ้น';
            document.getElementById('spClose').className = 'sp-close success';
            _spLog(`✅ Completed successfully`, 'ok');
            showToast('✅ Sync สำเร็จ', 'success');
            loadLog();
          } else {
            _spSetStep(lastStep, 'fail');
            document.getElementById('spHero').className = 'sp-hero fail';
            document.getElementById('spSpinner').className = 'sp-spinner';
            document.getElementById('spSpinner').textContent = '❌';
            document.getElementById('spTitle').textContent = 'Sync ล้มเหลว';
            document.getElementById('spPhase').textContent = `${run.conclusion} · ${_spFmtElapsed(elapsedSec)}`;
            document.getElementById('spClose').textContent = '❌ ปิด';
            document.getElementById('spClose').className = 'sp-close danger';
            _spLog(`❌ ${run.conclusion}`, 'err');
            showToast(`❌ Sync ${run.conclusion}`, 'error');
            loadLog();
          }
          return;
        }

        // Determine phase from job steps
        const jobs = await _fetchRunJobs(pat, githubRunId);
        if (jobs?.jobs?.[0]) {
          const steps = jobs.jobs[0].steps || [];
          const runningStep = steps.find(s => s.status === 'in_progress');
          if (runningStep) {
            const name = runningStep.name.toLowerCase();
            let phase = lastStep;
            if (name.includes('run sync')) phase = 'import';
            else if (name.includes('playwright') || name.includes('chromium')) phase = 'queue';
            else if (name.includes('install') || name.includes('setup') || name.includes('checkout')) phase = 'queue';
            else phase = lastStep;

            // Better phase from sync_log if available
            const log = await _fetchLatestSyncLog(startMs);
            if (log) {
              phase = log.rows_total ? 'import' : 'login';
              if (log.rows_total) {
                document.getElementById('spRows').textContent = (log.rows_total || 0).toLocaleString();
              }
            }
            if (phase !== lastStep) {
              _spAdvanceSteps(phase);
              _spLog(`→ ${runningStep.name}`);
              lastStep = phase;
            }
            document.getElementById('spPhase').textContent = runningStep.name;
          }
        }
      } else {
        // Still waiting for run to appear
        document.getElementById('spPhase').textContent = 'Queued ใน GitHub...';
      }
    } catch (e) {
      console.warn('poll err:', e.message);
    }

    // Next poll
    _spPollTimer = setTimeout(tick, 5000);
  };
  tick();
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
