/* ============================================================
   promotion-list.js — Poster-first Promotion Gallery Controller
   ============================================================ */

import {
  fetchPromotions,
  fetchPromotionCategories,
  createPromotionCategory,
  updatePromotionCategory,
  removePromotionCategory,
  createPromotions,
  removePromotion,
  uploadPosterFile,
} from "./promotion-api.js";

// ── STATE ──────────────────────────────────────────────────
let allPromotions = [];
let allCategories = [];
let gridCols = 5;
let activeCat = "all";
let currentMonth = ""; // YYYY-MM

// ── INIT ───────────────────────────────────────────────────
async function initPage() {
  // default to current month
  const now = new Date();
  currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  document.getElementById("uploadMonth").value = currentMonth;

  showLoading(true);
  try {
    [allPromotions, allCategories] = await Promise.all([
      fetchPromotions(currentMonth).catch(() => []),
      fetchPromotionCategories().catch(() => []),
    ]);
    renderMonthLabel();
    renderCategoryChips();
    renderGallery();
    populateUploadCatSelect();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);

  // drag & drop on drop zone
  const dz = document.getElementById("dropZone");
  if (dz) {
    dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("dragover"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("dragover"));
    dz.addEventListener("drop", (e) => {
      e.preventDefault();
      dz.classList.remove("dragover");
      window.handleFiles(e.dataTransfer.files);
    });
  }
}

// ── MONTH NAVIGATION ───────────────────────────────────────
function renderMonthLabel() {
  const [y, m] = currentMonth.split("-");
  const thMonths = [
    "", "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
  ];
  document.getElementById("monthLabel").textContent =
    `${thMonths[parseInt(m)]} ${parseInt(y) + 543}`;
}

function shiftMonth(delta) {
  const [y, m] = currentMonth.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  currentMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  reloadMonth();
}

async function reloadMonth() {
  showLoading(true);
  renderMonthLabel();
  try {
    allPromotions = await fetchPromotions(currentMonth).catch(() => []);
    activeCat = "all";
    renderCategoryChips();
    renderGallery();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้", "error");
  }
  showLoading(false);
}

window.prevMonth = () => shiftMonth(-1);
window.nextMonth = () => shiftMonth(+1);

// ── CATEGORY CHIPS ─────────────────────────────────────────
function renderCategoryChips() {
  const bar = document.getElementById("catBar");
  // count per category for this month
  const countMap = {};
  allPromotions.forEach((p) => {
    const cid = p.promotion_category_id || "uncategorized";
    countMap[cid] = (countMap[cid] || 0) + 1;
  });

  let html = `<button class="promo-cat-chip ${activeCat === "all" ? "active" : ""}"
    data-cat="all" onclick="window.filterCat(this,'all')">
    ทั้งหมด <span class="promo-cat-count">${allPromotions.length}</span>
  </button>`;

  // only show categories that have posters this month, plus all defined ones
  allCategories.forEach((cat) => {
    const cnt = countMap[cat.promotion_category_id] || 0;
    const isActive = activeCat === String(cat.promotion_category_id);
    const style = isActive
      ? `background:${cat.color || "#f59e0b"};color:#fff;border-color:${cat.color || "#f59e0b"}`
      : "";
    html += `<button class="promo-cat-chip ${isActive ? "active" : ""}" style="${style}"
      data-cat="${cat.promotion_category_id}"
      onclick="window.filterCat(this,'${cat.promotion_category_id}')">
      ${cat.icon || "📁"} ${cat.category_name}
      ${cnt ? `<span class="promo-cat-count">${cnt}</span>` : ""}
    </button>`;
  });

  // ปุ่ม ⚙️ จัดการหมวดหมู่
  html += `<button class="promo-cat-manage-btn" onclick="window.openCatManager()" title="จัดการหมวดหมู่">⚙️</button>`;

  bar.innerHTML = html;
}

window.filterCat = function (btn, catId) {
  activeCat = catId;
  renderCategoryChips();
  renderGallery();
};

// ── GRID TOGGLE ────────────────────────────────────────────
window.setGrid = function (cols) {
  gridCols = cols;
  document.querySelectorAll(".promo-toggle-btn").forEach((b) => b.classList.remove("active"));
  const ab = document.getElementById("btnGrid" + cols);
  if (ab) ab.classList.add("active");
  renderGallery();
};

// ── RENDER GALLERY ─────────────────────────────────────────
function renderGallery() {
  let filtered = allPromotions;
  if (activeCat !== "all") {
    filtered = allPromotions.filter(
      (p) => String(p.promotion_category_id) === activeCat
    );
  }

  document.getElementById("statTotal").textContent = filtered.length;
  document.getElementById("statCats").textContent = allCategories.length;
  document.getElementById("pageSubtitle").textContent =
    `${filtered.length} โปสเตอร์ · ${currentMonth}`;

  const body = document.getElementById("galleryBody");

  if (!filtered.length) {
    body.innerHTML = `
      <div class="empty-state" style="padding:60px 0;grid-column:1/-1">
        <div class="empty-icon">🖼️</div>
        <div class="empty-text">ไม่มีโปสเตอร์ในเดือนนี้</div>
      </div>`;
    body.className = "promo-gallery";
    return;
  }

  // group by category
  const groups = {};
  filtered.forEach((p) => {
    const cid = p.promotion_category_id || 0;
    if (!groups[cid]) groups[cid] = [];
    groups[cid].push(p);
  });

  // sort categories by sort_order
  const catOrder = {};
  allCategories.forEach((c, i) => { catOrder[c.promotion_category_id] = i; });

  const sortedKeys = Object.keys(groups).sort((a, b) =>
    (catOrder[a] ?? 999) - (catOrder[b] ?? 999)
  );

  let html = "";
  sortedKeys.forEach((cid) => {
    const cat = allCategories.find((c) => String(c.promotion_category_id) === String(cid));
    const catLabel = cat ? `${cat.icon || "📁"} ${cat.category_name}` : "📁 ไม่มีหมวดหมู่";
    const catColor = cat?.color || "#94a3b8";
    const promos = groups[cid];

    // collect all poster URLs for lightbox
    const allUrls = promos.map(p => p.poster_url).filter(Boolean);

    html += `
      <div class="promo-section">
        <div class="promo-section-header">
          <span class="promo-section-title" style="color:${catColor}">${catLabel}</span>
          <span class="promo-section-count">${promos.length} รายการ</span>
          <div class="promo-section-line" style="background:${catColor}30"></div>
        </div>
        <div class="promo-grid promo-grid-${gridCols}">
          ${promos.map((p, idx) => buildCard(p, allUrls, idx)).join("")}
        </div>
      </div>`;
  });

  body.innerHTML = html;
  body.className = "promo-gallery";

  // scroll reveal
  requestAnimationFrame(() => initScrollReveal());
}

// ── BUILD CARD ─────────────────────────────────────────────
function buildCard(p, allUrls, idx) {
  const urlsJson = JSON.stringify(allUrls).replace(/"/g, "&quot;");
  const title = p.title || "";

  return `
    <div class="promo-card" onclick="ImgPopup.open(${urlsJson}, ${idx})">
      <div class="promo-card-img">
        <img src="${p.poster_url}" alt="${title}" loading="lazy"
             onerror="this.parentElement.classList.add('promo-card-noposter'); this.remove();" />
      </div>
      ${title ? `<div class="promo-card-caption">${escapeHtml(title)}</div>` : ""}
      <button class="promo-card-del" data-perm="promotion_delete"
        onclick="event.stopPropagation(); window.deletePoster(${p.promotion_id})"
        title="ลบ">🗑</button>
    </div>`;
}

// ── SCROLL REVEAL ──────────────────────────────────────────
function initScrollReveal() {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("promo-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.05, rootMargin: "0px 0px -30px 0px" }
  );
  document.querySelectorAll(".promo-card").forEach((c) => observer.observe(c));
}

// ── DELETE ─────────────────────────────────────────────────
window.deletePoster = function (id) {
  if (typeof DeleteModal !== "undefined") {
    DeleteModal.show({
      title: "ลบโปสเตอร์",
      message: "ยืนยันลบโปสเตอร์นี้?",
      onConfirm: async () => {
        try {
          await removePromotion(id);
          allPromotions = allPromotions.filter((p) => p.promotion_id !== id);
          renderCategoryChips();
          renderGallery();
          showToast("ลบเรียบร้อย");
        } catch (e) {
          showToast("ลบไม่สำเร็จ: " + e.message, "error");
        }
      },
    });
  }
};

// ── UPLOAD MODAL ───────────────────────────────────────────
let pendingFiles = [];

function populateUploadCatSelect() {
  const sel = document.getElementById("uploadCat");
  sel.innerHTML = '<option value="">— เลือกหมวดหมู่ —</option>';
  allCategories.forEach((c) => {
    sel.innerHTML += `<option value="${c.promotion_category_id}">${c.icon || ""} ${c.category_name}</option>`;
  });
}

window.openUpload = function () {
  pendingFiles = [];
  document.getElementById("previewGrid").innerHTML = "";
  document.getElementById("fileInput").value = "";
  document.getElementById("uploadMonth").value = currentMonth;
  const dz = document.getElementById("dropZone");
  if (dz) dz.style.display = "";
  document.getElementById("uploadModal").classList.add("open");
};

window.closeUpload = function () {
  document.getElementById("uploadModal").classList.remove("open");
};

window.handleFiles = function (fileList) {
  for (const f of fileList) {
    if (!f.type.startsWith("image/")) continue;
    pendingFiles.push(f);
  }
  renderPreviews();
};

function renderPreviews() {
  const grid = document.getElementById("previewGrid");
  const dz = document.getElementById("dropZone");
  let cards = pendingFiles
    .map((f, i) => {
      const url = URL.createObjectURL(f);
      return `<div class="promo-preview-item">
        <img src="${url}" />
        <button class="promo-preview-del" onclick="window.removePreview(${i})">✕</button>
        <div class="promo-preview-name">${f.name}</div>
      </div>`;
    })
    .join("");
  // ปุ่มเพิ่มรูปอีก
  if (pendingFiles.length) {
    cards += `<div class="promo-preview-add" onclick="document.getElementById('fileInput').click()">
      <span>＋</span><span style="font-size:9px">เพิ่มรูป</span>
    </div>`;
  }
  grid.innerHTML = cards;
  // ซ่อน drop zone เมื่อมีไฟล์แล้ว
  if (dz) dz.style.display = pendingFiles.length ? "none" : "";
}

window.removePreview = function (idx) {
  pendingFiles.splice(idx, 1);
  renderPreviews();
};

window.confirmUpload = async function () {
  if (!pendingFiles.length) {
    showToast("กรุณาเลือกไฟล์ภาพ", "error");
    return;
  }

  const btn = document.getElementById("btnUploadConfirm");
  btn.disabled = true;
  btn.textContent = "⏳ กำลังอัปโหลด...";

  try {
    // resolve category
    const catId = document.getElementById("uploadCat").value;

    const month = document.getElementById("uploadMonth").value || currentMonth;

    // upload files → get URLs
    const urls = [];
    for (const f of pendingFiles) {
      const url = await uploadPosterFile(f);
      urls.push(url);
    }

    // batch insert rows
    const rows = urls.map((url, i) => ({
      promotion_category_id: catId ? Number(catId) : null,
      promo_month: month,
      poster_url: url,
      title: "",
      sort_order: i,
    }));

    const created = await createPromotions(rows);
    allPromotions.push(...(created || []));

    renderCategoryChips();
    renderGallery();
    window.closeUpload();
    showToast(`อัปโหลด ${urls.length} ภาพเรียบร้อย`);
  } catch (e) {
    showToast("อัปโหลดไม่สำเร็จ: " + e.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "📤 อัปโหลด";
  }
};

// ── CATEGORY MANAGER ───────────────────────────────────────
let catEditList = []; // working copy

window.openCatManager = function () {
  catEditList = allCategories.map((c) => ({ ...c, _deleted: false }));
  renderCatManagerList();
  document.getElementById("catManagerModal").classList.add("open");
};

window.closeCatManager = function () {
  document.getElementById("catManagerModal").classList.remove("open");
};

window.addCatRow = function () {
  catEditList.push({
    promotion_category_id: null, // new
    category_name: "",
    icon: "🎁",
    color: "#f59e0b",
    sort_order: catEditList.length,
    _deleted: false,
    _new: true,
  });
  renderCatManagerList();
};

window.removeCatRow = function (idx) {
  catEditList[idx]._deleted = true;
  renderCatManagerList();
};

window.restoreCatRow = function (idx) {
  catEditList[idx]._deleted = false;
  renderCatManagerList();
};

const ICON_CHOICES = [
  "🎁","🌳","🪥","💊","⭐","📦","🎯","💰","🏷️","🛒",
  "💎","🔥","👑","🎉","🎊","🧴","💄","🧪","🌿","🍃",
  "❤️","💪","👁️","🦷","🧬","🥤","🧃","☕","🍵","🫖",
  "✨","🌟","💫","⚡","🔔","📣","🎪","🎨","🏆","🥇",
];

window.openIconPicker = function (idx) {
  // close any existing
  document.querySelectorAll(".icon-picker-popup").forEach((e) => e.remove());
  const btn = document.querySelector(`.cat-mgr-icon-btn[data-idx="${idx}"]`);
  if (!btn) return;
  const popup = document.createElement("div");
  popup.className = "icon-picker-popup";
  popup.innerHTML = ICON_CHOICES.map(
    (ic) => `<button class="icon-picker-item" onclick="window.pickIcon(${idx},'${ic}')">${ic}</button>`
  ).join("");
  btn.parentElement.style.position = "relative";
  btn.parentElement.appendChild(popup);
  // close on outside click
  setTimeout(() => {
    const closer = (e) => {
      if (!popup.contains(e.target) && e.target !== btn) {
        popup.remove();
        document.removeEventListener("click", closer);
      }
    };
    document.addEventListener("click", closer);
  }, 0);
};

window.pickIcon = function (idx, icon) {
  catEditList[idx].icon = icon;
  document.querySelectorAll(".icon-picker-popup").forEach((e) => e.remove());
  renderCatManagerList();
};

function renderCatManagerList() {
  const list = document.getElementById("catManagerList");
  const visible = catEditList.filter((c) => !c._deleted);
  const deleted = catEditList.filter((c) => c._deleted);

  let html = visible
    .map((c, _) => {
      const idx = catEditList.indexOf(c);
      return `<div class="cat-mgr-row">
        <button class="cat-mgr-icon-btn" data-idx="${idx}" onclick="window.openIconPicker(${idx})" title="เลือก icon">${c.icon || "🎁"}</button>
        <input class="cat-mgr-name" value="${escapeHtml(c.category_name)}" placeholder="ชื่อหมวดหมู่" data-idx="${idx}" data-field="category_name" onchange="window.catFieldChange(this)" />
        <input type="color" value="${c.color || "#f59e0b"}" data-idx="${idx}" data-field="color" onchange="window.catFieldChange(this)" style="width:36px;height:32px;border:none;cursor:pointer;border-radius:6px" />
        <button class="cat-mgr-del" onclick="window.removeCatRow(${idx})" title="ลบ">🗑</button>
      </div>`;
    })
    .join("");

  if (deleted.length) {
    html += `<div class="cat-mgr-deleted-header">รายการที่จะถูกลบ</div>`;
    html += deleted
      .map((c) => {
        const idx = catEditList.indexOf(c);
        return `<div class="cat-mgr-row cat-mgr-row-deleted">
          <span class="cat-mgr-icon">${c.icon || ""}</span>
          <span class="cat-mgr-name-deleted">${escapeHtml(c.category_name)}</span>
          <button class="btn btn-sm btn-outline" onclick="window.restoreCatRow(${idx})">↩ คืนค่า</button>
        </div>`;
      })
      .join("");
  }

  list.innerHTML = html || '<div style="padding:20px;text-align:center;color:var(--text3)">ไม่มีหมวดหมู่</div>';
}

window.catFieldChange = function (el) {
  const idx = Number(el.dataset.idx);
  const field = el.dataset.field;
  catEditList[idx][field] = el.value;
};

window.saveCatChanges = async function () {
  const btn = document.querySelector('#catManagerModal .btn-primary');
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "⏳ กำลังบันทึก...";

  try {
    // 1. Delete
    for (const c of catEditList.filter((c) => c._deleted && c.promotion_category_id)) {
      await removePromotionCategory(c.promotion_category_id);
    }
    // 2. Create new
    for (const c of catEditList.filter((c) => !c._deleted && c._new && c.category_name.trim())) {
      await createPromotionCategory({
        category_name: c.category_name.trim(),
        icon: c.icon || "🎁",
        color: c.color || "#f59e0b",
        sort_order: c.sort_order,
      });
    }
    // 3. Update existing
    for (const c of catEditList.filter((c) => !c._deleted && !c._new && c.promotion_category_id)) {
      await updatePromotionCategory(c.promotion_category_id, {
        category_name: c.category_name.trim(),
        icon: c.icon || "🎁",
        color: c.color || "#f59e0b",
        sort_order: c.sort_order,
      });
    }

    // reload
    allCategories = await fetchPromotionCategories().catch(() => []);
    renderCategoryChips();
    renderGallery();
    populateUploadCatSelect();
    window.closeCatManager();
    showToast("บันทึกหมวดหมู่เรียบร้อย");
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
};

// ── HELPERS ────────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove("show"), 3000);
}

function showLoading(show) {
  document.getElementById("loadingOverlay").classList.toggle("show", show);
}

// ── START ──────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPage);
} else {
  initPage();
}
