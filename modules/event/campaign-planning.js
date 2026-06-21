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
// ── STATE ─────────────────────────────────────────────────
let allCampaigns = [];
let partCounts = {};   // campaign_id -> #participants
let postCounts = {};   // campaign_id -> #submissions

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
              <div class="cmp-sub">${(c.rewards && Object.keys(c.rewards).length) || c.reward ? "🎁 มีของรางวัล" : "ID #" + c.campaign_id}</div>
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
            <button class="btn-icon" title="ลิงก์ลงทะเบียน / QR" onclick="window.openShareModal(${c.campaign_id})">🔗</button>
            <button class="btn-icon" title="แก้ไข" data-perm="campaign_edit" onclick="window.openCampEdit(${c.campaign_id})">✏️</button>
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
// ── SHARE LINK MODAL (QR + Link) ──────────────────────────
// ฐาน URL สาธารณะสำหรับลิงก์ที่แชร์ (ให้ได้ลิงก์ github.io แม้ตอน preview บน localhost)
const PUBLIC_BASE = "https://zepyros11.github.io/A4S-ERP-G";
function buildRegUrl(token) {
  const host = location.hostname;
  let base;
  if (host.includes("github.io")) {
    base = `${location.origin}/${location.pathname.split("/")[1]}`; // deploy จริงบน github.io
  } else if (host === "127.0.0.1" || host === "localhost") {
    base = PUBLIC_BASE; // preview ในเครื่อง → ใช้ลิงก์สาธารณะที่แชร์ได้
  } else {
    base = location.origin; // custom domain
  }
  return `${base}/modules/event/campaign-register.html?t=${token}`;
}
window.openShareModal = function (id) {
  const c = allCampaigns.find((x) => x.campaign_id === id);
  if (!c) return;
  if (!c.public_token) return showToast("แคมเปญนี้ยังไม่มีลิงก์ — บันทึกแคมเปญก่อน", "warning");

  const url = buildRegUrl(c.public_token);
  document.getElementById("shareCampName").textContent = c.name || "";
  document.getElementById("shareUrlInput").value = url;

  const wrap = document.getElementById("shareQrWrap");
  wrap.innerHTML = "";
  if (window.QRCode) {
    new QRCode(wrap, { text: url, width: 190, height: 190, correctLevel: QRCode.CorrectLevel.M });
  } else {
    wrap.textContent = "QR library ยังไม่โหลด — รีเฟรชหน้า";
  }
  document.getElementById("shareModal").classList.add("open");
};
window.closeShareModal = function () {
  document.getElementById("shareModal").classList.remove("open");
};
window.copyShareUrl = async function () {
  const input = document.getElementById("shareUrlInput");
  const url = input.value;
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    showToast("คัดลอกลิงก์ลงทะเบียนแล้ว 🔗", "success");
  } catch {
    input.select();
    document.execCommand("copy");
    showToast("คัดลอกแล้ว", "success");
  }
};

// ── CREATE / EDIT → หน้าแบบฟอร์มแยก (campaign-form.html) ───
window.openCampCreate = function () {
  location.href = "./campaign-form.html";
};
window.openCampEdit = function (id) {
  location.href = `./campaign-form.html?edit=${id}`;
};

document.addEventListener("DOMContentLoaded", initPage);
