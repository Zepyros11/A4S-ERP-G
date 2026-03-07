// CONFIG

const SB_URL = localStorage.getItem("sb_url") || "";
const SB_KEY = localStorage.getItem("sb_key") || "";

// STATE

let products = [];
let warehouses = [];
let stockBalance = [];

// SUPABASE REQUEST

async function sbFetch(table, q = "", opts = {}) {
  const { method = "GET", body } = opts;

  const res = await fetch(`${SB_URL}/rest/v1/${table}${q}`, {
    method,

    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
    },

    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  return res.json().catch(() => null);
}

// LOAD DATA

async function loadData() {
  showLoading(true);

  try {
    const [prods, whs, stocks, imgs] = await Promise.all([
      sbFetch("products", "?select=*&is_active=eq.true&order=product_name"),

      sbFetch("warehouses", "?select=*"),

      sbFetch("stock_balance", "?select=*"),

      sbFetch("product_images", "?select=*"),
    ]);

    products = prods || [];
    warehouses = whs || [];
    stockBalance = stocks || [];

    products = products.map((p) => {
      const img = imgs.find(
        (i) => i.product_id === p.product_id && i.sort_order === 0,
      );

      return {
        ...p,
        image_url: img?.url || "",
      };
    });

    renderTable(products);
  } catch (e) {
    showToast(e.message, "error");
  }

  showLoading(false);
}

// GET STOCK

function getStock(productId) {
  const row = stockBalance.find((s) => s.product_id === productId);

  return row?.qty_on_hand || 0;
}

// RENDER TABLE

function renderTable(list) {
  const tbody = document.getElementById("prodTableBody");

  if (!list.length) {
    tbody.innerHTML = `
<tr>
<td colspan="6" class="empty-state">
ไม่พบสินค้า
</td>
</tr>
`;

    return;
  }

  tbody.innerHTML = list
    .map((p) => {
      const qty = getStock(p.product_id);

      return `

<tr>

<td>

<div class="prod-img-wrap">

<img src="${p.image_url}"
class="prod-img"
onerror="this.parentElement.innerHTML='<span class=prod-img-placeholder>📦</span>'">

</div>

</td>

<td class="code-cell">
${p.product_code || "-"}
</td>

<td>
${p.product_name}
</td>

<td>
${warehouses[0]?.warehouse_code || "-"}
</td>

<td class="col-right mono">
${qty}
</td>

<td class="col-center">

<input
type="number"
class="form-control stock-set-input"
value="${qty}"
onchange="setStock(${p.product_id},this.value)"
>

</td>

</tr>

`;
    })
    .join("");
}

// SET STOCK

async function setStock(productId, qty) {
  qty = Number(qty);

  if (isNaN(qty) || qty < 0) {
    showToast("จำนวนไม่ถูกต้อง", "error");
    return;
  }

  const warehouse = warehouses[0];

  try {
    await sbFetch(
      "stock_balance",
      `?product_id=eq.${productId}&warehouse_id=eq.${warehouse.warehouse_id}`,
      {
        method: "PATCH",
        body: { qty_on_hand: qty },
      },
    );

    showToast("บันทึกสำเร็จ", "success");

    loadData();
  } catch (e) {
    showToast(e.message, "error");
  }
}

// FILTER

function filterTable() {
  const q = document.getElementById("searchInput").value.toLowerCase();

  const list = products.filter((p) =>
    `${p.product_code} ${p.product_name}`.toLowerCase().includes(q),
  );

  renderTable(list);
}

// UI HELPERS

function showToast(msg, type = "success") {
  const t = document.getElementById("toast");

  t.className = `toast toast-${type} show`;

  t.textContent = msg;

  setTimeout(() => t.classList.remove("show"), 3000);
}

function showLoading(show) {
  document.getElementById("loadingOverlay").classList.toggle("show", show);
}

// INIT

window.addEventListener("DOMContentLoaded", loadData);
