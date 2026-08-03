/* ============================================================
   withdraw.js — เบิกสินค้า (แทน Google Sheet "Withdraw_DATA")
   Tables: withdraw_categories, withdraw_txns, withdraw_txn_lines (sql/177)
           + stock_items (sql/179) + stock_movements

   โครงงาน:
     - แท็บ 1 "บันทึกเบิก"  = หัวบิล (วันที่ / ประเภท / คลัง) + ตารางกรอกจำนวน
                              (เหมือนแผ่นกรอกในชีต — กรอกหลายสินค้าแล้ว Save ทีเดียว)
     - แท็บ 2 "รายงาน"      = เมทริกซ์ สินค้า × วันที่ 1–31 แยกตามประเภท + คอลัมน์ "รวมเบิก"
     - แท็บ 3 "ประวัติ"     = รายการที่บันทึกไว้ · แก้ / ลบ / ดูรายละเอียด

   รายการสินค้าในตารางกรอก:
     มาจาก stock_items (master กลาง) ซึ่งใช้ร่วมกับหน้าตรวจนับสต็อก และหน้ายืม/คืน
     แก้รหัส/ชื่อ/ราคา/ลำดับ ได้ที่ปุ่ม "📦 รายการสินค้า" ในหน้าตรวจนับ Stock F.3
     ที่เดียว — หน้านี้อ่านอย่างเดียว

   ตัดสต็อกจริง:
     บรรทัดที่สินค้า "ผูกกับ catalog แล้ว" (stock_items.product_id ไม่ว่าง) จะสร้าง
     stock_movements type INTERNAL คู่กัน 1 แถว (stock-balance.js นับ OUT/INTERNAL
     เป็น −qty) แล้วเก็บ movement_id ไว้ที่บรรทัด → ตอนแก้/ลบ ถอน movement เดิม
     ออกก่อนเสมอ ไม่ให้ค้างในบัญชีเดินสต็อก

     สินค้าที่ยังไม่ผูก catalog บันทึกได้ตามปกติแต่ไม่ตัดสต็อก (movement_id = null)
     — ตรงกับความหมายคอลัมน์ H ในใบตรวจนับ ("เบิกออกไปแล้วแต่ระบบยังไม่ตัด")
     ซึ่งหน้าตรวจนับจะดึงไปบวกกลับให้เอง จึงต้องไม่ตัดซ้ำที่นี่
   ============================================================ */

const SB_URL = localStorage.getItem("sb_url") || "";
const SB_KEY = localStorage.getItem("sb_key") || "";

const MOVE_REF_TYPE = "WITHDRAW"; // ref_doc_type ที่เขียนลง stock_movements

const state = {
  categories: [],
  warehouses: [],
  items: [],          // stock_items — master กลาง (sql/179) · หน้านี้อ่านอย่างเดียว
  txns: [],
  txnById: {},        // txn_id → txn
  lines: [],
  linesByTxn: {},     // txn_id → [line]
  movements: [],      // stock_movements (ใช้คำนวณ on-hand)
  onHand: {},         // `${pid}_${whId}` → qty
  allowNegative: true,
  /* คีย์ทุก map ในหน้านี้เป็น stock_items.id ไม่ใช่ product_id
     — สินค้าส่วนใหญ่ไม่ได้ผูก catalog จึงมี product_id เป็น null ซ้ำกันหมด
     ใช้ product_id เป็นคีย์เมื่อไหร่ รายการที่ไม่ผูกจะยุบรวมกันเป็นตัวเดียว */
  qtyDraft: {},       // item_id → จำนวนที่กำลังกรอก (คงค่าไว้ตอนกรอง/ค้นหา)
  editId: null,
  editQtyByItem: {},  // ตอนแก้ไข: จำนวนเดิมของบิลนี้ (บวกคืนตอนเช็คสต็อกไม่พอ)
  selected: new Set(),
  reportCatId: "all",
};

/* ── helpers ── */
const $ = (id) => document.getElementById(id);
const val = (id) => ($(id)?.value || "").trim();
const showLoading = (on) => { const el = $("loadingOverlay"); if (el) el.style.display = on ? "flex" : "none"; };

function toast(msg, type = "success") {
  const el = $("toast");
  if (!el) return alert(msg);
  el.textContent = msg;
  el.className = `toast show toast-${type}`;
  setTimeout(() => el.classList.remove("show"), 3000);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

const fmtDate = (iso) => (window.DateFmt ? window.DateFmt.formatDMY(iso) : (iso || ""));
const fmtQty = (n) => Number(n || 0).toLocaleString("th-TH", { maximumFractionDigits: 2 });
const fmtMoney = (n) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/* แปลง error ดิบของ PostgREST เป็นภาษาที่คนอ่านแล้วรู้ว่าต้องทำอะไรต่อ
   เคสที่เจอบ่อยสุดคือ "ลืมรัน migration" — ถ้าไม่ดัก จะได้แค่ 42703 ที่ไม่บอกอะไร */
function explainError(e) {
  const msg = String(e?.message || e);
  if (/requester/.test(msg) && /42703|does not exist|PGRST204/.test(msg)) {
    return "ยังไม่ได้อัปเดตโครงตาราง — ต้องรัน sql/182_stock_check_issues.sql ใน Supabase ก่อน";
  }
  if (/stock_items/.test(msg) && /404|does not exist|PGRST205/.test(msg)) {
    return "ยังไม่มีตารางรายการสินค้ากลาง — ต้องรัน sql/179_stock_items.sql ใน Supabase ก่อน";
  }
  return "ทำรายการไม่สำเร็จ: " + msg.slice(0, 160);
}

function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const monthOf = (iso) => String(iso || "").slice(0, 7);   // YYYY-MM
const dayOf = (iso) => Number(String(iso || "").slice(8, 10)) || 0;
const daysInMonth = (ym) => {
  const [y, m] = String(ym || "").split("-").map(Number);
  return y && m ? new Date(y, m, 0).getDate() : 31;
};

function currentUser() {
  if (window.ERP_USER) return window.ERP_USER;
  const raw = localStorage.getItem("erp_session") || sessionStorage.getItem("erp_session");
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

function can(perm) {
  return !window.AuthZ || typeof AuthZ.hasPerm !== "function" ? true : AuthZ.hasPerm(perm);
}

/* ซ่อน/ลบปุ่มตาม data-perm หลัง render ใหม่ทุกครั้ง */
function applyPerms(root) {
  if (window.AuthZ && typeof AuthZ.applyDomPerms === "function") AuthZ.applyDomPerms(root);
}

/* ============================================================
   SUPABASE
   ============================================================ */
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
    throw new Error(`${opts.method || "GET"} ${path} → ${res.status}: ${(await res.text()).slice(0, 250)}`);
  }
  return res;
}

async function sbJson(path, opts) {
  const res = await sbFetch(path, opts);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/* Supabase ตอบสูงสุด 1000 แถว/ครั้ง → ไล่ดึงเป็นหน้าๆ จนครบ */
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

async function sbInsert(table, rows) {
  if (!rows.length) return [];
  /* batch insert: ทุกแถวต้องมี key ชุดเดียวกัน ไม่งั้น PostgREST ตอบ PGRST102 */
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const normalized = rows.map((r) => Object.fromEntries(keys.map((k) => [k, r[k] ?? null])));
  return (await sbJson(table, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(normalized),
  })) || [];
}

/* ============================================================
   LOAD
   ============================================================ */
async function loadAll() {
  if (!SB_URL || !SB_KEY) {
    toast("ยังไม่ได้ตั้งค่า Supabase (sb_url / sb_key)", "error");
    return;
  }
  showLoading(true);
  try {
    const [cats, whs, items, allowNeg] = await Promise.all([
      sbJson("withdraw_categories?select=*&order=sort_order.asc,id.asc"),
      sbJson("warehouses?select=warehouse_id,warehouse_code,warehouse_name,is_active&order=warehouse_code.asc"),
      sbFetchAll("stock_items?select=*&is_active=eq.true&order=sort_order.asc,item_name.asc"),
      loadAllowNegative(),
    ]);
    state.categories = cats || [];
    state.warehouses = (whs || []).filter((w) => w.is_active !== false);
    state.items = items || [];
    state.allowNegative = allowNeg;

    fillCategorySelects();
    fillWarehouseSelect();

    await Promise.all([loadMovements(), loadTxns()]);

    renderItemTable();
    renderCatTabs();
    renderReport();
    renderHistory();
    updateStats();
  } catch (e) {
    console.error(e);
    const msg = String(e?.message || e);
    toast(
      /stock_items/.test(msg) && /404|does not exist|PGRST205/.test(msg)
        ? "ยังไม่มีตารางรายการสินค้ากลาง — ต้องรัน sql/179_stock_items.sql ใน Supabase ก่อน"
        : "โหลดข้อมูลไม่ได้: " + msg,
      "error"
    );
  } finally {
    showLoading(false);
  }
}

async function loadAllowNegative() {
  try {
    const rows = await sbJson("app_settings?key=eq.inventory_allow_negative&select=value");
    if (!rows || !rows.length) return true; // default: อนุญาต (ตรงกับ stock-balance)
    return String(rows[0].value).toLowerCase() === "true";
  } catch {
    return true;
  }
}

async function loadMovements() {
  state.movements = await sbFetchAll(
    "stock_movements?select=movement_id,product_id,warehouse_id,movement_type,qty&order=movement_id.asc"
  );
  buildOnHand();
}

/* signed qty ต่อประเภท — ต้องตรงกับ stock-balance.js / stock-dashboard.js */
function signedQty(m) {
  const q = +m.qty || 0;
  return m.movement_type === "OUT" || m.movement_type === "INTERNAL" ? -q : q;
}

function buildOnHand() {
  const map = {};
  state.movements.forEach((m) => {
    if (m.product_id == null || m.warehouse_id == null) return;
    const k = `${m.product_id}_${m.warehouse_id}`;
    map[k] = (map[k] || 0) + signedQty(m);
  });
  state.onHand = map;
}

const onHandOf = (pid, whId) => (whId ? state.onHand[`${pid}_${whId}`] || 0 : 0);

async function loadTxns() {
  const [txns, lines] = await Promise.all([
    sbFetchAll("withdraw_txns?select=*&order=txn_date.desc,id.desc"),
    sbFetchAll("withdraw_txn_lines?select=*&order=txn_id.asc,line_no.asc"),
  ]);
  state.txns = txns || [];
  state.lines = lines || [];
  state.txnById = {};
  state.txns.forEach((t) => (state.txnById[t.id] = t));
  state.linesByTxn = {};
  state.lines.forEach((l) => (state.linesByTxn[l.txn_id] ||= []).push(l));
  fillRequesterList();
}

/* ============================================================
   DROPDOWNS
   ============================================================ */
function fillCategorySelects() {
  const keep = val("fCategory");
  const opts = state.categories
    .filter((c) => c.is_active !== false)
    .map((c) => `<option value="${c.id}">${esc((c.icon ? c.icon + " " : "") + c.cat_name)}</option>`)
    .join("");
  $("fCategory").innerHTML = opts || `<option value="">— ยังไม่มีประเภท (กด ⚙️ จัดการ) —</option>`;
  if (keep && state.categories.some((c) => String(c.id) === keep)) $("fCategory").value = keep;

  const keepHis = val("hisCategory");
  $("hisCategory").innerHTML =
    `<option value="">🧿 ทุกประเภท</option>` +
    state.categories.map((c) => `<option value="${c.id}">${esc((c.icon ? c.icon + " " : "") + c.cat_name)}</option>`).join("");
  if (keepHis) $("hisCategory").value = keepHis;

}

/* ผู้เบิกที่เคยพิมพ์ไปแล้ว → datalist ให้เลือกซ้ำได้ ไม่ต้องพิมพ์ใหม่ทุกครั้ง
   (ไม่ทำเป็นตาราง master เพราะชีตเดิมก็พิมพ์อิสระ ชื่อคน/สาขาปนกัน) */
function fillRequesterList() {
  const seen = [...new Set(state.txns.map((t) => (t.requester || "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "th"));
  $("wdRequesterList").innerHTML = seen.map((r) => `<option value="${esc(r)}"></option>`).join("");
}

function fillWarehouseSelect() {
  const saved = localStorage.getItem("wd_warehouse") || "";
  const keep = val("fWarehouse") || saved;
  $("fWarehouse").innerHTML = state.warehouses.length
    ? state.warehouses
        .map((w) => `<option value="${w.warehouse_id}">${esc(w.warehouse_name || w.warehouse_code)}</option>`)
        .join("")
    : `<option value="">— ยังไม่มีคลัง —</option>`;
  if (keep && state.warehouses.some((w) => String(w.warehouse_id) === String(keep))) {
    $("fWarehouse").value = String(keep);
  }
}

/* ============================================================
   TAB 1 — ตารางกรอกจำนวน
   ============================================================ */
const priceOf = (it) => +it.price || 0;
const itemById = () => Object.fromEntries(state.items.map((it) => [it.id, it]));

function renderItemTable() {
  const body = $("wdItemBody");
  const search = norm(val("fltItem"));
  const onlyFilled = $("fltOnlyFilled")?.checked;
  const whId = val("fWarehouse");

  const all = state.items;
  const rows = all.filter((it) => {
    if (onlyFilled && !(+state.qtyDraft[it.id] > 0)) return false;
    if (!search) return true;
    return norm(it.item_code).includes(search) || norm(it.item_name).includes(search);
  });

  $("wdItemCount").textContent = `${rows.length} รายการ${rows.length !== all.length ? ` (จาก ${all.length})` : ""}`;

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="7" class="wd-empty">
      <span class="wd-empty-icon">📦</span>
      ${all.length
        ? "ไม่พบสินค้าที่ตรงกับเงื่อนไข"
        : "ยังไม่มีสินค้าให้เบิก — เพิ่มได้ที่หน้า “ตรวจนับ Stock F.3” → ปุ่ม 📦 รายการสินค้า"}
    </td></tr>`;
    updateEntryTotals();
    return;
  }

  body.innerHTML = rows
    .map((it, i) => {
      const price = priceOf(it);
      const qty = +state.qtyDraft[it.id] || 0;
      /* ยอดคงเหลือมาจาก stock_movements ซึ่งผูก catalog — สินค้าที่ยังไม่ผูกไม่มียอดให้เทียบ
         แสดง "—" ตรง ๆ ดีกว่าโชว์ 0 ซึ่งอ่านได้ว่า "ของหมด" ทั้งที่แค่ยังไม่ได้ผูก */
      const linked = it.product_id != null;
      const stock = linked ? onHandOf(it.product_id, whId) + (+state.editQtyByItem[it.id] || 0) : null;
      const stockCls = !linked ? "" : stock < 0 ? "wd-neg" : stock === 0 ? "wd-low" : "";
      const over = linked && qty > stock;
      return `<tr class="${qty > 0 ? "wd-row-filled" : ""}" data-iid="${it.id}">
        <td class="wd-col-no">${i + 1}</td>
        <td class="wd-code">${esc(it.item_code || "—")}</td>
        <td>${esc(it.item_name || "")}</td>
        <td class="wd-num">${price ? fmtMoney(price) : `<span style="color:var(--text3)">—</span>`}</td>
        <td class="wd-num">${
          linked
            ? `<span class="wd-onhand ${stockCls}">${fmtQty(stock)}</span>`
            : `<span class="wd-onhand" style="color:var(--text3)" title="สินค้านี้ยังไม่ได้ผูกกับ catalog — บันทึกเบิกได้ แต่ระบบจะไม่ตัดสต็อกให้">—</span>`
        }</td>
        <td class="wd-col-qty">
          <input class="form-control wd-qty-input ${over ? "wd-over" : ""}" type="number" min="0" step="any"
                 value="${qty || ""}" placeholder="0"
                 data-iid="${it.id}" data-price="${price}" data-stock="${linked ? stock : ""}"
                 oninput="window.onQtyInput(this)" />
        </td>
        <td class="wd-num" data-amt="${it.id}">${qty ? fmtMoney(qty * price) : "0.00"}</td>
      </tr>`;
    })
    .join("");

  updateEntryTotals();
}

window.onQtyInput = function (input) {
  const iid = input.dataset.iid;
  const price = +input.dataset.price || 0;
  const qty = +input.value || 0;

  if (qty > 0) state.qtyDraft[iid] = qty;
  else delete state.qtyDraft[iid];

  /* data-stock ว่าง = สินค้ายังไม่ผูก catalog → ไม่มีเพดานให้เตือนเกิน */
  const hasStock = input.dataset.stock !== "";
  input.classList.toggle("wd-over", hasStock && qty > (+input.dataset.stock || 0));
  input.closest("tr")?.classList.toggle("wd-row-filled", qty > 0);
  const amtCell = document.querySelector(`[data-amt="${iid}"]`);
  if (amtCell) amtCell.textContent = qty ? fmtMoney(qty * price) : "0.00";

  updateEntryTotals();
};

function updateEntryTotals() {
  let qty = 0;
  let amount = 0;
  const byId = itemById();
  Object.entries(state.qtyDraft).forEach(([iid, q]) => {
    const it = byId[iid];
    if (!it) return;
    qty += +q || 0;
    amount += (+q || 0) * priceOf(it);
  });
  $("wdSumQty").textContent = fmtQty(qty);
  $("wdSumAmount").textContent = fmtMoney(amount);
}

window.clearQty = function () {
  state.qtyDraft = {};
  renderItemTable();
};

/* ============================================================
   TAB 1 — บันทึก / แก้ไข
   ============================================================ */
window.saveEntry = async function () {
  const editing = !!state.editId;
  if (!can(editing ? "withdraw_edit" : "withdraw_create")) {
    return toast(editing ? "ไม่มีสิทธิ์แก้ไข" : "ไม่มีสิทธิ์บันทึก", "error");
  }

  const date = val("fDate");
  const catId = val("fCategory");
  const whId = val("fWarehouse");
  if (!date) return toast("กรุณาเลือกวันที่", "error");
  if (!catId) return toast("กรุณาเลือกประเภทการเบิก", "error");
  if (!whId) return toast("กรุณาเลือกคลังที่เบิก", "error");

  const byId = itemById();
  const picked = Object.entries(state.qtyDraft)
    .map(([iid, q]) => ({ it: byId[iid], qty: +q || 0 }))
    .filter((r) => r.it && r.qty > 0);

  if (!picked.length) return toast("ยังไม่ได้กรอกจำนวนสินค้าที่จะเบิก", "error");

  /* สต็อกไม่พอ — บล็อกเมื่อระบบตั้งค่าห้ามติดลบ (ตรงกับ stock-balance)
     เช็คได้เฉพาะตัวที่ผูก catalog · ตัวที่ไม่ผูกไม่มียอดในระบบให้เทียบ จึงไม่บล็อก */
  if (!state.allowNegative) {
    const short = picked.filter(
      (r) =>
        r.it.product_id != null &&
        r.qty > onHandOf(r.it.product_id, whId) + (+state.editQtyByItem[r.it.id] || 0)
    );
    if (short.length) {
      return toast(
        `สต็อกไม่พอ ${short.length} รายการ (เช่น ${short[0].it.item_name}) — ระบบตั้งค่าห้ามสต็อกติดลบ`,
        "error"
      );
    }
  }

  const cat = state.categories.find((c) => String(c.id) === catId);
  const wh = state.warehouses.find((w) => String(w.warehouse_id) === String(whId));
  const me = currentUser();

  const header = {
    txn_date: date,
    category_id: Number(catId),
    category_name: cat?.cat_name || null,
    warehouse_id: Number(whId),
    warehouse_name: wh?.warehouse_name || wh?.warehouse_code || null,
    requester: val("fRequester") || null,
    note: val("fNote") || null,
  };

  showLoading(true);
  try {
    let txnId = state.editId;

    if (editing) {
      /* แก้ไข = ถอนของเดิมออกให้หมดก่อน (movement + บรรทัด) แล้วเขียนใหม่ */
      const oldLines = state.linesByTxn[txnId] || [];
      const oldMoveIds = oldLines.map((l) => l.movement_id).filter(Boolean);
      if (oldMoveIds.length) {
        await sbFetch(`stock_movements?movement_id=in.(${oldMoveIds.join(",")})`, { method: "DELETE" });
      }
      await sbFetch(`withdraw_txn_lines?txn_id=eq.${txnId}`, { method: "DELETE" });
      await sbFetch(`withdraw_txns?id=eq.${txnId}`, { method: "PATCH", body: JSON.stringify(header) });
    } else {
      header.created_by = me?.user_id ? Number(me.user_id) : null;
      header.created_by_name = me?.full_name || me?.username || null;
      const ins = await sbInsert("withdraw_txns", [header]);
      txnId = ins?.[0]?.id;
      if (!txnId) throw new Error("สร้างรายการไม่สำเร็จ");
    }

    /* 1) เขียน stock_movements ก่อน เพื่อเอา movement_id มาผูกกับบรรทัด
          เฉพาะสินค้าที่ผูก catalog — ตัวที่ไม่ผูกไม่มี product_id ให้ movement อ้าง
          (ดูหมายเหตุหัวไฟล์: ตัวที่ไม่ตัดสต็อก หน้าตรวจนับจะดึงไปบวกกลับให้เอง) */
    const movedAt = new Date(`${date}T12:00:00+07:00`).toISOString(); // เที่ยงวันไทย — กันวันเพี้ยนข้าม TZ
    const noteText = [cat?.cat_name, val("fNote")].filter(Boolean).join(" · ");
    const linked = picked.filter((r) => r.it.product_id != null);
    const moves = linked.length
      ? await sbInsert(
          "stock_movements",
          linked.map((r) => ({
            product_id: r.it.product_id,
            warehouse_id: Number(whId),
            movement_type: "INTERNAL",
            qty: r.qty,
            moved_at: movedAt,
            ref_doc_type: MOVE_REF_TYPE,
            ref_doc_id: String(txnId),
            note: noteText || null,
          }))
        )
      : [];

    /* 2) บรรทัด (snapshot รหัส/ชื่อ/ราคา + movement_id ที่เพิ่งได้)
          จับคู่ด้วย product_id ไม่ใช่ลำดับ index — สินค้าห้ามซ้ำในบิลอยู่แล้ว
          (qtyDraft คีย์เดียวต่อสินค้า) และไม่ต้องพึ่งลำดับที่ PostgREST ตอบกลับ */
    const moveByPid = {};
    (moves || []).forEach((m) => (moveByPid[m.product_id] = m.movement_id));
    await sbInsert(
      "withdraw_txn_lines",
      picked.map((r, i) => ({
        txn_id: txnId,
        item_id: r.it.id,
        product_id: r.it.product_id ?? null,
        item_code: r.it.item_code || null,
        item_name: r.it.item_name || "",
        price: priceOf(r.it),
        qty: r.qty,
        movement_id: r.it.product_id != null ? moveByPid[r.it.product_id] ?? null : null,
        line_no: i + 1,
      }))
    );

    const unlinked = picked.length - linked.length;
    const tail = unlinked
      ? ` · ตัดสต็อก ${linked.length} รายการ (อีก ${unlinked} ยังไม่ผูก catalog จึงไม่ตัด)`
      : " · ตัดสต็อกแล้ว";
    toast(editing ? "✅ แก้ไขรายการแล้ว" + tail : `✅ บันทึกเบิก ${picked.length} รายการ` + tail);
    resetEntryState();
    await Promise.all([loadMovements(), loadTxns()]);
    renderItemTable();
    renderCatTabs();
    renderReport();
    renderHistory();
    updateStats();
  } catch (e) {
    console.error(e);
    toast(explainError(e), "error");
  } finally {
    showLoading(false);
  }
};

function resetEntryState() {
  state.editId = null;
  state.qtyDraft = {};
  state.editQtyByItem = {};
  $("fEditId").value = "";
  $("fRequester").value = "";
  $("fNote").value = "";
  $("fDate").value = todayISO();
  $("wdFormCard").classList.remove("editing");
  $("wdFormTitle").textContent = "📝 บันทึกรายการเบิก";
  $("wdSaveBtn").textContent = "💾 Save ข้อมูล";
  $("wdCancelEditBtn").style.display = "none";
  if ($("fltOnlyFilled")) $("fltOnlyFilled").checked = false;
}

window.resetEntry = function () {
  resetEntryState();
  renderItemTable();
};

window.editTxn = function (id) {
  if (!can("withdraw_edit")) return toast("ไม่มีสิทธิ์แก้ไข", "error");
  const t = state.txns.find((x) => String(x.id) === String(id));
  if (!t) return;

  state.editId = t.id;
  state.qtyDraft = {};
  state.editQtyByItem = {};
  (state.linesByTxn[t.id] || []).forEach((l) => {
    if (l.item_id == null) return;   // สินค้าถูกลบจาก master → แก้จำนวนไม่ได้ (บรรทัดเดิมยังอยู่)
    state.qtyDraft[l.item_id] = +l.qty || 0;
    state.editQtyByItem[l.item_id] = +l.qty || 0;
  });

  $("fEditId").value = t.id;
  $("fDate").value = t.txn_date || todayISO();
  if (t.category_id) $("fCategory").value = String(t.category_id);
  if (t.warehouse_id) $("fWarehouse").value = String(t.warehouse_id);
  $("fRequester").value = t.requester || "";
  $("fNote").value = t.note || "";

  $("wdFormCard").classList.add("editing");
  $("wdFormTitle").textContent = `✏️ แก้ไขรายการเบิก #${t.id}`;
  $("wdSaveBtn").textContent = "💾 บันทึกการแก้ไข";
  $("wdCancelEditBtn").style.display = "";

  window.switchTab("entry");
  renderItemTable();
  $("wdFormCard").scrollIntoView({ behavior: "smooth", block: "start" });
};

/* ลบบิล = ลบ movement ที่ผูกไว้ด้วยเสมอ (บรรทัด cascade ตาม txn) */
async function deleteTxnIds(ids) {
  const moveIds = ids
    .flatMap((id) => state.linesByTxn[id] || [])
    .map((l) => l.movement_id)
    .filter(Boolean);
  if (moveIds.length) {
    await sbFetch(`stock_movements?movement_id=in.(${moveIds.join(",")})`, { method: "DELETE" });
  }
  await sbFetch(`withdraw_txns?id=in.(${ids.join(",")})`, { method: "DELETE" });
}

window.deleteTxn = function (id) {
  if (!can("withdraw_delete")) return toast("ไม่มีสิทธิ์ลบ", "error");
  const t = state.txns.find((x) => String(x.id) === String(id));
  if (!t) return;
  const lines = state.linesByTxn[t.id] || [];
  DeleteModal.open(
    `ลบรายการเบิก "${t.category_name || "-"}" วันที่ ${fmtDate(t.txn_date)} (${lines.length} สินค้า) ? ` +
      `สต็อกที่ตัดไปจะถูกคืนกลับให้`,
    async () => {
      showLoading(true);
      try {
        await deleteTxnIds([t.id]);
        if (String(state.editId) === String(t.id)) resetEntryState();
        state.selected.delete(t.id);
        await Promise.all([loadMovements(), loadTxns()]);
        renderItemTable();
        renderReport();
        renderHistory();
        updateStats();
        toast("ลบแล้ว · คืนสต็อกให้เรียบร้อย");
      } catch (e) {
        console.error(e);
        toast("ลบไม่สำเร็จ: " + e.message, "error");
      } finally {
        showLoading(false);
      }
    }
  );
};

window.bulkDelete = async function () {
  if (!can("withdraw_delete")) return toast("ไม่มีสิทธิ์ลบ", "error");
  const ids = [...state.selected];
  if (!ids.length) return;
  const ok = await ConfirmModal.open({
    title: "ลบรายการที่เลือก",
    message: `ลบรายการเบิก ${ids.length} รายการ? สต็อกที่ตัดไปจะถูกคืนกลับให้`,
    icon: "🗑",
    okText: "ลบเลย",
    tone: "danger",
    note: "⚠️ การลบนี้ถาวร กู้คืนไม่ได้",
  });
  if (!ok) return;

  showLoading(true);
  try {
    await deleteTxnIds(ids);
    if (ids.some((id) => String(id) === String(state.editId))) resetEntryState();
    clearSelection();
    await Promise.all([loadMovements(), loadTxns()]);
    renderItemTable();
    renderReport();
    renderHistory();
    updateStats();
    toast(`ลบ ${ids.length} รายการแล้ว · คืนสต็อกให้เรียบร้อย`);
  } catch (e) {
    console.error(e);
    toast("ลบไม่สำเร็จ: " + e.message, "error");
  } finally {
    showLoading(false);
  }
};

/* ============================================================
   TAB 2 — รายงานเมทริกซ์ (สินค้า × วันที่)
   ============================================================ */
function renderCatTabs() {
  const wrap = $("wdCatTabs");
  const month = val("rptMonth");
  const inMonth = state.lines.filter((l) => monthOf(txnOf(l)?.txn_date) === month);

  const countFor = (catId) =>
    inMonth.filter((l) => catId === "all" || String(txnOf(l)?.category_id) === String(catId))
      .reduce((s, l) => s + (+l.qty || 0), 0);

  const tabs = [{ id: "all", label: "📋 ทุกประเภท" }].concat(
    state.categories.map((c) => ({ id: String(c.id), label: `${c.icon || "🏷️"} ${c.cat_name}` }))
  );

  wrap.innerHTML = tabs
    .map((t) => {
      const n = countFor(t.id);
      return `<button class="wd-cat-tab ${String(state.reportCatId) === t.id ? "active" : ""}"
        onclick="window.setReportCat('${t.id}')">${esc(t.label)}<span class="wd-cat-n">${fmtQty(n)}</span></button>`;
    })
    .join("");
}

const txnOf = (line) => state.txnById[line.txn_id];

window.setReportCat = function (catId) {
  state.reportCatId = catId;
  renderCatTabs();
  renderReport();
};

/* รวมบรรทัดของเดือน/ประเภทที่เลือก → แถวละสินค้า, ช่องละวัน */
function buildMatrix() {
  const month = val("rptMonth") || monthOf(todayISO());
  const nDays = daysInMonth(month);
  const search = norm(val("rptSearch"));
  const hideZero = $("rptHideZero")?.checked;

  const rowsMap = {};
  state.lines.forEach((l) => {
    const t = state.txnById[l.txn_id];
    if (!t || monthOf(t.txn_date) !== month) return;
    if (state.reportCatId !== "all" && String(t.category_id) !== String(state.reportCatId)) return;

    const key = l.item_id != null ? `i${l.item_id}` : `n${norm(l.item_name)}`;
    const row = (rowsMap[key] ||= {
      key,
      code: l.item_code || "",
      name: l.item_name || "",
      price: +l.price || 0,
      days: {},
      total: 0,
      value: 0,
    });
    const d = dayOf(t.txn_date);
    row.days[d] = (row.days[d] || 0) + (+l.qty || 0);
    row.total += +l.qty || 0;
    row.value += +l.amount || (+l.price || 0) * (+l.qty || 0);
  });

  let rows = Object.values(rowsMap);

  /* ไม่ซ่อนศูนย์ = โชว์รายการสินค้ากลางครบทุกแถว (เหมือนชีตที่มีรายการยืนพื้น) */
  if (!hideZero) {
    const seen = new Set(rows.map((r) => r.key));
    state.items.forEach((it) => {
      const key = `i${it.id}`;
      if (seen.has(key)) return;
      rows.push({
        key,
        code: it.item_code || "",
        name: it.item_name || "",
        price: priceOf(it),
        days: {},
        total: 0,
        value: 0,
      });
    });
  }

  if (search) rows = rows.filter((r) => norm(r.code).includes(search) || norm(r.name).includes(search));

  /* เรียงตามลำดับใน master กลาง (ให้ตรงกับตารางกรอกและชีตเดิม)
     ที่เหลือ (สินค้าที่ถูกลบออกจาก master ไปแล้ว) ต่อท้ายโดยเรียงตามรหัส */
  const rank = {};
  state.items.forEach((it, i) => (rank[`i${it.id}`] = +it.sort_order || i + 1));
  rows.sort(
    (a, b) =>
      (rank[a.key] ?? Infinity) - (rank[b.key] ?? Infinity) ||
      String(a.code).localeCompare(String(b.code), "th") ||
      String(a.name).localeCompare(String(b.name), "th")
  );

  return { month, nDays, rows };
}

function renderReport() {
  const { month, nDays, rows } = buildMatrix();
  const [y, m] = month.split("-").map(Number);

  const dayTh = [];
  for (let d = 1; d <= nDays; d++) {
    const dow = new Date(y, m - 1, d).getDay(); // 0=อา, 6=ส
    const weekend = dow === 0 || dow === 6;
    dayTh.push(`<th class="wd-col-day ${weekend ? "wd-day-weekend" : ""}" title="วันที่ ${d}">${d}</th>`);
  }

  $("wdMatrixHead").innerHTML = `<tr>
    <th class="wd-col-no wd-sticky-1">ลำดับ</th>
    <th class="wd-col-code wd-sticky-2">รหัสสินค้า</th>
    <th class="wd-name-cell wd-sticky-3">รายละเอียด</th>
    ${dayTh.join("")}
    <th class="wd-col-total">รวมเบิก</th>
    <th class="wd-col-value">มูลค่า</th>
  </tr>`;

  applyStickyOffsets();
  $("wdReportCount").textContent = `${rows.length} รายการ`;

  if (!rows.length) {
    $("wdMatrixBody").innerHTML = `<tr><td colspan="${nDays + 5}" class="wd-empty">
      <span class="wd-empty-icon">📊</span>ยังไม่มีการเบิกในเดือนนี้
    </td></tr>`;
    $("wdMatrixFoot").innerHTML = "";
    return;
  }

  $("wdMatrixBody").innerHTML = rows
    .map((r, i) => {
      const cells = [];
      for (let d = 1; d <= nDays; d++) {
        const q = r.days[d] || 0;
        cells.push(`<td class="wd-col-day ${q ? "" : "wd-day-zero"}">${q ? fmtQty(q) : "·"}</td>`);
      }
      return `<tr>
        <td class="wd-col-no wd-sticky-1">${i + 1}</td>
        <td class="wd-code wd-sticky-2">${esc(r.code || "—")}</td>
        <td class="wd-name-cell wd-sticky-3">${esc(r.name)}</td>
        ${cells.join("")}
        <td class="wd-col-total">${fmtQty(r.total)}</td>
        <td class="wd-col-value">${fmtMoney(r.value)}</td>
      </tr>`;
    })
    .join("");

  /* แถวรวมรายวัน */
  const dayTotals = [];
  let grandQty = 0;
  let grandValue = 0;
  for (let d = 1; d <= nDays; d++) {
    const sum = rows.reduce((s, r) => s + (r.days[d] || 0), 0);
    grandQty += sum;
    dayTotals.push(`<td class="wd-col-day ${sum ? "" : "wd-day-zero"}">${sum ? fmtQty(sum) : "·"}</td>`);
  }
  grandValue = rows.reduce((s, r) => s + r.value, 0);

  $("wdMatrixFoot").innerHTML = `<tr>
    <td class="wd-sticky-1"></td>
    <td class="wd-sticky-2"></td>
    <td class="wd-foot-label wd-sticky-3">รวมรายวัน</td>
    ${dayTotals.join("")}
    <td class="wd-col-total">${fmtQty(grandQty)}</td>
    <td class="wd-col-value">${fmtMoney(grandValue)}</td>
  </tr>`;
}

/* คอลัมน์ซ้าย 3 ช่อง (ลำดับ/รหัส/รายละเอียด) ตรึงตอนเลื่อนแนวนอน —
   ระยะ left ต้องวัดจากความกว้างจริงหลัง render (ตั้งค่าตายตัวใน CSS แล้วเหลื่อม)
   ใช้ offsetWidth ซึ่งเป็น layout px ชุดเดียวกับที่ CSS left ใช้ → zoom ที่ :root ไม่กวน */
function applyStickyOffsets() {
  const ths = $("wdMatrixHead").querySelectorAll("th");
  if (ths.length < 3) return;
  const table = $("wdMatrixTable");
  table.style.setProperty("--wd-left-2", `${ths[0].offsetWidth}px`);
  table.style.setProperty("--wd-left-3", `${ths[0].offsetWidth + ths[1].offsetWidth}px`);
}

window.exportReport = function () {
  const { month, nDays, rows } = buildMatrix();
  if (!rows.length) return toast("ไม่มีข้อมูลให้ export", "warning");
  if (!window.XLSX) return toast("โหลดตัวช่วย Excel ไม่สำเร็จ", "error");

  const catName =
    state.reportCatId === "all"
      ? "ทุกประเภท"
      : state.categories.find((c) => String(c.id) === String(state.reportCatId))?.cat_name || "";

  const head = ["ลำดับ", "รหัสสินค้า", "รายละเอียด"];
  for (let d = 1; d <= nDays; d++) head.push(d);
  head.push("รวมเบิก", "มูลค่า");

  const body = rows.map((r, i) => {
    const line = [i + 1, r.code, r.name];
    for (let d = 1; d <= nDays; d++) line.push(r.days[d] || "");
    line.push(r.total, r.value);
    return line;
  });

  const foot = ["", "", "รวมรายวัน"];
  for (let d = 1; d <= nDays; d++) foot.push(rows.reduce((s, r) => s + (r.days[d] || 0), 0) || "");
  foot.push(
    rows.reduce((s, r) => s + r.total, 0),
    rows.reduce((s, r) => s + r.value, 0)
  );

  const aoa = [[`รายงานเบิกสินค้า · ${catName} · เดือน ${month}`], [], head, ...body, foot];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, catName.slice(0, 28) || "report");
  XLSX.writeFile(wb, `withdraw_${catName}_${month}.xlsx`);
  toast(`📥 Export ${rows.length} รายการ`);
};

/* ============================================================
   TAB 3 — ประวัติรายการ
   ============================================================ */
function historyRows() {
  const search = norm(val("hisSearch"));
  const catId = val("hisCategory");
  const from = val("hisFrom");
  const to = val("hisTo");

  return state.txns.filter((t) => {
    if (catId && String(t.category_id) !== catId) return false;
    if (from && String(t.txn_date) < from) return false;
    if (to && String(t.txn_date) > to) return false;
    if (!search) return true;
    const lines = state.linesByTxn[t.id] || [];
    return (
      norm(t.note).includes(search) ||
      norm(t.category_name).includes(search) ||
      norm(t.created_by_name).includes(search) ||
      lines.some((l) => norm(l.item_name).includes(search) || norm(l.item_code).includes(search))
    );
  });
}

const sumQty = (lines) => lines.reduce((s, l) => s + (+l.qty || 0), 0);
const sumAmount = (lines) => lines.reduce((s, l) => s + (+l.amount || (+l.price || 0) * (+l.qty || 0)), 0);

function renderHistory() {
  const rows = historyRows();
  $("wdHistCount").textContent = `${rows.length} รายการ`;
  $("nHistory").textContent = state.txns.length;

  const body = $("wdHistBody");
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="9" class="wd-empty">
      <span class="wd-empty-icon">🧾</span>ยังไม่มีรายการที่ตรงกับเงื่อนไข
    </td></tr>`;
    updateBulkBar();
    return;
  }

  body.innerHTML = rows
    .map((t) => {
      const lines = state.linesByTxn[t.id] || [];
      const preview = lines
        .slice(0, 3)
        .map((l) => `<strong>${esc(l.item_name)}</strong> ×${fmtQty(l.qty)}`)
        .join(" · ");
      const more = lines.length > 3 ? ` · +อีก ${lines.length - 3} รายการ` : "";
      const cat = state.categories.find((c) => String(c.id) === String(t.category_id));
      return `<tr>
        <td class="wd-col-chk">
          <input type="checkbox" ${state.selected.has(t.id) ? "checked" : ""}
                 onchange="window.toggleSelect(${t.id}, this.checked)" />
        </td>
        <td>${fmtDate(t.txn_date)}</td>
        <td><span class="wd-chip">${esc((cat?.icon || "🏷️") + " " + (t.category_name || "—"))}</span></td>
        <td><span class="wd-chip wd-chip-muted">${esc(t.warehouse_name || "—")}</span></td>
        <td class="wd-items-cell">${preview || "—"}${more}</td>
        <td class="wd-num">${fmtQty(sumQty(lines))}</td>
        <td class="wd-num">${fmtMoney(sumAmount(lines))}</td>
        <td>${esc(t.created_by_name || "—")}</td>
        <td class="wd-col-act">
          <button class="wd-icon-btn" title="ดูรายละเอียด" onclick="window.openDetail(${t.id})">👁</button>
          <button class="wd-icon-btn" title="แก้ไข" data-perm="withdraw_edit"
                  onclick="window.editTxn(${t.id})">✏️</button>
          <button class="wd-icon-btn wd-danger" title="ลบ" data-perm="withdraw_delete"
                  onclick="window.deleteTxn(${t.id})">🗑</button>
        </td>
      </tr>`;
    })
    .join("");

  applyPerms(body);
  updateBulkBar();
}

window.clearHistoryFilters = function () {
  ["hisSearch", "hisFrom", "hisTo"].forEach((id) => ($(id).value = ""));
  $("hisCategory").value = "";
  renderHistory();
};

/* ── เลือกหลายแถว ── */
window.toggleSelect = function (id, on) {
  if (on) state.selected.add(id);
  else state.selected.delete(id);
  updateBulkBar();
};

window.toggleSelectAll = function (on) {
  const rows = historyRows();
  if (on) rows.forEach((t) => state.selected.add(t.id));
  else rows.forEach((t) => state.selected.delete(t.id));
  renderHistory();
};

window.clearSelection = function () {
  state.selected.clear();
  renderHistory();
};

function updateBulkBar() {
  const ids = [...state.selected];
  $("wdBulkBar").style.display = ids.length ? "" : "none";
  $("wdBulkCount").textContent = ids.length;
  $("wdBulkQty").textContent = fmtQty(
    ids.reduce((s, id) => s + sumQty(state.linesByTxn[id] || []), 0)
  );
  const rows = historyRows();
  const all = $("wdChkAll");
  if (all) all.checked = rows.length > 0 && rows.every((t) => state.selected.has(t.id));
  applyPerms($("wdBulkBar"));
}

window.exportHistory = function () {
  const rows = historyRows();
  if (!rows.length) return toast("ไม่มีข้อมูลให้ export", "warning");
  if (!window.XLSX) return toast("โหลดตัวช่วย Excel ไม่สำเร็จ", "error");

  const head = ["วันที่", "ประเภท", "คลัง", "รหัสสินค้า", "ชื่อสินค้า", "ราคา", "จำนวน", "มูลค่า", "หมายเหตุ", "ผู้บันทึก"];
  const body = [];
  rows.forEach((t) => {
    (state.linesByTxn[t.id] || []).forEach((l) => {
      body.push([
        fmtDate(t.txn_date),
        t.category_name || "",
        t.warehouse_name || "",
        l.item_code || "",
        l.item_name || "",
        +l.price || 0,
        +l.qty || 0,
        +l.amount || (+l.price || 0) * (+l.qty || 0),
        t.note || "",
        t.created_by_name || "",
      ]);
    });
  });

  const ws = XLSX.utils.aoa_to_sheet([head, ...body]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "withdraw");
  XLSX.writeFile(wb, `withdraw_history_${todayISO()}.xlsx`);
  toast(`📥 Export ${body.length} บรรทัด`);
};

/* ── โมดัลรายละเอียด ── */
window.openDetail = function (id) {
  const t = state.txns.find((x) => String(x.id) === String(id));
  if (!t) return;
  const lines = state.linesByTxn[t.id] || [];

  $("dtlMeta").innerHTML = `
    <span>📅 <strong>${fmtDate(t.txn_date)}</strong></span>
    <span>🏷️ <strong>${esc(t.category_name || "—")}</strong></span>
    <span>🏭 <strong>${esc(t.warehouse_name || "—")}</strong></span>
    <span>📦 รวม <strong>${fmtQty(sumQty(lines))}</strong> ชิ้น</span>
    <span>💰 <strong>${fmtMoney(sumAmount(lines))}</strong> บาท</span>
    <span>✍️ ${esc(t.created_by_name || "—")}</span>
    ${t.note ? `<span>💬 ${esc(t.note)}</span>` : ""}`;

  $("dtlBody").innerHTML = lines.length
    ? lines
        .map(
          (l, i) => `<tr>
            <td class="wd-col-no">${i + 1}</td>
            <td class="wd-code">${esc(l.item_code || "—")}</td>
            <td>${esc(l.item_name)}</td>
            <td class="wd-num">${fmtMoney(l.price)}</td>
            <td class="wd-num">${fmtQty(l.qty)}</td>
            <td class="wd-num">${fmtMoney(l.amount || (+l.price || 0) * (+l.qty || 0))}</td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="6" class="wd-empty">ไม่มีบรรทัดสินค้า</td></tr>`;

  $("detailModal").classList.add("open");
};

window.closeDetail = () => $("detailModal").classList.remove("open");

/* ============================================================
   MODAL — จัดการประเภทการเบิก (In-Context CRUD)
   ============================================================ */
window.openCategoryManager = function () {
  $("cmSearch").value = "";
  $("cmNewName").value = "";
  $("cmNewIcon").value = "";
  renderCategoryManager();
  $("categoryModal").classList.add("open");
  applyPerms($("categoryModal"));
};

window.closeCategoryManager = () => $("categoryModal").classList.remove("open");

window.renderCategoryManager = function () {
  const search = norm(val("cmSearch"));
  const rows = state.categories.filter((c) => !search || norm(c.cat_name).includes(search) || norm(c.cat_code).includes(search));
  const list = $("cmList");

  list.innerHTML = rows.length
    ? rows
        .map(
          (c) => `<div class="wd-manage-row wd-cat-row">
            <input class="form-control" id="cmName_${c.id}" value="${esc(c.cat_name)}" />
            <input class="form-control wd-icon-input" id="cmIcon_${c.id}" value="${esc(c.icon || "")}" maxlength="4" />
            <div class="wd-manage-actions">
              <button class="wd-icon-btn" title="บันทึก" data-perm="withdraw_edit"
                      onclick="window.updateCategory(${c.id})">💾</button>
              <button class="wd-icon-btn wd-danger" title="ลบ" data-perm="withdraw_delete"
                      onclick="window.deleteCategory(${c.id})">🗑</button>
            </div>
          </div>`
        )
        .join("")
    : `<div class="wd-empty">ยังไม่มีประเภทการเบิก</div>`;

  applyPerms(list);
};

/* รหัสสร้างเอง: ตัวอักษร A-Z จากชื่อ (ไทยไม่มี) → ไม่ได้ก็ CATn */
function genCatCode(name) {
  const letters = String(name).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
  const base = letters || `CAT${state.categories.length + 1}`;
  let code = base;
  let i = 2;
  while (state.categories.some((c) => norm(c.cat_code) === norm(code))) code = `${base}${i++}`;
  return code;
}

window.addCategory = async function () {
  if (!can("withdraw_create")) return toast("ไม่มีสิทธิ์เพิ่ม", "error");
  const name = val("cmNewName");
  if (!name) return toast("กรุณากรอกชื่อประเภท", "error");
  if (state.categories.some((c) => norm(c.cat_name) === norm(name))) return toast("มีประเภทนี้อยู่แล้ว", "error");

  try {
    const maxSort = state.categories.reduce((m, c) => Math.max(m, +c.sort_order || 0), 0);
    await sbInsert("withdraw_categories", [
      { cat_code: genCatCode(name), cat_name: name, icon: val("cmNewIcon") || "🏷️", sort_order: maxSort + 1 },
    ]);
    state.categories = (await sbJson("withdraw_categories?select=*&order=sort_order.asc,id.asc")) || [];
    $("cmNewName").value = "";
    $("cmNewIcon").value = "";
    fillCategorySelects();
    renderCategoryManager();
    renderCatTabs();
    toast("เพิ่มประเภทแล้ว");
  } catch (e) {
    console.error(e);
    toast("เพิ่มไม่สำเร็จ: " + e.message, "error");
  }
};

window.updateCategory = async function (id) {
  if (!can("withdraw_edit")) return toast("ไม่มีสิทธิ์แก้ไข", "error");
  const name = ($(`cmName_${id}`)?.value || "").trim();
  const icon = ($(`cmIcon_${id}`)?.value || "").trim();
  if (!name) return toast("ชื่อประเภทห้ามว่าง", "error");
  if (state.categories.some((c) => c.id !== id && norm(c.cat_name) === norm(name))) {
    return toast("ชื่อนี้ซ้ำกับประเภทอื่น", "error");
  }
  try {
    await sbFetch(`withdraw_categories?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify({ cat_name: name, icon: icon || null }),
    });
    const c = state.categories.find((x) => x.id === id);
    if (c) { c.cat_name = name; c.icon = icon || null; }
    fillCategorySelects();
    renderCatTabs();
    renderReport();
    toast("บันทึกแล้ว");
  } catch (e) {
    console.error(e);
    toast(explainError(e), "error");
  }
};

window.deleteCategory = function (id) {
  if (!can("withdraw_delete")) return toast("ไม่มีสิทธิ์ลบ", "error");
  const c = state.categories.find((x) => x.id === id);
  if (!c) return;
  const used = state.txns.filter((t) => String(t.category_id) === String(id)).length;
  DeleteModal.open(
    used
      ? `"${c.cat_name}" ถูกใช้ใน ${used} รายการแล้ว — ลบประเภทนี้? (รายการเก่ายังเก็บชื่อประเภทไว้ ไม่หาย)`
      : `ลบประเภท "${c.cat_name}" ?`,
    async () => {
      try {
        await sbFetch(`withdraw_categories?id=eq.${id}`, { method: "DELETE" });
        state.categories = state.categories.filter((x) => x.id !== id);
        fillCategorySelects();
        renderCategoryManager();
        renderCatTabs();
        renderReport();
        toast("ลบแล้ว");
      } catch (e) {
        console.error(e);
        toast("ลบไม่สำเร็จ: " + e.message, "error");
      }
    }
  );
};

/* ตั้งค่ารายการสินค้าย้ายไปอยู่หน้าตรวจนับ Stock F.3 แล้ว (master กลาง · sql/179)
   — ที่นั่นแก้แล้วมีผลทั้ง 3 หน้าพร้อมกัน จึงไม่ควรมี 2 ที่ให้แก้ */
window.openItemManager = function () {
  window.location.href = "./stock-check.html?items=1";
};

/* ============================================================
   STATS + TABS
   ============================================================ */
function updateStats() {
  const month = val("rptMonth") || monthOf(todayISO());
  const txnIds = new Set(state.txns.filter((t) => monthOf(t.txn_date) === month).map((t) => t.id));
  const lines = state.lines.filter((l) => txnIds.has(l.txn_id));

  const qty = lines.reduce((s, l) => s + (+l.qty || 0), 0);
  const value = lines.reduce((s, l) => s + (+l.amount || (+l.price || 0) * (+l.qty || 0)), 0);

  $("statQty").textContent = fmtQty(qty);
  $("statQtySub").textContent = `ชิ้น · เดือน ${month}`;
  $("statValue").textContent = fmtMoney(value);
  $("statTxn").textContent = txnIds.size;

  const byCat = {};
  state.txns
    .filter((t) => txnIds.has(t.id))
    .forEach((t) => {
      const q = sumQty(state.linesByTxn[t.id] || []);
      const k = t.category_name || "—";
      byCat[k] = (byCat[k] || 0) + q;
    });
  const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
  $("statTopCat").textContent = top ? top[0] : "—";
  $("statTopCatSub").textContent = top ? `${fmtQty(top[1])} ชิ้น` : "ยังไม่มีข้อมูล";
}

window.switchTab = function (tab) {
  document.querySelectorAll("#wdTabs .page-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
  ["entry", "report", "history"].forEach((t) => {
    $(`pane-${t}`).style.display = t === tab ? "" : "none";
  });
};

window.reloadAll = async function () {
  await loadAll();
  toast("รีเฟรชข้อมูลแล้ว");
};

/* ============================================================
   INIT
   ============================================================ */
window.addEventListener("DOMContentLoaded", () => {
  $("fDate").value = todayISO();
  $("rptMonth").value = monthOf(todayISO());

  /* แท็บ 1 */
  $("fltItem").addEventListener("input", renderItemTable);
  $("fltOnlyFilled").addEventListener("change", renderItemTable);
  $("fWarehouse").addEventListener("change", () => {
    localStorage.setItem("wd_warehouse", val("fWarehouse"));
    renderItemTable();
  });

  /* แท็บ 2 */
  $("rptMonth").addEventListener("change", () => {
    renderCatTabs();
    renderReport();
    updateStats();
  });
  $("rptSearch").addEventListener("input", renderReport);
  $("rptHideZero").addEventListener("change", renderReport);

  /* แท็บ 3 */
  ["hisSearch"].forEach((id) => $(id).addEventListener("input", renderHistory));
  ["hisCategory", "hisFrom", "hisTo"].forEach((id) => $(id).addEventListener("change", renderHistory));

  loadAll();
});
