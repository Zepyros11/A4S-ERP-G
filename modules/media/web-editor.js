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
  /* จุดเดียวที่ทุกการแก้ไขต้องผ่าน → เกาะตรงนี้ที่เดียวก็เก็บประวัติได้ครบทุกอย่าง
     (ลากวาง · ลบ · พิมพ์ · ลากขอบ · เปลี่ยนเลย์เอาต์ ...) ไม่ต้องไล่ใส่ทีละจุดแล้วลืมบางอัน */
  if (v) histPush();
}

/* ============================================================
   ประวัติการแก้ไข (Undo / Redo)
   ============================================================
   เก็บเป็น "ภาพนิ่งของทั้งต้นไม้" (JSON) ไม่ใช่บันทึกทีละ action
   เพราะ state ทั้งหมดเป็น JSON ล้วนอยู่แล้ว → ย้อนกลับ = โหลดภาพเก่าทับ จบ
   ไม่ต้องเขียนตัวย้อนของแต่ละ action (ซึ่งจะพลาดง่ายมากเวลามี action ใหม่)

   หน่วง 450ms ก่อนเก็บ = พิมพ์รัวๆ ได้ 1 ภาพ ไม่ใช่ภาพต่อ 1 ตัวอักษร
   (ไม่หน่วง = กด Ctrl+Z ทีนึงถอยได้ตัวอักษรเดียว ใช้งานจริงไม่ไหว) */
/* ⚠️ ห้ามตั้งชื่อตัวแปรนี้ว่า `history` — ชนกับ window.history ของเบราว์เซอร์
   ตระกูลเดียวกับ `chrome` ที่เคยทำทั้งไฟล์ parse ไม่ผ่านจนแผงเครื่องมือหายทั้งแผง
   (ดูคอมเมนต์ที่ siteChrome) · node --check จับไม่ได้เพราะ Node ไม่มี window */
const HIST_MAX = 60;
let histStack = [];
let histIdx = -1;
let histTimer = null;
let histApplying = false;

function histInit() {
  histStack = [JSON.stringify(blocks)];
  histIdx = 0;
  histSync();
}

function histPush() {
  if (histApplying) return; /* ตอนกำลัง undo/redo อยู่ ห้ามเก็บซ้ำ ไม่งั้นวนไม่จบ */
  clearTimeout(histTimer);
  histTimer = setTimeout(() => {
    const snap = JSON.stringify(blocks);
    if (snap === histStack[histIdx]) return; /* ไม่มีอะไรเปลี่ยนจริง (เช่นลากแล้ววางที่เดิม) */
    histStack = histStack.slice(0, histIdx + 1); /* แก้ต่อหลัง undo = ทิ้งเส้นทาง redo เดิม */
    histStack.push(snap);
    if (histStack.length > HIST_MAX) histStack.shift();
    histIdx = histStack.length - 1;
    histSync();
  }, 450);
}

function histApply(i) {
  if (i < 0 || i >= histStack.length) return false;
  clearTimeout(histTimer); /* ทิ้ง snapshot ที่ค้างคิวอยู่ ไม่งั้นมันจะเด้งกลับมาทับทันที */
  histApplying = true;
  histIdx = i;
  blocks = JSON.parse(histStack[i]);
  if (selectedId && !findNode(selectedId)) selectedId = null; /* ของที่เลือกไว้อาจหายไปในภาพนี้ */
  renderCanvas();
  renderProps();
  setDirty(true);
  histApplying = false;
  histSync();
  return true;
}

function undo() {
  if (!histApply(histIdx - 1)) return toast("ย้อนกลับไปได้สุดแล้ว", "error");
  toast("↶ ย้อนกลับ");
}
function redo() {
  if (!histApply(histIdx + 1)) return toast("ไม่มีอะไรให้ทำซ้ำ", "error");
  toast("↷ ทำซ้ำ");
}

/* ปุ่มบนหัวหน้าเป็นตัวบอกว่ายังย้อน/ทำซ้ำได้อีกไหม (คีย์ลัดอย่างเดียวมองไม่เห็นสถานะ) */
function histSync() {
  const u = document.getElementById("undoBtn");
  const r = document.getElementById("redoBtn");
  if (u) u.disabled = histIdx <= 0;
  if (r) r.disabled = histIdx >= histStack.length - 1;
}

/* ============================================================
   Load
   ============================================================ */
async function init() {
  renderCats();
  requestAnimationFrame(syncNavHeight);
  initSplitter();
  applyGuides();
  applyLayers();
  applyZoom();
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
    blocks = healTree(page.blocks || []); /* healTree เติม default ให้ครบทุกชั้นแล้ว */
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
    histInit(); /* ภาพแรก = สภาพตอนโหลด → Ctrl+Z ย้อนกลับมาที่นี่ได้เสมอ */
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

/* ── การ์ดทั้งหมดของหมวด แยกตามหมวดย่อย (def.sub) ──
   block ที่มี presets แตกเป็นหลายการ์ด (ข้อความ → ย่อหน้า/หัวข้อใหญ่/... · section → 1×1/2×2/...)
   "เลือกแบบก่อนลาก" ต้องเห็นตัวเลือกตั้งแต่ในแถบเครื่องมือ ไม่ใช่ไปเจอทีหลังในแท็บตั้งค่า */
function cardsBySub(groupKey) {
  const m = new Map();
  window.WebBlocks.byGroup(groupKey).forEach((b) => {
    const key = b.sub || "อื่นๆ";
    if (!m.has(key)) m.set(key, []);
    const list = m.get(key);
    if (b.presets) {
      b.presets.forEach((p) =>
        list.push({ type: b.type, preset: p.key, icon: b.icon, label: p.label, wire: p.wire || b.wire, lblKey: `b:${b.type}#${p.key}.label` })
      );
    } else {
      list.push({ type: b.type, preset: "", icon: b.icon, label: blockLabel(b), wire: b.wire, lblKey: `b:${b.type}.label` });
    }
  });
  return m;
}

/* ── ระดับ 2: หมวดย่อยในหมวด ──
   หมวดย่อยเดียว = ข้ามไปชั้น 3 เลย (ไม่ให้กดผ่านหน้าที่มีตัวเลือกเดียว ซึ่งเป็นคลิกที่เสียเปล่า) */
function renderSubs(groupKey) {
  const m = cardsBySub(groupKey);
  if (m.size === 1) {
    const [sub] = [...m.keys()];
    openSub(groupKey, sub, true);
    return false; /* บอกผู้เรียกว่าไม่ต้องหยุดที่ชั้น 2 */
  }
  document.getElementById("subList").innerHTML = [...m.entries()]
    .map(([sub, list]) => `<button class="wb-cat" data-sub="${window.WebRender.esc(sub)}">
      <span class="wb-cat-icon">${list[0]?.icon || "▫"}</span>
      <span class="wb-cat-txt"><span class="wb-cat-name">${window.WebRender.esc(sub)}</span></span>
      <span class="wb-cat-count">${list.length}</span>
      <span class="wb-cat-arrow">›</span>
    </button>`)
    .join("");
  return true;
}

/* ── ระดับ 3: การ์ดในหมวดย่อย ── */
function renderPalette(groupKey, sub) {
  /* ใช้ wireframe (b.wire) ไม่ใช่ block จริงย่อส่วน — ดูเหตุผลใน js/shared/web-blocks.js
     SVG ปรับขนาดเองตาม viewBox ไม่ต้องคำนวณ scale ด้วย JS (เลี่ยงปัญหา zoom ไปในตัว) */
  const list = cardsBySub(groupKey).get(sub) || [];
  document.getElementById("palette").innerHTML = list
    .map((c) => `
    <div class="wb-palette-item" draggable="true" data-new="${c.type}" data-preset="${c.preset}">
      <div class="wb-palette-label"><span class="wb-palette-icon">${c.icon}</span>${editable(c.lblKey, c.label)}</div>
      <div class="wb-thumb">${c.wire || ""}</div>
    </div>`)
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
  const active = document.getElementById(
    nav.classList.contains("level3") ? "paneBlocks" : nav.classList.contains("level2") ? "paneSubs" : "paneCats"
  );
  const h = active?.offsetHeight || 0;
  /* วัดได้ 0 = ยังไม่ได้ layout (ฟอนต์ยังไม่มา / แผงเพิ่งถูกแสดง) — ห้ามล็อกเป็น 0px
     .wb-nav มี overflow:hidden → ล็อก 0 เมื่อไหร่ เนื้อหาหายทั้งแผงและไม่กลับมาเอง
     ปล่อยเป็น auto ไว้ก่อนแล้ววัดใหม่รอบหน้า ดีกว่าเสี่ยงแผงว่างเปล่า */
  nav.style.height = h ? h + "px" : "";
}

/* แยก 2 ส่วน: "ทุกหมวด" = ที่จะกดกลับไป · ชื่อหมวด = ที่อยู่ตอนนี้ (เน้นให้เห็นชัด) */
function backLabelHtml(key) {
  const g = window.WebBlocks.GROUPS.find((x) => x.key === key);
  const name = window.WebRender.esc(lbl(`g:${key}.label`, g ? g.label : ""));
  return `ทุกหมวด<span class="wb-back-sep">·</span><span class="wb-back-cur">${name}</span>`;
}

let curCat = null; /* หมวดที่เปิดอยู่ — ใช้ตอนวาดใหม่หลังเปลี่ยนชื่อ */
let curSub = null; /* หมวดย่อยที่เปิดอยู่ */

function openCat(key) {
  const g = window.WebBlocks.GROUPS.find((x) => x.key === key);
  if (!g) return;
  curCat = key;
  document.getElementById("backLabel").innerHTML = backLabelHtml(key);
  const nav = document.getElementById("wbNav");
  nav.classList.remove("level3");
  /* renderSubs คืน false เมื่อหมวดนั้นมีหมวดย่อยเดียว = มันพาไปชั้น 3 ให้แล้ว */
  if (renderSubs(key)) nav.classList.add("level2");
  requestAnimationFrame(syncNavHeight);
}

/* เปิดหมวดย่อย → ชั้น 3
   skipBack = เข้ามาเพราะหมวดนั้นมีหมวดย่อยเดียว → ปุ่มย้อนกลับต้องพากลับไป "ทุกหมวด" ไม่ใช่ชั้น 2 ที่ข้ามไป */
function openSub(catKey, sub, skipBack) {
  curCat = catKey;
  curSub = sub;
  renderPalette(catKey, sub);
  const g = window.WebBlocks.GROUPS.find((x) => x.key === catKey);
  const catName = window.WebRender.esc(lbl(`g:${catKey}.label`, g ? g.label : ""));
  document.getElementById("backLabel2").innerHTML = skipBack
    ? `ทุกหมวด<span class="wb-back-sep">·</span><span class="wb-back-cur">${window.WebRender.esc(sub)}</span>`
    : `${catName}<span class="wb-back-sep">·</span><span class="wb-back-cur">${window.WebRender.esc(sub)}</span>`;
  document.getElementById("paneBlocks").dataset.skipBack = skipBack ? "1" : "";
  const nav = document.getElementById("wbNav");
  nav.classList.add("level2", "level3");
  requestAnimationFrame(syncNavHeight);
}

function backToSubs() {
  const nav = document.getElementById("wbNav");
  nav.classList.remove("level3");
  /* หมวดที่มีหมวดย่อยเดียว ชั้น 2 ว่างเปล่า — ต้องกลับไปชั้น 1 เลย ไม่งั้นเจอหน้าว่าง */
  if (document.getElementById("paneBlocks").dataset.skipBack) nav.classList.remove("level2");
  requestAnimationFrame(syncNavHeight);
}

function backToCats() {
  document.getElementById("wbNav").classList.remove("level2", "level3");
  requestAnimationFrame(syncNavHeight);
}

/* คลิกการ์ดหมวดย่อย */
document.getElementById("subList")?.addEventListener("click", (e) => {
  const b = e.target.closest("[data-sub]");
  if (b && curCat) openSub(curCat, b.dataset.sub, false);
});

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
    renderSubs(curCat);
    if (curSub) renderPalette(curCat, curSub);
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

/* ============================================================
   เส้นโครงสร้าง (guides) — สลับระหว่าง "เห็นโครง" กับ "เห็นของจริง"
   ============================================================
   เปิด  = section/ช่อง มีเส้นประจางตลอด + คอลัมน์ว่างโชว์กรอบ "ลากมาวางที่นี่"
           → กวาดตาเห็นโครงทั้งหน้าว่ามีกี่แถบ แบ่งกี่ช่อง โดยไม่ต้องไล่ชี้ทีละอัน
   ปิด   = canvas เหมือนหน้าเว็บจริงเป๊ะ → ตรวจงานก่อนเผยแพร่ได้โดยไม่ต้องเปิดแท็บใหม่
   ค่าเริ่มต้น = เปิด (คนเข้ามาแก้หน้าเว็บต้องการเห็นโครงก่อน) */
const GUIDE_KEY = "wb_guides";
let guidesOn = localStorage.getItem(GUIDE_KEY) !== "0";

function applyGuides() {
  document.querySelector(".wb-canvas-wrap")?.classList.toggle("wb-guides", guidesOn);
  const btn = document.getElementById("guideBtn");
  if (btn) {
    btn.classList.toggle("is-off", !guidesOn);
    btn.textContent = guidesOn ? "⊞ เส้นโครง" : "⊡ เส้นโครง";
    btn.title = guidesOn ? "ซ่อนเส้นโครงสร้าง (ดูเหมือนเว็บจริง)" : "แสดงเส้นโครงสร้าง (section · ช่อง)";
  }
}

function toggleGuides() {
  guidesOn = !guidesOn;
  localStorage.setItem(GUIDE_KEY, guidesOn ? "1" : "0");
  applyGuides();
}

/* ── ซ่อมโครงตอนโหลด ──
   จำนวนช่องต้องเท่ากับ คอลัมน์ × แถว เสมอ · ถ้าไม่ตรง syncColumns จะเติม/ยุบให้
   จำเป็นเพราะหน้าที่บันทึกไว้ก่อนหน้านี้อาจถูกลบช่องไปแล้ว (สมัยที่ปุ่ม Delete ยังลบช่องได้)
   → เปิดมาแล้วเห็นกริดพัง แก้เองไม่ได้ · ซ่อมเงียบๆ ตรงนี้ทีเดียว ไม่ต้องแตะข้อมูลใน DB */
function healTree(list) {
  return (list || []).map((n) => {
    if (!n) return n;
    /* ⚠️ ต้องเติม default ให้ "ทุกชั้น" ไม่ใช่แค่ชั้นบนสุด
       ของเดิมเรียก withDefaults แค่กับ blocks ชั้นแรก → element ที่อยู่ในช่องไม่เคยได้ค่าเริ่มต้นเลย
       ผลคือ field ที่เพิ่มเข้ามาทีหลัง (เช่น "ความเข้มแถบไล่สี") จะไม่มี key ในข้อมูล
       → แผงตั้งค่าอ่านไม่เจอเลยโชว์ค่าต่ำสุด แต่ renderer เติม default ของตัวเอง
       = เลขบนแผงกับภาพจริงไม่ตรงกัน (บั๊กที่หาต้นตอยากมาก เพราะโค้ดสองฝั่งดู "ถูก" ทั้งคู่) */
    const b = window.WebBlocks.withDefaults(n);
    if (b.children) b.children = healTree(b.children);
    if (b.type === "section") window.WebBlocks.syncColumns(b);
    return b;
  });
}

/* ── ตัวช่วยเดินต้นไม้ ──
   block ไม่ได้อยู่ระดับเดียวแล้ว (section > column > element) → ทุกที่ที่เคยใช้
   blocks.find/findIndex ต้องผ่าน 2 ตัวนี้ ไม่งั้นจะเห็นแค่ชั้นบนสุด */
function findNode(id) { return window.WebBlocks.find(blocks, id); }
function curNode() { return selectedId ? findNode(selectedId)?.node || null : null; }

/* wrap = ตัวที่ส่งให้ renderer ห่อ HTML ของ "ทุกชั้น" ด้วยกรอบของ editor
   หน้าจริง (web-view) ไม่ส่งตัวนี้ → ได้ HTML สะอาด ไม่มีปุ่ม ▲▼⧉✕ ปน */
const editorWrap = (node, html) => blockShell(node, html);

/* ปุ่ม + คั่นระหว่างแถบ — ทางลัดที่เร็วกว่าลากจาก palette เมื่อรู้อยู่แล้วว่าอยากได้กี่คอลัมน์
   idx = ตำแหน่งที่จะแทรก (0 = บนสุด · blocks.length = ล่างสุด) */
function insertRow(idx, always) {
  return `<div class="wb-ins${always ? " wb-ins--always" : ""}"><button class="wb-ins-btn" data-ins="${idx}" title="เพิ่มแถบใหม่ตรงนี้">＋</button></div>`;
}

function renderCanvas() {
  const c = document.getElementById("canvas");
  renderChrome();
  if (!blocks.length) {
    c.innerHTML = `<div class="wb-empty">ยังไม่มีบล็อก<br />ลากจากแถบซ้ายมาวาง หรือกดปุ่มด้านล่าง</div>
      ${insertRow(0, true)}`;
    return;
  }
  /* แทรกปุ่มคั่นทุกช่องว่างระหว่างแถบ + ปิดท้ายอีก 1 อัน (อันท้ายโชว์ตลอด ที่เหลือโชว์ตอนชี้) */
  c.innerHTML = blocks
    .map((b, i) => insertRow(i) + window.WebRender.block(b, editorWrap))
    .join("") + insertRow(blocks.length, true);
  if (selectedId) {
    const el = c.querySelector(`[data-id="${selectedId}"]`);
    if (el) el.classList.add("selected");
  }
  /* ปุ่ม ‹ › ของสไลด์ต้องกดได้ใน canvas ด้วย — ไม่งั้นแก้พาดหัวสไลด์ที่ 3 แล้วดูผลไม่ได้เลย
     (ตัวเลื่อนอัตโนมัติปิดอยู่ในโหมดแก้ไข — renderer ไม่ใส่ data-auto ให้) */
  window.WebRender.bindCarousels(c);
  renderLayers(); /* โครงเปลี่ยน → ต้นไม้ต้องตามทันที (ตัวมันเช็คเองว่าเปิดแท็บอยู่ไหม) */
}

/* ── ย้าย span ของช่องมาไว้บน wrapper ของ editor ──
   ⚠️ จำเป็น ห้ามลบ · หน้าเว็บจริง `.wv-col` เป็นลูกของกริดโดยตรง → grid-column/​grid-row มีผลทันที
   แต่ในหน้าแก้ไข editor ห่อทุก node ด้วย .wb-block อีกชั้น → ตัวที่กริดมองเห็นคือ wrapper
   span ที่อยู่บน .wv-col จึงตกอยู่บน element ที่ไม่ใช่ grid item = ถูกเมินทั้งหมด
   ผลคือ "แถวหัวเต็มความกว้าง" และ span ทุกแบบดูเหมือนไม่ทำงานเฉพาะตอนแก้ไข (หน้าจริงถูก) */
function cellSpanStyle(b, isCol) {
  if (!isCol) return "";
  const n = (v) => Math.max(1, Math.min(4, +v || 1));
  const st = [];
  if (n(b.props?.spanX) > 1) st.push(`grid-column:span ${n(b.props.spanX)}`);
  if (n(b.props?.spanY) > 1) st.push(`grid-row:span ${n(b.props.spanY)}`);
  return st.length ? ` style="${st.join(";")}"` : "";
}

function blockShell(b, html) {
  const def = window.WebBlocks.get(b.type);
  /* คอลัมน์ไม่ใช่ของที่ผู้ใช้สร้าง/ลบเอง (เกิดจากช่อง "จำนวนคอลัมน์" ของ section)
     → เลือกเพื่อตั้งค่าได้ แต่ไม่มีปุ่ม ▲▼⧉✕ และลากย้ายไม่ได้ */
  const isCol = b.type === "column";
  /* element เตี้ยกว่าแถบเครื่องมือของตัวเอง (ข้อความบรรทัดเดียวสูง ~24px) → ป้าย/ปุ่มต้องลอยอยู่
     "เหนือ" ชิ้นงาน ไม่ใช่ทับข้างใน · section/ช่อง ตัวใหญ่พอ วางข้างในได้ตามเดิม */
  const isEl = window.WebBlocks.isElement(b.type);
  const bar = isCol
    ? ""
    : `<div class="wb-block-bar">
      <button class="wb-grip" title="ลากเพื่อสลับลำดับ">⠿</button>
      <button data-act="up"  title="เลื่อนขึ้น">▲</button>
      <button data-act="down" title="เลื่อนลง">▼</button>
      <button data-act="dup" title="ทำซ้ำ">⧉</button>
      <button data-act="del" title="ลบ (กด Del ก็ได้)">✕</button>
    </div>`;
  return `<div class="wb-block${isCol ? " wb-block--col" : ""}${isEl ? " wb-block--el" : ""}"${cellSpanStyle(b, isCol)} data-id="${b.id}" data-type="${b.type}"${isCol ? "" : ' draggable="true"'}>
    <div class="wb-block-tag">${def ? def.icon + " " + window.WebRender.esc(blockLabel(def)) : b.type}</div>
    ${bar}
    ${padHandles(b.type, b)}
    ${isCol && !(b.children || []).length
      ? `<button class="wb-cell-add" data-celladd="${b.id}" title="เพิ่มองค์ประกอบ หรือแบ่งเป็นกริดย่อย">＋</button>`
      : ""}
    ${html != null ? html : window.WebRender.block(b, editorWrap)}
  </div>`;
}

/* ============================================================
   ลากขอบปรับระยะขอบใน (padding) — เห็นผลสดๆ บน canvas
   ============================================================
   แถบตัวเลื่อนในแผงตั้งค่าอยู่คนละที่กับของที่กำลังปรับ ต้องมองสลับไปมา
   ลากที่ขอบจริง = ตาอยู่กับผลลัพธ์ตลอดเวลา (นี่คือวิธีที่คนคุ้นจาก Figma/Elementor)

   ขอบบน-ล่างคุมค่าเดียวกัน (padY) · ซ้าย-ขวาคุม padX — ตรงกับที่ contract เก็บจริง
   ถ้าจะแยก 4 ด้านต้องเพิ่ม 4 prop ซึ่งยังไม่จำเป็นตอนนี้ */
const PAD_MAP = {
  section: [
    { side: "top", axis: "y", fk: "padY" }, { side: "bottom", axis: "y", fk: "padY" },
    { side: "left", axis: "x", fk: "padX" }, { side: "right", axis: "x", fk: "padX" },
  ],
  /* ช่อง: เอาเฉพาะบน-ล่าง — prop `pad` ตัวเดียวคุมทั้ง 4 ด้านอยู่แล้ว ลากบน/ล่างก็ได้ผลเท่ากัน
     ปล่อยขอบซ้าย-ขวาว่างไว้ให้ "ลากปรับความกว้างคอลัมน์" ซึ่งเป็นสิ่งที่คนคาดหวังจากขอบด้านข้างมากกว่า
     (เคยใส่ padding ไว้ 4 ด้าน → ลากขอบขวาแล้วมันตันที่ 0 เพราะความกว้างช่องไม่ได้มาจาก padding) */
  column: [
    { side: "top", axis: "y", fk: "pad" }, { side: "bottom", axis: "y", fk: "pad" },
  ],
};

/* ── กติกาความลึก: ซ้อนกริดได้ถึง MAX_NEST ชั้น ──
   Section > ช่อง > [Section > ช่อง] × N > องค์ประกอบ
   ยังต้องมีเพดาน ไม่ใช่ปล่อยไม่จำกัด — ลึกเกินไปคือ responsive คุมไม่ไหว
   (คอลัมน์ซ้อนคอลัมน์หลายชั้น พอย่อจอลงมือถือจะไม่รู้ว่าอะไรควรยุบก่อนหลัง)
   และ breadcrumb/ต้นไม้เลเยอร์จะยาวจนอ่านไม่ออก */
const MAX_NEST = 6;

/* section นี้อยู่ลึกกี่ชั้น (ระดับหน้า = 0) */
function sectionDepth(sec) {
  let d = 0, cur = findNode(sec.id)?.parent || null;
  while (cur) {
    if (cur.type === "section") d++;
    cur = findNode(cur.id)?.parent || null;
  }
  return d;
}

function cellCanNest(colNode) {
  if (colNode?.type !== "column") return false;
  const sec = findNode(colNode.id)?.parent;
  if (sec?.type !== "section") return false;
  /* กริดใหม่ที่จะเกิดในช่องนี้จะอยู่ลึกกว่า section แม่ 1 ชั้น */
  return sectionDepth(sec) + 1 < MAX_NEST;
}

/* section ที่ไปอยู่ในช่อง ต้องไม่มีระยะขอบ/ความกว้างสูงสุดของ "แถบเต็มจอ"
   ไม่งั้นกริดย่อยจะมีขอบในหนา 40/44px ซ้อนเข้าไปอีกชั้นจนเนื้อหาลีบ */
function makeSection(preset, nested) {
  const s = window.WebBlocks.newBlock("section", preset);
  if (nested) Object.assign(s.props, { padY: 0, padX: 0, bg: "", maxWidth: 1600, gap: 14 });
  return s;
}

function padHandles(type, node) {
  const pads = (PAD_MAP[type] || [])
    .map((h) => `<div class="wb-pad wb-pad--${h.side}" data-pad="${h.side}" data-padfk="${h.fk}" title="ลากเพื่อปรับระยะขอบใน"></div>`)
    .join("");
  return pads + colSizeHandle(type, node);
}

/* ── ที่จับปรับความกว้างคอลัมน์ ──
   วางไว้ที่ "ขอบขวาของช่อง" เฉพาะช่องที่มีเพื่อนบ้านทางขวา → 1 รอยต่อ = 1 ที่จับ ไม่ซ้อนกัน
   ช่องขวาสุดไม่มี (ขอบนั้นคือขอบ section ไม่ใช่รอยต่อระหว่างคอลัมน์ ลากแล้วไม่มีความหมาย) */
function colSizeHandle(type, node) {
  if (type !== "column" || !node) return "";
  const hit = findNode(node.id);
  const par = hit?.parent;
  if (par?.type !== "section") return "";
  const cols = window.WebBlocks.colParts(par.props.layout).length;
  const c = hit.idx % cols; /* อยู่คอลัมน์ที่เท่าไหร่ (กริดหลายแถวใช้ track ร่วมกัน) */
  /* ที่จับ 2 ฝั่ง: ขอบขวาคุมรอยต่อ c · ขอบซ้ายคุมรอยต่อ c-1
     ต้องมีทั้งคู่ เพราะผู้ใช้เลือกช่องไหนก็คาดหวังว่าจะลากขอบของช่องนั้นได้
     (เดิมมีแต่ฝั่งขวา → เลือกช่องขวาสุดแล้วไม่มีที่จับเลย = "ปรับขนาดไม่ได้")
     ขอบนอกสุดของกริดไม่มีที่จับ เพราะนั่นคือขอบ section ไม่ใช่รอยต่อระหว่างคอลัมน์ */
  const h = (cls, div) =>
    `<div class="wb-colsize${cls}" data-colsize="${div}" data-sec="${par.id}" title="ลากเพื่อปรับความกว้างคอลัมน์"></div>`;
  return (c > 0 ? h(" wb-colsize--left", c - 1) : "") + (c < cols - 1 ? h("", c) : "");
}

/* ── ลากรอยต่อระหว่างคอลัมน์ = เปลี่ยนสัดส่วนความกว้าง ──
   คิดเป็น fr ไม่ใช่ px: ย้ายน้ำหนักระหว่างคอลัมน์ซ้าย-ขวา โดยผลรวมของคู่นี้คงที่เสมอ
   → คอลัมน์อื่นในแถวไม่ขยับตาม และไม่ว่าจอกว้างเท่าไหร่สัดส่วนก็เท่าเดิม (responsive ไม่พัง) */
document.addEventListener("pointerdown", (e) => {
  const h = e.target.closest?.(".wb-colsize");
  if (!h) return;
  const sec = findNode(h.dataset.sec)?.node;
  if (!sec) return;
  e.preventDefault();
  e.stopPropagation();

  const WB = window.WebBlocks;
  const c = +h.dataset.colsize;
  const ps = WB.colParts(sec.props.layout);
  const pairSum = ps[c] + ps[c + 1];
  const gridEl = document.querySelector(`.wb-block[data-id="${sec.id}"] .wv-grid`);
  const cells = gridEl ? [...gridEl.children] : [];
  /* ความกว้างจริงของคู่คอลัมน์นี้ = ฐานแปลง px → fr (ลาก 1px คิดเป็นกี่ fr) */
  const pairPx = cells[c] && cells[c + 1]
    ? cells[c].getBoundingClientRect().width + cells[c + 1].getBoundingClientRect().width
    : 0;
  if (!pairPx) return;

  const sx = e.clientX;
  let next = ps.slice();
  const badge = document.createElement("div");
  badge.className = "wb-pad-badge";
  document.body.appendChild(badge);

  const move = (ev) => {
    const dfr = ((ev.clientX - sx) / pairPx) * pairSum;
    /* 0.2 = ขั้นต่ำเดียวกับที่ colParts บังคับ — กันลากจนคอลัมน์แคบจนคลิกเลือกกลับไม่ได้ */
    const left = Math.max(0.2, Math.min(pairSum - 0.2, ps[c] + dfr));
    next[c] = Math.round(left * 100) / 100;
    next[c + 1] = Math.round((pairSum - left) * 100) / 100;
    if (gridEl) gridEl.style.gridTemplateColumns = next.map((n) => n + "fr").join(" ");
    const pct = (n) => Math.round((n / next.reduce((a, b) => a + b, 0)) * 100);
    badge.textContent = `${pct(next[c])}% · ${pct(next[c + 1])}%`;
    badge.style.left = ev.clientX + 14 + "px";
    badge.style.top = ev.clientY - 10 + "px";
  };
  const up = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    badge.remove();
    document.body.classList.remove("wb-padding");
    sec.props.layout = next.join("-");
    setDirty(true);
    renderCanvas();
    renderProps();
  };
  document.body.classList.add("wb-padding");
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
});

/* ระหว่างลากห้ามเรียก refreshBlock — DOM ที่ถูกวาดใหม่จะพา handle ที่นิ้วจับอยู่หายไปกลางคัน
   จึงแก้ style ของ element จริงสดๆ แล้วค่อยเขียนลง props + วาดใหม่ตอนปล่อยนิ้ว */
document.addEventListener("pointerdown", (e) => {
  const h = e.target.closest?.(".wb-pad");
  if (!h) return;
  const blkEl = h.closest(".wb-block");
  const hit = findNode(blkEl?.dataset.id);
  if (!hit) return;
  e.preventDefault();
  e.stopPropagation();

  const node = hit.node;
  const fk = h.dataset.padfk;
  const fd = fieldDef(node, fk) || {};
  const min = fd.min ?? 0;
  const max = fd.max ?? 200;
  const step = fd.step || 1;
  const target = blkEl.querySelector(":scope > .wv-sec, :scope > .wv-col");
  const start = +node.props[fk] || 0;
  const sx = e.clientX, sy = e.clientY;
  /* กฎเดียวคุมทั้ง 4 ด้าน: "ลากออกนอกกรอบ = เพิ่ม · ลากเข้าใน = ลด"
     ขอบล่างลากลง(+) · ขอบขวาลากขวา(+) · ขอบบนลากขึ้น(−) · ขอบซ้ายลากซ้าย(−) → จึงได้ +1/−1 ตามนี้
     ⚠️ อย่ากลับทิศเป็น "ลากตามทิศเดียวกันทุกด้าน" — ขอบล่างจะลากลงแล้วกรอบหดขึ้น ขัดสัญชาตญาณทันที */
  const dir = h.dataset.pad === "bottom" || h.dataset.pad === "right" ? 1 : -1;
  const vertical = h.dataset.pad === "top" || h.dataset.pad === "bottom";
  /* px ของเมาส์ (บนจอจริง) กับ px ของ layout ไม่เท่ากัน เพราะมี zoom ซ้อนกัน 2 ชั้น:
     :root{zoom:.65} ของทั้งระบบ × zoom ของ canvas (ปุ่มย่อ/ขยาย)
     ⚠️ อย่าอ่านค่า zoom มาคูณเอง — พลาดชั้นใดชั้นหนึ่งเมื่อไหร่ ค่าจะเพี้ยนแบบหาต้นตอยาก
     วัดจากของจริงแทน: rect.width (px บนจอ) ÷ offsetWidth (px ของ layout) = อัตราส่วนรวมทุกชั้น */
  const zoom = target ? target.getBoundingClientRect().width / (target.offsetWidth || 1) : 1;

  let cur = start;
  const badge = document.createElement("div");
  badge.className = "wb-pad-badge";
  document.body.appendChild(badge);

  const move = (ev) => {
    const d = ((vertical ? ev.clientY - sy : ev.clientX - sx) / zoom) * dir;
    cur = Math.max(min, Math.min(max, Math.round((start + d) / step) * step));
    if (target) {
      if (node.type === "column") target.style.padding = cur + "px";
      else target.style.padding = `${fk === "padY" ? cur : +node.props.padY || 0}px ${fk === "padX" ? cur : +node.props.padX || 0}px`;
    }
    badge.textContent = `${fk === "padX" ? "ซ้าย-ขวา" : fk === "padY" ? "บน-ล่าง" : "ขอบใน"} ${cur}px`;
    badge.style.left = ev.clientX + 14 + "px";
    badge.style.top = ev.clientY - 10 + "px";
  };
  const up = () => {
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerup", up);
    badge.remove();
    document.body.classList.remove("wb-padding");
    if (cur === start) return;
    node.props[fk] = cur;
    setDirty(true);
    refreshBlock(node.id);
    renderProps(); /* ตัวเลขบนแถบเลื่อนในแผงต้องตรงกับที่เพิ่งลาก */
  };
  /* ปิด drag&drop ของ block ชั่วคราว — ไม่งั้นเบราว์เซอร์อาจตีความว่า "กำลังลากบล็อกไปวางที่อื่น"
     แล้ว pointermove ของเราจะถูกแย่งไปกลางคัน (preventDefault ด้านบนกันได้เกือบหมด นี่คือกันชั้นที่ 2) */
  const wasDraggable = blkEl.draggable;
  blkEl.draggable = false;
  const restore = () => { blkEl.draggable = wasDraggable; };
  document.addEventListener("pointerup", restore, { once: true });

  document.body.classList.add("wb-padding");
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", up);
});

/* วาดใหม่เฉพาะ block เดียว — กันไม่ให้ช่องกรอกใน props เสีย focus ตอนพิมพ์ */
function refreshBlock(id) {
  const el = document.querySelector(`.wb-block[data-id="${id}"]`);
  const b = findNode(id)?.node;
  if (!el || !b) return;
  const wasSelected = el.classList.contains("selected");
  el.outerHTML = window.WebRender.block(b, editorWrap);
  const fresh = document.querySelector(`.wb-block[data-id="${id}"]`);
  if (wasSelected) fresh?.classList.add("selected");
  if (fresh) window.WebRender.bindCarousels(fresh); /* วาดใหม่ = ของเดิมตายไปพร้อม event ต้องผูกใหม่ */
}

/* ============================================================
   ปุ่ม + → เลือกเลย์เอาต์ → แทรกแถบใหม่ตรงตำแหน่งนั้น
   ============================================================ */
/* insertInto = id ของช่องที่จะแบ่งกริดย่อย (null = แทรกเป็นแถบระดับหน้า) */
let insertAt = null;
let insertInto = null;

function openLayoutPicker(idx, intoId) {
  insertAt = idx;
  insertInto = intoId || null;
  const WB = window.WebBlocks;
  const cell = insertInto ? findNode(insertInto)?.node : null;

  /* กลุ่ม "องค์ประกอบ" มีเฉพาะตอนกดจากในช่อง — ระดับหน้าวางองค์ประกอบเดี่ยวๆ ไม่ได้ (ต้องมีแถบก่อน)
     กลุ่ม "กริดย่อย" มีเฉพาะช่องที่ยังซ้อนได้ — ช่องย่อยชั้น 2 จะเหลือแค่กลุ่มองค์ประกอบ */
  /* การ์ดกริด: ภาพบน–ชื่อล่าง (เป็นภาพสัดส่วน อ่านจากภาพก่อน)
     การ์ดเครื่องมือ: ชื่อบน–ภาพล่าง = หน้าตาเดียวกับแถบเครื่องมือด้านซ้ายเป๊ะ (ใช้ class ชุดเดียวกัน)
     ของสองอย่างนี้เจอกันคนละที่ ถ้าหน้าตาไม่ตรงกันผู้ใช้ต้องเรียนรู้ใหม่ 2 รอบ */
  const gridCard = (it) => `<button type="button" class="wb-lp" data-pick="${it.pick}">
      <span class="wb-lp-wire">${it.wire || ""}</span>
      <span class="wb-lp-label">${window.WebRender.esc(it.label)}</span>
    </button>`;
  const toolCard = (it) => `<div class="wb-palette-item" data-pick="${it.pick}">
      <div class="wb-palette-label"><span class="wb-palette-icon">${it.icon}</span>${window.WebRender.esc(it.label)}</div>
      <div class="wb-thumb">${it.wire || ""}</div>
    </div>`;

  const groups = [];
  if (!cell || cellCanNest(cell)) {
    groups.push({
      key: "grid", head: "▦ กริด", card: gridCard,
      items: WB.get("section").presets.map((p) => ({
        pick: `grid:${p.key}`, label: p.label, wire: p.wire,
      })),
    });
  }
  if (cell) {
    groups.push({
      key: "el", head: "🧰 เครื่องมือ", card: toolCard,
      /* element ที่มี presets แตกเป็นการ์ดต่อแบบ (ข้อความ → ย่อหน้า/หัวข้อใหญ่/คำโปรย ...)
         กลไกเดียวกับกริด — เลือกแบบตั้งแต่ตอนหยิบ ไม่ต้องวางแล้วมาไล่ตั้งค่าทีละอัน
         แบ่งหัวข้อย่อยด้วย def.sub เหมือนแถบเครื่องมือซ้าย — สองที่ต้องเรียงเหมือนกัน
         ไม่งั้นผู้ใช้ต้องจำตำแหน่ง 2 ชุดสำหรับของชุดเดียวกัน */
      items: WB.byGroup("element").flatMap((b) => {
        const mk = (pick, label, wire) => ({ pick, label, wire, icon: b.icon, sub: b.sub || "" });
        return b.presets
          ? b.presets.map((p) => mk(`el:${b.type}#${p.key}`, p.label, p.wire || b.wire))
          : [mk(`el:${b.type}`, blockLabel(b), b.wire)];
      }),
    });
  }

  document.querySelector("#layoutOverlay .modal-title").textContent =
    cell ? "เพิ่มลงในช่องนี้" : "เลือกเลย์เอาต์แถบใหม่";

  /* มีกลุ่มเดียว = ไม่ต้องมีแท็บ (แท็บที่กดไม่ได้มีแต่ทำให้งง) */
  const tabs = groups.length > 1
    ? `<div class="wb-lp-tabs">${groups
        .map((g, i) => `<button type="button" class="wb-lp-tab${i === 0 ? " active" : ""}" data-lptab="${g.key}">${g.head}</button>`)
        .join("")}</div>`
    : "";
  /* แตกเป็นหัวข้อย่อยถ้า items มี sub (แท็บเครื่องมือ) · ไม่มี sub ก็เรียงรวดเดียว (แท็บกริด) */
  const paneBody = (g) => {
    const subs = new Map();
    g.items.forEach((it) => {
      const k = it.sub || "";
      if (!subs.has(k)) subs.set(k, []);
      subs.get(k).push(it);
    });
    return [...subs.entries()]
      .map(([sub, list]) =>
        (sub && subs.size > 1 ? `<div class="wb-lp-head">${sub}</div>` : "") +
        `<div class="wb-lp-row">${list.map(g.card).join("")}</div>`
      )
      .join("");
  };

  document.getElementById("layoutPickGrid").innerHTML = tabs + groups
    .map((g, i) => `<div class="wb-lp-pane" data-lppane="${g.key}"${i === 0 ? "" : " hidden"}>${paneBody(g)}</div>`)
    .join("");
  document.getElementById("layoutOverlay").classList.add("open");
}

/* สลับแท็บในโมดัล */
document.getElementById("layoutPickGrid")?.addEventListener("click", (e) => {
  const t = e.target.closest("[data-lptab]");
  if (!t) return;
  const host = document.getElementById("layoutPickGrid");
  host.querySelectorAll("[data-lptab]").forEach((x) => x.classList.toggle("active", x === t));
  host.querySelectorAll("[data-lppane]").forEach((p) => { p.hidden = p.dataset.lppane !== t.dataset.lptab; });
});

function closeLayoutPicker() {
  document.getElementById("layoutOverlay").classList.remove("open");
  insertAt = null;
  insertInto = null;
}

document.getElementById("layoutPickGrid")?.addEventListener("click", (e) => {
  const b = e.target.closest("[data-pick]");
  if (!b || insertAt == null) return;
  const host = insertInto ? findNode(insertInto)?.node?.children : blocks;
  if (!host) return;
  /* รูปแบบค่า: "el:<type>[#preset]" = วางองค์ประกอบ · "grid:<presetKey>" = แบ่งเป็นกริดย่อย */
  const [kind, val] = b.dataset.pick.split(":");
  const [elType, elPreset] = val.split("#");
  const nb = kind === "el" ? window.WebBlocks.newBlock(elType, elPreset) : makeSection(val, !!insertInto);
  if (!nb) return;
  host.splice(Math.max(0, Math.min(insertAt, host.length)), 0, nb);
  closeLayoutPicker();
  selectedId = nb.id;
  setDirty(true);
  renderCanvas();
  renderProps();
  switchTab("props"); /* วางแถบเสร็จมักอยากตั้งค่าต่อทันที (เหมือนตอนลากมาวาง) */
});

/* ── canvas events (delegate — block ถูกวาดใหม่บ่อย) ── */
document.addEventListener("click", (e) => {
  const ins = e.target.closest("[data-ins]");
  if (ins) { openLayoutPicker(+ins.dataset.ins); return; }

  /* ＋ กลางช่องว่าง → แบ่งช่องนั้นเป็นกริดย่อย */
  const cadd = e.target.closest("[data-celladd]");
  if (cadd) { e.stopPropagation(); openLayoutPicker(0, cadd.dataset.celladd); return; }

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
  /* ช่องเลื่อน/ทำซ้ำเองไม่ได้เช่นกัน — จำนวนและลำดับถูกกำหนดโดยกริดของแถบ (ดูเหตุผลใน delBlock) */
  if (hit.node.type === "column" && act !== "del") return;
  const { list, idx: i } = hit;
  if (act === "up" && i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]];
  else if (act === "down" && i < list.length - 1) [list[i + 1], list[i]] = [list[i], list[i + 1]];
  else if (act === "dup") {
    const copy = JSON.parse(JSON.stringify(list[i]));
    reId(copy);
    /* ทำซ้ำ element ในกริด = เกือบทุกครั้งตั้งใจจะ "เติมช่องที่ยังว่าง" ไม่ใช่ซ้อนทับในช่องเดิม
       (สร้างกริด 2×2 แล้วทำสไลด์ 1 ใบให้เสร็จ → ทำซ้ำอีก 3 ครั้งให้ครบ 4 ช่อง)
       ซ้อนต่อท้ายช่องเดิมทำให้ต้องมาลากย้ายเองทุกใบ ซึ่งเป็นงานที่ไม่ควรต้องทำ */
    const slot = nextEmptyCell(hit);
    if (slot) {
      slot.children.push(copy);
      selectedId = copy.id;
      setDirty(true);
      renderCanvas();
      renderProps();
      toast("ทำซ้ำแล้ว — วางไว้ในช่องว่างถัดไป");
      return;
    }
    list.splice(i + 1, 0, copy);
    selectedId = copy.id;
    if (window.WebBlocks.isElement(hit.node.type)) toast("ทำซ้ำแล้ว — ไม่มีช่องว่าง จึงวางต่อจากตัวเดิม");
  } else if (act === "del") {
    delBlock(id);
    return;
  } else return;
  setDirty(true);
  renderCanvas();
}

/* ── หาช่องว่างถัดไปในกริดเดียวกัน (ใช้ตอนทำซ้ำ) ──
   ไล่จากช่องถัดจากตัวเอง วนกลับมาช่องก่อนหน้าถ้าจำเป็น → เติมตามลำดับที่ตาอ่าน (ซ้าย→ขวา บน→ล่าง)
   คืน null ถ้าไม่ใช่ element ในช่อง หรือทุกช่องมีของหมดแล้ว → ผู้เรียกใช้พฤติกรรมเดิมแทน */
function nextEmptyCell(hit) {
  if (!window.WebBlocks.isElement(hit.node.type)) return null;
  const cell = hit.parent;
  if (cell?.type !== "column") return null;
  const sec = findNode(cell.id)?.parent;
  if (sec?.type !== "section") return null;
  const cells = sec.children || [];
  const at = cells.indexOf(cell);
  for (let k = 1; k < cells.length; k++) {
    const c = cells[(at + k) % cells.length];
    if (c && !(c.children || []).length) return c;
  }
  return null;
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
  /* ⚠️ ช่องเป็นโครงสร้างที่ผูกกับ "คอลัมน์ × แถว" ของแถบ ไม่ใช่ของที่ผู้ใช้สร้างเอง
     ลบเดี่ยวเมื่อไหร่ จำนวนช่องจะไม่ตรงกับกริด → ช่องหายไปดื้อๆ แล้วเพิ่มกลับเองไม่ได้
     ปุ่ม ✕ ของช่องถูกตัดออกไปแล้ว แต่คีย์ Delete ยังเข้าถึงได้ ต้องกันที่นี่อีกชั้น */
  if (hit.node.type === "column") {
    toast("ลบช่องเดี่ยวไม่ได้ — ปรับที่ “จำนวนคอลัมน์/แถว” ในตั้งค่าของแถบแทน", "error");
    return;
  }
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
    if (canvasZoom === "fit") applyZoom(); /* พื้นที่ canvas เพิ่งเปลี่ยนความกว้าง */
  };

  split.addEventListener("pointerdown", (e) => {
    e.preventDefault(); /* กันเบราว์เซอร์ลาก selection แทน */
    /* วัดอัตราส่วนจากของจริงเหมือนที่ลากขอบ padding ทำ — ไม่ต้องไปอ่านค่า zoom เอง
       (แผงซ้ายอยู่นอกตัวย่อ canvas จึงโดนแค่ :root{zoom} แต่วัดแบบนี้ถูกเสมอไม่ว่าจะมีกี่ชั้น) */
    zoom = side.getBoundingClientRect().width / (side.offsetWidth || 1) || 1;
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

/* ============================================================
   ย่อ/ขยายมุมมอง canvas
   ============================================================
   เว็บจริงกว้าง 1200px แต่ช่องที่เหลือให้ canvas มักแคบกว่านั้น (มีแผง 2 ข้าง)
   → เห็นไม่ครบ ต้องเลื่อนไปมา · ย่อลงเพื่อดูโครงรวม แล้วขยายกลับมาแก้รายละเอียด

   ใช้ CSS zoom ไม่ใช่ transform:scale — zoom ย่อ "พื้นที่ที่กล่องใช้จริง" ด้วย
   ส่วน transform ย่อแค่ภาพที่เห็น กล่องยังกินที่เท่าเดิม (เหลือช่องว่างใหญ่ใต้หน้า
   และ .wb-canvas-wrap ยังมี scrollbar แนวนอนทั้งที่ย่อแล้ว) */
const ZOOM_KEY = "wb_zoom";
const SITE_W = 1200; /* ความกว้างเว็บจริง — ตรงกับ max-width ของ .wb-canvas */
let canvasZoom = localStorage.getItem(ZOOM_KEY) || "100";

function fitScale() {
  const wrap = document.querySelector(".wb-canvas-wrap");
  if (!wrap) return 1;
  /* clientWidth = ความกว้างข้างในกรอบ (หัก padding/scrollbar แล้ว) หน่วยเดียวกับ max-width ของ canvas
     ไม่ย่อเกิน 100% — ขยายให้ใหญ่กว่าเว็บจริงไม่มีประโยชน์ มีแต่ทำให้ดูไม่ตรงของจริง */
  return Math.min(1, (wrap.clientWidth - 22) / SITE_W);
}

function applyZoom() {
  const sc = document.getElementById("wbScaler");
  if (!sc) return;
  const s = canvasZoom === "fit" ? fitScale() : (+canvasZoom || 100) / 100;
  sc.style.zoom = Math.max(0.3, Math.min(1, s));
  const sel = document.getElementById("zoomSel");
  if (sel) sel.value = canvasZoom;
}

function setZoom(v) {
  canvasZoom = v;
  localStorage.setItem(ZOOM_KEY, v);
  applyZoom();
}

/* "พอดีจอ" ขึ้นกับความกว้างที่เหลือ → ต้องคำนวณใหม่ทุกครั้งที่พื้นที่เปลี่ยน
   (ย่อ-ขยายหน้าต่าง · เปิด-ปิดแผงเลเยอร์ · ลากเส้นแบ่งแผงซ้าย) */
window.addEventListener("resize", () => { if (canvasZoom === "fit") applyZoom(); });

/* ── แผงเลเยอร์: เปิด/ปิด + จำค่าไว้ต่อเครื่อง ── */
const LYR_KEY = "wb_layers_open";
let layersOn = localStorage.getItem(LYR_KEY) === "1";

function applyLayers() {
  document.querySelector(".wb-shell")?.classList.toggle("has-layers", layersOn);
  document.getElementById("layersBtn")?.classList.toggle("is-off", !layersOn);
  document.getElementById("layersBtn2")?.classList.toggle("is-on", layersOn);
  if (layersOn) renderLayers();
  if (canvasZoom === "fit") applyZoom(); /* พื้นที่ canvas เพิ่ง กว้างขึ้น/แคบลง */
}

function toggleLayers() {
  layersOn = !layersOn;
  localStorage.setItem(LYR_KEY, layersOn ? "1" : "0");
  applyLayers();
}

/* ============================================================
   แท็บเลเยอร์ — โครงทั้งหน้าเป็นต้นไม้
   ============================================================
   ของซ้อนกันได้ถึง 4 ชั้น (แถบ › ช่อง › แถบย่อย › ช่อง › องค์ประกอบ)
   คลิกใน canvas จะโดน "ชั้นในสุด" เสมอ — ตั้งใจให้เป็นแบบนั้นเพราะเป็นสิ่งที่ต้องการ 90% ของเวลา
   แต่แปลว่าชั้นกลางๆ (ช่อง · แถบย่อย) แทบเลือกไม่ได้เลยถ้าไม่มีที่ว่างให้คลิกโดน
   ต้นไม้แก้ปัญหานี้ตรงๆ: เห็นทุกชั้นพร้อมกัน กดชั้นไหนก็ได้ ไม่ต้องเล็ง */
const layerClosed = new Set(); /* เก็บ "อันที่พับ" ไม่ใช่ "อันที่กาง" → ของที่เพิ่งสร้างจะกางเองโดยอัตโนมัติ */

function elementSummary(n) {
  const p = n.props || {};
  const t = (s) => {
    const v = String(s || "").trim().replace(/\s+/g, " ");
    return v.length > 20 ? v.slice(0, 20) + "…" : v;
  };
  if (n.type === "el_text") return t(p.text);
  if (n.type === "el_heading") return t(p.text);
  if (n.type === "el_button") return t(p.label);
  if (n.type === "el_image") return p.src ? t(p.alt) || "มีรูป" : "ยังไม่มีรูป";
  if (n.type === "el_carousel") return t(p.heading) || `${(p.slides || []).length} สไลด์`;
  return "";
}

function nodeLabel(n) {
  const WB = window.WebBlocks;
  const def = WB.get(n.type);
  const name = (def ? blockLabel(def) : n.type).replace(/\s*\(.*\)\s*$/, "");
  let sub = "";
  if (n.type === "section") {
    sub = `${WB.colParts(n.props.layout).length}×${WB.rowsOf(n.props.rows)}${n.props.headRow ? " +หัว" : ""}`;
  } else if (n.type === "column") {
    sub = (n.children || []).length ? "" : "ว่าง";
  } else {
    sub = elementSummary(n);
  }
  return { icon: def?.icon || "▫", name, sub };
}

function layerRows(list, depth) {
  return (list || [])
    .map((n) => {
      if (!n) return "";
      const kids = n.children || [];
      const open = !layerClosed.has(n.id);
      const { icon, name, sub } = nodeLabel(n);
      const esc = window.WebRender.esc;
      const row = `<div class="wb-lyr${n.id === selectedId ? " is-sel" : ""}" data-lyr="${n.id}" style="padding-left:${5 + depth * 14}px">
        ${kids.length
          ? `<button type="button" class="wb-lyr-tw" data-lyrtw="${n.id}" title="${open ? "พับ" : "กาง"}">${open ? "▾" : "▸"}</button>`
          : `<span class="wb-lyr-tw"></span>`}
        <span class="wb-lyr-ico">${icon}</span>
        <span class="wb-lyr-name">${esc(name)}</span>
        ${sub ? `<span class="wb-lyr-sub">${esc(sub)}</span>` : ""}
      </div>`;
      return row + (kids.length && open ? layerRows(kids, depth + 1) : "");
    })
    .join("");
}

/* ความลึกสูงสุดของต้นไม้ — ใช้กำหนดความกว้างแผง */
function treeDepth(list, d = 0) {
  return (list || []).reduce((mx, n) => (n?.children?.length ? Math.max(mx, treeDepth(n.children, d + 1)) : Math.max(mx, d)), d);
}

/* ── ความกว้างแผงตามความลึกจริงของโครง ──
   หน้าที่มีแต่แถบเดียวไม่ต้องกินที่ 300px · หน้าที่ซ้อน 4 ชั้นต้องกว้างพอไม่ให้ชื่อถูกตัด
   ตั้งเป็น CSS var แทน width ตรงๆ เพราะ .wb-shell เป็น grid — คอลัมน์ต้องรู้ขนาดด้วย */
function syncLayerWidth() {
  const d = treeDepth(blocks);
  /* เพดานกว้างขึ้นตาม MAX_NEST ที่เพิ่มเป็น 6 — ลึก 12 ชั้น (section+ช่อง สลับกัน) ยังต้องอ่านชื่อออก */
  const w = Math.max(190, Math.min(400, 150 + d * 16));
  document.querySelector(".wb-shell")?.style.setProperty("--wb-lyr-w", w + "px");
}

/* ── เลือกอันไหน = กางอันนั้น (กับทางที่ไปถึง) แล้วพับที่เหลือ ──
   หน้าที่มีของเยอะ ต้นไม้ยาวเป็นหน้าจอ ต้องไถหาว่าตัวที่เลือกอยู่ตรงไหน
   พับที่ไม่เกี่ยวทิ้ง = เห็นบริบทของสิ่งที่กำลังแก้ทันทีโดยไม่ต้องพับเอง
   ทำเฉพาะตอน "เลือกใหม่" — กด ▾▸ เองหลังจากนั้นยังอยู่จนกว่าจะเลือกอันอื่น */
function focusLayers(id) {
  layerClosed.clear();
  const keep = new Set();
  let cur = id ? findNode(id)?.node : null;
  while (cur) { keep.add(cur.id); cur = findNode(cur.id)?.parent || null; } /* ตัวเอง + บรรพบุรุษ = กาง */
  const walk = (list) =>
    (list || []).forEach((n) => {
      if (n?.children?.length && !keep.has(n.id)) layerClosed.add(n.id);
      if (n?.children) walk(n.children);
    });
  walk(blocks);
}

function renderLayers() {
  const host = document.getElementById("layerTree");
  if (!host || !layersOn) return; /* ปิดอยู่ = ไม่ต้องเสียแรงวาด */
  host.innerHTML = blocks.length
    ? layerRows(blocks, 0)
    : `<div class="wb-hint">ยังไม่มีบล็อกในหน้านี้</div>`;
  syncLayerWidth();
  /* พับที่เหลือแล้วแถวที่เลือกอาจเลื่อนตำแหน่ง — ดึงกลับเข้าจอให้เห็นเสมอ */
  host.querySelector(".wb-lyr.is-sel")?.scrollIntoView({ block: "nearest" });
}

/* คลิกแถว = เลือก · คลิกสามเหลี่ยม = พับ/กาง · ชี้ = ไฮไลต์ตัวจริงใน canvas */
document.getElementById("layerTree")?.addEventListener("click", (e) => {
  const tw = e.target.closest("[data-lyrtw]");
  if (tw) {
    const id = tw.dataset.lyrtw;
    if (layerClosed.has(id)) layerClosed.delete(id); else layerClosed.add(id);
    renderLayers();
    return;
  }
  const row = e.target.closest("[data-lyr]");
  if (!row) return;
  /* keepTab = อยู่แท็บเลเยอร์ต่อ ไม่เด้งไปแท็บตั้งค่า — ไม่งั้นเลือกทีเดียวก็หลุดออกจากต้นไม้ */
  select(row.dataset.lyr, true);
  document.querySelector(`.wb-block[data-id="${row.dataset.lyr}"]`)
    ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
});

document.getElementById("layerTree")?.addEventListener("mouseover", (e) => {
  const row = e.target.closest("[data-lyr]");
  document.querySelectorAll(".wb-hl").forEach((el) => el.classList.remove("wb-hl"));
  if (row) document.querySelector(`.wb-block[data-id="${row.dataset.lyr}"]`)?.classList.add("wb-hl");
});
document.getElementById("layerTree")?.addEventListener("mouseleave", () => {
  document.querySelectorAll(".wb-hl").forEach((el) => el.classList.remove("wb-hl"));
});

function select(id, keepTab) {
  if (id !== selectedId) openItems.clear(); /* คนละบล็อก = คนละลิสต์ คีย์เดิมใช้ไม่ได้ */
  selectedId = id;
  document.querySelectorAll(".wb-block").forEach((el) =>
    el.classList.toggle("selected", el.dataset.id === id)
  );
  renderProps();
  /* แผงเลเยอร์อยู่คนละฝั่งกับแท็บตั้งค่า → เลือกจากต้นไม้แล้วพาไปแท็บตั้งค่าได้เลย
     ไม่เสียบริบท เพราะต้นไม้ยังอยู่ให้เห็นตลอด (นี่คือเหตุผลที่แยกออกมาเป็นแผง ไม่ใช่แท็บ) */
  switchTab("props");
  focusLayers(id);
  renderLayers();
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
/* ── เทียบปุ่มลัดด้วย "ตำแหน่งปุ่มจริงบนแป้น" (e.code) ไม่ใช่ตัวอักษรที่พิมพ์ออกมา (e.key) ──
   ⚠️ สำคัญมากกับผู้ใช้ไทย: สลับแป้นเป็นภาษาไทยแล้วกด Ctrl+S เบราว์เซอร์ส่ง e.key = "ห"
   (Ctrl+Z→"ผ" · Ctrl+Y→"ั" · Ctrl+C→"แ" · Ctrl+V→"อ") → เช็ค e.key === "s" ไม่มีทางเข้าเงื่อนไข
   ผลคือคีย์ลัดเงียบทั้งหมด และ Ctrl+S หลุดไปเป็น "Save page as…" ของเบราว์เซอร์
   e.code = ตำแหน่งปุ่มบนแป้น ไม่ขึ้นกับภาษา · ยังเทียบ e.key ไว้เป็นตัวสำรอง (แป้น layout แปลกๆ) */
const isKey = (e, code, ch) => e.code === code || e.key?.toLowerCase() === ch;

document.addEventListener("keydown", (e) => {
  /* มี modal เปิดอยู่ → ปล่อยให้ modal จัดการคีย์เอง
     โปรเจกต์นี้มี 3 convention ต้องเช็คให้ครบ ไม่งั้น guard หลุด:
     form modal = .modal-overlay.open · ConfirmModal = .cm-overlay.open · DeleteModal = .dm-overlay.active */
  if (document.querySelector(".modal-overlay.open, .cm-overlay.open, .dm-overlay.active")) return;

  /* ── Undo / Redo ──
     Ctrl+Z · Ctrl+Shift+Z · Ctrl+Y (Cmd บน Mac)
     ⚠️ กำลังพิมพ์อยู่ในช่องกรอก = ปล่อยให้เบราว์เซอร์ย้อนตัวอักษรตามปกติ
     ถ้าแย่งไปย้อนทั้งหน้า ผู้ใช้จะเสียงานที่พิมพ์ค้างไว้โดยไม่ได้ตั้งใจ */
  /* Ctrl+Alt+C / Ctrl+Alt+V = คัดลอก/วางสไตล์
     ใช้ Alt ร่วมด้วยเพราะ Ctrl+C/Ctrl+V ล้วนๆ ต้องเป็นของการคัดลอกข้อความตามปกติ */
  if ((e.ctrlKey || e.metaKey) && e.altKey) {
    if (isKey(e, "KeyC", "c")) { e.preventDefault(); copyStyle(); return; }
    if (isKey(e, "KeyV", "v")) { e.preventDefault(); pasteStyle(); return; }
  }

  /* ── Ctrl+S = บันทึก ──
     ต้อง preventDefault ไม่งั้นเบราว์เซอร์เปิดหน้าต่าง "Save page as…" ทับ
     ทำงานแม้กำลังพิมพ์อยู่ (ต่างจาก Ctrl+Z) เพราะ Ctrl+S ในช่องกรอกไม่มีความหมายอื่น
     blur ก่อน = ปิดการแก้ชื่อในที่ (ดับเบิลคลิกหัวการ์ด) ให้บันทึกค่าลง props ก่อนยิงขึ้นเซิร์ฟเวอร์
     ไม่ทำ = กด Ctrl+S ระหว่างแก้ชื่อแล้วชื่อที่พิมพ์หายไปเฉยๆ */
  if ((e.ctrlKey || e.metaKey) && !e.altKey && isKey(e, "KeyS", "s")) {
    e.preventDefault();
    document.activeElement?.blur();
    if (!dirty) return toast("บันทึกไว้แล้ว ไม่มีอะไรเปลี่ยน");
    savePage();
    return;
  }

  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    /* "กำลังพิมพ์" = ช่องที่มีตัวอักษรให้ย้อนจริงๆ เท่านั้น
       ⚠️ อย่าเหมารวมทุก input — แถบเลื่อน/สวิตช์/ปุ่มเลือก/จานสี เบราว์เซอร์ไม่มี undo ให้
       เหมารวมเมื่อไหร่ = ลากแถบเลื่อนเสร็จแล้วกด Ctrl+Z จะเงียบสนิท (โฟกัสยังค้างที่แถบ)
       ซึ่งเป็นจังหวะที่อยาก undo มากที่สุดพอดี */
    const t = e.target;
    const typing =
      t && (t.isContentEditable ||
        t.matches("textarea") ||
        t.matches('input:not([type]), input[type="text"], input[type="number"], input[type="search"], input[type="url"], input[type="email"], input[type="tel"], input[type="password"]'));
    if (!typing && (isKey(e, "KeyZ", "z") || isKey(e, "KeyY", "y"))) {
      e.preventDefault();
      if (isKey(e, "KeyY", "y") || e.shiftKey) redo(); else undo();
      return;
    }
  }

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
/* element ต้องมีบ้าน — ห่อด้วย section ช่องเดียว (1 คอลัมน์ × 1 แถว)
   ⚠️ ต้องส่ง preset "1x1" ให้ newBlock เสมอ — ค่าเริ่มต้นของ section คือ 1-1 (2 คอลัมน์)
   ถ้าไม่ส่ง ผู้ใช้ลากรูปมา 1 ใบแล้วได้กริด 2 ช่องโดยไม่ได้ขอ */
function wrapInSection(el) {
  const s = window.WebBlocks.newBlock("section", "1x1");
  s.children[0].children.push(el);
  return s;
}

/* ── เป้าหมายการวางตอนนี้ ──
   element (ข้อความ/รูป/ปุ่ม) → ต้องลงใน "คอลัมน์" เท่านั้น (นอกคอลัมน์ = วางไม่ได้)
   อย่างอื่น (section/บล็อกเดิม)  → ลงระดับหน้า
   คืน { host, list } — host = DOM ที่ใช้คำนวณตำแหน่ง · list = array จริงที่จะ splice */
/* ── ช่องที่แบ่งกริดย่อยแล้ว = องค์ประกอบต้องลงช่องย่อยเสมอ ──
   กติกา: ช่องหนึ่งเป็นได้อย่างเดียว — "เป็นกริดย่อย" หรือ "เป็นที่วางองค์ประกอบ" ไม่ปนกัน
   เหตุผล: ถ้าปนได้ จะเกิดของที่ลอยอยู่ใต้กริดย่อยในช่องเดียวกัน ซึ่งอ่านไม่ออกว่าอยู่ชั้นไหน
   และพื้นที่ในช่องแม่ที่ไม่ใช่ของช่องย่อยไหนเลย (ช่องไฟ · ใต้กริด · ขอบใน) มีเยอะมาก
   เล็งพลาดตรงไหนของก็หลุดออกนอกกริดทันที

   เลือก "ดูดเข้าช่องย่อยที่ใกล้ที่สุด" แทนการ "ห้ามวาง" เพราะห้ามแล้วจะได้เคอร์เซอร์ 🚫
   บนพื้นที่ที่ตาเห็นว่าว่าง = ผู้ใช้งงว่าทำไมวางไม่ได้ · ดูดได้ผลลัพธ์เดียวกันแต่ไม่มีทางตัน */
function snapToCell(colEl, x, y) {
  /* เอาเฉพาะกริด "ลูกโดยตรง" ของช่องนี้ ไม่ใช่ลูกหลานทั้งหมด
     ซ้อนได้หลายชั้นแล้ว ถ้ากวาดทั้งกิ่ง จุดที่อยู่ในช่องไฟชั้นนอกจะกระโดดไปลงช่องลึกสุดที่บังเอิญใกล้กว่า */
  const secs = [...colEl.querySelectorAll(':scope > .wv-col > .wb-block[data-type="section"]')];
  if (!secs.length) return null;
  const cells = secs.flatMap((s) => [...s.querySelectorAll(':scope > .wv-sec > .wv-grid > .wb-block[data-type="column"]')]);
  let best = null, bestD = Infinity;
  cells.forEach((el) => {
    const r = el.getBoundingClientRect();
    const dx = Math.max(r.left - x, 0, x - r.right);
    const dy = Math.max(r.top - y, 0, y - r.bottom);
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = el; }
  });
  return best;
}

/* ── หาช่องจาก "พิกัด" ไม่ใช่จาก e.target ──
   ⚠️ ห้ามกลับไปใช้ e.target.closest() — ของ editor หลายอย่างลอยทับเนื้อหาและต้องรับคลิกเอง
   (ป้ายชื่อบล็อก · แถบปุ่ม ▲▼⧉✕ · ลูกศรสไลด์ · ที่จับลาก padding)
   ป้าย/ปุ่มของกริดย่อยอยู่มุมบน = ทับช่องแถวบนพอดี → เมาส์ไปโดนมันแทนช่อง
   แล้ว closest() เด้งไปเจอช่องแม่ = "แถวล่างวางได้ แถวบนวางไม่ได้" (อาการที่เคยเจอ)
   เทียบพิกัดกับกรอบช่องตรงๆ จึงไม่สนใจว่ามีอะไรลอยทับอยู่
   เลือกช่องที่ "ลึกที่สุด" ที่ครอบจุดนี้ = ช่องย่อยชนะช่องแม่เสมอเมื่อซ้อนกัน */
function cellAtPoint(x, y, opts = {}) {
  let best = null, bestDepth = opts.shallow ? Infinity : -1;
  canvasEl().querySelectorAll('.wb-block[data-type="column"]').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return;
    if (opts.filter && !opts.filter(el)) return;
    let d = 0, p = el.parentElement;
    while (p) { if (p.classList?.contains("wb-block")) d++; p = p.parentElement; }
    if (opts.shallow ? d < bestDepth : d > bestDepth) { bestDepth = d; best = el; }
  });
  return best;
}

function dropTarget(e) {
  if (window.WebBlocks.isElement(dragType)) {
    let colEl = cellAtPoint(e.clientX, e.clientY);
    if (colEl) {
      /* ยังต้องมี snap ต่อ — จุดที่อยู่ในช่องไฟของกริดย่อยจะครอบด้วย "ช่องแม่" เท่านั้น */
      colEl = snapToCell(colEl, e.clientX, e.clientY) || colEl;
      const node = findNode(colEl.dataset.id)?.node;
      if (node) return { host: colEl, list: node.children, forEl: true };
    }
    /* ลากข้อความ/รูป/ปุ่มลงที่ว่างนอกคอลัมน์ = สร้าง section 1 คอลัมน์ห่อให้เอง
       ไม่งั้นหน้าเปล่าจะวางอะไรไม่ได้เลยจนกว่าจะรู้ว่า "ต้องลาก Section มาก่อน"
       — คนใช้ครั้งแรกไม่มีทางเดาออก และจะสรุปว่าเครื่องมือพัง */
    return { host: canvasEl(), list: blocks, forEl: false, autoWrap: true };
  }
  /* ลาก section ลงในช่อง = แบ่งช่องนั้นเป็นกริดย่อย (ทางเดียวกับปุ่ม ＋ แค่คนละวิธีเข้า)
     อนุญาตเฉพาะช่องที่ยังซ้อนได้ (ดู cellCanNest) — ช่องย่อยจะไม่รับ ตกไปเป็นระดับหน้าแทน */
  if (dragType === "section") {
    /* หา "ช่องลึกที่สุดที่รับกริดได้" — รับได้ = ยังไม่ชนเพดานความลึก และข้างในไม่มี element ปน
       (ช่องหนึ่งเป็นได้อย่างเดียว: "ที่อยู่ของกริด" หรือ "ที่วางองค์ประกอบ")
       เล็งในช่องย่อยที่ว่าง = ซ้อนลงไปอีกชั้น · เล็งช่องไฟ/ขอบในของกริด = ได้ช่องแม่ (วางเป็นพี่น้องกับกริดเดิม) */
    const colEl = cellAtPoint(e.clientX, e.clientY, {
      filter: (el) => {
        const n = findNode(el.dataset.id)?.node;
        return n && cellCanNest(n) && (n.children || []).every((c) => c?.type === "section");
      },
    });
    const node = colEl ? findNode(colEl.dataset.id)?.node : null;
    if (node) return { host: colEl, list: node.children, forEl: true, nested: true };
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
  /* ⚠️ หักระยะได้เฉพาะเมื่อกรอบวางอยู่ใน "ช่องเดียวกัน" กับที่กำลังคำนวณ
     ตอนลากข้ามช่อง กรอบยังค้างอยู่ช่องเดิม → ของในช่องใหม่ยังไม่ถูกดัน
     ถ้าหักทิ้งไปด้วยจะเพี้ยนไป 1 ตำแหน่ง (เล็งบนสุด แต่กรอบไปโผล่ล่างสุด) */
  const sameHost = !!line && dropLineHost === (host.dataset?.id || "root");
  const shift = sameHost ? line.getBoundingClientRect().height : 0;
  const els = dropKids(host);
  for (let i = 0; i < els.length; i++) {
    const r = els[i].getBoundingClientRect();
    const top = r.top - (sameHost && dropLineIdx !== null && i >= dropLineIdx ? shift : 0);
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
  /* ย้ายไปช่องอื่นแล้ว = เก็บกรอบเดิมทิ้งก่อนวัดตำแหน่งใหม่
     เหลือกรอบค้างอยู่ในช่องเก่า → เรขาคณิตของทั้ง 2 ช่องเพี้ยนพร้อมกัน (ช่องเก่ายังถูกดัน ช่องใหม่ยังไม่ถูกดัน)
     ล้างก่อนแล้ววัดบนหน้าที่ "สะอาด" เสมอ ตัดปัญหาทั้งคลาสนี้ทิ้ง */
  if (dropLineHost !== null && dropLineHost !== (t.host.dataset?.id || "root")) clearDropLine();
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
    /* section ที่ลงในช่อง ต้องใช้ค่าเริ่มต้นแบบ "กริดย่อย" (ไม่มี padding แถบเต็มจอ) */
    const nb = type === "section" ? makeSection(preset, !!t.nested) : window.WebBlocks.newBlock(type, preset);
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
    renderCrumb(null);
    renderStyleBar(null);
    return;
  }
  renderStyleBar(b);
  const def = window.WebBlocks.get(b.type);
  /* หัวแผง = "ตั้งค่า · <ชื่อบล็อกสั้น>" — ตัดวงเล็บอธิบายทิ้ง (ยาวเกินจนตกบรรทัดในแผงแคบ) */
  hdr.textContent = `⚙️ ตั้งค่า · ${blockLabel(def).replace(/\s*\(.*\)\s*$/, "")}`;
  /* เส้นทาง Section › คอลัมน์ › ข้อความ — ของซ้อนกัน 3 ชั้นแล้ว ถ้าไม่บอกว่าอยู่ชั้นไหน
     ผู้ใช้จะแก้ padding ของคอลัมน์ทั้งที่ตั้งใจแก้ของ section แล้วงงว่าทำไมไม่ขยับ
     กดที่ชื่อชั้นบน = กระโดดไปเลือกชั้นนั้น (ทางเดียวที่จะเลือก section ได้เมื่อมันเต็มไปด้วยลูก) */
  renderCrumb(b);

  /* บริบทกริด: section = ของตัวเอง · ช่อง = ของ section ที่มันอยู่ */
  const WB = window.WebBlocks;
  const grid = b.type === "section" ? b : b.type === "column" ? findNode(b.id)?.parent : null;
  uiCtx = grid
    ? { cols: WB.colParts(grid.props.layout).length, rows: WB.rowsOf(grid.props.rows), head: !!grid.props.headRow }
    : { cols: 1, rows: 1, head: false };
  /* block ที่มี section marker → โหมดแบ่งหมวด (หัวข้อเทา + แถวแนวนอน) เช่น site_header
     block อื่น → โหมดเดิม (ป้ายสีเขียว + เส้นคั่น) ไม่กระทบ */
  const sectioned = def.fields.some((f) => f.section);
  /* กลุ่มแรก = "เนื้อหา/สิ่งที่บล็อกนี้เป็น" (รูป · ข้อความ · เลย์เอาต์) → ป้ายไฮไลต์ + เว้นห่างจากกัน
     กลุ่มถัดไป (สไตล์ · พฤติกรรม) = ป้ายเงียบๆ แถวชิดกัน
     ถ้าไฮไลต์ทุกป้ายจะกลายเป็นเขียวทั้งแผงจนไม่มีอะไรเด่น = เท่ากับไม่ได้ไฮไลต์ */
  /* บล็อกที่ขึ้นต้นด้วยหัวข้อกลุ่ม (site_header/section/column) → กลุ่มที่ 1 คือกลุ่มเนื้อหา
     บล็อกที่ยิงฟิลด์มาเลย (el_image/el_text) → ของที่อยู่ "ก่อนหัวข้อแรก" คือกลุ่มเนื้อหา
     ไม่แยก 2 กรณีนี้ = el_image โดนไฮไลต์ทุกบรรทัดจนไม่เหลืออะไรเด่น */
  const primaryGrp = def.fields[0]?.section != null ? 1 : 0;
  /* อ่านค่ามาแสดงผ่าน withDefaults เสมอ = แหล่งเดียวกับที่ renderer ใช้
     ⚠️ ห้ามอ่าน b.props ตรงๆ — block ที่สร้างไว้ก่อนจะเพิ่ม field ใหม่จะไม่มี key นั้น
     แผงจะโชว์ค่าต่ำสุด แต่ภาพจริงใช้ default ของ renderer = ตัวเลขไม่ตรงกับที่เห็น
     (เขียนยังลง b.props เหมือนเดิม — ที่นี่ใช้อ่านอย่างเดียว) */
  const view = window.WebBlocks.withDefaults(b).props;

  /* ── ทางลัดไปตั้งค่ากริดย่อย ──
     ช่องที่ถูกแบ่งแล้ว "เลย์เอาต์" ไม่ได้อยู่ที่ตัวช่อง แต่อยู่ที่แถบย่อยที่ซ้อนอยู่ข้างใน
     ซึ่งคลิกเลือกยากมาก (คลิกตรงไหนก็โดนช่องย่อยที่อยู่ในสุด) — เหลือทาง breadcrumb ทางเดียว
     ที่ไม่มีใครเดาออก → เอามาไว้บนสุดของแผงช่องให้เห็นชัดๆ */
  const innerSec = b.type === "column" ? (b.children || []).find((c) => c?.type === "section") : null;
  const jump = innerSec
    ? `<button type="button" class="wb-jump" data-jump="${innerSec.id}">▦ ช่องนี้แบ่งเป็นกริดย่อยอยู่ — กดเพื่อเปลี่ยนเลย์เอาต์</button>`
    : "";

  let grp = 0;
  host.innerHTML = jump + def.fields
    .map((f, i) => {
      if (f.section) { grp++; return `<div class="wb-section">${f.section}</div>`; }
      if (f.type === "textsetting") return textSettingHtml(f, view);
      const sep = !sectioned && !f.half && i > 0 ? '<div class="wb-sep"></div>' : "";
      return sep + fieldHtml(f, view[f.key], sectioned, grp === primaryGrp);
    })
    .join("");
}

/* ============================================================
   คัดลอก / วาง "สไตล์"
   ============================================================
   ตั้งค่าสไลด์ 1 ใบใช้เวลาพอควร (ความเข้ม · ความสูงไล่สี · ขนาดพาดหัว · ลูกศร ...)
   พอมี 4 ใบในกริดต้องทำซ้ำทั้งหมด — ก๊อปสไตล์ทีเดียวจบ โดยเนื้อหาของแต่ละใบไม่ถูกแตะ

   "อะไรคือสไตล์" ไม่ต้องมาไล่ระบุทีละ field — ใช้โครงที่ contract มีอยู่แล้ว:
     กลุ่มแรก (เนื้อหา/สิ่งที่บล็อกนี้เป็น) = ไม่ก๊อป · กลุ่มถัดไป (สไตล์ · พฤติกรรม ...) = ก๊อป
   ผลพลอยได้คือ field ใหม่ที่เพิ่มทีหลังจะเข้ากลุ่มถูกเอง ไม่ต้องมาแก้ตรงนี้อีก */
const STYLE_CLIP_KEY = "wb_style_clip";
let styleClip = null;
try { styleClip = JSON.parse(localStorage.getItem(STYLE_CLIP_KEY) || "null"); } catch { styleClip = null; }

function styleKeys(def) {
  const primaryGrp = def.fields[0]?.section != null ? 1 : 0;
  let grp = 0;
  const keys = [];
  def.fields.forEach((f) => {
    if (f.section) { grp++; return; }
    /* TextSetting: ข้อความ = เนื้อหา · ขนาด/สี/น้ำหนัก/จัดวาง = สไตล์ (อยู่ field เดียวกันแต่คนละ prop) */
    if (f.type === "textsetting") {
      Object.entries(f.map || {}).forEach(([role, pk]) => { if (role !== "text") keys.push(pk); });
      return;
    }
    if (grp === primaryGrp) return;
    if (f.type === "list" || f.type === "image") return; /* รายการ/รูป = เนื้อหาแน่นอน */
    keys.push(f.key);
  });
  return keys;
}

function copyStyle() {
  const b = curNode();
  if (!b) return;
  const def = window.WebBlocks.get(b.type);
  const keys = styleKeys(def);
  if (!keys.length) return toast("บล็อกนี้ไม่มีสไตล์ให้คัดลอก", "error");
  const props = {};
  const view = window.WebBlocks.withDefaults(b).props;
  keys.forEach((k) => { if (view[k] !== undefined) props[k] = view[k]; });
  styleClip = { type: b.type, label: blockLabel(def), props };
  try { localStorage.setItem(STYLE_CLIP_KEY, JSON.stringify(styleClip)); } catch {}
  renderStyleBar(b);
  toast(`คัดลอกสไตล์ของ "${styleClip.label}" แล้ว (${keys.length} ค่า)`);
}

function pasteStyle() {
  const b = curNode();
  if (!b || !styleClip) return;
  /* ต้องเป็นบล็อกชนิดเดียวกัน — ชนิดอื่นมี prop คนละชุด ยัดข้ามกันได้ค่าเพี้ยนเงียบๆ */
  if (styleClip.type !== b.type) {
    return toast(`วางไม่ได้ — สไตล์ที่คัดลอกไว้เป็นของ "${styleClip.label}"`, "error");
  }
  Object.assign(b.props, JSON.parse(JSON.stringify(styleClip.props)));
  setDirty(true);
  refreshBlock(b.id);
  renderProps();
  toast("วางสไตล์แล้ว");
}

function renderStyleBar(b) {
  const host = document.getElementById("styleBar");
  if (!host) return;
  if (!b) { host.hidden = true; host.innerHTML = ""; return; }
  const same = styleClip && styleClip.type === b.type;
  host.hidden = false;
  host.innerHTML = `
    <button type="button" class="wb-sb-btn" onclick="copyStyle()" title="คัดลอกเฉพาะสไตล์ (Ctrl+Alt+C)">⧉ คัดลอกสไตล์</button>
    <button type="button" class="wb-sb-btn${same ? "" : " is-off"}" onclick="pasteStyle()" ${same ? "" : "disabled"}
      title="${same ? "วางสไตล์ที่คัดลอกไว้ (Ctrl+Alt+V)" : styleClip ? `สไตล์ที่คัดลอกไว้เป็นของ “${styleClip.label}”` : "ยังไม่ได้คัดลอกสไตล์"}">⤓ วางสไตล์</button>`;
}

/* ── breadcrumb ของ node ที่เลือก ──
   ไล่จาก id ขึ้นไปหาบรรพบุรุษด้วย find() ซ้ำๆ (โครงเล็ก ต้นทุนไม่มีนัยยะ)
   วาดใต้หัวแผง · ชั้นสุดท้าย = ตัวที่กำลังแก้ (ไม่ต้องกด) */
function renderCrumb(node) {
  const host = document.getElementById("propsCrumb");
  if (!host) return;
  if (!node) { host.innerHTML = ""; host.hidden = true; return; }
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
        : `<button class="wb-crumb-up" data-crumb="${n.id}" title="กดเพื่อเลือกและตั้งค่าชั้นนี้">${name}</button>`;
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

/* ── บริบทของกริดที่ล้อมรอบ node ที่กำลังแก้ ──
   ตั้งใน renderProps ทุกครั้ง · ใช้ 2 อย่าง
     1. ปุ่มเลือกเลย์เอาต์วาดตัวอย่างตามจำนวนแถวจริง
     2. ตัวเลือก "กินกี่คอลัมน์/กี่แถว" ของช่อง ต้องไม่เกินขนาดกริดที่มันอยู่
        (ปล่อยให้เลือก 4 ในกริด 2 คอลัมน์ = ผู้ใช้กดแล้วไม่เห็นอะไรเปลี่ยน แล้วเดาไม่ออกว่าทำไม) */
let uiCtx = { cols: 1, rows: 1 };

function spanOpts(f) {
  const max = f.key === "spanX" ? uiCtx.cols : uiCtx.rows;
  return (f.options || []).filter((o) => +o.value <= (max || 1));
}

function fieldHtml(f, val, sectioned, primary) {
  if (f.type === "list") return listHtml(f, val || [], sectioned);
  if (f.type === "image") return imageFieldHtml(f, val, primary);
  /* กริด 1 คอลัมน์ → "กินกี่คอลัมน์" มีตัวเลือกเดียว = ไม่ต้องโชว์ให้รก */
  if ((f.key === "spanX" || f.key === "spanY") && spanOpts(f).length < 2) return "";
  /* row = แถวแนวนอน (label ซ้าย/ตัวคุมขวา) · half = ครึ่งกว้างเรียงคู่
     head (ป้ายสีเขียว) = เฉพาะ block โหมดเดิมที่ไม่มี section */
  let cls = "wb-field";
  if (f.row) cls += " wb-field--row";
  else if (f.half) cls += " wb-field--half";
  else if (!sectioned) cls += " wb-field--head";
  if (primary) cls += " wb-field--primary";
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
    /* วาดตัวอย่างตามจำนวนแถวที่ตั้งอยู่จริง (ctx.rows) → เห็นผลลัพธ์ก่อนกด ไม่ใช่เห็นแค่คอลัมน์ */
    return `<div class="wb-gridpick">${(f.options || [])
      .map((o) => `<button type="button" class="wb-gp${String(val) === String(o.value) ? " active" : ""}" ${attrs} data-setbtn="1" data-val="${o.value}" title="${window.WebRender.esc(o.label)}">${window.WebBlocks.gridWire(o.value, uiCtx.rows || 1, 120, 40, 5, 3.5, uiCtx.head)}</button>`)
      .join("")}</div>`;
  }
  if (f.type === "segment") {
    /* ปุ่มเลือก 1 ตัว (ซ้าย/กลาง) = radio ซ่อน + label เป็นปุ่ม → ไหลผ่าน input handler เป็นค่าปกติ */
    const nm = `seg-${ctx.fk || f.key}-${ctx.idx ?? ""}`;
    const segOpts = f.key === "spanX" || f.key === "spanY" ? spanOpts(f) : f.options || [];
    return `<div class="wb-seg">${segOpts
      .map((o) => `<label class="wb-seg-btn"><input type="radio" ${attrs} name="${nm}" value="${window.WebRender.esc(o.value)}"${String(val) === String(o.value) ? " checked" : ""} /><span>${window.WebRender.esc(o.label)}</span></label>`)
      .join("")}</div>`;
  }
  if (f.type === "range") {
    /* ตัวเลขเป็น input ไม่ใช่ป้าย — ลากหยาบๆ ด้วยแถบ แล้วพิมพ์ค่าเป๊ะๆ ทีหลังได้
       (แถบเลื่อนอย่างเดียวเล็งเลขที่ต้องการไม่ได้เลย โดยเฉพาะช่วงกว้างอย่าง 0-600)
       ทั้งคู่ใช้ data-fk เดียวกัน → ไหลเข้า handler เดิม แล้ว sync กันเองในนั้น */
    const rv = window.WebRender.esc(val ?? f.min ?? 0);
    const mm = `min="${f.min ?? 0}" max="${f.max ?? 100}" step="${f.step ?? 1}"`;
    return `<div class="wb-range">
      <input type="range" ${attrs} ${mm} value="${rv}" />
      <span class="wb-range-num">
        <input type="number" class="wb-range-val" ${attrs} ${mm} value="${rv}" />
        ${f.unit ? `<span class="wb-range-unit">${f.unit}</span>` : ""}
      </span>
    </div>`;
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
function imageFieldHtml(f, val, primary) {
  const attrs = `data-fk="${f.key}"`;
  const v = window.WebRender.esc(val ?? "");
  return `<div class="wb-field wb-field--row${primary ? " wb-field--primary" : ""}">
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
  return `${arr.map((item, idx) => {
      /* พับไว้เป็นค่าเริ่มต้นเมื่อมีหลายรายการ — การ์ดสไลด์ 1 ใบสูงเกือบเต็มจอ
         มี 3 ใบก็เลื่อนหาไม่เจอแล้ว · รายการเดียวไม่ต้องพับ (พับแล้วไม่ได้อะไร) */
      const key = `${f.key}:${idx}`;
      const open = arr.length === 1 || openItems.has(key);
      const pv = itemPreview(f, item);
      return `
      <div class="wb-list-item${open ? "" : " collapsed"}">
        <div class="wb-list-item-hdr" data-litoggle="${key}" data-lfk="${f.key}" data-lidx="${idx}">
          <span class="wb-li-caret">›</span>
          <span class="wb-li-no">#${idx + 1}</span>
          <span class="wb-li-preview${pv ? "" : " is-empty"}" title="ดับเบิลคลิกเพื่อเปลี่ยนชื่อ">${
            pv ? window.WebRender.esc(pv) : "(ยังไม่มีชื่อ)"
          }</span>
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
      </div>`;
    }).join("")}
    <button class="wb-btn-add" data-lact="add" data-fk="${f.key}">＋ เพิ่มรายการ</button>`;
}

/* ข้อความสรุปบนหัวการ์ดตอนพับ — "#1" เฉยๆ บอกไม่ได้ว่าใบไหนคือใบไหน
   หยิบช่องข้อความช่องแรกที่มีค่า (ข้าม toggle/รูป เพราะเป็น URL ยาวอ่านไม่รู้เรื่อง) */
/* ช่องที่ถือ "ชื่อ" ของรายการ = ช่องข้อความช่องแรก (ข้าม toggle/รูป/dropdown)
   ใช้ตัวเดียวกันทั้งข้อความสรุปและการดับเบิลคลิกเปลี่ยนชื่อ — ที่เห็นคือที่แก้ ไม่หลุดกัน */
function primaryField(f) {
  return (f.itemFields || []).find((x) => !["toggle", "image", "select"].includes(x.type)) || null;
}

function itemPreview(f, item) {
  const sf = primaryField(f);
  const v = sf ? String(item[sf.key] || "").trim().replace(/\s+/g, " ") : "";
  return v.length > 34 ? v.slice(0, 34) + "…" : v;
}

/* ── ดับเบิลคลิกที่ข้อความสรุป = เปลี่ยนชื่อในที่ ──
   ไม่ต้องกางการ์ดแล้วเลื่อนหาช่อง "พาดหัว" ทีละใบ (สไลด์ 4 ใบ = กาง 4 รอบ)
   คลิกเดียวยังเป็นการพับ/กาง — จึงผูก dblclick ไว้ที่ "ข้อความสรุป" เท่านั้น
   แล้วให้ตัวพับข้ามคลิกที่ตกบนข้อความนี้ ไม่งั้นดับเบิลคลิกจะพับ-กางสลับ 2 ครั้งไปด้วย */
let renaming = false;

function startRename(pvEl) {
  if (renaming) return;
  const hdr = pvEl.closest("[data-litoggle]");
  const b = curNode();
  if (!hdr || !b) return;
  const fk = hdr.dataset.lfk;
  const idx = +hdr.dataset.lidx;
  const f = window.WebBlocks.get(b.type)?.fields.find((x) => x.key === fk);
  const sf = f && primaryField(f);
  if (!sf) return;

  renaming = true;
  const inp = document.createElement("input");
  inp.className = "wb-li-rename";
  inp.value = b.props[fk][idx][sf.key] || "";
  inp.placeholder = sf.label;
  pvEl.replaceWith(inp);
  inp.focus();
  inp.select();

  let closed = false;
  const done = (save) => {
    if (closed) return; /* Enter แล้ว blur ตามมาทันที — กันทำงานซ้ำ */
    closed = true;
    renaming = false;
    if (save) {
      b.props[fk][idx][sf.key] = inp.value;
      setDirty(true);
      refreshBlock(b.id);
    }
    renderProps();
  };
  inp.addEventListener("keydown", (ev) => {
    ev.stopPropagation(); /* กัน Delete/Escape ทะลุไปสั่งลบบล็อกใน canvas */
    if (ev.key === "Enter") { ev.preventDefault(); done(true); }
    else if (ev.key === "Escape") { ev.preventDefault(); done(false); }
  });
  inp.addEventListener("blur", () => done(true));
}

/* ออกจากช่องตัวเลขแล้วค่อยจัดตัวอักษรให้ตรงกับค่าที่เก็บจริง (เผื่อพิมพ์เกินช่วงหรือปล่อยว่าง)
   change ของ input[type=number] ยิงตอน blur/Enter — ไม่รบกวนระหว่างพิมพ์ */
document.getElementById("props").addEventListener("change", (e) => {
  const el = e.target;
  if (!el.classList?.contains("wb-range-val")) return;
  const b = curNode();
  if (!b || !el.dataset.fk) return;
  const cur = b.props[el.dataset.fk];
  el.value = cur == null || cur === "" ? el.min : cur;
});

/* ปุ่มกระโดดไปเลือก node อื่น (ตอนนี้ใช้กับ "ตั้งค่ากริดย่อย") */
document.getElementById("props").addEventListener("click", (e) => {
  const j = e.target.closest("[data-jump]");
  if (j) select(j.dataset.jump);
});

document.getElementById("props").addEventListener("dblclick", (e) => {
  const pv = e.target.closest(".wb-li-preview");
  if (pv) startRename(pv);
});

/* จำว่าการ์ดไหนกางอยู่ (คีย์ = "fk:idx") — renderProps วาดใหม่บ่อย ถ้าไม่จำจะพับกลับหมดทุกครั้ง
   ล้างเมื่อเลือกบล็อกอื่น/สลับลำดับ เพราะ idx เลื่อนแล้วคีย์เดิมชี้ผิดใบ */
const openItems = new Set();

document.getElementById("props").addEventListener("click", (e) => {
  const hdr = e.target.closest("[data-litoggle]");
  /* ปุ่ม ▲▼✕ เป็นของมันเอง · ข้อความสรุปสงวนไว้ให้ดับเบิลคลิกเปลี่ยนชื่อ
     (ถ้าไม่ข้าม ดับเบิลคลิกจะพับ-กาง 2 ครั้งซ้อนไปกับการแก้ชื่อ) */
  if (!hdr || e.target.closest("button[data-lact]") || e.target.closest(".wb-li-preview")) return;
  const key = hdr.dataset.litoggle;
  const card = hdr.closest(".wb-list-item");
  const nowOpen = card.classList.toggle("collapsed") === false;
  if (nowOpen) openItems.add(key); else openItems.delete(key);
});

/* ── พิมพ์ → อัปเดต state + วาด block นั้นใหม่ (ไม่แตะ panel) ── */
document.getElementById("props").addEventListener("input", (e) => {
  const el = e.target;
  if (!el.dataset.fk || el.dataset.upload) return;
  const b = curNode();
  if (!b) return;
  /* checkbox เก็บค่าที่ .checked ไม่ใช่ .value (.value ของ checkbox คือ "on" เสมอ) */
  const isToggle = el.type === "checkbox";
  let val = isToggle ? el.checked : el.value;

  /* ช่องตัวเลขข้างแถบเลื่อน: input[type=number] ไม่กันค่าเกิน min/max ให้ (พิมพ์ 9999 ก็รับ)
     บีบค่าที่ "เก็บลง props" อย่างเดียว ไม่แตะตัวอักษรที่กำลังพิมพ์
     (ถ้าเขียนทับระหว่างพิมพ์ จะพิมพ์ "16" ไม่ได้เลยเพราะ "1" โดนดันเป็น min ทันที)
     ตัวอักษรจะถูกจัดให้ตรงตอนออกจากช่อง — ดู listener "change" ข้างล่าง */
  if (el.classList.contains("wb-range-val") && el.value !== "" && Number.isFinite(+el.value)) {
    val = Math.min(+el.max, Math.max(+el.min, +el.value));
  }

  if (el.dataset.idx != null && el.dataset.sub) {
    b.props[el.dataset.fk][+el.dataset.idx][el.dataset.sub] = val;
  } else {
    b.props[el.dataset.fk] = val;
  }

  /* จำนวนแถวเปลี่ยน = จำนวนช่องเปลี่ยน (คอลัมน์ × แถว) → สร้าง/ยุบ children แล้ววาดใหม่ทั้ง canvas
     ต้อง renderProps ด้วย เพราะปุ่มเลือกเลย์เอาต์วาดตัวอย่างตามจำนวนแถว และตัวเลือก span ก็เปลี่ยนตาม */
  if (b.type === "section" && (el.dataset.fk === "rows" || el.dataset.fk === "headRow")) {
    window.WebBlocks.syncColumns(b);
    setDirty(true);
    renderCanvas();
    renderProps();
    return;
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

  /* แถบเลื่อน ↔ ช่องตัวเลข: ขยับอันไหนอีกอันตามทันที (คนละ element แต่คุมค่าเดียวกัน) */
  const rw = el.closest(".wb-range");
  if (rw) {
    const rng = rw.querySelector('input[type="range"]');
    const numI = rw.querySelector(".wb-range-val");
    if (el === rng && numI) numI.value = el.value;
    else if (el === numI && rng) rng.value = el.value;
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
      renderProps(); /* ตัวเลือก "กินกี่คอลัมน์" ของช่องข้างในเปลี่ยนตามจำนวนคอลัมน์ใหม่ */
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
    openItems.add(`${fk}:${arr.length - 1}`); /* เพิ่งกดเพิ่ม = กำลังจะกรอก ต้องกางให้เลย */
  } else if (act === "del") arr.splice(idx, 1);
  else if (act === "up" && idx > 0) [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
  else if (act === "down" && idx < arr.length - 1) [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]];
  else return;

  /* ลบ/สลับลำดับแล้ว idx เลื่อน → คีย์ที่จำไว้จะชี้ผิดใบ ล้างทิ้งดีกว่ากางผิดใบให้งง */
  if (act !== "add") openItems.clear();
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
