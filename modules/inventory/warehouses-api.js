/* =====================================================
   warehouses-api.js
   Supabase API Layer — Warehouses
===================================================== */

function getSB() {
  return {
    url: localStorage.getItem("sb_url") || "",
    key: localStorage.getItem("sb_key") || "",
  };
}

async function sbFetch(table, opts = {}) {
  const { method = "GET", query = "", body } = opts;
  const { url, key } = getSB();

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

  if (!res.ok) {
    const t = await res.text();
    throw new Error(t);
  }

  if (method === "DELETE") return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/* ================================
   WAREHOUSES
================================ */

export async function fetchWarehouses() {
  return sbFetch("warehouses", { query: "?select=*&order=warehouse_code.asc" });
}

export async function createWarehouse(data) {
  return sbFetch("warehouses", { method: "POST", body: data });
}

export async function updateWarehouse(id, data) {
  return sbFetch("warehouses", {
    method: "PATCH",
    query: `?warehouse_id=eq.${id}`,
    body: data,
  });
}

export async function removeWarehouse(id) {
  return sbFetch("warehouses", {
    method: "DELETE",
    query: `?warehouse_id=eq.${id}`,
  });
}

export async function patchWarehouseStatus(id, status) {
  return sbFetch("warehouses", {
    method: "PATCH",
    query: `?warehouse_id=eq.${id}`,
    body: { is_active: status },
  });
}

/* ================================
   STOCK
================================ */

export async function fetchStock() {
  try {
    return await sbFetch("stock_available", { query: "?select=*" });
  } catch {
    return [];
  }
}

/* ================================
   COUNTRIES
================================ */

export async function fetchCountries() {
  return sbFetch("countries", {
    query: "?select=*&order=sort_order.asc,country_name.asc",
  });
}

export async function createCountry(data) {
  return sbFetch("countries", { method: "POST", body: data });
}

export async function updateCountry(id, data) {
  return sbFetch("countries", {
    method: "PATCH",
    query: `?country_id=eq.${id}`,
    body: data,
  });
}

export async function removeCountry(id) {
  return sbFetch("countries", {
    method: "DELETE",
    query: `?country_id=eq.${id}`,
  });
}
