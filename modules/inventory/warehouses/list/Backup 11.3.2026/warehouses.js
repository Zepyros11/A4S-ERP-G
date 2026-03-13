let SUPABASE_URL = localStorage.getItem("sb_url") || "";
let SUPABASE_KEY = localStorage.getItem("sb_key") || "";

let warehouses = [];
let stock = [];
let countries = [];
let selectedCountry = null;

const TYPE = {
  MAIN: { label: "🏣 คลังหลัก", color: "type-main" },
  BRANCH: { label: "🏪 คลังสาขา", color: "type-branch" },
  TRANSIT: { label: "📦 จุดพักสินค้า", color: "type-transit" },
  RETURN: { label: "↩️ จุดคืนสินค้า", color: "type-return" },
};

// ============================================================
// SUPABASE FETCH HELPER
// ============================================================
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

// ============================================================
// LOAD DATA
// ============================================================
async function loadData() {
  showLoading(true);
  try {
    warehouses = await sbFetch("warehouses", {
      query: "?select=*&order=warehouse_code.asc",
    });
    countries = await sbFetch("countries", {
      query: "?select=*&order=sort_order.asc,country_name.asc",
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

// ============================================================
// RENDER TABLE — Group by Country → Parent → Child
// ============================================================
function renderTable() {
  const search = document.getElementById("searchInput").value.toLowerCase();
  const type = document.getElementById("filterType").value;
  const status = document.getElementById("filterStatus").value;

  let list = warehouses.filter((w) => {
    const q = (w.warehouse_name + " " + w.warehouse_code).toLowerCase();
    if (search && !q.includes(search)) return false;
    if (type && w.warehouse_type !== type) return false;
    if (status !== "" && String(w.is_active) !== status) return false;
    return true;
  });

  const tbody = document.getElementById("whTable");
  document.getElementById("whCount").textContent = list.length + " รายการ";

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px">ไม่พบข้อมูล</td></tr>`;
    return;
  }

  let html = "";

  const withCountry = list.filter((w) => w.country);
  const withoutCountry = list.filter((w) => !w.country);

  // group by country code
  const countryGroups = {};
  withCountry.forEach((w) => {
    if (!countryGroups[w.country]) countryGroups[w.country] = [];
    countryGroups[w.country].push(w);
  });

  Object.entries(countryGroups).forEach(([code, whs]) => {
    const countryInfo = countries.find((c) => c.country_code === code);
    const flag = countryInfo?.flag_emoji || "🌍";
    const name = countryInfo?.country_name || code;

    const parents = whs.filter((w) => !w.parent_id);
    const children = whs.filter((w) => w.parent_id);

    html += `
<tr class="wh-country-row">
  <td colspan="7">
    <span class="wh-country-label">${flag} ${name}</span>
    <span class="wh-country-count">${whs.length} คลัง</span>
  </td>
</tr>`;

    parents.forEach((w) => {
      html += renderWarehouseRow(w, false);
      children
        .filter((c) => c.parent_id === w.warehouse_id)
        .forEach((child) => {
          html += renderWarehouseRow(child, true);
        });
    });

    // children ที่ parent ถูก filter ซ่อน
    const renderedChildIds = children
      .filter((c) => parents.find((p) => p.warehouse_id === c.parent_id))
      .map((c) => c.warehouse_id);
    children
      .filter((c) => !renderedChildIds.includes(c.warehouse_id))
      .forEach((child) => {
        html += renderWarehouseRow(child, true);
      });
  });

  // คลังไม่มี country
  if (withoutCountry.length > 0) {
    html += `
<tr class="wh-country-row wh-country-unknown">
  <td colspan="7">
    <span class="wh-country-label">🌍 ไม่ระบุประเทศ</span>
    <span class="wh-country-count">${withoutCountry.length} คลัง</span>
  </td>
</tr>`;
    withoutCountry.forEach((w) => {
      html += renderWarehouseRow(w, false);
    });
  }

  tbody.innerHTML = html;
}

function renderWarehouseRow(w, isChild) {
  const whStock = stock.filter((s) => s.warehouse_id === w.warehouse_id);
  const qty = whStock.reduce((sum, s) => sum + (s.qty_on_hand || 0), 0);
  const remainLabel =
    !w.is_active && qty > 0
      ? `<span class="stock-warning">มีสินค้าตกค้าง</span>`
      : "";

  const nameCell = isChild
    ? `<span class="wh-child-indent">└</span> ${w.warehouse_icon || "🏭"} <strong>${w.warehouse_name}</strong>`
    : `${w.warehouse_icon || "🏭"} <strong>${w.warehouse_name}</strong>`;

  return `
<tr class="${isChild ? "wh-child-row" : "wh-parent-row"}"
    onclick="openWarehouseStock(${w.warehouse_id},'${w.warehouse_name}','${w.warehouse_icon}')">
  <td class="col-center">${w.warehouse_code}</td>
  <td>${nameCell}</td>
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
        <span class="phone-icon">📞</span> ${w.phone || "-"}
      </span>
    </span>
  </td>
  <td class="col-center">${qty}</td>
  <td class="col-center">
    <div class="status-box">
      <label class="switch" onclick="event.stopPropagation()">
        <input type="checkbox" ${w.is_active ? "checked" : ""}
          onclick="event.stopPropagation()"
          onchange="toggleWarehouseStatus(${w.warehouse_id}, this.checked)">
        <span class="slider"></span>
      </label>
      ${remainLabel}
    </div>
  </td>
  <td class="col-center">
    <button class="btn-icon" onclick="event.stopPropagation();editWarehouse(${w.warehouse_id})">✏️</button>
    <button class="btn-icon danger" onclick="event.stopPropagation();deleteWarehouse(${w.warehouse_id},'${w.warehouse_name}')">🗑</button>
  </td>
</tr>`;
}

// ============================================================
// MODAL OPEN / CLOSE
// ============================================================
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

  const targetCode = data?.country || null;
  selectedCountry = targetCode
    ? countries.find((c) => c.country_code === targetCode) || null
    : null;

  const parentSel = document.getElementById("fParent");
  parentSel.innerHTML = `<option value="">— ไม่มี (คลังหลัก) —</option>`;
  warehouses
    .filter(
      (w) =>
        w.warehouse_id !== (data?.warehouse_id || -1) &&
        w.warehouse_type === "MAIN",
    )
    .forEach((w) => {
      const sel = data?.parent_id === w.warehouse_id ? "selected" : "";
      parentSel.innerHTML += `<option value="${w.warehouse_id}" ${sel}>${w.warehouse_icon || "🏭"} ${w.warehouse_name}</option>`;
    });

  renderCountryDropdown();
}

function closeModal() {
  document.getElementById("modalOverlay").classList.remove("open");
  closeCountryDropdown();
}

function closeModalBg(e) {
  if (e.target.id === "modalOverlay") closeModal();
}

function editWarehouse(id) {
  const w = warehouses.find((w) => w.warehouse_id === id);
  openModal(w);
}

// ============================================================
// CUSTOM COUNTRY DROPDOWN
// ============================================================
function renderCountryDropdown() {
  const trigger = document.getElementById("countryTrigger");
  trigger.innerHTML = selectedCountry
    ? `${selectedCountry.flag_emoji || ""} ${selectedCountry.country_name} <span class="country-trigger-arrow">▾</span>`
    : `— เลือกประเทศ — <span class="country-trigger-arrow">▾</span>`;
  renderCountryList();
}

function toggleCountryDropdown(e) {
  e.stopPropagation();
  const panel = document.getElementById("countryPanel");
  panel.classList.contains("open")
    ? closeCountryDropdown()
    : panel.classList.add("open");
}

function closeCountryDropdown() {
  document.getElementById("countryPanel")?.classList.remove("open");
}

function renderCountryList() {
  const list = document.getElementById("countryList");
  if (!list) return;
  list.innerHTML =
    countries
      .map(
        (c) => `
    <div class="country-item ${selectedCountry?.country_id === c.country_id ? "selected" : ""}"
         data-id="${c.country_id}" id="ci-${c.country_id}">
      <span class="country-item-label" onclick="selectCountry(${c.country_id})">
        ${c.flag_emoji || ""} ${c.country_name}
        <small class="country-code">${c.country_code}</small>
      </span>
      <span class="country-item-actions">
        <button class="ci-btn" onclick="startEditCountry(${c.country_id}, event)" title="แก้ไข">✏️</button>
        <button class="ci-btn danger" onclick="deleteCountry(${c.country_id})" title="ลบ">🗑</button>
      </span>
    </div>`,
      )
      .join("") +
    `
    <div class="country-add-row">
      <button class="country-add-btn" onclick="startAddCountry(event)">＋ เพิ่มประเทศ</button>
    </div>`;
}

function selectCountry(id) {
  selectedCountry = countries.find((c) => c.country_id === id) || null;
  renderCountryDropdown();
  closeCountryDropdown();
}

function startEditCountry(id, e) {
  e && e.stopPropagation();
  const c = countries.find((c) => c.country_id === id);
  if (!c) return;
  const item = document.getElementById(`ci-${id}`);
  item.classList.add("editing");
  item.innerHTML = `
    <input class="ci-input" id="ci-flag-${id}" value="${c.flag_emoji || ""}" placeholder="🏳" style="width:48px" />
    <input class="ci-input" id="ci-name-${id}" value="${c.country_name}" placeholder="ชื่อประเทศ" />
    <input class="ci-input" id="ci-code-${id}" value="${c.country_code}" placeholder="CODE" style="width:60px;text-transform:uppercase" />
    <span class="country-item-actions">
      <button class="ci-btn success" onclick="saveEditCountry(${id}, event)">✔</button>
      <button class="ci-btn" onclick="renderCountryList()">✕</button>
    </span>`;
}

async function saveEditCountry(id, e) {
  e && e.stopPropagation();
  const flag = document.getElementById(`ci-flag-${id}`)?.value.trim();
  const name = document.getElementById(`ci-name-${id}`)?.value.trim();
  const code = document
    .getElementById(`ci-code-${id}`)
    ?.value.trim()
    .toUpperCase();
  if (!name || !code) {
    showToast("กรุณากรอกชื่อและรหัส", "warning");
    return;
  }
  try {
    await sbFetch("countries", {
      method: "PATCH",
      query: `?country_id=eq.${id}`,
      body: { flag_emoji: flag, country_name: name, country_code: code },
    });
    countries = await sbFetch("countries", {
      query: "?select=*&order=sort_order.asc,country_name.asc",
    });
    if (selectedCountry?.country_id === id)
      selectedCountry = countries.find((c) => c.country_id === id);
    renderCountryDropdown();
    showToast("แก้ไขสำเร็จ");
  } catch (e) {
    showToast("แก้ไขไม่สำเร็จ", "error");
  }
}

function startAddCountry(e) {
  e && e.stopPropagation();
  const list = document.getElementById("countryList");
  const addRow = list.querySelector(".country-add-row");
  const newRow = document.createElement("div");
  newRow.className = "country-item editing";
  newRow.id = "ci-new";
  newRow.innerHTML = `
    <input class="ci-input" id="ci-new-flag" placeholder="🏳" style="width:48px" />
    <input class="ci-input" id="ci-new-name" placeholder="ชื่อประเทศ" />
    <input class="ci-input" id="ci-new-code" placeholder="CODE" style="width:60px;text-transform:uppercase" />
    <span class="country-item-actions">
      <button class="ci-btn success" onclick="saveAddCountry()">✔</button>
      <button class="ci-btn" onclick="renderCountryList()">✕</button>
    </span>`;
  list.insertBefore(newRow, addRow);
  document.getElementById("ci-new-flag").focus();
}

async function saveAddCountry() {
  const flag = document.getElementById("ci-new-flag")?.value.trim();
  const name = document.getElementById("ci-new-name")?.value.trim();
  const code = document
    .getElementById("ci-new-code")
    ?.value.trim()
    .toUpperCase();
  if (!name || !code) {
    showToast("กรุณากรอกชื่อและรหัส", "warning");
    return;
  }
  try {
    await sbFetch("countries", {
      method: "POST",
      body: { flag_emoji: flag, country_name: name, country_code: code },
    });
    countries = await sbFetch("countries", {
      query: "?select=*&order=sort_order.asc,country_name.asc",
    });
    renderCountryList();
    showToast("เพิ่มประเทศสำเร็จ");
  } catch (e) {
    showToast("เพิ่มไม่สำเร็จ: " + e.message, "error");
  }
}

async function deleteCountry(id) {
  const c = countries.find((c) => c.country_id === id);
  if (!c) return;
  openDeleteModal(`ต้องการลบประเทศ "${c.country_name}" หรือไม่?`, async () => {
    try {
      await sbFetch("countries", {
        method: "DELETE",
        query: `?country_id=eq.${id}`,
      });
      countries = await sbFetch("countries", {
        query: "?select=*&order=sort_order.asc,country_name.asc",
      });
      if (selectedCountry?.country_id === id)
        selectedCountry = countries[0] || null;
      renderCountryDropdown();
      showToast("ลบสำเร็จ");
    } catch (e) {
      showToast("ลบไม่สำเร็จ", "error");
    }
  });
}

document.addEventListener("click", (e) => {
  if (!e.target.closest("#countryDropdownWrap")) closeCountryDropdown();
  document
    .querySelectorAll(".menu-dropdown")
    .forEach((m) => (m.style.display = "none"));
});

// ============================================================
// SAVE WAREHOUSE
// ============================================================
async function saveWarehouse() {
  if (!selectedCountry) {
    showToast("กรุณาเลือกประเทศ", "warning");
    return;
  }
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
    country: selectedCountry.country_code,
    parent_id: parseInt(document.getElementById("fParent").value) || null,
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
      await sbFetch("warehouses", { method: "POST", body: payload });
    }
    closeModal();
    loadData();
    showToast("บันทึกสำเร็จ");
  } catch (e) {
    showToast(
      e.message.includes("duplicate") || e.message.includes("unique")
        ? "รหัสซ้ำ"
        : "บันทึกไม่สำเร็จ",
      "error",
    );
  }
}

// ============================================================
// DELETE / TOGGLE
// ============================================================
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

async function toggleWarehouseStatus(id, status) {
  try {
    await sbFetch("warehouses", {
      method: "PATCH",
      query: `?warehouse_id=eq.${id}`,
      body: { is_active: status },
    });
    const w = warehouses.find((w) => w.warehouse_id === id);
    if (w) w.is_active = status;
    renderTable();
    renderStats();
    showToast("อัปเดตสถานะสำเร็จ");
  } catch (e) {
    showToast("เปลี่ยนสถานะไม่ได้", "error");
  }
}

// ============================================================
// STATS
// ============================================================
function renderStats() {
  const total = warehouses.length;
  const active = warehouses.filter((w) => w.is_active).length;
  document.getElementById("statTotal").textContent = total;
  document.getElementById("statActive").textContent = active;
  document.getElementById("statInactive").textContent = total - active;
  document.getElementById("statStock").textContent = stock.length;
}

// ============================================================
// SORT
// ============================================================
let currentSort = { field: "", dir: "asc" };

function sortTable(field) {
  if (currentSort.field === field) {
    currentSort.dir = currentSort.dir === "asc" ? "desc" : "asc";
  } else {
    currentSort.field = field;
    currentSort.dir = "asc";
  }
  warehouses.sort((a, b) => {
    const x = a[field] || "";
    const y = b[field] || "";
    return currentSort.dir === "asc" ? (x > y ? 1 : -1) : x < y ? 1 : -1;
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

// ============================================================
// GENERATE CODE
// ============================================================
function generateCode() {
  if (warehouses.length === 0) return "WH-001";
  const nums = warehouses.map(
    (w) => parseInt(w.warehouse_code.replace("WH-", "")) || 0,
  );
  return "WH-" + String(Math.max(...nums) + 1).padStart(3, "0");
}

// ============================================================
// PANEL
// ============================================================
let currentPanelItems = [];

async function openWarehouseStock(id, name, icon) {
  const items = stock.filter((s) => s.warehouse_id === id);
  document.getElementById("panelTitle").innerHTML =
    `สินค้าในคลัง : ${icon || "🏣"} ${name}`;
  document.getElementById("warehousePanel").classList.add("open");
  document.querySelector(".page").classList.remove("panel-open");
  renderStockPanel(items);
}

function closePanel() {
  document.getElementById("warehousePanel").classList.remove("open");
  document.querySelector(".page").classList.remove("panel-open");
}

function renderStockPanel(items) {
  currentPanelItems = items;
  drawPanel(items);
}

function filterPanelStock() {
  const q = document.getElementById("panelSearch").value.toLowerCase();
  drawPanel(
    currentPanelItems.filter(
      (i) =>
        (i.product_name || "").toLowerCase().includes(q) ||
        (i.product_sku || "").toLowerCase().includes(q),
    ),
  );
}

function drawPanel(items) {
  const body = document.getElementById("panelBody");
  if (items.length === 0) {
    body.innerHTML = `<div style="padding:30px;text-align:center">ไม่พบสินค้า</div>`;
    return;
  }
  body.innerHTML = `
<table class="stock-table">
  <thead><tr><th>สินค้า</th><th>จำนวน</th></tr></thead>
  <tbody>
    ${items
      .map((i) => {
        const cls =
          i.qty_on_hand === 0
            ? "qty-zero"
            : i.qty_on_hand < 5
              ? "qty-low"
              : "qty-ok";
        return `<tr><td>${i.product_name || "-"}</td><td class="stock-qty ${cls}">${i.qty_on_hand}</td></tr>`;
      })
      .join("")}
  </tbody>
</table>`;
}

// ============================================================
// EXPORT / IMPORT
// ============================================================
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
      await sbFetch("warehouses", {
        method: "POST",
        body: {
          warehouse_code: cols[0],
          warehouse_name: cols[1],
          warehouse_type: cols[2] || "MAIN",
          manager_name: cols[3] || "",
          location: cols[4] || "",
          phone: cols[5] || "",
          is_active: true,
        },
      });
    }
    loadData();
    showToast("Import สำเร็จ");
  };
  input.click();
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

// ============================================================
// TOAST / LOADING
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
window.addEventListener("DOMContentLoaded", () => {
  if (SUPABASE_URL && SUPABASE_KEY) loadData();
});
