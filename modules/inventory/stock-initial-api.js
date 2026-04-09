/* ============================================================
   stock-initial-api.js — API layer for Stock Initial module
   ============================================================ */

function getSB() {
  return {
    url: localStorage.getItem("sb_url") || "",
    key: localStorage.getItem("sb_key") || "",
  };
}

async function sbFetch(table, opts = {}) {
  const { url, key } = getSB();
  const { method = "GET", query = "", body } = opts;
  const res = await fetch(`${url}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  if (method === "DELETE") return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function fetchProducts() {
  return sbFetch("products", {
    query: "?select=*&is_active=eq.true&order=product_name.asc",
  });
}

export async function fetchWarehouses() {
  return sbFetch("warehouses", {
    query: "?select=*&is_active=eq.true&order=warehouse_code.asc",
  });
}

export async function fetchCategories() {
  return sbFetch("categories", { query: "?select=*&order=category_name.asc" });
}

export async function fetchProductImages() {
  return sbFetch("product_images", { query: "?select=*&order=sort_order.asc" });
}

export async function fetchStockInits() {
  return sbFetch("stock_movements", {
    query: "?movement_type=eq.INIT&select=*",
  });
}

export async function deleteStockInit(movementId) {
  return sbFetch("stock_movements", {
    method: "DELETE",
    query: `?movement_id=eq.${movementId}`,
  });
}

export async function createStockInit(productId, warehouseId, qty, note = "Stock เริ่มต้น") {
  return sbFetch("stock_movements", {
    method: "POST",
    body: {
      product_id: productId,
      warehouse_id: warehouseId,
      movement_type: "INIT",
      qty,
      ref_doc_type: "INIT",
      note,
    },
  });
}
