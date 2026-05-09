/* ============================================================
   products-table.js — Render table for Products module
   Hierarchical: parent + variant children (สินค้าชุด)
   ============================================================ */

export function renderProductsTable(
  products,
  categories,
  productImages,
  sortKey = "product_name",
  sortAsc = true,
  expandedParents = new Set(),
) {
  const tbody = document.getElementById("tableBody");
  const countEl = document.getElementById("tableCount");

  // ── group: parent (parent_product_id == null) + children
  const parents = products.filter((p) => !p.parent_product_id);
  const children = products.filter((p) => p.parent_product_id);
  const childrenByParent = {};
  children.forEach((c) => {
    (childrenByParent[c.parent_product_id] ||= []).push(c);
  });

  // orphans: child whose parent ถูก filter ออกแล้ว (ยังคงโชว์ไว้ ไม่ทิ้ง)
  const parentIds = new Set(parents.map((p) => p.product_id));
  const orphanChildren = children.filter(
    (c) => !parentIds.has(c.parent_product_id),
  );

  if (countEl) countEl.textContent = `${products.length} รายการ`;

  if (products.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-text">ไม่พบสินค้า</div></div></td></tr>`;
    return;
  }

  const sortedParents = sortRows(parents, sortKey, sortAsc);
  let html = "";

  sortedParents.forEach((p) => {
    const kids = sortRows(
      childrenByParent[p.product_id] || [],
      sortKey,
      sortAsc,
    );
    const isVariantParent = kids.length > 0;
    // default = collapsed · ขยายเฉพาะที่ user กดให้ขยาย
    const isCollapsed = isVariantParent && !expandedParents.has(p.product_id);
    html += renderRow(
      p,
      false,
      isVariantParent,
      kids,
      categories,
      productImages,
      null,
      isCollapsed,
    );
    kids.forEach((k) => {
      html += renderRow(
        k,
        true,
        false,
        null,
        categories,
        productImages,
        p,
        isCollapsed,
      );
    });
  });

  // orphan children — render flat
  if (orphanChildren.length) {
    sortRows(orphanChildren, sortKey, sortAsc).forEach((c) => {
      html += renderRow(c, false, false, null, categories, productImages);
    });
  }

  tbody.innerHTML = html;
}

function sortRows(rows, sortKey, sortAsc) {
  return [...rows].sort((a, b) => {
    let av = a[sortKey] ?? "";
    let bv = b[sortKey] ?? "";
    if (typeof av === "string") av = av.toLowerCase();
    if (typeof bv === "string") bv = bv.toLowerCase();
    if (av === bv) return 0;
    return sortAsc ? (av > bv ? 1 : -1) : av < bv ? 1 : -1;
  });
}

function renderRow(
  p,
  isChild,
  isVariantParent,
  kids,
  categories,
  productImages,
  parent = null,
  isCollapsed = false,
) {
  const cat = categories.find((c) => c.category_id === p.category_id);
  // child ไม่มีรูปของตัวเอง → ใช้รูปของ parent
  const img = isChild
    ? productImages.find((i) => i.product_id === (parent?.product_id || -1))
    : productImages.find((i) => i.product_id === p.product_id);

  const imgCell = isChild
    ? `<div class="prod-img-wrap" style="opacity:.55;width:32px;height:32px"><span class="prod-img-placeholder" style="font-size:14px">└</span></div>`
    : img
      ? `<div class="prod-img-wrap">
           <img src="${img.url}" alt="${escapeAttr(p.product_name)}"
             onerror="this.parentElement.innerHTML='<span class=\\'prod-img-placeholder\\'>📦</span>'">
         </div>`
      : `<div class="prod-img-wrap"><span class="prod-img-placeholder">📦</span></div>`;

  const variantBadge = isVariantParent
    ? `<span class="variant-badge">${kids.length} ตัวเลือก</span>`
    : "";

  const collapseBtn = isVariantParent
    ? `<button class="prod-collapse-btn${isCollapsed ? " collapsed" : ""}"
        data-parent="${p.product_id}"
        onclick="event.stopPropagation();window.toggleVariantGroup(${p.product_id})"
        title="ย่อ/ขยายตัวเลือก">▾</button>`
    : "";

  const nameCell = isChild
    ? `<div class="prod-name prod-name-child"><span class="prod-child-indent">└</span> ${escapeHtml(p.product_name)}</div>`
    : `<div class="prod-name">${collapseBtn}${escapeHtml(p.product_name)}${variantBadge}</div>`;

  // price: parent ของ variant แสดงเป็น range
  let costCell, saleCell;
  if (isVariantParent) {
    costCell = priceRangeCell(kids.map((k) => k.cost_price));
    saleCell = priceRangeCell(kids.map((k) => k.sale_price));
  } else {
    costCell = `<span style="font-family:'IBM Plex Mono',monospace">฿${formatNum(p.cost_price)}</span>`;
    saleCell = `<span style="font-family:'IBM Plex Mono',monospace">฿${formatNum(p.sale_price)}</span>`;
  }

  // status — parent toggle = cascade ไปทุก variant (handled in products-list.js)
  const statusCell = `<label class="switch" onclick="event.stopPropagation()">
    <input type="checkbox" ${p.is_active ? "checked" : ""}
      onchange="window.toggleProductActive(${p.product_id}, this)">
    <span class="slider"></span>
  </label>`;

  // ปิดแจ้งเตือนสินค้าหมด — parent toggle cascade ไปทุก variant
  const alertOffTitle = isVariantParent
    ? "เปิด = ปิดแจ้งเตือนทุกตัวเลือกในชุด"
    : "เปิด = ไม่แจ้งเตือนเมื่อสินค้าหมด/ใกล้หมด";
  const alertOffCell = `<label class="switch" onclick="event.stopPropagation()" title="${alertOffTitle}">
    <input type="checkbox" ${p.disable_stock_alert ? "checked" : ""}
      onchange="window.toggleStockAlertDisabled(${p.product_id}, this)">
    <span class="slider"></span>
  </label>`;

  // actions — variant child ไม่มีปุ่มแก้ไข (แก้ที่ parent), เหลือแค่ลบรายตัว
  const editLabel = isVariantParent ? "แก้ไขสินค้าชุด" : "แก้ไข";
  const deleteLabel = isVariantParent
    ? "ลบสินค้าชุด (ลบทุกตัวเลือก)"
    : isChild
      ? "ลบตัวเลือกนี้"
      : "ลบ";

  const editBtn = isChild
    ? ""
    : `<button class="btn-icon" title="${editLabel}"
      onclick="event.stopPropagation();window.openEditPanel(${p.product_id})">✏️</button>`;

  const actionsCell = `<div class="action-group">
    ${editBtn}
    <button class="btn-icon danger" title="${deleteLabel}"
      onclick="window.deleteProduct(${p.product_id})">🗑️</button>
  </div>`;

  const rowClass = isChild
    ? `prod-child-row${isCollapsed ? " row-collapsed" : ""}`
    : isVariantParent
      ? "prod-parent-row"
      : "";
  const childAttr =
    isChild && parent ? ` data-parent-id="${parent.product_id}"` : "";

  return `<tr class="${rowClass}"${childAttr}>
<td style="text-align:center">
  <input type="checkbox" class="row-check" value="${p.product_id}" onchange="window.updateDeleteButton()">
</td>
<td style="text-align:center" onclick="event.stopPropagation();window.openLightbox(${(parent || p).product_id})">
  ${imgCell}
</td>
<td>${nameCell}</td>
<td class="col-center">
  <div class="cat-badge" style="background:${cat?.color || "#eee"}20;"
    onclick="event.stopPropagation();window.openCategoryPicker(${p.product_id}, event)">
    <span class="cat-icon">${cat?.icon || "📦"}</span>
    <span>${cat?.category_name || "—"}</span>
  </div>
</td>
<td class="col-center">${costCell}</td>
<td class="col-center">${saleCell}</td>
<td style="text-align:center">${statusCell}</td>
<td style="text-align:center">${alertOffCell}</td>
<td style="text-align:center">${actionsCell}</td>
</tr>`;
}

function priceRangeCell(prices) {
  const valid = prices.filter((p) => p != null && p > 0);
  if (valid.length === 0)
    return `<span style="font-family:'IBM Plex Mono',monospace;color:var(--text3)">—</span>`;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  if (min === max)
    return `<span style="font-family:'IBM Plex Mono',monospace">฿${formatNum(min)}</span>`;
  return `<span style="font-family:'IBM Plex Mono',monospace;font-size:12px">฿${formatNum(min)} - ${formatNum(max)}</span>`;
}

function formatNum(n) {
  return parseFloat(n || 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[<>&"']/g, (c) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/`/g, "&#96;");
}
