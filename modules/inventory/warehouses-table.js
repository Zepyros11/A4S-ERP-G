/* =====================================================
   warehouses-table.js
   Render Warehouse Table — Group: Country → Parent → Child
===================================================== */

/* types injected ผ่าน parameter — fallback ใช้ defaults
   เผื่อ table ถูก render ก่อน fetch (rare) */
const DEFAULT_TYPES = [
  { type_code: "MAIN",    type_name: "คลังหลัก",     icon: "🏣", color: "#0369a1" },
  { type_code: "BRANCH",  type_name: "คลังสาขา",     icon: "🏪", color: "#15803d" },
  { type_code: "TRANSIT", type_name: "จุดพักสินค้า", icon: "📦", color: "#c2410c" },
  { type_code: "RETURN",  type_name: "จุดคืนสินค้า", icon: "↩️", color: "#b91c1c" },
];

let _types = DEFAULT_TYPES;
const findType = (code) =>
  _types.find((t) => t.type_code === code) || { icon: "🏭", color: "#64748b", type_name: code };

export const whIcon = (w) => findType(w?.warehouse_type).icon;

export function renderWarehousesTable(warehouses, stock, countries, types) {
  if (Array.isArray(types) && types.length) _types = types;
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
    tbody.innerHTML = `<tr class="r-card-plain"><td colspan="6" style="text-align:center;padding:30px;color:var(--text3)">ไม่พบข้อมูล</td></tr>`;
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
<tr class="wh-country-row r-card-plain">
  <td colspan="6">
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
<tr class="wh-country-row wh-country-unknown r-card-plain">
  <td colspan="6">
    <span class="wh-country-label">🌍 ไม่ระบุประเทศ</span>
    <span class="wh-country-count">${withoutCountry.length} คลัง</span>
  </td>
</tr>`;
    withoutCountry.forEach((w) => {
      html += renderRow(w, false, stock);
    });
  }

  tbody.innerHTML = html;
  if (window.AuthZ) window.AuthZ.applyDomPerms(tbody);
}

function renderRow(w, isChild, stock) {
  const whStock = stock.filter((s) => s.warehouse_id === w.warehouse_id);
  const qty = whStock.reduce((sum, s) => sum + (s.qty_on_hand || 0), 0);
  const remainLabel =
    !w.is_active && qty > 0
      ? `<span class="stock-warning">มีสินค้าตกค้าง</span>`
      : "";

  const ic = whIcon(w);
  const nameCell = isChild
    ? `<span class="wh-child-indent">└</span> <strong>${w.warehouse_name}</strong>`
    : `<strong>${w.warehouse_name}</strong>`;

  return `
<tr class="${isChild ? "wh-child-row" : "wh-parent-row"}"
    onclick="openWarehouseStock(${w.warehouse_id},'${w.warehouse_name}','${ic}')">

  <td class="r-card-title">${nameCell}</td>

  <td class="col-center" data-label="ประเภท">
    ${(() => {
      const t = findType(w.warehouse_type);
      return `<span class="type-badge" style="background:${t.color}22;color:${t.color}">${t.icon} ${t.type_name}</span>`;
    })()}
  </td>

  <td class="col-center" data-label="ผู้ดูแล">
    <span class="manager-cell">
      <span class="manager-icon">👤</span>
      ${w.manager_name || "-"}
      <span class="manager-tooltip">
        📞 ${w.phone || "-"}
      </span>
    </span>
  </td>

  <td class="col-center" data-label="จำนวนสินค้า">${qty}</td>

  <td class="col-center" data-label="สถานะ">
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

  <td class="col-center" data-label="จัดการ">
    <button class="btn-icon" data-perm="warehouse_edit"
      onclick="event.stopPropagation();editWarehouse(${w.warehouse_id})">✏️</button>
    <button class="btn-icon danger" data-perm="warehouse_delete"
      onclick="event.stopPropagation();deleteWarehouse(${w.warehouse_id},'${w.warehouse_name}')">🗑️</button>
  </td>

</tr>`;
}
