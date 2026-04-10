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
      sbFetch("role_configs", { query: "?select=*&order=sort_order" }).catch(() => null),
    ]);
    /* อัปเดต ROLE_PERMISSIONS จาก Supabase — filter stale keys */
    if (roleData && roleData.length > 0) {
      const validKeys = new Set(AppPermissions.allPermKeys);
      ROLE_PERMISSIONS = {};
      roleData.forEach((r) => {
        ROLE_PERMISSIONS[r.role_key] = {
          label: r.label,
          icon: r.icon || "",
          color: r.color || "role-VIEWER",
          perms: (r.permissions || []).filter(k => validKeys.has(k)),
        };
      });
    }
    populateRoleSelects();
    allUsers = users || [];
    filterTable();
    updateStats();
  } catch (e) {
    showToast("โหลดไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

function populateRoleSelects() {
  const keys = Object.keys(ROLE_PERMISSIONS);
  if (!keys.length) return;

  const buildOption = (k) => {
    const r = ROLE_PERMISSIONS[k];
    const emoji = AppPermissions.iconToEmoji(r.icon);
    const prefix = emoji ? `${emoji}  ` : "";
    return `<option value="${k}">${prefix}${r.label}</option>`;
  };

  /* Modal dropdown (fRole) */
  const fRole = document.getElementById("fRole");
  if (fRole) {
    const cur = fRole.value;
    fRole.innerHTML = keys.map(buildOption).join("");
    if (cur && keys.includes(cur)) fRole.value = cur;
  }

  /* Filter dropdown (filterRole) */
  const filterRole = document.getElementById("filterRole");
  if (filterRole) {
    const cur = filterRole.value;
    filterRole.innerHTML = `<option value="">ทุก Role</option>` +
      keys.map(buildOption).join("");
    if (cur) filterRole.value = cur;
  }
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
  const html = list
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
      <td><span class="role-badge ${role.color}">${AppPermissions.iconToEmoji(role.icon)} ${role.label}</span></td>
      <td><span style="font-size:12.5px;color:var(--text2)">${u.email || "—"}</span></td>
      <td><span class="status-badge ${isActive ? "status-on" : "status-off"}">${isActive ? "● ใช้งาน" : "● ปิด"}</span></td>
      <td class="col-center" onclick="event.stopPropagation()">
        <div class="action-group">
          <button class="btn-icon" data-perm="users_edit" onclick="editUser(${u.user_id})">✏️</button>
          <button class="btn-icon danger" data-perm="users_delete" onclick="deleteUser(${u.user_id})">🗑</button>
        </div>
      </td>
    </tr>`;
    })
    .join("");
  tbody.innerHTML = html;
  /* apply permission filtering on dynamically rendered buttons */
  if (window.AuthZ) window.AuthZ.applyDomPerms(tbody);
}


/* ── Helpers to find sub / count states ── */
function _findSub(subKey) {
  for (const m of AppPermissions.modules) {
    const s = m.children.find(c => c.key === subKey);
    if (s) return { mod: m, sub: s };
  }
  return null;
}
function _modAllPerms(mod) {
  return mod.children.flatMap(c => c.perms);
}

function buildPermToggles(rolePerms, customP = []) {
  customPerms = {};
  customP.forEach(k => customPerms[k] = true);

  document.getElementById("permToggles").innerHTML = AppPermissions.modules.map(mod => {
    const allModPerms = _modAllPerms(mod);
    const modActive = allModPerms.filter(p => rolePerms.includes(p.key) || customPerms[p.key]).length;
    const modState = modActive === 0 ? "none" : modActive === allModPerms.length ? "all" : "partial";
    const modCbTxt = modState === "all" ? "✓" : modState === "partial" ? "—" : "";

    const subsHtml = mod.children.map(sub => {
      const subActive = sub.perms.filter(p => rolePerms.includes(p.key) || customPerms[p.key]).length;
      const subState = subActive === 0 ? "none" : subActive === sub.perms.length ? "all" : "partial";
      const subCbTxt = subState === "all" ? "✓" : subState === "partial" ? "—" : "";

      const items = sub.perms.map(p => {
        const fromRole = rolePerms.includes(p.key);
        const isCustom = !fromRole && !!customPerms[p.key];
        const cbCls = fromRole ? "cb-role" : isCustom ? "cb-custom" : "cb-empty";
        const cbTxt = (fromRole || isCustom) ? "✓" : "";
        return `<div class="tree-item${fromRole ? " tree-from-role" : ""}" onclick="${fromRole ? "" : `toggleTreePerm('${p.key}','${sub.key}','${mod.key}')`}">
          <span class="tree-cb ${cbCls}" id="tcb-${p.key}">${cbTxt}</span>
          <span class="tree-item-label">${p.label}</span>
          ${fromRole ? '<span class="tree-role-tag">Role</span>' : ""}
        </div>`;
      }).join("");

      return `<div class="tree-sub" id="tsub-${sub.key}">
        <div class="tree-sub-hdr">
          <span class="tree-sub-cb state-${subState}" id="subcb-${sub.key}"
            onclick="event.stopPropagation();toggleSubCustom('${sub.key}','${mod.key}')">${subCbTxt}</span>
          <span class="tree-sub-icon">${sub.icon}</span>
          <span class="tree-sub-label" onclick="toggleSubCollapse('${sub.key}')">${sub.label}</span>
          <span class="tree-sub-count" id="subcount-${sub.key}">${subActive}/${sub.perms.length}</span>
          <span class="tree-sub-expand" id="subexp-${sub.key}" onclick="toggleSubCollapse('${sub.key}')">▸</span>
        </div>
        <div class="tree-sub-children collapsed" id="tsubchildren-${sub.key}">${items}</div>
      </div>`;
    }).join("");

    return `<div class="tree-module" id="tmod-${mod.key}">
      <div class="tree-mod-hdr">
        <span class="tree-mod-cb state-${modState}" id="modcb-${mod.key}"
          onclick="event.stopPropagation();toggleModuleCustom('${mod.key}')">${modCbTxt}</span>
        <span class="tree-mod-icon">${mod.icon}</span>
        <span class="tree-mod-label" onclick="toggleModuleCollapse('${mod.key}')">${mod.label}</span>
        <span class="tree-mod-count" id="modcount-${mod.key}">${modActive}/${allModPerms.length}</span>
        <span class="tree-expand-icon" id="expicon-${mod.key}" onclick="toggleModuleCollapse('${mod.key}')">▸</span>
      </div>
      <div class="tree-children collapsed" id="tchildren-${mod.key}">${subsHtml}</div>
    </div>`;
  }).join("");
}

function toggleTreePerm(key, subKey, modKey) {
  customPerms[key] = !customPerms[key];
  const cbEl = document.getElementById(`tcb-${key}`);
  if (cbEl) {
    const isOn = customPerms[key];
    cbEl.className = `tree-cb ${isOn ? "cb-custom" : "cb-empty"}`;
    cbEl.textContent = isOn ? "✓" : "";
  }
  _syncSubCount(subKey);
  _syncModCount(modKey);
}

function toggleSubCustom(subKey, modKey) {
  const found = _findSub(subKey);
  if (!found) return;
  const role = document.getElementById("fRole").value;
  const rolePerms = ROLE_PERMISSIONS[role]?.perms || [];
  const hasOff = found.sub.perms.some(p => !rolePerms.includes(p.key) && !customPerms[p.key]);
  found.sub.perms.forEach(p => {
    if (!rolePerms.includes(p.key)) {
      customPerms[p.key] = hasOff;
      const cbEl = document.getElementById(`tcb-${p.key}`);
      if (cbEl) {
        cbEl.className = `tree-cb ${hasOff ? "cb-custom" : "cb-empty"}`;
        cbEl.textContent = hasOff ? "✓" : "";
      }
    }
  });
  _syncSubCount(subKey);
  _syncModCount(modKey);
}

function toggleModuleCustom(modKey) {
  const mod = AppPermissions.modules.find(m => m.key === modKey);
  if (!mod) return;
  const role = document.getElementById("fRole").value;
  const rolePerms = ROLE_PERMISSIONS[role]?.perms || [];
  const allPerms = _modAllPerms(mod);
  const hasOff = allPerms.some(p => !rolePerms.includes(p.key) && !customPerms[p.key]);
  allPerms.forEach(p => {
    if (!rolePerms.includes(p.key)) {
      customPerms[p.key] = hasOff;
      const cbEl = document.getElementById(`tcb-${p.key}`);
      if (cbEl) {
        cbEl.className = `tree-cb ${hasOff ? "cb-custom" : "cb-empty"}`;
        cbEl.textContent = hasOff ? "✓" : "";
      }
    }
  });
  mod.children.forEach(c => _syncSubCount(c.key));
  _syncModCount(modKey);
}

function toggleModuleCollapse(modKey) {
  const children = document.getElementById(`tchildren-${modKey}`);
  const icon = document.getElementById(`expicon-${modKey}`);
  if (!children) return;
  const collapsed = children.classList.toggle("collapsed");
  if (icon) icon.textContent = collapsed ? "▸" : "▾";
}

function toggleSubCollapse(subKey) {
  const children = document.getElementById(`tsubchildren-${subKey}`);
  const icon = document.getElementById(`subexp-${subKey}`);
  if (!children) return;
  const collapsed = children.classList.toggle("collapsed");
  if (icon) icon.textContent = collapsed ? "▸" : "▾";
}

function _syncSubCount(subKey) {
  const found = _findSub(subKey);
  if (!found) return;
  const role = document.getElementById("fRole").value;
  const rolePerms = ROLE_PERMISSIONS[role]?.perms || [];
  const active = found.sub.perms.filter(p => rolePerms.includes(p.key) || customPerms[p.key]).length;
  const total = found.sub.perms.length;
  const state = active === 0 ? "none" : active === total ? "all" : "partial";
  const txt = state === "all" ? "✓" : state === "partial" ? "—" : "";
  const cb = document.getElementById(`subcb-${subKey}`);
  const cnt = document.getElementById(`subcount-${subKey}`);
  if (cb) { cb.className = `tree-sub-cb state-${state}`; cb.textContent = txt; }
  if (cnt) cnt.textContent = `${active}/${total}`;
}

function _syncModCount(modKey) {
  const mod = AppPermissions.modules.find(m => m.key === modKey);
  if (!mod) return;
  const role = document.getElementById("fRole").value;
  const rolePerms = ROLE_PERMISSIONS[role]?.perms || [];
  const allPerms = _modAllPerms(mod);
  const active = allPerms.filter(p => rolePerms.includes(p.key) || customPerms[p.key]).length;
  const total = allPerms.length;
  const state = active === 0 ? "none" : active === total ? "all" : "partial";
  const txt = state === "all" ? "✓" : state === "partial" ? "—" : "";
  const cb = document.getElementById(`modcb-${mod.key}`);
  const cnt = document.getElementById(`modcount-${mod.key}`);
  if (cb) { cb.className = `tree-mod-cb state-${state}`; cb.textContent = txt; }
  if (cnt) cnt.textContent = `${active}/${total}`;
}

function onRoleChange() {
  const role = document.getElementById("fRole").value;
  const cfg = ROLE_PERMISSIONS[role];
  if (!cfg) return;
  buildPermToggles(
    cfg.perms || [],
    Object.keys(customPerms).filter((k) => customPerms[k]),
  );
}

function generateUserCode() {
  const max = allUsers.reduce((acc, u) => {
    const n = parseInt((u.user_code || "").replace(/\D/g, "")) || 0;
    return Math.max(acc, n);
  }, 0);
  return "EMP" + String(max + 1).padStart(3, "0");
}

function toggleEye(inputId, iconId) {
  const input = document.getElementById(inputId);
  const isText = input.type === "text";
  input.type = isText ? "password" : "text";
  document.getElementById(iconId).textContent = isText ? "👁" : "🙈";
}

async function hashPassword(pwd) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pwd));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function openModal(data = null) {
  const isEdit = !!data;
  document.getElementById("modalTitle").textContent = isEdit ? "แก้ไขผู้ใช้งาน" : "เพิ่มผู้ใช้งานใหม่";
  document.getElementById("editId").value = data?.user_id || "";
  document.getElementById("fFullName").value = data?.full_name || "";
  document.getElementById("fUserCode").value = data?.user_code || (isEdit ? "" : generateUserCode());
  document.getElementById("fUsername").value = data?.username || "";
  document.getElementById("fPassword").value = "";
  document.getElementById("fPasswordConfirm").value = "";
  document.getElementById("fEmail").value = data?.email || "";
  document.getElementById("fPhone").value = data?.phone || "";
  document.getElementById("fStatus").value = data
    ? String(data.is_active !== false)
    : "true";
  const roleKeys = Object.keys(ROLE_PERMISSIONS);
  const fallbackRole = roleKeys[0] || "VIEWER";
  document.getElementById("fRole").value = (data?.role && ROLE_PERMISSIONS[data.role]) ? data.role : fallbackRole;
  /* แสดง hint เมื่อแก้ไข, ซ่อน * เมื่อ optional */
  document.getElementById("pwdHint").style.display      = isEdit ? "block" : "none";
  document.getElementById("pwdReq").style.display       = isEdit ? "none" : "inline";
  document.getElementById("pwdConfirmReq").style.display = isEdit ? "none" : "inline";
  customPerms = {};
  onRoleChange();
  if (data?.custom_permissions) {
    const validKeys = new Set(AppPermissions.allPermKeys);
    const validCustom = data.custom_permissions.filter(k => validKeys.has(k));
    validCustom.forEach((k) => { customPerms[k] = true; });
    buildPermToggles(
      ROLE_PERMISSIONS[data.role]?.perms || [],
      validCustom,
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

function closeModal() {
  document.getElementById("modalOverlay").classList.remove("open");
}
function closeModalBg(e) {
  if (e.target === document.getElementById("modalOverlay")) closeModal();
}

async function saveUser() {
  const fullName  = document.getElementById("fFullName").value.trim();
  const username  = document.getElementById("fUsername").value.trim();
  const password  = document.getElementById("fPassword").value;
  const confirmPw = document.getElementById("fPasswordConfirm").value;
  const editId    = document.getElementById("editId").value;

  if (!fullName || !username) {
    showToast("กรุณากรอกชื่อ-นามสกุล และ Username", "error");
    return;
  }
  if (!editId && !password) {
    showToast("กรุณากรอกรหัสผ่าน", "error");
    return;
  }
  if (password && password !== confirmPw) {
    showToast("รหัสผ่านไม่ตรงกัน", "error");
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

  const userCode = document.getElementById("fUserCode").value.trim().toUpperCase();
  if (!userCode) { showToast("กรุณากรอกรหัสพนักงาน", "error"); return; }

  const payload = {
    full_name: fullName,
    username,
    user_code: userCode,
    email: document.getElementById("fEmail")?.value.trim() || null,
    phone: document.getElementById("fPhone")?.value.trim() || null,
    role,
    custom_permissions: extras.length ? extras : null,
    is_active: document.getElementById("fStatus").value === "true",
    ...(password ? { password_hash: await hashPassword(password) } : {}),
  };

  showLoading(true);
  try {
    if (editId) {
      await sbFetch("users", {
        method: "PATCH",
        query: `?user_id=eq.${editId}`,
        body: payload,
      });
      /* อัปเดต session ถ้าแก้ไขตัวเอง */
      const currentUser = window.ERP_USER;
      if (currentUser && String(currentUser.user_id) === String(editId)) {
        const updated = { ...currentUser, full_name: fullName, username, role, email: payload.email };
        if (localStorage.getItem("erp_session")) localStorage.setItem("erp_session", JSON.stringify(updated));
        if (sessionStorage.getItem("erp_session")) sessionStorage.setItem("erp_session", JSON.stringify(updated));
        window.ERP_USER = updated;
        closeModal();
        await loadData();
        showToast("✅ แก้ไขผู้ใช้สำเร็จ! กำลัง reload...", "success");
        setTimeout(() => location.reload(), 1200);
        showLoading(false);
        return;
      }
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
  populateRoleSelects();
  onRoleChange();
  if (SUPABASE_URL && SUPABASE_KEY) setTimeout(() => loadData(), 50);
});

window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (document.getElementById("modalOverlay").classList.contains("open")) {
    closeModal();
  }
});
