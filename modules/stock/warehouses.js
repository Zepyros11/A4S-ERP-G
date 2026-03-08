let SUPABASE_URL = localStorage.getItem("sb_url") || "";
let SUPABASE_KEY = localStorage.getItem("sb_key") || "";

let warehouses = [];
let stock = [];

const TYPE = {
  MAIN: { label: "คลังหลัก", color: "type-main" },
  BRANCH: { label: "คลังสาขา", color: "type-branch" },
  TRANSIT: { label: "จุดพักสินค้า", color: "type-transit" },
  RETURN: { label: "จุดคืนสินค้า", color: "type-return" },
};
async function sbFetch(table, opts = {}) {
  const { method = "GET", query = "", body } = opts;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method,

    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(t);
  }

  if (method === "DELETE") return null;

  const text = await res.text();

  return text ? JSON.parse(text) : null;
}

async function loadData() {
  showLoading(true);

  try {
    warehouses = await sbFetch("warehouses", {
      query: "?select=*&order=warehouse_code.asc",
    });

    try {
      stock = await sbFetch("stock_available", { query: "?select=*" });
    } catch {}

    renderTable();
    renderStats();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้", "error");
  }

  showLoading(false);
}

function renderTable() {
  const search = document.getElementById("searchInput").value.toLowerCase();

  const type = document.getElementById("filterType").value;

  const status = document.getElementById("filterStatus").value;

  const list = warehouses.filter((w) => {
    const q = (w.warehouse_name + " " + w.warehouse_code).toLowerCase();

    if (search && !q.includes(search)) return false;

    if (type && w.warehouse_type !== type) return false;

    if (status !== "") {
      if (String(w.is_active) !== status) return false;
    }

    return true;
  });

  const tbody = document.getElementById("whTable");

  document.getElementById("whCount").textContent = list.length + " รายการ";

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8">ไม่พบข้อมูล</td></tr>`;
    return;
  }

  tbody.innerHTML = list
    .map((w) => {
      const whStock = stock.filter((s) => s.warehouse_id === w.warehouse_id);
      const qty = whStock.reduce((sum, s) => sum + (s.qty_on_hand || 0), 0);
      let remainLabel = "";

      if (!w.is_active && qty > 0) {
        remainLabel = `<span class="stock-warning">มีสินค้าตกค้าง</span>`;
      }

      return `
<tr onclick="openWarehouseStock(${w.warehouse_id},'${w.warehouse_name}','${w.warehouse_icon}')">

<td class="col-center">${w.warehouse_code}</td>

<td>
${w.warehouse_icon || "🏭"}
<strong>${w.warehouse_name}</strong>
</td>

<td class="col-center">
<span class="type-badge ${TYPE[w.warehouse_type]?.color || ""}">
${TYPE[w.warehouse_type]?.label || ""}
</span>
</td>

<td class="col-center">

<span class="manager-cell">

<span class="manager-icon">👤</span>
${w.manager_name || "-"}

<span class="manager-tooltip">
<span class="phone-icon">📞</span>
${w.phone || "-"}
</span>

</span>

</td>

<td class="col-center">
${qty}
</td>

<td class="col-center">

<div class="status-box">

<label class="switch"
onclick="event.stopPropagation()"
title="${w.is_active ? "เปิดใช้งาน" : "ปิดใช้งาน"}">

<input type="checkbox"
${w.is_active ? "checked" : ""}
onclick="event.stopPropagation()"
onchange="toggleWarehouseStatus(${w.warehouse_id}, this.checked)">

<span class="slider"></span>

</label>

${remainLabel}

</div>

</td>

<td class="col-center">

<button
class="btn-icon"
onclick="event.stopPropagation();editWarehouse(${w.warehouse_id})">
✏️
</button>

<button
class="btn-icon danger"
onclick="event.stopPropagation();deleteWarehouse(${w.warehouse_id},'${w.warehouse_name}')">
🗑
</button>

</td>

</tr>

`;
    })
    .join("");
}

function openModal(data = null) {
  document.getElementById("modalOverlay").classList.add("open");

  document.getElementById("modalTitle").textContent = data
    ? "แก้ไขคลัง"
    : "เพิ่มคลัง";

  document.getElementById("editId").value = data?.warehouse_id || "";

  document.getElementById("fCode").value =
    data?.warehouse_code || generateCode();

  document.getElementById("fType").value = data?.warehouse_type || "MAIN";

  document.getElementById("fIcon").value = data?.warehouse_icon || "🏭";

  document.getElementById("fName").value = data?.warehouse_name || "";

  document.getElementById("fAddress").value = data?.location || "";

  document.getElementById("fManager").value = data?.manager_name || "";

  document.getElementById("fPhone").value = data?.phone || "";

  document.getElementById("fCapacity").value = data?.capacity || "";

  document.getElementById("fNote").value = data?.note || "";

  document.getElementById("fStatus").value = data
    ? data.is_active
      ? "true"
      : "false"
    : "true";
}

function closeModal() {
  document.getElementById("modalOverlay").classList.remove("open");
}

function closeModalBg(e) {
  if (e.target.id === "modalOverlay") closeModal();
}

function editWarehouse(id) {
  const w = warehouses.find((w) => w.warehouse_id === id);

  openModal(w);
}

function deleteWarehouse(id, name) {
  const whStock = stock.filter((s) => s.warehouse_id === id);

  const qty = whStock.reduce((a, b) => a + (b.qty_on_hand || 0), 0);

  if (qty > 0) {
    showToast(`คลัง "${name}" ยังมีสินค้าอยู่ ลบไม่ได้`, "warning");
    return;
  }

  openDeleteModal(`ต้องการลบคลัง "${name}" หรือไม่ ?`, async () => {
    await sbFetch("warehouses", {
      method: "DELETE",
      query: `?warehouse_id=eq.${id}`,
    });

    loadData();
  });
}

async function saveWarehouse() {
  const payload = {
    warehouse_code: document.getElementById("fCode").value,
    warehouse_name: document.getElementById("fName").value,
    warehouse_type: document.getElementById("fType").value,
    warehouse_icon: document.getElementById("fIcon").value,
    location: document.getElementById("fAddress").value,
    manager_name: document.getElementById("fManager").value,
    phone: document.getElementById("fPhone").value,
    capacity: parseInt(document.getElementById("fCapacity").value) || 0,
    note: document.getElementById("fNote").value,
    is_active: document.getElementById("fStatus").value === "true",
  };

  const id = document.getElementById("editId").value;
  const isEdit = id && id !== "";

  try {
    if (isEdit) {
      await sbFetch("warehouses", {
        method: "PATCH",
        query: `?warehouse_id=eq.${id}`,
        body: payload,
      });
    } else {
      await sbFetch("warehouses", {
        method: "POST",
        body: payload,
      });
    }

    closeModal();
    loadData();
    showToast("บันทึกสำเร็จ");
  } catch (e) {
    if (e.message.includes("duplicate") || e.message.includes("unique")) {
      showToast("SKU ซ้ำ", "error");
    } else {
      showToast("บันทึกไม่สำเร็จ", "error");
    }
  }
}

function generateCode() {
  if (warehouses.length === 0) return "WH-001";

  const nums = warehouses.map(
    (w) => parseInt(w.warehouse_code.replace("WH-", "")) || 0,
  );

  const next = Math.max(...nums) + 1;

  return "WH-" + String(next).padStart(3, "0");
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
  if (SUPABASE_URL && SUPABASE_KEY) loadData();
});
async function toggleWarehouseStatus(id, status) {
  try {
    await sbFetch("warehouses", {
      method: "PATCH",
      query: `?warehouse_id=eq.${id}`,
      body: { is_active: status },
    });

    // update local state
    const w = warehouses.find((w) => w.warehouse_id === id);
    if (w) w.is_active = status;

    // re-render table + stats
    renderTable();
    renderStats();

    showToast("อัปเดตสถานะสำเร็จ");
  } catch (e) {
    showToast("เปลี่ยนสถานะไม่ได้", "error");
  }
}
function renderStats() {
  const total = warehouses.length;

  const active = warehouses.filter((w) => w.is_active).length;

  const inactive = total - active;

  const totalStock = stock.length;

  document.getElementById("statTotal").textContent = total;

  document.getElementById("statActive").textContent = active;

  document.getElementById("statInactive").textContent = inactive;

  document.getElementById("statStock").textContent = totalStock;
}
let currentSort = { field: "", dir: "asc" };

function sortTable(field) {
  if (currentSort.field === field) {
    currentSort.dir = currentSort.dir === "asc" ? "desc" : "asc";
  } else {
    currentSort.field = field;
    currentSort.dir = "asc";
  }

  warehouses.sort((a, b) => {
    let x;
    let y;

    if (field === "qty") {
      const ax = stock
        .filter((s) => s.warehouse_id === a.warehouse_id)
        .reduce((sum, s) => sum + (s.qty_on_hand || 0), 0);

      const bx = stock
        .filter((s) => s.warehouse_id === b.warehouse_id)
        .reduce((sum, s) => sum + (s.qty_on_hand || 0), 0);

      x = ax;
      y = bx;
    } else {
      x = a[field] || "";
      y = b[field] || "";
    }

    if (currentSort.dir === "asc") return x > y ? 1 : -1;
    return x < y ? 1 : -1;
  });

  document.querySelectorAll(".sort-icon").forEach((i) => {
    i.classList.remove("active");
    i.textContent = "⇅";
  });

  const icon = document.getElementById("sort-" + field);

  if (icon) {
    icon.classList.add("active");
    icon.textContent = currentSort.dir === "asc" ? "▲" : "▼";
  }

  renderTable();
}
function downloadTemplate() {
  const data = [
    {
      warehouse_code: "",
      warehouse_name: "",
      warehouse_type: "",
      manager_name: "",
      location: "",
      phone: "",
    },
  ];

  const ws = XLSX.utils.json_to_sheet(data);

  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, ws, "Warehouses");

  XLSX.writeFile(wb, "warehouse_template.xlsx");
}
async function openWarehouseStock(id, name, icon) {
  const items = stock.filter((s) => s.warehouse_id === id);

  document.getElementById("panelTitle").innerHTML =
    `สินค้าในคลัง : ${icon || "🏣"}  ${name}`;

  document.getElementById("warehousePanel").classList.add("open");
  document.querySelector(".page").classList.remove("panel-open");

  renderStockPanel(items);
}

function closePanel() {
  document.getElementById("warehousePanel").classList.remove("open");
  document.querySelector(".page").classList.remove("panel-open");
}
function exportWarehouses() {
  if (!warehouses || warehouses.length === 0) {
    showToast("ไม่มีข้อมูลให้ Export", "warning");
    return;
  }

  const rows = warehouses.map((w) => ({
    code: w.warehouse_code,
    name: w.warehouse_name,
    type: w.warehouse_type,
    manager: w.manager_name || "",
    location: w.location || "",
    phone: w.phone || "",
    active: w.is_active ? "YES" : "NO",
  }));

  const ws = XLSX.utils.json_to_sheet(rows);

  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, ws, "Warehouses");

  XLSX.writeFile(wb, "warehouses_export.xlsx");
}
function importWarehouses() {
  const input = document.createElement("input");

  input.type = "file";

  input.accept = ".xlsx,.csv";

  input.onchange = async (e) => {
    const file = e.target.files[0];

    const text = await file.text();

    const rows = text.split("\n").slice(1);

    for (const row of rows) {
      if (!row.trim()) continue;

      const cols = row.split(",");

      const payload = {
        warehouse_code: cols[0],
        warehouse_name: cols[1],
        warehouse_type: cols[2] || "MAIN",
        manager_name: cols[3] || "",
        location: cols[4] || "",
        phone: cols[5] || "",
        is_active: true,
      };

      await sbFetch("warehouses", {
        method: "POST",
        body: payload,
      });
    }

    loadData();

    showToast("Import สำเร็จ");
  };

  input.click();
}

let currentPanelItems = [];

function renderStockPanel(items) {
  currentPanelItems = items;

  drawPanel(items);
}

function filterPanelStock() {
  const q = document.getElementById("panelSearch").value.toLowerCase();

  const list = currentPanelItems.filter(
    (i) =>
      (i.product_name || "").toLowerCase().includes(q) ||
      (i.product_sku || "").toLowerCase().includes(q),
  );

  drawPanel(list);
}
function drawPanel(items) {
  const body = document.getElementById("panelBody");

  if (items.length === 0) {
    body.innerHTML = `
<div style="padding:30px;text-align:center">
ไม่พบสินค้า
</div>
`;
    return;
  }

  body.innerHTML = `

<table class="stock-table">

<thead>
<tr>
<th>สินค้า</th>
<th>จำนวน</th>
</tr>
</thead>

<tbody>

${items
  .map((i) => {
    let cls = "qty-ok";

    if (i.qty_on_hand === 0) cls = "qty-zero";
    else if (i.qty_on_hand < 5) cls = "qty-low";

    return `

<tr>

<td>${i.product_name || "-"}</td>

<td class="stock-qty ${cls}">
${i.qty_on_hand}
</td>

</tr>

`;
  })
  .join("")}

</tbody>

</table>

`;
}
// ===============================
// STOCK MOVEMENT ENGINE
// ===============================

async function createMovement({
  product_id,
  warehouse_id,
  bin_id = null,
  movement_type,
  qty,
  ref_doc_type = null,
  ref_doc_id = null,
  note = "",
}) {
  try {
    await sbFetch("stock_movements", {
      method: "POST",
      body: {
        product_id,
        warehouse_id,
        bin_id,
        movement_type,
        qty,
        ref_doc_type,
        ref_doc_id,
        note,
      },
    });

    loadData();
    showToast("บันทึก Movement สำเร็จ");
  } catch (e) {
    showToast("บันทึก Movement ไม่สำเร็จ", "error");
  }
}
async function receiveStock(product_id, warehouse_id, qty) {
  await createMovement({
    product_id,
    warehouse_id,
    movement_type: "IN",
    qty: qty,
    ref_doc_type: "PO",
  });
}
async function issueStock(product_id, warehouse_id, qty) {
  await createMovement({
    product_id,
    warehouse_id,
    movement_type: "OUT",
    qty: qty,
    ref_doc_type: "SO",
  });
}
async function transferStock(product_id, from_wh, to_wh, qty) {
  try {
    await createMovement({
      product_id,
      warehouse_id: from_wh,
      movement_type: "OUT",
      qty: qty,
      ref_doc_type: "TRANSFER",
    });

    await createMovement({
      product_id,
      warehouse_id: to_wh,
      movement_type: "IN",
      qty: qty,
      ref_doc_type: "TRANSFER",
    });

    showToast("โอนสินค้าสำเร็จ");
  } catch (e) {
    showToast("Transfer ไม่สำเร็จ", "error");
  }
}
async function loadMovementHistory(product_id) {
  return await sbFetch("stock_movements", {
    query: `?product_id=eq.${product_id}&order=moved_at.desc.nullslast`,
  });
}
async function openMovementHistory(product_id) {
  const rows = await loadMovementHistory(product_id);

  document.getElementById("movementPanel").classList.add("open");

  drawMovement(rows);
}

function closeMovementPanel() {
  document.getElementById("movementPanel").classList.remove("open");
}

function drawMovement(rows) {
  const body = document.getElementById("movementBody");

  if (!rows || rows.length === 0) {
    body.innerHTML = "<div style='padding:20px'>ไม่มี Movement</div>";

    return;
  }

  body.innerHTML = `

<table class="stock-table">

<thead>
<tr>
<th>Date</th>
<th>Type</th>
<th>Qty</th>
<th>Ref</th>
</tr>
</thead>

<tbody>

${rows
  .map(
    (r) => `

<tr>

<td>${new Date(r.moved_at).toLocaleString()}</td>

<td>${r.movement_type}</td>

<td>${r.qty}</td>

<td>${r.ref_doc_type || ""}</td>

</tr>

`,
  )
  .join("")}

</tbody>

</table>

`;
}
function toggleRowMenu(btn) {
  const menu = btn.nextElementSibling;

  document.querySelectorAll(".menu-dropdown").forEach((m) => {
    if (m !== menu) m.style.display = "none";
  });

  menu.style.display = menu.style.display === "block" ? "none" : "block";
}

document.addEventListener("click", () => {
  document
    .querySelectorAll(".menu-dropdown")
    .forEach((m) => (m.style.display = "none"));
});
