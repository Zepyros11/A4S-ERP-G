/* ============================================================
   stock-initial-table.js — Table renderer for Stock Initial
   ============================================================ */

export function buildTableHeader(warehouses, activeWarehouseId) {
  const thead = document.getElementById("siThead");
  if (!thead) return;
  const wh = warehouses.find((w) => w.warehouse_id === activeWarehouseId);
  thead.innerHTML = `
  <tr>
    <th style="width:64px;text-align:center">ภาพ</th>
    <th onclick="window.sortTable('product_name')" style="cursor:pointer;width:30%">
      ชื่อสินค้า <span class="sort-icon" id="sort-product_name">⇅</span>
    </th>
    <th onclick="window.sortTable('category_name')" style="cursor:pointer;width:15%">
      หมวดหมู่ <span class="sort-icon" id="sort-category_name">⇅</span>
    </th>
    <th class="col-center" style="width:15%">
      <div class="si-wh-name">
        ${wh?.warehouse_icon || "🏭"} ${wh?.warehouse_name || ""}
      </div>
    </th>
  </tr>`;
}

export function renderTable({
  products,
  categories,
  productImages,
  initMap,
  originalValues,
  activeWarehouseId,
  currentSort,
  search,
  catId,
  status,
}) {
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
      if (currentSort.field === "category_name") {
        const x =
          categories.find((c) => c.category_id === a.category_id)
            ?.category_name || "";
        const y =
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
      const x = a[currentSort.field] || "";
      const y = b[currentSort.field] || "";
      return currentSort.dir === "asc" ? (x > y ? 1 : -1) : x < y ? 1 : -1;
    });
  }

  const countEl = document.getElementById("productCount");
  if (countEl) countEl.textContent = list.length + " รายการ";

  const tbody = document.getElementById("productTable");
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;padding:30px">ไม่พบข้อมูล</td></tr>`;
    return;
  }

  tbody.innerHTML = list
    .map((p) => {
      const cat = categories.find((c) => c.category_id === p.category_id);
      const key = `${p.product_id}-${activeWarehouseId}`;
      const val = initMap[key]?.qty || "";

      if (!(key in originalValues)) {
        originalValues[key] = val === "" ? "" : parseFloat(val);
      }

      const img = productImages.find((i) => i.product_id === p.product_id);
      const imgCell = img
        ? `<img src="${img.url}" style="width:48px;height:48px;object-fit:cover;border-radius:6px;cursor:pointer;"
             onclick="window.openImgPopup(${p.product_id})"
             onerror="this.parentElement.innerHTML='<span>📦</span>'">`
        : `<span style="font-size:24px">📦</span>`;

      return `
<tr class="si-data-row" id="row-${p.product_id}">
  <td style="text-align:center;cursor:pointer" onclick="window.openImgPopup(${p.product_id})">
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
  <td class="col-center si-input-cell">
    <input
      type="number"
      class="si-qty-input"
      id="inp-${p.product_id}-${activeWarehouseId}"
      value="${val}"
      min="0"
      placeholder="-"
      oninput="window.onAnyInput()"
    />
  </td>
</tr>`;
    })
    .join("");
}

export function buildWarehouseTabs(
  warehouses,
  activeCountry,
  activeParent,
  activeWarehouseId,
) {
  // Country
  const countries = [
    ...new Set(warehouses.map((w) => w.country).filter(Boolean)),
  ];
  const countryEl = document.getElementById("countryTabs");
  if (countryEl) {
    countryEl.innerHTML = countries
      .map(
        (c) =>
          `<option value="${c}" ${c === activeCountry ? "selected" : ""}>${c}</option>`,
      )
      .join("");
    countryEl.onchange = () => window.setCountry(countryEl.value);
  }

  // Parent
  const parents = warehouses.filter(
    (w) => !w.parent_id && w.country === activeCountry,
  );
  const parentEl = document.getElementById("parentTabs");
  if (parentEl) {
    parentEl.innerHTML = parents
      .map(
        (p) =>
          `<option value="${p.warehouse_id}" ${p.warehouse_id === activeParent ? "selected" : ""}>${p.warehouse_icon || "🏬"} ${p.warehouse_name}</option>`,
      )
      .join("");
    parentEl.onchange = () => window.setParent(parseInt(parentEl.value));
  }

  // Child
  const children = warehouses.filter((w) => w.parent_id === activeParent);
  const childEl = document.getElementById("childTabs");
  if (childEl) {
    childEl.innerHTML = children.length
      ? children
          .map(
            (c) =>
              `<option value="${c.warehouse_id}" ${c.warehouse_id === activeWarehouseId ? "selected" : ""}>${c.warehouse_icon || "🏠"} ${c.warehouse_name}</option>`,
          )
          .join("")
      : `<option value="">— ไม่มีคลังย่อย —</option>`;
    childEl.onchange = () => window.setWarehouse(parseInt(childEl.value));
  }
}
