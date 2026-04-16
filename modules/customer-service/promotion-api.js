/* ============================================================
   promotion-api.js — API layer for Promotion Module
============================================================ */

const SB_URL_DEFAULT = "https://dtiynydgkcqausqktreg.supabase.co";
const SB_KEY_DEFAULT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0aXlueWRna2NxYXVzcWt0cmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyNjEwNTcsImV4cCI6MjA4NzgzNzA1N30.DmXwvBBvx3zK7rw21179ro65mTm0B4lQ20ktVMpAUQE";

function getSB() {
  const storedKey = localStorage.getItem("sb_key") || "";
  const isValidKey = storedKey.startsWith("eyJ") && storedKey.length > 100;
  return {
    url: localStorage.getItem("sb_url") || SB_URL_DEFAULT,
    key: isValidKey ? storedKey : SB_KEY_DEFAULT,
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
    throw new Error(e.message || "API Error");
  }
  return method === "DELETE" ? null : res.json().catch(() => null);
}

/* ── PROMOTIONS ── */
export async function fetchPromotions() {
  return sbFetch("promotions", "?select=*&order=start_date.desc") || [];
}

export async function fetchPromotionById(id) {
  const res = await sbFetch("promotions", `?promotion_id=eq.${id}&select=*`);
  return res?.[0] || null;
}

export async function createPromotion(data) {
  const res = await sbFetch("promotions", "", { method: "POST", body: data });
  return res?.[0];
}

export async function updatePromotion(id, data) {
  return sbFetch("promotions", `?promotion_id=eq.${id}`, {
    method: "PATCH",
    body: data,
  });
}

export async function removePromotion(id) {
  return sbFetch("promotions", `?promotion_id=eq.${id}`, { method: "DELETE" });
}

/* ── PROMOTION CATEGORIES ── */
export async function fetchPromotionCategories() {
  return (
    sbFetch(
      "promotion_categories",
      "?select=*&order=sort_order.asc,category_name.asc",
    ) || []
  );
}

/* ── USERS ── */
export async function fetchUsers() {
  return (
    sbFetch(
      "users",
      "?select=user_id,full_name,username&is_active=eq.true&order=full_name",
    ) || []
  );
}

/* ── UPLOAD POSTER ── */
export async function uploadPromotionPoster(promotionId, file) {
  const { url, key } = getSB();
  const ext = file.name.split(".").pop().toLowerCase();
  const fileName = `${promotionId}_poster_${Date.now()}.${ext}`;
  const uploadPath = `promotions/${fileName}`;

  const uploadRes = await fetch(
    `${url}/storage/v1/object/promotion-files/${uploadPath}`,
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

  return `${url}/storage/v1/object/public/promotion-files/${uploadPath}`;
}
