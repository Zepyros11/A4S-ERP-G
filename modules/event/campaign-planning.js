/* ============================================================
   campaign-planning.js — Campaign Review (list + create/edit)
============================================================ */

// ── Supabase helpers ──────────────────────────────────────
function getSB() {
  return {
    url: localStorage.getItem("sb_url") || "",
    key: localStorage.getItem("sb_key") || "",
  };
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
      Prefer:
        method === "POST" || method === "PATCH" ? "return=representation" : "",
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

// ── UI helpers ────────────────────────────────────────────
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
function genToken() {
  const raw =
    (window.crypto && crypto.randomUUID && crypto.randomUUID()) ||
    Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return raw.replace(/-/g, "").slice(0, 20);
}

// ── STATE ─────────────────────────────────────────────────
let allCampaigns = [];
let partCounts = {};   // campaign_id -> #participants
let postCounts = {};   // campaign_id -> #submissions
let editingId = null;
let pendingMedia = []; // [{file?, url?, type:'image'|'video', name, isCover}]
let editToken = null;  // public_token of campaign being edited (กัน gen ซ้ำ)

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
  document.getElementById("searchInput").addEventListener("input", renderTable);
  document.getElementById("filterStatus").addEventListener("change", renderTable);

  // มาจากหน้า detail → เปิด modal แก้ไขทันที (?edit=<id>)
  const editId = +new URLSearchParams(location.search).get("edit");
  if (editId && allCampaigns.some((c) => c.campaign_id === editId)) {
    openCampModal(editId);
    history.replaceState(null, "", location.pathname);
  }
}

async function loadData() {
  const [camps, parts, subs] = await Promise.all([
    sbFetch("campaigns", "?select=*&order=created_at.desc"),
    sbFetch("campaign_participants", "?select=campaign_id"),
    sbFetch("campaign_submissions", "?select=campaign_id"),
  ]);
  allCampaigns = camps || [];
  partCounts = tally(parts || []);
  postCounts = tally(subs || []);
  renderStats();
  renderTable();
}
function tally(rows) {
  const m = {};
  rows.forEach((r) => (m[r.campaign_id] = (m[r.campaign_id] || 0) + 1));
  return m;
}

// ── STATS ─────────────────────────────────────────────────
function renderStats() {
  document.getElementById("statTotal").textContent = allCampaigns.length;
  document.getElementById("statActive").textContent = allCampaigns.filter(
    (c) => c.status === "ACTIVE",
  ).length;
  document.getElementById("statParticipants").textContent = Object.values(
    partCounts,
  ).reduce((a, b) => a + b, 0);
  document.getElementById("statPosts").textContent = Object.values(
    postCounts,
  ).reduce((a, b) => a + b, 0);
}

// ── TABLE ─────────────────────────────────────────────────
const PLAT_LABEL = { tiktok: "🎵", instagram: "📸", facebook: "👍" };
const STATUS_LABEL = {
  DRAFT: "📝 ร่าง",
  ACTIVE: "▶️ ดำเนินการ",
  ENDED: "✅ จบแล้ว",
  CANCELLED: "❌ ยกเลิก",
};

function renderTable() {
  const search = document.getElementById("searchInput").value.trim().toLowerCase();
  const fStatus = document.getElementById("filterStatus").value;
  const tbody = document.getElementById("tableBody");

  let rows = allCampaigns.filter((c) => {
    if (fStatus && c.status !== fStatus) return false;
    if (search && !(c.name || "").toLowerCase().includes(search)) return false;
    return true;
  });

  document.getElementById("rowCount").textContent = `${rows.length} แคมเปญ`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state">
      <div class="empty-icon">🔍</div><div class="empty-text">ไม่พบแคมเปญ</div></div></td></tr>`;
    updateBulkBar();
    return;
  }

  tbody.innerHTML = rows
    .map((c) => {
      const cover = c.cover_url
        ? `<img class="cmp-cover" src="${esc(c.cover_url)}" alt="" style="cursor:zoom-in" onclick="window.ImgPopup&&ImgPopup.open(['${esc(c.cover_url)}'])" />`
        : `<div class="cmp-cover cmp-cover-ph">🚀</div>`;
      const dates =
        c.start_date || c.end_date
          ? `${fmtDMY(c.start_date) || "—"} – ${fmtDMY(c.end_date) || "—"}`
          : "—";
      const plats = (c.platforms || [])
        .map((p) => `<span class="cmp-plat-chip">${PLAT_LABEL[p] || p}</span>`)
        .join("");
      return `<tr>
        <td class="col-center"><input type="checkbox" class="row-check" value="${c.campaign_id}" onclick="window.updateBulkBar()" /></td>
        <td>
          <div class="cmp-name-cell">
            ${cover}
            <div>
              <div class="cmp-name">${esc(c.name)}</div>
              <div class="cmp-sub">${c.reward ? "🎁 " + esc(c.reward) : "ID #" + c.campaign_id}</div>
            </div>
          </div>
        </td>
        <td class="col-center" style="white-space:nowrap">${dates}</td>
        <td class="col-center"><span class="cmp-plats">${plats || "—"}</span></td>
        <td class="col-center">${partCounts[c.campaign_id] || 0}</td>
        <td class="col-center">${postCounts[c.campaign_id] || 0}</td>
        <td class="col-center"><span class="cmp-status cmpstat-${c.status}">${STATUS_LABEL[c.status] || c.status}</span></td>
        <td class="col-center">
          <div class="cmp-row-actions">
            <button class="btn-icon" title="เปิด" onclick="window.openDetail(${c.campaign_id})">📂</button>
            <button class="btn-icon" title="ลิงก์ลงทะเบียน" onclick="window.copyRegLink('${esc(c.public_token || "")}')">🔗</button>
            <button class="btn-icon" title="แก้ไข" data-perm="campaign_edit" onclick="window.openCampModal(${c.campaign_id})">✏️</button>
            <button class="btn-icon" title="ลบ" data-perm="campaign_delete" onclick="window.deleteCampaign(${c.campaign_id})">🗑</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");

  // re-apply perms to dynamically rendered buttons
  if (window.AuthZ && AuthZ.applyDomPerms) AuthZ.applyDomPerms(tbody);
  updateBulkBar();
}

// ── BULK SELECT / DELETE ──────────────────────────────────
window.toggleAll = function (el) {
  document.querySelectorAll(".row-check").forEach((c) => (c.checked = el.checked));
  updateBulkBar();
};
window.updateBulkBar = function () {
  const sel = [...document.querySelectorAll(".row-check:checked")];
  const bar = document.getElementById("bulkBar");
  bar.style.display = sel.length ? "flex" : "none";
  document.getElementById("bulkCount").textContent = `${sel.length} รายการ`;
  const chkAll = document.getElementById("chkAll");
  const all = document.querySelectorAll(".row-check");
  if (chkAll) chkAll.checked = all.length > 0 && sel.length === all.length;
};
function getSelected() {
  return [...document.querySelectorAll(".row-check:checked")].map((c) => +c.value);
}
window.bulkDelete = function () {
  const ids = getSelected();
  if (!ids.length) return;
  DeleteModal.open(`ต้องการลบแคมเปญ ${ids.length} รายการ (รวมผู้เข้าร่วม/ผลงานทั้งหมด) หรือไม่?`, async () => {
    showLoading(true);
    try {
      for (const id of ids) await sbFetch("campaigns", `?campaign_id=eq.${id}`, { method: "DELETE" });
      showToast("ลบแคมเปญที่เลือกแล้ว", "success");
      await loadData();
    } catch (e) {
      showToast("ลบไม่สำเร็จ: " + e.message, "error");
    }
    showLoading(false);
  });
};
window.deleteCampaign = function (id) {
  const c = allCampaigns.find((x) => x.campaign_id === id);
  DeleteModal.open(`ต้องการลบแคมเปญ "${c ? esc(c.name) : id}" (รวมผู้เข้าร่วม/ผลงานทั้งหมด) หรือไม่?`, async () => {
    showLoading(true);
    try {
      await sbFetch("campaigns", `?campaign_id=eq.${id}`, { method: "DELETE" });
      showToast("ลบแคมเปญแล้ว", "success");
      await loadData();
    } catch (e) {
      showToast("ลบไม่สำเร็จ: " + e.message, "error");
    }
    showLoading(false);
  });
};

// ── NAV ───────────────────────────────────────────────────
window.openDetail = function (id) {
  location.href = `./campaign-detail.html?campaign_id=${id}`;
};
window.copyRegLink = async function (token) {
  if (!token) return showToast("แคมเปญนี้ยังไม่มีลิงก์ — บันทึกแคมเปญก่อน", "warning");
  const url = `${location.origin}${location.pathname.replace(/campaign-planning\.html$/, "campaign-register.html")}?t=${token}`;
  try {
    await navigator.clipboard.writeText(url);
    showToast("คัดลอกลิงก์ลงทะเบียนแล้ว 🔗", "success");
  } catch {
    window.prompt("คัดลอกลิงก์นี้:", url);
  }
};

// ── CREATE / EDIT MODAL ───────────────────────────────────
window.openCampModal = function (id = null) {
  editingId = id;
  pendingMedia = [];
  editToken = null;
  const camp = id ? allCampaigns.find((c) => c.campaign_id === id) : null;

  document.getElementById("campModalTitle").textContent = id ? "✏️ แก้ไขแคมเปญ" : "🚀 สร้างแคมเปญ";
  document.getElementById("fId").value = id || "";
  document.getElementById("fName").value = camp?.name || "";
  document.getElementById("fDesc").value = camp?.description || "";
  document.getElementById("fStart").value = (camp?.start_date || "").slice(0, 10);
  document.getElementById("fEnd").value = (camp?.end_date || "").slice(0, 10);
  document.getElementById("fStatus").value = camp?.status || "DRAFT";
  document.getElementById("fRankMetric").value = camp?.rank_metric || "views";
  document.getElementById("fReward").value = camp?.reward || "";
  document.getElementById("fRegOpen").checked = camp ? !!camp.reg_open : true;
  editToken = camp?.public_token || null;

  const plats = camp?.platforms || ["tiktok", "instagram", "facebook"];
  document.querySelectorAll("#fPlatforms input").forEach((cb) => {
    cb.checked = plats.includes(cb.value);
  });

  // media: existing url items
  pendingMedia = (camp?.media || []).map((m) => ({
    url: m.url,
    type: m.type || "image",
    name: m.name || "",
    isCover: camp?.cover_url && m.url === camp.cover_url,
  }));
  if (pendingMedia.length && !pendingMedia.some((m) => m.isCover)) {
    const firstImg = pendingMedia.find((m) => m.type === "image");
    if (firstImg) firstImg.isCover = true;
  }
  renderMediaGrid();
  document.getElementById("campModal").classList.add("open");
  setTimeout(() => document.getElementById("fName").focus(), 50);
};
window.closeCampModal = function () {
  document.getElementById("campModal").classList.remove("open");
  editingId = null;
  pendingMedia = [];
};

function renderMediaGrid() {
  const grid = document.getElementById("fMediaGrid");
  grid.innerHTML = pendingMedia
    .map((m, i) => {
      const src = m.url || (m.file ? URL.createObjectURL(m.file) : "");
      const inner =
        m.type === "video"
          ? `<video src="${src}" muted></video><span class="cmp-vid-tag">▶ วิดีโอ</span>`
          : `<img src="${src}" alt="" />`;
      const coverTag =
        m.type === "image"
          ? `<span class="cmp-cover-tag" style="cursor:pointer" title="ตั้งเป็นปก" onclick="window.setCover(${i})">${m.isCover ? "★ ปก" : "☆"}</span>`
          : "";
      return `<div class="cmp-media-item ${m.pending ? "is-pending" : ""}">
        ${inner}${coverTag}
        <button class="cmp-media-remove" onclick="window.removeMedia(${i})">✕</button>
      </div>`;
    })
    .join("");
  document.getElementById("fMediaCount").textContent = `${pendingMedia.length}/5`;
  const area = document.getElementById("fUploadArea");
  area.classList.toggle("is-full", pendingMedia.length >= 5);
}
window.setCover = function (i) {
  pendingMedia.forEach((m, idx) => (m.isCover = idx === i && m.type === "image"));
  renderMediaGrid();
};
window.removeMedia = function (i) {
  pendingMedia.splice(i, 1);
  if (pendingMedia.length && !pendingMedia.some((m) => m.isCover)) {
    const f = pendingMedia.find((m) => m.type === "image");
    if (f) f.isCover = true;
  }
  renderMediaGrid();
};
window.handleMediaFiles = function (input) {
  const files = [...input.files];
  input.value = "";
  for (const file of files) {
    if (pendingMedia.length >= 5) {
      showToast("สูงสุด 5 ไฟล์", "warning");
      break;
    }
    const type = file.type.startsWith("video") ? "video" : "image";
    pendingMedia.push({ file, type, name: file.name, isCover: false });
  }
  if (!pendingMedia.some((m) => m.isCover)) {
    const f = pendingMedia.find((m) => m.type === "image");
    if (f) f.isCover = true;
  }
  renderMediaGrid();
};

window.saveCampaign = async function () {
  const name = document.getElementById("fName").value.trim();
  if (!name) return showToast("กรุณาใส่ชื่อแคมเปญ", "error");

  const platforms = [...document.querySelectorAll("#fPlatforms input:checked")].map((c) => c.value);
  if (!platforms.length) return showToast("เลือกอย่างน้อย 1 แพลตฟอร์ม", "error");

  const btn = document.getElementById("btnSaveCamp");
  btn.disabled = true;
  showLoading(true);
  try {
    const { url, key } = getSB();
    const token = editToken || genToken();

    // upload pending files → url
    const media = [];
    let coverUrl = null;
    for (let i = 0; i < pendingMedia.length; i++) {
      const m = pendingMedia[i];
      let fileUrl = m.url;
      if (!fileUrl && m.file) {
        const safe = (m.name || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `campaigns/${token}/${Date.now()}_${i}_${safe}`;
        fileUrl = await window.ImageCompressor.uploadViaRest(url, key, BUCKET, path, m.file);
        if (!fileUrl) throw new Error(`อัปโหลดไฟล์ "${m.name}" ไม่สำเร็จ`);
      }
      media.push({ url: fileUrl, type: m.type, name: m.name || "" });
      if (m.isCover) coverUrl = fileUrl;
    }
    if (!coverUrl) {
      const firstImg = media.find((m) => m.type === "image");
      coverUrl = firstImg ? firstImg.url : null;
    }

    const payload = {
      name,
      description: document.getElementById("fDesc").value.trim() || null,
      start_date: document.getElementById("fStart").value || null,
      end_date: document.getElementById("fEnd").value || null,
      status: document.getElementById("fStatus").value,
      rank_metric: document.getElementById("fRankMetric").value,
      platforms,
      reward: document.getElementById("fReward").value.trim() || null,
      reg_open: document.getElementById("fRegOpen").checked,
      media,
      cover_url: coverUrl,
      public_token: token,
      updated_at: new Date().toISOString(),
    };

    if (editingId) {
      await sbFetch("campaigns", `?campaign_id=eq.${editingId}`, { method: "PATCH", body: payload });
    } else {
      payload.created_by = localStorage.getItem("user_name") || localStorage.getItem("username") || null;
      await sbFetch("campaigns", "", { method: "POST", body: payload });
    }

    showToast("บันทึกแคมเปญแล้ว", "success");
    closeCampModal();
    await loadData();
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  } finally {
    btn.disabled = false;
    showLoading(false);
  }
};

document.addEventListener("DOMContentLoaded", initPage);
