/* ============================================================
   stock-check.js — ตรวจนับสต็อก (แทน Google Sheet "Stock F.3")
   Tables: stock_check_sessions, stock_check_lines  (sql/177)

   โครงงาน:
     - 1 รอบตรวจนับ = 1 แผ่นชีตเดิม · เลือกรอบจาก dropdown บนสุด
     - ตารางคือใบตรวจนับ: ช่องขาว = กรอกได้ · ช่องเทา = สูตร (รวม / ผลต่าง)
     - สูตร F และ J คำนวณที่ฐานข้อมูล (GENERATED COLUMN) — ที่นี่คำนวณซ้ำ
       ฝั่งหน้าเว็บเพื่อให้ตัวเลขขยับทันทีระหว่างพิมพ์ แล้วรับค่าจริงจาก
       server กลับมาทับตอนบันทึกเสร็จ (กันสูตร 2 ฝั่งเพี้ยนจากกันเงียบ ๆ)
     - แจ้งเตือน L / M คำนวณฝั่งนี้อย่างเดียว (เป็นข้อความ ไม่ใช่ตัวเลขตั้งต้น)
     - ยืม / เบิก / ยอดในระบบ กดปุ่มดึงจากที่อื่นได้ แต่พิมพ์ทับเองได้เสมอ
       (ชีตเดิมพิมพ์มือทั้งหมด — ห้ามล็อกจนคนทำงานแก้ตัวเลขที่ผิดไม่ได้)
   ============================================================ */

const SB_URL = localStorage.getItem("sb_url") || "";
const SB_KEY = localStorage.getItem("sb_key") || "";

/* หน้านี้นับคลังเดียวตายตัวทุกวัน (กทม. ชั้น3) — ไม่เปิดให้เลือกในหน้า
   เพราะเลือกผิดคลังทีเดียว = ใบของวันนั้นไปโผล่คนละที่ แล้ว duplicate วันถัดไปก็เพี้ยนตาม
   เก็บเป็นค่าตั้งค่าใน DB ไม่ hardcode — ย้ายคลังทีหลังแก้ที่เดียวโดยไม่ต้องแตะโค้ด:
     UPDATE app_settings SET value = '<warehouse_id>' WHERE key = 'stock_check_warehouse_id';
   ไม่ได้ตั้งไว้ = ใช้ "ทุกคลัง" (warehouse_id NULL) */
const WH_SETTING_KEY = "stock_check_warehouse_id";

/* คอลัมน์ที่เราส่งขึ้น server ได้ — generated column (total_pieces, variance)
   ห้ามอยู่ในชุดนี้ เพราะ Postgres ปฏิเสธการเขียนทับ
   ใช้ชุดเดียวกันทุกแถวเสมอ ไม่งั้น bulk POST เจอ PGRST102 (keys ไม่ตรงกัน) */
const LINE_COLS = [
  "id", "session_id", "item_id", "product_id", "product_code", "product_name", "category_name",
  "box_unit_name", "pieces_per_box", "qty_box", "qty_piece", "qty_borrow", "qty_issue",
  "qty_system", "note", "sort_order", "borrow_source", "issue_source", "system_source",
];

const state = {
  date: "",             // วันที่ที่กำลังดู (ISO · เวลาไทย)
  warehouseId: "",      // "" = ทุกคลัง · จำค่าไว้ที่ localStorage
  session: null,        // ใบตรวจนับของ (date × warehouse) — 1 วัน 1 ใบ
  creating: false,      // กันสร้างใบซ้อนตอนกดเลื่อนวันรัว ๆ
  lines: [],
  items: [],          // stock_items — master กลาง ใช้ร่วมหน้าเบิก + หน้ายืม/คืน (sql/179)
  categories: [],
  warehouses: [],
  selected: new Set(),
  issues: [],           // เบิกรอเซ็น (stock_check_issues · sql/182) — ทุกแถว = ยังรอเซ็น
  issuesReady: true,    // false = ยังไม่ได้รัน sql/182 (แสดงคำแนะนำแทนตารางว่าง)
  issueSel: new Set(),
  catTint: new Map(),   // ชื่อหมวด (normalize แล้ว) → index สีพื้นแถว 0..5
  itemsDirty: false,    // มีการแก้ master ในโมดัลแล้วยัง sync ตารางไม่ครบ
  upload: { headers: [], rows: [], headerRow: 0, branchIdx: -1 },
  saveTimers: new Map(),   // lineId → timeout handle (debounce ต่อบรรทัด)
  pendingSaves: 0,
};

/* ── helpers ── */
const $ = (id) => document.getElementById(id);
const val = (id) => ($(id)?.value || "").trim();
const showLoading = (on) => { const el = $("loadingOverlay"); if (el) el.style.display = on ? "flex" : "none"; };

function toast(msg, type = "success") {
  const el = $("toast");
  if (!el) return;
  el.textContent = msg;
  el.className = `toast show toast-${type}`;
  setTimeout(() => el.classList.remove("show"), 3200);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

const fmtDate = (iso) => (window.DateFmt ? window.DateFmt.formatDMY(iso) : (iso || ""));
const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/* ตัวเลขในใบตรวจนับเป็นจำนวนของ — ตัดทศนิยมที่ไม่จำเป็นทิ้ง (12.00 → 12) */
function fmtQty(n) {
  if (n === null || n === undefined || n === "") return "—";
  const v = Number(n);
  if (!isFinite(v)) return "—";
  return v.toLocaleString("th-TH", { maximumFractionDigits: 2 });
}


function currentUser() {
  if (window.ERP_USER) return window.ERP_USER;
  const raw = localStorage.getItem("erp_session") || sessionStorage.getItem("erp_session");
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

function can(perm) {
  return !window.AuthZ || typeof AuthZ.hasPerm !== "function" ? true : AuthZ.hasPerm(perm);
}

function applyPerms(root) {
  if (window.AuthZ && typeof AuthZ.applyDomPerms === "function") AuthZ.applyDomPerms(root);
}

/* วันที่ "วันนี้" ตามเวลาไทย — ต้องตรงกับที่ trigger ใน sql/180 ใช้ตัดรอบ
   ห้ามใช้ new Date().toISOString() เพราะเป็น UTC → ช่วงเที่ยงคืน–07:00 ของไทย
   จะยังได้วันเมื่อวาน แล้วใบของวันนี้จะโดนล็อกทันทีที่พนักงานเปิดใช้ตอนเช้า */
const todayISO = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });

/* บวก/ลบวันบน ISO string ตรง ๆ — ไม่ผ่าน Date object เพื่อไม่ให้ TZ ของเครื่องมายุ่ง */
function isoShift(iso, days) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/* แก้ไขได้เมื่อ = ใบของวันนี้ (หรืออนาคต) หรือ ใบเก่าที่กดปลดล็อกไว้
   กติกาเดียวกับ trigger ฝั่ง DB เป๊ะ ๆ — ถ้าสองฝั่งไม่ตรงกัน หน้าเว็บจะให้พิมพ์ได้
   แล้วค่อยเด้ง error ตอนบันทึก ซึ่งผู้ใช้จะไม่รู้ว่าพิมพ์ไปแล้วหายไปไหน */
const isEditable = () =>
  !!state.session && (state.session.check_date >= todayISO() || state.session.edit_unlocked === true);
const isLocked = () => !!state.session && !isEditable();

/* ── supabase ── */
async function sbFetch(path, opts = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    const err = new Error(`${opts.method || "GET"} ${path} → ${res.status}: ${body}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return res;
}

async function sbJson(path, opts) {
  const res = await sbFetch(path, opts);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/* Supabase ตอบสูงสุด 1000 แถว/ครั้ง — ใบตรวจนับ + stock_movements เกินได้ง่าย */
async function sbFetchAll(path, page = 1000, max = 60000) {
  const all = [];
  for (let from = 0; from < max; from += page) {
    const res = await sbFetch(path, { headers: { Range: `${from}-${from + page - 1}` } });
    const chunk = await res.json();
    all.push(...chunk);
    if (chunk.length < page) break;
  }
  return all;
}

/* แถวเดียวกันทุกคีย์ + แบ่งก้อน — ใช้ทั้ง insert ใหม่และ bulk update (on_conflict=id) */
function toPayload(line) {
  const row = {};
  LINE_COLS.forEach((k) => {
    if (k === "id" && (line.id === undefined || line.id === null)) return;
    row[k] = line[k] === undefined ? null : line[k];
  });
  return row;
}

async function bulkUpsertLines(lines, { chunk = 200 } = {}) {
  const out = [];
  for (let i = 0; i < lines.length; i += chunk) {
    const body = lines.slice(i, i + chunk).map(toPayload);
    /* คีย์ต้องตรงกันทุกแถวใน 1 request — toPayload คุมให้แล้ว
       ยกเว้นแถวใหม่ที่ไม่มี id → แยก request ไม่ปนกับแถวที่มี id */
    const withId = body.filter((r) => r.id != null);
    const noId = body.filter((r) => r.id == null);
    if (withId.length) {
      out.push(...(await sbJson("stock_check_lines?on_conflict=id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(withId),
      }) || []));
    }
    if (noId.length) {
      out.push(...(await sbJson("stock_check_lines", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(noId),
      }) || []));
    }
  }
  return out;
}

/* ============================================================
   คำนวณ — สูตรคอลัมน์ F / J / L / M
   ============================================================ */
const isCounted = (l) =>
  (l.qty_box !== null && l.qty_box !== undefined) ||
  (l.qty_piece !== null && l.qty_piece !== undefined);

/* F = ลัง × ตัวคูณ + ชิ้น */
function calcTotal(l) {
  return (Number(l.qty_box) || 0) * (Number(l.pieces_per_box) || 1) + (Number(l.qty_piece) || 0);
}

/* J = (F + ยืม + เบิก) − ยอดในระบบ · ยังไม่นับ = null (ไม่ใช่ 0) */
function calcVariance(l) {
  if (!isCounted(l)) return null;
  return calcTotal(l) + (Number(l.qty_borrow) || 0) + (Number(l.qty_issue) || 0) - (Number(l.qty_system) || 0);
}

/* L — ของหาย / ของเกิน / ตรงกัน */
function alertText(v) {
  if (v === null || v === undefined) return { cls: "sc-badge-none", text: "ยังไม่นับ" };
  if (v > 0) return { cls: "sc-badge-over", text: `ของเกิน ${fmtQty(v)} ชิ้น` };
  if (v < 0) return { cls: "sc-badge-short", text: `ของหาย ${fmtQty(-v)} ชิ้น` };
  return { cls: "sc-badge-match", text: "ตรงกัน" };
}

/* M — ใกล้หมดแล้ว (เทียบยอดที่นับได้จริงกับเกณฑ์ของรอบ) */
function isLowStock(l) {
  if (!isCounted(l)) return false;
  const th = Number(state.session?.low_stock_threshold);
  if (!isFinite(th)) return false;
  return calcTotal(l) < th;
}

/* ── สีพื้นแถวตามหมวดหมู่ ────────────────────────────────
   ไล่สีตามลำดับหมวดที่เรียงแล้ว (ไม่ใช่ hash ชื่อ) เพื่อให้แต่ละหมวดได้คนละสีแน่นอน
   — hash ชื่อจะชนสีกันเองได้ง่ายมากเมื่อมีหมวดอยู่ไม่กี่อัน
   แลกกับว่าถ้าเพิ่มหมวดใหม่ สีของหมวดอื่นจะขยับ ซึ่งยอมรับได้ เพราะสีนี้เป็นแค่
   ตัวช่วยแบ่งกลุ่มด้วยสายตา ไม่ได้สื่อความหมายตายตัวเหมือนสีสถานะ */
const CAT_TINT_COUNT = 6;

function buildCatTints() {
  const names = new Set();
  state.items.forEach((it) => it.category && names.add(norm(it.category)));
  state.lines.forEach((l) => l.category_name && names.add(norm(l.category_name)));
  const sorted = [...names].sort((a, b) => a.localeCompare(b, "th"));
  state.catTint = new Map(sorted.map((n, i) => [n, i % CAT_TINT_COUNT]));
}

function catClass(name) {
  const i = state.catTint?.get(norm(name));
  return i === undefined ? "" : ` sc-cat-${i}`;
}

function rowStatus(l) {
  if (!isCounted(l)) return "uncounted";
  const v = calcVariance(l);
  if (v > 0) return "over";
  if (v < 0) return "short";
  return "match";
}

/* ============================================================
   INIT
   ============================================================ */
async function init() {
  if (!SB_URL || !SB_KEY) return toast("ยังไม่ได้เชื่อมต่อ Supabase", "error");
  state.date = todayISO();
  $("scDate").value = state.date;
  bindEvents();
  showLoading(true);
  try {
    /* ต้องรู้คลังก่อนเสมอ — loadWarehouses() วาดป้ายชื่อคลังจากค่านี้
       และ loadDay() ใช้มันหาใบ ถ้ายิงขนานกันจะได้ค่าว่างแล้วไปสร้างใบใน "ทุกคลัง" */
    await loadFixedWarehouse();
    await Promise.all([loadWarehouses(), loadCategories(), loadStockItems()]);
    await loadIssues();          // ต้องมาก่อน loadDay — คอลัมน์ "เบิก" ดึงจากตรงนี้
    fillIssueControls();
    renderIssues();
    await loadDay();
  } catch (e) {
    console.error(e);
    toast(explainError(e), "error");
  }
  showLoading(false);

  /* ?items=1 — หน้าเบิก/หน้ายืม-คืน ส่งมาเพื่อเปิดโมดัลรายการสินค้ากลางทันที
     (2 หน้านั้นแก้ master เองไม่ได้แล้ว ต้องเด้งมาที่นี่) */
  if (new URLSearchParams(location.search).get("items") === "1") {
    if (can("stock_items_manage")) window.openItemManager();
    else toast("ไม่มีสิทธิ์จัดการรายการสินค้ากลาง", "error");
  }
}

/* ข้อความ error ที่บอกทางแก้ได้จริง — 404 บนตารางใหม่ = ยังไม่ได้รัน migration */
function explainError(e) {
  const msg = String(e?.message || e);
  if (/edit_unlocked/.test(msg) && /42703|does not exist|PGRST204/.test(msg)) {
    return "ยังไม่ได้อัปเดตโครงตาราง — ต้องรัน sql/180_stock_check_daily.sql ใน Supabase ก่อน";
  }
  if (/stock_check_(sessions|lines|report)/.test(msg) && /404|does not exist|PGRST205/.test(msg)) {
    return "ยังไม่มีตารางตรวจนับ — ต้องรัน sql/178_stock_check.sql ใน Supabase ก่อน";
  }
  if (/stock_items/.test(msg) && /404|does not exist|PGRST205/.test(msg)) {
    return "ยังไม่มีตารางรายการสินค้ากลาง — ต้องรัน sql/179_stock_items.sql ใน Supabase ก่อน";
  }
  if (/stock_check_issues/.test(msg) && /404|does not exist|PGRST205/.test(msg)) {
    return "ยังไม่มีตารางเบิกรอเซ็น — ต้องรัน sql/182_stock_check_issues.sql ใน Supabase ก่อน";
  }
  if (/borrow_ledger|borrow_items/.test(msg) && /404|does not exist|PGRST205/.test(msg)) {
    return "ยังไม่มีตารางยืม-คืน — ต้องรัน sql/176_borrow_return.sql ก่อนถึงจะดึงยอดยืมได้";
  }
  if (/withdraw_ledger/.test(msg) && /404|does not exist|PGRST205/.test(msg)) {
    return "ยังไม่มีตารางเบิกสินค้า — ต้องรัน sql/177_withdraw.sql ก่อนถึงจะดึงยอดเบิกได้";
  }
  if (/sign_status/.test(msg) && /42703|does not exist|PGRST204/.test(msg)) {
    return "ยังไม่ได้อัปเดตโครงตารางเบิก — ต้องรัน sql/181_withdraw_sign_status.sql ใน Supabase ก่อน";
  }
  if (/ปิดแล้ว/.test(msg)) return msg.replace(/^.*?: /, "");
  return "ทำรายการไม่สำเร็จ: " + msg.slice(0, 160);
}

async function loadWarehouses() {
  state.warehouses = (await sbJson(
    "warehouses?select=warehouse_id,warehouse_name&is_active=eq.true&order=warehouse_name.asc"
  )) || [];
  const opts = state.warehouses
    .map((w) => `<option value="${w.warehouse_id}">🏭 ${esc(w.warehouse_name)}</option>`)
    .join("");
  const wh = state.warehouses.find((w) => String(w.warehouse_id) === state.warehouseId);
  /* ตั้งค่าชี้ไปคลังที่ถูกลบ/ปิดใช้งาน → บอกให้เห็น ไม่ใช่เงียบแล้วไปสร้างใบใน "ทุกคลัง"
     (ใบจะไปคนละที่กับของเมื่อวาน แล้ว duplicate ก็ไม่เจอต้นแบบ) */
  $("scWarehouse").textContent = state.warehouseId
    ? (wh ? `🏭 ${wh.warehouse_name}` : `⚠️ ไม่พบคลัง id ${state.warehouseId}`)
    : "🏭 ทุกคลัง";
  $("scWarehouse").classList.toggle("sc-wh-missing", !!state.warehouseId && !wh);
}

/* คลังประจำของหน้า — อ่านจาก app_settings (ดูหมายเหตุที่ WH_SETTING_KEY) */
async function loadFixedWarehouse() {
  try {
    const rows = await sbJson(`app_settings?select=value&key=eq.${WH_SETTING_KEY}`);
    const v = String(rows?.[0]?.value ?? "").trim();
    state.warehouseId = /^\d+$/.test(v) ? v : "";
  } catch {
    state.warehouseId = "";   // อ่านไม่ได้ = ใช้ทุกคลัง ดีกว่าค้างหน้าเปล่า
  }
}

async function loadCategories() {
  state.categories = (await sbJson("categories?select=category_id,category_name,icon")) || [];
}

/* master กลาง — โหลดทั้งชุด (เปิด+ปิด) เพราะโมดัลจัดการต้องเห็นตัวที่ปิดใช้งานด้วย
   ส่วนที่เอาไปเติมลงรอบตรวจนับกรอง is_active เอาเองตอนใช้ */
async function loadStockItems() {
  state.items = await sbFetchAll(
    "stock_items?select=*&order=sort_order.asc,item_name.asc"
  );
  /* dropdown สินค้าของแท็บเบิกรอเซ็นกินรายการชุดเดียวกัน — เติมทุกครั้งที่ master เปลี่ยน
     ไม่งั้นเพิ่มสินค้าในโมดัลแล้วยังเลือกไม่ได้จนกว่าจะรีเฟรชหน้า */
  fillIssueControls();
}

/* ============================================================
   ใบตรวจนับรายวัน — 1 วัน = 1 ใบ (ต่อคลัง)
   ============================================================ */
/* PostgREST: warehouse_id เป็น NULL ได้ (= ทุกคลัง) ต้องใช้ is.null ไม่ใช่ eq. */
const whFilter = () =>
  state.warehouseId ? `&warehouse_id=eq.${state.warehouseId}` : "&warehouse_id=is.null";

async function findSession(dateISO) {
  const rows = await sbJson(
    `stock_check_sessions?select=*&check_date=eq.${dateISO}${whFilter()}&limit=1`
  );
  return rows?.[0] || null;
}

/* โหลดใบของวันที่เลือก · ถ้าเป็น "วันนี้" แล้วยังไม่มีใบ → สร้างให้อัตโนมัติ
   วันย้อนหลังที่ไม่มีใบจะไม่สร้างให้ เพราะจะได้ใบที่ duplicate ยอดผิดวันมาแทน
   ของจริงที่ไม่เคยนับ — ปล่อยว่างแล้วบอกตรง ๆ ว่าวันนั้นไม่ได้นับดีกว่า */
async function loadDay() {
  state.session = await findSession(state.date);

  if (!state.session && state.date === todayISO() && can("stock_check_create") && !state.creating) {
    state.creating = true;
    try {
      state.session = await createTodaySheet();
    } catch (e) {
      /* 23505 = ชนกับใบที่อีกแท็บเพิ่งสร้าง (unique index ใน sql/180) → อ่านใบนั้นมาใช้ */
      if (/23505|duplicate key/.test(String(e?.message || e))) state.session = await findSession(state.date);
      else throw e;
    } finally {
      state.creating = false;
    }
  }

  await loadLines();

  /* "ยืม" = ยอดค้างคืน (ยืม − คืน) · "เบิก" = ของที่ออกไปแล้วแต่หลังบ้านยังไม่ตัด (รอเซ็น)
     ทั้งคู่คือยอดสด ๆ จากหน้าอื่น — ดึงให้เองทุกครั้งที่เปิดใบของวันนี้ ไม่ต้องรอคนกดปุ่ม
     เฉพาะใบของวันนี้เท่านั้น: ใบย้อนหลังต้องคงตัวเลข ณ วันนั้นไว้เป็นหลักฐาน
     ถ้าไปดึงทับ ประวัติจะกลายเป็นยอดของวันนี้ทั้งหมด เทียบย้อนหลังไม่ได้อีก */
  if (state.date === todayISO()) {
    await window.pullBorrow({ silent: true });
    await window.pullIssue({ silent: true });
  }
}

/* สร้างใบของวันนี้ แล้วคัดลอกทุกช่องจากใบล่าสุดที่ผ่านมา
   Why duplicate: พนักงานนับซ้ำที่เดิมทุกวัน ของส่วนใหญ่ไม่ขยับ — เริ่มจากใบเปล่า
   ทุกวันแปลว่าต้องพิมพ์ใหม่ทั้ง 28 แถวทุกเย็น
   ⚠️ แลกกับความเสี่ยงที่ต้องรู้: ถ้าวันไหนลืมอัปเดต ใบจะดู "นับครบแล้ว" ทั้งที่ยังไม่ได้นับ
   → แถบหัวตารางบอกไว้ว่าค่าไหนยกมาจากวันไหน */
async function createTodaySheet() {
  const me = currentUser();
  const wh = state.warehouses.find((w) => String(w.warehouse_id) === String(state.warehouseId));

  /* ใบล่าสุดก่อนหน้าวันนี้ (คลังเดียวกัน) — ใช้เป็นทั้งต้นแบบตัวเลขและเกณฑ์ใกล้หมด */
  const prevRows = await sbJson(
    `stock_check_sessions?select=*&check_date=lt.${state.date}${whFilter()}` +
      `&order=check_date.desc,id.desc&limit=1`
  );
  const prev = prevRows?.[0] || null;

  const header = {
    check_date: state.date,
    warehouse_id: state.warehouseId ? Number(state.warehouseId) : null,
    warehouse_name: wh?.warehouse_name || null,
    low_stock_threshold: prev?.low_stock_threshold ?? 50,
    created_by: me?.user_id ?? null,
    created_by_name: me?.full_name || me?.role || null,
  };
  const post = (body) =>
    sbJson("stock_check_sessions", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(body),
    });

  let created;
  try {
    created = (await post(header))?.[0];
  } catch (e) {
    /* created_by ชี้ user ที่ไม่มีอยู่แล้ว (โดนลบทิ้งระหว่างยัง login ค้าง) → 23503
       ปล่อยให้ล้มทั้งใบไม่ได้ เพราะหน้าจะใช้งานไม่ได้เลยทั้งวัน
       ชื่อผู้บันทึกยังเก็บไว้ใน created_by_name ซึ่งเป็น snapshot อยู่แล้ว */
    if (!/23503|foreign key/.test(String(e?.message || e))) throw e;
    created = (await post({ ...header, created_by: null }))?.[0];
  }
  if (!created) throw new Error("สร้างใบตรวจนับของวันนี้ไม่สำเร็จ");

  state.session = created;
  state.lines = [];

  let copied = 0;
  if (prev) copied = await copyLinesFrom(prev.id, created.id);
  const added = await fillSessionProducts(created);   // สินค้าที่เพิ่มใน master หลังใบล่าสุด

  toast(
    copied
      ? `สร้างใบของวันนี้แล้ว — ยกค่าจาก ${fmtDate(prev.check_date)} มา ${copied} รายการ` +
          (added ? ` · สินค้าใหม่อีก ${added} รายการ` : "")
      : `สร้างใบของวันนี้แล้ว — เติมสินค้า ${added} รายการ`
  );
  return created;
}

/* คัดลอกบรรทัดทั้งหมดจากใบก่อนหน้า รวมตัวเลขที่กรอกไว้ทุกช่อง + หมายเหตุ */
async function copyLinesFrom(fromSessionId, toSessionId) {
  const src = await sbFetchAll(
    `stock_check_lines?select=*&session_id=eq.${fromSessionId}&order=sort_order.asc,id.asc`
  );
  if (!src.length) return 0;

  const rows = src.map((l) => ({
    session_id: toSessionId,
    item_id: l.item_id,
    product_id: l.product_id,
    product_code: l.product_code,
    product_name: l.product_name,
    category_name: l.category_name,
    box_unit_name: l.box_unit_name,
    pieces_per_box: l.pieces_per_box,
    qty_box: l.qty_box,
    qty_piece: l.qty_piece,
    qty_borrow: l.qty_borrow,
    qty_issue: l.qty_issue,
    qty_system: l.qty_system,
    note: l.note,
    sort_order: l.sort_order,
    /* ยกมาแล้วถือเป็นค่าที่คนดูแลเอง ไม่ใช่ค่าที่ระบบเพิ่งดึงมา — ตั้ง manual ให้หมด
       ไม่งั้นช่องจะขึ้นสีเทา "ระบบดึงให้" ทั้งที่จริงเป็นเลขของเมื่อวาน */
    borrow_source: "manual",
    issue_source: "manual",
    system_source: "manual",
  }));
  /* ต้องอัปเดต state.lines ด้วย — fillSessionProducts() ที่เรียกต่อจากนี้ใช้ state.lines
     ตัดสินว่าสินค้าตัวไหน "มีในใบแล้ว" ถ้าไม่อัปเดตมันจะเติมทับทุกตัวที่เพิ่ง copy มา
     แล้วชนกับ unique index (session_id, item_id) → สร้างใบของวันนี้ล้มทั้งใบ */
  state.lines = (await bulkUpsertLines(rows)) || [];
  return rows.length;
}

window.shiftDate = async function (delta) {
  const next = delta === 0 ? todayISO() : isoShift(state.date, delta);
  if (next > todayISO()) return toast("ยังไปวันในอนาคตไม่ได้", "warning");
  state.date = next;
  $("scDate").value = next;
  showLoading(true);
  try { await loadDay(); } catch (e) { toast(explainError(e), "error"); }
  showLoading(false);
};

async function loadLines() {
  if (!state.session) { state.lines = []; return renderAll(); }
  state.lines = await sbFetchAll(
    `stock_check_lines?select=*&session_id=eq.${state.session.id}&order=sort_order.asc,id.asc`
  );
  state.selected.clear();
  renderAll();
}

window.reloadAll = async function () {
  showLoading(true);
  try { await loadStockItems(); await loadDay(); } catch (e) { toast(explainError(e), "error"); }
  showLoading(false);
};

/* ============================================================
   RENDER
   ============================================================ */
function renderAll() {
  renderSessionMeta();
  renderSheetTitle();
  buildCatTints();
  renderTable();
  renderStats();
  applyPerms(document);
}

/* แถบหัวเรื่องวันที่ — "วันที่ 3 สิงหาคม 2569 · คลัง กทม. ชั้น3"
   รูปแบบเดียวกับหัวชีทของหน้า Daily Sale (ds-sheet-title) เพื่อให้ 2 หน้าที่ทำงานราย
   วันเหมือนกันอ่านออกแบบเดียวกัน · ปี พ.ศ. เพราะเป็นเอกสารที่พิมพ์ออกไปใช้ในออฟฟิศ */
const TH_MONTHS = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
                   "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];

function renderSheetTitle() {
  const el = $("scSheetTitle");
  if (!el) return;
  const [y, m, d] = (state.date || todayISO()).split("-").map(Number);
  const wh = state.warehouses.find((w) => String(w.warehouse_id) === String(state.warehouseId));
  const whName = state.warehouseId ? wh?.warehouse_name || `คลัง #${state.warehouseId}` : "ทุกคลัง";
  const today = state.date === todayISO();

  /* สถานะทั้งหมดอยู่ที่แถบนี้ที่เดียว — ชิปซ้ำใต้แถบเลือกวันถูกเอาออกแล้ว
     (คลังก็มีที่ป้าย 🏭 ด้านซ้าย · สถานะล็อกก็มีที่ปุ่มด้านขวา) */
  const tail = !state.session
    ? " · ไม่ได้นับวันนี้"
    : today
      ? ""
      : isLocked()
        ? " · 🔒 ล็อกแล้ว"
        : " · 🔓 ปลดล็อกให้แก้ไข";

  el.innerHTML =
    `วันที่ ${d} ${TH_MONTHS[m - 1]} ${y + 543}` +
    `<span class="sc-sheet-title-sub"> · คลัง ${esc(whName)}${tail}</span>`;
  /* ใบย้อนหลังเปลี่ยนสีแถบ — เห็นตั้งแต่หัวว่ากำลังดูของเก่า ไม่ใช่ใบวันนี้ */
  el.classList.toggle("sc-sheet-title-past", !today);
}

/* ซิงก์ปุ่ม/ช่องของ "วันที่กำลังดู" ให้ตรงกับ state
   (ไม่ได้วาดชิปสถานะแล้ว — ย้ายไปรวมที่แถบหัวเรื่องวันที่ที่เดียว ไม่ให้บอกซ้ำ 3 ที่) */
function renderSessionMeta() {
  const s = state.session;
  const today = state.date === todayISO();

  document.body.classList.toggle("sc-closed", isLocked());
  $("scDate").value = state.date;
  $("scToday").classList.toggle("active", today);
  $("scNext").disabled = today;            // ห้ามไปวันในอนาคต — ยังไม่ได้นับ ไม่มีอะไรให้ดู

  /* ปุ่มล็อก/ปลดล็อก โผล่เฉพาะใบของวันที่ผ่านมา — ใบของวันนี้แก้ได้อยู่แล้ว
     ถ้าโชว์ทุกวันจะกลายเป็นปุ่มที่กดแล้วไม่เกิดอะไรขึ้น */
  const btnLock = $("btnToggleLock");
  if (btnLock) {
    btnLock.style.display = s && !today ? "" : "none";
    btnLock.textContent = isLocked() ? "🔓 ปลดล็อกแก้ไข" : "🔒 ล็อกกลับ";
  }
  const btnDel = $("btnDeleteSheet");
  if (btnDel) btnDel.style.display = s ? "" : "none";

  $("fltThreshold").value = s ? s.low_stock_threshold ?? 50 : "";
}

/* เดิมเป็นตัวกรอง (ค้นหา/หมวดหมู่/สถานะ) — เจ้าของงานให้เอาออกเพราะไม่ได้ใช้
   คงชื่อฟังก์ชันไว้เพราะมีที่เรียก 6 จุด (ตาราง · ท้ายตาราง · Excel · พิมพ์)
   ถ้าจะเอาตัวกรองกลับ ใส่เงื่อนไขที่นี่ที่เดียวได้เลย */
function visibleLines() {
  return state.lines;
}

/* ยังไม่เปิดรอบ → โชว์รายการสินค้าที่ตั้งค่าไว้แบบพรีวิว (อ่านอย่างเดียว)
   ชีตเดิมมีรายการสินค้ายืนพื้นอยู่ตลอด ตารางว่างเปล่าทำให้ดูเหมือนยังไม่ได้ตั้งค่าอะไรเลย
   ช่องกรอกทุกช่อง disabled — ตัวเลขต้องผูกกับรอบเสมอ ไม่มีที่ให้เก็บถ้ายังไม่เปิดรอบ */
function renderPreview() {
  const body = $("lineBody");
  const rows = state.items.filter((it) => it.is_active !== false);

  $("lineCount").textContent = `${rows.length.toLocaleString("th-TH")} รายการ (ยังไม่เปิดรอบ)`;

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="14" class="sc-empty">${
      state.items.length
        ? "— ไม่พบสินค้าที่ตรงกับคำค้น —"
        : "— ยังไม่มีรายการสินค้า — กด “📦 รายการสินค้า” เพื่อเพิ่ม —"
    }</td></tr>`;
    return renderFooter([]);
  }

  body.innerHTML =
    `<tr class="sc-preview-note"><td colspan="14">
       👀 <strong>วันที่ ${esc(fmtDate(state.date))} ไม่มีใบตรวจนับ</strong> (วันนั้นไม่ได้นับ) —
       นี่คือรายการสินค้าที่ตั้งค่าไว้ ${rows.length.toLocaleString("th-TH")} รายการ ·
       กด <strong>“วันนี้”</strong> เพื่อกลับไปใบที่กรอกได้
     </td></tr>` +
    rows.map((it, i) => {
      const conv = Number(it.pieces_per_box) || 1;
      return `<tr class="sc-row-uncounted sc-row-preview${catClass(it.category)}">
        <td class="sc-col-chk"></td>
        <td class="sc-col-no">${i + 1}</td>
        <td class="sc-col-prod" title="${esc(it.category || "")}">
          <span class="sc-prod-code">${esc(it.item_code || "—")}</span>
          <span class="sc-prod-name">${esc(it.item_name)}</span>
          <span class="sc-conv-chip${conv === 1 ? " sc-conv-default" : ""}"
                title="1 ${esc(it.box_unit_name || "ลัง")} = กี่ชิ้น (ตั้งที่ 📦 รายการสินค้า)">
            1 ${esc(it.box_unit_name || "ลัง")} = ${fmtQty(conv)}
          </span>
        </td>
        <td class="sc-col-in"><input class="sc-cell-input" type="number" placeholder="—" disabled /></td>
        <td class="sc-col-in"><input class="sc-cell-input" type="number" placeholder="—" disabled /></td>
        <td class="sc-col-num sc-td-calc">—</td>
        <td class="sc-col-in sc-td-locked">—</td>
        <td class="sc-col-in sc-td-locked">—</td>
        <td class="sc-col-in sc-td-locked">—</td>
        <td class="sc-col-num sc-td-calc">—</td>
        <td class="sc-col-note"><input class="sc-cell-input sc-cell-text" type="text" placeholder="—" disabled /></td>
        <td class="sc-col-alert"><span class="sc-badge sc-badge-none">ยังไม่นับ</span></td>
        <td class="sc-col-alert2"></td>
        <td class="sc-col-act"></td>
      </tr>`;
    }).join("");

  renderFooter([]);
}

function renderTable() {
  const body = $("lineBody");

  if (!state.session) return renderPreview();

  const rows = visibleLines();
  $("lineCount").textContent = `${rows.length.toLocaleString("th-TH")} รายการ`;

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="14" class="sc-empty">— ไม่มีรายการที่ตรงกับตัวกรอง —</td></tr>`;
    return renderFooter([]);
  }

  const dis = isLocked() ? " disabled" : "";
  body.innerHTML = rows.map((l, i) => {
    const total = calcTotal(l);
    const v = calcVariance(l);
    const al = alertText(v);
    const low = isLowStock(l);
    const st = rowStatus(l);
    const conv = Number(l.pieces_per_box) || 1;

    return `<tr data-id="${l.id}" class="sc-row-${st}${isCounted(l) ? "" : " sc-row-uncounted"}${catClass(l.category_name)}">
      <td class="sc-col-chk">
        <input type="checkbox" class="sc-row-chk" value="${l.id}"
               ${state.selected.has(l.id) ? "checked" : ""} onchange="window.toggleRow(${l.id}, this.checked)" />
      </td>
      <td class="sc-col-no">${i + 1}</td>
      <td class="sc-col-prod" title="${esc(l.category_name || "")}">
        <span class="sc-prod-code">${esc(l.product_code || "—")}</span>
        <span class="sc-prod-name">${esc(l.product_name)}</span>
        <span class="sc-conv-chip${conv === 1 ? " sc-conv-default" : ""}" data-conv="${l.id}"
              title="1 ${esc(l.box_unit_name || "ลัง")} = กี่ชิ้น (คลิกเพื่อแก้)">
          1 ${esc(l.box_unit_name || "ลัง")} = ${fmtQty(conv)}
        </span>
      </td>
      <td class="sc-col-in">${numCell(l.id, "qty_box", l.qty_box, dis)}</td>
      <td class="sc-col-in">${numCell(l.id, "qty_piece", l.qty_piece, dis)}</td>
      <td class="sc-col-num sc-td-calc" data-cell="total">${isCounted(l) ? fmtQty(total) : "—"}</td>
      <td class="sc-col-in sc-td-locked" data-cell="borrow"
          title="ยอดค้างคืนจากหน้ายืม/คืน (ยืม − คืน) — ดึงให้อัตโนมัติ แก้มือไม่ได้">${fmtQty(l.qty_borrow)}</td>
      <td class="sc-col-in sc-td-locked" data-cell="issue"
          title="ของที่เบิกออกไปแล้วแต่ระบบหลังบ้านยังไม่ตัดยอด (สถานะ “รอเซ็น”) — ดึงจากหน้าเบิกสินค้าให้อัตโนมัติ แก้มือไม่ได้">${fmtQty(l.qty_issue)}</td>
      <td class="sc-col-in sc-td-locked" data-cell="system"
          title="${esc(sysCellTitle(l))}">${fmtQty(l.qty_system)}</td>
      <td class="sc-col-num sc-td-calc" data-cell="variance">${v === null ? "—" : fmtQty(v)}</td>
      <td class="sc-col-note">
        <input class="sc-cell-input sc-cell-text" type="text" data-id="${l.id}" data-field="note"
               value="${esc(l.note || "")}" placeholder="—"${dis} />
      </td>
      <td class="sc-col-alert" data-cell="alert"><span class="sc-badge ${al.cls}">${esc(al.text)}</span></td>
      <td class="sc-col-alert2" data-cell="alert2">${low ? `<span class="sc-badge sc-badge-low">ใกล้หมดแล้ว</span>` : ""}</td>
      <td class="sc-col-act">
        <button class="sc-del-btn" data-perm="stock_check_delete" data-perm-mode="hide"
                onclick="window.deleteLine(${l.id})" title="ลบรายการนี้ออกจากรอบ">🗑</button>
      </td>
    </tr>`;
  }).join("");

  renderFooter(rows);
  syncBulkBar();
  /* แถวถูกสร้างใหม่ทุกครั้งที่กรอง → ต้องบังคับสิทธิ์/ล็อกซ้ำ ไม่งั้นปุ่มลบ
     ของคนที่ไม่มีสิทธิ์จะโผล่กลับมาหลังพิมพ์ในช่องค้นหา */
  applyPerms($("lineBody"));
  if (isLocked()) lockInputs();
}

/* "ยอดในระบบ" แก้มือไม่ได้ — เป็นตัวเลขจากระบบหลังบ้าน ต้องมาจากไฟล์เท่านั้น
   Why: เผลอคลิกแล้วพิมพ์ทับทีเดียว ยอดที่อัปโหลดมาหายเงียบ ๆ แล้ว "ผลต่าง" ผิดทั้งแถว
   โดยที่ไม่มีอะไรเตือน (เคยเกิดจริง: Callomag หาย 4 ชิ้นจากยอดที่อัปโหลดมา) */
function sysCellTitle(l) {
  if (l.system_source === "upload") return "มาจากไฟล์ที่อัปโหลด — แก้มือไม่ได้";
  if (l.system_source === "movements") return "คำนวณจากความเคลื่อนไหวสต็อก — แก้มือไม่ได้";
  return "ยังไม่มียอดจากระบบ — กด “📤 อัปโหลดยอดในระบบ” เพื่อลงยอด";
}

function numCell(id, field, value, dis, auto = false) {
  const v = value === null || value === undefined ? "" : value;
  return `<input class="sc-cell-input${auto ? " sc-auto" : ""}" type="number" step="any"
                 data-id="${id}" data-field="${field}" value="${v}" placeholder="—"${dis} />`;
}

function renderFooter(rows) {
  const sum = (f) => rows.reduce((s, l) => s + (Number(l[f]) || 0), 0);
  const totalSum = rows.reduce((s, l) => s + (isCounted(l) ? calcTotal(l) : 0), 0);
  const varSum = rows.reduce((s, l) => s + (calcVariance(l) || 0), 0);
  $("sumTotal").textContent = fmtQty(totalSum);
  $("sumBorrow").textContent = fmtQty(sum("qty_borrow"));
  $("sumIssue").textContent = fmtQty(sum("qty_issue"));
  $("sumSystem").textContent = fmtQty(sum("qty_system"));
  $("sumVariance").textContent = fmtQty(varSum);
}

function renderStats() {
  /* ยังไม่เปิดรอบ → การ์ดใบแรกบอกจำนวนสินค้าที่ตั้งค่าไว้ ไม่ใช่ 0 เปล่า ๆ
     (0 อ่านได้ว่า "ยังไม่ได้ตั้งค่าอะไรเลย" ทั้งที่ master มีของอยู่) */
  if (!state.session) {
    const n = state.items.filter((it) => it.is_active !== false).length;
    $("statTotal").textContent = n.toLocaleString("th-TH");
    $("statCounted").textContent = "สินค้าที่ตั้งค่าไว้ (ยังไม่เปิดรอบ)";
    ["statMatch", "statShort", "statOver", "statLow"].forEach((id) => ($(id).textContent = "0"));
    $("statMatchSub").textContent = "ยังไม่ได้นับ";
    $("statShortSub").textContent = "รวม 0 ชิ้น";
    $("statOverSub").textContent = "รวม 0 ชิ้น";
    $("statLowSub").textContent = "ต่ำกว่าเกณฑ์ 50 ชิ้น";
    return;
  }

  const ls = state.lines;
  const counted = ls.filter(isCounted);
  const short = counted.filter((l) => calcVariance(l) < 0);
  const over = counted.filter((l) => calcVariance(l) > 0);
  const match = counted.filter((l) => calcVariance(l) === 0);
  const low = counted.filter(isLowStock);

  $("statTotal").textContent = ls.length.toLocaleString("th-TH");
  $("statCounted").textContent = `นับแล้ว ${counted.length.toLocaleString("th-TH")} รายการ`;
  $("statMatch").textContent = match.length.toLocaleString("th-TH");
  $("statMatchSub").textContent = counted.length
    ? `${Math.round((match.length / counted.length) * 100)}% ของที่นับแล้ว`
    : "ยังไม่ได้นับ";
  $("statShort").textContent = short.length.toLocaleString("th-TH");
  $("statShortSub").textContent = `รวม ${fmtQty(short.reduce((s, l) => s - calcVariance(l), 0))} ชิ้น`;
  $("statOver").textContent = over.length.toLocaleString("th-TH");
  $("statOverSub").textContent = `รวม ${fmtQty(over.reduce((s, l) => s + calcVariance(l), 0))} ชิ้น`;
  $("statLow").textContent = low.length.toLocaleString("th-TH");
  $("statLowSub").textContent = `ต่ำกว่าเกณฑ์ ${fmtQty(state.session?.low_stock_threshold ?? 50)} ชิ้น`;
}

function lockInputs() {
  document.querySelectorAll("#lineBody .sc-cell-input").forEach((el) => (el.disabled = true));
}

/* ============================================================
   แก้ไขในตาราง + autosave
   ============================================================ */
function bindEvents() {
  /* เลือกวันจากปฏิทิน — กันเลือกวันอนาคตไว้ที่นี่ด้วย ไม่ใช่แค่ปุ่ม › */
  $("scDate").addEventListener("change", async (e) => {
    const v = e.target.value;
    if (!v) { e.target.value = state.date; return; }
    if (v > todayISO()) { toast("ยังไปวันในอนาคตไม่ได้", "warning"); e.target.value = state.date; return; }
    state.date = v;
    showLoading(true);
    try { await loadDay(); } catch (err) { toast(explainError(err), "error"); }
    showLoading(false);
  });

  /* แท็บเบิกรอเซ็น */
  if ($("iaDate")) $("iaDate").value = todayISO();
  $("issueSearch")?.addEventListener("input", renderIssues);
  /* Enter ในช่องจำนวน = กด "＋ เพิ่ม" — คนกรอกชีตชินกับการพิมพ์รวดเดียวไม่จับเมาส์ */
  $("iaQty")?.addEventListener("keydown", (e) => { if (e.key === "Enter") window.addIssue(); });

  $("fltThreshold").addEventListener("change", saveThreshold);

  /* แก้เซลล์ในตาราง — delegate เพราะแถวถูก re-render บ่อย */
  const body = $("lineBody");
  body.addEventListener("input", onCellInput);
  body.addEventListener("click", onCellClick);

  /* ── ลากไฟล์มาวางที่ไหนก็ได้ในการ์ดใบตรวจนับ ──
     ต้อง preventDefault ทั้ง dragover และ drop ไม่งั้นเบราว์เซอร์จะเปิดไฟล์นั้นทับหน้าเว็บ
     ใช้ตัวนับ depth เพราะ dragleave ยิงตอนลากผ่านลูก ๆ ทุกตัว
     ถ้าซ่อนป้ายทันทีที่ dragleave ป้ายจะกะพริบทั้งตอนลาก */
  const card = $("scCard");
  const overlay = $("upDropOverlay");
  let depth = 0;
  const showOverlay = (on) => overlay.classList.toggle("open", on);
  const hasFile = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");

  card.addEventListener("dragenter", (e) => {
    if (!hasFile(e)) return;
    e.preventDefault(); depth++; showOverlay(true);
  });
  card.addEventListener("dragover", (e) => { if (hasFile(e)) e.preventDefault(); });
  card.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; showOverlay(false); } });
  card.addEventListener("drop", (e) => {
    if (!hasFile(e)) return;
    e.preventDefault(); depth = 0; showOverlay(false);
    handleUploadFile(e.dataTransfer.files?.[0]);
  });
  /* ลากออกนอกหน้าต่างไปเลย — dragleave ของการ์ดอาจไม่ยิง ป้ายจะค้าง */
  window.addEventListener("dragend", () => { depth = 0; showOverlay(false); });

  /* คลิกที่ป้าย = เลือกไฟล์เอง (label ครอบ input ไว้) · ตั้ง value="" ให้เลือกไฟล์เดิมซ้ำได้ */
  $("upQuickFile").addEventListener("change", (e) => {
    handleUploadFile(e.target.files?.[0]);
    e.target.value = "";
  });

  $("upKeyCol").addEventListener("change", renderUploadPreview);
  $("upQtyCol").addEventListener("change", renderUploadPreview);
  $("upBranch").addEventListener("change", renderUploadPreview);

  /* โมดัลรายการสินค้ากลาง */
  $("imSearch").addEventListener("input", renderItemManager);
  $("imShowInactive").addEventListener("change", renderItemManager);
  $("imShowPrice").addEventListener("change", applyPriceVisibility);
  /* Enter ในแถวเพิ่มใหม่ = กด "＋ เพิ่ม" (พิมพ์รวดเดียวหลายตัวโดยไม่ต้องละมือไปคลิก) */
  Object.values(IM_NEW_IDS).forEach((id) => {
    $(id).addEventListener("keydown", (e) => { if (e.key === "Enter") window.addItem(); });
  });

  /* ดักการปิดโมดัลที่ "ตัว class" ไม่ใช่ที่ปุ่ม — modalManager.js ปิดด้วย ESC โดยลบ
     class .open ออกตรง ๆ ไม่ได้เรียก closeItemManager() ถ้าไปผูกกับปุ่มอย่างเดียว
     กด ESC แล้วตารางจะค้างข้อมูลเก่า */
  const modal = $("itemModal");
  new MutationObserver(() => {
    if (!modal.classList.contains("open") && state.itemsDirty) refreshItemsEverywhere();
  }).observe(modal, { attributes: true, attributeFilter: ["class"] });
}

function onCellInput(e) {
  const el = e.target;
  if (!el.classList.contains("sc-cell-input")) return;
  const id = Number(el.dataset.id);
  const field = el.dataset.field;
  const line = state.lines.find((l) => l.id === id);
  if (!line) return;

  if (field === "note") {
    line.note = el.value;
  } else {
    const raw = el.value.trim();
    if (raw === "") {
      /* ลัง/ชิ้น ว่าง = ยังไม่นับ (null) · ยืม/เบิก/ระบบ เป็น NOT NULL → 0 */
      line[field] = field === "qty_box" || field === "qty_piece" ? null : 0;
    } else {
      const n = Number(raw);
      if (!isFinite(n)) return;
      line[field] = n;
    }
    /* ไม่มี qty_borrow / qty_issue / qty_system ตรงนี้ — 3 ช่องนั้นอ่านอย่างเดียว
       ค่ามาจากหน้าอื่น และถูกดึงทับทุกครั้งที่เปิดใบของวันนี้ */
    /* ไม่มี qty_system ตรงนี้ — ช่องนั้นเป็นข้อความอ่านอย่างเดียว (ดู sysCellTitle) */
  }

  refreshRow(line);
  renderFooter(visibleLines());
  renderStats();
  queueSave(line, field);
}

/* อัปเดตเฉพาะเซลล์สูตร/ป้ายของแถวนั้น — re-render ทั้งตารางจะทำให้ช่องที่พิมพ์อยู่หลุด focus */
function refreshRow(line) {
  const tr = document.querySelector(`#lineBody tr[data-id="${line.id}"]`);
  if (!tr) return;
  const v = calcVariance(line);
  const al = alertText(v);
  tr.querySelector('[data-cell="total"]').textContent = isCounted(line) ? fmtQty(calcTotal(line)) : "—";
  tr.querySelector('[data-cell="variance"]').textContent = v === null ? "—" : fmtQty(v);
  tr.querySelector('[data-cell="alert"]').innerHTML = `<span class="sc-badge ${al.cls}">${esc(al.text)}</span>`;
  tr.querySelector('[data-cell="alert2"]').innerHTML = isLowStock(line)
    ? `<span class="sc-badge sc-badge-low">ใกล้หมดแล้ว</span>` : "";
  /* ต้องต่อ catClass ด้วย — ตรงนี้เขียนทับ className ทั้งก้อน ถ้าลืมสีหมวดจะหายทันที
     ที่พิมพ์เลขลงแถวนั้น (แถวอื่นยังมีสีอยู่ กลายเป็นสีหายเป็นแถว ๆ) */
  tr.className = `sc-row-${rowStatus(line)}${isCounted(line) ? "" : " sc-row-uncounted"}${catClass(line.category_name)}`;
}

function queueSave(line, field) {
  clearTimeout(state.saveTimers.get(line.id));
  setSaveFlag("saving");
  state.saveTimers.set(line.id, setTimeout(() => saveLine(line, field), 700));
}

async function saveLine(line, field) {
  state.saveTimers.delete(line.id);
  state.pendingSaves++;
  const patch = { [field]: line[field] };
  if (field === "qty_borrow") patch.borrow_source = "manual";
  if (field === "qty_issue") patch.issue_source = "manual";
  if (field === "qty_system") patch.system_source = "manual";
  if (field === "qty_box" || field === "qty_piece") {
    const me = currentUser();
    patch.counted_by = me?.user_id ?? null;
    patch.counted_by_name = me?.full_name || me?.role || null;
    patch.counted_at = new Date().toISOString();
  }

  try {
    const rows = await sbJson(`stock_check_lines?id=eq.${line.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(patch),
    });
    /* รับ total_pieces / variance ที่ฐานข้อมูลคำนวณกลับมาทับ —
       ถ้าสูตร 2 ฝั่งไม่ตรง จะเห็นตัวเลขกระตุกทันที ดีกว่าเพี้ยนเงียบ ๆ */
    if (rows && rows[0]) Object.assign(line, rows[0]);
    setSaveFlag("saved");
  } catch (e) {
    console.error(e);
    setSaveFlag("failed");
    toast(explainError(e), "error");
  } finally {
    state.pendingSaves--;
  }
}

function setSaveFlag(kind) {
  const el = $("saveFlag");
  if (!el) return;
  if (kind === "saving") { el.className = "sc-save-flag sc-saving"; el.textContent = "กำลังบันทึก…"; return; }
  if (kind === "failed") { el.className = "sc-save-flag sc-failed"; el.textContent = "บันทึกไม่สำเร็จ"; return; }
  el.className = "sc-save-flag sc-saved";
  el.textContent = "✓ บันทึกแล้ว";
  setTimeout(() => { if (el.textContent === "✓ บันทึกแล้ว") el.textContent = ""; }, 2500);
}

/* คลิกป้ายตัวคูณ → แก้ตัวคูณลัง→ชิ้น ของบรรทัดนั้นในที่ (ไม่เด้ง popup) */
function onCellClick(e) {
  const chip = e.target.closest(".sc-conv-chip");
  if (!chip || isLocked()) return;
  const id = Number(chip.dataset.conv);
  const line = state.lines.find((l) => l.id === id);
  if (!line) return;

  const input = document.createElement("input");
  input.type = "number";
  input.min = "0.01";
  input.step = "any";
  input.className = "sc-cell-input";
  input.style.width = "70px";
  input.value = Number(line.pieces_per_box) || 1;
  chip.replaceWith(input);
  input.focus();
  input.select();

  const commit = async () => {
    const n = Number(input.value);
    if (isFinite(n) && n > 0 && n !== Number(line.pieces_per_box)) {
      line.pieces_per_box = n;
      try {
        const rows = await sbJson(`stock_check_lines?id=eq.${line.id}`, {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ pieces_per_box: n }),
        });
        if (rows && rows[0]) Object.assign(line, rows[0]);
        setSaveFlag("saved");
      } catch (err) { toast(explainError(err), "error"); }
    }
    renderTable();
    renderStats();
  };
  input.addEventListener("blur", commit, { once: true });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") input.blur();
    if (ev.key === "Escape") { input.removeEventListener("blur", commit); renderTable(); }
  });
}

async function saveThreshold() {
  if (!state.session) return;
  const n = Number(val("fltThreshold"));
  if (!isFinite(n) || n < 0) return renderSessionMeta();
  try {
    await sbFetch(`stock_check_sessions?id=eq.${state.session.id}`, {
      method: "PATCH",
      body: JSON.stringify({ low_stock_threshold: n }),
    });
    state.session.low_stock_threshold = n;
    renderTable();
    renderStats();
    toast(`ตั้งเกณฑ์ใกล้หมดเป็น ${fmtQty(n)} ชิ้นแล้ว`);
  } catch (e) { toast(explainError(e), "error"); }
}

/* ============================================================
   ใบตรวจนับ — เติมสินค้า / ล็อก-ปลดล็อก / ลบ
   ============================================================ */
/* ดึงสินค้าที่ยังไม่มีในรอบ มาเป็นบรรทัดใหม่ — ใช้ทั้งตอนเปิดรอบและปุ่ม "เติมสินค้าเข้ารอบ"
   แหล่งคือ stock_items (master กลาง · sql/179) ไม่ใช่ catalog products แล้ว
   → ตัวคูณลังมาจากคอลัมน์เดียวตรง ๆ ไม่ต้องเดาจาก product_units อีก
   และรหัส/ชื่อที่ลงบรรทัดจะตรงกับที่หน้าเบิก/หน้ายืม-คืน ใช้เป๊ะ ๆ (จับคู่ด้วย item_id ได้) */
async function fillSessionProducts(session) {
  /* โหลดสดทุกครั้ง — ผู้ใช้อาจเพิ่งเพิ่มสินค้าในโมดัลจัดการก่อนกดปุ่มนี้ */
  await loadStockItems();
  const items = state.items.filter((it) => it.is_active !== false);

  const existing = new Set(state.lines.filter((l) => l.item_id != null).map((l) => l.item_id));
  let order = state.lines.reduce((m, l) => Math.max(m, Number(l.sort_order) || 0), 0);

  const newLines = items
    .filter((it) => !existing.has(it.id))
    .map((it) => ({
      session_id: session.id,
      item_id: it.id,
      /* ผูก catalog ไว้ด้วยถ้ามี — คอลัมน์นี้คือสิ่งเดียวที่ทำให้ "ดึงยอดในระบบ" ทำงานได้ */
      product_id: it.product_id ?? null,
      product_code: it.item_code || null,
      product_name: it.item_name || "(ไม่มีชื่อ)",
      category_name: it.category || null,
      box_unit_name: it.box_unit_name || "ลัง",
      pieces_per_box: Number(it.pieces_per_box) > 0 ? Number(it.pieces_per_box) : 1,
      qty_box: null,
      qty_piece: null,
      qty_borrow: 0,
      qty_issue: 0,
      qty_system: 0,
      note: null,
      sort_order: ++order,
      borrow_source: "manual",
      issue_source: "manual",
      system_source: "manual",
    }));

  if (!newLines.length) return 0;
  await bulkUpsertLines(newLines);
  return newLines.length;
}

window.addProductsToSession = async function () {
  if (!state.session) return toast("ไม่มีใบตรวจนับของวันที่เลือก", "error");
  if (isLocked()) return toast("ใบนี้ถูกล็อกแล้ว — กด “ปลดล็อกแก้ไข” ก่อนถึงจะเพิ่มรายการได้", "error");
  showLoading(true);
  try {
    const n = await fillSessionProducts(state.session);
    await loadLines();
    toast(n ? `เพิ่มสินค้า ${n.toLocaleString("th-TH")} รายการ` : "ไม่มีสินค้าใหม่ที่ยังไม่อยู่ในรอบนี้",
      n ? "success" : "warning");
  } catch (e) { toast(explainError(e), "error"); }
  showLoading(false);
};

window.toggleLock = async function () {
  if (!state.session) return;
  const unlocking = isLocked();
  const ok = await ConfirmModal.open({
    title: unlocking ? "ปลดล็อกใบย้อนหลัง?" : "ล็อกกลับ?",
    message: unlocking
      ? `เปิดให้แก้ตัวเลขของใบวันที่ ${fmtDate(state.session.check_date)} ได้อีกครั้ง`
      : `ล็อกใบวันที่ ${fmtDate(state.session.check_date)} กลับเป็นอ่านอย่างเดียว`,
    note: unlocking
      ? "ใบของวันที่ผ่านมาเป็นหลักฐานที่ใช้เทียบย้อนหลัง — แก้แล้วตัวเลขเดิมไม่เหลือ"
      : undefined,
    icon: unlocking ? "🔓" : "🔒",
  });
  if (!ok) return;

  showLoading(true);
  try {
    await sbFetch(`stock_check_sessions?id=eq.${state.session.id}`, {
      method: "PATCH",
      body: JSON.stringify({ edit_unlocked: unlocking }),
    });
    toast(unlocking ? "ปลดล็อกให้แก้ไขได้แล้ว" : "ล็อกกลับแล้ว");
    await loadDay();
  } catch (e) { toast(explainError(e), "error"); }
  showLoading(false);
};

window.deleteSession = async function () {
  if (!state.session) return;
  const ok = await ConfirmModal.open({
    title: "ลบใบตรวจนับของวันนี้?",
    message: `ลบใบวันที่ ${fmtDate(state.session.check_date)} (${esc(state.session.warehouse_name || "ทุกคลัง")}) ` +
      `พร้อมรายการทั้งหมด ${state.lines.length.toLocaleString("th-TH")} รายการ — กู้คืนไม่ได้`,
    note: state.date === todayISO()
      ? "ลบแล้วหน้านี้จะสร้างใบใหม่ให้ทันที โดยยกค่าจากใบล่าสุดมาอีกรอบ (= ล้างสิ่งที่นับวันนี้ทิ้ง)"
      : undefined,
    icon: "🗑",
    tone: "danger",
  });
  if (!ok) return;
  showLoading(true);
  try {
    /* ใบที่ล็อกอยู่ → trigger กันลบบรรทัด ต้องปลดล็อกก่อนแล้วค่อยลบทั้งหัวใบ */
    if (isLocked()) {
      await sbFetch(`stock_check_sessions?id=eq.${state.session.id}`, {
        method: "PATCH", body: JSON.stringify({ edit_unlocked: true }),
      });
    }
    await sbFetch(`stock_check_sessions?id=eq.${state.session.id}`, { method: "DELETE" });
    state.session = null;
    state.lines = [];
    await loadDay();
    toast("ลบใบตรวจนับแล้ว");
  } catch (e) { toast(explainError(e), "error"); }
  showLoading(false);
};

/* ============================================================
   ดึงข้อมูลเข้าคอลัมน์ ยืม / เบิก / ยอดในระบบ
   ============================================================ */
function guardEditable() {
  if (!state.session) { toast("ไม่มีใบตรวจนับของวันที่เลือก", "error"); return false; }
  if (isLocked()) { toast("ใบนี้ถูกล็อกแล้ว — กด “ปลดล็อกแก้ไข” ก่อนถึงจะแก้ตัวเลขได้", "error"); return false; }
  if (!state.lines.length) { toast("ยังไม่มีรายการในรอบนี้", "error"); return false; }
  return true;
}

/* จับคู่ค่าที่ดึงมากับบรรทัด
   ลำดับความน่าเชื่อ: item_id (master กลางเดียวกัน — ตรงแน่นอน) → รหัส → ชื่อ
   รหัส/ชื่อยังต้องมีไว้ เพราะบรรทัดที่พิมพ์เองล้วนหรือรายการเก่าก่อน sql/179
   จะไม่มี item_id ให้จับ */
function buildLineIndex() {
  const byItem = new Map(), byCode = new Map(), byName = new Map(), byPid = new Map();
  state.lines.forEach((l) => {
    if (l.item_id != null) byItem.set(String(l.item_id), l);
    if (l.product_id != null) byPid.set(String(l.product_id), l);
    if (l.product_code) byCode.set(norm(l.product_code), l);
    if (l.product_name) byName.set(norm(l.product_name), l);
  });
  return { byItem, byCode, byName, byPid };
}

/* opts.silent = ดึงเงียบ ๆ ตอนเปิดใบของวันนี้ (ไม่เด้ง toast / ไม่ขึ้น spinner)
   คลิกจากปุ่มจะส่ง PointerEvent มาเป็น arg แรก — เช็ค === true จึงปลอดภัย */
window.pullBorrow = async function (opts) {
  const silent = opts?.silent === true;
  if (silent) {
    /* เงียบ = ทำเฉพาะใบที่แก้ได้และมีบรรทัดแล้ว ไม่ต้องเด้ง error ให้รำคาญ */
    if (!state.session || isLocked() || !state.lines.length) return;
  } else if (!guardEditable()) return;

  if (!silent) showLoading(true);
  try {
    /* borrow_ledger พ่วง item_code จาก stock_items มาให้แล้ว (sql/179)
       — หน้ายืม/คืน ใช้ master ตัวเดียวกับใบตรวจนับ จึงจับคู่ด้วย item_id ได้ตรง ๆ */
    const ledger = await sbFetchAll(
      "borrow_ledger?select=line_id,item_id,item_code,item_name,txn_type,qty&order=line_id.asc"
    );

    /* คงเหลือค้างคืน = ยืม − คืน (ยอดที่ยังอยู่นอกชั้น จึงต้องบวกกลับตอนเทียบยอดระบบ)
       รวมยอดต่อ "ตัวสินค้า" 1 ตัวก่อน แล้วค่อยหาว่าตรงกับบรรทัดไหนในใบตรวจนับ
       — ถ้าไปจับคู่ทีละ key (รหัส/ชื่อ) แยกกัน สินค้าตัวเดียวที่รหัสไปตรงสินค้า A
       แต่ชื่อไปตรงสินค้า B จะถูกลงยอดให้ทั้งคู่ */
    const outstanding = new Map();   // item_id (หรือชื่อ ถ้า item ถูกลบ) → {qty, id, code, name}
    ledger.forEach((r) => {
      const key = r.item_id != null ? "id:" + r.item_id : "n:" + norm(r.item_name);
      const cur = outstanding.get(key) || {
        qty: 0,
        id: r.item_id ?? null,
        code: r.item_code || null,
        name: r.item_name,
      };
      cur.qty += (r.txn_type === "return" ? -1 : 1) * (Number(r.qty) || 0);
      outstanding.set(key, cur);
    });

    const idx = buildLineIndex();
    const qtyByLine = new Map();
    outstanding.forEach((v) => {
      if (v.qty <= 0) return;
      /* item_id แน่นอนที่สุด → รหัส → ชื่อ (ชื่อซ้ำกันได้ จึงไว้ท้ายสุด) */
      const line =
        (v.id != null && idx.byItem.get(String(v.id))) ||
        (v.code && idx.byCode.get(norm(v.code))) ||
        idx.byName.get(norm(v.name));
      if (!line) return;
      /* สินค้าในชีตยืม-คืนหลายตัวอาจชี้สินค้าตัวเดียวกันในคลัง → รวมยอด */
      qtyByLine.set(line.id, (qtyByLine.get(line.id) || 0) + v.qty);
    });
    const matched = qtyByLine.size;

    const n = await applyPulled(qtyByLine, "qty_borrow", "borrow_source", "borrow_ledger", { zeroUnmatched: true });
    renderAll();
    if (!silent) {
      toast(matched
        ? `ดึงยอดยืมแล้ว — จับคู่ได้ ${matched} รายการ · อัปเดต ${n} บรรทัด`
        : "ไม่พบรายการยืมค้างที่จับคู่กับสินค้าในรอบนี้ได้", matched ? "success" : "warning");
    }
  } catch (e) {
    console.error(e);
    if (!silent) toast(explainError(e), "error");
  }
  if (!silent) showLoading(false);
};

/* ============================================================
   แท็บ "เบิกรอเซ็น"  (stock_check_issues · sql/182)
   แทนชีต `เบิกรอเซ็น` ที่อยู่ในเล่มเดียวกับ Stock F.3

   🔴 ทุกแถวในตารางนี้ = "ยังรอเซ็น" เสมอ — ไม่มีคอลัมน์สถานะ
      เซ็นอนุมัติแล้ว = ลบแถวทิ้ง (ตามที่ชีตเดิมทำ และเจ้าของงานยืนยัน)
      → มีแถวอยู่ = คอลัมน์ "เบิก" ต้องบวกกลับ · ลบแถว = ยอดหลุดออกเอง
   ============================================================ */
window.switchScTab = function (tab) {
  document.querySelectorAll("#scTabs .page-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
  $("scPaneCount").style.display = tab === "count" ? "" : "none";
  $("scPaneIssue").style.display = tab === "issue" ? "" : "none";
  if (tab === "issue") renderIssues();
};

async function loadIssues() {
  /* ห้าม throw ออกไป — ถูกเรียกใน init() ก่อน loadDay()
     ถ้ายังไม่ได้รัน sql/182 แล้วปล่อยให้ระเบิด แท็บ "ตรวจนับ" ทั้งแท็บจะไม่โหลดตามไปด้วย
     (ของหลักต้องใช้ได้ ต่อให้ของเสริมยังไม่พร้อม) */
  try {
    state.issues = (await sbFetchAll("stock_check_issues?select=*&order=issue_date.desc,id.desc")) || [];
    state.issuesReady = true;
  } catch (e) {
    console.error("loadIssues:", e);
    state.issues = [];
    state.issuesReady = false;
  }
}

/* dropdown สินค้า + datalist ผู้เบิก — เติมใหม่ทุกครั้งที่ master เปลี่ยน */
function fillIssueControls() {
  const sel = $("iaItem");
  if (sel) {
    const keep = sel.value;
    sel.innerHTML =
      `<option value="">— เลือกสินค้า —</option>` +
      state.items
        .filter((it) => it.is_active !== false)
        .map((it) => `<option value="${it.id}">${esc((it.item_code ? it.item_code + " · " : "") + it.item_name)}</option>`)
        .join("");
    if (keep) sel.value = keep;
  }
  /* ชื่อผู้เบิกที่เคยพิมพ์ → เลือกซ้ำได้ ไม่ต้องพิมพ์ใหม่ทุกครั้ง
     (ไม่ทำเป็นตาราง master เพราะชีตเดิมก็พิมพ์อิสระ ชื่อคน/สาขาปนกัน) */
  const dl = $("scRequesterList");
  if (dl) {
    const seen = [...new Set(state.issues.map((r) => (r.requester || "").trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "th"));
    dl.innerHTML = seen.map((r) => `<option value="${esc(r)}"></option>`).join("");
  }
}

function issueRows() {
  const q = norm($("issueSearch")?.value || "");
  if (!q) return state.issues;
  return state.issues.filter(
    (r) =>
      norm(r.item_name).includes(q) ||
      norm(r.item_code).includes(q) ||
      norm(r.requester).includes(q) ||
      norm(r.note).includes(q)
  );
}

function renderIssues() {
  const rows = issueRows();
  $("scNIssue").textContent = state.issues.length;
  $("scIssueCount").textContent = `${rows.length} รายการ`;
  $("scIssueTotal").textContent = fmtQty(rows.reduce((s, r) => s + (+r.qty || 0), 0));

  const body = $("scIssueBody");
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="8" class="sc-empty">
      <span class="sc-empty-icon">${state.issuesReady === false ? "⚠️" : "⏳"}</span>
      ${state.issuesReady === false
        ? "ยังไม่มีตารางเบิกรอเซ็น — ต้องรัน sql/182_stock_check_issues.sql ใน Supabase ก่อน"
        : state.issues.length ? "ไม่มีรายการที่ตรงกับที่ค้นหา" : "ยังไม่มีรายการเบิกที่รอเซ็น"}
    </td></tr>`;
    updateIssueBar();
    return;
  }

  body.innerHTML = rows
    .map(
      (r) => `<tr>
        <td class="sc-col-chk">
          <input type="checkbox" ${state.issueSel.has(r.id) ? "checked" : ""}
                 onchange="window.toggleIssueSel(${r.id}, this.checked)" />
        </td>
        <td>${fmtDate(r.issue_date)}</td>
        <td>${r.item_code ? `<span class="sc-issue-code">${esc(r.item_code)}</span> ` : ""}<strong>${esc(r.item_name)}</strong></td>
        <td class="sc-col-num">${fmtQty(r.qty)}</td>
        <td>${esc(r.requester || "—")}</td>
        <td>${esc(r.note || "—")}</td>
        <td class="sc-issue-muted">${esc(r.created_by_name || "—")}</td>
        <td class="sc-col-act">
          <button class="sc-del-btn" data-perm="stock_check_edit"
                  title="เซ็นอนุมัติแล้ว — ลบแถวนี้ทิ้ง"
                  onclick="window.deleteIssues([${r.id}])">🗑</button>
        </td>
      </tr>`
    )
    .join("");

  applyPerms(body);
  updateIssueBar();
}

window.addIssue = async function () {
  if (!can("stock_check_edit")) return toast("ไม่มีสิทธิ์บันทึก", "error");

  const itemId = val("iaItem");
  const qty = Number(val("iaQty"));
  if (!itemId) return toast("เลือกสินค้าก่อน", "error");
  if (!isFinite(qty) || qty <= 0) return toast("กรอกจำนวนให้มากกว่า 0", "error");

  const it = state.items.find((x) => String(x.id) === String(itemId));
  if (!it) return toast("ไม่พบสินค้าใน master", "error");

  const me = currentUser();
  const row = {
    issue_date: val("iaDate") || todayISO(),
    warehouse_id: state.warehouseId ? Number(state.warehouseId) : null,
    item_id: it.id,
    /* snapshot ชื่อ/รหัสไว้ด้วย — สินค้าถูกลบจาก master ทีหลังแล้วแถวเก่ายังอ่านออก */
    item_code: it.item_code || null,
    item_name: it.item_name,
    qty,
    requester: val("iaRequester") || null,
    note: val("iaNote") || null,
    created_by: me?.user_id ? Number(me.user_id) : null,
    created_by_name: me?.full_name || me?.username || null,
  };

  showLoading(true);
  try {
    let ins;
    try {
      ins = await sbJson("stock_check_issues", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify([row]),
      });
    } catch (e) {
      /* created_by ชี้ไป users ที่ไม่มีจริง (session ค้างจากเครื่องอื่น) → ลองใหม่แบบไม่ผูก */
      if (!/23503|foreign key/i.test(String(e?.message || e))) throw e;
      ins = await sbJson("stock_check_issues", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify([{ ...row, created_by: null }]),
      });
    }
    state.issues.unshift(...(ins || []));

    /* เคลียร์เฉพาะสินค้า/จำนวน — วันที่กับผู้เบิกคงไว้ กรอกรายการถัดไปต่อได้เลย
       (คนกรอกมักเบิกหลายตัวให้คนเดียวกันในวันเดียวกัน) */
    $("iaItem").value = "";
    $("iaQty").value = "";
    $("iaNote").value = "";

    fillIssueControls();
    renderIssues();
    /* ใบตรวจนับของวันนี้ต้องเห็นยอดใหม่ทันที ไม่ต้องรีเฟรชหน้า */
    if (state.date === todayISO()) await window.pullIssue({ silent: true });
    toast(`เพิ่มแล้ว — ${it.item_name} ${fmtQty(qty)} ชิ้น`);
  } catch (e) {
    console.error(e);
    toast(explainError(e), "error");
  }
  showLoading(false);
};

window.deleteIssues = async function (ids) {
  if (!can("stock_check_edit")) return toast("ไม่มีสิทธิ์ลบ", "error");
  const list = ids || [...state.issueSel];
  if (!list.length) return;

  const rows = state.issues.filter((r) => list.some((id) => String(id) === String(r.id)));
  const totalQty = rows.reduce((s, r) => s + (+r.qty || 0), 0);
  const ok = await ConfirmModal.open({
    title: list.length === 1 ? "เซ็นอนุมัติแล้ว — ลบรายการนี้?" : `ลบ ${list.length} รายการที่เซ็นแล้ว?`,
    message:
      list.length === 1 && rows[0]
        ? `${rows[0].item_name} ${fmtQty(rows[0].qty)} ชิ้น (${rows[0].requester || "ไม่ระบุผู้เบิก"})`
        : `รวม ${fmtQty(totalQty)} ชิ้น`,
    note: "ยอดนี้จะหลุดจากคอลัมน์ “เบิก” ในใบตรวจนับทันที — ใช้เมื่อระบบหลังบ้านตัดยอดให้แล้วเท่านั้น",
    icon: "🗑",
    tone: "danger",
    confirmText: "ลบ",
  });
  if (!ok) return;

  showLoading(true);
  try {
    await sbFetch(`stock_check_issues?id=in.(${list.join(",")})`, { method: "DELETE" });
    const gone = new Set(list.map(String));
    state.issues = state.issues.filter((r) => !gone.has(String(r.id)));
    state.issueSel.clear();
    fillIssueControls();
    renderIssues();
    if (state.date === todayISO()) await window.pullIssue({ silent: true });
    toast(`ลบแล้ว ${list.length} รายการ`);
  } catch (e) {
    console.error(e);
    toast(explainError(e), "error");
  }
  showLoading(false);
};

/* ── เลือกหลายแถว ── */
window.toggleIssueSel = function (id, on) {
  if (on) state.issueSel.add(id);
  else state.issueSel.delete(id);
  updateIssueBar();
};

window.toggleIssueAll = function (on) {
  const rows = issueRows();
  if (on) rows.forEach((r) => state.issueSel.add(r.id));
  else rows.forEach((r) => state.issueSel.delete(r.id));
  renderIssues();
};

window.clearIssueSel = function () {
  state.issueSel.clear();
  renderIssues();
};

function updateIssueBar() {
  const ids = [...state.issueSel];
  const picked = state.issues.filter((r) => ids.some((id) => String(id) === String(r.id)));
  $("scIssueBulkBar").style.display = picked.length ? "" : "none";
  $("scIssueBulkCount").textContent = picked.length;
  $("scIssueBulkQty").textContent = fmtQty(picked.reduce((s, r) => s + (+r.qty || 0), 0));

  const rows = issueRows();
  const all = $("scIssueChkAll");
  if (all) all.checked = rows.length > 0 && rows.every((r) => state.issueSel.has(r.id));
  applyPerms($("scIssueBulkBar"));
}

window.exportIssues = function () {
  const rows = issueRows();
  if (!rows.length) return toast("ไม่มีข้อมูลให้ export", "warning");
  if (!window.XLSX) return toast("โหลดตัวช่วย Excel ไม่สำเร็จ", "error");

  const head = ["วันที่", "รหัสสินค้า", "สินค้า", "จำนวน", "ผู้เบิก", "หมายเหตุ", "ผู้บันทึก"];
  const body = rows.map((r) => [
    fmtDate(r.issue_date),
    r.item_code || "",
    r.item_name || "",
    +r.qty || 0,
    r.requester || "",
    r.note || "",
    r.created_by_name || "",
  ]);
  const ws = XLSX.utils.aoa_to_sheet([head, ...body]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "pending");
  XLSX.writeFile(wb, `stock_check_issues_${todayISO()}.xlsx`);
  toast(`📥 Export ${body.length} บรรทัด`);
};


window.pullIssue = async function (opts) {
  const silent = opts?.silent === true;
  if (silent) {
    if (!state.session || isLocked() || !state.lines.length) return;
  } else if (!guardEditable()) return;

  if (!silent) showLoading(true);
  try {
    /* ดึงจากแท็บ "เบิกรอเซ็น" (stock_check_issues · sql/182)
       ทุกแถวในตารางนั้น = "ของออกจากชั้นแล้ว แต่หลังบ้านยังไม่ตัดยอด" → ต้องบวกกลับ
       (เซ็นอนุมัติแล้ว = user ลบแถวทิ้ง เหมือนที่ชีตเดิมทำ) จึงไม่ต้องกรองสถานะ

       🔴 ทำไมไม่ดึงจากหน้า "เบิกสินค้า" (withdraw_ledger)
          หน้านั้นเป็นบิลเบิกที่ตัดสต็อกจริง = ถูกหักจากยอดในระบบไปแล้ว
          เอามาบวกกลับอีกจะกลายเป็น "ของเกิน" ปลอมทั้งใบ
          · เจ้าของงานยืนยันว่าหน้าเบิกสินค้า "ทำงานคนละส่วน" กับใบตรวจนับ
          · ชีตเดิมก็แยกกัน: `เบิกรอเซ็น` อยู่ในเล่ม Stock F.3 ส่วน `Withdraw_DATA` แยกเล่ม
          ⚠️ ถ้าวันหน้าเริ่มใช้หน้าเบิกสินค้ากับคลังนี้ด้วย (และยังผูก catalog ไม่ครบ
             จึงไม่ตัดสต็อก) ต้องมาบวกยอดจาก withdraw_ledger ที่ movement_id IS NULL
             เข้ามาตรงนี้เพิ่ม ไม่งั้นของพวกนั้นจะขึ้นเป็น "ของหาย" */
    await loadIssues();
    const whId = state.session.warehouse_id;
    const rows = state.issues.filter((r) => !whId || String(r.warehouse_id) === String(whId));

    /* รวมยอดต่อ "ตัวสินค้า" ก่อน แล้วค่อยจับคู่บรรทัด — ด้วยเหตุผลเดียวกับ pullBorrow
       (คีย์เดียวต่อสินค้า 1 ตัว กันยอดเดียวถูกลงให้ 2 บรรทัดเพราะรหัสกับชื่อไปคนละทาง) */
    const byItemQty = new Map(), byCodeQty = new Map(), byNameQty = new Map();
    rows.forEach((r) => {
      const q = Number(r.qty) || 0;
      if (q <= 0) return;
      const bump = (m, k) => m.set(k, (m.get(k) || 0) + q);
      if (r.item_id != null) bump(byItemQty, String(r.item_id));
      else if (r.item_code) bump(byCodeQty, norm(r.item_code));
      else if (r.item_name) bump(byNameQty, norm(r.item_name));
    });

    const idx = buildLineIndex();
    const qtyByLine = new Map();
    const add = (line, q) => { if (line) qtyByLine.set(line.id, (qtyByLine.get(line.id) || 0) + q); };
    byItemQty.forEach((q, iid) => add(idx.byItem.get(iid), q));
    byCodeQty.forEach((q, code) => add(idx.byCode.get(code), q));
    byNameQty.forEach((q, name) => add(idx.byName.get(name), q));

    const n = await applyPulled(qtyByLine, "qty_issue", "issue_source", "withdraw", { zeroUnmatched: true });
    renderAll();
    if (!silent) {
      toast(qtyByLine.size
        ? `ดึงยอดเบิกแล้ว — จับคู่ได้ ${qtyByLine.size} รายการ · อัปเดต ${n} บรรทัด`
        : "ไม่มีรายการเบิกที่รอเซ็น — ไม่ต้องบวกกลับในช่อง “เบิก”", qtyByLine.size ? "success" : "warning");
    }
  } catch (e) {
    console.error(e);
    if (!silent) toast(explainError(e), "error");
  }
  if (!silent) showLoading(false);
};

window.pullSystemQty = async function () {
  if (!guardEditable()) return;

  /* ยอดในระบบมาจาก stock_movements ซึ่งผูกกับ catalog products
     → คำนวณได้เฉพาะบรรทัดที่สินค้าใน master กลางผูก catalog ไว้ (stock_items.product_id)
     ตัวที่ไม่ผูกต้องใช้ "อัปโหลดยอดในระบบ" แทน — ต้องบอกให้เห็นตัวเลขก่อนกด
     ไม่ใช่กดแล้วเงียบ ๆ ได้ 0 ทั้งใบ */
  const linked = state.lines.filter((l) => l.product_id != null);
  const unlinked = state.lines.length - linked.length;
  if (!linked.length) {
    return toast(
      "สินค้าในรอบนี้ยังไม่ได้ผูกกับสินค้าใน catalog — ยอดในระบบต้องใช้ปุ่ม “📤 อัปโหลดยอดในระบบ” แทน",
      "warning"
    );
  }

  const ok = await ConfirmModal.open({
    title: "ดึงยอดในระบบ?",
    message: `คำนวณยอดคงเหลือจากความเคลื่อนไหวสต็อก แล้วเขียนทับคอลัมน์ “ยอดในระบบ” ${linked.length.toLocaleString("th-TH")} บรรทัด`,
    note: [
      state.session.warehouse_id
        ? `เฉพาะคลัง: ${state.session.warehouse_name || "—"}`
        : "รวมทุกคลัง (รอบนี้ไม่ได้ระบุคลัง)",
      unlinked
        ? `⚠️ อีก ${unlinked.toLocaleString("th-TH")} บรรทัดไม่ได้ผูก catalog — ข้ามไป ค่าเดิมคงอยู่`
        : null,
    ].filter(Boolean).join(" · "),
    icon: "🔄",
  });
  if (!ok) return;

  showLoading(true);
  try {
    const whFilter = state.session.warehouse_id ? `&warehouse_id=eq.${state.session.warehouse_id}` : "";
    const movs = await sbFetchAll(
      `stock_movements?select=movement_id,product_id,warehouse_id,movement_type,qty${whFilter}&order=movement_id.asc`
    );

    /* เครื่องหมายต้องตรงกับหน้า Stock สินค้า / Stock Dashboard เป๊ะ ๆ
       ไม่งั้น "ยอดในระบบ" ในใบตรวจนับกับหน้าอื่นจะไม่ตรงกันโดยไม่มีใครรู้ */
    const signed = (m) => {
      const q = Number(m.qty) || 0;
      return m.movement_type === "OUT" || m.movement_type === "INTERNAL" ? -q : q;
    };

    const byPid = new Map();
    movs.forEach((m) => {
      if (m.product_id == null) return;
      const k = String(m.product_id);
      byPid.set(k, (byPid.get(k) || 0) + signed(m));
    });

    /* ลงค่าเฉพาะบรรทัดที่ผูก catalog — ไม่ใช้ fillZero เพราะจะไปล้างบรรทัดที่ไม่ผูก
       (ซึ่งกรอกมือหรืออัปโหลดมา) ให้เป็น 0 ทั้งแถบ
       ส่วนบรรทัดที่ผูกแล้วแต่ไม่มีความเคลื่อนไหว = ไม่มีของจริง ๆ → ใส่ 0 ตรงนี้เอง */
    const qtyByLine = new Map();
    linked.forEach((l) => qtyByLine.set(l.id, byPid.get(String(l.product_id)) || 0));

    const n = await applyPulled(qtyByLine, "qty_system", "system_source", "movements");
    renderAll();
    toast(
      unlinked
        ? `ดึงยอดในระบบแล้ว — อัปเดต ${n.toLocaleString("th-TH")} บรรทัด · ข้าม ${unlinked.toLocaleString("th-TH")} บรรทัดที่ไม่ได้ผูก catalog`
        : `ดึงยอดในระบบแล้ว — อัปเดต ${n.toLocaleString("th-TH")} บรรทัด`
    );
  } catch (e) {
    console.error(e);
    toast(explainError(e), "error");
  }
  showLoading(false);
};

/* เขียนค่าที่ดึงมาลงบรรทัด แล้ว bulk upsert เฉพาะแถวที่เปลี่ยนจริง
   บรรทัดที่ไม่อยู่ใน qtyByLine ปล่อยตามเดิมเสมอ — "ไม่เจอ" แปลว่าไม่เกี่ยวข้อง
   ไม่ใช่ "เป็นศูนย์" · ผู้เรียกที่อยากลง 0 ต้องใส่ 0 ลง map มาเองให้ชัด
   (ยอดในระบบเคยล้างทั้งใบอัตโนมัติ แล้วไปทับค่าที่อัปโหลด/กรอกมือไว้) */
/* opts.zeroUnmatched — บรรทัดที่ "ไม่เจอ" ให้ลงเป็น 0 แทนที่จะข้าม
   ใช้กับคอลัมน์ที่ auto-pull + ล็อก (ยืม / เบิก) เท่านั้น เพราะการดึงคือ
   "แหล่งเดียว" ของค่านั้น → ไม่เจอ = ไม่มียอดค้าง = 0 จริง ๆ

   🔴 ห้ามเปิดกับ "ยอดในระบบ" (upload / movements) — ไฟล์หลังบ้านมีเฉพาะสินค้า
      ที่มีเคลื่อนไหว สินค้าที่ไม่อยู่ในไฟล์ = "ไม่มีข้อมูล" ไม่ใช่ "สต็อกเป็น 0"
      ถ้าเผลอล้างเป็น 0 ผลต่างจะกลายเป็น "ของเกิน" ทั้งใบ

   ทำไมต้องมี: เดิมข้ามบรรทัดที่ไม่เจอเสมอ → ลบรายการเบิกรอเซ็นตัวสุดท้าย
   (หรือคืนของครบทุกชิ้น) แล้วคอลัมน์จะค้างเลขเดิมตลอดไป เพราะไม่มีอะไรมาลบล้าง
   และช่องถูกล็อกไว้ ทำให้แก้มือก็ไม่ได้ด้วย */
async function applyPulled(qtyByLine, field, sourceField, sourceValue, opts) {
  const zeroUnmatched = opts?.zeroUnmatched === true;
  const changed = [];
  state.lines.forEach((l) => {
    if (!qtyByLine.has(l.id)) {
      if (!zeroUnmatched) return;
      if (Number(l[field]) === 0) return;   // เป็น 0 อยู่แล้ว — ไม่ต้องเขียนทับทั้งใบทุกครั้งที่โหลด
      l[field] = 0;
      l[sourceField] = sourceValue;
      changed.push(l);
      return;
    }
    const q = qtyByLine.get(l.id) || 0;
    if (Number(l[field]) === q && l[sourceField] === sourceValue) return;
    l[field] = q;
    l[sourceField] = sourceValue;
    changed.push(l);
  });
  if (!changed.length) return 0;
  const rows = await bulkUpsertLines(changed);
  const byId = new Map(rows.map((r) => [r.id, r]));
  state.lines.forEach((l) => { const r = byId.get(l.id); if (r) Object.assign(l, r); });
  return changed.length;
}

/* ============================================================
   ยอดในระบบ — ลากไฟล์มาวาง (ทางหลัก) / โมดัลเลือกคอลัมน์เอง (ทางสำรอง)
   ============================================================ */
/* สาขาตั้งต้น — รายงานหลังบ้านมีทุกสาขาในไฟล์เดียว แต่หน้านี้นับของที่ กทม. (BKK01) */
const UP_DEFAULT_BRANCH = "BKK01";

const RE_COL_CODE = /รหัสสินค้า|product.?code|item.?code|sku/i;
const RE_COL_QTY = /^จำนวน|คงเหลือ|ยอดคงเหลือ|qty|quantity|balance|on.?hand/i;
const RE_COL_BRANCH = /สาขา|branch|warehouse|คลัง/i;

/* หาแถวหัวตารางเอง — รายงานหลังบ้านมีหัวกระดาษ ("ผู้ตรวจสอบ", "วันที่พิมพ์") อยู่ 5–6 แถวแรก
   ถ้าถือว่าแถวแรกคือหัวตารางเสมอ จะได้คอลัมน์ว่างเปล่าแล้วจับคู่ไม่ได้สักแถว
   เกณฑ์: แถวที่มีทั้ง "รหัสสินค้า" และ "จำนวน" อยู่ในแถวเดียวกัน */
function findHeaderRow(rows) {
  const limit = Math.min(rows.length, 20);
  for (let i = 0; i < limit; i++) {
    const cells = (rows[i] || []).map((c) => String(c ?? "").trim());
    if (cells.some((c) => RE_COL_CODE.test(c)) && cells.some((c) => RE_COL_QTY.test(c))) return i;
  }
  return 0;   // หาไม่เจอ → ใช้แถวแรกแบบเดิม แล้วให้ผู้ใช้เลือกคอลัมน์เอง
}

/* แปลงไฟล์เป็นโครงข้อมูลล้วน ๆ — ไม่แตะ DOM เลย เพื่อให้ทั้งทางลากวางและทางโมดัลใช้ตัวเดียวกัน */
function parseUploadWorkbook(buf) {
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  /* blankrows:false ห้ามใส่ — แถวว่างคั่นในหัวกระดาษจะหายไป ทำให้เลขแถวเลื่อน
     แล้วที่แจ้งผู้ใช้ว่า "หัวตารางอยู่แถวที่ N" จะไม่ตรงกับที่เขาเห็นใน Excel */
  const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const headerRow = findHeaderRow(raw);
  const headers = (raw[headerRow] || []).map((h, i) => String(h ?? "").trim() || `คอลัมน์ ${i + 1}`);
  const rows = raw.slice(headerRow + 1).filter((r) => r.some((c) => String(c ?? "").trim() !== ""));

  const codeIdx = headers.findIndex((h) => RE_COL_CODE.test(h));
  const qtyIdx = headers.findIndex((h) => RE_COL_QTY.test(h));
  const branchIdx = headers.findIndex((h) => RE_COL_BRANCH.test(h));

  const branchCounts = new Map();
  if (branchIdx >= 0) {
    rows.forEach((r) => {
      const b = String(r[branchIdx] ?? "").trim();
      branchCounts.set(b, (branchCounts.get(b) || 0) + 1);
    });
  }
  return { headerRow, headers, rows, codeIdx, qtyIdx, branchIdx, branchCounts };
}

/* รวมยอดต่อ "รหัสสินค้า" แล้วจับคู่กับบรรทัดในใบตรวจนับ — ฟังก์ชันล้วน ไม่แตะ DOM
   รวมก่อนจับคู่เพราะไฟล์มีรหัสซ้ำในสาขาเดียวกันได้จริง (BKK01 มี 10016 สองแถว)
   ถ้าไม่รวม แถวหลังจะทับแถวแรกแล้วยอดหายเงียบ ๆ */
function aggregateUpload(p, branch, codeIdx, qtyIdx) {
  const idx = buildLineIndex();
  const agg = new Map();
  (p.rows || []).forEach((r) => {
    if (p.branchIdx >= 0 && branch !== "__ALL__" && String(r[p.branchIdx] ?? "").trim() !== branch) return;
    const key = String(r[codeIdx] ?? "").trim();
    if (!key) return;
    const rawQty = String(r[qtyIdx] ?? "").replace(/,/g, "").trim();
    const qty = Number(rawQty);
    const ok = rawQty !== "" && isFinite(qty);

    const k = norm(key);
    const cur = agg.get(k) || { key, qty: 0, validQty: false, rows: 0 };
    cur.rows++;
    if (ok) { cur.qty += qty; cur.validQty = true; }
    agg.set(k, cur);
  });

  return [...agg.values()].map((a) => ({
    ...a,
    /* จับคู่ด้วยรหัสเท่านั้น — ไฟล์นี้ชื่อสินค้าเป็นชื่อเต็มของระบบหลังบ้าน
       ("เอ็มเว่ โรยัล ออย จำนวน 1 ขวด") ไม่ตรงกับชื่อสั้นในใบตรวจนับ ("Royal Oil")
       ถ้าปล่อยให้ fallback ไปจับด้วยชื่อ จะได้คู่ที่ผิดแบบเงียบ ๆ */
    line: idx.byCode.get(norm(a.key)) || null,
  }));
}

/* เขียนยอดลงบรรทัด — ใช้ร่วมทั้งทางลากวางและปุ่มในโมดัล */
async function applyUploadMatches(matches) {
  const hit = matches.filter((m) => m.line && m.validQty);
  if (!hit.length) { toast("ไม่มีรหัสสินค้าในไฟล์ที่ตรงกับใบตรวจนับนี้", "error"); return -1; }
  const qtyByLine = new Map();
  hit.forEach((m) => qtyByLine.set(m.line.id, m.qty));
  const n = await applyPulled(qtyByLine, "qty_system", "system_source", "upload");
  renderAll();
  const skipped = state.lines.length - hit.length;
  toast(
    skipped > 0
      ? `ลงยอดในระบบแล้ว ${n.toLocaleString("th-TH")} บรรทัด · อีก ${skipped.toLocaleString("th-TH")} บรรทัดไม่มีในไฟล์ (คงยอดเดิม)`
      : `ลงยอดในระบบแล้ว ${n.toLocaleString("th-TH")} บรรทัด`
  );
  return n;
}

/* ── ทางหลัก: ลากไฟล์มาวาง แล้วลงยอดทันที ────────────────────
   อ่านไฟล์แล้ว "มั่นใจ" (เจอหัวตาราง + คอลัมน์รหัส/จำนวน + มีสาขา BKK01) → ลงยอดเลย
   ไม่มั่นใจ (ไฟล์คนละรูปแบบ / ไม่มีสาขา BKK01) → เปิดโมดัลให้เลือกเอง
   ไม่เดาแล้วลงมั่ว เพราะลงผิดคอลัมน์ = ผลต่างผิดทั้งใบโดยไม่มีอะไรเตือน */
async function handleUploadFile(file) {
  if (!file) return;
  if (!guardEditable()) return;

  showLoading(true);
  try {
    const buf = await file.arrayBuffer();
    const p = parseUploadWorkbook(buf);
    state.upload = p;

    const hasBranchCol = p.branchIdx >= 0;
    const branchOk = !hasBranchCol || p.branchCounts.has(UP_DEFAULT_BRANCH);
    const confident = p.codeIdx >= 0 && p.qtyIdx >= 0 && p.rows.length > 0 && branchOk;

    if (!confident) {
      showLoading(false);
      openUploadModal(p);
      toast("อ่านไฟล์อัตโนมัติไม่ได้ — เลือกคอลัมน์/สาขาเองในหน้าต่างนี้", "warning");
      return;
    }

    const branch = hasBranchCol ? UP_DEFAULT_BRANCH : "__ALL__";
    await applyUploadMatches(aggregateUpload(p, branch, p.codeIdx, p.qtyIdx));
  } catch (e) {
    console.error(e);
    toast("อ่านไฟล์ไม่ได้: " + String(e.message).slice(0, 120), "error");
  }
  showLoading(false);
}

/* ── ทางสำรอง: โมดัลเลือกคอลัมน์/สาขาเอง ───────────────────── */
function openUploadModal(p) {
  const opts = p.headers.map((h, i) => `<option value="${i}">${esc(h)}</option>`).join("");
  $("upKeyCol").innerHTML = opts;
  $("upQtyCol").innerHTML = opts;
  $("upKeyCol").value = String(p.codeIdx >= 0 ? p.codeIdx : 0);
  $("upQtyCol").value = String(p.qtyIdx >= 0 ? p.qtyIdx : Math.min(1, p.headers.length - 1));

  const sel = $("upBranch");
  if (p.branchIdx < 0) {
    sel.innerHTML = `<option value="__ALL__">— ไฟล์นี้ไม่มีคอลัมน์สาขา (ใช้ทุกแถว) —</option>`;
    sel.disabled = true;
  } else {
    const names = [...p.branchCounts.keys()].sort((a, b) => a.localeCompare(b, "th"));
    sel.disabled = false;
    sel.innerHTML =
      `<option value="__ALL__">— ทุกสาขา (รวมยอด) —</option>` +
      names.map((nm) => {
        const label = nm || "(ไม่ระบุสาขา)";
        return `<option value="${esc(nm)}">${esc(label)} · ${p.branchCounts.get(nm).toLocaleString("th-TH")} แถว</option>`;
      }).join("");
    sel.value = p.branchCounts.has(UP_DEFAULT_BRANCH) ? UP_DEFAULT_BRANCH : "__ALL__";
  }

  $("upDetected").innerHTML =
    `🔎 พบหัวตารางที่ <strong>แถว ${p.headerRow + 1}</strong> · อ่านข้อมูลได้ ` +
    `<strong>${p.rows.length.toLocaleString("th-TH")}</strong> แถว`;
  $("upMapWrap").style.display = "";
  $("uploadModal").classList.add("open");
  renderUploadPreview();
}

window.closeUpload = function () { $("uploadModal").classList.remove("open"); };

/* จับคู่ตามที่เลือกในโมดัล */
function matchUpload() {
  return aggregateUpload(
    state.upload,
    $("upBranch")?.value ?? "__ALL__",
    Number($("upKeyCol").value),
    Number($("upQtyCol").value)
  );
}

function renderUploadPreview() {
  if (!state.upload.rows?.length) return;
  const matches = matchUpload();
  const hit = matches.filter((m) => m.line && m.validQty);
  const missKey = matches.filter((m) => !m.line);
  const missQty = matches.filter((m) => m.line && !m.validQty);

  /* เรียงให้แถวที่จับคู่ได้ขึ้นก่อน — ไฟล์มีสินค้าเป็นพันรายการ ถ้าโชว์ 12 แถวแรกตามไฟล์
     ผู้ใช้จะเห็นแต่ ✕ แล้วเข้าใจว่าอัปโหลดไม่ได้ ทั้งที่จับคู่ได้ครบ */
  const preview = [...matches].sort((a, b) => (b.line ? 1 : 0) - (a.line ? 1 : 0));

  $("upPreview").innerHTML = `<table>
    <thead><tr><th>รหัสสินค้า</th><th>ยอดในไฟล์</th><th>ผลจับคู่</th></tr></thead>
    <tbody>${preview.slice(0, 12).map((m) => `<tr>
      <td>${esc(m.key || "(ว่าง)")}${m.rows > 1
        ? ` <span class="sc-dup" title="รหัสนี้มี ${m.rows} แถวในไฟล์ — รวมยอดให้แล้ว">×${m.rows}</span>`
        : ""}</td>
      <td>${m.validQty ? fmtQty(m.qty) : `<span class="sc-miss">ไม่ใช่ตัวเลข</span>`}</td>
      <td>${m.line
        ? `<span class="sc-hit">✓ ${esc(m.line.product_name)}</span>`
        : `<span class="sc-miss">✕ ไม่มีในใบตรวจนับ</span>`}</td>
    </tr>`).join("")}</tbody>
  </table>`;

  /* ตัวเลขที่ผู้ใช้ต้องตัดสินใจจริง ๆ คือ "บรรทัดในใบตรวจนับกี่บรรทัดจะได้ยอด"
     ไม่ใช่ "ไฟล์มีกี่แถว" — ไฟล์มีสินค้าเป็นพันตัวที่ไม่เกี่ยวกับคลังนี้อยู่แล้ว */
  const n = (v) => v.toLocaleString("th-TH");
  const uncovered = state.lines.length - hit.length;

  $("upSummary").innerHTML = `
    จะลงยอดให้ <strong class="sc-ok">${n(hit.length)}</strong> บรรทัด
    จากทั้งใบ ${n(state.lines.length)} บรรทัด
    ${uncovered > 0 ? `· <strong class="sc-short">${n(uncovered)}</strong> บรรทัดไม่มีในไฟล์ (คงยอดเดิม)` : ""}
    ${missQty.length ? `· ยอดไม่ใช่ตัวเลข <strong class="sc-short">${n(missQty.length)}</strong> รหัส` : ""}
    <br />ไฟล์มี <strong>${n(matches.length)}</strong> รหัสในสาขาที่เลือก —
    ไม่อยู่ในใบตรวจนับ ${n(missKey.length)} รหัส (ข้ามไป ไม่กระทบอะไร)
    ${matches.length > 12 ? `<br />(แสดงตัวอย่าง 12 รหัสแรก · เรียงรหัสที่จับคู่ได้ขึ้นก่อน)` : ""}`;

  $("upApplyBtn").disabled = hit.length === 0;
}

window.applyUpload = async function () {
  showLoading(true);
  try {
    const n = await applyUploadMatches(matchUpload());
    if (n >= 0) closeUpload();
  } catch (e) {
    console.error(e);
    toast(explainError(e), "error");
  }
  showLoading(false);
};

/* ============================================================
   เลือกหลายรายการ / ลบ
   ============================================================ */
window.toggleRow = function (id, checked) {
  if (checked) state.selected.add(id); else state.selected.delete(id);
  syncBulkBar();
};

window.toggleSelectAll = function (checked) {
  const rows = visibleLines();
  rows.forEach((l) => { if (checked) state.selected.add(l.id); else state.selected.delete(l.id); });
  document.querySelectorAll("#lineBody .sc-row-chk").forEach((c) => (c.checked = checked));
  syncBulkBar();
};

window.clearSelection = function () {
  state.selected.clear();
  document.querySelectorAll("#lineBody .sc-row-chk").forEach((c) => (c.checked = false));
  const all = $("chkAll");
  if (all) { all.checked = false; all.indeterminate = false; }
  syncBulkBar();
};

function syncBulkBar() {
  const n = state.selected.size;
  $("bulkBar").style.display = n ? "" : "none";
  $("bulkCount").textContent = n.toLocaleString("th-TH");

  const visible = visibleLines();
  const sel = visible.filter((l) => state.selected.has(l.id)).length;
  const all = $("chkAll");
  if (all) {
    all.checked = visible.length > 0 && sel === visible.length;
    all.indeterminate = sel > 0 && sel < visible.length;
  }
}

window.bulkClearCount = async function () {
  if (!guardEditable() || !state.selected.size) return;
  const ok = await ConfirmModal.open({
    title: "ล้างจำนวนที่นับ?",
    message: `ล้างช่อง ลัง / ชิ้น ของ ${state.selected.size.toLocaleString("th-TH")} รายการที่เลือก (กลับเป็น “ยังไม่นับ”)`,
    note: "ยอดยืม / เบิก / ยอดในระบบ ไม่ถูกแตะ",
    icon: "♻️",
  });
  if (!ok) return;

  showLoading(true);
  try {
    const changed = state.lines.filter((l) => state.selected.has(l.id));
    changed.forEach((l) => { l.qty_box = null; l.qty_piece = null; });
    const rows = await bulkUpsertLines(changed);
    const byId = new Map(rows.map((r) => [r.id, r]));
    state.lines.forEach((l) => { const r = byId.get(l.id); if (r) Object.assign(l, r); });
    clearSelection();
    renderAll();
    toast(`ล้างจำนวนแล้ว ${changed.length.toLocaleString("th-TH")} รายการ`);
  } catch (e) { toast(explainError(e), "error"); }
  showLoading(false);
};

window.bulkDelete = async function () {
  if (!guardEditable() || !state.selected.size) return;
  const ok = await ConfirmModal.open({
    title: "ลบรายการที่เลือก?",
    message: `ลบ ${state.selected.size.toLocaleString("th-TH")} รายการออกจากรอบตรวจนับนี้ — กู้คืนไม่ได้`,
    icon: "🗑",
    tone: "danger",
  });
  if (!ok) return;

  showLoading(true);
  try {
    const ids = Array.from(state.selected).join(",");
    await sbFetch(`stock_check_lines?id=in.(${ids})`, { method: "DELETE" });
    state.selected.clear();
    await loadLines();
    toast("ลบรายการแล้ว");
  } catch (e) { toast(explainError(e), "error"); }
  showLoading(false);
};

window.deleteLine = async function (id) {
  if (!guardEditable()) return;
  const line = state.lines.find((l) => l.id === id);
  const ok = await ConfirmModal.open({
    title: "ลบรายการนี้?",
    message: `ลบ “${line?.product_name || ""}” ออกจากรอบตรวจนับนี้`,
    icon: "🗑",
    tone: "danger",
  });
  if (!ok) return;
  try {
    await sbFetch(`stock_check_lines?id=eq.${id}`, { method: "DELETE" });
    state.selected.delete(id);
    await loadLines();
    toast("ลบรายการแล้ว");
  } catch (e) { toast(explainError(e), "error"); }
};

/* ============================================================
   MASTER: รายการสินค้ากลาง (stock_items · sql/179)
   ใช้ร่วมกับหน้าเบิกสินค้า และหน้ายืม/คืน สินค้า — แก้ที่นี่ที่เดียว
   ============================================================ */
const ITEM_NUM_FIELDS = { pieces_per_box: 1, price: 0, sort_order: 0 };

/* โหลด master ใหม่ แล้ววาดทั้งโมดัลและตารางข้างหลังพร้อมกัน
   ตารางข้างหลังต้องอัปเดตทันที ไม่ใช่รอปิดโมดัลหรือรีเฟรชหน้า — ผู้ใช้แก้ราคา/ชื่อ/ลำดับ
   แล้วอยากเห็นผลเลย ถ้าเงียบไว้จะเข้าใจว่าบันทึกไม่ติด แล้วกดซ้ำ
   (renderAll ครอบทั้ง buildCatTints + ตัวกรองหมวด + สถิติ ซึ่งอิง state.items ทั้งหมด) */
async function refreshItemsEverywhere() {
  await loadStockItems();
  renderItemManager();
  renderAll();
  state.itemsDirty = false;
}

/* ราคาไม่ได้ใช้ในหน้าตรวจนับ → ซ่อนไว้ให้ฟอร์มสั้นลง แต่หน้าเบิก/ยืม-คืน ใช้คิดมูลค่า
   จึงเปิดดูได้ · จำค่าที่เลือกไว้ ไม่ต้องมาติ๊กใหม่ทุกครั้งที่เปิดโมดัล */
const IM_PRICE_KEY = "sc_im_show_price";

function applyPriceVisibility() {
  const show = $("imShowPrice").checked;
  $("itemModal").querySelector(".sc-item-modal").classList.toggle("sc-hide-price", !show);
  localStorage.setItem(IM_PRICE_KEY, show ? "1" : "0");
}

window.openItemManager = function () {
  $("imSearch").value = "";
  $("imShowInactive").checked = false;
  $("imShowPrice").checked = localStorage.getItem(IM_PRICE_KEY) === "1";
  applyPriceVisibility();
  $("itemModal").classList.add("open");
  renderItemManager();
};

window.closeItemManager = async function () {
  $("itemModal").classList.remove("open");
  /* กันกรณีที่มีอะไรเปลี่ยนแล้วตารางยังไม่ทัน (เช่น บันทึกล้มกลางคัน หรือแก้จากแท็บอื่น)
     — ปิดโมดัลแล้วต้องเห็นข้อมูลตรงกับ master เสมอ */
  if (state.itemsDirty) await refreshItemsEverywhere();
};

function imVisibleItems() {
  const q = norm($("imSearch")?.value);
  const showOff = $("imShowInactive")?.checked;
  return state.items.filter((it) => {
    if (!showOff && it.is_active === false) return false;
    if (!q) return true;
    return norm(`${it.item_code || ""} ${it.item_name || ""} ${it.category || ""}`).includes(q);
  });
}

window.renderItemManager = function () {
  const rows = imVisibleItems();
  const off = state.items.filter((it) => it.is_active === false).length;
  $("imCount").textContent = off
    ? `${rows.length.toLocaleString("th-TH")} รายการ (ปิดใช้งาน ${off.toLocaleString("th-TH")})`
    : `${rows.length.toLocaleString("th-TH")} รายการ`;

  const list = $("imList");
  if (!rows.length) {
    list.innerHTML = `<div class="sc-im-empty">${
      state.items.length ? "ไม่พบสินค้าที่ค้นหา" : "ยังไม่มีสินค้า — เพิ่มด้านบนได้เลย"
    }</div>`;
    return;
  }

  list.innerHTML = rows.map((it) => {
    /* ผูก catalog แล้วเท่านั้นที่ "ดึงยอดในระบบ" และ "ตัดสต็อกตอนเบิก" ทำงาน
       — ต้องเห็นได้จากตารางเลย ไม่ใช่ไปเจอตอนตัวเลขไม่ขึ้น */
    const link = it.product_id
      ? `<span class="sc-im-link sc-im-link-on" title="ผูกกับสินค้าใน catalog (#${it.product_id}) — ตัดสต็อก/ดึงยอดในระบบได้">🔗</span>`
      : `<span class="sc-im-link" title="ยังไม่ผูก catalog — หน้าเบิกจะไม่ตัดสต็อกจริง และใบตรวจนับต้องอัปโหลดยอดในระบบเอง">⛓️‍💥</span>`;
    return `
    <div class="sc-im-row${it.is_active === false ? " sc-im-off" : ""}" data-id="${it.id}">
      <input class="form-control sc-im-c-code" data-f="item_code" value="${esc(it.item_code || "")}" placeholder="—" />
      <input class="form-control sc-im-c-name" data-f="item_name" value="${esc(it.item_name || "")}" />
      <input class="form-control sc-im-c-cat" data-f="category" value="${esc(it.category || "")}" placeholder="—" />
      <input class="form-control sc-im-c-box" data-f="pieces_per_box" type="number" min="1" step="any"
             value="${Number(it.pieces_per_box) || 1}" />
      <input class="form-control sc-im-c-price" data-f="price" type="number" min="0" step="0.01"
             value="${Number(it.price) || 0}" />
      <input class="form-control sc-im-c-order" data-f="sort_order" type="number" step="any"
             value="${Number(it.sort_order) || 0}" />
      <label class="sc-im-c-on">
        <input type="checkbox" data-f="is_active" ${it.is_active === false ? "" : "checked"} />
        ${link}
      </label>
      <div class="sc-im-c-act">
        <button class="sc-im-btn" title="บันทึก" onclick="window.saveItem(${it.id})">💾</button>
        <button class="sc-im-btn sc-im-btn-danger" title="ลบ" onclick="window.deleteItem(${it.id})">🗑</button>
      </div>
    </div>`;
  }).join("");

  applyPerms(list);
};

/* อ่านค่า 1 สินค้าจากชุด input → object พร้อมส่ง
   read(field) คืนค่าดิบเป็นข้อความ — แถวเพิ่มใหม่อ่านจาก id (#imNew…)
   แถวในลิสต์อ่านจาก data-f ของแถวนั้น (ค่าว่าง = ใช้ default ไม่ใช่ NaN) */
function imBuildRow(read) {
  const txt = (f) => (read(f) || "").trim();
  const out = {
    item_code: txt("item_code") || null,
    item_name: txt("item_name"),
    category: txt("category") || null,
  };
  Object.entries(ITEM_NUM_FIELDS).forEach(([f, dflt]) => {
    const raw = txt(f);
    const n = Number(raw);
    out[f] = raw === "" || !isFinite(n) ? dflt : n;
  });
  /* ตัวคูณลัง 0 จะทำให้สูตร "ลัง × ตัวคูณ + ชิ้น" กลืนจำนวนลังหายเงียบ ๆ */
  if (!(out.pieces_per_box > 0)) out.pieces_per_box = 1;
  return out;
}

const IM_NEW_IDS = {
  item_code: "imNewCode", item_name: "imNewName", category: "imNewCat",
  pieces_per_box: "imNewBox", price: "imNewPrice", sort_order: "imNewOrder",
};

function imDuplicateName(name, exceptId = null) {
  return state.items.some((it) => it.id !== exceptId && norm(it.item_name) === norm(name));
}

window.addItem = async function () {
  if (!can("stock_items_manage")) return toast("ไม่มีสิทธิ์เพิ่มสินค้า", "error");
  const row = imBuildRow((f) => $(IM_NEW_IDS[f])?.value);
  if (!row.item_name) return toast("กรุณากรอกชื่อสินค้า", "error");
  if (imDuplicateName(row.item_name)) return toast(`มีสินค้า “${row.item_name}” อยู่แล้ว`, "error");

  showLoading(true);
  try {
    await sbFetch("stock_items", { method: "POST", body: JSON.stringify({ ...row, is_active: true }) });
    Object.values(IM_NEW_IDS).forEach((id) => ($(id).value = ""));
    state.itemsDirty = true;
    await refreshItemsEverywhere();
    toast(`เพิ่ม “${row.item_name}” แล้ว`);
  } catch (e) {
    toast(explainError(e), "error");
  }
  showLoading(false);
};

window.saveItem = async function (id) {
  if (!can("stock_items_manage")) return toast("ไม่มีสิทธิ์แก้ไข", "error");
  const el = document.querySelector(`#imList .sc-im-row[data-id="${id}"]`);
  if (!el) return;
  const row = imBuildRow((f) => el.querySelector(`[data-f="${f}"]`)?.value);
  if (!row.item_name) return toast("ชื่อสินค้าห้ามว่าง", "error");
  if (imDuplicateName(row.item_name, id)) return toast(`มีสินค้า “${row.item_name}” อยู่แล้ว`, "error");
  row.is_active = el.querySelector('[data-f="is_active"]').checked;

  showLoading(true);
  try {
    await sbFetch(`stock_items?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(row) });
    state.itemsDirty = true;
    await refreshItemsEverywhere();
    toast("บันทึกแล้ว — รอบตรวจนับที่เปิดอยู่ยังใช้ค่าเดิม (ค่าใหม่มีผลกับรอบถัดไป)");
  } catch (e) {
    toast(explainError(e), "error");
  }
  showLoading(false);
};

window.deleteItem = async function (id) {
  if (!can("stock_items_manage")) return toast("ไม่มีสิทธิ์ลบ", "error");
  const it = state.items.find((x) => x.id === id);
  if (!it) return;

  /* ลบ master ไม่ได้ลบประวัติ — บรรทัดเก่า snapshot ชื่อ/ราคาไว้แล้ว และ FK เป็น
     ON DELETE SET NULL ทั้ง 3 ตาราง · บอกจำนวนที่กระทบก่อนให้ตัดสินใจ */
  let used = 0;
  try {
    const res = await sbFetch(`stock_check_lines?select=id&item_id=eq.${id}`, {
      headers: { Prefer: "count=exact", Range: "0-0" },
    });
    used = Number((res.headers.get("content-range") || "").split("/")[1]) || 0;
  } catch { /* นับไม่ได้ก็ถามต่อได้ — แค่ไม่มีตัวเลขให้ดู */ }

  const ok = await ConfirmModal.open({
    title: "ลบสินค้าออกจากรายการกลาง?",
    message: `ลบ “${it.item_name}” — จะหายจากฟอร์มกรอกทั้ง 3 หน้า`,
    icon: "🗑",
    okText: "ลบเลย",
    tone: "danger",
    note: used
      ? `⚠️ มี ${used.toLocaleString("th-TH")} บรรทัดในใบตรวจนับที่อ้างสินค้านี้ — บรรทัดเดิมยังอยู่และยังนับในรายงาน (ใช้ชื่อ/ราคาที่บันทึกไว้ตอนนั้น)`
      : "ถ้าแค่อยากซ่อนจากฟอร์มชั่วคราว ให้เอาเครื่องหมายถูกช่อง “เปิดใช้” ออกแทน",
  });
  if (!ok) return;

  showLoading(true);
  try {
    await sbFetch(`stock_items?id=eq.${id}`, { method: "DELETE" });
    state.itemsDirty = true;
    await refreshItemsEverywhere();
    toast("ลบแล้ว");
  } catch (e) {
    toast(explainError(e), "error");
  }
  showLoading(false);
};

/* ============================================================
   EXPORT / พิมพ์
   ============================================================ */
function exportRows() {
  return visibleLines().map((l, i) => {
    const v = calcVariance(l);
    return {
      "NO": i + 1,
      "รหัสสินค้า": l.product_code || "",
      "ชื่อสินค้า": l.product_name || "",
      "หมวดหมู่": l.category_name || "",
      "ลัง": l.qty_box ?? "",
      "ชิ้น": l.qty_piece ?? "",
      "ตัวคูณ (1 ลัง = กี่ชิ้น)": Number(l.pieces_per_box) || 1,
      "รวม (ชิ้น)": isCounted(l) ? calcTotal(l) : "",
      "ยืม": Number(l.qty_borrow) || 0,
      "เบิก": Number(l.qty_issue) || 0,
      "ยอดในระบบ": Number(l.qty_system) || 0,
      "ผลต่าง": v === null ? "" : v,
      "หมายเหตุ": l.note || "",
      "แจ้งเตือน": alertText(v).text,
      "แจ้งเตือน 2": isLowStock(l) ? "ใกล้หมดแล้ว" : "",
    };
  });
}

window.exportExcel = function () {
  const rows = exportRows();
  if (!rows.length) return toast("ไม่มีข้อมูลให้ export", "error");
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "ตรวจนับสต็อก");
  const s = state.session;
  XLSX.writeFile(wb, `stock-check-${s?.check_date || todayISO()}.xlsx`);
};

/* พิมพ์ผ่านหน้าต่างใหม่ที่สร้าง HTML สะอาด ๆ เอง
   (สั่ง print หน้าหลักตรง ๆ ตารางยาวจะถูกตัดเหลือหน้าเดียวเพราะ layout ของ ERP) */
window.printSheet = function () {
  const rows = visibleLines();
  if (!rows.length) return toast("ไม่มีข้อมูลให้พิมพ์", "error");
  const s = state.session;

  const trs = rows.map((l, i) => {
    const v = calcVariance(l);
    const al = alertText(v);
    const cls = v === null ? "" : v < 0 ? "neg" : v > 0 ? "pos" : "ok";
    return `<tr>
      <td class="c">${i + 1}</td>
      <td class="mono">${esc(l.product_code || "—")}</td>
      <td>${esc(l.product_name)}</td>
      <td class="r">${l.qty_box ?? ""}</td>
      <td class="r">${l.qty_piece ?? ""}</td>
      <td class="r b">${isCounted(l) ? fmtQty(calcTotal(l)) : "—"}</td>
      <td class="r">${fmtQty(l.qty_borrow || 0)}</td>
      <td class="r">${fmtQty(l.qty_issue || 0)}</td>
      <td class="r">${fmtQty(l.qty_system || 0)}</td>
      <td class="r b ${cls}">${v === null ? "—" : fmtQty(v)}</td>
      <td>${esc(l.note || "")}</td>
      <td class="c ${cls}">${esc(al.text)}</td>
      <td class="c">${isLowStock(l) ? "ใกล้หมดแล้ว" : ""}</td>
    </tr>`;
  }).join("");

  const nowText = new Date().toLocaleString("en-GB", {
    timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  const html = `<!doctype html><html lang="th"><head><meta charset="UTF-8">
<title>ใบตรวจนับสต็อก ${esc(fmtDate(s?.check_date))}</title>
<style>
  @page { size: A4 landscape; margin: 12mm 10mm; }
  body { font-family: "Sarabun","Tahoma",sans-serif; font-size: 11px; color: #1f2937; margin: 0; }
  .hdr { display:flex; justify-content:space-between; align-items:flex-end;
         border-bottom:2px solid #4a7c59; padding-bottom:8px; margin-bottom:12px; }
  .hdr h1 { margin:0; font-size:18px; color:#2d4a36; }
  .meta { text-align:right; font-size:10px; color:#64748b; line-height:1.5; }
  .meta b { color:#1f2937; }
  table { width:100%; border-collapse:collapse; font-size:10.5px; }
  thead th { background:#2d4a36; color:#fff; text-align:left; padding:6px 7px;
             font-weight:600; border:1px solid #2d4a36; }
  tbody td { padding:5px 7px; border:1px solid #d1d5db; }
  tbody tr:nth-child(even) td { background:#f9fafb; }
  td.c, th.c { text-align:center; }
  td.r, th.r { text-align:right; font-variant-numeric:tabular-nums; }
  td.b { font-weight:700; }
  td.mono { font-family:"IBM Plex Mono",monospace; font-size:9.5px; }
  .neg { color:#b91c1c; } .pos { color:#b45309; } .ok { color:#166534; }
  tfoot td { background:#ecfdf5; font-weight:700; border-top:2px solid #4a7c59; }
  .sign { margin-top:22px; display:flex; gap:60px; font-size:11px; color:#374151; }
  .sign div { flex:1; border-top:1px dotted #9ca3af; padding-top:6px; text-align:center; }
</style></head><body>
  <div class="hdr">
    <h1>🧮 ใบตรวจนับสต็อก${s?.title ? " — " + esc(s.title) : ""}</h1>
    <div class="meta">
      <div><b>วันที่ตรวจนับ:</b> ${esc(fmtDate(s?.check_date))} ·
           <b>คลัง:</b> ${esc(s?.warehouse_name || "ทุกคลัง")}</div>
      <div><b>เกณฑ์ใกล้หมด:</b> ${fmtQty(s?.low_stock_threshold ?? 50)} ชิ้น ·
           <b>พิมพ์เมื่อ:</b> ${nowText} · A4S-ERP</div>
    </div>
  </div>
  <table>
    <thead><tr>
      <th class="c" style="width:28px">NO</th>
      <th style="width:80px">รหัส</th>
      <th>ชื่อสินค้า</th>
      <th class="r" style="width:44px">ลัง</th>
      <th class="r" style="width:44px">ชิ้น</th>
      <th class="r" style="width:62px">รวม</th>
      <th class="r" style="width:48px">ยืม</th>
      <th class="r" style="width:48px">เบิก</th>
      <th class="r" style="width:64px">ยอดระบบ</th>
      <th class="r" style="width:60px">ผลต่าง</th>
      <th style="width:110px">หมายเหตุ</th>
      <th class="c" style="width:96px">แจ้งเตือน</th>
      <th class="c" style="width:70px">แจ้งเตือน 2</th>
    </tr></thead>
    <tbody>${trs}</tbody>
    <tfoot><tr>
      <td colspan="5" class="r">รวม ${rows.length.toLocaleString("th-TH")} รายการ</td>
      <td class="r">${fmtQty(rows.reduce((a, l) => a + (isCounted(l) ? calcTotal(l) : 0), 0))}</td>
      <td class="r">${fmtQty(rows.reduce((a, l) => a + (Number(l.qty_borrow) || 0), 0))}</td>
      <td class="r">${fmtQty(rows.reduce((a, l) => a + (Number(l.qty_issue) || 0), 0))}</td>
      <td class="r">${fmtQty(rows.reduce((a, l) => a + (Number(l.qty_system) || 0), 0))}</td>
      <td class="r">${fmtQty(rows.reduce((a, l) => a + (calcVariance(l) || 0), 0))}</td>
      <td colspan="3"></td>
    </tr></tfoot>
  </table>
  <div class="sign">
    <div>ผู้ตรวจนับ</div><div>ผู้ตรวจสอบ</div><div>ผู้อนุมัติ</div>
  </div>
  <script>window.addEventListener("load",()=>setTimeout(()=>window.print(),200));<\/script>
</body></html>`;

  const w = window.open("", "stock-check-print", "width=1100,height=820");
  if (!w) return toast("เบราว์เซอร์บล็อก popup — อนุญาต popup ของหน้านี้ก่อน", "error");
  w.document.open();
  w.document.write(html);
  w.document.close();
};

/* ── START ── */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
