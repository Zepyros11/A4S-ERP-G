/* ============================================================
   stock-dashboard.js — Stock Dashboard Controller
   ============================================================ */

// ── STATE ──────────────────────────────────────────────────
const state = {
  products: [],
  categories: [],
  warehouses: [],
  stockBalance: [],
  movements: [],
};

// ── SUPABASE ───────────────────────────────────────────────
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

// ── INIT ───────────────────────────────────────────────────
async function init() {
  const { url, key } = getSB();
  if (!url || !key) {
    showToast("ยังไม่ได้เชื่อมต่อ Supabase", "error");
    return;
  }
  await loadAll();
}

async function loadAll() {
  showLoading(true);
  try {
    const [prods, cats, whs, sb, mvs] = await Promise.all([
      sbFetch(
        "products",
        "?select=product_id,product_code,product_name,category_id,cost_price,sale_price,reorder_point,parent_product_id,is_active",
      ),
      sbFetch("categories", "?select=*"),
      sbFetch(
        "warehouses",
        "?select=warehouse_id,warehouse_name,country,is_active",
      ),
      sbFetch(
        "stock_balance",
        "?select=product_id,warehouse_id,qty_on_hand",
      ),
      sbFetch(
        "stock_movements",
        "?select=*&order=moved_at.desc&limit=10",
      ).catch(() => []),
    ]);

    state.products = prods || [];
    state.categories = cats || [];
    state.warehouses = whs || [];
    state.stockBalance = sb || [];
    state.movements = mvs || [];

    render();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

window.refreshDashboard = () => loadAll();

// ── COMPUTE ────────────────────────────────────────────────
function buildIndexes() {
  const productsById = {};
  const categoriesById = {};
  const warehousesById = {};
  state.products.forEach((p) => (productsById[p.product_id] = p));
  state.categories.forEach((c) => (categoriesById[c.category_id] = c));
  state.warehouses.forEach((w) => (warehousesById[w.warehouse_id] = w));

  // SKU = variant child + singleton (ไม่นับ umbrella parent)
  const parentIdsWithKids = new Set(
    state.products
      .filter((p) => p.parent_product_id)
      .map((c) => c.parent_product_id),
  );
  const isSku = (p) =>
    p.parent_product_id || !parentIdsWithKids.has(p.product_id);

  // Total qty per product (across warehouses)
  const totalQtyByProduct = {};
  state.stockBalance.forEach((s) => {
    totalQtyByProduct[s.product_id] =
      (totalQtyByProduct[s.product_id] || 0) + (s.qty_on_hand || 0);
  });

  return {
    productsById,
    categoriesById,
    warehousesById,
    isSku,
    totalQtyByProduct,
  };
}

// ── RENDER ─────────────────────────────────────────────────
function render() {
  const idx = buildIndexes();

  renderKpis(idx);
  renderByWarehouse(idx);
  renderByCategory(idx);
  renderLowStock(idx);
  renderOutOfStock(idx);
  renderTopValue(idx);
  renderRecentMovements(idx);
}

function renderKpis(idx) {
  const skus = state.products.filter(idx.isSku);
  let totalValue = 0;
  let totalQty = 0;
  state.stockBalance.forEach((s) => {
    const p = idx.productsById[s.product_id];
    if (!p) return;
    totalValue += (s.qty_on_hand || 0) * (p.cost_price || 0);
    totalQty += s.qty_on_hand || 0;
  });

  const inStock = skus.filter(
    (p) => (idx.totalQtyByProduct[p.product_id] || 0) > 0,
  ).length;
  const lowStock = skus.filter((p) => {
    const q = idx.totalQtyByProduct[p.product_id] || 0;
    return q > 0 && q <= (p.reorder_point || 0);
  }).length;
  const outOfStock = skus.filter(
    (p) => !(idx.totalQtyByProduct[p.product_id] > 0),
  ).length;

  $("kpiTotalValue").textContent = "฿" + fmtNum(totalValue, 0);
  $("kpiTotalQty").textContent = fmtNum(totalQty, 0) + " ชิ้น";
  $("kpiInStock").textContent = fmtNum(inStock, 0);
  $("kpiSkuTotal").textContent = `/ ${fmtNum(skus.length, 0)} SKU`;
  $("kpiLowStock").textContent = fmtNum(lowStock, 0);
  $("kpiOutOfStock").textContent = fmtNum(outOfStock, 0);
}

function renderByWarehouse(idx) {
  const valueByWh = {};
  state.stockBalance.forEach((s) => {
    const p = idx.productsById[s.product_id];
    if (!p) return;
    const v = (s.qty_on_hand || 0) * (p.cost_price || 0);
    valueByWh[s.warehouse_id] = (valueByWh[s.warehouse_id] || 0) + v;
  });

  const rows = Object.entries(valueByWh)
    .map(([whId, value]) => ({
      whId: parseInt(whId),
      value,
      wh: idx.warehousesById[parseInt(whId)],
    }))
    .filter((r) => r.wh)
    .sort((a, b) => b.value - a.value);

  $("warehouseCount").textContent = `${rows.length} คลัง`;
  const max = rows[0]?.value || 1;
  const totalSum = rows.reduce((s, r) => s + r.value, 0) || 1;

  const list = $("warehouseList");
  if (rows.length === 0) {
    list.innerHTML = `<div class="sd-empty">— ไม่มีข้อมูล —</div>`;
    return;
  }
  list.innerHTML = rows
    .map((r) => {
      const pct = (r.value / totalSum) * 100;
      const widthPct = (r.value / max) * 100;
      return `<div class="sd-bar-row">
        <div class="sd-bar-row-top">
          <div class="sd-bar-row-name">🏭 ${escapeHtml(r.wh.warehouse_name)}</div>
          <div>
            <span class="sd-bar-row-val">฿${fmtNum(r.value, 0)}</span>
            <span class="sd-bar-row-pct">${pct.toFixed(1)}%</span>
          </div>
        </div>
        <div class="sd-bar-track"><div class="sd-bar-fill" style="width:${widthPct}%"></div></div>
      </div>`;
    })
    .join("");
}

function renderByCategory(idx) {
  const valueByCat = {};
  state.stockBalance.forEach((s) => {
    const p = idx.productsById[s.product_id];
    if (!p) return;
    const v = (s.qty_on_hand || 0) * (p.cost_price || 0);
    valueByCat[p.category_id || 0] =
      (valueByCat[p.category_id || 0] || 0) + v;
  });

  const rows = Object.entries(valueByCat)
    .map(([catId, value]) => ({
      catId: parseInt(catId),
      value,
      cat: idx.categoriesById[parseInt(catId)],
    }))
    .filter((r) => r.cat)
    .sort((a, b) => b.value - a.value);

  $("categoryCount").textContent = `${rows.length} หมวด`;
  const max = rows[0]?.value || 1;
  const totalSum = rows.reduce((s, r) => s + r.value, 0) || 1;

  const list = $("categoryList");
  if (rows.length === 0) {
    list.innerHTML = `<div class="sd-empty">— ไม่มีข้อมูล —</div>`;
    return;
  }
  list.innerHTML = rows
    .map((r) => {
      const pct = (r.value / totalSum) * 100;
      const widthPct = (r.value / max) * 100;
      const icon = r.cat.icon || "📦";
      return `<div class="sd-bar-row">
        <div class="sd-bar-row-top">
          <div class="sd-bar-row-name">${icon} ${escapeHtml(r.cat.category_name)}</div>
          <div>
            <span class="sd-bar-row-val">฿${fmtNum(r.value, 0)}</span>
            <span class="sd-bar-row-pct">${pct.toFixed(1)}%</span>
          </div>
        </div>
        <div class="sd-bar-track"><div class="sd-bar-fill" style="width:${widthPct}%"></div></div>
      </div>`;
    })
    .join("");
}

function renderLowStock(idx) {
  const skus = state.products.filter(idx.isSku);
  const rows = skus
    .map((p) => ({
      p,
      qty: idx.totalQtyByProduct[p.product_id] || 0,
      reorder: p.reorder_point || 0,
    }))
    .filter((r) => r.qty > 0 && r.qty <= r.reorder)
    .sort((a, b) => a.qty / a.reorder - b.qty / b.reorder);

  $("lowCount").textContent = `${rows.length} รายการ`;

  const tbody = $("lowStockBody");
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="sd-empty">— ไม่มีรายการ —</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .slice(0, 20)
    .map(
      (r) => `<tr>
      <td>${escapeHtml(r.p.product_name)}</td>
      <td class="sd-td-right"><span class="sd-qty sd-qty-low">${fmtNum(r.qty, 0)}</span></td>
      <td class="sd-td-right sd-td-mono">${fmtNum(r.reorder, 0)}</td>
    </tr>`,
    )
    .join("");
}

function renderOutOfStock(idx) {
  const skus = state.products.filter(idx.isSku);
  const rows = skus.filter(
    (p) => !(idx.totalQtyByProduct[p.product_id] > 0),
  );

  $("outCount").textContent = `${rows.length} รายการ`;

  const tbody = $("outStockBody");
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="2" class="sd-empty">— ไม่มีรายการ —</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .slice(0, 20)
    .map((p) => {
      const cat = idx.categoriesById[p.category_id];
      return `<tr>
        <td>${escapeHtml(p.product_name)}</td>
        <td class="sd-td-right">
          <span class="sd-cat-badge">${cat?.icon || "📦"} ${escapeHtml(cat?.category_name || "—")}</span>
        </td>
      </tr>`;
    })
    .join("");
}

function renderTopValue(idx) {
  const skus = state.products.filter(idx.isSku);
  const rows = skus
    .map((p) => {
      const qty = idx.totalQtyByProduct[p.product_id] || 0;
      const value = qty * (p.cost_price || 0);
      return { p, qty, value };
    })
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 10);

  const tbody = $("topValueBody");
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="sd-empty">— ไม่มีรายการ —</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map((r, i) => {
      const cat = idx.categoriesById[r.p.category_id];
      return `<tr>
        <td class="sd-td-mono">${i + 1}</td>
        <td>${escapeHtml(r.p.product_name)}</td>
        <td class="sd-td-right">
          <span class="sd-cat-badge">${cat?.icon || "📦"} ${escapeHtml(cat?.category_name || "—")}</span>
        </td>
        <td class="sd-td-right sd-td-mono">${fmtNum(r.qty, 0)}</td>
        <td class="sd-td-right sd-td-mono" style="color:var(--accent);font-weight:700">฿${fmtNum(r.value, 0)}</td>
      </tr>`;
    })
    .join("");
}

function renderRecentMovements(idx) {
  const tbody = $("recentMovesBody");
  if (state.movements.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="sd-empty">— ยังไม่มีการเคลื่อนไหว —</td></tr>`;
    return;
  }
  tbody.innerHTML = state.movements
    .map((m) => {
      const p = idx.productsById[m.product_id];
      const w = idx.warehousesById[m.warehouse_id];
      const type = m.movement_type || m.type || "—";
      const sign = type === "IN" || type === "RETURN" ? "+" : "-";
      const cls = `sd-mv-${type}`;
      return `<tr>
        <td class="sd-td-mono" style="font-size:11.5px">${fmtDateTime(m.moved_at)}</td>
        <td><span class="sd-mv-badge ${cls}">${type}</span></td>
        <td>${p ? escapeHtml(p.product_name) : "—"}</td>
        <td>${w ? escapeHtml(w.warehouse_name) : "—"}</td>
        <td class="sd-td-right sd-td-mono">${sign}${fmtNum(m.qty || 0, 0)}</td>
      </tr>`;
    })
    .join("");
}

// ── UTILS ──────────────────────────────────────────────────
function $(id) {
  return document.getElementById(id);
}

function fmtNum(n, decimals = 2) {
  return parseFloat(n || 0).toLocaleString("th-TH", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Bangkok",
    });
  } catch {
    return iso;
  }
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

// ── START ──────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
