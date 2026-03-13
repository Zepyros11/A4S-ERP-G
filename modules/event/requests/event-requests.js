/* ============================================================
   event-requests.js — Controller for Event Requests page
============================================================ */

// ── API ───────────────────────────────────────────────────
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
      Prefer: method === "POST" || method === "PATCH" ? "return=representation" : "",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.message || "Error");
  }
  return method === "DELETE" ? null : res.json().catch(() => null);
}

async function fetchRequests() {
  return sbFetch("event_requests", "?select=*&order=created_at.desc") || [];
}
async function fetchUsers() {
  return sbFetch("users", "?select=user_id,full_name,dept_id&is_active=eq.true") || [];
}
async function fetchDepts() {
  return sbFetch("departments", "?select=dept_id,dept_name&is_active=eq.true") || [];
}
async function createRequest(data) {
  const res = await sbFetch("event_requests", "", { method: "POST", body: data });
  return res?.[0];
}
async function updateRequest(id, data) {
  return sbFetch("event_requests", `?request_id=eq.${id}`, { method: "PATCH", body: data });
}
async function autoGenerateRequestCode() {
  const { url, key } = getSB();
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const prefix = `REQ-${yyyy}${mm}-`;
  const res = await fetch(
    `${url}/rest/v1/event_requests?request_code=like.${prefix}*&select=request_code`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  const rows = await res.json().catch(() => []);
  let maxSeq = 0;
  (rows || []).forEach((r) => {
    const parts = (r.request_code || "").split("-");
    const n = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(n) && n > maxSeq) maxSeq = n;
  });
  return `${prefix}${String(maxSeq + 1).padStart(3, "0")}`;
}

async function uploadRequestFile(requestId, file) {
  const { url, key } = getSB();
  const ext = file.name.split(".").pop().toLowerCase();
  const fileName = `req_${requestId}_${Date.now()}.${ext}`;
  const res = await fetch(
    `${url}/storage/v1/object/event-files/documents/${fileName}`,
    {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": file.type,
        "x-upsert": "true",
      },
      body: file,
    }
  );
  if (!res.ok) throw new Error("Upload failed");
  return `${url}/storage/v1/object/public/event-files/documents/${fileName}`;
}

async function createEventFromRequest(req) {
  // สร้าง event code ใหม่
  const { url, key } = getSB();
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const prefix = `EVT-${yyyy}${mm}-`;
  const res = await fetch(
    `${url}/rest/v1/events?event_code=like.${prefix}*&select=event_code`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  const rows = await res.json().catch(() => []);
  let maxSeq = 0;
  (rows || []).forEach((r) => {
    const parts = (r.event_code || "").split("-");
    const n = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(n) && n > maxSeq) maxSeq = n;
  });
  const eventCode = `${prefix}${String(maxSeq + 1).padStart(3, "0")}`;

  const payload = {
    event_code: eventCode,
    event_name: req.event_name,
    event_type: req.event_type,
    event_date: req.requested_date,
    end_date: req.end_date,
    location: req.location || "",
    max_attendees: req.attendees_count || 0,
    status: "CONFIRMED",
  };
  const result = await sbFetch("events", "", { method: "POST", body: payload });
  return result?.[0];
}

// ── STATE ─────────────────────────────────────────────────
let allRequests = [];
let allUsers    = [];
let allDepts    = [];
let selectedReq = null;
let rejectTargetId = null;

// ── INIT ──────────────────────────────────────────────────
async function initPage() {
  await loadData();
  bindEvents();
}

async function loadData() {
  showLoading(true);
  try {
    const [reqs, users, depts] = await Promise.all([
      fetchRequests(),
      fetchUsers(),
      fetchDepts(),
    ]);
    allRequests = reqs || [];
    allUsers    = users || [];
    allDepts    = depts || [];

    populateDeptSelect();
    updateCards();
    filterTable();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

function bindEvents() {
  document.getElementById("searchInput")?.addEventListener("input",