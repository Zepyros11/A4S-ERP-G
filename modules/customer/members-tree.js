/* ============================================================
   members-tree.js — MLM Tree View
   - Search member by code (fast) or name (suggest)
   - 4 modes: sponsor-down/up + upline-down/up
   - Lazy-load children on expand (handles 100k+ members)
   ============================================================ */

const SUPABASE_URL = localStorage.getItem('sb_url') || '';
const SUPABASE_KEY = localStorage.getItem('sb_key') || '';

let currentMember = null;
let currentMode = 'sponsor-down';     // 'sponsor-down' | 'sponsor-up' | 'upline-down' | 'upline-up'
let _searchDebounce = null;

const PKG_LABEL = { DM:'💎 DM', SI:'⭐ SI', PL:'💠 PL', MB:'🎁 MB', EM:'🌟 EM' };

/* ── Supabase fetch helper ── */
async function sb(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 120)}`);
  return res.json();
}
async function sbCount(filter = '') {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/members?select=member_code${filter ? '&' + filter : ''}`,
    {
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        Prefer: 'count=exact', Range: '0-0',
      },
    }
  );
  const range = res.headers.get('content-range') || '*/0';
  return parseInt(range.split('/')[1], 10) || 0;
}

/* ── Search input ── */
document.getElementById('searchInput').addEventListener('input', (e) => {
  const q = e.target.value.trim();
  clearTimeout(_searchDebounce);
  if (!q) { _hideSuggest(); return; }
  // Numeric → direct match; text → suggest
  if (/^\d+$/.test(q)) {
    _searchDebounce = setTimeout(() => loadMember(q), 300);
  } else {
    _searchDebounce = setTimeout(() => suggestByName(q), 350);
  }
});

async function suggestByName(q) {
  try {
    const esc = q.replace(/[,()*]/g, '');
    const rows = await sb(
      `members?select=member_code,full_name,member_name,country_code,package` +
      `&or=(full_name.ilike.*${esc}*,member_name.ilike.*${esc}*)&limit=5`
    );
    if (!rows.length) { _hideSuggest(); return; }
    const html = rows.map(m => {
      const name = MemberFmt.displayName(m);
      return `<div onclick="loadMember('${m.member_code}')" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);transition:background .12s" onmouseover="this.style.background='var(--accent-pale)'" onmouseout="this.style.background='transparent'">
        <span style="font-family:'IBM Plex Mono',monospace;color:var(--accent);font-weight:600;font-size:12px">${m.member_code}</span>
        <span style="margin-left:10px;font-size:13px">${escapeHtml(name)}</span>
        <span style="margin-left:8px;font-size:11px;color:var(--text3)">${m.country_code || ''} · ${m.package || ''}</span>
      </div>`;
    }).join('');
    const sug = document.getElementById('searchSuggest');
    sug.innerHTML = html;
    sug.style.display = 'block';
  } catch (e) { console.error(e); }
}
function _hideSuggest() { document.getElementById('searchSuggest').style.display = 'none'; }

/* ── Load selected member + show card ── */
async function loadMember(code) {
  _hideSuggest();
  document.getElementById('searchInput').value = code;
  showLoading(true);
  try {
    const rows = await sb(`members?select=*&member_code=eq.${encodeURIComponent(code)}&limit=1`);
    if (!rows.length) { showToast(`ไม่พบสมาชิก ${code}`, 'error'); showLoading(false); return; }
    currentMember = rows[0];
    _renderMemberCard(currentMember);
    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('memberCard').style.display = 'block';
    setMode(currentMode);   // re-render tree
  } catch (e) {
    showToast('โหลดไม่ได้: ' + e.message, 'error');
  }
  showLoading(false);
}

function _renderMemberCard(m) {
  const name = window.MemberFmt ? MemberFmt.displayName(m) : (m.full_name || m.member_name || '—');
  const initial = name.replace(/^(นาย|นาง|นางสาว|Mr\.|Mrs\.|Ms\.|บริษัท|ห้างหุ้นส่วน)\s*/i, '').trim().charAt(0).toUpperCase() || '?';
  document.getElementById('mAvatar').textContent = initial;
  document.getElementById('mName').textContent = name;
  document.getElementById('mCode').textContent = `🔖 ${m.member_code} · ${_flag(m.country_code)} ${m.country_code || '—'}`;

  const pkgEl = document.getElementById('mPkgBadge');
  if (m.package) {
    pkgEl.innerHTML = `<span class="tree-pkg pkg-${m.package}" style="font-size:13px;padding:5px 12px">${PKG_LABEL[m.package] || m.package}</span>`;
  } else pkgEl.innerHTML = '';

  document.getElementById('mSponsor').textContent = m.sponsor_code || '— (root)';
  document.getElementById('mUpline').textContent  = m.upline_code  || '— (root)';
  document.getElementById('mSide').textContent    = m.side          || '—';
  document.getElementById('mRegAt').textContent   = m.registered_at ? DateFmt.formatDMY(m.registered_at) : '—';
}

/* ── Mode switching ── */
function setMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.tree-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.mode === mode);
  });
  if (!currentMember) return;
  renderTree();
}

/* ── Render tree based on mode ── */
async function renderTree() {
  const wrap = document.getElementById('treeWrap');
  wrap.innerHTML = '<div class="tree-loading">⏳ กำลังโหลด...</div>';

  try {
    if (currentMode === 'sponsor-up') {
      await renderUplineChain('sponsor_code');
    } else if (currentMode === 'upline-up') {
      await renderUplineChain('upline_code');
    } else {
      // downline (sponsor-down or upline-down)
      const field = currentMode === 'sponsor-down' ? 'sponsor_code' : 'upline_code';
      wrap.innerHTML = '';
      const node = await _buildNode(currentMember, field, 0);
      wrap.appendChild(node);
      // Auto-expand level 1
      const toggle = node.querySelector('.tree-toggle');
      if (toggle && !toggle.classList.contains('leaf')) toggle.click();
    }
  } catch (e) {
    wrap.innerHTML = `<div class="tree-empty">❌ ${escapeHtml(e.message)}</div>`;
  }
}

/* ── Render upline chain (one row per ancestor) — uses RPC for speed ── */
async function renderUplineChain(field) {
  const wrap = document.getElementById('treeWrap');
  let chain = [];
  try {
    // Single RPC call returns full chain via recursive CTE
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_chain_up`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ start_code: currentMember.member_code, field_name: field }),
    });
    if (res.ok) {
      chain = await res.json();
    } else {
      throw new Error('RPC not available');
    }
  } catch (e) {
    // Fallback: sequential fetch (slower but works without SQL 007)
    console.warn('RPC fallback:', e.message);
    chain = [currentMember];
    let curr = currentMember;
    let depth = 0;
    while (curr[field] && depth < 30) {
      try {
        const rows = await sb(`members?select=*&member_code=eq.${encodeURIComponent(curr[field])}&limit=1`);
        if (!rows.length) break;
        chain.push(rows[0]);
        curr = rows[0];
        depth++;
      } catch { break; }
    }
  }

  wrap.innerHTML = '';
  // Breadcrumb top → me
  const bc = document.createElement('div');
  bc.className = 'upline-breadcrumb';
  bc.innerHTML = chain.slice().reverse().map((m, i, arr) => {
    const isLast = i === arr.length - 1;
    const tag = isLast
      ? `<span style="background:var(--accent);color:#fff;padding:4px 10px;border-radius:6px;font-family:'IBM Plex Mono',monospace;font-weight:600">${m.member_code} (คุณ)</span>`
      : `<span class="upline-link" onclick="loadMember('${m.member_code}')">${m.member_code}</span>`;
    return tag + (isLast ? '' : '<span class="upline-arrow">›</span>');
  }).join('');
  wrap.appendChild(bc);

  // List view of chain (deep first → root last)
  for (let i = 0; i < chain.length; i++) {
    const m = chain[i];
    const isMe = i === 0;
    const node = document.createElement('div');
    node.style.cssText = `padding:10px 14px;border:1px solid ${isMe ? 'var(--accent)' : 'var(--border)'};border-radius:8px;margin-top:8px;display:flex;align-items:center;gap:10px;${isMe ? 'background:var(--accent-pale)' : ''}`;
    node.innerHTML = `
      <div style="background:${isMe ? 'var(--accent)' : 'var(--surface2)'};color:${isMe ? '#fff' : 'var(--text2)'};width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px">L${i}</div>
      <div style="flex:1">
        <div style="display:flex;gap:10px;align-items:baseline">
          <span class="tree-code" onclick="loadMember('${m.member_code}')" style="cursor:pointer">${m.member_code}</span>
          <span class="tree-name">${escapeHtml(MemberFmt.displayName(m))}</span>
          ${m.package ? `<span class="tree-pkg pkg-${m.package}">${m.package}</span>` : ''}
          ${m.side ? `<span class="tree-side ${m.side==='ซ้าย'?'left':'right'}">${m.side}</span>` : ''}
        </div>
      </div>
      <span style="font-size:11px;color:var(--text3)">${_flag(m.country_code)} ${m.country_code || ''}</span>
    `;
    wrap.appendChild(node);
  }

  if (chain.length === 1) {
    const note = document.createElement('div');
    note.style.cssText = 'padding:14px;color:var(--text3);font-size:13px;text-align:center';
    note.textContent = `🏛️ คุณคือ root ของสาย ${field === 'sponsor_code' ? 'Sponsor' : 'Upline'} นี้`;
    wrap.appendChild(note);
  }
}

/* ── Fetch children + their child counts in 1 query (RPC) ── */
async function _fetchDownline(parentCode, field) {
  // Try RPC first (fast)
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_direct_downline`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ parent_code: parentCode, field_name: field }),
    });
    if (res.ok) return await res.json();
  } catch {}

  // Fallback: fetch children + N+1 counts (slower but works without SQL 007)
  console.warn('Tree RPC fallback — run sql/007_tree_rpc.sql for speed');
  const order = field === 'upline_code' ? '&order=side.asc,registered_at.asc' : '&order=registered_at.asc';
  const children = await sb(`members?select=*&${field}=eq.${encodeURIComponent(parentCode)}${order}&limit=1000`);
  await Promise.all(children.map(async c => {
    c.child_count = await sbCount(`${field}=eq.${encodeURIComponent(c.member_code)}`);
  }));
  return children;
}

/* ── Build a tree node element with lazy expand ── */
async function _buildRootNode(member, field) {
  // Root node — count its direct children once
  const wrapper = document.createElement('div');
  wrapper.className = 'tree-node-wrap';

  const childCount = await sbCount(`${field}=eq.${encodeURIComponent(member.member_code)}`);
  member.child_count = childCount;
  return _buildNodeFromData(member, field, 0);
}

function _buildNodeFromData(member, field, depth) {
  const wrapper = document.createElement('div');
  wrapper.className = 'tree-node-wrap';

  const childCount = Number(member.child_count || 0);
  const row = document.createElement('div');
  row.className = 'tree-node';
  const name = MemberFmt.displayName(member);
  const isLeaf = childCount === 0;
  row.innerHTML = `
    <div class="tree-toggle ${isLeaf ? 'leaf' : ''}" data-expanded="false">${isLeaf ? '' : '▶'}</div>
    <span class="tree-icon">${depth === 0 ? '🌳' : '👤'}</span>
    <div class="tree-info">
      <span class="tree-code" onclick="event.stopPropagation();loadMember('${member.member_code}')" style="cursor:pointer">${member.member_code}</span>
      <span class="tree-name">${escapeHtml(name)}</span>
      ${member.package ? `<span class="tree-pkg pkg-${member.package}">${member.package}</span>` : ''}
      ${member.side && depth > 0 ? `<span class="tree-side ${member.side==='ซ้าย'?'left':'right'}">${member.side}</span>` : ''}
      <span class="tree-meta">${_flag(member.country_code)} ${member.country_code || ''}</span>
    </div>
    ${childCount > 0 ? `<span class="tree-count">${childCount.toLocaleString()}</span>` : ''}
  `;
  wrapper.appendChild(row);

  if (!isLeaf) {
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'tree-children';
    childrenContainer.style.display = 'none';
    wrapper.appendChild(childrenContainer);

    let loaded = false;
    const toggleEl = row.querySelector('.tree-toggle');
    const expand = async () => {
      const isExpanded = toggleEl.dataset.expanded === 'true';
      if (isExpanded) {
        childrenContainer.style.display = 'none';
        toggleEl.textContent = '▶';
        toggleEl.dataset.expanded = 'false';
        return;
      }
      childrenContainer.style.display = 'block';
      toggleEl.textContent = '▼';
      toggleEl.dataset.expanded = 'true';
      if (!loaded) {
        childrenContainer.innerHTML = '<div class="tree-loading">⏳ กำลังโหลด...</div>';
        try {
          // SINGLE RPC query — fetches children + their child counts
          const children = await _fetchDownline(member.member_code, field);
          childrenContainer.innerHTML = '';
          for (const c of children) {
            childrenContainer.appendChild(_buildNodeFromData(c, field, depth + 1));
          }
          loaded = true;
        } catch (e) {
          childrenContainer.innerHTML = `<div class="tree-empty">❌ ${escapeHtml(e.message)}</div>`;
        }
      }
    };
    row.addEventListener('click', expand);
  } else {
    row.addEventListener('click', () => loadMember(member.member_code));
  }

  return wrapper;
}

// Backwards-compat alias for renderTree call
async function _buildNode(member, field, depth) {
  if (depth === 0) return _buildRootNode(member, field);
  return _buildNodeFromData(member, field, depth);
}

/* ── Utils ── */
function _flag(c) { return c === 'TH' ? '🇹🇭' : c === 'KH' ? '🇰🇭' : '🌐'; }
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({
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

/* Click outside closes suggest */
document.addEventListener('click', (e) => {
  const sug = document.getElementById('searchSuggest');
  const inp = document.getElementById('searchInput');
  if (sug && !sug.contains(e.target) && e.target !== inp) _hideSuggest();
});
