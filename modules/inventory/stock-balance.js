/* ============================================================
   stock-balance.js — Stock สินค้า controller
   ----------------------------------------------------------------
   On-hand = signed sum ของ stock_movements ต่อ product+warehouse
             (calc on-the-fly เลี่ยงปัญหา view out-of-sync · ตรงกับ stock-dashboard)
   Reserved = sales_orders.status='CONFIRMED'  (qty_ordered − qty_delivered)
            + requisitions.status='APPROVED'   (qty_approved − qty_issued)
   Available = On-hand − Reserved
   Lot/Expiry = อ่านจาก stock_movements.lot_no / expiry_date (nullable)
   Negative toggle = เก็บใน app_settings.inventory_allow_negative
   ============================================================ */

// ── STATE ───────────────────────────────────────────────────
const state = {
  products: [],
  categories: [],
  warehouses: [],
  movements: [],          // ALL stock_movements (สำหรับ on-hand + lot)
  reservedSO: [],         // {product_id, warehouse_id, qty}
  reservedREQ: [],        // {product_id, warehouse_id, qty}
  allowNegative: true,    // จาก app_settings
};

const filter = { search: "", categoryId: "", warehouseId: "", status: "" };

const EXPIRING_SOON_DAYS = 30;

// ── SUPABASE ────────────────────────────────────────────────
function getSB() {
  return {
    url: localStorage.getItem("sb_url") || "",
    key: localStorage.getItem("sb_key") || "",
  };
}

async function sbFetch(table, query = "") {
  const { url, key } = getSB();
  const res = await fetch(`${url}/rest/v1/${table}${query}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || "Error");
  }
  return res.json();
}

async function sbPatch(table, query, body) {
  const { url, key } = getSB();
  const res = await fetch(`${url}/rest/v1/${table}${query}`, {
    method: "PATCH",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || "Error");
  }
  return res.json();
}

// ── INIT ────────────────────────────────────────────────────
async function init() {
  const { url, key } = getSB();
  if (!url || !key) {
    showToast("ยังไม่ได้เชื่อมต่อ Supabase", "error");
    return;
  }
  bindEvents();
  await loadAll();
}

window.refreshBalance = () => loadAll();

window.resetFilters = () => {
  filter.search = "";
  filter.categoryId = "";
  filter.warehouseId = "";
  filter.status = "";
  $("sbSearch").value = "";
  $("sbCategory").value = "";
  $("sbWarehouse").value = "";
  $("sbStatus").value = "";
  render();
};

async function loadAll() {
  showLoading(true);
  try {
    const [prods, cats, whs, mvs, soReserved, reqReserved, negSetting] =
      await Promise.all([
        sbFetch(
          "products",
          "?select=product_id,product_code,product_name,category_id,reorder_point,parent_product_id,disable_stock_alert,cost_price&is_active=eq.true",
        ),
        sbFetch("categories", "?select=*"),
        sbFetch(
          "warehouses",
          "?select=warehouse_id,warehouse_name,country&is_active=eq.true",
        ),
        // ดึง movements ทั้งหมด (รวม lot/expiry สำหรับ KPI ใกล้หมดอายุ)
        sbFetch(
          "stock_movements",
          "?select=movement_id,product_id,warehouse_id,movement_type,qty,moved_at,ref_doc_type,ref_doc_id,note,lot_no,expiry_date&order=moved_at.desc",
        ).catch((e) => {
          // ถ้า column lot_no/expiry_date ยังไม่ migrate → fallback แบบไม่มีคอลัมน์
          if (/column .* does not exist/i.test(e.message)) {
            return sbFetch(
              "stock_movements",
              "?select=movement_id,product_id,warehouse_id,movement_type,qty,moved_at,ref_doc_type,ref_doc_id,note&order=moved_at.desc",
            );
          }
          throw e;
        }),
        loadReservedSO(),
        loadReservedREQ(),
        loadAllowNegative(),
      ]);

    state.products = prods || [];
    state.categories = cats || [];
    state.warehouses = whs || [];
    state.movements = mvs || [];
    state.reservedSO = soReserved || [];
    state.reservedREQ = reqReserved || [];
    state.allowNegative = negSetting;

    populateFilters();
    $("negToggle").checked = !!state.allowNegative;
    render();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

// ── RESERVED LOAD ───────────────────────────────────────────
// SO ที่ status='CONFIRMED' แต่ยังไม่ส่งของครบ → reserved
async function loadReservedSO() {
  try {
    const headers = await sbFetch(
      "sales_orders",
      "?select=so_id,warehouse_id,status&status=eq.CONFIRMED",
    );
    if (!headers.length) return [];
    const ids = headers.map((h) => h.so_id).join(",");
    const items = await sbFetch(
      "so_items",
      `?select=so_id,product_id,qty_ordered,qty_delivered&so_id=in.(${ids})`,
    );
    const whBySo = {};
    headers.forEach((h) => (whBySo[h.so_id] = h.warehouse_id));
    return items
      .map((it) => ({
        product_id: it.product_id,
        warehouse_id: whBySo[it.so_id],
        qty: Math.max(0, (+it.qty_ordered || 0) - (+it.qty_delivered || 0)),
      }))
      .filter((r) => r.qty > 0);
  } catch (e) {
    console.warn("[stock-balance] reserved SO load failed:", e.message);
    return [];
  }
}

// REQ ที่ status='APPROVED' แต่ยังไม่ออกของครบ → reserved
async function loadReservedREQ() {
  try {
    const headers = await sbFetch(
      "requisitions",
      "?select=req_id,warehouse_id,status&status=eq.APPROVED",
    );
    if (!headers.length) return [];
    const ids = headers.map((h) => h.req_id).join(",");
    const items = await sbFetch(
      "requisition_items",
      `?select=req_id,product_id,qty_approved,qty_issued&req_id=in.(${ids})`,
    );
    const whByReq = {};
    headers.forEach((h) => (whByReq[h.req_id] = h.warehouse_id));
    return items
      .map((it) => ({
        product_id: it.product_id,
        warehouse_id: whByReq[it.req_id],
        qty: Math.max(0, (+it.qty_approved || 0) - (+it.qty_issued || 0)),
      }))
      .filter((r) => r.qty > 0);
  } catch (e) {
    console.warn("[stock-balance] reserved REQ load failed:", e.message);
    return [];
  }
}

async function loadAllowNegative() {
  try {
    const rows = await sbFetch(
      "app_settings",
      "?key=eq.inventory_allow_negative&select=value",
    );
    if (!rows.length) return true; // default: อนุญาต
    return String(rows[0].value).toLowerCase() === "true";
  } catch {
    return true;
  }
}

async function saveAllowNegative(val) {
  try {
    // upsert via PATCH first; ถ้าไม่มี row → fallback POST
    const existing = await sbFetch(
      "app_settings",
      "?key=eq.inventory_allow_negative&select=key",
    );
    if (existing.length) {
      await sbPatch(
        "app_settings",
        "?key=eq.inventory_allow_negative",
        { value: String(val) },
      );
    } else {
      const { url, key } = getSB();
      await fetch(`${url}/rest/v1/app_settings`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          key: "inventory_allow_negative",
          value: String(val),
          description:
            "อนุญาตให้สต็อกติดลบหรือไม่ (toggle ในหน้า Stock สินค้า)",
        }),
      });
    }
    state.allowNegative = val;
    showToast(
      val ? "อนุญาตให้ติดลบแล้ว" : "ห้ามติดลบ — จะ enforce ตอนทำฟอร์ม SO/REQ",
      "success",
    );
    render();
  } catch (e) {
    showToast("บันทึก setting ไม่ได้: " + e.message, "error");
    $("negToggle").checked = state.allowNegative;
  }
}

// ── COMPUTE ─────────────────────────────────────────────────
// signed qty per movement type (sync กับ stock-dashboard.js)
function signedQty(m) {
  const q = +m.qty || 0;
  switch (m.movement_type) {
    case "OUT":
    case "INTERNAL":
      return -q;
    default:
      return q; // IN, INIT, RETURN, ADJUST, TRANSFER (treat as +)
  }
}

function buildIndexes() {
  const productsById = {};
  const categoriesById = {};
  const warehousesById = {};
  state.products.forEach((p) => (productsById[p.product_id] = p));
  state.categories.forEach((c) => (categoriesById[c.category_id] = c));
  state.warehouses.forEach((w) => (warehousesById[w.warehouse_id] = w));

  // SKU = leaf (มี parent) หรือ singleton (ไม่มี child)
  const parentIdsWithKids = new Set(
    state.products
      .filter((p) => p.parent_product_id)
      .map((c) => c.parent_product_id),
  );
  const isSku = (p) =>
    p.parent_product_id || !parentIdsWithKids.has(p.product_id);

  // On-hand: pid → { whId: qty }
  const onHandByPidWh = {};
  state.movements.forEach((m) => {
    if (m.product_id == null || m.warehouse_id == null) return;
    const bucket = (onHandByPidWh[m.product_id] ||= {});
    bucket[m.warehouse_id] = (bucket[m.warehouse_id] || 0) + signedQty(m);
  });

  // Reserved: pid → { whId: qty }  (รวม SO + REQ)
  const reservedByPidWh = {};
  [...state.reservedSO, ...state.reservedREQ].forEach((r) => {
    if (r.product_id == null) return;
    const bucket = (reservedByPidWh[r.product_id] ||= {});
    const wh = r.warehouse_id ?? "_unknown";
    bucket[wh] = (bucket[wh] || 0) + (+r.qty || 0);
  });

  // Lots: pid → { lotKey: { lot_no, warehouse_id, in: qty, out: qty, expiry_date } }
  // OUT/INTERNAL ที่ไม่มี lot_no → กระจายเฉลี่ย ไม่ track ระดับ lot
  const lotsByPid = {};
  state.movements.forEach((m) => {
    if (m.product_id == null) return;
    if (!m.lot_no) return; // ข้าม movement ที่ไม่มี lot
    const bucket = (lotsByPid[m.product_id] ||= {});
    const k = `${m.warehouse_id || 0}::${m.lot_no}`;
    if (!bucket[k]) {
      bucket[k] = {
        lot_no: m.lot_no,
        warehouse_id: m.warehouse_id,
        in: 0,
        out: 0,
        expiry_date: m.expiry_date || null,
      };
    }
    const sign = signedQty(m);
    if (sign >= 0) bucket[k].in += sign;
    else bucket[k].out += -sign;
    // เก็บ expiry ที่เห็นล่าสุด (ถ้า movement หลายรายการของ lot เดียวกัน)
    if (m.expiry_date && !bucket[k].expiry_date)
      bucket[k].expiry_date = m.expiry_date;
  });

  return {
    productsById,
    categoriesById,
    warehousesById,
    isSku,
    onHandByPidWh,
    reservedByPidWh,
    lotsByPid,
  };
}

function getOnHandTotal(pid, idx) {
  const bucket = idx.onHandByPidWh[pid] || {};
  return Object.values(bucket).reduce((s, v) => s + v, 0);
}

function getOnHandScoped(pid, idx) {
  const bucket = idx.onHandByPidWh[pid] || {};
  if (filter.warehouseId)
    return bucket[filter.warehouseId] || 0;
  return Object.values(bucket).reduce((s, v) => s + v, 0);
}

function getReservedScoped(pid, idx) {
  const bucket = idx.reservedByPidWh[pid] || {};
  if (filter.warehouseId)
    return bucket[filter.warehouseId] || 0;
  return Object.values(bucket).reduce((s, v) => s + v, 0);
}

function getExpiringSoonQty(pid, idx) {
  const bucket = idx.lotsByPid[pid] || {};
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() + EXPIRING_SOON_DAYS);
  let qty = 0;
  Object.values(bucket).forEach((lot) => {
    if (!lot.expiry_date) return;
    if (filter.warehouseId && String(lot.warehouse_id) !== String(filter.warehouseId))
      return;
    const exp = new Date(lot.expiry_date + "T00:00:00");
    if (exp <= cutoff) qty += Math.max(0, lot.in - lot.out);
  });
  return qty;
}

// ── RENDER ──────────────────────────────────────────────────
function render() {
  const idx = buildIndexes();
  renderKpis(idx);
  renderWarnings(idx);
  renderTable(idx);
  $("sbScopeNote").textContent = filter.warehouseId
    ? `เฉพาะคลัง: ${idx.warehousesById[filter.warehouseId]?.warehouse_name || "—"}`
    : "ทุกคลัง";
}

function renderKpis(idx) {
  const skus = state.products.filter(idx.isSku);
  const tracked = skus.filter((p) => !p.disable_stock_alert);

  let inStock = 0,
    lowStock = 0,
    outOfStock = 0,
    expiring = 0;

  tracked.forEach((p) => {
    const onHand = getOnHandScoped(p.product_id, idx);
    const reserved = getReservedScoped(p.product_id, idx);
    const available = onHand - reserved;
    if (onHand > 0) inStock++;
    if (available <= 0) outOfStock++;
    else if (available <= (p.reorder_point || 0)) lowStock++;
    if (getExpiringSoonQty(p.product_id, idx) > 0) expiring++;
  });

  $("kpiInStock").textContent = fmtNum(inStock, 0);
  $("kpiSkuTotal").textContent = `/ ${fmtNum(tracked.length, 0)} SKU`;
  $("kpiLowStock").textContent = fmtNum(lowStock, 0);
  $("kpiOutOfStock").textContent = fmtNum(outOfStock, 0);
  $("kpiExpiring").textContent = fmtNum(expiring, 0);
}

function renderWarnings(idx) {
  const box = $("sbWarnings");
  if (!box) return;
  const warnings = [];
  if (!state.allowNegative) {
    // นับ SKU ที่ available < 0 (เฉพาะที่ตั้ง toggle ห้ามติดลบ)
    const skus = state.products.filter(idx.isSku);
    let neg = 0;
    skus.forEach((p) => {
      const available =
        getOnHandScoped(p.product_id, idx) -
        getReservedScoped(p.product_id, idx);
      if (available < 0) neg++;
    });
    if (neg > 0) {
      warnings.push(
        `<span class="sd-warn-strong">${fmtNum(neg, 0)} SKU</span> มี Available ติดลบ — ห้ามตัดสต็อกเพิ่ม จนกว่าจะรับเข้าใหม่`,
      );
    }
  }
  box.innerHTML = warnings
    .map(
      (w) =>
        `<div class="sd-warn"><span class="sd-warn-icon">⚠️</span><span>${w}</span></div>`,
    )
    .join("");
}

function renderTable(idx) {
  const skus = state.products.filter(idx.isSku);
  const q = filter.search.trim().toLowerCase();

  let rows = skus.map((p) => {
    const onHand = getOnHandScoped(p.product_id, idx);
    const reserved = getReservedScoped(p.product_id, idx);
    const available = onHand - reserved;
    const expQty = getExpiringSoonQty(p.product_id, idx);
    return { p, onHand, reserved, available, expQty };
  });

  // filter
  rows = rows.filter((r) => {
    if (filter.categoryId && String(r.p.category_id) !== filter.categoryId)
      return false;
    if (q) {
      const hay = `${r.p.product_name || ""} ${r.p.product_code || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (filter.warehouseId && r.onHand === 0 && r.reserved === 0 && r.expQty === 0)
      return false;
    if (filter.status === "ok") {
      if (
        !(r.available > (r.p.reorder_point || 0)) ||
        r.p.disable_stock_alert
      )
        return false;
    } else if (filter.status === "low") {
      const ok = r.available > 0 && r.available <= (r.p.reorder_point || 0);
      if (!ok || r.p.disable_stock_alert) return false;
    } else if (filter.status === "out") {
      if (r.available > 0 || r.p.disable_stock_alert) return false;
    } else if (filter.status === "negative") {
      if (r.available >= 0) return false;
    } else if (filter.status === "expiring") {
      if (r.expQty <= 0) return false;
    }
    return true;
  });

  // sort: ติดลบมาก่อน → out → low → ok (เพื่อให้ปัญหาเด่น)
  rows.sort((a, b) => {
    const sa = statusRank(a);
    const sb = statusRank(b);
    if (sa !== sb) return sa - sb;
    return (a.p.product_name || "").localeCompare(b.p.product_name || "");
  });

  $("sbCount").textContent = `${fmtNum(rows.length, 0)} รายการ`;

  const tbody = $("sbBody");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="sd-empty">— ไม่มีรายการ —</td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map((r) => {
      const cat = idx.categoriesById[r.p.category_id];
      const reorder = r.p.reorder_point || 0;
      const status = statusBadge(r);
      const onHandCls = r.onHand < 0 ? "sd-qty-out" : "";
      const availCls =
        r.available < 0
          ? "sd-qty-out"
          : r.available === 0
            ? "sd-qty-out"
            : r.available <= reorder && !r.p.disable_stock_alert
              ? "sd-qty-low"
              : "sd-qty-ok";
      const expChip = r.expQty > 0
        ? `<span class="sb-exp-chip" title="ใกล้หมดอายุ ≤${EXPIRING_SOON_DAYS} วัน">⏳ ${fmtNum(r.expQty, 0)}</span>`
        : "";
      return `<tr>
        <td><div class="sb-thumb">📦</div></td>
        <td>
          <div class="sb-prod-name">${escapeHtml(r.p.product_name)}</div>
          <div class="sb-prod-code">${escapeHtml(r.p.product_code || "")}</div>
        </td>
        <td>
          <span class="sd-cat-badge">${cat?.icon || "📦"} ${escapeHtml(cat?.category_name || "—")}</span>
        </td>
        <td class="sd-td-right sd-td-mono"><span class="${onHandCls}">${fmtNum(r.onHand, 0)}</span></td>
        <td class="sd-td-right sd-td-mono">${r.reserved > 0 ? `<span class="sb-reserved">${fmtNum(r.reserved, 0)}</span>` : "0"}</td>
        <td class="sd-td-right sd-td-mono"><span class="sd-qty ${availCls}">${fmtNum(r.available, 0)}</span></td>
        <td class="sd-td-right sd-td-mono">${reorder > 0 ? fmtNum(reorder, 0) : `<span style="color:var(--text3)">—</span>`}</td>
        <td class="sd-td-right">${status}${expChip}</td>
        <td>
          <button class="sb-act-btn" onclick="openDetail(${r.p.product_id})" title="ดูรายละเอียด">รายละเอียด</button>
        </td>
      </tr>`;
    })
    .join("");
}

function statusRank(r) {
  if (r.available < 0) return 0;
  if (r.available <= 0) return 1;
  if (r.available <= (r.p.reorder_point || 0) && !r.p.disable_stock_alert)
    return 2;
  if (r.expQty > 0) return 3;
  return 4;
}

function statusBadge(r) {
  if (r.available < 0)
    return `<span class="sb-badge sb-badge-neg">ติดลบ</span>`;
  if (r.available <= 0)
    return `<span class="sb-badge sb-badge-out">หมด</span>`;
  if (r.available <= (r.p.reorder_point || 0) && !r.p.disable_stock_alert)
    return `<span class="sb-badge sb-badge-low">ใกล้สั่ง</span>`;
  return `<span class="sb-badge sb-badge-ok">ปกติ</span>`;
}

// ── DETAIL MODAL ────────────────────────────────────────────
let _detailPid = null;
let _detailIdx = null;

window.openDetail = function (pid) {
  _detailPid = pid;
  _detailIdx = buildIndexes();
  const p = _detailIdx.productsById[pid];
  if (!p) return;
  $("detailTitle").textContent = `📦 ${p.product_name}`;
  $("detailSubtitle").textContent =
    `${p.product_code || "—"} · จุดสั่งซื้อ ${fmtNum(p.reorder_point || 0, 0)}`;
  switchTab("warehouses");
  $("detailModal").classList.add("open");
};

window.closeDetail = function () {
  $("detailModal").classList.remove("open");
  _detailPid = null;
};

window.switchTab = function (tab) {
  ["warehouses", "movements", "lots"].forEach((t) => {
    document
      .querySelectorAll(`.sb-tab[data-tab="${t}"]`)
      .forEach((b) => b.classList.toggle("active", t === tab));
    const pane = $("pane" + t.charAt(0).toUpperCase() + t.slice(1));
    if (pane) pane.style.display = t === tab ? "" : "none";
  });
  if (tab === "warehouses") renderPaneWarehouses();
  else if (tab === "movements") renderPaneMovements();
  else if (tab === "lots") renderPaneLots();
};

function renderPaneWarehouses() {
  if (!_detailPid || !_detailIdx) return;
  const onHandByWh = _detailIdx.onHandByPidWh[_detailPid] || {};
  const reservedByWh = _detailIdx.reservedByPidWh[_detailPid] || {};
  const allWhIds = new Set([
    ...Object.keys(onHandByWh),
    ...Object.keys(reservedByWh),
  ]);
  const rows = Array.from(allWhIds)
    .map((id) => {
      const wh = _detailIdx.warehousesById[id];
      const onHand = +onHandByWh[id] || 0;
      const reserved = +reservedByWh[id] || 0;
      return { wh, onHand, reserved, available: onHand - reserved };
    })
    .filter((r) => r.wh)
    .sort((a, b) => b.onHand - a.onHand);

  const tbody = $("paneWarehousesBody");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="sd-empty">— ไม่มียอดในคลังใด —</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map((r) => {
      const onCls = r.onHand < 0 ? "sd-qty-out" : "";
      const avCls =
        r.available < 0 || r.available === 0
          ? "sd-qty-out"
          : "sd-qty-ok";
      return `<tr>
        <td>🏭 ${escapeHtml(r.wh.warehouse_name)}</td>
        <td class="sd-td-right sd-td-mono"><span class="${onCls}">${fmtNum(r.onHand, 0)}</span></td>
        <td class="sd-td-right sd-td-mono">${r.reserved > 0 ? `<span class="sb-reserved">${fmtNum(r.reserved, 0)}</span>` : "0"}</td>
        <td class="sd-td-right sd-td-mono"><span class="sd-qty ${avCls}">${fmtNum(r.available, 0)}</span></td>
      </tr>`;
    })
    .join("");
}

const TYPE_LABELS = {
  IN: { label: "รับเข้า", cls: "sd-mv-IN", sign: "+" },
  OUT: { label: "จ่ายออก", cls: "sd-mv-OUT", sign: "−" },
  INIT: { label: "ตั้งต้น", cls: "sd-mv-INIT", sign: "+" },
  ADJUST: { label: "ปรับยอด", cls: "sd-mv-ADJUST", sign: "±" },
  INTERNAL: { label: "เบิก", cls: "sd-mv-INTERNAL", sign: "−" },
  RETURN: { label: "คืน", cls: "sd-mv-RETURN", sign: "+" },
  TRANSFER: { label: "โอน", cls: "sd-mv-INIT", sign: "↔" },
};

function renderPaneMovements() {
  if (!_detailPid) return;
  const movs = state.movements
    .filter((m) => m.product_id === _detailPid)
    .slice(0, 100); // จำกัด 100 รายการล่าสุด
  const tbody = $("paneMovementsBody");
  if (!movs.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="sd-empty">— ยังไม่มี movement —</td></tr>`;
    return;
  }
  tbody.innerHTML = movs
    .map((m) => {
      const cfg = TYPE_LABELS[m.movement_type] || {
        label: m.movement_type,
        cls: "sd-mv-ADJUST",
        sign: "",
      };
      const wh = _detailIdx.warehousesById[m.warehouse_id];
      const ref = m.ref_doc_type
        ? `${m.ref_doc_type}${m.ref_doc_id ? " #" + m.ref_doc_id : ""}`
        : "—";
      return `<tr>
        <td class="sd-td-mono">${fmtDateTime(m.moved_at)}</td>
        <td><span class="sd-mv-badge ${cfg.cls}">${cfg.label}</span></td>
        <td>${wh ? "🏭 " + escapeHtml(wh.warehouse_name) : "—"}</td>
        <td class="sd-td-mono">${escapeHtml(ref)}</td>
        <td class="sd-td-right sd-td-mono">${cfg.sign}${fmtNum(Math.abs(+m.qty || 0), 0)}</td>
        <td>${escapeHtml(m.note || "")}</td>
      </tr>`;
    })
    .join("");
}

function renderPaneLots() {
  if (!_detailPid || !_detailIdx) return;
  const bucket = _detailIdx.lotsByPid[_detailPid] || {};
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rows = Object.values(bucket)
    .map((lot) => ({
      ...lot,
      remaining: Math.max(0, lot.in - lot.out),
      daysLeft: lot.expiry_date
        ? Math.floor(
            (new Date(lot.expiry_date + "T00:00:00") - today) /
              86400000,
          )
        : null,
    }))
    .filter((l) => l.remaining > 0)
    .sort((a, b) => {
      if (a.expiry_date && b.expiry_date)
        return a.expiry_date.localeCompare(b.expiry_date);
      if (a.expiry_date) return -1;
      if (b.expiry_date) return 1;
      return a.lot_no.localeCompare(b.lot_no);
    });

  const tbody = $("paneLotsBody");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="sd-empty">— ยังไม่มี lot ที่ track (ต้องบันทึก lot_no/expiry_date ใน stock_movements) —</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map((l) => {
      const wh = _detailIdx.warehousesById[l.warehouse_id];
      let dayCell = `<span style="color:var(--text3)">—</span>`;
      if (l.daysLeft != null) {
        if (l.daysLeft < 0)
          dayCell = `<span class="sd-qty-out">หมดแล้ว ${Math.abs(l.daysLeft)} วัน</span>`;
        else if (l.daysLeft <= EXPIRING_SOON_DAYS)
          dayCell = `<span class="sd-qty-low">${l.daysLeft} วัน</span>`;
        else dayCell = `<span class="sd-qty-ok">${l.daysLeft} วัน</span>`;
      }
      return `<tr>
        <td class="sd-td-mono">${escapeHtml(l.lot_no)}</td>
        <td>${wh ? "🏭 " + escapeHtml(wh.warehouse_name) : "—"}</td>
        <td class="sd-td-right sd-td-mono">${fmtNum(l.remaining, 0)}</td>
        <td class="sd-td-mono">${l.expiry_date ? fmtDate(l.expiry_date) : "—"}</td>
        <td class="sd-td-right sd-td-mono">${dayCell}</td>
      </tr>`;
    })
    .join("");
}

// ── FILTER UI ───────────────────────────────────────────────
function populateFilters() {
  const sel = $("sbCategory");
  sel.innerHTML = `<option value="">ทุกหมวดหมู่</option>` +
    state.categories
      .map(
        (c) =>
          `<option value="${c.category_id}">${c.icon || "📦"} ${escapeHtml(c.category_name)}</option>`,
      )
      .join("");

  const wsel = $("sbWarehouse");
  wsel.innerHTML = `<option value="">ทุกคลัง</option>` +
    state.warehouses
      .map(
        (w) =>
          `<option value="${w.warehouse_id}">🏭 ${escapeHtml(w.warehouse_name)}</option>`,
      )
      .join("");
}

function bindEvents() {
  $("sbSearch").addEventListener("input", (e) => {
    filter.search = e.target.value;
    render();
  });
  $("sbCategory").addEventListener("change", (e) => {
    filter.categoryId = e.target.value;
    render();
  });
  $("sbWarehouse").addEventListener("change", (e) => {
    filter.warehouseId = e.target.value;
    render();
  });
  $("sbStatus").addEventListener("change", (e) => {
    filter.status = e.target.value;
    render();
  });
  $("negToggle").addEventListener("change", (e) => {
    saveAllowNegative(e.target.checked);
  });
  $("detailModal").addEventListener("click", (e) => {
    if (e.target.id === "detailModal") closeDetail();
  });
}

// ── UTILS ───────────────────────────────────────────────────
function $(id) {
  return document.getElementById(id);
}

function fmtNum(n, decimals = 2) {
  return parseFloat(n || 0).toLocaleString("th-TH", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtDate(s) {
  if (!s) return "";
  const d = new Date(s.length <= 10 ? s + "T00:00:00" : s);
  return d.toLocaleDateString("en-GB", { timeZone: "Asia/Bangkok" });
}

function fmtDateTime(s) {
  if (!s) return "";
  const d = new Date(s);
  const date = d.toLocaleDateString("en-GB", { timeZone: "Asia/Bangkok" });
  const time = d.toLocaleTimeString("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok",
  });
  return `${date} ${time}`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[<>&"']/g, (c) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

function showToast(msg, type = "success") {
  const t = $("toast");
  if (!t) return;
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove("show"), 3000);
}

function showLoading(show) {
  $("loadingOverlay")?.classList.toggle("show", show);
}

// ── START ───────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
