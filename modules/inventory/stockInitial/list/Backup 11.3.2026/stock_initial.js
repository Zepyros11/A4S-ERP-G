// ============================================================
// A4S-ERP — Stock Initial  (stock_initial.js)
// ============================================================

let SUPABASE_URL = localStorage.getItem("sb_url") || "";
let SUPABASE_KEY = localStorage.getItem("sb_key") || "";

let products = [];
let warehouses = [];
let categories = [];
let initMap = {};
let productImages = [];
let currentSort = { field: "product_name", dir: "asc" };

// track original values to detect changes
// key: "product_id-warehouse_id" → original qty (number)
let originalValues = {};
let activeWarehouseId = null;

let activeCountry = null;
let activeParent = null;
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
  if (!res.ok) throw new Error(await res.text());
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
    const [_prods, _whs, _cats, _imgs, inits] = await Promise.all([
      sbFetch("products", {
        query: "?select=*&is_active=eq.true&order=product_name.asc",
      }),
      sbFetch("warehouses", {
        query: "?select=*&is_active=eq.true&order=warehouse_code.asc",
      }),
      sbFetch("categories", { query: "?select=*&order=category_name.asc" }),
      sbFetch("product_images", { query: "?select=*&order=sort_order.asc" }),
      sbFetch("stock_movements", { query: "?movement_type=eq.INIT&select=*" }),
    ]);
    products = _prods || [];
    warehouses = _whs || [];
    categories = _cats || [];
    productImages = _imgs || [];
    initMap = {};
    (inits || []).forEach((r) => {
      initMap[`${r.product_id}-${r.warehouse_id}`] = r;
    });

    originalValues = {};

    buildCategoryFilter();
    buildCountryFilter();
    renderStats();

    const firstCountry = warehouses[0]?.country;
    if (firstCountry) {
      buildParentFilter(firstCountry);
    }
    if (warehouses.length) {
      activeWarehouseId = warehouses[0].warehouse_id;
    }

    buildTableHeader();
    renderTable();
  } catch (err) {
    console.error(err);
    showToast("โหลดข้อมูลไม่สำเร็จ", "error");
  } finally {
    showLoading(false);
  }
}

// ============================================================
// BUILD TABLE HEADER
// ============================================================
function buildTableHeader() {
  const thead = document.getElementById("siThead");
  const wh = warehouses.find((w) => w.warehouse_id === activeWarehouseId);
  thead.innerHTML = `
  <tr>
    <th style="width:64px;text-align:center">ภาพ</th>
    <th onclick="sortTable('product_name')" style="cursor:pointer">
      ชื่อสินค้า
      <span class="sort-icon" id="sort-product_name">⇅</span>
    </th>
    <th onclick="sortTable('category_name')" style="cursor:pointer">
      หมวดหมู่
      <span class="sort-icon" id="sort-category_name">⇅</span>
    </th>
    <th class="col-center">
      <div class="si-wh-name">
        ${wh?.warehouse_icon || "🏭"} ${wh?.warehouse_name || ""}
      </div>
    </th>
  </tr>
  `;
}
function setWarehouse(id) {
  activeWarehouseId = id;
  buildWarehouseSelector();
  buildTableHeader();
  renderTable();
}

// ============================================================
// BUILD CATEGORY FILTER
// ============================================================
function buildCategoryFilter() {
  const sel = document.getElementById("filterCategory");
  sel.innerHTML = `<option value="">🏷️ ทุกหมวดหมู่</option>`;
  categories.forEach((c) => {
    sel.innerHTML += `<option value="${c.category_id}">${c.category_name}</option>`;
  });
}

// ============================================================
// STATS
// ============================================================
function renderStats() {
  const productIdsWithInit = new Set(
    Object.keys(initMap).map((k) => parseInt(k.split("-")[0])),
  );
  const hasStock = products.filter((p) =>
    productIdsWithInit.has(p.product_id),
  ).length;

  document.getElementById("statTotal").textContent = products.length;
  document.getElementById("statHasStock").textContent = hasStock;
  document.getElementById("statNoStock").textContent =
    products.length - hasStock;
  document.getElementById("statWarehouses").textContent = warehouses.length;
}

// ============================================================
// RENDER TABLE
// ============================================================
function renderTable() {
  const search = document.getElementById("searchInput").value.toLowerCase();
  const catId = document.getElementById("filterCategory").value;
  const status = document.getElementById("filterStatus").value;

  const productIdsWithInit = new Set(
    Object.keys(initMap).map((k) => parseInt(k.split("-")[0])),
  );

  let list = products.filter((p) => {
    const q = (p.product_name + " " + p.product_code).toLowerCase();
    if (search && !q.includes(search)) return false;
    if (catId && String(p.category_id) !== catId) return false;
    if (status === "has" && !productIdsWithInit.has(p.product_id)) return false;
    if (status === "none" && productIdsWithInit.has(p.product_id)) return false;
    return true;
  });

  if (currentSort.field) {
    list = [...list].sort((a, b) => {
      let x, y;
      if (currentSort.field === "category_name") {
        x =
          categories.find((c) => c.category_id === a.category_id)
            ?.category_name || "";
        y =
          categories.find((c) => c.category_id === b.category_id)
            ?.category_name || "";
        return currentSort.dir === "asc"
          ? x.localeCompare(y)
          : y.localeCompare(x);
      }
      if (currentSort.field === "product_name") {
        const ac = (a.product_code || "").toUpperCase();
        const bc = (b.product_code || "").toUpperCase();
        const aParts = ac.split("-");
        const bParts = bc.split("-");
        const aPrefix = aParts.slice(0, -2).join("-");
        const bPrefix = bParts.slice(0, -2).join("-");
        const aSeq = parseInt(aParts[aParts.length - 1]) || 9999;
        const bSeq = parseInt(bParts[bParts.length - 1]) || 9999;
        if (aPrefix !== bPrefix) {
          return currentSort.dir === "asc"
            ? aPrefix.localeCompare(bPrefix)
            : bPrefix.localeCompare(aPrefix);
        }
        return currentSort.dir === "asc" ? aSeq - bSeq : bSeq - aSeq;
      }
      x = a[currentSort.field] || "";
      y = b[currentSort.field] || "";
      return currentSort.dir === "asc" ? (x > y ? 1 : -1) : x < y ? 1 : -1;
    });
  }

  document.getElementById("productCount").textContent = list.length + " รายการ";
  const colSpan = 3;
  const tbody = document.getElementById("productTable");

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align:center;padding:30px">ไม่พบข้อมูล</td></tr>`;
    return;
  }

  tbody.innerHTML = list
    .map((p) => {
      const cat = categories.find((c) => c.category_id === p.category_id);
      const catName = cat ? cat.category_name : "-";

      const key = `${p.product_id}-${activeWarehouseId}`;
      const val = initMap[key]?.qty || "";

      // store original
      if (!(key in originalValues)) {
        originalValues[key] = val === "" ? "" : parseFloat(val);
      }

      const whInputs = `
<td class="col-center si-input-cell">
  <input
    type="number"
    class="si-qty-input"
    id="inp-${p.product_id}-${activeWarehouseId}"
    value="${val}"
    min="0"
    placeholder="-"
    oninput="onAnyInput()"
  />
</td>
`;
      const img = productImages.find((i) => i.product_id === p.product_id);
      const imgCell = img
        ? `<img src="${img.url}" style="width:48px;height:48px;object-fit:cover;border-radius:6px;cursor:pointer;"
             onclick="openImgPopup(${p.product_id})"
             onerror="this.parentElement.innerHTML='<span>📦</span>'">`
        : `<span style="font-size:24px">📦</span>`;

      return `
<tr class="si-data-row" id="row-${p.product_id}">
  <td style="text-align:center;cursor:pointer" onclick="openImgPopup(${p.product_id})">
    ${imgCell}
  </td>
  <td>
    <strong>${p.product_name}</strong>
    <div class="si-code">${p.product_code}</div>
  </td>
  <td class="col-center">
    <div class="cat-badge" style="background:${cat?.color || "#eee"}20">
      <span class="cat-icon">${cat?.icon || "📦"}</span>
      <span>${cat?.category_name || "-"}</span>
    </div>
  </td>
  ${whInputs}
</tr>`;
    })
    .join("");

  // reset save all btn
  updateSaveAllBtn();
}

// ============================================================
// DETECT CHANGES → SHOW/HIDE SAVE ALL
// ============================================================
function onAnyInput() {
  updateSaveAllBtn();
}

function updateSaveAllBtn() {
  const btn = document.getElementById("saveAllBtn");
  const hasChange = getChangedRows().length > 0;
  btn.style.display = hasChange ? "inline-flex" : "none";
}

function getChangedRows() {
  const changed = [];
  document.querySelectorAll(".si-qty-input").forEach((input) => {
    const id = input.id; // inp-{productId}-{whId}
    const parts = id.replace("inp-", "").split("-");
    const productId = parseInt(parts[0]);
    const whId = parseInt(parts[1]);
    const key = `${productId}-${whId}`;
    const currentVal = input.value === "" ? "" : parseFloat(input.value);
    const original = originalValues[key] ?? "";

    if (currentVal !== original && input.value !== "") {
      changed.push({ productId, whId, qty: parseFloat(input.value) });
    }
  });
  return changed;
}

// ============================================================
// SAVE ALL CHANGED
// ============================================================
async function saveAll() {
  const changed = getChangedRows();
  if (changed.length === 0) {
    showToast("ไม่มีการเปลี่ยนแปลง", "warning");
    return;
  }

  showLoading(true);
  try {
    for (const { productId, whId, qty } of changed) {
      await saveInitEntry(productId, whId, qty);
    }
    await loadData();
    showToast(`บันทึกสำเร็จ ${changed.length} รายการ`);
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
}

// ============================================================
// CORE SAVE INIT ENTRY (Override)
// ============================================================
async function saveInitEntry(
  productId,
  warehouseId,
  qty,
  note = "Stock เริ่มต้น",
) {
  const key = `${productId}-${warehouseId}`;
  const existing = initMap[key];

  if (existing) {
    await sbFetch("stock_movements", {
      method: "DELETE",
      query: `?movement_id=eq.${existing.movement_id}`,
    });
  }

  await sbFetch("stock_movements", {
    method: "POST",
    body: {
      product_id: productId,
      warehouse_id: warehouseId,
      movement_type: "INIT",
      qty: qty,
      ref_doc_type: "INIT",
      note: note,
    },
  });
}

// ============================================================
// SORT
// ============================================================
function sortTable(field) {
  if (currentSort.field === field) {
    currentSort.dir = currentSort.dir === "asc" ? "desc" : "asc";
  } else {
    currentSort.field = field;
    currentSort.dir = "asc";
  }
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
function setCountry(code) {
  activeCountry = code;

  const firstParent = warehouses.find(
    (w) => !w.parent_id && w.country === code,
  );

  activeParent = firstParent?.warehouse_id || null;
  activeWarehouseId = activeParent;

  buildWarehouseSelector();
  buildTableHeader();
  renderTable();
}

function setParent(id) {
  activeParent = id;
  activeWarehouseId = id;

  buildWarehouseSelector();
  buildTableHeader();
  renderTable();
}
if (warehouses.length) {
  activeCountry = warehouses[0].country;

  const firstParent = warehouses.find(
    (w) => !w.parent_id && w.country === activeCountry,
  );

  activeParent = firstParent?.warehouse_id;
  activeWarehouseId = activeParent;
}
function buildCountryFilter() {
  const sel = document.getElementById("filterCountry");

  const countryNames = {
    TH: "🇹🇭 ไทย",
    NG: "🇳🇬 Nigeria",
  };

  const countries = [...new Set(warehouses.map((w) => w.country))];

  sel.innerHTML = `<option value="">🌍 ประเทศ</option>`;

  countries.forEach((c) => {
    const label = countryNames[c] || c;

    sel.innerHTML += `
      <option value="${c}">
        ${label}
      </option>
    `;
  });
}
function buildParentFilter(country) {
  const sel = document.getElementById("filterParent");

  const parents = warehouses.filter(
    (w) => !w.parent_id && w.country === country,
  );

  sel.innerHTML = `<option value="">🏬 คลังหลัก</option>`;

  parents.forEach((p) => {
    sel.innerHTML += `
      <option value="${p.warehouse_id}">
        ${p.warehouse_icon || "🏬"} ${p.warehouse_name}
      </option>
    `;
  });
}
function buildChildFilter(parentId) {
  const sel = document.getElementById("filterChild");

  const childs = warehouses.filter((w) => w.parent_id == parentId);

  sel.innerHTML = `<option value="">🏠 คลังสาขา</option>`;

  childs.forEach((c) => {
    sel.innerHTML += `
      <option value="${c.warehouse_id}">
        ${c.warehouse_icon || "🏠"} ${c.warehouse_name}
      </option>
    `;
  });
}
function onCountryChange() {
  const country = document.getElementById("filterCountry").value;

  buildParentFilter(country);

  document.getElementById("filterChild").innerHTML =
    `<option value="">🏠 คลังย่อย</option>`;
}

function onParentChange() {
  const parentId = parseInt(document.getElementById("filterParent").value);

  buildChildFilter(parentId);

  activeWarehouseId = parentId;

  buildTableHeader();
  renderTable();
}

function onChildChange() {
  const childId = parseInt(document.getElementById("filterChild").value);

  activeWarehouseId = childId;

  buildTableHeader();
  renderTable();
}
