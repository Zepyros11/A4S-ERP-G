/* ============================================================
   roles.js — Role & Permission Management
   ============================================================ */
/* global AppPermissions */

const SUPABASE_URL = localStorage.getItem("sb_url") || "";
const SUPABASE_KEY = localStorage.getItem("sb_key") || "";

let roleConfigs  = [];
let selectedRole = null;
let activePerms  = new Set();
let editingRoleKey = null; /* null = create mode, roleKey = edit mode */

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
  const validKeys = new Set(AppPermissions.allPermKeys);
  const container = document.getElementById("roleList");
  container.innerHTML = roleConfigs.map((r) => {
    const count = (r.permissions || []).filter(k => validKeys.has(k)).length;
    const total = AppPermissions.allPerms.length;
    const pct   = Math.round((count / total) * 100);
    const isActive = selectedRole === r.role_key;
    const editBtn = `<button class="btn-icon" data-perm="roles_edit" title="แก้ไข" onclick="editRoleCard('${r.role_key}', event)">✏️</button>`;
    const delBtn = `<button class="btn-icon danger" data-perm="roles_delete" title="ลบ" onclick="deleteRoleCard('${r.role_key}', event)">🗑</button>`;
    return `<div class="role-card ${isActive ? "active" : ""}" onclick="selectRole('${r.role_key}')">
      <div class="role-card-icon">${AppPermissions.renderIcon(r.icon || "👤", 20)}</div>
      <div class="role-card-info">
        <div class="role-card-name">
          <span class="role-badge ${r.color || "role-VIEWER"}">${r.label}</span>
        </div>
        <div class="role-card-count">${count} / ${total} สิทธิ์</div>
        <div class="role-card-bar"><div class="role-card-bar-fill" style="width:${pct}%"></div></div>
      </div>
      <div class="role-card-actions">${editBtn}${delBtn}</div>
    </div>`;
  }).join("");
  if (window.AuthZ) window.AuthZ.applyDomPerms(container);
}

/* ── SELECT ROLE ── */
function selectRole(roleKey) {
  selectedRole = roleKey;
  const role = roleConfigs.find((r) => r.role_key === roleKey);
  if (!role) return;

  /* filter out stale permission keys ที่ไม่อยู่ใน tree ปัจจุบัน */
  const validKeys = new Set(AppPermissions.allPermKeys);
  activePerms = new Set((role.permissions || []).filter(k => validKeys.has(k)));

  renderRoleList();
  document.getElementById("panelEmpty").style.display = "none";
  document.getElementById("panelContent").style.display = "flex";

  document.getElementById("panelTitle").innerHTML = `${AppPermissions.renderIcon(role.icon || "👤", 20)} ${role.label}`;
  document.getElementById("panelMeta").textContent = role.is_system ? "Role มาตรฐาน (System)" : "Role กำหนดเอง";

  document.getElementById("permSearch").value = "";
  renderTree();
}

/* ── PERMISSION TREE (3-Level) ── */
function renderTree(filter = "") {
  const q = filter.toLowerCase();
  document.getElementById("permTree").innerHTML = AppPermissions.modules.map(mod => {
    /* filter sub-modules */
    const visibleSubs = mod.children.map(sub => {
      const matchSub = !q || sub.label.toLowerCase().includes(q) || mod.label.toLowerCase().includes(q);
      const visiblePerms = matchSub
        ? sub.perms
        : sub.perms.filter(p => p.label.toLowerCase().includes(q));
      return { ...sub, visiblePerms };
    }).filter(sub => sub.visiblePerms.length > 0);

    if (visibleSubs.length === 0) return "";

    /* module-level counts (across all children) */
    const modPerms = visibleSubs.flatMap(s => s.visiblePerms);
    const modTotal = modPerms.length;
    const modChecked = modPerms.filter(p => activePerms.has(p.key)).length;
    const modState = modChecked === 0 ? "none" : modChecked === modTotal ? "all" : "partial";

    /* render sub-modules */
    const subsHtml = visibleSubs.map(sub => {
      const subTotal = sub.visiblePerms.length;
      const subChecked = sub.visiblePerms.filter(p => activePerms.has(p.key)).length;
      const subState = subChecked === 0 ? "none" : subChecked === subTotal ? "all" : "partial";

      const items = sub.visiblePerms.map(p => {
        const isOn = activePerms.has(p.key);
        return `<div class="tree-item" onclick="togglePerm('${p.key}','${sub.key}','${mod.key}')">
          <div class="tree-cb ${isOn ? "checked" : ""}" id="cb-${p.key}">${isOn ? "✓" : ""}</div>
          <span class="tree-item-label">${p.label}</span>
        </div>`;
      }).join("");

      return `<div class="tree-sub" id="rsub-${sub.key}">
        <div class="tree-sub-hdr">
          <div class="tree-cb sub-cb state-${subState}" id="sub-cb-${sub.key}"
            onclick="event.stopPropagation();toggleSub('${sub.key}','${mod.key}')">
            ${subState === "all" ? "✓" : subState === "partial" ? "—" : ""}
          </div>
          <span class="sub-icon">${sub.icon}</span>
          <span class="sub-label" onclick="toggleCollapseSub('${sub.key}')">${sub.label}</span>
          <span class="sub-count" id="sub-count-${sub.key}">${subChecked}/${subTotal}</span>
          <span class="sub-expand" id="sexp-${sub.key}" onclick="toggleCollapseSub('${sub.key}')">▾</span>
        </div>
        <div class="tree-sub-children" id="schildren-${sub.key}">${items}</div>
      </div>`;
    }).join("");

    return `<div class="tree-module" id="rmod-${mod.key}">
      <div class="tree-module-hdr">
        <div class="tree-cb mod-cb state-${modState}" id="mod-cb-${mod.key}"
          onclick="event.stopPropagation();toggleModule('${mod.key}')">
          ${modState === "all" ? "✓" : modState === "partial" ? "—" : ""}
        </div>
        <span class="mod-icon">${mod.icon}</span>
        <span class="mod-label" onclick="toggleCollapseRole('${mod.key}')">${mod.label}</span>
        <span class="mod-count" id="mod-count-${mod.key}">${modChecked}/${modTotal}</span>
        <span class="mod-expand" id="rexp-${mod.key}" onclick="toggleCollapseRole('${mod.key}')">▾</span>
      </div>
      <div class="tree-children" id="rchildren-${mod.key}">${subsHtml}</div>
    </div>`;
  }).join("");

  updateAllCb();
  updateTotalCount();
}

function toggleCollapseRole(modKey) {
  const children = document.getElementById(`rchildren-${modKey}`);
  const icon = document.getElementById(`rexp-${modKey}`);
  if (!children) return;
  const collapsed = children.classList.toggle("collapsed");
  if (icon) icon.textContent = collapsed ? "▸" : "▾";
}

function toggleCollapseSub(subKey) {
  const children = document.getElementById(`schildren-${subKey}`);
  const icon = document.getElementById(`sexp-${subKey}`);
  if (!children) return;
  const collapsed = children.classList.toggle("collapsed");
  if (icon) icon.textContent = collapsed ? "▸" : "▾";
}

function filterTree() {
  renderTree(document.getElementById("permSearch").value);
}

/* ── HELPERS: find sub / mod ── */
function _findSub(subKey) {
  for (const m of AppPermissions.modules) {
    const s = m.children.find(c => c.key === subKey);
    if (s) return { mod: m, sub: s };
  }
  return null;
}

/* ── TOGGLE PERM (level 3) ── */
function togglePerm(key, subKey, modKey) {
  if (activePerms.has(key)) activePerms.delete(key);
  else activePerms.add(key);
  const cb = document.getElementById(`cb-${key}`);
  if (cb) {
    cb.className = `tree-cb ${activePerms.has(key) ? "checked" : ""}`;
    cb.textContent = activePerms.has(key) ? "✓" : "";
  }
  updateSubCb(subKey);
  updateModuleCb(modKey);
  updateAllCb();
  updateTotalCount();
}

/* ── TOGGLE SUB-MODULE (level 2) ── */
function toggleSub(subKey, modKey) {
  const found = _findSub(subKey);
  if (!found) return;
  const checked = found.sub.perms.filter(p => activePerms.has(p.key)).length;
  const doCheck = checked < found.sub.perms.length;
  found.sub.perms.forEach(p => {
    if (doCheck) activePerms.add(p.key);
    else activePerms.delete(p.key);
    const cb = document.getElementById(`cb-${p.key}`);
    if (cb) {
      cb.className = `tree-cb ${doCheck ? "checked" : ""}`;
      cb.textContent = doCheck ? "✓" : "";
    }
  });
  updateSubCb(subKey);
  updateModuleCb(modKey);
  updateAllCb();
  updateTotalCount();
}

/* ── TOGGLE MODULE (level 1) — all perms in all children ── */
function toggleModule(modKey) {
  const mod = AppPermissions.modules.find(m => m.key === modKey);
  if (!mod) return;
  const allPerms = mod.children.flatMap(c => c.perms);
  const checked = allPerms.filter(p => activePerms.has(p.key)).length;
  const doCheck = checked < allPerms.length;
  allPerms.forEach(p => {
    if (doCheck) activePerms.add(p.key);
    else activePerms.delete(p.key);
    const cb = document.getElementById(`cb-${p.key}`);
    if (cb) {
      cb.className = `tree-cb ${doCheck ? "checked" : ""}`;
      cb.textContent = doCheck ? "✓" : "";
    }
  });
  mod.children.forEach(c => updateSubCb(c.key));
  updateModuleCb(modKey);
  updateAllCb();
  updateTotalCount();
}

/* ── TOGGLE ALL ── */
function toggleAll() {
  const total = AppPermissions.allPerms.length;
  const checked = AppPermissions.allPerms.filter(p => activePerms.has(p.key)).length;
  const doCheck = checked < total;
  AppPermissions.allPerms.forEach(p => {
    if (doCheck) activePerms.add(p.key);
    else activePerms.delete(p.key);
    const cb = document.getElementById(`cb-${p.key}`);
    if (cb) {
      cb.className = `tree-cb ${doCheck ? "checked" : ""}`;
      cb.textContent = doCheck ? "✓" : "";
    }
  });
  AppPermissions.modules.forEach(m => {
    m.children.forEach(c => updateSubCb(c.key));
    updateModuleCb(m.key);
  });
  updateAllCb();
  updateTotalCount();
}

/* ── UPDATE HELPERS ── */
function updateSubCb(subKey) {
  const found = _findSub(subKey);
  if (!found) return;
  const total = found.sub.perms.length;
  const checked = found.sub.perms.filter(p => activePerms.has(p.key)).length;
  const state = checked === 0 ? "none" : checked === total ? "all" : "partial";
  const cb = document.getElementById(`sub-cb-${subKey}`);
  if (cb) {
    cb.className = `tree-cb sub-cb state-${state}`;
    cb.textContent = state === "all" ? "✓" : state === "partial" ? "—" : "";
  }
  const countEl = document.getElementById(`sub-count-${subKey}`);
  if (countEl) countEl.textContent = `${checked}/${total}`;
}

function updateModuleCb(modKey) {
  const mod = AppPermissions.modules.find(m => m.key === modKey);
  if (!mod) return;
  const allPerms = mod.children.flatMap(c => c.perms);
  const total = allPerms.length;
  const checked = allPerms.filter(p => activePerms.has(p.key)).length;
  const state = checked === 0 ? "none" : checked === total ? "all" : "partial";
  const modCb = document.getElementById(`mod-cb-${modKey}`);
  if (modCb) {
    modCb.className = `tree-cb mod-cb state-${state}`;
    modCb.textContent = state === "all" ? "✓" : state === "partial" ? "—" : "";
  }
  const countEl = document.getElementById(`mod-count-${modKey}`);
  if (countEl) countEl.textContent = `${checked}/${total}`;
}

function updateAllCb() {
  const total = AppPermissions.allPerms.length;
  const checked = AppPermissions.allPerms.filter(p => activePerms.has(p.key)).length;
  const state = checked === 0 ? "none" : checked === total ? "all" : "partial";
  const el = document.getElementById("cbAll");
  if (el) {
    el.className = `tree-cb mod-cb state-${state}`;
    el.textContent = state === "all" ? "✓" : state === "partial" ? "—" : "";
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

/* ── ICON PICKER (Fluent Emoji Flat — colorful & cute) ── */
const DEFAULT_ICONS = [
  "fluent-emoji-flat:bust-in-silhouette",
  "fluent-emoji-flat:crown",
  "fluent-emoji-flat:office-building",
  "fluent-emoji-flat:factory",
  "fluent-emoji-flat:money-bag",
  "fluent-emoji-flat:eye",
  "fluent-emoji-flat:locked",
  "fluent-emoji-flat:gear",
  "fluent-emoji-flat:key",
  "fluent-emoji-flat:man-office-worker",
  "fluent-emoji-flat:woman-office-worker",
  "fluent-emoji-flat:technologist",
  "fluent-emoji-flat:construction-worker",
  "fluent-emoji-flat:busts-in-silhouette",
  "fluent-emoji-flat:briefcase",
  "fluent-emoji-flat:clipboard",
  "fluent-emoji-flat:chart-increasing",
  "fluent-emoji-flat:trophy",
  "fluent-emoji-flat:star",
  "fluent-emoji-flat:rocket",
  "fluent-emoji-flat:direct-hit",
  "fluent-emoji-flat:department-store",
  "fluent-emoji-flat:delivery-truck",
  "fluent-emoji-flat:package",
  "fluent-emoji-flat:receipt",
  "fluent-emoji-flat:bell",
  "fluent-emoji-flat:light-bulb",
];

let _iconSearchTimer = null;

function renderIconPicker(icons, loading = false) {
  const picker = document.getElementById("iconPicker");
  if (loading) {
    picker.innerHTML = `<div class="icon-picker-loading">⏳ กำลังค้นหา...</div>`;
    return;
  }
  if (!icons.length) {
    picker.innerHTML = `<div class="icon-picker-empty">ไม่พบไอคอน ลองคำอื่น</div>`;
    return;
  }
  const current = document.getElementById("newRoleIcon").value;
  picker.innerHTML = icons.map(ic => {
    const html = AppPermissions.renderIcon(ic, 20);
    return `<div class="icon-opt${ic === current ? " selected" : ""}" title="${ic}" onclick="pickIcon('${ic}')">${html}</div>`;
  }).join("");
}

function pickIcon(icon) {
  document.getElementById("newRoleIcon").value = icon;
  document.getElementById("iconPreview").innerHTML = AppPermissions.renderIcon(icon, 22);
  document.querySelectorAll("#iconPicker .icon-opt").forEach(el => {
    el.classList.toggle("selected", el.getAttribute("title") === icon);
  });
}

async function searchIcons() {
  const q = document.getElementById("iconSearch").value.trim();
  clearTimeout(_iconSearchTimer);
  if (!q) {
    renderIconPicker(DEFAULT_ICONS);
    return;
  }
  _iconSearchTimer = setTimeout(async () => {
    renderIconPicker([], true);
    try {
      /* จำกัดให้ใช้เฉพาะ Fluent Emoji Flat (colorful & cute) */
      const res = await fetch(`https://api.iconify.design/search?query=${encodeURIComponent(q)}&limit=96&prefix=fluent-emoji-flat`);
      const data = await res.json();
      renderIconPicker(data.icons || []);
    } catch (e) {
      renderIconPicker([]);
    }
  }, 300);
}

/* ── ROLE MODAL (create / edit) ── */
function openRoleModal(roleKey = null) {
  editingRoleKey = roleKey;
  const editing = !!roleKey;
  const role = editing ? roleConfigs.find(r => r.role_key === roleKey) : null;

  document.querySelector("#addRoleOverlay .modal-title").textContent =
    editing ? "แก้ไข Role" : "เพิ่ม Role ใหม่";
  document.querySelector("#addRoleOverlay .modal-footer .btn-primary").textContent =
    editing ? "💾 บันทึก" : "สร้าง Role";

  const defaultIcon = role?.icon || "fluent-emoji-flat:bust-in-silhouette";
  document.getElementById("newRoleLabel").value = role?.label || "";
  document.getElementById("newRoleIcon").value  = defaultIcon;
  document.getElementById("newRoleColor").value = role?.color || "role-VIEWER";
  document.getElementById("iconSearch").value   = "";
  document.getElementById("iconPreview").innerHTML = AppPermissions.renderIcon(defaultIcon, 22);
  renderIconPicker(DEFAULT_ICONS);

  document.getElementById("addRoleOverlay").classList.add("open");
  setTimeout(() => document.getElementById("newRoleLabel").focus(), 100);
}

/* Backward-compat alias */
function openAddRole() { openRoleModal(null); }

function editRoleCard(roleKey, e) {
  e.stopPropagation();
  openRoleModal(roleKey);
}

/* auto-generate role key จาก label */
function _generateRoleKey(label) {
  /* แปลงเป็นตัวพิมพ์ใหญ่ เอาเฉพาะ A-Z 0-9 */
  let base = (label || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!base) base = "ROLE";
  /* กัน collision */
  let key = base;
  let i = 2;
  while (roleConfigs.find(r => r.role_key === key)) {
    key = `${base}_${i}`;
    i++;
  }
  return key;
}
function closeAddRole() {
  document.getElementById("addRoleOverlay").classList.remove("open");
}
function closeAddRoleBg(e) {
  if (e.target === document.getElementById("addRoleOverlay")) closeAddRole();
}

async function saveNewRole() {
  const label = document.getElementById("newRoleLabel").value.trim();
  if (!label) {
    showToast("กรุณากรอกชื่อ Role", "error");
    return;
  }
  if (!SUPABASE_URL) { showToast("กรุณาเชื่อมต่อ Supabase ก่อน", "warning"); return; }

  const icon  = document.getElementById("newRoleIcon").value.trim() || "fluent-emoji-flat:bust-in-silhouette";
  const color = document.getElementById("newRoleColor").value;

  showLoading(true);
  try {
    if (editingRoleKey) {
      /* ── EDIT MODE ── */
      await sbFetch("role_configs", {
        method: "PATCH",
        query: `?role_key=eq.${editingRoleKey}`,
        body: { label, icon, color, updated_at: new Date().toISOString() },
      });
      const r = roleConfigs.find(x => x.role_key === editingRoleKey);
      if (r) Object.assign(r, { label, icon, color });
      closeAddRole();
      renderRoleList();
      if (selectedRole === editingRoleKey) selectRole(editingRoleKey);
      showToast("✅ บันทึก Role สำเร็จ!", "success");
    } else {
      /* ── CREATE MODE ── */
      const roleKey = _generateRoleKey(label);
      const payload = {
        role_key:    roleKey,
        label, icon, color,
        permissions: [],
        is_system:   false,
        sort_order:  roleConfigs.length + 1,
      };
      await sbFetch("role_configs", { method: "POST", body: payload });
      roleConfigs.push(payload);
      closeAddRole();
      renderRoleList();
      selectRole(roleKey);
      showToast("✅ สร้าง Role สำเร็จ!", "success");
    }
  } catch (e) {
    showToast("บันทึกไม่ได้: " + e.message, "error");
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
