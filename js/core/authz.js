/* ============================================================
   authz.js — Authorization / Permission Enforcement Layer
   ============================================================
   วิธีใช้:
   1. โหลดไฟล์นี้หลัง auth.js ทุกหน้า:
      <script src="../../js/core/authz.js"></script>

   2. Guard ทั้งหน้า:
      <script>AuthZ.requirePerm("events_view");</script>

   3. ซ่อน/แสดงปุ่ม-element ตาม perm:
      <button data-perm="events_create">+ เพิ่ม</button>
      → ถ้าไม่มีสิทธิ์ element จะถูก remove อัตโนมัติ

   4. ตรวจสิทธิ์ใน JS:
      if (AuthZ.hasPerm("events_delete")) { ... }

   5. หลัง dynamic render (เช่น renderTable) → เรียก:
      AuthZ.applyDomPerms(containerEl);
   ============================================================ */

(function () {
  /* ── อ่าน effective permissions จาก session ── */
  function getEffectivePerms() {
    const user = window.ERP_USER;
    if (!user) return new Set();
    return new Set(user.effective_perms || []);
  }

  /* ── BASE_PATH (ใช้ร่วมกับ auth.js) ── */
  function getBasePath() {
    const host = window.location.hostname;
    if (host.includes("github.io")) {
      return "/" + window.location.pathname.split("/")[1];
    }
    return "";
  }

  const AuthZ = {
    /* เช็คสิทธิ์ 1 ตัว */
    hasPerm(key) {
      if (!key) return true;
      return getEffectivePerms().has(key);
    },

    /* เช็คว่ามีอย่างน้อย 1 สิทธิ์ใน list */
    hasAnyPerm(keys) {
      if (!keys || !keys.length) return true;
      const perms = getEffectivePerms();
      return keys.some((k) => perms.has(k));
    },

    /* เช็คว่ามีทุกสิทธิ์ใน list */
    hasAllPerms(keys) {
      if (!keys || !keys.length) return true;
      const perms = getEffectivePerms();
      return keys.every((k) => perms.has(k));
    },

    /* Guard ทั้งหน้า — redirect ถ้าไม่มีสิทธิ์ */
    requirePerm(key) {
      if (!key || this.hasPerm(key)) return true;
      alert("⛔ คุณไม่มีสิทธิ์เข้าถึงหน้านี้");
      const base = getBasePath();
      window.location.replace(base + "/modules/dashboard/dashboard.html");
      throw new Error(`Permission denied: ${key}`);
    },

    /* Scan element ที่มี data-perm และ remove ถ้าไม่มีสิทธิ์
       - mode="remove" (default) → .remove()
       - mode="hide" → style.display = "none"
       - mode="disable" → disabled=true (สำหรับปุ่ม/input)
    */
    applyDomPerms(root, mode = "remove") {
      root = root || document;
      const nodes = root.querySelectorAll("[data-perm]");
      nodes.forEach((el) => {
        const need = el.getAttribute("data-perm");
        if (this.hasPerm(need)) return;
        const m = el.getAttribute("data-perm-mode") || mode;
        if (m === "hide") el.style.display = "none";
        else if (m === "disable") {
          el.disabled = true;
          el.setAttribute("aria-disabled", "true");
          el.style.opacity = "0.5";
          el.style.cursor = "not-allowed";
        } else {
          el.remove();
        }
      });
    },

    /* รีเฟรช effective_perms จาก Supabase (ใช้หลัง role/perm เปลี่ยน) */
    async refresh() {
      const user = window.ERP_USER;
      if (!user || !user.user_id) return;
      const url = localStorage.getItem("sb_url");
      const key = localStorage.getItem("sb_key");
      if (!url || !key) return;
      try {
        const [userRes, roleRes] = await Promise.all([
          fetch(`${url}/rest/v1/users?user_id=eq.${user.user_id}&select=*`, {
            headers: { apikey: key, Authorization: `Bearer ${key}` },
          }).then((r) => r.json()),
          fetch(`${url}/rest/v1/role_configs?role_key=eq.${encodeURIComponent(user.role)}&select=*`, {
            headers: { apikey: key, Authorization: `Bearer ${key}` },
          }).then((r) => r.json()),
        ]);
        const fresh = (userRes && userRes[0]) || {};
        const role = (roleRes && roleRes[0]) || null;
        const rolePerms = (role && role.permissions) || [];
        const customPerms = fresh.custom_permissions || [];
        const effective = Array.from(new Set([...rolePerms, ...customPerms]));
        const updated = { ...user, effective_perms: effective, custom_permissions: customPerms };
        window.ERP_USER = updated;
        if (localStorage.getItem("erp_session"))
          localStorage.setItem("erp_session", JSON.stringify(updated));
        if (sessionStorage.getItem("erp_session"))
          sessionStorage.setItem("erp_session", JSON.stringify(updated));
        this.applyDomPerms();
      } catch (e) {
        console.warn("AuthZ.refresh failed:", e);
      }
    },
  };

  /* ── Auto-apply บน DOMContentLoaded ── */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => AuthZ.applyDomPerms());
  } else {
    AuthZ.applyDomPerms();
  }

  /* ── Expose globally ── */
  window.AuthZ = AuthZ;
  window.hasPerm = (k) => AuthZ.hasPerm(k);
  window.requirePerm = (k) => AuthZ.requirePerm(k);
})();
