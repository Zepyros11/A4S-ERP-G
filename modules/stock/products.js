// ============================================================
// CUSTOM CONFIRM DIALOG
// ============================================================
let _confirmResolveFunc = null;

function showConfirm(title, message) {
  return new Promise((resolve) => {
    _confirmResolveFunc = resolve;
    document.getElementById("confirmTitle").textContent = title;
    document.getElementById("confirmMsg").textContent = message;
    const overlay = document.getElementById("confirmOverlay");
    overlay.classList.add("open");
  });
}

function confirmResolve(result) {
  const overlay = document.getElementById("confirmOverlay");
  overlay.classList.remove("open");
  if (_confirmResolveFunc) {
    _confirmResolveFunc(result);
    _confirmResolveFunc = null;
  }
}

let SUPABASE_URL = localStorage.getItem("sb_url") || "";
let SUPABASE_KEY = localStorage.getItem("sb_key") || "";
let allProducts = [],
  stockBalance = [],
  categories = [],
  warehouses = [],
  units = [],
  productImages = [];
let selectedProduct = null;
let sortKey = "product_code",
  sortAsc = true;
let unitRowCount = 0;
let skuOptions = { f2: [], f3: [], f4: [] };
let selectedIds = new Set();

// ============================================================
// SUPABASE
// ============================================================
async function supabaseFetch(table, options = {}) {
  const { method = "GET", body, query = "" } = options;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
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
  if (!res.ok) {
    const e = await res.json();
    throw new Error(e.message || "Error");
  }
  return method === "GET" ? res.json() : res.json().catch(() => null);
}

// ============================================================
// LOAD DATA
// ============================================================
async function loadData() {
  showLoading(true);
  try {
    const [prods, cats, whs, stk, uts, imgs] = await Promise.all([
      supabaseFetch("products", { query: "?select=*&order=product_code" }),
      supabaseFetch("categories", { query: "?select=*" }),
      supabaseFetch("warehouses", { query: "?select=*&is_active=eq.true" }),
      supabaseFetch("stock_available", { query: "?select=*" }),
      supabaseFetch("product_units", { query: "?select=*" }),
      supabaseFetch("product_images", {
        query: "?select=*&order=sort_order.asc",
      }),
    ]);
    allProducts = prods || [];
    categories = cats || [];
    warehouses = whs || [];
    stockBalance = stk || [];
    units = uts || [];
    productImages = imgs || [];
    populateFilters();
    renderTable(allProducts);
    updateStats();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

// ============================================================
// FILTERS & TABLE
// ============================================================
function populateFilters() {
  const catSel = document.getElementById("filterCategory");
  catSel.innerHTML = '<option value="">ทุกหมวดหมู่</option>';
  categories.forEach((c) =>
    catSel.insertAdjacentHTML(
      "beforeend",
      `<option value="${c.category_id}">${c.category_name}</option>`,
    ),
  );

  const whSel = document.getElementById("filterWarehouse");
  whSel.innerHTML = '<option value="">ทุกคลัง</option>';
  warehouses.forEach((w) =>
    whSel.insertAdjacentHTML(
      "beforeend",
      `<option value="${w.warehouse_id}">${w.warehouse_name}</option>`,
    ),
  );
}

function filterTable() {
  const search = document.getElementById("searchInput").value.toLowerCase();
  const catId = document.getElementById("filterCategory").value;
  const whId = document.getElementById("filterWarehouse").value;
  const status = document.getElementById("filterStatus").value;
  let filtered = allProducts.filter((p) => {
    const matchSearch =
      !search ||
      p.product_name.toLowerCase().includes(search) ||
      p.product_code.toLowerCase().includes(search);
    const matchCat = !catId || String(p.category_id) === catId;
    const stock = getTotalStock(p.product_id, whId ? parseInt(whId) : null);
    const matchStatus =
      !status ||
      (status === "ok" && stock > (p.reorder_point || 0)) ||
      (status === "low" && stock > 0 && stock <= (p.reorder_point || 0)) ||
      (status === "out" && stock === 0);
    return matchSearch && matchCat && matchStatus;
  });
  renderTable(filtered);
}

function sortTable(key) {
  if (sortKey === key) sortAsc = !sortAsc;
  else {
    sortKey = key;
    sortAsc = true;
  }
  filterTable();
}

function renderTable(products) {
  const sorted = [...products].sort((a, b) => {
    let av = a[sortKey] || "",
      bv = b[sortKey] || "";
    if (typeof av === "string") av = av.toLowerCase();
    if (typeof bv === "string") bv = bv.toLowerCase();
    return sortAsc ? (av > bv ? 1 : -1) : av < bv ? 1 : -1;
  });
  const tbody = document.getElementById("tableBody");
  document.getElementById("tableCount").textContent = `${sorted.length} รายการ`;
  if (!sorted.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-text">ไม่พบสินค้า</div></div></td></tr>`;
    return;
  }
  tbody.innerHTML = sorted
    .map((p) => {
      const totalStock = getTotalStock(p.product_id);
      const cat = categories.find((c) => c.category_id === p.category_id);
      const { cls, label } = getStockStatus(p, totalStock);

      // หารูปแรกของสินค้า (sort_order ต่ำสุด)
      const img = productImages.find((i) => i.product_id === p.product_id);
      const imgCell = img
        ? `<div class="prod-img-wrap">
             <img src="${img.url}" alt="${p.product_name}"
               onerror="this.parentElement.innerHTML='<span class=\\'prod-img-placeholder\\'>📦</span>'">
           </div>`
        : `<div class="prod-img-wrap">
             <span class="prod-img-placeholder">📦</span>
           </div>`;

      return `<tr>

<td style="text-align:center"
 onclick="event.stopPropagation();openLightbox(${p.product_id})">
 ${imgCell}
</td>

<td onclick="selectProduct(${p.product_id})">
 <div class="prod-name">${p.product_name}</div>
 <div class="prod-category">${p.product_code || "—"}</div>
</td>

<td onclick="selectProduct(${p.product_id})">
 ${cat?.category_name || "—"}
</td>

<td onclick="selectProduct(${p.product_id})">
 <span style="font-family:'IBM Plex Mono',monospace">
   ฿${formatNum(p.sale_price)}
 </span>
</td>

<td style="text-align:center">
<label class="switch">
  <input type="checkbox"
    ${p.is_active ? "checked" : ""}
    onchange="toggleProductActive(${p.product_id}, this)">
  <span class="slider"></span>
</label>
</td>

<td style="text-align:center">
 <button class="btn-icon"
   onclick="event.stopPropagation();window.location.href='product_form.html?id=${p.product_id}'">
   ✏️
 </button>
</td>

<td style="text-align:center">
  <button class="btn-icon danger"
    onclick="event.stopPropagation();deleteProduct(${p.product_id})">
    🗑
  </button>
</td>

</tr>`;
    })
    .join("");
}

function getTotalStock(productId, warehouseId = null) {
  return stockBalance
    .filter(
      (s) =>
        s.product_id === productId &&
        (warehouseId === null || s.warehouse_id === warehouseId),
    )
    .reduce((sum, s) => sum + (s.qty_available || 0), 0);
}

function getStockStatus(product, qty) {
  if (qty <= 0) return { cls: "stock-out", label: "🚨 หมด" };
  if (qty <= (product.reorder_point || 0))
    return { cls: "stock-low", label: "⚠️ ต่ำ" };
  return { cls: "stock-ok", label: "✅ ปกติ" };
}

function updateStats() {
  let ok = 0,
    low = 0,
    out = 0;
  allProducts.forEach((p) => {
    const qty = getTotalStock(p.product_id);
    if (qty <= 0) out++;
    else if (qty <= (p.reorder_point || 0)) low++;
    else ok++;
  });
  const statTotal = document.getElementById("statTotal");
  const statOk = document.getElementById("statOk");
  const statLow = document.getElementById("statLow");
  const statOut = document.getElementById("statOut");

  if (statTotal) statTotal.textContent = allProducts.length;
  if (statOk) statOk.textContent = ok;
  if (statLow) statLow.textContent = low;
  if (statOut) statOut.textContent = out;
}

// ============================================================
// SIDE PANEL
// ============================================================
async function selectProduct(productId) {
  selectedProduct = allProducts.find((p) => p.product_id === productId);
  if (!selectedProduct) return;
  document
    .querySelectorAll(".data-table tr")
    .forEach((tr) => tr.classList.remove("selected"));
  event.currentTarget.classList.add("selected");
  const cat = categories.find(
    (c) => c.category_id === selectedProduct.category_id,
  );
  document.getElementById("panelCode").textContent =
    selectedProduct.product_code;
  document.getElementById("panelName").textContent =
    selectedProduct.product_name;
  document.getElementById("panelCategory").textContent =
    cat?.category_name || "ไม่มีหมวดหมู่";
  document.getElementById("panelBaseUnit").textContent =
    selectedProduct.base_unit || "—";
  document.getElementById("panelReorder").textContent =
    selectedProduct.reorder_point || "0";
  document.getElementById("panelCost").textContent =
    "฿" + formatNum(selectedProduct.cost_price);
  document.getElementById("panelSale").textContent =
    "฿" + formatNum(selectedProduct.sale_price);
  const prodUnits = units.filter((u) => u.product_id === productId);
  document.getElementById("panelUnits").innerHTML = prodUnits.length
    ? prodUnits
        .map(
          (u) =>
            `<span class="unit-badge">${u.unit_name}${u.conversion_qty > 1 ? ` = ${u.conversion_qty} ${selectedProduct.base_unit}` : ""}</span>`,
        )
        .join("")
    : '<span style="color:var(--text3);font-size:12px">ไม่มีหน่วยพิเศษ</span>';
  // แสดงรูปภาพใน side panel
  const panelImgWrap = document.getElementById("panelImgWrap");
  if (panelImgWrap) {
    const img = productImages.find((i) => i.product_id === productId);
    if (img) {
      panelImgWrap.innerHTML = `<img src="${img.url}" alt="${selectedProduct.product_name}"
        onerror="this.parentElement.innerHTML='<span class='panel-img-placeholder'>📦</span>'">`;
    } else {
      panelImgWrap.innerHTML = '<span class="panel-img-placeholder">📦</span>';
    }
  }

  renderStockByWarehouse(productId);
  await loadHistory(productId);
  document.getElementById("sidePanel").classList.add("open");
  switchTabById("info");
}

function renderStockByWarehouse(productId) {
  let html =
    '<table class="stock-table"><thead><tr><th>คลัง</th><th>คงมือ</th><th>จอง</th><th>พร้อมจ่าย</th></tr></thead><tbody>';
  warehouses.forEach((wh) => {
    const s = stockBalance.find(
      (b) => b.product_id === productId && b.warehouse_id === wh.warehouse_id,
    );
    const onHand = s?.qty_on_hand || 0;
    const reserved = s?.qty_reserved || 0;
    const avail = s?.qty_available || 0;
    const cls =
      avail <= 0
        ? "qty-zero"
        : avail <= (selectedProduct?.reorder_point || 0)
          ? "qty-low"
          : "qty-ok";
    html += `<tr>
      <td><span class="wh-name">🏭 ${wh.warehouse_name}</span></td>
      <td><span class="qty-value">${onHand.toLocaleString()}</span></td>
      <td><span class="qty-value" style="color:var(--text3)">${reserved.toLocaleString()}</span></td>
      <td><span class="qty-value ${cls}">${avail.toLocaleString()}</span></td>
    </tr>`;
  });
  html += "</tbody></table>";
  document.getElementById("stockByWarehouse").innerHTML = html;
}

async function loadHistory(productId) {
  document.getElementById("historyList").innerHTML =
    '<div style="padding:20px;text-align:center;color:var(--text3)">กำลังโหลด...</div>';
  try {
    const movements = await supabaseFetch("stock_movements", {
      query: `?product_id=eq.${productId}&order=moved_at.desc&limit=20`,
    });
    const typeMap = {
      IN: { icon: "📥", cls: "dot-in", label: "รับเข้า", sign: "+" },
      OUT: { icon: "📤", cls: "dot-out", label: "จ่ายออก", sign: "-" },
      ADJUST: { icon: "⚖️", cls: "dot-adj", label: "ปรับ", sign: "±" },
      INTERNAL: { icon: "📋", cls: "dot-out", label: "โอนภายใน", sign: "-" },
      RETURN: { icon: "↩", cls: "dot-in", label: "คืนสินค้า", sign: "+" },
    };
    if (!movements?.length) {
      document.getElementById("historyList").innerHTML =
        '<div class="empty-state" style="padding:30px 0"><div class="empty-icon">📜</div><div class="empty-text">ยังไม่มีประวัติ</div></div>';
      return;
    }
    document.getElementById("historyList").innerHTML = movements
      .map((m) => {
        const t = typeMap[m.movement_type] || {
          icon: "❓",
          cls: "dot-adj",
          label: m.movement_type,
          sign: "",
        };
        const wh = warehouses.find((w) => w.warehouse_id === m.warehouse_id);
        const date = new Date(m.moved_at).toLocaleDateString("th-TH", {
          day: "numeric",
          month: "short",
          year: "2-digit",
        });
        return `<div class="hist-item">
        <div class="hist-dot ${t.cls}">${t.icon}</div>
        <div class="hist-body">
          <div class="hist-type">${t.label}</div>
          <div class="hist-ref">${m.ref_doc_id ? "#" + m.ref_doc_id : "—"} · ${wh?.warehouse_name || "—"}</div>
          <div class="hist-date">${date}</div>
        </div>
        <div class="hist-qty" style="color:${["IN", "RETURN"].includes(m.movement_type) ? "var(--success)" : "var(--danger)"}">${t.sign}${Math.abs(m.qty).toLocaleString()}</div>
      </div>`;
      })
      .join("");
  } catch (e) {
    document.getElementById("historyList").innerHTML =
      '<div class="empty-state" style="padding:20px 0"><div class="empty-text" style="color:var(--danger)">โหลดไม่ได้</div></div>';
  }
}

function closePanel() {
  document.getElementById("sidePanel").classList.remove("open");
  document
    .querySelectorAll(".data-table tr")
    .forEach((tr) => tr.classList.remove("selected"));
  selectedProduct = null;
}

function switchTab(name, btn) {
  document
    .querySelectorAll(".panel-tab")
    .forEach((t) => t.classList.remove("active"));
  document
    .querySelectorAll(".panel-tab-content")
    .forEach((t) => t.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById("tab-" + name).classList.add("active");
}

function switchTabById(name) {
  document
    .querySelectorAll(".panel-tab")
    .forEach((t) => t.classList.remove("active"));
  document
    .querySelectorAll(".panel-tab-content")
    .forEach((t) => t.classList.remove("active"));
  const tabs = document.querySelectorAll(".panel-tab");
  const idx = ["info", "stock", "history"].indexOf(name);
  if (tabs[idx]) tabs[idx].classList.add("active");
  document.getElementById("tab-" + name)?.classList.add("active");
}

// ============================================================
// MODAL & SKU BUILDER
// ============================================================
function onCategoryChange() {
  const catId = parseInt(document.getElementById("fCategory").value);
  const skuWrap = document.getElementById("skuBuilderWrap");
  const skuPh = document.getElementById("skuPlaceholder");
  const prodPh = document.getElementById("prodFieldsPlaceholder");
  const prodCnt = document.getElementById("prodFieldsContent");
  const btnSave = document.getElementById("btnSave");
  const badge = document.getElementById("modalSkuBadge");
  if (!catId) {
    skuWrap.style.display = "none";
    skuPh.style.display = "flex";
    prodPh.style.display = "flex";
    prodCnt.style.display = "none";
    btnSave.style.display = "none";
    badge.style.display = "none";
    return;
  }
  const cat = categories.find((c) => c.category_id === catId);
  buildSkuBuilder(cat);
  skuWrap.style.display = "block";
  skuPh.style.display = "none";
  prodPh.style.display = "none";
  prodCnt.style.display = "flex";
  prodCnt.style.flexDirection = "column";
  btnSave.style.display = "inline-flex";
}

function buildSkuBuilder(cat) {
  const lbl = cat?.sku_labels || {};
  const prefix =
    lbl.prefix || cat?.category_name?.substring(0, 3).toUpperCase() || "PRD";
  const catProds = allProducts.filter(
    (p) => p.category_id === cat?.category_id,
  );
  function extractPart(idx) {
    const vals = new Set();
    catProds.forEach((p) => {
      const parts = (p.product_code || "").split("-");
      if (parts[idx]) vals.add(parts[idx].trim());
    });
    return [...vals].filter(Boolean).sort();
  }
  skuOptions.f2 = extractPart(1);
  skuOptions.f3 = extractPart(2);
  skuOptions.f4 = extractPart(3);
  const seq = autoSeq(cat.category_id, prefix);
  document.getElementById("skuColsGrid").innerHTML = `
    <div>
      <div style="font-size:10px;font-weight:700;color:var(--text3);letter-spacing:.5px;margin-bottom:4px;">ช่อง 1 — PREFIX (คงที่)</div>
      <input id="sku_f1" class="form-control" value="${prefix}" readonly style="font-family:monospace;text-align:center;font-weight:700;background:var(--surface2);">
    </div>
    <div>
      <div style="font-size:10px;font-weight:700;color:var(--text3);letter-spacing:.5px;margin-bottom:4px;">ช่อง 2 — ${lbl.l2 || "ช่อง 2"}</div>
      <input id="sku_f2" class="form-control" placeholder="พิมพ์หรือเลือก" list="lst_f2" style="font-family:monospace;text-transform:uppercase;text-align:center;" oninput="this.value=this.value.toUpperCase();updateSkuFinalPreview()">
      <datalist id="lst_f2">${skuOptions.f2.map((v) => `<option value="${v}">`).join("")}</datalist>
    </div>
    <div>
      <div style="font-size:10px;font-weight:700;color:var(--text3);letter-spacing:.5px;margin-bottom:4px;">ช่อง 3 — ${lbl.l3 || "ช่อง 3"}</div>
      <input id="sku_f3" class="form-control" placeholder="พิมพ์หรือเลือก" list="lst_f3" style="font-family:monospace;text-transform:uppercase;text-align:center;" oninput="this.value=this.value.toUpperCase();updateSkuFinalPreview()">
      <datalist id="lst_f3">${skuOptions.f3.map((v) => `<option value="${v}">`).join("")}</datalist>
    </div>
    <div>
      <div style="font-size:10px;font-weight:700;color:var(--text3);letter-spacing:.5px;margin-bottom:4px;">ช่อง 4 — ${lbl.l4 || "ช่อง 4"}</div>
      <input id="sku_f4" class="form-control" placeholder="พิมพ์หรือเลือก" list="lst_f4" style="font-family:monospace;text-transform:uppercase;text-align:center;" oninput="this.value=this.value.toUpperCase();updateSkuFinalPreview()">
      <datalist id="lst_f4">${skuOptions.f4.map((v) => `<option value="${v}">`).join("")}</datalist>
    </div>
    <div>
      <div style="font-size:10px;font-weight:700;color:var(--text3);letter-spacing:.5px;margin-bottom:4px;">ช่อง 5 — ลำดับ</div>
      <input id="sku_f5" class="form-control" value="${seq}" style="font-family:monospace;font-size:14px;font-weight:700;text-align:center;background:var(--surface2);" oninput="updateSkuFinalPreview()">
    </div>`;
  const badge = document.getElementById("modalSkuBadge");
  if (badge) {
    badge.style.display = "inline-flex";
    badge.textContent = `${cat?.icon || ""} ${cat?.category_name || ""}`;
  }
  updateSkuFinalPreview();
}

function autoSeq(catId, prefix) {
  const count = allProducts.filter((p) => p.category_id === catId).length;
  return String(count + 1).padStart(3, "0");
}

function updateSkuFinalPreview() {
  const parts = ["f1", "f2", "f3", "f4", "f5"].map((k) => {
    const el = document.getElementById("sku_" + k);
    return el ? (el.value || "?").toUpperCase() : "?";
  });
  const sku = parts.join("-");
  document.getElementById("skuFinalPreview").textContent = sku;
  const editId = document.getElementById("editProductId").value;
  const isDup = allProducts.some(
    (p) => p.product_code === sku && String(p.product_id) !== editId,
  );
  document.getElementById("skuDupWarn").style.display = isDup
    ? "block"
    : "none";
}

function openModal(editData = null) {
  document.getElementById("modalTitle").textContent = editData
    ? "แก้ไขสินค้า"
    : "เพิ่มสินค้าใหม่";
  document.getElementById("editProductId").value = editData?.product_id || "";
  document.getElementById("skuBuilderWrap").style.display = "none";
  document.getElementById("skuPlaceholder").style.display = "flex";
  document.getElementById("prodFieldsPlaceholder").style.display = "flex";
  document.getElementById("prodFieldsContent").style.display = "none";
  document.getElementById("btnSave").style.display = "none";
  document.getElementById("modalSkuBadge").style.display = "none";
  document.getElementById("skuColsGrid").innerHTML = "";
  const fCat = document.getElementById("fCategory");
  fCat.innerHTML = '<option value="">— เลือกหมวดหมู่ก่อน —</option>';
  categories.forEach((c) =>
    fCat.insertAdjacentHTML(
      "beforeend",
      `<option value="${c.category_id}">${c.icon || ""} ${c.category_name}</option>`,
    ),
  );
  if (editData) {
    fCat.value = editData.category_id || "";
    onCategoryChange();
    const parts = (editData.product_code || "").split("-");
    ["f2", "f3", "f4", "f5"].forEach((f, i) => {
      const el = document.getElementById("sku_" + f);
      if (el) el.value = parts[i + 1] || "";
    });
    updateSkuFinalPreview();
    document.getElementById("fName").value = editData.product_name || "";
    document.getElementById("fBaseUnit").value = editData.base_unit || "";
    document.getElementById("fReorder").value = editData.reorder_point || "";
    document.getElementById("fCost").value = editData.cost_price || "";
    document.getElementById("fSale").value = editData.sale_price || "";
    document.getElementById("unitsContainer").innerHTML = "";
    unitRowCount = 0;
    units
      .filter((u) => u.product_id === editData.product_id)
      .forEach((u) => addUnitRow(u));
    if (unitRowCount === 0)
      addUnitRow({
        unit_name: editData.base_unit || "",
        conversion_qty: 1,
        is_base_unit: true,
      });
  } else {
    ["fName", "fBaseUnit", "fReorder", "fCost", "fSale"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    document.getElementById("unitsContainer").innerHTML = "";
    unitRowCount = 0;
    addUnitRow({ unit_name: "", conversion_qty: 1, is_base_unit: true });
  }
  document.getElementById("modalOverlay").classList.add("open");
}

function editSelectedProduct() {
  if (!selectedProduct) return;
  window.location.href = `product_form.html?id=${selectedProduct.product_id}`;
}

function closeModal() {
  document.getElementById("modalOverlay").classList.remove("open");
}
function closeModalOnBg(e) {
  if (e.target === document.getElementById("modalOverlay")) closeModal();
}

function addUnitRow(data = {}) {
  unitRowCount++;
  const id = unitRowCount;
  const div = document.createElement("div");
  div.id = `unit-row-${id}`;
  div.style.cssText =
    "display:flex;gap:8px;align-items:center;margin-bottom:8px";
  div.innerHTML = `
    <input class="form-control" placeholder="ชื่อหน่วย เช่น กล่อง" value="${data.unit_name || ""}" id="uname-${id}" style="flex:2">
    <input class="form-control" placeholder="= ? ชิ้น" type="number" min="1" value="${data.conversion_qty || 1}" id="uconv-${id}" style="flex:1;text-align:right">
    <label style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--text2);flex-shrink:0;cursor:pointer">
      <input type="checkbox" id="ubase-${id}" ${data.is_base_unit ? "checked" : ""}> หน่วยหลัก
    </label>
    <button onclick="document.getElementById('unit-row-${id}').remove()" style="width:28px;height:28px;border:none;background:var(--bg);border-radius:6px;cursor:pointer;color:var(--text3);font-size:14px;flex-shrink:0">✕</button>`;
  document.getElementById("unitsContainer").appendChild(div);
}

async function saveProduct() {
  const code = document.getElementById("skuFinalPreview")?.textContent?.trim();
  const name = document.getElementById("fName").value.trim();
  const baseUnit = document.getElementById("fBaseUnit").value.trim();
  const catVal = document.getElementById("fCategory").value;
  if (!catVal) {
    showToast("กรุณาเลือกหมวดหมู่", "error");
    return;
  }
  if (!code || code.includes("?")) {
    showToast("กรุณากรอกรหัสสินค้าให้ครบ", "error");
    return;
  }
  if (!name) {
    showToast("กรุณากรอกชื่อสินค้า", "error");
    return;
  }
  if (!baseUnit) {
    showToast("กรุณากรอกหน่วยฐาน", "error");
    return;
  }
  const editId = document.getElementById("editProductId").value;
  if (
    allProducts.some(
      (p) => p.product_code === code && String(p.product_id) !== editId,
    )
  ) {
    showToast("รหัสสินค้าซ้ำกับที่มีอยู่แล้ว!", "error");
    return;
  }
  SUPABASE_URL = localStorage.getItem("sb_url") || "";
  SUPABASE_KEY = localStorage.getItem("sb_key") || "";
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    showToast("กรุณาเชื่อมต่อ Supabase ก่อน", "warning");
    return;
  }
  const payload = {
    product_code: code,
    product_name: name,
    category_id: catVal ? parseInt(catVal) : null,
    base_unit: baseUnit,
    reorder_point: parseFloat(document.getElementById("fReorder").value) || 0,
    cost_price: parseFloat(document.getElementById("fCost").value) || 0,
    sale_price: parseFloat(document.getElementById("fSale").value) || 0,
  };
  showLoading(true);
  try {
    let productId;
    if (editId) {
      await supabaseFetch("products", {
        method: "PATCH",
        body: payload,
        query: `?product_id=eq.${editId}`,
      });
      productId = parseInt(editId);
      showToast("✅ แก้ไขสินค้าสำเร็จ!", "success");
    } else {
      const res = await supabaseFetch("products", {
        method: "POST",
        body: payload,
      });
      productId = res[0].product_id;
      showToast("✅ เพิ่มสินค้าสำเร็จ!", "success");
    }
    if (productId) {
      await supabaseFetch("product_units", {
        method: "DELETE",
        query: `?product_id=eq.${productId}`,
      }).catch(() => {});
      const unitDivs = document
        .getElementById("unitsContainer")
        .querySelectorAll('[id^="unit-row-"]');
      for (const div of unitDivs) {
        const rowId = div.id.replace("unit-row-", "");
        const uname = document.getElementById(`uname-${rowId}`)?.value.trim();
        const uconv =
          parseFloat(document.getElementById(`uconv-${rowId}`)?.value) || 1;
        const ubase =
          document.getElementById(`ubase-${rowId}`)?.checked || false;
        if (uname)
          await supabaseFetch("product_units", {
            method: "POST",
            body: {
              product_id: productId,
              unit_name: uname,
              conversion_qty: uconv,
              is_base_unit: ubase,
            },
          });
      }
    }
    closeModal();
    await loadData();
    if (productId) {
      const updated = allProducts.find((p) => p.product_id === productId);
      if (updated) selectProduct(productId);
    }
  } catch (e) {
    showToast("เกิดข้อผิดพลาด: " + e.message, "error");
  }
  showLoading(false);
}

async function deleteSelectedProduct() {
  if (!selectedProduct) return;
  const ok = await showConfirm(
    "ยืนยันการลบสินค้า",
    `ต้องการลบ "${selectedProduct.product_name}" ใช่หรือไม่? การดำเนินการนี้ไม่สามารถย้อนกลับได้`,
  );
  if (!ok) return;
  showLoading(true);
  try {
    await supabaseFetch("product_units", {
      method: "DELETE",
      query: `?product_id=eq.${selectedProduct.product_id}`,
    }).catch(() => {});
    await supabaseFetch("products", {
      method: "DELETE",
      query: `?product_id=eq.${selectedProduct.product_id}`,
    });
    showToast("🗑 ลบสินค้าแล้ว", "success");
    closePanel();
    await loadData();
  } catch (e) {
    showToast("ลบไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

// ============================================================
// UTILS
// ============================================================
function formatNum(n) {
  return parseFloat(n || 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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
  SUPABASE_URL = localStorage.getItem("sb_url") || "";
  SUPABASE_KEY = localStorage.getItem("sb_key") || "";
  if (SUPABASE_URL && SUPABASE_KEY) loadData();
});
function toggleProductSelection(productId, checkbox) {
  if (checkbox.checked) {
    selectedIds.add(productId);
  } else {
    selectedIds.delete(productId);
  }

  updateDeleteButton();
}

function toggleCheckAll(master) {
  const checkboxes = document.querySelectorAll(
    '#tableBody input[type="checkbox"]',
  );
  checkboxes.forEach((cb) => {
    cb.checked = master.checked;
    const id = parseInt(cb.getAttribute("onchange")?.match(/\d+/)?.[0]);
    if (master.checked) {
      selectedIds.add(id);
    } else {
      selectedIds.delete(id);
    }
  });

  updateDeleteButton();
}

function updateDeleteButton() {
  const btn = document.getElementById("btnDeleteSelected");
  btn.style.display = selectedIds.size > 0 ? "inline-flex" : "none";
}

async function deleteSelectedProducts() {
  if (!selectedIds.size) return;

  const ok = await showConfirm(
    "ยืนยันการลบหลายรายการ",
    `ต้องการลบ ${selectedIds.size} รายการใช่หรือไม่? การดำเนินการนี้ไม่สามารถย้อนกลับได้`,
  );
  if (!ok) return;

  try {
    for (let id of selectedIds) {
      await supabaseFetch("product_units", {
        method: "DELETE",
        query: `?product_id=eq.${id}`,
      }).catch(() => {});
      await supabaseFetch("products", {
        method: "DELETE",
        query: `?product_id=eq.${id}`,
      });
    }

    showToast("ลบสินค้าเรียบร้อยแล้ว", "success");
    selectedIds.clear();
    document.getElementById("checkAll").checked = false;
    await loadData();
  } catch (e) {
    showToast("ลบไม่สำเร็จ: " + e.message, "error");
  }
}

// ============================================================
// IMAGE LIGHTBOX
// ============================================================
var lbImages = [];
var lbIndex = 0;

function openLightbox(productId, startIndex) {
  startIndex = startIndex || 0;
  var prod = allProducts.find(function (p) {
    return p.product_id === productId;
  });
  var imgs = productImages
    .filter(function (i) {
      return i.product_id === productId;
    })
    .sort(function (a, b) {
      return (a.sort_order || 0) - (b.sort_order || 0);
    });
  if (!imgs.length) return;
  lbImages = imgs.map(function (i) {
    return { url: i.url, alt: prod ? prod.product_name : "" };
  });
  lbIndex = Math.min(startIndex, lbImages.length - 1);
  renderLightbox();
  document.getElementById("lightboxOverlay").classList.add("open");
  document.addEventListener("keydown", lightboxKeyHandler);
}

function closeLightbox() {
  document.getElementById("lightboxOverlay").classList.remove("open");
  document.removeEventListener("keydown", lightboxKeyHandler);
}

function closeLightboxOnBg(e) {
  if (e.target === document.getElementById("lightboxOverlay")) closeLightbox();
}

function lightboxKeyHandler(e) {
  if (e.key === "ArrowLeft") lightboxNav(-1);
  if (e.key === "ArrowRight") lightboxNav(1);
  if (e.key === "Escape") closeLightbox();
}

function lightboxNav(dir) {
  var next = (lbIndex + dir + lbImages.length) % lbImages.length;
  var img = document.getElementById("lightboxImg");
  img.classList.add("fading");
  setTimeout(function () {
    lbIndex = next;
    renderLightbox();
    img.classList.remove("fading");
  }, 140);
}

function lightboxGoTo(idx) {
  if (idx === lbIndex) return;
  lbIndex = idx;
  renderLightbox();
}

function renderLightbox() {
  var cur = lbImages[lbIndex];
  var img = document.getElementById("lightboxImg");
  img.src = cur.url;
  img.alt = cur.alt;
  document.getElementById("lightboxTitle").textContent = cur.alt;
  document.getElementById("lightboxCounter").textContent =
    lbImages.length > 1 ? lbIndex + 1 + " / " + lbImages.length : "";
  var prev = document.getElementById("lbPrev");
  var next = document.getElementById("lbNext");
  // loop mode: hide arrows only when there is 1 image
  if (lbImages.length <= 1) {
    prev.classList.add("hidden");
    next.classList.add("hidden");
  } else {
    prev.classList.remove("hidden");
    next.classList.remove("hidden");
  }
  var thumbWrap = document.getElementById("lightboxThumbs");
  if (lbImages.length > 1) {
    thumbWrap.innerHTML = lbImages
      .map(function (im, i) {
        return (
          '<div class="lightbox-thumb ' +
          (i === lbIndex ? "active" : "") +
          '" onclick="lightboxGoTo(' +
          i +
          ')">' +
          '<img src="' +
          im.url +
          '" alt="' +
          im.alt +
          '">' +
          "</div>"
        );
      })
      .join("");
  } else {
    thumbWrap.innerHTML = "";
  }
}
async function toggleProductActive(productId, el) {
  const isActive = el.checked;

  try {
    await supabaseFetch("products", {
      method: "PATCH",
      body: { is_active: isActive },
      query: `?product_id=eq.${productId}`,
    });

    showToast(
      isActive ? "เปิดใช้งานสินค้าแล้ว" : "ปิดใช้งานสินค้าแล้ว",
      "success",
    );
  } catch (e) {
    showToast("อัปเดตสถานะไม่สำเร็จ", "error");
    el.checked = !isActive;
  }
}
async function deleteProduct(productId) {
  const prod = allProducts.find((p) => p.product_id === productId);
  if (!prod) return;

  const ok = await showConfirm(
    "ยืนยันการลบสินค้า",
    `ต้องการลบ "${prod.product_name}" ใช่หรือไม่?`,
  );

  if (!ok) return;

  showLoading(true);

  try {
    await supabaseFetch("product_units", {
      method: "DELETE",
      query: `?product_id=eq.${productId}`,
    }).catch(() => {});

    await supabaseFetch("products", {
      method: "DELETE",
      query: `?product_id=eq.${productId}`,
    });

    showToast("ลบสินค้าแล้ว", "success");

    await loadData();
  } catch (e) {
    showToast("ลบสินค้าไม่ได้", "error");
  }

  showLoading(false);
}
