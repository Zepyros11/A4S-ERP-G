/* ============================================================
   po-list.js - Purchase Order List
============================================================ */

function getSB() {
  return {
    url: localStorage.getItem("sb_url") || "",
    key: localStorage.getItem("sb_key") || "",
  };
}

async function sbFetch(table, query = "", opts = {}) {
  const { url, key } = getSB();
  const { method = "GET", body } = opts;

  if (!url || !key) {
    throw new Error("ยังไม่ได้ตั้งค่า Supabase");
  }

  const res = await fetch(`${url}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer:
        method === "POST" || method === "PATCH"
          ? "return=representation"
          : "",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "โหลดข้อมูลไม่สำเร็จ");
  }

  return method === "DELETE" ? null : res.json().catch(() => null);
}

async function fetchPurchaseOrders() {
  return (
    sbFetch(
      "purchase_orders",
      "?select=po_id,po_number,supplier_id,warehouse_id,created_by,status,order_date,expected_date,total_amount,note,created_at&order=po_id.desc"
    ) || []
  );
}

async function fetchSuppliers() {
  return (
    sbFetch(
      "suppliers",
      "?select=supplier_id,supplier_name&is_active=eq.true&order=supplier_name"
    ) || []
  );
}

async function fetchWarehouses() {
  return (
    sbFetch(
      "warehouses",
      "?select=warehouse_id,warehouse_name&is_active=eq.true&order=warehouse_name"
    ) || []
  );
}

async function fetchUsers() {
  return (
    sbFetch(
      "users",
      "?select=user_id,first_name,last_name&is_active=eq.true&order=first_name"
    ) || []
  );
}

async function fetchPoItems() {
  return sbFetch("po_items", "?select=po_id,qty_ordered") || [];
}

const state = {
  orders: [],
  suppliers: [],
  warehouses: [],
  users: [],
  poItems: [],
  selected: null,
};

const STATUS_META = {
  DRAFT: { label: "Draft", cls: "status-draft" },
  APPROVED: { label: "Approved", cls: "status-approved" },
  ORDERED: { label: "Ordered", cls: "status-ordered" },
  RECEIVED: { label: "Received", cls: "status-received" },
  CANCELLED: { label: "Cancelled", cls: "status-cancelled" },
};

function getStatusMeta(status) {
  return (
    STATUS_META[String(status || "").toUpperCase()] || {
      label: status || "Unknown",
      cls: "status-default",
    }
  );
}

function getSupplierName(supplierId) {
  return (
    state.suppliers.find((s) => String(s.supplier_id) === String(supplierId))
      ?.supplier_name || "—"
  );
}

function getWarehouseName(warehouseId) {
  return (
    state.warehouses.find((w) => String(w.warehouse_id) === String(warehouseId))
      ?.warehouse_name || "—"
  );
}

function getUserName(userId) {
  const user = state.users.find((u) => String(u.user_id) === String(userId));
  if (!user) return "—";
  const first = user.first_name || "";
  const last = user.last_name || "";
  return `${first} ${last}`.trim() || "—";
}

function getPoItemSummary(poId) {
  const rows = state.poItems.filter((item) => String(item.po_id) === String(poId));
  const lineCount = rows.length;
  const qtyTotal = rows.reduce(
    (sum, row) => sum + (parseFloat(row.qty_ordered) || 0),
    0
  );

  return { lineCount, qtyTotal };
}

function formatCurrency(value) {
  return (
    "฿" +
    parseFloat(value || 0).toLocaleString("th-TH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function bindEvents() {
  document.getElementById("searchInput")?.addEventListener("input", filterTable);
  document.getElementById("filterStatus")?.addEventListener("change", filterTable);
  document.getElementById("filterSupplier")?.addEventListener("change", filterTable);
  document
    .getElementById("filterWarehouse")
    ?.addEventListener("change", filterTable);
}

function populateFilters() {
  const supplierSel = document.getElementById("filterSupplier");
  const warehouseSel = document.getElementById("filterWarehouse");

  if (supplierSel) {
    supplierSel.innerHTML =
      `<option value="">ทุก Supplier</option>` +
      state.suppliers
        .map(
          (supplier) =>
            `<option value="${supplier.supplier_id}">${escapeHtml(
              supplier.supplier_name
            )}</option>`
        )
        .join("");
  }

  if (warehouseSel) {
    warehouseSel.innerHTML =
      `<option value="">ทุกคลัง</option>` +
      state.warehouses
        .map(
          (warehouse) =>
            `<option value="${warehouse.warehouse_id}">${escapeHtml(
              warehouse.warehouse_name
            )}</option>`
        )
        .join("");
  }
}

function updateCards() {
  const total = state.orders.length;
  const draft = state.orders.filter(
    (order) => String(order.status || "").toUpperCase() === "DRAFT"
  ).length;
  const active = state.orders.filter((order) => {
    const status = String(order.status || "").toUpperCase();
    return status !== "RECEIVED" && status !== "CANCELLED";
  }).length;
  const amount = state.orders.reduce(
    (sum, order) => sum + (parseFloat(order.total_amount) || 0),
    0
  );

  document.getElementById("cardTotal").textContent = total;
  document.getElementById("cardDraft").textContent = draft;
  document.getElementById("cardActive").textContent = active;
  document.getElementById("cardAmount").textContent = formatCurrency(amount);
}

function filterTable() {
  const q = (document.getElementById("searchInput")?.value || "").trim().toLowerCase();
  const status = document.getElementById("filterStatus")?.value || "";
  const supplierId = document.getElementById("filterSupplier")?.value || "";
  const warehouseId = document.getElementById("filterWarehouse")?.value || "";

  const rows = state.orders.filter((order) => {
    const supplierName = getSupplierName(order.supplier_id).toLowerCase();
    const warehouseName = getWarehouseName(order.warehouse_id).toLowerCase();
    const poNumber = String(order.po_number || "").toLowerCase();
    const note = String(order.note || "").toLowerCase();
    const matchesQuery =
      !q ||
      poNumber.includes(q) ||
      supplierName.includes(q) ||
      warehouseName.includes(q) ||
      note.includes(q);

    const matchesStatus =
      !status || String(order.status || "").toUpperCase() === status;
    const matchesSupplier =
      !supplierId || String(order.supplier_id) === String(supplierId);
    const matchesWarehouse =
      !warehouseId || String(order.warehouse_id) === String(warehouseId);

    return matchesQuery && matchesStatus && matchesSupplier && matchesWarehouse;
  });

  renderTable(rows);
}

function renderTable(rows) {
  const tbody = document.getElementById("poTableBody");
  const countEl = document.getElementById("poCount");
  if (!tbody) return;

  if (countEl) countEl.textContent = `${rows.length} รายการ`;

  if (!rows.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9">
          <div class="empty-state">
            <div class="empty-icon">🧾</div>
            <div class="empty-text">ไม่พบรายการใบสั่งซื้อ</div>
          </div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map((order) => {
      const status = getStatusMeta(String(order.status || "").toUpperCase());
      const supplierName = escapeHtml(getSupplierName(order.supplier_id));
      const warehouseName = escapeHtml(getWarehouseName(order.warehouse_id));
      const itemSummary = getPoItemSummary(order.po_id);

      return `
        <tr data-po-id="${order.po_id}">
          <td>
            <div class="po-number">
              <div class="po-number-main">${escapeHtml(order.po_number || "—")}</div>
              <div class="po-number-sub">อัปเดต ${escapeHtml(formatDate(order.created_at || order.order_date))}</div>
            </div>
          </td>
          <td>
            <div class="po-supplier">
              <div class="po-supplier-name">${supplierName}</div>
              <div class="po-supplier-meta">ผู้สร้าง: ${escapeHtml(
                getUserName(order.created_by)
              )}</div>
            </div>
          </td>
          <td class="col-center"><span class="po-chip">${warehouseName}</span></td>
          <td class="col-center">${escapeHtml(formatDate(order.order_date))}</td>
          <td class="col-center">${escapeHtml(formatDate(order.expected_date))}</td>
          <td class="col-center">
            <div class="po-items-meta">
              <span class="po-items-count">${itemSummary.lineCount}</span>
              <span class="po-items-qty">${itemSummary.qtyTotal.toLocaleString("th-TH")} ชิ้น</span>
            </div>
          </td>
          <td class="col-center"><span class="po-amount">${formatCurrency(
            order.total_amount
          )}</span></td>
          <td class="col-center">
            <span class="po-status-badge ${status.cls}">${escapeHtml(
              status.label
            )}</span>
          </td>
          <td class="col-center" onclick="event.stopPropagation()">
            <button class="po-row-action" title="ดูรายละเอียด" onclick="window.openPoPanelById(${
              order.po_id
            })">↗</button>
          </td>
        </tr>`;
    })
    .join("");

  tbody.querySelectorAll("tr[data-po-id]").forEach((row) => {
    row.addEventListener("click", () => {
      window.openPoPanelById(row.dataset.poId);
    });
  });
}

function renderNoConfigState() {
  state.orders = [];
  updateCards();
  document.getElementById("poTableBody").innerHTML = `
    <tr>
      <td colspan="9">
        <div class="empty-state">
          <div class="empty-icon">🔌</div>
          <div class="empty-text">ยังไม่ได้ตั้งค่า Supabase สำหรับโหลดรายการใบสั่งซื้อ</div>
        </div>
      </td>
    </tr>`;
  document.getElementById("poCount").textContent = "0 รายการ";
}

function openPoPanel(order) {
  state.selected = order;
  const panel = document.getElementById("poPanel");
  const backdrop = document.getElementById("poPanelBackdrop");
  const body = document.getElementById("poPanelBody");
  if (!panel || !backdrop || !body) return;

  const supplierName = escapeHtml(getSupplierName(order.supplier_id));
  const warehouseName = escapeHtml(getWarehouseName(order.warehouse_id));
  const creatorName = escapeHtml(getUserName(order.created_by));
  const status = getStatusMeta(String(order.status || "").toUpperCase());
  const itemSummary = getPoItemSummary(order.po_id);

  body.innerHTML = `
    <div class="po-panel-hero">
      <div class="po-status-badge ${status.cls}">${escapeHtml(status.label)}</div>
      <div class="po-panel-no">${escapeHtml(order.po_number || "—")}</div>
      <div class="po-panel-amount">${formatCurrency(order.total_amount)}</div>
    </div>

    <div class="po-panel-grid">
      <div class="po-detail-card">
        <div class="po-detail-label">Supplier</div>
        <div class="po-detail-value">${supplierName}</div>
      </div>
      <div class="po-detail-card">
        <div class="po-detail-label">คลัง</div>
        <div class="po-detail-value">${warehouseName}</div>
      </div>
      <div class="po-detail-card">
        <div class="po-detail-label">วันที่สั่งซื้อ</div>
        <div class="po-detail-value">${escapeHtml(formatDate(order.order_date))}</div>
      </div>
      <div class="po-detail-card">
        <div class="po-detail-label">กำหนดรับ</div>
        <div class="po-detail-value">${escapeHtml(formatDate(order.expected_date))}</div>
      </div>
      <div class="po-detail-card">
        <div class="po-detail-label">ผู้สร้างเอกสาร</div>
        <div class="po-detail-value">${creatorName}</div>
      </div>
      <div class="po-detail-card">
        <div class="po-detail-label">จำนวนรายการ</div>
        <div class="po-detail-value">${itemSummary.lineCount} รายการ / ${itemSummary.qtyTotal.toLocaleString(
          "th-TH"
        )} ชิ้น</div>
      </div>
    </div>

    <div class="po-note-box">
      <div class="po-detail-label">หมายเหตุ</div>
      <div class="po-note-text">${escapeHtml(order.note || "—")}</div>
    </div>`;

  panel.classList.add("open");
  backdrop.classList.add("open");
}

function closePoPanel() {
  document.getElementById("poPanel")?.classList.remove("open");
  document.getElementById("poPanelBackdrop")?.classList.remove("open");
}

async function loadData() {
  const { url, key } = getSB();
  if (!url || !key) {
    renderNoConfigState();
    showToast("ยังไม่ได้ตั้งค่า Supabase", "warning");
    return;
  }

  showLoading(true);
  try {
    const [orders, suppliers, warehouses, users, poItems] = await Promise.all([
      fetchPurchaseOrders(),
      fetchSuppliers(),
      fetchWarehouses(),
      fetchUsers(),
      fetchPoItems(),
    ]);

    state.orders = orders || [];
    state.suppliers = suppliers || [];
    state.warehouses = warehouses || [];
    state.users = users || [];
    state.poItems = poItems || [];

    populateFilters();
    updateCards();
    filterTable();
  } catch (error) {
    renderNoConfigState();
    showToast(error.message || "โหลดข้อมูลไม่สำเร็จ", "error");
  }
  showLoading(false);
}

function showToast(message, type = "success") {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.className = `toast toast-${type} show`;
  toast.textContent = message;
  setTimeout(() => toast.classList.remove("show"), 2600);
}

function showLoading(show) {
  document.getElementById("loadingOverlay")?.classList.toggle("show", show);
}

window.openPoPanelById = function openPoPanelById(poId) {
  const order = state.orders.find((item) => String(item.po_id) === String(poId));
  if (order) openPoPanel(order);
};

window.closePoPanel = closePoPanel;

window.copySelectedPoNumber = async function copySelectedPoNumber() {
  if (!state.selected?.po_number) {
    showToast("ยังไม่ได้เลือกรายการ", "warning");
    return;
  }

  try {
    await navigator.clipboard.writeText(state.selected.po_number);
    showToast(`คัดลอก ${state.selected.po_number} แล้ว`, "success");
  } catch (_) {
    showToast("คัดลอกเลขที่ PO ไม่สำเร็จ", "error");
  }
};

window.goToPOForm = function goToPOForm() {
  window.location.href = "./po_form.html";
};

window.refreshPOList = function refreshPOList() {
  loadData();
};

window.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  await loadData();
});
