/* ============================================================
   requisition-list.js - Requisition List
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

async function fetchRequisitions() {
  return (
    sbFetch(
      "requisitions",
      "?select=req_id,req_number,req_date,dept_id,warehouse_id,purpose_id,requested_by,approved_by,status,note,created_at&order=req_id.desc"
    ) || []
  );
}

async function fetchDepartments() {
  return (
    sbFetch(
      "departments",
      "?select=dept_id,dept_code,dept_name&order=sort_order,dept_code"
    ) || []
  );
}

async function fetchPurposes() {
  return (
    sbFetch(
      "requisition_purposes",
      "?select=purpose_id,purpose_code,purpose_name,purpose_type&is_active=eq.true"
    ) || []
  );
}

async function fetchUsers() {
  return (
    sbFetch(
      "users",
      "?select=user_id,full_name&is_active=eq.true&order=full_name"
    ) || []
  );
}

async function fetchReqItems() {
  return sbFetch("requisition_items", "?select=req_id,product_id,qty_requested") || [];
}

async function fetchProducts() {
  return (
    sbFetch("products", "?select=product_id,product_name,product_code") || []
  );
}

// คำนวณ on-hand ปัจจุบันสำหรับ (product_id, warehouse_id) จาก stock_movements
// คืน Map: { productId: qty }
async function fetchOnHandForItems(warehouseId, productIds) {
  if (!productIds.length) return new Map();
  const inList = productIds.join(",");
  const moves = await sbFetch(
    "stock_movements",
    `?warehouse_id=eq.${warehouseId}&product_id=in.(${inList})&select=product_id,movement_type,qty`
  );
  const map = new Map();
  (moves || []).forEach((m) => {
    const sign = m.movement_type === "OUT" || m.movement_type === "INTERNAL" ? -1 : 1;
    const cur = map.get(m.product_id) || 0;
    map.set(m.product_id, cur + sign * (parseFloat(m.qty) || 0));
  });
  return map;
}

// ตรวจ stock พอจะหักทุก item ของ REQ ไหม — return { ok, shortages: [{name, requested, available, short}] }
async function checkStockAvailable(warehouseId, items, productsMap) {
  const pids = [...new Set(items.map((it) => it.product_id))];
  const onHand = await fetchOnHandForItems(warehouseId, pids);
  // รวม qty per product (ถ้ามีหลาย row product เดียวกัน)
  const reqByPid = new Map();
  items.forEach((it) => {
    reqByPid.set(it.product_id, (reqByPid.get(it.product_id) || 0) + (parseFloat(it.qty_requested) || 0));
  });
  const shortages = [];
  for (const [pid, requested] of reqByPid) {
    const available = onHand.get(pid) || 0;
    if (requested > available) {
      const p = productsMap?.get(String(pid)) || productsMap?.get(pid);
      shortages.push({
        product_id: pid,
        name: p?.product_name || `Product #${pid}`,
        requested,
        available,
        short: requested - available,
      });
    }
  }
  return { ok: shortages.length === 0, shortages };
}

const state = {
  reqs: [],
  depts: [],
  purposes: [],
  users: [],
  reqItems: [],
  products: [],
  selected: null,
};

const STATUS_META = {
  DRAFT:     { label: "Draft",             cls: "status-draft"     },
  PENDING:   { label: "รออนุมัติ",        cls: "status-pending"   },
  APPROVED:  { label: "อนุมัติแล้ว",       cls: "status-approved"  },
  ISSUED:    { label: "จ่ายของออกแล้ว",   cls: "status-issued"    },
  CANCELLED: { label: "ยกเลิก",            cls: "status-cancelled" },
};

function getStatusMeta(status) {
  return (
    STATUS_META[String(status || "").toUpperCase()] || {
      label: status || "Unknown",
      cls: "status-default",
    }
  );
}

function getDeptName(deptId) {
  return (
    state.depts.find((d) => String(d.dept_id) === String(deptId))?.dept_name ||
    "—"
  );
}

function getPurposeName(purposeId) {
  return (
    state.purposes.find((p) => String(p.purpose_id) === String(purposeId))
      ?.purpose_name || "—"
  );
}

function getUserName(userId) {
  return (
    state.users.find((u) => String(u.user_id) === String(userId))?.full_name ||
    "—"
  );
}

function getReqItemSummary(reqId) {
  const rows = state.reqItems.filter(
    (item) => String(item.req_id) === String(reqId)
  );
  const lineCount = rows.length;
  const qtyTotal = rows.reduce(
    (sum, row) => sum + (parseFloat(row.qty_requested) || 0),
    0
  );
  return { lineCount, qtyTotal };
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function bindEvents() {
  document.getElementById("searchInput")?.addEventListener("input", filterTable);
  document.getElementById("filterStatus")?.addEventListener("change", filterTable);
  document.getElementById("filterDept")?.addEventListener("change", filterTable);
  document.getElementById("filterPurpose")?.addEventListener("change", filterTable);
}

function populateFilters() {
  const deptSel = document.getElementById("filterDept");
  const purposeSel = document.getElementById("filterPurpose");

  if (deptSel) {
    deptSel.innerHTML =
      `<option value="">ทุกแผนก</option>` +
      state.depts
        .map(
          (d) =>
            `<option value="${d.dept_id}">${escapeHtml(d.dept_name)}</option>`
        )
        .join("");
  }

  if (purposeSel) {
    purposeSel.innerHTML =
      `<option value="">ทุกวัตถุประสงค์</option>` +
      state.purposes
        .map(
          (p) =>
            `<option value="${p.purpose_id}">${escapeHtml(p.purpose_name)}</option>`
        )
        .join("");
  }
}

function updateCards() {
  const total = state.reqs.length;
  const pending = state.reqs.filter(
    (r) => String(r.status || "").toUpperCase() === "PENDING"
  ).length;
  const approved = state.reqs.filter(
    (r) => String(r.status || "").toUpperCase() === "APPROVED"
  ).length;
  const items = state.reqItems.length;

  document.getElementById("cardTotal").textContent = total;
  document.getElementById("cardPending").textContent = pending;
  document.getElementById("cardApproved").textContent = approved;
  document.getElementById("cardItems").textContent = items;
}

function filterTable() {
  const q = (document.getElementById("searchInput")?.value || "").trim().toLowerCase();
  const status = document.getElementById("filterStatus")?.value || "";
  const deptId = document.getElementById("filterDept")?.value || "";
  const purposeId = document.getElementById("filterPurpose")?.value || "";

  const rows = state.reqs.filter((req) => {
    const reqNumber = String(req.req_number || "").toLowerCase();
    const deptName = getDeptName(req.dept_id).toLowerCase();
    const userName = getUserName(req.requested_by).toLowerCase();
    const note = String(req.note || "").toLowerCase();
    const matchesQuery =
      !q ||
      reqNumber.includes(q) ||
      deptName.includes(q) ||
      userName.includes(q) ||
      note.includes(q);

    const matchesStatus =
      !status || String(req.status || "").toUpperCase() === status;
    const matchesDept = !deptId || String(req.dept_id) === String(deptId);
    const matchesPurpose =
      !purposeId || String(req.purpose_id) === String(purposeId);

    return matchesQuery && matchesStatus && matchesDept && matchesPurpose;
  });

  renderTable(rows);
}

function renderTable(rows) {
  const tbody = document.getElementById("reqTableBody");
  const countEl = document.getElementById("reqCount");
  if (!tbody) return;

  // permission gates (fallback = true ถ้า AuthZ ไม่ได้โหลด เพื่อไม่ block dev)
  const hasPerm = (k) => (window.AuthZ?.hasPerm ? window.AuthZ.hasPerm(k) : true);
  const canEdit    = hasPerm("req_edit");
  const canDelete  = hasPerm("req_delete");
  const canApprove = hasPerm("req_approve");

  if (countEl) countEl.textContent = `${rows.length} รายการ`;

  if (!rows.length) {
    tbody.innerHTML = `
      <tr class="r-card-plain">
        <td colspan="8">
          <div class="empty-state">
            <div class="empty-state-icon">📋</div>
            <div class="empty-state-title">ไม่พบรายการใบเบิก</div>
            <div class="empty-state-hint">ลองล้างตัวกรองหรือสร้างใบเบิกใหม่</div>
          </div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map((req) => {
      const status = getStatusMeta(String(req.status || "").toUpperCase());
      const deptName = escapeHtml(getDeptName(req.dept_id));
      const purposeName = escapeHtml(getPurposeName(req.purpose_id));
      const userName = escapeHtml(getUserName(req.requested_by));
      const summary = getReqItemSummary(req.req_id);

      return `
        <tr data-req-id="${req.req_id}">
          <td class="r-card-title">
            <div class="req-number">
              <div class="req-number-main">${escapeHtml(req.req_number || "—")}</div>
              <div class="req-number-sub">สร้าง ${escapeHtml(formatDate(req.created_at || req.req_date))}</div>
            </div>
          </td>
          <td data-label="ผู้ขอเบิก">
            <div class="req-requester">
              <div class="req-requester-name">${userName}</div>
            </div>
          </td>
          <td class="col-center" data-label="แผนก"><span class="req-chip">${deptName}</span></td>
          <td class="col-center" data-label="วัตถุประสงค์">${purposeName}</td>
          <td class="col-center" data-label="วันที่เบิก">${escapeHtml(formatDate(req.req_date))}</td>
          <td class="col-center" data-label="จำนวนรายการ">
            <div class="req-items-meta">
              <span class="req-items-count">${summary.lineCount}</span>
              <span class="req-items-qty">${summary.qtyTotal.toLocaleString("th-TH")} ชิ้น</span>
            </div>
          </td>
          <td class="col-center" data-label="สถานะ">
            <span class="status-badge ${status.cls}">${escapeHtml(status.label)}</span>
          </td>
          <td class="col-center" data-label="จัดการ">
            <div class="req-row-actions">
              <button class="req-row-action print" title="พิมพ์" onclick="window.printReq(${req.req_id})">🖨️</button>
              ${(String(req.status || "").toUpperCase() === "DRAFT" && canApprove)
                ? `<button class="req-row-action approve" title="อนุมัติ" onclick="window.approveReq(${req.req_id})">✅</button>`
                : ""}
              ${canEdit
                ? `<button class="req-row-action edit" title="แก้ไข" onclick="window.editReq(${req.req_id})">✏️</button>`
                : ""}
              ${canDelete
                ? `<button class="req-row-action delete" title="ลบ" onclick="window.deleteReq(${req.req_id})">🗑️</button>`
                : ""}
            </div>
          </td>
        </tr>`;
    })
    .join("");
}

function renderNoConfigState() {
  state.reqs = [];
  updateCards();
  document.getElementById("reqTableBody").innerHTML = `
    <tr class="r-card-plain">
      <td colspan="8">
        <div class="empty-state">
          <div class="empty-state-icon">🔌</div>
          <div class="empty-state-title">ยังไม่ได้ตั้งค่า Supabase</div>
          <div class="empty-state-hint">กรุณาตั้งค่าการเชื่อมต่อก่อนโหลดรายการใบเบิก</div>
        </div>
      </td>
    </tr>`;
  document.getElementById("reqCount").textContent = "0 รายการ";
}

async function deleteRequisition(req) {
  showLoading(true);
  const wasApproved = String(req.status || "").toUpperCase() === "APPROVED";
  const summary = getReqItemSummary(req.req_id);
  try {
    // 1) ลบ stock_movements ของ REQ นี้ → on-hand คืนอัตโนมัติ
    //    (stock_balance ใช้ signed sum ของ movements ที่เหลือ — ไม่มี OUT แล้วก็เท่ากับคืน)
    await sbFetch(
      "stock_movements",
      `?ref_doc_type=eq.REQ&ref_doc_id=eq.${req.req_id}`,
      { method: "DELETE" }
    );
    // 2) ลบ requisition_items
    await sbFetch(
      "requisition_items",
      `?req_id=eq.${req.req_id}`,
      { method: "DELETE" }
    );
    // 3) ลบ requisition header (hard delete)
    await sbFetch("requisitions", `?req_id=eq.${req.req_id}`, { method: "DELETE" });

    const returnedMsg = wasApproved && summary.qtyTotal > 0
      ? ` · คืน stock ${summary.qtyTotal.toLocaleString("th-TH")} ชิ้น`
      : "";
    showToast(`ลบ ${req.req_number} สำเร็จ${returnedMsg}`, "success");
    await loadData();
  } catch (e) {
    showToast("ลบไม่สำเร็จ: " + (e.message || e), "error");
  }
  showLoading(false);
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
    const [reqs, depts, purposes, users, reqItems, products] = await Promise.all([
      fetchRequisitions(),
      fetchDepartments(),
      fetchPurposes(),
      fetchUsers(),
      fetchReqItems(),
      fetchProducts(),
    ]);

    state.reqs = reqs || [];
    state.depts = depts || [];
    state.purposes = purposes || [];
    state.users = users || [];
    state.reqItems = reqItems || [];
    state.products = products || [];

    populateFilters();
    updateCards();
    filterTable();
  } catch (error) {
    renderNoConfigState();
    showToast(error.message || "โหลดข้อมูลไม่สำเร็จ", "error");
  }
  showLoading(false);
}

function showToast(message, type = "success") {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.className = `toast toast-${type} show`;
  toast.textContent = message;
  setTimeout(() => toast.classList.remove("show"), 2600);
}

function showLoading(show) {
  document.getElementById("loadingOverlay")?.classList.toggle("show", show);
}

window.editReq = function editReq(reqId) {
  window.location.href = `./requisition-form.html?req_id=${reqId}`;
};

window.printReq = function printReq(reqId) {
  // เปิด popup window — form ใน headless mode (ซ่อน chrome) + auto open preview
  const w = Math.min(960, window.screen.availWidth - 80);
  const h = Math.min(960, window.screen.availHeight - 80);
  const left = (window.screen.availWidth - w) / 2;
  const top = (window.screen.availHeight - h) / 2;
  window.open(
    `./requisition-form.html?req_id=${reqId}&print=1&headless=1`,
    "req-print-" + reqId,
    `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no`
  );
};

window.approveReq = async function approveReq(reqId) {
  const req = state.reqs.find((r) => String(r.req_id) === String(reqId));
  if (!req) return;
  const summary = getReqItemSummary(req.req_id);

  // เตรียมรายชื่อสินค้าที่จะหัก stock
  const rowsOfReq = state.reqItems.filter(
    (it) => String(it.req_id) === String(req.req_id)
  );
  if (!rowsOfReq.length) {
    showToast("ใบนี้ไม่มีรายการสินค้า อนุมัติไม่ได้", "warning");
    return;
  }
  // re-fetch จาก DB กันค่า stale ใน state (เช่น schema เปลี่ยน หลัง deploy)
  let warehouseId = req.warehouse_id;
  if (!warehouseId) {
    try {
      const fresh = await sbFetch(
        "requisitions",
        `?req_id=eq.${req.req_id}&select=warehouse_id`
      );
      warehouseId = fresh?.[0]?.warehouse_id;
    } catch (_) {}
  }
  if (!warehouseId) {
    showToast("ใบนี้ไม่มีข้อมูลคลัง — กรุณาแก้ไขเลือกคลังก่อนอนุมัติ", "error");
    return;
  }
  // ตรวจว่าคลังยัง active อยู่ — ถ้า soft-delete แล้วจะแจ้งให้ user รู้
  try {
    const whCheck = await sbFetch(
      "warehouses",
      `?warehouse_id=eq.${warehouseId}&select=warehouse_name,is_active`
    );
    const wh = whCheck?.[0];
    if (!wh) {
      showToast("คลังของใบเบิกนี้ไม่อยู่ในระบบแล้ว", "error");
      return;
    }
    if (wh.is_active === false) {
      showToast(`คลัง "${wh.warehouse_name}" ถูกปิดใช้งาน — แก้ไขเลือกคลังใหม่ก่อนอนุมัติ`, "error");
      return;
    }
  } catch (_) {}

  // ตรวจ stock ในคลังว่าพอจะหักไหม
  showLoading(true);
  const productsMap = new Map(state.products.map((p) => [String(p.product_id), p]));
  const stockCheck = await checkStockAvailable(warehouseId, rowsOfReq, productsMap);
  showLoading(false);
  if (!stockCheck.ok) {
    const lines = stockCheck.shortages
      .map(
        (s) =>
          `<li>${escapeHtml(s.name)} — ต้องการ <b>${s.requested.toLocaleString("th-TH")}</b> · มี ${s.available.toLocaleString("th-TH")} · <span style="color:#991b1b">ขาด ${s.short.toLocaleString("th-TH")}</span></li>`
      )
      .join("");
    const proceed = await ConfirmModal.open({
      title: "สินค้าไม่พอในคลัง",
      message: `มีสินค้าไม่พอ ${stockCheck.shortages.length} รายการ`,
      icon: "⚠️",
      okText: "อนุมัติต่อ (stock จะติดลบ)",
      cancelText: "ยกเลิก",
      tone: "warning",
      note: `<ul style="margin:6px 0 0 18px;padding:0;font-size:12.5px;line-height:1.7;">${lines}</ul>`,
    });
    if (!proceed) return;
  }
  const productLines = rowsOfReq
    .map((it) => {
      const p = state.products.find(
        (x) => String(x.product_id) === String(it.product_id)
      );
      const name = escapeHtml(p?.product_name || `Product #${it.product_id}`);
      const qty = (parseFloat(it.qty_requested) || 0).toLocaleString("th-TH");
      return `<li>${name} <b>${qty}</b> ชิ้น</li>`;
    })
    .join("");
  const note =
    `📦 stock จะถูกหักจากคลัง <b>${summary.qtyTotal.toLocaleString("th-TH")}</b> ชิ้น ใน ${summary.lineCount} รายการ` +
    `<ul style="margin:6px 0 0 18px;padding:0;font-size:12.5px;line-height:1.7;">${productLines}</ul>`;

  const ok =
    typeof ConfirmModal !== "undefined" && ConfirmModal.open
      ? await ConfirmModal.open({
          title: "ยืนยันอนุมัติใบเบิก",
          message: `อนุมัติใบเบิก ${req.req_number} ?`,
          icon: "✅",
          okText: "อนุมัติ",
          cancelText: "ยกเลิก",
          tone: "success",
          note,
        })
      : window.confirm(`อนุมัติใบเบิก ${req.req_number} ?`);
  if (!ok) return;

  showLoading(true);
  try {
    // re-check status ก่อน approve กัน race condition (user อื่นอาจ approve/cancel ไปแล้ว)
    const cur = await sbFetch(
      "requisitions",
      `?req_id=eq.${req.req_id}&select=status`
    );
    const curStatus = String(cur?.[0]?.status || "").toUpperCase();
    if (curStatus !== "DRAFT" && curStatus !== "PENDING") {
      showToast(`ใบนี้ถูกเปลี่ยนสถานะเป็น "${curStatus}" แล้ว — กรุณา refresh`, "warning");
      showLoading(false);
      await loadData();
      return;
    }

    const approverId = window.ERP_USER?.user_id || null;
    // 1) PATCH header → APPROVED
    await sbFetch("requisitions", `?req_id=eq.${req.req_id}`, {
      method: "PATCH",
      body: {
        status: "APPROVED",
        approved_by: approverId ? parseInt(approverId) : null,
        approved_at: new Date().toISOString(),
      },
    });
    // 2) ลบ stock_movements เดิมของ REQ นี้ (กัน duplicate ถ้าเคยมี — ปกติไม่มี)
    await sbFetch(
      "stock_movements",
      `?ref_doc_type=eq.REQ&ref_doc_id=eq.${req.req_id}`,
      { method: "DELETE" }
    ).catch(() => null);
    // 3) Insert stock_movements OUT per item
    const movedAt = new Date().toISOString();
    for (const it of rowsOfReq) {
      await sbFetch("stock_movements", "", {
        method: "POST",
        body: {
          product_id: parseInt(it.product_id),
          warehouse_id: parseInt(warehouseId),
          movement_type: "OUT",
          qty: parseFloat(it.qty_requested),
          moved_at: movedAt,
          ref_doc_type: "REQ",
          ref_doc_id: req.req_id,
          note: `REQ ${req.req_number}`,
        },
      });
    }
    showToast(
      `✅ อนุมัติ ${req.req_number} สำเร็จ · หัก stock ${summary.qtyTotal.toLocaleString("th-TH")} ชิ้น`,
      "success"
    );
    await loadData();
  } catch (e) {
    showToast("อนุมัติไม่สำเร็จ: " + (e.message || e), "error");
  }
  showLoading(false);
};

window.deleteReq = async function deleteReq(reqId) {
  const req = state.reqs.find((r) => String(r.req_id) === String(reqId));
  if (!req) return;
  const wasApproved = String(req.status || "").toUpperCase() === "APPROVED";
  const summary = getReqItemSummary(req.req_id);

  // สรุปรายชื่อสินค้า + qty ของใบนี้ (ใช้แสดงทั้งกรณี approved/draft)
  const rowsOfReq = state.reqItems.filter(
    (it) => String(it.req_id) === String(req.req_id)
  );
  const productLines = rowsOfReq
    .map((it) => {
      const p = state.products.find(
        (x) => String(x.product_id) === String(it.product_id)
      );
      const name = escapeHtml(p?.product_name || `Product #${it.product_id}`);
      const qty = (parseFloat(it.qty_requested) || 0).toLocaleString("th-TH");
      return `<li>${name} <b>${qty}</b> ชิ้น</li>`;
    })
    .join("");
  const itemsListHtml = productLines
    ? `<ul style="margin:6px 0 0 18px;padding:0;font-size:12.5px;line-height:1.7;">${productLines}</ul>`
    : "";

  const headline = wasApproved && summary.qtyTotal > 0
    ? `🔄 ใบนี้อนุมัติแล้ว — stock จะถูกเอาคืนคลังเดิม <b>${summary.lineCount}</b> รายการ`
    : "⚠️ รายการสินค้าที่เกี่ยวข้องจะถูกลบด้วย (hard delete)";
  const returnHint = headline + itemsListHtml;

  if (typeof ConfirmModal === "undefined" || !ConfirmModal.open) {
    if (window.confirm(`ลบใบเบิก ${req.req_number} ?`)) deleteRequisition(req);
    return;
  }
  const ok = await ConfirmModal.open({
    title: "ยืนยันลบใบเบิก",
    message: `ลบใบเบิก ${req.req_number} ?`,
    icon: "🗑️",
    okText: "ลบ",
    cancelText: "ยกเลิก",
    tone: "danger",
    note: returnHint,
  });
  if (ok) deleteRequisition(req);
};

window.goToREQForm = function goToREQForm() {
  window.location.href = "./requisition-form.html";
};

window.refreshREQList = function refreshREQList() {
  loadData();
};

window.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  await loadData();
});
