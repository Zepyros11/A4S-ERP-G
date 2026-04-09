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

async function loadAll() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  setWelcome();
  try {
    const [products, stockBalance, pos, sos, movements] = await Promise.all([
      sbFetch('products', '?select=product_id,product_code,product_name,reorder_point,is_active&is_active=eq.true'),
      sbFetch('stock_balance', '?select=product_id,warehouse_id,qty_on_hand'),
      sbFetch('purchase_orders', '?select=po_id,po_number,order_date,total_amount,status&order=order_date.desc&limit=100'),
      sbFetch('sales_orders', '?select=so_id,so_number,order_date,total_amount,status&order=order_date.desc&limit=100'),
      sbFetch('stock_movements', '?select=*&order=moved_at.desc&limit=100'),
    ]);
    renderKPIs(products, stockBalance, pos, sos);
    renderStockAlerts(products, stockBalance);
    renderTopProducts(products, stockBalance);
    renderRecentDocs(pos, sos);
    renderMovementChart(movements);
    renderRecentMovements(movements, products);
  } catch(e) {
    showToast('โหลดไม่ได้: ' + e.message, 'error');
  }
}

function renderKPIs(products, stockBalance, pos, sos) {
  const totalStock = stockBalance.reduce((s, b) => s + (b.qty_on_hand || 0), 0);
  document.getElementById('kpiProducts').textContent = products.length;
  document.getElementById('kpiProductsSub').textContent = `Stock รวม ${totalStock.toLocaleString()} ชิ้น`;
  document.getElementById('trendProducts').textContent = `${products.length} รายการ`;
  document.getElementById('trendProducts').className = 'kpi-trend trend-neu';

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
  const monthPO = pos.filter(p => p.order_date >= monthStart);
  const totalPOAmt = monthPO.reduce((s, p) => s + parseFloat(p.total_amount || 0), 0);
  document.getElementById('kpiPO').textContent = monthPO.length;
  document.getElementById('kpiPOSub').textContent = `฿${totalPOAmt.toLocaleString('th-TH', { minimumFractionDigits:0 })}`;
  document.getElementById('trendPO').textContent = `${monthPO.length} ใบ`;

  const monthSO = sos.filter(s => s.order_date >= monthStart);
  const totalSOAmt = monthSO.reduce((s, p) => s + parseFloat(p.total_amount || 0), 0);
  document.getElementById('kpiSO').textContent = monthSO.length;
  document.getElementById('kpiSOSub').textContent = `฿${totalSOAmt.toLocaleString('th-TH', { minimumFractionDigits:0 })}`;
  document.getElementById('trendSO').textContent = `${monthSO.length} ใบ`;

  const stockMap = {};
  stockBalance.forEach(b => { stockMap[b.product_id] = (stockMap[b.product_id] || 0) + (b.qty_on_hand || 0); });
  const alertCount = products.filter(p => (stockMap[p.product_id] || 0) <= (p.reorder_point || 0)).length;
  document.getElementById('kpiAlert').textContent = alertCount;
  document.getElementById('kpiAlertSub').textContent = alertCount > 0 ? 'ต้องสั่งซื้อเพิ่ม' : 'Stock ปกติ ✓';
  document.getElementById('trendAlert').textContent = alertCount > 0 ? `⚠️ ${alertCount}` : '✓ ปกติ';
  document.getElementById('trendAlert').className = `kpi-trend ${alertCount > 0 ? 'trend-down' : 'trend-up'}`;
}

function renderStockAlerts(products, stockBalance) {
  const stockMap = {};
  stockBalance.forEach(b => { stockMap[b.product_id] = (stockMap[b.product_id] || 0) + (b.qty_on_hand || 0); });
  const alerts = products
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

window.addEventListener('DOMContentLoaded', () => {
  setWelcome();
  if (SUPABASE_URL && SUPABASE_KEY) loadAll();
});