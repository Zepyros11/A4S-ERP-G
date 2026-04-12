/* ============================================================
   account.js — Account Settings Page Logic
   ============================================================ */
/* global AppPermissions */

const SUPABASE_URL = localStorage.getItem("sb_url") || "";
const SUPABASE_KEY = localStorage.getItem("sb_key") || "";

const AVATAR_COLORS = ["#0f4c75","#065f46","#6d28d9","#c2410c","#0e7490","#92400e"];

let currentUser = null;
let currentRole = null;
let rolePermsSet = new Set();
let customPermsSet = new Set();

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

/* ── LOAD USER DATA ── */
async function loadUserData() {
  const session = window.ERP_USER;
  if (!session || !session.user_id) {
    showToast("กรุณา login ก่อน", "error");
    return;
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    showToast("ยังไม่ได้ตั้งค่า Supabase", "error");
    return;
  }

  showLoading(true);
  try {
    const [users, roles] = await Promise.all([
      sbFetch("users", { query: `?user_id=eq.${session.user_id}&select=*` }),
      sbFetch("role_configs", {
        query: `?role_key=eq.${encodeURIComponent(session.role || "")}&select=*`,
      }).catch(() => null),
    ]);
    currentUser = (users && users[0]) || null;
    if (!currentUser) throw new Error("ไม่พบข้อมูลผู้ใช้");

    currentRole = (roles && roles[0]) || null;
    rolePermsSet = new Set(currentRole?.permissions || []);
    customPermsSet = new Set(currentUser.custom_permissions || []);

    renderAll();
  } catch (e) {
    showToast("โหลดข้อมูลไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

function renderAll() {
  const u = currentUser;
  const r = currentRole;

  /* ── Profile Header ── */
  renderAvatar(u);

  document.getElementById("accName").textContent = u.full_name || "—";
  document.getElementById("accUsername").textContent = u.username || "—";

  const roleLabel = r
    ? `${AppPermissions.iconToEmoji(r.icon) || ""} ${r.label}`.trim()
    : u.role || "—";
  const roleBadge = document.getElementById("accRoleBadge");
  roleBadge.className = `role-badge ${r?.color || "role-VIEWER"}`;
  roleBadge.textContent = roleLabel;

  /* ── Personal Info Form ── */
  document.getElementById("fFullName").value = u.full_name || "";
  document.getElementById("fEmail").value = u.email || "";
  document.getElementById("fPhone").value = u.phone || "";

  /* ── Account Info (read-only) ── */
  document.getElementById("infoUsername").textContent = u.username || "—";
  document.getElementById("infoCode").textContent = u.user_code || "—";
  document.getElementById("infoRole").innerHTML = `<span class="role-badge ${r?.color || "role-VIEWER"}">${roleLabel}</span>`;
  document.getElementById("infoStatus").innerHTML =
    u.is_active !== false
      ? '<span class="status-badge status-on">● ใช้งาน</span>'
      : '<span class="status-badge status-off">● ปิด</span>';
  document.getElementById("infoUserId").textContent = "#" + (u.user_id || "—");

  const loginAt = window.ERP_USER?.login_at
    ? new Date(window.ERP_USER.login_at)
    : new Date();
  document.getElementById("infoLoginTime").textContent = loginAt.toLocaleString("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  /* ── Permissions Tree ── */
  renderPermTree();
}

function renderPermTree() {
  const validKeys = new Set(AppPermissions.allPermKeys);
  const validRole = new Set([...rolePermsSet].filter((k) => validKeys.has(k)));
  const validCustom = new Set(
    [...customPermsSet].filter((k) => validKeys.has(k) && !validRole.has(k)),
  );
  const effective = new Set([...validRole, ...validCustom]);

  document.getElementById("permCount").textContent = effective.size;
  document.getElementById("permCountRole").textContent = validRole.size;
  document.getElementById("permCountCustom").textContent = validCustom.size;

  const container = document.getElementById("permTreeRo");
  container.innerHTML = AppPermissions.modules.map((mod) => {
    const modAllPerms = mod.children.flatMap((c) => c.perms);
    const modCount = modAllPerms.filter((p) => effective.has(p.key)).length;
    const modTotal = modAllPerms.length;
    const modState = modCount === 0 ? "none" : modCount === modTotal ? "all" : "partial";
    const modCbTxt = modState === "all" ? "✓" : modState === "partial" ? "—" : "";

    const subsHtml = mod.children.map((sub) => {
      const subCount = sub.perms.filter((p) => effective.has(p.key)).length;
      const subState = subCount === 0 ? "none" : subCount === sub.perms.length ? "all" : "partial";
      const subCbTxt = subState === "all" ? "✓" : subState === "partial" ? "—" : "";

      const items = sub.perms.map((p) => {
        const isOn = effective.has(p.key);
        const fromRole = validRole.has(p.key);
        const cbCls = fromRole ? "cb-role" : isOn ? "cb-custom" : "cb-off";
        const cbTxt = isOn ? "✓" : "";
        const tag = fromRole
          ? '<span class="ro-tag role">Role</span>'
          : isOn
            ? '<span class="ro-tag custom">เพิ่มเติม</span>'
            : "";
        return `<div class="ro-item${isOn ? "" : " off"}">
          <span class="ro-cb ${cbCls}">${cbTxt}</span>
          <span class="ro-label">${p.label}</span>
          ${tag}
        </div>`;
      }).join("");

      return `<div class="ro-sub">
        <div class="ro-sub-hdr" onclick="toggleRoSub('${sub.key}')">
          <span class="ro-cb sub-cb state-${subState}">${subCbTxt}</span>
          <span class="ro-sub-icon">${sub.icon}</span>
          <span class="ro-sub-label">${sub.label}</span>
          <span class="ro-sub-count">${subCount}/${sub.perms.length}</span>
          <span class="ro-expand" id="roSubExp-${sub.key}">▾</span>
        </div>
        <div class="ro-sub-children" id="roSubCh-${sub.key}">${items}</div>
      </div>`;
    }).join("");

    return `<div class="ro-module">
      <div class="ro-mod-hdr" onclick="toggleRoMod('${mod.key}')">
        <span class="ro-cb mod-cb state-${modState}">${modCbTxt}</span>
        <span class="ro-mod-icon">${mod.icon}</span>
        <span class="ro-mod-label">${mod.label}</span>
        <span class="ro-mod-count">${modCount}/${modTotal}</span>
        <span class="ro-expand" id="roModExp-${mod.key}">▾</span>
      </div>
      <div class="ro-children" id="roModCh-${mod.key}">${subsHtml}</div>
    </div>`;
  }).join("");
}

function toggleRoMod(modKey) {
  const el = document.getElementById(`roModCh-${modKey}`);
  const icon = document.getElementById(`roModExp-${modKey}`);
  if (!el) return;
  const collapsed = el.classList.toggle("collapsed");
  if (icon) icon.textContent = collapsed ? "▸" : "▾";
}

function toggleRoSub(subKey) {
  event.stopPropagation();
  const el = document.getElementById(`roSubCh-${subKey}`);
  const icon = document.getElementById(`roSubExp-${subKey}`);
  if (!el) return;
  const collapsed = el.classList.toggle("collapsed");
  if (icon) icon.textContent = collapsed ? "▸" : "▾";
}

/* ── SAVE PROFILE ── */
async function saveProfile() {
  const fullName = document.getElementById("fFullName").value.trim();
  const email = document.getElementById("fEmail").value.trim() || null;
  const phone = document.getElementById("fPhone").value.trim() || null;

  if (!fullName) {
    showToast("กรุณากรอกชื่อ-นามสกุล", "error");
    return;
  }

  showLoading(true);
  try {
    await sbFetch("users", {
      method: "PATCH",
      query: `?user_id=eq.${currentUser.user_id}`,
      body: { full_name: fullName, email, phone },
    });

    /* อัปเดต local state */
    currentUser.full_name = fullName;
    currentUser.email = email;
    currentUser.phone = phone;

    /* อัปเดต session → topbar จะ sync */
    const session = window.ERP_USER || {};
    const updated = { ...session, full_name: fullName, email };
    window.ERP_USER = updated;
    if (localStorage.getItem("erp_session"))
      localStorage.setItem("erp_session", JSON.stringify(updated));
    if (sessionStorage.getItem("erp_session"))
      sessionStorage.setItem("erp_session", JSON.stringify(updated));

    renderAll();
    showToast("✅ บันทึกข้อมูลสำเร็จ! กำลัง reload...", "success");
    setTimeout(() => location.reload(), 1200);
  } catch (e) {
    showToast("บันทึกไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

/* ── CHANGE PASSWORD ── */
async function hashPassword(pwd) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pwd));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function changePassword() {
  const current = document.getElementById("fCurrentPwd").value;
  const newPwd = document.getElementById("fNewPwd").value;
  const confirmPwd = document.getElementById("fConfirmPwd").value;

  if (!current || !newPwd || !confirmPwd) {
    showToast("กรุณากรอกข้อมูลให้ครบ", "error");
    return;
  }
  if (newPwd !== confirmPwd) {
    showToast("รหัสผ่านใหม่ไม่ตรงกัน", "error");
    return;
  }
  if (newPwd.length < 6) {
    showToast("รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร", "error");
    return;
  }
  if (newPwd === current) {
    showToast("รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านปัจจุบัน", "error");
    return;
  }

  showLoading(true);
  try {
    /* verify current password */
    const currentHash = await hashPassword(current);
    if (currentHash !== currentUser.password_hash) {
      showToast("❌ รหัสผ่านปัจจุบันไม่ถูกต้อง", "error");
      showLoading(false);
      return;
    }

    /* update password */
    const newHash = await hashPassword(newPwd);
    await sbFetch("users", {
      method: "PATCH",
      query: `?user_id=eq.${currentUser.user_id}`,
      body: { password_hash: newHash },
    });

    showToast("✅ เปลี่ยนรหัสผ่านสำเร็จ! กำลัง logout...", "success");
    setTimeout(() => {
      localStorage.removeItem("erp_session");
      sessionStorage.removeItem("erp_session");
      const host = window.location.hostname;
      const BASE_PATH = host.includes("github.io")
        ? "/" + window.location.pathname.split("/")[1]
        : "";
      window.location.href = BASE_PATH + "/login.html";
    }, 1500);
  } catch (e) {
    showToast("เปลี่ยนรหัสผ่านไม่ได้: " + e.message, "error");
    showLoading(false);
  }
}

/* ── Password strength meter ── */
function checkPasswordStrength() {
  const pwd = document.getElementById("fNewPwd").value;
  const fill = document.getElementById("pwdStrengthFill");
  const text = document.getElementById("pwdStrengthText");

  if (!pwd) {
    fill.style.width = "0%";
    fill.className = "pwd-strength-fill";
    text.textContent = "—";
    text.className = "pwd-strength-text";
    return;
  }

  let score = 0;
  if (pwd.length >= 6) score++;
  if (pwd.length >= 10) score++;
  if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score++;
  if (/\d/.test(pwd)) score++;
  if (/[^a-zA-Z0-9]/.test(pwd)) score++;

  const levels = [
    { pct: 20, cls: "weak", label: "⚠️ อ่อนแอมาก" },
    { pct: 40, cls: "weak", label: "⚠️ อ่อนแอ" },
    { pct: 60, cls: "fair", label: "⚡ พอใช้" },
    { pct: 80, cls: "good", label: "✅ ดี" },
    { pct: 100, cls: "strong", label: "💪 แข็งแกร่ง" },
  ];
  const lvl = levels[Math.max(0, score - 1)] || levels[0];
  fill.style.width = lvl.pct + "%";
  fill.className = "pwd-strength-fill " + lvl.cls;
  text.textContent = lvl.label;
  text.className = "pwd-strength-text " + lvl.cls;
}

function checkPasswordMatch() {
  const newPwd = document.getElementById("fNewPwd").value;
  const confirmPwd = document.getElementById("fConfirmPwd").value;
  const el = document.getElementById("pwdMatch");

  if (!confirmPwd) {
    el.textContent = "";
    el.className = "pwd-match";
    return;
  }
  if (newPwd === confirmPwd) {
    el.textContent = "✓ รหัสผ่านตรงกัน";
    el.className = "pwd-match ok";
  } else {
    el.textContent = "✗ รหัสผ่านไม่ตรงกัน";
    el.className = "pwd-match err";
  }
}

/* ── AVATAR RENDER + UPLOAD ── */
function renderAvatar(u) {
  const avatarEl = document.getElementById("accAvatar");
  const removeBtn = document.getElementById("avatarRemoveBtn");
  const color = AVATAR_COLORS[(u.user_id || 0) % AVATAR_COLORS.length];

  if (u.avatar_url) {
    avatarEl.innerHTML = `<img src="${u.avatar_url}" alt="avatar" />`;
    avatarEl.style.background = "transparent";
    if (removeBtn) removeBtn.style.display = "flex";
  } else {
    const nameParts = (u.full_name || "?").split(" ").filter(Boolean);
    const initials = ((nameParts[0]?.[0] || "") + (nameParts[1]?.[0] || "")).toUpperCase() || "?";
    avatarEl.textContent = initials;
    avatarEl.style.background = color;
    if (removeBtn) removeBtn.style.display = "none";
  }
}

function triggerAvatarUpload() {
  document.getElementById("avatarFileInput").click();
}

async function onAvatarSelected(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showToast("กรุณาเลือกไฟล์รูปภาพ", "error");
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    showToast("ไฟล์ใหญ่เกินไป (จำกัด 5MB)", "error");
    return;
  }
  showLoading(true);
  try {
    const dataUrl = await resizeImage(file, 300);
    await sbFetch("users", {
      method: "PATCH",
      query: `?user_id=eq.${currentUser.user_id}`,
      body: { avatar_url: dataUrl },
    });
    currentUser.avatar_url = dataUrl;
    renderAvatar(currentUser);
    showToast("✅ อัพโหลดรูปสำเร็จ", "success");
  } catch (e) {
    showToast("อัพโหลดไม่ได้: " + e.message, "error");
  }
  /* reset file input เพื่อให้เลือกไฟล์เดิมได้อีก */
  ev.target.value = "";
  showLoading(false);
}

function removeAvatar() {
  if (typeof DeleteModal === "undefined") {
    /* fallback */
    if (!confirm("ต้องการลบรูปโปรไฟล์หรือไม่?")) return;
    _doRemoveAvatar();
    return;
  }
  DeleteModal.open("ต้องการลบรูปโปรไฟล์หรือไม่?", _doRemoveAvatar);
}

async function _doRemoveAvatar() {
  showLoading(true);
  try {
    await sbFetch("users", {
      method: "PATCH",
      query: `?user_id=eq.${currentUser.user_id}`,
      body: { avatar_url: null },
    });
    currentUser.avatar_url = null;
    renderAvatar(currentUser);
    showToast("ลบรูปแล้ว", "success");
  } catch (e) {
    showToast("ลบไม่ได้: " + e.message, "error");
  }
  showLoading(false);
}

/* resize + compress รูปใน browser (ไม่ต้องใช้ server) */
function resizeImage(file, maxSize = 300) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("อ่านไฟล์ไม่ได้"));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("รูปภาพไม่ถูกต้อง"));
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let { width, height } = img;
        /* crop center square */
        const size = Math.min(width, height);
        const sx = (width - size) / 2;
        const sy = (height - size) / 2;
        canvas.width = maxSize;
        canvas.height = maxSize;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, sx, sy, size, size, 0, 0, maxSize, maxSize);
        canvas.toBlob(
          (blob) => {
            if (!blob) return reject(new Error("แปลงรูปไม่ได้"));
            const r2 = new FileReader();
            r2.onload = (e2) => resolve(e2.target.result);
            r2.readAsDataURL(blob);
          },
          "image/jpeg",
          0.85,
        );
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ── TAB SWITCH ── */
function switchTab(tabName) {
  document.querySelectorAll(".section-tab").forEach((t) => {
    t.classList.toggle("active", t.getAttribute("data-tab") === tabName);
  });
  const targetId = "tab" + tabName.charAt(0).toUpperCase() + tabName.slice(1);
  document.querySelectorAll(".tab-panel").forEach((p) => {
    p.classList.toggle("active", p.id === targetId);
  });
}

function toggleEye(inputId, iconId) {
  const input = document.getElementById(inputId);
  const isText = input.type === "text";
  input.type = isText ? "password" : "text";
  document.getElementById(iconId).textContent = isText ? "👁" : "🙈";
}

/* ── UI HELPERS ── */
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
  if (SUPABASE_URL && SUPABASE_KEY) {
    setTimeout(() => loadUserData(), 80);
  }
});
