/* ============================================================
   products-table.js — Render table for Products module
   ============================================================ */

export function renderProductsTable(
  products,
  categories,
  productImages,
  sortKey = "product_code",
  sortAsc = true,
) {
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
      const aParts = ac.split("-");
      const bParts = bc.split("-");
      const aPrefix = aParts.slice(0, -2).join("-");
      const bPrefix = bParts.slice(0, -2).join("-");
      const aSeq = getSkuSeq(ac);
      const bSeq = getSkuSeq(bc);
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
  const countEl = document.getElementById("tableCount");
  if (countEl) countEl.textContent = `${sorted.length} รายการ`;

  if (!sorted.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-text">ไม่พบสินค้า</div></div></td></tr>`;
    return;
  }

  tbody.innerHTML = sorted
    .map((p) => {
      const cat = categories.find((c) => c.category_id === p.category_id);
      const img = productImages.find((i) => i.product_id === p.product_id);

      const imgCell = img
        ? `<div class="prod-img-wrap">
           <img src="${img.url}" alt="${p.product_name}"
             onerror="this.parentElement.innerHTML='<span class=\\'prod-img-placeholder\\'>📦</span>'">
         </div>`
        : `<div class="prod-img-wrap"><span class="prod-img-placeholder">📦</span></div>`;

      return `<tr>
<td style="text-align:center">
  <input type="checkbox" class="row-check" value="${p.product_id}" onchange="window.updateDeleteButton()">
</td>
<td style="text-align:center" onclick="event.stopPropagation();window.openLightbox(${p.product_id})">
  ${imgCell}
</td>
<td>
  <div class="prod-name">${p.product_name}</div>
  <div class="prod-category">${p.product_code || "—"}</div>
</td>
<td class="col-center">
  <div class="cat-badge" style="background:${cat?.color || "#eee"}20;"
    onclick="event.stopPropagation();window.openCategoryPicker(${p.product_id}, event)">
    <span class="cat-icon">${cat?.icon || "📦"}</span>
    <span>${cat?.category_name || "—"}</span>
  </div>
</td>
<td class="col-center">
  <span style="font-family:'IBM Plex Mono',monospace">฿${formatNum(p.cost_price)}</span>
</td>
<td class="col-center">
  <span style="font-family:'IBM Plex Mono',monospace">฿${formatNum(p.sale_price)}</span>
</td>
<td style="text-align:center">
  <label class="switch">
    <input type="checkbox" ${p.is_active ? "checked" : ""}
      onchange="window.toggleProductActive(${p.product_id}, this)">
    <span class="slider"></span>
  </label>
</td>
<td style="text-align:center">
  <div class="action-group">
    <button class="btn-icon" onclick="event.stopPropagation();window.openEditPanel(${p.product_id})">✏️</button>
    <button class="btn-icon danger" onclick="deleteProduct(${p.product_id})">
  🗑️
</button>
</td>
</tr>`;
    })
    .join("");
}

function formatNum(n) {
  return parseFloat(n || 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
