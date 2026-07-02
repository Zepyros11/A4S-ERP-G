/* =====================================================
   categories-table.js
   Render Category Table
===================================================== */

export function renderCategoriesTable(categories, products) {
  const tbody = document.getElementById("catTableBody");
  if (!tbody) return;

  let html = "";

  categories.forEach((c) => {
    const count = products.filter(
      (p) => p.category_id === c.category_id,
    ).length;
    const color = c.color || "#0f4c75";
    const bg = color + "33";

    html += `
      <tr>

        <td class="r-card-corner" style="text-align:center">
          <input type="checkbox" class="row-check" value="${c.category_id}" onchange="window.updateDeleteButton()">
        </td>

        <td class="r-card-title">
          <div style="display:flex;align-items:center;gap:12px">
            <div class="cat-color" style="background:${bg};color:${color};border:1.5px solid ${color}">
              ${c.icon || "📦"}
            </div>
            <div>
              <div style="font-weight:700">${c.category_name}</div>
            </div>
          </div>
        </td>

        <td class="col-center" data-label="จำนวนสินค้า">
          <strong>${count}</strong>
        </td>

        <td class="col-center" data-label="จัดการ">
          <button class="btn-icon" data-perm="inv_cat_edit" onclick="editCategory(${c.category_id})">✏️</button>
          <button class="btn-icon danger" data-perm="inv_cat_delete" onclick="deleteCategory(${c.category_id},'${c.category_name}')">🗑️</button>
        </td>

      </tr>
    `;
  });

  if (!html) {
    html = `
      <tr class="r-card-plain">
        <td colspan="4" style="text-align:center;padding:40px;color:var(--text3)">
          ไม่พบข้อมูล
        </td>
      </tr>
    `;
  }

  tbody.innerHTML = html;
  if (window.AuthZ) window.AuthZ.applyDomPerms(tbody);
  document.getElementById("catCount").textContent =
    categories.length + " รายการ";
}
