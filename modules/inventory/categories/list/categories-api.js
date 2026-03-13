/* =====================================================
   categories-api.js
   Supabase API Layer — Categories
===================================================== */

function getSB() {
  return {
    url: localStorage.getItem("sb_url") || "",
    key: localStorage.getItem("sb_key") || "",
  };
}

async function sbFetch(table, q = "", opts = {}) {
  const { method = "GET", body } = opts;
  const { url, key } = getSB();

  const res = await fetch(`${url}/rest/v1/${table}${q}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: method === "POST" ? "return=representation" : "",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Supabase error");
  }

  return method !== "DELETE" ? res.json().catch(() => null) : null;
}

/* ================================
   CATEGORIES
================================ */

export async function fetchCategories() {
  return sbFetch("categories", "?select=*&order=category_name");
}

export async function createCategory(data) {
  return sbFetch("categories", "", { method: "POST", body: data });
}

export async function updateCategory(id, data) {
  return sbFetch("categories", `?category_id=eq.${id}`, {
    method: "PATCH",
    body: data,
  });
}

export async function removeCategory(id) {
  return sbFetch("categories", `?category_id=eq.${id}`, { method: "DELETE" });
}

/* ================================
   PRODUCTS (ใช้นับจำนวนต่อหมวด)
================================ */

export async function fetchProductsByCategory() {
  return sbFetch(
    "products",
    "?select=product_id,category_id&is_active=eq.true",
  );
}
