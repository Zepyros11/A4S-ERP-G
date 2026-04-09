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
    const bg = color + "22";
    const lbl = c.sku_labels || {};

    const skuFmt = lbl.prefix
      ? `${lbl.prefix}-${(lbl.segments || [])
          .map((s) => `[${typeof s === "string" ? s : s.label}]`)
          .join("-")}-001`
      : "—";

    html += `
      <tr>

        <td>
          <div style="display:flex;align-items:center;gap:12px">
            <div class="cat-color" style="background:${bg};color:${color}">
              ${c.icon || "📦"}
            </div>
            <div>
              <div style="font-weight:700">${c.category_name}</div>
              ${
                c.description
                  ? `<div style="font-size:12px;color:var(--text3)">${c.description}</div>`
                  : ""
              }
            </div>
          </div>
        </td>

        <td class="col-center">
          <strong>${count}</strong>
        </td>

        <td class="col-center" style="font-family:monospace;font-size:12px">
          ${skuFmt}
        </td>

        <td class="col-center">
          <button class="btn-icon" onclick="editCategory(${c.category_id})">✏️</button>
          <button class="btn-icon danger" onclick="deleteCategory(${c.category_id},'${c.category_name}')">🗑️</button>
        </td>

      </tr>
    `;
  });

  if (!html) {
    html = `
      <tr>
        <td colspan="4" style="text-align:center;padding:40px;color:var(--text3)">
          ไม่พบข้อมูล
        </td>
      </tr>
    `;
  }

  tbody.innerHTML = html;
  document.getElementById("catCount").textContent =
    categories.length + " รายการ";
}
