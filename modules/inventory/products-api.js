/* ============================================================
   products-api.js — API layer for Products module
   ============================================================ */

function getSB() {
  return {
    url: localStorage.getItem("sb_url") || "",
    key: localStorage.getItem("sb_key") || "",
  };
}

async function sbFetch(table, query = "", opts = {}) {
  const { url, key } = getSB();
  const { method = "GET", body } = opts;
  const res = await fetch(`${url}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer:
        method === "POST" || method === "PATCH" ? "return=representation" : "",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || "Error");
  }
  return method === "DELETE" ? null : res.json().catch(() => null);
}

export async function fetchProducts() {
  return sbFetch("products", "?select=*&order=product_code") || [];
}

export async function fetchCategories() {
  return sbFetch("categories", "?select=*") || [];
}

export async function fetchProductUnits() {
  return sbFetch("product_units", "?select=*") || [];
}

export async function fetchProductImages() {
  return sbFetch("product_images", "?select=*&order=sort_order.asc") || [];
}

export async function createProduct(data) {
  const res = await sbFetch("products", "", { method: "POST", body: data });
  return res?.[0];
}

export async function updateProduct(id, data) {
  return sbFetch(`products`, `?product_id=eq.${id}`, {
    method: "PATCH",
    body: data,
  });
}

export async function removeProduct(id) {
  return sbFetch("products", `?product_id=eq.${id}`, { method: "DELETE" });
}

export async function removeProductUnits(productId) {
  return sbFetch("product_units", `?product_id=eq.${productId}`, {
    method: "DELETE",
  }).catch(() => null);
}

export async function createProductUnit(data) {
  return sbFetch("product_units", "", { method: "POST", body: data });
}

export async function updateProductStatus(id, isActive) {
  return sbFetch("products", `?product_id=eq.${id}`, {
    method: "PATCH",
    body: { is_active: isActive },
  });
}

export async function updateProductStockAlert(id, disabled) {
  return sbFetch("products", `?product_id=eq.${id}`, {
    method: "PATCH",
    body: { disable_stock_alert: disabled },
  });
}

export async function updateProductCategory(id, categoryId) {
  return sbFetch("products", `?product_id=eq.${id}`, {
    method: "PATCH",
    body: { category_id: categoryId },
  });
}

export async function removeProductImages(productId) {
  return sbFetch("product_images", `?product_id=eq.${productId}`, {
    method: "DELETE",
  }).catch(() => null);
}

export async function createProductImage(data) {
  return sbFetch("product_images", "", { method: "POST", body: data });
}

export async function uploadProductImage(productId, file, slotIndex) {
  const { url, key } = getSB();
  const rand = Math.random().toString(36).slice(2, 6);
  const path = `products/${productId}_${slotIndex}_${Date.now()}_${rand}`;
  const publicUrl = await window.ImageCompressor.uploadViaRest(
    url, key, "product-images", path, file,
  );
  if (!publicUrl) throw new Error("Upload failed");
  return publicUrl;
}
