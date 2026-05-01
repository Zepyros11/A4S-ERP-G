/* ============================================================
   manual-view.js — Reader page
   ============================================================ */
import { fetchChapters, fetchPages, fetchPageById } from "./manual-api.js";

const state = {
  chapters: [],
  pagesByChapter: {},
  currentPage: null,
  currentChapterId: null,
};

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
function canEdit() {
  return window.AuthZ ? AuthZ.hasPerm("manual_edit") : false;
}

/* ── boot ───────────────────────────────────────────────── */
async function boot() {
  showLoading(true);
  try {
    state.chapters = await fetchChapters();
    /* parallel fetch pages */
    const all = await Promise.all(
      state.chapters.map((c) => fetchPages({ chapterId: c.id })),
    );
    state.chapters.forEach((c, i) => (state.pagesByChapter[c.id] = all[i]));

    const params = new URLSearchParams(location.search);
    const pageId = params.get("page");
    const chapterId = params.get("chapter");

    if (pageId) {
      await loadPage(parseInt(pageId, 10));
    } else if (chapterId) {
      const id = parseInt(chapterId, 10);
      const firstPage = (state.pagesByChapter[id] || [])[0];
      if (firstPage) await loadPage(firstPage.id);
      else renderEmptyChapter(id);
    } else {
      /* default — first available page */
      const firstCh = state.chapters[0];
      const firstPage = firstCh ? (state.pagesByChapter[firstCh.id] || [])[0] : null;
      if (firstPage) {
        history.replaceState(null, "", `?page=${firstPage.id}`);
        await loadPage(firstPage.id);
      } else {
        renderEmpty();
      }
    }
    renderToc();
  } catch (e) {
    showToast("โหลดไม่สำเร็จ: " + e.message, "error");
  } finally {
    showLoading(false);
  }
}

async function loadPage(id) {
  const page = await fetchPageById(id);
  if (!page) {
    renderNotFound();
    return;
  }
  state.currentPage = page;
  state.currentChapterId = page.chapter_id;
  document.title = `${page.title} — คู่มือ A4S-ERP`;
  renderReader();
  renderToc();
  /* scroll reader into view on mobile */
  if (window.innerWidth < 900) {
    document.getElementById("reader").scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

/* ── TOC ───────────────────────────────────────────────── */
function renderToc() {
  const body = document.getElementById("tocBody");
  if (!state.chapters.length) {
    body.innerHTML = `<div class="man-empty"><div class="man-empty-msg">ยังไม่มีบท</div></div>`;
    return;
  }
  body.innerHTML = state.chapters
    .map((ch) => {
      const pages = state.pagesByChapter[ch.id] || [];
      const isActiveChapter = ch.id === state.currentChapterId;
      return `
        <div class="man-toc-chapter ${isActiveChapter ? "open" : ""}" data-ch="${ch.id}">
          <div class="man-toc-ch-hdr" onclick="window.toggleTocChapter(${ch.id})">
            <span>${escapeHtml(ch.icon || "📖")}</span>
            <span style="flex:1">${escapeHtml(ch.title)}</span>
            <span class="arrow">›</span>
          </div>
          <div class="man-toc-pages">
            ${
              pages.length
                ? pages
                    .map(
                      (p) =>
                        `<a class="man-toc-page${p.id === state.currentPage?.id ? " active" : ""}"
                           href="?page=${p.id}"
                           onclick="window.navTo(event, ${p.id})">
                          ${escapeHtml(p.title)}
                         </a>`,
                    )
                    .join("")
                : `<div style="font-size:12px;color:#94a3b8;padding:6px 10px;font-style:italic">ยังไม่มีหน้า</div>`
            }
          </div>
        </div>`;
    })
    .join("");
}

window.toggleTocChapter = function (id) {
  document.querySelector(`.man-toc-chapter[data-ch="${id}"]`)?.classList.toggle("open");
};

window.navTo = function (e, pageId) {
  e.preventDefault();
  history.pushState(null, "", `?page=${pageId}`);
  loadPage(pageId);
};
window.addEventListener("popstate", () => {
  const params = new URLSearchParams(location.search);
  const pageId = params.get("page");
  if (pageId) loadPage(parseInt(pageId, 10));
});

/* ── Reader ────────────────────────────────────────────── */
function renderReader() {
  const p = state.currentPage;
  const chapter = state.chapters.find((c) => c.id === p.chapter_id);
  const pages = state.pagesByChapter[p.chapter_id] || [];
  const idx = pages.findIndex((x) => x.id === p.id);
  const prev = idx > 0 ? pages[idx - 1] : findCrossChapter(-1);
  const next = idx < pages.length - 1 ? pages[idx + 1] : findCrossChapter(+1);

  const meta = [];
  if (chapter) meta.push(`${escapeHtml(chapter.icon || "📖")} ${escapeHtml(chapter.title)}`);
  meta.push(`⏱ ${p.reading_minutes || 1} นาที`);
  if (p.updated_at) {
    const fmt = window.DateFmt?.formatDMYTime?.(p.updated_at) || p.updated_at;
    meta.push(`📅 อัปเดต ${fmt}`);
  }
  if (!p.is_published) meta.push(`<span style="color:#d97706;font-weight:700">⚠ DRAFT</span>`);

  const editBtn = canEdit()
    ? `<a class="btn btn-outline" style="margin-left:auto" href="manual-edit.html?id=${p.id}">✏️ แก้ไข</a>`
    : "";

  const reader = document.getElementById("reader");
  reader.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <div>
        <div class="man-reader-eyebrow">${chapter ? escapeHtml(chapter.title) : ""}</div>
        <h1>${escapeHtml(p.title)}</h1>
      </div>
      ${editBtn}
      <button class="btn btn-outline" onclick="window.print()" title="พิมพ์/บันทึกเป็น PDF">🖨</button>
    </div>
    <div class="man-reader-meta">${meta.join(" · ")}</div>
    ${p.summary ? `<div class="man-reader-summary">${escapeHtml(p.summary)}</div>` : ""}
    <div class="man-prose">${renderBlocks(p.blocks || [])}</div>
    <div class="man-reader-nav">
      ${
        prev
          ? `<a class="man-nav-btn" href="?page=${prev.id}" onclick="window.navTo(event, ${prev.id})">
              <small>‹ หน้าก่อนหน้า</small><b>${escapeHtml(prev.title)}</b></a>`
          : `<span></span>`
      }
      ${
        next
          ? `<a class="man-nav-btn next" href="?page=${next.id}" onclick="window.navTo(event, ${next.id})">
              <small>หน้าถัดไป ›</small><b>${escapeHtml(next.title)}</b></a>`
          : `<span></span>`
      }
    </div>`;

  /* wire image click → popup */
  if (window.ImgPopup) {
    const imgs = Array.from(reader.querySelectorAll(".man-block-image img"));
    const urls = imgs.map((el) => el.src);
    const captions = imgs.map((el) => el.alt || "");
    imgs.forEach((el, i) => {
      el.addEventListener("click", () => ImgPopup.open(urls, i, { titles: captions }));
    });
  }
}

function findCrossChapter(dir) {
  /* dir = -1 (prev) or +1 (next) — jump to neighboring chapter's last/first page */
  const idx = state.chapters.findIndex((c) => c.id === state.currentChapterId);
  if (idx < 0) return null;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= state.chapters.length) return null;
  const targetCh = state.chapters[newIdx];
  const pages = state.pagesByChapter[targetCh.id] || [];
  if (!pages.length) return null;
  return dir < 0 ? pages[pages.length - 1] : pages[0];
}

function renderEmpty() {
  document.getElementById("reader").innerHTML = `
    <div class="man-empty">
      <div class="man-empty-ico">📚</div>
      <div class="man-empty-msg">ยังไม่มีคู่มือ</div>
      <a class="btn btn-primary" href="manual-list.html" style="margin-top:14px">← กลับหน้าสารบัญ</a>
    </div>`;
}
function renderEmptyChapter(chId) {
  const ch = state.chapters.find((c) => c.id === chId);
  document.getElementById("reader").innerHTML = `
    <div class="man-empty">
      <div class="man-empty-ico">${escapeHtml(ch?.icon || "📖")}</div>
      <div style="font-size:18px;font-weight:700;color:#0f172a;margin-top:8px">${escapeHtml(ch?.title || "บท")}</div>
      <div class="man-empty-msg">บทนี้ยังไม่มีหน้า</div>
      <a class="btn btn-outline" href="manual-list.html" style="margin-top:14px">← สารบัญ</a>
    </div>`;
}
function renderNotFound() {
  document.getElementById("reader").innerHTML = `
    <div class="man-empty">
      <div class="man-empty-ico">🔍</div>
      <div class="man-empty-msg">ไม่พบหน้านี้ — อาจถูกลบหรือยังไม่เผยแพร่</div>
      <a class="btn btn-primary" href="manual-list.html" style="margin-top:14px">← สารบัญ</a>
    </div>`;
}

/* ── Block renderer ─────────────────────────────────────── */
function renderBlocks(blocks) {
  if (!Array.isArray(blocks) || !blocks.length) {
    return `<p style="color:#94a3b8;font-style:italic">— ยังไม่มีเนื้อหา —</p>`;
  }
  return blocks.map(renderBlock).join("");
}

function renderBlock(b) {
  if (!b || !b.type) return "";
  switch (b.type) {
    case "heading": {
      const lvl = Math.min(Math.max(parseInt(b.level, 10) || 2, 2), 4);
      return `<h${lvl}>${escapeHtml(b.text || "")}</h${lvl}>`;
    }
    case "paragraph":
      return `<p>${inlineFormat(b.text || "")}</p>`;
    case "image": {
      const w = ["full", "medium", "small"].includes(b.width) ? b.width : "full";
      return `<figure class="man-block-image size-${w}">
        <img src="${escapeAttr(b.src || "")}" alt="${escapeAttr(b.caption || "")}" data-img-popup="1">
        ${b.caption ? `<figcaption>${escapeHtml(b.caption)}</figcaption>` : ""}
      </figure>`;
    }
    case "steps": {
      const items = Array.isArray(b.items) ? b.items : [];
      return `<div class="man-block-steps"><ol>
        ${items.map((s) => `<li>${inlineFormat(s)}</li>`).join("")}
      </ol></div>`;
    }
    case "callout": {
      const v = ["info", "tip", "warning", "success"].includes(b.variant) ? b.variant : "info";
      const titles = { info: "💡 หมายเหตุ", tip: "✨ เคล็ดลับ", warning: "⚠️ ข้อควรระวัง", success: "✅ สำเร็จ" };
      return `<div class="man-block-callout ${v}">
        <div class="man-block-callout-title">${b.title ? escapeHtml(b.title) : titles[v]}</div>
        <div>${inlineFormat(b.text || "")}</div>
      </div>`;
    }
    case "video": {
      const src = b.src || "";
      /* YouTube embed support */
      const yt = src.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([\w-]+)/);
      if (yt) {
        return `<div class="man-block-video">
          <iframe src="https://www.youtube.com/embed/${yt[1]}" allowfullscreen></iframe>
        </div>`;
      }
      return `<div class="man-block-video">
        <video src="${escapeAttr(src)}" ${b.poster ? `poster="${escapeAttr(b.poster)}"` : ""} controls></video>
      </div>`;
    }
    case "table": {
      const headers = Array.isArray(b.headers) ? b.headers : [];
      const rows = Array.isArray(b.rows) ? b.rows : [];
      return `<div class="man-block-table"><table>
        ${headers.length ? `<thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>` : ""}
        <tbody>
          ${rows
            .map(
              (r) =>
                `<tr>${(Array.isArray(r) ? r : [])
                  .map((c) => `<td>${inlineFormat(String(c ?? ""))}</td>`)
                  .join("")}</tr>`,
            )
            .join("")}
        </tbody>
      </table></div>`;
    }
    case "code":
      return `<pre class="man-block-code">${escapeHtml(b.text || "")}</pre>`;
    case "divider":
      return `<hr class="man-block-divider">`;
    default:
      return "";
  }
}

/* very small inline formatter — **bold**, *italic*, `code` */
function inlineFormat(s) {
  let out = escapeHtml(s);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|\W)\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");
  out = out.replace(/\n/g, "<br>");
  return out;
}

/* ── Utils ─────────────────────────────────────────────── */
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

document.addEventListener("DOMContentLoaded", boot);
