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
const RW_METRIC_LABEL = { likes: "ยอดไลค์", views: "ยอดวิว", engagement: "การมีส่วนร่วม" };
const socIcon = (s) => `<img class="soc-ic" src="${s.ic}" alt="${s.label}" />`;

// ของรางวัล per-channel (รองรับ fallback flat tiers)
function tierRowsHtml(tiers, unit) {
  return tiers
    .map((t) => {
      const rf = +t.rank_from || 1;
      const rt = Math.max(rf, +t.rank_to || rf);
      const rank = rf === rt ? `อันดับ ${rf}` : `อันดับ ${rf}–${rt}`;
      const cond = (t.min_value != null && t.min_value !== "")
        ? `<div class="reward-cond">เงื่อนไข: ${unit} ≥ ${esc(t.min_value)}</div>`
        : "";
      return `<div class="reward-tier"><div class="reward-tier-rank">🏆 ${rank}</div><div class="reward-tier-prize">${esc(t.prize)}</div>${cond}</div>`;
    })
    .join("");
}
function renderRewardTiers() {
  const rEl = document.getElementById("cReward");
  if (!rEl) return;
  const rw = (campaign.rewards && typeof campaign.rewards === "object") ? campaign.rewards : {};
  const unit = RW_METRIC_LABEL[rw.metric] || "ยอด";

  // 1 ช่องทางที่มีรางวัล = 1 คอลัมน์ (FB,TK → 2 คอลัมน์ · FB,TK,IG → 3 คอลัมน์)
  let groups = [];
  if (rw.channels && typeof rw.channels === "object") {
    groups = SOCIALS
      .map((s) => {
        const ch = rw.channels[s.rwkey];
        if (!ch || !ch.enabled) return "";
        const tiers = (Array.isArray(ch.tiers) ? ch.tiers : []).filter((t) => t && (t.prize || "").trim());
        if (!tiers.length) return "";
        return `<div class="reward-chan-group"><div class="reward-chan-title">${socIcon(s)} ${s.label}</div>${tierRowsHtml(tiers, unit)}</div>`;
      })
      .filter(Boolean);
  } else if (Array.isArray(rw.tiers)) {
    const tiers = rw.tiers.filter((t) => t && (t.prize || "").trim());
    if (tiers.length) groups = [`<div class="reward-chan-group">${tierRowsHtml(tiers, unit)}</div>`];
  }
  if (!groups.length) return;
  const cols = `<div class="reward-chan-cols" style="grid-template-columns:repeat(${groups.length},minmax(0,1fr))">${groups.join("")}</div>`;
  rEl.innerHTML =
    `<div class="reward-title">🎁 ของรางวัล <span class="reward-meta">· วัดจาก${unit}</span></div>${cols}`;
  show("cReward", true);
}
const socialImg = {}; // key -> File (รูปที่เลือก ยังไม่ upload)

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
    if (!campaign.reg_open) return closed("🔒", "แคมเปญนี้ปิดรับลงทะเบียนแล้ว");
    if (campaign.status === "CANCELLED") return closed("❌", "แคมเปญนี้ถูกยกเลิก");
    if (campaign.status === "ENDED") return closed("🏁", "แคมเปญนี้จบแล้ว");

    renderCampaign();
    setupCodeLookup();
    show("stateLoading", false);
    show("content", true);
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
          <label>ลิงก์โปรไฟล์ / โพสต์</label>
          <input id="u_${s.key}" placeholder="${s.ph}" oninput="window.onSocialUrl('${s.key}')" />
        </div>
        <div class="fg fg-img">
          <label>รูป <span class="req plat-req hidden" id="rq_${s.key}">*</span></label>
          <div class="img-drop" id="drop_${s.key}" onclick="document.getElementById('f_${s.key}').click()">
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
      const f = e.dataTransfer?.files?.[0];
      if (f && f.type.startsWith("image/")) setSocialImg(s.key, f);
    });
  });
}
function markReq(key) {
  const url = (document.getElementById(`u_${key}`)?.value || "").trim();
  document.getElementById(`rq_${key}`).classList.toggle("hidden", !url);
}
function setSocialImg(key, file) {
  socialImg[key] = file;
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
      el.innerHTML = `<div class="cs-info cs-err">⚠️ ค้นหาไม่สำเร็จ — พิมพ์ชื่อเองได้</div>`;
    }
  }, 280);
}
function renderCodeSuggest(rows) {
  const el = _codeSuggestEl();
  if (!el) return;
  if (!rows.length) {
    el.innerHTML = `<div class="cs-info">ไม่พบรหัสนี้ — พิมพ์ชื่อเองได้</div>`;
    return;
  }
  // แสดงแค่ รหัส + ชื่อ (ไม่โชว์ chip role/ตำแหน่ง — กัน popup ล้นแนวนอน)
  el.innerHTML = rows.map((m) => {
    const name = m.person_name || "—";
    return `<div class="cs-row" data-name="${esc(name)}">
      <span class="cs-code">${esc(m.member_code)}</span>
      <span class="cs-name">${esc(name)}</span>
    </div>`;
  }).join("");
  el.querySelectorAll(".cs-row").forEach((r) =>
    r.addEventListener("click", () => selectCodeName(r.dataset.name || "")));
}
function selectCodeName(name) {
  const nameEl = document.getElementById("rName");
  if (nameEl) nameEl.value = name;
  hideCodeSuggest();
}
function setupCodeLookup() {
  const codeInput = document.getElementById("rCode");
  if (!codeInput) return;
  codeInput.addEventListener("input", lookupCodeNames);
  codeInput.addEventListener("focus", lookupCodeNames);
  // คลิกนอกกรอบ → ปิด popup
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".fg-code")) hideCodeSuggest();
  });
  codeInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideCodeSuggest();
  });
}

function regMsg(html) {
  const el = document.getElementById("rMsg");
  if (el) el.innerHTML = html ? `<div class="lookup-hit no">${html}</div>` : "";
}

// ── SUBMIT (ไม่ต้อง login) ─────────────────────────────────
async function doRegister() {
  const code = document.getElementById("rCode").value.trim();
  const name = document.getElementById("rName").value.trim();
  regMsg("");
  if (!code) { regMsg("กรุณากรอกรหัส"); return toast("กรุณากรอกรหัส", "error"); }
  if (!name) { regMsg("กรุณากรอกชื่อ"); return toast("กรุณากรอกชื่อ", "error"); }

  // เก็บช่องทางที่ใส่ลิงก์ + ตรวจกฎ
  const filled = SOCIALS
    .map((s) => ({ ...s, url: (document.getElementById(`u_${s.key}`)?.value || "").trim() }))
    .filter((s) => s.url);

  if (!filled.length) {
    regMsg("❌ กรุณากรอกช่องทางโซเชียลอย่างน้อย 1 ช่องทาง");
    return toast("กรอกโซเชียลอย่างน้อย 1 ช่องทาง", "error");
  }
  for (const s of filled) {
    if (safeHref(s.url) === "#") {
      regMsg(`❌ ลิงก์ ${s.label} ไม่ถูกต้อง (ต้องขึ้นต้น http/https)`);
      return toast(`ลิงก์ ${s.label} ไม่ถูกต้อง`, "error");
    }
    if (!socialImg[s.key]) {
      regMsg(`❌ กรุณาแนบรูปของ ${s.label} (ช่องที่ใส่ลิงก์ต้องมีรูป)`);
      return toast(`แนบรูปของ ${s.label}`, "error");
    }
  }

  // ฟิลด์กำหนดเอง — ตรวจ required + เก็บคำตอบ
  const cf = collectCustomAnswers();
  if (cf.error) { regMsg(`❌ ${esc(cf.error)}`); return toast(cf.error, "error"); }

  const btn = document.getElementById("btnRegister");
  btn.disabled = true;
  const oldLabel = btn.textContent;
  btn.textContent = "⏳ กำลังอัปโหลด...";
  try {
    const token = campaign.public_token || campaign.campaign_id;
    const payload = {
      campaign_id: campaign.campaign_id,
      member_code: code,
      member_name: name,
      source: "public",
      status: "pending",
      custom_answers: cf.answers,
    };

    // upload รูป + set url/img ต่อช่องทาง
    for (const s of filled) {
      const path = `campaigns/${token}/reg/${Date.now()}_${s.key}`;
      const imgUrl = await window.ImageCompressor.uploadViaRest(SB_URL, SB_KEY, "event-files", path, socialImg[s.key]);
      if (!imgUrl) throw new Error(`อัปโหลดรูป ${s.label} ไม่สำเร็จ`);
      payload[s.col_url] = s.url;
      payload[s.col_img] = imgUrl;
    }

    await sbSend("campaign_participants", payload);

    show("content", false);
    document.getElementById("doneMsg").textContent = "ลงทะเบียนเรียบร้อยแล้ว ขอบคุณค่ะ 🎉";
    show("stateDone", true);
  } catch (e) {
    regMsg("ลงทะเบียนไม่สำเร็จ: " + esc(e.message));
    toast("ลงทะเบียนไม่สำเร็จ: " + e.message, "error");
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
  if (e.key === "Escape") window.closeLightbox();
});

window.doRegister = doRegister;
document.addEventListener("DOMContentLoaded", init);
