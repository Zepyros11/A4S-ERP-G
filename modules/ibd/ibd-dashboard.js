/* ============================================================
   ibd-dashboard.js — IBD Dashboard
   สรุปจาก ibd_complaints + ibd_ewallet_requests + ibd_relocation_requests
   ============================================================ */

const SB_URL = localStorage.getItem('sb_url') || '';
const SB_KEY = localStorage.getItem('sb_key') || '';

const TOPIC_LABELS = {
  product_order:  'Product Order follow up',
  info_change:    'Member Information Change',
  password:       'Member Login Password',
  commission:     'Commission Checking & Payment',
  service:        'Service Complaint',
  wrong_sponsor:  'Wrong Sponsor / Team Placement',
  other:          'Other',
};

function $(id) { return document.getElementById(id); }
function fmt(n) { return Number(n || 0).toLocaleString('en-US'); }
function showLoading(on) { const el = $('loadingOverlay'); if (el) el.style.display = on ? 'flex' : 'none'; }
function toast(msg, type = 'success') {
  const el = $('toast'); if (!el) return alert(msg);
  el.textContent = msg; el.className = `toast show toast-${type}`;
  setTimeout(() => el.classList.remove('show'), 3000);
}

async function sbGet(path) {
  if (!SB_URL || !SB_KEY) throw new Error('Supabase ยังไม่ได้ตั้งค่า');
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

/* DD/MM/YYYY HH:mm — Bangkok TZ */
function fmtTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const opts = { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' };
    return d.toLocaleString('en-GB', opts).replace(',', '');
  } catch { return iso; }
}

/* ── Load summary counts ── */
async function loadCards() {
  // ใช้ count via Range header
  async function countByStatus(table, pendingStatuses) {
    const all = await fetch(`${SB_URL}/rest/v1/${table}?select=id&limit=1`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: 'count=exact' },
    });
    const total = +all.headers.get('content-range')?.split('/')[1] || 0;

    const filter = pendingStatuses.map(s => `status.eq.${s}`).join(',');
    const pendRes = await fetch(`${SB_URL}/rest/v1/${table}?select=id&or=(${filter})&limit=1`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Prefer: 'count=exact' },
    });
    const pending = +pendRes.headers.get('content-range')?.split('/')[1] || 0;
    return { total, pending };
  }

  const [c, e, r] = await Promise.all([
    countByStatus('ibd_complaints', ['new', 'in_progress']),
    countByStatus('ibd_ewallet_requests', ['pending']),
    countByStatus('ibd_relocation_requests', ['pending']),
  ]);

  $('cardComplaintTotal').textContent = fmt(c.total);
  $('cardComplaintPending').textContent = fmt(c.pending);
  $('cardEwalletTotal').textContent = fmt(e.total);
  $('cardEwalletPending').textContent = fmt(e.pending);
  $('cardRelocationTotal').textContent = fmt(r.total);
  $('cardRelocationPending').textContent = fmt(r.pending);
}

/* ── Top topics chart (complaints) — last 30 days ── */
async function loadTopicChart() {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  try {
    const rows = await sbGet(`ibd_complaints?select=topic&created_at=gte.${since}`);
    const counts = {};
    rows.forEach(r => { counts[r.topic] = (counts[r.topic] || 0) + 1; });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 7);

    const root = $('topicChart');
    if (!sorted.length) { root.innerHTML = '<div class="ibd-empty">ยังไม่มีข้อมูล 30 วันล่าสุด</div>'; return; }

    const max = sorted[0][1];
    root.innerHTML = sorted.map(([key, v]) => {
      const pct = (v / max) * 100;
      const label = TOPIC_LABELS[key] || key;
      return `
        <div class="ibd-bar-row">
          <div class="ibd-bar-label" title="${label}">${label}</div>
          <div class="ibd-bar-track"><div class="ibd-bar-fill" style="width:${pct}%"></div></div>
          <div class="ibd-bar-value">${v}</div>
        </div>`;
    }).join('');
  } catch (e) {
    $('topicChart').innerHTML = `<div class="ibd-empty">โหลดไม่สำเร็จ: ${e.message}</div>`;
  }
}

/* ── Top branches chart ── */
async function loadBranchChart() {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  try {
    // join กับ ibd_countries เพื่อเอาชื่อ
    const rows = await sbGet(
      `ibd_complaints?select=branch_code,ibd_countries(name_en,flag_emoji)&created_at=gte.${since}`
    );
    const counts = {};
    rows.forEach(r => {
      if (!r.branch_code) return;
      const label = r.ibd_countries
        ? `${r.ibd_countries.flag_emoji || ''} ${r.ibd_countries.name_en}`
        : r.branch_code;
      counts[label] = (counts[label] || 0) + 1;
    });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 7);

    const root = $('branchChart');
    if (!sorted.length) { root.innerHTML = '<div class="ibd-empty">ยังไม่มีข้อมูล 30 วันล่าสุด</div>'; return; }

    const max = sorted[0][1];
    root.innerHTML = sorted.map(([label, v]) => {
      const pct = (v / max) * 100;
      return `
        <div class="ibd-bar-row">
          <div class="ibd-bar-label" title="${label}">${label}</div>
          <div class="ibd-bar-track"><div class="ibd-bar-fill" style="width:${pct}%"></div></div>
          <div class="ibd-bar-value">${v}</div>
        </div>`;
    }).join('');
  } catch (e) {
    $('branchChart').innerHTML = `<div class="ibd-empty">โหลดไม่สำเร็จ: ${e.message}</div>`;
  }
}

/* ── Recent submissions (รวม 3 ตาราง) ── */
async function loadRecent() {
  try {
    const [c, e, r] = await Promise.all([
      sbGet('ibd_complaints?select=id,member_code,member_name,topic,status,created_at&order=created_at.desc&limit=6'),
      sbGet('ibd_ewallet_requests?select=id,member_code,member_full_name,status,created_at&order=created_at.desc&limit=6'),
      sbGet('ibd_relocation_requests?select=id,member_code,member_name,from_country,to_country,status,created_at&order=created_at.desc&limit=6'),
    ]);

    const items = [
      ...c.map(x => ({ kind: 'complaint',  ...x, label: TOPIC_LABELS[x.topic] || x.topic, name: x.member_name,      icon: '📋', href: './ibd-complaints.html'  })),
      ...e.map(x => ({ kind: 'ewallet',    ...x, label: 'ขอโอน E-Wallet',                  name: x.member_full_name, icon: '💳', href: './ibd-ewallet.html'     })),
      ...r.map(x => ({ kind: 'relocation', ...x, label: `ย้ายฐาน ${x.from_country || '?'} → ${x.to_country || '?'}`, name: x.member_name, icon: '🌐', href: './ibd-relocation.html' })),
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 12);

    const root = $('recentList');
    if (!items.length) { root.innerHTML = '<div class="ibd-empty">ยังไม่มีคำขอจากลูกค้า</div>'; return; }

    root.innerHTML = items.map(it => `
      <div class="ibd-recent-row" onclick="location.href='${it.href}'">
        <div class="ibd-recent-icon">${it.icon}</div>
        <div class="ibd-recent-main">
          <div class="ibd-recent-title">${it.label} · <span style="color:var(--text2);font-weight:500">${escapeHtml(it.name || '—')}</span></div>
          <div class="ibd-recent-sub">${escapeHtml(it.member_code || '—')} · ${statusBadge(it.kind, it.status)}</div>
        </div>
        <div class="ibd-recent-time">${fmtTime(it.created_at)}</div>
      </div>
    `).join('');
  } catch (e) {
    $('recentList').innerHTML = `<div class="ibd-empty">โหลดไม่สำเร็จ: ${e.message}</div>`;
  }
}

function statusBadge(kind, status) {
  const map = {
    new:         { cls: 'new',        text: 'NEW' },
    in_progress: { cls: 'progress',   text: 'IN PROGRESS' },
    resolved:    { cls: 'resolved',   text: 'RESOLVED' },
    closed:      { cls: 'closed',     text: 'CLOSED' },
    pending:     { cls: 'pending',    text: 'PENDING' },
    approved:    { cls: 'approved',   text: 'APPROVED' },
    paid:        { cls: 'paid',       text: 'PAID' },
    rejected:    { cls: 'rejected',   text: 'REJECTED' },
  };
  const m = map[status] || { cls: 'closed', text: status };
  return `<span class="ibd-badge ibd-badge-${m.cls}">${m.text}</span>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ── Init ── */
async function init() {
  showLoading(true);
  try {
    await Promise.all([loadCards(), loadTopicChart(), loadBranchChart(), loadRecent()]);
  } catch (e) {
    console.error(e);
    toast('โหลดข้อมูลไม่สำเร็จ: ' + e.message, 'error');
  } finally {
    showLoading(false);
  }
}

window.addEventListener('DOMContentLoaded', init);
