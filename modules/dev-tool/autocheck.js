/* ============================================================
   autocheck.js — System Health Check dashboard
   ตรวจสอบทุก component ของระบบและแสดงผลเป็น checklist
   ============================================================ */

const SB_URL   = (localStorage.getItem('sb_url') || '').replace(/\/+$/, '');
const SB_KEY   = localStorage.getItem('sb_key') || '';
const PROXY    = (localStorage.getItem('erp_proxy_url') || '').replace(/\/+$/, '');

const CHECKS = [
  {
    group: '📦 Infrastructure',
    groupId: 'infra',
    checks: [
      {
        id: 'sb_config',
        title: 'Supabase URL + Key',
        desc: 'ตั้งค่า sb_url และ sb_key ใน localStorage',
        fn: checkSupabaseConfig,
      },
      {
        id: 'sb_connect',
        title: 'Supabase Connection',
        desc: 'เชื่อมต่อและ query ได้',
        fn: checkSupabaseConnect,
      },
      {
        id: 'proxy_alive',
        title: 'AI Proxy Health',
        desc: 'Render service ตื่นและ respond',
        fn: checkProxyAlive,
      },
      {
        id: 'master_key',
        title: 'Master Key',
        desc: 'สามารถ encrypt/decrypt ได้',
        fn: checkMasterKey,
      },
    ],
  },
  {
    group: '📱 LINE Integration',
    groupId: 'line',
    checks: [
      {
        id: 'line_channel',
        title: 'Default LINE Channel',
        desc: 'มี channel purpose=event และ is_default=true',
        fn: checkLineChannel,
      },
      {
        id: 'line_token',
        title: 'Channel Access Token',
        desc: 'Token decrypt ได้และเรียก LINE API สำเร็จ',
        fn: checkLineToken,
      },
      {
        id: 'line_liff',
        title: 'LIFF ID configured',
        desc: 'Channel มี liff_id (สำหรับ register.html)',
        fn: checkLiffId,
      },
    ],
  },
  {
    group: '💾 Database Schema',
    groupId: 'schema',
    checks: [
      {
        id: 'tbl_line_channels',
        title: 'Table: line_channels',
        desc: 'SQL 027 — multi-channel registry',
        fn: () => checkTable('line_channels'),
      },
      {
        id: 'tbl_mla',
        title: 'Table: member_line_accounts',
        desc: 'SQL 028 — multi-LINE account per member',
        fn: () => checkTable('member_line_accounts'),
      },
      {
        id: 'col_members_line',
        title: 'members.line_user_id column',
        desc: 'SQL 028 — primary LINE account',
        fn: checkMembersLineColumn,
      },
      {
        id: 'col_ea_line',
        title: 'event_attendees.line_user_id column',
        desc: 'SQL 027 — cached LINE during register',
        fn: checkAttendeesLineColumn,
      },
    ],
  },
  {
    group: '📊 Data Statistics',
    groupId: 'data',
    checks: [
      {
        id: 'count_members',
        title: 'Total Members',
        desc: 'จำนวนสมาชิกทั้งระบบ',
        fn: () => checkCount('members'),
      },
      {
        id: 'count_linked',
        title: 'LINE-linked Members',
        desc: 'สมาชิกที่ผูก LINE แล้ว',
        fn: () => checkCount('members', 'line_user_id=not.is.null'),
      },
      {
        id: 'count_events',
        title: 'Total Events',
        desc: 'Events ในระบบ',
        fn: () => checkCount('events'),
      },
      {
        id: 'count_attendees',
        title: 'Total Attendees',
        desc: 'ผู้เข้าร่วม events ทั้งหมด',
        fn: () => checkCount('event_attendees'),
      },
      {
        id: 'count_webhook_activity',
        title: 'Recent Webhook Activity',
        desc: 'LINE webhook update ใน 24 ชม.ล่าสุด',
        fn: checkRecentWebhook,
      },
    ],
  },
];

/* ── Check functions ──────────────────────────────────────── */

async function checkSupabaseConfig() {
  if (!SB_URL) return { status: 'error', result: 'sb_url ว่าง', fix: 'ไปที่ Settings → Supabase' };
  if (!SB_KEY) return { status: 'error', result: 'sb_key ว่าง', fix: 'ไปที่ Settings → Supabase' };
  return { status: 'ok', result: hostFromUrl(SB_URL) };
}

async function checkSupabaseConnect() {
  if (!SB_URL || !SB_KEY) return { status: 'error', result: 'config ไม่ครบ' };
  try {
    const r = await fetch(`${SB_URL}/rest/v1/events?select=event_id&limit=1`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    });
    if (!r.ok) return { status: 'error', result: `HTTP ${r.status}` };
    await r.json();
    return { status: 'ok', result: 'query สำเร็จ' };
  } catch (e) {
    return { status: 'error', result: e.message };
  }
}

async function checkProxyAlive() {
  if (!PROXY) return { status: 'error', result: 'ยังไม่ตั้ง proxy URL', fix: 'ไปที่ Settings → LINE' };
  try {
    const start = Date.now();
    const r = await fetch(PROXY + '/', { signal: AbortSignal.timeout(60000) });
    const ms = Date.now() - start;
    if (!r.ok) return { status: 'error', result: `HTTP ${r.status}` };
    const d = await r.json().catch(() => ({}));
    if (ms > 10000) return { status: 'warn', result: `slow cold start (${ms}ms)` };
    return { status: 'ok', result: `${d.message || 'ok'} (${ms}ms)` };
  } catch (e) {
    return { status: 'error', result: 'ต่อไม่ได้: ' + e.message };
  }
}

async function checkMasterKey() {
  if (!window.ERPCrypto) return { status: 'error', result: 'ERPCrypto ไม่โหลด' };
  if (!ERPCrypto.hasMasterKey()) return { status: 'warn', result: 'ยังไม่ตั้ง', fix: 'ไปที่ Settings → Master Key' };
  const ok = await ERPCrypto.verifyMasterKey();
  return ok
    ? { status: 'ok', result: 'verified' }
    : { status: 'error', result: 'verify failed' };
}

async function checkLineChannel() {
  try {
    const rows = await sbGet(`line_channels?purpose=eq.event&is_default=eq.true&is_active=eq.true&select=id,name,liff_id&limit=1`);
    if (!rows.length) return { status: 'warn', result: 'ไม่มี default event channel', fix: 'ไปที่ Settings → LINE Channels' };
    const c = rows[0];
    return { status: 'ok', result: c.name };
  } catch (e) {
    return { status: 'error', result: e.message };
  }
}

async function checkLineToken() {
  if (!PROXY) return { status: 'warn', result: 'ไม่มี proxy' };
  if (!ERPCrypto?.hasMasterKey()) return { status: 'warn', result: 'ต้อง master key ก่อน' };
  try {
    const rows = await sbGet(`line_channels?purpose=eq.event&is_default=eq.true&is_active=eq.true&select=token_encrypted&limit=1`);
    if (!rows[0]?.token_encrypted) return { status: 'error', result: 'ไม่มี token' };
    const token = await ERPCrypto.decrypt(rows[0].token_encrypted);
    const r = await fetch(PROXY + '/line/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) return { status: 'error', result: d.error || `HTTP ${r.status}` };
    return { status: 'ok', result: `OA: ${d.displayName || '?'}` };
  } catch (e) {
    return { status: 'error', result: e.message };
  }
}

async function checkLiffId() {
  try {
    const rows = await sbGet(`line_channels?purpose=eq.event&is_default=eq.true&is_active=eq.true&select=liff_id&limit=1`);
    const liff = rows[0]?.liff_id;
    if (!liff) return { status: 'warn', result: 'ยังไม่ได้ตั้ง LIFF ID' };
    return { status: 'ok', result: liff };
  } catch (e) {
    return { status: 'error', result: e.message };
  }
}

async function checkTable(tableName) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${tableName}?select=*&limit=1`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    });
    if (r.status === 404) return { status: 'error', result: 'ไม่มี table', fix: 'รัน migration SQL' };
    if (!r.ok) return { status: 'error', result: `HTTP ${r.status}` };
    return { status: 'ok', result: 'exists' };
  } catch (e) {
    return { status: 'error', result: e.message };
  }
}

async function checkMembersLineColumn() {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/members?select=line_user_id&limit=1`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    });
    if (!r.ok) {
      const msg = await r.text().catch(() => '');
      if (msg.includes('line_user_id')) return { status: 'error', result: 'column ไม่มี', fix: 'รัน SQL 028' };
      return { status: 'error', result: `HTTP ${r.status}` };
    }
    return { status: 'ok', result: 'column exists' };
  } catch (e) {
    return { status: 'error', result: e.message };
  }
}

async function checkAttendeesLineColumn() {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/event_attendees?select=line_user_id&limit=1`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    });
    if (!r.ok) {
      const msg = await r.text().catch(() => '');
      if (msg.includes('line_user_id')) return { status: 'error', result: 'column ไม่มี', fix: 'รัน SQL 027' };
      return { status: 'error', result: `HTTP ${r.status}` };
    }
    return { status: 'ok', result: 'column exists' };
  } catch (e) {
    return { status: 'error', result: e.message };
  }
}

async function checkCount(table, filter = '') {
  try {
    const q = filter ? `?${filter}&select=*` : `?select=*`;
    const r = await fetch(`${SB_URL}/rest/v1/${table}${q}`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: 'count=exact', Range: '0-0' },
    });
    if (!r.ok) return { status: 'error', result: `HTTP ${r.status}` };
    const range = r.headers.get('content-range') || '*/0';
    const n = parseInt(range.split('/')[1], 10) || 0;
    return { status: 'ok', result: n.toLocaleString() + ' rows' };
  } catch (e) {
    return { status: 'error', result: e.message };
  }
}

async function checkRecentWebhook() {
  try {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const rows = await sbGet(`member_line_accounts?last_active_at=gte.${encodeURIComponent(yesterday)}&select=member_code&limit=1000`);
    if (!rows.length) return { status: 'warn', result: 'ไม่มี activity 24 ชม.' };
    return { status: 'ok', result: `${rows.length.toLocaleString()} users active` };
  } catch (e) {
    return { status: 'error', result: e.message };
  }
}

/* ── Helpers ───────────────────────────────────────────────── */

async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!r.ok) throw new Error(`${r.status}: ${await r.text().catch(() => '')}`);
  return r.json();
}

function hostFromUrl(u) {
  try { return new URL(u).host; } catch { return u; }
}

/* ── UI rendering ──────────────────────────────────────────── */

function renderGroups() {
  const container = document.getElementById('acGroups');
  container.innerHTML = CHECKS.map(g => `
    <div class="ac-group" data-group="${g.groupId}">
      <div class="ac-group-head">
        <div class="ac-group-title">${g.group}</div>
        <div class="ac-group-badge pending" id="badge_${g.groupId}">รอ check</div>
      </div>
      <div class="ac-group-body">
        ${g.checks.map(c => `
          <div class="ac-item" id="item_${c.id}">
            <div class="ac-status pending" id="status_${c.id}">⋯</div>
            <div class="ac-name">
              <div class="ac-name-title">${c.title}</div>
              <div class="ac-name-desc">${c.desc}</div>
            </div>
            <div class="ac-result pending" id="result_${c.id}">—</div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function setItemStatus(id, status, result, fix) {
  const statusEl = document.getElementById(`status_${id}`);
  const resultEl = document.getElementById(`result_${id}`);
  if (!statusEl || !resultEl) return;
  const icons = { running: '⋯', ok: '✅', warn: '⚠️', error: '❌', pending: '⋯' };
  statusEl.className = `ac-status ${status}`;
  statusEl.textContent = icons[status] || '⋯';
  resultEl.className = `ac-result ${status}`;
  resultEl.textContent = result || '';
  if (fix) {
    resultEl.innerHTML += `<span class="ac-fix">💡 ${fix}</span>`;
  }
}

function updateGroupBadge(groupId, results) {
  const badge = document.getElementById(`badge_${groupId}`);
  if (!badge) return;
  const errors = results.filter(r => r.status === 'error').length;
  const warns = results.filter(r => r.status === 'warn').length;
  const oks = results.filter(r => r.status === 'ok').length;
  const total = results.length;
  if (errors > 0) {
    badge.className = 'ac-group-badge error';
    badge.textContent = `${errors} error`;
  } else if (warns > 0) {
    badge.className = 'ac-group-badge warn';
    badge.textContent = `${warns} warning`;
  } else if (oks === total) {
    badge.className = 'ac-group-badge ok';
    badge.textContent = 'all pass';
  }
}

function updateSummary(allResults) {
  const errors = allResults.filter(r => r.status === 'error').length;
  const warns = allResults.filter(r => r.status === 'warn').length;
  const oks = allResults.filter(r => r.status === 'ok').length;
  const total = allResults.length;

  const summary = document.getElementById('acSummary');
  const titleEl = document.getElementById('acSummaryTitle');
  const detailEl = document.getElementById('acSummaryDetail');
  const iconEl = summary.querySelector('.ac-summary-icon');

  summary.className = 'ac-summary';
  if (errors > 0) {
    summary.classList.add('error');
    iconEl.textContent = '❌';
    titleEl.textContent = `${errors} ปัญหาที่ต้องแก้`;
    detailEl.textContent = `ผ่าน ${oks}/${total} · warning ${warns} · error ${errors}`;
  } else if (warns > 0) {
    summary.classList.add('warn');
    iconEl.textContent = '⚠️';
    titleEl.textContent = `มี ${warns} warning`;
    detailEl.textContent = `ผ่าน ${oks}/${total} · ควรตรวจสอบ`;
  } else {
    summary.classList.add('ok');
    iconEl.textContent = '✅';
    titleEl.textContent = 'ระบบทำงานปกติ';
    detailEl.textContent = `ผ่าน ${oks}/${total} checks`;
  }

  document.getElementById('acLastRun').textContent =
    `Last check: ${new Date().toLocaleTimeString('th-TH')}`;
}

async function runAllChecks() {
  const btn = document.getElementById('acRunBtn');
  btn.disabled = true;
  btn.innerHTML = '⏳ Running...';

  const allResults = [];
  for (const group of CHECKS) {
    const groupResults = [];
    // Run in parallel within group
    await Promise.all(group.checks.map(async (check) => {
      setItemStatus(check.id, 'running', 'กำลังตรวจ...');
      try {
        const result = await check.fn();
        setItemStatus(check.id, result.status, result.result, result.fix);
        groupResults.push(result);
        allResults.push(result);
      } catch (e) {
        setItemStatus(check.id, 'error', e.message || 'error');
        groupResults.push({ status: 'error' });
        allResults.push({ status: 'error' });
      }
    }));
    updateGroupBadge(group.groupId, groupResults);
  }

  updateSummary(allResults);
  btn.disabled = false;
  btn.innerHTML = '🔄 Run All Checks';
}

window.runAllChecks = runAllChecks;

document.addEventListener('DOMContentLoaded', () => {
  renderGroups();
  // Auto-run on page load
  setTimeout(runAllChecks, 500);
});
