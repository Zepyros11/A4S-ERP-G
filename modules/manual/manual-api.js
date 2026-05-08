/* ============================================================
   manual-api.js — API layer for User Manual Module
   ============================================================
   Tables: manual_chapters · manual_pages
   Storage bucket: manual-files (public)
   See sql/062_manual_module.sql for schema reference.
   ============================================================ */

const SB_URL_DEFAULT = "https://dtiynydgkcqausqktreg.supabase.co";
const SB_KEY_DEFAULT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0aXlueWRna2NxYXVzcWt0cmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyNjEwNTcsImV4cCI6MjA4NzgzNzA1N30.DmXwvBBvx3zK7rw21179ro65mTm0B4lQ20ktVMpAUQE";

function getSB() {
  const stored = localStorage.getItem("sb_key") || "";
  const valid = stored.startsWith("eyJ") && stored.length > 100;
  return {
    url: localStorage.getItem("sb_url") || SB_URL_DEFAULT,
    key: valid ? stored : SB_KEY_DEFAULT,
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
    throw new Error(e.message || `${res.status} ${res.statusText}`);
  }
  return method === "DELETE" ? null : res.json().catch(() => null);
}

/* ── CHAPTERS ──────────────────────────────────────────── */
export async function fetchChapters({ includeUnpublished = false } = {}) {
  const filter = includeUnpublished ? "" : "&is_published=eq.true";
  return (
    (await sbFetch(
      "manual_chapters",
      `?select=*${filter}&order=sort_order.asc,id.asc`,
    )) || []
  );
}

export async function createChapter(data) {
  const res = await sbFetch("manual_chapters", "", {
    method: "POST",
    body: data,
  });
  return res?.[0];
}

export async function updateChapter(id, data) {
  const res = await sbFetch("manual_chapters", `?id=eq.${id}`, {
    method: "PATCH",
    body: data,
  });
  return res?.[0];
}

export async function deleteChapter(id) {
  return sbFetch("manual_chapters", `?id=eq.${id}`, { method: "DELETE" });
}

/* ── PAGES ─────────────────────────────────────────────── */
export async function fetchPages({
  chapterId,
  includeUnpublished = false,
} = {}) {
  const parts = ["select=*"];
  if (chapterId) parts.push(`chapter_id=eq.${chapterId}`);
  if (!includeUnpublished) parts.push("is_published=eq.true");
  parts.push("order=sort_order.asc,id.asc");
  return (await sbFetch("manual_pages", `?${parts.join("&")}`)) || [];
}

export async function fetchPageById(id) {
  const rows =
    (await sbFetch("manual_pages", `?select=*&id=eq.${id}&limit=1`)) || [];
  return rows[0] || null;
}

export async function fetchPageBySlug(chapterSlug, pageSlug) {
  /* 2-step: chapter slug → id → page */
  const chRows =
    (await sbFetch(
      "manual_chapters",
      `?select=id&slug=eq.${encodeURIComponent(chapterSlug)}&limit=1`,
    )) || [];
  if (!chRows[0]) return null;
  const pRows =
    (await sbFetch(
      "manual_pages",
      `?select=*&chapter_id=eq.${chRows[0].id}&slug=eq.${encodeURIComponent(pageSlug)}&limit=1`,
    )) || [];
  return pRows[0] || null;
}

export async function createPage(data) {
  const res = await sbFetch("manual_pages", "", {
    method: "POST",
    body: data,
  });
  return res?.[0];
}

export async function updatePage(id, data) {
  const res = await sbFetch("manual_pages", `?id=eq.${id}`, {
    method: "PATCH",
    body: data,
  });
  return res?.[0];
}

export async function deletePage(id) {
  return sbFetch("manual_pages", `?id=eq.${id}`, { method: "DELETE" });
}

/* batch update sort_order */
export async function reorderPages(updates /* [{id, sort_order}] */) {
  for (const u of updates) {
    await updatePage(u.id, { sort_order: u.sort_order });
  }
}

/* ── IMAGE UPLOAD ──────────────────────────────────────── */
export async function uploadManualImage(file) {
  const { url, key } = getSB();
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `pages/manual_${Date.now()}_${rand}`;
  const publicUrl = await window.ImageCompressor.uploadViaRest(
    url, key, "manual-files", path, file,
  );
  if (!publicUrl) throw new Error("Upload failed");
  return publicUrl;
}

/* ── SEARCH (title/summary/blocks text) ────────────────── */
export async function searchPages(keyword) {
  const k = encodeURIComponent(`%${keyword}%`);
  /* PostgREST or-filter on title and summary; blocks search is client-side
     because JSONB ilike isn't directly supported via PostgREST without rpc */
  const q =
    `?select=*,manual_chapters(title,icon,slug)` +
    `&is_published=eq.true` +
    `&or=(title.ilike.${k},summary.ilike.${k})` +
    `&order=sort_order.asc&limit=50`;
  return (await sbFetch("manual_pages", q)) || [];
}
