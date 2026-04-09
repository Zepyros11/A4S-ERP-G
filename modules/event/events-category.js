/* ============================================================
   events-category.js — Controller for Event Category page
============================================================ */

// ── STATE ──────────────────────────────────────────────────
let allCategories = [];
let editId = null; // null = สร้างใหม่

// ── INIT ───────────────────────────────────────────────────
async function initPage() {
  await loadData();
  bindEvents();
}

async function loadData() {
  showLoading(true);
  try {
    allCategories = await fetchCategories();
    renderTable(allCategories);
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

// ── BIND EVENTS ────────────────────────────────────────────
function bindEvents() {
  document.getElementById("searchInput")?.addEventListener("input", () => {
    const q = document.getElementById("searchInput").value.toLowerCase();
    const filtered = allCategories.filter(
      (c) =>
        (c.category_name || "").toLowerCase().includes(q) ||
        (c.description || "").toLowerCase().includes(q),
    );
    renderTable(filtered);
  });
}

// ── RENDER TABLE ───────────────────────────────────────────
function renderTable(list) {
  const tbody = document.getElementById("tableBody");
  const countEl = document.getElementById("tableCount");
  if (countEl) countEl.textContent = `${list.length} รายการ`;

  if (!list.length) {
    tbody.innerHTML = `
      <tr><td colspan="6">
        <div class="empty-state">
          <div class="empty-icon">🏷️</div>
          <div class="empty-text">ไม่พบประเภทกิจกรรม</div>
        </div>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = list
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map((c, i) => {
      const icon = c.icon || "🏷️";
      const color = c.color || "#3b82f6";
      const bgColor = color + "22";
      const borderColor = color + "55";

      return `<tr>
        <td style="text-align:center; color:var(--text3); font-size:12px">${i + 1}</td>
        <td>
          <div style="display:flex; align-items:center; gap:10px">
            <span class="ecat-badge"
              style="background:${bgColor}; color:${color}; border-color:${borderColor}">
              ${icon} ${c.category_name}
            </span>
          </div>
        </td>
        <td style="font-size:13px; color:var(--text2)">${c.description || "—"}</td>
        <td class="col-center">
          <div class="ecat-icon-wrap">
            <span class="ecat-icon-emoji">${icon}</span>
            <span class="ecat-color-dot" style="background:${color}" title="${color}"></span>
          </div>
        </td>
        <td class="col-center">
          <span class="ecat-sort-badge">${c.sort_order ?? 0}</span>
        </td>
        <td class="col-center" onclick="event.stopPropagation()">
          <div class="action-group">
            <button class="btn-icon" onclick="window.openModal(${c.event_category_id})">✏️</button>
            <button class="btn-icon danger" onclick="window.deleteCategory(${c.event_category_id})">🗑</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");
}

// ── MODAL: OPEN ────────────────────────────────────────────
window.openModal = function (id = null) {
  editId = id;

  document.getElementById("modalTitle").textContent = id
    ? "✏️ แก้ไขประเภทกิจกรรม"
    : "➕ เพิ่มประเภทกิจกรรม";

  // Reset form
  document.getElementById("fCatName").value = "";
  document.getElementById("fCatDesc").value = "";
  document.getElementById("fCatIcon").value = "🏷️";
  document.getElementById("emojiPreviewInline").textContent = "🏷️";
  document.getElementById("fCatColor").value = "#3b82f6";
  document.getElementById("fCatColorHex").value = "#3b82f6";
  document.getElementById("fCatSort").value = "0";

  if (id) {
    const c = allCategories.find((x) => x.event_category_id === id);
    if (c) {
      document.getElementById("fCatName").value = c.category_name || "";
      document.getElementById("fCatDesc").value = c.description || "";
      document.getElementById("fCatIcon").value = c.icon || "🏷️";
      document.getElementById("emojiPreviewInline").textContent =
        c.icon || "🏷️";
      document.getElementById("fCatColor").value = c.color || "#3b82f6";
      document.getElementById("fCatColorHex").value = c.color || "#3b82f6";
      document.getElementById("fCatSort").value = c.sort_order ?? 0;
    }
  }

  // trigger preview
  document.dispatchEvent(new Event("input"));

  document.getElementById("catModalOverlay").classList.add("show");
  const modal = document.getElementById("catModal");
  modal.style.display = "block";
  requestAnimationFrame(() => modal.classList.add("show"));
  document.getElementById("fCatName").focus();
};

// ── MODAL: CLOSE ───────────────────────────────────────────
window.closeModal = function () {
  document.getElementById("catModalOverlay").classList.remove("show");
  const modal = document.getElementById("catModal");
  modal.classList.remove("show");
  setTimeout(() => (modal.style.display = "none"), 180);
  editId = null;
};

// ── SYNC COLOR HEX INPUT → COLOR PICKER ───────────────────
window.syncColorHex = function (input) {
  const val = input.value;
  if (/^#[0-9a-fA-F]{6}$/.test(val)) {
    document.getElementById("fCatColor").value = val;
  }
};

window.saveCategory = async function () {
  const name = document.getElementById("fCatName").value.trim();
  if (!name) {
    showToast("กรุณาระบุชื่อประเภท", "error");
    return;
  }

  const payload = {
    category_name: name,
    description: document.getElementById("fCatDesc").value.trim() || null,
    icon: document.getElementById("fCatIcon").value.trim() || "🏷️",
    color: document.getElementById("fCatColor").value || "#3b82f6",
    sort_order: parseInt(document.getElementById("fCatSort").value) || 0,
  };

  // spinner on
  document.getElementById("saveSpinner").style.display = "inline-block";
  document.getElementById("saveIcon").style.display = "none";
  document.getElementById("btnSaveCat").disabled = true;

  try {
    if (editId) {
      await updateCategory(editId, payload);
      showToast("แก้ไขประเภทแล้ว", "success");
    } else {
      await createCategory(payload);
      showToast("เพิ่มประเภทแล้ว", "success");
    }
    window.closeModal();
    await loadData();
  } catch (err) {
    showToast("บันทึกไม่สำเร็จ: " + err.message, "error");
  }

  // spinner off
  document.getElementById("saveSpinner").style.display = "none";
  document.getElementById("saveIcon").style.display = "inline";
  document.getElementById("btnSaveCat").disabled = false;
};
// ── DELETE ─────────────────────────────────────────────────
window.deleteCategory = function (id) {
  const c = allCategories.find((x) => x.event_category_id === id);
  if (!c) return;
  DeleteModal.open(
    `ต้องการลบประเภท "${c.category_name}" หรือไม่?`,
    async () => {
      showLoading(true);
      try {
        await removeCategory(id);
        showToast("ลบประเภทแล้ว", "success");
        await loadData();
      } catch (err) {
        showToast("ลบไม่สำเร็จ: " + err.message, "error");
      }
      showLoading(false);
    },
  );
};

// ── API ────────────────────────────────────────────────────
function getSB() {
  return {
    url: localStorage.getItem("sb_url") || "",
    key: localStorage.getItem("sb_key") || "",
  };
}

async function sbFetch(path, opts = {}) {
  const { url, key } = getSB();
  const { method = "GET", body } = opts;
  const res = await fetch(`${url}/rest/v1/${path}`, {
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
    throw new Error(e.message || "API Error");
  }
  return method === "DELETE" ? null : res.json().catch(() => null);
}

async function fetchCategories() {
  return (
    (await sbFetch(
      "event_categories?select=*&order=sort_order.asc,category_name.asc",
    )) || []
  );
}

async function createCategory(data) {
  const res = await sbFetch("event_categories", { method: "POST", body: data });
  return res?.[0];
}

async function updateCategory(id, data) {
  return sbFetch(`event_categories?event_category_id=eq.${id}`, {
    method: "PATCH",
    body: data,
  });
}

async function removeCategory(id) {
  return sbFetch(`event_categories?event_category_id=eq.${id}`, {
    method: "DELETE",
  });
}

// ── UTILS ──────────────────────────────────────────────────
function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove("show"), 3000);
}

function showLoading(show) {
  document.getElementById("loadingOverlay").classList.toggle("show", show);
}

// ── START ──────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPage);
} else {
  initPage();
}
