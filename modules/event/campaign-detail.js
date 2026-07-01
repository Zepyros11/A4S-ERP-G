/* ============================================================
   campaign-detail.js — Campaign Review detail (5 tabs)
============================================================ */

// ── Supabase helpers ──────────────────────────────────────
function getSB() {
  return { url: localStorage.getItem("sb_url") || "", key: localStorage.getItem("sb_key") || "" };
}
async function sbFetch(table, query = "", opts = {}) {
  const { url, key } = getSB();
  const { method = "GET", body } = opts;
  const res = await fetch(`${url}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: method === "POST" || method === "PATCH" ? "return=representation" : "",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || `Error ${res.status}`);
  }
  return method === "DELETE" ? null : res.json().catch(() => null);
}

const BUCKET = "event-files";
const fmtDMY = (d) => (window.DateFmt ? window.DateFmt.formatDMY(d) : (d || "").slice(0, 10));

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
/* อนุญาตเฉพาะ http/https — กัน javascript:/data: URL ที่ลูกค้า (public) ฝังมา
   แล้ว staff คลิกในหน้า back-office (รัน JS ในorigin ที่ login → ขโมย session ได้) */
function safeHref(u) {
  try {
    const p = new URL(String(u ?? ""), location.origin).protocol;
    return p === "http:" || p === "https:" ? String(u) : "#";
  } catch {
    return "#";
  }
}
/* ลิงก์จริงหรือไม่ — ต้องเป็น absolute http(s) URL เท่านั้น
   (ไม่นับข้อความ/caption ที่กรอกผิดช่อง เพราะ new URL(text,base) จะ pass เป็น relative) */
function isRealLink(u) {
  if (!u) return false;
  try {
    const p = new URL(String(u)).protocol;
    return p === "http:" || p === "https:";
  } catch {
    return false;
  }
}
const PLAT_LABEL = { tiktok: "🎵 TikTok", instagram: "📸 IG", facebook: "👍 FB" };
const fmtNum = (n) => (Number(n) || 0).toLocaleString("en-US");

// ── LINE OA chat (เปิดแชท 1:1 ในฝั่งแอดมิน) ──
// ACCOUNT_ID = ส่วนใน URL ตอนเปิด OA Manager chat: https://chat.line.biz/<ACCOUNT_ID>
// ค่านี้ = account id ของ OA "A4S_Lyra" (จาก URL chat.line.biz)
const LINE_OA_CHAT_ID = "U1145fdb4cd26606afe4fe12575d211cc";

// ⚠️ ทำไมไม่ deep-link ตรงคน:
//   chat.line.biz ใช้ user id "คนละชุด" กับ line_user_id (Messaging API) ที่ webhook เก็บ
//   เทียบจริงแล้ว 3 คน (Direk / A4S_Support_5 / ยุพิน) ไม่ตรงเลย และ LINE ไม่มี API แปลงข้ามกัน
//   → เปิด "หน้าแชทรวม" ของ OA แล้วก๊อปชื่อให้ staff วางค้นหาแทน (ไม่ 404)
function lineInboxUrl() {
  return LINE_OA_CHAT_ID ? `https://chat.line.biz/${LINE_OA_CHAT_ID}` : "https://chat.line.biz/";
}
// ลิงก์ตรงคน — ใช้ได้เฉพาะเมื่อมี line_chat_id (id จาก URL chat.line.biz, กรอกมือ)
function lineChatDirectUrl(chatId) {
  return `https://chat.line.biz/${LINE_OA_CHAT_ID}/chat/${encodeURIComponent(chatId)}`;
}
window.openLineChat = async function (name) {
  try {
    if (name) await navigator.clipboard.writeText(name);
    showToast(`ก๊อปชื่อ "${name}" แล้ว — วาง (Ctrl+V) ในช่องค้นหาแชท`, "success");
  } catch (e) {
    showToast("เปิดหน้าแชทแล้ว — ค้นชื่อ: " + (name || ""), "info");
  }
  window.open(lineInboxUrl(), "_blank", "noopener");
};

// ── STATE ─────────────────────────────────────────────────
let campaignId = null;
let campaign = null;
let missions = [];
let participants = [];
let submissions = [];
let lineByCode = {}; // member_code -> { line_display_name, line_user_id }
let _proofFile = null;

// ── INIT ──────────────────────────────────────────────────
async function initPage() {
  campaignId = +new URLSearchParams(location.search).get("campaign_id");
  if (!campaignId) {
    showToast("ไม่พบ campaign_id", "error");
    return;
  }
  showLoading(true);
  try {
    await loadAll();
  } catch (e) {
    showToast("โหลดข้อมูลไม่สำเร็จ: " + e.message, "error");
  } finally {
    showLoading(false);
  }
}

async function loadAll() {
  const [camp, parts, subs] = await Promise.all([
    sbFetch("campaigns", `?campaign_id=eq.${campaignId}&select=*&limit=1`),
    sbFetch("campaign_participants", `?campaign_id=eq.${campaignId}&select=*&order=joined_at.asc`),
    sbFetch("campaign_submissions", `?campaign_id=eq.${campaignId}&select=*&order=submitted_at.desc`),
  ]);
  campaign = (camp || [])[0];
  if (!campaign) throw new Error("ไม่พบแคมเปญ");
  participants = parts || [];
  submissions = subs || [];

  // ── เช็ค LINE จาก member_code (ตาราง members เหมือนหน้า line-members) ──
  lineByCode = {};
  const codes = [...new Set(participants.map((p) => p.member_code).filter(Boolean))];
  if (codes.length) {
    const inList = codes.map((c) => `"${String(c).replace(/"/g, "")}"`).join(",");
    const mem = await sbFetch(
      "members",
      `?member_code=in.(${inList})&select=member_code,line_display_name,line_user_id,line_chat_id,phone`,
    ).catch(() => []);
    (mem || []).forEach((m) => (lineByCode[m.member_code] = m));
  }

  renderHeader();
  renderKpis();
  renderOverview();
  renderBrief();
  renderParticipants();
  document.getElementById("rankMetricSel").value = campaign.rank_metric || "views";
  renderRanking();
  refreshCounts();
}

function refreshCounts() {
  document.getElementById("nParticipants").textContent = participants.length;
}

// ── TABS ──────────────────────────────────────────────────
window.switchTab = function (tab) {
  document.querySelectorAll(".cmp-tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  document.querySelectorAll(".cmp-pane").forEach((p) => p.classList.toggle("active", p.id === `pane-${tab}`));
};

// ── HEADER + OVERVIEW ─────────────────────────────────────
const STATUS_LABEL = { DRAFT: "📝 ร่าง", CONFIRMED: "✔️ ยืนยัน", ACTIVE: "▶️ ดำเนินการ", ENDED: "✅ จบแล้ว", CANCELLED: "❌ ยกเลิก" };
function renderHeader() {
  document.getElementById("dName").textContent = campaign.name;
  const cover = document.getElementById("dCover");
  if (campaign.cover_url) {
    cover.innerHTML = `<img src="${esc(campaign.cover_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:12px;cursor:zoom-in" onclick="ImgPopup.open(['${esc(campaign.cover_url)}'])" />`;
  } else cover.textContent = "🚀";
  const dates = campaign.start_date || campaign.end_date ? `📅 ${fmtDMY(campaign.start_date) || "—"} – ${fmtDMY(campaign.end_date) || "—"}` : "";
  const plats = (campaign.platforms || []).map((p) => PLAT_LABEL[p] || p).join(" · ");
  document.getElementById("dSub").innerHTML = `
    <span class="cmp-status cmpstat-${campaign.status}">${STATUS_LABEL[campaign.status] || campaign.status}</span>
    ${dates ? `<span>${dates}</span>` : ""}
    ${plats ? `<span>${plats}</span>` : ""}
    <span>${campaign.reg_open ? "🟢 เปิดรับสมัคร" : "🔴 ปิดรับสมัคร"}</span>`;
}
// ── การ์ดสรุปสำหรับผู้บริหาร (ระหว่าง hero กับ tabs) ──
function renderKpis() {
  const wrap = document.getElementById("cmpKpis");
  if (!wrap) return;
  const approved = participants.filter((p) => p.status === "approved").length;
  const cards = [
    { ic: "👥", v: fmtNum(participants.length), l: "ผู้เข้าร่วม", sub: `อนุมัติ ${fmtNum(approved)} คน`, type: "participants" },
  ];
  const dl = daysLeftInfo();
  if (dl) cards.push(dl);

  wrap.innerHTML = cards
    .map((c) => {
      const clickable = !!c.type;
      const valCls = c.big ? " cmp-kpi-big" : "";
      const valStyle = c.small ? ' style="font-size:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"' : c.color ? ` style="color:${c.color}"` : "";
      return `<div class="stat-card${clickable ? " cmp-kpi-card" : ""}"${clickable ? ` title="คลิกดูรายงานตาราง" onclick="window.openCardReport('${c.type}')"` : ""}>
      <div class="stat-icon">${c.ic}</div>
      <div style="min-width:0">
        <div class="stat-value${valCls}"${valStyle}>${c.v}</div>
        <div class="stat-label">${c.l}</div>
        <div class="cmp-kpi-sub">${c.sub}</div>
      </div>
    </div>`;
    })
    .join("");
}
// ตัวนับวันที่เหลือ (อ้างเวลาไทย Asia/Bangkok)
function daysLeftInfo() {
  const start = (campaign.start_date || "").slice(0, 10);
  const end = (campaign.end_date || "").slice(0, 10);
  if (!end) return null;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const diff = (d1, d2) => Math.round((new Date(d1).getTime() - new Date(d2).getTime()) / 86400000);
  if (campaign.status === "CANCELLED") return { ic: "❌", v: "ยกเลิก", l: "สถานะ", sub: `สิ้นสุด ${fmtDMY(end)}`, small: true };
  if (start && today < start) return { ic: "🚀", v: diff(start, today), l: "วันก่อนเริ่ม", sub: `เริ่ม ${fmtDMY(start)}`, color: "var(--info)" };
  if (today > end) return { ic: "🏁", v: "จบแล้ว", l: "วันที่เหลือ", sub: `สิ้นสุด ${fmtDMY(end)}`, small: true };
  const left = diff(end, today);
  return { ic: "⏳", v: left, l: "วันที่เหลือ", sub: `ถึง ${fmtDMY(end)}`, big: true };
}

// ── Popup รายงานตาราง (คลิกการ์ดสรุป) ──
window.openCardReport = function (type) {
  const titleEl = document.getElementById("cardReportTitle");
  const bodyEl = document.getElementById("cardReportBody");
  if (type === "posts") {
    titleEl.textContent = "📊 รายงานผลงาน (รายโพสต์)";
    bodyEl.innerHTML = buildPostReport();
  } else {
    titleEl.textContent = "👥 รายงานผู้เข้าร่วม";
    bodyEl.innerHTML = buildParticipantReport();
  }
  document.getElementById("cardReportModal").classList.add("open");
};
window.closeCardReport = function () {
  document.getElementById("cardReportModal").classList.remove("open");
};
function buildParticipantReport() {
  const metric = effectiveMetric();
  const mLabel = metricUnitLabel(metric);
  const rows = Object.values(channelAggAll()).sort((x, y) => _metricScore(y, metric) - _metricScore(x, metric));
  if (!rows.length) return `<div class="empty-state"><div class="empty-icon">👥</div><div class="empty-text">ยังไม่มีผู้เข้าร่วม</div></div>`;
  const body = rows
    .map((a, i) => `<tr>
      <td class="col-center">${i + 1}</td>
      <td><div style="font-weight:600">${esc(a.p.member_name || a.p.member_code)}</div>
        <div style="font-size:11px;color:var(--text3);font-family:'IBM Plex Mono',monospace">${esc(a.p.member_code)}</div></td>
      <td class="col-center">${statusPillPart(a.p)}</td>
      <td class="col-center">${fmtNum(a.posts)}</td>
      <td class="col-center">${fmtNum(a.views)}</td>
      <td class="col-center">${fmtNum(a.likes)}</td>
      <td class="col-center">${fmtNum(a.comments)}</td>
      <td class="col-center">${fmtNum(a.shares)}</td>
      <td class="col-center" style="font-weight:700;color:var(--accent)">${fmtNum(_metricScore(a, metric))}</td>
    </tr>`)
    .join("");
  return `<table class="data-table">
    <thead><tr>
      <th class="col-center">#</th><th>สมาชิก</th><th class="col-center">สถานะ</th>
      <th class="col-center">ผลงาน</th><th class="col-center">👁 วิว</th><th class="col-center">❤️ Like</th>
      <th class="col-center">💬 Cmt</th><th class="col-center">🔁 Share</th><th class="col-center">${esc(mLabel)}</th>
    </tr></thead><tbody>${body}</tbody></table>`;
}
function buildPostReport() {
  const byPid = {};
  participants.forEach((p) => (byPid[p.participant_id] = p));
  const rows = submissions.slice().sort((a, b) => (+b.likes || 0) - (+a.likes || 0));
  if (!rows.length) return `<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-text">ยังไม่มีผลงาน</div></div>`;
  const body = rows
    .map((s) => {
      const p = byPid[s.participant_id];
      const link = isRealLink(s.post_url)
        ? `<a href="${esc(safeHref(s.post_url))}" target="_blank" rel="noopener" onclick="window.openSocialWindow('${esc(safeHref(s.post_url))}');return false">🔗 เปิด</a>`
        : `<span style="color:var(--text3)">—</span>`;
      return `<tr>
        <td><div style="font-weight:600">${esc(p ? p.member_name || p.member_code : "#" + s.participant_id)}</div>
          <div style="font-size:11px;color:var(--text3);font-family:'IBM Plex Mono',monospace">${esc(p ? p.member_code : "")}</div></td>
        <td class="col-center">${esc(PLAT_LABEL[s.platform] || s.platform || "—")}</td>
        <td class="col-center">${link}</td>
        <td class="col-center">${fmtNum(s.views)}</td>
        <td class="col-center">${fmtNum(s.likes)}</td>
        <td class="col-center">${fmtNum(s.comments)}</td>
        <td class="col-center">${fmtNum(s.shares)}</td>
      </tr>`;
    })
    .join("");
  return `<table class="data-table">
    <thead><tr>
      <th>สมาชิก</th><th class="col-center">ช่องทาง</th><th class="col-center">โพสต์</th>
      <th class="col-center">👁 วิว</th><th class="col-center">❤️ Like</th><th class="col-center">💬 Cmt</th><th class="col-center">🔁 Share</th>
    </tr></thead><tbody>${body}</tbody></table>`;
}

const RW_SOC = [
  { k: "facebook", ic: "../../assets/icons/facebook.png", label: "Facebook" },
  { k: "tiktok",   ic: "../../assets/icons/tiktok.png",   label: "TikTok" },
  { k: "ig",       ic: "../../assets/icons/instagram.png", label: "Instagram" },
];
const RW_RANK = ["🥇 รางวัลที่ 1", "🥈 รางวัลที่ 2", "🥉 รางวัลที่ 3"];
const RW_METRIC_LABEL = { views: "ยอดวิว", likes: "ยอดไลค์", comments: "คอมเมนต์", shares: "แชร์", engagement: "การมีส่วนร่วม" };
const RW_METRIC_KEYS = ["views", "likes", "comments", "shares"];
function metricUnitLabel(m) {
  let arr = Array.isArray(m) ? m : (m === "engagement" ? ["likes", "comments", "shares"] : (RW_METRIC_KEYS.includes(m) ? [m] : []));
  arr = arr.filter((k) => RW_METRIC_KEYS.includes(k));
  return arr.length ? arr.map((k) => RW_METRIC_LABEL[k]).join(" + ") : "ยอด";
}

// ── ยอดตัววัด — รวม submissions ต่อคน + คิดคะแนนตาม rank_metric (ใช้ทั้งคอลัมน์ผู้เข้าร่วม + ranking) ──
function _metricKeysOf(metric) {
  if (Array.isArray(metric)) return metric.filter((k) => RW_METRIC_KEYS.includes(k));
  if (metric === "engagement") return ["likes", "comments", "shares"];
  return RW_METRIC_KEYS.includes(metric) ? [metric] : ["views"];
}
function _subAgg() {
  const agg = {};
  participants.forEach((p) => (agg[p.participant_id] = { views: 0, likes: 0, comments: 0, shares: 0, posts: 0 }));
  submissions
    .filter((s) => agg[s.participant_id])
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
function _metricScore(a, metric) {
  if (!a) return 0;
  return _metricKeysOf(metric).reduce((sum, k) => sum + (a[k] || 0), 0);
}
// เมตริกจริงที่เลือก = rewards.metric (array, แม่นยำ) · fallback rank_metric (string legacy ที่ถูกบีบเป็น views/likes/engagement)
function effectiveMetric() {
  const m = campaign && campaign.rewards && campaign.rewards.metric;
  if (Array.isArray(m) && m.length) return m;
  return (campaign && campaign.rank_metric) || "views";
}
const METRIC_ICON = { views: "👁", likes: "❤️", comments: "💬", shares: "🔁" };
// แสดงยอดแยกแต่ละเมตริก (ไม่รวม) เช่น ❤️ 18 · 💬 5 · คลิกที่ตัวเลข = แก้ inline
// ctx: {sub} = แก้โพสต์เดิม · {pid,plat} = ยังไม่มีโพสต์ → พิมพ์แล้วสร้างใหม่ · null = อ่านอย่างเดียว
function metricBreakdown(a, metric, ctx) {
  const agg = a || {};
  const parts = _metricKeysOf(metric)
    .map((k) => {
      const val = fmtNum(agg[k] || 0);
      let num;
      if (ctx && ctx.sub != null) {
        num = `<b class="cmp-metric-val" data-sub="${ctx.sub}" data-key="${k}" data-raw="${agg[k] || 0}" title="คลิกเพื่อแก้ยอด" onclick="event.stopPropagation();window.editMetricInline(this)">${val}</b>`;
      } else if (ctx && ctx.pid != null && ctx.plat) {
        num = `<b class="cmp-metric-val" data-pid="${ctx.pid}" data-plat="${ctx.plat}" data-key="${k}" data-raw="${agg[k] || 0}" title="คลิกเพื่อกรอกยอด" onclick="event.stopPropagation();window.editMetricInline(this)">${val}</b>`;
      } else {
        num = `<b style="color:var(--accent)">${val}</b>`;
      }
      return `<span style="white-space:nowrap">${METRIC_ICON[k]} ${num}</span>`;
    })
    .join(`<span style="color:var(--text3);margin:0 4px">·</span>`);
  return `<span style="display:inline-flex;align-items:center;font-size:13px;color:var(--text2)">${parts}</span>`;
}
const PLAT_URL_FIELD = { facebook: "facebook_url", tiktok: "tiktok_url", instagram: "ig_url" };
// ช่องทางที่ผู้เข้าร่วมมีลิงก์ (เรียงเดียวกับคอลัมน์โซเชียล) → ใช้ให้ 2 คอลัมน์ตรงแถวกัน
function activePlatforms(p) {
  return ["facebook", "tiktok", "instagram"].filter((pl) => isRealLink(p[PLAT_URL_FIELD[pl]]));
}
// ช่องยอด — 1 บรรทัด/โพสต์ · คลิกตัวเลข = แก้ inline (ไม่เปิด popup) · ช่องที่ยังไม่มีโพสต์ = พิมพ์แล้วสร้างใหม่
function metricCell(p, metric) {
  const plats = activePlatforms(p);
  if (!plats.length) return `<span style="color:var(--text3)">—</span>`;
  const rows = [];
  plats.forEach((pl) => {
    const subs = submissions.filter((s) => s.participant_id === p.participant_id && (s.platform || "?") === pl);
    if (!subs.length) {
      // ยังไม่มีโพสต์ในช่องนี้ → คลิกตัวเลขกรอก inline แล้วสร้างเรคคอร์ดใหม่ทันที
      rows.push(
        `<span class="cmp-metric-row">${metricBreakdown(null, metric, { pid: p.participant_id, plat: pl })}</span>`,
      );
    } else {
      // 1 โพสต์ = 1 บรรทัด · คลิกตัวเลขแก้ inline ตรงโพสต์
      subs.forEach((s) => {
        rows.push(
          `<span class="cmp-metric-row">${metricBreakdown(s, metric, { sub: s.submission_id })}</span>`,
        );
      });
    }
  });
  return `<span class="cmp-metric-list">${rows.join("")}</span>`;
}

// คลิกตัวเลขยอด → กลายเป็น input box แก้ inline (ไม่เปิด popup)
// มี data-sub → แก้โพสต์เดิม · มี data-pid+data-plat → ยังไม่มีโพสต์ → พิมพ์แล้วสร้างใหม่
window.editMetricInline = function (el) {
  if (el.dataset.editing) return;
  const key = el.dataset.key;
  const raw = parseInt(el.dataset.raw) || 0;
  const subId = el.dataset.sub ? +el.dataset.sub : null;
  const pid = el.dataset.pid ? +el.dataset.pid : null;
  const plat = el.dataset.plat || null;
  const sub = subId ? submissions.find((x) => x.submission_id === subId) : null;
  if (subId && !sub) {
    showToast("ไม่พบโพสต์นี้ — รีเฟรชหน้า", "warning");
    return;
  }
  const orig = el.innerHTML;
  el.dataset.editing = "1";
  el.textContent = "";
  const inp = document.createElement("input");
  inp.type = "number";
  inp.min = "0";
  inp.value = raw;
  inp.className = "cmp-metric-input";
  el.appendChild(inp);
  inp.focus();
  inp.select();

  let done = false;
  const cleanup = () => { delete el.dataset.editing; };
  const cancel = () => { if (done) return; done = true; el.innerHTML = orig; cleanup(); };
  const commit = async () => {
    if (done) return;
    done = true;
    const nv = Math.max(0, parseInt(inp.value) || 0);
    cleanup();
    if (nv === raw) { el.innerHTML = orig; return; }
    el.textContent = fmtNum(nv);
    try {
      // กันสร้างซ้ำ: ถ้าโหมดสร้างแต่ระหว่างนั้นมีโพสต์ช่องนี้แล้ว → แก้ของเดิมแทน
      const target = sub || submissions.find((x) => x.participant_id === pid && (x.platform || "?") === plat);
      if (target) {
        await sbFetch("campaign_submissions", `?submission_id=eq.${target.submission_id}`, { method: "PATCH", body: { [key]: nv } });
        target[key] = nv;
      } else {
        // ยังไม่มีเรคคอร์ด → สร้างใหม่ ใช้ลิงก์ช่องทางของคนนั้นเป็น post_url
        const pp = participants.find((x) => x.participant_id === pid);
        const post_url = ({ facebook: pp?.facebook_url, tiktok: pp?.tiktok_url, instagram: pp?.ig_url }[plat] || "").trim();
        await sbFetch("campaign_submissions", "", {
          method: "POST",
          body: {
            campaign_id: campaignId,
            participant_id: pid,
            platform: plat,
            post_url,
            views: 0, likes: 0, comments: 0, shares: 0,
            [key]: nv,
            status: "approved",
            verified_at: new Date().toISOString(),
            verified_by: localStorage.getItem("user_name") || localStorage.getItem("username") || null,
          },
        });
      }
      showToast("บันทึกแล้ว", "success");
      await loadAll();
      switchTab("participants");
    } catch (e) {
      showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
      el.innerHTML = orig;
    }
  };
  inp.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); commit(); }
    else if (ev.key === "Escape") { ev.preventDefault(); cancel(); }
  });
  inp.addEventListener("blur", commit);
};

function renderOverview() {
  document.getElementById("dDesc").textContent = campaign.description || "—";

  // ── ของรางวัล (per-channel · fallback flat tiers / format เดิม / reward เดิม) ──
  const rewardBox = document.getElementById("dRewardBox");
  const rewards = (campaign.rewards && typeof campaign.rewards === "object") ? campaign.rewards : {};
  const unit = metricUnitLabel(rewards.metric);
  const isTopN = (rewards.mode || "ranked") === "topn";
  const tierRows = (tiers) => tiers
    .map((t) => {
      const rf = +t.rank_from || 1;
      const rt = Math.max(rf, +t.rank_to || rf);
      const rank = isTopN ? `${rt} อันดับ` : (rf === rt ? `อันดับ ${rf}` : `อันดับ ${rf}–${rt}`);
      const cond = (t.min_value != null && t.min_value !== "")
        ? `<div class="cmp-rw-cond">เงื่อนไข: ${unit} อย่างน้อย ${esc(t.min_value)}</div>` : "";
      const img = t.prize_img
        ? `<img class="cmp-rw-img" src="${esc(t.prize_img)}" alt="" onclick="ImgPopup.open(['${esc(t.prize_img)}'])" />` : "";
      const txt = (t.prize || "").trim() ? `<div class="cmp-rw-tier-prize">${esc(t.prize)}</div>` : "";
      return `<div class="cmp-rw-tier"><div class="cmp-rw-tier-rank">🏆 ${rank}</div>${txt}${img}${cond}</div>`;
    })
    .join("");

  let rwHtml = "";
  if (rewards.combine_channels && rewards.channels && rewards.channels.all) {
    // รวมยอดทุกช่องทาง → รางวัลชุดเดียว
    const tiers = (Array.isArray(rewards.channels.all.tiers) ? rewards.channels.all.tiers : [])
      .filter((t) => t && ((t.prize || "").trim() || t.prize_img));
    if (tiers.length)
      rwHtml = `<div class="cmp-rw-group"><div class="cmp-rw-head">🔗 รวมทุกช่องทาง</div>${tierRows(tiers)}</div>`;
  } else if (rewards.channels && typeof rewards.channels === "object") {
    rwHtml = RW_SOC.map((s) => {
      const ch = rewards.channels[s.k];
      if (!ch || !ch.enabled) return "";
      const tiers = (Array.isArray(ch.tiers) ? ch.tiers : []).filter((t) => t && ((t.prize || "").trim() || t.prize_img));
      if (!tiers.length) return "";
      return `<div class="cmp-rw-group"><div class="cmp-rw-head"><img class="soc-ic" src="${s.ic}" alt="" /> ${s.label}</div>${tierRows(tiers)}</div>`;
    }).join("");
  } else if (Array.isArray(rewards.tiers)) {
    const tiers = rewards.tiers.filter((t) => t && ((t.prize || "").trim() || t.prize_img));
    if (tiers.length) rwHtml = `<div class="cmp-rw-group">${tierRows(tiers)}</div>`;
  }

  if (rwHtml) {
    rewardBox.style.display = "";
    document.getElementById("dReward").innerHTML = `<div class="cmp-rw-meta">วัดจาก${unit}</div>${rwHtml}`;
  } else {
    // fallback: format เดิม {facebook:[...]} หรือ reward (text) เดิม
    const rwBlocks = RW_SOC.map((s) => {
      const arr = Array.isArray(rewards[s.k]) ? rewards[s.k] : [];
      const rows = arr
        .map((v, i) => (v || "").trim()
          ? `<div class="cmp-rw-row"><span>${RW_RANK[i] || `รางวัลที่ ${i + 1}`}</span><b>${esc(v)}</b></div>` : "")
        .join("");
      return rows ? `<div class="cmp-rw-chan"><div class="cmp-rw-head"><img class="soc-ic" src="${s.ic}" alt="" /> ${s.label}</div>${rows}</div>` : "";
    }).join("");
    if (rwBlocks) {
      rewardBox.style.display = "";
      document.getElementById("dReward").innerHTML = `<div class="cmp-rw-cols">${rwBlocks}</div>`;
    } else if (campaign.reward) {
      rewardBox.style.display = "";
      document.getElementById("dReward").textContent = campaign.reward;
    } else rewardBox.style.display = "none";
  }

  // ── เงื่อนไขการเข้าร่วม ──
  const termsBox = document.getElementById("dTermsBox");
  const terms = (campaign.terms || "").split("\n").map((t) => t.replace(/^[\s•\-*]+/, "").trim()).filter(Boolean);
  if (terms.length) {
    termsBox.style.display = "";
    document.getElementById("dTerms").innerHTML = terms.map((t) => `<li>${esc(t)}</li>`).join("");
  } else termsBox.style.display = "none";

  const media = campaign.media || [];
  const g = document.getElementById("dGallery");
  document.getElementById("dGalleryEmpty").style.display = media.length ? "none" : "";
  g.innerHTML = media
    .map((m) => {
      if (m.type === "video")
        return `<div class="cmp-gallery-item"><video src="${esc(m.url)}" controls></video><span class="vtag">▶ วิดีโอ</span></div>`;
      return `<div class="cmp-gallery-item" onclick="ImgPopup.open(['${esc(m.url)}'])"><img src="${esc(m.url)}" alt="" /></div>`;
    })
    .join("");
}

// ── BRIEF (ภาพ/ข้อความบรีฟงาน · จาก requirements_images/text) ──
function renderBrief() {
  const imgs = Array.isArray(campaign.requirements_images)
    ? campaign.requirements_images.filter((m) => m && m.url) : [];
  const g = document.getElementById("dBriefGallery");
  document.getElementById("dBriefGalleryEmpty").style.display = imgs.length ? "none" : "";
  const arr = `[${imgs.map((m) => `'${esc(m.url)}'`).join(",")}]`;
  g.innerHTML = imgs
    .map((m, i) => `<div class="cmp-gallery-item" onclick="ImgPopup.open(${arr}, ${i})"><img src="${esc(m.url)}" alt="" /></div>`)
    .join("");
  document.getElementById("dBriefText").textContent = campaign.requirements_text || "—";
}

const PUBLIC_BASE = "https://zepyros11.github.io/A4S-ERP-G";
function buildRegUrl(token) {
  const host = location.hostname;
  let base;
  if (host.includes("github.io")) base = `${location.origin}/${location.pathname.split("/")[1]}`;
  else if (host === "127.0.0.1" || host === "localhost") base = PUBLIC_BASE;
  else base = location.origin;
  return `${base}/modules/event/campaign-register.html?t=${token}`;
}
window.copyRegLink = async function () {
  if (!campaign?.public_token) return showToast("แคมเปญนี้ยังไม่มีลิงก์", "warning");
  const url = buildRegUrl(campaign.public_token);
  try {
    await navigator.clipboard.writeText(url);
    showToast("คัดลอกลิงก์ลงทะเบียนแล้ว 🔗", "success");
  } catch {
    window.prompt("คัดลอกลิงก์นี้:", url);
  }
};
// ── SHARE LINK MODAL (QR + Link) ──
window.openRegShareModal = function () {
  if (!campaign?.public_token) return showToast("แคมเปญนี้ยังไม่มีลิงก์ — บันทึกแคมเปญก่อน", "warning");
  const url = buildRegUrl(campaign.public_token);
  document.getElementById("regShareName").textContent = campaign.name || "";
  document.getElementById("regShareUrlInput").value = url;
  const wrap = document.getElementById("regShareQrWrap");
  wrap.innerHTML = "";
  if (window.QRCode) {
    new QRCode(wrap, { text: url, width: 190, height: 190, correctLevel: QRCode.CorrectLevel.M });
  } else {
    wrap.textContent = "QR library ยังไม่โหลด — รีเฟรชหน้า";
  }
  document.getElementById("regShareModal").classList.add("open");
};
window.closeRegShareModal = function () {
  document.getElementById("regShareModal").classList.remove("open");
};
window.openRegUrl = function () {
  if (!campaign?.public_token) return;
  window.open(buildRegUrl(campaign.public_token), "_blank", "noopener");
};
window.editCampaign = function () {
  location.href = `./campaign-form.html?edit=${campaignId}`;
};

// ════════════════════════════════════════════════════════
//  PARTICIPANTS
// ════════════════════════════════════════════════════════
function postCountFor(pid) {
  return submissions.filter((s) => s.participant_id === pid).length;
}
window.renderParticipants = function () {
  const search = (document.getElementById("partSearch").value || "").trim().toLowerCase();
  const body = document.getElementById("partBody");
  let rows = participants.filter(
    (p) =>
      !search ||
      (p.member_code || "").toLowerCase().includes(search) ||
      (p.member_name || "").toLowerCase().includes(search),
  );
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">👥</div><div class="empty-text">ยังไม่มีผู้เข้าร่วม</div></div></td></tr>`;
    updatePartBulk();
    return;
  }
  // ยอดตัววัด (เมตริกที่จัดอันดับ) ต่อคน + ตั้งหัวคอลัมน์ตามเมตริก
  const metric = effectiveMetric();
  const thM = document.getElementById("thPartMetric");
  if (thM) thM.textContent = _metricKeysOf(metric).map((k) => RW_METRIC_LABEL[k]).join(" · ");
  body.innerHTML = rows
    .map((p) => {
      // แสดงเฉพาะช่องทางที่มีลิงก์จริง (ไม่มีลิงก์ → ไม่แสดง)
      const soc = (ic, url, platform) => {
        if (!isRealLink(url)) return "";
        const link = `<a href="${esc(safeHref(url))}" title="${esc(url)}" onclick="event.stopPropagation();window.openSocialWindow('${esc(safeHref(url))}');return false"><img class="soc-ic" src="${ic}" alt="" /></a>`;
        const rec = `<button class="btn-icon cmp-soc-rec" data-perm="campaign_metric_edit" title="กรอกยอด ${esc(PLAT_LABEL[platform] || platform)}" onclick="event.stopPropagation();window.openSubModal(null,{participant_id:${p.participant_id},platform:'${platform}'})">📊</button>`;
        return `<span class="cmp-soc-cell">${link}${rec}</span>`;
      };
      const socInner =
        soc("../../assets/icons/facebook.png", p.facebook_url, "facebook") +
        soc("../../assets/icons/tiktok.png", p.tiktok_url, "tiktok") +
        soc("../../assets/icons/instagram.png", p.ig_url, "instagram");
      const socials = socInner
        ? `<span class="cmp-social-links">${socInner}</span>`
        : `<span style="color:var(--text3)">—</span>`;
      // รูปหลักฐาน — แยกเป็นคอลัมน์ใหม่ (กดดูเต็มจอ + เลื่อนระหว่างรูปได้)
      const imgs = [p.facebook_img, p.tiktok_img, p.ig_img].filter(Boolean);
      const imgArr = `[${imgs.map((im) => `'${esc(im)}'`).join(",")}]`;
      const imgCell = imgs.length
        ? `<span class="cmp-img-cell">${imgs
            .map((im, i) => `<img class="cmp-soc-thumb" src="${esc(im)}" alt="" title="ดูรูป" onclick="event.stopPropagation();ImgPopup.open(${imgArr}, ${i})" />`)
            .join("")}</span>`
        : `<span style="color:var(--text3)">—</span>`;
      // Line ID — เช็คจาก member_code (ตาราง members) · มี LINE → ลิงก์เปิดแชท LINE OA, ไม่มี → —
      const lm = lineByCode[p.member_code];
      // คลิก → มี chat id (กรอกมือ) เปิดตรงคน · ไม่มี → เปิด inbox OA + ก๊อปชื่อให้ค้นหา
      let lineCell;
      if (lm && lm.line_chat_id) {
        lineCell = `<a href="${esc(lineChatDirectUrl(lm.line_chat_id))}" target="_blank" rel="noopener" class="cmp-line-name" title="เปิดแชท 1:1 ตรงคน" onclick="event.stopPropagation()">${esc(lm.line_display_name || "เปิดแชท")}</a>`;
      } else if (lm && lm.line_display_name) {
        lineCell = `<a href="${esc(lineInboxUrl())}" target="_blank" rel="noopener" class="cmp-line-name" title="เปิดแชท A4S_Lyra + ก๊อปชื่อไปวางค้นหา" data-name="${esc(lm.line_display_name)}" onclick="event.stopPropagation(); event.preventDefault(); openLineChat(this.dataset.name)">${esc(lm.line_display_name)}</a>`;
      } else {
        lineCell = `<span style="color:var(--text3)">—</span>`;
      }
      return `<tr>
        <td class="col-center part-cell-chk"><input type="checkbox" class="part-check" value="${p.participant_id}" onclick="window.updatePartBulk()" /></td>
        <td class="part-cell-name"><div style="font-weight:600">${esc(p.member_name || "—")}</div>
            <div style="font-size:11px;color:var(--text3);font-family:'IBM Plex Mono',monospace">${esc(p.member_code)}</div></td>
        <td class="col-center" data-label="รูป">${imgCell}</td>
        <td class="col-center" data-label="โซเชียล">${socials}</td>
        <td class="col-center" data-label="ยอด" data-perm="campaign_metric_edit">${metricCell(p, metric)}</td>
        <td class="col-center" data-label="Line ID">${lineCell}</td>
        <td class="col-center" data-label="เบอร์โทร" style="white-space:nowrap;font-size:12.5px;color:var(--text2)">${(lm && lm.phone) || p.phone ? esc((lm && lm.phone) || p.phone) : `<span style="color:var(--text3)">—</span>`}</td>
        <td class="col-center" data-label="สถานะ">${statusPillPart(p)}</td>
        <td class="col-center" data-label="หมายเหตุ"><input class="part-note-input" type="text" placeholder="—" value="${esc(p.note || "")}" data-perm="campaign_edit" onchange="window.setPartNote(${p.participant_id}, this.value)" /></td>
        <td class="col-center" data-label="จัดการ">
          <div class="cmp-row-actions">
            <button class="btn-icon" title="แก้ไข" data-perm="campaign_edit" onclick="window.openPartModal(${p.participant_id})">✏️</button>
            <button class="btn-icon" title="ลบ" data-perm="campaign_delete" onclick="window.deletePart(${p.participant_id})">🗑</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");
  if (window.AuthZ) AuthZ.applyDomPerms(body);
  updatePartBulk();
};
function statusPillPart(p) {
  const st = p.status || "pending";
  const opts = [
    { v: "pending", l: "⏳ รอ" },
    { v: "approved", l: "✅ อนุมัติ" },
    { v: "rejected", l: "❌ ไม่ผ่านเกณฑ์" },
  ];
  return `<select class="pstat-select pstat-${st}" data-perm="campaign_edit" onchange="window.setPartStatus(${p.participant_id}, this.value)">
    ${opts.map((o) => `<option value="${o.v}"${o.v === st ? " selected" : ""}>${o.l}</option>`).join("")}
  </select>`;
}
window.setPartStatus = async function (id, status) {
  showLoading(true);
  try {
    await sbFetch("campaign_participants", `?participant_id=eq.${id}`, { method: "PATCH", body: { status } });
    const p = participants.find((x) => x.participant_id === id);
    if (p) p.status = status;
    renderParticipants();
    showToast("อัปเดตสถานะแล้ว", "success");
  } catch (e) {
    showToast("ไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};
window.setPartNote = async function (id, note) {
  const p = participants.find((x) => x.participant_id === id);
  const val = note.trim();
  if (p && (p.note || "") === val) return; // ไม่เปลี่ยน → ไม่ยิง
  try {
    await sbFetch("campaign_participants", `?participant_id=eq.${id}`, { method: "PATCH", body: { note: val } });
    if (p) p.note = val;
    showToast("บันทึกหมายเหตุแล้ว", "success");
  } catch (e) {
    showToast("ไม่สำเร็จ: " + e.message, "error");
  }
};
window.togglePartAll = function (el) {
  document.querySelectorAll(".part-check").forEach((c) => (c.checked = el.checked));
  updatePartBulk();
};
window.updatePartBulk = function () {
  const sel = [...document.querySelectorAll(".part-check:checked")];
  document.getElementById("partBulkBar").style.display = sel.length ? "flex" : "none";
  document.getElementById("partBulkCount").textContent = `${sel.length} รายการ`;
};
window.bulkDeleteParts = function () {
  const ids = [...document.querySelectorAll(".part-check:checked")].map((c) => +c.value);
  if (!ids.length) return;
  DeleteModal.open(`ลบผู้เข้าร่วม ${ids.length} คน (รวมผลงาน) ?`, async () => {
    showLoading(true);
    try {
      for (const id of ids) await sbFetch("campaign_participants", `?participant_id=eq.${id}`, { method: "DELETE" });
      showToast("ลบแล้ว", "success");
      await loadAll();
      switchTab("participants");
    } catch (e) {
      showToast("ลบไม่สำเร็จ: " + e.message, "error");
    }
    showLoading(false);
  });
};
window.deletePart = function (id) {
  const p = participants.find((x) => x.participant_id === id);
  DeleteModal.open(`ลบผู้เข้าร่วม "${p ? esc(p.member_name || p.member_code) : id}" (รวมผลงาน) ?`, async () => {
    showLoading(true);
    try {
      await sbFetch("campaign_participants", `?participant_id=eq.${id}`, { method: "DELETE" });
      showToast("ลบแล้ว", "success");
      await loadAll();
      switchTab("participants");
    } catch (e) {
      showToast("ลบไม่สำเร็จ: " + e.message, "error");
    }
    showLoading(false);
  });
};

window.openPartModal = function (id = null) {
  const p = id ? participants.find((x) => x.participant_id === id) : null;
  document.getElementById("partModalTitle").textContent = id ? "✏️ แก้ไขผู้เข้าร่วม" : "👥 เพิ่มผู้เข้าร่วม";
  document.getElementById("pId").value = id || "";
  document.getElementById("pCode").value = p?.member_code || "";
  document.getElementById("pCode").readOnly = !!id; // ห้ามแก้รหัสตอน edit (unique key)
  document.getElementById("pName").value = p?.member_name || "";
  document.getElementById("pPhone").value = p?.phone || "";
  document.getElementById("pStatus").value = p?.status || "pending";
  document.getElementById("pTiktokUrl").value = p?.tiktok_url || "";
  document.getElementById("pIgUrl").value = p?.ig_url || "";
  document.getElementById("pFbUrl").value = p?.facebook_url || "";
  document.getElementById("pNote").value = p?.note || "";
  document.getElementById("pLookupHit").innerHTML = "";
  renderPartCustomAnswers(p);
  document.getElementById("partModal").classList.add("open");
};

// แสดงคำตอบฟิลด์กำหนดเอง (read-only — ผู้ลงทะเบียนกรอกมาจากหน้า public)
function renderPartCustomAnswers(p) {
  const wrap = document.getElementById("pCustomAnswers");
  if (!wrap) return;
  const fields = Array.isArray(campaign?.register_fields) ? campaign.register_fields : [];
  const ans = (p && p.custom_answers && typeof p.custom_answers === "object") ? p.custom_answers : {};
  if (!fields.length) { wrap.innerHTML = ""; return; }
  const rows = fields
    .map((f) => {
      let v = ans[f.id];
      if (Array.isArray(v)) v = v.join(", ");
      v = (v == null || v === "") ? "—" : v;
      return `<div class="cmp-ans-row"><span class="cmp-ans-label">${esc(f.label)}</span><span class="cmp-ans-val">${esc(v)}</span></div>`;
    })
    .join("");
  wrap.innerHTML = `<div class="cmp-ans-head">📋 ข้อมูลเพิ่มเติม (จากฟอร์มลงทะเบียน)</div>${rows}`;
}
window.closePartModal = function () {
  document.getElementById("partModal").classList.remove("open");
};
// 📊 Dashboard → เปิดหน้า report ของแคมเปญนี้
window.openReport = function () {
  if (campaignId) location.href = `./campaign-report.html?campaign_id=${campaignId}`;
};

let _lookupTimer = null;
window.onPartCodeInput = function () {
  clearTimeout(_lookupTimer);
  const code = document.getElementById("pCode").value.trim();
  const hit = document.getElementById("pLookupHit");
  if (!code) return (hit.innerHTML = "");
  _lookupTimer = setTimeout(() => lookupMember(code), 400);
};
async function lookupMember(code) {
  const hit = document.getElementById("pLookupHit");
  hit.innerHTML = `<div class="cmp-lookup-hit" style="background:var(--surface2);color:var(--text3)">⏳ ค้นหา...</div>`;
  try {
    const sel = "member_code,member_name,full_name,phone";
    let rows = await sbFetch("members", `?member_code=eq.${encodeURIComponent(code)}&select=${sel}&limit=1`);
    if (!rows || !rows.length)
      rows = await sbFetch("test_members", `?member_code=eq.${encodeURIComponent(code)}&select=${sel}&limit=1`).catch(() => []);
    const m = (rows || [])[0];
    if (!m) {
      hit.innerHTML = `<div class="cmp-lookup-hit no">❌ ไม่พบสมาชิกรหัสนี้</div>`;
      return;
    }
    const name = m.full_name || m.member_name || m.member_code;
    if (!document.getElementById("pName").value) document.getElementById("pName").value = name;
    if (!document.getElementById("pPhone").value && m.phone) document.getElementById("pPhone").value = m.phone;
    hit.innerHTML = `<div class="cmp-lookup-hit ok">✅ ${esc(name)}</div>`;
  } catch (e) {
    hit.innerHTML = `<div class="cmp-lookup-hit no">⚠️ ${esc(e.message)}</div>`;
  }
}

window.savePart = async function () {
  const code = document.getElementById("pCode").value.trim();
  if (!code) return showToast("กรุณาใส่รหัสสมาชิก", "error");
  const id = document.getElementById("pId").value;
  const payload = {
    campaign_id: campaignId,
    member_code: code,
    member_name: document.getElementById("pName").value.trim() || null,
    phone: document.getElementById("pPhone").value.trim() || null,
    status: document.getElementById("pStatus").value,
    tiktok_url: document.getElementById("pTiktokUrl").value.trim() || null,
    ig_url: document.getElementById("pIgUrl").value.trim() || null,
    facebook_url: document.getElementById("pFbUrl").value.trim() || null,
    note: document.getElementById("pNote").value.trim() || null,
  };
  showLoading(true);
  try {
    if (id) {
      delete payload.member_code; // unique key — ไม่แก้
      delete payload.campaign_id;
      await sbFetch("campaign_participants", `?participant_id=eq.${id}`, { method: "PATCH", body: payload });
    } else {
      payload.source = "staff";
      await sbFetch("campaign_participants", "", { method: "POST", body: payload });
    }
    showToast("บันทึกผู้เข้าร่วมแล้ว", "success");
    closePartModal();
    await loadAll();
    switchTab("participants");
  } catch (e) {
    const msg = /duplicate|unique/i.test(e.message) ? "สมาชิกนี้ลงทะเบียนในแคมเปญแล้ว" : e.message;
    showToast("บันทึกไม่สำเร็จ: " + msg, "error");
  }
  showLoading(false);
};

// ════════════════════════════════════════════════════════
//  SUBMISSIONS
// ════════════════════════════════════════════════════════
function partLabel(pid) {
  const p = participants.find((x) => x.participant_id === pid);
  return p ? `${p.member_name || p.member_code} (${p.member_code})` : `#${pid}`;
}
window.renderSubmissions = function () {
  const body = document.getElementById("subBody");
  if (!body) return; // pane ผลงานถูกเอาออกแล้ว — no-op
  const fEl = document.getElementById("subFilterStatus");
  const f = fEl ? fEl.value : "";
  let rows = submissions.filter((s) => !f || s.status === f);
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">📊</div><div class="empty-text">ยังไม่มีผลงาน</div></div></td></tr>`;
    return;
  }
  body.innerHTML = rows
    .map((s) => {
      const mission = missions.find((m) => m.mission_id === s.mission_id);
      const proof = s.proof_url ? ` <a href="#" onclick="ImgPopup.open(['${esc(s.proof_url)}']);return false" title="ดูหลักฐาน">🖼️</a>` : "";
      return `<tr>
        <td>${esc(partLabel(s.participant_id))}${mission ? `<div style="font-size:11px;color:var(--text3)">🎯 ${esc(mission.title)}</div>` : ""}</td>
        <td class="col-center">${PLAT_LABEL[s.platform] || s.platform}</td>
        <td><a href="${esc(safeHref(s.post_url))}" target="_blank" rel="noopener" style="font-size:12px">เปิดโพสต์ ↗</a>${proof}</td>
        <td class="col-center">${fmtNum(s.views)}</td>
        <td class="col-center">${fmtNum(s.likes)}</td>
        <td class="col-center">${fmtNum(s.comments)}</td>
        <td class="col-center">${fmtNum(s.shares)}</td>
        <td class="col-center">${statusPillSub(s)}</td>
        <td class="col-center">
          <div class="cmp-row-actions">
            ${s.status !== "approved" ? `<button class="btn-icon" title="อนุมัติ" data-perm="campaign_metric_edit" onclick="window.setSubStatus(${s.submission_id},'approved')">✅</button>` : ""}
            ${s.status !== "rejected" ? `<button class="btn-icon" title="ปฏิเสธ" data-perm="campaign_metric_edit" onclick="window.setSubStatus(${s.submission_id},'rejected')">🚫</button>` : ""}
            <button class="btn-icon" title="แก้ไข/กรอกยอด" data-perm="campaign_metric_edit" onclick="window.openSubModal(${s.submission_id})">✏️</button>
            <button class="btn-icon" title="ลบ" data-perm="campaign_delete" onclick="window.deleteSub(${s.submission_id})">🗑</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");
  if (window.AuthZ) AuthZ.applyDomPerms(body);
};
function statusPillSub(s) {
  const lbl = { pending: "⏳ รอ", approved: "✅ อนุมัติ", rejected: "❌ ปฏิเสธ" }[s.status] || s.status;
  return `<span class="pstat pstat-${s.status}">${lbl}</span>`;
}
window.setSubStatus = async function (id, status) {
  showLoading(true);
  try {
    const body = { status };
    if (status === "approved") {
      body.verified_at = new Date().toISOString();
      body.verified_by = localStorage.getItem("user_name") || localStorage.getItem("username") || null;
    }
    await sbFetch("campaign_submissions", `?submission_id=eq.${id}`, { method: "PATCH", body });
    const s = submissions.find((x) => x.submission_id === id);
    if (s) Object.assign(s, body);
    renderSubmissions();
    renderRanking();
    showToast("อัปเดตสถานะแล้ว", "success");
  } catch (e) {
    showToast("ไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

// เปิดลิงก์โซเชียลในหน้าต่างใหม่ (popup window แยก ไม่ใช่แท็บ)
window.openSocialWindow = function (url) {
  if (!url || url === "#") return;
  const w = 600, h = 820;
  const left = Math.max(0, (window.screen.width - w) / 2);
  const top = Math.max(0, (window.screen.height - h) / 2);
  window.open(url, "socialPreview", `noopener,width=${w},height=${h},left=${left},top=${top}`);
};

// เปิดลิงก์โพสต์ (ค่าปัจจุบันในช่อง) ในหน้าต่างใหม่ (popup window แยก ไม่ใช่แท็บ)
window.openSubPostLink = function () {
  const url = (document.getElementById("sPostUrl").value || "").trim();
  if (!url) return showToast("ยังไม่มีลิงก์โพสต์ — กรอกในช่องก่อน", "warning");
  const w = 600, h = 820;
  const left = Math.max(0, (window.screen.width - w) / 2);
  const top = Math.max(0, (window.screen.height - h) / 2);
  window.open(url, "postPreview", `noopener,width=${w},height=${h},left=${left},top=${top}`);
};

window.openSubModal = function (id = null, prefill = null) {
  if (!participants.length) return showToast("ยังไม่มีผู้เข้าร่วม — เพิ่มผู้เข้าร่วมก่อน", "warning");
  _proofFile = null;
  const pf = prefill || {};

  // กด 📊 ของคน+ช่องทางที่เคยกรอกยอดแล้ว → เปิดยอดเดิมมาแก้ (กันสร้างซ้ำ + ค่าไม่หาย)
  if (!id && pf.participant_id && pf.platform) {
    const existing = submissions.find(
      (x) => x.participant_id === pf.participant_id && x.platform === pf.platform,
    );
    if (existing) id = existing.submission_id;
  }
  const s = id ? submissions.find((x) => x.submission_id === id) : null;

  // กรอกยอดเร็วจากลิงก์ช่องทางของผู้เข้าร่วม → ดึง post_url ของช่องนั้นมาใส่อัตโนมัติ
  if (!s && pf.participant_id && pf.platform) {
    const pp = participants.find((x) => x.participant_id === pf.participant_id);
    pf.post_url = { facebook: pp?.facebook_url, tiktok: pp?.tiktok_url, instagram: pp?.ig_url }[pf.platform] || "";
  }

  // populate participant select
  document.getElementById("sParticipant").innerHTML = participants
    .map((p) => `<option value="${p.participant_id}">${esc(p.member_name || p.member_code)} (${esc(p.member_code)})</option>`)
    .join("");
  document.getElementById("subModalTitle").textContent = id ? "✏️ แก้ไขผลงาน" : pf.participant_id ? "📊 กรอกยอด" : "📊 เพิ่มผลงาน";
  document.getElementById("sId").value = id || "";
  document.getElementById("sParticipant").value = s?.participant_id || pf.participant_id || participants[0].participant_id;
  document.getElementById("sPlatform").value = s?.platform || pf.platform || (campaign.platforms || ["tiktok"])[0];
  document.getElementById("sPostUrl").value = s?.post_url || pf.post_url || "";
  document.getElementById("sViews").value = s?.views ?? 0;
  document.getElementById("sLikes").value = s?.likes ?? 0;
  document.getElementById("sComments").value = s?.comments ?? 0;
  document.getElementById("sShares").value = s?.shares ?? 0;
  document.getElementById("sProofPreview").innerHTML = s?.proof_url
    ? `<img src="${esc(s.proof_url)}" style="max-height:120px;border-radius:8px;border:1px solid var(--border)" />`
    : "";
  document.getElementById("subModal").classList.add("open");
};
window.closeSubModal = function () {
  document.getElementById("subModal").classList.remove("open");
  _proofFile = null;
};
window.onProofPick = function (input) {
  const f = input.files[0];
  input.value = "";
  if (!f) return;
  _proofFile = f;
  document.getElementById("sProofPreview").innerHTML = `<img src="${URL.createObjectURL(f)}" style="max-height:120px;border-radius:8px;border:1px solid var(--border)" />`;
};

window.saveSub = async function () {
  const post_url = document.getElementById("sPostUrl").value.trim();
  if (!post_url) return showToast("ใส่ลิงก์โพสต์", "error");
  const participant_id = +document.getElementById("sParticipant").value;
  if (!participant_id) return showToast("เลือกผู้เข้าร่วม", "error");
  let id = document.getElementById("sId").value;

  // กันโพสต์ซ้ำ: เพิ่มผลงานใหม่ แต่คนนี้ + โพสต์ (URL) นี้ มีอยู่แล้ว → แก้ของเดิมแทน insert ซ้ำ
  // (ไม่งั้น ranking รวมยอดซ้ำ เช่น 18+30=48 ทั้งที่เป็นโพสต์เดียว)
  if (!id) {
    const dup = submissions.find(
      (x) => x.participant_id === participant_id && (x.post_url || "").trim() === post_url,
    );
    if (dup) id = dup.submission_id;
  }

  const btn = document.getElementById("btnSaveSub");
  btn.disabled = true;
  showLoading(true);
  try {
    let proof_url = null;
    if (_proofFile) {
      const { url, key } = getSB();
      const path = `campaigns/${campaignId}/proofs/${Date.now()}`;
      proof_url = await window.ImageCompressor.uploadViaRest(url, key, BUCKET, path, _proofFile);
    }
    // ไม่มีขั้นอนุมัติแล้ว — ยอดที่กรอกนับเข้าอันดับทันที (status = approved)
    const payload = {
      campaign_id: campaignId,
      participant_id,
      platform: document.getElementById("sPlatform").value,
      post_url,
      views: parseInt(document.getElementById("sViews").value) || 0,
      likes: parseInt(document.getElementById("sLikes").value) || 0,
      comments: parseInt(document.getElementById("sComments").value) || 0,
      shares: parseInt(document.getElementById("sShares").value) || 0,
      status: "approved",
      verified_at: new Date().toISOString(),
      verified_by: localStorage.getItem("user_name") || localStorage.getItem("username") || null,
    };
    if (proof_url) payload.proof_url = proof_url;

    if (id) await sbFetch("campaign_submissions", `?submission_id=eq.${id}`, { method: "PATCH", body: payload });
    else await sbFetch("campaign_submissions", "", { method: "POST", body: payload });

    showToast("บันทึกผลงานแล้ว", "success");
    closeSubModal();
    await loadAll();
    switchTab("participants");
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  } finally {
    btn.disabled = false;
    showLoading(false);
  }
};
window.deleteSub = function (id) {
  DeleteModal.open("ลบผลงานนี้?", async () => {
    showLoading(true);
    try {
      await sbFetch("campaign_submissions", `?submission_id=eq.${id}`, { method: "DELETE" });
      showToast("ลบแล้ว", "success");
      await loadAll();
      switchTab("ranking");
    } catch (e) {
      showToast("ลบไม่สำเร็จ: " + e.message, "error");
    }
    showLoading(false);
  });
};

// ════════════════════════════════════════════════════════
//  RANKING
// ════════════════════════════════════════════════════════
let _rankMetricTouched = false;
window.onRankMetricChange = function () {
  _rankMetricTouched = true;
  renderRanking();
};
// toggle: ยอดเท่ากัน → อันดับเดียวกัน (รับรางวัลเท่ากัน)
let _rankTieShare = false;
window.onRankTieToggle = function () {
  _rankTieShare = document.getElementById("rankTieToggle").checked;
  renderRanking();
};
// แปลง rows (เรียงจากมากไปน้อยแล้ว) → [{a, rank}]
// tie ON: ยอดเท่ากันได้อันดับเดียวกัน · คนถัดไปเลื่อนขึ้นมาอันดับถัดไป ไม่ข้าม (dense ranking เช่น 1,1,2,3)
//         → รางวัลทุกระดับยังถูกแจกครบ (เสมอที่ 1 สองคน คนถัดไปยังได้รางวัลที่ 2)
function rankRows(rows, metric) {
  let prevScore = null, prevRank = 0;
  return rows.map((a, i) => {
    const score = _metricScore(a, metric);
    let rank;
    if (_rankTieShare) {
      if (prevScore !== null && score === prevScore) {
        rank = prevRank; // เสมอ → อันดับเดียวกัน
      } else {
        rank = prevRank + 1; // เลื่อนขึ้นมาอันดับถัดไป
        prevScore = score;
        prevRank = rank;
      }
    } else {
      rank = i + 1; // ปิด toggle = ไล่ตามลำดับเดิม
    }
    return { a, rank };
  });
}
// ช่องทางแจกรางวัล (key ใน rewards ↔ platform ใน submissions: ig ↔ instagram)
const RANK_CHANS = [
  { key: "facebook", platform: "facebook", label: "Facebook", ic: "../../assets/icons/facebook.png" },
  { key: "tiktok", platform: "tiktok", label: "TikTok", ic: "../../assets/icons/tiktok.png" },
  { key: "ig", platform: "instagram", label: "Instagram", ic: "../../assets/icons/instagram.png" },
];
// รางวัลของอันดับนี้ — ranked: ตามช่วง rank_from..rank_to · topn: N คนแรกที่ยอดถึงเกณฑ์
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
// รวมยอดต่อคน เฉพาะ submissions ของแพลตฟอร์มนี้
function channelAgg(platform) {
  const agg = {};
  // ไม่นับคนสถานะ "ไม่ผ่านเกณฑ์" (rejected) เข้าอันดับ
  participants
    .filter((p) => p.status !== "rejected")
    .forEach((p) => (agg[p.participant_id] = { p, views: 0, likes: 0, comments: 0, shares: 0, posts: 0 }));
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
// render leaderboard เป็น block ต่ออันดับ — คนอันดับเดียวกัน (เสมอ) อยู่ block เดียวกัน รับรางวัลร่วม
// prizeFn(rank, score) → ข้อความรางวัลของอันดับนั้น (คืน "" ถ้าไม่มีรางวัล)
function lbBlocks(ranked, metric, prizeFn) {
  const groups = [];
  ranked.forEach((r) => {
    const last = groups[groups.length - 1];
    if (last && last.rank === r.rank) last.items.push(r.a);
    else groups.push({ rank: r.rank, score: _metricScore(r.a, metric), items: [r.a] });
  });
  return groups.map((g) => lbBlock(g, metric, prizeFn(g.rank, g.score))).join("");
}
function lbBlock(g, metric, prize) {
  const { rank } = g;
  const topClass = rank <= 3 ? ` top${rank}` : "";
  const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : rank;
  const prizeCell = prize
    ? `<div class="lb-prize">🎁 ${esc(prize)}</div>`
    : `<div class="lb-prize lb-prize-none">—</div>`;
  const members = g.items
    .map((a) => `<div class="lb-member">
      <div class="lb-name"><div class="n">${esc(a.p.member_name || a.p.member_code)}</div>
        <div class="c">${esc(a.p.member_code)} · ${a.posts} โพสต์</div></div>
      <div class="lb-score">${fmtNum(_metricScore(a, metric))}<div style="font-size:10px;color:var(--text3);font-weight:600">${esc(metricUnitLabel(metric))}</div></div>
    </div>`)
    .join("");
  const multi = g.items.length > 1 ? " lb-block-multi" : "";
  return `<div class="lb-row${topClass}${multi}">
    <div class="lb-rank">${medal}</div>
    <div class="lb-members">${members}</div>
    ${prizeCell}
  </div>`;
}
window.renderRanking = function () {
  const el = document.getElementById("rankList");
  // ตอนโหลด = เมตริกที่ตั้งจริง (rewards.metric) · staff เปลี่ยน dropdown เอง = override
  const metric = _rankMetricTouched ? document.getElementById("rankMetricSel").value : effectiveMetric();
  const rewards = (campaign && campaign.rewards) || null;
  const chans = rewards && rewards.channels
    ? RANK_CHANS.filter((c) => rewards.channels[c.key] && rewards.channels[c.key].enabled)
    : [];

  // รวมยอดทุกช่องทาง → leaderboard เดียว (ผลรวมทุกช่องต่อคน) + แจกรางวัลตามอันดับรวม
  if (rewards && rewards.combine_channels) {
    const rows = Object.values(channelAggAll())
      .filter((a) => a.posts > 0)
      .sort((x, y) => _metricScore(y, metric) - _metricScore(x, metric));
    const mode = rewards.mode || "ranked";
    // รางวัลชุดเดียว: ใช้ channels.all → fallback ช่องแรกที่เปิด (ข้อมูลเก่า)
    const tiers = (rewards.channels && rewards.channels.all && rewards.channels.all.tiers)
      || (chans.length ? rewards.channels[chans[0].key].tiers : null);
    const head = `<div class="lb-chan-hdr"><span>🔗 รวมทุกช่องทาง</span><span class="lb-chan-n">${rows.length} คน</span></div>`;
    const body = rows.length
      ? lbBlocks(rankRows(rows, metric), metric, (rank, score) => (tiers ? prizeForRank(tiers, rank, score, mode) : ""))
      : `<div class="lb-chan-empty">ยังไม่มีผลงาน — อันดับจะแสดงเมื่อมีผลงานแล้ว</div>`;
    el.innerHTML = `<div class="lb-grid">${`<div class="lb-chan">${head}${body}</div>`}</div>`;
    return;
  }

  // ไม่มี config ช่องทางแจกรางวัล → leaderboard เดียวรวมทุกช่อง (ไม่มีรางวัล)
  if (!chans.length) {
    const agg = channelAggAll();
    const rows = Object.values(agg).filter((a) => a.posts > 0).sort((x, y) => _metricScore(y, metric) - _metricScore(x, metric));
    el.innerHTML = rows.length
      ? lbBlocks(rankRows(rows, metric), metric, () => "")
      : `<div class="empty-state"><div class="empty-icon">🏆</div><div class="empty-text">ยังไม่มีผลงาน — อันดับจะแสดงเมื่อมีผลงานแล้ว</div></div>`;
    return;
  }

  const mode = rewards.mode || "ranked";
  const cols = chans
    .map((c) => {
      const rows = Object.values(channelAgg(c.platform))
        .filter((a) => a.posts > 0)
        .sort((x, y) => _metricScore(y, metric) - _metricScore(x, metric));
      const head = `<div class="lb-chan-hdr"><img src="${c.ic}" alt="" /><span>${c.label}</span><span class="lb-chan-n">${rows.length} คน</span></div>`;
      const body = rows.length
        ? lbBlocks(rankRows(rows, metric), metric, (rank, score) => prizeForRank(rewards.channels[c.key].tiers, rank, score, mode))
        : `<div class="lb-chan-empty">ยังไม่มีผลงานในช่องนี้</div>`;
      return `<div class="lb-chan">${head}${body}</div>`;
    })
    .join("");
  el.innerHTML = `<div class="lb-grid">${cols}</div>`;
};
function channelAggAll() {
  const agg = {};
  // ไม่นับคนสถานะ "ไม่ผ่านเกณฑ์" (rejected) เข้าอันดับ
  participants
    .filter((p) => p.status !== "rejected")
    .forEach((p) => (agg[p.participant_id] = { p, views: 0, likes: 0, comments: 0, shares: 0, posts: 0 }));
  submissions.filter((s) => agg[s.participant_id]).forEach((s) => {
    const a = agg[s.participant_id];
    a.views += +s.views || 0; a.likes += +s.likes || 0;
    a.comments += +s.comments || 0; a.shares += +s.shares || 0; a.posts += 1;
  });
  return agg;
}

// ── ลาก tab ซ้าย/ขวา จัดลำดับ (จำค่าไว้ใน localStorage) ──
function initTabReorder() {
  const bar = document.getElementById("cmpTabs");
  if (!bar) return;
  const KEY = "cmpTabOrder";
  const tabs = () => [...bar.querySelectorAll(".cmp-tab")];
  const activateFirst = () => {
    const first = tabs()[0];
    if (first) window.switchTab(first.dataset.tab);
  };

  // ใช้ลำดับที่เคยจัดไว้
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (Array.isArray(saved)) {
      saved.forEach((t) => {
        const el = bar.querySelector(`.cmp-tab[data-tab="${t}"]`);
        if (el) bar.appendChild(el);
      });
    }
  } catch {}
  activateFirst(); // tab ซ้ายสุด = หน้าที่แสดงตอนเปิด

  let dragEl = null;
  const afterEl = (x) => {
    const els = [...bar.querySelectorAll(".cmp-tab:not(.dragging)")];
    let best = { offset: -Infinity, el: null };
    els.forEach((c) => {
      const box = c.getBoundingClientRect();
      const offset = x - box.left - box.width / 2;
      if (offset < 0 && offset > best.offset) best = { offset, el: c };
    });
    return best.el;
  };

  tabs().forEach((t) => {
    t.setAttribute("draggable", "true");
    t.addEventListener("dragstart", (e) => {
      dragEl = t;
      t.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });
    t.addEventListener("dragend", () => {
      t.classList.remove("dragging");
      dragEl = null;
      localStorage.setItem(KEY, JSON.stringify(tabs().map((x) => x.dataset.tab)));
      activateFirst(); // จัดลำดับเสร็จ → เด้งไปหน้าซ้ายสุด
    });
  });
  bar.addEventListener("dragover", (e) => {
    if (!dragEl) return;
    e.preventDefault();
    const after = afterEl(e.clientX);
    if (after) bar.insertBefore(dragEl, after);
    else bar.appendChild(dragEl);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  initTabReorder();
  initPage();
});
