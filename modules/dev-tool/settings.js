/* ============================================================
   settings.js — Shared automation config (GitHub + LINE)
   Reads/writes `sync_config` table (id=1)
   ============================================================ */

const SUPABASE_URL = localStorage.getItem('sb_url') || '';
const SUPABASE_KEY = localStorage.getItem('sb_key') || '';

let config = {};
let _patDirty = false;
let _lineDirty = false;

/* ── Load config from Supabase ── */
async function loadConfig() {
  showLoading(true);
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/sync_config?id=eq.1&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    config = data?.[0] || {};
    await _populateFields();
    _renderStatusIndicators();
  } catch (e) {
    showToast('โหลด config ไม่ได้: ' + e.message, 'error');
  }
  showLoading(false);
}

async function _populateFields() {
  // GitHub fields (plain text)
  document.getElementById('ghOwner').value    = config.github_owner    || '';
  document.getElementById('ghRepo').value     = config.github_repo     || '';
  document.getElementById('ghBranch').value   = config.github_branch   || 'main';
  document.getElementById('ghPatExpires').value = config.github_pat_expires_at || '';
  _renderPatExpiryBadge();

  // LINE fields
  document.getElementById('lineType').value     = config.line_target_type || 'group';
  document.getElementById('lineTargetId').value = config.line_target_id   || '';
  document.getElementById('lineSuccess').checked = !!config.line_notify_on_success;

  // Decrypt sensitive fields if master key available
  if (!window.ERPCrypto || !ERPCrypto.hasMasterKey()) {
    if (config.github_pat_encrypted) document.getElementById('ghPat').placeholder = '(encrypted — ต้อง Master Key)';
    if (config.line_token_encrypted) document.getElementById('lineToken').placeholder = '(encrypted — ต้อง Master Key)';
    return;
  }
  try {
    if (config.github_pat_encrypted)
      document.getElementById('ghPat').value = (await ERPCrypto.decrypt(config.github_pat_encrypted)) || '';
    if (config.line_token_encrypted)
      document.getElementById('lineToken').value = (await ERPCrypto.decrypt(config.line_token_encrypted)) || '';
  } catch {
    document.getElementById('ghPat').placeholder = '(decrypt ล้มเหลว)';
  }
}

function _renderStatusIndicators() {
  // GitHub status
  const ghEl = document.getElementById('ghStatus');
  if (config.github_owner && config.github_pat_encrypted) {
    ghEl.className = 'config-status ok';
    ghEl.textContent = `✅ เชื่อมต่อ ${config.github_owner}/${config.github_repo} · PAT ตั้งค่าแล้ว`;
  } else if (config.github_owner) {
    ghEl.className = 'config-status warn';
    ghEl.textContent = '⚠️ ตั้งค่า repo แล้ว แต่ยังไม่มี PAT';
  } else {
    ghEl.className = 'config-status none';
    ghEl.textContent = '❌ ยังไม่ได้ตั้งค่า GitHub';
  }

  // LINE status
  const lineEl = document.getElementById('lineStatus');
  if (config.line_token_encrypted && (config.line_target_id || config.line_target_type === 'broadcast')) {
    lineEl.className = 'config-status ok';
    lineEl.textContent = `✅ LINE Notify ตั้งค่าแล้ว (${config.line_target_type})`;
  } else if (config.line_token_encrypted) {
    lineEl.className = 'config-status warn';
    lineEl.textContent = '⚠️ มี Token แต่ยังไม่ได้ตั้ง Target';
  } else {
    lineEl.className = 'config-status none';
    lineEl.textContent = '❌ ยังไม่ได้ตั้งค่า LINE Notify';
  }
}

/* ── Track dirty state ── */
document.addEventListener('input', (e) => {
  if (e.target.id === 'ghPat') _patDirty = true;
  if (e.target.id === 'lineToken') _lineDirty = true;
});

/* ── Eye toggle ── */
function togglePatEye() {
  const inp = document.getElementById('ghPat');
  const eye = document.getElementById('patEye');
  if (inp.type === 'password') { inp.type = 'text'; eye.textContent = '🙈'; }
  else { inp.type = 'password'; eye.textContent = '👁️'; }
}
function toggleLineEye() {
  const inp = document.getElementById('lineToken');
  const eye = document.getElementById('lineTokenEye');
  if (inp.type === 'password') { inp.type = 'text'; eye.textContent = '🙈'; }
  else { inp.type = 'password'; eye.textContent = '👁️'; }
}

/* ── PAT expiry helpers ── */
function _setExpiresIn(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const iso = d.toISOString().slice(0, 10);
  document.getElementById('ghPatExpires').value = iso;
  config.github_pat_expires_at = iso;
  _renderPatExpiryBadge();
}

function _renderPatExpiryBadge() {
  const badge = document.getElementById('patExpiryBadge');
  const expIso = config.github_pat_expires_at;
  if (!expIso) { badge.style.display = 'none'; return; }
  const exp = new Date(expIso + 'T23:59:59');
  const days = Math.floor((exp - Date.now()) / 86400000);

  let cls, text;
  if (days < 0) { cls = 'expired'; text = `❌ หมดอายุแล้ว ${Math.abs(days)} วัน`; }
  else if (days === 0) { cls = 'expired'; text = `⚠️ หมดอายุวันนี้!`; }
  else if (days <= 7)  { cls = 'expired'; text = `⚠️ เหลือ ${days} วัน — ใกล้หมดอายุ!`; }
  else if (days <= 30) { cls = 'warn'; text = `⏰ เหลือ ${days} วัน`; }
  else { cls = 'ok'; text = `✓ เหลือ ${days} วัน · ${DateFmt.formatDMY(expIso)}`; }

  badge.className = `pat-badge ${cls}`;
  badge.textContent = text;
  badge.style.display = 'inline-flex';
}

/* ── Save GitHub config ── */
async function saveGithub() {
  const owner    = document.getElementById('ghOwner').value.trim();
  const repo     = document.getElementById('ghRepo').value.trim();
  const branch   = document.getElementById('ghBranch').value.trim() || 'main';
  const pat      = document.getElementById('ghPat').value;

  if (!owner || !repo) {
    showToast('กรอก owner / repo ก่อน', 'error'); return;
  }

  showLoading(true);
  try {
    const expires = document.getElementById('ghPatExpires').value || null;
    const patch = {
      github_owner: owner,
      github_repo: repo,
      github_branch: branch,
      github_pat_expires_at: expires,
      updated_at: new Date().toISOString(),
    };
    if (_patDirty && pat) {
      if (!ERPCrypto.hasMasterKey()) { showToast('ต้องตั้ง Master Key ก่อน', 'error'); showLoading(false); return; }
      patch.github_pat_encrypted = await ERPCrypto.encrypt(pat);
    }
    const res = await fetch(`${SUPABASE_URL}/rest/v1/sync_config?id=eq.1`, {
      method: 'PATCH',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
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

/* ── Save LINE config ── */
async function saveLine() {
  const token      = document.getElementById('lineToken').value;
  const targetType = document.getElementById('lineType').value;
  const targetId   = document.getElementById('lineTargetId').value.trim();
  const notifySucc = document.getElementById('lineSuccess').checked;

  if (targetType !== 'broadcast' && !targetId) {
    showToast('ใส่ Group ID หรือ User ID ก่อน', 'error'); return;
  }

  showLoading(true);
  try {
    const patch = {
      line_target_type: targetType,
      line_target_id: targetType === 'broadcast' ? null : targetId,
      line_notify_on_success: notifySucc,
      updated_at: new Date().toISOString(),
    };
    if (_lineDirty && token) {
      if (!ERPCrypto.hasMasterKey()) { showToast('ต้องตั้ง Master Key ก่อน', 'error'); showLoading(false); return; }
      patch.line_token_encrypted = await ERPCrypto.encrypt(token);
    }
    const res = await fetch(`${SUPABASE_URL}/rest/v1/sync_config?id=eq.1`, {
      method: 'PATCH',
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json' },
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

/* ── Test LINE (trigger GitHub workflow with test_line input) ── */
async function testLine() {
  if (!config.github_owner || !config.github_pat_encrypted) {
    showToast('ต้องตั้งค่า GitHub ก่อน', 'error'); return;
  }
  if (!ERPCrypto.hasMasterKey()) { showToast('ต้องตั้ง Master Key ก่อน', 'error'); return; }

  if (!confirm('ส่ง Test LINE message ผ่าน GitHub Actions?\n(ใช้เวลา ~30 วินาที)')) return;

  showLoading(true);
  try {
    const pat = await ERPCrypto.decrypt(config.github_pat_encrypted);
    const ghUrl = `https://api.github.com/repos/${config.github_owner}/${config.github_repo}/actions/workflows/${config.github_workflow || 'sync-members.yml'}/dispatches`;
    const res = await fetch(ghUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${pat}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: config.github_branch || 'main', inputs: { test_line: 'true' } }),
    });
    if (res.status === 204) {
      showToast('🚀 ส่ง test ไป GitHub แล้ว — รอ ~30 วิ ดูใน LINE', 'success');
    } else {
      const err = await res.text();
      throw new Error(`${res.status}: ${err.slice(0, 150)}`);
    }
  } catch (e) {
    showToast('ส่งไม่ได้: ' + e.message, 'error');
  }
  showLoading(false);
}

/* ── Utils ── */
function showLoading(on) { document.getElementById('loadingOverlay').style.display = on ? 'flex' : 'none'; }
function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show toast-${type}`;
  setTimeout(() => t.className = 'toast', 3500);
}

/* ── Init ── */
(async () => {
  if (!SUPABASE_URL || !SUPABASE_KEY) { showToast('กรุณาตั้งค่า Supabase ก่อน', 'error'); return; }
  await loadConfig();
})();
