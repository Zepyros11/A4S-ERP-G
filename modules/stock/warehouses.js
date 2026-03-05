/* ============================================================
   warehouses.js — Logic สำหรับหน้าจัดการคลังสินค้า
   ============================================================ */

let SUPABASE_URL = localStorage.getItem("sb_url") || "";
let SUPABASE_KEY = localStorage.getItem("sb_key") || "";
let allWarehouses = [],
  allStockBalance = [],
  allProducts = [];
let selectedId = null;

const TYPE_CFG = {
  MAIN: { label: "🏭 หลัก", color: "#0f4c75", bg: "var(--accent-pale)" },
  BRANCH: { label: "🏪 สาขา", color: "#0e7490", bg: "var(--teal-pale)" },
  TRANSIT: {
    label: "🚚 พักสินค้า",
    color: "#92400e",
    bg: "var(--warning-pale)",
  },
  RETURN: { label: "↩ คืนสินค้า", color: "#057a55", bg: "var(--success-pale)" },
};

async function sbFetch(table, opts = {}) {
  const { method = "GET", query = "", body } = opts;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: method === "POST" ? "return=representation" : "",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json()).message || "Error");
  return method !== "DELETE" ? res.json().catch(() => null) : null;
}

async function loadData() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  showLoading(true);
  try {
    const [whs, stock, prods] = await Promise.all([
      sbFetch("warehouses", { query: "?select=*&order=warehouse_code" }),
      sbFetch("stock_balance", { query: "?select=*" }),
      sbFetch("products", {
        query: "?select=product_id,product_code,product_name",
      }),
    ]);
    allWarehouses = whs || [];
    allStockBalance = stock || [];
    allProducts = prods || [];
    renderCards();
    updateStats();
  } catch (e) {
    showToast("โหลดไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

function updateStats() {
  const totalStock = allStockBalance.reduce(
    (s, b) => s + (b.qty_on_hand || 0),
    0,
  );
  document.getElementById("statTotal").textContent = allWarehouses.length;
  document.getElementById("statActive").textContent = allWarehouses.filter(
    (w) => w.is_active !== false,
  ).length;
  document.getElementById("statTotalStock").textContent =
    totalStock.toLocaleString();
  document.getElementById("statBranch").textContent = allWarehouses.filter(
    (w) => w.warehouse_type === "BRANCH",
  ).length;
}

function renderCards() {
  const search = document.getElementById("searchInput").value.toLowerCase();
  const type = document.getElementById("filterType").value;
  const status = document.getElementById("filterStatus").value;

  const list = allWarehouses.filter((w) => {
    const q =
      `${w.warehouse_name || ""} ${w.warehouse_code || ""}`.toLowerCase();
    return (
      (!search || q.includes(search)) &&
      (!type || w.warehouse_type === type) &&
      (status === "" || String(w.is_active !== false) === status)
    );
  });

  const grid = document.getElementById("whGrid");
  if (list.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1"><div class="empty-state"><div class="empty-icon">🔍</div><div>ไม่พบคลังสินค้า</div></div></div>`;
    return;
  }

  grid.innerHTML = list
    .map((w) => {
      const cfg = TYPE_CFG[w.warehouse_type] || {
        label: w.warehouse_type,
        color: "#6b7280",
        bg: "var(--surface2)",
      };
      const isActive = w.is_active !== false;
      const whStock = allStockBalance.filter(
        (b) => b.warehouse_id === w.warehouse_id,
      );
      const totalQty = whStock.reduce((s, b) => s + (b.qty_on_hand || 0), 0);
      const reserved = whStock.reduce((s, b) => s + (b.qty_reserved || 0), 0);
      const skuCount = whStock.filter((b) => (b.qty_on_hand || 0) > 0).length;
      const capacityPct =
        w.capacity && totalQty
          ? Math.min(100, Math.round((totalQty / w.capacity) * 100))
          : null;

      return `<div class="wh-card ${w.warehouse_id === selectedId ? "selected" : ""}" onclick="selectWarehouse(${w.warehouse_id})">
      <div class="wh-card-top">
        <div class="wh-icon" style="background:${cfg.bg};color:${cfg.color}">${cfg.label.split(" ")[0]}</div>
        <div style="flex:1;min-width:0">
          <div class="wh-code">${w.warehouse_code || "—"}</div>
          <div class="wh-name">${w.warehouse_name}</div>
          <div class="wh-type" style="color:${cfg.color};font-weight:600;font-size:11px">${cfg.label}</div>
          ${w.manager_name ? `<div class="wh-type">👤 ${w.manager_name}</div>` : ""}
        </div>
        <span class="status-badge ${isActive ? "status-active" : "status-inactive"}">${isActive ? "● ใช้งาน" : "● ปิด"}</span>
      </div>
      <div class="wh-card-stats">
        <div class="wh-stat"><div class="wh-stat-val">${totalQty.toLocaleString()}</div><div class="wh-stat-lbl">QTY ON HAND</div></div>
        <div class="wh-stat"><div class="wh-stat-val" style="color:var(--warning)">${reserved.toLocaleString()}</div><div class="wh-stat-lbl">RESERVED</div></div>
        <div class="wh-stat"><div class="wh-stat-val" style="color:var(--accent)">${skuCount}</div><div class="wh-stat-lbl">SKU</div></div>
      </div>
      ${
        capacityPct !== null
          ? `<div style="padding:0 20px 12px">
        <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text3);margin-bottom:4px"><span>ความจุ</span><span>${capacityPct}% (${totalQty.toLocaleString()}/${w.capacity.toLocaleString()})</span></div>
        <div style="height:6px;background:var(--border);border-radius:3px;overflow:hidden"><div style="height:100%;width:${capacityPct}%;background:${capacityPct > 80 ? "#ef4444" : capacityPct > 50 ? "#f59e0b" : "#10b981"};border-radius:3px;transition:width .6s ease"></div></div>
      </div>`
          : ""
      }
      <div class="wh-card-footer">
        <button class="btn-sm btn-sm-edit" onclick="event.stopPropagation();editWarehouse(${w.warehouse_id})">✏️ แก้ไข</button>
        <button class="btn-sm btn-sm-del" onclick="event.stopPropagation();deleteWarehouse(${w.warehouse_id},'${w.warehouse_name}')">🗑</button>
      </div>
    </div>`;
    })
    .join("");
}

function selectWarehouse(id) {
  selectedId = id;
  renderCards();
  showStockDetail(id);
}

function showStockDetail(whId) {
  const wh = allWarehouses.find((w) => w.warehouse_id === whId);
  const whStock = allStockBalance.filter((b) => b.warehouse_id === whId);
  document.getElementById("stockPanelTitle").textContent =
    `📦 Stock ใน ${wh?.warehouse_name || "คลัง"}`;
  document.getElementById("stockPanel").classList.add("open");
  const tbody = document.getElementById("stockTableBody");
  if (whStock.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text3)">ไม่มี Stock ในคลังนี้</td></tr>`;
    return;
  }
  tbody.innerHTML = whStock
    .map((b) => {
      const prod = allProducts.find((p) => p.product_id === b.product_id);
      const avail = (b.qty_on_hand || 0) - (b.qty_reserved || 0);
      const qtyClass =
        b.qty_on_hand === 0
          ? "qty-zero"
          : b.qty_on_hand < 10
            ? "qty-low"
            : "qty-ok";
      return `<tr>
      <td><span style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--text3)">${prod?.product_code || "—"}</span></td>
      <td><span style="font-weight:500">${prod?.product_name || "สินค้า #" + b.product_id}</span></td>
      <td><span class="stock-qty ${qtyClass}">${(b.qty_on_hand || 0).toLocaleString()}</span></td>
      <td><span class="stock-qty" style="color:#d97706">${(b.qty_reserved || 0).toLocaleString()}</span></td>
      <td><span class="stock-qty" style="color:var(--accent)">${Math.max(0, avail).toLocaleString()}</span></td>
    </tr>`;
    })
    .join("");
  document
    .getElementById("stockPanel")
    .scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function closeStockPanel() {
  document.getElementById("stockPanel").classList.remove("open");
  selectedId = null;
  renderCards();
}

function openModal(data = null) {
  document.getElementById("modalTitle").textContent = data
    ? "แก้ไขคลังสินค้า"
    : "เพิ่มคลังสินค้าใหม่";
  document.getElementById("editId").value = data?.warehouse_id || "";
  const codeEl = document.getElementById("fCode");
  codeEl.value = data?.warehouse_code || generateCode();
  codeEl.readOnly = true;
  codeEl.style.cssText =
    'background:var(--surface2);color:var(--text3);cursor:not-allowed;font-family:"IBM Plex Mono",monospace;font-weight:600;letter-spacing:1px;';
  document.getElementById("fName").value = data?.warehouse_name || "";
  document.getElementById("fType").value = data?.warehouse_type || "MAIN";
  document.getElementById("fAddress").value = data?.address || "";
  document.getElementById("fManager").value = data?.manager_name || "";
  document.getElementById("fPhone").value = data?.phone || "";
  document.getElementById("fCapacity").value = data?.capacity || "";
  document.getElementById("fNote").value = data?.note || "";
  document.getElementById("fStatus").value = data
    ? String(data.is_active !== false)
    : "true";
  document.getElementById("modalOverlay").classList.add("open");
  setTimeout(() => document.getElementById("fCode").focus(), 100);
}

function editWarehouse(id) {
  openModal(allWarehouses.find((w) => w.warehouse_id === id));
}
function closeModal() {
  document.getElementById("modalOverlay").classList.remove("open");
}
function closeModalBg(e) {
  if (e.target === document.getElementById("modalOverlay")) closeModal();
}

async function saveWarehouse() {
  const name = document.getElementById("fName").value.trim();
  if (!name) {
    showToast("กรุณากรอกชื่อคลัง", "error");
    return;
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    showToast("กรุณาเชื่อมต่อ Supabase ก่อน", "warning");
    return;
  }
  const payload = {
    warehouse_code: document.getElementById("fCode").value.trim() || null,
    warehouse_name: name,
    warehouse_type: document.getElementById("fType").value, // ← เพิ่มบรรทัดนี้
    location: document.getElementById("fAddress").value.trim() || null,
    is_active: document.getElementById("fStatus").value === "true",
  };
  showLoading(true);
  try {
    const editId = document.getElementById("editId").value;
    if (editId) {
      await sbFetch("warehouses", {
        method: "PATCH",
        query: `?warehouse_id=eq.${editId}`,
        body: payload,
      });
      showToast("✅ แก้ไขคลังสำเร็จ!", "success");
    } else {
      await sbFetch("warehouses", { method: "POST", body: payload });
      showToast("✅ เพิ่มคลังสำเร็จ!", "success");
    }
    closeModal();
    await loadData();
  } catch (e) {
    showToast("เกิดข้อผิดพลาด: " + e.message, "error");
  }
  showLoading(false);
}

async function deleteWarehouse(id, name) {
  if (!confirm(`ลบคลัง "${name}" ออกจากระบบ?\n(Stock ในคลังนี้จะถูกลบด้วย)`))
    return;
  showLoading(true);
  try {
    await sbFetch("warehouses", {
      method: "DELETE",
      query: `?warehouse_id=eq.${id}`,
    });
    showToast("ลบคลังแล้ว", "success");
    if (selectedId === id) closeStockPanel();
    await loadData();
  } catch (e) {
    showToast("ลบไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove("show"), 3000);
}
function showLoading(show) {
  document.getElementById("loadingOverlay").classList.toggle("show", show);
}

window.addEventListener("DOMContentLoaded", () => {
  if (SUPABASE_URL && SUPABASE_KEY) setTimeout(() => loadData(), 50);
});
function generateCode() {
  if (allWarehouses.length === 0) return "WH-001";
  const nums = allWarehouses.map(
    (w) => parseInt((w.warehouse_code || "").replace("WH-", "")) || 0,
  );
  const next = Math.max(...nums) + 1;
  return "WH-" + String(next).padStart(3, "0");
}
