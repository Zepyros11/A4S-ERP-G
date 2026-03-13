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
  const ext = file.name.split(".").pop().toLowerCase();
  const fileName = `${productId}_${slotIndex}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 6)}.${ext}`;
  const uploadPath = `products/${fileName}`;

  const uploadRes = await fetch(
    `${url}/storage/v1/object/product-images/${uploadPath}`,
    {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": file.type,
        "x-upsert": "true",
      },
      body: file,
    },
  );

  if (!uploadRes.ok) {
    const err = await uploadRes.json().catch(() => ({}));
    throw new Error(err.message || "Upload failed");
  }

  return `${url}/storage/v1/object/public/product-images/${uploadPath}`;
}
