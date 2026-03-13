/* ============================================================
   event-request-form.js — Controller for Request Form page
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

async function fetchDepts() {
  return (
    sbFetch("departments", "?select=dept_id,dept_name&is_active=eq.true") || []
  );
}
async function createRequest(data) {
  const res = await sbFetch("event_requests", "", {
    method: "POST",
    body: data,
  });
  return res?.[0];
}
async function updateRequest(id, data) {
  return sbFetch("event_requests", `?request_id=eq.${id}`, {
    method: "PATCH",
    body: data,
  });
}
async function autoGenerateRequestCode() {
  const { url, key } = getSB();
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const prefix = `REQ-${yyyy}${mm}-`;
  const res = await fetch(
    `${url}/rest/v1/event_requests?request_code=like.${prefix}*&select=request_code`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
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
    },
  );
  if (!res.ok) throw new Error("Upload failed");
  return `${url}/storage/v1/object/public/event-files/documents/${fileName}`;
}

// ── STATE ─────────────────────────────────────────────────
let attachFile = null;

// ── INIT ──────────────────────────────────────────────────
async function initPage() {
  showLoading(true);
  try {
    const depts = await fetchDepts();
    const sel = document.getElementById("fReqDept");
    depts.forEach((d) =>
      sel.insertAdjacentHTML(
        "beforeend",
        `<option value="${d.dept_id}">${d.dept_name}</option>`,
      ),
    );
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

// ── FILE HANDLER ──────────────────────────────────────────
window.handleFileSelect = function (input) {
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    showToast("ไฟล์ใหญ่เกิน 10MB", "error");
    return;
  }
  attachFile = file;
  document.getElementById("fileName").textContent = `📎 ${file.name}`;
};

window.handleFileDrop = function (e) {
  e.preventDefault();
  const file = e.dataTransfer.files?.[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    showToast("ไฟล์ใหญ่เกิน 10MB", "error");
    return;
  }
  attachFile = file;
  document.getElementById("fileName").textContent = `📎 ${file.name}`;
};

// ── SUBMIT ────────────────────────────────────────────────
window.submitRequest = async function () {
  const name = document.getElementById("fReqName").value.trim();
  const type = document.getElementById("fReqType").value;
  const date = document.getElementById("fReqDate").value;

  if (!name) {
    showToast("กรุณาระบุชื่อกิจกรรม", "error");
    return;
  }
  if (!type) {
    showToast("กรุณาเลือกประเภท", "error");
    return;
  }
  if (!date) {
    showToast("กรุณาเลือกวันที่", "error");
    return;
  }

  const session = JSON.parse(
    localStorage.getItem("erp_session") ||
      sessionStorage.getItem("erp_session") ||
      "{}",
  );

  showLoading(true);
  try {
    const code = await autoGenerateRequestCode();

    const payload = {
      request_code: code,
      event_name: name,
      event_type: type,
      dept_id: document.getElementById("fReqDept").value || null,
      requested_date: date,
      end_date: document.getElementById("fReqEndDate").value || null,
      location: document.getElementById("fReqLocation").value || "",
      attendees_count:
        parseInt(document.getElementById("fReqAttendees").value) || 0,
      detail:
        [
          document.getElementById("fReqObjective").value,
          document.getElementById("fReqDetail").value,
        ]
          .filter(Boolean)
          .join("\n\n") || "",
      requested_by: session?.user_id || null,
      status: "PENDING",
    };

    const newReq = await createRequest(payload);

    // upload file ถ้ามี
    if (attachFile && newReq?.request_id) {
      try {
        const fileUrl = await uploadRequestFile(newReq.request_id, attachFile);
        await updateRequest(newReq.request_id, { attachment_url: fileUrl });
      } catch (_) {
        /* ไม่ block ถ้า upload fail */
      }
    }

    showToast("ส่งคำขอเรียบร้อยแล้ว 📤", "success");
    setTimeout(() => {
      window.location.href = "./event-requests.html";
    }, 1200);
  } catch (e) {
    showToast("ส่งคำขอไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

// ── HELPERS ───────────────────────────────────────────────
function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove("show"), 3000);
}
function showLoading(show) {
  document.getElementById("loadingOverlay").classList.toggle("show", show);
}

// ── START ─────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPage);
} else {
  initPage();
}
