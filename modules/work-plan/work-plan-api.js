/* ============================================================
   work-plan-api.js — Supabase REST wrapper for Work Planning
============================================================ */

function getSB() {
  return {
    url: localStorage.getItem("sb_url") || "",
    key: localStorage.getItem("sb_key") || "",
  };
}

export async function sbFetch(table, query = "", opts = {}) {
  const { url, key } = getSB();
  const { method = "GET", body, prefer } = opts;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  else if (method === "POST" || method === "PATCH")
    headers.Prefer = "return=representation";

  const res = await fetch(`${url}/rest/v1/${table}${query}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || `HTTP ${res.status}`);
  }
  return method === "DELETE" ? null : res.json().catch(() => null);
}

/* ── Departments ─────────────────────────────────────────── */
export async function fetchDepartments(scope) {
  return (
    (await sbFetch(
      "work_departments",
      `?scope=eq.${scope}&order=sort_order.asc,name.asc`
    )) || []
  );
}

export async function createDepartment({ scope, name, color, sort_order }) {
  const [row] = await sbFetch("work_departments", "", {
    method: "POST",
    body: { scope, name, color: color || "#4a90e2", sort_order: sort_order || 0 },
  });
  return row;
}

export async function updateDepartment(id, patch) {
  const [row] = await sbFetch(`work_departments?id=eq.${id}`, "", {
    method: "PATCH",
    body: patch,
  });
  return row;
}

export async function deleteDepartment(id) {
  return sbFetch(`work_departments?id=eq.${id}`, "", { method: "DELETE" });
}

/* ── Plans ──────────────────────────────────────────────── */
export async function fetchPlans({ scope, year, deptId }) {
  const q = [`scope=eq.${scope}`];
  if (year) q.push(`year=eq.${year}`);
  if (deptId) q.push(`dept_id=eq.${deptId}`);
  q.push("order=event_start.desc.nullslast,created_at.desc");
  return (await sbFetch("work_plans", "?" + q.join("&"))) || [];
}

export async function fetchPlan(id) {
  const rows = await sbFetch("work_plans", `?id=eq.${id}`);
  return rows?.[0] || null;
}

export async function createPlan(payload) {
  const [row] = await sbFetch("work_plans", "", {
    method: "POST",
    body: payload,
  });
  return row;
}

export async function updatePlan(id, patch) {
  const [row] = await sbFetch(`work_plans?id=eq.${id}`, "", {
    method: "PATCH",
    body: patch,
  });
  return row;
}

export async function deletePlan(id) {
  return sbFetch(`work_plans?id=eq.${id}`, "", { method: "DELETE" });
}

/* ── Rows ───────────────────────────────────────────────── */
export async function fetchRows(planId) {
  return (
    (await sbFetch(
      "work_plan_rows",
      `?plan_id=eq.${planId}&order=event_day.asc,row_order.asc`
    )) || []
  );
}

export async function createRow(payload) {
  const [row] = await sbFetch("work_plan_rows", "", {
    method: "POST",
    body: payload,
  });
  return row;
}

export async function updateRow(id, patch) {
  const [row] = await sbFetch(`work_plan_rows?id=eq.${id}`, "", {
    method: "PATCH",
    body: patch,
  });
  return row;
}

export async function deleteRow(id) {
  return sbFetch(`work_plan_rows?id=eq.${id}`, "", { method: "DELETE" });
}

/* ── Users (staff) ──────────────────────────────────────── */
export async function fetchStaffUsers() {
  // users table มี user_id, username, full_name, role, is_active (ยืนยันจาก login.html)
  // ไม่มี first_name/last_name → ไม่ select (เพราะจะ 400)
  return (
    (await sbFetch(
      "users",
      "?is_active=eq.true&select=user_id,username,full_name,role&order=full_name.asc"
    )) || []
  );
}

/* ── Places (ดึงจากหน้า events-place-list) ─────────────── */
export async function fetchPlaces() {
  return (
    (await sbFetch(
      "places",
      "?status=eq.ACTIVE&select=place_id,place_name,place_type,address&order=place_name.asc"
    )) || []
  );
}

/* ── Count rows per plan (สำหรับ card) ─────────────────── */
export async function countRowsByPlan(planIds) {
  if (!planIds?.length) return {};
  const rows = await sbFetch(
    "work_plan_rows",
    `?plan_id=in.(${planIds.join(",")})&select=plan_id`
  );
  const map = {};
  (rows || []).forEach((r) => {
    map[r.plan_id] = (map[r.plan_id] || 0) + 1;
  });
  return map;
}
