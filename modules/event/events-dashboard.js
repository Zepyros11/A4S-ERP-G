/* ============================================================
   events-dashboard.js — Events analytics overview
============================================================ */

// ── API helpers ──
function getSB() {
  return {
    url: localStorage.getItem("sb_url") || "",
    key: localStorage.getItem("sb_key") || "",
  };
}
async function sbGet(path) {
  const { url, key } = getSB();
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text().catch(() => "")}`);
  return res.json();
}

// ── State ──
let ALL_EVENTS = [];
let ALL_ATTENDEES = [];
let ALL_CATEGORIES = [];
let ALL_MEMBERS_MAP = {}; // member_code -> {country_code, position_level, sponsor_code, full_name, member_name}
let DATE_FROM = null;
let DATE_TO = null;
let CHARTS = {}; // chart instances (for destroy/rebuild)

// ── Date utils ──
function parseDMY(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1]);
}
function toISO(d) {
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtDMY(d) {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (!dt || isNaN(dt)) return "";
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
}
function fmtNum(n) {
  return Number(n || 0).toLocaleString("th-TH");
}
function fmtMoney(n) {
  return Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function monthKey(d) {
  const dt = typeof d === "string" ? new Date(d) : d;
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(k) {
  const [y, m] = k.split("-");
  const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  return `${months[+m - 1]} ${(+y + 543).toString().slice(-2)}`;
}

// ── Date range presets ──
window.setPreset = function (kind) {
  const now = new Date();
  let from = null, to = null;
  if (kind === "30d") { from = new Date(now); from.setDate(from.getDate() - 30); to = now; }
  else if (kind === "90d") { from = new Date(now); from.setDate(from.getDate() - 90); to = now; }
  else if (kind === "ytd") { from = new Date(now.getFullYear(), 0, 1); to = now; }
  else if (kind === "all") { from = null; to = null; }
  window._fpFrom?.setDate(from || null, false);
  window._fpTo?.setDate(to || null, false);
  DATE_FROM = from;
  DATE_TO = to;
  applyFilter();
};

window.refreshDashboard = async function () {
  await loadData();
  applyFilter();
};

// ── Loading ──
function showLoading(b) {
  document.getElementById("loadingOverlay").classList.toggle("show", !!b);
}
function showToast(msg, type = "info") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.className = `toast toast-${type} show`;
  setTimeout(() => t.classList.remove("show"), 2400);
}

// ── Data fetch ──
async function loadData() {
  showLoading(true);
  try {
    const [events, attendees, cats] = await Promise.all([
      sbGet("events?select=event_id,event_name,event_code,event_date,end_date,max_attendees,price,event_category_id,location,status").catch(() => []),
      sbGet("event_attendees?select=attendee_id,event_id,name,member_code,position_level,paid_amount,payment_status,checked_in,check_in_at,created_at").catch(() => []),
      sbGet("event_categories?select=event_category_id,category_name").catch(() => []),
    ]);

    ALL_EVENTS = events || [];
    ALL_ATTENDEES = attendees || [];
    ALL_CATEGORIES = cats || [];

    // Load members (for country + sponsor info) — only those referenced by attendees
    const codes = [...new Set(ALL_ATTENDEES.map(a => a.member_code).filter(Boolean))];
    ALL_MEMBERS_MAP = {};
    if (codes.length) {
      // Batch fetch (in chunks of 200 to avoid URL limit)
      const chunks = [];
      for (let i = 0; i < codes.length; i += 200) chunks.push(codes.slice(i, i + 200));
      for (const chunk of chunks) {
        try {
          const q = `members?select=member_code,full_name,member_name,country_code,position_level,sponsor_code&member_code=in.(${chunk.map(c => `"${c}"`).join(",")})`;
          const rows = await sbGet(q);
          (rows || []).forEach(m => { ALL_MEMBERS_MAP[m.member_code] = m; });
        } catch (e) { console.warn("members fetch:", e); }
      }
    }
  } catch (e) {
    showToast("โหลดข้อมูลไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
}

// ── Filter by date range ──
function applyFilter() {
  const fromISO = DATE_FROM ? toISO(DATE_FROM) : null;
  const toISOStr = DATE_TO ? toISO(DATE_TO) : null;

  const events = ALL_EVENTS.filter(e => {
    if (!e.event_date) return false;
    if (fromISO && e.event_date < fromISO) return false;
    if (toISOStr && e.event_date > toISOStr) return false;
    return true;
  });
  const evIds = new Set(events.map(e => e.event_id));
  const attendees = ALL_ATTENDEES.filter(a => evIds.has(a.event_id));

  renderKPI(events, attendees);
  renderMonthsChart(events, attendees);
  renderTopEventsChart(events, attendees);
  renderCategoryChart(events);
  renderPositionChart(attendees);
  renderCountryChart(attendees);
  renderTopMembers(attendees);
  renderTopSponsors(attendees);
  renderUpcoming(); // uses ALL_EVENTS (future only)

  // Update sub labels
  const label = (fromISO || toISOStr)
    ? `${fmtDMY(DATE_FROM) || "..."} — ${fmtDMY(DATE_TO) || "..."}`
    : "ทุกช่วงเวลา";
  document.getElementById("chartMonthsSub").textContent = label;
}

// ── KPI ──
function renderKPI(events, attendees) {
  const now = new Date();
  const nowISO = toISO(now);
  const upcoming = events.filter(e => e.event_date > nowISO).length;
  const past = events.filter(e => (e.end_date || e.event_date) < nowISO).length;
  const ongoing = events.length - upcoming - past;

  const total = attendees.length;
  const checkedIn = attendees.filter(a => a.checked_in).length;
  const rate = total ? Math.round((checkedIn / total) * 100) : 0;

  const revenue = attendees
    .filter(a => a.payment_status === "PAID")
    .reduce((s, a) => s + parseFloat(a.paid_amount || 0), 0);
  const pending = attendees
    .filter(a => a.payment_status === "UNPAID")
    .reduce((s, a) => s + parseFloat(a.paid_amount || 0), 0);

  const uniqueMembers = new Set(attendees.map(a => a.member_code).filter(Boolean)).size;

  document.getElementById("kpiEvents").textContent = fmtNum(events.length);
  document.getElementById("kpiEventsSub").textContent = `🟢 ${upcoming} ยังไม่จัด · ⏳ ${ongoing} กำลังจัด · ✓ ${past} จบแล้ว`;

  document.getElementById("kpiAttendees").textContent = fmtNum(total);
  document.getElementById("kpiAttendeesSub").textContent = `Check-in แล้ว ${fmtNum(checkedIn)}`;

  document.getElementById("kpiCheckinRate").textContent = `${rate}%`;
  document.getElementById("kpiCheckinSub").textContent = `${fmtNum(checkedIn)} / ${fmtNum(total)}`;

  document.getElementById("kpiRevenue").textContent = fmtMoney(revenue);
  document.getElementById("kpiRevenueSub").textContent = `รอชำระ ฿${fmtMoney(pending)}`;

  document.getElementById("kpiMembers").textContent = fmtNum(uniqueMembers);
  document.getElementById("kpiMembersSub").textContent = `จาก ${fmtNum(total)} attendees`;
}

// ── Chart helpers ──
function destroyChart(id) {
  if (CHARTS[id]) { CHARTS[id].destroy(); delete CHARTS[id]; }
}
const PALETTE = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#06b6d4", "#f97316", "#14b8a6", "#eab308", "#6366f1"];

// ── Chart 1: Events per month (bar) ──
function renderMonthsChart(events, attendees) {
  destroyChart("months");
  const ctx = document.getElementById("chartMonths").getContext("2d");

  // Build last 12 months keys (or whole range)
  const buckets = {};
  events.forEach(e => {
    if (!e.event_date) return;
    const k = monthKey(e.event_date);
    if (!buckets[k]) buckets[k] = { events: 0, attendees: 0 };
    buckets[k].events += 1;
  });
  attendees.forEach(a => {
    const e = ALL_EVENTS.find(x => x.event_id === a.event_id);
    if (!e?.event_date) return;
    const k = monthKey(e.event_date);
    if (!buckets[k]) buckets[k] = { events: 0, attendees: 0 };
    buckets[k].attendees += 1;
  });

  const keys = Object.keys(buckets).sort();
  const labels = keys.map(monthLabel);
  const evData = keys.map(k => buckets[k].events);
  const atData = keys.map(k => buckets[k].attendees);

  CHARTS.months = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Events", data: evData, backgroundColor: "#3b82f6", borderRadius: 6, yAxisID: "y1" },
        { label: "ผู้เข้าร่วม", data: atData, type: "line", borderColor: "#10b981", backgroundColor: "rgba(16,185,129,.15)", fill: true, tension: .3, yAxisID: "y2", pointRadius: 3 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        y1: { beginAtZero: true, position: "left", title: { display: true, text: "Events" } },
        y2: { beginAtZero: true, position: "right", title: { display: true, text: "Attendees" }, grid: { display: false } },
      },
      plugins: { legend: { position: "top", labels: { boxWidth: 12, font: { size: 11 } } } },
    },
  });
}

// ── Chart 2: Top 10 events by attendees (horizontal bar) ──
function renderTopEventsChart(events, attendees) {
  destroyChart("topEvents");
  const ctx = document.getElementById("chartTopEvents").getContext("2d");

  const count = {};
  attendees.forEach(a => { count[a.event_id] = (count[a.event_id] || 0) + 1; });
  const sorted = events
    .map(e => ({ ...e, _count: count[e.event_id] || 0 }))
    .sort((a, b) => b._count - a._count)
    .slice(0, 10);

  const labels = sorted.map(e => (e.event_name || e.event_code || "").slice(0, 30));
  const data = sorted.map(e => e._count);

  CHARTS.topEvents = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "ผู้เข้าร่วม",
        data,
        backgroundColor: sorted.map((_, i) => PALETTE[i % PALETTE.length]),
        borderRadius: 5,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true, maintainAspectRatio: false,
      scales: { x: { beginAtZero: true }, y: { ticks: { font: { size: 11 } } } },
      plugins: { legend: { display: false } },
    },
  });
}

// ── Donut helper ──
function renderDonut(chartKey, canvasId, dataMap, emptyMsg = "ไม่มีข้อมูล") {
  destroyChart(chartKey);
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext("2d");
  const entries = Object.entries(dataMap).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = "13px Sarabun";
    ctx.fillStyle = "#94a3b8";
    ctx.textAlign = "center";
    ctx.fillText(emptyMsg, canvas.width / 2, canvas.height / 2);
    return;
  }
  const labels = entries.map(([k]) => k);
  const data = entries.map(([, v]) => v);
  CHARTS[chartKey] = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]),
        borderWidth: 2,
        borderColor: "#fff",
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: "60%",
      plugins: {
        legend: { position: "right", labels: { boxWidth: 12, font: { size: 11 }, padding: 8 } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const total = ctx.dataset.data.reduce((s, v) => s + v, 0);
              const pct = total ? ((ctx.parsed / total) * 100).toFixed(1) : 0;
              return `${ctx.label}: ${ctx.parsed} (${pct}%)`;
            },
          },
        },
      },
    },
  });
}

function renderCategoryChart(events) {
  const catMap = {};
  ALL_CATEGORIES.forEach(c => { catMap[c.event_category_id] = c.category_name; });
  const dist = {};
  events.forEach(e => {
    const name = catMap[e.event_category_id] || "ไม่ระบุ";
    dist[name] = (dist[name] || 0) + 1;
  });
  renderDonut("category", "chartCategory", dist);
}

function renderPositionChart(attendees) {
  const dist = {};
  attendees.forEach(a => {
    const p = (a.position_level || "").trim() || "— ไม่ระบุ";
    dist[p] = (dist[p] || 0) + 1;
  });
  renderDonut("position", "chartPosition", dist);
}

function renderCountryChart(attendees) {
  const dist = {};
  attendees.forEach(a => {
    const m = ALL_MEMBERS_MAP[a.member_code];
    const c = (m?.country_code || "— ไม่ระบุ");
    dist[c] = (dist[c] || 0) + 1;
  });
  renderDonut("country", "chartCountry", dist);
}

// ── Top members + sponsors ──
function renderTopMembers(attendees) {
  const count = {};
  attendees.forEach(a => {
    if (!a.member_code) return;
    count[a.member_code] = (count[a.member_code] || 0) + 1;
  });
  const sorted = Object.entries(count)
    .map(([code, n]) => {
      const m = ALL_MEMBERS_MAP[code];
      return { code, name: m?.full_name || m?.member_name || "—", position: m?.position_level || "", n };
    })
    .sort((a, b) => b.n - a.n)
    .slice(0, 10);

  const el = document.getElementById("topMembersList");
  if (!sorted.length) {
    el.innerHTML = `<div class="ed-empty"><div class="ed-empty-icon">👥</div>ไม่มีข้อมูล</div>`;
    return;
  }
  el.innerHTML = sorted.map((r, i) => {
    const rankClass = i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";
    return `<div class="ed-list-item">
      <div class="ed-list-rank ${rankClass}">${i + 1}</div>
      <div class="ed-list-info">
        <div class="ed-list-name">${escapeHtml(r.name)} <span style="font-family:'IBM Plex Mono',monospace;color:#1e40af;font-size:11px;font-weight:700;background:#dbeafe;padding:1px 6px;border-radius:4px;margin-left:4px">${r.code}</span></div>
        <div class="ed-list-sub">${r.position ? `⭐ ${escapeHtml(r.position)}` : "—"}</div>
      </div>
      <div class="ed-list-value">${r.n} ครั้ง</div>
    </div>`;
  }).join("");
}

function renderTopSponsors(attendees) {
  // count = how many attendees each sponsor_code has brought (via member_code → sponsor_code)
  const sponsorCount = {};
  attendees.forEach(a => {
    if (!a.member_code) return;
    const m = ALL_MEMBERS_MAP[a.member_code];
    const sp = m?.sponsor_code;
    if (!sp) return;
    sponsorCount[sp] = (sponsorCount[sp] || 0) + 1;
  });

  // Need sponsor's name — ALL_MEMBERS_MAP only has attendees' members, not sponsors.
  // Use sponsor code itself as name if we don't have the record.
  const sorted = Object.entries(sponsorCount)
    .map(([code, n]) => {
      const m = ALL_MEMBERS_MAP[code];
      return { code, name: m?.full_name || m?.member_name || "", n };
    })
    .sort((a, b) => b.n - a.n)
    .slice(0, 10);

  const el = document.getElementById("topSponsorsList");
  if (!sorted.length) {
    el.innerHTML = `<div class="ed-empty"><div class="ed-empty-icon">🤝</div>ไม่มีข้อมูล sponsor</div>`;
    return;
  }
  el.innerHTML = sorted.map((r, i) => {
    const rankClass = i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";
    return `<div class="ed-list-item">
      <div class="ed-list-rank ${rankClass}">${i + 1}</div>
      <div class="ed-list-info">
        <div class="ed-list-name">${r.name ? escapeHtml(r.name) : "—"} <span style="font-family:'IBM Plex Mono',monospace;color:#1e40af;font-size:11px;font-weight:700;background:#dbeafe;padding:1px 6px;border-radius:4px;margin-left:4px">${r.code}</span></div>
        <div class="ed-list-sub">Sponsor</div>
      </div>
      <div class="ed-list-value">พาไป ${r.n} คน</div>
    </div>`;
  }).join("");
}

// ── Upcoming events ──
function renderUpcoming() {
  const nowISO = toISO(new Date());
  const upcoming = ALL_EVENTS
    .filter(e => e.event_date && e.event_date >= nowISO)
    .sort((a, b) => a.event_date.localeCompare(b.event_date))
    .slice(0, 8);

  const el = document.getElementById("upcomingGrid");
  const sub = document.getElementById("upcomingSub");
  sub.textContent = upcoming.length ? `${upcoming.length} รายการ` : "";

  if (!upcoming.length) {
    el.innerHTML = `<div class="ed-empty"><div class="ed-empty-icon">📅</div>ไม่มีกิจกรรมที่กำลังจะถึง</div>`;
    return;
  }

  const countByEv = {};
  ALL_ATTENDEES.forEach(a => { countByEv[a.event_id] = (countByEv[a.event_id] || 0) + 1; });

  el.innerHTML = upcoming.map(e => {
    const cnt = countByEv[e.event_id] || 0;
    const max = e.max_attendees || 0;
    const pct = max > 0 ? Math.min(100, Math.round((cnt / max) * 100)) : 0;
    const fillClass = pct >= 100 ? "full" : pct >= 80 ? "warn" : "";
    const progress = max > 0
      ? `<div class="ed-up-progress">
          <div class="ed-up-progress-label"><span>ลงทะเบียน</span><span>${cnt} / ${max} (${pct}%)</span></div>
          <div class="ed-up-progress-bar"><div class="ed-up-progress-fill ${fillClass}" style="width:${pct}%"></div></div>
        </div>`
      : `<div class="ed-up-progress"><div class="ed-up-progress-label"><span>ลงทะเบียน</span><span>${cnt} คน (ไม่จำกัด)</span></div></div>`;
    return `<div class="ed-up-card" onclick="location.href='./attendees.html?event=${e.event_id}'">
      <div class="ed-up-date">📅 ${fmtDMY(e.event_date)}</div>
      <div class="ed-up-name">${escapeHtml(e.event_name || e.event_code || "—")}</div>
      ${e.location ? `<div class="ed-up-location">📍 ${escapeHtml(e.location)}</div>` : ""}
      ${progress}
    </div>`;
  }).join("");
}

// ── Utils ──
function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ── Init ──
async function init() {
  // Setup flatpickr date inputs
  const flatOpts = {
    dateFormat: "d/m/Y",
    allowInput: true,
    locale: "th",
    onChange: (dates) => {
      /* handled in buttons */
    },
  };
  window._fpFrom = flatpickr("#dateFrom", {
    ...flatOpts,
    onChange: (dates) => { DATE_FROM = dates[0] || null; applyFilter(); },
  });
  window._fpTo = flatpickr("#dateTo", {
    ...flatOpts,
    onChange: (dates) => { DATE_TO = dates[0] || null; applyFilter(); },
  });

  await loadData();
  applyFilter();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
