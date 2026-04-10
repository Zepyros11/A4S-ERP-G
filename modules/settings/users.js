/* ============================================================
   users.js — Logic สำหรับหน้าจัดการผู้ใช้งาน
   ============================================================ */
/* global AppPermissions */

const SUPABASE_URL = localStorage.getItem("sb_url") || "";
const SUPABASE_KEY = localStorage.getItem("sb_key") || "";

/* ── Role config — โหลดจาก Supabase, fallback เป็น defaultRoles ── */
let ROLE_PERMISSIONS = { ...AppPermissions.defaultRoles };
const ALL_PERMISSIONS = AppPermissions.allPerms;
const AVATAR_COLORS = [
  "#0f4c75",
  "#065f46",
  "#6d28d9",
  "#c2410c",
  "#0e7490",
  "#92400e",
];

let allUsers = [];
let selectedId = null;
let sortKey = "full_name";
let sortAsc = true;
let customPerms = {};

async function sbFetch(table, opts = {}) {
  const { method = "GET", query = "", body } = opts;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    method,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: method === "POST" ? "return=representation" : "",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json()).message || "Error");
  return method !== "DELETE" ? res.json().catch(() => null) : null;
}

async function loadData() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    renderTable([]);
    return;
  }
  showLoading(true);
  try {
    const [users, roleData] = await Promise.all([
      sbFetch("users", { query: "?select=*&order=full_name" }),
      sbFetch("role_configs", { query: "?select=*&order=sort_order" }),
    ]);
    /* อัปเดต ROLE_PERMISSIONS จาก Supabase */
    if (roleData) {
      roleData.forEach((r) => {
        ROLE_PERMISSIONS[r.role_key] = {
          label: `${r.icon || ""} ${r.label}`.trim(),
          color: r.color || "role-VIEWER",
          perms: r.permissions || [],
        };
      });
    }
    allUsers = users || [];
    filterTable();
    updateStats();
  } catch (e) {
    showToast("โหลดไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

function updateStats() {
  document.getElementById("statTotal").textContent = allUsers.length;
  document.getElementById("statAdmin").textContent = allUsers.filter(
    (u) => u.role === "ADMIN",
  ).length;
  document.getElementById("statManager").textContent = allUsers.filter(
    (u) => u.role === "MANAGER",
  ).length;
  document.getElementById("statActive").textContent = allUsers.filter(
    (u) => u.is_active !== false,
  ).length;
  document.getElementById("statInactive").textContent = allUsers.filter(
    (u) => u.is_active === false,
  ).length;
}

function filterTable() {
  const search = document.getElementById("searchInput").value.toLowerCase();
  const role = document.getElementById("filterRole").value;
  const status = document.getElementById("filterStatus").value;
  let list = allUsers.filter((u) => {
    const full =
      `${u.full_name || ""} ${u.username || ""} ${u.email || ""}`.toLowerCase();
    return (
      (!search || full.includes(search)) &&
      (!role || u.role === role) &&
      (status === "" || String(u.is_active !== false) === status)
    );
  });
  list.sort((a, b) => {
    let av = a[sortKey] ?? "",
      bv = b[sortKey] ?? "";
    if (typeof av === "string") av = av.toLowerCase();
    if (typeof bv === "string") bv = bv.toLowerCase();
    return sortAsc ? (av > bv ? 1 : -1) : av < bv ? 1 : -1;
  });
  renderTable(list);
}

function sortBy(key) {
  if (sortKey === key) sortAsc = !sortAsc;
  else {
    sortKey = key;
    sortAsc = true;
  }
  filterTable();
}

function renderTable(list) {
  document.getElementById("tableCount").textContent = `${list.length} รายการ`;
  const tbody = document.getElementById("tableBody");
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">🔍</div><div>ไม่พบผู้ใช้งาน</div></div></td></tr>`;
    return;
  }
  tbody.innerHTML = list
    .map((u) => {
      const role = ROLE_PERMISSIONS[u.role] || {
        label: u.role,
        color: "role-VIEWER",
      };
      const nameParts = (u.full_name || "?").split(" ");
      const initials = (
        nameParts[0][0] + (nameParts[1]?.[0] || "")
      ).toUpperCase();
      const color = AVATAR_COLORS[(u.user_id || 0) % AVATAR_COLORS.length];
      const isActive = u.is_active !== false;
      return `<tr>
      <td><div style="display:flex;align-items:center;gap:10px">
        <div class="avatar" style="background:${color};width:32px;height:32px;font-size:12px">${initials}</div>
        <div style="font-weight:600">${u.full_name || "—"}</div>
      </div></td>
      <td><span style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--text2)">${u.username || "—"}</span></td>
      <td><span class="role-badge ${role.color}">${role.label}</span></td>
      <td><span style="font-size:12.5px;color:var(--text2)">${u.email || "—"}</span></td>
      <td><span class="status-badge ${isActive ? "status-on" : "status-off"}">${isActive ? "● ใช้งาน" : "● ปิด"}</span></td>
      <td class="col-center" onclick="event.stopPropagation()">
        <div class="action-group">
          <button class="btn-icon" onclick="editUser(${u.user_id})">✏️</button>
          <button class="btn-icon danger" onclick="deleteUser(${u.user_id})">🗑</button>
        </div>
      </td>
    </tr>`;
    })
    .join("");
}

function selectUser(id, e) {
  selectedId = id;
  const u = allUsers.find((x) => x.user_id === id);
  if (!u) return;
  document
    .querySelectorAll(".usr-table tr")
    .forEach((r) => r.classList.remove("selected"));
  e.currentTarget.classList.add("selected");

  const nameParts2 = (u.full_name || "?").split(" ");
  const initials = (
    nameParts2[0][0] + (nameParts2[1]?.[0] || "")
  ).toUpperCase();
  const color = AVATAR_COLORS[(u.user_id || 0) % AVATAR_COLORS.length];
  const role = ROLE_PERMISSIONS[u.role] || {
    label: u.role,
    color: "role-VIEWER",
    perms: [],
  };
  const isActive = u.is_active !== false;

  document.getElementById("panelAvatar").textContent = initials;
  document.getElementById("panelAvatar").style.background = color;
  document.getElementById("panelName").textContent = u.full_name || "—";
  document.getElementById("panelUsername").textContent =
    "@" + (u.username || "—");
  document.getElementById("panelRole").innerHTML =
    `<span class="role-badge ${role.color}">${role.label}</span>`;
  document.getElementById("panelStatus").innerHTML =
    `<span class="status-badge ${isActive ? "status-on" : "status-off"}">${isActive ? "● ใช้งาน" : "● ปิด"}</span>`;
  document.getElementById("panelEmail").textContent = u.email || "—";
  document.getElementById("panelPhone").textContent = u.phone || "—";

  const userPerms = new Set([...role.perms, ...(u.custom_permissions || [])]);
  document.getElementById("panelPerms").innerHTML = AppPermissions.modules.map((mod) => {
    const items = mod.perms.map((p) => {
      const has = userPerms.has(p.key);
      return `<div class="perm-item">
        <div class="perm-check ${has ? "perm-on" : "perm-off"}">${has ? "✓" : "—"}</div>
        <span style="font-size:12px;color:${has ? "var(--text)" : "var(--text3)"}">${p.label}</span>
      </div>`;
    }).join("");
    return `<div class="perm-mod-section">
      <div class="perm-mod-title">${mod.icon} ${mod.label}</div>
      <div class="perm-grid">${items}</div>
    </div>`;
  }).join("");

  document.getElementById("sidePanel").classList.add("open");
  document.getElementById("userPanelOverlay").style.display = "block";
}

function closePanel() {
  document.getElementById("sidePanel").classList.remove("open");
  document.getElementById("userPanelOverlay").style.display = "none";
  document
    .querySelectorAll(".usr-table tr")
    .forEach((r) => r.classList.remove("selected"));
  selectedId = null;
}

function buildPermToggles(rolePerms, customP = []) {
  customPerms = {};
  customP.forEach((k) => (customPerms[k] = true));
  document.getElementById("permToggles").innerHTML = AppPermissions.modules.map((mod) => {
    const chips = mod.perms.map((p) => {
      const fromRole = rolePerms.includes(p.key);
      const isCustom = !fromRole && !!customPerms[p.key];
      let cls = "perm-chip";
      let icon = '<span class="perm-chip-icon-off">+</span>';
      let tag = "";
      if (fromRole) {
        cls += " state-role";
        icon = '<span class="perm-chip-icon-check">✓</span>';
        tag = '<span class="perm-chip-tag">Role</span>';
      } else if (isCustom) {
        cls += " state-custom";
        icon = '<span class="perm-chip-icon-check">✓</span>';
      }
      return `<label class="${cls}" id="ptog-${p.key}" onclick="togglePerm('${p.key}',${fromRole})">
        ${icon}
        <span class="perm-chip-label">${p.label}</span>
        ${tag}
      </label>`;
    }).join("");
    return `<div class="perm-module-group">
      <div class="perm-module-header"><span>${mod.icon}</span><span>${mod.label}</span></div>
      <div class="perm-module-chips">${chips}</div>
    </div>`;
  }).join("");
}

function togglePerm(key, fromRole) {
  if (fromRole) return;
  customPerms[key] = !customPerms[key];
  const el = document.getElementById(`ptog-${key}`);
  const isOn = customPerms[key];
  el.className = `perm-chip${isOn ? " state-custom" : ""}`;
  el.querySelector("[class^='perm-chip-icon']").outerHTML = isOn
    ? '<span class="perm-chip-icon-check">✓</span>'
    : '<span class="perm-chip-icon-off">+</span>';
}

function onRoleChange() {
  const role = document.getElementById("fRole").value;
  const cfg = ROLE_PERMISSIONS[role];
  buildPermToggles(
    cfg.perms,
    Object.keys(customPerms).filter((k) => customPerms[k]),
  );
}

function openModal(data = null) {
  document.getElementById("modalTitle").textContent = data
    ? "แก้ไขผู้ใช้งาน"
    : "เพิ่มผู้ใช้งานใหม่";
  document.getElementById("editId").value = data?.user_id || "";
  document.getElementById("fFullName").value = data?.full_name || "";
  document.getElementById("fUsername").value = data?.username || "";
  document.getElementById("fEmail").value = data?.email || "";
  document.getElementById("fPhone").value = data?.phone || "";
  document.getElementById("fStatus").value = data
    ? String(data.is_active !== false)
    : "true";
  document.getElementById("fRole").value = data?.role || "MANAGER";
  customPerms = {};
  onRoleChange();
  if (data?.custom_permissions) {
    data.custom_permissions.forEach((k) => {
      customPerms[k] = true;
    });
    buildPermToggles(
      ROLE_PERMISSIONS[data.role]?.perms || [],
      data.custom_permissions,
    );
  }
  document.getElementById("modalOverlay").classList.add("open");
  setTimeout(() => document.getElementById("fFullName").focus(), 100);
}

function editUser(id) {
  selectedId = id;
  openModal(allUsers.find((u) => u.user_id === id));
}
function deleteUser(id) {
  selectedId = id;
  deleteSelected();
}

function editSelected() {
  if (!selectedId) return;
  openModal(allUsers.find((u) => u.user_id === selectedId));
}
function closeModal() {
  document.getElementById("modalOverlay").classList.remove("open");
}
function closeModalBg(e) {
  if (e.target === document.getElementById("modalOverlay")) closeModal();
}

async function saveUser() {
  const fullName = document.getElementById("fFullName").value.trim();
  const username = document.getElementById("fUsername").value.trim();
  if (!fullName || !username) {
    showToast("กรุณากรอกชื่อ-นามสกุล และ Username", "error");
    return;
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    showToast("กรุณาเชื่อมต่อ Supabase ก่อน", "warning");
    return;
  }

  const role = document.getElementById("fRole").value;
  const rolePerms = ROLE_PERMISSIONS[role]?.perms || [];
  const extras = Object.keys(customPerms).filter(
    (k) => customPerms[k] && !rolePerms.includes(k),
  );

  const payload = {
    full_name: fullName,
    username,
    email: document.getElementById("fEmail")?.value.trim() || null,
    phone: document.getElementById("fPhone")?.value.trim() || null,
    role,
    custom_permissions: extras.length ? extras : null,
    is_active: document.getElementById("fStatus").value === "true",
  };

  showLoading(true);
  try {
    const editId = document.getElementById("editId").value;
    if (editId) {
      await sbFetch("users", {
        method: "PATCH",
        query: `?user_id=eq.${editId}`,
        body: payload,
      });
      showToast("✅ แก้ไขผู้ใช้สำเร็จ!", "success");
    } else {
      await sbFetch("users", { method: "POST", body: payload });
      showToast("✅ เพิ่มผู้ใช้สำเร็จ!", "success");
    }
    closeModal();
    await loadData();
  } catch (e) {
    showToast("เกิดข้อผิดพลาด: " + e.message, "error");
  }
  showLoading(false);
}

function deleteSelected() {
  if (!selectedId) return;
  const u = allUsers.find((x) => x.user_id === selectedId);
  DeleteModal.open(`ต้องการลบผู้ใช้ "${u?.full_name}" ออกจากระบบหรือไม่?`, async () => {
    showLoading(true);
    try {
      await sbFetch("users", {
        method: "DELETE",
        query: `?user_id=eq.${selectedId}`,
      });
      showToast("ลบผู้ใช้แล้ว", "success");
      closePanel();
      await loadData();
    } catch (e) {
      showToast("ลบไม่ได้: " + e.message, "error");
    }
    showLoading(false);
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

window.addEventListener("DOMContentLoaded", () => {
  onRoleChange();
  if (SUPABASE_URL && SUPABASE_KEY) setTimeout(() => loadData(), 50);
});

window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (document.getElementById("modalOverlay").classList.contains("open")) {
    closeModal();
  } else if (document.getElementById("sidePanel").classList.contains("open")) {
    closePanel();
  }
});
