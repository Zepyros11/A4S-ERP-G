// ============================================================
// A4S-ERP — Auth Guard
// วิธีใช้: ใส่ <script src="../../shared/auth.js"></script>
//          ก่อน sidebar.js ในทุกหน้าที่ต้องการป้องกัน
// ============================================================

(function () {
  // ── 1. อ่าน Session ──────────────────────────────────────
  function getSession() {
    // ลอง localStorage ก่อน (remember me), แล้ว sessionStorage
    const local = localStorage.getItem("erp_session");
    const session = sessionStorage.getItem("erp_session");
    if (local) return JSON.parse(local);
    if (session) return JSON.parse(session);
    return null;
  }

  // detect base path automatically
  function getBasePath() {
    const host = window.location.hostname;

    // GitHub Pages project
    if (host.includes("github.io")) {
      const parts = window.location.pathname.split("/");
      return "/" + parts[1];
    }

    // localhost or real domain
    return "";
  }

  const BASE_PATH = getBasePath();

  const session = getSession();

  // ── 2. ถ้าไม่มี session → redirect ไป login ──────────────
  if (!session) {
    // จำ URL ที่ผู้ใช้พยายามเข้า เพื่อ redirect กลับหลัง login
    sessionStorage.setItem("erp_redirect", window.location.pathname);
    window.location.replace(BASE_PATH + "/login.html");
    throw new Error("Not authenticated"); // หยุด script ที่เหลือ
  }

  // ── 3. เปิดให้ page อื่นเข้าถึง session ได้ ─────────────
  window.ERP_USER = session;

  // ── 4. Logout function ───────────────────────────────────
  window.erpLogout = function () {
    if (!confirm("ออกจากระบบ?")) return;
    localStorage.removeItem("erp_session");
    sessionStorage.removeItem("erp_session");
    window.location.replace(BASE_PATH + "/login.html");
  };

  // ── 5. Inject User chip ใน Topbar (รอ DOM) ──────────────
  // sidebar.js จะ inject topbar ทีหลัง เราต้องรอ
  function injectUserChip() {
    const topbar = document.querySelector(".topbar-right");

    if (!topbar) return; // กัน error ถ้า element ไม่มี

    const user = localStorage.getItem("user_name") || "User";

    const chip = document.createElement("div");
    chip.className = "user-chip";
    chip.innerHTML = `👤 ${user}`;

    topbar.appendChild(chip);
  }

  // Toggle dropdown
  window.toggleUserMenu = function () {
    const dd = document.getElementById("erpDropdown");
    if (dd) dd.classList.toggle("open");
  };

  // ปิด dropdown เมื่อคลิกที่อื่น
  document.addEventListener("click", (e) => {
    const wrap = document.getElementById("erpChipWrap");
    if (wrap && !wrap.contains(e.target)) {
      const dd = document.getElementById("erpDropdown");
      if (dd) dd.classList.remove("open");
    }
  });

  // รอ topbar ถูก inject โดย sidebar.js
  const observer = new MutationObserver(() => {
    if (document.querySelector(".topbar")) {
      injectUserChip();
      // รอ sidebar inject topbar-actions ด้วย
      setTimeout(injectUserChip, 100);
      observer.disconnect();
    }
  });

  // ลอง inject ทันทีก่อน (กรณี topbar มีอยู่แล้ว)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      injectUserChip();
      setTimeout(injectUserChip, 150);
    });
  } else {
    injectUserChip();
    setTimeout(injectUserChip, 150);
  }

  observer.observe(document.body, { childList: true, subtree: true });
})();

function getBasePath() {
  const host = window.location.hostname;

  if (host.includes("github.io")) {
    const parts = window.location.pathname.split("/");
    return "/" + parts[1];
  }

  return "";
}

const BASE_PATH = getBasePath();
