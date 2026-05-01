/* ============================================================
   manual-list.js — Book TOC overview
   ============================================================ */
import {
  fetchChapters,
  fetchPages,
  createChapter,
  updateChapter,
  deleteChapter as apiDeleteChapter,
  searchPages,
} from "./manual-api.js";

const PALETTE = [
  "linear-gradient(135deg,#0ea5e9,#6366f1)",
  "linear-gradient(135deg,#f59e0b,#ef4444)",
  "linear-gradient(135deg,#10b981,#06b6d4)",
  "linear-gradient(135deg,#8b5cf6,#ec4899)",
  "linear-gradient(135deg,#1e3a8a,#3b82f6)",
  "linear-gradient(135deg,#dc2626,#f97316)",
  "linear-gradient(135deg,#059669,#84cc16)",
  "linear-gradient(135deg,#7c3aed,#0ea5e9)",
];

const state = {
  chapters: [],
  pagesByChapter: {},
  showDrafts: false,
  editingChapterId: null,
  selectedColor: PALETTE[0],
};

/* ── helpers ────────────────────────────────────────────── */
function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.className = `toast toast-${type} show`;
  setTimeout(() => t.classList.remove("show"), 3000);
}
function showLoading(on) {
  document.getElementById("loadingOverlay")?.classList.toggle("active", on);
}
function slugify(str) {
  return (str || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\w฀-๿]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
function canEdit() {
  return window.AuthZ ? AuthZ.hasPerm("manual_edit") : true;
}

/* ── Load + render ──────────────────────────────────────── */
async function load() {
  showLoading(true);
  try {
    state.chapters = await fetchChapters({ includeUnpublished: state.showDrafts && canEdit() });
    /* fetch pages per chapter in parallel */
    const ids = state.chapters.map((c) => c.id);
    const all = await Promise.all(
      ids.map((id) => fetchPages({ chapterId: id, includeUnpublished: state.showDrafts && canEdit() })),
    );
    state.pagesByChapter = {};
    ids.forEach((id, i) => (state.pagesByChapter[id] = all[i]));
    render();
  } catch (e) {
    showToast("โหลดไม่สำเร็จ: " + e.message, "error");
    document.getElementById("shelf").innerHTML = `
      <div class="man-empty"><div class="man-empty-ico">⚠️</div>
      <div class="man-empty-msg">โหลดข้อมูลไม่ได้ — ${escapeHtml(e.message)}</div></div>`;
  } finally {
    showLoading(false);
  }
}

function render() {
  const shelf = document.getElementById("shelf");
  const totalPages = Object.values(state.pagesByChapter).reduce((n, arr) => n + arr.length, 0);
  const totalMin = Object.values(state.pagesByChapter).reduce(
    (n, arr) => n + arr.reduce((s, p) => s + (p.reading_minutes || 0), 0),
    0,
  );
  document.getElementById("statChapters").textContent = state.chapters.length;
  document.getElementById("statPages").textContent = totalPages;
  document.getElementById("statMinutes").textContent = totalMin;

  if (!state.chapters.length) {
    shelf.innerHTML = `
      <div class="man-empty" style="grid-column:1/-1">
        <div class="man-empty-ico">📚</div>
        <div class="man-empty-msg">ยังไม่มีเนื้อหา — ${canEdit() ? "เริ่มต้นด้วยการเพิ่มบทแรก" : "ยังไม่ถูกสร้าง"}</div>
        ${canEdit() ? '<button class="btn btn-primary" style="margin-top:14px" onclick="window.openNewChapter()">＋ สร้างบทแรก</button>' : ""}
      </div>`;
    return;
  }

  let html = "";
  state.chapters.forEach((ch, i) => {
    const pages = state.pagesByChapter[ch.id] || [];
    const minutes = pages.reduce((s, p) => s + (p.reading_minutes || 0), 0);
    const draftMark = ch.is_published ? "" : " (draft)";
    html += `
      <div class="man-chapter">
        <div class="man-chapter-cover" style="background:${escapeAttr(ch.cover_color || PALETTE[i % PALETTE.length])}">
          <span class="man-chapter-num">บทที่ ${i + 1}${draftMark}</span>
          <span class="man-chapter-meta">${pages.length} หน้า · ${minutes} น.</span>
          <span>${escapeHtml(ch.icon || "📖")}</span>
        </div>
        <div class="man-chapter-body">
          <div class="man-chapter-title">${escapeHtml(ch.title)}</div>
          <div class="man-chapter-desc">${escapeHtml(ch.description || "—")}</div>

          <div class="man-chapter-pages">
            ${
              pages.length
                ? pages
                    .slice(0, 4)
                    .map(
                      (p) =>
                        `<a class="man-chapter-page-item${p.is_published ? "" : " draft"}"
                           href="manual-view.html?page=${p.id}">
                           <span class="pg-dot"></span>
                           <span>${escapeHtml(p.title)}</span>
                         </a>`,
                    )
                    .join("")
                : `<div class="man-chapter-empty">ยังไม่มีหน้าในบทนี้</div>`
            }
          </div>

          <div class="man-chapter-foot">
            <a class="man-chapter-more" href="manual-view.html?chapter=${ch.id}">
              ${pages.length > 4 ? `+ ดูทั้งหมด (${pages.length})` : "อ่านบทนี้"} →
            </a>
            ${
              canEdit()
                ? `<div class="man-chapter-actions">
                     <button class="man-icon-btn" title="แก้ไขบท" onclick="window.openEditChapter(${ch.id})">✏️</button>
                     <button class="man-icon-btn" title="เพิ่มหน้าใหม่" onclick="window.location.href='manual-edit.html?chapter=${ch.id}'">＋</button>
                   </div>`
                : ""
            }
          </div>
        </div>
      </div>`;
  });

  if (canEdit()) {
    html += `
      <div class="man-chapter man-chapter-add" onclick="window.openNewChapter()">
        <div class="man-chapter-add-icon">＋</div>
        <div class="man-chapter-add-text">เพิ่มบทใหม่</div>
      </div>`;
  }

  shelf.innerHTML = html;
  if (window.AuthZ) AuthZ.applyDomPerms(shelf);
}

/* ── Search ─────────────────────────────────────────────── */
let searchTimer = null;
function bindSearch() {
  const input = document.getElementById("searchInput");
  const dropdown = document.getElementById("searchResults");
  input.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (!q) {
      dropdown.classList.remove("show");
      return;
    }
    searchTimer = setTimeout(() => doSearch(q), 220);
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".man-search")) dropdown.classList.remove("show");
  });
}
async function doSearch(q) {
  const dropdown = document.getElementById("searchResults");
  try {
    const rows = await searchPages(q);
    if (!rows.length) {
      dropdown.innerHTML = `<div class="man-search-result-empty">ไม่พบ "${escapeHtml(q)}"</div>`;
    } else {
      dropdown.innerHTML = rows
        .map(
          (r) => `
          <a class="man-search-result" href="manual-view.html?page=${r.id}">
            <div class="man-search-result-title">${escapeHtml(r.title)}</div>
            <div class="man-search-result-meta">
              ${escapeHtml(r.manual_chapters?.icon || "📖")} ${escapeHtml(r.manual_chapters?.title || "")}
              ${r.summary ? " · " + escapeHtml(r.summary).slice(0, 80) : ""}
            </div>
          </a>`,
        )
        .join("");
    }
    dropdown.classList.add("show");
  } catch (e) {
    showToast("ค้นหาไม่ได้: " + e.message, "error");
  }
}

/* ── Toggle drafts ──────────────────────────────────────── */
window.toggleDrafts = function () {
  if (!canEdit()) return;
  state.showDrafts = !state.showDrafts;
  const btn = document.getElementById("btnShowDrafts");
  if (btn) {
    btn.textContent = state.showDrafts ? "✓ แสดง draft" : "👁 แสดง draft";
    btn.classList.toggle("btn-primary", state.showDrafts);
  }
  load();
};

/* ── Chapter modal ──────────────────────────────────────── */
function buildPalette() {
  const wrap = document.getElementById("chPalette");
  wrap.innerHTML = PALETTE.map(
    (c) => `<div class="man-palette-swatch" style="background:${c}" data-color="${escapeAttr(c)}"></div>`,
  ).join("");
  wrap.querySelectorAll(".man-palette-swatch").forEach((el) => {
    el.addEventListener("click", () => {
      wrap.querySelectorAll(".man-palette-swatch").forEach((x) => x.classList.remove("active"));
      el.classList.add("active");
      state.selectedColor = el.dataset.color;
    });
  });
  wrap.firstElementChild?.classList.add("active");
}

function openModal({ chapter = null } = {}) {
  state.editingChapterId = chapter?.id || null;
  document.getElementById("chapterModalTitle").textContent = chapter ? "แก้ไขบท" : "เพิ่มบทใหม่";
  document.getElementById("chTitle").value = chapter?.title || "";
  document.getElementById("chSlug").value = chapter?.slug || "";
  document.getElementById("chDesc").value = chapter?.description || "";
  document.getElementById("chIcon").value = chapter?.icon || "📖";
  document.getElementById("chOrder").value = chapter?.sort_order ?? state.chapters.length;
  document.getElementById("chPublished").checked = chapter ? !!chapter.is_published : true;

  state.selectedColor = chapter?.cover_color || PALETTE[0];
  document.querySelectorAll("#chPalette .man-palette-swatch").forEach((el) => {
    el.classList.toggle("active", el.dataset.color === state.selectedColor);
  });

  document.getElementById("btnDeleteChapter").style.display = chapter ? "" : "none";
  document.getElementById("chapterModal").classList.add("open");
}

window.openNewChapter = function () {
  if (!canEdit()) return;
  openModal();
};
window.openEditChapter = function (id) {
  const ch = state.chapters.find((c) => c.id === id);
  if (ch) openModal({ chapter: ch });
};
window.closeChapterModal = function () {
  document.getElementById("chapterModal").classList.remove("open");
};

/* auto-fill slug from title */
document.addEventListener("input", (e) => {
  if (e.target.id === "chTitle" && !state.editingChapterId) {
    document.getElementById("chSlug").value = slugify(e.target.value);
  }
});

window.saveChapter = async function () {
  const payload = {
    title: document.getElementById("chTitle").value.trim(),
    slug: document.getElementById("chSlug").value.trim() || slugify(document.getElementById("chTitle").value),
    description: document.getElementById("chDesc").value.trim() || null,
    icon: document.getElementById("chIcon").value.trim() || "📖",
    cover_color: state.selectedColor,
    sort_order: parseInt(document.getElementById("chOrder").value, 10) || 0,
    is_published: document.getElementById("chPublished").checked,
  };
  if (!payload.title) {
    showToast("กรุณาใส่ชื่อบท", "warning");
    return;
  }
  showLoading(true);
  try {
    if (state.editingChapterId) {
      await updateChapter(state.editingChapterId, payload);
      showToast("บันทึกเรียบร้อย");
    } else {
      await createChapter(payload);
      showToast("เพิ่มบทใหม่สำเร็จ");
    }
    window.closeChapterModal();
    await load();
  } catch (e) {
    showToast("บันทึกไม่ได้: " + e.message, "error");
  } finally {
    showLoading(false);
  }
};

window.deleteChapter = async function () {
  if (!state.editingChapterId) return;
  const ch = state.chapters.find((c) => c.id === state.editingChapterId);
  const pages = state.pagesByChapter[state.editingChapterId] || [];
  const ok = await ConfirmModal.open({
    title: "ลบบทนี้?",
    icon: "🗑",
    message: `ต้องการลบบท "${ch?.title}" หรือไม่?`,
    note: pages.length
      ? `⚠️ บทนี้มี ${pages.length} หน้า — จะถูกลบทั้งหมดด้วย`
      : "ไม่มีหน้าใต้บทนี้",
    okText: "ลบเลย",
    cancelText: "ยกเลิก",
    tone: "danger",
  });
  if (!ok) return;
  showLoading(true);
  try {
    await apiDeleteChapter(state.editingChapterId);
    showToast("ลบบทแล้ว");
    window.closeChapterModal();
    await load();
  } catch (e) {
    showToast("ลบไม่ได้: " + e.message, "error");
  } finally {
    showLoading(false);
  }
};

/* ── Utils ──────────────────────────────────────────────── */
function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function escapeAttr(s) {
  return String(s ?? "").replace(/"/g, "&quot;");
}

/* ── Boot ───────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
  buildPalette();
  bindSearch();
  load();
});
