/* ============================================================
   campaign-dashboard.js — Campaign Review (aggregate dashboard)
   ภาพรวมทุกแคมเปญ: KPI + สถานะ + แพลตฟอร์ม + Top performers + active
   อ่านอย่างเดียว (ไม่ PATCH สถานะกลับ DB — แค่คำนวณ display ตามวันที่)
============================================================ */

// ── Supabase helpers ──────────────────────────────────────
function getSB() {
  return {
    url: localStorage.getItem("sb_url") || "",
    key: localStorage.getItem("sb_key") || "",
  };
}
async function sbFetch(table, query = "") {
  const { url, key } = getSB();
  const res = await fetch(`${url}/rest/v1/${table}${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || `Error ${res.status}`);
  }
  return res.json().catch(() => null);
}

const fmtDMY = (d) => (window.DateFmt ? window.DateFmt.formatDMY(d) : (d || "").slice(0, 10));
const fmtNum = (n) => (Number(n) || 0).toLocaleString("en-US");
function fmtCompact(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, "") + "K";
  return String(n);
}

function showLoading(on) {
  const el = document.getElementById("loadingOverlay");
  if (el) el.style.display = on ? "flex" : "none";
}
function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove("show"), 3000);
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

// ── STATE ─────────────────────────────────────────────────
let campaigns = [];
let participants = [];
let submissions = [];
let partById = {}; // participant_id -> participant row

// ── AUTO STATUS ตามวันที่ (เหมือน campaign-planning — แต่ไม่เขียนกลับ) ──
function todayBKK() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}
function displayStatus(c) {
  // ไม่ auto: ร่าง (ยังแก้อยู่) และ ยกเลิก — เหมือน campaign-planning (แต่ไม่เขียนกลับ)
  if (c.status === "DRAFT" || c.status === "CANCELLED") return c.status;
  const start = (c.start_date || "").slice(0, 10);
  if (!start) return c.status;
  const end = (c.end_date || "").slice(0, 10);
  const today = todayBKK();
  if (today < start) return "CONFIRMED";
  if (end && today > end) return "ENDED";
  return "ACTIVE";
}

// ── INIT ──────────────────────────────────────────────────
async function initPage() {
  showLoading(true);
  try {
    await loadData();
  } catch (e) {
    showToast("โหลดข้อมูลไม่สำเร็จ: " + e.message, "error");
  } finally {
    showLoading(false);
  }
}

async function loadData() {
  const [camps, parts, subs] = await Promise.all([
    sbFetch("campaigns", "?select=*&order=created_at.desc"),
    sbFetch("campaign_participants", "?select=participant_id,campaign_id,member_code,member_name,status"),
    sbFetch("campaign_submissions", "?select=campaign_id,participant_id,platform,views,likes,comments,shares,status"),
  ]);
  campaigns = (camps || []).map((c) => ({ ...c, _status: displayStatus(c) }));
  participants = parts || [];
  submissions = subs || [];
  partById = {};
  participants.forEach((p) => (partById[p.participant_id] = p));

  renderKpis();
  renderStatusDonut();
  renderPlatformBars();
  renderTopPerformers();
  renderCampaignReport();
}

const approvedSubs = () => submissions.filter((s) => s.status === "approved");
const engOf = (s) => (+s.likes || 0) + (+s.comments || 0) + (+s.shares || 0);

// ════════════════════════════════════════════════════════
//  KPI CARDS
// ════════════════════════════════════════════════════════
function renderKpis() {
  const active = campaigns.filter((c) => c._status === "ACTIVE").length;
  const ended = campaigns.filter((c) => c._status === "ENDED").length;
  const appr = approvedSubs();
  const totalViews = appr.reduce((a, s) => a + (+s.views || 0), 0);
  const totalEng = appr.reduce((a, s) => a + engOf(s), 0);
  const approvedParts = participants.filter((p) => p.status === "approved").length;

  document.getElementById("kpiCampaigns").textContent = fmtNum(campaigns.length);
  document.getElementById("kpiCampaignsSub").innerHTML =
    `<span style="color:var(--success)">▶️ ${active} ดำเนินการ</span> · <span style="color:var(--info)">✅ ${ended} จบแล้ว</span>`;

  document.getElementById("kpiParticipants").textContent = fmtNum(participants.length);
  document.getElementById("kpiParticipantsSub").textContent = `อนุมัติแล้ว ${fmtNum(approvedParts)} คน`;

  document.getElementById("kpiViews").textContent = fmtCompact(totalViews);
  document.getElementById("kpiViews").title = fmtNum(totalViews);
  document.getElementById("kpiViewsSub").textContent = `จาก ${fmtNum(appr.length)} ผลงานที่อนุมัติ`;

  document.getElementById("kpiEng").textContent = fmtCompact(totalEng);
  document.getElementById("kpiEng").title = fmtNum(totalEng);
  const likes = appr.reduce((a, s) => a + (+s.likes || 0), 0);
  document.getElementById("kpiEngSub").textContent = `❤️ ${fmtCompact(likes)} like + 💬🔁 อื่นๆ`;
}

// ════════════════════════════════════════════════════════
//  STATUS DONUT (SVG, dependency-free)
// ════════════════════════════════════════════════════════
const STATUS_META = {
  ACTIVE: { label: "▶️ ดำเนินการ", color: "#057a55" },
  CONFIRMED: { label: "✔️ ยืนยัน", color: "#4338ca" },
  DRAFT: { label: "📝 ร่าง", color: "#9d958b" },
  ENDED: { label: "✅ จบแล้ว", color: "#1e40af" },
  CANCELLED: { label: "❌ ยกเลิก", color: "#b45309" },
};
function renderStatusDonut() {
  const counts = {};
  Object.keys(STATUS_META).forEach((k) => (counts[k] = 0));
  campaigns.forEach((c) => (counts[c._status] = (counts[c._status] || 0) + 1));
  const total = campaigns.length;

  const svg = document.getElementById("statusDonut");
  const legend = document.getElementById("statusLegend");
  if (!total) {
    svg.innerHTML = `<circle cx="70" cy="70" r="54" fill="none" stroke="var(--border)" stroke-width="18"/>`;
    document.getElementById("donutCenterNum").textContent = "0";
    legend.innerHTML = `<div class="dash-empty-sm">ยังไม่มีแคมเปญ</div>`;
    return;
  }

  const r = 54, C = 2 * Math.PI * r;
  let offset = 0;
  const segs = Object.keys(STATUS_META)
    .filter((k) => counts[k] > 0)
    .map((k) => {
      const frac = counts[k] / total;
      const seg = `<circle cx="70" cy="70" r="${r}" fill="none" stroke="${STATUS_META[k].color}"
        stroke-width="18" stroke-dasharray="${(frac * C).toFixed(2)} ${(C - frac * C).toFixed(2)}"
        stroke-dashoffset="${(-offset * C).toFixed(2)}" transform="rotate(-90 70 70)"
        stroke-linecap="butt"><title>${STATUS_META[k].label}: ${counts[k]}</title></circle>`;
      offset += frac;
      return seg;
    })
    .join("");
  svg.innerHTML =
    `<circle cx="70" cy="70" r="${r}" fill="none" stroke="var(--surface2)" stroke-width="18"/>` + segs;
  document.getElementById("donutCenterNum").textContent = fmtNum(total);

  legend.innerHTML = Object.keys(STATUS_META)
    .map((k) => {
      const pct = total ? Math.round((counts[k] / total) * 100) : 0;
      return `<div class="dash-legend-row">
        <span class="dash-dot" style="background:${STATUS_META[k].color}"></span>
        <span class="dash-legend-lbl">${STATUS_META[k].label}</span>
        <span class="dash-legend-val">${counts[k]} <span class="muted">(${pct}%)</span></span>
      </div>`;
    })
    .join("");
}

// ════════════════════════════════════════════════════════
//  PLATFORM BARS (approved submissions)
// ════════════════════════════════════════════════════════
const PLAT_META = {
  tiktok: { label: "TikTok", icon: "../../assets/icons/tiktok.png", color: "#111827" },
  instagram: { label: "Instagram", icon: "../../assets/icons/instagram.png", color: "#c13584" },
  facebook: { label: "Facebook", icon: "../../assets/icons/facebook.png", color: "#1877f2" },
};
function renderPlatformBars() {
  const agg = {};
  Object.keys(PLAT_META).forEach((k) => (agg[k] = { views: 0, eng: 0, posts: 0 }));
  approvedSubs().forEach((s) => {
    const a = agg[s.platform];
    if (!a) return;
    a.views += +s.views || 0;
    a.eng += engOf(s);
    a.posts += 1;
  });
  const max = Math.max(1, ...Object.values(agg).map((a) => a.views));
  const wrap = document.getElementById("platformBars");
  const hasAny = Object.values(agg).some((a) => a.posts > 0);
  if (!hasAny) {
    wrap.innerHTML = `<div class="dash-empty-sm">ยังไม่มีผลงานที่อนุมัติ</div>`;
    return;
  }
  wrap.innerHTML = Object.keys(PLAT_META)
    .map((k) => {
      const a = agg[k];
      const pct = Math.max(2, Math.round((a.views / max) * 100));
      return `<div class="dash-bar-row">
        <div class="dash-bar-head">
          <span class="dash-bar-name"><img src="${PLAT_META[k].icon}" alt="" class="dash-plat-ic" /> ${PLAT_META[k].label}</span>
          <span class="dash-bar-val">${fmtNum(a.views)} <span class="muted">วิว · ${a.posts} โพสต์</span></span>
        </div>
        <div class="dash-bar-track">
          <div class="dash-bar-fill" style="width:${pct}%;background:${PLAT_META[k].color}"></div>
        </div>
        <div class="dash-bar-sub">❤️💬🔁 ${fmtNum(a.eng)} engagement</div>
      </div>`;
    })
    .join("");
}

// ════════════════════════════════════════════════════════
//  TOP PERFORMERS — รวมข้ามแคมเปญ (by member_code, approved)
// ════════════════════════════════════════════════════════
function renderTopPerformers() {
  const metric = document.getElementById("topMetricSel").value;
  const byMember = {};
  approvedSubs().forEach((s) => {
    const p = partById[s.participant_id];
    if (!p) return;
    const key = p.member_code || `#${s.participant_id}`;
    const m = (byMember[key] ||= {
      code: p.member_code,
      name: p.member_name || p.member_code,
      views: 0, likes: 0, comments: 0, shares: 0, posts: 0,
      campaigns: new Set(),
    });
    m.views += +s.views || 0;
    m.likes += +s.likes || 0;
    m.comments += +s.comments || 0;
    m.shares += +s.shares || 0;
    m.posts += 1;
    m.campaigns.add(s.campaign_id);
  });

  const scoreOf = (m) =>
    metric === "likes" ? m.likes
    : metric === "engagement" ? m.likes + m.comments + m.shares
    : m.views;

  const rows = Object.values(byMember)
    .filter((m) => m.posts > 0)
    .sort((a, b) => scoreOf(b) - scoreOf(a))
    .slice(0, 10);

  const el = document.getElementById("topList");
  if (!rows.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">🏆</div>
      <div class="empty-text">ยังไม่มีผลงานที่อนุมัติ — อันดับจะแสดงเมื่อมีผลงานอนุมัติแล้ว</div></div>`;
    return;
  }
  const metricLbl = { views: "วิว", likes: "Like", engagement: "Eng." }[metric];
  el.innerHTML = rows
    .map((m, i) => {
      const rank = i + 1;
      const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : rank;
      const top = rank <= 3 ? ` top${rank}` : "";
      return `<div class="dash-lb-row${top}">
        <div class="dash-lb-rank">${medal}</div>
        <div class="dash-lb-name">
          <div class="n">${esc(m.name)}</div>
          <div class="c">${esc(m.code)} · ${m.posts} โพสต์ · ${m.campaigns.size} แคมเปญ</div>
        </div>
        <div class="dash-lb-metrics">
          <div class="mm"><div class="v">${fmtCompact(m.views)}</div><div class="l">👁 วิว</div></div>
          <div class="mm"><div class="v">${fmtCompact(m.likes)}</div><div class="l">❤️ like</div></div>
          <div class="mm"><div class="v">${fmtCompact(m.comments + m.shares)}</div><div class="l">💬🔁</div></div>
        </div>
        <div class="dash-lb-score">${fmtCompact(scoreOf(m))}<div class="lbl">${metricLbl}</div></div>
      </div>`;
    })
    .join("");
}
window.renderTopPerformers = renderTopPerformers;

// ════════════════════════════════════════════════════════
//  รายงานทุกแคมเปญ — ตาราง metric รายตัว + filter + CSV
// ════════════════════════════════════════════════════════
const PLAT_REPORT = {
  tiktok: "../../assets/icons/tiktok.png",
  instagram: "../../assets/icons/instagram.png",
  facebook: "../../assets/icons/facebook.png",
};
// รวม metric ของแต่ละแคมเปญ (total + approved)
function campaignAgg(cid) {
  const parts = participants.filter((p) => p.campaign_id === cid);
  const subs = submissions.filter((s) => s.campaign_id === cid);
  const appr = subs.filter((s) => s.status === "approved");
  return {
    partsTotal: parts.length,
    partsApproved: parts.filter((p) => p.status === "approved").length,
    postsTotal: subs.length,
    postsApproved: appr.length,
    views: appr.reduce((a, s) => a + (+s.views || 0), 0),
    likes: appr.reduce((a, s) => a + (+s.likes || 0), 0),
    eng: appr.reduce((a, s) => a + engOf(s), 0),
  };
}
function dateProgress(c) {
  const start = (c.start_date || "").slice(0, 10);
  const end = (c.end_date || "").slice(0, 10);
  if (!start || !end) return null;
  const today = todayBKK();
  const t0 = new Date(start).getTime(), t1 = new Date(end).getTime(), tn = new Date(today).getTime();
  if (t1 <= t0) return 100;
  const pct = Math.round(((tn - t0) / (t1 - t0)) * 100);
  return Math.max(0, Math.min(100, pct));
}
function reportRows() {
  const f = document.getElementById("reportStatusSel").value;
  return campaigns.filter((c) => !f || c._status === f);
}
function renderCampaignReport() {
  const rows = reportRows();
  const body = document.getElementById("reportBody");
  document.getElementById("reportCount").textContent = `(${rows.length} แคมเปญ)`;

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="10"><div class="empty-state"><div class="empty-icon">🔍</div>
      <div class="empty-text">ไม่พบแคมเปญ</div></div></td></tr>`;
    return;
  }
  body.innerHTML = rows
    .map((c) => {
      const a = campaignAgg(c.campaign_id);
      const prog = c._status === "ACTIVE" ? dateProgress(c) : null;
      const cover = c.cover_url
        ? `<img class="dash-rep-cover" src="${esc(c.cover_url)}" alt="" />`
        : `<div class="dash-rep-cover dash-rep-cover-ph">🚀</div>`;
      const dates = c.start_date || c.end_date
        ? `${fmtDMY(c.start_date) || "—"} – ${fmtDMY(c.end_date) || "—"}` : "—";
      const progBar = prog == null ? "" : `
        <div class="dash-rep-prog" title="ผ่านไป ${prog}% ของช่วงเวลา">
          <div class="dash-rep-prog-track"><div class="dash-rep-prog-fill" style="width:${prog}%"></div></div>
          <span>${prog}%</span>
        </div>`;
      const plats = (c.platforms || [])
        .map((p) => PLAT_REPORT[p]
          ? `<img src="${PLAT_REPORT[p]}" alt="${p}" class="dash-plat-ic" />` : `<span>${esc(p)}</span>`)
        .join(" ");
      return `<tr>
        <td>
          <div class="dash-rep-name-cell">
            ${cover}
            <div style="min-width:0">
              <div class="dash-rep-name">${esc(c.name)}</div>
              <div class="dash-rep-sub">${(c.rewards && Object.keys(c.rewards).length) || c.reward ? "🎁 มีของรางวัล" : "ID #" + c.campaign_id}</div>
            </div>
          </div>
        </td>
        <td class="col-center"><span class="cmp-status cmpstat-${c._status}">${STATUS_META[c._status]?.label || c._status}</span></td>
        <td class="col-center" style="white-space:nowrap">${dates}${progBar}</td>
        <td class="col-center"><span class="dash-rep-plats">${plats || "—"}</span></td>
        <td class="col-center">${fmtNum(a.partsTotal)}<div class="dash-rep-mini">✅ ${fmtNum(a.partsApproved)}</div></td>
        <td class="col-center">${fmtNum(a.postsApproved)}<div class="dash-rep-mini">/${fmtNum(a.postsTotal)} ทั้งหมด</div></td>
        <td class="col-center"><b>${fmtNum(a.views)}</b></td>
        <td class="col-center">${fmtNum(a.likes)}</td>
        <td class="col-center">${fmtNum(a.eng)}</td>
        <td class="col-center"><button class="btn-icon dash-rep-open" title="เปิดรายละเอียด" onclick="window.openCampaign(${c.campaign_id})">📂</button></td>
      </tr>`;
    })
    .join("");
}
window.renderCampaignReport = renderCampaignReport;

window.openCampaign = function (id) {
  location.href = `./campaign-detail.html?campaign_id=${id}`;
};

// ── Export CSV (รายงานทุกแคมเปญตาม filter ปัจจุบัน) ──
function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
window.exportReportCSV = function () {
  const rows = reportRows();
  if (!rows.length) return showToast("ไม่มีข้อมูลให้ export", "warning");
  const headers = ["แคมเปญ", "สถานะ", "เริ่ม", "สิ้นสุด", "แพลตฟอร์ม", "ผู้เข้าร่วม", "อนุมัติ(คน)", "ผลงานอนุมัติ", "ผลงานทั้งหมด", "วิว", "Like", "Comment+Share", "Engagement"];
  const lines = [headers.join(",")];
  rows.forEach((c) => {
    const a = campaignAgg(c.campaign_id);
    const subs = submissions.filter((s) => s.campaign_id === c.campaign_id && s.status === "approved");
    const cs = subs.reduce((x, s) => x + (+s.comments || 0) + (+s.shares || 0), 0);
    lines.push([
      csvCell(c.name),
      (STATUS_META[c._status]?.label || c._status).replace(/^[^฀-๿a-zA-Z]+/, "").trim(),
      fmtDMY(c.start_date) || "",
      fmtDMY(c.end_date) || "",
      csvCell((c.platforms || []).join(" / ")),
      a.partsTotal, a.partsApproved, a.postsApproved, a.postsTotal,
      a.views, a.likes, cs, a.eng,
    ].join(","));
  });
  const csv = "﻿" + lines.join("\r\n"); // BOM กัน Excel เพี้ยนภาษาไทย
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const today = todayBKK();
  const a = document.createElement("a");
  a.href = url;
  a.download = `campaign-report-${today}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("ดาวน์โหลดรายงาน CSV แล้ว", "success");
};

document.addEventListener("DOMContentLoaded", initPage);
