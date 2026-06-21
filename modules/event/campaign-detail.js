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
const PLAT_LABEL = { tiktok: "🎵 TikTok", instagram: "📸 IG", facebook: "👍 FB" };
const fmtNum = (n) => (Number(n) || 0).toLocaleString("en-US");

// ── STATE ─────────────────────────────────────────────────
let campaignId = null;
let campaign = null;
let missions = [];
let participants = [];
let submissions = [];
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
  const [camp, miss, parts, subs] = await Promise.all([
    sbFetch("campaigns", `?campaign_id=eq.${campaignId}&select=*&limit=1`),
    sbFetch("campaign_missions", `?campaign_id=eq.${campaignId}&select=*&order=sort_order.asc,mission_id.asc`),
    sbFetch("campaign_participants", `?campaign_id=eq.${campaignId}&select=*&order=joined_at.asc`),
    sbFetch("campaign_submissions", `?campaign_id=eq.${campaignId}&select=*&order=submitted_at.desc`),
  ]);
  campaign = (camp || [])[0];
  if (!campaign) throw new Error("ไม่พบแคมเปญ");
  missions = miss || [];
  participants = parts || [];
  submissions = subs || [];

  renderHeader();
  renderOverview();
  renderMissions();
  renderParticipants();
  renderSubmissions();
  document.getElementById("rankMetricSel").value = campaign.rank_metric || "views";
  renderRanking();
  refreshCounts();
}

function refreshCounts() {
  document.getElementById("nMissions").textContent = missions.length;
  document.getElementById("nParticipants").textContent = participants.length;
  document.getElementById("nSubmissions").textContent = submissions.length;
}

// ── TABS ──────────────────────────────────────────────────
window.switchTab = function (tab) {
  document.querySelectorAll(".cmp-tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  document.querySelectorAll(".cmp-pane").forEach((p) => p.classList.toggle("active", p.id === `pane-${tab}`));
};

// ── HEADER + OVERVIEW ─────────────────────────────────────
const STATUS_LABEL = { DRAFT: "📝 ร่าง", ACTIVE: "▶️ ดำเนินการ", ENDED: "✅ จบแล้ว", CANCELLED: "❌ ยกเลิก" };
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
const RW_SOC = [
  { k: "facebook", ic: "../../assets/icons/facebook.png", label: "Facebook" },
  { k: "tiktok",   ic: "../../assets/icons/tiktok.png",   label: "TikTok" },
  { k: "ig",       ic: "../../assets/icons/instagram.png", label: "Instagram" },
];
const RW_RANK = ["🥇 รางวัลที่ 1", "🥈 รางวัลที่ 2", "🥉 รางวัลที่ 3"];

function renderOverview() {
  document.getElementById("dDesc").textContent = campaign.description || "—";

  // ── ของรางวัล (JSONB แยกช่องทาง × อันดับ · fallback reward เดิม) ──
  const rewardBox = document.getElementById("dRewardBox");
  const rewards = (campaign.rewards && typeof campaign.rewards === "object") ? campaign.rewards : {};
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
window.editCampaign = function () {
  location.href = `./campaign-form.html?edit=${campaignId}`;
};

// ════════════════════════════════════════════════════════
//  MISSIONS
// ════════════════════════════════════════════════════════
function renderMissions() {
  const el = document.getElementById("missionList");
  if (!missions.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">🎯</div><div class="empty-text">ยังไม่มี Mission</div></div>`;
    return;
  }
  el.innerHTML = missions
    .map(
      (m) => `<div class="cmp-mission">
      <div class="m-body">
        <div class="m-title">${esc(m.title)}</div>
        ${m.description ? `<div class="m-desc">${esc(m.description)}</div>` : ""}
        <div class="m-tags">
          ${m.platform ? `<span class="cmp-tag">${PLAT_LABEL[m.platform] || m.platform}</span>` : `<span class="cmp-tag">ทุกแพลตฟอร์ม</span>`}
          <span class="cmp-tag">⚖️ ${m.points} points</span>
        </div>
      </div>
      <div class="m-actions">
        <div class="cmp-row-actions">
          <button class="btn-icon" data-perm="campaign_edit" onclick="window.openMissionModal(${m.mission_id})">✏️</button>
          <button class="btn-icon" data-perm="campaign_delete" onclick="window.deleteMission(${m.mission_id})">🗑</button>
        </div>
      </div>
    </div>`,
    )
    .join("");
  if (window.AuthZ) AuthZ.applyDomPerms(el);
}
window.openMissionModal = function (id = null) {
  const m = id ? missions.find((x) => x.mission_id === id) : null;
  document.getElementById("missionModalTitle").textContent = id ? "✏️ แก้ไข Mission" : "🎯 เพิ่ม Mission";
  document.getElementById("mId").value = id || "";
  document.getElementById("mTitle").value = m?.title || "";
  document.getElementById("mDesc").value = m?.description || "";
  document.getElementById("mPlatform").value = m?.platform || "";
  document.getElementById("mPoints").value = m?.points ?? 1;
  document.getElementById("missionModal").classList.add("open");
};
window.closeMissionModal = function () {
  document.getElementById("missionModal").classList.remove("open");
};
window.saveMission = async function () {
  const title = document.getElementById("mTitle").value.trim();
  if (!title) return showToast("กรุณาใส่ชื่อภารกิจ", "error");
  const id = document.getElementById("mId").value;
  const payload = {
    campaign_id: campaignId,
    title,
    description: document.getElementById("mDesc").value.trim() || null,
    platform: document.getElementById("mPlatform").value || null,
    points: parseFloat(document.getElementById("mPoints").value) || 1,
    sort_order: id ? undefined : missions.length,
  };
  showLoading(true);
  try {
    if (id) await sbFetch("campaign_missions", `?mission_id=eq.${id}`, { method: "PATCH", body: payload });
    else await sbFetch("campaign_missions", "", { method: "POST", body: payload });
    showToast("บันทึก Mission แล้ว", "success");
    closeMissionModal();
    await loadAll();
    switchTab("missions");
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};
window.deleteMission = function (id) {
  const m = missions.find((x) => x.mission_id === id);
  DeleteModal.open(`ลบ Mission "${m ? esc(m.title) : id}" ?`, async () => {
    showLoading(true);
    try {
      await sbFetch("campaign_missions", `?mission_id=eq.${id}`, { method: "DELETE" });
      showToast("ลบแล้ว", "success");
      await loadAll();
      switchTab("missions");
    } catch (e) {
      showToast("ลบไม่สำเร็จ: " + e.message, "error");
    }
    showLoading(false);
  });
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
    body.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">👥</div><div class="empty-text">ยังไม่มีผู้เข้าร่วม</div></div></td></tr>`;
    updatePartBulk();
    return;
  }
  body.innerHTML = rows
    .map((p) => {
      const soc = (ic, url, img) => {
        if (!url && !img) return `<span class="cmp-soc-cell off"><img class="soc-ic" src="${ic}" alt="" /></span>`;
        const thumb = img
          ? `<img class="cmp-soc-thumb" src="${esc(img)}" alt="" onclick="event.stopPropagation();ImgPopup.open(['${esc(img)}'])" title="ดูรูป" />`
          : "";
        const link = url
          ? `<a href="${esc(safeHref(url))}" target="_blank" rel="noopener" title="${esc(url)}"><img class="soc-ic" src="${ic}" alt="" /></a>`
          : `<span class="off"><img class="soc-ic" src="${ic}" alt="" /></span>`;
        return `<span class="cmp-soc-cell">${link}${thumb}</span>`;
      };
      const socials = `<span class="cmp-social-links">
        ${soc("../../assets/icons/facebook.png", p.facebook_url, p.facebook_img)}${soc("../../assets/icons/tiktok.png", p.tiktok_url, p.tiktok_img)}${soc("../../assets/icons/instagram.png", p.ig_url, p.ig_img)}</span>`;
      return `<tr>
        <td class="col-center"><input type="checkbox" class="part-check" value="${p.participant_id}" onclick="window.updatePartBulk()" /></td>
        <td><div style="font-weight:600">${esc(p.member_name || "—")}</div>
            <div style="font-size:11px;color:var(--text3);font-family:'IBM Plex Mono',monospace">${esc(p.member_code)}${p.phone ? " · " + esc(p.phone) : ""}</div></td>
        <td class="col-center">${socials}</td>
        <td class="col-center">${postCountFor(p.participant_id)}</td>
        <td class="col-center"><span class="cmp-tag">${p.source === "public" ? "🌐 public" : "🧑‍💼 staff"}</span></td>
        <td class="col-center">${statusPillPart(p)}</td>
        <td class="col-center">
          <div class="cmp-row-actions">
            ${p.status !== "approved" ? `<button class="btn-icon" title="อนุมัติ" data-perm="campaign_edit" onclick="window.setPartStatus(${p.participant_id},'approved')">✅</button>` : ""}
            ${p.status !== "rejected" ? `<button class="btn-icon" title="ปฏิเสธ" data-perm="campaign_edit" onclick="window.setPartStatus(${p.participant_id},'rejected')">🚫</button>` : ""}
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
  const lbl = { pending: "⏳ รอ", approved: "✅ อนุมัติ", rejected: "❌ ปฏิเสธ" }[p.status] || p.status;
  return `<span class="pstat pstat-${p.status}">${lbl}</span>`;
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
  document.getElementById("pTiktokId").value = p?.tiktok_id || "";
  document.getElementById("pTiktokUrl").value = p?.tiktok_url || "";
  document.getElementById("pIgId").value = p?.ig_id || "";
  document.getElementById("pIgUrl").value = p?.ig_url || "";
  document.getElementById("pFbId").value = p?.facebook_id || "";
  document.getElementById("pFbUrl").value = p?.facebook_url || "";
  document.getElementById("pNote").value = p?.note || "";
  document.getElementById("pLookupHit").innerHTML = "";
  document.getElementById("partModal").classList.add("open");
};
window.closePartModal = function () {
  document.getElementById("partModal").classList.remove("open");
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
    tiktok_id: document.getElementById("pTiktokId").value.trim() || null,
    tiktok_url: document.getElementById("pTiktokUrl").value.trim() || null,
    ig_id: document.getElementById("pIgId").value.trim() || null,
    ig_url: document.getElementById("pIgUrl").value.trim() || null,
    facebook_id: document.getElementById("pFbId").value.trim() || null,
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
  const f = document.getElementById("subFilterStatus").value;
  const body = document.getElementById("subBody");
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

window.openSubModal = function (id = null) {
  if (!participants.length) return showToast("ยังไม่มีผู้เข้าร่วม — เพิ่มผู้เข้าร่วมก่อน", "warning");
  const s = id ? submissions.find((x) => x.submission_id === id) : null;
  _proofFile = null;

  // populate participant select
  document.getElementById("sParticipant").innerHTML = participants
    .map((p) => `<option value="${p.participant_id}">${esc(p.member_name || p.member_code)} (${esc(p.member_code)})</option>`)
    .join("");
  // populate mission select
  document.getElementById("sMission").innerHTML =
    `<option value="">— ไม่ระบุ —</option>` +
    missions.map((m) => `<option value="${m.mission_id}">${esc(m.title)}</option>`).join("");

  document.getElementById("subModalTitle").textContent = id ? "✏️ แก้ไขผลงาน" : "📊 เพิ่มผลงาน";
  document.getElementById("sId").value = id || "";
  document.getElementById("sParticipant").value = s?.participant_id || participants[0].participant_id;
  document.getElementById("sMission").value = s?.mission_id || "";
  document.getElementById("sPlatform").value = s?.platform || (campaign.platforms || ["tiktok"])[0];
  document.getElementById("sStatus").value = s?.status || "pending";
  document.getElementById("sPostUrl").value = s?.post_url || "";
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
  const id = document.getElementById("sId").value;

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
    const status = document.getElementById("sStatus").value;
    const payload = {
      campaign_id: campaignId,
      participant_id,
      mission_id: document.getElementById("sMission").value ? +document.getElementById("sMission").value : null,
      platform: document.getElementById("sPlatform").value,
      post_url,
      views: parseInt(document.getElementById("sViews").value) || 0,
      likes: parseInt(document.getElementById("sLikes").value) || 0,
      comments: parseInt(document.getElementById("sComments").value) || 0,
      shares: parseInt(document.getElementById("sShares").value) || 0,
      status,
    };
    if (proof_url) payload.proof_url = proof_url;
    if (status === "approved") {
      payload.verified_at = new Date().toISOString();
      payload.verified_by = localStorage.getItem("user_name") || localStorage.getItem("username") || null;
    }

    if (id) await sbFetch("campaign_submissions", `?submission_id=eq.${id}`, { method: "PATCH", body: payload });
    else await sbFetch("campaign_submissions", "", { method: "POST", body: payload });

    showToast("บันทึกผลงานแล้ว", "success");
    closeSubModal();
    await loadAll();
    switchTab("submissions");
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
      switchTab("submissions");
    } catch (e) {
      showToast("ลบไม่สำเร็จ: " + e.message, "error");
    }
    showLoading(false);
  });
};

// ════════════════════════════════════════════════════════
//  RANKING
// ════════════════════════════════════════════════════════
window.renderRanking = function () {
  const metric = document.getElementById("rankMetricSel").value;
  const el = document.getElementById("rankList");
  const missionPts = {};
  missions.forEach((m) => (missionPts[m.mission_id] = Number(m.points) || 1));

  // aggregate approved submissions per participant
  const agg = {};
  participants.forEach((p) => {
    agg[p.participant_id] = { p, views: 0, likes: 0, comments: 0, shares: 0, weighted: 0, posts: 0 };
  });
  submissions
    .filter((s) => s.status === "approved" && agg[s.participant_id])
    .forEach((s) => {
      const a = agg[s.participant_id];
      a.views += +s.views || 0;
      a.likes += +s.likes || 0;
      a.comments += +s.comments || 0;
      a.shares += +s.shares || 0;
      a.posts += 1;
      const eng = (+s.likes || 0) + (+s.comments || 0) + (+s.shares || 0);
      const pts = s.mission_id ? missionPts[s.mission_id] || 1 : 1;
      a.weighted += eng * pts;
    });

  const scoreOf = (a) =>
    metric === "likes" ? a.likes : metric === "engagement" ? a.likes + a.comments + a.shares : metric === "weighted" ? a.weighted : a.views;

  let rows = Object.values(agg)
    .filter((a) => a.posts > 0)
    .sort((x, y) => scoreOf(y) - scoreOf(x));

  if (!rows.length) {
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">🏆</div><div class="empty-text">ยังไม่มีผลงานที่อนุมัติ — อันดับจะแสดงเมื่อมีผลงานอนุมัติแล้ว</div></div>`;
    return;
  }
  const metricLabel = { views: "วิว", likes: "Like", engagement: "Eng.", weighted: "คะแนน" }[metric];
  el.innerHTML = rows
    .map((a, i) => {
      const rank = i + 1;
      const topClass = rank <= 3 ? ` top${rank}` : "";
      const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : rank;
      return `<div class="lb-row${topClass}">
        <div class="lb-rank">${medal}</div>
        <div class="lb-name"><div class="n">${esc(a.p.member_name || a.p.member_code)}</div>
          <div class="c">${esc(a.p.member_code)} · ${a.posts} โพสต์</div></div>
        <div class="lb-metrics">
          <div class="m"><div class="v">${fmtNum(a.views)}</div><div class="l">👁 วิว</div></div>
          <div class="m"><div class="v">${fmtNum(a.likes)}</div><div class="l">❤️ like</div></div>
          <div class="m"><div class="v">${fmtNum(a.comments + a.shares)}</div><div class="l">💬🔁</div></div>
        </div>
        <div class="lb-score">${fmtNum(scoreOf(a))}<div style="font-size:10px;color:var(--text3);font-weight:600">${metricLabel}</div></div>
      </div>`;
    })
    .join("");
};

document.addEventListener("DOMContentLoaded", initPage);
