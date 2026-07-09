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
  { label: "สุขภาพ / ความงาม", query: "เทรนด์สุขภาพ อาหารเสริม ความงาม สกินแคร์", emoji: "💚" },
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
        topics: TOPICS.map(t => ({ label: t.label, query: t.query })),
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
  document.getElementById("statTrending").textContent = (LAST.trending || []).length;
  document.getElementById("statTopics").textContent = (LAST.topics || []).length;
  const news = (LAST.topics || []).reduce((s, t) => s + (t.items || []).length, 0);
  document.getElementById("statNews").textContent = news;
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
        <button class="tr-idea-btn" onclick="ideaFromTrend(${i})">💡 ปั้นคอนเทนต์</button>
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

/* ── Section 2: topic tabs + news ── */
function renderTopicTabs() {
  const tabs = document.getElementById("topicTabs");
  const topics = LAST.topics || [];
  tabs.innerHTML = topics.map((t, i) => {
    const emoji = (TOPICS.find(x => x.label === t.label) || {}).emoji || "📰";
    return `<button class="tr-tab ${i === ACTIVE_TAB ? "active" : ""}" onclick="selectTab(${i})">
      ${esc(emoji)} ${esc(t.label)} <span class="tr-tab-count">${(t.items || []).length}</span>
    </button>`;
  }).join("");
}
function selectTab(i) {
  ACTIVE_TAB = i;
  renderTopicTabs();
  renderTopicNews();
}
function renderTopicNews() {
  const wrap = document.getElementById("topicNews");
  const topics = LAST.topics || [];
  const t = topics[ACTIVE_TAB];
  if (!t) { wrap.innerHTML = `<div class="tr-empty">ยังไม่มีหัวข้อ — เพิ่มที่ ⚙️ จัดการหัวข้อ</div>`; return; }
  const items = t.items || [];
  if (!items.length) {
    wrap.innerHTML = `<div class="tr-empty">ไม่พบข่าวสำหรับ "${esc(t.label)}" ลองปรับคำค้นให้กว้างขึ้น</div>`;
    return;
  }
  wrap.innerHTML = items.map((n, idx) => `
    <div class="tr-news-item">
      <div class="tr-news-main">
        <a class="tr-news-title" href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a>
        <div class="tr-news-meta">
          ${n.source ? `<span class="tr-news-src">${esc(n.source)}</span>` : ""}
          ${n.pubDate ? `<span class="tr-news-time">· ${esc(timeAgo(n.pubDate))}</span>` : ""}
        </div>
      </div>
      <button class="tr-idea-btn sm" onclick="ideaFromNews(${ACTIVE_TAB}, ${idx})">💡 ปั้น</button>
    </div>`).join("");
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
    <div class="tr-manage-row">
      <input class="tr-input tr-mini" value="${esc(t.emoji || "🔎")}" maxlength="2" oninput="editTopic(${i},'emoji',this.value)" />
      <input class="tr-input" value="${esc(t.label)}" placeholder="ชื่อหัวข้อ" oninput="editTopic(${i},'label',this.value)" />
      <input class="tr-input" value="${esc(t.query)}" placeholder="คำค้น" oninput="editTopic(${i},'query',this.value)" />
      <button class="tr-del" title="ลบ" onclick="removeTopic(${i})">🗑</button>
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
    .map((t, i) => ({ ...t, label: (t.label || "").trim(), query: (t.query || "").trim(), sort: i + 1 }))
    .filter(t => t.label && t.query);
  if (!clean.length) return showToast("ต้องมีอย่างน้อย 1 หัวข้อ", "error");

  if (TOPICS_FROM_DB) {
    try {
      // sync แบบง่าย: ลบทั้งหมดแล้ว insert ใหม่ (จำนวนหัวข้อน้อย)
      await sbFetch("trend_topics", "?id=gt.0", { method: "DELETE" });
      await sbFetch("trend_topics", "", {
        method: "POST",
        body: clean.map(t => ({
          label: t.label, query: t.query, emoji: t.emoji || "🔎", sort: t.sort, is_active: true,
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

/* ══ Init ══ */
async function initPage() {
  document.getElementById("loadingOverlay").style.display = "none";
  await loadTopics();
  document.getElementById("statTopics").textContent = TOPICS.length;
  await refreshAll();
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initPage);
else initPage();
