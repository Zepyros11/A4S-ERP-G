/* ============================================================
   campaign-register.js — Public campaign registration (no login)
   ใช้ anon key จาก register-config.js (window.REGISTER_CONFIG)
   privacy = public_token ในลิงก์ (?t=...)
============================================================ */

const SB_URL = localStorage.getItem("sb_url") || window.REGISTER_CONFIG?.sb_url || "";
const SB_KEY = localStorage.getItem("sb_key") || window.REGISTER_CONFIG?.sb_key || "";

const PLAT_META = {
  tiktok: { icon: "🎵", label: "TikTok", ph: "https://tiktok.com/@..." },
  instagram: { icon: "📸", label: "Instagram", ph: "https://instagram.com/..." },
  facebook: { icon: "👍", label: "Facebook", ph: "https://facebook.com/..." },
};

let campaign = null;
let missions = [];
let participant = null; // หลังลงทะเบียน

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
async function init() {
  const token = new URLSearchParams(location.search).get("t");
  if (!token) return closed("🔗", "ลิงก์ไม่ถูกต้อง");
  try {
    const rows = await sbGet(`campaigns?public_token=eq.${encodeURIComponent(token)}&select=*&limit=1`);
    campaign = (rows || [])[0];
    if (!campaign) return closed("❓", "ไม่พบแคมเปญนี้");
    if (!campaign.reg_open) return closed("🔒", "แคมเปญนี้ปิดรับลงทะเบียนแล้ว");
    if (campaign.status === "CANCELLED") return closed("❌", "แคมเปญนี้ถูกยกเลิก");
    if (campaign.status === "ENDED") return closed("🏁", "แคมเปญนี้จบแล้ว");

    missions = await sbGet(`campaign_missions?campaign_id=eq.${campaign.campaign_id}&select=*&order=sort_order.asc,mission_id.asc`);
    renderCampaign();
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
          : `<img class="reg-media-item" src="${esc(m.url)}" alt="" loading="lazy" />`,
      )
      .join("")}</div>`;
  } else if (campaign.cover_url) {
    hc.innerHTML = `<img class="reg-cover" src="${esc(campaign.cover_url)}" alt="" />`;
  } else {
    hc.innerHTML = `<div class="reg-cover reg-cover-ph">🚀</div>`;
  }
  document.getElementById("cName").textContent = campaign.name;
  const dates = campaign.start_date || campaign.end_date ? `📅 ${fmtDMY(campaign.start_date) || "—"} – ${fmtDMY(campaign.end_date) || "—"}` : "";
  const plats = (campaign.platforms || []).map((p) => `${PLAT_META[p]?.icon || ""} ${PLAT_META[p]?.label || p}`).join(" · ");
  document.getElementById("cMeta").innerHTML = `${dates ? `<span>${dates}</span>` : ""}${plats ? `<span>${plats}</span>` : ""}`;
  document.getElementById("cDesc").textContent = campaign.description || "";
  if (campaign.reward) {
    const r = document.getElementById("cReward");
    r.textContent = "🎁 ของรางวัล: " + campaign.reward;
    show("cReward", true);
  }

  // missions
  if (missions.length) {
    show("missionsCard", true);
    document.getElementById("missionsList").innerHTML = missions
      .map(
        (m, i) => `<div class="mission-item">
        <div class="num">${i + 1}</div>
        <div>
          <div class="mt">${esc(m.title)}</div>
          ${m.description ? `<div class="md">${esc(m.description)}</div>` : ""}
          <div class="mtag">${m.platform ? (PLAT_META[m.platform]?.icon || "") + " " + (PLAT_META[m.platform]?.label || m.platform) : "ทุกแพลตฟอร์ม"}</div>
        </div>
      </div>`,
      )
      .join("");
  }

  // platform inputs in registration
  const platforms = campaign.platforms || ["tiktok", "instagram", "facebook"];
  document.getElementById("platforms").innerHTML = platforms
    .map((p) => {
      const meta = PLAT_META[p] || { icon: "", label: p, ph: "" };
      return `<div class="platform-block">
        <h4>${meta.icon} ${meta.label}</h4>
        <div class="reg-grid">
          <div class="fg"><label>ID / Username</label><input id="r_${p}_id" placeholder="@username" /></div>
          <div class="fg"><label>ลิงก์โปรไฟล์</label><input id="r_${p}_url" placeholder="${meta.ph}" /></div>
        </div>
      </div>`;
    })
    .join("");

  // work submission selects
  document.getElementById("wMission").innerHTML =
    `<option value="">— ไม่ระบุ —</option>` + missions.map((m) => `<option value="${m.mission_id}">${esc(m.title)}</option>`).join("");
  document.getElementById("wPlatform").innerHTML = platforms
    .map((p) => `<option value="${p}">${PLAT_META[p]?.icon || ""} ${PLAT_META[p]?.label || p}</option>`)
    .join("");
}

// ── MEMBER LOOKUP ─────────────────────────────────────────
// ⚠️ ยืนยันตัวตน "ตอน submit" ด้วยรหัสผ่านเท่านั้น — ไม่ echo ชื่อ/เบอร์
//    ก่อนยืนยัน (กัน PII oracle: ไล่เดา member_code เก็บชื่อ/เบอร์)
async function lookupMember(code) {
  const sel = "member_code,member_name,full_name,phone,password_hash";
  let rows = await sbGet(`members?member_code=eq.${encodeURIComponent(code)}&select=${sel}&limit=1`).catch(() => []);
  if (!rows || !rows.length)
    rows = await sbGet(`test_members?member_code=eq.${encodeURIComponent(code)}&select=${sel}&limit=1`).catch(() => []);
  return (rows || [])[0] || null;
}
function regMsg(html) {
  const el = document.getElementById("rMsg");
  if (el) el.innerHTML = html ? `<div class="lookup-hit no">${html}</div>` : "";
}

// ── REGISTER ──────────────────────────────────────────────
async function doRegister() {
  const code = document.getElementById("rCode").value.trim();
  const pass = document.getElementById("rPass").value;
  regMsg("");
  if (!code) { regMsg("กรุณากรอกรหัสสมาชิก"); return toast("กรุณากรอกรหัสสมาชิก", "error"); }
  if (!pass) { regMsg("กรุณากรอกรหัสผ่าน"); return toast("กรุณากรอกรหัสผ่าน", "error"); }

  const btn = document.getElementById("btnRegister");
  btn.disabled = true;
  try {
    // members-only → ต้องเจอใน members/test_members
    const m = await lookupMember(code);
    if (!m) {
      regMsg("❌ ไม่พบรหัสสมาชิกนี้ — แคมเปญนี้สำหรับสมาชิกเท่านั้น");
      btn.disabled = false;
      return;
    }
    // ── ยืนยันรหัสผ่าน (mirror register.html — SHA-256 ทางเดียว) ──
    if (!window.ERPCrypto) { regMsg("ระบบยังไม่พร้อม ลองรีเฟรชหน้า"); btn.disabled = false; return; }
    if (!m.password_hash) { regMsg("❌ สมาชิกยังไม่ได้ตั้งรหัสผ่าน — ติดต่อแอดมิน"); btn.disabled = false; return; }
    const inputHash = await ERPCrypto.hash(pass);
    if (inputHash !== m.password_hash) {
      regMsg("❌ รหัสผ่านไม่ถูกต้อง");
      toast("รหัสผ่านไม่ถูกต้อง", "error");
      btn.disabled = false;
      return;
    }
    // identity ยืนยันแล้ว → ปลอดภัยที่จะใช้ชื่อ/เบอร์ของสมาชิก
    const platforms = campaign.platforms || [];
    const socials = {};
    platforms.forEach((p) => {
      socials[`${p === "instagram" ? "ig" : p === "facebook" ? "facebook" : "tiktok"}_id`] =
        (document.getElementById(`r_${p}_id`)?.value || "").trim() || null;
      socials[`${p === "instagram" ? "ig" : p === "facebook" ? "facebook" : "tiktok"}_url`] =
        (document.getElementById(`r_${p}_url`)?.value || "").trim() || null;
    });

    const payload = {
      campaign_id: campaign.campaign_id,
      member_code: code,
      member_name: m.full_name || m.member_name || code,
      phone: document.getElementById("rPhone").value.trim() || m.phone || null,
      source: "public",
      status: "pending",
      ...socials,
    };

    const rows = await sbSend(
      "campaign_participants?on_conflict=campaign_id,member_code",
      payload,
      { upsert: true },
    );
    participant = (rows || [])[0];
    regMsg("");
    toast("ลงทะเบียนสำเร็จ! 🎉 ส่งลิงก์ผลงานได้เลย", "success");

    // reveal work card, lock registration
    document.getElementById("btnRegister").textContent = "✅ ลงทะเบียนแล้ว (อัปเดตข้อมูลได้)";
    document.getElementById("btnRegister").disabled = false;
    show("workCard", true);
    await loadMyWork();
    document.getElementById("workCard").scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    regMsg("ลงทะเบียนไม่สำเร็จ: " + esc(e.message));
    toast("ลงทะเบียนไม่สำเร็จ: " + e.message, "error");
    btn.disabled = false;
  }
}

// ── WORK SUBMISSION ───────────────────────────────────────
async function loadMyWork() {
  if (!participant) return;
  try {
    const rows = await sbGet(
      `campaign_submissions?participant_id=eq.${participant.participant_id}&select=*&order=submitted_at.desc`,
    );
    const el = document.getElementById("workList");
    if (!rows || !rows.length) {
      el.innerHTML = `<div style="font-size:13px;color:var(--text3)">ยังไม่มีผลงานที่ส่ง</div>`;
      return;
    }
    const stLbl = { pending: "⏳ รอตรวจ", approved: "✅ อนุมัติ", rejected: "❌ ไม่ผ่าน" };
    el.innerHTML = rows
      .map(
        (s) => `<div class="work-item">
        <span>${PLAT_META[s.platform]?.icon || ""} <a href="${esc(safeHref(s.post_url))}" target="_blank" rel="noopener">${esc(s.post_url)}</a></span>
        <span style="white-space:nowrap">${stLbl[s.status] || s.status}</span>
      </div>`,
      )
      .join("");
  } catch (e) {
    /* เงียบ */
  }
}
async function doSubmitWork() {
  if (!participant) return toast("ลงทะเบียนก่อน", "error");
  const url = document.getElementById("wUrl").value.trim();
  if (!url) return toast("ใส่ลิงก์โพสต์", "error");
  try {
    await sbSend("campaign_submissions", {
      campaign_id: campaign.campaign_id,
      participant_id: participant.participant_id,
      mission_id: document.getElementById("wMission").value ? +document.getElementById("wMission").value : null,
      platform: document.getElementById("wPlatform").value,
      post_url: url,
      status: "pending",
    });
    document.getElementById("wUrl").value = "";
    toast("ส่งผลงานแล้ว ✅", "success");
    await loadMyWork();
  } catch (e) {
    toast("ส่งไม่สำเร็จ: " + e.message, "error");
  }
}

window.doRegister = doRegister;
window.doSubmitWork = doSubmitWork;
document.addEventListener("DOMContentLoaded", init);
