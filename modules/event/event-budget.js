/* ============================================================
   event-budget.js — Controller for Event Budget page
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

async function fetchEvents() {
  return (
    sbFetch(
      "events",
      "?select=event_id,event_name,event_code,status&order=event_date.desc",
    ) || []
  );
}
async function fetchBudget(eventId) {
  const res =
    (await sbFetch("event_budget", `?event_id=eq.${eventId}&select=*`)) || [];
  return res?.[0] || null;
}
async function upsertBudget(eventId, data) {
  // upsert: ถ้ามีอยู่แล้ว PATCH, ถ้าไม่มี POST
  const existing = await fetchBudget(eventId);
  if (existing) {
    return sbFetch("event_budget", `?budget_id=eq.${existing.budget_id}`, {
      method: "PATCH",
      body: data,
    });
  } else {
    const res = await sbFetch("event_budget", "", {
      method: "POST",
      body: { ...data, event_id: eventId },
    });
    return res?.[0];
  }
}
async function fetchSuppliers(eventId) {
  return (
    sbFetch(
      "event_suppliers",
      `?event_id=eq.${eventId}&order=created_at.asc`,
    ) || []
  );
}
async function createSupplier(data) {
  const res = await sbFetch("event_suppliers", "", {
    method: "POST",
    body: data,
  });
  return res?.[0];
}
async function updateSupplier(id, data) {
  return sbFetch("event_suppliers", `?ev_supplier_id=eq.${id}`, {
    method: "PATCH",
    body: data,
  });
}
async function removeSupplier(id) {
  return sbFetch("event_suppliers", `?ev_supplier_id=eq.${id}`, {
    method: "DELETE",
  });
}
async function uploadSupDoc(eventId, file) {
  const { url, key } = getSB();
  const ext = file.name.split(".").pop().toLowerCase();
  const fileName = `sup_${eventId}_${Date.now()}.${ext}`;
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
let allEvents = [];
let currentEventId = null;
let currentBudget = null;
let currentSuppliers = [];
let editingSupId = null;
let supAttachFile = null;

// ── INIT ──────────────────────────────────────────────────
async function initPage() {
  showLoading(true);
  try {
    allEvents = (await fetchEvents()) || [];
    populateEventSelect();

    // รับ event_id จาก URL ถ้ามี
    const params = new URLSearchParams(window.location.search);
    const urlEventId = params.get("event_id");
    if (urlEventId) {
      document.getElementById("eventSelect").value = urlEventId;
      await loadEventBudget(parseInt(urlEventId));
    }
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

function populateEventSelect() {
  const sel = document.getElementById("eventSelect");
  sel.innerHTML = '<option value="">-- เลือกกิจกรรม --</option>';
  allEvents.forEach((e) =>
    sel.insertAdjacentHTML(
      "beforeend",
      `<option value="${e.event_id}">[${e.event_code}] ${e.event_name}</option>`,
    ),
  );
}

// ── EVENT CHANGE ──────────────────────────────────────────
window.onEventChange = async function () {
  const val = document.getElementById("eventSelect").value;
  if (!val) {
    currentEventId = null;
    document.getElementById("budgetSection").style.display = "none";
    document.getElementById("noEventState").style.display = "block";
    document.getElementById("btnSetBudget").style.display = "none";
    return;
  }
  await loadEventBudget(parseInt(val));
};

async function loadEventBudget(eventId) {
  currentEventId = eventId;
  showLoading(true);
  try {
    const [budget, suppliers] = await Promise.all([
      fetchBudget(eventId),
      fetchSuppliers(eventId),
    ]);
    currentBudget = budget;
    currentSuppliers = suppliers || [];

    document.getElementById("noEventState").style.display = "none";
    document.getElementById("budgetSection").style.display = "block";
    document.getElementById("btnSetBudget").style.display = "inline-flex";

    renderBudgetSummary();
    renderSupplierTable();
  } catch (e) {
    showToast("โหลดงบประมาณไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

// ── RENDER BUDGET ─────────────────────────────────────────
function renderBudgetSummary() {
  const total = parseFloat(currentBudget?.budget_total || 0);
  const spent = calcSpent();
  const remain = total - spent;
  const pct = total > 0 ? Math.min((spent / total) * 100, 100) : 0;

  document.getElementById("cardBudgetTotal").textContent =
    `฿${formatNum(total)}`;
  document.getElementById("cardSpent").textContent = `฿${formatNum(spent)}`;
  document.getElementById("cardRemain").textContent = `฿${formatNum(remain)}`;
  document.getElementById("cardVendorCount").textContent =
    currentSuppliers.length;

  document.getElementById("spentLabel").textContent = `฿${formatNum(spent)}`;
  document.getElementById("totalLabel").textContent = `฿${formatNum(total)}`;
  document.getElementById("budgetPctLabel").textContent =
    `${pct.toFixed(1)}% ของงบประมาณ`;

  const bar = document.getElementById("budgetBar");
  bar.style.width = `${pct}%`;
  bar.className =
    "budget-bar-fill" + (pct >= 100 ? " danger" : pct >= 80 ? " warn" : "");

  // remain color
  const remainEl = document.getElementById("cardRemain");
  remainEl.className =
    "budget-card-value " +
    (remain < 0 ? "danger" : remain < total * 0.2 ? "warning" : "success");
}

function calcSpent() {
  return currentSuppliers
    .filter((s) => s.status !== "CANCELLED")
    .reduce((sum, s) => sum + parseFloat(s.amount || 0), 0);
}

// ── RENDER SUPPLIER TABLE ─────────────────────────────────
function renderSupplierTable() {
  const tbody = document.getElementById("supplierTableBody");
  const countEl = document.getElementById("supplierCount");
  if (countEl) countEl.textContent = `${currentSuppliers.length} รายการ`;

  if (!currentSuppliers.length) {
    tbody.innerHTML = `<tr><td colspan="6">
      <div class="empty-state">
        <div class="empty-icon">🚚</div>
        <div class="empty-text">ยังไม่มี Vendor</div>
      </div></td></tr>`;
    return;
  }

  tbody.innerHTML = currentSuppliers
    .map(
      (s) => `
    <tr>
      <td>
        <div style="font-weight:600">${s.supplier_name}</div>
        <div style="font-size:11px;color:var(--text3)">${s.detail || ""}</div>
      </td>
      <td class="col-center">
        <span style="font-size:12px">${serviceLabel(s.service_type)}</span>
      </td>
      <td class="col-center" style="font-family:'IBM Plex Mono',monospace;font-size:13px">
        ฿${formatNum(s.amount)}
      </td>
      <td class="col-center">
        <span class="sup-status-badge sup-${s.status}">
          ${supStatusLabel(s.status)}
        </span>
      </td>
      <td class="col-center">
        ${
          s.doc_url
            ? `<a href="${s.doc_url}" target="_blank" class="btn-icon">📎</a>`
            : `<span style="color:var(--text3);font-size:12px">—</span>`
        }
      </td>
      <td style="text-align:center">
        <div class="action-group">
          <button class="btn-icon"
            onclick="window.openSupplierModal(${s.ev_supplier_id})">✏️</button>
          <button class="btn-icon danger"
            onclick="window.deleteSupplier(${s.ev_supplier_id})">🗑</button>
        </div>
      </td>
    </tr>`,
    )
    .join("");
}

// ── BUDGET MODAL ──────────────────────────────────────────
window.openBudgetModal = function () {
  document.getElementById("fBudgetTotal").value =
    currentBudget?.budget_total || "";
  document.getElementById("fBudgetNote").value = currentBudget?.note || "";
  document.getElementById("budgetModalOverlay").classList.add("open");
};
window.closeBudgetModal = function () {
  document.getElementById("budgetModalOverlay").classList.remove("open");
};
window.saveBudget = async function () {
  const total = parseFloat(document.getElementById("fBudgetTotal").value);
  if (isNaN(total) || total < 0) {
    showToast("กรุณาระบุงบประมาณที่ถูกต้อง", "error");
    return;
  }
  const session = JSON.parse(
    localStorage.getItem("erp_session") ||
      sessionStorage.getItem("erp_session") ||
      "{}",
  );
  showLoading(true);
  try {
    await upsertBudget(currentEventId, {
      budget_total: total,
      note: document.getElementById("fBudgetNote").value || null,
      approved_by: session?.user_id || null,
      approved_at: new Date().toISOString(),
    });
    showToast("บันทึกงบประมาณแล้ว 💰", "success");
    window.closeBudgetModal();
    currentBudget = await fetchBudget(currentEventId);
    renderBudgetSummary();
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

// ── SUPPLIER MODAL ────────────────────────────────────────
window.handleSupFile = function (input) {
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    showToast("ไฟล์ใหญ่เกิน 10MB", "error");
    return;
  }
  supAttachFile = file;
  document.getElementById("supFileName").textContent = `📎 ${file.name}`;
};

window.openSupplierModal = function (id = null) {
  editingSupId = id;
  supAttachFile = null;
  document.getElementById("supplierModalTitle").textContent = id
    ? "✏️ แก้ไข Vendor"
    : "🚚 เพิ่ม Vendor";
  document.getElementById("supFileName").textContent = "";

  ["fSupId", "fSupName", "fSupDetail"].forEach(
    (f) => (document.getElementById(f).value = ""),
  );
  document.getElementById("fSupAmount").value = "";
  document.getElementById("fSupServiceType").value = "";
  document.getElementById("fSupStatus").value = "PENDING";
  document.getElementById("fSupFile").value = "";

  if (id) {
    const s = currentSuppliers.find((x) => x.ev_supplier_id === id);
    if (s) {
      document.getElementById("fSupId").value = s.ev_supplier_id;
      document.getElementById("fSupName").value = s.supplier_name || "";
      document.getElementById("fSupServiceType").value = s.service_type || "";
      document.getElementById("fSupAmount").value = s.amount || "";
      document.getElementById("fSupStatus").value = s.status || "PENDING";
      document.getElementById("fSupDetail").value = s.detail || "";
      if (s.doc_url) {
        document.getElementById("supFileName").textContent =
          "📎 ไฟล์แนบอยู่แล้ว";
      }
    }
  }
  document.getElementById("supplierModalOverlay").classList.add("open");
};

window.closeSupplierModal = function () {
  document.getElementById("supplierModalOverlay").classList.remove("open");
  editingSupId = null;
};

window.saveSupplier = async function () {
  const name = document.getElementById("fSupName").value.trim();
  const svcType = document.getElementById("fSupServiceType").value;
  if (!name) {
    showToast("กรุณาระบุชื่อ Vendor", "error");
    return;
  }
  if (!svcType) {
    showToast("กรุณาเลือกประเภทบริการ", "error");
    return;
  }

  const payload = {
    event_id: currentEventId,
    supplier_name: name,
    service_type: svcType,
    amount: parseFloat(document.getElementById("fSupAmount").value) || 0,
    status: document.getElementById("fSupStatus").value,
    detail: document.getElementById("fSupDetail").value || null,
  };

  showLoading(true);
  try {
    let saved;
    if (editingSupId) {
      await updateSupplier(editingSupId, payload);
      saved = { ev_supplier_id: editingSupId };
    } else {
      saved = await createSupplier(payload);
    }

    // upload doc ถ้ามี
    if (supAttachFile && saved?.ev_supplier_id) {
      try {
        const docUrl = await uploadSupDoc(currentEventId, supAttachFile);
        await updateSupplier(saved.ev_supplier_id, { doc_url: docUrl });
      } catch (_) {}
    }

    showToast(editingSupId ? "แก้ไขแล้ว" : "เพิ่ม Vendor แล้ว", "success");
    window.closeSupplierModal();
    currentSuppliers = await fetchSuppliers(currentEventId);
    renderSupplierTable();
    renderBudgetSummary();
  } catch (e) {
    showToast("บันทึกไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

window.deleteSupplier = function (id) {
  const s = currentSuppliers.find((x) => x.ev_supplier_id === id);
  if (!s) return;
  DeleteModal.open(
    `ต้องการลบ Vendor "${s.supplier_name}" หรือไม่?`,
    async () => {
      showLoading(true);
      try {
        await removeSupplier(id);
        showToast("ลบ Vendor แล้ว", "success");
        currentSuppliers = await fetchSuppliers(currentEventId);
        renderSupplierTable();
        renderBudgetSummary();
      } catch (e) {
        showToast("ลบไม่สำเร็จ: " + e.message, "error");
      }
      showLoading(false);
    },
  );
};

// ── HELPERS ───────────────────────────────────────────────
function serviceLabel(t) {
  return (
    {
      VENUE: "🏢 สถานที่",
      CATERING: "🍽 อาหาร",
      AV: "🎤 AV",
      DECORATION: "🎨 ตกแต่ง",
      PRINTING: "🖨 สิ่งพิมพ์",
      TRANSPORT: "🚌 ขนส่ง",
      PHOTOGRAPHER: "📷 ช่างภาพ",
      BOOTH: "🏪 บูธ",
      GIFT: "🎁 ของขวัญ",
      OTHER: "📌 อื่นๆ",
    }[t] || t
  );
}
function supStatusLabel(s) {
  return (
    {
      PENDING: "⏳ รอดำเนินการ",
      CONFIRMED: "✅ ยืนยัน",
      PAID: "💳 ชำระแล้ว",
      CANCELLED: "❌ ยกเลิก",
    }[s] || s
  );
}
function formatNum(n) {
  return parseFloat(n || 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
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
