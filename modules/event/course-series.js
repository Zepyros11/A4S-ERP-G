/* ============================================================
   course-series.js — Course Series + Levels CRUD
   - Series: group of related events (e.g., "Unlock the World")
   - Levels: ordered steps within series (Basic → Advance → Master)
   - Prerequisites: must complete previous level before next
   ============================================================ */

const SUPABASE_URL = localStorage.getItem('sb_url') || '';
const SUPABASE_KEY = localStorage.getItem('sb_key') || '';

let seriesList = [];
let levelsMap = {};       // seriesId → [levels]
let editingSeriesId = null;
let editingLevelId = null;
let currentSeriesId = null; // for adding level

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

/* ── Load all series + levels ── */
async function loadAll() {
  showLoading(true);
  try {
    seriesList = await sb('course_series?select=*&order=created_at.asc') || [];
    const allLevels = await sb('course_levels?select=*&order=series_id,level_order.asc') || [];
    levelsMap = {};
    for (const lv of allLevels) {
      if (!levelsMap[lv.series_id]) levelsMap[lv.series_id] = [];
      levelsMap[lv.series_id].push(lv);
    }
    // Count events per series
    for (const s of seriesList) {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/events?select=event_id&series_id=eq.${s.id}`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Prefer: 'count=exact', Range: '0-0' } }
        );
        const range = res.headers.get('content-range') || '*/0';
        s._eventCount = parseInt(range.split('/')[1], 10) || 0;
      } catch { s._eventCount = 0; }
    }
    render();
  } catch (e) {
    showToast('โหลดไม่ได้: ' + e.message, 'error');
  }
  showLoading(false);
}

/* ── Render series + levels ── */
function render() {
  const grid = document.getElementById('seriesGrid');
  if (!seriesList.length) {
    grid.innerHTML = `<div class="cs-empty"><div class="cs-empty-icon">📚</div><div style="font-weight:600;color:var(--text2);font-size:15px">ยังไม่มีหลักสูตร</div><div style="font-size:13px;margin-top:4px">กด "เพิ่มหลักสูตร" เพื่อสร้างหลักสูตรแรก</div></div>`;
    return;
  }

  grid.innerHTML = seriesList.map(s => {
    const levels = levelsMap[s.id] || [];
    const levelsHtml = levels.length
      ? levels.map(lv => {
          const prereq = lv.prerequisite_level_id
            ? levels.find(l => l.id === lv.prerequisite_level_id)
            : null;
          return `<div class="cs-level">
            <div class="cs-level-num" style="background:${s.color || '#3b82f6'}">${lv.level_order}</div>
            <div class="cs-level-info">
              <div class="cs-level-name">${escapeHtml(lv.level_name)}</div>
              <div class="cs-level-prereq">${prereq ? `🔒 ต้องผ่าน: ${escapeHtml(prereq.level_name)}` : '🟢 ไม่มีเงื่อนไข — ลงได้เลย'}</div>
            </div>
            <div class="cs-level-actions">
              <button class="cs-level-btn" onclick="editLevel('${s.id}','${lv.id}')" title="แก้ไข">✏️</button>
              <button class="cs-level-btn danger" onclick="deleteLevel('${lv.id}','${escapeHtml(lv.level_name)}')" title="ลบ">🗑️</button>
            </div>
          </div>`;
        }).join('')
      : '<div style="padding:12px;color:var(--text3);font-size:12.5px;text-align:center;font-style:italic">ยังไม่มี level — กดเพิ่มด้านล่าง</div>';

    return `<div class="cs-card">
      <div class="cs-card-head">
        <div class="cs-card-icon" style="background:${s.color}20">${_safeIcon(s.icon, 28)}</div>
        <div style="flex:1;min-width:0">
          <div class="cs-card-name">${escapeHtml(s.name)}</div>
          ${s.description ? `<div class="cs-card-desc">${escapeHtml(s.description)}</div>` : ''}
        </div>
        <div class="cs-card-actions">
          <button class="cs-btn" onclick="editSeries('${s.id}')">✏️ แก้ไข</button>
          <button class="cs-btn danger" onclick="deleteSeries('${s.id}','${escapeHtml(s.name)}')">🗑️</button>
        </div>
      </div>
      <div class="cs-levels">
        ${levelsHtml}
        <button class="cs-add-level" onclick="openLevelModal('${s.id}')">➕ เพิ่ม Level</button>
      </div>
      <div class="cs-card-foot">
        <span>📊 ${levels.length} levels</span>
        <span>🗓️ ${s._eventCount || 0} events</span>
      </div>
    </div>`;
  }).join('');
}

/* ── Series CRUD ── */
function openSeriesModal(id) {
  editingSeriesId = id || null;
  const s = id ? seriesList.find(x => x.id === id) : null;
  document.getElementById('smTitle').textContent = s ? 'แก้ไขหลักสูตร' : 'เพิ่มหลักสูตร';
  document.getElementById('sfName').value = s?.name || '';
  const icon = s?.icon || '📚';
  document.getElementById('sfIcon').value = icon;
  _updateIconPreview(icon);
  const RANDOM_COLORS = ['#3b82f6','#ef4444','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#f97316','#6366f1','#14b8a6','#e11d48','#0ea5e9'];
  document.getElementById('sfColor').value = s?.color || RANDOM_COLORS[Math.floor(Math.random() * RANDOM_COLORS.length)];
  document.getElementById('sfDesc').value = s?.description || '';
  document.getElementById('seriesModalOverlay').classList.add('open');
  setTimeout(() => document.getElementById('sfName').focus(), 50);
}
function editSeries(id) { openSeriesModal(id); }
function closeSeriesModal() { document.getElementById('seriesModalOverlay').classList.remove('open'); }

async function saveSeries() {
  const name = document.getElementById('sfName').value.trim();
  if (!name) { showToast('กรุณาใส่ชื่อ', 'error'); return; }

  const data = {
    name,
    icon: document.getElementById('sfIcon').value.trim() || '📚',
    color: document.getElementById('sfColor').value || '#3b82f6',
    description: document.getElementById('sfDesc').value.trim() || null,
    updated_at: new Date().toISOString(),
  };

  showLoading(true);
  try {
    if (editingSeriesId) {
      await sb(`course_series?id=eq.${editingSeriesId}`, { method: 'PATCH', body: data });
    } else {
      data.created_at = data.updated_at;
      await sb('course_series', { method: 'POST', body: [data], headers: { Prefer: 'return=minimal' } });
    }
    closeSeriesModal();
    showToast('✅ บันทึกแล้ว', 'success');
    await loadAll();
  } catch (e) {
    showToast('บันทึกไม่ได้: ' + e.message, 'error');
  }
  showLoading(false);
}

async function deleteSeries(id, name) {
  if (!confirm(`ลบหลักสูตร "${name}" ?\n(levels ทั้งหมดจะถูกลบด้วย)`)) return;
  showLoading(true);
  try {
    await sb(`course_series?id=eq.${id}`, { method: 'DELETE' });
    showToast('🗑️ ลบแล้ว', 'success');
    await loadAll();
  } catch (e) {
    showToast('ลบไม่ได้: ' + e.message, 'error');
  }
  showLoading(false);
}

/* ── Level CRUD ── */
function openLevelModal(seriesId, levelId) {
  currentSeriesId = seriesId;
  editingLevelId = levelId || null;
  const levels = levelsMap[seriesId] || [];
  const lv = levelId ? levels.find(l => l.id === levelId) : null;

  document.getElementById('lmTitle').textContent = lv ? 'แก้ไข Level' : 'เพิ่ม Level';
  document.getElementById('lfName').value = lv?.level_name || '';
  document.getElementById('lfOrder').value = lv?.level_order || (levels.length + 1);
  document.getElementById('lfDesc').value = lv?.description || '';

  // Populate prerequisite dropdown
  const sel = document.getElementById('lfPrereq');
  sel.innerHTML = '<option value="">ไม่มี — ลงได้เลย</option>' +
    levels
      .filter(l => l.id !== levelId) // exclude self
      .map(l => `<option value="${l.id}" ${lv?.prerequisite_level_id === l.id ? 'selected' : ''}>Lv.${l.level_order}: ${escapeHtml(l.level_name)}</option>`)
      .join('');

  document.getElementById('levelModalOverlay').classList.add('open');
  setTimeout(() => document.getElementById('lfName').focus(), 50);
}
function editLevel(seriesId, levelId) { openLevelModal(seriesId, levelId); }
function closeLevelModal() { document.getElementById('levelModalOverlay').classList.remove('open'); }

async function saveLevel() {
  const name = document.getElementById('lfName').value.trim();
  if (!name) { showToast('กรุณาใส่ชื่อ Level', 'error'); return; }

  const data = {
    series_id: currentSeriesId,
    level_name: name,
    level_order: parseInt(document.getElementById('lfOrder').value) || 1,
    prerequisite_level_id: document.getElementById('lfPrereq').value || null,
    description: document.getElementById('lfDesc').value.trim() || null,
  };

  showLoading(true);
  try {
    if (editingLevelId) {
      await sb(`course_levels?id=eq.${editingLevelId}`, { method: 'PATCH', body: data });
    } else {
      data.created_at = new Date().toISOString();
      await sb('course_levels', { method: 'POST', body: [data], headers: { Prefer: 'return=minimal' } });
    }
    closeLevelModal();
    showToast('✅ บันทึกแล้ว', 'success');
    await loadAll();
  } catch (e) {
    showToast('บันทึกไม่ได้: ' + e.message, 'error');
  }
  showLoading(false);
}

async function deleteLevel(id, name) {
  if (!confirm(`ลบ level "${name}" ?`)) return;
  showLoading(true);
  try {
    await sb(`course_levels?id=eq.${id}`, { method: 'DELETE' });
    showToast('🗑️ ลบแล้ว', 'success');
    await loadAll();
  } catch (e) {
    showToast('ลบไม่ได้: ' + e.message, 'error');
  }
  showLoading(false);
}

/* ── Icon helper (emoji only, no API) ── */
function _safeIcon(icon, size = 24) {
  if (!icon) return '📚';
  if (icon.includes(':')) {
    const emoji = window.AppPermissions?.iconToEmoji(icon) || '📚';
    return `<span style="font-size:${size}px">${emoji}</span>`;
  }
  return `<span style="font-size:${size}px">${icon}</span>`;
}

/* ── Icon picker (uses shared iconPicker.js module) ── */
async function pickIcon() {
  if (window._loadIconPicker) await window._loadIconPicker();
  if (!window._openIconPicker) { showToast('Icon picker ยังไม่โหลด', 'error'); return; }
  window._openIconPicker({
    current: document.getElementById('sfIcon').value,
    onPick: (icon) => {
      document.getElementById('sfIcon').value = icon;
      _updateIconPreview(icon);
    },
  });
}
function _updateIconPreview(icon) {
  const el = document.getElementById('sfIconPreview');
  if (icon && icon.includes(':') && window._renderIcon) {
    el.innerHTML = window._renderIcon(icon, 24);
  } else {
    el.innerHTML = _safeIcon(icon || '📚', 24);
  }
}

/* ── ESC close ── */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeSeriesModal(); closeLevelModal(); }
});

/* ── Utils ── */
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
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
  await loadAll();
})();
