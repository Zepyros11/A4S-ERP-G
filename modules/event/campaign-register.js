/* ============================================================
   campaign-register.js — Public campaign registration (no login)
   ใช้ anon key จาก register-config.js (window.REGISTER_CONFIG)
   privacy = public_token ในลิงก์ (?t=...)
============================================================ */

const SB_URL = localStorage.getItem("sb_url") || window.REGISTER_CONFIG?.sb_url || "";
const SB_KEY = localStorage.getItem("sb_key") || window.REGISTER_CONFIG?.sb_key || "";

let campaign = null;

// 3 ช่องทางโซเชียล — col_url/col_img = ชื่อคอลัมน์ใน campaign_participants,
// rwkey = key ใน campaigns.rewards (JSONB)
const SOCIALS = [
  { key: "facebook",  ic: "../../assets/icons/facebook.png",  label: "Facebook",  col_url: "facebook_url", col_img: "facebook_img", rwkey: "facebook", ph: "https://facebook.com/..." },
  { key: "tiktok",    ic: "../../assets/icons/tiktok.png",    label: "TikTok",    col_url: "tiktok_url",   col_img: "tiktok_img",   rwkey: "tiktok",   ph: "https://tiktok.com/@..." },
  { key: "instagram", ic: "../../assets/icons/instagram.png", label: "Instagram", col_url: "ig_url",       col_img: "ig_img",       rwkey: "ig",       ph: "https://instagram.com/..." },
];
const RW_METRIC_LABEL = { views: "ยอดวิว", likes: "ยอดไลค์", comments: "คอมเมนต์", shares: "แชร์", engagement: "การมีส่วนร่วม" };
const RW_METRIC_KEYS = ["views", "likes", "comments", "shares"];
function metricUnitLabel(m) {
  let arr = Array.isArray(m) ? m : (m === "engagement" ? ["likes", "comments", "shares"] : (RW_METRIC_KEYS.includes(m) ? [m] : []));
  arr = arr.filter((k) => RW_METRIC_KEYS.includes(k));
  return arr.length ? arr.map((k) => RW_METRIC_LABEL[k]).join(" + ") : "ยอด";
}
const socIcon = (s) => `<img class="soc-ic" src="${s.ic}" alt="${s.label}" />`;

// ของรางวัลแบบตาราง matrix — อันดับอยู่คอลัมน์ซ้าย (แสดงครั้งเดียว) · ช่องทางเป็นคอลัมน์ขวา
function renderRewardTiers() {
  const rEl = document.getElementById("cReward");
  if (!rEl) return;
  const rw = (campaign.rewards && typeof campaign.rewards === "object") ? campaign.rewards : {};
  const unit = metricUnitLabel(rw.metric);

  // รวบรวมช่องทางที่มีรางวัล (แต่ละช่องทาง = 1 คอลัมน์)
  let channels = [];
  if (rw.combine_channels && rw.channels && rw.channels.all) {
    // รวมยอดทุกช่องทาง → รางวัลชุดเดียว (คอลัมน์เดียว ไม่มีหัวช่องทาง)
    const tiers = (Array.isArray(rw.channels.all.tiers) ? rw.channels.all.tiers : [])
      .filter((t) => t && ((t.prize || "").trim() || t.prize_img));
    if (tiers.length) channels = [{ social: null, tiers }];
  } else if (rw.channels && typeof rw.channels === "object") {
    channels = SOCIALS.map((s) => {
      const ch = rw.channels[s.rwkey];
      if (!ch || !ch.enabled) return null;
      const tiers = (Array.isArray(ch.tiers) ? ch.tiers : []).filter((t) => t && ((t.prize || "").trim() || t.prize_img));
      return tiers.length ? { social: s, tiers } : null;
    }).filter(Boolean);
  } else if (Array.isArray(rw.tiers)) {
    const tiers = rw.tiers.filter((t) => t && ((t.prize || "").trim() || t.prize_img));
    if (tiers.length) channels = [{ social: null, tiers }];
  }
  if (!channels.length) return;

  // แถวอันดับ = union ของทุกช่องทาง (เรียงตาม rank_from · แสดงครั้งเดียวด้านซ้าย)
  const rf = (t) => +t.rank_from || 1;
  const rt = (t) => Math.max(rf(t), +t.rank_to || rf(t));
  const key = (t) => `${rf(t)}-${rt(t)}`;
  const isTopN = (rw.mode || "ranked") === "topn";
  const label = (t) => isTopN
    ? `${rt(t)} อันดับ`
    : (rf(t) === rt(t) ? `อันดับ ${rf(t)}` : `อันดับ ${rf(t)}–${rt(t)}`);
  // คำนับหน่วยท้ายตัวเลข (ไลค์/วิว/คอมเมนต์/แชร์) — ใช้เมื่อเลือกเมตริกเดียว
  const COUNT_WORD = { views: "วิว", likes: "ไลค์", comments: "คอมเมนต์", shares: "แชร์" };
  const metricKeys = Array.isArray(rw.metric)
    ? rw.metric
    : (rw.metric === "engagement" ? ["likes", "comments", "shares"] : (rw.metric ? [rw.metric] : []));
  const countWord = metricKeys.length === 1 ? (COUNT_WORD[metricKeys[0]] || "") : "";
  const condText = (t) => (t && t.min_value != null && t.min_value !== "")
    ? `${unit} อย่างน้อย ${t.min_value}${countWord ? " " + countWord : ""}` : "";
  const rowMap = {}, rowOrder = [];
  channels.forEach((c) => c.tiers.forEach((t) => {
    const k = key(t);
    if (!rowMap[k]) { rowMap[k] = { label: label(t), rf: rf(t), cond: condText(t) }; rowOrder.push(k); }
  }));
  rowOrder.sort((a, b) => rowMap[a].rf - rowMap[b].rf);

  const measure = rw.combine_channels ? `${unit} (รวมทุกช่องทาง)` : unit;
  const rewardTitle = `<div class="reward-title">🎁 ของรางวัล <span class="reward-meta">· วัดจาก${esc(measure)}</span></div>`;

  // ── รางวัลเดียว (1 ช่องทาง × 1 อันดับ) → การ์ดสวย แทนตาราง ──
  if (channels.length === 1 && channels[0].tiers.length === 1) {
    const t = channels[0].tiers[0];
    const cond = condText(t);
    const chan = channels[0].social;
    const img = t.prize_img
      ? `<img class="rm-hero-img" src="${esc(t.prize_img)}" alt="" loading="lazy" onclick="window.openLightbox('${esc(t.prize_img)}')" />` : "";
    const prize = (t.prize || "").trim() ? `<div class="rm-hero-prize">${esc(t.prize)}</div>` : "";
    rEl.innerHTML = `${rewardTitle}
      <div class="rm-hero">
        <div class="rm-hero-badges">
          <span class="rm-badge rm-badge-rank">🏆 ${esc(rowMap[rowOrder[0]].label)}</span>
          ${chan ? `<span class="rm-badge rm-badge-chan">${socIcon(chan)} ${esc(chan.label)}</span>` : ""}
          ${cond ? `<span class="rm-badge rm-badge-cond">✅ ${esc(cond)}</span>` : ""}
        </div>
        ${img}
        ${prize}
      </div>`;
    show("cReward", true);
    return;
  }

  // รางวัลของช่องทาง × อันดับ (topn: เงื่อนไขขั้นต่ำย้ายไปแสดงใต้อันดับ · ranked: อยู่ในเซลล์)
  const cellHtml = (c, k) => {
    const t = c.tiers.find((x) => key(x) === k);
    if (!t) return "—";
    const cond = (!isTopN && t.min_value != null && t.min_value !== "")
      ? `<div class="rm-cond">${esc(condText(t))}</div>` : "";
    const img = t.prize_img
      ? `<img class="rm-img" src="${esc(t.prize_img)}" alt="" loading="lazy" onclick="window.openLightbox('${esc(t.prize_img)}')" />` : "";
    const txt = (t.prize || "").trim() ? `<b>${esc(t.prize)}</b>` : "";
    return `${txt}${img}${cond}`;
  };

  const hasChanHeader = channels.some((c) => c.social);
  let cells = "";
  if (hasChanHeader) {
    cells += `<div class="rm-corner"></div>`;
    channels.forEach((c) => {
      cells += `<div class="rm-chan">${c.social ? socIcon(c.social) + " " + esc(c.social.label) : ""}</div>`;
    });
  }
  rowOrder.forEach((k) => {
    const condHtml = (isTopN && rowMap[k].cond)
      ? `<div class="rm-rank-cond">${esc(rowMap[k].cond)}</div>` : "";
    cells += `<div class="rm-rank"><span class="rm-rank-lbl">🏆 ${esc(rowMap[k].label)}</span>${condHtml}</div>`;
    channels.forEach((c) => { cells += `<div class="rm-cell">${cellHtml(c, k)}</div>`; });
  });

  const cols = `auto repeat(${channels.length}, minmax(0,1fr))`;
  rEl.innerHTML =
    `${rewardTitle}
     <div class="reward-matrix" style="grid-template-columns:${cols}">${cells}</div>`;
  show("cReward", true);
}
const socialImg = {};   // key -> File (รูปใหม่ที่เลือก ยังไม่ upload)
const existingImg = {}; // key -> URL (รูปเดิมตอนแก้ไข — ไม่ต้องอัปใหม่ถ้าไม่เปลี่ยน)

// ── REST helpers ──────────────────────────────────────────
async function sbGet(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
  });
  if (!res.ok) throw new Error(`โหลดข้อมูลไม่สำเร็จ (${res.status})`);
  return res.json();
}
async function sbSend(path, body, { method = "POST", upsert = false } = {}) {
  const prefer = ["return=representation"];
  if (upsert) prefer.push("resolution=merge-duplicates");
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: prefer.join(","),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || `Error ${res.status}`);
  }
  return res.json().catch(() => null);
}

function toast(msg, type = "success") {
  const t = document.getElementById("toast");
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove("show"), 3200);
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}
/* อนุญาตเฉพาะ http/https — กัน javascript:/data: URL */
function safeHref(u) {
  try {
    const p = new URL(String(u ?? ""), location.origin).protocol;
    return p === "http:" || p === "https:" ? String(u) : "#";
  } catch {
    return "#";
  }
}
function fmtDMY(d) {
  if (!d) return "";
  const s = String(d).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}
function show(id, on) {
  document.getElementById(id).classList.toggle("hidden", !on);
}

// ── INIT ──────────────────────────────────────────────────
// ── company logo จาก app_settings (cache localStorage + fallback A4S) ──
async function loadLogo() {
  try {
    const cached = (localStorage.getItem("company_logo_url") || "").trim();
    if (cached) document.querySelectorAll(".js-company-logo").forEach((img) => (img.src = cached));
  } catch (e) {}
  try {
    const rows = await sbGet("app_settings?select=value&key=eq.company_logo_url");
    const u = (rows && rows[0] && rows[0].value || "").trim();
    if (u) {
      try { localStorage.setItem("company_logo_url", u); } catch (e) {}
      document.querySelectorAll(".js-company-logo").forEach((img) => (img.src = u));
    }
  } catch (e) {}
}

async function init() {
  loadLogo();
  const token = new URLSearchParams(location.search).get("t");
  if (!token) return closed("🔗", "ลิงก์ไม่ถูกต้อง");
  try {
    const rows = await sbGet(`campaigns?public_token=eq.${encodeURIComponent(token)}&select=*&limit=1`);
    campaign = (rows || [])[0];
    if (!campaign) return closed("❓", "ไม่พบแคมเปญนี้");
    if (campaign.status === "CANCELLED") return closed("❌", "แคมเปญนี้ถูกยกเลิก");
    // โหมดทดสอบ (ตั้งจากหลังบ้าน) → เปิดให้ลงทะเบียนได้ทุกเวลา ข้ามการเช็คด้านล่าง
    if (!campaign.test_mode) {
      if (!campaign.reg_open) return closed("🔒", "แคมเปญนี้ปิดรับลงทะเบียนแล้ว");
      if (campaign.status === "ENDED") return closed("🏁", "แคมเปญนี้จบแล้ว");
      // ช่วงเวลากิจกรรม (อ้างอิงเวลาไทย Asia/Bangkok +07:00)
      const startMs = campaign.start_date ? Date.parse(campaign.start_date + "T00:00:00+07:00") : null;
      const endMs = campaign.end_date ? Date.parse(campaign.end_date + "T23:59:59+07:00") : null;
      const now = Date.now();
      if (startMs && now < startMs) return closed("⏳", `ยังไม่ถึงเวลาเปิดลงทะเบียน · เริ่ม ${fmtDMY(campaign.start_date)}`);
      if (endMs && now > endMs) return closed("🏁", "หมดเวลากิจกรรมแล้ว — ปิดรับลงทะเบียน");
    }

    renderCampaign();
    setupCodeLookup();
    show("stateLoading", false);
    show("content", true);
    if (campaign.test_mode) {
      const card = document.getElementById("regCard");
      if (card && !document.getElementById("testModeBanner")) {
        const b = document.createElement("div");
        b.id = "testModeBanner";
        b.className = "reg-testmode-banner";
        b.textContent = "🧪 โหมดทดสอบ — เปิดให้ทดสอบลงทะเบียนนอกช่วงเวลากิจกรรม";
        card.insertBefore(b, card.firstChild);
      }
    }
  } catch (e) {
    closed("⚠️", "เกิดข้อผิดพลาด: " + e.message);
  }
}
function closed(icon, msg) {
  document.getElementById("closedIcon").textContent = icon;
  document.getElementById("closedMsg").textContent = msg;
  show("stateLoading", false);
  show("stateClosed", true);
}

function renderCampaign() {
  // hero — สื่อแคมเปญแสดงเป็น gallery 3 คอลัมน์ (รูป/วิดีโอ ≤5)
  const hc = document.getElementById("heroCover");
  const media = Array.isArray(campaign.media) ? campaign.media.filter((m) => m && m.url) : [];
  if (media.length) {
    hc.innerHTML = `<div class="reg-media-grid">${media
      .slice(0, 6)
      .map((m) =>
        m.type === "video"
          ? `<video class="reg-media-item" src="${esc(m.url)}" controls playsinline></video>`
          : `<img class="reg-media-item" src="${esc(m.url)}" alt="" loading="lazy" onclick="window.openLightbox('${esc(m.url)}')" />`,
      )
      .join("")}</div>`;
  } else if (campaign.cover_url) {
    hc.innerHTML = `<img class="reg-cover" src="${esc(campaign.cover_url)}" alt="" style="cursor:zoom-in" onclick="window.openLightbox('${esc(campaign.cover_url)}')" />`;
  } else {
    hc.innerHTML = `<div class="reg-cover reg-cover-ph">🚀</div>`;
  }
  document.getElementById("cName").textContent = campaign.name;
  // โชว์ชื่อแคมเปญบนแถบหัว (แทนข้อความตายตัว)
  if (campaign.name) {
    document.getElementById("regBrandMain").textContent = campaign.name;
    document.getElementById("regBrandSub").textContent = "ลงทะเบียนแคมเปญ · Campaign Registration";
    document.title = `${campaign.name} — ลงทะเบียนแคมเปญ`;
  }
  const dates = campaign.start_date || campaign.end_date ? `📅 ${fmtDMY(campaign.start_date) || "—"} – ${fmtDMY(campaign.end_date) || "—"}` : "";
  document.getElementById("cMeta").innerHTML = dates ? `<span>${dates}</span>` : "";
  document.getElementById("cDesc").textContent = campaign.description || "";
  startCountdown();

  // ของรางวัล (Tier Builder: ช่วงอันดับ + เงื่อนไขขั้นต่ำ + ของรางวัล)
  renderRewardTiers();

  // เงื่อนไขการเข้าร่วม (1 บรรทัด = 1 ข้อ)
  const terms = (campaign.terms || "")
    .split("\n")
    .map((t) => t.replace(/^[\s•\-*]+/, "").trim())
    .filter(Boolean);
  if (terms.length) {
    document.getElementById("termsList").innerHTML = terms.map((t) => `<li>${esc(t)}</li>`).join("");
    show("termsCard", true);
  }

  renderSocials();
  renderCustomFields();
}

// ── CUSTOM FIELDS (campaigns.register_fields) ──────────────
const CF_CHOICE_TYPES = ["dropdown", "radio", "checkbox"];

function renderCustomFields() {
  const wrap = document.getElementById("customFields");
  if (!wrap) return;
  const fields = Array.isArray(campaign.register_fields) ? campaign.register_fields : [];
  if (!fields.length) { wrap.innerHTML = ""; return; }
  wrap.innerHTML =
    `<div class="social-section" style="margin-top:14px">
      <div class="social-section-title">ข้อมูลเพิ่มเติม</div>
      ${fields.map(renderOneField).join("")}
    </div>`;
}
function renderOneField(f) {
  const id = `cf_${f.id}`;
  const req = f.required ? ` <span class="req">*</span>` : "";
  const label = `<label>${esc(f.label)}${req}</label>`;
  const opts = Array.isArray(f.options) ? f.options : [];
  let input;
  if (f.type === "textarea") {
    input = `<textarea id="${id}" rows="3"></textarea>`;
  } else if (f.type === "dropdown") {
    input = `<select id="${id}"><option value="">— เลือก —</option>${opts
      .map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}</select>`;
  } else if (f.type === "radio") {
    input = `<div class="cf-choices" id="${id}">${opts
      .map((o) => `<label class="cf-choice"><input type="radio" name="${id}" value="${esc(o)}" /> ${esc(o)}</label>`).join("")}</div>`;
  } else if (f.type === "checkbox") {
    input = `<div class="cf-choices" id="${id}">${opts
      .map((o) => `<label class="cf-choice"><input type="checkbox" value="${esc(o)}" /> ${esc(o)}</label>`).join("")}</div>`;
  } else {
    input = `<input id="${id}" />`;
  }
  return `<div class="fg">${label}${input}</div>`;
}
function collectCustomAnswers() {
  const fields = Array.isArray(campaign.register_fields) ? campaign.register_fields : [];
  const answers = {};
  for (const f of fields) {
    const id = `cf_${f.id}`;
    let val;
    if (f.type === "checkbox") {
      const box = document.getElementById(id);
      val = box ? [...box.querySelectorAll("input:checked")].map((c) => c.value) : [];
    } else if (f.type === "radio") {
      const box = document.getElementById(id);
      const c = box ? box.querySelector("input:checked") : null;
      val = c ? c.value : "";
    } else {
      const el = document.getElementById(id);
      val = el ? el.value.trim() : "";
    }
    const empty = Array.isArray(val) ? !val.length : !val;
    if (f.required && empty) return { error: `กรุณากรอก “${f.label}”` };
    if (!empty) answers[f.id] = val;
  }
  return { answers };
}

// ── SOCIAL CHANNELS (URL + รูป) ────────────────────────────
function renderSocials() {
  const wrap = document.getElementById("socials");
  wrap.innerHTML = SOCIALS.map(
    (s) => `<div class="social-block" data-key="${s.key}">
      <div class="social-head">${socIcon(s)} ${s.label}</div>
      <div class="social-fields">
        <div class="fg fg-link">
          <label>ลิงก์โพสต์เท่านั้น</label>
          <input id="u_${s.key}" placeholder="${s.ph}" oninput="window.onSocialUrl('${s.key}')" />
        </div>
        <div class="fg fg-img">
          <label>รูป <span class="req plat-req hidden" id="rq_${s.key}">*</span></label>
          <div class="img-drop disabled" id="drop_${s.key}" onclick="window.tryPickSocialImg('${s.key}')">
            <span class="img-drop-ph">📷</span>
            <img class="img-prev hidden" id="prev_${s.key}" alt="" />
            <button type="button" class="img-rm hidden" id="rm_${s.key}" onclick="event.stopPropagation();window.removeSocialImg('${s.key}')">✕</button>
          </div>
          <input type="file" accept="image/*" id="f_${s.key}" class="hidden" onchange="window.onSocialImg('${s.key}',this)" />
        </div>
      </div>
    </div>`,
  ).join("");

  // drag & drop รูปลงแต่ละช่อง
  SOCIALS.forEach((s) => {
    const drop = document.getElementById(`drop_${s.key}`);
    ["dragenter", "dragover"].forEach((ev) =>
      drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("dragover"); }),
    );
    ["dragleave", "drop"].forEach((ev) =>
      drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("dragover"); }),
    );
    drop.addEventListener("drop", (e) => {
      const url = (document.getElementById(`u_${s.key}`)?.value || "").trim();
      if (!url) { toast("กรุณากรอกลิงก์ของช่องทางนี้ก่อนแนบรูป", "warning"); return; }
      const f = e.dataTransfer?.files?.[0];
      if (f && f.type.startsWith("image/")) setSocialImg(s.key, f);
    });
  });
}
// คลิกช่องรูป — ต้องมีลิงก์ก่อน ถึงเปิดเลือกไฟล์ได้
window.tryPickSocialImg = function (key) {
  const url = (document.getElementById(`u_${key}`)?.value || "").trim();
  if (!url) {
    toast("กรุณากรอกลิงก์ของช่องทางนี้ก่อนแนบรูป", "warning");
    document.getElementById(`u_${key}`)?.focus();
    return;
  }
  document.getElementById(`f_${key}`).click();
};
function markReq(key) {
  const url = (document.getElementById(`u_${key}`)?.value || "").trim();
  document.getElementById(`rq_${key}`).classList.toggle("hidden", !url);
  // ไม่มีลิงก์ → ปิดช่องรูป (กดไม่ได้) + ลบรูปที่เผลอแนบไว้
  const drop = document.getElementById(`drop_${key}`);
  if (drop) drop.classList.toggle("disabled", !url);
  if (!url && (socialImg[key] || existingImg[key])) window.removeSocialImg(key);
}
function setSocialImg(key, file) {
  socialImg[key] = file;
  delete existingImg[key];   // รูปใหม่แทนรูปเดิม
  const prev = document.getElementById(`prev_${key}`);
  prev.src = URL.createObjectURL(file);
  prev.classList.remove("hidden");
  document.getElementById(`rm_${key}`).classList.remove("hidden");
  document.getElementById(`drop_${key}`).querySelector(".img-drop-ph").classList.add("hidden");
}
window.onSocialUrl = function (key) { markReq(key); };
window.onSocialImg = function (key, input) {
  const f = input.files?.[0];
  if (f) setSocialImg(key, f);
  input.value = "";
};
window.removeSocialImg = function (key) {
  delete socialImg[key];
  delete existingImg[key];
  const prev = document.getElementById(`prev_${key}`);
  prev.src = ""; prev.classList.add("hidden");
  document.getElementById(`rm_${key}`).classList.add("hidden");
  document.getElementById(`drop_${key}`).querySelector(".img-drop-ph").classList.remove("hidden");
};

// ── ค้นหาชื่อจากรหัสสมาชิก (member_persons) ────────────────
// กรอกรหัส → popup ชื่อ (1 รหัสอาจมี 1-2 คน: primary + ผู้สมัครร่วม / บริษัท)
// เลือก → autofill ช่องชื่อ  (logic เดียวกับหน้า attendees: digits → member_code lookup)
let _codeSearchTimer = null;
let _codeSeq = 0;
function _codeSuggestEl() { return document.getElementById("codeSuggest"); }
function hideCodeSuggest() {
  const el = _codeSuggestEl();
  if (el) { el.classList.add("hidden"); el.innerHTML = ""; }
}
function lookupCodeNames() {
  const el = _codeSuggestEl();
  if (!el) return;
  clearTimeout(_codeSearchTimer);
  // strip ilike wildcards / PostgREST reserved chars แล้วรับเฉพาะรหัสตัวเลข
  const code = (document.getElementById("rCode").value || "").trim().replace(/[,()*%_\\]/g, "");
  if (!/^\d{3,}$/.test(code)) { hideCodeSuggest(); return; }
  el.classList.remove("hidden");
  el.innerHTML = `<div class="cs-info">⏳ กำลังค้นหา…</div>`;
  const seq = ++_codeSeq;
  _codeSearchTimer = setTimeout(async () => {
    try {
      const rows = await sbGet(
        `member_persons?select=member_code,person_role,person_name,position_level,is_company` +
        `&member_code=eq.${encodeURIComponent(code)}&order=person_role`,
      );
      if (seq !== _codeSeq) return;   // มีการพิมพ์ใหม่ → ผลนี้เก่าแล้ว
      renderCodeSuggest(rows || []);
    } catch (e) {
      if (seq !== _codeSeq) return;
      el.innerHTML = `<div class="cs-info cs-err">⚠️ ค้นหาไม่สำเร็จ — กรุณารีเฟรชหน้าใหม่อีกครั้ง</div>`;
    }
  }, 280);
}
function renderCodeSuggest(rows) {
  const el = _codeSuggestEl();
  if (!el) return;
  if (!rows.length) {
    const nameEl = document.getElementById("rName");
    if (nameEl) nameEl.value = "";
    el.innerHTML = `<div class="cs-info">ไม่พบรหัสนี้ — กรุณาตรวจสอบรหัสสมาชิก</div>`;
    return;
  }
  // เรียงบุคคลหลัก (primary) ขึ้นก่อนเสมอ
  rows = [...rows].sort((a, b) => (b.person_role === "primary") - (a.person_role === "primary"));
  // เติมชื่อ "บุคคลหลัก" ให้อัตโนมัติเป็นค่าเริ่มต้น (ช่องชื่อกรอกเองไม่ได้)
  const primary = rows.find((r) => r.person_role === "primary") || rows[0];
  const nameEl = document.getElementById("rName");
  if (nameEl) nameEl.value = primary.person_name || "";
  // มีคนเดียว → ปิด popup (ไม่ต้องเลือก)
  if (rows.length === 1) { hideCodeSuggest(); maybeCheckExisting(); return; }
  // หลายคน (บริษัท+ผู้สมัครร่วม) → โชว์ให้เลือก · default = บุคคลหลัก
  el.innerHTML = rows.map((m) => {
    const name = m.person_name || "—";
    const isPrimary = m.person_role === "primary";
    return `<div class="cs-row" data-name="${esc(name)}">
      <span class="cs-code">${esc(m.member_code)}</span>
      <span class="cs-name">${esc(name)}</span>
      ${isPrimary ? `<span class="cs-tag">บุคคลหลัก</span>` : ""}
    </div>`;
  }).join("");
  el.querySelectorAll(".cs-row").forEach((r) =>
    r.addEventListener("click", () => selectCodeName(r.dataset.name || "")));
}
function selectCodeName(name) {
  const nameEl = document.getElementById("rName");
  if (nameEl) nameEl.value = name;
  hideCodeSuggest();
  maybeCheckExisting();   // เลือกสมาชิกแล้ว → เช็คว่าเคยลงทะเบียนไหม
}
function setupCodeLookup() {
  const codeInput = document.getElementById("rCode");
  if (!codeInput) return;
  codeInput.addEventListener("input", () => { _softExitEditOnCodeChange(); lookupCodeNames(); });
  codeInput.addEventListener("focus", lookupCodeNames);
  codeInput.addEventListener("change", maybeCheckExisting);   // blur หลังพิมพ์ครบ → เช็คซ้ำ
  // คลิกนอกกรอบ → ปิด popup
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".fg-code")) hideCodeSuggest();
  });
  codeInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideCodeSuggest();
  });
}

// ── นับถอยหลัง (อ้างอิงเวลาไทย Asia/Bangkok +07:00) ──
let _cdTimer = null;
function renderCountdown() {
  const el = document.getElementById("cCountdown");
  if (!el || !campaign) return;
  const startMs = campaign.start_date ? Date.parse(campaign.start_date + "T00:00:00+07:00") : null;
  const endMs = campaign.end_date ? Date.parse(campaign.end_date + "T23:59:59+07:00") : null;
  const now = Date.now();
  let target, label, cls;
  if (startMs && now < startMs) { target = startMs; label = "เริ่มกิจกรรมในอีก"; cls = "cd-soon"; }
  else if (endMs && now <= endMs) { target = endMs; label = "เหลือเวลาอีก"; cls = "cd-active"; }
  else if (endMs) { el.innerHTML = `<div class="reg-cd-box cd-ended">⏱️ กิจกรรมสิ้นสุดแล้ว</div>`; return; }
  else { el.innerHTML = ""; return; }
  let diff = Math.max(0, target - now);
  const d = Math.floor(diff / 86400000); diff -= d * 86400000;
  const h = Math.floor(diff / 3600000); diff -= h * 3600000;
  const m = Math.floor(diff / 60000); diff -= m * 60000;
  const s = Math.floor(diff / 1000);
  const cell = (v, u) => `<div class="cd-cell"><span class="cd-num">${String(v).padStart(2, "0")}</span><span class="cd-unit">${u}</span></div>`;
  el.innerHTML = `<div class="reg-cd-box ${cls}">
    <span class="cd-label">⏳ ${label}</span>
    <div class="cd-grid">${cell(d, "วัน")}${cell(h, "ชม.")}${cell(m, "นาที")}${cell(s, "วิ")}</div>
  </div>`;
}
function startCountdown() {
  renderCountdown();
  if (!_cdTimer) _cdTimer = setInterval(renderCountdown, 1000);
}

// ── โหมดแก้ไข: รหัสที่เคยลงทะเบียนแล้ว → ยืนยันรหัสผ่าน → ดึงข้อมูลเดิมมาแก้ ──
let editId = null;          // participant_id ที่กำลังแก้ (null = ลงทะเบียนใหม่)
let _dupRow = null;         // แถวลงทะเบียนเดิมของรหัสนี้ (ล่าสุด)
let _dupDismissedCode = ""; // รหัสที่กด "ยกเลิก" ไปแล้ว — ไม่เด้งซ้ำจนกว่าจะเปลี่ยนรหัส

// หาแถวลงทะเบียนล่าสุดของรหัสในแคมเปญนี้
async function fetchExistingParticipant(code) {
  if (!campaign || !code) return null;
  const rows = await sbGet(
    `campaign_participants?campaign_id=eq.${campaign.campaign_id}` +
    `&member_code=eq.${encodeURIComponent(code)}&order=joined_at.desc&limit=1`,
  );
  return (rows && rows[0]) || null;
}

// ตรวจว่ารหัสนี้เคยลงทะเบียนไหม → เด้ง popup ให้เลือกแก้ไข/ยกเลิก
async function maybeCheckExisting() {
  const code = (document.getElementById("rCode").value || "").trim();
  if (!/^\d{3,}$/.test(code)) return;
  if (editId && _dupRow && _dupRow.member_code === code) return; // กำลังแก้รหัสนี้อยู่
  if (_dupDismissedCode === code) return;                         // เพิ่งกดยกเลิกไป
  try {
    const row = await fetchExistingParticipant(code);
    if (!row) return;
    _dupRow = row;
    openDupModal(code);
  } catch (e) { /* เงียบ — ไม่ขัดการลงทะเบียนปกติ */ }
}

// ออกจากโหมดแก้ไขแบบเบาๆ เมื่อผู้ใช้แก้รหัสให้ต่างจากที่ยืนยันไว้ (ไม่ล้างค่าที่พิมพ์)
function _softExitEditOnCodeChange() {
  if (!editId || !_dupRow) return;
  const cur = (document.getElementById("rCode").value || "").trim();
  if (cur === (_dupRow.member_code || "")) return;
  editId = null; _dupRow = null;
  document.getElementById("editBanner").classList.add("hidden");
  document.getElementById("btnRegister").textContent = "✅ ส่งข้อมูลลงทะเบียน";
}

function openDupModal(code) {
  const m = document.getElementById("dupModal");
  const name = (_dupRow && _dupRow.member_name) ? _dupRow.member_name : "";
  const nameHtml = name ? ` ในชื่อ <b>${esc(name)}</b>` : "";
  m.querySelector("#dupMsg").innerHTML =
    `รหัส <b>${esc(code)}</b>${nameHtml} มีการลงทะเบียนในแคมเปญนี้แล้ว ต้องการแก้ไขข้อมูลเดิมหรือไม่?`;
  m.classList.remove("hidden");
}
window.closeDupModal = function () {
  document.getElementById("dupModal").classList.add("hidden");
  // ยกเลิก → ล้างรหัส/ชื่อที่กรอก กันลงทะเบียนทับของเดิมโดยไม่ตั้งใจ
  document.getElementById("rCode").value = "";
  document.getElementById("rName").value = "";
  hideCodeSuggest();
  _dupRow = null;
  _dupDismissedCode = "";
};
window.openPwModal = function () {
  document.getElementById("dupModal").classList.add("hidden");
  const code = (_dupRow && _dupRow.member_code) || (document.getElementById("rCode").value || "").trim();
  document.getElementById("pwCode").textContent = code;
  document.getElementById("pwInput").value = "";
  pwMsg("");
  document.getElementById("pwModal").classList.remove("hidden");
  setTimeout(() => document.getElementById("pwInput").focus(), 50);
};
window.closePwModal = function () {
  document.getElementById("pwModal").classList.add("hidden");
};
function pwMsg(text) {
  const el = document.getElementById("pwMsg");
  el.textContent = text || "";
  el.classList.toggle("hidden", !text);
}

// ยืนยันรหัสผ่านสมาชิก (เทียบ password_hash / national_id_hash เหมือนหน้า register)
window.verifyEditPassword = async function () {
  const code = document.getElementById("pwCode").textContent.trim();
  const pass = document.getElementById("pwInput").value;
  if (!pass) { pwMsg("กรุณากรอกรหัสผ่าน"); return; }
  if (!window.ERPCrypto) { pwMsg("ระบบยังไม่พร้อม ลองใหม่อีกครั้ง"); return; }
  const btn = document.getElementById("pwBtn");
  btn.disabled = true; btn.textContent = "⏳ กำลังตรวจสอบ...";
  try {
    // หา member (members ก่อน · fallback test_members)
    let rows = await sbGet(`members?member_code=eq.${encodeURIComponent(code)}&select=password_hash,national_id_hash&limit=1`);
    let member = rows && rows[0];
    if (!member) {
      const tr = await sbGet(`test_members?member_code=eq.${encodeURIComponent(code)}&select=password_hash&limit=1`);
      member = tr && tr[0];
    }
    if (!member || (!member.password_hash && !member.national_id_hash)) {
      pwMsg("สมาชิกนี้ยังไม่ได้ตั้งรหัสผ่าน — ติดต่อเจ้าหน้าที่"); return;
    }
    // รับได้ทั้งรหัสผ่าน หรือเลขบัตรประชาชน (เผื่อลืมรหัสผ่าน)
    const inputHash = await ERPCrypto.hash(pass);
    let ok = !!member.password_hash && inputHash === member.password_hash;
    if (!ok && member.national_id_hash) {
      const idHash = await ERPCrypto.hash(pass.toUpperCase().replace(/[\s-]/g, ""));
      if (idHash === member.national_id_hash) ok = true;
    }
    if (!ok) {
      // ถ้าไม่มี national_id_hash → ยืนยันด้วยเลขบัตรไม่ได้ (ยังไม่ backfill) → บอกให้ชัด
      pwMsg(member.national_id_hash
        ? "รหัสผ่านหรือเลขบัตรไม่ถูกต้อง"
        : "รหัสผ่านไม่ถูกต้อง — สมาชิกนี้ยังใช้เลขบัตรยืนยันไม่ได้ กรุณาใช้รหัสผ่าน");
      return;
    }

    // ผ่าน → ดึงข้อมูลเดิมมาแสดง
    if (!_dupRow || _dupRow.member_code !== code) _dupRow = await fetchExistingParticipant(code);
    if (!_dupRow) { pwMsg("ไม่พบข้อมูลเดิม"); return; }
    populateFromParticipant(_dupRow);
    closePwModal();
    toast("ยืนยันตัวตนสำเร็จ — แก้ไขข้อมูลได้เลย", "success");
  } catch (e) {
    pwMsg("ตรวจสอบไม่สำเร็จ: " + (e.message || e));
  } finally {
    btn.disabled = false; btn.textContent = "ยืนยัน";
  }
};

// เติมข้อมูลเดิมลงฟอร์ม + เข้าโหมดแก้ไข
function populateFromParticipant(p) {
  editId = p.participant_id;
  _dupDismissedCode = "";
  document.getElementById("rCode").value = p.member_code || "";
  document.getElementById("rName").value = p.member_name || "";
  hideCodeSuggest();

  // โซเชียล: ใส่ลิงก์ + แสดงรูปเดิม (เก็บใน existingImg — ไม่ต้องอัปใหม่ถ้าไม่เปลี่ยน)
  SOCIALS.forEach((s) => {
    const url = p[s.col_url] || "";
    const img = p[s.col_img] || "";
    const uEl = document.getElementById(`u_${s.key}`);
    if (uEl) uEl.value = url;
    delete socialImg[s.key];
    if (img) { existingImg[s.key] = img; showExistingImg(s.key, img); }
    else { delete existingImg[s.key]; clearImgSlot(s.key); }
    markReq(s.key);
  });

  // คำตอบฟิลด์กำหนดเอง
  const ans = (p.custom_answers && typeof p.custom_answers === "object") ? p.custom_answers : {};
  (Array.isArray(campaign.register_fields) ? campaign.register_fields : []).forEach((f) => {
    const v = ans[f.id];
    const id = `cf_${f.id}`;
    if (f.type === "checkbox") {
      const box = document.getElementById(id);
      if (box) box.querySelectorAll("input").forEach((c) => { c.checked = Array.isArray(v) && v.includes(c.value); });
    } else if (f.type === "radio") {
      const box = document.getElementById(id);
      if (box) box.querySelectorAll("input").forEach((c) => { c.checked = (c.value === v); });
    } else {
      const el = document.getElementById(id);
      if (el) el.value = v != null ? v : "";
    }
  });

  document.getElementById("editBanner").classList.remove("hidden");
  document.getElementById("btnRegister").textContent = "💾 บันทึกการแก้ไข";
  regMsg("");
}

function showExistingImg(key, url) {
  const prev = document.getElementById(`prev_${key}`);
  prev.src = url; prev.classList.remove("hidden");
  document.getElementById(`rm_${key}`).classList.remove("hidden");
  document.getElementById(`drop_${key}`).querySelector(".img-drop-ph").classList.add("hidden");
}
function clearImgSlot(key) {
  const prev = document.getElementById(`prev_${key}`);
  if (prev) { prev.src = ""; prev.classList.add("hidden"); }
  document.getElementById(`rm_${key}`)?.classList.add("hidden");
  document.getElementById(`drop_${key}`)?.querySelector(".img-drop-ph")?.classList.remove("hidden");
}

// ออกจากโหมดแก้ไข → เคลียร์ฟอร์มกลับเป็นลงทะเบียนใหม่
window.cancelEditMode = function () {
  editId = null; _dupRow = null; _dupDismissedCode = "";
  document.getElementById("rCode").value = "";
  document.getElementById("rName").value = "";
  SOCIALS.forEach((s) => {
    const uEl = document.getElementById(`u_${s.key}`); if (uEl) uEl.value = "";
    delete socialImg[s.key]; delete existingImg[s.key];
    clearImgSlot(s.key); markReq(s.key);
  });
  renderCustomFields();   // reset ฟิลด์กำหนดเองกลับว่าง
  document.getElementById("editBanner").classList.add("hidden");
  document.getElementById("btnRegister").textContent = "✅ ส่งข้อมูลลงทะเบียน";
  regMsg("");
};

function regMsg(html) {
  const el = document.getElementById("rMsg");
  if (el) el.innerHTML = html ? `<div class="lookup-hit no">${html}</div>` : "";
}
// แจ้ง error ให้ข้อความ inline + toast ตรงกันเสมอ
function regFail(msg) {
  regMsg(`❌ ${esc(msg)}`);
  toast(msg, "error");
}

// ── SUBMIT (ไม่ต้อง login) ─────────────────────────────────
async function doRegister() {
  const code = document.getElementById("rCode").value.trim();
  const name = document.getElementById("rName").value.trim();
  regMsg("");
  if (!code) return regFail("กรุณากรอกรหัส");
  if (!name) return regFail("ไม่พบชื่อจากรหัสนี้ — กรุณาตรวจสอบรหัสสมาชิก");

  // เก็บช่องทางที่ใส่ลิงก์ + ตรวจกฎ
  const filled = SOCIALS
    .map((s) => ({ ...s, url: (document.getElementById(`u_${s.key}`)?.value || "").trim() }))
    .filter((s) => s.url);

  if (!filled.length) return regFail("กรุณากรอกช่องทางโซเชียลอย่างน้อย 1 ช่องทาง");
  for (const s of filled) {
    if (safeHref(s.url) === "#") return regFail(`ลิงก์ ${s.label} ไม่ถูกต้อง (ต้องขึ้นต้น http/https)`);
    if (!socialImg[s.key] && !existingImg[s.key]) return regFail(`กรุณาแนบรูปของ ${s.label} (ช่องที่ใส่ลิงก์ต้องมีรูป)`);
  }

  // ฟิลด์กำหนดเอง — ตรวจ required + เก็บคำตอบ
  const cf = collectCustomAnswers();
  if (cf.error) return regFail(cf.error);

  const isEdit = !!editId;
  const btn = document.getElementById("btnRegister");
  btn.disabled = true;
  const oldLabel = btn.textContent;
  btn.textContent = isEdit ? "⏳ กำลังบันทึก..." : "⏳ กำลังอัปโหลด...";
  try {
    const token = campaign.public_token || campaign.campaign_id;
    const payload = isEdit
      ? { member_code: code, member_name: name, custom_answers: cf.answers }
      : { campaign_id: campaign.campaign_id, member_code: code, member_name: name,
          source: "public", status: "pending", custom_answers: cf.answers };

    // โหมดแก้ไข: เคลียร์ทุกช่องทางก่อน → ช่องที่ถูกลบจะกลายเป็น null
    if (isEdit) SOCIALS.forEach((s) => { payload[s.col_url] = null; payload[s.col_img] = null; });

    // set url/img ต่อช่องทาง — รูปใหม่ → upload · รูปเดิม → ใช้ URL เดิม
    for (const s of filled) {
      let imgUrl = existingImg[s.key] || null;
      if (socialImg[s.key]) {
        const path = `campaigns/${token}/reg/${Date.now()}_${s.key}`;
        imgUrl = await window.ImageCompressor.uploadViaRest(SB_URL, SB_KEY, "event-files", path, socialImg[s.key]);
        if (!imgUrl) throw new Error(`อัปโหลดรูป ${s.label} ไม่สำเร็จ`);
      }
      payload[s.col_url] = s.url;
      payload[s.col_img] = imgUrl;
    }

    if (isEdit) {
      await sbSend(`campaign_participants?participant_id=eq.${editId}`, payload, { method: "PATCH" });
    } else {
      await sbSend("campaign_participants", payload);
    }

    show("content", false);
    show("stateDone", true);
  } catch (e) {
    regMsg((isEdit ? "บันทึกไม่สำเร็จ: " : "ลงทะเบียนไม่สำเร็จ: ") + esc(e.message));
    toast((isEdit ? "บันทึกไม่สำเร็จ: " : "ลงทะเบียนไม่สำเร็จ: ") + e.message, "error");
    btn.disabled = false;
    btn.textContent = oldLabel;
  }
}

// ── LIGHTBOX (กดรูปขยายเต็มจอ) ─────────────────────────────
window.openLightbox = function (src) {
  document.getElementById("lightboxImg").src = src;
  document.getElementById("lightbox").classList.remove("hidden");
  document.body.style.overflow = "hidden";
};
window.closeLightbox = function () {
  document.getElementById("lightbox").classList.add("hidden");
  document.getElementById("lightboxImg").src = "";
  document.body.style.overflow = "";
};
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const pw = document.getElementById("pwModal");
  const dup = document.getElementById("dupModal");
  if (pw && !pw.classList.contains("hidden")) { window.closePwModal(); return; }
  if (dup && !dup.classList.contains("hidden")) { window.closeDupModal(); return; }
  window.closeLightbox();
});

window.doRegister = doRegister;
document.addEventListener("DOMContentLoaded", init);
