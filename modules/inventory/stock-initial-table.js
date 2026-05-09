/* ============================================================
   stock-initial-table.js — Renderers for Stock Initial
   - renderProductList: product-centric list (1 row per parent/singleton)
   - renderMatrix: variants × warehouses inside modal
   ============================================================ */

const WH_TYPE_ICONS = {
  MAIN: "🏣",
  BRANCH: "🏪",
  TRANSIT: "📦",
  RETURN: "↩️",
};
const whIcon = (w) => WH_TYPE_ICONS[w?.warehouse_type] || "🏭";

// ════════════════════════════════════════════════════════════
// PRODUCT LIST (main page)
// ════════════════════════════════════════════════════════════
export function renderProductList({
  products,
  categories,
  productImages,
  warehouses,
  initMap,
  currentSort,
  search,
  fillStatus,
}) {
  // group: parent + children
  const parents = products.filter((p) => !p.parent_product_id);
  const childrenByParent = {};
  products
    .filter((p) => p.parent_product_id)
    .forEach((c) => {
      (childrenByParent[c.parent_product_id] ||= []).push(c);
    });

  // each row = parent (or singleton); compute fill summary
  const rows = parents.map((p) => {
    const kids = childrenByParent[p.product_id] || [];
    const skus = kids.length > 0 ? kids : [p];
    const totalCells = skus.length * warehouses.length;
    let setCells = 0;
    skus.forEach((sku) => {
      warehouses.forEach((w) => {
        if (initMap[`${sku.product_id}-${w.warehouse_id}`]) setCells++;
      });
    });
    const status =
      setCells === 0 ? "none" : setCells === totalCells ? "full" : "partial";
    return { p, kids, skuCount: skus.length, totalCells, setCells, status };
  });

  // filter
  const list = rows.filter((r) => {
    const q = (r.p.product_name || "").toLowerCase();
    if (search && !q.includes(search)) return false;
    if (fillStatus && r.status !== fillStatus) return false;
    return true;
  });

  // sort
  if (currentSort?.field) {
    const dir = currentSort.dir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      let av, bv;
      if (currentSort.field === "category_name") {
        av =
          categories.find((c) => c.category_id === a.p.category_id)
            ?.category_name || "";
        bv =
          categories.find((c) => c.category_id === b.p.category_id)
            ?.category_name || "";
      } else {
        av = a.p[currentSort.field] ?? "";
        bv = b.p[currentSort.field] ?? "";
      }
      if (typeof av === "string") av = av.toLowerCase();
      if (typeof bv === "string") bv = bv.toLowerCase();
      if (av === bv) return 0;
      return av > bv ? dir : -dir;
    });
  }

  const countEl = document.getElementById("productCount");
  if (countEl) countEl.textContent = `${list.length} ชุด`;

  const tbody = document.getElementById("productTable");
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text3)">ไม่พบข้อมูล</td></tr>`;
    return;
  }

  tbody.innerHTML = list
    .map(({ p, kids, skuCount, totalCells, setCells, status }) => {
      const cat = categories.find((c) => c.category_id === p.category_id);
      const img = productImages.find((i) => i.product_id === p.product_id);

      const imgCell = img
        ? `<img src="${img.url}" style="width:48px;height:48px;object-fit:cover;border-radius:6px;cursor:pointer;"
             onclick="event.stopPropagation();window.openImgPopup(${p.product_id})"
             onerror="this.parentElement.innerHTML='<span style=\\'font-size:24px\\'>📦</span>'">`
        : `<span style="font-size:24px">📦</span>`;

      const variantBadge =
        kids.length > 0
          ? `<span class="si-variant-badge">${kids.length} ตัวเลือก</span>`
          : "";

      const fillPill = renderFillPill(status, setCells, totalCells, skuCount);

      return `
<tr class="si-prod-row" onclick="window.openStockModal(${p.product_id})">
  <td style="text-align:center">${imgCell}</td>
  <td>
    <div class="si-prod-name">${escapeHtml(p.product_name)}${variantBadge}</div>
  </td>
  <td class="col-center">
    <div class="cat-badge" style="background:${cat?.color || "#eee"}20">
      <span class="cat-icon">${cat?.icon || "📦"}</span>
      <span>${cat?.category_name || "-"}</span>
    </div>
  </td>
  <td class="col-center">${fillPill}</td>
  <td class="col-center">
    <button class="si-set-btn" onclick="event.stopPropagation();window.openStockModal(${p.product_id})">
      ✏️ ตั้ง Stock
    </button>
  </td>
</tr>`;
    })
    .join("");
}

function renderFillPill(status, set, total, skuCount) {
  const pct = total === 0 ? 0 : Math.round((set / total) * 100);
  if (status === "full") {
    return `<span class="si-fill-pill si-fill-pill--full">
      ✅ ครบ ${total} ช่อง
    </span>`;
  }
  if (status === "partial") {
    return `<span class="si-fill-pill si-fill-pill--partial">
      🟡 ${set}/${total} ช่อง
      <span class="si-fill-bar"><span class="si-fill-bar-fg" style="width:${pct}%"></span></span>
    </span>`;
  }
  return `<span class="si-fill-pill si-fill-pill--none">
    ⏳ ยังไม่ตั้ง (${total} ช่อง)
  </span>`;
}

// ════════════════════════════════════════════════════════════
// MATRIX (inside modal): rows × warehouses
// ════════════════════════════════════════════════════════════
export function renderMatrix({ parent, rows, warehouses, initMap }) {
  const table = document.getElementById("simMatrix");
  if (!table) return;

  // group warehouses by country (ถ้ามีหลายประเทศ → แสดง country header row)
  const byCountry = {};
  const countryOrder = [];
  warehouses.forEach((w) => {
    const c = w.country || "—";
    if (!byCountry[c]) {
      byCountry[c] = [];
      countryOrder.push(c);
    }
    byCountry[c].push(w);
  });
  const multiCountry = countryOrder.length > 1;

  // จัดลำดับ warehouses ใหม่ตาม country group เพื่อให้ตรงกับ country header colspan
  const orderedWh = countryOrder.flatMap((c) => byCountry[c]);

  // ── HEAD ──
  let countryRow = "";
  if (multiCountry) {
    countryRow = `<tr class="sim-country-row">
      <th class="sim-th-variant"></th>
      ${countryOrder
        .map(
          (c) =>
            `<th class="sim-th-wh" colspan="${byCountry[c].length}">🌍 ${escapeHtml(c)}</th>`,
        )
        .join("")}
    </tr>`;
  }

  const whHeaderRow = `<tr>
    <th class="sim-th-variant">ตัวเลือก</th>
    ${orderedWh
      .map(
        (w) =>
          `<th class="sim-th-wh" title="${escapeAttr(w.warehouse_name)}">${whIcon(w)} ${escapeHtml(shortenWh(w.warehouse_name))}</th>`,
      )
      .join("")}
  </tr>`;

  // ── BODY (each variant or singleton) ──
  const bodyRows = rows
    .map((sku) => {
      const isVariant = !!sku.parent_product_id;
      const variantLabel = isVariant
        ? variantSubName(sku.product_name, parent.product_name)
        : sku.product_name;

      const cells = orderedWh
        .map((w) => {
          const key = `${sku.product_id}-${w.warehouse_id}`;
          const val = initMap[key]?.qty ?? "";
          const hasVal = val !== "" && val != null;
          return `<td>
          <input
            type="number"
            class="sim-qty-input${hasVal ? " has-value" : ""}"
            id="sim-inp-${key}"
            data-key="${key}"
            value="${val}"
            min="0"
            placeholder="—"
            oninput="window.onMatrixInput(this)"
          />
        </td>`;
        })
        .join("");

      return `<tr>
      <td class="sim-td-variant">
        <div class="sim-variant-name">${escapeHtml(variantLabel)}</div>
      </td>
      ${cells}
    </tr>`;
    })
    .join("");

  // ── FOOT (Σ row per warehouse) ──
  const sumCells = orderedWh
    .map((w) => {
      let sum = 0;
      let any = false;
      rows.forEach((sku) => {
        const v = initMap[`${sku.product_id}-${w.warehouse_id}`]?.qty;
        if (v != null && v !== "") {
          sum += parseFloat(v) || 0;
          any = true;
        }
      });
      return `<td id="sim-sum-${w.warehouse_id}">${any ? formatNum(sum) : "—"}</td>`;
    })
    .join("");
  const footRow = `<tr>
    <td class="sim-td-variant">Σ ผลรวมต่อคลัง</td>
    ${sumCells}
  </tr>`;

  table.innerHTML = `
    <thead>${countryRow}${whHeaderRow}</thead>
    <tbody>${bodyRows}</tbody>
    <tfoot>${footRow}</tfoot>
  `;
}

export function buildMatrixSubtitle(rows, warehouses) {
  return `${rows.length} ตัวเลือก × ${warehouses.length} คลัง · กรอกแล้วกด 💾 บันทึก`;
}

// ── Helpers ──────────────────────────────────────────────────
// "PO Director 6 เดือน ปกทอง (2XL)" → "2XL"  (ดึงเฉพาะส่วนที่ต่างจากชื่อ parent)
function variantSubName(childName, parentName) {
  const c = (childName || "").trim();
  const p = (parentName || "").trim();
  if (c.startsWith(p)) {
    const rest = c.slice(p.length).trim();
    // ตัดวงเล็บออกถ้ามี (XXL) → XXL
    const m = rest.match(/^\((.+)\)$/);
    return m ? m[1] : rest || c;
  }
  return c;
}

function shortenWh(name, max = 18) {
  if (!name) return "";
  return name.length <= max ? name : name.slice(0, max - 1) + "…";
}

function formatNum(n) {
  return parseFloat(n || 0).toLocaleString("th-TH", {
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
