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
const fmtNum = (n) => (Number(n) || 0).toLocaleString("en-US");

// ── STATE ─────────────────────────────────────────────────
let allCampaigns = [];
let partCounts = {};   // campaign_id -> #participants
let allParts = [];     // ผู้เข้าร่วมทั้งหมด (สำหรับนับ approved)

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
  const [camps, parts] = await Promise.all([
    sbFetch("campaigns", "?select=*&order=created_at.desc"),
    sbFetch("campaign_participants", "?select=campaign_id,status"),
  ]);
  allCampaigns = camps || [];
  allParts = parts || [];
  partCounts = tally(allParts);
  await syncAutoStatus();
  renderStats();
  renderTable();
}

// ── AUTO STATUS ตามวันที่ ──────────────────────────────────
// today (Asia/Bangkok) เป็น YYYY-MM-DD เทียบกับ start/end ได้ตรงๆ
// กฎ: auto ทำงานเฉพาะ "ยืนยันแล้ว" (track CONFIRMED/ACTIVE/ENDED) เท่านั้น
//   DRAFT (ร่าง) → ไม่ auto · CANCELLED → ค้างไว้เสมอ
//   ยืนยันแล้ว: ก่อนเริ่ม=CONFIRMED · อยู่ในช่วง=ACTIVE · เลยสิ้นสุด=ENDED
function todayBKK() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}
// คอลัมน์วันที่เหลือ (font แดง) — อ้างเวลาไทย
function daysLeftCell(c) {
  const start = (c.start_date || "").slice(0, 10);
  const end = (c.end_date || "").slice(0, 10);
  if (!end || c.status === "CANCELLED") return `<span style="color:var(--text3)">—</span>`;
  const today = todayBKK();
  const diff = (d1, d2) => Math.round((new Date(d1).getTime() - new Date(d2).getTime()) / 86400000);
  if (start && today < start) return `<span style="color:var(--info);font-weight:700">+${diff(start, today)} วัน</span>`;
  if (today > end) return `<span style="color:var(--text3)">จบแล้ว</span>`;
  return `<span style="color:#dc2626;font-weight:800;font-size:15px">${diff(end, today)}</span>`;
}
function computeAutoStatus(c) {
  // ไม่ auto: ร่าง (ยังแก้อยู่) และ ยกเลิก (ค้างไว้)
  if (c.status === "DRAFT" || c.status === "CANCELLED") return c.status;
  // track ที่ยืนยันแล้ว → เปลี่ยนตามวันที่
  const start = (c.start_date || "").slice(0, 10);
  if (!start) return c.status; // ไม่มีวันเริ่ม → คงเดิม (CONFIRMED)
  const end = (c.end_date || "").slice(0, 10);
  const today = todayBKK();
  if (today < start) return "CONFIRMED"; // ยืนยันแล้ว รอถึงวันเริ่ม
  if (end && today > end) return "ENDED";
  return "ACTIVE";
}
async function syncAutoStatus() {
  const changed = [];
  for (const c of allCampaigns) {
    const next = computeAutoStatus(c);
    if (next !== c.status) {
      c.status = next; // อัปเดต local ทันที (ให้ตารางแสดงถูกแม้ PATCH ช้า)
      changed.push(c);
    }
  }
  if (!changed.length) return;
  // เขียนกลับ DB เฉพาะที่เปลี่ยน (best-effort — ถ้าพลาดก็ยังแสดงค่าใหม่ในจอ)
  await Promise.all(
    changed.map((c) =>
      sbFetch("campaigns", `?campaign_id=eq.${c.campaign_id}`, {
        method: "PATCH",
        body: { status: c.status },
      }).catch(() => {})
    )
  );
}
function tally(rows) {
  const m = {};
  rows.forEach((r) => (m[r.campaign_id] = (m[r.campaign_id] || 0) + 1));
  return m;
}

// ── STATS (ภาพรวมเชิงปฏิบัติการ — สถานะ + งานค้าง) ─────────
function renderStats() {
  const today = todayBKK();

  // 1) แคมเปญทั้งหมด + แยกจบแล้ว/ยกเลิก
  const ended = allCampaigns.filter((c) => c.status === "ENDED").length;
  const cancelled = allCampaigns.filter((c) => c.status === "CANCELLED").length;
  document.getElementById("statTotal").textContent = fmtNum(allCampaigns.length);
  document.getElementById("statCampSub").innerHTML =
    `<span style="color:var(--info)">✅ ${ended} จบแล้ว</span> · ❌ ${cancelled} ยกเลิก`;

  // 2) ดำเนินการอยู่ + เปิดรับสมัครกี่แคมเปญ
  const activeCamps = allCampaigns.filter((c) => c.status === "ACTIVE");
  const regOpen = activeCamps.filter((c) => c.reg_open).length;
  document.getElementById("statActive").textContent = fmtNum(activeCamps.length);
  document.getElementById("statActiveSub").textContent = regOpen
    ? `🟢 เปิดรับสมัคร ${fmtNum(regOpen)} แคมเปญ`
    : "ไม่มีแคมเปญเปิดรับสมัคร";

  // 3) กำลังจะถึง — มีวันเริ่มในอนาคต (ยังไม่ยกเลิก/จบ)
  const upcoming = allCampaigns.filter((c) => {
    if (c.status === "CANCELLED" || c.status === "ENDED") return false;
    const start = (c.start_date || "").slice(0, 10);
    return start && start > today;
  });
  document.getElementById("statUpcoming").textContent = fmtNum(upcoming.length);
  if (upcoming.length) {
    const soonest = upcoming
      .map((c) => (c.start_date || "").slice(0, 10))
      .sort()[0];
    document.getElementById("statUpcomingSub").textContent = `เริ่มเร็วสุด ${fmtDMY(soonest)}`;
  } else {
    document.getElementById("statUpcomingSub").textContent = "ไม่มีแคมเปญที่ตั้งคิวไว้";
  }
}

// ── TABLE ─────────────────────────────────────────────────
const PLAT_ICON = {
  tiktok: "../../assets/icons/tiktok.png",
  instagram: "../../assets/icons/instagram.png",
  facebook: "../../assets/icons/facebook.png",
};
const PLAT_NAME = { tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook" };
const STATUS_LABEL = {
  DRAFT: "📝 ร่าง",
  CONFIRMED: "✔️ ยืนยัน",
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
        .map((p) =>
          PLAT_ICON[p]
            ? `<span class="cmp-plat-chip" title="${PLAT_NAME[p]}"><img src="${PLAT_ICON[p]}" alt="${PLAT_NAME[p]}" class="cmp-plat-ic" /></span>`
            : `<span class="cmp-plat-chip">${p}</span>`
        )
        .join("");
      return `<tr class="cmp-row" style="cursor:pointer" onclick="window.rowClick(event, ${c.campaign_id})">
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
        <td class="col-center">${daysLeftCell(c)}</td>
        <td class="col-center">
          <select class="cmp-status-select cmpstat-${c.status}" data-perm="campaign_edit"
                  onchange="window.changeCampStatus(${c.campaign_id}, this)">
            ${Object.keys(STATUS_LABEL).map((s) =>
              `<option value="${s}" ${s === c.status ? "selected" : ""}>${STATUS_LABEL[s]}</option>`
            ).join("")}
          </select>
        </td>
        <td class="col-center">
          <div class="cmp-row-actions">
            <button class="btn-icon" title="รายงาน / Dashboard" onclick="window.openReport(${c.campaign_id})">📊</button>
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

// ── INLINE STATUS CHANGE ──────────────────────────────────
window.changeCampStatus = async function (id, sel) {
  const c = allCampaigns.find((x) => x.campaign_id === id);
  if (!c) return;
  const prev = c.status;
  const next = sel.value;
  if (next === prev) return;
  // อัปเดต UI สีทันที (optimistic)
  sel.className = `cmp-status-select cmpstat-${next}`;
  try {
    await sbFetch("campaigns", `?campaign_id=eq.${id}`, {
      method: "PATCH",
      body: { status: next },
    });
    c.status = next;
    showToast(`เปลี่ยนสถานะเป็น ${STATUS_LABEL[next]}`, "success");
  } catch (e) {
    sel.value = prev;
    sel.className = `cmp-status-select cmpstat-${prev}`;
    showToast("เปลี่ยนสถานะไม่สำเร็จ: " + e.message, "error");
  }
};

// ── NAV ───────────────────────────────────────────────────
// คลิกที่แถว = เปิดรายละเอียด (ยกเว้นคลิกบน control: checkbox / รูปปก / dropdown สถานะ / ปุ่มจัดการ)
window.rowClick = function (e, id) {
  if (e.target.closest("input, button, select, a, .cmp-cover")) return;
  window.openDetail(id);
};
window.openDetail = function (id) {
  location.href = `./campaign-detail.html?campaign_id=${id}`;
};
window.openReport = function (id) {
  location.href = `./campaign-report.html?campaign_id=${id}`;
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
window.openShareUrl = function () {
  const url = document.getElementById("shareUrlInput").value;
  if (!url) return;
  window.open(url, "_blank", "noopener");
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
