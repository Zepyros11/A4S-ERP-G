// ============================================================
// STATE
// ============================================================
const SB_URL = localStorage.getItem("sb_url") || "";
const SB_KEY = localStorage.getItem("sb_key") || "";

let products = [];
let warehouses = [];
let stockBalance = [];
let categories = [];
let recentLogs = [];

let selectedProduct = null;
let selectedWarehouse = null;
let adjType = "IN";

// ============================================================
// SUPABASE
// ============================================================
async function sbFetch(table, q = "", opts = {}) {
  const { method = "GET", body } = opts;
  const res = await fetch(`${SB_URL}/rest/v1/${table}${q}`, {
    method,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer:
        method === "POST"
          ? "return=representation"
          : method === "PATCH"
            ? "return=representation"
            : "",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json()).message || "Error");
  return method !== "DELETE" ? res.json().catch(() => null) : null;
}

// ============================================================
// LOAD DATA
// ============================================================
async function loadData() {
  if (!SB_URL || !SB_KEY) {
    renderTable([]);
    return;
  }

  showLoading(true);

  try {
    const [prods, whs, sb, cats, logs, imgs] = await Promise.all([
      sbFetch("products", "?select=*&is_active=eq.true&order=product_name"),
      sbFetch("warehouses", "?select=*&is_active=eq.true"),
      sbFetch("stock_balance", "?select=*"),
      sbFetch("categories", "?select=*"),
      sbFetch("stock_movements", "?select=*&order=moved_at.desc&limit=10"),
      sbFetch("product_images", "?select=*"),
    ]);

    products = (prods || []).map((p) => {
      const img = (imgs || []).find(
        (i) => i.product_id === p.product_id && i.sort_order === 0,
      );

      return {
        ...p,
        image_url: img?.url || "",
      };
    });

    warehouses = whs || [];
    stockBalance = sb || [];
    categories = cats || [];
    recentLogs = logs || [];

    filterTable();
    renderLogs();
  } catch (e) {
    showToast("โหลดไม่ได้: " + e.message, "error");
  }

  showLoading(false);
}

// ============================================================
// PRODUCT TABLE
// ============================================================
function getTotalStock(prodId) {
  return stockBalance
    .filter((b) => b.product_id === prodId)
    .reduce((s, b) => s + (b.qty_on_hand || 0), 0);
}

function getWarehouseStock(prodId, warehouseId) {
  const sb = stockBalance.find(
    (b) => b.product_id === prodId && b.warehouse_id === warehouseId,
  );

  return sb?.qty_on_hand || 0;
}
function filterTable() {
  const search = document.getElementById("searchInput").value.toLowerCase();
  const list = products.filter(
    (p) =>
      !search ||
      `${p.product_code} ${p.product_name}`.toLowerCase().includes(search),
  );
  renderTable(list);
}

function renderTable(list) {
  const tbody = document.getElementById("prodTableBody");

  if (!list.length) {
    tbody.innerHTML = `
<tr>
<td colspan="7" style="padding:40px;text-align:center;color:var(--text3)">
ไม่พบสินค้า
</td>
</tr>`;
    return;
  }

  tbody.innerHTML = list
    .map((p) => {
      const total = getTotalStock(p.product_id);

      const st =
        total === 0 ? "out" : total <= (p.reorder_point || 0) ? "low" : "ok";

      const qtyClass =
        st === "out" ? "qty-zero" : st === "low" ? "qty-low" : "qty-ok";

      const badgeCls =
        st === "ok" ? "badge-ok" : st === "low" ? "badge-low" : "badge-out";

      const badgeLbl =
        st === "ok" ? "ปกติ" : st === "low" ? "ใกล้หมด" : "หมดแล้ว";

      const img = p.image_url || "";

      const whStock = warehouses
        .map((w) => {
          const qty = getWarehouseStock(p.product_id, w.warehouse_id);

          if (qty <= 0) return "";

          return `
<span style="
display:inline-block;
padding:2px 6px;
background:var(--accent-pale);
border-radius:4px;
margin-right:4px;
font-size:11px;
">
${w.warehouse_code}:${qty}
</span>`;
        })
        .join("");

      return `
<tr onclick="selectProduct(${p.product_id})">

<td>
  <div class="prod-img-wrap">
    <img
      src="${img}"
      class="prod-img"
      onerror="this.parentElement.innerHTML='<span class=prod-img-placeholder>📦</span>'"
    >
  </div>
</td>

<td class="code-cell">
  ${p.product_code || "-"}
</td>

<td>
  ${p.product_name}
</td>

<td style="font-size:12px;color:var(--text2)">
  ${whStock || "-"}
</td>

<td class="right">
  <span class="mono ${qtyClass}">
    ${total.toLocaleString()}
  </span>
</td>

<td>
  <span class="badge ${badgeCls}">
    ${badgeLbl}
  </span>
</td>

<td>
  <button
    class="row-menu-btn"
    onclick="openRowMenu(event, ${p.product_id})"
  >
    ⋮
  </button>
</td>

</tr>
`;
    })
    .join("");
}
function selectProduct(id) {
  selectedProduct = products.find((p) => p.product_id === Number(id));

  selectedWarehouse = null;
  adjType = "IN";

  renderAdjPanel();
}

// ============================================================
// ADJUSTMENT PANEL
// ============================================================
function renderAdjPanel() {
  if (!selectedProduct) {
    document.getElementById("adjForm").style.display = "none";
    return;
  }

  document.getElementById("adjForm").style.display = "block";

  // Header
  const cat = categories.find(
    (c) => c.category_id === selectedProduct.category_id,
  );

  document.getElementById("adjCode").textContent =
    selectedProduct.product_code || "—";

  document.getElementById("adjName").textContent = selectedProduct.product_name;

  document.getElementById("adjCat").textContent = cat
    ? `🏷️ ${cat.category_name}`
    : "ไม่มีหมวดหมู่";

  // Type button states
  document.querySelectorAll(".adj-type-btn").forEach((b) => {
    b.className =
      "adj-type-btn" + (b.dataset.type === adjType ? ` sel-${adjType}` : "");
  });

  // Qty label
  const labels = {
    IN: "จำนวนที่เพิ่ม",
    OUT: "จำนวนที่ลด",
    ADJUST: "ตั้งยอด Stock เป็น",
  };

  document.getElementById("qtyLabel").textContent = labels[adjType];

  // Warehouse dropdown
  const whSelect = document.getElementById("whSelect");

  whSelect.innerHTML =
    '<option value="">— เลือกคลัง —</option>' +
    warehouses
      .map((w) => {
        const sb = stockBalance.find(
          (b) =>
            b.product_id === selectedProduct.product_id &&
            b.warehouse_id === w.warehouse_id,
        );

        const qty = getWarehouseStock(
          selectedProduct.product_id,
          w.warehouse_id,
        );

        const sel =
          selectedWarehouse?.warehouse_id === w.warehouse_id ? "selected" : "";

        return `<option value="${w.warehouse_id}" ${sel}>
          ${w.warehouse_name} (คงเหลือ: ${qty})
        </option>`;
      })
      .join("");

  // Reset inputs
  document.getElementById("adjQty").value = "";
  document.getElementById("adjNote").value = "";
  document.getElementById("qtyPreview").style.display = "none";
}

function selectWarehouse(id) {
  selectedWarehouse = warehouses.find((w) => w.warehouse_id == id);

  if (!selectedWarehouse) return;

  const cur = getWarehouseStock(
    selectedProduct.product_id,
    selectedWarehouse.warehouse_id,
  );

  document.getElementById("currentStock").textContent = cur.toLocaleString();

  updatePreview();
}

function updatePreview() {
  if (!selectedWarehouse) return;

  const qty = parseFloat(document.getElementById("adjQty").value) || 0;

  const preview = document.getElementById("qtyPreview");

  const cur = getWarehouseStock(
    selectedProduct.product_id,
    selectedWarehouse.warehouse_id,
  );

  let after;

  if (adjType === "IN") {
    after = cur + qty;
  }

  if (adjType === "OUT") {
    after = cur - qty;
  }

  if (adjType === "ADJUST") {
    after = qty;
  }

  preview.style.display = "block";
  preview.textContent = `${cur} → ${after}`;

  if (after < 0) {
    preview.className = "qty-preview err";
  } else if (after <= 5) {
    preview.className = "qty-preview warn";
  } else {
    preview.className = "qty-preview ok";
  }
}
// ============================================================
// SAVE ADJUSTMENT
// ============================================================
async function saveAdjustment() {
  if (!selectedProduct) {
    showToast("กรุณาเลือกสินค้า", "error");
    return;
  }
  if (!selectedWarehouse) {
    showToast("กรุณาเลือกคลัง", "error");
    return;
  }

  const qty = parseFloat(document.getElementById("adjQty").value);
  if (!qty || qty <= 0) {
    showToast("กรุณาใส่จำนวนที่ถูกต้อง", "error");
    return;
  }
  if (!SB_URL || !SB_KEY) {
    showToast("กรุณาเชื่อมต่อ Supabase ก่อน", "warning");
    return;
  }

  const sb = stockBalance.find(
    (b) =>
      b.product_id === selectedProduct.product_id &&
      b.warehouse_id === selectedWarehouse.warehouse_id,
  );
  const cur = sb?.qty_on_hand || 0;
  const isIn = adjType === "IN";
  const isAdj = adjType === "ADJUST";
  const qtyAfter = isAdj ? qty : isIn ? cur + qty : cur - qty;
  const note = document.getElementById("adjNote").value.trim();

  if (!isAdj && !isIn && qtyAfter < 0) {
    showToast(`Stock ไม่พอ (มี ${cur} ชิ้น)`, "error");
    return;
  }

  showLoading(true);
  try {
    // 1. Insert stock_movements record
    await sbFetch("stock_movements", "", {
      method: "POST",
      body: {
        product_id: selectedProduct.product_id,
        warehouse_id: selectedWarehouse.warehouse_id,
        movement_type: adjType,
        qty: isIn || isAdj ? qty : -qty,
        note: note || `Manual ${adjType}`,
        moved_at: new Date().toISOString(),
      },
    });

    // 2. Upsert stock_balance
    if (sb) {
      await sbFetch(
        "stock_balance",
        `?product_id=eq.${selectedProduct.product_id}&warehouse_id=eq.${selectedWarehouse.warehouse_id}`,
        { method: "PATCH", body: { qty_on_hand: qtyAfter } },
      );
      sb.qty_on_hand = qtyAfter;
    } else {
      await sbFetch("stock_balance", "", {
        method: "POST",
        body: {
          product_id: selectedProduct.product_id,
          warehouse_id: selectedWarehouse.warehouse_id,
          qty_on_hand: qtyAfter,
          qty_reserved: 0,
        },
      });
      stockBalance.push({
        product_id: selectedProduct.product_id,
        warehouse_id: selectedWarehouse.warehouse_id,
        qty_on_hand: qtyAfter,
        qty_reserved: 0,
      });
    }

    const typeLabel = { IN: "เพิ่ม", OUT: "ลด", ADJUST: "ตั้งค่า" }[adjType];
    showToast(
      `✅ ${typeLabel} Stock ${selectedProduct.product_name} → ${qtyAfter} ชิ้น`,
      "success",
    );

    // Reload logs & re-render
    const logs = await sbFetch(
      "stock_movements",
      "?select=*&order=moved_at.desc&limit=10",
    );
    recentLogs = logs || [];
    renderLogs();
    renderAdjPanel();
    filterTable();
  } catch (e) {
    showToast("บันทึกไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

// ============================================================
// RECENT LOGS
// ============================================================
function renderLogs() {
  const card = document.getElementById("logCard");
  const list = document.getElementById("logList");
  if (!recentLogs.length) {
    card.style.display = "none";
    return;
  }
  card.style.display = "block";

  const TC = {
    IN: { icon: "📥", cls: "qty-in-clr", bg: "#d1fae5", sign: "+" },
    OUT: { icon: "📤", cls: "qty-out-clr", bg: "#fee2e2", sign: "-" },
    ADJUST: { icon: "⚖️", cls: "qty-adj-clr", bg: "#fef3c7", sign: "±" },
    INTERNAL: { icon: "📋", cls: "qty-out-clr", bg: "#ede9fe", sign: "-" },
    RETURN: { icon: "↩️", cls: "qty-in-clr", bg: "#d1fae5", sign: "+" },
  };

  list.innerHTML = recentLogs
    .map((m) => {
      const p = products.find((x) => x.product_id === m.product_id);
      const w = warehouses.find((x) => x.warehouse_id === m.warehouse_id);
      const cfg = TC[m.movement_type] || {
        icon: "❓",
        cls: "",
        bg: "#f3f4f6",
        sign: "",
      };
      const dt = new Date(m.moved_at);
      const dateStr = dt.toLocaleDateString("th-TH", {
        day: "numeric",
        month: "short",
      });
      const timeStr = dt.toLocaleTimeString("th-TH", {
        hour: "2-digit",
        minute: "2-digit",
      });
      return `<div class="log-item">
      <div class="log-type" style="background:${cfg.bg}">${cfg.icon}</div>
      <div class="log-info">
        <div class="log-prod">${p?.product_name || "#" + m.product_id}</div>
        <div class="log-meta">${w?.warehouse_name || "—"} · ${dateStr} ${timeStr}</div>
      </div>
      <div class="log-qty ${cfg.cls}">${cfg.sign}${Math.abs(m.qty || 0)}</div>
    </div>`;
    })
    .join("");
}

// ============================================================
// UTILS
// ============================================================
function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove("show"), 3000);
}
function showLoading(show) {
  document.getElementById("loadingOverlay").classList.toggle("show", show);
}

// ============================================================
// INIT
// ============================================================
window.addEventListener("DOMContentLoaded", async () => {
  if (SB_URL && SB_KEY) {
    await loadData();

    autoSelectFromURL();
  }
});

function autoSelectFromURL() {
  const params = new URLSearchParams(window.location.search);

  const productId = params.get("product");
  const warehouseId = params.get("warehouse");

  if (productId) {
    selectProduct(Number(productId));
  }

  if (warehouseId) {
    selectWarehouse(Number(warehouseId));
  }
}

let menuProduct = null;

function openRowMenu(e, productId) {
  e.stopPropagation();

  menuProduct = products.find((p) => p.product_id === productId);

  const menu = document.getElementById("rowMenu");

  menu.style.display = "block";
  menu.style.left = e.pageX + "px";
  menu.style.top = e.pageY + "px";
}

function openAdjustment(type) {
  if (!menuProduct) return;

  selectedProduct = menuProduct;
  adjType = type;

  document.getElementById("rowMenu").style.display = "none";

  selectedWarehouse = warehouses[0];

  const qty = prompt("ใส่จำนวน");

  if (!qty || qty <= 0) return;

  document.getElementById("adjQty").value = qty;

  saveAdjustment();
}
// ปิด menu เมื่อคลิกที่อื่น
document.addEventListener("click", () => {
  const menu = document.getElementById("rowMenu");
  if (menu) menu.style.display = "none";
});
function setAdjType(type) {
  adjType = type;

  document.querySelectorAll(".adj-btn").forEach((btn) => {
    btn.classList.remove("active");
  });

  event.target.classList.add("active");

  if (type === "ADD") {
    document.getElementById("qtyLabel").textContent = "จำนวนที่เพิ่ม";
  }

  if (type === "SUB") {
    document.getElementById("qtyLabel").textContent = "จำนวนที่ลด";
  }

  if (type === "SET") {
    document.getElementById("qtyLabel").textContent = "จำนวนใหม่";
  }
}
function selectAdjType(type) {
  adjType = type;

  document.querySelectorAll(".adj-type-btn").forEach((btn) => {
    btn.classList.remove("sel-IN", "sel-OUT", "sel-ADJUST");
  });

  const btn = document.querySelector(`[data-type="${type}"]`);

  if (btn) {
    btn.classList.add(`sel-${type}`);
  }

  const labels = {
    IN: "จำนวนที่เพิ่ม",
    OUT: "จำนวนที่ลด",
    ADJUST: "ตั้งค่า Stock เป็น",
  };

  document.getElementById("qtyLabel").textContent = labels[type];

  updatePreview();
}
