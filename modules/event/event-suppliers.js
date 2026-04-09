/* ============================================================
   event-suppliers.js — All suppliers cross-event view
============================================================ */

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

async function fetchAllSuppliers() {
  return sbFetch("event_suppliers", "?select=*&order=created_at.desc") || [];
}
async function fetchEvents() {
  return (
    sbFetch(
      "events",
      "?select=event_id,event_name,event_code&order=event_date.desc",
    ) || []
  );
}

// ── STATE ─────────────────────────────────────────────────
let allSuppliers = [];
let allEvents = [];

// ── INIT ──────────────────────────────────────────────────
async function initPage() {
  showLoading(true);
  try {
    const [sups, events] = await Promise.all([
      fetchAllSuppliers(),
      fetchEvents(),
    ]);
    allSuppliers = sups || [];
    allEvents = events || [];

    populateEventFilter();
    updateCards();
    filterTable();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);

  document
    .getElementById("searchInput")
    ?.addEventListener("input", filterTable);
  document
    .getElementById("filterEvent")
    ?.addEventListener("change", filterTable);
  document
    .getElementById("filterServiceType")
    ?.addEventListener("change", filterTable);
  document
    .getElementById("filterSupStatus")
    ?.addEventListener("change", filterTable);
}

function populateEventFilter() {
  const sel = document.getElementById("filterEvent");
  sel.innerHTML = '<option value="">🗓 ทุกกิจกรรม</option>';
  allEvents.forEach((e) =>
    sel.insertAdjacentHTML(
      "beforeend",
      `<option value="${e.event_id}">[${e.event_code}] ${e.event_name}</option>`,
    ),
  );
}

function updateCards() {
  const active = allSuppliers.filter((s) => s.status !== "CANCELLED");
  const paid = allSuppliers.filter((s) => s.status === "PAID");
  const total = active.reduce((sum, s) => sum + parseFloat(s.amount || 0), 0);

  document.getElementById("cardTotal").textContent = allSuppliers.length;
  document.getElementById("cardPaid").textContent = paid.length;
  document.getElementById("cardTotalAmount").textContent =
    `฿${formatNum(total)}`;
}

function filterTable() {
  const search =
    document.getElementById("searchInput")?.value.toLowerCase() || "";
  const eventId = document.getElementById("filterEvent")?.value || "";
  const svcType = document.getElementById("filterServiceType")?.value || "";
  const status = document.getElementById("filterSupStatus")?.value || "";

  const filtered = allSuppliers.filter((s) => {
    const matchSearch =
      !search || (s.supplier_name || "").toLowerCase().includes(search);
    const matchEvent = !eventId || String(s.event_id) === eventId;
    const matchSvcType = !svcType || s.service_type === svcType;
    const matchStatus = !status || s.status === status;
    return matchSearch && matchEvent && matchSvcType && matchStatus;
  });

  renderTable(filtered);
}

function renderTable(list) {
  const tbody = document.getElementById("tableBody");
  const countEl = document.getElementById("tableCount");
  if (countEl) countEl.textContent = `${list.length} รายการ`;

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="6">
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <div class="empty-text">ไม่พบ Vendor</div>
      </div></td></tr>`;
    return;
  }

  tbody.innerHTML = list
    .map((s) => {
      const ev = allEvents.find((e) => e.event_id === s.event_id);
      return `<tr>
      <td>
        <div style="font-weight:600">${s.supplier_name}</div>
        <div style="font-size:11px;color:var(--text3)">${s.detail || ""}</div>
      </td>
      <td class="col-center" style="font-size:12px">
        ${
          ev
            ? `<a href="./event-budget.html?event_id=${ev.event_id}"
          style="color:var(--accent)">${ev.event_code}</a>`
            : "—"
        }
      </td>
      <td class="col-center" style="font-size:12px">
        ${serviceLabel(s.service_type)}
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
    </tr>`;
    })
    .join("");
}

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

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPage);
} else {
  initPage();
}
