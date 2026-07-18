/* ============================================================
   web-editor.js — Website Builder (canvas drag & drop)
   ============================================================
   ทำงานบน blocks JSONB ของ web_pages เท่านั้น
   HTML ที่เห็นใน canvas = ตัวเดียวกับหน้า public (js/shared/web-render.js)
   ============================================================ */

const SB_URL = localStorage.getItem("sb_url") || "";
const SB_KEY = localStorage.getItem("sb_key") || "";
const HDRS = { apikey: SB_KEY, Authorization: "Bearer " + SB_KEY };

/* ── state ── */
let page = null;        /* แถวจาก web_pages */
let blocks = [];        /* array ที่กำลังแก้ (ยังไม่บันทึก) */
let selectedId = null;
let dirty = false;

/* ============================================================
   REST helpers
   ============================================================ */
async function sbGet(path) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: HDRS });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function sbPatch(path, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: { ...HDRS, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function toast(msg, type = "success") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove("show"), 3000);
}
function loading(show) {
  document.getElementById("loadingOverlay")?.classList.toggle("show", show);
}

function setDirty(v) {
  dirty = v;
  document.getElementById("dirtyFlag").style.display = v ? "inline" : "none";
}

/* ============================================================
   Load
   ============================================================ */
async function init() {
  renderCats();
  requestAnimationFrame(syncNavHeight);
  initSplitter();
  const id = new URLSearchParams(location.search).get("id");
  try {
    loading(true);
    const q = id ? `id=eq.${encodeURIComponent(id)}` : `is_home=eq.true`;
    const rows = await sbGet(`web_pages?${q}&select=*&limit=1`);
    if (!rows.length) {
      document.getElementById("canvas").innerHTML =
        `<div class="wb-empty">ไม่พบหน้านี้<br />ตรวจว่ารัน sql/171_web_pages.sql แล้วหรือยัง</div>`;
      return;
    }
    page = rows[0];
    blocks = (page.blocks || []).map((b) => window.WebBlocks.withDefaults(b));
    document.getElementById("heroTitle").textContent = "✏️ " + page.title;
    document.getElementById("heroSub").textContent =
      `/${page.slug} · ${page.status === "published" ? "เผยแพร่แล้ว" : "ฉบับร่าง"} · ลากบล็อกจากซ้ายมาวาง · คลิกบล็อกเพื่อแก้เนื้อหา`;
    renderCanvas();
    loadPagesForSelect(); /* เติม dropdown "ลิงก์โลโก้" — ไม่ต้อง await กันหน้าค้าง */
  } catch (e) {
    console.error(e);
    toast("โหลดหน้าไม่สำเร็จ: " + e.message, "error");
  } finally {
    loading(false);
  }
}

/* รายชื่อหน้าเว็บสำหรับ select optionsFrom:"pages" (เช่น ลิงก์โลโก้)
   เก็บที่ window.__wbPages ให้ inputHtml อ่าน · fallback = หน้าปัจจุบัน ถ้าโหลดไม่ได้ */
async function loadPagesForSelect() {
  try {
    window.__wbPages = await sbGet("web_pages?select=slug,title&order=title");
  } catch (e) {
    window.__wbPages = page ? [{ slug: page.slug, title: page.title }] : [];
  }
}

/* ============================================================
   Palette
   ============================================================ */
/* ── ระดับ 1: หมวด ── */
function renderCats() {
  document.getElementById("catList").innerHTML = window.WebBlocks.GROUPS.map((g) => {
    const n = window.WebBlocks.byGroup(g.key).length;
    return `<button class="wb-cat" onclick="openCat('${g.key}')">
      <span class="wb-cat-icon">${g.icon}</span>
      <span class="wb-cat-txt">
        <div class="wb-cat-name">${g.label}</div>
        <div class="wb-cat-hint">${g.hint}</div>
      </span>
      <span class="wb-cat-count">${n}</span>
      <span class="wb-cat-arrow">›</span>
    </button>`;
  }).join("");
}

/* ── ระดับ 2: บล็อกในหมวด ── */
function renderPalette(groupKey) {
  /* ใช้ wireframe (b.wire) ไม่ใช่ block จริงย่อส่วน — ดูเหตุผลใน js/shared/web-blocks.js
     SVG ปรับขนาดเองตาม viewBox ไม่ต้องคำนวณ scale ด้วย JS (เลี่ยงปัญหา zoom ไปในตัว) */
  document.getElementById("palette").innerHTML = window.WebBlocks.byGroup(groupKey)
    .map(
      (b) => `
    <div class="wb-palette-item" draggable="true" data-new="${b.type}">
      <div class="wb-palette-label"><span class="wb-palette-icon">${b.icon}</span><span>${b.label}</span></div>
      <div class="wb-thumb">${b.wire || ""}</div>
    </div>`
    )
    .join("");

  document.querySelectorAll("[data-new]").forEach((el) => {
    el.addEventListener("dragstart", (e) =>
      e.dataTransfer.setData("text/plain", "new:" + el.dataset.new)
    );
  });
}

/* ความสูงของกรอบสไลด์ = แผ่นที่กำลังโชว์ (offsetHeight = CSS px ระบบเดียวกับ style.height → zoom ไม่กวน) */
function syncNavHeight() {
  const nav = document.getElementById("wbNav");
  if (!nav) return;
  const active = document.getElementById(nav.classList.contains("level2") ? "paneBlocks" : "paneCats");
  nav.style.height = active.offsetHeight + "px";
}

function openCat(key) {
  const g = window.WebBlocks.GROUPS.find((x) => x.key === key);
  if (!g) return;
  renderPalette(key);
  document.getElementById("backLabel").textContent = `ทุกหมวด · ${g.label}`;
  document.getElementById("wbNav").classList.add("level2");
  requestAnimationFrame(syncNavHeight); /* รอ palette วาดเสร็จก่อนค่อยวัดความสูง */
}

function backToCats() {
  document.getElementById("wbNav").classList.remove("level2");
  syncNavHeight();
}

window.addEventListener("resize", () => requestAnimationFrame(syncNavHeight));

/* ============================================================
   Canvas
   ============================================================ */
function renderCanvas() {
  const c = document.getElementById("canvas");
  if (!blocks.length) {
    c.innerHTML = `<div class="wb-empty">ยังไม่มีบล็อก<br />ลากจากแถบซ้ายมาวางที่นี่</div>`;
    return;
  }
  c.innerHTML = blocks.map((b) => blockShell(b)).join("");
  if (selectedId) {
    const el = c.querySelector(`[data-id="${selectedId}"]`);
    if (el) el.classList.add("selected");
  }
}

function blockShell(b) {
  const def = window.WebBlocks.get(b.type);
  return `<div class="wb-block" data-id="${b.id}" draggable="true">
    <div class="wb-block-tag">${def ? def.icon + " " + def.label : b.type}</div>
    <div class="wb-block-bar">
      <button class="wb-grip" title="ลากเพื่อสลับลำดับ">⠿</button>
      <button data-act="up"  title="เลื่อนขึ้น">▲</button>
      <button data-act="down" title="เลื่อนลง">▼</button>
      <button data-act="dup" title="ทำซ้ำ">⧉</button>
      <button data-act="del" title="ลบ (กด Del ก็ได้)">✕</button>
    </div>
    ${window.WebRender.block(b)}
  </div>`;
}

/* วาดใหม่เฉพาะ block เดียว — กันไม่ให้ช่องกรอกใน props เสีย focus ตอนพิมพ์ */
function refreshBlock(id) {
  const el = document.querySelector(`.wb-block[data-id="${id}"]`);
  const b = blocks.find((x) => x.id === id);
  if (!el || !b) return;
  const wasSelected = el.classList.contains("selected");
  el.outerHTML = blockShell(b);
  if (wasSelected)
    document.querySelector(`.wb-block[data-id="${id}"]`)?.classList.add("selected");
}

/* ── canvas events (delegate — block ถูกวาดใหม่บ่อย) ── */
document.addEventListener("click", (e) => {
  const bar = e.target.closest(".wb-block-bar button");
  if (bar) {
    const id = bar.closest(".wb-block").dataset.id;
    const act = bar.dataset.act;
    if (act) { e.stopPropagation(); blockAction(id, act); }
    return;
  }
  const blk = e.target.closest(".wb-block");
  if (blk) { select(blk.dataset.id); return; }
  /* คลิกที่ว่างใน canvas = เลิกเลือก → เด้งกลับแท็บบล็อกให้ลากตัวถัดไปต่อได้ */
  if (e.target.closest(".wb-canvas-wrap")) deselect();
});

function blockAction(id, act) {
  const i = blocks.findIndex((b) => b.id === id);
  if (i < 0) return;
  if (act === "up" && i > 0) [blocks[i - 1], blocks[i]] = [blocks[i], blocks[i - 1]];
  else if (act === "down" && i < blocks.length - 1) [blocks[i + 1], blocks[i]] = [blocks[i], blocks[i + 1]];
  else if (act === "dup") {
    const copy = JSON.parse(JSON.stringify(blocks[i]));
    copy.id = "b" + Math.random().toString(36).slice(2, 9);
    blocks.splice(i + 1, 0, copy);
  } else if (act === "del") {
    delBlock(i, id);
    return;
  } else return;
  setDirty(true);
  renderCanvas();
}

async function delBlock(i, id) {
  const def = window.WebBlocks.get(blocks[i].type);
  const ok = await ConfirmModal.open({
    title: "ลบบล็อก",
    message: `ลบบล็อก "${def?.label || blocks[i].type}" ออกจากหน้านี้?`,
    icon: "🗑️",
    okText: "ลบ",
    tone: "danger",
  });
  if (!ok) return;
  blocks.splice(i, 1);
  if (selectedId === id) { selectedId = null; renderProps(); switchTab("blocks"); }
  setDirty(true);
  renderCanvas();
}

/* ============================================================
   เส้นแบ่ง — ลากปรับความกว้างแผง (จำค่าไว้ต่อเครื่อง)
   ============================================================ */
const PANE_KEY = "wb_pane_w";
const PANE_MIN = 240;
const PANE_MAX = 680;

function initSplitter() {
  const split = document.getElementById("wbSplit");
  const shell = document.querySelector(".wb-shell");
  const side = document.querySelector(".wb-side");
  if (!split || !shell || !side) return;

  const apply = (w) => shell.style.setProperty("--wb-pane-w", Math.round(w) + "px");

  const saved = parseInt(localStorage.getItem(PANE_KEY) || "", 10);
  if (saved >= PANE_MIN && saved <= PANE_MAX) apply(saved);

  let startX = 0, startW = 0, zoom = 1;

  const onMove = (e) => {
    /* e.clientX = พิกเซลจริงบนจอ · แต่ --wb-pane-w อยู่ในพิกัด CSS ที่ :root{zoom:.65} ย่อไปแล้ว
       → ระยะที่เมาส์ลากต้องหาร zoom ก่อน ไม่งั้นแผงขยายช้ากว่ามือ 35% */
    apply(Math.min(PANE_MAX, Math.max(PANE_MIN, startW + (e.clientX - startX) / zoom)));
  };

  const onUp = () => {
    split.classList.remove("dragging");
    document.body.style.userSelect = "";
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    const cur = parseInt(shell.style.getPropertyValue("--wb-pane-w"), 10);
    if (cur) localStorage.setItem(PANE_KEY, cur);
  };

  split.addEventListener("pointerdown", (e) => {
    e.preventDefault(); /* กันเบราว์เซอร์ลาก selection แทน */
    zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    startX = e.clientX;
    startW = side.offsetWidth; /* offsetWidth = CSS px ระบบเดียวกับ --wb-pane-w */
    split.classList.add("dragging");
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });

  /* ดับเบิลคลิก = คืนค่าเริ่มต้น (กันลากเพลินจนแผงเบียดจนใช้ไม่ได้แล้วกลับเองไม่ถูก) */
  split.addEventListener("dblclick", () => {
    shell.style.removeProperty("--wb-pane-w");
    localStorage.removeItem(PANE_KEY);
    toast("คืนความกว้างเริ่มต้นแล้ว");
  });
}

/* ============================================================
   แท็บแผงซ้าย — บล็อก ↔ ตั้งค่า
   ============================================================ */
function switchTab(name) {
  document.querySelectorAll(".wb-tab").forEach((t) =>
    t.classList.toggle("active", t.dataset.tab === name)
  );
  document.getElementById("tabBlocks").hidden = name !== "blocks";
  document.getElementById("tabProps").hidden = name !== "props";
}

function select(id) {
  selectedId = id;
  document.querySelectorAll(".wb-block").forEach((el) =>
    el.classList.toggle("selected", el.dataset.id === id)
  );
  renderProps();
  switchTab("props"); /* เลือกบล็อก = อยากแก้ → พาไปเลย */
}

/* ยกเลิกเลือก → กลับไปแท็บบล็อก (ไม่งั้นติดอยู่แท็บตั้งค่าที่ว่างเปล่า) */
function deselect() {
  if (!selectedId) return;
  selectedId = null;
  document.querySelectorAll(".wb-block.selected").forEach((el) =>
    el.classList.remove("selected")
  );
  renderProps();
  switchTab("blocks");
}

/* ── คีย์ลัดบน canvas ──
   ESC    = เลิกเลือก (ทางกลับที่เร็วที่สุด)
   Del    = ลบบล็อกที่เลือก (ยังเด้งยืนยันเหมือนกดปุ่ม ✕ — ลบพลาดแล้วงานหาย) */
document.addEventListener("keydown", (e) => {
  /* มี modal เปิดอยู่ → ปล่อยให้ modal จัดการคีย์เอง
     โปรเจกต์นี้มี 3 convention ต้องเช็คให้ครบ ไม่งั้น guard หลุด:
     form modal = .modal-overlay.open · ConfirmModal = .cm-overlay.open · DeleteModal = .dm-overlay.active */
  if (document.querySelector(".modal-overlay.open, .cm-overlay.open, .dm-overlay.active")) return;

  if (e.key === "Escape") { deselect(); return; }

  if (e.key === "Delete" || e.key === "Backspace") {
    /* กำลังพิมพ์อยู่ในช่องกรอก → Del/Backspace เป็นของช่องนั้น ห้ามไปลบบล็อก
       (ไม่กันข้อนี้ = พิมพ์แก้ข้อความแล้วลบตัวอักษร กลายเป็นลบทั้งบล็อก) */
    const t = e.target;
    if (t && (t.matches("input, textarea, select") || t.isContentEditable)) return;
    if (!selectedId) return;
    e.preventDefault();
    const i = blocks.findIndex((b) => b.id === selectedId);
    if (i >= 0) delBlock(i, selectedId);
  }
});

/* ============================================================
   Drag & drop — ลากจาก palette มาวาง / ลากสลับลำดับใน canvas
   ============================================================ */
let dragId = null;

document.addEventListener("dragstart", (e) => {
  const blk = e.target.closest(".wb-block");
  if (!blk) return;
  dragId = blk.dataset.id;
  e.dataTransfer.setData("text/plain", "move:" + dragId);
  blk.classList.add("dragging");
});
document.addEventListener("dragend", () => {
  document.querySelectorAll(".dragging").forEach((el) => el.classList.remove("dragging"));
  clearDropLine();
  dragId = null;
});

const canvasEl = () => document.getElementById("canvas");

function clearDropLine() {
  document.querySelectorAll(".wb-drop-line").forEach((el) => el.remove());
}

/* หาตำแหน่งที่จะแทรก จากเมาส์เทียบจุดกึ่งกลางของแต่ละ block */
function dropIndex(y) {
  const els = [...canvasEl().querySelectorAll(".wb-block")];
  for (let i = 0; i < els.length; i++) {
    const r = els[i].getBoundingClientRect();
    if (y < r.top + r.height / 2) return i;
  }
  return els.length;
}

function showDropLine(idx) {
  clearDropLine();
  const line = document.createElement("div");
  line.className = "wb-drop-line";
  const els = [...canvasEl().querySelectorAll(".wb-block")];
  if (idx >= els.length) canvasEl().appendChild(line);
  else els[idx].before(line);
}

document.addEventListener("dragover", (e) => {
  const c = canvasEl();
  if (!c || !c.contains(e.target) && e.target !== c) return;
  e.preventDefault();
  showDropLine(dropIndex(e.clientY));
});

document.addEventListener("drop", (e) => {
  const c = canvasEl();
  if (!c || (!c.contains(e.target) && e.target !== c)) return;
  e.preventDefault();
  const data = e.dataTransfer.getData("text/plain") || "";
  let idx = dropIndex(e.clientY);
  clearDropLine();

  let added = false;
  if (data.startsWith("new:")) {
    const nb = window.WebBlocks.newBlock(data.slice(4));
    if (!nb) return;
    blocks.splice(idx, 0, nb);
    selectedId = nb.id;
    added = true;
  } else if (data.startsWith("move:")) {
    const id = data.slice(5);
    const from = blocks.findIndex((b) => b.id === id);
    if (from < 0) return;
    if (idx > from) idx--;              /* ตัวเองถูกดึงออกก่อน index เลื่อน */
    if (idx === from) return;
    const [moved] = blocks.splice(from, 1);
    blocks.splice(idx, 0, moved);
  } else return;

  setDirty(true);
  renderCanvas();
  renderProps();
  /* ลากบล็อกใหม่มาวาง = ปกติอยากแก้ทันที → พาไปแท็บตั้งค่า
     ส่วนการลากสลับลำดับ ไม่ต้องสลับแท็บ (กำลังจัดโครงอยู่) */
  if (added) switchTab("props");
});

/* ============================================================
   Properties panel
   ============================================================ */
function renderProps() {
  const host = document.getElementById("props");
  const hdr = document.getElementById("propsHdr");
  const b = blocks.find((x) => x.id === selectedId);
  if (!b) {
    hdr.textContent = "⚙️ ตั้งค่า";
    host.innerHTML = `<div class="wb-hint">คลิกบล็อกใน canvas<br />เพื่อแก้เนื้อหา</div>`;
    return;
  }
  const def = window.WebBlocks.get(b.type);
  hdr.textContent = `${def.icon} ${def.label}`;
  /* block ที่มี section marker → โหมดแบ่งหมวด (หัวข้อเทา + แถวแนวนอน) เช่น site_header
     block อื่น → โหมดเดิม (ป้ายสีเขียว + เส้นคั่น) ไม่กระทบ */
  const sectioned = def.fields.some((f) => f.section);
  host.innerHTML = def.fields
    .map((f, i) => {
      if (f.section) return `<div class="wb-section">${f.section}</div>`;
      if (f.type === "textsetting") return textSettingHtml(f, b.props);
      const sep = !sectioned && !f.half && i > 0 ? '<div class="wb-sep"></div>' : "";
      return sep + fieldHtml(f, b.props[f.key], sectioned);
    })
    .join("");
}

/* ── TextSetting: ชุดตั้งค่าข้อความรวม (พับได้) — ใช้ซ้ำได้ทุกที่ที่ต้องตั้งค่าข้อความ ──
   อ่าน/เขียนผ่าน f.map → prop key เดิม (ไม่มี state ใหม่นอกจาก weight/align ที่ contract ตั้ง default ให้)
   ทุก sub-control ใส่ data-fk = key จริง → ไหลผ่าน input/click handler เดิม */
function tsAttr(k) { return `data-fk="${k}"`; }

function swatchesHtml(fk, val, list) {
  const cur = String(val ?? "").trim().toLowerCase();
  const hex = /^#[0-9a-f]{6}$/i.test(cur) ? cur : "#000000";
  const btns = (list || [])
    .map((c) => `<button type="button" class="wb-sw${cur === c.toLowerCase() ? " active" : ""}" ${tsAttr(fk)} data-swatch="${c}" style="--sw:${c}" title="${c}"></button>`)
    .join("");
  const custom = cur && !(list || []).some((c) => c.toLowerCase() === cur);
  return `<div class="wb-swatches">${btns}<label class="wb-sw-custom${custom ? " active" : ""}" title="กำหนดเอง"><input type="color" ${tsAttr(fk)} value="${hex}" /><span>+</span></label></div>`;
}

/* ปุ่มกลุ่มเลือก 1 ตัว (S/M/L/XL · บาง/ปกติ/หนา · ซ้าย/กลาง/ขวา) */
function btnGroup(fk, cur, opts, extraCls) {
  return `<div class="wb-btngroup${extraCls ? " " + extraCls : ""}">${opts
    .map((o) => `<button type="button" class="wb-gbtn${String(cur) === String(o.value) ? " active" : ""}" ${tsAttr(fk)} data-setbtn="1" data-val="${o.value}"${o.num ? " data-num=\"1\"" : ""}${o.title ? ` title="${o.title}"` : ""}>${o.label}</button>`)
    .join("")}</div>`;
}

const ALIGN_ICON = {
  left: `<svg width="14" height="12"><rect y="1" width="13" height="2"/><rect y="5" width="8" height="2"/><rect y="9" width="11" height="2"/></svg>`,
  center: `<svg width="14" height="12"><rect x="0.5" y="1" width="13" height="2"/><rect x="3" y="5" width="8" height="2"/><rect x="1.5" y="9" width="11" height="2"/></svg>`,
  right: `<svg width="14" height="12"><rect x="1" y="1" width="13" height="2"/><rect x="6" y="5" width="8" height="2"/><rect x="3" y="9" width="11" height="2"/></svg>`,
};

function textSettingHtml(f, props) {
  const m = f.map;
  const text = props[m.text] ?? "";
  const size = props[m.size];
  const weight = props[m.weight] || "normal";
  const align = props[m.align] || "left";
  const P = window.WebBlocks.SIZE_PRESETS;
  /* preset ที่ตรงกับ size ปัจจุบัน (ไม่ตรง = custom → ไม่มีปุ่ม preset ไฮไลต์) */
  const presetVal = Object.keys(P).find((k) => +P[k] === +size);

  const sizeBtns = btnGroup(
    m.size,
    presetVal || "",
    ["s", "m", "l", "xl"].map((k) => ({ value: P[k], label: k.toUpperCase(), num: true }))
  );
  const weightBtns = btnGroup(m.weight, weight, [
    { value: "light", label: "บาง" }, { value: "normal", label: "ปกติ" }, { value: "bold", label: "หนา" },
  ]);
  const alignBtns = btnGroup(m.align, align, [
    { value: "left", label: ALIGN_ICON.left, title: "ซ้าย" },
    { value: "center", label: ALIGN_ICON.center, title: "กลาง" },
    { value: "right", label: ALIGN_ICON.right, title: "ขวา" },
  ], "wb-icons");

  const preview = window.WebRender.esc(String(text).slice(0, 22));
  return `<details class="wb-ts">
    <summary class="wb-ts-head">
      <span class="wb-ts-label">${f.label}</span>
      <span class="wb-ts-preview">${preview}</span>
    </summary>
    <div class="wb-ts-body">
      <input type="text" class="wb-ts-text" ${tsAttr(m.text)} value="${window.WebRender.esc(text)}" placeholder="ข้อความ" />
      <div class="wb-ts-field"><label>ขนาด</label>
        <div class="wb-ts-size">${sizeBtns}<span class="wb-ts-or">หรือ</span>
          <input type="number" class="wb-ts-px" ${tsAttr(m.size)} value="${window.WebRender.esc(size ?? "")}" min="${f.min ?? 8}" max="${f.max ?? 120}" step="1" /><span class="wb-ts-unit">px</span></div>
      </div>
      <div class="wb-ts-field"><label>น้ำหนัก</label>${weightBtns}</div>
      <div class="wb-ts-field"><label>สี</label>${swatchesHtml(m.color, props[m.color], f.swatches)}</div>
      <div class="wb-ts-field"><label>จัดวาง</label>${alignBtns}</div>
    </div>
  </details>`;
}

function fieldHtml(f, val, sectioned) {
  if (f.type === "list") return listHtml(f, val || [], sectioned);
  /* row = แถวแนวนอน (label ซ้าย/ตัวคุมขวา) · half = ครึ่งกว้างเรียงคู่
     head (ป้ายสีเขียว) = เฉพาะ block โหมดเดิมที่ไม่มี section */
  let cls = "wb-field";
  if (f.row) cls += " wb-field--row";
  else if (f.half) cls += " wb-field--half";
  else if (!sectioned) cls += " wb-field--head";
  return `<div class="${cls}"><label>${f.label}</label>${inputHtml(f, val, {})}</div>`;
}

/* ctx = { idx, sub } สำหรับ field ที่อยู่ใน repeater */
function inputHtml(f, val, ctx) {
  const attrs = `data-fk="${ctx.fk || f.key}"${ctx.idx != null ? ` data-idx="${ctx.idx}" data-sub="${f.key}"` : ""}`;
  const v = window.WebRender.esc(val ?? "");
  if (f.type === "toggle") {
    /* ใช้ .switch/.slider ของ design system (css/components/components.css) */
    return `<label class="switch"><input type="checkbox" ${attrs} ${window.WebRender.on(val) ? "checked" : ""} /><span class="slider"></span></label>`;
  }
  if (f.type === "textarea") return `<textarea ${attrs}>${v}</textarea>`;
  if (f.type === "number")
    return `<input type="number" ${attrs} value="${v}" min="${f.min ?? 1}" max="${f.max ?? 200}" step="1" />`;
  if (f.type === "select") {
    /* optionsFrom "pages" = เติม dropdown จากหน้าเว็บจริง (โหลดไว้ที่ window.__wbPages) */
    const opts =
      f.optionsFrom === "pages"
        ? (window.__wbPages || []).map((pg) => ({ value: pg.slug, label: pg.title }))
        : f.options || [];
    return `<select ${attrs}>${opts
      .map((o) => `<option value="${window.WebRender.esc(o.value)}"${String(val) === String(o.value) ? " selected" : ""}>${window.WebRender.esc(o.label)}</option>`)
      .join("")}</select>`;
  }
  if (f.type === "segment") {
    /* ปุ่มเลือก 1 ตัว (ซ้าย/กลาง) = radio ซ่อน + label เป็นปุ่ม → ไหลผ่าน input handler เป็นค่าปกติ */
    const nm = `seg-${ctx.fk || f.key}-${ctx.idx ?? ""}`;
    return `<div class="wb-seg">${(f.options || [])
      .map((o) => `<label class="wb-seg-btn"><input type="radio" ${attrs} name="${nm}" value="${window.WebRender.esc(o.value)}"${String(val) === String(o.value) ? " checked" : ""} /><span>${window.WebRender.esc(o.label)}</span></label>`)
      .join("")}</div>`;
  }
  if (f.type === "range") {
    const rv = window.WebRender.esc(val ?? f.min ?? 0);
    return `<div class="wb-range"><input type="range" ${attrs} min="${f.min ?? 0}" max="${f.max ?? 100}" step="${f.step ?? 1}" value="${rv}" /><span class="wb-range-val" data-unit="${f.unit || ""}">${rv}${f.unit || ""}</span></div>`;
  }
  if (f.type === "swatch") {
    /* ปุ่มสีแบรนด์ + ปุ่ม "+" (color picker) → เก็บค่าใน prop key เดิม (ไม่มี state ใหม่)
       ปุ่มที่ตรงกับค่าปัจจุบัน = ไฮไลต์ · ถ้าค่าไม่ตรงปุ่มไหน = ปุ่ม "+" ไฮไลต์แทน (สีกำหนดเอง) */
    const cur = String(val ?? "").trim().toLowerCase();
    const hex = /^#[0-9a-f]{6}$/i.test(cur) ? cur : "#000000";
    const list = f.swatches || [];
    const btns = list
      .map((c) => `<button type="button" class="wb-sw${cur === c.toLowerCase() ? " active" : ""}" ${attrs} data-swatch="${c}" style="--sw:${c}" title="${c}"></button>`)
      .join("");
    const custom = cur && !list.some((c) => c.toLowerCase() === cur);
    return `<div class="wb-swatches">${btns}<label class="wb-sw-custom${custom ? " active" : ""}" title="กำหนดเอง"><input type="color" ${attrs} value="${hex}" /><span>+</span></label></div>`;
  }
  if (f.type === "color") {
    /* 2 ช่องคู่กัน: จานสี (เลือกเร็ว) + hex (วางค่าจาก brand guide ได้)
       ทั้งคู่ data-fk เดียวกัน → sync กันในตัว handler */
    const hex = /^#[0-9a-f]{6}$/i.test(v) ? v : "#000000";
    return `<div class="wb-color-row">
        <input type="color" ${attrs} value="${hex}" />
        <input type="text" ${attrs} value="${v}" class="wb-color-hex" spellcheck="false" />
      </div>`;
  }
  if (f.type === "image") {
    return `<div class="wb-img-row">
        <input type="text" ${attrs} value="${v}" placeholder="วาง URL หรือกดอัปโหลด" />
        <button class="btn btn-outline btn-sm" data-upload="1" ${attrs}>📤</button>
      </div>
      <div class="wb-img-thumb" ${val ? `style="background-image:url('${v}')"` : ""}>${val ? "" : "ยังไม่มีรูป"}</div>`;
  }
  return `<input type="text" ${attrs} value="${v}" />`;
}

function listHtml(f, arr, sectioned) {
  /* --head (ป้ายสีเขียว) เฉพาะ block โหมดเดิม · ในโหมด section ใช้ label ธรรมดา */
  return `<div class="wb-field${sectioned ? "" : " wb-field--head"}">
    <label>${f.label} (${arr.length})</label>
    ${arr.map((item, idx) => `
      <div class="wb-list-item">
        <div class="wb-list-item-hdr">
          <span>#${idx + 1}</span>
          <div>
            <button data-lact="up"  data-fk="${f.key}" data-idx="${idx}" title="ขึ้น">▲</button>
            <button data-lact="down" data-fk="${f.key}" data-idx="${idx}" title="ลง">▼</button>
            <button data-lact="del" data-fk="${f.key}" data-idx="${idx}" title="ลบ">✕</button>
          </div>
        </div>
        <div class="wb-item-fields">
        ${f.itemFields.map((sf) => `
          <div class="wb-field${sf.half ? " wb-field--half" : ""}">
            <label>${sf.label}</label>
            ${inputHtml(sf, item[sf.key], { idx, fk: f.key })}
          </div>`).join("")}
        </div>
      </div>`).join("")}
    <button class="wb-btn-add" data-lact="add" data-fk="${f.key}">＋ เพิ่มรายการ</button>
  </div>`;
}

/* ── พิมพ์ → อัปเดต state + วาด block นั้นใหม่ (ไม่แตะ panel) ── */
document.getElementById("props").addEventListener("input", (e) => {
  const el = e.target;
  if (!el.dataset.fk || el.dataset.upload) return;
  const b = blocks.find((x) => x.id === selectedId);
  if (!b) return;
  /* checkbox เก็บค่าที่ .checked ไม่ใช่ .value (.value ของ checkbox คือ "on" เสมอ) */
  const isToggle = el.type === "checkbox";
  const val = isToggle ? el.checked : el.value;

  if (el.dataset.idx != null && el.dataset.sub) {
    b.props[el.dataset.fk][+el.dataset.idx][el.dataset.sub] = val;
  } else {
    b.props[el.dataset.fk] = val;
  }

  /* exclusive: เปิดอันนี้ = ปิดอันอื่นในลิสต์เดียวกัน (ภาษา/หน้าปัจจุบัน มีได้อันเดียว) */
  let rerender = false;
  if (isToggle && el.checked && el.dataset.idx != null && el.dataset.sub) {
    const fd = fieldDef(b, el.dataset.fk, el.dataset.sub);
    if (fd?.exclusive) {
      b.props[el.dataset.fk].forEach((it, i) => {
        if (i !== +el.dataset.idx) it[el.dataset.sub] = false;
      });
      rerender = true; /* ต้องวาดแผงใหม่ให้ checkbox ตัวอื่นเด้งกลับเป็นปิด */
    }
  }

  /* ปุ่ม "+" เลือกสีเอง → อัปเดตไฮไลต์ (เลิกไฮไลต์ปุ่มแบรนด์ ถ้าสีไม่ตรง) โดยไม่ re-render (กัน picker ปิด) */
  if (el.type === "color" && el.closest(".wb-swatches")) syncSwatchHighlight(el.closest(".wb-swatches"), val);

  /* TextSetting: พิมพ์ข้อความ → อัปเดตค่าย่อในหัวข้อพับ · พิมพ์ px → เลิกไฮไลต์ปุ่ม preset ที่ไม่ตรง */
  const ts = el.closest(".wb-ts");
  if (ts) {
    if (el.classList.contains("wb-ts-text")) {
      const pv = ts.querySelector(".wb-ts-preview");
      if (pv) pv.textContent = String(el.value).slice(0, 22);
    }
    if (el.classList.contains("wb-ts-px")) {
      ts.querySelectorAll(".wb-ts-size [data-setbtn]").forEach((btn) => btn.classList.toggle("active", +btn.dataset.val === +el.value));
    }
  }

  /* slider: อัปเดตตัวเลขที่โชว์ข้างๆ ตามค่าที่ลาก */
  if (el.type === "range") {
    const rv = el.parentElement.querySelector(".wb-range-val");
    if (rv) rv.textContent = el.value + (rv.dataset.unit || "");
  }

  /* ช่องสี: sync จานสี ↔ hex
     เช็ค hex ครบ 6 หลักก่อน — ระหว่างพิมพ์ "#7" ถ้ายัดใส่ input[type=color] เบราว์เซอร์
     จะรีเซ็ตเป็น #000000 แล้วเขียนทับสีที่ user กำลังจะพิมพ์ */
  const crow = el.closest(".wb-color-row");
  if (crow && /^#[0-9a-f]{6}$/i.test(el.value)) {
    crow.querySelectorAll("input").forEach((x) => {
      if (x !== el) x.value = el.value;
    });
  }

  /* ช่องรูป: อัปเดต preview สดตอนพิมพ์/วาง URL เอง
     (ไม่ทำ = preview ค้างที่ "ยังไม่มีรูป" จนกว่าจะกดอัปโหลดหรือเลือกบล็อกใหม่) */
  const thumb = el.closest(".wb-img-row")?.nextElementSibling;
  if (thumb?.classList.contains("wb-img-thumb")) {
    const v = el.value.trim();
    thumb.style.backgroundImage = v ? `url("${v.replace(/"/g, "%22")}")` : "";
    thumb.textContent = v ? "" : "ยังไม่มีรูป";
  }

  setDirty(true);
  refreshBlock(b.id);
  if (rerender) renderProps();
});

/* ── ปุ่มใน repeater + อัปโหลดรูป ── */
document.getElementById("props").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const b = blocks.find((x) => x.id === selectedId);
  if (!b) return;

  if (btn.dataset.upload) { pickImage(btn); return; }

  /* ปุ่มกลุ่มเลือก 1 ตัว (ขนาด preset / น้ำหนัก / จัดวาง) → ตั้งค่า + ไฮไลต์เฉพาะที่เลือก */
  if (btn.dataset.setbtn) {
    let v = btn.dataset.val;
    if (btn.dataset.num) v = +v;
    if (btn.dataset.idx != null && btn.dataset.sub) b.props[btn.dataset.fk][+btn.dataset.idx][btn.dataset.sub] = v;
    else b.props[btn.dataset.fk] = v;
    btn.parentElement.querySelectorAll("[data-setbtn]").forEach((x) => x.classList.toggle("active", x === btn));
    /* กด preset ขนาด → อัปเดตช่อง px ให้ตรง */
    const card = btn.closest(".wb-ts");
    if (card && btn.dataset.num) {
      const px = card.querySelector(`.wb-ts-px[data-fk="${btn.dataset.fk}"]`);
      if (px) px.value = v;
    }
    setDirty(true);
    refreshBlock(b.id);
    return;
  }

  /* คลิกปุ่มสีแบรนด์ → ตั้งค่าสี (prop key เดิม) + ไฮไลต์ + อัปเดต canvas */
  if (btn.dataset.swatch != null) {
    const color = btn.dataset.swatch;
    if (btn.dataset.idx != null && btn.dataset.sub) b.props[btn.dataset.fk][+btn.dataset.idx][btn.dataset.sub] = color;
    else b.props[btn.dataset.fk] = color;
    const wrap = btn.closest(".wb-swatches");
    syncSwatchHighlight(wrap, color);
    const ci = wrap.querySelector('input[type="color"]');
    if (ci && /^#[0-9a-f]{6}$/i.test(color)) ci.value = color; /* ให้ picker เริ่มจากสีนี้ */
    setDirty(true);
    refreshBlock(b.id);
    return;
  }

  const act = btn.dataset.lact;
  if (!act) return;
  const fk = btn.dataset.fk;
  const arr = b.props[fk];
  const idx = +btn.dataset.idx;

  if (act === "add") {
    const def = window.WebBlocks.get(b.type);
    const f = def.fields.find((x) => x.key === fk);
    /* toggle ต้องเริ่มเป็น false ไม่ใช่ "" — เก็บชนิดให้ตรงตั้งแต่แรก */
    arr.push(Object.fromEntries(f.itemFields.map((sf) => [sf.key, sf.type === "toggle" ? false : ""])));
  } else if (act === "del") arr.splice(idx, 1);
  else if (act === "up" && idx > 0) [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
  else if (act === "down" && idx < arr.length - 1) [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]];
  else return;

  setDirty(true);
  refreshBlock(b.id);
  renderProps();
});

/* ไฮไลต์ปุ่มสีที่ตรงกับค่าปัจจุบัน · ไม่ตรงปุ่มไหน → ปุ่ม "+" ไฮไลต์ (สีกำหนดเอง) */
function syncSwatchHighlight(wrap, value) {
  if (!wrap) return;
  const cur = String(value ?? "").trim().toLowerCase();
  let matched = false;
  wrap.querySelectorAll(".wb-sw").forEach((btn) => {
    const on = btn.dataset.swatch.toLowerCase() === cur;
    btn.classList.toggle("active", on);
    if (on) matched = true;
  });
  wrap.querySelector(".wb-sw-custom")?.classList.toggle("active", !!cur && !matched);
}

/* หา definition ของ field จาก contract — ใช้อ่าน bucket/keepAlpha ตอนอัปโหลด */
function fieldDef(block, fk, sub) {
  const def = window.WebBlocks.get(block.type);
  const f = def?.fields.find((x) => x.key === fk);
  if (!f) return null;
  return sub ? (f.itemFields || []).find((x) => x.key === sub) : f;
}

/* ── อัปโหลดรูป ──
   ปลายทางมาจาก field ใน contract ไม่ได้ fix ที่นี่:
     bucket อยู่ใน DRIVE_BUCKETS (web-images) → Drive ผ่าน proxy
     ไม่อยู่ (company-assets)                → Supabase Storage
   uploadViaRest ตัดสินเองจากชื่อ bucket · imageCompressor ย่อ/แปลงให้ตาม opts */
function pickImage(btn) {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "image/*";
  inp.onchange = async () => {
    const file = inp.files?.[0];
    if (!file) return;
    try {
      loading(true);
      const b = blocks.find((x) => x.id === selectedId);
      const fd = fieldDef(b, btn.dataset.fk, btn.dataset.sub) || {};
      const bucket = fd.bucket || "web-images";
      const opts = {};
      if (fd.keepAlpha) opts.keepAlpha = true;
      if (fd.maxDim) opts.maxDim = fd.maxDim;

      const rand = Math.random().toString(36).slice(2, 6);
      const path = `web/${page.slug}_${btn.dataset.fk}_${Date.now()}_${rand}`;
      const url = await window.ImageCompressor.uploadViaRest(
        SB_URL, SB_KEY, bucket, path, file, opts
      );
      if (!url) throw new Error("อัปโหลดไม่สำเร็จ (เช็คว่ามี bucket " + bucket + " ใน Supabase แล้ว)");
      if (btn.dataset.idx != null && btn.dataset.sub) {
        b.props[btn.dataset.fk][+btn.dataset.idx][btn.dataset.sub] = url;
      } else {
        b.props[btn.dataset.fk] = url;
      }
      setDirty(true);
      refreshBlock(b.id);
      renderProps();
      toast("อัปโหลดรูปแล้ว");
    } catch (err) {
      console.error(err);
      toast("อัปโหลดไม่สำเร็จ: " + err.message, "error");
    } finally {
      loading(false);
    }
  };
  inp.click();
}

/* ============================================================
   Save / nav
   ============================================================ */
async function savePage() {
  if (!page) return;
  if (!AuthZ.hasPerm("web_pages_edit")) return toast("ไม่มีสิทธิ์แก้ไข", "error");
  try {
    loading(true);
    const user = window.ERP_USER || JSON.parse(localStorage.getItem("erp_session") || "{}");
    await sbPatch(`web_pages?id=eq.${page.id}`, {
      blocks,
      updated_by: user.full_name || user.username || null,
      updated_at: new Date().toISOString(),
    });
    setDirty(false);
    toast("บันทึกแล้ว");
  } catch (e) {
    console.error(e);
    toast("บันทึกไม่สำเร็จ: " + e.message, "error");
  } finally {
    loading(false);
  }
}

function openLive() {
  window.open(`./web-view.html?slug=${encodeURIComponent(page?.slug || "home")}`, "_blank", "noopener");
}
function goBack() {
  location.href = "./web-pages.html";
}

/* กันปิดแท็บทิ้งงานที่ยังไม่บันทึก */
window.addEventListener("beforeunload", (e) => {
  if (dirty) { e.preventDefault(); e.returnValue = ""; }
});

document.addEventListener("DOMContentLoaded", init);
