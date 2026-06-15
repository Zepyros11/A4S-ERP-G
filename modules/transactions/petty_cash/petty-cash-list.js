/* ============================================================
   petty-cash-list.js — รายการสมุดเงินสดย่อย (Petty Cash)
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
      Prefer: method === "POST" || method === "PATCH" ? "return=representation" : "",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "โหลดข้อมูลไม่สำเร็จ");
  }
  return method === "DELETE" ? null : res.json().catch(() => null);
}

// ============================================================
// STATE
// ============================================================
let books = [];                  // petty_cash_books
let itemStats = {};              // { book_id: { count, totalOut } }
const selected = new Set();      // book_id ที่ติ๊กเลือก

// ============================================================
// LOAD
// ============================================================
async function loadAll() {
  showLoading(true);
  try {
    const [bookRows, itemRows] = await Promise.all([
      sbFetch("petty_cash_books", "?select=*&order=book_id.desc"),
      sbFetch("petty_cash_items", "?select=book_id,amount_out"),
    ]);
    books = bookRows || [];

    // aggregate item count + total out per book
    itemStats = {};
    (itemRows || []).forEach((it) => {
      const s = (itemStats[it.book_id] ||= { count: 0, totalOut: 0 });
      s.count += 1;
      s.totalOut += parseFloat(it.amount_out) || 0;
    });

    renderStats();
    applyFilter();
  } catch (e) {
    showToast("โหลดข้อมูลไม่สำเร็จ: " + e.message, "error");
    document.getElementById("tableBody").innerHTML =
      `<tr><td colspan="9"><div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-title">${escapeHtml(e.message)}</div></div></td></tr>`;
  }
  showLoading(false);
}

function renderStats() {
  const total = books.length;
  const draft = books.filter((b) => String(b.status).toUpperCase() !== "FINAL").length;
  const final = total - draft;
  const amount = Object.values(itemStats).reduce((a, s) => a + s.totalOut, 0);
  document.getElementById("cardTotal").textContent = total.toLocaleString("th-TH");
  document.getElementById("cardDraft").textContent = draft.toLocaleString("th-TH");
  document.getElementById("cardFinal").textContent = final.toLocaleString("th-TH");
  document.getElementById("cardAmount").textContent = fmtMoney(amount);
}

// ============================================================
// RENDER TABLE
// ============================================================
function applyFilter() {
  const q = (document.getElementById("searchInput").value || "").trim().toLowerCase();
  const status = document.getElementById("filterStatus").value;
  let rows = books.slice();
  if (status) rows = rows.filter((b) => (String(b.status).toUpperCase() === "FINAL" ? "FINAL" : "DRAFT") === status);
  if (q) {
    rows = rows.filter(
      (b) =>
        (b.book_no || "").toLowerCase().includes(q) ||
        (b.title || "").toLowerCase().includes(q) ||
        (b.prepared_by || "").toLowerCase().includes(q),
    );
  }
  renderTable(rows);
}

function renderTable(rows) {
  const tbody = document.getElementById("tableBody");
  document.getElementById("rowCount").textContent = `${rows.length.toLocaleString("th-TH")} รายการ`;

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state">
      <div class="empty-state-icon">🧾</div>
      <div class="empty-state-title">ไม่พบรายการ Petty Cash</div>
      <div class="empty-state-sub">ลองล้างตัวกรองหรือสร้างรายการใหม่</div>
    </div></td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map((b) => {
      const st = String(b.status).toUpperCase() === "FINAL" ? "final" : "draft";
      const stLabel = st === "final" ? "เสร็จสมบูรณ์" : "ฉบับร่าง";
      const s = itemStats[b.book_id] || { count: 0, totalOut: 0 };
      const range = fmtRange(b.date_from, b.date_to);
      const checked = selected.has(b.book_id) ? "checked" : "";
      return `
      <tr class="is-clickable" data-id="${b.book_id}" onclick="openBook(${b.book_id})">
        <td class="col-check" onclick="event.stopPropagation()">
          <input type="checkbox" class="pc-check row-check" data-id="${b.book_id}" ${checked} onclick="toggleSelect(${b.book_id}, this)" />
        </td>
        <td><span class="pc-no">${escapeHtml(b.book_no || "—")}</span></td>
        <td>
          <div class="pc-title-main">${escapeHtml(b.title || "— ไม่มีชื่อรอบ —")}</div>
          ${b.note ? `<div class="pc-title-sub">${escapeHtml(b.note)}</div>` : ""}
        </td>
        <td class="col-center">${range}</td>
        <td>${escapeHtml(b.prepared_by || "—")}</td>
        <td class="col-center">${s.count.toLocaleString("th-TH")}</td>
        <td class="col-right"><span class="pc-amount">${fmtMoney(s.totalOut)}</span></td>
        <td class="col-center"><span class="pc-badge ${st}">${stLabel}</span></td>
        <td class="col-center" onclick="event.stopPropagation()">
          <div class="pc-row-actions">
            <button class="pc-icon-btn" data-perm="petty_cash_edit" title="เปิด/แก้ไข" onclick="openBook(${b.book_id})">✏️</button>
            <button class="pc-icon-btn danger" data-perm="petty_cash_delete" title="ลบ" onclick="deleteBook(${b.book_id})">🗑</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");

  // ซ่อนปุ่มตามสิทธิ์
  if (window.AuthZ?.applyDomPerms) window.AuthZ.applyDomPerms(tbody);
  syncCheckAll();
}

// ============================================================
// SELECTION / BULK DELETE
// ============================================================
function toggleSelect(id, el) {
  if (el.checked) selected.add(id);
  else selected.delete(id);
  renderBulkBar();
  syncCheckAll();
}

function toggleSelectAll(el) {
  document.querySelectorAll(".row-check").forEach((cb) => {
    const id = parseInt(cb.dataset.id, 10);
    cb.checked = el.checked;
    if (el.checked) selected.add(id);
    else selected.delete(id);
  });
  renderBulkBar();
}

function syncCheckAll() {
  const all = document.querySelectorAll(".row-check");
  const checkAll = document.getElementById("checkAll");
  if (!checkAll) return;
  checkAll.checked = all.length > 0 && [...all].every((cb) => cb.checked);
}

function clearSelection() {
  selected.clear();
  document.querySelectorAll(".row-check").forEach((cb) => (cb.checked = false));
  const checkAll = document.getElementById("checkAll");
  if (checkAll) checkAll.checked = false;
  renderBulkBar();
}

function renderBulkBar() {
  const bar = document.getElementById("bulkBar");
  const info = document.getElementById("bulkInfo");
  bar.classList.toggle("show", selected.size > 0);
  info.textContent = `เลือก ${selected.size} รายการ`;
}

async function bulkDelete() {
  if (!selected.size) return;
  const ids = [...selected];
  const ok = await ConfirmModal.open({
    title: "ลบ Petty Cash ที่เลือก",
    message: `ลบทั้งหมด ${ids.length} รายการหรือไม่?`,
    icon: "🗑",
    okText: "ลบ",
    tone: "danger",
    note: "รายการในแต่ละเล่มจะถูกลบทั้งหมด (ย้อนกลับไม่ได้)",
  });
  if (!ok) return;
  showLoading(true);
  try {
    await sbFetch("petty_cash_books", `?book_id=in.(${ids.join(",")})`, { method: "DELETE" });
    selected.clear();
    showToast(`ลบ ${ids.length} รายการแล้ว`, "success");
    await loadAll();
  } catch (e) {
    showToast("ลบไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
}

async function deleteBook(id) {
  const b = books.find((x) => x.book_id === id);
  if (!b) return;
  const ok = await ConfirmModal.open({
    title: "ลบ Petty Cash",
    message: `ลบ "${b.book_no}${b.title ? " — " + b.title : ""}" หรือไม่?`,
    icon: "🗑",
    okText: "ลบ",
    tone: "danger",
    note: "รายการในเล่มนี้จะถูกลบทั้งหมด (ย้อนกลับไม่ได้)",
  });
  if (!ok) return;
  showLoading(true);
  try {
    await sbFetch("petty_cash_books", `?book_id=eq.${id}`, { method: "DELETE" });
    selected.delete(id);
    showToast("ลบรายการแล้ว", "success");
    await loadAll();
  } catch (e) {
    showToast("ลบไม่สำเร็จ: " + e.message, "error");
  }
  showLoading(false);
}

// ============================================================
// NAV
// ============================================================
window.goToForm = function () {
  window.location.href = "./petty-cash-form.html";
};
function openBook(id) {
  window.location.href = `./petty-cash-form.html?book_id=${id}`;
}

// ============================================================
// UTILS
// ============================================================
function fmtMoney(n) {
  return (parseFloat(n) || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtRange(from, to) {
  const f = from ? window.DateFmt?.formatDMY?.(from) || from : "";
  const t = to ? window.DateFmt?.formatDMY?.(to) || to : "";
  if (f && t) return f === t ? f : `${f} – ${t}`;
  return f || t || "—";
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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

// ============================================================
// INIT
// ============================================================
window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("searchInput").addEventListener("input", applyFilter);
  document.getElementById("filterStatus").addEventListener("change", applyFilter);
  const { url, key } = getSB();
  if (!url || !key) {
    showToast("กรุณาเชื่อมต่อ Supabase ก่อน", "warning");
    document.getElementById("tableBody").innerHTML =
      `<tr><td colspan="9"><div class="empty-state"><div class="empty-state-icon">🔌</div><div class="empty-state-title">ยังไม่ได้เชื่อมต่อ Supabase</div></div></td></tr>`;
    return;
  }
  loadAll();
});
