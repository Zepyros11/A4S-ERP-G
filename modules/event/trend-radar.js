/* ============================================================
   trend-radar.js — เรดาร์กระแส
   - ดึง Google Trends + Google News (ผ่าน ai-proxy /trend/fetch)
   - ปั้นไอเดียคอนเทนต์ด้วย Claude (/trend/ideas)
   - ส่งไอเดียเข้า FB Scheduler เป็น DRAFT
   ============================================================ */

/* ── Supabase REST helper ── */
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
      Prefer: (method === "POST" || method === "PATCH") ? "return=representation" : "",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "DB error");
  return method === "DELETE" ? null : res.json().catch(() => null);
}

function proxyBase() {
  return (localStorage.getItem("erp_proxy_url") || "").replace(/\/+$/, "");
}

/* ── บริบทธุรกิจ (ส่งให้ Claude ตอนปั้นคอนเทนต์) ── */
const BRAND_CONTEXT =
  "A4S — ธุรกิจเครือข่าย (MLM) จำหน่ายสินค้าสุขภาพและความงามให้สมาชิก " +
  "พร้อมจัดอีเวนต์สัมมนาและทริปท่องเที่ยวเพื่อสร้างแรงบันดาลใจให้ทีมงานและสมาชิก " +
  "โทนแบรนด์: อบอุ่น เป็นกันเอง สร้างแรงบันดาลใจ เน้นโอกาส/สุขภาพ/ไลฟ์สไตล์ที่ดีขึ้น";

/* ── หัวข้อ fallback ถ้ายังไม่รัน migration 040 ── */
const DEFAULT_TOPICS = [
  { label: "MLM / ธุรกิจเครือข่าย", query: "ธุรกิจเครือข่าย ขายตรง MLM แชร์ลูกโซ่", emoji: "🔗" },
  { label: "สุขภาพ / ความงาม", query: "เทรนด์สุขภาพ อาหารเสริม ความงาม สกินแคร์", emoji: "💚",
    yt_query: "รีวิว อาหารเสริม สกินแคร์ ครีมบำรุง เซรั่ม วิตามิน สุขภาพ ความงาม" },
  { label: "ท่องเที่ยว / อีเวนต์", query: "เทรนด์ท่องเที่ยว ทริป สัมมนา คอนเสิร์ต อีเวนต์", emoji: "✈️" },
  { label: "ไลฟ์สไตล์ / ไวรัล", query: "ไวรัล กระแสโซเชียล ไลฟ์สไตล์ ที่กำลังฮิต", emoji: "🔥" },
];

let TOPICS = [];          // [{id?, label, query, emoji, sort, is_active}]
let LAST = null;          // ผลลัพธ์ /trend/fetch ล่าสุด
let ACTIVE_TAB = 0;
let TOPICS_FROM_DB = false;

/* ── Toast ── */
function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove("show"), 3200);
}

/* ── Utils ── */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function timeAgo(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 90) return "เมื่อสักครู่";
  if (diff < 3600) return `${Math.round(diff / 60)} นาทีที่แล้ว`;
  if (diff < 86400) return `${Math.round(diff / 3600)} ชม.ที่แล้ว`;
  return `${Math.round(diff / 86400)} วันก่อน`;
}
function nowBangkok() {
  return new Date().toLocaleTimeString("th-TH", {
    timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit",
  });
}

/* ══ Load topics ══ */
async function loadTopics() {
  try {
    const rows = await sbFetch("trend_topics", "?select=*&is_active=eq.true&order=sort.asc");
    if (Array.isArray(rows) && rows.length) {
      TOPICS = rows;
      TOPICS_FROM_DB = true;
      return;
    }
  } catch (e) { /* table อาจยังไม่มี → fallback */ }
  TOPICS = DEFAULT_TOPICS.map((t, i) => ({ ...t, sort: i + 1, is_active: true }));
  TOPICS_FROM_DB = false;
}

/* ══ Fetch trends ══ */
async function refreshAll() {
  const base = proxyBase();
  if (!base) return showToast("ยังไม่ได้ตั้ง erp_proxy_url", "error");
  const grid = document.getElementById("trendingGrid");
  grid.innerHTML = `<div class="tr-skeleton"></div><div class="tr-skeleton"></div><div class="tr-skeleton"></div>`;
  document.getElementById("topicNews").innerHTML = `<div class="tr-loading">กำลังส่องกระแส…</div>`;
  document.getElementById("btnRefresh").disabled = true;

  try {
    const r = await fetch(`${base}/trend/fetch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        geo: "TH",
        topics: TOPICS.map(t => ({ label: t.label, query: t.query, yt_query: t.yt_query || "" })),
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!data.ok) throw new Error(data.error || "ดึงข้อมูลไม่สำเร็จ");
    LAST = data;
    renderStats();
    renderTrending();
    renderTopicTabs();
    renderTopicNews();
  } catch (e) {
    showToast("โหลดกระแสไม่สำเร็จ: " + e.message, "error");
    grid.innerHTML = `<div class="tr-empty">โหลดไม่สำเร็จ — ${esc(e.message)}</div>`;
    document.getElementById("topicNews").innerHTML = "";
  } finally {
    document.getElementById("btnRefresh").disabled = false;
  }
}

function renderStats() {
  const topics = LAST.topics || [];
  const vids = topics.reduce((s, t) => s + (t.videos || []).length, 0);
  const views = topics.reduce((s, t) => s + (t.videos || []).reduce((a, v) => a + (Number(v.views) || 0), 0), 0);
  document.getElementById("statVideos").textContent = vids;
  document.getElementById("statViews").textContent = formatViews(views);
  document.getElementById("statTopics").textContent = topics.length;
  document.getElementById("statUpdated").textContent = nowBangkok() + " น.";
}

/* ── Section 1: Google Trends cards ── */
function renderTrending() {
  const grid = document.getElementById("trendingGrid");
  const list = LAST.trending || [];
  if (!list.length) {
    grid.innerHTML = `<div class="tr-empty">ไม่พบข้อมูลเทรนด์ในขณะนี้</div>`;
    return;
  }
  grid.innerHTML = list.map((t, i) => {
    const news = (t.news || []).slice(0, 2);
    const newsHtml = news.map(n =>
      `<a class="tr-src-link" href="${esc(n.url)}" target="_blank" rel="noopener">
         <span class="tr-src-dot">•</span> ${esc(n.title)}
         ${n.source ? `<span class="tr-src-name">— ${esc(n.source)}</span>` : ""}
       </a>`).join("");
    return `
      <div class="tr-card">
        <div class="tr-card-top">
          <span class="tr-rank">#${i + 1}</span>
          ${t.traffic ? `<span class="tr-traffic">🔎 ${esc(t.traffic)}</span>` : ""}
        </div>
        <div class="tr-card-title">${esc(t.title)}</div>
        <div class="tr-card-news">${newsHtml || '<span class="tr-src-empty">—</span>'}</div>
        <div class="tr-card-actions">
          <button class="tr-idea-btn" onclick="ideaFromTrend(${i})">💡 ปั้นคอนเทนต์</button>
          <button class="tr-tag-btn" onclick="hashtagsFromTrend(${i})" title="hashtag แนะนำ">🏷️</button>
        </div>
      </div>`;
  }).join("");
}

/* หยิบข้อมูลจาก LAST ด้วย index (เลี่ยงยัด text เข้า onclick → กัน quote/apostrophe พัง) */
function ideaFromTrend(i) {
  const t = (LAST.trending || [])[i];
  if (!t) return;
  const ctx = (t.news || []).slice(0, 3).map(n => n.title).join(" | ");
  openIdeas(t.title, "กระแสทั่วไป", ctx);
}
function ideaFromNews(tabIdx, itemIdx) {
  const t = (LAST.topics || [])[tabIdx];
  const n = t && (t.items || [])[itemIdx];
  if (!n) return;
  openIdeas(n.title, t.label, "");
}
function hashtagsFromTrend(i) {
  const t = (LAST.trending || [])[i];
  if (t) openHashtags(t.title, "กระแสทั่วไป");
}
function hashtagsFromNews(tabIdx, itemIdx) {
  const t = (LAST.topics || [])[tabIdx];
  const n = t && (t.items || [])[itemIdx];
  if (n) openHashtags(n.title, t.label);
}
function ideaFromVideo(tabIdx, vidIdx) {
  const t = (LAST.topics || [])[tabIdx];
  const v = t && (t.videos || [])[vidIdx];
  if (!v) return;
  const ctx = `คลิป YouTube ยอดวิว ${formatViews(v.views)} จากช่อง ${v.channel || "-"}`;
  openIdeas(v.title, t.label, ctx);
}
function hashtagsFromVideo(tabIdx, vidIdx) {
  const t = (LAST.topics || [])[tabIdx];
  const v = t && (t.videos || [])[vidIdx];
  if (v) openHashtags(v.title, t.label);
}

/* ── Section 2: topic tabs + news ── */
function renderTopicTabs() {
  const tabs = document.getElementById("topicTabs");
  const topics = LAST.topics || [];
  tabs.innerHTML = topics.map((t, i) => {
    const emoji = (TOPICS.find(x => x.label === t.label) || {}).emoji || "🎬";
    const n = (t.videos || []).length;
    return `<button class="tr-tab ${i === ACTIVE_TAB ? "active" : ""}" onclick="selectTab(${i})">
      ${esc(emoji)} ${esc(t.label)} <span class="tr-tab-count">🎬 ${n}</span>
    </button>`;
  }).join("");
}
function selectTab(i) {
  ACTIVE_TAB = i;
  renderTopicTabs();
  renderTopicNews();
}
function formatViews(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "K";
  return String(n);
}
function renderTopicNews() {
  const wrap = document.getElementById("topicNews");
  const topics = LAST.topics || [];
  const t = topics[ACTIVE_TAB];
  if (!t) { wrap.innerHTML = `<div class="tr-empty">ยังไม่มีหัวข้อ — เพิ่มที่ ⚙️ จัดการหัวข้อ</div>`; return; }

  wrap.innerHTML = `${youtubeSection(t)}${newsSection(t)}`;
}

/* ── YouTube (พระเอก): คลิปเด่นตัวใหญ่ + กริดคลิป มี badge อันดับ ── */
function youtubeSection(t) {
  const canIdea = !!proxyBase();
  if (!LAST.youtubeEnabled) {
    return `<div class="tr-empty tr-empty-sm">🎬 ยังไม่ได้เปิดใช้ YouTube — ตั้งค่า API key ที่ backend ก่อน</div>`;
  }
  const videos = t.videos || [];
  if (!videos.length) {
    const msg = t.ytError
      ? (/quota/i.test(t.ytError)
          ? `🎬 โควตา YouTube วันนี้เต็ม — คลิปจะกลับมาเองหลังรีเซ็ต (พรุ่งนี้ ~บ่าย)`
          : `ดึงคลิปไม่สำเร็จ — <code>${esc(t.ytError)}</code>`)
      : `ไม่พบคลิปสำหรับ "${esc(t.label)}" — ลองปรับ 🎬 คำค้น YouTube ที่ ⚙️ จัดการหัวข้อ`;
    return `<div class="tr-empty tr-empty-sm">${msg}</div>`;
  }

  const card = (v, i) => {
    const rank = i + 1;
    const rankCls = rank <= 3 ? ` top${rank}` : "";
    const channel = v.channelUrl
      ? `<a class="tr-yt-channel" href="${esc(v.channelUrl)}" target="_blank" rel="noopener">📺 ${esc(v.channel)}</a>`
      : `<span class="tr-yt-channel-plain">📺 ${esc(v.channel)}</span>`;
    return `
      <div class="tr-yt-card">
        <a class="tr-yt-thumb"${v.thumb ? ` style="background-image:url('${esc(v.thumb)}')"` : ""} href="${esc(v.url)}" target="_blank" rel="noopener" title="เปิดวิดีโอ">
          <span class="tr-yt-rank${rankCls}">#${rank}</span>
          <span class="tr-yt-play">▶</span>
          <span class="tr-yt-views">👁 ${formatViews(v.views)}</span>
        </a>
        <div class="tr-yt-info">
          <a class="tr-yt-title" href="${esc(v.url)}" target="_blank" rel="noopener">${esc(v.title)}</a>
          <div class="tr-yt-meta">${channel}</div>
          ${canIdea ? `<div class="tr-yt-actions">
            <button class="tr-idea-btn sm" onclick="ideaFromVideo(${ACTIVE_TAB}, ${i})">💡 ปั้นคอนเทนต์</button>
            <button class="tr-tag-btn sm" onclick="hashtagsFromVideo(${ACTIVE_TAB}, ${i})" title="hashtag แนะนำ">🏷️</button>
          </div>` : ""}
        </div>
      </div>`;
  };

  // คลิปอันดับ 1 = คลิปเด่น (การ์ดใหญ่พาดขวาง) ที่เหลือเป็นกริดปกติ
  const [hero, ...rest] = videos;
  const heroHtml = `<div class="tr-yt-hero">${card(hero, 0)}</div>`;
  const restHtml = rest.length
    ? `<div class="tr-yt-grid">${rest.map((v, i) => card(v, i + 1)).join("")}</div>`
    : "";
  return `<div class="tr-yt-wrap">${heroHtml}${restHtml}</div>`;
}

/* ── ข่าว/บทความ (ส่วนรอง — พับเก็บได้) ── */
function newsSection(t) {
  const items = t.items || [];
  const emptyMsg = t.error
    ? `<div class="tr-empty">ดึงข่าวไม่สำเร็จ — <code>${esc(t.error)}</code><br><span class="tr-sub-note">ถ้าเป็น consent/redirect แปลว่า backend ยังไม่ได้ deploy ตัวแก้คุกกี้</span></div>`
    : `<div class="tr-empty">ไม่พบข่าวสำหรับ "${esc(t.label)}" ลองปรับคำค้นให้กว้างขึ้น</div>`;
  const list = items.length
    ? `<div class="tr-news-grid">${items.map((n, idx) => `
      <div class="tr-news-item">
        <div class="tr-news-main">
          <a class="tr-news-title" href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a>
          <div class="tr-news-meta">
            ${n.source ? `<span class="tr-news-src">${esc(n.source)}</span>` : ""}
            ${n.pubDate ? `<span class="tr-news-time">· ${esc(timeAgo(n.pubDate))}</span>` : ""}
          </div>
        </div>
        <div class="tr-news-actions">
          <button class="tr-idea-btn sm" onclick="ideaFromNews(${ACTIVE_TAB}, ${idx})">💡 ปั้น</button>
          <button class="tr-tag-btn sm" onclick="hashtagsFromNews(${ACTIVE_TAB}, ${idx})" title="hashtag แนะนำ">🏷️</button>
        </div>
      </div>`).join("")}</div>`
    : emptyMsg;
  return `
    <details class="tr-news-details">
      <summary class="tr-sub-hdr tr-news-summary">📰 ข่าว/บทความ <span class="tr-sub-note">${items.length ? items.length + " รายการ · แตะเพื่อดู" : "แตะเพื่อดู"}</span></summary>
      ${list}
    </details>`;
}

/* ══ Ideas modal ══ */
async function openIdeas(title, topic, context) {
  const base = proxyBase();
  if (!base) return showToast("ยังไม่ได้ตั้ง erp_proxy_url", "error");
  document.getElementById("ideasTitle").textContent = "💡 ปั้นคอนเทนต์";
  const body = document.getElementById("ideasBody");
  body.innerHTML = `
    <div class="tr-idea-source">📌 กระแส: <b>${esc(title)}</b></div>
    <div class="tr-loading">🤖 กำลังปั้นไอเดีย… (ใช้เวลา ~10 วิ)</div>`;
  document.getElementById("ideasModal").classList.add("open");

  try {
    const r = await fetch(`${base}/trend/ideas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, topic, context, brand: BRAND_CONTEXT }),
    });
    const data = await r.json().catch(() => ({}));
    if (!data.ok) throw new Error(data.error || "ปั้นไอเดียไม่สำเร็จ");
    renderIdeas(title, data.ideas || [], data.raw);
  } catch (e) {
    body.innerHTML = `
      <div class="tr-idea-source">📌 กระแส: <b>${esc(title)}</b></div>
      <div class="tr-empty">ปั้นไอเดียไม่สำเร็จ — ${esc(e.message)}</div>`;
  }
}

let CURRENT_IDEAS = []; // ไอเดียที่โชว์อยู่ (สำหรับปุ่ม copy/ส่ง FB อ้างด้วย index)
function ideaCaption(idea) {
  const tags = (idea.hashtags || []).join(" ");
  return [idea.caption, tags].filter(Boolean).join("\n\n");
}
function renderIdeas(title, ideas, raw) {
  CURRENT_IDEAS = Array.isArray(ideas) ? ideas : [];
  const body = document.getElementById("ideasBody");
  const canFb = !window.AuthZ || AuthZ.hasPerm("media_fb_create");
  let cards;
  if (CURRENT_IDEAS.length) {
    cards = CURRENT_IDEAS.map((idea, i) => {
      const tags = (idea.hashtags || []).map(h => esc(h)).join(" ");
      return `
        <div class="tr-idea-card">
          <div class="tr-idea-head">
            <span class="tr-idea-num">${i + 1}</span>
            <span class="tr-idea-angle">${esc(idea.angle || "มุมที่ " + (i + 1))}</span>
            ${idea.format ? `<span class="tr-idea-format">${esc(idea.format)}</span>` : ""}
          </div>
          ${idea.hook ? `<div class="tr-idea-hook">“${esc(idea.hook)}”</div>` : ""}
          <div class="tr-idea-caption">${esc(idea.caption || "")}</div>
          ${tags ? `<div class="tr-idea-tags">${tags}</div>` : ""}
          <div class="tr-idea-actions">
            <button class="btn btn-outline btn-sm" onclick="copyIdea(${i})">📋 คัดลอก</button>
            ${canFb ? `<button class="btn btn-primary btn-sm" onclick="sendIdeaToFb(${i}, this)">📅 ส่งเข้า FB Scheduler</button>` : ""}
          </div>
        </div>`;
    }).join("");
  } else {
    cards = `<div class="tr-empty">โมเดลตอบไม่เป็นรูปแบบที่อ่านได้${raw ? `:<br><pre class="tr-raw">${esc(raw)}</pre>` : ""}</div>`;
  }
  body.innerHTML = `<div class="tr-idea-source">📌 กระแส: <b>${esc(title)}</b></div>${cards}`;
}
function copyIdea(i) { const idea = CURRENT_IDEAS[i]; if (idea) copyText(ideaCaption(idea)); }
function sendIdeaToFb(i, btn) { const idea = CURRENT_IDEAS[i]; if (idea) sendToFb(ideaCaption(idea), btn); }

function closeIdeas() { document.getElementById("ideasModal").classList.remove("open"); }

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); showToast("คัดลอกแล้ว ✅"); }
  catch { showToast("คัดลอกไม่สำเร็จ", "error"); }
}

/* ══ Hashtag modal ══ */
let CURRENT_TAGS = [];
async function openHashtags(title, topic) {
  const base = proxyBase();
  if (!base) return showToast("ยังไม่ได้ตั้ง erp_proxy_url", "error");
  const body = document.getElementById("hashtagBody");
  body.innerHTML = `
    <div class="tr-idea-source">📌 กระแส: <b>${esc(title)}</b></div>
    <div class="tr-loading">🤖 กำลังคิด hashtag…</div>`;
  document.getElementById("hashtagModal").classList.add("open");
  try {
    const r = await fetch(`${base}/trend/hashtags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, topic, brand: BRAND_CONTEXT }),
    });
    const data = await r.json().catch(() => ({}));
    if (!data.ok) throw new Error(data.error || "คิด hashtag ไม่สำเร็จ");
    CURRENT_TAGS = data.hashtags || [];
    renderHashtags(title);
  } catch (e) {
    body.innerHTML = `
      <div class="tr-idea-source">📌 กระแส: <b>${esc(title)}</b></div>
      <div class="tr-empty">คิด hashtag ไม่สำเร็จ — ${esc(e.message)}</div>`;
  }
}
function renderHashtags(title) {
  const body = document.getElementById("hashtagBody");
  if (!CURRENT_TAGS.length) {
    body.innerHTML = `<div class="tr-idea-source">📌 <b>${esc(title)}</b></div><div class="tr-empty">ไม่มี hashtag แนะนำ</div>`;
    return;
  }
  const chips = CURRENT_TAGS.map((h, i) =>
    `<button class="tr-tag-chip" onclick="copyTag(${i})" title="คลิกเพื่อคัดลอก">${esc(h)}</button>`).join("");
  body.innerHTML = `
    <div class="tr-idea-source">📌 กระแส: <b>${esc(title)}</b></div>
    <p class="tr-hint">คลิกแท็บเพื่อคัดลอกทีละอัน หรือคัดลอกทั้งหมด</p>
    <div class="tr-tag-chips">${chips}</div>
    <div class="tr-idea-actions">
      <button class="btn btn-primary btn-sm" onclick="copyAllTags()">📋 คัดลอกทั้งหมด</button>
    </div>`;
}
function copyTag(i) { const h = CURRENT_TAGS[i]; if (h) copyText(h); }
function copyAllTags() { if (CURRENT_TAGS.length) copyText(CURRENT_TAGS.join(" ")); }
function closeHashtags() { document.getElementById("hashtagModal").classList.remove("open"); }

/* ── ส่งไอเดียเข้า FB Scheduler เป็น DRAFT ── */
async function sendToFb(caption, btn) {
  if (btn) { btn.disabled = true; btn.textContent = "กำลังส่ง…"; }
  try {
    const pages = await sbFetch("fb_pages", "?select=id&is_active=eq.true&order=id.asc&limit=1");
    if (!Array.isArray(pages) || !pages.length) {
      showToast("ยังไม่มีเพจ FB — ไปเพิ่มที่หน้า ‘ตารางโพสต์ FB’ ก่อน", "error");
      if (btn) { btn.disabled = false; btn.textContent = "📅 ส่งเข้า FB Scheduler"; }
      return;
    }
    const placeholder = new Date(Date.now() + 86400000).toISOString(); // scheduled_at NOT NULL → พรุ่งนี้
    await sbFetch("fb_scheduled_posts", "", {
      method: "POST",
      body: {
        fb_page_id: pages[0].id,
        caption,
        media_urls: [],
        status: "DRAFT",
        scheduled_at: placeholder,
        created_by: (window.ERP_USER && window.ERP_USER.user_id) || null,
      },
    });
    showToast("บันทึกเป็น DRAFT ในตารางโพสต์ FB แล้ว ✅ ไปตั้งเวลา+รูปต่อได้เลย");
    if (btn) btn.textContent = "✅ ส่งแล้ว";
  } catch (e) {
    showToast("ส่งไม่สำเร็จ: " + e.message, "error");
    if (btn) { btn.disabled = false; btn.textContent = "📅 ส่งเข้า FB Scheduler"; }
  }
}

/* ══ Manage topics ══ */
function openManage() {
  renderManageList();
  document.getElementById("manageModal").classList.add("open");
}
function closeManage() { document.getElementById("manageModal").classList.remove("open"); }

let MANAGE_DRAFT = []; // สำเนาแก้ไข
function renderManageList() {
  MANAGE_DRAFT = TOPICS.map(t => ({ ...t }));
  paintRows();
}
function paintRows() {
  const warn = !TOPICS_FROM_DB
    ? `<div class="tr-warn">⚠️ ยังไม่ได้รัน migration <code>sql/040_trend_radar.sql</code> — แก้ได้ชั่วคราวรอบนี้ แต่จะไม่ถูกบันทึกถาวรจนกว่าจะสร้างตาราง</div>`
    : "";
  document.getElementById("manageList").innerHTML = warn + manageRows();
}
function manageRows() {
  return MANAGE_DRAFT.map((t, i) => `
    <div class="tr-manage-item">
      <div class="tr-manage-row">
        <input class="tr-input tr-mini" value="${esc(t.emoji || "🔎")}" maxlength="2" oninput="editTopic(${i},'emoji',this.value)" />
        <input class="tr-input" value="${esc(t.label)}" placeholder="ชื่อหัวข้อ" oninput="editTopic(${i},'label',this.value)" />
        <button class="tr-del" title="ลบหัวข้อ" onclick="removeTopic(${i})">🗑</button>
      </div>
      <input class="tr-input tr-sub-input" value="${esc(t.query)}" placeholder="🔎 คำค้นข่าว" oninput="editTopic(${i},'query',this.value)" />
      <input class="tr-input tr-sub-input" value="${esc(t.yt_query || "")}" placeholder="🎬 คำค้น YouTube (เช่น รีวิว...) — ว่าง = ใช้เหมือนข่าว" oninput="editTopic(${i},'yt_query',this.value)" />
    </div>`).join("");
}
function editTopic(i, field, val) { if (MANAGE_DRAFT[i]) MANAGE_DRAFT[i][field] = val; }
function removeTopic(i) {
  MANAGE_DRAFT.splice(i, 1);
  paintRows();
}
function addTopic() {
  const label = document.getElementById("newLabel").value.trim();
  const query = document.getElementById("newQuery").value.trim();
  if (!label || !query) return showToast("กรอกชื่อหัวข้อและคำค้น", "error");
  MANAGE_DRAFT.push({ label, query, emoji: "🔎", sort: MANAGE_DRAFT.length + 1, is_active: true });
  document.getElementById("newLabel").value = "";
  document.getElementById("newQuery").value = "";
  paintRows();
}

async function saveManageAndRefresh() {
  const clean = MANAGE_DRAFT
    .map((t, i) => ({ ...t, label: (t.label || "").trim(), query: (t.query || "").trim(),
                     yt_query: (t.yt_query || "").trim(), sort: i + 1 }))
    .filter(t => t.label && t.query);
  if (!clean.length) return showToast("ต้องมีอย่างน้อย 1 หัวข้อ", "error");

  if (TOPICS_FROM_DB) {
    try {
      // sync แบบง่าย: ลบทั้งหมดแล้ว insert ใหม่ (จำนวนหัวข้อน้อย)
      await sbFetch("trend_topics", "?id=gt.0", { method: "DELETE" });
      await sbFetch("trend_topics", "", {
        method: "POST",
        body: clean.map(t => ({
          label: t.label, query: t.query, yt_query: t.yt_query || null,
          emoji: t.emoji || "🔎", sort: t.sort, is_active: true,
        })),
      });
      showToast("บันทึกหัวข้อแล้ว ✅");
    } catch (e) {
      return showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
    }
  } else {
    showToast("ใช้ชั่วคราวรอบนี้ (ยังไม่ได้สร้างตาราง)", "success");
  }
  TOPICS = clean;
  closeManage();
  refreshAll();
}

/* ══ Digest → LINE settings ══ */
let DIGEST_CFG = null;
let LINE_GROUPS = [];
async function openDigest() {
  const status = document.getElementById("dgStatus");
  status.textContent = "กำลังโหลดการตั้งค่า…";
  document.getElementById("digestModal").classList.add("open");

  // hour options 0-23
  const hourSel = document.getElementById("dgHour");
  hourSel.innerHTML = Array.from({ length: 24 }, (_, h) =>
    `<option value="${h}">${String(h).padStart(2, "0")}:00 น.</option>`).join("");

  try {
    const [cfgRows, groups] = await Promise.all([
      sbFetch("trend_digest_config", "?select=*&order=id.asc&limit=1"),
      sbFetch("line_groups", "?select=group_id,group_name,is_active&order=is_active.desc,group_name.asc").catch(() => []),
    ]);
    DIGEST_CFG = (Array.isArray(cfgRows) && cfgRows[0]) || null;
    LINE_GROUPS = Array.isArray(groups) ? groups : [];

    // group dropdown
    const gSel = document.getElementById("dgGroup");
    const hint = document.getElementById("dgGroupHint");
    if (LINE_GROUPS.length) {
      gSel.innerHTML = LINE_GROUPS.map(g =>
        `<option value="${esc(g.group_id)}">${esc(g.group_name || g.group_id)}${g.is_active === false ? " (ออกแล้ว)" : ""}</option>`).join("");
      hint.textContent = "";
    } else {
      gSel.innerHTML = `<option value="">— ยังไม่มีกลุ่ม —</option>`;
      hint.textContent = "บอทยังไม่ได้อยู่ในกลุ่มไหน — เชิญบอทเข้ากลุ่ม LINE ก่อน แล้วกลุ่มจะขึ้นเอง";
    }

    const c = DIGEST_CFG || { is_enabled: false, target_type: "group", send_hour: 8, include_ideas: true };
    document.getElementById("dgEnabled").checked = !!c.is_enabled;
    document.getElementById("dgTargetType").value = c.target_type || "group";
    document.getElementById("dgIdeas").checked = c.include_ideas !== false;
    hourSel.value = String(c.send_hour == null ? 8 : c.send_hour);
    if (c.target_id) document.getElementById("dgGroup").value = c.target_id;
    onDigestTargetChange();
    status.textContent = c.last_sent_on ? `ส่งล่าสุด: ${c.last_sent_on}` : "ยังไม่เคยส่ง";
  } catch (e) {
    status.textContent = "โหลดไม่สำเร็จ — " + e.message + " (รัน migration 041 หรือยัง?)";
  }
}
function onDigestTargetChange() {
  const isGroup = document.getElementById("dgTargetType").value === "group";
  document.getElementById("dgGroupWrap").style.display = isGroup ? "" : "none";
}
function closeDigest() { document.getElementById("digestModal").classList.remove("open"); }

function readDigestForm() {
  const target_type = document.getElementById("dgTargetType").value;
  return {
    is_enabled: document.getElementById("dgEnabled").checked,
    target_type,
    target_id: target_type === "group" ? (document.getElementById("dgGroup").value || null) : null,
    send_hour: parseInt(document.getElementById("dgHour").value, 10),
    include_ideas: document.getElementById("dgIdeas").checked,
    updated_at: new Date().toISOString(),
    updated_by: (window.ERP_USER && window.ERP_USER.full_name) || null,
  };
}
async function saveDigest() {
  const body = readDigestForm();
  if (body.is_enabled && body.target_type === "group" && !body.target_id)
    return showToast("เลือกกลุ่มปลายทางก่อน", "error");
  try {
    if (DIGEST_CFG && DIGEST_CFG.id) {
      await sbFetch("trend_digest_config", `?id=eq.${DIGEST_CFG.id}`, { method: "PATCH", body });
    } else {
      const rows = await sbFetch("trend_digest_config", "", { method: "POST", body });
      DIGEST_CFG = Array.isArray(rows) ? rows[0] : null;
    }
    showToast("บันทึกการตั้งค่าแล้ว ✅");
    closeDigest();
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  }
}
async function testDigest(btn) {
  const base = proxyBase();
  if (!base) return showToast("ยังไม่ได้ตั้ง erp_proxy_url", "error");
  const body = readDigestForm();
  if (body.target_type === "group" && !body.target_id)
    return showToast("เลือกกลุ่มปลายทางก่อนทดสอบ", "error");
  // บันทึกก่อน แล้วค่อยยิงทดสอบ (endpoint อ่าน config จาก DB)
  if (btn) { btn.disabled = true; btn.textContent = "กำลังส่ง…"; }
  try {
    await saveDigestSilent(body);
    const r = await fetch(`${base}/trend/digest/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const data = await r.json().catch(() => ({}));
    if (!data.ok) throw new Error(data.error || "ส่งไม่สำเร็จ");
    showToast("ส่งสรุปทดสอบเข้า LINE แล้ว ✅ เช็คในกลุ่มได้เลย");
  } catch (e) {
    showToast("ทดสอบไม่สำเร็จ: " + e.message, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "📤 ส่งทดสอบตอนนี้"; }
  }
}
async function saveDigestSilent(body) {
  if (DIGEST_CFG && DIGEST_CFG.id) {
    await sbFetch("trend_digest_config", `?id=eq.${DIGEST_CFG.id}`, { method: "PATCH", body });
  } else {
    const rows = await sbFetch("trend_digest_config", "", { method: "POST", body });
    DIGEST_CFG = Array.isArray(rows) ? rows[0] : null;
  }
}

/* ══ Init ══ */
async function initPage() {
  document.getElementById("loadingOverlay").style.display = "none";
  await loadTopics();
  document.getElementById("statTopics").textContent = TOPICS.length;
  await refreshAll();
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initPage);
else initPage();
