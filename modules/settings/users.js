/* ============================================================
   users.js — Logic สำหรับหน้าจัดการผู้ใช้งาน
   ============================================================ */
/* global AppPermissions */

const SUPABASE_URL = localStorage.getItem("sb_url") || "";
const SUPABASE_KEY = localStorage.getItem("sb_key") || "";

/* ── Role config — โหลดจาก Supabase, fallback เป็น defaultRoles ── */
let ROLE_PERMISSIONS = { ...AppPermissions.defaultRoles };
const AVATAR_COLORS = [
  "#0f4c75",
  "#065f46",
  "#6d28d9",
  "#c2410c",
  "#0e7490",
  "#92400e",
];

let allUsers = [];
let allDepartments = [];   /* [{dept_id, dept_code, dept_name, sort_order}] */
let selectedId = null;
let sortKey = "full_name";
let sortAsc = true;
/* ── State ของ role slots ในฟอร์ม (รายการ role_keys, slot 0 = role หลัก) ── */
let roleSlots = [];

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
    const [users, roleData, deptData] = await Promise.all([
      sbFetch("users", { query: "?select=*&order=full_name" }),
      sbFetch("role_configs", { query: "?select=*&order=sort_order" }).catch(() => null),
      sbFetch("departments", { query: "?select=*&order=sort_order,dept_code" }).catch(() => null),
    ]);
    allDepartments = deptData || [];
    populateDeptSelect();
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
  /* Filter dropdown (filterRole) */
  const keys = Object.keys(ROLE_PERMISSIONS);
  if (!keys.length) return;
  const buildOption = (k) => {
    const r = ROLE_PERMISSIONS[k];
    const emoji = AppPermissions.iconToEmoji(r.icon);
    const prefix = emoji ? `${emoji}  ` : "";
    return `<option value="${k}">${prefix}${r.label}</option>`;
  };
  const filterRole = document.getElementById("filterRole");
  if (filterRole) {
    const cur = filterRole.value;
    filterRole.innerHTML = `<option value="">ทุก Role</option>` +
      keys.map(buildOption).join("");
    if (cur) filterRole.value = cur;
  }
}

/* ── อ่าน roles จาก user record (รองรับทั้ง roles[] และ role เดี่ยว) ── */
function getUserRoles(u) {
  if (Array.isArray(u?.roles) && u.roles.length) return u.roles.filter(Boolean);
  if (u?.role) return [u.role];
  return [];
}

function updateStats() {
  document.getElementById("statTotal").textContent = allUsers.length;
  document.getElementById("statAdmin").textContent = allUsers.filter(
    (u) => getUserRoles(u).includes("ADMIN"),
  ).length;
  document.getElementById("statManager").textContent = allUsers.filter(
    (u) => getUserRoles(u).includes("MANAGER"),
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
    const roles = getUserRoles(u);
    return (
      (!search || full.includes(search)) &&
      (!role || roles.includes(role)) &&
      (status === "" || String(u.is_active !== false) === status)
    );
  });
  list.sort((a, b) => {
    let av = a[sortKey] ?? "",
      bv = b[sortKey] ?? "";
    if (sortKey === "role") {
      av = getUserRoles(a)[0] || "";
      bv = getUserRoles(b)[0] || "";
    }
    if (sortKey === "department") {
      av = getDeptName(a.department) === "—" ? "zzz" : getDeptName(a.department);
      bv = getDeptName(b.department) === "—" ? "zzz" : getDeptName(b.department);
    }
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
      const userRoles = getUserRoles(u);
      const primaryKey = userRoles[0];
      const primary = ROLE_PERMISSIONS[primaryKey] || {
        label: primaryKey || "—",
        color: "role-VIEWER",
        icon: "",
      };
      const extraCount = userRoles.length - 1;
      const extraTitle = userRoles
        .slice(1)
        .map((k) => ROLE_PERMISSIONS[k]?.label || k)
        .join(", ");
      const firstWord = (u.full_name || "?").trim().split(/\s+/)[0] || "?";
      const initials = firstWord.slice(0, 3).toUpperCase();
      let hash = 0;
      for (let i = 0; i < initials.length; i++) hash = (hash * 31 + initials.charCodeAt(i)) >>> 0;
      const color = AVATAR_COLORS[hash % AVATAR_COLORS.length];
      const isActive = u.is_active !== false;
      const extraBadge = extraCount > 0
        ? ` <span class="role-badge role-VIEWER" title="${extraTitle}" style="font-size:10px">+${extraCount}</span>`
        : "";
      return `<tr>
      <td><div style="display:flex;align-items:center;gap:10px">
        <div class="avatar" style="background:${color};width:32px;height:32px;font-size:10px;letter-spacing:0">${initials}</div>
        <div style="font-weight:600">${u.full_name || "—"}</div>
      </div></td>
      <td><span style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--text2)">${u.username || "—"}</span></td>
      <td><span class="role-badge ${primary.color}">${AppPermissions.iconToEmoji(primary.icon)} ${primary.label}</span>${extraBadge}</td>
      <td><span style="font-size:12.5px;color:var(--text2)">${getDeptName(u.department)}</span></td>
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

/* ============================================================
   Role slots (multi-role per user)
   ============================================================ */
function renderRoleSlots() {
  const container = document.getElementById("roleSlotList");
  if (!container) return;
  const allKeys = Object.keys(ROLE_PERMISSIONS);
  if (!allKeys.length) {
    container.innerHTML = `<div class="form-hint">ยังไม่มี Role ในระบบ — ไปที่หน้า "จัดการ Role" ก่อน</div>`;
    return;
  }
  /* บังคับให้มีอย่างน้อย 1 slot */
  if (!roleSlots.length) roleSlots = [allKeys[0]];

  const buildOptionHtml = (selectedKey) => allKeys.map((k) => {
    const r = ROLE_PERMISSIONS[k];
    const emoji = AppPermissions.iconToEmoji(r.icon);
    const prefix = emoji ? `${emoji}  ` : "";
    const sel = k === selectedKey ? " selected" : "";
    return `<option value="${k}"${sel}>${prefix}${r.label}</option>`;
  }).join("");

  container.innerHTML = roleSlots.map((roleKey, idx) => {
    const isPrimary = idx === 0;
    const numLabel = isPrimary ? "1" : String(idx + 1);
    const numClass = isPrimary ? "role-slot-num is-primary" : "role-slot-num";
    const numTitle = isPrimary ? "Role หลัก (กำหนดหน้าแรก)" : `Role เสริม #${idx}`;
    const removeDisabled = isPrimary && roleSlots.length === 1 ? "disabled" : "";
    return `<div class="role-slot" data-idx="${idx}">
      <span class="${numClass}" title="${numTitle}">${numLabel}</span>
      <select class="form-control" onchange="onRoleSlotChange(${idx}, this.value)">${buildOptionHtml(roleKey)}</select>
      <button type="button" class="role-slot-remove" onclick="removeRoleSlot(${idx})" ${removeDisabled} title="ลบ Role นี้">✕</button>
    </div>`;
  }).join("");

  /* ปิดปุ่ม "+ เพิ่ม" ถ้าครบทุก role แล้ว */
  const btn = document.getElementById("btnAddRole");
  if (btn) btn.disabled = roleSlots.length >= allKeys.length;
}

function onRoleSlotChange(idx, val) {
  if (idx < 0 || idx >= roleSlots.length) return;
  roleSlots[idx] = val;
  /* ถ้า slot ถูกซ้ำ ให้ลบตัวที่ซ้ำกว่าออก (เก็บ slot ที่เพิ่งเลือก) */
  const seen = new Set();
  roleSlots = roleSlots.filter((k, i) => {
    if (i === idx) { seen.add(k); return true; }
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  renderRoleSlots();
}

function addRoleSlot() {
  const allKeys = Object.keys(ROLE_PERMISSIONS);
  const next = allKeys.find((k) => !roleSlots.includes(k));
  if (!next) return;
  roleSlots.push(next);
  renderRoleSlots();
}

function removeRoleSlot(idx) {
  if (roleSlots.length <= 1) return;
  roleSlots.splice(idx, 1);
  renderRoleSlots();
}

/* ============================================================
   Departments — dropdown + inline CRUD
   ============================================================ */
function getDeptName(deptCode) {
  if (!deptCode) return "—";
  const d = allDepartments.find((x) => x.dept_code === deptCode);
  return d ? d.dept_name : deptCode;  /* fallback แสดง code ถ้าหาไม่เจอ (orphan) */
}

function populateDeptSelect() {
  const sel = document.getElementById("fDepartment");
  if (!sel) return;
  const cur = sel.value;
  const opts = allDepartments
    .map((d) => `<option value="${d.dept_code}">${d.dept_name}</option>`)
    .join("");
  sel.innerHTML = `<option value="">— ไม่ระบุ —</option>${opts}`;
  if (cur && allDepartments.some((d) => d.dept_code === cur)) sel.value = cur;
}

function openDeptManager() {
  renderDeptList();
  document.getElementById("deptModalOverlay").classList.add("open");
  document.getElementById("deptNewName").focus();
}

/* auto-gen dept_code: DEPT001, DEPT002, ... — รับประกันไม่ชนของเดิมและไม่ชนเอง */
function generateDeptCode() {
  let max = 0;
  for (const d of allDepartments) {
    const m = /^DEPT(\d+)$/i.exec(d.dept_code || "");
    if (m) max = Math.max(max, parseInt(m[1], 10) || 0);
  }
  return "DEPT" + String(max + 1).padStart(3, "0");
}
function closeDeptManager() {
  document.getElementById("deptModalOverlay").classList.remove("open");
}
function closeDeptManagerBg(e) {
  if (e.target === document.getElementById("deptModalOverlay")) closeDeptManager();
}

function renderDeptList() {
  const list = document.getElementById("deptList");
  if (!list) return;
  if (!allDepartments.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">🏢</div><div>ยังไม่มีแผนก</div></div>`;
    return;
  }
  list.innerHTML = allDepartments.map((d) => `
    <div class="dept-row" data-id="${d.dept_id}">
      <input class="form-control" data-edit="${d.dept_id}" value="${(d.dept_name || "").replace(/"/g, "&quot;")}" />
      <div class="dept-actions">
        <button class="btn-icon" title="บันทึก" onclick="saveDeptName(${d.dept_id})">💾</button>
        <button class="btn-icon danger" title="ลบ" onclick="deleteDept(${d.dept_id})">🗑</button>
      </div>
    </div>
  `).join("");
}

async function addDept() {
  const nameEl = document.getElementById("deptNewName");
  const dept_name = nameEl.value.trim();
  if (!dept_name) {
    showToast("กรุณากรอกชื่อแผนก", "error");
    return;
  }
  if (allDepartments.some((d) => (d.dept_name || "").toLowerCase() === dept_name.toLowerCase())) {
    showToast(`แผนก "${dept_name}" มีอยู่แล้ว`, "error");
    return;
  }
  const dept_code = generateDeptCode();
  const sort_order = (allDepartments.reduce((m, d) => Math.max(m, d.sort_order || 0), 0)) + 1;
  showLoading(true);
  try {
    const created = await sbFetch("departments", {
      method: "POST",
      body: { dept_code, dept_name, sort_order },
    });
    if (Array.isArray(created) && created[0]) allDepartments.push(created[0]);
    else allDepartments.push({ dept_code, dept_name, sort_order });
    nameEl.value = "";
    nameEl.focus();
    populateDeptSelect();
    renderDeptList();
    showToast("✅ เพิ่มแผนกแล้ว", "success");
  } catch (e) {
    showToast("เพิ่มไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

async function saveDeptName(id) {
  const input = document.querySelector(`input[data-edit="${id}"]`);
  if (!input) return;
  const dept_name = input.value.trim();
  if (!dept_name) { showToast("ชื่อแผนกห้ามว่าง", "error"); return; }
  showLoading(true);
  try {
    await sbFetch("departments", {
      method: "PATCH",
      query: `?dept_id=eq.${id}`,
      body: { dept_name, updated_at: new Date().toISOString() },
    });
    const d = allDepartments.find((x) => x.dept_id === id);
    if (d) d.dept_name = dept_name;
    populateDeptSelect();
    showToast("✅ บันทึกชื่อแผนกแล้ว", "success");
  } catch (e) {
    showToast("บันทึกไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

function deleteDept(id) {
  const d = allDepartments.find((x) => x.dept_id === id);
  if (!d) return;
  const inUse = allUsers.filter((u) => u.department === d.dept_code).length;
  const warn = inUse > 0
    ? `แผนก "${d.dept_name}" (${d.dept_code}) มีพนักงาน ${inUse} คนอยู่ — หากลบ คอลัมน์แผนกของคนเหล่านั้นจะกลายเป็น "ไม่ระบุ"\n\nยืนยันลบ?`
    : `ลบแผนก "${d.dept_name}" (${d.dept_code}) หรือไม่?`;
  const onConfirm = async () => {
    showLoading(true);
    try {
      await sbFetch("departments", {
        method: "DELETE",
        query: `?dept_id=eq.${id}`,
      });
      allDepartments = allDepartments.filter((x) => x.dept_id !== id);
      populateDeptSelect();
      renderDeptList();
      showToast("ลบแผนกแล้ว", "success");
    } catch (e) {
      showToast("ลบไม่ได้: " + e.message, "error");
    }
    showLoading(false);
  };
  if (window.DeleteModal) DeleteModal.open(warn, onConfirm);
  else onConfirm();
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
  document.getElementById("fDepartment").value = data?.department || "";
  document.getElementById("fPassword").value = "";
  document.getElementById("fPasswordConfirm").value = "";
  document.getElementById("fEmail").value = data?.email || "";
  document.getElementById("fPhone").value = data?.phone || "";
  document.getElementById("fStatus").value = data
    ? String(data.is_active !== false)
    : "true";

  /* Role slots — โหลดจาก data หรือ default เป็น role แรกในระบบ */
  const allKeys = Object.keys(ROLE_PERMISSIONS);
  const fallback = allKeys[0] || "VIEWER";
  const dataRoles = getUserRoles(data).filter((k) => ROLE_PERMISSIONS[k]);
  roleSlots = dataRoles.length ? dataRoles : [fallback];
  renderRoleSlots();

  /* แสดง hint เมื่อแก้ไข, ซ่อน * เมื่อ optional */
  document.getElementById("pwdHint").style.display      = isEdit ? "block" : "none";
  document.getElementById("pwdReq").style.display       = isEdit ? "none" : "inline";
  document.getElementById("pwdConfirmReq").style.display = isEdit ? "none" : "inline";

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

  /* รวบรวม roles จาก slots — กัน duplicate */
  const cleanRoles = Array.from(new Set(roleSlots.filter((k) => ROLE_PERMISSIONS[k])));
  if (!cleanRoles.length) {
    showToast("กรุณาเลือก Role อย่างน้อย 1 รายการ", "error");
    return;
  }

  /* user_code: edit = ค่าเดิม, create = auto-gen — ไม่แสดงใน UI แล้ว */
  const userCodeRaw = document.getElementById("fUserCode").value.trim().toUpperCase();
  const userCode = userCodeRaw || generateUserCode();
  const department = document.getElementById("fDepartment")?.value.trim() || null;

  const payload = {
    full_name: fullName,
    username,
    user_code: userCode,
    department,
    email: document.getElementById("fEmail")?.value.trim() || null,
    phone: document.getElementById("fPhone")?.value.trim() || null,
    role: cleanRoles[0],          /* backward compat — role หลัก */
    roles: cleanRoles,            /* รายการ role ทั้งหมด */
    custom_permissions: null,     /* perms มาจาก roles อย่างเดียว — เคลียร์ของเก่าทิ้ง */
    is_active: document.getElementById("fStatus").value === "true",
    ...(password ? { password_hash: await hashPassword(password) } : {}),
  };

  /* pre-check ชน Username ก่อนยิง API — user_code auto-gen แล้ว ไม่ต้องเช็ค */
  const dup = allUsers.find((u) =>
    String(u.user_id) !== String(editId) &&
    u.username?.toLowerCase() === username.toLowerCase());
  if (dup) {
    await showDuplicateAlert({
      field: "Username",
      value: username,
      owner: dup,
    });
    return;
  }

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
        const updated = { ...currentUser, full_name: fullName, username, role: payload.role, roles: cleanRoles, email: payload.email };
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
    const msg = String(e.message || "");
    if (/users_username_key/i.test(msg)) {
      await showDuplicateAlert({ field: "Username", value: username });
    } else if (/users_user_code_key/i.test(msg)) {
      await showDuplicateAlert({ field: "รหัสพนักงาน", value: userCode });
    } else if (/users_email_key/i.test(msg)) {
      await showDuplicateAlert({
        field: "อีเมล",
        value: document.getElementById("fEmail")?.value.trim() || "",
      });
    } else {
      showToast("เกิดข้อผิดพลาด: " + msg, "error");
    }
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

/* แสดง popup แจ้ง duplicate field — ใช้ ConfirmModal (alert mode) */
async function showDuplicateAlert({ field, value, owner }) {
  if (!window.ConfirmModal) {
    showToast(`${field} "${value}" ถูกใช้แล้ว`, "error");
    return;
  }
  const details = { [field]: value };
  if (owner) {
    details["ใช้โดย"] = owner.full_name || "—";
    if (owner.user_code) details["รหัสพนักงาน"] = owner.user_code;
    if (owner.username && field !== "Username") details["Username"] = owner.username;
  }
  await window.ConfirmModal.open({
    title: "ข้อมูลซ้ำ",
    icon: "⚠️",
    tone: "warning",
    message: `${field}นี้ถูกใช้งานแล้วในระบบ — กรุณาเปลี่ยนเป็นค่าอื่น`,
    details,
    okText: "เข้าใจแล้ว",
    hideCancel: true,
  });
  /* focus ช่องที่ซ้ำให้ผู้ใช้แก้ทันที */
  const focusMap = {
    "Username": "fUsername",
    "รหัสพนักงาน": "fUserCode",
    "อีเมล": "fEmail",
  };
  const el = document.getElementById(focusMap[field]);
  if (el) { el.focus(); el.select?.(); }
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
  if (SUPABASE_URL && SUPABASE_KEY) setTimeout(() => loadData(), 50);
});

/* ESC-close จัดการโดย modalManager.js (ส่วนกลาง) — ไม่ต้องลงเอง */
