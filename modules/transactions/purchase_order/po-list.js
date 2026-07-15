/* ============================================================
   po-list.js — Purchase Order List
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
  if (!url || !key) throw new Error("ยังไม่ได้ตั้งค่า Supabase");
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
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "โหลดข้อมูลไม่สำเร็จ");
  }
  return method === "DELETE" ? null : res.json().catch(() => null);
}

async function fetchPOs() {
  return (
    sbFetch(
      "purchase_orders",
      "?select=po_id,po_number,supplier_id,warehouse_id,status,order_date,expected_date,total_amount,created_by,created_at&order=po_id.desc"
    ) || []
  );
}
async function fetchSuppliers() {
  return sbFetch("suppliers", "?select=supplier_id,supplier_name,supplier_code,is_active&order=supplier_name") || [];
}
async function fetchWarehouses() {
  return sbFetch("warehouses", "?select=warehouse_id,warehouse_name,is_active&order=warehouse_name") || [];
}
async function fetchUsers() {
  return sbFetch("users", "?select=user_id,full_name&order=full_name") || [];
}
async function fetchPoItems() {
  return sbFetch("po_items", "?select=po_id,product_id,unit_id,qty_ordered,unit_price,subtotal") || [];
}
async function fetchProducts() {
  return sbFetch("products", "?select=product_id,product_name,product_code") || [];
}

const state = {
  pos: [],
  suppliers: [],
  warehouses: [],
  users: [],
  poItems: [],
  products: [],
};

const STATUS_META = {
  DRAFT:     { label: "Draft",          cls: "status-draft"     },
  APPROVED:  { label: "อนุมัติแล้ว",     cls: "status-approved"  },
  RECEIVED:  { label: "รับของแล้ว",      cls: "status-received"  },
  CANCELLED: { label: "ยกเลิก",          cls: "status-cancelled" },
};

function getStatusMeta(status) {
  return STATUS_META[String(status || "").toUpperCase()] || {
    label: status || "Unknown",
    cls: "status-default",
  };
}

function getSupplierName(id) {
  return state.suppliers.find(s => String(s.supplier_id) === String(id))?.supplier_name || "—";
}
function getWarehouseName(id) {
  return state.warehouses.find(w => String(w.warehouse_id) === String(id))?.warehouse_name || "—";
}
function getUserName(id) {
  return state.users.find(u => String(u.user_id) === String(id))?.full_name || "—";
}
function getPoItemSummary(poId) {
  const rows = state.poItems.filter(it => String(it.po_id) === String(poId));
  const lineCount = rows.length;
  const qtyTotal  = rows.reduce((s, r) => s + (parseFloat(r.qty_ordered) || 0), 0);
  return { lineCount, qtyTotal };
}

function formatCurrency(v) {
  return "฿" + parseFloat(v || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDate(value) {
  if (!value) return "—";
  // มาตรฐานโปรเจกต์ = DD/MM/YYYY (ค.ศ.) ผ่าน window.DateFmt
  if (window.DateFmt?.formatDMY) return window.DateFmt.formatDMY(value) || "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { timeZone: "Asia/Bangkok" });
}
function escapeHtml(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function bindEvents() {
  document.getElementById("searchInput")?.addEventListener("input", filterTable);
  document.getElementById("filterStatus")?.addEventListener("change", filterTable);
  document.getElementById("filterSupplier")?.addEventListener("change", filterTable);
  document.getElementById("filterWarehouse")?.addEventListener("change", filterTable);
}

function populateFilters() {
  const supSel = document.getElementById("filterSupplier");
  const whSel  = document.getElementById("filterWarehouse");
  if (supSel) {
    supSel.innerHTML = `<option value="">🏭 ทุก Supplier</option>` +
      state.suppliers
        .filter(s => s.is_active !== false)
        .map(s => `<option value="${s.supplier_id}">${escapeHtml(s.supplier_name)}</option>`)
        .join("");
  }
  if (whSel) {
    whSel.innerHTML = `<option value="">🏬 ทุกคลัง</option>` +
      state.warehouses
        .filter(w => w.is_active !== false)
        .map(w => `<option value="${w.warehouse_id}">${escapeHtml(w.warehouse_name)}</option>`)
        .join("");
  }
}

function updateCards() {
  const total = state.pos.length;
  const draft = state.pos.filter(p => String(p.status || "").toUpperCase() === "DRAFT").length;
  const approved = state.pos.filter(p => String(p.status || "").toUpperCase() === "APPROVED").length;
  const amount = state.pos.reduce((s, p) => s + (parseFloat(p.total_amount) || 0), 0);
  document.getElementById("cardTotal").textContent    = total;
  document.getElementById("cardDraft").textContent    = draft;
  document.getElementById("cardApproved").textContent = approved;
  document.getElementById("cardAmount").textContent   = formatCurrency(amount);
}

function filterTable() {
  const q = (document.getElementById("searchInput")?.value || "").trim().toLowerCase();
  const status = document.getElementById("filterStatus")?.value || "";
  const supId  = document.getElementById("filterSupplier")?.value || "";
  const whId   = document.getElementById("filterWarehouse")?.value || "";

  const rows = state.pos.filter(po => {
    const num = String(po.po_number || "").toLowerCase();
    const sup = getSupplierName(po.supplier_id).toLowerCase();
    const wh  = getWarehouseName(po.warehouse_id).toLowerCase();
    const matchQ = !q || num.includes(q) || sup.includes(q) || wh.includes(q);
    const matchS = !status || String(po.status || "").toUpperCase() === status;
    const matchSup = !supId || String(po.supplier_id) === String(supId);
    const matchWh  = !whId  || String(po.warehouse_id) === String(whId);
    return matchQ && matchS && matchSup && matchWh;
  });
  renderTable(rows);
}

function renderTable(rows) {
  const tbody = document.getElementById("poTableBody");
  const countEl = document.getElementById("poCount");
  if (!tbody) return;

  const hasPerm = (k) => (window.AuthZ?.hasPerm ? window.AuthZ.hasPerm(k) : true);
  const canEdit    = hasPerm("po_edit");
  const canDelete  = hasPerm("po_delete");
  const canApprove = hasPerm("po_approve");
  const canReceive = hasPerm("po_receive");

  if (countEl) countEl.textContent = `${rows.length} รายการ`;

  if (!rows.length) {
    tbody.innerHTML = `
      <tr class="r-card-plain"><td colspan="9">
        <div class="empty-state">
          <div class="empty-state-icon">🧾</div>
          <div class="empty-state-title">ไม่พบรายการใบสั่งซื้อ</div>
          <div class="empty-state-hint">ลองล้างตัวกรองหรือสร้างใบสั่งซื้อใหม่</div>
        </div>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(po => {
    const status = getStatusMeta(String(po.status || "").toUpperCase());
    const supName = escapeHtml(getSupplierName(po.supplier_id));
    const whName  = escapeHtml(getWarehouseName(po.warehouse_id));
    const creator = escapeHtml(getUserName(po.created_by));
    const sum = getPoItemSummary(po.po_id);
    const st = String(po.status || "").toUpperCase();

    return `
      <tr data-po-id="${po.po_id}">
        <td class="r-card-title">
          <div class="po-number">
            <div class="po-number-main">${escapeHtml(po.po_number || "—")}</div>
            <div class="po-number-sub">สร้าง ${escapeHtml(formatDate(po.created_at || po.order_date))}</div>
          </div>
        </td>
        <td data-label="Supplier">
          <div>
            <div class="po-supplier-name">${supName}</div>
            <div class="po-supplier-meta">ผู้สร้าง: ${creator}</div>
          </div>
        </td>
        <td class="col-center" data-label="คลัง"><span class="po-chip">${whName}</span></td>
        <td class="col-center" data-label="วันที่สั่ง">${escapeHtml(formatDate(po.order_date))}</td>
        <td class="col-center" data-label="กำหนดรับ">${escapeHtml(formatDate(po.expected_date))}</td>
        <td class="col-center" data-label="รายการ">
          <div class="po-items-meta">
            <span class="po-items-count">${sum.lineCount}</span>
            <span class="po-items-qty">${sum.qtyTotal.toLocaleString("th-TH")} ชิ้น</span>
          </div>
        </td>
        <td class="col-center" data-label="ยอดรวม"><span class="po-amount">${formatCurrency(po.total_amount)}</span></td>
        <td class="col-center" data-label="สถานะ"><span class="status-badge ${status.cls}">${escapeHtml(status.label)}</span></td>
        <td class="col-center" data-label="จัดการ">
          <div class="po-row-actions">
            <button class="po-row-action print" title="พิมพ์" onclick="window.printPO(${po.po_id})">🖨️</button>
            ${(st === "DRAFT" && canApprove)
              ? `<button class="po-row-action approve" title="อนุมัติ" onclick="window.approvePO(${po.po_id})">✅</button>` : ""}
            ${(st === "APPROVED" && canReceive)
              ? `<button class="po-row-action receive" title="รับของ" onclick="window.receivePO(${po.po_id})">📦</button>` : ""}
            ${canEdit
              ? `<button class="po-row-action edit" title="แก้ไข" onclick="window.editPO(${po.po_id})">✏️</button>` : ""}
            ${canDelete
              ? `<button class="po-row-action delete" title="ลบ" onclick="window.deletePO(${po.po_id})">🗑️</button>` : ""}
          </div>
        </td>
      </tr>`;
  }).join("");
}

function renderNoConfigState() {
  state.pos = [];
  updateCards();
  document.getElementById("poTableBody").innerHTML = `
    <tr class="r-card-plain"><td colspan="9">
      <div class="empty-state">
        <div class="empty-state-icon">🔌</div>
        <div class="empty-state-title">ยังไม่ได้ตั้งค่า Supabase</div>
        <div class="empty-state-hint">กรุณาตั้งค่าการเชื่อมต่อก่อนโหลดรายการ</div>
      </div>
    </td></tr>`;
  document.getElementById("poCount").textContent = "0 รายการ";
}

async function loadData() {
  const { url, key } = getSB();
  if (!url || !key) {
    renderNoConfigState();
    showToast("ยังไม่ได้ตั้งค่า Supabase", "warning");
    return;
  }
  showLoading(true);
  try {
    const [pos, sups, whs, users, items, products] = await Promise.all([
      fetchPOs(), fetchSuppliers(), fetchWarehouses(), fetchUsers(), fetchPoItems(), fetchProducts(),
    ]);
    state.pos = pos || [];
    state.suppliers = sups || [];
    state.warehouses = whs || [];
    state.users = users || [];
    state.poItems = items || [];
    state.products = products || [];
    populateFilters();
    updateCards();
    filterTable();
  } catch (e) {
    renderNoConfigState();
    showToast(e.message || "โหลดข้อมูลไม่สำเร็จ", "error");
  }
  showLoading(false);
}

function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove("show"), 2600);
}
function showLoading(show) {
  document.getElementById("loadingOverlay")?.classList.toggle("show", show);
}

// ─────────────────────────── ACTIONS ───────────────────────────

window.goToPOForm = function () { window.location.href = "./po-form.html"; };

window.editPO = function (poId) {
  window.location.href = `./po-form.html?po_id=${poId}`;
};

window.printPO = function (poId) {
  const w = Math.min(960, window.screen.availWidth - 80);
  const h = Math.min(960, window.screen.availHeight - 80);
  const left = (window.screen.availWidth - w) / 2;
  const top = (window.screen.availHeight - h) / 2;
  window.open(
    `./po-form.html?po_id=${poId}&print=1&headless=1`,
    "po-print-" + poId,
    `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no`
  );
};

window.approvePO = async function (poId) {
  const po = state.pos.find(p => String(p.po_id) === String(poId));
  if (!po) return;

  // status re-check (concurrent)
  showLoading(true);
  const cur = await sbFetch("purchase_orders", `?po_id=eq.${po.po_id}&select=status`);
  showLoading(false);
  const curStatus = String(cur?.[0]?.status || "").toUpperCase();
  if (curStatus !== "DRAFT") {
    showToast(`ใบนี้สถานะเป็น "${curStatus}" แล้ว — กรุณา refresh`, "warning");
    await loadData();
    return;
  }

  const sum = getPoItemSummary(po.po_id);
  const ok = await ConfirmModal.open({
    title: "ยืนยันอนุมัติใบสั่งซื้อ",
    message: `อนุมัติใบ ${po.po_number} ?`,
    icon: "✅",
    okText: "อนุมัติ",
    cancelText: "ยกเลิก",
    tone: "success",
    note: `📦 มูลค่ารวม <b>${formatCurrency(po.total_amount)}</b> · ${sum.lineCount} รายการ · ${sum.qtyTotal.toLocaleString("th-TH")} ชิ้น`,
  });
  if (!ok) return;

  showLoading(true);
  try {
    await sbFetch("purchase_orders", `?po_id=eq.${po.po_id}`, {
      method: "PATCH",
      body: { status: "APPROVED" },
    });
    showToast(`✅ อนุมัติ ${po.po_number} สำเร็จ — รอรับของ`, "success");
    await loadData();
  } catch (e) {
    showToast("อนุมัติไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

window.receivePO = async function (poId) {
  const po = state.pos.find(p => String(p.po_id) === String(poId));
  if (!po) return;

  // status re-check
  showLoading(true);
  const cur = await sbFetch("purchase_orders", `?po_id=eq.${po.po_id}&select=status,warehouse_id`);
  showLoading(false);
  const curStatus = String(cur?.[0]?.status || "").toUpperCase();
  if (curStatus !== "APPROVED") {
    showToast(`ใบนี้สถานะเป็น "${curStatus}" — รับของได้เฉพาะ APPROVED`, "warning");
    await loadData();
    return;
  }
  const warehouseId = cur?.[0]?.warehouse_id || po.warehouse_id;
  if (!warehouseId) {
    showToast("ใบนี้ไม่มีข้อมูลคลังปลายทาง", "error");
    return;
  }

  const rowsOfPo = state.poItems.filter(it => String(it.po_id) === String(po.po_id));
  if (!rowsOfPo.length) { showToast("ใบนี้ไม่มีรายการสินค้า", "warning"); return; }

  const productsMap = new Map(state.products.map(p => [String(p.product_id), p]));
  const productLines = rowsOfPo.map(it => {
    const p = productsMap.get(String(it.product_id));
    const name = escapeHtml(p?.product_name || `Product #${it.product_id}`);
    const qty = (parseFloat(it.qty_ordered) || 0).toLocaleString("th-TH");
    return `<li>${name} <b>${qty}</b> ชิ้น</li>`;
  }).join("");

  const ok = await ConfirmModal.open({
    title: "ยืนยันรับของ",
    message: `รับของจาก ${po.po_number} เข้าคลัง ${getWarehouseName(warehouseId)} ?`,
    icon: "📦",
    okText: "รับของ",
    cancelText: "ยกเลิก",
    tone: "success",
    note: `📥 stock จะถูกเพิ่มเข้าคลัง <b>${rowsOfPo.length}</b> รายการ` +
          `<ul style="margin:6px 0 0 18px;padding:0;font-size:12.5px;line-height:1.7;">${productLines}</ul>`,
  });
  if (!ok) return;

  showLoading(true);
  try {
    // ลบ stock_movements เดิมของ PO นี้ (กัน duplicate ถ้าเคย received แล้ว reverse กลับ)
    await sbFetch("stock_movements", `?ref_doc_type=eq.PO&ref_doc_id=eq.${po.po_id}`, { method: "DELETE" }).catch(() => null);

    // Insert IN movements + update qty_received
    const movedAt = new Date().toISOString();
    for (const it of rowsOfPo) {
      const qty = parseFloat(it.qty_ordered);
      await sbFetch("stock_movements", "", {
        method: "POST",
        body: {
          product_id: parseInt(it.product_id),
          warehouse_id: parseInt(warehouseId),
          movement_type: "IN",
          qty,
          moved_at: movedAt,
          ref_doc_type: "PO",
          ref_doc_id: po.po_id,
          note: `PO ${po.po_number}`,
        },
      });
      // update qty_received ใน po_items
      await sbFetch("po_items", `?po_item_id=eq.${it.po_item_id || ""}`, {
        method: "PATCH",
        body: { qty_received: qty },
      }).catch(() => null);   // ถ้า po_item_id ไม่มีจะ skip — ไม่ critical
    }

    // PATCH header → RECEIVED
    await sbFetch("purchase_orders", `?po_id=eq.${po.po_id}`, {
      method: "PATCH",
      body: { status: "RECEIVED" },
    });

    showToast(`📦 รับของ ${po.po_number} สำเร็จ — เพิ่ม stock แล้ว`, "success");
    await loadData();
  } catch (e) {
    showToast("รับของไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
};

async function deletePOActual(po) {
  showLoading(true);
  const wasReceived = String(po.status || "").toUpperCase() === "RECEIVED";
  const sum = getPoItemSummary(po.po_id);
  try {
    // 1) ลบ stock_movements ของ PO นี้ → คืน stock ถ้าเคย RECEIVED
    await sbFetch("stock_movements", `?ref_doc_type=eq.PO&ref_doc_id=eq.${po.po_id}`, { method: "DELETE" });
    // 2) ลบ po_items
    await sbFetch("po_items", `?po_id=eq.${po.po_id}`, { method: "DELETE" });
    // 3) ลบ purchase_orders
    await sbFetch("purchase_orders", `?po_id=eq.${po.po_id}`, { method: "DELETE" });
    const reverseMsg = wasReceived && sum.qtyTotal > 0
      ? ` · คืน stock ${sum.qtyTotal.toLocaleString("th-TH")} ชิ้น`
      : "";
    showToast(`ลบ ${po.po_number} สำเร็จ${reverseMsg}`, "success");
    await loadData();
  } catch (e) {
    showToast("ลบไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
}

window.deletePO = async function (poId) {
  const po = state.pos.find(p => String(p.po_id) === String(poId));
  if (!po) return;
  const wasReceived = String(po.status || "").toUpperCase() === "RECEIVED";
  const sum = getPoItemSummary(po.po_id);

  const rowsOfPo = state.poItems.filter(it => String(it.po_id) === String(po.po_id));
  const productLines = rowsOfPo.map(it => {
    const p = state.products.find(x => String(x.product_id) === String(it.product_id));
    const name = escapeHtml(p?.product_name || `Product #${it.product_id}`);
    const qty = (parseFloat(it.qty_ordered) || 0).toLocaleString("th-TH");
    return `<li>${name} <b>${qty}</b> ชิ้น</li>`;
  }).join("");
  const itemsList = productLines
    ? `<ul style="margin:6px 0 0 18px;padding:0;font-size:12.5px;line-height:1.7;">${productLines}</ul>`
    : "";

  const headline = wasReceived && sum.qtyTotal > 0
    ? `🔄 ใบนี้รับของแล้ว — stock จะถูกหักคืนคลังต้นทาง <b>${sum.lineCount}</b> รายการ`
    : "⚠️ รายการสินค้าที่เกี่ยวข้องจะถูกลบด้วย (hard delete)";

  const ok = await ConfirmModal.open({
    title: "ยืนยันลบใบสั่งซื้อ",
    message: `ลบใบสั่งซื้อ ${po.po_number} ?`,
    icon: "🗑️",
    okText: "ลบ",
    cancelText: "ยกเลิก",
    tone: "danger",
    note: headline + itemsList,
  });
  if (ok) deletePOActual(po);
};

window.refreshPOList = function () { loadData(); };

window.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  await loadData();
});
