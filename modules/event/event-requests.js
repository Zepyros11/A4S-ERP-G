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
  document.getElementById("searchInput")?.addEventListener("input", filterTable);
  document.getElementById("filterStatus")?.addEventListener("change", filterTable);
  document.getElementById("filterType")?.addEventListener("change", filterTable);
}

// ── CARDS ─────────────────────────────────────────────────
function updateCards() {
  document.getElementById("cardTotal").textContent    = allRequests.length;
  document.getElementById("cardPending").textContent  = allRequests.filter(r => r.status === "PENDING").length;
  document.getElementById("cardApproved").textContent = allRequests.filter(r => r.status === "APPROVED").length;
  document.getElementById("cardRejected").textContent = allRequests.filter(r => r.status === "REJECTED").length;
}

// ── DEPT SELECT ───────────────────────────────────────────
function populateDeptSelect() {
  const sel = document.getElementById("fReqDept");
  if (!sel) return;
  sel.innerHTML = `<option value="">-- เลือกแผนก --</option>` +
    allDepts.map(d => `<option value="${d.dept_id}">${d.dept_name}</option>`).join("");
}

// ── TABLE ─────────────────────────────────────────────────
const TYPE_MAP = {
  BOOTH:      "🏪 ออกบูธ",
  MEETING:    "👥 ประชุม",
  ONLINE:     "💻 Online",
  HYBRID:     "🔀 Hybrid",
  CONFERENCE: "🎤 Conference",
  OTHER:      "📌 อื่นๆ",
};

const REQ_STATUS = {
  PENDING:  { label: "รอดำเนินการ", cls: "status-PENDING"  },
  APPROVED: { label: "อนุมัติแล้ว", cls: "status-APPROVED" },
  REJECTED: { label: "ปฏิเสธ",      cls: "status-REJECTED" },
};

function filterTable() {
  const q = (document.getElementById("searchInput")?.value || "").toLowerCase();
  const s = document.getElementById("filterStatus")?.value || "";
  const t = document.getElementById("filterType")?.value || "";
  const filtered = allRequests.filter(r =>
    (!q || (r.event_name || "").toLowerCase().includes(q) || (r.request_code || "").toLowerCase().includes(q)) &&
    (!s || r.status === s) &&
    (!t || r.event_type === t)
  );
  renderTable(filtered);
}

function renderTable(rows) {
  const tbody = document.getElementById("evReqTableBody");
  const count = document.getElementById("evReqCount");
  if (!tbody) return;
  if (count) count.textContent = rows.length + " รายการ";

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">ยังไม่มีคำขอจัดกิจกรรม</div></div></td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const s = REQ_STATUS[r.status] || REQ_STATUS.PENDING;
    const deptName = (allDepts.find(d => String(d.dept_id) === String(r.dept_id)) || {}).dept_name || "—";
    return `
      <tr data-req-id="${r.request_id}" style="cursor:pointer">
        <td><span style="font-family:monospace;font-size:11px;color:#6366f1">${r.request_code || "—"}</span></td>
        <td>${r.event_name || "—"}</td>
        <td class="col-center"><span class="req-type-badge">${TYPE_MAP[r.event_type] || r.event_type || "—"}</span></td>
        <td class="col-center">${deptName}</td>
        <td class="col-center">${r.requested_date || "—"}</td>
        <td class="col-center"><span class="req-status-badge ${s.cls}">${s.label}</span></td>
        <td class="col-center" onclick="event.stopPropagation()">
          <button class="btn-icon" title="อนุมัติ" onclick="window.quickApprove(${r.request_id}, this)">✅</button>
          <button class="btn-icon" title="ปฏิเสธ"  onclick="window.openRejectModal(${r.request_id})">❌</button>
        </td>
      </tr>`;
  }).join("");

  tbody.querySelectorAll("tr[data-req-id]").forEach(tr => {
    tr.addEventListener("click", () => {
      const req = allRequests.find(r => String(r.request_id) === tr.dataset.reqId);
      if (req) openReqPanel(req);
    });
  });
}

// ── SIDE PANEL ────────────────────────────────────────────
function openReqPanel(req) {
  selectedReq = req;
  const s = REQ_STATUS[req.status] || REQ_STATUS.PENDING;
  const deptName = (allDepts.find(d => String(d.dept_id) === String(req.dept_id)) || {}).dept_name || "—";

  const rows = [
    ["รหัสคำขอ",    `<span style="font-family:monospace;color:#6366f1">${req.request_code || "—"}</span>`],
    ["ชื่อกิจกรรม", req.event_name || "—"],
    ["ประเภท",      TYPE_MAP[req.event_type] || req.event_type || "—"],
    ["แผนก",        deptName],
    ["วันที่จัด",   req.requested_date || "—"],
    ["วันสิ้นสุด",  req.end_date || "—"],
    ["สถานที่",     req.location || "—"],
    ["ผู้เข้าร่วม", req.attendees_count ? req.attendees_count + " คน" : "—"],
    ["สถานะ",       `<span class="req-status-badge ${s.cls}">${s.label}</span>`],
  ];
  if (req.detail) rows.push(["รายละเอียด", req.detail]);
  if (req.reject_reason) rows.push(["เหตุผลปฏิเสธ", `<span style="color:#dc2626">${req.reject_reason}</span>`]);

  document.getElementById("reqPanelBody").innerHTML = rows.map(([label, val]) => `
    <div class="req-detail-row">
      <span class="req-detail-label">${label}</span>
      <span class="req-detail-value">${val}</span>
    </div>`).join("");

  const footer = document.getElementById("reqPanelFooter");
  footer.innerHTML = req.status === "PENDING"
    ? `<button class="btn btn-secondary" onclick="window.closeReqPanel()">ปิด</button>
       <button class="btn btn-danger"    onclick="window.openRejectModal(${req.request_id})">❌ ปฏิเสธ</button>
       <button class="btn btn-primary"   onclick="window.quickApprove(${req.request_id})">✅ อนุมัติ</button>`
    : `<button class="btn btn-secondary" onclick="window.closeReqPanel()">ปิด</button>`;

  document.getElementById("reqPanel").classList.add("open");
  document.getElementById("panelBackdrop").style.display = "block";
}

function closeReqPanel() {
  document.getElementById("reqPanel").classList.remove("open");
  document.getElementById("panelBackdrop").style.display = "none";
  selectedReq = null;
}

// ── REQUEST MODAL ─────────────────────────────────────────
function openRequestModal() {
  ["fReqName","fReqLocation","fReqAttendees","fReqDetail"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  ["fReqType","fReqDept"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  document.getElementById("fReqDate").value    = "";
  document.getElementById("fReqEndDate").value = "";
  document.getElementById("reqModalOverlay").classList.add("open");
}

function closeRequestModal() {
  document.getElementById("reqModalOverlay").classList.remove("open");
}

async function submitRequest() {
  const name = (document.getElementById("fReqName")?.value || "").trim();
  const type = document.getElementById("fReqType")?.value || "";
  const date = document.getElementById("fReqDate")?.value || "";
  if (!name || !type || !date) {
    showToast("กรุณากรอก ชื่อกิจกรรม, ประเภท และวันที่", "error");
    return;
  }

  const btn = document.querySelector("#reqModalOverlay .btn-primary");
  if (btn) { btn.disabled = true; btn.textContent = "กำลังส่ง..."; }
  try {
    const code = await autoGenerateRequestCode();
    const payload = {
      request_code:    code,
      event_name:      name,
      event_type:      type,
      dept_id:         document.getElementById("fReqDept")?.value || null,
      requested_date:  date,
      end_date:        document.getElementById("fReqEndDate")?.value || null,
      location:        (document.getElementById("fReqLocation")?.value || "").trim() || null,
      attendees_count: parseInt(document.getElementById("fReqAttendees")?.value) || null,
      detail:          (document.getElementById("fReqDetail")?.value || "").trim() || null,
      status:          "PENDING",
    };
    const created = await createRequest(payload);

    // Upload file if provided
    const fileInput = document.getElementById("fReqFile");
    if (fileInput?.files?.[0] && created?.request_id) {
      try {
        const fileUrl = await uploadRequestFile(created.request_id, fileInput.files[0]);
        await updateRequest(created.request_id, { file_url: fileUrl });
      } catch (_) { /* file upload failed but request created */ }
    }

    closeRequestModal();
    showToast("ส่งคำขอสำเร็จ: " + code, "success");
    await loadData();
  } catch (e) {
    showToast("ส่งคำขอไม่สำเร็จ: " + e.message, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "📤 ส่งคำขอ"; }
  }
}

// ── APPROVE / REJECT ──────────────────────────────────────
async function quickApprove(id, btn) {
  if (btn) btn.disabled = true;
  try {
    const req = allRequests.find(r => String(r.request_id) === String(id));
    await updateRequest(id, { status: "APPROVED" });
    if (req) {
      try { await createEventFromRequest(req); } catch (_) {}
    }
    closeReqPanel();
    showToast("อนุมัติแล้ว", "success");
    await loadData();
  } catch (e) {
    showToast("เกิดข้อผิดพลาด: " + e.message, "error");
    if (btn) btn.disabled = false;
  }
}

function openRejectModal(id) {
  rejectTargetId = id;
  document.getElementById("fRejectReason").value = "";
  document.getElementById("rejectModalOverlay").classList.add("open");
}

function closeRejectModal() {
  document.getElementById("rejectModalOverlay").classList.remove("open");
  rejectTargetId = null;
}

async function confirmReject() {
  const reason = (document.getElementById("fRejectReason")?.value || "").trim();
  if (!reason) { showToast("กรุณาระบุเหตุผล", "error"); return; }

  const btn = document.querySelector("#rejectModalOverlay .btn-danger");
  if (btn) { btn.disabled = true; btn.textContent = "กำลังบันทึก..."; }
  try {
    await updateRequest(rejectTargetId, { status: "REJECTED", reject_reason: reason });
    closeRejectModal();
    closeReqPanel();
    showToast("ปฏิเสธคำขอแล้ว", "success");
    await loadData();
  } catch (e) {
    showToast("เกิดข้อผิดพลาด: " + e.message, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "ยืนยันปฏิเสธ"; }
  }
}

// ── UI HELPERS ────────────────────────────────────────────
function showLoading(show) {
  const el = document.getElementById("loadingOverlay");
  if (el) el.style.display = show ? "flex" : "none";
}

function showToast(msg, type = "success") {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.className = "toast " + (type === "error" ? "toast-error" : "toast-success");
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 3000);
}

// ── EXPOSE GLOBALS ────────────────────────────────────────
window.closeReqPanel    = closeReqPanel;
window.openRejectModal  = openRejectModal;
window.closeRejectModal = closeRejectModal;
window.confirmReject    = confirmReject;
window.quickApprove     = quickApprove;
window.openRequestModal = openRequestModal;
window.closeRequestModal = closeRequestModal;
window.submitRequest    = submitRequest;

initPage();