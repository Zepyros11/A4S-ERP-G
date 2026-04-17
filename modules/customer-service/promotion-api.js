/* ============================================================
   promotion-api.js — API layer for Promotion Module
   ============================================================
   Data model (Supabase tables — to be created):
   ─────────────────────────────────────────────
   promotion_categories
     promotion_category_id  SERIAL PK
     category_name          TEXT
     icon                   TEXT          (emoji)
     color                  TEXT          (hex)
     sort_order             INT DEFAULT 0

   promotions
     promotion_id           SERIAL PK
     promotion_category_id  INT FK
     promo_month            TEXT          (YYYY-MM)
     poster_url             TEXT          (public URL)
     title                  TEXT          (optional caption)
     sort_order             INT DEFAULT 0
     created_at             TIMESTAMPTZ DEFAULT now()
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
export async function fetchPromotions(month) {
  const q = month
    ? `?select=*&promo_month=eq.${month}&order=sort_order.asc,created_at.desc`
    : `?select=*&order=promo_month.desc,sort_order.asc`;
  return sbFetch("promotions", q) || [];
}

export async function createPromotions(rows) {
  // batch insert
  const res = await sbFetch("promotions", "", { method: "POST", body: rows });
  return res || [];
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

export async function createPromotionCategory(data) {
  const res = await sbFetch("promotion_categories", "", { method: "POST", body: data });
  return res?.[0];
}

export async function updatePromotionCategory(id, data) {
  return sbFetch("promotion_categories", `?promotion_category_id=eq.${id}`, {
    method: "PATCH",
    body: data,
  });
}

export async function removePromotionCategory(id) {
  return sbFetch("promotion_categories", `?promotion_category_id=eq.${id}`, { method: "DELETE" });
}

/* ── UPLOAD POSTER IMAGE ── */
export async function uploadPosterFile(file) {
  const { url, key } = getSB();
  const ext = file.name.split(".").pop().toLowerCase();
  const fileName = `promo_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
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
