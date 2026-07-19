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
/* กำลังแก้แถวส่วนกลาง (_layout_*) อยู่ไหม — ถ้าใช่ ไม่ต้องโชว์พรีวิวส่วนกลางซ้อนอีก */
let isLayout = false;
/* บล็อกของส่วนกลาง ไว้โชว์เป็นตัวล็อกหัว/ท้าย canvas ให้เห็นหน้าจริง (แก้ไม่ได้ที่นี่)
   ⚠️ ห้ามตั้งชื่อตัวแปรนี้ว่า `chrome` — Chromium/Edge มี window.chrome เป็น property ของ global
   อยู่แล้ว การประกาศ let/const ชื่อเดียวกันที่ระดับบนสุดของ classic script = SyntaxError
   "Identifier 'chrome' has already been declared" ทั้งไฟล์ตายทั้งไฟล์ (ทุกฟังก์ชันหาย ปุ่มกดไม่ได้)
   และ node --check จับไม่ได้เพราะ Node ไม่มี window.chrome */
let siteChrome = { header: [], footer: [] };

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
  const params = new URLSearchParams(location.search);
  const id = params.get("id");
  const slug = params.get("slug"); /* ใช้เปิดแถวส่วนกลาง (_layout_header / _layout_footer) */
  try {
    loading(true);
    const q = id
      ? `id=eq.${encodeURIComponent(id)}`
      : slug
        ? `slug=eq.${encodeURIComponent(slug)}`
        : `is_home=eq.true`;
    const rows = await sbGet(`web_pages?${q}&select=*&limit=1`);
    if (!rows.length) {
      document.getElementById("canvas").innerHTML =
        `<div class="wb-empty">ไม่พบหน้านี้<br />ตรวจว่ารัน sql/171_web_pages.sql แล้วหรือยัง</div>`;
      return;
    }
    page = rows[0];
    blocks = (page.blocks || []).map((b) => window.WebBlocks.withDefaults(b));
    /* แถวส่วนกลาง = ของใช้ร่วมทุกหน้า ต้องบอกให้ชัด ไม่งั้นแก้ทีเดียวกระทบทั้งเว็บโดยไม่รู้ตัว */
    isLayout = window.WebBlocks.isSystemSlug(page.slug);
    const L = window.WebBlocks.LAYOUT_SLUGS;
    const layoutName = page.slug === L.header ? "ส่วนหัว" : "ส่วนท้าย";
    document.getElementById("heroTitle").textContent =
      isLayout ? `🌐 ส่วนกลาง · ${layoutName}` : "✏️ " + page.title;
    document.getElementById("heroSub").textContent = isLayout
      ? `ใช้ร่วมกันทุกหน้า — แก้ที่นี่แล้วเปลี่ยนพร้อมกันทั้งเว็บ`
      : `/${page.slug} · ${page.status === "published" ? "เผยแพร่แล้ว" : "ฉบับร่าง"} · ลากบล็อกจากซ้ายมาวาง · คลิกบล็อกเพื่อแก้เนื้อหา`;
    if (!isLayout) loadChromePreview(); /* ไม่ await — โชว์ทีหลังได้ ไม่ต้องกันหน้าค้าง */
    renderCanvas();
    loadPagesForSelect(); /* เติม dropdown "ลิงก์โลโก้" — ไม่ต้อง await กันหน้าค้าง */
  } catch (e) {
    console.error(e);
    toast("โหลดหน้าไม่สำเร็จ: " + e.message, "error");
  } finally {
    loading(false);
  }
}

/* โหลด header/footer ส่วนกลางมาโชว์เป็นตัวล็อกหัว-ท้าย canvas
   เพื่อให้เห็น "หน้าจริง" ตอนแก้ — ไม่ใช่เห็นแค่ท่อนกลางแล้วเดาเอา
   ยังไม่ตั้งค่าส่วนกลาง = ไม่มีอะไรโผล่ (หน้าเดิมทำงานเหมือนเดิมทุกอย่าง) */
async function loadChromePreview() {
  const L = window.WebBlocks.LAYOUT_SLUGS;
  try {
    const rows = await sbGet(`web_pages?slug=in.(${L.header},${L.footer})&select=slug,blocks`);
    const of = (s) => (rows.find((r) => r.slug === s) || {}).blocks || [];
    siteChrome = { header: of(L.header), footer: of(L.footer) };
    if (siteChrome.header.length || siteChrome.footer.length) renderCanvas();
  } catch (e) {
    console.error("โหลดส่วนกลางไม่สำเร็จ", e);
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
/* ── ชื่อชั่วคราว (ดับเบิลคลิกเปลี่ยนชื่อ) ──────────────────────
   ชื่อจริงของหมวด/บล็อกอยู่ใน contract (js/shared/web-blocks.js) — แก้ที่นั่นถึงจะถาวร
   ตรงนี้เป็นแค่ที่ "ลองตั้งชื่อ" ระหว่างออกแบบ → เก็บใน localStorage เครื่องเดียว ไม่แตะ DB
   พอได้ชื่อที่พอใจแล้ว ให้ยกไปใส่ contract แล้วกด "คืนชื่อเดิม" ล้าง override ทิ้ง
   key: "g:<groupKey>.label" · "g:<groupKey>.hint" · "b:<blockType>.label" */
const LBL_KEY = "wbLabelOverrides";
let labelOv = {};
try { labelOv = JSON.parse(localStorage.getItem(LBL_KEY) || "{}"); } catch (e) { labelOv = {}; }

const lbl = (k, fallback) => labelOv[k] ?? fallback;
/* ชื่อบล็อกใช้หลายที่ (palette · ป้ายบน canvas · หัวแผงตั้งค่า) → ผ่านตัวนี้ตัวเดียว */
const blockLabel = (def) => (def ? lbl(`b:${def.type}.label`, def.label) : "");

function setLabel(k, v) {
  const s = String(v).trim();
  if (!s) delete labelOv[k];
  else labelOv[k] = s;
  localStorage.setItem(LBL_KEY, JSON.stringify(labelOv));
}

/* ห่อข้อความให้ดับเบิลคลิกแก้ได้ — handler กลางอ่าน data-lbl เอง */
const editable = (k, text) =>
  `<span class="wb-lbl" data-lbl="${k}" title="ดับเบิลคลิกเพื่อเปลี่ยนชื่อ">${window.WebRender.esc(text)}</span>`;

/* ── ระดับ 1: หมวด ── */
function renderCats() {
  const cats = window.WebBlocks.GROUPS.map((g) => {
    /* นับ "การ์ดที่ลากได้จริง" ไม่ใช่จำนวน def — section แตกเป็น 7 ใบตามเลย์เอาต์
       ถ้านับ def ตัวเลขบนป้ายจะไม่ตรงกับที่เห็นเมื่อกดเข้าไป */
    const n = window.WebBlocks.byGroup(g.key).reduce((s, b) => s + (b.presets ? b.presets.length : 1), 0);
    return `<button class="wb-cat" data-cat="${g.key}">
      <span class="wb-cat-icon">${g.icon}</span>
      <span class="wb-cat-txt">
        <div class="wb-cat-name">${editable(`g:${g.key}.label`, lbl(`g:${g.key}.label`, g.label))}</div>
        <div class="wb-cat-hint">${editable(`g:${g.key}.hint`, lbl(`g:${g.key}.hint`, g.hint))}</div>
      </span>
      <span class="wb-cat-count">${n}</span>
      <span class="wb-cat-arrow">›</span>
    </button>`;
  }).join("");
  /* ปุ่มล้างจะโผล่ก็ต่อเมื่อมีชื่อที่แก้ไว้จริง — ไม่งั้นรกเปล่าๆ */
  const n = Object.keys(labelOv).length;
  const reset = n
    ? `<button class="wb-lbl-reset" onclick="resetLabels()">↺ คืนชื่อเดิมทั้งหมด (${n})</button>`
    : "";
  document.getElementById("catList").innerHTML = cats + reset;
}

/* ── ระดับ 2: บล็อกในหมวด ── */
function renderPalette(groupKey) {
  /* ใช้ wireframe (b.wire) ไม่ใช่ block จริงย่อส่วน — ดูเหตุผลใน js/shared/web-blocks.js
     SVG ปรับขนาดเองตาม viewBox ไม่ต้องคำนวณ scale ด้วย JS (เลี่ยงปัญหา zoom ไปในตัว) */
  /* def ที่มี presets แตกเป็นหลายการ์ด (section → 1 ใบต่อ 1 เลย์เอาต์)
     "เลือก grid ก่อนลาก" ต้องเห็นตัวเลือกตั้งแต่ในแถบเครื่องมือ ไม่ใช่ไปเจอทีหลังในแท็บตั้งค่า */
  const cards = [];
  window.WebBlocks.byGroup(groupKey).forEach((b) => {
    if (b.presets) {
      b.presets.forEach((p) =>
        cards.push({ type: b.type, preset: p.layout, icon: b.icon, label: p.label, wire: p.wire, lblKey: `b:${b.type}#${p.layout}.label` })
      );
    } else {
      cards.push({ type: b.type, preset: "", icon: b.icon, label: blockLabel(b), wire: b.wire, lblKey: `b:${b.type}.label` });
    }
  });

  document.getElementById("palette").innerHTML = cards
    .map(
      (c) => `
    <div class="wb-palette-item" draggable="true" data-new="${c.type}" data-preset="${c.preset}">
      <div class="wb-palette-label"><span class="wb-palette-icon">${c.icon}</span>${editable(c.lblKey, c.label)}</div>
      <div class="wb-thumb">${c.wire || ""}</div>
    </div>`
    )
    .join("");

  document.querySelectorAll("[data-new]").forEach((el) => {
    el.addEventListener("dragstart", (e) => {
      /* รูปแบบ "new:<type>#<preset>" — # ว่างได้ (block ที่ไม่มี preset) */
      e.dataTransfer.setData("text/plain", `new:${el.dataset.new}#${el.dataset.preset || ""}`);
      /* ต้องบอกชนิดไว้ล่วงหน้า — dragover อ่าน dataTransfer ไม่ได้ (ดูคอมเมนต์ที่ dragType) */
      dragType = el.dataset.new;
    });
  });
}

/* ความสูงของกรอบสไลด์ = แผ่นที่กำลังโชว์ (offsetHeight = CSS px ระบบเดียวกับ style.height → zoom ไม่กวน) */
function syncNavHeight() {
  const nav = document.getElementById("wbNav");
  if (!nav) return;
  const active = document.getElementById(nav.classList.contains("level2") ? "paneBlocks" : "paneCats");
  nav.style.height = active.offsetHeight + "px";
}

/* แยก 2 ส่วน: "ทุกหมวด" = ที่จะกดกลับไป · ชื่อหมวด = ที่อยู่ตอนนี้ (เน้นให้เห็นชัด) */
function backLabelHtml(key) {
  const g = window.WebBlocks.GROUPS.find((x) => x.key === key);
  const name = window.WebRender.esc(lbl(`g:${key}.label`, g ? g.label : ""));
  return `ทุกหมวด<span class="wb-back-sep">·</span><span class="wb-back-cur">${name}</span>`;
}

let curCat = null; /* หมวดที่เปิดอยู่ — ใช้ตอนวาดใหม่หลังเปลี่ยนชื่อ */

function openCat(key) {
  const g = window.WebBlocks.GROUPS.find((x) => x.key === key);
  if (!g) return;
  curCat = key;
  renderPalette(key);
  document.getElementById("backLabel").innerHTML = backLabelHtml(key);
  document.getElementById("wbNav").classList.add("level2");
  requestAnimationFrame(syncNavHeight); /* รอ palette วาดเสร็จก่อนค่อยวัดความสูง */
}

function backToCats() {
  document.getElementById("wbNav").classList.remove("level2");
  syncNavHeight();
}

/* ── เปลี่ยนชื่อ: คลิกที่ตัวอักษรต้องไม่เปิดหมวดทันที เผื่อเป็นดับเบิลคลิก ──
   หน่วง 220ms แล้วค่อยเปิด · ถ้า dblclick มาก่อนก็ยกเลิกการเปิดทิ้ง
   (คลิกที่อื่นบนการ์ด — ไอคอน/จำนวน/ลูกศร — เปิดทันทีเหมือนเดิม ไม่หน่วง) */
let catTimer = null;
document.addEventListener("click", (e) => {
  const cat = e.target.closest && e.target.closest(".wb-cat");
  if (!cat) return;
  /* กำลังพิมพ์ชื่ออยู่ในการ์ด — ห้ามเปิดหมวด (input อยู่ใน <button> คลิกแล้วมันติดไปด้วย) */
  if (e.target.classList.contains("wb-lbl-input")) return;
  const key = cat.dataset.cat;
  if (e.target.closest(".wb-lbl")) {
    clearTimeout(catTimer);
    catTimer = setTimeout(() => openCat(key), 220);
    return;
  }
  openCat(key);
});

document.addEventListener("dblclick", (e) => {
  const el = e.target.closest && e.target.closest(".wb-lbl");
  if (!el || el.querySelector("input")) return;
  clearTimeout(catTimer); /* ตั้งใจ rename ไม่ใช่เปิดหมวด */
  e.preventDefault();
  startRename(el);
});

function startRename(el) {
  const key = el.dataset.lbl;
  const inp = document.createElement("input");
  inp.className = "wb-lbl-input";
  inp.value = el.textContent;
  el.textContent = "";
  el.appendChild(inp);
  inp.focus();
  inp.select();

  /* การ์ดใน palette เป็น draggable — ถ้าไม่ปิดชั่วคราว จะลากเลือกข้อความในช่องไม่ได้ */
  const drag = el.closest('[draggable="true"]');
  if (drag) drag.draggable = false;

  const finish = (save) => {
    if (inp.dataset.done) return; /* Enter แล้ว blur ตามมา — กันทำงานซ้ำ */
    inp.dataset.done = "1";
    if (save) setLabel(key, inp.value);
    redrawLabels();
  };
  inp.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
    else if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
    /* กันคีย์ลัดของ editor (Del = ลบบล็อก · ESC = ออกจากแท็บตั้งค่า) ระหว่างพิมพ์ */
    ev.stopPropagation();
  });
  inp.addEventListener("blur", () => finish(true));
}

/* ชื่อโผล่หลายที่ → วาดใหม่ให้ครบทุกที่ในครั้งเดียว */
function redrawLabels() {
  renderCats();
  if (curCat) {
    renderPalette(curCat);
    document.getElementById("backLabel").innerHTML = backLabelHtml(curCat);
  }
  renderCanvas();
  renderProps();
  requestAnimationFrame(syncNavHeight);
}

function resetLabels() {
  labelOv = {};
  localStorage.removeItem(LBL_KEY);
  redrawLabels();
  toast("คืนชื่อเดิมจาก contract แล้ว");
}

window.addEventListener("resize", () => requestAnimationFrame(syncNavHeight));

/* ============================================================
   Canvas
   ============================================================ */
/* วาดส่วนกลางเป็น "ตัวล็อก" หัว-ท้าย canvas — ดูได้ แก้ที่นี่ไม่ได้
   กดที่ป้ายเพื่อกระโดดไปแก้ที่ส่วนกลาง (แก้ทีเดียวเปลี่ยนทั้งเว็บ) */
function renderChrome() {
  const L = window.WebBlocks.LAYOUT_SLUGS;
  const paint = (elId, list, where, slug) => {
    const el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML = list.length
      ? `<button class="wb-chrome-tag" data-layout="${slug}">🌐 ส่วนกลาง · ${where} — กดเพื่อแก้ (มีผลทุกหน้า)</button>
         <div class="wb-chrome-body">${window.WebRender.page(list)}</div>`
      : "";
  };
  /* ตอนแก้แถวส่วนกลางเอง ไม่ต้องเอาส่วนกลางมาซ้อนอีก */
  paint("chromeTop", isLayout ? [] : siteChrome.header, "ส่วนหัว", L.header);
  paint("chromeBottom", isLayout ? [] : siteChrome.footer, "ส่วนท้าย", L.footer);
}

document.addEventListener("click", (e) => {
  const t = e.target.closest && e.target.closest("[data-layout]");
  if (!t) return;
  if (dirty && !confirm("ยังไม่ได้บันทึกหน้านี้ — ออกไปแก้ส่วนกลางเลยไหม?")) return;
  location.href = `./web-editor.html?slug=${encodeURIComponent(t.dataset.layout)}`;
});

/* ── ตัวช่วยเดินต้นไม้ ──
   block ไม่ได้อยู่ระดับเดียวแล้ว (section > column > element) → ทุกที่ที่เคยใช้
   blocks.find/findIndex ต้องผ่าน 2 ตัวนี้ ไม่งั้นจะเห็นแค่ชั้นบนสุด */
function findNode(id) { return window.WebBlocks.find(blocks, id); }
function curNode() { return selectedId ? findNode(selectedId)?.node || null : null; }

/* wrap = ตัวที่ส่งให้ renderer ห่อ HTML ของ "ทุกชั้น" ด้วยกรอบของ editor
   หน้าจริง (web-view) ไม่ส่งตัวนี้ → ได้ HTML สะอาด ไม่มีปุ่ม ▲▼⧉✕ ปน */
const editorWrap = (node, html) => blockShell(node, html);

function renderCanvas() {
  const c = document.getElementById("canvas");
  renderChrome();
  if (!blocks.length) {
    c.innerHTML = `<div class="wb-empty">ยังไม่มีบล็อก<br />ลากจากแถบซ้ายมาวางที่นี่</div>`;
    return;
  }
  c.innerHTML = window.WebRender.page(blocks, editorWrap);
  if (selectedId) {
    const el = c.querySelector(`[data-id="${selectedId}"]`);
    if (el) el.classList.add("selected");
  }
}

function blockShell(b, html) {
  const def = window.WebBlocks.get(b.type);
  /* คอลัมน์ไม่ใช่ของที่ผู้ใช้สร้าง/ลบเอง (เกิดจากช่อง "จำนวนคอลัมน์" ของ section)
     → เลือกเพื่อตั้งค่าได้ แต่ไม่มีปุ่ม ▲▼⧉✕ และลากย้ายไม่ได้ */
  const isCol = b.type === "column";
  const bar = isCol
    ? ""
    : `<div class="wb-block-bar">
      <button class="wb-grip" title="ลากเพื่อสลับลำดับ">⠿</button>
      <button data-act="up"  title="เลื่อนขึ้น">▲</button>
      <button data-act="down" title="เลื่อนลง">▼</button>
      <button data-act="dup" title="ทำซ้ำ">⧉</button>
      <button data-act="del" title="ลบ (กด Del ก็ได้)">✕</button>
    </div>`;
  return `<div class="wb-block${isCol ? " wb-block--col" : ""}" data-id="${b.id}" data-type="${b.type}"${isCol ? "" : ' draggable="true"'}>
    <div class="wb-block-tag">${def ? def.icon + " " + window.WebRender.esc(blockLabel(def)) : b.type}</div>
    ${bar}
    ${html != null ? html : window.WebRender.block(b, editorWrap)}
  </div>`;
}

/* วาดใหม่เฉพาะ block เดียว — กันไม่ให้ช่องกรอกใน props เสีย focus ตอนพิมพ์ */
function refreshBlock(id) {
  const el = document.querySelector(`.wb-block[data-id="${id}"]`);
  const b = findNode(id)?.node;
  if (!el || !b) return;
  const wasSelected = el.classList.contains("selected");
  el.outerHTML = window.WebRender.block(b, editorWrap);
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

/* ▲▼⧉✕ ทำงานภายใน "รายการที่ node นั้นอยู่" — element เลื่อนในคอลัมน์ตัวเอง
   section เลื่อนในหน้า · ใช้โค้ดชุดเดียวกันทั้งคู่เพราะ find() คืน list ที่ถูกต้องมาให้ */
function blockAction(id, act) {
  const hit = findNode(id);
  if (!hit) return;
  const { list, idx: i } = hit;
  if (act === "up" && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
  else if (act === "down" && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
  else if (act === "dup") {
    const copy = JSON.parse(JSON.stringify(list[i]));
    reId(copy);
    list.splice(i + 1, 0, copy);
  } else if (act === "del") {
    delBlock(id);
    return;
  } else return;
  setDirty(true);
  renderCanvas();
}

/* ทำซ้ำแล้วต้องแจก id ใหม่ "ทั้งกิ่ง" — ไม่งั้น section ที่ก๊อปมาจะมีคอลัมน์ id ซ้ำกับต้นฉบับ
   → คลิกเลือกอันหนึ่งแล้วอีกอันสว่างตาม / แก้ตัวหนึ่งไปโดนอีกตัว */
function reId(node) {
  node.id = "b" + Math.random().toString(36).slice(2, 9);
  (node.children || []).forEach(reId);
}

async function delBlock(id) {
  const hit = findNode(id);
  if (!hit) return;
  const def = window.WebBlocks.get(hit.node.type);
  const kids = (hit.node.children || []).reduce((n, c) => n + 1 + (c.children || []).length, 0);
  const ok = await ConfirmModal.open({
    title: "ลบบล็อก",
    message: kids
      ? `ลบ "${def?.label || hit.node.type}" ออกจากหน้านี้? (ของข้างในอีก ${kids} ชิ้นจะหายไปด้วย)`
      : `ลบบล็อก "${def?.label || hit.node.type}" ออกจากหน้านี้?`,
    icon: "🗑️",
    okText: "ลบ",
    tone: "danger",
  });
  if (!ok) return;
  hit.list.splice(hit.idx, 1);
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
    delBlock(selectedId);
  }
});

/* ============================================================
   Drag & drop — ลากจาก palette มาวาง / ลากสลับลำดับใน canvas
   ============================================================ */
let dragId = null;
/* ชนิดของที่กำลังลาก — ต้องจำไว้ตั้งแต่ dragstart
   เพราะ dragover อ่าน dataTransfer.getData() ไม่ได้ (เบราว์เซอร์ปิดไว้กันเว็บแอบดูของที่ลากมาจากที่อื่น)
   แต่เราต้องรู้ตั้งแต่ตอน hover ว่าจะไฮไลต์ "คอลัมน์" หรือ "ระดับหน้า" */
let dragType = null;

document.addEventListener("dragstart", (e) => {
  const blk = e.target.closest(".wb-block");
  if (!blk) return;
  dragId = blk.dataset.id;
  dragType = blk.dataset.type;
  e.dataTransfer.setData("text/plain", "move:" + dragId);
  blk.classList.add("dragging");
});
document.addEventListener("dragend", () => {
  dragType = null;
  document.querySelectorAll(".wb-col-over").forEach((el) => el.classList.remove("wb-col-over"));
  document.querySelectorAll(".dragging").forEach((el) => el.classList.remove("dragging"));
  clearDropLine();
  dragId = null;
});

const canvasEl = () => document.getElementById("canvas");

/* พื้นที่รับการวาง = ทั้งกรอบขาว (.wb-canvas-wrap) ไม่ใช่แค่ #canvas
   #canvas สูงเท่าเนื้อหาจริง → ที่ว่างใต้บล็อกสุดท้ายเป็นของ wrap (มัน min-height 400)
   ถ้าเช็คแค่ #canvas ตรงนั้นจะไม่ preventDefault เมาส์ขึ้น 🚫 วางไม่ลง */
const inDropZone = (e) => {
  const z = document.querySelector(".wb-canvas-wrap");
  return !!z && (z === e.target || z.contains(e.target));
};

/* ตำแหน่งที่ช่องวางอยู่ตอนนี้ (null = ไม่มีช่อง) — ต้องรู้เพื่อหักระยะตอนคำนวณ
   dropLineHost = อยู่ในกล่องไหน (id คอลัมน์ หรือ "root") — ลากข้ามคอลัมน์แล้ว index เท่าเดิม
   ถ้าไม่จำ host ด้วย เส้นจะค้างอยู่คอลัมน์เดิมเพราะโค้ดคิดว่า "ตำแหน่งไม่เปลี่ยน" */
let dropLineIdx = null;
let dropLineHost = null;

function clearDropLine() {
  document.querySelectorAll(".wb-drop-line").forEach((el) => el.remove());
  dropLineIdx = null;
  dropLineHost = null;
}

/* หาตำแหน่งที่จะแทรก จากเมาส์เทียบจุดกึ่งกลางของแต่ละ block
   ⚠️ ช่องวางที่แทรกอยู่ "ดันบล็อกที่อยู่ถัดจากมัน" ลงไปตามความสูงของช่อง
   ถ้าไม่หักออกก่อนเทียบ ค่าที่ได้จะสลับไปมาระหว่าง 2 ตำแหน่ง = ช่องกระพริบและวางไม่ลง
   หักแล้ว = คำนวณบนเรขาคณิตเดียวกับตอนไม่มีช่องเสมอ ผลลัพธ์นิ่ง */
/* element ต้องมีบ้าน — ห่อด้วย section 1 คอลัมน์ */
function wrapInSection(el) {
  const s = window.WebBlocks.newBlock("section");
  s.props.cols = "1";
  window.WebBlocks.syncColumns(s);
  s.children[0].children.push(el);
  return s;
}

/* ── เป้าหมายการวางตอนนี้ ──
   element (ข้อความ/รูป/ปุ่ม) → ต้องลงใน "คอลัมน์" เท่านั้น (นอกคอลัมน์ = วางไม่ได้)
   อย่างอื่น (section/บล็อกเดิม)  → ลงระดับหน้า
   คืน { host, list } — host = DOM ที่ใช้คำนวณตำแหน่ง · list = array จริงที่จะ splice */
function dropTarget(e) {
  if (window.WebBlocks.isElement(dragType)) {
    const colEl = e.target.closest?.('.wb-block[data-type="column"]');
    if (colEl) {
      const node = findNode(colEl.dataset.id)?.node;
      if (node) return { host: colEl, list: node.children, forEl: true };
    }
    /* ลากข้อความ/รูป/ปุ่มลงที่ว่างนอกคอลัมน์ = สร้าง section 1 คอลัมน์ห่อให้เอง
       ไม่งั้นหน้าเปล่าจะวางอะไรไม่ได้เลยจนกว่าจะรู้ว่า "ต้องลาก Section มาก่อน"
       — คนใช้ครั้งแรกไม่มีทางเดาออก และจะสรุปว่าเครื่องมือพัง */
    return { host: canvasEl(), list: blocks, forEl: false, autoWrap: true };
  }
  return { host: canvasEl(), list: blocks, forEl: false };
}

/* block ลูกโดยตรงของ host — ระดับหน้าเอาเฉพาะชั้นบนสุด ไม่งั้นจะนับ element ข้างในด้วย
   แล้ว index ที่ได้จะไม่ตรงกับ array จริง (เส้นบอกตำแหน่งไปโผล่คนละที่กับที่วางจริง) */
function dropKids(host) {
  return [...host.querySelectorAll(".wb-block")].filter(
    (el) => el.parentElement.closest(".wb-block") === (host.classList.contains("wb-block") ? host : null)
  );
}

function dropIndex(y, host) {
  const line = document.querySelector(".wb-drop-line");
  const shift = line ? line.getBoundingClientRect().height : 0;
  const els = dropKids(host);
  for (let i = 0; i < els.length; i++) {
    const r = els[i].getBoundingClientRect();
    const top = r.top - (dropLineIdx !== null && i >= dropLineIdx ? shift : 0);
    if (y < top + r.height / 2) return i;
  }
  return els.length;
}

function showDropLine(idx, host) {
  /* ตำแหน่งเดิม = ห้ามแตะ DOM
     ของเดิมสร้างช่องใหม่ทุก dragover (ยิงหลายสิบครั้ง/วินาที) → element ใต้เมาส์ถูกลบทิ้งตลอด
     dragover ตัวถัดไปเลยยิงใส่ node ที่หลุดจากหน้าไปแล้ว → ไม่ได้ preventDefault → ขึ้น 🚫 วางไม่ได้ */
  const key = host.dataset?.id || "root";
  if (dropLineIdx === idx && dropLineHost === key) return;
  const els = dropKids(host);
  let line = document.querySelector(".wb-drop-line");
  if (!line) {
    line = document.createElement("div");
    line.className = "wb-drop-line";
  }
  /* คอลัมน์: ต่อท้ายเข้าไปในกล่อง .wv-col (ลูกจริงอยู่ในนั้น) ไม่ใช่ท้าย .wb-block */
  const tail = host.querySelector(":scope > .wv-col") || host;
  if (idx >= els.length) tail.appendChild(line);
  else els[idx].before(line);
  dropLineIdx = idx;
  dropLineHost = key;
}

document.addEventListener("dragover", (e) => {
  if (!canvasEl() || !inDropZone(e)) return;
  const t = dropTarget(e);
  /* element ที่ยังไม่ได้ลอยอยู่เหนือคอลัมน์ = ห้ามวาง (ไม่ preventDefault → เคอร์เซอร์ขึ้น 🚫)
     ตั้งใจให้รู้ตัวตั้งแต่ตอนลาก ดีกว่าปล่อยวางแล้วของหายไปเฉยๆ */
  if (!t) { clearDropLine(); return; }
  e.preventDefault();
  document.querySelectorAll(".wb-col-over").forEach((el) => el.classList.remove("wb-col-over"));
  if (t.forEl) t.host.classList.add("wb-col-over");
  showDropLine(dropIndex(e.clientY, t.host), t.host);
});

document.addEventListener("drop", (e) => {
  if (!canvasEl() || !inDropZone(e)) return;
  const t = dropTarget(e);
  if (!t) return;
  e.preventDefault();
  document.querySelectorAll(".wb-col-over").forEach((el) => el.classList.remove("wb-col-over"));
  const data = e.dataTransfer.getData("text/plain") || "";
  /* ใช้ตำแหน่งของช่องที่ผู้ใช้เห็นอยู่ตรงๆ — ที่เห็นคือที่ได้ ไม่ต้องคำนวณซ้ำให้เพี้ยน */
  let idx = dropLineIdx !== null ? dropLineIdx : dropIndex(e.clientY, t.host);
  clearDropLine();

  let added = false;
  if (data.startsWith("new:")) {
    const [type, preset] = data.slice(4).split("#");
    const nb = window.WebBlocks.newBlock(type, preset);
    if (!nb) return;
    t.list.splice(idx, 0, t.autoWrap ? wrapInSection(nb) : nb);
    selectedId = nb.id; /* เลือกตัวที่ลากมา ไม่ใช่ section ที่ห่อให้ — คนลากอยากแก้ของตัวเอง */
    added = true;
  } else if (data.startsWith("move:")) {
    const hit = findNode(data.slice(5));
    if (!hit) return;
    /* ลาก element ออกมานอกคอลัมน์ = ห่อ section ใหม่ให้ (ทางเดียวที่จะแยกของออกมาเป็นแถบของตัวเอง) */
    if (t.autoWrap) {
      const [moved] = hit.list.splice(hit.idx, 1);
      blocks.splice(Math.min(idx, blocks.length), 0, wrapInSection(moved));
      setDirty(true);
      renderCanvas();
      renderProps();
      return;
    }
    /* ย้ายภายในรายการเดิม = ต้องหักตำแหน่งตัวเองที่ถูกดึงออกก่อน
       ย้ายข้ามคอลัมน์ = ไม่ต้องหัก (คนละ array กัน) */
    const same = hit.list === t.list;
    if (same) {
      if (idx > hit.idx) idx--;
      if (idx === hit.idx) return;
    }
    const [moved] = hit.list.splice(hit.idx, 1);
    t.list.splice(idx, 0, moved);
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
  const b = curNode();
  if (!b) {
    hdr.textContent = "⚙️ ตั้งค่า";
    host.innerHTML = `<div class="wb-hint">คลิกบล็อกใน canvas<br />เพื่อแก้เนื้อหา</div>`;
    return;
  }
  const def = window.WebBlocks.get(b.type);
  /* หัวแผง = "ตั้งค่า · <ชื่อบล็อกสั้น>" — ตัดวงเล็บอธิบายทิ้ง (ยาวเกินจนตกบรรทัดในแผงแคบ) */
  hdr.textContent = `⚙️ ตั้งค่า · ${blockLabel(def).replace(/\s*\(.*\)\s*$/, "")}`;
  /* เส้นทาง Section › คอลัมน์ › ข้อความ — ของซ้อนกัน 3 ชั้นแล้ว ถ้าไม่บอกว่าอยู่ชั้นไหน
     ผู้ใช้จะแก้ padding ของคอลัมน์ทั้งที่ตั้งใจแก้ของ section แล้วงงว่าทำไมไม่ขยับ
     กดที่ชื่อชั้นบน = กระโดดไปเลือกชั้นนั้น (ทางเดียวที่จะเลือก section ได้เมื่อมันเต็มไปด้วยลูก) */
  renderCrumb(b);
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

/* ── breadcrumb ของ node ที่เลือก ──
   ไล่จาก id ขึ้นไปหาบรรพบุรุษด้วย find() ซ้ำๆ (โครงเล็ก ต้นทุนไม่มีนัยยะ)
   วาดใต้หัวแผง · ชั้นสุดท้าย = ตัวที่กำลังแก้ (ไม่ต้องกด) */
function renderCrumb(node) {
  const host = document.getElementById("propsCrumb");
  if (!host) return;
  const chain = [];
  let cur = node;
  while (cur) {
    chain.unshift(cur);
    cur = window.WebBlocks.find(blocks, cur.id)?.parent || null;
  }
  if (chain.length < 2) { host.innerHTML = ""; host.hidden = true; return; }
  host.hidden = false;
  host.innerHTML = chain
    .map((n, i) => {
      const d = window.WebBlocks.get(n.type);
      const name = window.WebRender.esc((d ? blockLabel(d) : n.type).replace(/\s*\(.*\)\s*$/, ""));
      return i === chain.length - 1
        ? `<span class="wb-crumb-cur">${name}</span>`
        : `<button class="wb-crumb-up" data-crumb="${n.id}">${name}</button>`;
    })
    .join(`<span class="wb-crumb-sep">›</span>`);
}

document.getElementById("propsCrumb")?.addEventListener("click", (e) => {
  const b = e.target.closest("[data-crumb]");
  if (b) select(b.dataset.crumb);
});

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
        <div class="wb-ts-size">${sizeBtns}
          <span class="wb-ts-pxwrap"><input type="number" class="wb-ts-px" ${tsAttr(m.size)} value="${window.WebRender.esc(size ?? "")}" min="${f.min ?? 8}" max="${f.max ?? 120}" step="1" title="กำหนดขนาดเอง (px)" /><span class="wb-ts-unit">px</span></span></div>
      </div>
      <div class="wb-ts-field"><label>น้ำหนัก</label>${weightBtns}</div>
      <div class="wb-ts-field"><label>สี</label>${swatchesHtml(m.color, props[m.color], f.swatches)}</div>
      <div class="wb-ts-field"><label>จัดวาง</label>${alignBtns}</div>
    </div>
  </details>`;
}

function fieldHtml(f, val, sectioned) {
  if (f.type === "list") return listHtml(f, val || [], sectioned);
  if (f.type === "image") return imageFieldHtml(f, val);
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
    /* allowEmpty = เติมตัวเลือกว่างไว้บนสุด ให้เลิกผูกลิงก์ได้
       ไม่มีตัวนี้ dropdown จะไม่มีทางเป็นค่าว่าง = ปลดลิงก์ไม่ได้เลย */
    const blank = f.allowEmpty
      ? `<option value=""${val ? "" : " selected"}>${window.WebRender.esc(f.emptyLabel || "— ไม่เลือก —")}</option>`
      : "";
    return `<select ${attrs}>${blank}${opts
      .map((o) => `<option value="${window.WebRender.esc(o.value)}"${String(val) === String(o.value) ? " selected" : ""}>${window.WebRender.esc(o.label)}</option>`)
      .join("")}</select>`;
  }
  if (f.type === "gridpick") {
    /* เลือกเลย์เอาต์คอลัมน์จากภาพ — ตัวเลข "2-1" อ่านแล้วนึกภาพไม่ออก แต่เห็นรูปแล้วรู้ทันที
       ใช้ data-setbtn เดียวกับปุ่มกลุ่มอื่น → ไหลเข้า click handler เดิม (ไม่มี handler ใหม่) */
    return `<div class="wb-gridpick">${(f.options || [])
      .map((o) => `<button type="button" class="wb-gp${String(val) === String(o.value) ? " active" : ""}" ${attrs} data-setbtn="1" data-val="${o.value}" title="${window.WebRender.esc(o.label)}">${window.WebBlocks.gridWire(o.value, 120, 40, 5, 4)}</button>`)
      .join("")}</div>`;
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
    /* ในรายการย่อย (repeater) ยังใช้แบบเดิม — มี URL ให้วางได้
       ระดับบนสุดใช้ imageFieldHtml (แถวเดียว: ป้าย + ปุ่มเลือกรูป) */
    return `<div class="wb-img-row">
        <input type="text" ${attrs} value="${v}" placeholder="วาง URL หรือกดอัปโหลด" />
        <button class="btn btn-outline btn-sm" data-upload="1" ${attrs}>📤</button>
      </div>
      <div class="wb-img-thumb" ${val ? `style="background-image:url('${v}')"` : ""}>${val ? "" : "ยังไม่มีรูป"}</div>`;
  }
  return `<input type="text" ${attrs} value="${v}" />`;
}

/* ── ช่องรูประดับบนสุด: แถวเดียว (ป้ายซ้าย · ปุ่มเลือกรูปขวา) ──
   ไม่มีรูป = ไม่มีกล่องพรีวิวว่างมากินที่ · มีรูปแล้วค่อยโชว์พรีวิว + ปุ่มลบ */
function imageFieldHtml(f, val) {
  const attrs = `data-fk="${f.key}"`;
  const v = window.WebRender.esc(val ?? "");
  return `<div class="wb-field wb-field--row">
      <label>${f.label}</label>
      <button type="button" class="wb-img-btn" data-upload="1" ${attrs}>⬆ ${val ? "เปลี่ยนรูป" : "เลือกรูป"}</button>
    </div>${
      val
        ? `<div class="wb-img-thumb" style="background-image:url('${v}')"><button type="button" class="wb-img-clear" data-imgclear="1" ${attrs} title="ลบรูป">✕</button></div>`
        : ""
    }`;
}

/* ── list แบบ pills (f.pills) ──
   แถวเดียว: ป้ายซ้าย · ปุ่มกลมขวา (ที่ใช้อยู่ = เขียว) · ✎ เปิดแผงจัดการรายการเต็ม
   ใช้กับลิสต์สั้นที่ item มีแค่ "ชื่อ + ใช้อยู่" เช่นภาษา — ไม่ต้องกางการ์ด #1 #2 #3 กินที่ */
function pillsHtml(f, arr) {
  const nameKey = (f.itemFields.find((sf) => sf.type !== "toggle") || {}).key;
  const actKey = (f.itemFields.find((sf) => sf.type === "toggle") || {}).key;
  const pills = arr
    .map((it, idx) => `<button type="button" class="wb-pill${window.WebRender.on(it[actKey]) ? " active" : ""}" data-pill="1" data-fk="${f.key}" data-idx="${idx}" data-sub="${actKey}">${window.WebRender.esc(it[nameKey] || "—")}</button>`)
    .join("");
  return `<div class="wb-field wb-field--row">
      <label>${f.label}</label>
      <div class="wb-pills">${pills}<button type="button" class="wb-pill wb-pill-edit" data-pilledit="1" title="จัดการรายการ">✎</button></div>
    </div>
    <details class="wb-pill-manage"><summary></summary><div class="wb-pill-manage-body">${listItemsHtml(
      /* ตัด toggle "ใช้อยู่" ออกจากแผงจัดการ — ปุ่มกลมด้านบนคุมอยู่แล้ว
         (ถ้าปล่อยไว้ กดแล้ว exclusive สั่ง renderProps → แผงที่กางอยู่พับกลับเอง) */
      { ...f, itemFields: f.itemFields.filter((sf) => sf.key !== actKey).map((sf) => ({ ...sf, half: false })) },
      arr
    )}</div></details>`;
}

function listHtml(f, arr, sectioned) {
  if (f.pills) return pillsHtml(f, arr);
  /* --head (ป้ายสีเขียว) เฉพาะ block โหมดเดิม · ในโหมด section ใช้ label ธรรมดา */
  return `<div class="wb-field${sectioned ? "" : " wb-field--head"}">
    <label>${f.label} (${arr.length})</label>
    ${listItemsHtml(f, arr)}
  </div>`;
}

/* การ์ดรายการ + ปุ่มเพิ่ม — ใช้ร่วมกันทั้งโหมดปกติและแผงจัดการของ pills */
function listItemsHtml(f, arr) {
  return `${arr.map((item, idx) => `
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
    <button class="wb-btn-add" data-lact="add" data-fk="${f.key}">＋ เพิ่มรายการ</button>`;
}

/* ── พิมพ์ → อัปเดต state + วาด block นั้นใหม่ (ไม่แตะ panel) ── */
document.getElementById("props").addEventListener("input", (e) => {
  const el = e.target;
  if (!el.dataset.fk || el.dataset.upload) return;
  const b = curNode();
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

  /* แผงจัดการของ pills: เปลี่ยนชื่อรายการ → อัปเดตตัวอักษรบนปุ่มกลมทันที (ไม่ re-render กัน focus หลุด) */
  if (el.closest(".wb-pill-manage") && el.dataset.idx != null && el.type === "text") {
    const pill = el.closest("details")?.previousElementSibling?.querySelector(`[data-pill][data-idx="${el.dataset.idx}"]`);
    if (pill) pill.textContent = el.value || "—";
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
  const b = curNode();
  if (!b) return;

  if (btn.dataset.upload) { pickImage(btn); return; }

  /* ลบรูปที่เลือกไว้ (กลับไปเป็น "ยังไม่มีรูป" = แถวเดียวไม่มีพรีวิว) */
  if (btn.dataset.imgclear) {
    b.props[btn.dataset.fk] = "";
    setDirty(true);
    refreshBlock(b.id);
    renderProps();
    return;
  }

  /* pills: กด = เลือกอันนี้ (exclusive — อันอื่นในลิสต์ปิดหมด) */
  if (btn.dataset.pill) {
    const arr = b.props[btn.dataset.fk] || [];
    const sub = btn.dataset.sub;
    arr.forEach((it, i) => { it[sub] = i === +btn.dataset.idx; });
    btn.parentElement.querySelectorAll("[data-pill]").forEach((x) => x.classList.toggle("active", x === btn));
    setDirty(true);
    refreshBlock(b.id);
    return;
  }

  /* ✎ = กาง/พับแผงจัดการรายการ (เพิ่ม/ลบ/เรียงลำดับ/เปลี่ยนชื่อ) */
  if (btn.dataset.pilledit) {
    const d = btn.closest(".wb-field--row")?.nextElementSibling;
    if (d?.tagName === "DETAILS") { d.open = !d.open; btn.classList.toggle("active", d.open); }
    return;
  }

  /* ปุ่มกลุ่มเลือก 1 ตัว (ขนาด preset / น้ำหนัก / จัดวาง) → ตั้งค่า + ไฮไลต์เฉพาะที่เลือก */
  if (btn.dataset.setbtn) {
    let v = btn.dataset.val;
    if (btn.dataset.num) v = +v;
    if (btn.dataset.idx != null && btn.dataset.sub) b.props[btn.dataset.fk][+btn.dataset.idx][btn.dataset.sub] = v;
    else b.props[btn.dataset.fk] = v;
    btn.parentElement.querySelectorAll("[data-setbtn]").forEach((x) => x.classList.toggle("active", x === btn));
    /* เปลี่ยนเลย์เอาต์ = เปลี่ยนโครงสร้าง (คอลัมน์เพิ่ม/ยุบ) ไม่ใช่แค่หน้าตา → วาด canvas ใหม่ทั้งอัน
       refreshBlock ไม่พอ เพราะคอลัมน์ที่เพิ่งเกิดยังไม่มีใน DOM */
    if (b.type === "section" && btn.dataset.fk === "layout") {
      window.WebBlocks.syncColumns(b);
      setDirty(true);
      renderCanvas();
      return;
    }
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
  /* กันพังแบบเงียบๆ: ถ้าค่ายังไม่ใช่ array (ไม่เคยมีค่า / เป็น null ที่รอย้ายรูปแบบ)
     ปุ่มเพิ่มจะ throw แล้วไม่มีอะไรเกิดขึ้นเลย ผู้ใช้เห็นแค่ "กดแล้วไม่ทำงาน" */
  if (!Array.isArray(b.props[fk])) b.props[fk] = [];
  const arr = b.props[fk];
  const idx = +btn.dataset.idx;

  if (act === "add") {
    const def = window.WebBlocks.get(b.type);
    const f = def.fields.find((x) => x.key === fk);
    /* toggle ต้องเริ่มเป็น false ไม่ใช่ "" — เก็บชนิดให้ตรงตั้งแต่แรก */
    /* sf.default = ค่าตั้งต้นของรายการใหม่ (เช่นปุ่ม CTA ที่เพิ่งเพิ่มควร "แสดง" เลย)
       ไม่ระบุ = toggle เริ่มปิด · ที่เหลือเริ่มว่าง (พฤติกรรมเดิม) */
    arr.push(Object.fromEntries(f.itemFields.map((sf) =>
      [sf.key, sf.default !== undefined ? sf.default : sf.type === "toggle" ? false : ""])));
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
      const b = curNode();
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
