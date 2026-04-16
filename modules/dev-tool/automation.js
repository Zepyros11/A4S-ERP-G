/* ============================================================
   automation.js — Dev Tool: Web Automation Manager
   - CRUD automation tasks (stored in Supabase `automation_tasks`)
   - Run via GitHub Actions workflow_dispatch
   - View run history from `sync_log`
   ============================================================ */

const SUPABASE_URL = localStorage.getItem('sb_url') || '';
const SUPABASE_KEY = localStorage.getItem('sb_key') || '';

let tasks = [];
let editingId = null;

/* ── REST helper ── */
async function sb(path, opts = {}) {
  const { method = 'GET', body, headers = {} } = opts;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json', ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text.slice(0, 150)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/* ── Load tasks ── */
async function loadTasks() {
  try {
    tasks = await sb('automation_tasks?select=*&order=created_at.desc') || [];
    renderTasks();
  } catch (e) {
    // Table may not exist yet — show empty state
    console.warn('automation_tasks:', e.message);
    tasks = [];
    renderTasks();
  }
}

function renderTasks() {
  const grid = document.getElementById('taskGrid');
  const empty = document.getElementById('emptyState');

  if (!tasks.length) {
    grid.innerHTML = '';
    grid.appendChild(empty);
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  grid.innerHTML = tasks.map(t => {
    const typeIcon = t.task_type === 'api_fetch' ? 'api' : t.task_type === 'file_import' ? 'file' : 'web';
    const typeEmoji = typeIcon === 'api' ? '📡' : typeIcon === 'file' ? '📁' : '🌐';
    const statusDot = t.status === 'active' ? 'active' : t.status === 'error' ? 'error' : 'inactive';
    const scheduleLabel = { 'manual': 'Manual', '1h': 'ทุก 1 ชม.', '3h': 'ทุก 3 ชม.', '6h': 'ทุก 6 ชม.', '12h': 'ทุก 12 ชม.', '24h': 'ทุกวัน', 'weekly': 'ทุกสัปดาห์' };

    return `<div class="task-card">
      <div class="task-card-head">
        <div class="task-icon ${typeIcon}">${typeEmoji}</div>
        <div style="flex:1;min-width:0">
          <div class="task-name">${escapeHtml(t.name)}</div>
          <div class="task-url">${escapeHtml(t.target_url || '—')}</div>
        </div>
        <div class="task-status"><div class="dot ${statusDot}"></div>${t.status || 'inactive'}</div>
      </div>
      <div class="task-card-body">
        <div class="task-info">
          <dt>Schedule</dt><dd>${scheduleLabel[t.schedule] || t.schedule || 'Manual'}</dd>
          <dt>Workflow</dt><dd>${escapeHtml(t.workflow || '—')}</dd>
          <dt>Last run</dt><dd>${t.last_run_at ? DateFmt.formatDMYTime(t.last_run_at) : '—'}</dd>
          <dt>Last rows</dt><dd>${t.last_row_count != null ? Number(t.last_row_count).toLocaleString() : '—'}</dd>
        </div>
      </div>
      <div class="task-card-foot">
        <button class="task-btn" onclick="editTask('${t.id}')">✏️ แก้ไข</button>
        <button class="task-btn" onclick="deleteTask('${t.id}','${escapeHtml(t.name)}')">🗑️</button>
        ${t.config_url ? `<a class="task-btn" href="${escapeHtml(t.config_url)}" style="text-decoration:none">⚙️ Detail</a>` : ''}
        <button class="task-btn run" onclick="runTask('${t.id}')">▶️ Run</button>
      </div>
    </div>`;
  }).join('');
}

/* ── Modal ── */
function openAddModal() {
  editingId = null;
  document.getElementById('modalTitle').textContent = '➕ เพิ่ม Automation Task';
  document.getElementById('fName').value = '';
  document.getElementById('fType').value = 'web_download';
  document.getElementById('fUrl').value = '';
  document.getElementById('fUser').value = '';
  document.getElementById('fPass').value = '';
  document.getElementById('fWorkflow').value = '';
  document.getElementById('fSchedule').value = '24h';
  document.getElementById('fStatus').value = 'active';
  document.getElementById('fNotes').value = '';
  document.getElementById('fConfigUrl').value = '';
  document.getElementById('taskModalOverlay').classList.add('open');
}

function editTask(id) {
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  editingId = id;
  document.getElementById('modalTitle').textContent = '✏️ แก้ไข Task';
  document.getElementById('fName').value = t.name || '';
  document.getElementById('fType').value = t.task_type || 'web_download';
  document.getElementById('fUrl').value = t.target_url || '';
  document.getElementById('fUser').value = t.username || '';
  document.getElementById('fPass').value = '';
  document.getElementById('fWorkflow').value = t.workflow || '';
  document.getElementById('fSchedule').value = t.schedule || '24h';
  document.getElementById('fStatus').value = t.status || 'active';
  document.getElementById('fNotes').value = t.notes || '';
  document.getElementById('fConfigUrl').value = t.config_url || '';
  document.getElementById('taskModalOverlay').classList.add('open');
}

function closeModal() {
  document.getElementById('taskModalOverlay').classList.remove('open');
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

async function saveTask() {
  const name = document.getElementById('fName').value.trim();
  if (!name) { showToast('กรุณาใส่ชื่อ Task', 'error'); return; }

  const data = {
    name,
    task_type: document.getElementById('fType').value,
    target_url: document.getElementById('fUrl').value.trim(),
    username: document.getElementById('fUser').value.trim() || null,
    workflow: document.getElementById('fWorkflow').value.trim() || null,
    schedule: document.getElementById('fSchedule').value,
    status: document.getElementById('fStatus').value,
    notes: document.getElementById('fNotes').value.trim() || null,
    config_url: document.getElementById('fConfigUrl').value.trim() || null,
  };

  // Encrypt password if provided
  const pass = document.getElementById('fPass').value;
  if (pass && window.ERPCrypto && ERPCrypto.hasMasterKey()) {
    data.password_encrypted = await ERPCrypto.encrypt(pass);
  }

  showLoading(true);
  try {
    if (editingId) {
      data.updated_at = new Date().toISOString();
      await sb(`automation_tasks?id=eq.${editingId}`, { method: 'PATCH', body: data });
      showToast('✅ อัพเดทแล้ว', 'success');
    } else {
      data.created_at = new Date().toISOString();
      data.updated_at = data.created_at;
      await sb('automation_tasks', { method: 'POST', body: [data], headers: { Prefer: 'return=minimal' } });
      showToast('✅ เพิ่มแล้ว', 'success');
    }
    closeModal();
    await loadTasks();
  } catch (e) {
    showToast('บันทึกไม่ได้: ' + e.message, 'error');
  }
  showLoading(false);
}

async function deleteTask(id, name) {
  if (!confirm(`ลบ task "${name}" ?`)) return;
  showLoading(true);
  try {
    await sb(`automation_tasks?id=eq.${id}`, { method: 'DELETE' });
    showToast('🗑️ ลบแล้ว', 'success');
    await loadTasks();
  } catch (e) {
    showToast('ลบไม่ได้: ' + e.message, 'error');
  }
  showLoading(false);
}

/* ── Run task (trigger GitHub workflow) ── */
async function runTask(id) {
  const t = tasks.find(x => x.id === id);
  if (!t || !t.workflow) {
    showToast('ต้องกำหนด workflow ก่อน', 'error');
    return;
  }

  // Need GitHub config from sync_config
  let ghConfig;
  try {
    const rows = await sb('sync_config?id=eq.1&limit=1');
    ghConfig = rows?.[0];
  } catch { }
  if (!ghConfig?.github_owner || !ghConfig?.github_pat_encrypted) {
    showToast('ต้องตั้งค่า GitHub PAT ที่หน้า Auto-Sync ก่อน', 'error');
    return;
  }
  if (!window.ERPCrypto || !ERPCrypto.hasMasterKey()) {
    showToast('ต้องตั้ง Master Key ก่อน', 'error');
    return;
  }

  showLoading(true);
  try {
    const pat = await ERPCrypto.decrypt(ghConfig.github_pat_encrypted);
    const ghUrl = `https://api.github.com/repos/${ghConfig.github_owner}/${ghConfig.github_repo}/actions/workflows/${t.workflow}/dispatches`;
    const res = await fetch(ghUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${pat}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: ghConfig.github_branch || 'main' }),
    });
    if (res.status === 204) {
      // Update last_run_at
      await sb(`automation_tasks?id=eq.${id}`, {
        method: 'PATCH',
        body: { last_run_at: new Date().toISOString() },
      });
      showToast(`🚀 ${t.name} — ส่ง workflow แล้ว`, 'success');
      await loadTasks();
    } else {
      const err = await res.text();
      throw new Error(`GitHub ${res.status}: ${err.slice(0, 150)}`);
    }
  } catch (e) {
    showToast('รันไม่ได้: ' + e.message, 'error');
  }
  showLoading(false);
}

/* ── Load logs ── */
async function loadLogs() {
  try {
    const rows = await sb('sync_log?select=*&order=started_at.desc&limit=20');
    const body = document.getElementById('logBody');
    if (!rows?.length) {
      body.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text3)">ไม่มีประวัติ</td></tr>';
      return;
    }
    body.innerHTML = rows.map(r => {
      const badge = r.status === 'success' ? 'success' : r.status === 'running' ? 'running' : 'failed';
      const dur = r.duration_sec ? `${Math.floor(r.duration_sec / 60)}m ${r.duration_sec % 60}s` : '—';
      return `<tr>
        <td style="font-weight:600">${escapeHtml(r.source || '—')}</td>
        <td style="font-size:12px;color:var(--text3)">${r.started_at ? DateFmt.formatDMYTime(r.started_at) : '—'}</td>
        <td><span class="log-badge ${badge}">${r.status}</span></td>
        <td style="text-align:right;font-variant-numeric:tabular-nums">${r.rows_total != null ? Number(r.rows_total).toLocaleString() : '—'}</td>
        <td style="text-align:right;font-variant-numeric:tabular-nums">${dur}</td>
        <td style="font-size:11px;color:var(--text3);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(r.error_message || '')}">${escapeHtml((r.error_message || '').slice(0, 60))}</td>
      </tr>`;
    }).join('');
  } catch (e) {
    console.warn('loadLogs:', e.message);
  }
}

/* ── Utils ── */
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}
function showLoading(on) {
  document.getElementById('loadingOverlay').style.display = on ? 'flex' : 'none';
}
function showToast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show toast-${type}`;
  setTimeout(() => t.className = 'toast', 3500);
}

/* ── Init ── */
(async () => {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    showToast('กรุณาตั้งค่า Supabase ก่อน', 'error');
    return;
  }
  showLoading(true);
  await Promise.all([loadTasks(), loadLogs()]);
  showLoading(false);
})();
