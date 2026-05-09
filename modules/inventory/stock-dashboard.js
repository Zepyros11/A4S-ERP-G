/* ============================================================
   stock-dashboard.js — Stock Dashboard Controller
   ============================================================ */

// ── STATE ──────────────────────────────────────────────────
// เก็บ movements ทั้งหมด แล้วคำนวณ stock เอง (signed sum)
// — ไม่ใช้ stock_balance view เพราะอาจ out-of-sync — ตรงนี้ตรงกับ catalog.js
const state = {
  products: [],
  categories: [],
  warehouses: [],
  allMovements: [], // ALL movements (used for stock calc)
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
    // ดึง movements ทั้งหมดมาคำนวณ stock เอง — เลี่ยงปัญหา view out-of-sync
    const [prods, cats, whs, allMvs] = await Promise.all([
      sbFetch(
        "products",
        "?select=product_id,product_code,product_name,category_id,cost_price,sale_price,reorder_point,parent_product_id,disable_stock_alert&is_active=eq.true",
      ),
      sbFetch("categories", "?select=*"),
      sbFetch(
        "warehouses",
        "?select=warehouse_id,warehouse_name,country&is_active=eq.true",
      ),
      sbFetch(
        "stock_movements",
        "?select=product_id,warehouse_id,movement_type,qty",
      ).catch(() => []),
    ]);

    state.products = prods || [];
    state.categories = cats || [];
    state.warehouses = whs || [];
    state.allMovements = allMvs || [];

    render();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

window.refreshDashboard = () => loadAll();

// ── COMPUTE ────────────────────────────────────────────────
// signed qty per movement type — sync กับ catalog.js
// INIT/IN/RETURN/ADJUST = +qty · OUT/INTERNAL = -qty
// (catalog.js ตั้ง INTERNAL=0 เพราะตีความว่าเป็น transfer · แต่ movements.js ตั้ง '-'
//  → เลือกตาม movements.js ให้ผู้ใช้เห็นการเบิกออกเป็นการลดสต็อก)
function signedQty(m) {
  const q = +m.qty || 0;
  switch (m.movement_type) {
    case "OUT":
    case "INTERNAL":
      return -q;
    default:
      return q; // IN, INIT, RETURN, ADJUST
  }
}

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

  // คำนวณ qty จาก stock_movements ตรงๆ (signed sum)
  const totalQtyByProduct = {};
  const qtyByProductWh = {}; // pid → { whId: qty }
  state.allMovements.forEach((m) => {
    if (m.product_id == null) return;
    const signed = signedQty(m);
    totalQtyByProduct[m.product_id] =
      (totalQtyByProduct[m.product_id] || 0) + signed;
    if (m.warehouse_id != null) {
      const bucket = (qtyByProductWh[m.product_id] ||= {});
      bucket[m.warehouse_id] = (bucket[m.warehouse_id] || 0) + signed;
    }
  });

  return {
    productsById,
    categoriesById,
    warehousesById,
    isSku,
    totalQtyByProduct,
    qtyByProductWh,
  };
}

// ── RENDER ─────────────────────────────────────────────────
function render() {
  const idx = buildIndexes();

  renderKpis(idx);
  renderDataWarnings(idx);
  renderByWarehouse(idx);
  renderByCategory(idx);
  renderLowStock(idx);
  renderOutOfStock(idx);
  renderTopValue(idx);
}

function renderKpis(idx) {
  const skus = state.products.filter(idx.isSku);
  // KPI ทั้งหมดเคารพ flag disable_stock_alert (ตัวที่ปิดแจ้งเตือน
  // = สินค้าใช้ภายใน/consumable — ไม่ควรเข้านับใน in/low/out เพราะจะบิดสัดส่วน)
  const trackedSkus = skus.filter((p) => !p.disable_stock_alert);

  let totalValue = 0;
  let totalQty = 0;
  Object.entries(idx.totalQtyByProduct).forEach(([pid, qty]) => {
    if (qty <= 0) return;
    const p = idx.productsById[pid];
    if (!p) return;
    totalValue += qty * (p.cost_price || 0);
    totalQty += qty;
  });

  const inStock = trackedSkus.filter(
    (p) => (idx.totalQtyByProduct[p.product_id] || 0) > 0,
  ).length;
  const lowStock = trackedSkus.filter((p) => {
    const q = idx.totalQtyByProduct[p.product_id] || 0;
    return q > 0 && q <= (p.reorder_point || 0);
  }).length;
  const outOfStock = trackedSkus.filter(
    (p) => !(idx.totalQtyByProduct[p.product_id] > 0),
  ).length;

  $("kpiTotalValue").textContent = "฿" + fmtNum(totalValue, 0);
  $("kpiTotalQty").textContent = fmtNum(totalQty, 0) + " ชิ้น";
  $("kpiInStock").textContent = fmtNum(inStock, 0);
  $("kpiSkuTotal").textContent = `/ ${fmtNum(trackedSkus.length, 0)} SKU`;
  $("kpiLowStock").textContent = fmtNum(lowStock, 0);
  $("kpiOutOfStock").textContent = fmtNum(outOfStock, 0);
}

function renderDataWarnings(idx) {
  const box = $("sdWarnings");
  if (!box) return;
  const skus = state.products.filter(idx.isSku);
  // SKU ที่มีของในสต็อก แต่ยังไม่ตั้ง cost_price → มูลค่าจะหายไปเงียบๆ
  const missingCost = skus.filter((p) => {
    const qty = idx.totalQtyByProduct[p.product_id] || 0;
    return qty > 0 && !(p.cost_price > 0);
  }).length;

  const warnings = [];
  if (missingCost > 0) {
    warnings.push(
      `<span class="sd-warn-strong">${fmtNum(missingCost, 0)} SKU</span> มีสต็อกแต่ยังไม่ตั้งราคาทุน — มูลค่าสต็อกจะคำนวณเป็น ฿0`,
    );
  }
  box.innerHTML = warnings
    .map(
      (w) =>
        `<div class="sd-warn"><span class="sd-warn-icon">⚠️</span><span>${w}</span></div>`,
    )
    .join("");
}

function renderByWarehouse(idx) {
  const valueByWh = {};
  Object.entries(idx.qtyByProductWh).forEach(([pid, byWh]) => {
    const p = idx.productsById[pid];
    if (!p) return;
    const cost = p.cost_price || 0;
    Object.entries(byWh).forEach(([whId, qty]) => {
      if (qty <= 0) return;
      valueByWh[whId] = (valueByWh[whId] || 0) + qty * cost;
    });
  });

  const rows = Object.entries(valueByWh)
    .map(([whId, value]) => ({
      whId: parseInt(whId),
      value,
      wh: idx.warehousesById[parseInt(whId)],
    }))
    .filter((r) => r.wh && r.value > 0)
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
  // นับ SKU + รวมมูลค่าต่อหมวด — แสดงทุกหมวดที่มี SKU (รวมหมวดที่ยังไม่มีมูลค่า)
  const skus = state.products.filter(idx.isSku);
  const statByCat = {};
  skus.forEach((p) => {
    const cid = p.category_id || 0;
    if (!statByCat[cid]) statByCat[cid] = { value: 0, count: 0 };
    statByCat[cid].count++;
    const qty = idx.totalQtyByProduct[p.product_id] || 0;
    if (qty > 0) statByCat[cid].value += qty * (p.cost_price || 0);
  });

  const rows = Object.entries(statByCat)
    .map(([catId, stat]) => ({
      catId: parseInt(catId),
      value: stat.value,
      count: stat.count,
      cat: idx.categoriesById[parseInt(catId)],
    }))
    .filter((r) => r.cat)
    .sort((a, b) => b.value - a.value || b.count - a.count);

  $("categoryCount").textContent = `${rows.length} หมวด`;
  const max = rows[0]?.value || 1;
  const totalSum = rows.reduce((s, r) => s + r.value, 0);

  const list = $("categoryList");
  if (rows.length === 0) {
    list.innerHTML = `<div class="sd-empty">— ไม่มีข้อมูล —</div>`;
    return;
  }
  list.innerHTML = rows
    .map((r) => {
      const pct = totalSum > 0 ? (r.value / totalSum) * 100 : 0;
      const widthPct = max > 0 ? (r.value / max) * 100 : 0;
      const icon = r.cat.icon || "📦";
      return `<div class="sd-bar-row">
        <div class="sd-bar-row-top">
          <div class="sd-bar-row-name">${icon} ${escapeHtml(r.cat.category_name)} <span class="sd-bar-row-count">${r.count} SKU</span></div>
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
    .filter((p) => !p.disable_stock_alert)
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
    (p) =>
      !p.disable_stock_alert && !(idx.totalQtyByProduct[p.product_id] > 0),
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

// ── REPORT MODAL ───────────────────────────────────────────
// แต่ละ KPI กดแล้วเปิด popup รายงานละเอียด (ค้นหาได้)
const REPORT_CONFIG = {
  totalValue: {
    title: "💰 รายงานมูลค่าสต็อกรวม",
    subtitle: "SKU ทั้งหมดที่มีสต็อก > 0 · เรียงตามมูลค่า",
    columns: ["#", "สินค้า", "หมวดหมู่", "คงเหลือ", "ราคาทุน", "มูลค่า"],
    rowAlign: ["left", "left", "left", "right", "right", "right"],
  },
  inStock: {
    title: "📦 รายงาน SKU ในสต็อก",
    subtitle: "SKU ที่มีของในคลัง · เรียงตามจำนวน",
    columns: ["#", "สินค้า", "หมวดหมู่", "คงเหลือ", "จุดสั่งซื้อ"],
    rowAlign: ["left", "left", "left", "right", "right"],
  },
  lowStock: {
    title: "🔻 รายงานสินค้าใกล้สั่งซื้อ",
    subtitle: "คงเหลือ ≤ จุดสั่งซื้อ · เรียงตามความเร่งด่วน",
    columns: ["#", "สินค้า", "หมวดหมู่", "คงเหลือ", "จุดสั่งซื้อ", "% ที่เหลือ"],
    rowAlign: ["left", "left", "left", "right", "right", "right"],
  },
  outOfStock: {
    title: "❌ รายงานสินค้าหมดสต็อก",
    subtitle: "SKU ที่ไม่มีของในคลังเลย · ต้องเติมสต็อก",
    columns: ["#", "สินค้า", "หมวดหมู่", "จุดสั่งซื้อ"],
    rowAlign: ["left", "left", "left", "right"],
  },
};

let _reportRows = []; // cache rows ปัจจุบันสำหรับการค้นหา
let _reportType = null;

function buildReportRows(type, idx) {
  const skus = state.products.filter(idx.isSku);
  const tracked = skus.filter((p) => !p.disable_stock_alert);
  const catName = (p) =>
    idx.categoriesById[p.category_id]?.category_name || "—";
  const catIcon = (p) => idx.categoriesById[p.category_id]?.icon || "📦";

  if (type === "totalValue") {
    return skus
      .map((p) => {
        const qty = idx.totalQtyByProduct[p.product_id] || 0;
        const cost = p.cost_price || 0;
        return { p, qty, cost, value: qty * cost };
      })
      .filter((r) => r.qty > 0)
      .sort((a, b) => b.value - a.value)
      .map((r) => ({
        keys: [r.p.product_name, catName(r.p)],
        cells: [
          "",
          escapeHtml(r.p.product_name),
          `<span class="sd-cat-badge">${catIcon(r.p)} ${escapeHtml(catName(r.p))}</span>`,
          fmtNum(r.qty, 0),
          r.cost > 0 ? `฿${fmtNum(r.cost, 0)}` : `<span style="color:#dc2626">—</span>`,
          `<span style="color:var(--accent);font-weight:700">฿${fmtNum(r.value, 0)}</span>`,
        ],
      }));
  }

  if (type === "inStock") {
    return tracked
      .map((p) => ({ p, qty: idx.totalQtyByProduct[p.product_id] || 0 }))
      .filter((r) => r.qty > 0)
      .sort((a, b) => b.qty - a.qty)
      .map((r) => ({
        keys: [r.p.product_name, catName(r.p)],
        cells: [
          "",
          escapeHtml(r.p.product_name),
          `<span class="sd-cat-badge">${catIcon(r.p)} ${escapeHtml(catName(r.p))}</span>`,
          `<span class="sd-qty sd-qty-ok">${fmtNum(r.qty, 0)}</span>`,
          fmtNum(r.p.reorder_point || 0, 0),
        ],
      }));
  }

  if (type === "lowStock") {
    return tracked
      .map((p) => ({
        p,
        qty: idx.totalQtyByProduct[p.product_id] || 0,
        reorder: p.reorder_point || 0,
      }))
      .filter((r) => r.qty > 0 && r.qty <= r.reorder)
      .sort((a, b) => a.qty / a.reorder - b.qty / b.reorder)
      .map((r) => ({
        keys: [r.p.product_name, catName(r.p)],
        cells: [
          "",
          escapeHtml(r.p.product_name),
          `<span class="sd-cat-badge">${catIcon(r.p)} ${escapeHtml(catName(r.p))}</span>`,
          `<span class="sd-qty sd-qty-low">${fmtNum(r.qty, 0)}</span>`,
          fmtNum(r.reorder, 0),
          `${((r.qty / r.reorder) * 100).toFixed(0)}%`,
        ],
      }));
  }

  if (type === "outOfStock") {
    return tracked
      .filter((p) => !(idx.totalQtyByProduct[p.product_id] > 0))
      .sort((a, b) => (a.product_name || "").localeCompare(b.product_name || ""))
      .map((p) => ({
        keys: [p.product_name, catName(p)],
        cells: [
          "",
          escapeHtml(p.product_name),
          `<span class="sd-cat-badge">${catIcon(p)} ${escapeHtml(catName(p))}</span>`,
          fmtNum(p.reorder_point || 0, 0),
        ],
      }));
  }

  return [];
}

function renderReportTable(rows, columns, rowAlign) {
  const thead = $("reportThead");
  const tbody = $("reportTbody");
  thead.innerHTML = `<tr>${columns
    .map(
      (c, i) =>
        `<th${rowAlign[i] === "right" ? ' class="sd-th-right"' : ""}${
          i === 0 ? ' style="width:50px"' : ""
        }>${escapeHtml(c)}</th>`,
    )
    .join("")}</tr>`;

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${columns.length}" class="sd-empty">— ไม่มีรายการ —</td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map((r, i) => {
      const cells = [...r.cells];
      cells[0] = `<span class="sd-td-mono" style="color:var(--text3)">${i + 1}</span>`;
      return `<tr>${cells
        .map(
          (c, j) =>
            `<td${rowAlign[j] === "right" ? ' class="sd-td-right sd-td-mono"' : ""}>${c}</td>`,
        )
        .join("")}</tr>`;
    })
    .join("");
}

function applyReportSearch() {
  const cfg = REPORT_CONFIG[_reportType];
  if (!cfg) return;
  const q = ($("reportSearch").value || "").toLowerCase().trim();
  const filtered = q
    ? _reportRows.filter((r) =>
        r.keys.some((k) => (k || "").toLowerCase().includes(q)),
      )
    : _reportRows;
  $("reportCount").textContent = `${fmtNum(filtered.length, 0)} รายการ`;
  renderReportTable(filtered, cfg.columns, cfg.rowAlign);
}

window.openReport = function (type) {
  const cfg = REPORT_CONFIG[type];
  if (!cfg) return;
  _reportType = type;
  const idx = buildIndexes();
  _reportRows = buildReportRows(type, idx);

  $("reportTitle").textContent = cfg.title;
  $("reportSubtitle").textContent = cfg.subtitle;
  const search = $("reportSearch");
  search.value = "";
  applyReportSearch();
  $("reportModal").classList.add("open");
  setTimeout(() => search.focus(), 50);
};

window.closeReport = function () {
  $("reportModal").classList.remove("open");
};

function bindReportEvents() {
  $("reportSearch")?.addEventListener("input", applyReportSearch);
  $("reportModal")?.addEventListener("click", (e) => {
    if (e.target.id === "reportModal") window.closeReport();
  });
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bindReportEvents);
} else {
  bindReportEvents();
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
