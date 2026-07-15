/* ============================================================
   dashboard.js — Dashboard page logic
   ============================================================ */

const SUPABASE_URL = localStorage.getItem('sb_url') || '';
const SUPABASE_KEY = localStorage.getItem('sb_key') || '';

const TYPE_CFG = {
  IN:       { label:'รับเข้า',   icon:'📥', color:'#10b981' },
  OUT:      { label:'จ่ายออก',   icon:'📤', color:'#f59e0b' },
  INTERNAL: { label:'เบิก',      icon:'📋', color:'#8b5cf6' },
  RETURN:   { label:'คืน',       icon:'↩',  color:'#10b981' },
  ADJUST:   { label:'ปรับยอด',   icon:'⚖️', color:'#d97706' },
};

function updateClock() {
  document.getElementById('clockDisplay').textContent =
    new Date().toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}
setInterval(updateClock, 1000);
updateClock();

function setWelcome() {
  const now = new Date();
  const h = now.getHours();
  const greeting = h < 12 ? 'อรุณสวัสดิ์' : h < 17 ? 'สวัสดีตอนบ่าย' : 'สวัสดีตอนเย็น';
  const user = window.ERP_USER;
  const name = user ? ` คุณ${user.full_name || user.first_name || user.username}` : '';
  document.getElementById('welcomeMsg').textContent = `${greeting}${name} 👋`;
  document.getElementById('welcomeSub').textContent =
    `ภาพรวมระบบ · อัพเดทล่าสุด ${now.toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit' })} น.`;
  document.getElementById('welcomeDate').innerHTML =
    now.toLocaleDateString('th-TH', { weekday:'long', day:'numeric', month:'long', year:'numeric' }) +
    '<br>' + now.toLocaleDateString('th-TH', { year:'numeric', month:'long', day:'numeric', calendar:'gregory' });
}

async function sbFetch(table, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}

async function sbCount(table, query = '') {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}${query.includes('?') ? '&' : '?'}select=*&limit=1`, {
    headers: {
      'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'count=exact', 'Range': '0-0',
    },
  });
  return parseInt((res.headers.get('content-range') || '*/0').split('/')[1], 10) || 0;
}

async function loadAll() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  setWelcome();
  checkPatExpiry();         // fire-and-forget — show alert if PAT expiring
  loadMemberStats();        // KPI #1 + MLM charts
  loadEventsModule();       // KPI #2 + upcoming events
  loadStockOrdersModule();  // KPI #3 + stock & docs
  loadIbdModule();          // KPI #4 + IBD mini cards
}

/* ── Module: Stock & Orders (also feeds Sales KPI) ── */
async function loadStockOrdersModule() {
  try {
    const [products, stockBalance, pos, sos, movements] = await Promise.all([
      sbFetch('products', '?select=product_id,product_code,product_name,reorder_point,is_active,disable_stock_alert&is_active=eq.true'),
      sbFetch('stock_balance', '?select=product_id,warehouse_id,qty_on_hand'),
      sbFetch('purchase_orders', '?select=po_id,po_number,order_date,total_amount,status&order=order_date.desc&limit=100'),
      sbFetch('sales_orders', '?select=so_id,so_number,order_date,total_amount,status&order=order_date.desc&limit=100'),
      sbFetch('stock_movements', '?select=*&order=moved_at.desc&limit=100'),
    ]);
    renderSalesKPI(sos);
    renderStockBadge(products, stockBalance);
    renderStockAlerts(products, stockBalance);
    renderTopProducts(products, stockBalance);
    renderRecentDocs(pos, sos);
    renderMovementChart(movements);
    renderRecentMovements(movements, products);
  } catch(e) {
    showToast('โหลด stock/orders ไม่ได้: ' + e.message, 'error');
  }
}

function renderSalesKPI(sos) {
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
  const monthSO = sos.filter(s => s.order_date >= monthStart && s.status !== 'CANCELLED');
  const totalSOAmt = monthSO.reduce((s, p) => s + parseFloat(p.total_amount || 0), 0);
  document.getElementById('kpiSO').textContent = `฿${totalSOAmt.toLocaleString('th-TH', { maximumFractionDigits:0 })}`;
  document.getElementById('kpiSOSub').textContent = `${monthSO.length} ใบ · เดือนนี้`;
  document.getElementById('trendSO').textContent = `${monthSO.length} ใบ`;
}

function renderStockBadge(products, stockBalance) {
  const stockMap = {};
  stockBalance.forEach(b => { stockMap[b.product_id] = (stockMap[b.product_id] || 0) + (b.qty_on_hand || 0); });
  const alertCount = products.filter(p => !p.disable_stock_alert && (stockMap[p.product_id] || 0) <= (p.reorder_point || 0)).length;
  const totalStock = stockBalance.reduce((s, b) => s + (b.qty_on_hand || 0), 0);
  const badge = document.getElementById('stockTotalBadge');
  if (badge) {
    badge.innerHTML = alertCount > 0
      ? `${products.length} SKU · <span style="color:var(--danger);font-weight:700">${alertCount} ต้องเติม</span>`
      : `${products.length} SKU · Stock ${totalStock.toLocaleString()} ชิ้น`;
  }
}

function renderStockAlerts(products, stockBalance) {
  const stockMap = {};
  stockBalance.forEach(b => { stockMap[b.product_id] = (stockMap[b.product_id] || 0) + (b.qty_on_hand || 0); });
  const alerts = products
    .filter(p => !p.disable_stock_alert)
    .map(p => ({ ...p, qty: stockMap[p.product_id] || 0 }))
    .filter(p => p.qty <= (p.reorder_point || 0))
    .sort((a, b) => a.qty - b.qty).slice(0, 6);
  const el = document.getElementById('stockAlerts');
  if (!alerts.length) { el.innerHTML = `<div class="empty-sm"><div class="empty-sm-icon">✅</div>Stock ทุกรายการปกติ</div>`; return; }
  el.innerHTML = alerts.map(p => {
    const isDanger = p.qty === 0;
    return `<div class="alert-item">
      <div class="alert-dot ${isDanger ? 'alert-dot-danger' : 'alert-dot-warning'}"></div>
      <div class="alert-info"><div class="alert-name">${p.product_name}</div><div class="alert-code">${p.product_code}</div></div>
      <div class="alert-qty"><div class="alert-qty-val ${isDanger ? 'qty-danger' : 'qty-warning'}">${p.qty}</div><div class="alert-qty-label">คงเหลือ</div></div>
    </div>`;
  }).join('');
}

function renderTopProducts(products, stockBalance) {
  const stockMap = {};
  stockBalance.forEach(b => { stockMap[b.product_id] = (stockMap[b.product_id] || 0) + (b.qty_on_hand || 0); });
  const sorted = products.map(p => ({ ...p, qty: stockMap[p.product_id] || 0 })).sort((a, b) => b.qty - a.qty).slice(0, 5);
  const maxQty = sorted[0]?.qty || 1;
  const rankClass = ['rank-1','rank-2','rank-3','rank-n','rank-n'];
  document.getElementById('topProducts').innerHTML = !sorted.length
    ? `<div class="empty-sm"><div class="empty-sm-icon">📦</div>ไม่มีข้อมูล</div>`
    : sorted.map((p, i) => `
      <div class="top-prod-item">
        <div class="top-prod-rank ${rankClass[i]}">${i+1}</div>
        <div class="top-prod-name">${p.product_name}</div>
        <div class="top-prod-bar-wrap"><div class="top-prod-bar" style="width:${Math.round(p.qty/maxQty*100)}%"></div></div>
        <div class="top-prod-val">${p.qty.toLocaleString()}</div>
      </div>`).join('');
}

function renderRecentDocs(pos, sos) {
  const docs = [
    ...pos.slice(0, 5).map(p => ({ type:'PO', ref:p.po_number, date:p.order_date, amount:p.total_amount, status:p.status })),
    ...sos.slice(0, 5).map(s => ({ type:'SO', ref:s.so_number, date:s.order_date, amount:s.total_amount, status:s.status })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 8);
  const el = document.getElementById('recentDocs');
  if (!docs.length) { el.innerHTML = `<div class="empty-sm"><div class="empty-sm-icon">📄</div>ยังไม่มีเอกสาร</div>`; return; }
  el.innerHTML = docs.map(d => {
    const statusLabel = { DRAFT:'Draft', APPROVED:'อนุมัติ', PENDING:'รอดำเนินการ', RECEIVED:'รับแล้ว', DELIVERED:'ส่งแล้ว' }[d.status] || d.status;
    const statusClass = { DRAFT:'status-draft', APPROVED:'status-approved', RECEIVED:'status-approved', PENDING:'status-pending' }[d.status] || 'status-draft';
    const typeClass = { PO:'doc-po', SO:'doc-so', REQ:'doc-req' }[d.type];
    return `<div class="doc-item">
      <span class="doc-badge ${typeClass}">${d.type}</span>
      <div class="doc-info"><div class="doc-ref">${d.ref || '—'}</div><div class="doc-meta">${new Date(d.date).toLocaleDateString('th-TH', { day:'numeric', month:'short' })}</div></div>
      <div class="doc-right">
        <div class="doc-amount">฿${parseFloat(d.amount || 0).toLocaleString('th-TH', { minimumFractionDigits:0 })}</div>
        <span class="doc-status ${statusClass}">${statusLabel}</span>
      </div>
    </div>`;
  }).join('');
}

function renderMovementChart(movements) {
  const days = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(d.toISOString().substring(0, 10)); }
  const chartData = days.map(date => {
    const dayMoves = movements.filter(m => m.moved_at?.substring(0, 10) === date);
    const inQty  = dayMoves.filter(m => m.movement_type === 'IN' || m.movement_type === 'RETURN').reduce((s, m) => s + Math.abs(m.qty || 0), 0);
    const outQty = dayMoves.filter(m => m.movement_type === 'OUT' || m.movement_type === 'INTERNAL').reduce((s, m) => s + Math.abs(m.qty || 0), 0);
    const label  = new Date(date + 'T00:00:00').toLocaleDateString('th-TH', { day:'numeric', month:'short' });
    return { date, label, inQty, outQty };
  });
  const maxVal = Math.max(...chartData.map(d => Math.max(d.inQty, d.outQty)), 1);
  document.getElementById('barChart').innerHTML = chartData.map(d => `
    <div class="bar-col">
      <div style="display:flex;gap:3px;align-items:flex-end;flex:1;width:100%">
        <div class="bar bar-in" style="height:${Math.round(d.inQty/maxVal*88)}px;flex:1" data-val="${d.inQty}"></div>
        <div class="bar bar-out" style="height:${Math.round(d.outQty/maxVal*88)}px;flex:1" data-val="${d.outQty}"></div>
      </div>
      <div class="bar-label">${d.label}</div>
    </div>`).join('');
}

function renderRecentMovements(movements, products) {
  const el = document.getElementById('recentMovements');
  const recent = movements.slice(0, 8);
  if (!recent.length) { el.innerHTML = `<div class="empty-sm"><div class="empty-sm-icon">🔄</div>ยังไม่มีความเคลื่อนไหว</div>`; return; }
  el.innerHTML = recent.map(m => {
    const cfg  = TYPE_CFG[m.movement_type] || { label:m.movement_type, icon:'❓', color:'#9ca3af' };
    const prod = products.find(p => p.product_id === m.product_id);
    const time = new Date(m.moved_at).toLocaleString('th-TH', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
    return `<div class="activity-item">
      <div class="activity-icon" style="background:${cfg.color}22">${cfg.icon}</div>
      <div class="activity-body">
        <div class="activity-text"><strong>${cfg.label}</strong> · ${prod?.product_name || 'สินค้า #' + m.product_id} <span style="color:var(--text3)"> ${m.qty > 0 ? '+' : ''}${m.qty} ชิ้น</span></div>
        <div class="activity-time">${time}${m.note ? ' · ' + m.note : ''}</div>
      </div>
    </div>`;
  }).join('');
}

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove('show'), 4000);
}

/* ============================================================
   MEMBER (MLM) STATS — Chart.js + Supabase views
   ============================================================ */

const _mlmCharts = {};   // keep references for re-render

/* ── Fix Chart.js hover/tooltip ให้ตรงกับตำแหน่งเมาส์ใต้ CSS zoom ──
   แอปตั้ง :root{zoom:.65} (desktop density) แต่ Chart.js อ่านพิกัดจาก
   offsetX/offsetY ซึ่งไม่ผ่านการ map ของ zoom → hitbox/tooltip เลื่อนออกจากช่องจริง.
   แก้โดยคำนวณตำแหน่งใหม่จากสัดส่วน getBoundingClientRect (คงที่ไม่ขึ้นกับ zoom).
   ทำงานได้ทุกค่า zoom — ไม่ต้อง hardcode 0.65 */
const ChartZoomHoverFix = {
  id: 'zoomHoverFix',
  beforeEvent(chart, args) {
    const e = args.event;
    const ne = e && e.native;
    if (!ne || ne.clientX == null) return;          // event ไม่มีพิกัดเมาส์ — ข้าม
    const rect = chart.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    e.x = (ne.clientX - rect.left) / rect.width  * chart.width;
    e.y = (ne.clientY - rect.top)  / rect.height * chart.height;
  },
};
if (typeof Chart !== 'undefined') Chart.register(ChartZoomHoverFix);

async function _mlmFetch(view) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${view}?select=*`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`${view}: ${res.status}`);
  return res.json();
}

async function loadMemberStats() {
  const section = document.getElementById('memberStatsSection');
  // Hide KPI + section if user has no member_view perm
  if (window.AuthZ && !AuthZ.hasPerm('member_view')) {
    if (section) section.style.display = 'none';
    document.querySelectorAll('[data-perm="member_view"]').forEach(el => el.style.display = 'none');
    return;
  }
  if (!section) return;

  // ── KPI #1: total members count (โหลดแยก ไม่ให้ view ที่ช้า/พังมาบล็อก) ──
  _mlmTotalCount()
    .then(total => {
      document.getElementById('kpiMembers').textContent = total.toLocaleString();
      document.getElementById('mlmTotalBadge').textContent = `${total.toLocaleString()} คน`;
    })
    .catch(e => {
      console.error('loadMemberStats/count:', e);
      document.getElementById('kpiMembers').textContent = '—';
      document.getElementById('kpiMembersSub').textContent = 'โหลดยอดสมาชิกไม่ได้';
    });

  // ── Monthly signups → feeds KPI sub/trend + trend chart (โหลดแยก) ──
  _mlmFetch('v_members_monthly_signups')
    .then(monthly => {
      const now = new Date();
      const curMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
      const newThisMonth = (monthly.find(r => r.month === curMonth)?.count) || 0;
      const lastMonth = new Date(now.getFullYear(), now.getMonth()-1, 1);
      const lastMonthKey = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth()+1).padStart(2,'0')}`;
      const newLastMonth = (monthly.find(r => r.month === lastMonthKey)?.count) || 0;
      document.getElementById('kpiMembersSub').textContent = `+${newThisMonth.toLocaleString()} คน · เดือนนี้`;
      const tEl = document.getElementById('trendMembers');
      if (newThisMonth > newLastMonth) {
        tEl.textContent = `↑ +${newThisMonth - newLastMonth}`;
        tEl.className = 'kpi-trend trend-up';
      } else if (newThisMonth < newLastMonth) {
        tEl.textContent = `↓ ${newThisMonth - newLastMonth}`;
        tEl.className = 'kpi-trend trend-down';
      } else {
        tEl.textContent = `= ${newThisMonth}`;
        tEl.className = 'kpi-trend trend-neu';
      }
      if (typeof Chart !== 'undefined') _renderTrendChart(monthly);
    })
    .catch(e => {
      console.error('loadMemberStats/monthly:', e);
      const sub = document.getElementById('kpiMembersSub');
      if (sub.textContent.includes('กำลังโหลด')) sub.textContent = 'โหลดสถิติรายเดือนไม่ได้';
    });

  if (typeof Chart === 'undefined') { console.warn('Chart.js not loaded'); return; }

  // ── Charts + top sponsors (แต่ละอันโหลด+เรนเดอร์แยก ไม่บล็อกกัน) ──
  _mlmFetch('v_members_country_count').then(_renderCountryChart)
    .catch(e => console.error('loadMemberStats/country:', e));
  _mlmFetch('v_members_package_count').then(_renderPackageChart)
    .catch(e => console.error('loadMemberStats/package:', e));
  _mlmFetch('v_top_sponsors').then(_renderTopSponsors)
    .catch(e => {
      console.error('loadMemberStats/sponsors:', e);
      document.getElementById('topSponsorsBody').innerHTML =
        `<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--danger)">โหลดข้อมูลไม่ได้: ${escapeHtml(e.message)}</td></tr>`;
    });
}

/* ============================================================
   EVENTS MODULE — KPI #2 + Upcoming events list
   ============================================================ */
async function loadEventsModule() {
  const section = document.getElementById('eventsSection');
  if (window.AuthZ && !AuthZ.hasPerm('events_view')) {
    if (section) section.style.display = 'none';
    document.querySelectorAll('[data-perm="events_view"]').forEach(el => el.style.display = 'none');
    return;
  }
  try {
    const today = new Date().toISOString().substring(0, 10);
    const upcoming = await sbFetch(
      'events',
      `?select=event_id,event_code,event_name,event_date,end_date,location,max_attendees&event_date=gte.${today}&order=event_date.asc&limit=5`
    );
    const totalUpcoming = await sbCount('events', `?event_date=gte.${today}`);

    // attendees per event
    let attendeesByEvent = {};
    if (upcoming.length) {
      const ids = upcoming.map(e => e.event_id).join(',');
      const atts = await sbFetch('event_attendees', `?select=event_id&event_id=in.(${ids})`);
      atts.forEach(a => { attendeesByEvent[a.event_id] = (attendeesByEvent[a.event_id] || 0) + 1; });
    }

    // KPI #2
    const totalAtt = Object.values(attendeesByEvent).reduce((s, n) => s + n, 0);
    document.getElementById('kpiEvents').textContent = totalUpcoming;
    document.getElementById('kpiEventsSub').textContent = `${totalAtt.toLocaleString()} คนลงทะเบียน (5 รายการล่าสุด)`;
    document.getElementById('trendEvents').textContent = upcoming[0]
      ? `เร็วสุด ${new Date(upcoming[0].event_date).toLocaleDateString('th-TH', { day:'numeric', month:'short' })}`
      : '—';

    // Badge
    document.getElementById('eventsTotalBadge').textContent = `${totalUpcoming.toLocaleString()} กำลังจะมา`;

    // Render upcoming list
    renderUpcomingEvents(upcoming, attendeesByEvent);
  } catch (e) {
    console.error('loadEventsModule:', e);
    document.getElementById('kpiEvents').textContent = '—';
    document.getElementById('kpiEventsSub').textContent = 'โหลดไม่ได้';
  }
}

function renderUpcomingEvents(events, attendeesByEvent) {
  const el = document.getElementById('upcomingEvents');
  if (!events.length) {
    el.innerHTML = `<div class="empty-sm"><div class="empty-sm-icon">📅</div>ยังไม่มี Event ที่กำลังจะมา</div>`;
    return;
  }
  el.innerHTML = `<div class="upcoming-events-grid">${events.map(ev => {
    const reg = attendeesByEvent[ev.event_id] || 0;
    const max = ev.max_attendees || 0;
    const pct = max > 0 ? Math.min(100, Math.round(reg / max * 100)) : 0;
    const fillCls = pct >= 100 ? 'full' : pct >= 80 ? 'warn' : '';
    const dateLabel = formatEventDate(ev.event_date, ev.end_date);
    return `<div class="up-event-card" onclick="location.href='../event/attendees.html?event_id=${ev.event_id}'">
      <div class="up-event-date">${dateLabel}</div>
      <div class="up-event-name">${escapeHtml(ev.event_name || '—')}</div>
      <div class="up-event-loc">📍 ${escapeHtml(ev.location || '—')}</div>
      <div class="up-event-prog">
        <div class="up-event-prog-label">
          <span>ลงทะเบียน</span>
          <span><strong>${reg}</strong>${max ? ` / ${max}` : ''} ${max ? `(${pct}%)` : ''}</span>
        </div>
        ${max ? `<div class="up-event-prog-bar"><div class="up-event-prog-fill ${fillCls}" style="width:${pct}%"></div></div>` : ''}
      </div>
    </div>`;
  }).join('')}</div>`;
}

function formatEventDate(start, end) {
  if (!start) return '—';
  const s = new Date(start + 'T00:00:00');
  const sLabel = s.toLocaleDateString('th-TH', { day:'numeric', month:'short', year:'numeric', calendar:'gregory' });
  if (!end || end === start) return sLabel;
  const e = new Date(end + 'T00:00:00');
  const eLabel = e.toLocaleDateString('th-TH', { day:'numeric', month:'short' });
  return `${s.toLocaleDateString('th-TH', { day:'numeric', month:'short' })} - ${eLabel} ${s.toLocaleDateString('th-TH', { year:'numeric', calendar:'gregory' })}`;
}

/* ============================================================
   IBD MODULE — KPI #4 + 3 mini cards
   ============================================================ */
async function loadIbdModule() {
  const section = document.getElementById('ibdSection');
  if (window.AuthZ && !AuthZ.hasPerm('ibd_dashboard_view')) {
    if (section) section.style.display = 'none';
    document.querySelectorAll('[data-perm="ibd_dashboard_view"]').forEach(el => el.style.display = 'none');
    return;
  }
  try {
    const [complaintPending, ewalletPending, relocatePending,
           complaintTotal, ewalletTotal, relocateTotal] = await Promise.all([
      sbCount('ibd_complaints', '?or=(status.eq.new,status.eq.in_progress)'),
      sbCount('ibd_ewallet_requests', '?status=eq.pending'),
      sbCount('ibd_relocation_requests', '?status=eq.pending'),
      sbCount('ibd_complaints', ''),
      sbCount('ibd_ewallet_requests', ''),
      sbCount('ibd_relocation_requests', ''),
    ]);

    const totalPending = complaintPending + ewalletPending + relocatePending;
    const totalAll     = complaintTotal + ewalletTotal + relocateTotal;

    // KPI #4
    document.getElementById('kpiIbd').textContent = totalPending;
    document.getElementById('kpiIbdSub').textContent = `จาก ${totalAll.toLocaleString()} คำขอทั้งหมด`;
    const tEl = document.getElementById('trendIbd');
    tEl.textContent = totalPending > 0 ? `⚠️ ${totalPending}` : '✓ ว่าง';
    tEl.className = `kpi-trend ${totalPending > 0 ? 'trend-down' : 'trend-up'}`;

    // Badge
    document.getElementById('ibdTotalBadge').textContent = `${totalPending} รอดำเนินการ`;

    // Mini cards
    document.getElementById('ibdComplaintPending').textContent = complaintPending;
    document.getElementById('ibdComplaintSub').textContent = `จาก ${complaintTotal.toLocaleString()} เรื่อง · รอจัดการ`;
    document.getElementById('ibdEwalletPending').textContent = ewalletPending;
    document.getElementById('ibdEwalletSub').textContent = `จาก ${ewalletTotal.toLocaleString()} คำขอ · รอดำเนินการ`;
    document.getElementById('ibdRelocatePending').textContent = relocatePending;
    document.getElementById('ibdRelocateSub').textContent = `จาก ${relocateTotal.toLocaleString()} คำขอ · รอดำเนินการ`;
  } catch (e) {
    console.error('loadIbdModule:', e);
    document.getElementById('kpiIbd').textContent = '—';
    document.getElementById('kpiIbdSub').textContent = 'โหลดไม่ได้';
  }
}

async function _mlmTotalCount() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/members?select=member_code&limit=1`, {
    headers: {
      apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'count=exact', Range: '0-0',
    },
  });
  if (!res.ok) throw new Error(`members ${res.status}: ${await res.text()}`);
  const range = res.headers.get('content-range') || '*/0';
  return parseInt(range.split('/')[1], 10) || 0;
}

/* ── Trend chart (line) ── */
function _renderTrendChart(rows) {
  const labels = rows.map(r => r.month);
  const data   = rows.map(r => r.count);
  _mlmCharts.trend?.destroy();
  _mlmCharts.trend = new Chart(document.getElementById('chartTrend'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'สมัครใหม่',
        data,
        borderColor: '#0f4c75',
        backgroundColor: 'rgba(var(--accent-rgb),.12)',
        borderWidth: 2,
        fill: true,
        tension: 0.35,
        pointRadius: 3,
        pointHoverRadius: 6,
        pointBackgroundColor: '#0f4c75',
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } },
        x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 12 } },
      },
    },
  });
}

/* ── Country pie ── */
function _renderCountryChart(rows) {
  const labels = rows.map(r => _countryLabel(r.country_code));
  const data   = rows.map(r => r.count);
  const colors = ['#10b981', '#f59e0b', '#6366f1', '#ec4899', '#94a3b8'];
  _mlmCharts.country?.destroy();
  _mlmCharts.country = new Chart(document.getElementById('chartCountry'), {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 } } },
        tooltip: { callbacks: { label: c => `${c.label}: ${c.parsed.toLocaleString()}` } },
      },
      cutout: '55%',
    },
  });
}

/* ── Package donut ── */
function _renderPackageChart(rows) {
  const labels = rows.map(r => r.package);
  const data   = rows.map(r => r.count);
  const colors = {
    DM: '#8b5cf6', SI: '#f59e0b', PL: '#0e7490',
    MB: '#ec4899', EM: '#10b981', OTHER: '#94a3b8',
  };
  const bg = labels.map(l => colors[l] || '#94a3b8');
  _mlmCharts.package?.destroy();
  _mlmCharts.package = new Chart(document.getElementById('chartPackage'), {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: bg, borderWidth: 2, borderColor: '#fff' }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { font: { size: 11 } } },
        tooltip: { callbacks: { label: c => `${c.label}: ${c.parsed.toLocaleString()}` } },
      },
      cutout: '55%',
    },
  });
}

/* ── Top sponsors table ── */
function _renderTopSponsors(rows) {
  const tb = document.getElementById('topSponsorsBody');
  if (!rows.length) {
    tb.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text3)">ไม่มีข้อมูล</td></tr>`;
    return;
  }
  tb.innerHTML = rows.map((r, i) => {
    const rank = i + 1;
    const rankCls = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
    const flag = _countryFlag(r.sponsor_country);
    // Apply smart name rule (company → use full_name)
    const computedName = window.MemberFmt
      ? MemberFmt.displayNameFromPair(r.sponsor_member_name, r.sponsor_full_name)
      : (r.sponsor_full_name || r.sponsor_member_name);
    const hasName = computedName && computedName !== '—';
    const nameDisplay = hasName
      ? escapeHtml(computedName)
      : (r.sponsor_code === '1'
          ? '<span style="color:var(--text3)">🏛️ Root / Admin</span>'
          : '<span style="color:var(--text3)">— (สมาชิกแม่ทีม / ไม่ได้ import)</span>');
    return `<tr>
      <td><span class="mlm-rank ${rankCls}">${rank}</span></td>
      <td><span class="mlm-mono">${escapeHtml(r.sponsor_code || '—')}</span></td>
      <td>${nameDisplay}</td>
      <td>${flag} ${escapeHtml(r.sponsor_country || '')}</td>
      <td style="text-align:right"><span class="mlm-count">${(r.downline_count || 0).toLocaleString()}</span></td>
    </tr>`;
  }).join('');
}

function _countryLabel(c) {
  return c === 'TH' ? '🇹🇭 ไทย' : c === 'KH' ? '🇰🇭 Cambodia' : `🌐 ${c}`;
}
function _countryFlag(c) {
  return c === 'TH' ? '🇹🇭' : c === 'KH' ? '🇰🇭' : '🌐';
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}

/* ── PAT Expiry Alert (auto-show ≤ 30 days) ── */
async function checkPatExpiry() {
  const box = document.getElementById('patAlert');
  if (!box) return;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/sync_config?id=eq.1&select=github_pat_expires_at,github_pat_encrypted`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!res.ok) return;
    const [cfg] = await res.json();
    if (!cfg?.github_pat_encrypted) return;     // ยังไม่ตั้ง PAT
    if (!cfg?.github_pat_expires_at) return;    // ไม่รู้วันหมดอายุ — ข้าม

    const exp = new Date(cfg.github_pat_expires_at + 'T23:59:59');
    const days = Math.floor((exp - Date.now()) / 86400000);
    if (days > 30) return;     // ยังเหลือเยอะ — ไม่ต้องเตือน

    const isExpired = days < 0;
    const cls = (isExpired || days <= 7) ? 'danger' : 'warn';
    const icon = isExpired ? '🚨' : (days <= 7 ? '⚠️' : '⏰');
    const title = isExpired
      ? `PAT หมดอายุแล้ว ${Math.abs(days)} วัน — Auto-Sync ไม่ทำงาน!`
      : days === 0
        ? `PAT หมดอายุวันนี้!`
        : `PAT จะหมดอายุใน ${days} วัน`;
    const dateLabel = window.DateFmt
      ? DateFmt.formatDMY(cfg.github_pat_expires_at)
      : cfg.github_pat_expires_at;
    const msg = `Token GitHub Actions จะหมดอายุ ${dateLabel} — ไป generate ใหม่ที่ GitHub แล้วอัปเดตในหน้าตั้งค่า`;

    box.innerHTML = `
      <div class="pat-alert ${cls}">
        <div class="pat-alert-icon">${icon}</div>
        <div class="pat-alert-body">
          <div class="pat-alert-title">${title}</div>
          <div class="pat-alert-msg">${msg}</div>
        </div>
        <a class="pat-alert-cta" href="../customer/members-sync.html">⚙️ ไปอัปเดต</a>
      </div>
    `;
    box.style.display = 'block';
  } catch (e) {
    console.error('checkPatExpiry', e);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  setWelcome();
  if (SUPABASE_URL && SUPABASE_KEY) loadAll();
});