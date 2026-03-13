let SUPABASE_URL = localStorage.getItem("sb_url") || "";
let SUPABASE_KEY = localStorage.getItem("sb_key") || "";
let allProducts = [];
let categories = [];
let warehouses = [];
let units = [];
let productImages = [];

const EP_IMG_MAX = 5;
let epImagesState = [];
let sortKey = "product_code",
  sortAsc = true;
let unitRowCount = 0;
let skuOptions = { f2: [], f3: [], f4: [] };

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
    const [prods, cats, whs, uts, imgs] = await Promise.all([
      supabaseFetch("products", { query: "?select=*&order=product_code" }),
      supabaseFetch("categories", { query: "?select=*" }),
      supabaseFetch("warehouses", { query: "?select=*" }),
      supabaseFetch("product_units", { query: "?select=*" }),
      supabaseFetch("product_images", {
        query: "?select=*&order=sort_order.asc",
      }),
    ]);
    allProducts = prods || [];
    categories = cats || [];
    units = uts || [];
    productImages = imgs || [];
    populateFilters();
    updateStatusCards();
    renderTable(allProducts);
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

  if (catSel) {
    catSel.innerHTML = '<option value="">⚪ ทุกหมวดหมู่</option>';

    categories.forEach((c) =>
      catSel.insertAdjacentHTML(
        "beforeend",
        `<option value="${c.category_id}">
          ${c.icon || ""} ${c.category_name}
        </option>`,
      ),
    );
  }
}

function sortTable(key) {
  if (sortKey === key) sortAsc = !sortAsc;
  else {
    sortKey = key;
    sortAsc = true;
  }
  filterTable();
}
function filterTable() {
  const search = document.getElementById("searchInput").value.toLowerCase();
  const catId = document.getElementById("filterCategory").value;
  const status = document.getElementById("filterStatus")?.value;

  let filtered = allProducts.filter((p) => {
    const matchSearch =
      !search ||
      (p.product_name || "").toLowerCase().includes(search) ||
      (p.product_code || "").toLowerCase().includes(search);

    const matchCat = !catId || String(p.category_id) === catId;

    const matchStatus = !status || String(p.is_active) === status;

    return matchSearch && matchCat && matchStatus;
  });

  renderTable(filtered);
}
function renderTable(products) {
  function getSkuSeq(code) {
    if (!code) return 9999;
    const parts = code.split("-");
    const n = parseInt(parts[parts.length - 1], 10);
    return isNaN(n) ? 9999 : n;
  }
  const sorted = [...products].sort((a, b) => {
    if (sortKey === "product_code") {
      const ac = (a.product_code || "").toUpperCase();
      const bc = (b.product_code || "").toUpperCase();
      // prefix = ทุก segment ยกเว้น size และ seq (2 ตัวสุดท้าย)
      const aParts = ac.split("-");
      const bParts = bc.split("-");
      const aPrefix = aParts.slice(0, -2).join("-");
      const bPrefix = bParts.slice(0, -2).join("-");
      const aSeq = getSkuSeq(ac);
      const bSeq = getSkuSeq(bc);
      // เรียง prefix ก่อน → ถ้า prefix เหมือนกันเรียงตาม seq
      if (aPrefix !== bPrefix) {
        return sortAsc
          ? aPrefix.localeCompare(bPrefix)
          : bPrefix.localeCompare(aPrefix);
      }
      return sortAsc ? aSeq - bSeq : bSeq - aSeq;
    }
    let av = a[sortKey] || "",
      bv = b[sortKey] || "";
    if (typeof av === "string") av = av.toLowerCase();
    if (typeof bv === "string") bv = bv.toLowerCase();
    return sortAsc ? (av > bv ? 1 : -1) : av < bv ? 1 : -1;
  });
  const tbody = document.getElementById("tableBody");
  document.getElementById("tableCount").textContent = `${sorted.length} รายการ`;
  if (!sorted.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-text">ไม่พบสินค้า</div></div></td></tr>`;
    return;
  }
  tbody.innerHTML = sorted
    .map((p) => {
      const cat = categories.find((c) => c.category_id === p.category_id);

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

<td style="text-align:center">
  <input type="checkbox"
    class="row-check"
    value="${p.product_id}"
    onchange="updateDeleteButton()">
</td>

<td style="text-align:center"
 onclick="event.stopPropagation();openLightbox(${p.product_id})">
 ${imgCell}
</td>

<td>
  <div class="prod-name">${p.product_name}</div>
  <div class="prod-category">${p.product_code || "—"}</div>
</td>

<td class="col-center">

<div class="cat-badge"
style="background:${cat?.color || "#eee"}20;"
onclick="event.stopPropagation();openCategoryPicker(${p.product_id}, event)"

  <span class="cat-icon">
    ${cat?.icon || "📦"}
  </span>

  <span>
    ${cat?.category_name || "—"}
  </span>

</div>

</td>

<td class="col-center">
 <span style="font-family:'IBM Plex Mono',monospace">
   ฿${formatNum(p.cost_price)}
 </span>
</td>

<td class="col-center">
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
  <div class="action-group">

    <button class="btn-icon"
      onclick="event.stopPropagation();openEditPanel(${p.product_id})">
      ✏️
    </button>

    <button class="btn-icon danger"
      onclick="event.stopPropagation();deleteProduct(${p.product_id})">
      🗑
    </button>

  </div>
</td>

</tr>`;
    })
    .join("");
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
  } catch (e) {
    showToast("เกิดข้อผิดพลาด: " + e.message, "error");
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
  const epUpload = document.getElementById("epUpload");

  if (epUpload) {
    epUpload.addEventListener("change", handleEpUpload);
  }
});

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
      return i.product_id === productId && i.url;
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
      .filter((im) => im.url)
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

    // ⭐ update local data ทันที
    const prod = allProducts.find((p) => p.product_id === productId);
    if (prod) {
      prod.is_active = isActive;
    }

    // ⭐ update cards
    updateStatusCards();

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

  openDeleteModal(
    `ต้องการลบสินค้า "${prod.product_name}" หรือไม่ ?`,
    async () => {
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
    },
  );
}
function updateStatusCards() {
  const total = allProducts.length;

  const active = allProducts.filter((p) => p.is_active).length;

  const inactive = total - active;

  document.getElementById("cardTotal").textContent = total;
  document.getElementById("cardActive").textContent = active;
  document.getElementById("cardInactive").textContent = inactive;
}
function openCategoryPicker(productId, event) {
  event.stopPropagation();

  const picker = document.getElementById("catPicker");

  picker.innerHTML = categories
    .map(
      (c) => `
    <div class="cat-picker-item"
      onclick="changeProductCategory(${productId}, ${c.category_id})">

      <span>${c.icon || "📦"}</span>
      <span>${c.category_name}</span>

    </div>
  `,
    )
    .join("");

  picker.style.display = "block";

  picker.style.top = event.pageY + "px";
  picker.style.left = event.pageX + "px";

  document.addEventListener("click", closeCategoryPicker);
}

function closeCategoryPicker(e) {
  const picker = document.getElementById("catPicker");

  if (!picker.contains(e.target)) {
    picker.style.display = "none";
    document.removeEventListener("click", closeCategoryPicker);
  }
}
async function changeProductCategory(productId, categoryId) {
  try {
    await supabaseFetch("products", {
      method: "PATCH",
      body: { category_id: categoryId },
      query: `?product_id=eq.${productId}`,
    });

    // ⭐ ปิด dropdown
    const picker = document.getElementById("catPicker");
    picker.style.display = "none";

    showToast("เปลี่ยนหมวดหมู่แล้ว", "success");

    await loadData();
  } catch (e) {
    showToast("เปลี่ยนหมวดหมู่ไม่สำเร็จ", "error");
  }
}
// =======================================
// BULK DELETE
// =======================================

function getSelectedProducts() {
  const checks = document.querySelectorAll(".row-check:checked");

  return Array.from(checks).map((c) => parseInt(c.value));
}

function updateDeleteButton() {
  const btn = document.getElementById("btnDeleteSelected");

  const selected = getSelectedProducts();

  btn.style.display = selected.length ? "inline-flex" : "none";
}

function toggleAllCheckbox(el) {
  const checks = document.querySelectorAll(".row-check");

  checks.forEach((c) => (c.checked = el.checked));

  updateDeleteButton();
}
async function deleteSelectedProducts() {
  const ids = getSelectedProducts();

  if (!ids.length) return;

  openDeleteModal(
    `ต้องการลบสินค้า ${ids.length} รายการ หรือไม่ ?`,
    async () => {
      showLoading(true);

      try {
        for (const id of ids) {
          await supabaseFetch("product_units", {
            method: "DELETE",
            query: `?product_id=eq.${id}`,
          }).catch(() => {});

          await supabaseFetch("products", {
            method: "DELETE",
            query: `?product_id=eq.${id}`,
          });
        }

        showToast("ลบสินค้าที่เลือกแล้ว", "success");

        await loadData();
      } catch (e) {
        showToast("ลบสินค้าไม่สำเร็จ", "error");
      }

      showLoading(false);
    },
  );
}
function openEditPanel(productId) {
  const p = allProducts.find((x) => x.product_id === productId);

  if (!p) return;

  // set data
  document.getElementById("epProductId").value = p.product_id;
  document.getElementById("epName").value = p.product_name || "";
  document.getElementById("epCost").value = p.cost_price || 0;
  document.getElementById("epSale").value = p.sale_price || 0;

  // reset image state
  epImagesState = [];

  // load images
  const imgs = productImages
    .filter((i) => i.product_id === productId)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));

  imgs.forEach((i) => {
    epImagesState.push(i.url);
  });

  // render slots
  renderEpImages();

  // open panel
  document.getElementById("editPanel").classList.add("open");
}
function closeEditPanel() {
  document.getElementById("editPanel").classList.remove("open");
}
async function saveEditPanel() {
  const id = document.getElementById("epProductId").value;
  const name = document.getElementById("epName").value;
  const cost = document.getElementById("epCost").value;
  const sale = document.getElementById("epSale").value;

  showLoading(true);
  try {
    // update product info
    await supabaseFetch("products", {
      method: "PATCH",
      body: { product_name: name, cost_price: cost, sale_price: sale },
      query: `?product_id=eq.${id}`,
    });

    // ลบรูปเก่าทั้งหมด
    await supabaseFetch("product_images", {
      method: "DELETE",
      query: `?product_id=eq.${id}`,
    }).catch(() => {});

    // วน upload ทีละ slot
    for (let idx = 0; idx < epImagesState.length; idx++) {
      const img = epImagesState[idx];
      if (!img) continue;

      // ถ้าเป็น URL เดิม (string) → re-insert โดยไม่ต้อง upload ใหม่
      if (typeof img === "string") {
        await supabaseFetch("product_images", {
          method: "POST",
          body: { product_id: id, url: img, sort_order: idx },
        }).catch((e) =>
          console.warn(`Re-insert slot ${idx} failed:`, e.message),
        );
        continue;
      }

      // ถ้าเป็น File ใหม่ → upload ไปที่ Storage
      try {
        const ext = img.name.split(".").pop().toLowerCase();
        const fileName = `${id}_${idx}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
        const uploadPath = `products/${fileName}`;

        const uploadRes = await fetch(
          `${SUPABASE_URL}/storage/v1/object/product-images/${uploadPath}`,
          {
            method: "POST",
            headers: {
              apikey: SUPABASE_KEY,
              Authorization: `Bearer ${SUPABASE_KEY}`,
              "Content-Type": img.type,
              "x-upsert": "true",
            },
            body: img,
          },
        );

        if (!uploadRes.ok) {
          const err = await uploadRes.json().catch(() => ({}));
          throw new Error(err.message || "Upload failed");
        }

        const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/product-images/${uploadPath}`;

        await supabaseFetch("product_images", {
          method: "POST",
          body: { product_id: id, url: publicUrl, sort_order: idx },
        });
      } catch (e) {
        console.warn(`Upload slot ${idx} failed:`, e.message);
        showToast(
          `⚠️ อัปโหลดรูป slot ${idx + 1} ไม่สำเร็จ: ${e.message}`,
          "error",
        );
      }
    }

    showToast("บันทึกแล้ว", "success");
    closeEditPanel();
    await loadData();
  } catch (e) {
    console.error(e);
    showToast("บันทึกไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

function handleEpUpload(e) {
  const files = Array.from(e.target.files);

  let index = parseInt(e.target.dataset.index || 0);

  files.forEach((file) => {
    if (epImagesState.length < EP_IMG_MAX) {
      epImagesState.splice(index, 0, file);

      index++;
    }
  });

  // limit 5
  epImagesState = epImagesState.slice(0, EP_IMG_MAX);

  renderEpImages();

  e.target.value = "";
}
function removeEpImage(index) {
  epImagesState.splice(index, 1);

  renderEpImages();
}
function renderEpImages() {
  for (let i = 0; i < EP_IMG_MAX; i++) {
    const slot = document.querySelector(`.ep-slot[data-index="${i}"]`);
    if (!slot) continue;

    const img = epImagesState[i];
    slot.onclick = null;

    if (img) {
      const url = typeof img === "string" ? img : URL.createObjectURL(img);
      slot.innerHTML = `
        <img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:6px;"
          onerror="this.parentElement.innerHTML='<div class=\\'ep-slot-plus\\'>📷</div>'">
        <button class="ep-slot-remove" onclick="removeEpImage(${i})">×</button>
      `;
    } else {
      slot.innerHTML = `<div class="ep-slot-plus">+</div>`;
      slot.onclick = () => {
        const upload = document.getElementById("epUpload");
        upload.dataset.index = i;
        upload.click();
      };
    }
  }
}
