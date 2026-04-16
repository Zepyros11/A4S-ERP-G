/* ============================================================
   promotion-list.js — Controller for Promotion List page
============================================================ */

import {
  fetchPromotions,
  fetchPromotionCategories,
  fetchUsers,
  removePromotion,
  updatePromotion,
} from "./promotion-api.js";

let allPromotions = [];
let allUsers = [];
let promotionCategories = [];

let sortKey = "start_date";
let sortAsc = false;
let activeDateRange = "month";
let activeStatusFilter = "";

/* ── Helpers ── */
function getSBLocal() {
  return {
    url: localStorage.getItem("sb_url") || "",
    key: localStorage.getItem("sb_key") || "",
  };
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yyyy = dt.getFullYear() + 543;
  return `${dd}/${mm}/${yyyy}`;
}

function deriveStatus(promo) {
  if (promo.status === "CANCELLED") return "CANCELLED";
  if (promo.status === "DRAFT") return "DRAFT";
  const today = new Date().toISOString().slice(0, 10);
  if (promo.start_date && today < promo.start_date) return "UPCOMING";
  if (promo.end_date && today > promo.end_date) return "EXPIRED";
  return "ACTIVE";
}

const STATUS_MAP = {
  DRAFT: { label: "📝 Draft", cls: "status-draft" },
  ACTIVE: { label: "🎯 Active", cls: "status-active" },
  UPCOMING: { label: "⏳ Upcoming", cls: "status-upcoming" },
  EXPIRED: { label: "⏰ Expired", cls: "status-expired" },
  CANCELLED: { label: "❌ Cancelled", cls: "status-cancelled" },
};

/* ── INIT ── */
async function initPage() {
  showLoading(true);
  try {
    [allPromotions, promotionCategories, allUsers] = await Promise.all([
      fetchPromotions().catch(() => []),
      fetchPromotionCategories().catch(() => []),
      fetchUsers().catch(() => []),
    ]);
    // derive status for each
    allPromotions.forEach((p) => (p._status = deriveStatus(p)));
    updateStats();
    filterTable();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);

  // search
  const si = document.getElementById("searchInput");
  if (si) si.addEventListener("input", () => filterTable());
}

/* ── STATS ── */
function updateStats() {
  const now = new Date();
  const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  let active = 0, month = 0, upcoming = 0, expired = 0;
  allPromotions.forEach((p) => {
    const s = p._status;
    if (s === "ACTIVE") active++;
    if (s === "UPCOMING") upcoming++;
    if (s === "EXPIRED") expired++;
    if (p.start_date && p.start_date.slice(0, 7) === curMonth) month++;
  });

  document.getElementById("cardActive").textContent = active;
  document.getElementById("cardMonth").textContent = month;
  document.getElementById("cardUpcoming").textContent = upcoming;
  document.getElementById("cardExpired").textContent = expired;
}

/* ── FILTER ── */
window.setDateFilter = function (btn, range) {
  document.querySelectorAll("#dateFilterChips .date-chip").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  activeDateRange = range;
  filterTable();
};

window.setStatusFilter = function (btn, status) {
  document.querySelectorAll("#statusFilterChips .date-chip").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  activeStatusFilter = status;
  filterTable();
};

function filterTable() {
  const now = new Date();
  const curMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const today = now.toISOString().slice(0, 10);
  const q = (document.getElementById("searchInput")?.value || "").trim().toLowerCase();

  let filtered = allPromotions.filter((p) => {
    // date range
    if (activeDateRange === "month" && (!p.start_date || p.start_date.slice(0, 7) !== curMonth)) return false;
    if (activeDateRange === "active" && p._status !== "ACTIVE") return false;
    if (activeDateRange === "upcoming" && p._status !== "UPCOMING") return false;

    // status
    if (activeStatusFilter && p._status !== activeStatusFilter) return false;

    // search
    if (q && !(p.promotion_name || "").toLowerCase().includes(q) &&
        !(p.description || "").toLowerCase().includes(q)) return false;

    return true;
  });

  // sort
  filtered.sort((a, b) => {
    let va = a[sortKey] || "";
    let vb = b[sortKey] || "";
    if (typeof va === "string") va = va.toLowerCase();
    if (typeof vb === "string") vb = vb.toLowerCase();
    if (va < vb) return sortAsc ? -1 : 1;
    if (va > vb) return sortAsc ? 1 : -1;
    return 0;
  });

  document.getElementById("tableCount").textContent = `${filtered.length} รายการ`;
  renderTable(filtered);
}

/* ── SORT ── */
window.sortTable = function (key) {
  if (sortKey === key) sortAsc = !sortAsc;
  else { sortKey = key; sortAsc = true; }
  filterTable();
};

/* ── RENDER TABLE ── */
function renderTable(items) {
  const tbody = document.getElementById("tableBody");
  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="7">
      <div class="empty-state">
        <div class="empty-icon">🎁</div>
        <div class="empty-text">ไม่พบข้อมูลโปรโมชัน</div>
      </div></td></tr>`;
    return;
  }

  tbody.innerHTML = items
    .map((p) => {
      const st = STATUS_MAP[p._status] || STATUS_MAP.DRAFT;
      const posterThumb = p.poster_url
        ? `<img src="${p.poster_url}" alt="" style="width:40px;height:40px;object-fit:cover;border-radius:8px;cursor:pointer"
             onclick="event.stopPropagation(); ImgPopup.open(['${p.poster_url}'], 0)">`
        : `<span style="font-size:20px;opacity:.3">🖼️</span>`;

      return `<tr onclick="window.openPromotion(${p.promotion_id})" style="cursor:pointer">
        <td style="text-align:center" onclick="event.stopPropagation()">
          <input type="checkbox" class="row-check" value="${p.promotion_id}" onchange="window.updateBulkBtn()" />
        </td>
        <td class="col-center">${posterThumb}</td>
        <td><strong>${escapeHtml(p.promotion_name)}</strong></td>
        <td>${formatDate(p.start_date)}</td>
        <td>${formatDate(p.end_date)}</td>
        <td class="col-center"><span class="status-pill ${st.cls}">${st.label}</span></td>
        <td class="col-center" onclick="event.stopPropagation()">
          <button class="btn btn-sm btn-outline" onclick="window.deletePromotion(${p.promotion_id},'${escapeHtml(p.promotion_name)}')">🗑</button>
        </td>
      </tr>`;
    })
    .join("");
}

/* ── CHECKBOX BULK ── */
window.toggleAllCheckbox = function (master) {
  document.querySelectorAll(".row-check").forEach((cb) => (cb.checked = master.checked));
  window.updateBulkBtn();
};

window.updateBulkBtn = function () {
  const cnt = document.querySelectorAll(".row-check:checked").length;
  const btn = document.getElementById("btnDeleteSelected");
  if (btn) btn.style.display = cnt > 0 ? "inline-flex" : "none";
};

/* ── ACTIONS ── */
window.openPromotion = function (id) {
  // TODO: open promotion form when created
  showToast("เปิดโปรโมชัน #" + id, "info");
};

window.createPromotion = function () {
  // TODO: open promotion form when created
  showToast("สร้างโปรโมชัน — (coming soon)", "info");
};

window.deletePromotion = function (id, name) {
  if (typeof DeleteModal !== "undefined") {
    DeleteModal.show({
      title: "ลบโปรโมชัน",
      message: `ยืนยันลบ "${name}" ?`,
      onConfirm: async () => {
        try {
          await removePromotion(id);
          allPromotions = allPromotions.filter((p) => p.promotion_id !== id);
          updateStats();
          filterTable();
          showToast("ลบเรียบร้อย");
        } catch (e) {
          showToast("ลบไม่สำเร็จ: " + e.message, "error");
        }
      },
    });
  }
};

window.deleteSelectedPromotions = function () {
  const ids = [...document.querySelectorAll(".row-check:checked")].map((cb) => Number(cb.value));
  if (!ids.length) return;
  if (typeof DeleteModal !== "undefined") {
    DeleteModal.show({
      title: "ลบโปรโมชันที่เลือก",
      message: `ยืนยันลบ ${ids.length} รายการ ?`,
      onConfirm: async () => {
        try {
          await Promise.all(ids.map((id) => removePromotion(id)));
          allPromotions = allPromotions.filter((p) => !ids.includes(p.promotion_id));
          updateStats();
          filterTable();
          showToast(`ลบ ${ids.length} รายการเรียบร้อย`);
        } catch (e) {
          showToast("ลบไม่สำเร็จ: " + e.message, "error");
        }
      },
    });
  }
};

/* ── UI HELPERS ── */
function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove("show"), 3000);
}

function showLoading(show) {
  document.getElementById("loadingOverlay").classList.toggle("show", show);
}

/* ── START ── */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPage);
} else {
  initPage();
}
