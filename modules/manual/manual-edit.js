/* ============================================================
   manual-edit.js — Block-based manual page editor
   ============================================================ */
import {
  fetchChapters,
  fetchPageById,
  createPage,
  updatePage,
  deletePage as apiDeletePage,
  uploadManualImage,
} from "./manual-api.js";

const state = {
  chapters: [],
  pageId: null,
  page: null,
  blocks: [],
  dirty: false,
  draggingIdx: null,
};

const DEFAULTS = {
  heading:   () => ({ type: "heading", level: 2, text: "" }),
  paragraph: () => ({ type: "paragraph", text: "" }),
  image:     () => ({ type: "image", src: "", caption: "", width: "full" }),
  steps:     () => ({ type: "steps", items: [""] }),
  callout:   () => ({ type: "callout", variant: "info", title: "", text: "" }),
  video:     () => ({ type: "video", src: "" }),
  table:     () => ({ type: "table", headers: ["คอลัมน์ 1", "คอลัมน์ 2"], rows: [["", ""], ["", ""]] }),
  code:      () => ({ type: "code", lang: "", text: "" }),
  divider:   () => ({ type: "divider" }),
};

const TYPE_LABEL = {
  heading: "🏷 หัวข้อ",
  paragraph: "📝 ข้อความ",
  image: "🖼️ รูปภาพ",
  steps: "📋 ขั้นตอน",
  callout: "💡 Callout",
  video: "🎬 วิดีโอ",
  table: "📊 ตาราง",
  code: "💻 โค้ด",
  divider: "➖ เส้นคั่น",
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
function setDirty(d) {
  state.dirty = d;
  const el = document.getElementById("saveStatus");
  if (!el) return;
  el.classList.toggle("dirty", d);
  el.classList.toggle("saved", !d);
  el.textContent = d ? "มีการแก้ไข — ยังไม่ได้บันทึก" : "บันทึกแล้ว";
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

/* ── boot ───────────────────────────────────────────────── */
async function boot() {
  showLoading(true);
  try {
    state.chapters = await fetchChapters({ includeUnpublished: true });
    populateChapterSelect();

    const params = new URLSearchParams(location.search);
    const id = params.get("id");
    const chapterParam = params.get("chapter");

    if (id) {
      state.pageId = parseInt(id, 10);
      state.page = await fetchPageById(state.pageId);
      if (!state.page) {
        showToast("ไม่พบหน้านี้", "error");
        setTimeout(() => (location.href = "manual-list.html"), 1500);
        return;
      }
      populateForm(state.page);
      document.getElementById("modeLabel").textContent = "แก้ไขหน้า";
      document.getElementById("btnDelete").style.display = "";
    } else {
      /* new page */
      if (chapterParam) document.getElementById("pgChapter").value = chapterParam;
      document.getElementById("pgPublished").checked = false;
      addInitialBlock();
      document.getElementById("modeLabel").textContent = "หน้าใหม่";
    }
    refreshPreviewLink();
    bindFormEvents();
    setDirty(false);
  } catch (e) {
    showToast("โหลดไม่สำเร็จ: " + e.message, "error");
  } finally {
    showLoading(false);
  }
}

function populateChapterSelect() {
  const sel = document.getElementById("pgChapter");
  sel.innerHTML = state.chapters
    .map((c) => `<option value="${c.id}">${escapeHtml(c.icon || "📖")} ${escapeHtml(c.title)}</option>`)
    .join("");
  if (!state.chapters.length) {
    sel.innerHTML = `<option value="">— ยังไม่มีบท —</option>`;
  }
}

function populateForm(p) {
  document.getElementById("pgTitle").value = p.title || "";
  document.getElementById("pgSummary").value = p.summary || "";
  document.getElementById("pgChapter").value = p.chapter_id || "";
  document.getElementById("pgSlug").value = p.slug || "";
  document.getElementById("pgOrder").value = p.sort_order ?? 0;
  document.getElementById("pgMinutes").value = p.reading_minutes ?? 3;
  document.getElementById("pgPublished").checked = !!p.is_published;
  state.blocks = Array.isArray(p.blocks) ? structuredClone(p.blocks) : [];
  if (!state.blocks.length) addInitialBlock(false);
  renderBlocks();
  updateHeader();
}

function addInitialBlock(markDirty = true) {
  state.blocks = [DEFAULTS.heading(), DEFAULTS.paragraph()];
  renderBlocks();
  if (markDirty) setDirty(true);
}

function bindFormEvents() {
  ["pgTitle", "pgSummary", "pgChapter", "pgSlug", "pgOrder", "pgMinutes", "pgPublished"].forEach((id) => {
    document.getElementById(id).addEventListener("input", () => {
      setDirty(true);
      if (id === "pgTitle") {
        if (!state.pageId && !document.getElementById("pgSlug").dataset.touched) {
          document.getElementById("pgSlug").value = slugify(document.getElementById("pgTitle").value);
        }
        updateHeader();
      }
    });
  });
  document.getElementById("pgSlug").addEventListener("input", (e) => {
    e.target.dataset.touched = "1";
  });

  /* Warn before leaving with unsaved changes */
  window.addEventListener("beforeunload", (e) => {
    if (state.dirty) {
      e.preventDefault();
      e.returnValue = "มีการแก้ไขที่ยังไม่บันทึก ออกหรือไม่?";
    }
  });
}

function updateHeader() {
  const t = document.getElementById("pgTitle").value.trim();
  document.getElementById("pageTitleHeader").textContent = t || "(ยังไม่ตั้งชื่อ)";
}

function refreshPreviewLink() {
  const a = document.getElementById("btnPreview");
  if (state.pageId) {
    a.href = `manual-view.html?page=${state.pageId}`;
  } else {
    a.href = "#";
    a.style.opacity = "0.5";
    a.title = "บันทึกก่อนเพื่อดูพรีวิว";
    a.addEventListener("click", (e) => {
      e.preventDefault();
      showToast("กรุณาบันทึกก่อน", "warning");
    });
  }
}

/* ── Block rendering ────────────────────────────────────── */
function renderBlocks() {
  const list = document.getElementById("blocksList");
  if (!state.blocks.length) {
    list.innerHTML = `<div class="man-empty"><div class="man-empty-msg">ยังไม่มี block — เลือกประเภทด้านล่างเพื่อเริ่มเขียน</div></div>`;
    return;
  }
  list.innerHTML = state.blocks.map((b, i) => renderBlockEditor(b, i)).join("");
  /* attach drag-drop */
  list.querySelectorAll(".man-block").forEach((el) => {
    el.addEventListener("dragstart", onDragStart);
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onDrop);
    el.addEventListener("dragend", onDragEnd);
  });
}

function renderBlockEditor(b, i) {
  const head = `
    <div class="man-block-type">
      <span>${TYPE_LABEL[b.type] || b.type}</span>
      <span class="man-block-actions">
        <button class="man-icon-btn" title="เลื่อนขึ้น" onclick="window.moveBlock(${i}, -1)">↑</button>
        <button class="man-icon-btn" title="เลื่อนลง" onclick="window.moveBlock(${i}, 1)">↓</button>
        <button class="man-icon-btn" title="คัดลอก" onclick="window.dupBlock(${i})">⎘</button>
        <button class="man-icon-btn danger" title="ลบ block" onclick="window.removeBlock(${i})">🗑</button>
      </span>
    </div>`;

  const body = renderBlockBody(b, i);

  return `
    <div class="man-block" draggable="true" data-idx="${i}">
      <div class="man-block-handle" title="ลากเพื่อจัดเรียง">⋮⋮</div>
      ${head}
      ${body}
    </div>`;
}

function renderBlockBody(b, i) {
  switch (b.type) {
    case "heading":
      return `
        <div class="man-block-row">
          <select onchange="window.updateBlock(${i}, 'level', parseInt(this.value,10))">
            <option value="2"${b.level === 2 ? " selected" : ""}>H2 (ใหญ่)</option>
            <option value="3"${b.level === 3 ? " selected" : ""}>H3 (กลาง)</option>
            <option value="4"${b.level === 4 ? " selected" : ""}>H4 (เล็ก)</option>
          </select>
          <input type="text" placeholder="หัวข้อ ..." value="${escapeAttr(b.text || "")}"
                 oninput="window.updateBlock(${i}, 'text', this.value)" />
        </div>`;

    case "paragraph":
      return `<textarea placeholder="พิมพ์ข้อความ ... รองรับ **bold** *italic* \`code\`"
              oninput="window.updateBlock(${i}, 'text', this.value)">${escapeHtml(b.text || "")}</textarea>`;

    case "image":
      return `
        <div class="man-image-drop" onclick="document.getElementById('img-${i}').click()">
          ${b.src ? `<img src="${escapeAttr(b.src)}" alt="">` : `<div style="font-size:34px">📁</div><div style="font-size:12.5px;color:#6366f1;margin-top:6px">คลิกเพื่อเลือกไฟล์ หรือลากวางที่นี่</div>`}
        </div>
        <input type="file" accept="image/*" id="img-${i}" style="display:none"
               onchange="window.uploadBlockImage(${i}, this.files[0])" />
        <div class="man-image-controls">
          <input type="text" placeholder="คำอธิบายภาพ (caption)" value="${escapeAttr(b.caption || "")}"
                 oninput="window.updateBlock(${i}, 'caption', this.value)" />
          <select onchange="window.updateBlock(${i}, 'width', this.value)">
            <option value="full"${b.width === "full" ? " selected" : ""}>เต็มความกว้าง</option>
            <option value="medium"${b.width === "medium" ? " selected" : ""}>กลาง 70%</option>
            <option value="small"${b.width === "small" ? " selected" : ""}>เล็ก 50%</option>
          </select>
        </div>`;

    case "steps": {
      const items = Array.isArray(b.items) ? b.items : [];
      return `
        <div id="steps-${i}">
          ${items
            .map(
              (s, j) => `
            <div class="man-block-row" style="margin-bottom:6px">
              <span style="width:24px;height:24px;border-radius:50%;background:#6366f1;color:#fff;font-size:11px;display:inline-flex;align-items:center;justify-content:center;font-weight:700">${j + 1}</span>
              <input type="text" placeholder="ขั้นตอนที่ ${j + 1}" value="${escapeAttr(s)}"
                     oninput="window.updateStepItem(${i}, ${j}, this.value)" />
              <button class="man-icon-btn danger" onclick="window.removeStep(${i}, ${j})">✕</button>
            </div>`,
            )
            .join("")}
        </div>
        <button class="btn btn-outline btn-sm" style="margin-top:6px" onclick="window.addStep(${i})">＋ เพิ่มขั้นตอน</button>`;
    }

    case "callout":
      return `
        <div class="man-block-row" style="margin-bottom:8px">
          <select onchange="window.updateBlock(${i}, 'variant', this.value)" style="flex:0 0 140px">
            <option value="info"${b.variant === "info" ? " selected" : ""}>💡 Info</option>
            <option value="tip"${b.variant === "tip" ? " selected" : ""}>✨ Tip</option>
            <option value="warning"${b.variant === "warning" ? " selected" : ""}>⚠️ Warning</option>
            <option value="success"${b.variant === "success" ? " selected" : ""}>✅ Success</option>
          </select>
          <input type="text" placeholder="หัวข้อ (เว้นว่างใช้ค่าเริ่มต้น)" value="${escapeAttr(b.title || "")}"
                 oninput="window.updateBlock(${i}, 'title', this.value)" />
        </div>
        <textarea placeholder="ข้อความ callout"
                  oninput="window.updateBlock(${i}, 'text', this.value)">${escapeHtml(b.text || "")}</textarea>`;

    case "video":
      return `
        <input type="text" placeholder="URL — รองรับ YouTube หรือไฟล์ .mp4" value="${escapeAttr(b.src || "")}"
               oninput="window.updateBlock(${i}, 'src', this.value)" />
        <div style="font-size:11.5px;color:#94a3b8;margin-top:4px">ตัวอย่าง: https://youtu.be/xxxxx หรือ https://.../video.mp4</div>`;

    case "table":
      return renderTableEditor(b, i);

    case "code":
      return `
        <div class="man-block-row" style="margin-bottom:6px">
          <input type="text" placeholder="ภาษา (เช่น sql, js)" value="${escapeAttr(b.lang || "")}"
                 oninput="window.updateBlock(${i}, 'lang', this.value)" style="max-width:160px" />
        </div>
        <textarea style="font-family:'IBM Plex Mono',monospace;font-size:13px;min-height:120px;background:#0f172a;color:#e2e8f0"
                  placeholder="SELECT * FROM ..."
                  oninput="window.updateBlock(${i}, 'text', this.value)">${escapeHtml(b.text || "")}</textarea>`;

    case "divider":
      return `<div style="text-align:center;color:#94a3b8;font-size:13px;padding:10px">— เส้นคั่น —</div>`;

    default:
      return `<div style="color:#94a3b8">ไม่รู้จัก block: ${escapeHtml(b.type)}</div>`;
  }
}

function renderTableEditor(b, i) {
  const headers = Array.isArray(b.headers) ? b.headers : [];
  const rows = Array.isArray(b.rows) ? b.rows : [];
  const cols = headers.length;
  const headerHtml = headers
    .map(
      (h, c) => `
    <th><input type="text" value="${escapeAttr(h)}"
        oninput="window.updateTableHeader(${i}, ${c}, this.value)" /></th>`,
    )
    .join("");
  const rowsHtml = rows
    .map(
      (r, ri) => `
    <tr>
      ${(Array.from({ length: cols }, (_, c) => r[c] ?? ""))
        .map(
          (cell, c) => `
        <td><input type="text" value="${escapeAttr(cell)}"
            oninput="window.updateTableCell(${i}, ${ri}, ${c}, this.value)" /></td>`,
        )
        .join("")}
      <td style="border:0;padding:0 0 0 6px;width:30px">
        <button class="man-icon-btn danger" onclick="window.removeTableRow(${i}, ${ri})" title="ลบแถว">✕</button>
      </td>
    </tr>`,
    )
    .join("");
  return `
    <table class="man-table-edit">
      <thead><tr>${headerHtml}<th style="border:0;background:transparent;width:30px"></th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div class="man-table-tools">
      <button class="btn btn-outline btn-sm" onclick="window.addTableRow(${i})">＋ แถว</button>
      <button class="btn btn-outline btn-sm" onclick="window.addTableCol(${i})">＋ คอลัมน์</button>
      <button class="btn btn-outline btn-sm" onclick="window.removeTableCol(${i})">− คอลัมน์</button>
    </div>`;
}

/* ── Block ops ─────────────────────────────────────────── */
window.addBlock = function (type) {
  const factory = DEFAULTS[type];
  if (!factory) return;
  state.blocks.push(factory());
  renderBlocks();
  setDirty(true);
};
window.removeBlock = async function (i) {
  const ok = await ConfirmModal.open({
    title: "ลบ block?",
    message: "ลบ block นี้ออกจากหน้านี้ — แก้ไขกลับได้จนกว่าจะกดบันทึก",
    icon: "🗑",
    okText: "ลบ", tone: "danger",
  });
  if (!ok) return;
  state.blocks.splice(i, 1);
  renderBlocks();
  setDirty(true);
};
window.dupBlock = function (i) {
  state.blocks.splice(i + 1, 0, structuredClone(state.blocks[i]));
  renderBlocks();
  setDirty(true);
};
window.moveBlock = function (i, dir) {
  const j = i + dir;
  if (j < 0 || j >= state.blocks.length) return;
  [state.blocks[i], state.blocks[j]] = [state.blocks[j], state.blocks[i]];
  renderBlocks();
  setDirty(true);
};
window.updateBlock = function (i, field, value) {
  if (!state.blocks[i]) return;
  state.blocks[i][field] = value;
  setDirty(true);
};

/* steps */
window.addStep = function (i) {
  if (!Array.isArray(state.blocks[i].items)) state.blocks[i].items = [];
  state.blocks[i].items.push("");
  renderBlocks();
  setDirty(true);
};
window.removeStep = function (i, j) {
  state.blocks[i].items.splice(j, 1);
  renderBlocks();
  setDirty(true);
};
window.updateStepItem = function (i, j, value) {
  state.blocks[i].items[j] = value;
  setDirty(true);
};

/* table */
window.updateTableHeader = function (i, c, value) {
  state.blocks[i].headers[c] = value;
  setDirty(true);
};
window.updateTableCell = function (i, ri, c, value) {
  if (!state.blocks[i].rows[ri]) state.blocks[i].rows[ri] = [];
  state.blocks[i].rows[ri][c] = value;
  setDirty(true);
};
window.addTableRow = function (i) {
  const cols = state.blocks[i].headers.length;
  state.blocks[i].rows.push(Array(cols).fill(""));
  renderBlocks();
  setDirty(true);
};
window.removeTableRow = function (i, ri) {
  state.blocks[i].rows.splice(ri, 1);
  renderBlocks();
  setDirty(true);
};
window.addTableCol = function (i) {
  state.blocks[i].headers.push(`คอลัมน์ ${state.blocks[i].headers.length + 1}`);
  state.blocks[i].rows.forEach((r) => r.push(""));
  renderBlocks();
  setDirty(true);
};
window.removeTableCol = function (i) {
  if (state.blocks[i].headers.length <= 1) return;
  state.blocks[i].headers.pop();
  state.blocks[i].rows.forEach((r) => r.pop());
  renderBlocks();
  setDirty(true);
};

/* image upload */
window.uploadBlockImage = async function (i, file) {
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    showToast("ไฟล์ใหญ่เกิน 10MB", "warning");
    return;
  }
  showLoading(true);
  try {
    const url = await uploadManualImage(file);
    state.blocks[i].src = url;
    renderBlocks();
    setDirty(true);
    showToast("อัปโหลดรูปสำเร็จ");
  } catch (e) {
    showToast("อัปโหลดไม่ได้: " + e.message, "error");
  } finally {
    showLoading(false);
  }
};

/* ── Drag-drop reorder ─────────────────────────────────── */
function onDragStart(e) {
  state.draggingIdx = parseInt(this.dataset.idx, 10);
  this.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
}
function onDragOver(e) {
  e.preventDefault();
  const idx = parseInt(this.dataset.idx, 10);
  if (state.draggingIdx === null || idx === state.draggingIdx) return;
  const rect = this.getBoundingClientRect();
  const isAbove = e.clientY < rect.top + rect.height / 2;
  this.classList.toggle("drop-above", isAbove);
  this.classList.toggle("drop-below", !isAbove);
}
function onDragLeave() {
  this.classList.remove("drop-above", "drop-below");
}
function onDrop(e) {
  e.preventDefault();
  const target = parseInt(this.dataset.idx, 10);
  this.classList.remove("drop-above", "drop-below");
  if (state.draggingIdx === null || target === state.draggingIdx) return;
  const rect = this.getBoundingClientRect();
  const isAbove = e.clientY < rect.top + rect.height / 2;
  const insertAt = isAbove ? target : target + 1;
  const adjusted = state.draggingIdx < insertAt ? insertAt - 1 : insertAt;
  const [moved] = state.blocks.splice(state.draggingIdx, 1);
  state.blocks.splice(adjusted, 0, moved);
  state.draggingIdx = null;
  renderBlocks();
  setDirty(true);
}
function onDragEnd() {
  this.classList.remove("dragging", "drop-above", "drop-below");
  state.draggingIdx = null;
}

/* ── Save / delete ──────────────────────────────────────── */
window.savePage = async function () {
  const title = document.getElementById("pgTitle").value.trim();
  if (!title) {
    showToast("กรุณาใส่ชื่อหน้า", "warning");
    return;
  }
  const chapter_id = parseInt(document.getElementById("pgChapter").value, 10);
  if (!chapter_id) {
    showToast("เลือกบทก่อน", "warning");
    return;
  }
  const slugInput = document.getElementById("pgSlug").value.trim();
  const payload = {
    chapter_id,
    title,
    slug: slugInput || slugify(title) || `page-${Date.now()}`,
    summary: document.getElementById("pgSummary").value.trim() || null,
    blocks: state.blocks,
    sort_order: parseInt(document.getElementById("pgOrder").value, 10) || 0,
    reading_minutes: parseInt(document.getElementById("pgMinutes").value, 10) || 1,
    is_published: document.getElementById("pgPublished").checked,
    updated_by: window.ERP_USER?.user_id || null,
  };

  showLoading(true);
  try {
    if (state.pageId) {
      await updatePage(state.pageId, payload);
      showToast("บันทึกเรียบร้อย");
    } else {
      const created = await createPage(payload);
      state.pageId = created?.id;
      state.page = created;
      if (state.pageId) {
        history.replaceState(null, "", `?id=${state.pageId}`);
        document.getElementById("modeLabel").textContent = "แก้ไขหน้า";
        document.getElementById("btnDelete").style.display = "";
        refreshPreviewLink();
      }
      showToast("สร้างหน้าใหม่สำเร็จ");
    }
    setDirty(false);
  } catch (e) {
    showToast("บันทึกไม่ได้: " + e.message, "error");
  } finally {
    showLoading(false);
  }
};

window.deletePage = async function () {
  if (!state.pageId) return;
  const ok = await ConfirmModal.open({
    title: "ลบหน้านี้?",
    icon: "🗑",
    message: `ต้องการลบหน้า "${state.page?.title || ""}" หรือไม่?`,
    note: "⚠️ การลบเป็นการลบถาวร ย้อนกลับไม่ได้",
    okText: "ลบเลย", tone: "danger",
  });
  if (!ok) return;
  showLoading(true);
  try {
    await apiDeletePage(state.pageId);
    showToast("ลบหน้าแล้ว");
    state.dirty = false;
    setTimeout(() => (location.href = "manual-list.html"), 800);
  } catch (e) {
    showToast("ลบไม่ได้: " + e.message, "error");
  } finally {
    showLoading(false);
  }
};

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
