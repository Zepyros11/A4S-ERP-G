/* ============================================================
   roles.js — Role & Permission Management
   ============================================================ */
/* global AppPermissions */

const SUPABASE_URL = localStorage.getItem("sb_url") || "";
const SUPABASE_KEY = localStorage.getItem("sb_key") || "";

let roleConfigs  = [];
let selectedRole = null;
let activePerms  = new Set();

/* ── SUPABASE ── */
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

/* ── LOAD ── */
async function loadRoles() {
  showLoading(true);
  try {
    const data = await sbFetch("role_configs", { query: "?select=*&order=sort_order" });
    roleConfigs = data || [];
  } catch (e) {
    showToast("โหลด Role ไม่ได้ ใช้ค่าเริ่มต้น", "warning");
    roleConfigs = buildDefaultRoleConfigs();
  }
  renderRoleList();
  if (roleConfigs.length > 0) selectRole(roleConfigs[0].role_key);
  showLoading(false);
}

function buildDefaultRoleConfigs() {
  return Object.entries(AppPermissions.defaultRoles).map(([key, cfg], i) => ({
    role_key: key,
    label: cfg.label.replace(/^\S+ /, ""),
    icon: cfg.icon,
    color: cfg.color,
    permissions: cfg.perms,
    is_system: true,
    sort_order: i + 1,
  }));
}

/* ── ROLE LIST ── */
function renderRoleList() {
  document.getElementById("roleList").innerHTML = roleConfigs.map((r) => {
    const count = (r.permissions || []).length;
    const total = AppPermissions.allPerms.length;
    const pct   = Math.round((count / total) * 100);
    const isActive = selectedRole === r.role_key;
    return `<div class="role-card ${isActive ? "active" : ""}" onclick="selectRole('${r.role_key}')">
      <div class="role-card-icon">${r.icon || "👤"}</div>
      <div class="role-card-info">
        <div class="role-card-name"><span class="role-badge ${r.color}">${r.icon} ${r.label}</span></div>
        <div class="role-card-count">${count} สิทธิ์ จาก ${total}</div>
        <div class="role-card-bar"><div class="role-card-bar-fill" style="width:${pct}%"></div></div>
      </div>
      ${!r.is_system ? `<button class="btn-icon danger" title="ลบ Role" onclick="deleteRoleCard('${r.role_key}', event)">🗑</button>` : ""}
    </div>`;
  }).join("");
}

/* ── SELECT ROLE ── */
function selectRole(roleKey) {
  selectedRole = roleKey;
  const role = roleConfigs.find((r) => r.role_key === roleKey);
  if (!role) return;

  activePerms = new Set(role.permissions || []);

  renderRoleList();
  document.getElementById("panelEmpty").style.display = "none";
  document.getElementById("panelContent").style.display = "flex";

  document.getElementById("panelTitle").textContent = `${role.icon || ""} ${role.label}`;
  document.getElementById("panelMeta").textContent   = role.is_system ? "Role มาตรฐาน (System)" : "Role กำหนดเอง";

  document.getElementById("permSearch").value = "";
  renderTree();
}

/* ── PERMISSION TREE ── */
function renderTree(filter = "") {
  const q = filter.toLowerCase();
  document.getElementById("permTree").innerHTML = AppPermissions.modules.map((mod) => {
    const visiblePerms = q
      ? mod.perms.filter((p) => p.label.toLowerCase().includes(q))
      : mod.perms;
    if (visiblePerms.length === 0) return "";

    const total   = visiblePerms.length;
    const checked = visiblePerms.filter((p) => activePerms.has(p.key)).length;
    const state   = checked === 0 ? "none" : checked === total ? "all" : "partial";

    const items = visiblePerms.map((p) => {
      const isOn = activePerms.has(p.key);
      return `<label class="tree-item" onclick="togglePerm('${p.key}', '${mod.key}')">
        <div class="tree-cb ${isOn ? "checked" : ""}" id="cb-${p.key}">${isOn ? "✓" : ""}</div>
        <span class="tree-item-label">${p.label}</span>
      </label>`;
    }).join("");

    return `<div class="tree-module">
      <label class="tree-module-hdr" onclick="toggleModule('${mod.key}')">
        <div class="tree-cb mod-cb state-${state}" id="mod-cb-${mod.key}">
          ${state === "all" ? "✓" : state === "partial" ? "◦" : ""}
        </div>
        <span class="mod-icon">${mod.icon}</span>
        <span class="mod-label">${mod.label}</span>
        <span class="mod-count" id="mod-count-${mod.key}">${checked}/${total}</span>
      </label>
      <div class="tree-children">${items}</div>
    </div>`;
  }).join("");

  updateAllCb();
  updateTotalCount();
}

function filterTree() {
  renderTree(document.getElementById("permSearch").value);
}

/* ── TOGGLE PERM ── */
function togglePerm(key, modKey) {
  if (activePerms.has(key)) activePerms.delete(key);
  else activePerms.add(key);

  const cb = document.getElementById(`cb-${key}`);
  if (cb) {
    cb.className = `tree-cb ${activePerms.has(key) ? "checked" : ""}`;
    cb.textContent = activePerms.has(key) ? "✓" : "";
  }
  updateModuleCb(modKey);
  updateAllCb();
  updateTotalCount();
}

/* ── TOGGLE MODULE (select all / none) ── */
function toggleModule(modKey) {
  const mod = AppPermissions.modules.find((m) => m.key === modKey);
  if (!mod) return;

  const q       = document.getElementById("permSearch").value.toLowerCase();
  const visible = q ? mod.perms.filter((p) => p.label.toLowerCase().includes(q)) : mod.perms;
  const checked = visible.filter((p) => activePerms.has(p.key)).length;
  const doCheck = checked < visible.length;

  visible.forEach((p) => {
    if (doCheck) activePerms.add(p.key);
    else activePerms.delete(p.key);
    const cb = document.getElementById(`cb-${p.key}`);
    if (cb) {
      cb.className = `tree-cb ${doCheck ? "checked" : ""}`;
      cb.textContent = doCheck ? "✓" : "";
    }
  });

  updateModuleCb(modKey);
  updateAllCb();
  updateTotalCount();
}

/* ── TOGGLE ALL ── */
function toggleAll() {
  const total   = AppPermissions.allPerms.length;
  const checked = AppPermissions.allPerms.filter((p) => activePerms.has(p.key)).length;
  const doCheck = checked < total;

  AppPermissions.allPerms.forEach((p) => {
    if (doCheck) activePerms.add(p.key);
    else activePerms.delete(p.key);
    const cb = document.getElementById(`cb-${p.key}`);
    if (cb) {
      cb.className = `tree-cb ${doCheck ? "checked" : ""}`;
      cb.textContent = doCheck ? "✓" : "";
    }
  });

  AppPermissions.modules.forEach((m) => updateModuleCb(m.key));
  updateAllCb();
  updateTotalCount();
}

/* ── UPDATE HELPERS ── */
function updateModuleCb(modKey) {
  const mod = AppPermissions.modules.find((m) => m.key === modKey);
  if (!mod) return;
  const total   = mod.perms.length;
  const checked = mod.perms.filter((p) => activePerms.has(p.key)).length;
  const state   = checked === 0 ? "none" : checked === total ? "all" : "partial";

  const modCb = document.getElementById(`mod-cb-${modKey}`);
  if (modCb) {
    modCb.className = `tree-cb mod-cb state-${state}`;
    modCb.textContent = state === "all" ? "✓" : state === "partial" ? "◦" : "";
  }
  const countEl = document.getElementById(`mod-count-${modKey}`);
  if (countEl) countEl.textContent = `${checked}/${total}`;
}

function updateAllCb() {
  const total   = AppPermissions.allPerms.length;
  const checked = AppPermissions.allPerms.filter((p) => activePerms.has(p.key)).length;
  const state   = checked === 0 ? "none" : checked === total ? "all" : "partial";
  const el = document.getElementById("cbAll");
  if (el) {
    el.className = `tree-cb mod-cb state-${state}`;
    el.textContent = state === "all" ? "✓" : state === "partial" ? "◦" : "";
  }
}

function updateTotalCount() {
  const el = document.getElementById("totalCount");
  if (el) el.textContent = `${activePerms.size} / ${AppPermissions.allPerms.length} สิทธิ์`;
}

/* ── SAVE ── */
async function saveRole() {
  if (!selectedRole || !SUPABASE_URL) {
    showToast("กรุณาเชื่อมต่อ Supabase ก่อน", "warning");
    return;
  }
  showLoading(true);
  try {
    await sbFetch("role_configs", {
      method: "PATCH",
      query: `?role_key=eq.${selectedRole}`,
      body: { permissions: [...activePerms], updated_at: new Date().toISOString() },
    });
    const role = roleConfigs.find((r) => r.role_key === selectedRole);
    if (role) role.permissions = [...activePerms];
    renderRoleList();
    showToast("✅ บันทึกสิทธิ์สำเร็จ!", "success");
  } catch (e) {
    showToast("บันทึกไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

/* ── ADD ROLE MODAL ── */
function openAddRole() {
  document.getElementById("newRoleKey").value   = "";
  document.getElementById("newRoleLabel").value = "";
  document.getElementById("newRoleIcon").value  = "👤";
  document.getElementById("addRoleOverlay").classList.add("open");
  setTimeout(() => document.getElementById("newRoleKey").focus(), 100);
}
function closeAddRole() {
  document.getElementById("addRoleOverlay").classList.remove("open");
}
function closeAddRoleBg(e) {
  if (e.target === document.getElementById("addRoleOverlay")) closeAddRole();
}

async function saveNewRole() {
  const roleKey = document.getElementById("newRoleKey").value.trim().toUpperCase();
  const label   = document.getElementById("newRoleLabel").value.trim();
  if (!roleKey || !label) {
    showToast("กรุณากรอก Role Key และชื่อ", "error");
    return;
  }
  if (roleConfigs.find((r) => r.role_key === roleKey)) {
    showToast("Role Key นี้มีอยู่แล้ว", "error");
    return;
  }
  if (!SUPABASE_URL) { showToast("กรุณาเชื่อมต่อ Supabase ก่อน", "warning"); return; }

  const payload = {
    role_key:    roleKey,
    label,
    icon:        document.getElementById("newRoleIcon").value.trim() || "👤",
    color:       document.getElementById("newRoleColor").value,
    permissions: [],
    is_system:   false,
    sort_order:  roleConfigs.length + 1,
  };

  showLoading(true);
  try {
    await sbFetch("role_configs", { method: "POST", body: payload });
    roleConfigs.push(payload);
    closeAddRole();
    renderRoleList();
    selectRole(roleKey);
    showToast("✅ สร้าง Role สำเร็จ!", "success");
  } catch (e) {
    showToast("สร้างไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

/* ── DELETE ROLE ── */
function deleteRoleCard(roleKey, e) {
  e.stopPropagation();
  const role = roleConfigs.find((r) => r.role_key === roleKey);
  DeleteModal.open(`ต้องการลบ Role "${role?.label}"?`, async () => {
    showLoading(true);
    try {
      await sbFetch("role_configs", { method: "DELETE", query: `?role_key=eq.${roleKey}` });
      roleConfigs = roleConfigs.filter((r) => r.role_key !== roleKey);
      if (selectedRole === roleKey) {
        selectedRole = null;
        document.getElementById("panelEmpty").style.display = "flex";
        document.getElementById("panelContent").style.display = "none";
      }
      renderRoleList();
      showToast("ลบ Role แล้ว", "success");
    } catch (e2) {
      showToast("ลบไม่ได้: " + e2.message, "error");
    }
    showLoading(false);
  });
}

/* ── KEYBOARD ── */
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAddRole();
});

/* ── TOAST / LOADING ── */
function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove("show"), 3000);
}
function showLoading(show) {
  document.getElementById("loadingOverlay").classList.toggle("show", show);
}

/* ── INIT ── */
window.addEventListener("DOMContentLoaded", () => {
  if (SUPABASE_URL && SUPABASE_KEY) loadRoles();
  else {
    roleConfigs = buildDefaultRoleConfigs();
    renderRoleList();
    if (roleConfigs.length > 0) selectRole(roleConfigs[0].role_key);
  }
});
