/* ============================================================
   wizard.js — Step Wizard for Automation Builder
   - Load tasks → select → show steps
   - CRUD steps (add/edit/delete/reorder)
   - Preview generated pseudo-code
   - Save steps JSON to automation_tasks.steps
   ============================================================ */

const SUPABASE_URL = localStorage.getItem('sb_url') || '';
const SUPABASE_KEY = localStorage.getItem('sb_key') || '';

let tasks = [];
let currentTaskId = null;
let steps = [];
let editingStepIdx = -1;

const STEP_TYPES = {
  login:     { icon: '🔐', label: 'Login',      bg: 'login' },
  navigate:  { icon: '🔗', label: 'Navigate',   bg: 'navigate' },
  click:     { icon: '👆', label: 'Click',      bg: 'click' },
  fill_form: { icon: '📝', label: 'Fill Form',  bg: 'fill_form' },
  export:    { icon: '📥', label: 'Export',      bg: 'export' },
  import_db: { icon: '🗄️', label: 'Import DB',  bg: 'import_db' },
};

/* ── REST helper ── */
async function sb(path, opts = {}) {
  const { method = 'GET', body, headers = {} } = opts;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 150)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/* ── Load tasks into selector ── */
async function loadTasks() {
  try {
    tasks = await sb('automation_tasks?select=id,name,steps&order=created_at.desc') || [];
    const sel = document.getElementById('taskSelect');
    sel.innerHTML = '<option value="">-- เลือก automation task --</option>' +
      tasks.map(t => `<option value="${t.id}">${escapeHtml(t.name)} (${(t.steps || []).length} steps)</option>`).join('');
  } catch (e) {
    console.warn('loadTasks:', e.message);
    tasks = [];
  }
}

/* ── Load a specific task's steps ── */
function loadTask(id) {
  currentTaskId = id;
  const t = tasks.find(x => x.id === id);
  steps = t?.steps || [];
  document.getElementById('addStepBar').style.display = id ? 'flex' : 'none';
  renderSteps();
}

/* ── Render step list ── */
function renderSteps() {
  const el = document.getElementById('stepList');
  if (!currentTaskId || !steps.length) {
    el.innerHTML = currentTaskId
      ? '<div class="wz-empty"><div class="wz-empty-icon">📭</div><div style="font-weight:600;color:var(--text2)">ยังไม่มี step</div><div style="font-size:12.5px;margin-top:4px">กดปุ่มด้านล่างเพื่อเพิ่ม step แรก</div></div>'
      : '<div class="wz-empty"><div class="wz-empty-icon">🧙</div><div style="font-weight:600;color:var(--text2);font-size:14px">เลือก task ด้านบนเพื่อดูและแก้ไข steps</div></div>';
    return;
  }

  el.innerHTML = steps.map((s, i) => {
    const t = STEP_TYPES[s.type] || { icon: '❓', label: s.type, bg: '' };
    const meta = _stepMeta(s);
    return `<div class="wz-step" onclick="editStep(${i})">
      <div class="wz-step-num">${i + 1}</div>
      <div class="wz-step-icon ${t.bg}">${t.icon}</div>
      <div class="wz-step-body">
        <div class="wz-step-label">${escapeHtml(s.label || t.label)}</div>
        <div class="wz-step-meta">${escapeHtml(meta)}</div>
        <div class="wz-step-type">${t.label}</div>
      </div>
      <div class="wz-step-actions" onclick="event.stopPropagation()">
        <button class="wz-step-btn" onclick="moveStep(${i},-1)" title="ขึ้น" ${i === 0 ? 'disabled style="opacity:.3"' : ''}>▲</button>
        <button class="wz-step-btn" onclick="moveStep(${i},1)" title="ลง" ${i === steps.length - 1 ? 'disabled style="opacity:.3"' : ''}>▼</button>
        <button class="wz-step-btn danger" onclick="deleteStep(${i})" title="ลบ">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

function _stepMeta(s) {
  const c = s.config || {};
  switch (s.type) {
    case 'login': return c.url ? new URL(c.url).hostname : '—';
    case 'navigate': return c.url ? c.url.replace(/https?:\/\/[^/]+/, '') : c.selector || '—';
    case 'click': return c.selector || '—';
    case 'fill_form': return (c.fields || []).map(f => f.selector).join(', ') || '—';
    case 'export': return c.export_selector || '—';
    case 'import_db': return `${c.target_table || '?'} · batch ${c.batch_size || 500}`;
    default: return '—';
  }
}

/* ── Add step ── */
function addStep(type) {
  const t = STEP_TYPES[type] || { label: type };
  steps.push({
    id: `step-${Date.now()}`,
    type,
    label: t.label,
    config: _defaultConfig(type),
  });
  renderSteps();
  editStep(steps.length - 1);
}

function _defaultConfig(type) {
  switch (type) {
    case 'login': return { url: '', username_selector: '', password_selector: '', submit_selector: '', popup_selector: '', wait_after: 2000 };
    case 'navigate': return { url: '', wait: 'networkidle', timeout: 30000 };
    case 'click': return { selector: '', use_js_click: false, wait_after: 1000 };
    case 'fill_form': return { fields: [{ selector: '', value: '', remove_readonly: false }], submit_selector: '', use_js_click: false, wait_processing: '', wait_timeout: 60000 };
    case 'export': return { export_selector: '', confirm_selector: '', download_timeout: 1800000, filename_pattern: '' };
    case 'import_db': return { parser: 'xlsx', target_table: '', conflict_key: '', batch_size: 500, encrypt_fields: [] };
    default: return {};
  }
}

/* ── Delete step ── */
function deleteStep(i) {
  if (!confirm(`ลบ step ${i + 1}: ${steps[i].label} ?`)) return;
  steps.splice(i, 1);
  renderSteps();
}

/* ── Move step ── */
function moveStep(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= steps.length) return;
  [steps[i], steps[j]] = [steps[j], steps[i]];
  renderSteps();
}

/* ── Edit step (open modal) ── */
function editStep(i) {
  editingStepIdx = i;
  const s = steps[i];
  const t = STEP_TYPES[s.type] || { icon: '❓', label: s.type, bg: '' };

  document.getElementById('smIcon').textContent = t.icon;
  document.getElementById('smIcon').className = `icon wz-step-icon ${t.bg}`;
  document.getElementById('smTitle').textContent = `แก้ไข: ${s.label}`;

  const body = document.getElementById('smBody');
  body.innerHTML = _buildStepForm(s);
  document.getElementById('stepModalOverlay').classList.add('open');
}

function closeStepModal() {
  document.getElementById('stepModalOverlay').classList.remove('open');
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeStepModal(); });

function saveStepModal() {
  const s = steps[editingStepIdx];
  if (!s) return;

  // Common: label
  s.label = document.getElementById('sf_label')?.value?.trim() || s.label;

  // Type-specific config
  const c = s.config || {};
  switch (s.type) {
    case 'login':
      c.url = _v('sf_url'); c.username_selector = _v('sf_user_sel'); c.password_selector = _v('sf_pass_sel');
      c.submit_selector = _v('sf_submit_sel'); c.popup_selector = _v('sf_popup_sel');
      c.wait_after = parseInt(_v('sf_wait')) || 2000;
      break;
    case 'navigate':
      c.url = _v('sf_url'); c.wait = _v('sf_wait_strategy'); c.timeout = parseInt(_v('sf_timeout')) || 30000;
      break;
    case 'click':
      c.selector = _v('sf_selector'); c.use_js_click = _checked('sf_js_click'); c.wait_after = parseInt(_v('sf_wait')) || 1000;
      break;
    case 'fill_form':
      c.fields = _collectFields();
      c.submit_selector = _v('sf_submit_sel'); c.use_js_click = _checked('sf_js_click');
      c.wait_processing = _v('sf_wait_proc'); c.wait_timeout = parseInt(_v('sf_wait_timeout')) || 60000;
      break;
    case 'export':
      c.export_selector = _v('sf_export_sel'); c.confirm_selector = _v('sf_confirm_sel');
      c.download_timeout = parseInt(_v('sf_dl_timeout')) || 1800000; c.filename_pattern = _v('sf_filename');
      break;
    case 'import_db':
      c.parser = _v('sf_parser'); c.target_table = _v('sf_table'); c.conflict_key = _v('sf_conflict');
      c.batch_size = parseInt(_v('sf_batch')) || 500;
      c.encrypt_fields = _v('sf_encrypt').split(',').map(s => s.trim()).filter(Boolean);
      break;
  }
  s.config = c;
  closeStepModal();
  renderSteps();
}

function _v(id) { return document.getElementById(id)?.value?.trim() || ''; }
function _checked(id) { return document.getElementById(id)?.checked || false; }

function _collectFields() {
  const items = document.querySelectorAll('.wz-fields-item');
  return Array.from(items).map(el => ({
    selector: el.querySelector('.ff-sel')?.value?.trim() || '',
    value: el.querySelector('.ff-val')?.value?.trim() || '',
    remove_readonly: el.querySelector('.ff-ro')?.checked || false,
  })).filter(f => f.selector);
}

/* ── Build step form HTML per type ── */
function _buildStepForm(s) {
  const c = s.config || {};
  let html = `<div class="wz-field"><label>Label (ชื่อ step)</label><input id="sf_label" value="${escapeAttr(s.label || '')}"></div>`;

  switch (s.type) {
    case 'login':
      html += `
        <div class="wz-field"><label>URL</label><input id="sf_url" value="${escapeAttr(c.url || '')}" placeholder="https://..."></div>
        <div class="wz-field-row">
          <div class="wz-field"><label>Username selector</label><input id="sf_user_sel" value="${escapeAttr(c.username_selector || '')}" placeholder="#tbx-user"></div>
          <div class="wz-field"><label>Password selector</label><input id="sf_pass_sel" value="${escapeAttr(c.password_selector || '')}" placeholder="#tbx-pwd"></div>
        </div>
        <div class="wz-field-row">
          <div class="wz-field"><label>Submit button selector</label><input id="sf_submit_sel" value="${escapeAttr(c.submit_selector || '')}" placeholder="#btn-logins"></div>
          <div class="wz-field"><label>Popup OK selector</label><input id="sf_popup_sel" value="${escapeAttr(c.popup_selector || '')}" placeholder="button.swal-button--confirm"><div class="hint">optional — กดปิด popup หลัง login</div></div>
        </div>
        <div class="wz-field"><label>Wait after (ms)</label><input id="sf_wait" type="number" value="${c.wait_after || 2000}"></div>`;
      break;

    case 'navigate':
      html += `
        <div class="wz-field"><label>URL</label><input id="sf_url" value="${escapeAttr(c.url || '')}" placeholder="https://..."></div>
        <div class="wz-field-row">
          <div class="wz-field"><label>Wait strategy</label><select id="sf_wait_strategy"><option value="networkidle" ${c.wait==='networkidle'?'selected':''}>networkidle</option><option value="domcontentloaded" ${c.wait==='domcontentloaded'?'selected':''}>domcontentloaded</option><option value="load" ${c.wait==='load'?'selected':''}>load</option></select></div>
          <div class="wz-field"><label>Timeout (ms)</label><input id="sf_timeout" type="number" value="${c.timeout || 30000}"></div>
        </div>`;
      break;

    case 'click':
      html += `
        <div class="wz-field"><label>CSS Selector</label><input id="sf_selector" value="${escapeAttr(c.selector || '')}" placeholder="a[href='#collapseOne']"></div>
        <div class="wz-field-row">
          <div class="wz-field"><label>Wait after (ms)</label><input id="sf_wait" type="number" value="${c.wait_after || 1000}"></div>
          <div class="wz-field" style="display:flex;align-items:flex-end"><label class="wz-check"><input type="checkbox" id="sf_js_click" ${c.use_js_click?'checked':''}> ใช้ JS click (reliable กว่า)</label></div>
        </div>`;
      break;

    case 'fill_form': {
      const fields = c.fields || [{ selector: '', value: '', remove_readonly: false }];
      html += `<div class="wz-field"><label>Fields</label><div class="wz-fields-list" id="ffList">`;
      html += fields.map((f, i) => `<div class="wz-fields-item">
        <input class="ff-sel" value="${escapeAttr(f.selector)}" placeholder="selector">
        <input class="ff-val" value="${escapeAttr(f.value)}" placeholder="value / {{var}}">
        <label class="wz-check" style="margin:0;font-size:10px"><input type="checkbox" class="ff-ro" ${f.remove_readonly?'checked':''}> readonly</label>
        <button onclick="this.closest('.wz-fields-item').remove()" title="ลบ">✕</button>
      </div>`).join('');
      html += `</div><button class="wz-add-btn" onclick="addFormField()" style="margin:0">+ Add field</button></div>`;
      html += `
        <div class="wz-field"><label>Submit selector</label><input id="sf_submit_sel" value="${escapeAttr(c.submit_selector || '')}" placeholder="button[type=submit]"></div>
        <label class="wz-check"><input type="checkbox" id="sf_js_click" ${c.use_js_click?'checked':''}> ใช้ JS click</label>
        <div class="wz-field-row" style="margin-top:10px">
          <div class="wz-field"><label>Wait processing selector</label><input id="sf_wait_proc" value="${escapeAttr(c.wait_processing || '')}" placeholder="#datable_processing"></div>
          <div class="wz-field"><label>Wait timeout (ms)</label><input id="sf_wait_timeout" type="number" value="${c.wait_timeout || 60000}"></div>
        </div>`;
      break;
    }

    case 'export':
      html += `
        <div class="wz-field-row">
          <div class="wz-field"><label>Export button selector</label><input id="sf_export_sel" value="${escapeAttr(c.export_selector || '')}" placeholder="a[class*=exportExcel]"></div>
          <div class="wz-field"><label>Confirm button selector</label><input id="sf_confirm_sel" value="${escapeAttr(c.confirm_selector || '')}" placeholder="button.confirm"></div>
        </div>
        <div class="wz-field-row">
          <div class="wz-field"><label>Download timeout (ms)</label><input id="sf_dl_timeout" type="number" value="${c.download_timeout || 1800000}"></div>
          <div class="wz-field"><label>Filename pattern</label><input id="sf_filename" value="${escapeAttr(c.filename_pattern || '')}" placeholder="file-{{timestamp}}.xls"></div>
        </div>`;
      break;

    case 'import_db':
      html += `
        <div class="wz-field-row3">
          <div class="wz-field"><label>Parser</label><select id="sf_parser"><option value="xlsx" ${c.parser==='xlsx'?'selected':''}>xlsx (SheetJS)</option><option value="csv" ${c.parser==='csv'?'selected':''}>CSV</option></select></div>
          <div class="wz-field"><label>Target table</label><input id="sf_table" value="${escapeAttr(c.target_table || '')}" placeholder="members"></div>
          <div class="wz-field"><label>Conflict key</label><input id="sf_conflict" value="${escapeAttr(c.conflict_key || '')}" placeholder="member_code"></div>
        </div>
        <div class="wz-field-row">
          <div class="wz-field"><label>Batch size</label><input id="sf_batch" type="number" value="${c.batch_size || 500}"></div>
          <div class="wz-field"><label>Encrypt fields (comma)</label><input id="sf_encrypt" value="${(c.encrypt_fields || []).join(', ')}" placeholder="__password_plain, __national_id_plain"></div>
        </div>`;
      break;
  }
  return html;
}

/* ── Add form field row (fill_form type) ── */
function addFormField() {
  const list = document.getElementById('ffList');
  if (!list) return;
  const div = document.createElement('div');
  div.className = 'wz-fields-item';
  div.innerHTML = `
    <input class="ff-sel" placeholder="selector">
    <input class="ff-val" placeholder="value / {{var}}">
    <label class="wz-check" style="margin:0;font-size:10px"><input type="checkbox" class="ff-ro"> readonly</label>
    <button onclick="this.closest('.wz-fields-item').remove()" title="ลบ">✕</button>`;
  list.appendChild(div);
}

/* ── Save steps to Supabase ── */
async function saveSteps() {
  if (!currentTaskId) { showToast('เลือก task ก่อน', 'error'); return; }
  showLoading(true);
  try {
    await sb(`automation_tasks?id=eq.${currentTaskId}`, {
      method: 'PATCH',
      body: { steps, updated_at: new Date().toISOString() },
    });
    showToast('✅ บันทึก steps แล้ว', 'success');
    await loadTasks();
    // Re-select current task
    document.getElementById('taskSelect').value = currentTaskId;
  } catch (e) {
    showToast('บันทึกไม่ได้: ' + e.message, 'error');
  }
  showLoading(false);
}

/* ── Preview pseudo-code ── */
function togglePreview() {
  const panel = document.getElementById('previewPanel');
  if (panel.classList.contains('show')) {
    panel.classList.remove('show');
    return;
  }
  panel.innerHTML = _generatePreview();
  panel.classList.add('show');
}

function _generatePreview() {
  if (!steps.length) return '<span class="comment">// ยังไม่มี step</span>';
  let code = '<span class="comment">// Generated Playwright pseudo-code</span>\n';
  code += '<span class="keyword">const</span> { chromium } = <span class="fn">require</span>(<span class="string">\'playwright\'</span>);\n\n';
  code += '<span class="keyword">const</span> browser = <span class="keyword">await</span> chromium.<span class="fn">launch</span>();\n';
  code += '<span class="keyword">const</span> page = <span class="keyword">await</span> browser.<span class="fn">newPage</span>();\n\n';

  for (const s of steps) {
    const c = s.config || {};
    code += `<span class="comment">// Step: ${escapeHtml(s.label)}</span>\n`;
    switch (s.type) {
      case 'login':
        code += `<span class="keyword">await</span> page.<span class="fn">goto</span>(<span class="string">'${escapeHtml(c.url)}'</span>);\n`;
        code += `<span class="keyword">await</span> page.<span class="fn">fill</span>(<span class="string">'${escapeHtml(c.username_selector)}'</span>, USERNAME);\n`;
        code += `<span class="keyword">await</span> page.<span class="fn">fill</span>(<span class="string">'${escapeHtml(c.password_selector)}'</span>, PASSWORD);\n`;
        code += `<span class="keyword">await</span> page.<span class="fn">click</span>(<span class="string">'${escapeHtml(c.submit_selector)}'</span>);\n`;
        if (c.popup_selector) code += `<span class="keyword">await</span> page.<span class="fn">click</span>(<span class="string">'${escapeHtml(c.popup_selector)}'</span>);\n`;
        break;
      case 'navigate':
        code += `<span class="keyword">await</span> page.<span class="fn">goto</span>(<span class="string">'${escapeHtml(c.url)}'</span>, { waitUntil: <span class="string">'${c.wait}'</span> });\n`;
        break;
      case 'click':
        code += c.use_js_click
          ? `<span class="keyword">await</span> page.<span class="fn">evaluate</span>(() => document.<span class="fn">querySelector</span>(<span class="string">'${escapeHtml(c.selector)}'</span>).<span class="fn">click</span>());\n`
          : `<span class="keyword">await</span> page.<span class="fn">click</span>(<span class="string">'${escapeHtml(c.selector)}'</span>);\n`;
        if (c.wait_after) code += `<span class="keyword">await</span> page.<span class="fn">waitForTimeout</span>(${c.wait_after});\n`;
        break;
      case 'fill_form':
        (c.fields || []).forEach(f => {
          if (f.remove_readonly) code += `<span class="keyword">await</span> page.<span class="fn">evaluate</span>(() => document.<span class="fn">querySelector</span>(<span class="string">'${escapeHtml(f.selector)}'</span>).removeAttribute(<span class="string">'readonly'</span>));\n`;
          code += `<span class="keyword">await</span> page.<span class="fn">fill</span>(<span class="string">'${escapeHtml(f.selector)}'</span>, <span class="string">'${escapeHtml(f.value)}'</span>);\n`;
        });
        if (c.submit_selector) code += `<span class="keyword">await</span> page.<span class="fn">click</span>(<span class="string">'${escapeHtml(c.submit_selector)}'</span>);\n`;
        if (c.wait_processing) code += `<span class="keyword">await</span> page.<span class="fn">waitForSelector</span>(<span class="string">'${escapeHtml(c.wait_processing)}'</span>, { state: <span class="string">'hidden'</span>, timeout: ${c.wait_timeout} });\n`;
        break;
      case 'export':
        code += `<span class="keyword">await</span> page.<span class="fn">click</span>(<span class="string">'${escapeHtml(c.export_selector)}'</span>);\n`;
        if (c.confirm_selector) code += `<span class="keyword">await</span> page.<span class="fn">click</span>(<span class="string">'${escapeHtml(c.confirm_selector)}'</span>);\n`;
        code += `<span class="keyword">const</span> download = <span class="keyword">await</span> page.<span class="fn">waitForEvent</span>(<span class="string">'download'</span>, { timeout: ${c.download_timeout} });\n`;
        break;
      case 'import_db':
        code += `<span class="fn">parseXlsToRecords</span>(filePath);\n`;
        code += `<span class="fn">upsertMembers</span>(records, ${c.batch_size});\n`;
        break;
    }
    code += '\n';
  }
  code += '<span class="keyword">await</span> browser.<span class="fn">close</span>();';
  return code;
}

/* ── Utils ── */
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function escapeAttr(s) { return String(s ?? '').replace(/"/g, '&quot;'); }
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
  showLoading(true);
  await loadTasks();
  // Auto-select if URL has ?task=id
  const params = new URLSearchParams(location.search);
  if (params.get('task')) {
    document.getElementById('taskSelect').value = params.get('task');
    loadTask(params.get('task'));
  }
  showLoading(false);
})();
