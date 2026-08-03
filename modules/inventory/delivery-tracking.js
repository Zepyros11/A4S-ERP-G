/* ============================================================
   delivery-tracking.js — ติดตามการจัดส่ง (แทน Google Sheet "ส่ง Track")
   Tables: delivery_orders, delivery_customers  (sql/175)

   โครงงาน:
     - ฟอร์มบน = ทั้ง "เพิ่ม" และ "แก้ไข" (เหมือนแถวป้อนข้อมูลในชีต)
     - ลูกค้าเก็บเป็น master (delivery_customers) — Line ID เป็นตัวชี้
       เลือกจาก dropdown หรือพิมพ์ชื่อใหม่ได้ทันที (สร้าง master ให้อัตโนมัติ)
     - แถวจัดส่งเก็บ snapshot ชื่อ/จังหวัด/เบอร์ ไว้ด้วย → แก้ master ทีหลังไม่ทับบิลเก่า
   ============================================================ */

const SB_URL = localStorage.getItem("sb_url") || "";
const SB_KEY = localStorage.getItem("sb_key") || "";

/* ── บริษัทขนส่ง + ลิงก์ติดตามพัสดุ ── */
const COURIERS = {
  KEX:   { label: "Kerry (KEX)",    url: "https://th.kex-express.com/th/track/v2/?track=" },
  FLASH: { label: "Flash Express",  url: "https://www.flashexpress.com/fle/tracking?se=" },
  JT:    { label: "J&T Express",    url: "https://www.jtexpress.co.th/index/query/gzquery.html?bills=" },
  THP:   { label: "ไปรษณีย์ไทย",     url: "https://track.thailandpost.co.th/?trackNumber=" },
  OTHER: { label: "อื่น ๆ",          url: "" },
};

const state = {
  orders: [],
  customers: [],
  csUsers: [],
  selected: new Set(),
  editId: null,
  kexRows: [],      // ผลการจับคู่ของ modal KEX
  msgRowId: null,
  day: null,        // วันที่ที่กำลังดู (ISO) — ตารางเป็นมุมมองรายวันแบบ Daily Sale
  allDays: false,   // true = ปิดมุมมองรายวัน ดูทุกวันรวมกัน
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

/* ลิงก์ Line OA มาจากช่องที่ CS พิมพ์เอง → ปล่อยลง href ตรงๆ ไม่ได้
   esc() กัน attribute breakout ได้ แต่ไม่กัน scheme — "javascript:…" ยังทำงานตอนคลิก
   อนุญาตเฉพาะ http/https · นอกนั้นคืนค่าว่าง (ปุ่มจะไม่แสดง) */
function safeUrl(u) {
  try {
    const p = new URL(String(u ?? "").trim());
    return p.protocol === "https:" || p.protocol === "http:" ? p.href : "";
  } catch {
    return "";
  }
}

const fmtDate = (iso) => (window.DateFmt ? window.DateFmt.formatDMY(iso) : (iso || ""));
const fmtMoney = (n) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

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

/* Supabase ตอบสูงสุด 1000 แถว/ครั้ง → ไล่ดึงเป็นหน้าๆ จนครบ (ข้อมูลย้อนหลังมีหลายพันแถว) */
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
async function loadCsUsers() {
  /* เฉพาะคนแผนก CS: role หลัก (slot 1) ต้องเป็น role ที่ key/label ขึ้นต้นด้วย "CS" */
  const cfgs = (await sbJson("role_configs?select=role_key,label")) || [];
  const isCs = (s) => /^cs($|[^a-z0-9])/i.test(String(s || "").trim());
  const csKeys = cfgs.filter((c) => isCs(c.role_key) || isCs(c.label)).map((c) => c.role_key);

  let users = [];
  if (csKeys.length) {
    const inList = csKeys.map((k) => encodeURIComponent(k)).join(",");
    users = (await sbJson(`users?select=user_id,full_name,role&is_active=eq.true&role=in.(${inList})&order=full_name.asc`)) || [];
  }
  /* ไม่มี role CS เลย → ปล่อยให้เลือกจากพนักงานทั้งหมด ดีกว่า dropdown ว่าง */
  if (!users.length) {
    users = (await sbJson("users?select=user_id,full_name,role&is_active=eq.true&order=full_name.asc")) || [];
  }
  state.csUsers = users;

  const optHtml = users.map((u) => `<option value="${u.user_id}">${esc(u.full_name || u.role || u.user_id)}</option>`).join("");
  $("fCs").innerHTML = `<option value="">— เลือก CS —</option>` + optHtml;
  $("fltCs").innerHTML = `<option value="">🧿 CS ทั้งหมด</option>` + optHtml;

  /* ค่าเริ่มต้น = ตัวผู้ใช้เอง ถ้าอยู่ในรายชื่อ */
  const me = currentUser();
  if (me && users.some((u) => String(u.user_id) === String(me.user_id))) {
    $("fCs").value = String(me.user_id);
  }
}

async function loadCustomers() {
  state.customers = await sbFetchAll(
    "delivery_customers?select=*&is_active=eq.true&order=customer_name.asc"
  );
}

async function loadOrders() {
  state.orders = await sbFetchAll("delivery_orders?select=*&order=order_date.desc,id.desc");
}

/* ============================================================
   COMBOBOX — dropdown ที่จัดสไตล์เองได้
   (<datalist> เบราว์เซอร์วาดเอง → คุม CSS ไม่ได้เลย จึงเขียนเอง)
   ============================================================ */
const COMBO_MAX = 60;

function comboHighlight(text, q) {
  const t = String(text ?? "");
  if (!q) return esc(t);
  const i = t.toLowerCase().indexOf(q);
  if (i < 0) return esc(t);
  return esc(t.slice(0, i)) + "<b>" + esc(t.slice(i, i + q.length)) + "</b>" + esc(t.slice(i + q.length));
}

function initCombo(inputId, getItems, onPick) {
  const input = $(inputId);
  if (!input) return;
  const wrap = input.closest(".dt-combo");
  const caret = wrap.querySelector(".dt-combo-caret");
  const menu = document.createElement("div");
  menu.className = "dt-combo-menu";
  wrap.appendChild(menu);

  let items = [], active = -1;

  function render() {
    const q = input.value.trim().toLowerCase();
    const all = getItems();
    const hit = q
      ? all
          .filter((it) => String(it.value).toLowerCase().includes(q))
          .sort(
            (a, b) =>
              String(a.value).toLowerCase().indexOf(q) - String(b.value).toLowerCase().indexOf(q)
          )
      : all;
    items = hit.slice(0, COMBO_MAX);
    active = -1;

    if (!all.length) {
      menu.innerHTML = `<div class="dt-combo-empty">ยังไม่มีข้อมูลในระบบ</div>`;
      return;
    }
    if (!items.length) {
      menu.innerHTML = `<div class="dt-combo-empty">ไม่พบ “${esc(input.value.trim())}” — พิมพ์ต่อได้เลย ระบบจะสร้างให้ใหม่ตอนกด ＋ เพิ่ม</div>`;
      return;
    }
    menu.innerHTML =
      items
        .map(
          (it, i) => `
        <div class="dt-combo-item" data-i="${i}">
          <span class="dt-combo-item-main">${comboHighlight(it.value, q)}</span>
          ${it.sub ? `<span class="dt-combo-item-sub">${esc(it.sub)}</span>` : ""}
        </div>`
        )
        .join("") +
      (hit.length > items.length
        ? `<div class="dt-combo-more">แสดง ${items.length} จาก ${hit.length.toLocaleString()} — พิมพ์เพิ่มเพื่อค้นให้แคบลง</div>`
        : "");
  }

  const isOpen = () => wrap.classList.contains("open");
  function open() { render(); wrap.classList.add("open"); }
  function close() { wrap.classList.remove("open"); active = -1; }

  function setActive(i) {
    const els = menu.querySelectorAll(".dt-combo-item");
    if (!els.length) return;
    active = (i + els.length) % els.length;
    els.forEach((el, n) => el.classList.toggle("active", n === active));
    els[active].scrollIntoView({ block: "nearest" });
  }

  function pick(i) {
    const it = items[i];
    if (!it) return;
    input.value = it.value;
    close();
    input.dispatchEvent(new Event("input", { bubbles: true })); /* ให้ onLineIdInput / onCustomerInput ทำงานต่อ */
    onPick?.(it);   /* เลือกจากรายการ = ผู้ใช้ตั้งใจ → เติมช่องที่ผูกกันได้เลย */
  }

  input.addEventListener("focus", open);
  input.addEventListener("input", () => { if (isOpen()) render(); else open(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { if (!isOpen()) open(); setActive(active + 1); e.preventDefault(); }
    else if (e.key === "ArrowUp") { if (isOpen()) { setActive(active - 1); e.preventDefault(); } }
    else if (e.key === "Enter" && isOpen() && active >= 0) {
      pick(active);
      e.preventDefault();
      e.stopPropagation(); /* กันไปชน Enter = เพิ่มรายการ ของฟอร์ม */
    } else if (e.key === "Escape" && isOpen()) {
      close();
      e.stopPropagation(); /* กัน modalManager ปิดโมดัลอื่น */
    }
  });
  menu.addEventListener("mousedown", (e) => {
    const el = e.target.closest(".dt-combo-item");
    if (!el) return;
    e.preventDefault();          /* กัน blur ก่อนเลือก */
    pick(Number(el.dataset.i));
  });
  caret?.addEventListener("mousedown", (e) => {
    e.preventDefault();
    if (isOpen()) close();
    else { input.focus(); open(); }
  });
  document.addEventListener("mousedown", (e) => { if (!wrap.contains(e.target)) close(); });
}

/* ── ประวัติของบัญชี LINE ที่เลือกอยู่ (ชื่อผู้รับ/จังหวัด/เบอร์ = ข้อมูลลูกของ Line ID) ── */
function ordersOfCurrentLine() {
  const k = norm(val("fLineId"));
  if (!k) return [];
  return state.orders.filter((o) => norm(o.line_id) === k);
}

/* บิลล่าสุดของผู้รับคนนี้ (ในบัญชี LINE ที่เลือก ถ้ามี) */
function lastOrderOfName(name) {
  const n = norm(name);
  if (!n) return null;
  const pool = ordersOfCurrentLine();
  const list = (pool.length ? pool : state.orders).filter((o) => norm(o.customer_name) === n);
  return list[0] || null;   /* state.orders เรียง order_date desc มาแล้ว */
}

/* นับค่าที่พบบ่อย → เรียงตัวเลือกจาก "ใช้ล่าสุด/บ่อยสุด" */
function tally(list, key) {
  const m = new Map();
  list.forEach((o) => {
    const v = (o[key] || "").trim();
    if (v) m.set(v, (m.get(v) || 0) + 1);
  });
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function updateFkHint() {
  const el = $("fCustomerHint");
  if (!el) return;
  const n = ordersOfCurrentLine().length;
  el.textContent = n ? `· เฉพาะของ ${val("fLineId")} (${n} บิล)` : "";
}

/* ── แหล่งข้อมูลของแต่ละช่อง ── */
function initAllCombos() {
  /* ① Line ID = ตัวตั้ง */
  initCombo(
    "fLineId",
    () =>
      state.customers
        .filter((c) => c.line_id)
        .map((c) => ({ value: c.line_id, sub: c.line_oa_url ? "🔗 มี OA" : c.province || "" })),
    () => {
      /* เปลี่ยนบัญชี → ล้างช่องลูกที่ไม่ใช่ของบัญชีนี้ แล้วเติมให้ถ้ามีผู้รับรายเดียว */
      const pool = ordersOfCurrentLine();
      const names = tally(pool, "customer_name");
      const cur = norm(val("fCustomer"));
      if (cur && !names.some(([n]) => norm(n) === cur)) {
        ["fCustomer", "fProvince", "fPhone"].forEach((id) => ($(id).value = ""));
      }
      if (!val("fCustomer") && names.length === 1) {
        $("fCustomer").value = names[0][0];
        fillFromLastOrder(names[0][0]);
      }
      updateFkHint();
    }
  );

  /* ② ผู้รับ — เฉพาะที่บัญชีนี้เคยส่ง (ไม่มี Line ID → ใช้รายชื่อทั้งหมด) */
  initCombo(
    "fCustomer",
    () => {
      const pool = ordersOfCurrentLine();
      if (pool.length) {
        return tally(pool, "customer_name").map(([name, n]) => {
          const last = pool.find((o) => norm(o.customer_name) === norm(name));
          return { value: name, sub: [last?.province, `${n} บิล`].filter(Boolean).join(" · ") };
        });
      }
      return state.customers.map((c) => ({ value: c.customer_name, sub: c.line_id || "" }));
    },
    (it) => fillFromLastOrder(it.value)
  );

  /* ③ จังหวัด — ของบัญชีนี้ก่อน ไม่มีค่อยไล่ทั้งระบบ */
  initCombo("fProvince", () => {
    const pool = ordersOfCurrentLine();
    if (pool.length) return tally(pool, "province").map(([p, n]) => ({ value: p, sub: `${n} บิล` }));
    const all = tally(state.orders, "province");
    return all
      .sort((a, b) => a[0].localeCompare(b[0], "th"))
      .map(([p, n]) => ({ value: p, sub: `${n.toLocaleString()} บิล` }));
  });

  /* ④ เบอร์โทร — ของผู้รับคนนี้ก่อน แล้วค่อยของทั้งบัญชี */
  initCombo("fPhone", () => {
    const pool = ordersOfCurrentLine();
    const n = norm(val("fCustomer"));
    const mine = n ? pool.filter((o) => norm(o.customer_name) === n) : [];
    const src = mine.length ? mine : pool;
    return tally(src, "phone").map(([p, c]) => ({ value: p, sub: `${c} บิล` }));
  });
}

/* เลือกผู้รับ → เติมจังหวัด+เบอร์จากบิลล่าสุดของคนนั้น
   force = true (เลือกจาก dropdown) ทับของเดิม · false (พิมพ์เอง) เติมเฉพาะช่องว่าง */
function fillFromLastOrder(name, force = true) {
  const last = lastOrderOfName(name);
  if (!last) return;
  if (last.province && (force || !val("fProvince"))) $("fProvince").value = last.province;
  if (last.phone && (force || !val("fPhone"))) $("fPhone").value = last.phone;
}

/* ============================================================
   FORM
   ============================================================ */
function findCustomerByLineId(lineId) {
  if (!lineId) return null;
  return state.customers.find((c) => norm(c.line_id) === norm(lineId)) || null;
}
function findCustomerByName(name) {
  if (!name) return null;
  return state.customers.find((c) => norm(c.customer_name) === norm(name)) || null;
}

window.onLineIdInput = function () {
  updateFkHint();
  const c = findCustomerByLineId(val("fLineId"));
  if (!c) { refreshOaStatus(); return; }
  applyCustomerToForm(c);
};

window.onCustomerInput = function () {
  const name = val("fCustomer");
  fillFromLastOrder(name, false);   /* พิมพ์ชื่อที่เคยส่ง → เติมจังหวัด/เบอร์ให้ถ้ายังว่าง */
  const c = findCustomerByName(name);
  if (!c) { $("fCustomerId").value = ""; refreshOaStatus(); return; }
  applyCustomerToForm(c);
};

function applyCustomerToForm(c) {
  $("fCustomerId").value = c.id;
  /* ชื่อผู้รับเปลี่ยนได้ทุกบิล — เติมให้เฉพาะตอนช่องยังว่าง ห้ามทับที่ CS พิมพ์ไว้ */
  if (!val("fCustomer")) $("fCustomer").value = c.customer_name || "";
  if (c.line_id && val("fLineId") !== c.line_id) $("fLineId").value = c.line_id;
  if (!val("fProvince")) $("fProvince").value = c.province || "";
  if (!val("fPhone")) $("fPhone").value = c.phone || "";
  $("fOaLink").value = c.line_oa_url || "";
  updateFkHint();
  refreshOaStatus();
}

window.refreshOaStatus = function () {
  const has = !!val("fOaLink");
  const box = $("fOaStatus");
  box.className = `dt-oa-status ${has ? "on" : "off"}`;
  $("fOaStatusText").textContent = has ? "เชื่อม Line OA แล้ว" : "ยังไม่มีลิงก์";
};

window.resetForm = function () {
  state.editId = null;
  $("fEditId").value = "";
  $("fCustomerId").value = "";
  $("fOrderDate").value = todayISO();
  $("fShipDate").value = todayISO();   /* ปกติบันทึกวันที่ส่งจริงวันเดียวกับที่กรอก */
  $("fLineId").value = "";
  $("fCustomer").value = "";
  $("fProvince").value = "";
  $("fPhone").value = "";
  $("fTracking").value = "";
  $("fCost").value = "0";
  $("fNote").value = "";
  $("fOaLink").value = "";
  $("fCourier").value = "KEX";
  $("dtFormCard").classList.remove("editing");
  $("dtFormTitle").textContent = "📝 บันทึกรายการจัดส่ง";
  $("dtAddBtn").textContent = "＋ เพิ่ม";
  $("dtAddBtn").style.display = can("delivery_create") ? "" : "none";
  $("dtCancelEditBtn").style.display = "none";
  updateFkHint();
  refreshOaStatus();
  renderTable();
};

/* ── หา/สร้าง master ลูกค้าจากค่าที่กรอกในฟอร์ม ── */
async function resolveCustomer() {
  const name = val("fCustomer");
  const lineId = val("fLineId");
  const province = val("fProvince");
  const phone = val("fPhone");
  const oa = val("fOaLink");

  let cust = null;
  const idInForm = val("fCustomerId");
  if (idInForm) cust = state.customers.find((c) => String(c.id) === idInForm) || null;
  if (!cust) cust = findCustomerByLineId(lineId);
  if (!cust) cust = findCustomerByName(name);

  if (cust) {
    /* master = บัญชี LINE ที่สั่ง — ชื่อผู้รับ/จังหวัด/เบอร์ เปลี่ยนได้ทุกบิล
       จึงไม่เขียนทับ master ด้วยค่าจากบิล (แก้ชื่อ master ได้ที่ ⚙️ จัดการ)
       เขียนกลับเฉพาะ Line ID + ลิงก์ Line OA ซึ่งผูกกับบัญชีจริงๆ */
    const patch = {};
    if (lineId && lineId !== cust.line_id) {
      /* Line ID ห้ามซ้ำ (unique index) — ถ้าเป็นของคนอื่นอยู่ ให้ข้ามไปและเตือน */
      const owner = findCustomerByLineId(lineId);
      if (owner && String(owner.id) !== String(cust.id)) {
        toast(`Line ID "${lineId}" เป็นของ "${owner.customer_name}" อยู่แล้ว — ไม่ได้ย้ายให้`, "warning");
      } else {
        patch.line_id = lineId;
      }
    }
    if (oa && oa !== cust.line_oa_url) patch.line_oa_url = oa;
    if (Object.keys(patch).length) {
      await sbFetch(`delivery_customers?id=eq.${cust.id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      Object.assign(cust, patch);
    }
    return cust;
  }

  /* ไม่มี → สร้างใหม่ */
  const created = await sbJson("delivery_customers", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      customer_name: name,
      line_id: lineId || null,
      province: province || null,
      phone: phone || null,
      line_oa_url: oa || null,
    }),
  });
  const row = Array.isArray(created) ? created[0] : created;
  state.customers.push(row);
  return row;
}

window.saveOrder = async function () {
  const name = val("fCustomer");
  if (!name) return toast("กรอกรายชื่อลูกค้าก่อน", "error");
  if (!val("fOrderDate")) return toast("เลือก Order Date ก่อน", "error");

  const needPerm = state.editId ? "delivery_edit" : "delivery_create";
  if (!can(needPerm)) return toast("ไม่มีสิทธิ์ทำรายการนี้", "error");

  showLoading(true);
  try {
    const cust = await resolveCustomer();
    const csId = val("fCs");
    const csUser = state.csUsers.find((u) => String(u.user_id) === csId);
    const me = currentUser();

    const payload = {
      order_date: val("fOrderDate"),
      ship_date: val("fShipDate") || null,
      cs_user_id: csId ? Number(csId) : null,
      cs_name: csUser ? csUser.full_name : null,
      customer_id: cust ? cust.id : null,
      customer_name: name,
      line_id: val("fLineId") || null,
      province: val("fProvince") || null,
      phone: val("fPhone") || null,
      courier: val("fCourier") || "KEX",
      tracking_no: val("fTracking") || null,
      shipping_cost: Number(val("fCost") || 0),
      note: val("fNote") || null,
    };

    if (state.editId) {
      await sbFetch(`delivery_orders?id=eq.${state.editId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      toast("บันทึกการแก้ไขแล้ว");
    } else {
      payload.created_by = me?.user_id ? Number(me.user_id) : null;
      await sbFetch("delivery_orders", { method: "POST", body: JSON.stringify(payload) });
      toast("เพิ่มรายการแล้ว");
    }

    await loadOrders();
    const keep = {
      ship: val("fShipDate"),
      cs: val("fCs"),
      line: val("fLineId"),        /* ยังอยู่บัญชี LINE เดิม — 1 บัญชีมักสั่งให้หลายคน (เหมือนชีต) */
      lineCustId: val("fCustomerId"),
      oa: val("fOaLink"),
    };
    resetForm();
    /* ตารางเป็นรายวัน → เด้งไปวันของบิลที่เพิ่งบันทึก */
    setDay(payload.order_date);   /* setDay → clearSelection → renderTable ให้ในตัว */
    $("fShipDate").value = keep.ship;
    $("fCs").value = keep.cs;
    $("fLineId").value = keep.line;
    $("fCustomerId").value = keep.lineCustId;
    $("fOaLink").value = keep.oa;
    updateFkHint();
    refreshOaStatus();
    $("fCustomer").focus();       /* พร้อมกรอกผู้รับคนถัดไปทันที */
  } catch (e) {
    console.error(e);
    toast("บันทึกไม่สำเร็จ: " + e.message, "error");
  } finally {
    showLoading(false);
  }
};

window.editRow = function (id) {
  const r = state.orders.find((o) => String(o.id) === String(id));
  if (!r) return;
  state.editId = r.id;
  $("fEditId").value = r.id;
  $("fCustomerId").value = r.customer_id || "";
  $("fOrderDate").value = r.order_date || "";
  $("fShipDate").value = r.ship_date || "";
  $("fCs").value = r.cs_user_id ? String(r.cs_user_id) : "";
  $("fLineId").value = r.line_id || "";
  $("fCustomer").value = r.customer_name || "";
  $("fProvince").value = r.province || "";
  $("fPhone").value = r.phone || "";
  $("fCourier").value = r.courier || "KEX";
  $("fTracking").value = r.tracking_no || "";
  $("fCost").value = r.shipping_cost ?? 0;
  $("fNote").value = r.note || "";
  const cust = state.customers.find((c) => String(c.id) === String(r.customer_id));
  $("fOaLink").value = cust?.line_oa_url || "";
  updateFkHint();
  refreshOaStatus();

  $("dtFormCard").classList.add("editing");
  $("dtFormTitle").textContent = "✏️ แก้ไขรายการจัดส่ง";
  $("dtAddBtn").textContent = "💾 บันทึกการแก้ไข";
  /* โหมดแก้ไขใช้สิทธิ์ delivery_edit — คนที่เพิ่มไม่ได้แต่แก้ได้ ต้องเห็นปุ่มนี้ */
  $("dtAddBtn").style.display = can("delivery_edit") ? "" : "none";
  $("dtCancelEditBtn").style.display = "";
  window.scrollTo({ top: 0, behavior: "smooth" });
  renderTable();
};

/* ── ผูก Line OA URL เข้ากับลูกค้า (ปุ่ม Save line OA) ── */
window.saveLineOa = async function () {
  if (!can("delivery_edit")) return toast("ไม่มีสิทธิ์แก้ไข", "error");
  const url = val("fOaLink");
  const name = val("fCustomer");
  if (!name) return toast("เลือก/กรอกรายชื่อลูกค้าก่อน", "error");
  if (!url) return toast("ใส่ LineOA Link ก่อน", "error");

  showLoading(true);
  try {
    const cust = await resolveCustomer();   // สร้าง master ให้ถ้ายังไม่มี + เขียน url ให้เลย
    if (cust && cust.line_oa_url !== url) {
      await sbFetch(`delivery_customers?id=eq.${cust.id}`, {
        method: "PATCH",
        body: JSON.stringify({ line_oa_url: url }),
      });
      cust.line_oa_url = url;
    }
    renderTable();
    toast(`ผูก Line OA ให้ "${cust.customer_name}" แล้ว`);
  } catch (e) {
    console.error(e);
    toast("บันทึก Line OA ไม่สำเร็จ: " + e.message, "error");
  } finally {
    showLoading(false);
  }
};

/* ============================================================
   TABLE
   ============================================================ */
function filteredOrders() {
  const q = norm($("fltSearch")?.value);
  const cs = $("fltCs")?.value || "";
  const courier = $("fltCourier")?.value || "";
  const sent = $("fltSent")?.value || "";
  const day = state.allDays ? "" : state.day;   /* มุมมองรายวัน = กรองตาม Order Date วันเดียว */

  return state.orders.filter((r) => {
    if (day && (r.order_date || "") !== day) return false;
    if (cs && String(r.cs_user_id || "") !== cs) return false;
    if (courier && (r.courier || "") !== courier) return false;
    if (sent === "1" && !r.track_sent) return false;
    if (sent === "0" && r.track_sent) return false;
    if (q) {
      const hay = norm(
        [r.customer_name, r.line_id, r.tracking_no, r.phone, r.province, r.cs_name, r.note].join(" ")
      );
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/* ============================================================
   มุมมองรายวัน (แบบหน้า Daily Sale)
   ตารางแสดงทีละวัน · ข้ามวัน = เปิดชีตของวันนั้น
   ข้อมูลถูกบันทึกรายบิลพร้อม order_date อยู่แล้ว จึงเป็น "save รายวัน" โดยตัวมันเอง
   ============================================================ */
const TH_MONTH = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
                  "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
function thaiFullDate(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return `${Number(m[3])} ${TH_MONTH[Number(m[2]) - 1]} ${Number(m[1]) + 543}`;
}

/* เปลี่ยนวันที่กำลังดู + ให้ฟอร์มบันทึกลงวันเดียวกัน */
window.setDay = function (iso) {
  state.day = iso || todayISO();
  const el = $("fltDay");
  if (el) el.value = state.day;
  /* ฟอร์มตามวันที่เปิดอยู่ — ยกเว้นตอนกำลังแก้บิลเก่า */
  if (!state.editId) {
    $("fOrderDate").value = state.day;
    $("fShipDate").value = state.day;
  }
  clearSelection();   /* เปลี่ยนวัน = ล้างที่เลือกไว้ กัน bulk ข้ามวัน */
};

window.shiftDay = function (delta) {
  if (state.allDays) {
    $("fltAllDays").checked = false;
    state.allDays = false;
  }
  if (!delta) return setDay(todayISO());
  const d = new Date(state.day + "T00:00:00");
  d.setDate(d.getDate() + delta);
  setDay(
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  );
};

function updateDayUI(shown) {
  const today = todayISO();
  $("dtChipToday").classList.toggle("active", !state.allDays && state.day === today);
  ["fltDay", "dtChipPrev", "dtChipNext"].forEach((id) => {
    const el = $(id);
    if (el) el.disabled = state.allDays;
  });

  const title = $("dtSheetTitle");
  if (state.allDays) {
    title.innerHTML = `🗂 ทุกวันรวมกัน · <small>${shown.toLocaleString()} รายการ</small>`;
  } else {
    title.innerHTML =
      `วันที่ ${thaiFullDate(state.day)}` +
      ` · <small>${shown ? `${shown.toLocaleString()} รายการ` : "ยังไม่มีรายการของวันนี้"}</small>`;
  }

  const last = state.orders.length ? state.orders[0].order_date : null;
  $("dtDayInfo").textContent =
    `ทั้งหมด ${state.orders.length.toLocaleString()} รายการ` +
    (last ? ` · ล่าสุด ${fmtDate(last)}` : "");
}

/* จำกัดจำนวนแถวที่ "วาด" (สถิติยังนับจากผลกรองทั้งหมด) — กันหน้าหน่วงตอนดูข้อมูลย้อนหลังหลายพันแถว */
const RENDER_CAP = 800;
function visibleOrders() {
  return filteredOrders().slice(0, RENDER_CAP);
}

function custOf(row) {
  return state.customers.find((c) => String(c.id) === String(row.customer_id)) || null;
}

function trackUrl(row) {
  const c = COURIERS[row.courier] || COURIERS.OTHER;
  return c.url && row.tracking_no ? c.url + encodeURIComponent(row.tracking_no) : "";
}

function renderTable() {
  const rows = filteredOrders();
  const body = $("dtBody");

  /* ── stats ── */
  const sent = rows.filter((r) => r.track_sent).length;
  const cost = rows.reduce((s, r) => s + Number(r.shipping_cost || 0), 0);
  $("statTotal").textContent = rows.length.toLocaleString();
  $("statSent").textContent = sent.toLocaleString();
  $("statSentSub").textContent = rows.length ? `${Math.round((sent / rows.length) * 100)}%` : "0%";
  $("statPending").textContent = (rows.length - sent).toLocaleString();
  $("statCost").textContent = fmtMoney(cost);
  $("dtCount").textContent = `${rows.length.toLocaleString()} รายการ`;
  updateDayUI(rows.length);

  /* แถวรวมค่าส่งท้ายตาราง = ปุ่ม "คิดราคา" ของชีตเดิม (คิดให้อัตโนมัติ) */
  $("dtFootTotal").style.display = rows.length ? "" : "none";
  $("dtFootCost").textContent = fmtMoney(cost);
  $("dtFootScope").textContent = state.allDays
    ? " (ทุกวันที่กรองอยู่)"
    : ` วันที่ ${fmtDate(state.day)}`;

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="14">
      <div class="empty-state"><div class="empty-icon">🚚</div>
      <div>${
        state.allDays
          ? "ไม่พบรายการตามเงื่อนไขที่กรอง"
          : `ยังไม่มีรายการจัดส่งของวันที่ ${fmtDate(state.day)} — กรอกฟอร์มด้านบนแล้วกด ＋ เพิ่ม ได้เลย`
      }</div></div></td></tr>`;
    updateBulkBar();
    return;
  }

  const view = rows.slice(0, RENDER_CAP);
  body.innerHTML = view
    .map((r) => {
      const cust = custOf(r);
      const oa = safeUrl(cust?.line_oa_url);
      const url = trackUrl(r);
      const cls = [r.track_sent ? "dt-sent" : "", String(r.id) === String(state.editId) ? "dt-row-edit" : ""]
        .filter(Boolean).join(" ");
      return `
      <tr class="${cls}">
        <td class="dt-col-chk">
          <input type="checkbox" ${state.selected.has(r.id) ? "checked" : ""}
                 onchange="window.toggleSelect(${r.id}, this.checked)" />
        </td>
        <td class="dt-col-send">
          <input type="checkbox" ${r.track_sent ? "checked" : ""}
                 onchange="window.toggleSent(${r.id}, this.checked)" title="ติ๊กเมื่อส่ง Tracking ให้ลูกค้าแล้ว" />
        </td>
        <td>${esc(fmtDate(r.order_date))}</td>
        <td>${r.ship_date ? esc(fmtDate(r.ship_date)) : '<span style="color:var(--text3)">—</span>'}</td>
        <td>${esc(r.cs_name || "—")}</td>
        <td>
          <div class="dt-cust">
            <span class="dt-cust-name">${esc(r.customer_name || "—")}</span>
            <span class="dt-cust-line">${r.line_id ? "🆔 " + esc(r.line_id) : ""}</span>
          </div>
        </td>
        <td>${esc(r.province || "—")}</td>
        <td>${esc(r.phone || "—")}</td>
        <td><span class="dt-chip ${r.courier === "OTHER" ? "dt-chip-muted" : ""}">${esc((COURIERS[r.courier] || COURIERS.OTHER).label)}</span></td>
        <td class="dt-track dt-editable" data-id="${r.id}" data-f="tracking_no"
            title="คลิกเพื่อพิมพ์/แก้เลขพัสดุ" onclick="window.editCell(event, this)">${
          r.tracking_no
            ? url
              ? `<a href="${esc(url)}" target="_blank" rel="noopener" title="เปิดหน้าติดตามพัสดุ">${esc(r.tracking_no)}</a>`
              : esc(r.tracking_no)
            : '<span class="dt-cell-empty">— ใส่เลข —</span>'
        }</td>
        <td class="dt-num dt-editable" data-id="${r.id}" data-f="shipping_cost"
            title="คลิกเพื่อแก้ค่าส่ง" onclick="window.editCell(event, this)">${fmtMoney(r.shipping_cost)}</td>
        <td style="text-align:center">
          <button class="dt-icon-btn" onclick="window.openMsgModal(${r.id})" title="สร้างข้อความแจ้งลูกค้า">💬</button>
        </td>
        <td style="text-align:center">${
          oa
            ? `<a class="dt-icon-btn" href="${esc(oa)}" target="_blank" rel="noopener" title="เปิดแชท Line OA">🔗</a>`
            : `<span class="dt-icon-btn dt-off" title="ยังไม่ผูก Line OA">🔗</span>`
        }</td>
        <td class="dt-col-act">
          <button class="dt-icon-btn" data-perm="delivery_edit" onclick="window.editRow(${r.id})" title="แก้ไข">✏️</button>
          <button class="dt-icon-btn dt-danger" data-perm="delivery_delete" onclick="window.deleteRow(${r.id})" title="ลบ">🗑</button>
        </td>
      </tr>`;
    })
    .join("");

  if (rows.length > view.length) {
    body.insertAdjacentHTML(
      "beforeend",
      `<tr><td colspan="14" style="text-align:center;padding:14px;color:var(--text2);background:var(--surface-soft)">
         แสดง ${view.length.toLocaleString()} จาก ${rows.length.toLocaleString()} รายการ ·
         เลือกวันจากแถบ 📅 ด้านบน หรือใช้ตัวกรอง (CS / ค้นหา) เพื่อดูรายการที่เหลือ — ตัวเลขสรุปด้านบนนับครบทุกรายการที่กรองแล้ว
       </td></tr>`
    );
  }

  applyPerms(body);
  updateBulkBar();
}

/* ── เดาบริษัทขนส่งจากรูปแบบเลขพัสดุ (ชีตเดิมใช้ KEX เป็นหลัก) ── */
function guessCourier(tracking) {
  const t = String(tracking || "").trim().toUpperCase();
  if (/^ESCH/.test(t)) return "KEX";
  if (/^TH\d/.test(t) || /^LP\d/.test(t)) return "FLASH";
  if (/^OSA/.test(t)) return "JT";
  return null;
}

/* ── คลิกแก้ Tracking / ค่าส่ง ในตารางได้เลย (เหมือนพิมพ์ในชีต) ── */
window.editCell = function (e, td) {
  if (e.target.closest("a") || td.querySelector("input")) return;   /* คลิกลิงก์ = เปิดหน้า track */
  if (!can("delivery_edit")) return toast("ไม่มีสิทธิ์แก้ไข", "error");

  const id = Number(td.dataset.id);
  const field = td.dataset.f;
  const row = state.orders.find((o) => o.id === id);
  if (!row) return;

  const isNum = field === "shipping_cost";
  const old = row[field] ?? (isNum ? 0 : "");
  const inp = document.createElement("input");
  inp.className = "dt-cell-input" + (isNum ? " dt-num-input" : "");
  if (isNum) { inp.type = "number"; inp.step = "0.01"; inp.min = "0"; }
  inp.value = old ?? "";
  td.innerHTML = "";
  td.appendChild(inp);
  inp.focus();
  inp.select();

  let closed = false;
  async function commit() {
    if (closed) return;
    closed = true;
    const v = isNum ? Number(inp.value || 0) : inp.value.trim();
    if (String(v ?? "") === String(old ?? "")) return renderTable();
    const patch = { [field]: isNum ? v : v || null };
    if (field === "tracking_no" && v) patch.courier = guessCourier(v) || row.courier;
    try {
      await sbFetch(`delivery_orders?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      Object.assign(row, patch);
      toast("บันทึกแล้ว");
    } catch (err) {
      console.error(err);
      toast("บันทึกไม่สำเร็จ: " + err.message, "error");
    }
    renderTable();
  }

  inp.addEventListener("blur", commit);
  inp.addEventListener("keydown", (ev) => {
    ev.stopPropagation();
    if (ev.key === "Enter") { ev.preventDefault(); inp.blur(); }
    else if (ev.key === "Escape") { closed = true; renderTable(); }
  });
};

/* ── ติ๊ก "ส่ง Track" ── */
window.toggleSent = async function (id, checked) {
  if (!can("delivery_edit")) { toast("ไม่มีสิทธิ์แก้ไข", "error"); renderTable(); return; }
  const r = state.orders.find((o) => o.id === id);
  if (!r) return;
  try {
    await sbFetch(`delivery_orders?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify({ track_sent: checked, track_sent_at: checked ? new Date().toISOString() : null }),
    });
    r.track_sent = checked;
    r.track_sent_at = checked ? new Date().toISOString() : null;
    renderTable();
  } catch (e) {
    console.error(e);
    toast("อัปเดตไม่สำเร็จ: " + e.message, "error");
    renderTable();
  }
};

window.deleteRow = function (id) {
  const r = state.orders.find((o) => o.id === id);
  if (!r) return;
  DeleteModal.open(
    `ลบรายการจัดส่งของ "${r.customer_name || "-"}" วันที่ ${fmtDate(r.order_date)} ?`,
    async () => {
      try {
        await sbFetch(`delivery_orders?id=eq.${id}`, { method: "DELETE" });
        state.orders = state.orders.filter((o) => o.id !== id);
        state.selected.delete(id);
        if (String(state.editId) === String(id)) resetForm();
        else renderTable();
        toast("ลบแล้ว");
      } catch (e) {
        console.error(e);
        toast("ลบไม่สำเร็จ: " + e.message, "error");
      }
    }
  );
};

/* ============================================================
   SELECTION + BULK
   ============================================================ */
window.toggleSelect = function (id, checked) {
  if (checked) state.selected.add(id);
  else state.selected.delete(id);
  updateBulkBar();
};

window.toggleSelectAll = function (checked) {
  const rows = visibleOrders();   /* เลือกเฉพาะแถวที่เห็นจริง กันติ๊กโดนแถวที่ถูกตัดออกจากการแสดงผล */
  if (checked) rows.forEach((r) => state.selected.add(r.id));
  else rows.forEach((r) => state.selected.delete(r.id));
  renderTable();
};

window.clearSelection = function () {
  state.selected.clear();
  const all = $("dtChkAll");
  if (all) all.checked = false;
  renderTable();
};

function updateBulkBar() {
  const rows = visibleOrders();
  const ids = rows.filter((r) => state.selected.has(r.id));
  const bar = $("dtBulkBar");
  bar.style.display = ids.length ? "" : "none";
  $("dtBulkCount").textContent = ids.length;
  $("dtBulkCost").textContent = fmtMoney(ids.reduce((s, r) => s + Number(r.shipping_cost || 0), 0));
  const all = $("dtChkAll");
  if (all) all.checked = rows.length > 0 && ids.length === rows.length;
}

window.bulkSetSent = async function (flag) {
  if (!can("delivery_edit")) return toast("ไม่มีสิทธิ์แก้ไข", "error");
  const ids = [...state.selected];
  if (!ids.length) return;
  const ok = await ConfirmModal.open({
    title: flag ? "ติ๊กส่ง Track" : "ยกเลิกติ๊ก",
    message: `${flag ? "ทำเครื่องหมายว่าส่ง Track แล้ว" : "ยกเลิกเครื่องหมายส่ง Track"} ${ids.length} รายการ?`,
    icon: flag ? "✅" : "↩️",
    okText: "ตกลง",
    tone: "primary",
  });
  if (!ok) return;

  showLoading(true);
  try {
    const now = new Date().toISOString();
    await sbFetch(`delivery_orders?id=in.(${ids.join(",")})`, {
      method: "PATCH",
      body: JSON.stringify({ track_sent: flag, track_sent_at: flag ? now : null }),
    });
    state.orders.forEach((o) => {
      if (state.selected.has(o.id)) { o.track_sent = flag; o.track_sent_at = flag ? now : null; }
    });
    clearSelection();
    toast(`อัปเดต ${ids.length} รายการแล้ว`);
  } catch (e) {
    console.error(e);
    toast("อัปเดตไม่สำเร็จ: " + e.message, "error");
  } finally {
    showLoading(false);
  }
};

window.bulkDelete = async function () {
  if (!can("delivery_delete")) return toast("ไม่มีสิทธิ์ลบ", "error");
  const ids = [...state.selected];
  if (!ids.length) return;
  const ok = await ConfirmModal.open({
    title: "ลบรายการที่เลือก",
    message: `ลบรายการจัดส่ง ${ids.length} รายการ?`,
    icon: "🗑",
    okText: "ลบเลย",
    tone: "danger",
    note: "⚠️ การลบนี้ถาวร กู้คืนไม่ได้",
  });
  if (!ok) return;

  showLoading(true);
  try {
    await sbFetch(`delivery_orders?id=in.(${ids.join(",")})`, { method: "DELETE" });
    state.orders = state.orders.filter((o) => !state.selected.has(o.id));
    clearSelection();
    toast(`ลบ ${ids.length} รายการแล้ว`);
  } catch (e) {
    console.error(e);
    toast("ลบไม่สำเร็จ: " + e.message, "error");
  } finally {
    showLoading(false);
  }
};

/* ============================================================
   MESSAGE MODAL — ข้อความส่งลูกค้า
   ============================================================ */
function buildMessage(r) {
  const courier = (COURIERS[r.courier] || COURIERS.OTHER).label;
  const url = trackUrl(r);
  const date = fmtDate(r.ship_date || r.order_date);
  const lines = [
    `เรียน คุณ${r.customer_name || ""}`,
    `ทางบริษัทฯ ได้จัดส่งสินค้ารอบวันที่ ${date} ให้เรียบร้อยแล้วนะคะ`,
  ];
  if (r.tracking_no) {
    lines.push(`ลูกค้า ${courier} ตรวจสอบพัสดุผ่านลิงค์ด้านล่างได้เลยค่ะ`);
    lines.push(url || `เลขพัสดุ: ${r.tracking_no}`);
  }
  lines.push("ขอบคุณที่ใช้บริการค่ะ");
  return lines.join("\n");
}

window.openMsgModal = function (id) {
  const r = state.orders.find((o) => o.id === id);
  if (!r) return;
  state.msgRowId = id;
  $("msgText").value = buildMessage(r);
  const oa = safeUrl(custOf(r)?.line_oa_url);
  const btn = $("msgOaBtn");
  if (oa) { btn.href = oa; btn.style.display = ""; } else { btn.style.display = "none"; }
  $("msgModal").classList.add("open");
};

window.closeMsgModal = function () {
  $("msgModal").classList.remove("open");
};

window.copyMsg = async function () {
  const text = $("msgText").value;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = $("msgText");
    ta.select();
    document.execCommand("copy");
  }
  toast("คัดลอกข้อความแล้ว");
};

/* ============================================================
   CUSTOMER MANAGER — In-Context CRUD
   ============================================================ */
window.openCustManager = function () {
  $("custModal").classList.add("open");
  renderCustManager();
};
window.closeCustManager = function () {
  $("custModal").classList.remove("open");
};

window.renderCustManager = function () {
  const q = norm($("cmSearch")?.value);
  const list = state.customers.filter((c) =>
    !q || norm([c.customer_name, c.line_id, c.province, c.phone].join(" ")).includes(q)
  );
  const box = $("cmList");
  if (!list.length) {
    box.innerHTML = `<div class="empty-state"><div class="empty-icon">👥</div><div>ยังไม่มีรายชื่อลูกค้า</div></div>`;
    return;
  }
  box.innerHTML = list
    .map(
      (c) => `
      <div class="dt-cust-row" data-id="${c.id}">
        <input class="form-control" value="${esc(c.line_id || "")}" data-f="line_id" placeholder="Line ID" />
        <input class="form-control" value="${esc(c.customer_name || "")}" data-f="customer_name" placeholder="ชื่อลูกค้า" />
        <input class="form-control" value="${esc(c.province || "")}" data-f="province" placeholder="จังหวัด" />
        <input class="form-control" value="${esc(c.phone || "")}" data-f="phone" placeholder="เบอร์" />
        <input class="form-control" value="${esc(c.line_oa_url || "")}" data-f="line_oa_url" placeholder="Line OA Link" />
        <div class="dt-cust-actions">
          <button class="dt-icon-btn" data-perm="delivery_edit" onclick="window.saveCustEntry(${c.id})" title="บันทึก">💾</button>
          <button class="dt-icon-btn dt-danger" data-perm="delivery_delete" onclick="window.deleteCustEntry(${c.id})" title="ลบ">🗑</button>
        </div>
      </div>`
    )
    .join("");
  applyPerms(box);
};

window.addCustEntry = async function () {
  if (!can("delivery_create")) return toast("ไม่มีสิทธิ์เพิ่ม", "error");
  const name = val("cmNewName");
  if (!name) return toast("กรอกชื่อลูกค้าก่อน", "error");
  const lineId = val("cmNewLineId");
  if (lineId && findCustomerByLineId(lineId)) return toast("Line ID นี้มีอยู่แล้ว", "error");

  try {
    const created = await sbJson("delivery_customers", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        customer_name: name,
        line_id: lineId || null,
        province: val("cmNewProvince") || null,
        phone: val("cmNewPhone") || null,
      }),
    });
    state.customers.push(Array.isArray(created) ? created[0] : created);
    state.customers.sort((a, b) => (a.customer_name || "").localeCompare(b.customer_name || "", "th"));
    ["cmNewLineId", "cmNewName", "cmNewProvince", "cmNewPhone"].forEach((id) => ($(id).value = ""));
    renderCustManager();
    toast("เพิ่มลูกค้าแล้ว");
  } catch (e) {
    console.error(e);
    toast("เพิ่มไม่สำเร็จ: " + e.message, "error");
  }
};

window.saveCustEntry = async function (id) {
  if (!can("delivery_edit")) return toast("ไม่มีสิทธิ์แก้ไข", "error");
  const row = $("cmList").querySelector(`.dt-cust-row[data-id="${id}"]`);
  if (!row) return;
  const patch = {};
  row.querySelectorAll("[data-f]").forEach((el) => {
    patch[el.dataset.f] = el.value.trim() || null;
  });
  if (!patch.customer_name) return toast("ชื่อลูกค้าห้ามว่าง", "error");
  const dup = patch.line_id && state.customers.find(
    (c) => String(c.id) !== String(id) && norm(c.line_id) === norm(patch.line_id)
  );
  if (dup) return toast(`Line ID ซ้ำกับ "${dup.customer_name}"`, "error");

  try {
    await sbFetch(`delivery_customers?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    const c = state.customers.find((x) => String(x.id) === String(id));
    if (c) Object.assign(c, patch);
    renderTable();
    toast("บันทึกแล้ว");
  } catch (e) {
    console.error(e);
    toast("บันทึกไม่สำเร็จ: " + e.message, "error");
  }
};

window.deleteCustEntry = async function (id) {
  if (!can("delivery_delete")) return toast("ไม่มีสิทธิ์ลบ", "error");
  const c = state.customers.find((x) => String(x.id) === String(id));
  if (!c) return;
  const used = state.orders.filter((o) => String(o.customer_id) === String(id)).length;
  const ok = await ConfirmModal.open({
    title: "ลบลูกค้า",
    message: `ลบ "${c.customer_name}" ออกจากรายชื่อ?`,
    icon: "🗑",
    okText: "ลบเลย",
    tone: "danger",
    note: used
      ? `⚠️ ลูกค้ารายนี้ถูกใช้ใน ${used} รายการจัดส่ง — รายการเดิมยังอยู่ครบ (เก็บชื่อไว้ในแถวแล้ว) แต่ลิงก์ Line OA จะหายไป`
      : undefined,
  });
  if (!ok) return;

  try {
    await sbFetch(`delivery_customers?id=eq.${id}`, { method: "DELETE" });
    state.customers = state.customers.filter((x) => String(x.id) !== String(id));
    renderCustManager();
    renderTable();
    toast("ลบแล้ว");
  } catch (e) {
    console.error(e);
    toast("ลบไม่สำเร็จ: " + e.message, "error");
  }
};

/* ============================================================
   KEX IMPORT — เติม Tracking + ค่าส่ง โดยเทียบชื่อลูกค้า
   ============================================================ */
window.openKexImport = function () {
  state.kexRows = [];
  $("kexPaste").value = "";
  $("kexPreview").style.display = "none";
  $("kexPreview").innerHTML = "";
  $("kexSummary").textContent = "";
  $("kexApplyBtn").disabled = true;
  $("kexModal").classList.add("open");
};
window.closeKexImport = function () {
  $("kexModal").classList.remove("open");
};

/* หาคอลัมน์ชื่อ/tracking/ค่าส่ง จากหัวตารางแบบยืดหยุ่น */
function pickKexColumns(header) {
  const idx = { name: -1, track: -1, cost: -1 };
  header.forEach((h, i) => {
    const t = norm(h);
    if (idx.name < 0 && /(ชื่อ|ผู้รับ|consignee|receiver|customer|name)/.test(t)) idx.name = i;
    if (idx.track < 0 && /(track|พัสดุ|เลขที่|consignment|awb|no\.)/.test(t)) idx.track = i;
    if (idx.cost < 0 && /(ค่าส่ง|ค่าขนส่ง|freight|price|amount|ราคา|cost)/.test(t)) idx.cost = i;
  });
  return idx;
}

function matchKexRows(raw) {
  /* raw = [[name, tracking, cost], ...] */
  const pending = filteredOrders();
  const used = new Set();
  return raw
    .filter((r) => (r[0] || "").toString().trim() || (r[1] || "").toString().trim())
    .map((r) => {
      const name = String(r[0] ?? "").trim();
      const tracking = String(r[1] ?? "").trim();
      const cost = Number(String(r[2] ?? "").replace(/[^\d.-]/g, "")) || 0;
      /* จับคู่แถวแรกที่ชื่อตรงและยังไม่ถูกใช้ — เติมให้แถวที่ยังไม่มี tracking ก่อน */
      const cands = pending.filter((o) => norm(o.customer_name) === norm(name) && !used.has(o.id));
      const target = cands.find((o) => !o.tracking_no) || cands[0] || null;
      if (target) used.add(target.id);
      return { name, tracking, cost, target };
    });
}

function renderKexPreview() {
  const rows = state.kexRows;
  const hit = rows.filter((r) => r.target).length;
  $("kexSummary").textContent = `จับคู่ได้ ${hit} / ${rows.length} แถว`;
  $("kexApplyBtn").disabled = hit === 0;
  $("kexPreview").style.display = rows.length ? "" : "none";
  $("kexPreview").innerHTML = `
    <table>
      <thead><tr><th>ชื่อในไฟล์</th><th>Tracking</th><th>ค่าส่ง</th><th>จับคู่กับ</th></tr></thead>
      <tbody>
        ${rows
          .map(
            (r) => `<tr>
              <td>${esc(r.name)}</td>
              <td class="dt-track">${esc(r.tracking)}</td>
              <td>${fmtMoney(r.cost)}</td>
              <td class="${r.target ? "dt-kex-hit" : "dt-kex-miss"}">${
                r.target
                  ? `✅ ${esc(r.target.customer_name)} · ${esc(fmtDate(r.target.order_date))}`
                  : "✕ ไม่พบรายการที่ตรงกัน"
              }</td>
            </tr>`
          )
          .join("")}
      </tbody>
    </table>`;
}

window.parseKexPaste = function () {
  const text = $("kexPaste").value.trim();
  if (!text) return toast("ยังไม่ได้วางข้อมูล", "error");
  const raw = text
    .split(/\r?\n/)
    .map((line) => line.split(/\t|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.replace(/^"|"$/g, "").trim()));
  /* ถ้าแถวแรกดูเป็นหัวตาราง ให้ตัดออก + เรียงคอลัมน์ตามหัว */
  const idx = pickKexColumns(raw[0] || []);
  let body = raw;
  if (idx.name >= 0 || idx.track >= 0) {
    body = raw.slice(1).map((r) => [r[idx.name] ?? r[0], r[idx.track] ?? r[1], r[idx.cost] ?? r[2]]);
  }
  state.kexRows = matchKexRows(body);
  renderKexPreview();
};

function readKexFile(file) {
  if (typeof XLSX === "undefined") return toast("โหลดตัวอ่านไฟล์ไม่สำเร็จ — ลองรีเฟรชหน้า", "error");
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const wb = XLSX.read(e.target.result, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
      if (!rows.length) return toast("ไฟล์ว่าง", "error");
      const idx = pickKexColumns(rows[0] || []);
      const body =
        idx.name >= 0 || idx.track >= 0
          ? rows.slice(1).map((r) => [r[idx.name] ?? r[0], r[idx.track] ?? r[1], r[idx.cost] ?? r[2]])
          : rows;
      state.kexRows = matchKexRows(body);
      renderKexPreview();
      toast(`อ่านไฟล์แล้ว ${body.length} แถว`);
    } catch (err) {
      console.error(err);
      toast("อ่านไฟล์ไม่สำเร็จ: " + err.message, "error");
    }
  };
  reader.readAsArrayBuffer(file);
}

window.applyKexImport = async function () {
  if (!can("delivery_edit")) return toast("ไม่มีสิทธิ์แก้ไข", "error");
  const hits = state.kexRows.filter((r) => r.target && r.tracking);
  if (!hits.length) return toast("ไม่มีแถวที่จับคู่ได้", "error");

  const ok = await ConfirmModal.open({
    title: "เติมข้อมูลจาก KEX",
    message: `เติม Tracking + ค่าส่ง ให้ ${hits.length} รายการ?`,
    icon: "📥",
    okText: "เติมเลย",
    tone: "primary",
    note: "ค่าเดิมในช่อง Tracking / ค่าส่ง ของรายการที่จับคู่ได้จะถูกทับ",
  });
  if (!ok) return;

  showLoading(true);
  try {
    for (const h of hits) {
      const patch = { tracking_no: h.tracking, courier: h.target.courier || "KEX" };
      if (h.cost) patch.shipping_cost = h.cost;
      await sbFetch(`delivery_orders?id=eq.${h.target.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      Object.assign(h.target, patch);
    }
    closeKexImport();
    renderTable();
    toast(`เติมข้อมูล ${hits.length} รายการแล้ว`);
  } catch (e) {
    console.error(e);
    toast("เติมข้อมูลไม่สำเร็จ: " + e.message, "error");
  } finally {
    showLoading(false);
  }
};

/* ============================================================
   EXPORT / FILTERS / BOOT
   ============================================================ */
window.exportExcel = function () {
  if (typeof XLSX === "undefined") return toast("โหลดตัวเขียนไฟล์ไม่สำเร็จ", "error");
  const rows = filteredOrders().map((r) => ({
    "ส่ง Track": r.track_sent ? "✔" : "",
    "Order Date": fmtDate(r.order_date),
    "วันที่จัดส่ง": fmtDate(r.ship_date),
    CS: r.cs_name || "",
    "Line ID": r.line_id || "",
    "รายชื่อลูกค้า": r.customer_name || "",
    "จังหวัด": r.province || "",
    "เบอร์โทรศัพท์": r.phone || "",
    "ขนส่ง": (COURIERS[r.courier] || COURIERS.OTHER).label,
    Tracking: r.tracking_no || "",
    "ค่าส่ง": Number(r.shipping_cost || 0),
    "หมายเหตุ": r.note || "",
    "ข้อความส่งลูกค้า": buildMessage(r),
  }));
  if (!rows.length) return toast("ไม่มีข้อมูลให้ export", "error");
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, state.allDays ? "ทั้งหมด" : fmtDate(state.day).replace(/\//g, "-"));
  XLSX.writeFile(wb, `order-tracking-${state.allDays ? "all" : state.day}.xlsx`);
};

window.clearFilters = function () {
  ["fltSearch", "fltCs", "fltCourier", "fltSent"].forEach((id) => ($(id).value = ""));
  renderTable();   /* ไม่แตะวันที่ที่เปิดอยู่ — เปลี่ยนวันใช้แถบ 📅 ด้านบน */
};

window.reloadAll = async function () {
  showLoading(true);
  try {
    await Promise.all([loadCustomers(), loadOrders()]);
    renderTable();
    toast("รีเฟรชแล้ว");
  } catch (e) {
    console.error(e);
    toast("โหลดข้อมูลไม่สำเร็จ: " + e.message, "error");
  } finally {
    showLoading(false);
  }
};

async function boot() {
  showLoading(true);
  try {
    setDay(todayISO());          /* เปิดหน้ามา = ชีตของวันนี้ */
    refreshOaStatus();
    await Promise.all([loadCsUsers(), loadCustomers(), loadOrders()]);
    renderTable();
  } catch (e) {
    console.error(e);
    toast("โหลดข้อมูลไม่สำเร็จ: " + e.message, "error");
  } finally {
    showLoading(false);
  }

  initAllCombos();   /* dropdown อ่าน state สดทุกครั้งที่เปิด — init หลังโหลดหรือก่อนก็ได้ */

  /* filters */
  ["fltSearch", "fltCs", "fltCourier", "fltSent"].forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener(el.tagName === "SELECT" ? "change" : "input", renderTable);
  });

  /* แถบวัน */
  $("fltDay").addEventListener("change", (e) => {
    setDay(e.target.value || todayISO());
  });
  $("fltAllDays").addEventListener("change", (e) => {
    state.allDays = e.target.checked;
    clearSelection();          /* ล้างที่เลือกไว้ + render ให้ในตัว */
  });

  /* Enter ในฟอร์ม = เพิ่มรายการ */
  $("dtFormCard").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.target.tagName === "TEXTAREA") return;
    e.preventDefault();
    saveOrder();
  });

  /* KEX: เลือกไฟล์ / ลากวาง */
  $("kexFile").addEventListener("change", (e) => {
    if (e.target.files?.[0]) readKexFile(e.target.files[0]);
    e.target.value = "";
  });
  const drop = $("kexDrop");
  ["dragover", "dragenter"].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.style.borderColor = "var(--accent-light)"; })
  );
  ["dragleave", "drop"].forEach((ev) =>
    drop.addEventListener(ev, () => { drop.style.borderColor = ""; })
  );
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) readKexFile(f);
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
