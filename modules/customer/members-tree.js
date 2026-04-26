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
      `members?select=member_code,full_name,member_name,country_code,position_level` +
      `&or=(full_name.ilike.*${esc}*,member_name.ilike.*${esc}*)&limit=5`
    );
    if (!rows.length) { _hideSuggest(); return; }
    const html = rows.map(m => {
      const name = MemberFmt.displayName(m);
      return `<div onclick="loadMember('${m.member_code}')" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border);transition:background .12s" onmouseover="this.style.background='var(--accent-pale)'" onmouseout="this.style.background='transparent'">
        <span style="font-family:'IBM Plex Mono',monospace;color:var(--accent);font-weight:600;font-size:12px">${m.member_code}</span>
        <span style="margin-left:10px;font-size:13px">${escapeHtml(name)}</span>
        <span style="margin-left:8px;font-size:11px;color:var(--text3)">${m.country_code || ''} · ${m.position_level || ''}</span>
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
  if (m.position_level) {
    pkgEl.innerHTML = `<span class="tree-pos" style="font-size:13px;padding:5px 12px">⭐ ${escapeHtml(m.position_level)}</span>`;
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
const MODE_HINT = {
  'sponsor-down':    '⭐ <b>ลูกทีมของคุณ</b> — คนที่<b>คุณชวน</b>มาสมัคร ไล่ลงไปเรื่อยๆ · คลิก <b>▶</b> ขยายดูลูก · แยกเป็น 2 คอลัมน์ <span style="color:#1e40af;font-weight:600">ซ้าย</span>/<span style="color:#991b1b;font-weight:600">ขวา</span> ตามตำแหน่ง binary',
  'sponsor-up':      '⬆️ <b>แม่ทีมของคุณ</b> — คนที่<b>ชวนคุณ</b>มา ไล่ขึ้นไปถึง root · คลิก<b>รหัส</b>หรือ<b>ปุ่ม breadcrumb</b>เพื่อกระโดดไปดูคนนั้นแทน',
  'sponsor-leaders': '👑 <b>หัวหน้าทีม</b> — คนในสาย<b>แม่ทีม (Sponsor)</b>ที่มีตำแหน่ง <b>SVP / VP / AVP</b> เรียงจากตำแหน่งสูงสุดลงมา · คลิกแถวเพื่อกระโดดไปดูคนนั้น',
  'upline-down':     '🌲 <b>Downline Binary</b> — ใครอยู่<b>ใต้คุณ</b>ในผังคำนวณโบนัส (ซ้าย/ขวา max 2 คน) · คลิก <b>▼ ขยาย</b> เปิดชั้นต่อไป · ช่องว่าง = ยังไม่มีคนในตำแหน่งนั้น',
  'upline-up':       '⬆️ <b>Upline Binary</b> — <b>คุณอยู่ใต้ใคร</b>ในผังคำนวณโบนัส ไล่ขึ้นยอดบน · คลิก<b>รหัส</b>เพื่อเปลี่ยนคนที่ดู · L = ระดับห่างจากคุณ',
};

const LEADER_RANKS = { SVP: 1, VP: 2, AVP: 3 };
const LEADER_POS_STYLE = {
  SVP: { bg: '#fce7f3', color: '#9f1239' },
  VP:  { bg: '#fef3c7', color: '#92400e' },
  AVP: { bg: '#cffafe', color: '#0e7490' },
};

function _makeHint() {
  const hint = document.createElement('div');
  hint.style.cssText = 'padding:10px 14px;background:var(--accent-pale);border-left:3px solid var(--accent);border-radius:6px;margin-bottom:12px;font-size:12.5px;color:var(--text2);line-height:1.5';
  hint.innerHTML = MODE_HINT[currentMode] || '';
  return hint;
}

async function renderTree() {
  const wrap = document.getElementById('treeWrap');
  wrap.innerHTML = '<div class="tree-loading">⏳ กำลังโหลด...</div>';

  try {
    if (currentMode === 'sponsor-up') {
      await renderUplineChain('sponsor_code');
      wrap.insertBefore(_makeHint(), wrap.firstChild);
    } else if (currentMode === 'upline-up') {
      await renderUplineChain('upline_code');
      wrap.insertBefore(_makeHint(), wrap.firstChild);
    } else if (currentMode === 'sponsor-leaders') {
      await renderSponsorLeaders();
    } else if (currentMode === 'upline-down') {
      await renderBinaryTree();
    } else {
      // sponsor-down: list view (recursive, no left/right)
      wrap.innerHTML = '';
      wrap.appendChild(_makeHint());
      const node = await _buildNode(currentMember, 'sponsor_code', 0);
      wrap.appendChild(node);
      const toggle = node.querySelector('.tree-toggle');
      if (toggle && !toggle.classList.contains('leaf')) toggle.click();
    }
  } catch (e) {
    wrap.innerHTML = `<div class="tree-empty">❌ ${escapeHtml(e.message)}</div>`;
  }
}

/* ── Binary tree (upline-down mode) ── */
async function renderBinaryTree() {
  const wrap = document.getElementById('treeWrap');
  wrap.innerHTML = '';
  wrap.appendChild(_makeHint());

  const container = document.createElement('div');
  container.className = 'binary-tree';
  wrap.appendChild(container);

  // Root
  const childCount = await sbCount(`upline_code=eq.${encodeURIComponent(currentMember.member_code)}`);
  currentMember.child_count = childCount;
  const rootNode = _buildBinaryNode(currentMember, 0, true);
  container.appendChild(rootNode);

  // Auto-expand root
  const rootBtn = rootNode.querySelector(':scope > .bt-expand');
  if (rootBtn) rootBtn.click();
}

function _buildBinaryNode(member, depth, isRoot = false) {
  const wrap = document.createElement('div');
  wrap.className = 'bt-node';

  const name = MemberFmt.displayName(member);
  const card = document.createElement('div');
  card.className = 'bt-card' + (isRoot ? ' root' : '');
  card.innerHTML = `
    <div class="bt-code tt" data-tip="${escapeHtml(name)}${member.position_level ? ' · ' + escapeHtml(member.position_level) : ''}" onclick="event.stopPropagation();loadMember('${member.member_code}')">${member.member_code}</div>
    <div class="bt-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
    <div class="bt-meta">
      ${member.position_level ? `<span class="tree-pos">⭐ ${escapeHtml(member.position_level)}</span>` : ''}
      ${member.side && !isRoot ? `<span class="tree-side ${member.side==='ซ้าย'?'left':'right'}">${member.side}</span>` : ''}
      <span>${_flag(member.country_code)} ${member.country_code || ''}</span>
    </div>
  `;
  wrap.appendChild(card);

  const childCount = Number(member.child_count || 0);
  if (childCount === 0) return wrap;

  const btn = document.createElement('button');
  btn.className = 'bt-expand';
  btn.textContent = `▼ ขยาย (${childCount})`;
  wrap.appendChild(btn);

  let loaded = false;
  let childContainer = null;

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (loaded) {
      if (childContainer) childContainer.remove();
      btn.textContent = `▼ ขยาย (${childCount})`;
      loaded = false;
      childContainer = null;
      return;
    }
    btn.textContent = '⏳ กำลังโหลด...';
    try {
      const children = await _fetchDownline(member.member_code, 'upline_code');
      const left = children.find(c => c.side === 'ซ้าย');
      const right = children.find(c => c.side === 'ขวา');

      childContainer = document.createElement('div');
      childContainer.className = 'bt-children';

      const leftSlot = document.createElement('div');
      leftSlot.className = 'bt-slot bt-slot-left';
      leftSlot.innerHTML = `<span class="bt-side-label left">◀ ซ้าย</span>`;
      if (left) leftSlot.appendChild(_buildBinaryNode(left, depth + 1));
      else {
        const empty = document.createElement('div');
        empty.className = 'bt-empty';
        empty.textContent = 'ว่าง';
        leftSlot.appendChild(empty);
      }

      const rightSlot = document.createElement('div');
      rightSlot.className = 'bt-slot bt-slot-right';
      rightSlot.innerHTML = `<span class="bt-side-label right">ขวา ▶</span>`;
      if (right) rightSlot.appendChild(_buildBinaryNode(right, depth + 1));
      else {
        const empty = document.createElement('div');
        empty.className = 'bt-empty';
        empty.textContent = 'ว่าง';
        rightSlot.appendChild(empty);
      }

      childContainer.appendChild(leftSlot);
      childContainer.appendChild(rightSlot);
      wrap.appendChild(childContainer);
      btn.textContent = '▲ ย่อ';
      loaded = true;

      // Warn if sparse/extra children
      const extras = children.length - (left ? 1 : 0) - (right ? 1 : 0);
      if (extras > 0) console.warn(`[binary-tree] ${member.member_code} has ${extras} extra children beyond ซ้าย/ขวา`);
    } catch (err) {
      btn.textContent = `▼ ขยาย (${childCount})`;
      showToast('โหลดไม่ได้: ' + err.message, 'error');
    }
  });

  return wrap;
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
    const nm = escapeHtml(MemberFmt.displayName(m));
    const pos = m.position_level ? ` · ${escapeHtml(m.position_level)}` : '';
    const flag = _flag(m.country_code);
    const ttl = `${flag} ${nm}${pos}`;
    const tag = isLast
      ? `<span class="tt" data-tip="${ttl}" style="background:var(--accent);color:#fff;padding:4px 10px;border-radius:6px;font-family:'IBM Plex Mono',monospace;font-weight:600">${m.member_code} (คุณ)</span>`
      : `<span class="upline-link tt" data-tip="${ttl}" onclick="loadMember('${m.member_code}')">${m.member_code}</span>`;
    return tag + (isLast ? '' : '<span class="upline-arrow">›</span>');
  }).join('');
  wrap.appendChild(bc);

  // Split chain into left/right columns (same layout as downline)
  const lefts  = chain.map((m, i) => ({ m, i })).filter(x => x.m.side === 'ซ้าย');
  const rights = chain.map((m, i) => ({ m, i })).filter(x => x.m.side === 'ขวา');
  const others = chain.map((m, i) => ({ m, i })).filter(x => x.m.side !== 'ซ้าย' && x.m.side !== 'ขวา');

  const splitWrap = document.createElement('div');
  splitWrap.className = 'tree-children split';
  splitWrap.style.marginLeft = '0';
  splitWrap.style.paddingLeft = '0';

  const makeChainCol = (side, label, rows) => {
    const col = document.createElement('div');
    col.className = `tree-col ${side}`;
    col.innerHTML = `<div class="tree-col-header ${side}">${label} (${rows.length})</div>`;
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'tree-col-empty';
      empty.textContent = '— ไม่มีสายฝั่งนี้ —';
      col.appendChild(empty);
      return col;
    }
    for (const { m, i } of rows) {
      const isMe = i === 0;
      const nm = escapeHtml(MemberFmt.displayName(m));
      const posTxt = m.position_level ? escapeHtml(m.position_level) : '';
      const tip = `${nm}${posTxt ? ' · ' + posTxt : ''}${m.side ? ' · ' + m.side : ''}`;
      const row = document.createElement('div');
      row.style.cssText = `padding:9px 12px;border:1px solid ${isMe ? 'var(--accent)' : 'var(--border)'};border-radius:8px;margin-top:6px;display:flex;align-items:center;gap:10px;${isMe ? 'background:var(--accent-pale)' : 'background:var(--surface)'}`;
      row.innerHTML = `
        <div style="background:${isMe ? 'var(--accent)' : 'var(--surface2)'};color:${isMe ? '#fff' : 'var(--text2)'};width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;flex-shrink:0">L${i}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap">
            <span class="tree-code tt" data-tip="${tip}" onclick="loadMember('${m.member_code}')" style="cursor:pointer">${m.member_code}</span>
            <span class="tree-name" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${nm}</span>
            ${posTxt ? `<span class="tree-pos">⭐ ${posTxt}</span>` : ''}
          </div>
        </div>
        <span style="font-size:11px;color:var(--text3);flex-shrink:0">${_flag(m.country_code)}</span>
      `;
      col.appendChild(row);
    }
    return col;
  };

  splitWrap.appendChild(makeChainCol('left',  '◀ ซ้าย', lefts));
  splitWrap.appendChild(makeChainCol('right', 'ขวา ▶', rights));
  wrap.appendChild(splitWrap);

  if (others.length) {
    const othersCol = document.createElement('div');
    othersCol.className = 'tree-col';
    othersCol.style.marginTop = '12px';
    othersCol.innerHTML = `<div class="tree-col-header none">ไม่ระบุด้าน (${others.length})</div>`;
    for (const { m, i } of others) {
      const nm = escapeHtml(MemberFmt.displayName(m));
      const row = document.createElement('div');
      row.style.cssText = 'padding:9px 12px;border:1px solid var(--border);border-radius:8px;margin-top:6px;display:flex;align-items:center;gap:10px;background:var(--surface)';
      row.innerHTML = `
        <div style="background:var(--surface2);width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;flex-shrink:0">L${i}</div>
        <span class="tree-code" onclick="loadMember('${m.member_code}')" style="cursor:pointer">${m.member_code}</span>
        <span class="tree-name" style="flex:1">${nm}</span>
      `;
      othersCol.appendChild(row);
    }
    wrap.appendChild(othersCol);
  }

  if (chain.length === 1) {
    const note = document.createElement('div');
    note.style.cssText = 'padding:14px;color:var(--text3);font-size:13px;text-align:center';
    note.textContent = `🏛️ คุณคือ root ของสาย ${field === 'sponsor_code' ? 'Sponsor' : 'Upline'} นี้`;
    wrap.appendChild(note);
  }
}

/* ── Render sponsor leaders (filter chain by SVP/VP/AVP, sort by rank) ── */
async function renderSponsorLeaders() {
  const wrap = document.getElementById('treeWrap');
  let chain = [];
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_chain_up`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ start_code: currentMember.member_code, field_name: 'sponsor_code' }),
    });
    if (res.ok) chain = await res.json();
    else throw new Error('RPC not available');
  } catch (e) {
    console.warn('RPC fallback:', e.message);
    chain = [currentMember];
    let curr = currentMember, depth = 0;
    while (curr.sponsor_code && depth < 30) {
      try {
        const rows = await sb(`members?select=*&member_code=eq.${encodeURIComponent(curr.sponsor_code)}&limit=1`);
        if (!rows.length) break;
        chain.push(rows[0]); curr = rows[0]; depth++;
      } catch { break; }
    }
  }

  // Skip self (chain[0]); keep only SVP/VP/AVP; sort by rank
  const leaders = chain.slice(1).filter(m => LEADER_RANKS[m.position_level]);
  leaders.sort((a, b) => LEADER_RANKS[a.position_level] - LEADER_RANKS[b.position_level]);

  wrap.innerHTML = '';
  wrap.appendChild(_makeHint());

  if (!leaders.length) {
    const empty = document.createElement('div');
    empty.className = 'tree-empty';
    empty.innerHTML = '<div class="tree-empty-icon">👑</div>ไม่มีแม่ทีมที่มีตำแหน่ง SVP / VP / AVP ในสายของคุณ';
    wrap.appendChild(empty);
    return;
  }

  const table = document.createElement('table');
  table.style.cssText = 'width:100%;border-collapse:separate;border-spacing:0;margin-top:6px;font-size:13px;background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden';
  table.innerHTML = `
    <thead>
      <tr style="background:var(--surface2);text-align:left">
        <th style="padding:11px 14px;border-bottom:1px solid var(--border);font-weight:700;color:var(--text2);font-size:11.5px;letter-spacing:.4px;width:140px">ตำแหน่ง</th>
        <th style="padding:11px 14px;border-bottom:1px solid var(--border);font-weight:700;color:var(--text2);font-size:11.5px;letter-spacing:.4px">ชื่อ</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector('tbody');

  leaders.forEach((m, idx) => {
    const name = MemberFmt.displayName(m);
    const c = LEADER_POS_STYLE[m.position_level] || { bg: '#e2e8f0', color: '#334155' };
    const isLast = idx === leaders.length - 1;
    const tr = document.createElement('tr');
    tr.style.cssText = 'cursor:pointer;transition:background .12s';
    tr.onmouseover = () => tr.style.background = 'var(--accent-pale)';
    tr.onmouseout  = () => tr.style.background = '';
    tr.onclick = () => loadMember(m.member_code);
    const cellBorder = isLast ? '' : 'border-bottom:1px solid var(--border)';
    tr.innerHTML = `
      <td style="padding:11px 14px;${cellBorder}">
        <span style="display:inline-block;padding:4px 11px;border-radius:6px;background:${c.bg};color:${c.color};font-weight:700;font-size:12px">⭐ ${escapeHtml(m.position_level)}</span>
      </td>
      <td style="padding:11px 14px;${cellBorder};color:var(--text)">
        <span style="font-family:'IBM Plex Mono',monospace;color:var(--accent);font-weight:600;font-size:12px;margin-right:10px">${m.member_code}</span>
        <span>${escapeHtml(name)}</span>
        <span style="margin-left:8px;font-size:11px;color:var(--text3)">${_flag(m.country_code)} ${m.country_code || ''}</span>
      </td>
    `;
    tbody.appendChild(tr);
  });

  wrap.appendChild(table);
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
  const posTxt = member.position_level ? escapeHtml(member.position_level) : '';
  const tip = `${escapeHtml(name)}${posTxt ? ' · ' + posTxt : ''}${member.side ? ' · ' + member.side : ''}${childCount ? ' · ลูกทีม ' + childCount.toLocaleString() : ''}`;
  row.innerHTML = `
    <div class="tree-toggle ${isLeaf ? 'leaf' : ''}" data-expanded="false">${isLeaf ? '' : '▶'}</div>
    <span class="tree-icon">${depth === 0 ? '🌳' : '👤'}</span>
    <div class="tree-info">
      <span class="tree-code tt" data-tip="${tip}" onclick="event.stopPropagation();loadMember('${member.member_code}')" style="cursor:pointer">${member.member_code}</span>
      <span class="tree-name">${escapeHtml(name)}</span>
      ${posTxt ? `<span class="tree-pos">⭐ ${posTxt}</span>` : ''}
      ${member.side && depth > 0 ? `<span class="tree-side ${member.side==='ซ้าย'?'left':'right'}">${member.side}</span>` : ''}
      <span class="tree-meta">${_flag(member.country_code)} ${member.country_code || ''}</span>
    </div>
    ${childCount > 0 ? `<span class="tree-count">${childCount.toLocaleString()}</span>` : ''}
  `;
  wrapper.appendChild(row);

  if (!isLeaf) {
    const childrenContainer = document.createElement('div');
    childrenContainer.className = 'tree-children hidden';
    wrapper.appendChild(childrenContainer);

    let loaded = false;
    const toggleEl = row.querySelector('.tree-toggle');
    const expand = async () => {
      const isExpanded = toggleEl.dataset.expanded === 'true';
      if (isExpanded) {
        childrenContainer.classList.add('hidden');
        toggleEl.textContent = '▶';
        toggleEl.dataset.expanded = 'false';
        return;
      }
      childrenContainer.classList.remove('hidden');
      toggleEl.textContent = '▼';
      toggleEl.dataset.expanded = 'true';
      if (!loaded) {
        childrenContainer.innerHTML = '<div class="tree-loading">⏳ กำลังโหลด...</div>';
        try {
          // SINGLE RPC query — fetches children + their child counts
          const children = await _fetchDownline(member.member_code, field);
          _renderChildrenSplit(childrenContainer, children, field, depth + 1);
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

/* ── Render children as left/right split columns ── */
function _renderChildrenSplit(container, children, field, depth) {
  container.innerHTML = '';
  const lefts  = children.filter(c => c.side === 'ซ้าย');
  const rights = children.filter(c => c.side === 'ขวา');
  const others = children.filter(c => c.side !== 'ซ้าย' && c.side !== 'ขวา');

  // No side info → fallback to flat list (no split)
  if (!lefts.length && !rights.length) {
    container.classList.remove('split');
    for (const c of children) container.appendChild(_buildNodeFromData(c, field, depth));
    return;
  }

  container.classList.add('split');

  const makeCol = (side, label, rows) => {
    const col = document.createElement('div');
    col.className = `tree-col ${side}`;
    col.innerHTML = `<div class="tree-col-header ${side}">${label} (${rows.length})</div>`;
    if (rows.length) {
      for (const c of rows) col.appendChild(_buildNodeFromData(c, field, depth));
    } else {
      const empty = document.createElement('div');
      empty.className = 'tree-col-empty';
      empty.textContent = '— ว่าง —';
      col.appendChild(empty);
    }
    return col;
  };

  container.appendChild(makeCol('left',  '◀ ซ้าย', lefts));
  container.appendChild(makeCol('right', 'ขวา ▶', rights));

  if (others.length) {
    const col = document.createElement('div');
    col.className = 'tree-col';
    col.style.flexBasis = '100%';
    col.innerHTML = `<div class="tree-col-header none">ไม่ระบุด้าน (${others.length})</div>`;
    for (const c of others) col.appendChild(_buildNodeFromData(c, field, depth));
    container.appendChild(col);
  }
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

/* ── Auto-load from ?code= query param ── */
(() => {
  const code = new URLSearchParams(location.search).get('code');
  if (code) loadMember(code);
})();
