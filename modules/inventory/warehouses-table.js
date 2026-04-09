/* =====================================================
   warehouses-table.js
   Render Warehouse Table — Group: Country → Parent → Child
===================================================== */

export const TYPE = {
  MAIN: { label: "🏣 คลังหลัก", color: "type-main" },
  BRANCH: { label: "🏪 คลังสาขา", color: "type-branch" },
  TRANSIT: { label: "📦 จุดพักสินค้า", color: "type-transit" },
  RETURN: { label: "↩️ จุดคืนสินค้า", color: "type-return" },
};

export function renderWarehousesTable(warehouses, stock, countries) {
  const search =
    document.getElementById("searchInput")?.value.toLowerCase() || "";
  const type = document.getElementById("filterType")?.value || "";
  const status = document.getElementById("filterStatus")?.value || "";

  const list = warehouses.filter((w) => {
    const q = (w.warehouse_name + " " + w.warehouse_code).toLowerCase();
    if (search && !q.includes(search)) return false;
    if (type && w.warehouse_type !== type) return false;
    if (status !== "" && String(w.is_active) !== status) return false;
    return true;
  });

  const tbody = document.getElementById("whTable");
  document.getElementById("whCount").textContent = list.length + " รายการ";

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text3)">ไม่พบข้อมูล</td></tr>`;
    return;
  }

  let html = "";

  const withCountry = list.filter((w) => w.country);
  const withoutCountry = list.filter((w) => !w.country);

  /* group by country */
  const countryGroups = {};
  withCountry.forEach((w) => {
    if (!countryGroups[w.country]) countryGroups[w.country] = [];
    countryGroups[w.country].push(w);
  });

  Object.entries(countryGroups).forEach(([code, whs]) => {
    const info = countries.find((c) => c.country_code === code);
    const name = info?.country_name || code;

    const parents = whs.filter((w) => !w.parent_id);
    const children = whs.filter((w) => w.parent_id);

    html += `
<tr class="wh-country-row">
  <td colspan="7">
    <span class="wh-country-label">🌍 ${name}</span>
    <span class="wh-country-count">${whs.length} คลัง</span>
  </td>
</tr>`;

    parents.forEach((w) => {
      html += renderRow(w, false, stock);
      children
        .filter((c) => c.parent_id === w.warehouse_id)
        .forEach((child) => {
          html += renderRow(child, true, stock);
        });
    });

    /* children ที่ parent ถูก filter ซ่อน */
    const renderedIds = children
      .filter((c) => parents.find((p) => p.warehouse_id === c.parent_id))
      .map((c) => c.warehouse_id);
    children
      .filter((c) => !renderedIds.includes(c.warehouse_id))
      .forEach((child) => {
        html += renderRow(child, true, stock);
      });
  });

  /* ไม่มีประเทศ */
  if (withoutCountry.length > 0) {
    html += `
<tr class="wh-country-row wh-country-unknown">
  <td colspan="7">
    <span class="wh-country-label">🌍 ไม่ระบุประเทศ</span>
    <span class="wh-country-count">${withoutCountry.length} คลัง</span>
  </td>
</tr>`;
    withoutCountry.forEach((w) => {
      html += renderRow(w, false, stock);
    });
  }

  tbody.innerHTML = html;
}

function renderRow(w, isChild, stock) {
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
    onclick="openWarehouseStock(${w.warehouse_id},'${w.warehouse_name}','${w.warehouse_icon || "🏭"}')">

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
        📞 ${w.phone || "-"}
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
    <button class="btn-icon"
      onclick="event.stopPropagation();editWarehouse(${w.warehouse_id})">✏️</button>
    <button class="btn-icon danger"
      onclick="event.stopPropagation();deleteWarehouse(${w.warehouse_id},'${w.warehouse_name}')">🗑️</button>
  </td>

</tr>`;
}
