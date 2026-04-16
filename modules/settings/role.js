/* ============================================================
   role.js — Role & Permissions Page
   modules/settings/users/
   
   ใช้ ERP_MODULES จาก modules-registry.js
   เมื่อเพิ่ม module ใหม่ใน registry → หน้านี้อัปเดตอัตโนมัติ
============================================================ */

const SUPABASE_URL = localStorage.getItem("sb_url") || "";
const SUPABASE_KEY = localStorage.getItem("sb_key") || "";

// ── BUILT-IN ROLES ─────────────────────────────────────────
const DEFAULT_ROLES = {
  ADMIN: {
    label: "👑 Admin",
    color: "role-ADMIN",
    desc: "สิทธิ์เต็ม — จัดการระบบทั้งหมด",
    builtIn: true,
    perms: [
      "view_all",
      "view_inventory",
      "manage_stock",
      "create_po",
      "approve_po",
      "view_sales",
      "create_so",
      "approve_so",
      "view_events",
      "manage_events",
      "manage_attendees",
      "view_reports",
      "export_reports",
      "manage_users",
      "manage_settings",
      "view_promotions",
      "manage_promotions",
    ],
  },
  MANAGER: {
    label: "🏢 Manager",
    color: "role-MANAGER",
    desc: "จัดการทั่วไป — PO, SO, Stock, รายงาน",
    builtIn: true,
    perms: [
      "view_all",
      "view_inventory",
      "manage_stock",
      "create_po",
      "approve_po",
      "view_sales",
      "create_so",
      "approve_so",
      "view_events",
      "view_reports",
      "export_reports",
    ],
  },
  WAREHOUSE: {
    label: "🏭 Warehouse",
    color: "role-WAREHOUSE",
    desc: "จัดการคลังสินค้า — รับของ, เบิกของ",
    builtIn: true,
    perms: ["view_all", "view_inventory", "manage_stock", "create_po"],
  },
  SALES: {
    label: "💰 Sales",
    color: "role-SALES",
    desc: "ฝ่ายขาย — สร้าง SO, ดูข้อมูลลูกค้า",
    builtIn: true,
    perms: ["view_all", "view_sales", "create_so"],
  },
  VIEWER: {
    label: "👁 Viewer",
    color: "role-VIEWER",
    desc: "ดูข้อมูลอย่างเดียว — ไม่มีสิทธิ์แก้ไข",
    builtIn: true,
    perms: ["view_all"],
  },
};

// ── STATE ──────────────────────────────────────────────────
let roles = {};
let userCounts = {};
let editingKey = null;
let modalPerms = {};

// ── INIT ───────────────────────────────────────────────────
async function initPage() {
  loadRoles();
  await fetchUserCounts();
  renderRoleGrid();
}

function loadRoles() {
  const saved = JSON.parse(localStorage.getItem("erp_roles") || "null");
  roles = saved ? { ...DEFAULT_ROLES, ...saved } : { ...DEFAULT_ROLES };
}

function saveRoles() {
  const toSave = {};
  Object.entries(roles).forEach(([k, v]) => {
    toSave[k] = v;
  });
  localStorage.setItem("erp_roles", JSON.stringify(toSave));
}

// ── FETCH USER COUNTS ──────────────────────────────────────
async function fetchUserCounts() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/users?select=role&is_active=eq.true`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
        },
      },
    );
    const data = await res.json();
    userCounts = {};
    (data || []).forEach((u) => {
      userCounts[u.role] = (userCounts[u.role] || 0) + 1;
    });
  } catch (_) {}
}

// ── RENDER ROLE GRID ───────────────────────────────────────
function renderRoleGrid() {
  const grid = document.getElementById("roleGrid");

  grid.innerHTML = Object.entries(roles)
    .map(([key, role]) => {
      const count = userCounts[key] || 0;

      // จัดกลุ่ม perm ตาม module จาก ERP_MODULES (modules-registry.js)
      const moduleChips = ERP_MODULES.map((mod) => {
        const modPerms = mod.perms.filter((p) => role.perms.includes(p.key));
        if (!modPerms.length) return "";
        return `
        <div style="margin-bottom:8px">
          <div style="font-size:10px; font-weight:700; color:var(--text3);
            text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px">
            ${mod.label}
          </div>
          <div style="display:flex; flex-wrap:wrap; gap:4px">
            ${modPerms.map((p) => `<span class="role-perm-chip">${p.label}</span>`).join("")}
          </div>
        </div>`;
      }).join("");

      return `
    <div class="role-card">
      <div class="role-card-header">
        <div class="role-card-left">
          <div>
            <div style="display:flex; align-items:center; gap:6px">
              <span class="role-card-badge ${role.color}">${role.label}</span>
              ${role.builtIn ? `<span class="role-builtin-tag">Built-in</span>` : ""}
            </div>
            <div class="role-card-key">${key}</div>
          </div>
        </div>
        <div class="role-card-actions">
          <button class="btn-icon" onclick="window.openRoleModal('${key}')">✏️</button>
          ${
            !role.builtIn
              ? `<button class="btn-icon danger" onclick="window.confirmDeleteRole('${key}')">🗑</button>`
              : ""
          }
        </div>
      </div>
      <div class="role-card-body">
        <div class="role-card-desc">${role.desc || "—"}</div>
        <div class="role-user-count">👤 ${count} คนในระบบ</div>
        <div>${moduleChips || '<span style="font-size:12px;color:var(--text3)">ไม่มีสิทธิ์</span>'}</div>
      </div>
    </div>`;
    })
    .join("");
}

// ── MODAL OPEN ─────────────────────────────────────────────
window.openRoleModal = function (key = null) {
  editingKey = key;
  const role = key ? roles[key] : null;

  document.getElementById("roleModalTitle").textContent = key
    ? `✏️ แก้ไข Role: ${key}`
    : "เพิ่ม Role ใหม่";
  document.getElementById("rEditKey").value = key || "";
  document.getElementById("rKey").value = key || "";
  document.getElementById("rKey").disabled = !!key;
  document.getElementById("rLabel").value = role?.label || "";
  document.getElementById("rColor").value = role?.color || "role-VIEWER";
  document.getElementById("rDesc").value = role?.desc || "";

  document.getElementById("rBtnDelete").style.display =
    key && !roles[key]?.builtIn ? "inline-flex" : "none";

  modalPerms = {};
  (role?.perms || []).forEach((k) => {
    modalPerms[k] = true;
  });
  renderPermToggles();

  document.getElementById("roleModalOverlay").classList.add("open");
  setTimeout(
    () => document.getElementById(key ? "rLabel" : "rKey").focus(),
    100,
  );
};

// ── RENDER PERM TOGGLES จัดกลุ่มตาม ERP_MODULES ───────────
function renderPermToggles() {
  // วน ERP_MODULES จาก modules-registry.js → auto เมื่อเพิ่ม module ใหม่
  const html = ERP_MODULES.map(
    (mod) => `
    <div style="grid-column:span 2; margin-bottom:8px">
      <div style="font-size:11px; font-weight:700; color:var(--text3);
        text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px;
        padding-bottom:4px; border-bottom:1px solid var(--border)">
        ${mod.label}
      </div>
      <div class="role-perm-edit-grid">
        ${mod.perms
          .map((p) => {
            const isOn = !!modalPerms[p.key];
            return `<label class="role-perm-toggle ${isOn ? "active" : ""}"
            id="rptog-${p.key}"
            onclick="window.toggleModalPerm('${p.key}')">
            <div class="role-perm-toggle-icon">${isOn ? "✓" : ""}</div>
            <span class="role-perm-toggle-label">${p.label}</span>
          </label>`;
          })
          .join("")}
      </div>
    </div>
  `,
  ).join("");

  document.getElementById("rPermGrid").innerHTML = html;
}

window.toggleModalPerm = function (key) {
  modalPerms[key] = !modalPerms[key];
  const el = document.getElementById(`rptog-${key}`);
  el.classList.toggle("active", modalPerms[key]);
  el.querySelector(".role-perm-toggle-icon").textContent = modalPerms[key]
    ? "✓"
    : "";
};

// ── MODAL CLOSE ────────────────────────────────────────────
window.closeRoleModal = function () {
  document.getElementById("roleModalOverlay").classList.remove("open");
};
window.closeRoleModalBg = function (e) {
  if (e.target === document.getElementById("roleModalOverlay"))
    window.closeRoleModal();
};

// ── SAVE ROLE ──────────────────────────────────────────────
window.saveRole = function () {
  const key = document
    .getElementById("rKey")
    .value.trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  const label = document.getElementById("rLabel").value.trim();
  const color = document.getElementById("rColor").value;
  const desc = document.getElementById("rDesc").value.trim();
  const perms = Object.keys(modalPerms).filter((k) => modalPerms[k]);

  if (!key) {
    showToast("กรุณาระบุ Role Key", "error");
    return;
  }
  if (!label) {
    showToast("กรุณาระบุชื่อ Role", "error");
    return;
  }
  if (!editingKey && roles[key]) {
    showToast(`Role Key "${key}" มีอยู่แล้ว`, "error");
    return;
  }

  const isBuiltIn = editingKey ? !!roles[editingKey]?.builtIn : false;
  roles[key] = { label, color, desc, builtIn: isBuiltIn, perms };

  saveRoles();
  renderRoleGrid();
  window.closeRoleModal();
  showToast(editingKey ? "แก้ไข Role แล้ว" : "เพิ่ม Role แล้ว", "success");
};

// ── DELETE ROLE ────────────────────────────────────────────
window.deleteRole = function () {
  const key = document.getElementById("rEditKey").value;
  if (!key || roles[key]?.builtIn) return;
  window.confirmDeleteRole(key);
};

window.confirmDeleteRole = function (key) {
  if (roles[key]?.builtIn) {
    showToast("ไม่สามารถลบ Built-in Role ได้", "error");
    return;
  }
  const count = userCounts[key] || 0;
  DeleteModal.open(
    count > 0
      ? `Role "${key}" มีผู้ใช้ ${count} คน — ยืนยันลบ?`
      : `ต้องการลบ Role "${key}" หรือไม่?`,
    () => {
      delete roles[key];
      saveRoles();
      renderRoleGrid();
      window.closeRoleModal();
      showToast("ลบ Role แล้ว", "success");
    },
  );
};

// ── UTILS ──────────────────────────────────────────────────
function showToast(msg, type = "success") {
  const t = document.getElementById("toast");
  t.className = `toast toast-${type} show`;
  t.textContent = msg;
  setTimeout(() => t.classList.remove("show"), 3000);
}

// ── START ──────────────────────────────────────────────────
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPage);
} else {
  initPage();
}
