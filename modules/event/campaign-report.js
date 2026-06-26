/* ============================================================
   campaign-report.js — รายงาน/Dashboard ของแคมเปญเดียว
   เปิดจาก campaign-planning (ปุ่ม 📊) ด้วย ?campaign_id=X
   อ่านอย่างเดียว — KPI + สถานะผู้เข้าร่วม + แพลตฟอร์ม + อันดับ + ตาราง/CSV
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
let campaignId = null;
let campaign = null;
let participants = [];
let submissions = [];

// ── AUTO STATUS ตามวันที่ (display only — ไม่เขียนกลับ DB) ──
function todayBKK() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}
function displayStatus(c) {
  if (c.status === "CANCELLED") return "CANCELLED";
  const start = (c.start_date || "").slice(0, 10);
  if (!start) return c.status;
  const end = (c.end_date || "").slice(0, 10);
  const today = todayBKK();
  if (today < start) return "DRAFT";
  if (end && today > end) return "ENDED";
  return "ACTIVE";
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

const STATUS_META = {
  ACTIVE: { label: "▶️ ดำเนินการ", color: "#057a55" },
  DRAFT: { label: "📝 ร่าง", color: "#9d958b" },
  ENDED: { label: "✅ จบแล้ว", color: "#1e40af" },
  CANCELLED: { label: "❌ ยกเลิก", color: "#b45309" },
};
const PLAT_META = {
  tiktok: { label: "TikTok", icon: "../../assets/icons/tiktok.png", color: "#111827" },
  instagram: { label: "Instagram", icon: "../../assets/icons/instagram.png", color: "#c13584" },
  facebook: { label: "Facebook", icon: "../../assets/icons/facebook.png", color: "#1877f2" },
};
const engOf = (s) => (+s.likes || 0) + (+s.comments || 0) + (+s.shares || 0);

// ── เมตริกที่ตั้งจริง (rewards.metric = array) · fallback rank_metric (string legacy) ──
const RW_METRIC_KEYS = ["views", "likes", "comments", "shares"];
const RW_METRIC_LABEL = { views: "ยอดวิว", likes: "ยอดไลค์", comments: "คอมเมนต์", shares: "แชร์", engagement: "การมีส่วนร่วม" };
function metricUnitLabel(m) {
  let arr = Array.isArray(m) ? m : m === "engagement" ? ["likes", "comments", "shares"] : RW_METRIC_KEYS.includes(m) ? [m] : [];
  arr = arr.filter((k) => RW_METRIC_KEYS.includes(k));
  return arr.length ? arr.map((k) => RW_METRIC_LABEL[k]).join(" + ") : "ยอด";
}
function _metricKeysOf(metric) {
  if (Array.isArray(metric)) return metric.filter((k) => RW_METRIC_KEYS.includes(k));
  if (metric === "engagement") return ["likes", "comments", "shares"];
  return RW_METRIC_KEYS.includes(metric) ? [metric] : ["views"];
}
function _metricScore(a, metric) {
  if (!a) return 0;
  return _metricKeysOf(metric).reduce((sum, k) => sum + (+a[k] || 0), 0);
}
function effectiveMetric() {
  const m = campaign && campaign.rewards && campaign.rewards.metric;
  if (Array.isArray(m) && m.length) return m;
  return (campaign && campaign.rank_metric) || "views";
}
// ช่องทางแจกรางวัล (key ↔ platform: ig ↔ instagram)
const RANK_CHANS = [
  { key: "facebook", platform: "facebook", label: "Facebook", ic: "../../assets/icons/facebook.png" },
  { key: "tiktok", platform: "tiktok", label: "TikTok", ic: "../../assets/icons/tiktok.png" },
  { key: "ig", platform: "instagram", label: "Instagram", ic: "../../assets/icons/instagram.png" },
];
function prizeForRank(tiers, rank, score, mode) {
  if (!Array.isArray(tiers) || !tiers.length) return "";
  if (mode === "topn") {
    const t = tiers[0];
    const within = rank <= (t.rank_to || t.rank_from || 0);
    const minOk = t.min_value == null || score >= +t.min_value;
    return within && minOk ? t.prize || "" : "";
  }
  const t = tiers.find((x) => rank >= (x.rank_from || 0) && rank <= (x.rank_to || x.rank_from || 0));
  return t ? t.prize || "" : "";
}
function channelAgg(platform) {
  const agg = {};
  participants.forEach((p) => (agg[p.participant_id] = { p, views: 0, likes: 0, comments: 0, shares: 0, posts: 0 }));
  submissions
    .filter((s) => s.platform === platform && agg[s.participant_id])
    .forEach((s) => {
      const a = agg[s.participant_id];
      a.views += +s.views || 0;
      a.likes += +s.likes || 0;
      a.comments += +s.comments || 0;
      a.shares += +s.shares || 0;
      a.posts += 1;
    });
  return agg;
}
let _rankMetricTouched = false;

// ── INIT ──────────────────────────────────────────────────
async function initPage() {
  campaignId = +new URLSearchParams(location.search).get("campaign_id");
  if (!campaignId) {
    showToast("ไม่พบ campaign_id", "error");
    return;
  }
  document.getElementById("linkDetail").href = `./campaign-detail.html?campaign_id=${campaignId}`;
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
  const [camp, parts, subs] = await Promise.all([
    sbFetch("campaigns", `?campaign_id=eq.${campaignId}&select=*&limit=1`),
    sbFetch("campaign_participants", `?campaign_id=eq.${campaignId}&select=*&order=joined_at.asc`),
    sbFetch("campaign_submissions", `?campaign_id=eq.${campaignId}&select=*`),
  ]);
  campaign = (camp || [])[0];
  if (!campaign) throw new Error("ไม่พบแคมเปญ");
  campaign._status = displayStatus(campaign);
  participants = parts || [];
  submissions = subs || [];

  document.getElementById("heroName").textContent = campaign.name || "";
  document.title = `รายงาน: ${campaign.name || ""} — A4S-ERP`;

  renderHead();
  renderKpis();
  renderStatusDonut();
  renderPlatformBars();
  document.getElementById("rankMetricSel").value = campaign.rank_metric || "views";
  renderRanking();
  renderReport();
}

// ── HEAD CARD ─────────────────────────────────────────────
function renderHead() {
  const c = campaign;
  const cover = c.cover_url
    ? `<img class="rep-head-cover" src="${esc(c.cover_url)}" alt="" style="cursor:zoom-in" onclick="window.ImgPopup&&ImgPopup.open(['${esc(c.cover_url)}'])" />`
    : `<div class="rep-head-cover rep-head-cover-ph">🚀</div>`;
  const dates = c.start_date || c.end_date
    ? `📅 ${fmtDMY(c.start_date) || "—"} – ${fmtDMY(c.end_date) || "—"}` : "📅 —";
  const plats = (c.platforms || [])
    .map((p) => PLAT_META[p]
      ? `<img src="${PLAT_META[p].icon}" alt="${PLAT_META[p].label}" title="${PLAT_META[p].label}" class="dash-plat-ic" />`
      : `<span>${esc(p)}</span>`)
    .join(" ");
  const prog = c._status === "ACTIVE" ? dateProgress(c) : null;
  const progBar = prog == null ? "" : `
    <div class="dash-rep-prog" title="ผ่านไป ${prog}% ของช่วงเวลา" style="max-width:240px">
      <div class="dash-rep-prog-track"><div class="dash-rep-prog-fill" style="width:${prog}%"></div></div>
      <span>${prog}%</span>
    </div>`;
  document.getElementById("repHead").innerHTML = `
    ${cover}
    <div class="rep-head-info">
      <div class="rep-head-name">${esc(c.name)}</div>
      <div class="rep-head-meta">
        <span class="cmp-status cmpstat-${c._status}">${STATUS_META[c._status]?.label || c._status}</span>
        <span>${dates}</span>
        ${plats ? `<span class="dash-rep-plats">${plats}</span>` : ""}
        <span>${c.reg_open ? "🟢 เปิดรับสมัคร" : "🔴 ปิดรับสมัคร"}</span>
      </div>
      ${c.description ? `<div class="rep-head-desc">${esc(c.description)}</div>` : ""}
      ${progBar}
    </div>`;
}

// ── KPI CARDS ─────────────────────────────────────────────
function renderKpis() {
  const approvedParts = participants.filter((p) => p.status === "approved").length;
  const totalViews = submissions.reduce((a, s) => a + (+s.views || 0), 0);
  const totalLikes = submissions.reduce((a, s) => a + (+s.likes || 0), 0);
  const totalEng = submissions.reduce((a, s) => a + engOf(s), 0);

  document.getElementById("kpiParticipants").textContent = fmtNum(participants.length);
  document.getElementById("kpiParticipantsSub").textContent = `อนุมัติแล้ว ${fmtNum(approvedParts)} คน`;

  document.getElementById("kpiPosts").textContent = fmtNum(submissions.length);
  const posters = new Set(submissions.map((s) => s.participant_id)).size;
  document.getElementById("kpiPostsSub").textContent = `จาก ${fmtNum(posters)} คนที่ส่งผลงาน`;

  // การ์ดที่ 3 = ยอดรวมตาม "เมตริกที่ตั้งจริง" (แทนยอดวิวที่มักเป็น 0)
  const metric = effectiveMetric();
  const metricTotal = submissions.reduce((a, s) => a + _metricScore(s, metric), 0);
  document.getElementById("kpiViews").textContent = fmtCompact(metricTotal);
  document.getElementById("kpiViews").title = fmtNum(metricTotal);
  const ml = document.getElementById("kpiMetricLabel");
  if (ml) ml.textContent = metricUnitLabel(metric) + " รวม";
  document.getElementById("kpiViewsSub").textContent = `👁 ${fmtCompact(totalViews)} วิว · ❤️ ${fmtCompact(totalLikes)} like`;

  document.getElementById("kpiEng").textContent = fmtCompact(totalEng);
  document.getElementById("kpiEng").title = fmtNum(totalEng);
  document.getElementById("kpiEngSub").textContent = "❤️ like + 💬 comment + 🔁 share";
}

// ── PARTICIPANT STATUS DONUT ──────────────────────────────
const PART_STATUS_META = {
  approved: { label: "✅ อนุมัติ", color: "#057a55" },
  pending: { label: "⏳ รอ", color: "#d97706" },
  rejected: { label: "❌ ปฏิเสธ", color: "#b45309" },
};
function renderStatusDonut() {
  const counts = {};
  Object.keys(PART_STATUS_META).forEach((k) => (counts[k] = 0));
  participants.forEach((p) => {
    const k = PART_STATUS_META[p.status] ? p.status : "pending";
    counts[k] = (counts[k] || 0) + 1;
  });
  const total = participants.length;

  const svg = document.getElementById("statusDonut");
  const legend = document.getElementById("statusLegend");
  document.getElementById("donutCenterNum").textContent = fmtNum(total);
  if (!total) {
    svg.innerHTML = `<circle cx="70" cy="70" r="54" fill="none" stroke="var(--border)" stroke-width="18"/>`;
    legend.innerHTML = `<div class="dash-empty-sm">ยังไม่มีผู้เข้าร่วม</div>`;
    return;
  }

  const r = 54, C = 2 * Math.PI * r;
  let offset = 0;
  const segs = Object.keys(PART_STATUS_META)
    .filter((k) => counts[k] > 0)
    .map((k) => {
      const frac = counts[k] / total;
      const seg = `<circle cx="70" cy="70" r="${r}" fill="none" stroke="${PART_STATUS_META[k].color}"
        stroke-width="18" stroke-dasharray="${(frac * C).toFixed(2)} ${(C - frac * C).toFixed(2)}"
        stroke-dashoffset="${(-offset * C).toFixed(2)}" transform="rotate(-90 70 70)"
        stroke-linecap="butt"><title>${PART_STATUS_META[k].label}: ${counts[k]}</title></circle>`;
      offset += frac;
      return seg;
    })
    .join("");
  svg.innerHTML =
    `<circle cx="70" cy="70" r="${r}" fill="none" stroke="var(--surface2)" stroke-width="18"/>` + segs;

  legend.innerHTML = Object.keys(PART_STATUS_META)
    .map((k) => {
      const pct = total ? Math.round((counts[k] / total) * 100) : 0;
      return `<div class="dash-legend-row">
        <span class="dash-dot" style="background:${PART_STATUS_META[k].color}"></span>
        <span class="dash-legend-lbl">${PART_STATUS_META[k].label}</span>
        <span class="dash-legend-val">${counts[k]} <span class="muted">(${pct}%)</span></span>
      </div>`;
    })
    .join("");
}

// ── PLATFORM BARS ─────────────────────────────────────────
function renderPlatformBars() {
  const metric = effectiveMetric();
  const mLabel = metricUnitLabel(metric);
  const agg = {};
  Object.keys(PLAT_META).forEach((k) => (agg[k] = { views: 0, likes: 0, comments: 0, shares: 0, eng: 0, posts: 0 }));
  submissions.forEach((s) => {
    const a = agg[s.platform];
    if (!a) return;
    a.views += +s.views || 0;
    a.likes += +s.likes || 0;
    a.comments += +s.comments || 0;
    a.shares += +s.shares || 0;
    a.eng += engOf(s);
    a.posts += 1;
  });
  const scoreOf = (a) => _metricScore(a, metric);
  const max = Math.max(1, ...Object.values(agg).map(scoreOf));
  const wrap = document.getElementById("platformBars");
  const hasAny = Object.values(agg).some((a) => a.posts > 0);
  if (!hasAny) {
    wrap.innerHTML = `<div class="dash-empty-sm">ยังไม่มีผลงาน</div>`;
    return;
  }
  wrap.innerHTML = Object.keys(PLAT_META)
    .map((k) => {
      const a = agg[k];
      const score = scoreOf(a);
      const pct = Math.max(2, Math.round((score / max) * 100));
      return `<div class="dash-bar-row">
        <div class="dash-bar-head">
          <span class="dash-bar-name"><img src="${PLAT_META[k].icon}" alt="" class="dash-plat-ic" /> ${PLAT_META[k].label}</span>
          <span class="dash-bar-val">${fmtNum(score)} <span class="muted">${esc(mLabel)} · ${a.posts} โพสต์</span></span>
        </div>
        <div class="dash-bar-track">
          <div class="dash-bar-fill" style="width:${pct}%;background:${PLAT_META[k].color}"></div>
        </div>
        <div class="dash-bar-sub">👁 ${fmtNum(a.views)} วิว · ❤️💬🔁 ${fmtNum(a.eng)} engagement</div>
      </div>`;
    })
    .join("");
}

// ── PER-PARTICIPANT AGGREGATION (นับทุกผลงานที่กรอก เหมือนหน้า detail) ──
function aggByParticipant() {
  const agg = {};
  participants.forEach((p) => {
    agg[p.participant_id] = {
      p, views: 0, likes: 0, comments: 0, shares: 0, posts: 0,
      platforms: new Set(),
    };
  });
  submissions.forEach((s) => {
    const a = agg[s.participant_id];
    if (!a) return;
    a.views += +s.views || 0;
    a.likes += +s.likes || 0;
    a.comments += +s.comments || 0;
    a.shares += +s.shares || 0;
    a.posts += 1;
    if (s.platform) a.platforms.add(s.platform);
  });
  return agg;
}

// ── LEADERBOARD (แยกช่องทาง + รางวัลตามอันดับ) ──────────────
window.onRankMetricChange = function () {
  _rankMetricTouched = true;
  renderRanking();
};
function dashLbRow(a, rank, metric, prize) {
  const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : rank;
  const top = rank <= 3 ? ` top${rank}` : "";
  const prizeCell = prize
    ? `<div class="dash-lb-prize">🎁 ${esc(prize)}</div>`
    : `<div class="dash-lb-prize dash-lb-prize-none">—</div>`;
  return `<div class="dash-lb-row${top}">
    <div class="dash-lb-rank">${medal}</div>
    <div class="dash-lb-name">
      <div class="n">${esc(a.p.member_name || a.p.member_code)}</div>
      <div class="c">${esc(a.p.member_code)} · ${a.posts} โพสต์</div>
    </div>
    <div class="dash-lb-score">${fmtCompact(_metricScore(a, metric))}<div class="lbl">${esc(metricUnitLabel(metric))}</div></div>
    ${prizeCell}
  </div>`;
}
window.renderRanking = function () {
  const el = document.getElementById("rankList");
  const metric = _rankMetricTouched ? document.getElementById("rankMetricSel").value : effectiveMetric();
  const rewards = (campaign && campaign.rewards) || null;
  const chans = rewards && rewards.channels
    ? RANK_CHANS.filter((c) => rewards.channels[c.key] && rewards.channels[c.key].enabled)
    : [];

  // ไม่มี config ช่องทาง → leaderboard เดียวรวม (ไม่มีรางวัล)
  if (!chans.length) {
    const rows = Object.values(aggByParticipant())
      .filter((a) => a.posts > 0)
      .sort((x, y) => _metricScore(y, metric) - _metricScore(x, metric))
      .slice(0, 10);
    el.innerHTML = rows.length
      ? rows.map((a, i) => dashLbRow(a, i + 1, metric, "")).join("")
      : `<div class="empty-state"><div class="empty-icon">🏆</div><div class="empty-text">ยังไม่มีผลงาน — อันดับจะแสดงเมื่อมีการกรอกยอดแล้ว</div></div>`;
    return;
  }

  const mode = rewards.mode || "ranked";
  el.innerHTML =
    `<div class="dash-lb-grid">` +
    chans
      .map((c) => {
        const rows = Object.values(channelAgg(c.platform))
          .filter((a) => a.posts > 0)
          .sort((x, y) => _metricScore(y, metric) - _metricScore(x, metric));
        const head = `<div class="dash-lb-chan-hdr"><img src="${c.ic}" alt="" /><span>${c.label}</span><span class="dash-lb-chan-n">${rows.length} คน</span></div>`;
        const body = rows.length
          ? rows.map((a, i) => dashLbRow(a, i + 1, metric, prizeForRank(rewards.channels[c.key].tiers, i + 1, _metricScore(a, metric), mode))).join("")
          : `<div class="dash-empty-sm">ยังไม่มีผลงานในช่องนี้</div>`;
        return `<div class="dash-lb-chan">${head}${body}</div>`;
      })
      .join("") +
    `</div>`;
};

// ── REPORT TABLE ──────────────────────────────────────────
const PART_PILL = { pending: "⏳ รอ", approved: "✅ อนุมัติ", rejected: "❌ ปฏิเสธ" };
function reportRows() {
  const metric = effectiveMetric();
  return Object.values(aggByParticipant()).sort((x, y) => _metricScore(y, metric) - _metricScore(x, metric));
}
function renderReport() {
  const rows = reportRows();
  const body = document.getElementById("reportBody");
  document.getElementById("reportCount").textContent = `(${rows.length} คน)`;
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">👥</div>
      <div class="empty-text">ยังไม่มีผู้เข้าร่วม</div></div></td></tr>`;
    return;
  }
  body.innerHTML = rows
    .map((a) => {
      const plats = [...a.platforms]
        .map((p) => PLAT_META[p]
          ? `<img src="${PLAT_META[p].icon}" alt="${p}" class="dash-plat-ic" />` : `<span>${esc(p)}</span>`)
        .join(" ");
      const st = a.p.status || "pending";
      return `<tr>
        <td>
          <div class="dash-rep-name">${esc(a.p.member_name || a.p.member_code)}</div>
          <div class="dash-rep-sub">${esc(a.p.member_code)}</div>
        </td>
        <td class="col-center"><span class="cmp-status cmpstat-${st === "approved" ? "ACTIVE" : st === "rejected" ? "CANCELLED" : "DRAFT"}">${PART_PILL[st] || st}</span></td>
        <td class="col-center"><span class="dash-rep-plats">${plats || "—"}</span></td>
        <td class="col-center">${fmtNum(a.posts)}</td>
        <td class="col-center"><b>${fmtNum(a.views)}</b></td>
        <td class="col-center">${fmtNum(a.likes)}</td>
        <td class="col-center">${fmtNum(a.comments)}</td>
        <td class="col-center">${fmtNum(a.shares)}</td>
        <td class="col-center">${fmtNum(a.likes + a.comments + a.shares)}</td>
      </tr>`;
    })
    .join("");
}

// ── Export CSV ────────────────────────────────────────────
function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
window.exportReportCSV = function () {
  const rows = reportRows();
  if (!rows.length) return showToast("ไม่มีข้อมูลให้ export", "warning");
  const headers = ["รหัสสมาชิก", "ชื่อ", "สถานะ", "แพลตฟอร์ม", "ผลงาน", "วิว", "Like", "Comment", "Share", "Engagement"];
  const lines = [headers.join(",")];
  rows.forEach((a) => {
    lines.push([
      csvCell(a.p.member_code),
      csvCell(a.p.member_name || ""),
      (PART_PILL[a.p.status] || a.p.status || "").replace(/^[^฀-๿a-zA-Z]+/, "").trim(),
      csvCell([...a.platforms].join(" / ")),
      a.posts, a.views, a.likes, a.comments, a.shares, a.likes + a.comments + a.shares,
    ].join(","));
  });
  const csv = "﻿" + lines.join("\r\n"); // BOM กัน Excel เพี้ยนภาษาไทย
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `campaign-${campaignId}-report-${todayBKK()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("ดาวน์โหลดรายงาน CSV แล้ว", "success");
};

document.addEventListener("DOMContentLoaded", initPage);
