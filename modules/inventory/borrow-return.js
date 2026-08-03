/* ============================================================
   borrow-return.js — ยืม / คืน สินค้า (แทน Google Sheet "ยืม-คืน")
   Tables: borrow_persons, borrow_txns, borrow_txn_lines (sql/176)
           + stock_items (sql/179)

   โครงงาน:
     แท็บ 1 บันทึก  — หัวบิล (วันที่ · ยืม/คืน · ชื่อคน) + ตารางสินค้าให้กรอกจำนวน
                      กด "Save ข้อมูล" ครั้งเดียว = 1 txn + หลายบรรทัด
     แท็บ 2 รายงาน  — เลือกคน → สรุปต่อสินค้า (ยืม · คืน · คงเหลือ = ยืม-คืน)
     แท็บ 3 ประวัติ — รายการที่บันทึกไว้ · ดู / แก้ / ลบ (มี bulk delete)

   รายการสินค้ามาจาก stock_items (master กลาง) ซึ่งใช้ร่วมกับหน้าตรวจนับสต็อก
   และหน้าเบิกสินค้า — แก้รหัส/ชื่อ/ราคา ได้ที่ปุ่ม "📦 รายการสินค้า" ในหน้า
   ตรวจนับ Stock F.3 ที่เดียว · หน้านี้อ่านอย่างเดียว

   บรรทัดเก็บ snapshot ชื่อสินค้า + ราคา ไว้ด้วย → แก้ master ทีหลังไม่ทับของเก่า
   ============================================================ */

const SB_URL = localStorage.getItem("sb_url") || "";
const SB_KEY = localStorage.getItem("sb_key") || "";

const TYPE_LABEL = { borrow: "ยืม", return: "คืน" };

const state = {
  items: [],        // master สินค้า
  persons: [],      // master ผู้ยืม
  txns: [],         // รายการ + lines (embedded)
  qty: new Map(),   // itemId → จำนวนที่กรอกในแท็บ 1 (คงค่าไว้แม้จะกรองตาราง)
  type: "borrow",
  editId: null,
  selected: new Set(),
  tab: "entry",
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
  setTimeout(() => el.classList.remove("show"), 3000);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

const fmtDate = (iso) => (window.DateFmt ? window.DateFmt.formatDMY(iso) : (iso || ""));
const fmtMoney = (n) =>
  Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/* จำนวนอาจเป็นทศนิยม (เช่น 0.5 กล่อง) — แสดงเท่าที่จำเป็น ไม่โชว์ .00 เปล่าๆ */
const fmtQty = (n) =>
  Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

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

/* ── Supabase REST ── */
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
async function sbFetchAll(path, page = 1000, max = 30000) {
  const all = [];
  for (let from = 0; from < max; from += page) {
    const res = await sbFetch(path, { headers: { Range: `${from}-${from + page - 1}` } });
    const chunk = await res.json();
    all.push(...chunk);
    if (chunk.length < page) break;
  }
  return all;
}

/* ============================================================
   LOAD
   ============================================================ */
/* โหลด "ทุกตัว" รวมที่ปิดใช้งานแล้ว — แล้วค่อยกรองตอนแสดงในฟอร์ม (visibleItems)
   สินค้าที่เลิกผลิตถูกปิดใช้งาน แต่ของยังค้างคืนอยู่กับคน → รายงานต้องหาราคา
   ปัจจุบันของมันเจอ ไม่งั้นตกไปใช้ราคา snapshot บนบรรทัดซึ่งเป็น 0
   (ชีตยืม-คืนเดิมไม่มีคอลัมน์ราคา) แล้วมูลค่าค้างคืนจะขึ้น ฿0 ทั้งที่ของมีมูลค่าจริง */
async function loadItems() {
  state.items = await sbFetchAll(
    "stock_items?select=*&order=sort_order.asc,item_name.asc"
  );
}

async function loadPersons() {
  state.persons = await sbFetchAll(
    "borrow_persons?select=*&is_active=eq.true&order=sort_order.asc,person_name.asc"
  );
}

async function loadTxns() {
  const rows = await sbFetchAll(
    "borrow_txns?select=*,lines:borrow_txn_lines(*)&order=txn_date.desc,id.desc"
  );
  rows.forEach((t) => {
    t.lines = (t.lines || []).sort((a, b) => (a.line_no || 0) - (b.line_no || 0));
  });
  state.txns = rows;
}

window.reloadAll = async function () {
  showLoading(true);
  try {
    await Promise.all([loadItems(), loadPersons(), loadTxns()]);
    fillPersonSelects();
    renderItemTable();
    renderReport();
    renderHistory();
    renderStats();
  } catch (e) {
    toast("โหลดข้อมูลไม่สำเร็จ: " + e.message, "error");
  } finally {
    showLoading(false);
  }
};

/* ============================================================
   TABS
   ============================================================ */
window.switchTab = function (tab) {
  state.tab = tab;
  document.querySelectorAll("#brTabs .page-tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
  ["entry", "report", "history"].forEach((t) => {
    const pane = $("pane-" + t);
    if (pane) pane.style.display = t === tab ? "" : "none";
  });
};

/* ============================================================
   COMBOBOX ผู้ยืม
   (<datalist> เบราว์เซอร์วาดเอง → คุม CSS ไม่ได้ จึงเขียนเอง)
   ============================================================ */
const COMBO_MAX = 60;

function comboHighlight(text, q) {
  const t = String(text ?? "");
  if (!q) return esc(t);
  const i = t.toLowerCase().indexOf(q);
  if (i < 0) return esc(t);
  return esc(t.slice(0, i)) + "<b>" + esc(t.slice(i, i + q.length)) + "</b>" + esc(t.slice(i + q.length));
}

function initPersonCombo() {
  const input = $("fPerson");
  if (!input) return;
  const wrap = input.closest(".br-combo");
  const caret = wrap.querySelector(".br-combo-caret");
  const menu = document.createElement("div");
  menu.className = "br-combo-menu";
  wrap.appendChild(menu);

  let items = [], active = -1;

  function render() {
    const q = input.value.trim().toLowerCase();
    const all = state.persons;
    const hit = q
      ? all
          .filter((p) => String(p.person_name).toLowerCase().includes(q))
          .sort(
            (a, b) =>
              String(a.person_name).toLowerCase().indexOf(q) -
              String(b.person_name).toLowerCase().indexOf(q)
          )
      : all;
    items = hit.slice(0, COMBO_MAX);
    active = -1;

    if (!all.length) {
      menu.innerHTML = `<div class="br-combo-empty">ยังไม่มีรายชื่อในระบบ — พิมพ์ชื่อได้เลย ระบบจะสร้างให้ตอนกด Save</div>`;
      return;
    }
    if (!items.length) {
      menu.innerHTML = `<div class="br-combo-empty">ไม่พบ “${esc(input.value.trim())}” — พิมพ์ต่อได้เลย ระบบจะสร้างชื่อใหม่ให้ตอนกด Save</div>`;
      return;
    }
    menu.innerHTML = items
      .map(
        (p, i) => `
        <div class="br-combo-item" data-i="${i}">
          <span class="br-combo-item-main">${comboHighlight(p.person_name, q)}</span>
          <span class="br-combo-item-sub">${p.person_type === "company" ? "🏢 บริษัท" : "👤 บุคคล"}</span>
        </div>`
      )
      .join("") +
      (hit.length > items.length
        ? `<div class="br-combo-empty">…อีก ${hit.length - items.length} รายการ — พิมพ์เพิ่มเพื่อกรอง</div>`
        : "");
  }

  function open() { wrap.classList.add("open"); render(); }
  function close() { wrap.classList.remove("open"); }

  function pick(i) {
    const p = items[i];
    if (!p) return;
    input.value = p.person_name;
    $("fPersonId").value = p.id;
    close();
  }

  input.addEventListener("focus", open);
  input.addEventListener("input", () => {
    $("fPersonId").value = "";   // พิมพ์เอง = ยังไม่ผูก master จนกว่าจะเลือก/บันทึก
    open();
  });
  caret.addEventListener("mousedown", (e) => {
    e.preventDefault();
    wrap.classList.contains("open") ? close() : (input.focus(), open());
  });
  menu.addEventListener("mousedown", (e) => {
    const row = e.target.closest(".br-combo-item");
    if (!row) return;
    e.preventDefault();
    pick(Number(row.dataset.i));
  });
  input.addEventListener("keydown", (e) => {
    if (!wrap.classList.contains("open")) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = Math.max(0, Math.min(items.length - 1, active + (e.key === "ArrowDown" ? 1 : -1)));
      menu.querySelectorAll(".br-combo-item").forEach((el, i) => el.classList.toggle("active", i === active));
      menu.querySelector(".br-combo-item.active")?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Escape") {
      close();
    }
  });
  document.addEventListener("mousedown", (e) => {
    if (!wrap.contains(e.target)) close();
  });
}

function fillPersonSelects() {
  const opts = state.persons
    .map((p) => `<option value="${p.id}">${esc(p.person_name)}</option>`)
    .join("");
  const rpt = $("rptPerson");
  const his = $("hisPerson");
  const keepR = rpt?.value || "";
  const keepH = his?.value || "";
  if (rpt) { rpt.innerHTML = `<option value="">👥 ทุกคน</option>` + opts; rpt.value = keepR; }
  if (his) { his.innerHTML = `<option value="">👥 ทุกคน</option>` + opts; his.value = keepH; }
}

/* ============================================================
   TAB 1 — ตารางกรอกจำนวน
   ============================================================ */
window.setType = function (type) {
  state.type = type;
  document.querySelectorAll("#fTypeToggle .br-type-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.type === type);
  });
};

/* ตารางกรอกโชว์เฉพาะสินค้าที่เปิดใช้งาน — ยกเว้นตัวที่กำลังกรอกจำนวนค้างอยู่
   (แก้บิลเก่าที่มีสินค้าซึ่งถูกปิดไปแล้ว ต้องยังเห็นแถวนั้นไม่งั้นจำนวนหายเงียบตอนกด Save) */
function visibleItems() {
  const q = norm(val("fltItem"));
  const onlyFilled = $("fltOnlyFilled")?.checked;
  return state.items.filter((it) => {
    const typed = num(state.qty.get(it.id)) > 0;
    if (it.is_active === false && !typed) return false;
    if (q && !norm(it.item_name).includes(q) && !norm(it.item_code).includes(q)) return false;
    if (onlyFilled && !typed) return false;
    return true;
  });
}

function renderItemTable() {
  const body = $("brItemBody");
  if (!body) return;
  const rows = visibleItems();
  $("brItemCount").textContent = `${rows.length} รายการ`;

  if (!state.items.length) {
    body.innerHTML = `<tr><td colspan="6" class="br-empty">
      <span class="br-empty-icon">📦</span>
      ยังไม่มีรายการสินค้าในระบบ<br />
      เพิ่มได้ที่หน้า <strong>ตรวจนับ Stock F.3</strong> → ปุ่ม <strong>📦 รายการสินค้า</strong>
    </td></tr>`;
    updateEntryTotals();
    return;
  }
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="6" class="br-empty">
      <span class="br-empty-icon">🔍</span>ไม่พบสินค้าตามที่ค้นหา
    </td></tr>`;
    updateEntryTotals();
    return;
  }

  body.innerHTML = rows
    .map((it, i) => {
      const q = num(state.qty.get(it.id));
      const price = num(it.price);
      return `
      <tr data-item="${it.id}" class="${q > 0 ? "br-row-filled" : ""}">
        <td style="text-align:center">${i + 1}</td>
        <td class="br-code">${esc(it.item_code || "—")}</td>
        <td>${esc(it.item_name)}${it.unit ? ` <span class="br-chip br-chip-muted">${esc(it.unit)}</span>` : ""}${
          it.is_active === false
            ? ` <span class="br-chip br-chip-off" title="ปิดใช้งานแล้ว — โผล่ที่นี่เพราะบิลนี้มีของค้างอยู่">ปิดใช้งาน</span>`
            : ""
        }</td>
        <td class="br-num">${fmtMoney(price)}</td>
        <td style="text-align:center">
          <input class="form-control br-qty-input" type="number" step="any" min="0"
                 data-qty="${it.id}" value="${q > 0 ? q : ""}" placeholder="0" />
        </td>
        <td class="br-num" data-amt="${it.id}">${q > 0 ? fmtMoney(price * q) : "—"}</td>
      </tr>`;
    })
    .join("");

  updateEntryTotals();
}

function onQtyInput(e) {
  const input = e.target.closest("[data-qty]");
  if (!input) return;
  const id = Number(input.dataset.qty);
  const item = state.items.find((it) => it.id === id);
  if (!item) return;

  let q = num(input.value);
  if (q < 0) { q = 0; input.value = ""; }
  if (q > 0) state.qty.set(id, q);
  else state.qty.delete(id);

  const tr = input.closest("tr");
  tr?.classList.toggle("br-row-filled", q > 0);
  const amt = tr?.querySelector(`[data-amt="${id}"]`);
  if (amt) amt.textContent = q > 0 ? fmtMoney(num(item.price) * q) : "—";

  updateEntryTotals();
}

function updateEntryTotals() {
  let qty = 0, amount = 0;
  state.qty.forEach((q, id) => {
    const it = state.items.find((x) => x.id === id);
    if (!it) return;
    qty += num(q);
    amount += num(q) * num(it.price);
  });
  $("brSumQty").textContent = fmtQty(qty);
  $("brSumAmount").textContent = fmtMoney(amount);
}

/* ปุ่ม Save ใช้สิทธิ์ต่างกันตามโหมด — ซ่อนเมื่อผู้ใช้ทำโหมดนั้นไม่ได้ */
function syncSaveBtn() {
  const btn = $("brSaveBtn");
  if (!btn) return;
  btn.style.display = can(state.editId ? "borrow_edit" : "borrow_create") ? "" : "none";
}

window.clearQty = function () {
  state.qty.clear();
  renderItemTable();
};

window.resetEntry = function () {
  state.editId = null;
  state.qty.clear();
  $("fEditId").value = "";
  $("fDate").value = todayISO();
  $("fPerson").value = "";
  $("fPersonId").value = "";
  $("fNote").value = "";
  window.setType("borrow");
  $("brFormCard").classList.remove("editing");
  $("brFormTitle").textContent = "📝 บันทึกรายการ";
  $("brSaveBtn").textContent = "💾 Save ข้อมูล";
  $("brCancelEditBtn").style.display = "none";
  if ($("fltOnlyFilled")) $("fltOnlyFilled").checked = false;
  syncSaveBtn();
  renderItemTable();
};

/* ── หาหรือสร้าง master ผู้ยืมจากชื่อที่พิมพ์ ── */
async function resolvePersonId(name) {
  const pid = $("fPersonId").value;
  if (pid) {
    const p = state.persons.find((x) => String(x.id) === String(pid));
    if (p && norm(p.person_name) === norm(name)) return p.id;
  }
  const hit = state.persons.find((p) => norm(p.person_name) === norm(name));
  if (hit) return hit.id;

  if (!can("borrow_create")) {
    throw new Error(`ไม่พบชื่อ “${name}” ในระบบ และคุณไม่มีสิทธิ์เพิ่มรายชื่อใหม่`);
  }
  const [created] = await sbJson("borrow_persons", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ person_name: name, person_type: "person" }),
  });
  state.persons.push(created);
  state.persons.sort((a, b) => String(a.person_name).localeCompare(String(b.person_name), "th"));
  fillPersonSelects();
  return created.id;
}

window.saveEntry = async function () {
  const editing = !!state.editId;
  if (!can(editing ? "borrow_edit" : "borrow_create")) {
    return toast(editing ? "ไม่มีสิทธิ์แก้ไข" : "ไม่มีสิทธิ์บันทึก", "error");
  }

  const date = val("fDate");
  const name = val("fPerson");
  if (!date) return toast("กรุณาเลือกวันที่", "error");
  if (!name) return toast("กรุณาระบุชื่อผู้ยืม", "error");

  const picked = [...state.qty.entries()]
    .map(([id, q]) => ({ item: state.items.find((x) => x.id === id), qty: num(q) }))
    .filter((r) => r.item && r.qty > 0);
  if (!picked.length) return toast("กรุณากรอกจำนวนอย่างน้อย 1 รายการ", "error");

  showLoading(true);
  try {
    const personId = await resolvePersonId(name);
    const me = currentUser();

    const header = {
      txn_date: date,
      txn_type: state.type,
      person_id: personId,
      person_name: name,
      note: val("fNote") || null,
    };

    let txnId = state.editId;
    if (editing) {
      await sbFetch(`borrow_txns?id=eq.${txnId}`, {
        method: "PATCH",
        body: JSON.stringify(header),
      });
      /* แทนที่บรรทัดทั้งชุด — ง่ายและตรงกว่าไล่ diff ทีละบรรทัด */
      await sbFetch(`borrow_txn_lines?txn_id=eq.${txnId}`, { method: "DELETE" });
    } else {
      const [created] = await sbJson("borrow_txns", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          ...header,
          created_by: me?.user_id ?? null,
          created_by_name: me?.full_name || me?.username || null,
        }),
      });
      txnId = created.id;
    }

    /* ทุกแถวต้องมี key ชุดเดียวกัน ไม่งั้น batch insert เจอ PGRST102 */
    const lines = picked.map((r, i) => ({
      txn_id: txnId,
      item_id: r.item.id,
      item_name: r.item.item_name,
      price: num(r.item.price),
      qty: r.qty,
      line_no: i + 1,
    }));
    await sbFetch("borrow_txn_lines", { method: "POST", body: JSON.stringify(lines) });

    toast(
      `${editing ? "แก้ไข" : "บันทึก"}รายการ${TYPE_LABEL[state.type]} ${picked.length} รายการเรียบร้อย`
    );
    window.resetEntry();
    await window.reloadAll();
  } catch (e) {
    toast("บันทึกไม่สำเร็จ: " + e.message, "error");
  } finally {
    showLoading(false);
  }
};

/* ============================================================
   TAB 2 — รายงานยืม-คืน
   ============================================================ */
/* รวมทุกบรรทัดเป็น key = คน × สินค้า
   ราคา: ใช้ราคาปัจจุบันของ master ถ้าสินค้ายังอยู่ (เหมือนคอลัมน์ราคาในชีต)
         ถ้า master ถูกลบไปแล้ว → ใช้ราคาที่ snapshot ไว้ในบรรทัดล่าสุด */
function buildBalance() {
  const map = new Map();
  for (const t of state.txns) {
    for (const l of t.lines || []) {
      const itemKey = l.item_id != null ? `i${l.item_id}` : `n${norm(l.item_name)}`;
      const key = `${t.person_id ?? "x" + norm(t.person_name)}|${itemKey}`;
      let row = map.get(key);
      if (!row) {
        row = {
          personId: t.person_id,
          personName: t.person_name || "(ไม่ระบุชื่อ)",
          itemId: l.item_id,
          itemName: l.item_name,
          price: num(l.price),
          borrow: 0,
          return: 0,
        };
        map.set(key, row);        // txns เรียงใหม่→เก่า ⇒ บรรทัดแรกที่เจอ = ราคา snapshot ล่าสุด
      }
      if (t.txn_type === "borrow") row.borrow += num(l.qty);
      else row.return += num(l.qty);
    }
  }
  const rows = [...map.values()];
  for (const r of rows) {
    const master = r.itemId != null ? state.items.find((x) => x.id === r.itemId) : null;
    if (master) r.price = num(master.price);
    r.balance = r.borrow - r.return;
  }
  rows.sort(
    (a, b) =>
      String(a.personName).localeCompare(String(b.personName), "th") ||
      String(a.itemName).localeCompare(String(b.itemName), "th")
  );
  return rows;
}

function reportRows() {
  const pid = $("rptPerson")?.value || "";
  const q = norm($("rptSearch")?.value);
  const hideZero = $("rptHideZero")?.checked;
  return buildBalance().filter((r) => {
    if (pid && String(r.personId) !== String(pid)) return false;
    if (q && !norm(r.itemName).includes(q)) return false;
    if (hideZero && r.balance === 0) return false;
    return true;
  });
}

function renderReport() {
  const body = $("brReportBody");
  if (!body) return;
  const rows = reportRows();
  const singlePerson = !!($("rptPerson")?.value);

  /* เลือกคนเดียว → ไม่ต้องโชว์คอลัมน์ชื่อซ้ำทุกแถว */
  const personTh = $("rptPersonTh");
  if (personTh) personTh.style.display = singlePerson ? "none" : "";

  $("brReportCount").textContent = `${rows.length} รายการ`;

  if (!rows.length) {
    const hasData = state.txns.length > 0;
    body.innerHTML = `<tr><td colspan="8" class="br-empty">
      <span class="br-empty-icon">${hasData ? "✅" : "📊"}</span>
      ${
        hasData
          ? "ไม่มีรายการค้างคืนตามเงื่อนไขที่เลือก<br />(เอาเครื่องหมาย “ซ่อนรายการที่คงเหลือ 0” ออก เพื่อดูรายการที่คืนครบแล้ว)"
          : "ยังไม่มีข้อมูลยืม-คืน<br />ไปที่แท็บ <strong>บันทึกยืม / คืน</strong> เพื่อเริ่มบันทึก"
      }
    </td></tr>`;
    ["rptSumBorrow", "rptSumReturn", "rptSumBalance"].forEach((id) => ($(id).textContent = "0"));
    $("rptSumValue").textContent = "0.00";
    return;
  }

  body.innerHTML = rows
    .map(
      (r, i) => `
      <tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${esc(r.itemName)}</td>
        <td${singlePerson ? ' style="display:none"' : ""}>${esc(r.personName)}</td>
        <td class="br-num">${fmtMoney(r.price)}</td>
        <td class="br-num ${r.borrow ? "br-borrow" : "br-zero"}">${fmtQty(r.borrow)}</td>
        <td class="br-num ${r.return ? "br-return" : "br-zero"}">${fmtQty(r.return)}</td>
        <td class="br-num ${r.balance ? "br-balance" : "br-zero"}">${fmtQty(r.balance)}</td>
        <td class="br-num">${r.balance ? fmtMoney(r.balance * r.price) : "—"}</td>
      </tr>`
    )
    .join("");

  const sum = rows.reduce(
    (a, r) => ({
      borrow: a.borrow + r.borrow,
      ret: a.ret + r.return,
      bal: a.bal + r.balance,
      value: a.value + r.balance * r.price,
    }),
    { borrow: 0, ret: 0, bal: 0, value: 0 }
  );
  $("rptSumBorrow").textContent = fmtQty(sum.borrow);
  $("rptSumReturn").textContent = fmtQty(sum.ret);
  $("rptSumBalance").textContent = fmtQty(sum.bal);
  $("rptSumValue").textContent = fmtMoney(sum.value);
}

window.exportReport = function () {
  const rows = reportRows();
  if (!rows.length) return toast("ไม่มีข้อมูลให้ส่งออก", "error");
  const data = rows.map((r, i) => ({
    ลำดับ: i + 1,
    สินค้า: r.itemName,
    ผู้ยืม: r.personName,
    ราคา: r.price,
    ยืม: r.borrow,
    คืน: r.return,
    คงเหลือ: r.balance,
    มูลค่าคงเหลือ: r.balance * r.price,
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "รายงานยืม-คืน");
  XLSX.writeFile(wb, `borrow-return-report-${todayISO()}.xlsx`);
};

/* ============================================================
   STATS
   ============================================================ */
function renderStats() {
  const rows = buildBalance();
  const borrow = rows.reduce((s, r) => s + r.borrow, 0);
  const ret = rows.reduce((s, r) => s + r.return, 0);
  const outstanding = rows.reduce((s, r) => s + Math.max(0, r.balance), 0);
  const value = rows.reduce((s, r) => s + Math.max(0, r.balance) * r.price, 0);
  const people = new Set(rows.filter((r) => r.balance > 0).map((r) => r.personId ?? r.personName));

  $("statBorrow").textContent = fmtQty(borrow);
  $("statReturn").textContent = fmtQty(ret);
  $("statReturnSub").textContent = borrow ? `${Math.round((ret / borrow) * 100)}% ของที่ยืม` : "0% ของที่ยืม";
  $("statOutstanding").textContent = fmtQty(outstanding);
  $("statOutstandingSub").textContent = `${people.size} คนที่ยังค้าง`;
  $("statValue").textContent = fmtMoney(value);
}

/* ============================================================
   TAB 3 — ประวัติรายการ
   ============================================================ */
function txnQty(t) { return (t.lines || []).reduce((s, l) => s + num(l.qty), 0); }
function txnAmount(t) { return (t.lines || []).reduce((s, l) => s + num(l.price) * num(l.qty), 0); }

function historyRows() {
  const q = norm($("hisSearch")?.value);
  const pid = $("hisPerson")?.value || "";
  const type = $("hisType")?.value || "";
  const from = $("hisFrom")?.value || "";
  const to = $("hisTo")?.value || "";

  return state.txns.filter((t) => {
    if (pid && String(t.person_id) !== String(pid)) return false;
    if (type && t.txn_type !== type) return false;
    if (from && t.txn_date < from) return false;
    if (to && t.txn_date > to) return false;
    if (q) {
      const hay = norm(
        [t.person_name, t.note, ...(t.lines || []).map((l) => l.item_name)].join(" ")
      );
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderHistory() {
  const body = $("brHistBody");
  if (!body) return;
  const rows = historyRows();
  $("brHistCount").textContent = `${rows.length} รายการ`;
  $("nHistory").textContent = state.txns.length;

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="9" class="br-empty">
      <span class="br-empty-icon">🧾</span>
      ${state.txns.length ? "ไม่พบรายการตามตัวกรอง" : "ยังไม่มีรายการที่บันทึกไว้"}
    </td></tr>`;
    updateBulkBar();
    return;
  }

  body.innerHTML = rows
    .map((t) => {
      const names = (t.lines || []).map((l) => l.item_name);
      const preview =
        names.slice(0, 3).map((n) => esc(n)).join(" · ") +
        (names.length > 3 ? ` <strong>…+${names.length - 3}</strong>` : "");
      return `
      <tr>
        <td style="text-align:center">
          <input type="checkbox" data-sel="${t.id}" ${state.selected.has(t.id) ? "checked" : ""} />
        </td>
        <td>${fmtDate(t.txn_date)}</td>
        <td><span class="br-chip br-chip-${t.txn_type}">${t.txn_type === "borrow" ? "📤 ยืม" : "📥 คืน"}</span></td>
        <td>${esc(t.person_name || "—")}</td>
        <td class="br-items-cell">${preview || "—"}</td>
        <td class="br-num">${fmtQty(txnQty(t))}</td>
        <td class="br-num">${fmtMoney(txnAmount(t))}</td>
        <td>${esc(t.created_by_name || "—")}</td>
        <td style="text-align:center">
          <button class="br-icon-btn" title="ดูรายละเอียด" onclick="window.openDetail(${t.id})">👁</button>
          <button class="br-icon-btn" data-perm="borrow_edit" title="แก้ไข" onclick="window.editTxn(${t.id})">✏️</button>
          <button class="br-icon-btn br-danger" data-perm="borrow_delete" title="ลบ" onclick="window.deleteTxn(${t.id})">🗑</button>
        </td>
      </tr>`;
    })
    .join("");

  applyPerms(body);
  updateBulkBar();
}

window.clearHistoryFilters = function () {
  ["hisSearch", "hisPerson", "hisType", "hisFrom", "hisTo"].forEach((id) => {
    const el = $(id);
    if (el) el.value = "";
  });
  renderHistory();
};

window.exportHistory = function () {
  const rows = historyRows();
  if (!rows.length) return toast("ไม่มีข้อมูลให้ส่งออก", "error");
  const data = [];
  rows.forEach((t) => {
    (t.lines || []).forEach((l) => {
      data.push({
        วันที่: fmtDate(t.txn_date),
        ประเภท: TYPE_LABEL[t.txn_type] || t.txn_type,
        ชื่อผู้ยืม: t.person_name || "",
        สินค้า: l.item_name,
        ราคา: num(l.price),
        จำนวน: num(l.qty),
        มูลค่า: num(l.price) * num(l.qty),
        หมายเหตุ: t.note || "",
        ผู้บันทึก: t.created_by_name || "",
      });
    });
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "ประวัติยืม-คืน");
  XLSX.writeFile(wb, `borrow-return-history-${todayISO()}.xlsx`);
};

/* ── เลือกหลายแถว ── */
window.toggleSelectAll = function (on) {
  const rows = historyRows();
  if (on) rows.forEach((t) => state.selected.add(t.id));
  else state.selected.clear();
  document.querySelectorAll("#brHistBody [data-sel]").forEach((cb) => (cb.checked = on));
  updateBulkBar();
};

window.clearSelection = function () {
  state.selected.clear();
  document.querySelectorAll("#brHistBody [data-sel]").forEach((cb) => (cb.checked = false));
  const all = $("brChkAll");
  if (all) all.checked = false;
  updateBulkBar();
};

function updateBulkBar() {
  const rows = historyRows();
  const picked = rows.filter((t) => state.selected.has(t.id));
  const bar = $("brBulkBar");
  if (bar) bar.style.display = picked.length ? "flex" : "none";
  $("brBulkCount").textContent = picked.length;
  $("brBulkQty").textContent = fmtQty(picked.reduce((s, t) => s + txnQty(t), 0));
  const all = $("brChkAll");
  if (all) all.checked = rows.length > 0 && picked.length === rows.length;
  applyPerms(bar);
}

window.bulkDelete = async function () {
  if (!can("borrow_delete")) return toast("ไม่มีสิทธิ์ลบ", "error");
  const ids = [...state.selected];
  if (!ids.length) return;
  const ok = await ConfirmModal.open({
    title: "ลบรายการที่เลือก",
    message: `ลบรายการยืม/คืน ${ids.length} รายการ?`,
    icon: "🗑",
    okText: "ลบเลย",
    tone: "danger",
    note: "⚠️ ยอดคงเหลือของคนที่เกี่ยวข้องจะถูกคำนวณใหม่ · การลบนี้ถาวร กู้คืนไม่ได้",
  });
  if (!ok) return;

  showLoading(true);
  try {
    await sbFetch(`borrow_txns?id=in.(${ids.join(",")})`, { method: "DELETE" });
    state.selected.clear();
    toast(`ลบ ${ids.length} รายการแล้ว`);
    await window.reloadAll();
  } catch (e) {
    toast("ลบไม่สำเร็จ: " + e.message, "error");
  } finally {
    showLoading(false);
  }
};

window.deleteTxn = async function (id) {
  if (!can("borrow_delete")) return toast("ไม่มีสิทธิ์ลบ", "error");
  const t = state.txns.find((x) => x.id === id);
  if (!t) return;
  const ok = await ConfirmModal.open({
    title: "ลบรายการ",
    message: `ลบรายการ${TYPE_LABEL[t.txn_type]}นี้?`,
    icon: "🗑",
    okText: "ลบเลย",
    tone: "danger",
    details: {
      วันที่: fmtDate(t.txn_date),
      ชื่อผู้ยืม: t.person_name || "—",
      จำนวนสินค้า: `${(t.lines || []).length} รายการ · ${fmtQty(txnQty(t))} ชิ้น`,
    },
    note: "⚠️ ยอดคงเหลือจะถูกคำนวณใหม่ · การลบนี้ถาวร",
  });
  if (!ok) return;

  showLoading(true);
  try {
    await sbFetch(`borrow_txns?id=eq.${id}`, { method: "DELETE" });
    state.selected.delete(id);
    toast("ลบรายการแล้ว");
    await window.reloadAll();
  } catch (e) {
    toast("ลบไม่สำเร็จ: " + e.message, "error");
  } finally {
    showLoading(false);
  }
};

window.editTxn = function (id) {
  if (!can("borrow_edit")) return toast("ไม่มีสิทธิ์แก้ไข", "error");
  const t = state.txns.find((x) => x.id === id);
  if (!t) return;

  state.editId = id;
  state.qty.clear();
  (t.lines || []).forEach((l) => {
    if (l.item_id != null) state.qty.set(l.item_id, num(l.qty));
  });

  $("fEditId").value = id;
  $("fDate").value = t.txn_date || todayISO();
  $("fPerson").value = t.person_name || "";
  $("fPersonId").value = t.person_id ?? "";
  $("fNote").value = t.note || "";
  window.setType(t.txn_type);

  $("brFormCard").classList.add("editing");
  $("brFormTitle").textContent = "✏️ แก้ไขรายการ";
  $("brSaveBtn").textContent = "💾 บันทึกการแก้ไข";
  $("brCancelEditBtn").style.display = "";
  syncSaveBtn();

  /* สินค้าที่ถูกลบออกจาก master แล้ว จะกรอกจำนวนกลับไม่ได้ — เตือนไว้ */
  const orphan = (t.lines || []).filter((l) => l.item_id == null || !state.items.some((x) => x.id === l.item_id));
  if (orphan.length) {
    toast(`⚠️ ${orphan.length} รายการในบิลนี้ไม่มีอยู่ใน master สินค้าแล้ว — จะหายไปถ้ากดบันทึก`, "warning");
  }

  window.switchTab("entry");
  if ($("fltOnlyFilled")) $("fltOnlyFilled").checked = true;
  renderItemTable();
  window.scrollTo({ top: 0, behavior: "smooth" });
};

/* ── โมดัลรายละเอียด ── */
window.openDetail = function (id) {
  const t = state.txns.find((x) => x.id === id);
  if (!t) return;
  $("dtlMeta").innerHTML = `
    <span>วันที่ <strong>${fmtDate(t.txn_date)}</strong></span>
    <span>ประเภท <strong class="${t.txn_type === "borrow" ? "br-borrow" : "br-return"}">${TYPE_LABEL[t.txn_type]}</strong></span>
    <span>ชื่อผู้ยืม <strong>${esc(t.person_name || "—")}</strong></span>
    <span>ผู้บันทึก <strong>${esc(t.created_by_name || "—")}</strong></span>
    ${t.note ? `<span>หมายเหตุ <strong>${esc(t.note)}</strong></span>` : ""}`;

  $("dtlBody").innerHTML =
    (t.lines || [])
      .map(
        (l, i) => `
      <tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${esc(l.item_name)}</td>
        <td class="br-num">${fmtMoney(l.price)}</td>
        <td class="br-num">${fmtQty(l.qty)}</td>
        <td class="br-num">${fmtMoney(num(l.price) * num(l.qty))}</td>
      </tr>`
      )
      .join("") || `<tr><td colspan="5" class="br-empty">ไม่มีบรรทัดสินค้า</td></tr>`;

  $("detailModal").classList.add("open");
};
window.closeDetail = function () { $("detailModal").classList.remove("open"); };

/* ============================================================
   MASTER: ผู้ยืม (In-Context CRUD)
   ============================================================ */
window.openPersonManager = function () {
  $("personModal").classList.add("open");
  window.renderPersonManager();
};
window.closePersonManager = function () { $("personModal").classList.remove("open"); };

window.renderPersonManager = function () {
  const q = norm($("pmSearch")?.value);
  const rows = state.persons.filter((p) => !q || norm(p.person_name).includes(q));
  const list = $("pmList");
  if (!rows.length) {
    list.innerHTML = `<div class="br-empty">${state.persons.length ? "ไม่พบรายชื่อที่ค้นหา" : "ยังไม่มีรายชื่อ — เพิ่มด้านบนได้เลย"}</div>`;
    return;
  }
  list.innerHTML = rows
    .map(
      (p) => `
      <div class="br-manage-row br-person-row" data-id="${p.id}">
        <input class="form-control" data-f="person_name" value="${esc(p.person_name)}" />
        <select class="form-control" data-f="person_type">
          <option value="person" ${p.person_type === "person" ? "selected" : ""}>👤 บุคคล</option>
          <option value="company" ${p.person_type === "company" ? "selected" : ""}>🏢 บริษัท</option>
        </select>
        <input class="form-control" data-f="phone" value="${esc(p.phone || "")}" placeholder="เบอร์โทร" />
        <div class="br-manage-actions">
          <button class="br-icon-btn" data-perm="borrow_edit" title="บันทึก" onclick="window.savePerson(${p.id})">💾</button>
          <button class="br-icon-btn br-danger" data-perm="borrow_delete" title="ลบ" onclick="window.deletePerson(${p.id})">🗑</button>
        </div>
      </div>`
    )
    .join("");
  applyPerms(list);
};

window.addPerson = async function () {
  if (!can("borrow_create")) return toast("ไม่มีสิทธิ์เพิ่ม", "error");
  const name = val("pmNewName");
  if (!name) return toast("กรุณากรอกชื่อ", "error");
  if (state.persons.some((p) => norm(p.person_name) === norm(name))) {
    return toast(`มีชื่อ “${name}” อยู่แล้ว`, "error");
  }
  showLoading(true);
  try {
    await sbFetch("borrow_persons", {
      method: "POST",
      body: JSON.stringify({
        person_name: name,
        person_type: val("pmNewType") || "person",
        phone: val("pmNewPhone") || null,
      }),
    });
    ["pmNewName", "pmNewPhone"].forEach((id) => ($(id).value = ""));
    await loadPersons();
    fillPersonSelects();
    window.renderPersonManager();
    toast(`เพิ่ม “${name}” แล้ว`);
  } catch (e) {
    toast("เพิ่มไม่สำเร็จ: " + e.message, "error");
  } finally {
    showLoading(false);
  }
};

window.savePerson = async function (id) {
  if (!can("borrow_edit")) return toast("ไม่มีสิทธิ์แก้ไข", "error");
  const row = document.querySelector(`#pmList .br-manage-row[data-id="${id}"]`);
  if (!row) return;
  const name = row.querySelector('[data-f="person_name"]').value.trim();
  if (!name) return toast("ชื่อห้ามว่าง", "error");
  if (state.persons.some((p) => p.id !== id && norm(p.person_name) === norm(name))) {
    return toast(`มีชื่อ “${name}” อยู่แล้ว`, "error");
  }
  showLoading(true);
  try {
    await sbFetch(`borrow_persons?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        person_name: name,
        person_type: row.querySelector('[data-f="person_type"]').value,
        phone: row.querySelector('[data-f="phone"]').value.trim() || null,
      }),
    });
    await loadPersons();
    fillPersonSelects();
    window.renderPersonManager();
    toast("บันทึกแล้ว");
  } catch (e) {
    toast("บันทึกไม่สำเร็จ: " + e.message, "error");
  } finally {
    showLoading(false);
  }
};

window.deletePerson = async function (id) {
  if (!can("borrow_delete")) return toast("ไม่มีสิทธิ์ลบ", "error");
  const p = state.persons.find((x) => x.id === id);
  if (!p) return;
  const used = state.txns.filter((t) => t.person_id === id).length;
  const ok = await ConfirmModal.open({
    title: "ลบรายชื่อ",
    message: `ลบ “${p.person_name}” ออกจากรายชื่อผู้ยืม?`,
    icon: "🗑",
    okText: "ลบเลย",
    tone: "danger",
    note: used
      ? `⚠️ มี ${used} รายการที่บันทึกในชื่อนี้ — รายการเดิมยังอยู่และยังแสดงชื่อเดิม แต่จะหลุดออกจากตัวกรองรายชื่อ`
      : undefined,
  });
  if (!ok) return;
  showLoading(true);
  try {
    await sbFetch(`borrow_persons?id=eq.${id}`, { method: "DELETE" });
    await window.reloadAll();
    window.renderPersonManager();
    toast("ลบแล้ว");
  } catch (e) {
    toast("ลบไม่สำเร็จ: " + e.message, "error");
  } finally {
    showLoading(false);
  }
};

/* MASTER สินค้าเป็นของกลาง (stock_items · sql/179) ใช้ร่วมกับหน้าตรวจนับและหน้าเบิก
   → แก้ที่หน้าตรวจนับ Stock F.3 ที่เดียว ไม่เปิดให้แก้ 2 ที่ */
window.openItemManager = function () {
  window.location.href = "./stock-check.html?items=1";
};

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  if (!SB_URL || !SB_KEY) {
    toast("ไม่พบการตั้งค่า Supabase — กรุณา login ใหม่", "error");
    return;
  }

  $("fDate").value = todayISO();
  window.setType("borrow");
  initPersonCombo();

  /* ตารางกรอกจำนวน: ผูก event ที่ tbody ครั้งเดียว (แถวถูก re-render บ่อย) */
  $("brItemBody").addEventListener("input", onQtyInput);
  $("brItemBody").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.matches("[data-qty]")) {
      e.preventDefault();
      window.saveEntry();
    }
  });

  $("fltItem").addEventListener("input", renderItemTable);
  $("fltOnlyFilled").addEventListener("change", renderItemTable);

  ["rptPerson", "rptSearch", "rptHideZero"].forEach((id) =>
    $(id).addEventListener("input", renderReport)
  );
  ["hisSearch", "hisPerson", "hisType", "hisFrom", "hisTo"].forEach((id) =>
    $(id).addEventListener("input", () => renderHistory())
  );

  $("brHistBody").addEventListener("change", (e) => {
    const cb = e.target.closest("[data-sel]");
    if (!cb) return;
    const id = Number(cb.dataset.sel);
    cb.checked ? state.selected.add(id) : state.selected.delete(id);
    updateBulkBar();
  });

  await window.reloadAll();
  applyPerms(document);
  syncSaveBtn();
});
