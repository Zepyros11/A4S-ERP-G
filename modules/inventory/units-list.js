/* ============================================================
   units-list.js — Master Units settings page
   ============================================================ */

const state = {
  units: [],
  productUnits: [], // เพื่อ count การใช้งาน
  editId: null,
};

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

// ── INIT ───────────────────────────────────────────────────
async function init() {
  const { url, key } = getSB();
  if (!url || !key) {
    showToast("ยังไม่ได้เชื่อมต่อ Supabase", "error");
    return;
  }
  await loadAll();
}

async function loadAll() {
  showLoading(true);
  try {
    const [units, prodUnits] = await Promise.all([
      sbFetch("units", "?select=*&order=unit_name.asc"),
      sbFetch("product_units", "?select=unit_id,unit_name").catch(() => []),
    ]);
    state.units = units || [];
    state.productUnits = prodUnits || [];
    window.filterTable();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

// ── FILTER + RENDER ────────────────────────────────────────
window.filterTable = function () {
  const search =
    document.getElementById("searchInput")?.value.toLowerCase() || "";
  const status = document.getElementById("filterStatus")?.value || "";

  const filtered = state.units.filter((u) => {
    const matchSearch =
      !search || (u.unit_name || "").toLowerCase().includes(search);
    const matchStatus = !status || String(u.is_active) === status;
    return matchSearch && matchStatus;
  });
  renderTable(filtered);
};

function countUsage(unitId, unitName) {
  // นับจาก unit_id ก่อน (ตรงสุด) · fallback ไปนับชื่อสำหรับข้อมูลเก่า (unit_id NULL)
  return state.productUnits.filter(
    (pu) =>
      (pu.unit_id != null && pu.unit_id === unitId) ||
      (pu.unit_id == null && pu.unit_name === unitName),
  ).length;
}

function renderTable(rows) {
  const tbody = document.getElementById("tableBody");
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state">
      <div class="empty-icon">📐</div>
      <div class="empty-text">ไม่พบหน่วยนับ</div>
    </td></tr>`;
    syncSelectAllState();
    return;
  }
  tbody.innerHTML = rows
    .map((u) => {
      const usage = countUsage(u.unit_id, u.unit_name);
      return `<tr>
        <td class="col-center">
          <input type="checkbox" class="row-check" value="${u.unit_id}"
            onchange="window.updateDeleteButton()">
        </td>
        <td><div class="units-name-cell">${escapeHtml(u.unit_name)}</div></td>
        <td class="col-center">
          <span class="units-usage-badge${usage > 0 ? " used" : ""}">${usage} สินค้า</span>
        </td>
        <td class="col-center">
          <label class="switch" onclick="event.stopPropagation()">
            <input type="checkbox" ${u.is_active ? "checked" : ""}
              onchange="window.toggleUnitActive(${u.unit_id}, this)">
            <span class="slider"></span>
          </label>
        </td>
        <td class="col-center">
          <div class="action-group">
            <button class="btn-icon" title="แก้ไข" data-perm="units_edit"
              onclick="window.openUnitModal(${u.unit_id})">✏️</button>
            <button class="btn-icon danger" title="ลบ" data-perm="units_delete"
              onclick="window.deleteUnit(${u.unit_id})">🗑️</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");
  syncSelectAllState();
  window.updateDeleteButton();
  if (window.AuthZ) window.AuthZ.applyDomPerms(tbody);
}

// ── BULK SELECT / DELETE ──────────────────────────────────
function getSelectedUnitIds() {
  return Array.from(document.querySelectorAll(".row-check:checked")).map((c) =>
    parseInt(c.value),
  );
}

function syncSelectAllState() {
  const all = document.querySelectorAll(".row-check");
  const checked = document.querySelectorAll(".row-check:checked");
  const selectAll = document.getElementById("selectAllCheckbox");
  if (!selectAll) return;
  selectAll.checked = all.length > 0 && checked.length === all.length;
  selectAll.indeterminate = checked.length > 0 && checked.length < all.length;
}

window.toggleAllCheckbox = function (el) {
  document
    .querySelectorAll(".row-check")
    .forEach((c) => (c.checked = el.checked));
  window.updateDeleteButton();
};

window.updateDeleteButton = function () {
  const btn = document.getElementById("btnDeleteSelected");
  const ids = getSelectedUnitIds();
  if (btn) {
    btn.style.display = ids.length ? "inline-flex" : "none";
    btn.textContent = `🗑️ ลบที่เลือก (${ids.length})`;
  }
  syncSelectAllState();
};

window.deleteSelectedUnits = function () {
  const ids = getSelectedUnitIds();
  if (!ids.length) return;

  // กัน orphan: ตรวจหน่วยที่ยังถูกใช้
  const inUse = ids.filter((id) => {
    const u = state.units.find((x) => x.unit_id === id);
    return u && countUsage(u.unit_id, u.unit_name) > 0;
  });
  if (inUse.length) {
    showToast(
      `${inUse.length} หน่วยถูกใช้กับสินค้าอยู่ — ปิดใช้งานแทน`,
      "error",
    );
    return;
  }

  const opener = window.DeleteModal?.open || window.ConfirmModal?.open;
  const doDelete = async () => {
    showLoading(true);
    try {
      for (const id of ids) {
        await sbFetch("units", `?unit_id=eq.${id}`, { method: "DELETE" });
      }
      showToast(`ลบ ${ids.length} หน่วยแล้ว`, "success");
      await loadAll();
    } catch (e) {
      showToast("ลบไม่สำเร็จ: " + e.message, "error");
    }
    showLoading(false);
  };
  if (opener) {
    opener(`ต้องการลบ ${ids.length} หน่วย หรือไม่?`, doDelete);
  } else if (confirm(`ลบ ${ids.length} หน่วย?`)) {
    doDelete();
  }
};

// ── MODAL ──────────────────────────────────────────────────
window.openUnitModal = function (unitId) {
  state.editId = unitId || null;
  const u = unitId ? state.units.find((x) => x.unit_id === unitId) : null;

  document.getElementById("unitModalTitle").textContent = u
    ? "แก้ไขหน่วยนับ"
    : "เพิ่มหน่วยนับ";
  document.getElementById("uName").value = u?.unit_name || "";
  document.getElementById("uActive").checked = u ? !!u.is_active : true;

  document.getElementById("unitOverlay").classList.add("open");
  setTimeout(() => document.getElementById("uName").focus(), 50);
};

window.closeUnitModal = function (e) {
  if (e && e.target.id !== "unitOverlay") return;
  document.getElementById("unitOverlay").classList.remove("open");
  state.editId = null;
};

window.saveUnit = async function () {
  const name = document.getElementById("uName").value.trim();
  const isActive = document.getElementById("uActive").checked;

  if (!name) {
    showToast("กรุณากรอกชื่อหน่วย", "error");
    return;
  }

  // กันชื่อซ้ำ (case-insensitive)
  const dup = state.units.find(
    (u) =>
      u.unit_name.toLowerCase() === name.toLowerCase() &&
      u.unit_id !== state.editId,
  );
  if (dup) {
    showToast("ชื่อหน่วยนี้มีอยู่แล้ว", "error");
    return;
  }

  const payload = { unit_name: name, is_active: isActive };
  showLoading(true);
  try {
    if (state.editId) {
      await sbFetch("units", `?unit_id=eq.${state.editId}`, {
        method: "PATCH",
        body: payload,
      });
      showToast("แก้ไขหน่วยแล้ว", "success");
    } else {
      await sbFetch("units", "", { method: "POST", body: payload });
      showToast("เพิ่มหน่วยแล้ว", "success");
    }
    document.getElementById("unitOverlay").classList.remove("open");
    state.editId = null;
    await loadAll();
  } catch (e) {
    showToast("บันทึกไม่ได้: " + e.message, "error");
  }
  showLoading(false);
};

window.toggleUnitActive = async function (unitId, el) {
  const isActive = el.checked;
  try {
    await sbFetch("units", `?unit_id=eq.${unitId}`, {
      method: "PATCH",
      body: { is_active: isActive },
    });
    const u = state.units.find((x) => x.unit_id === unitId);
    if (u) u.is_active = isActive;
    showToast(isActive ? "เปิดใช้งานแล้ว" : "ปิดใช้งานแล้ว", "success");
  } catch (e) {
    showToast("อัปเดตไม่สำเร็จ", "error");
    el.checked = !isActive;
  }
};

window.deleteUnit = function (unitId) {
  const u = state.units.find((x) => x.unit_id === unitId);
  if (!u) return;
  const usage = countUsage(u.unit_id, u.unit_name);
  if (usage > 0) {
    showToast(
      `หน่วย "${u.unit_name}" ถูกใช้กับ ${usage} สินค้า — ปิดใช้งานแทน`,
      "error",
    );
    return;
  }
  const opener = window.DeleteModal?.open || window.ConfirmModal?.open;
  const doDelete = async () => {
    showLoading(true);
    try {
      await sbFetch("units", `?unit_id=eq.${unitId}`, { method: "DELETE" });
      showToast("ลบหน่วยแล้ว", "success");
      await loadAll();
    } catch (e) {
      showToast("ลบไม่ได้: " + e.message, "error");
    }
    showLoading(false);
  };
  if (opener) {
    opener(`ต้องการลบหน่วย "${u.unit_name}" หรือไม่?`, doDelete);
  } else if (confirm(`ลบ "${u.unit_name}"?`)) {
    doDelete();
  }
};

// ── UTILS ──────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? "").replace(/[<>&"']/g, (c) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  if (!t) return;
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove("show"), 3000);
}

function showLoading(show) {
  document.getElementById("loadingOverlay")?.classList.toggle("show", show);
}

// ── START ──────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
