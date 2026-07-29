// ============================================================
// A4S-ERP — Auth Guard
// วิธีใช้: ใส่ <script src="../../shared/auth.js"></script>
//          ก่อน sidebar.js ในทุกหน้าที่ต้องการป้องกัน
// ============================================================

/* ============================================================
   Connection guard — ต้องอยู่บนสุด รันก่อนโค้ดอื่นทั้งหมด
   ------------------------------------------------------------
   ปัญหาที่แก้: มีแค่ 3 หน้าที่โหลด js/core/config.js (login, web-editor,
   web-pages) · อีก ~94 หน้าอ่าน localStorage 'sb_url' ที่ค้างไว้ตั้งแต่ตอน login
   → พอเปลี่ยนปลายทาง Supabase คนที่ login ค้างอยู่จะยังยิงเข้าฐานเดิม
     จนกว่าจะ logout/login ใหม่ ทำให้ข้อมูลแตกเป็นสองทางแบบเงียบๆ

   auth.js โหลดครบ 117 หน้า จึงคำนวณปลายทางใหม่ทุกครั้งที่โหลดหน้า
   ค่าต้องตรงกับ js/core/config.js เสมอ (แก้ที่ไหนต้องแก้ทั้งคู่)
   ดู docs/MIGRATION-2026-08.md
   ============================================================ */
(function () {
  var isNew = (window.ERP_IS_NEW =
    window.ERP_IS_NEW ?? (localStorage.getItem("erp_env") !== "old"));

  var cfg = isNew
    ? {
        url: "https://egnwfmdsqtxxyhyajnnu.supabase.co",
        key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVnbndmbWRzcXR4eHloeWFqbm51Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUwNTI4ODEsImV4cCI6MjEwMDYyODg4MX0.5R47xGBQY0Nr92AP30kSNgpYkZ6pV-al9-JGxsimifc",
        proxy: "https://a4s-erp-proxy-new.onrender.com",
        driveKey: "7f2f204a8636f7136e23ec84924d691bde6879086605ece1",
      }
    : {
        url: "https://dtiynydgkcqausqktreg.supabase.co",
        key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR0aXlueWRna2NxYXVzcWt0cmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyNjEwNTcsImV4cCI6MjA4NzgzNzA1N30.DmXwvBBvx3zK7rw21179ro65mTm0B4lQ20ktVMpAUQE",
        proxy: "https://a4s-erp-proxy.onrender.com",
        driveKey: "e8a34e421ad649830e5da29bff37b9e2ec729c4e252ab337",
      };

  try {
    if (localStorage.getItem("sb_url") !== cfg.url) {
      console.info("[auth] ปลายทาง Supabase เปลี่ยน → อัปเดต localStorage");
    }
    localStorage.setItem("sb_url", cfg.url);
    localStorage.setItem("sb_key", cfg.key);
    localStorage.setItem("erp_proxy_url", cfg.proxy);
    localStorage.setItem("erp_drive_key", cfg.driveKey);
    localStorage.setItem("erp_drive_storage", "1");
  } catch (e) {
    /* โหมดส่วนตัว/localStorage ถูกปิด — ปล่อยผ่าน ไม่ให้ทั้งหน้าพัง */
  }
})();

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

  // ── 4. Logout function (custom modal) ────────────────────
  function _doLogout() {
    localStorage.removeItem("erp_session");
    sessionStorage.removeItem("erp_session");
    window.location.replace(BASE_PATH + "/login.html");
  }

  function _closeLogoutModal() {
    document.getElementById("logoutModalOverlay")?.classList.remove("active");
    document.removeEventListener("keydown", _logoutKeyHandler);
  }

  function _logoutKeyHandler(e) {
    if (e.key === "Escape") _closeLogoutModal();
    else if (e.key === "Enter") _doLogout();
  }

  function _injectLogoutModal() {
    if (document.getElementById("logoutModalOverlay")) return;

    /* ── HTML ── */
    const wrap = document.createElement("div");
    wrap.innerHTML = `
<div id="logoutModalOverlay" class="lm-overlay">
  <div class="lm-modal">
    <div class="lm-icon-wrap">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#0f4c75" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
        <polyline points="16 17 21 12 16 7"/>
        <line x1="21" y1="12" x2="9" y2="12"/>
      </svg>
    </div>
    <div class="lm-title">ออกจากระบบ?</div>
    <div class="lm-body">
      <p>คุณต้องการออกจากระบบหรือไม่?<br/>ต้อง login ใหม่เมื่อจะใช้งานอีกครั้ง</p>
    </div>
    <div class="lm-footer">
      <button class="lm-btn cancel" id="lmCancelBtn">ยกเลิก</button>
      <button class="lm-btn primary" id="lmConfirmBtn">🚪 ออกจากระบบ</button>
    </div>
  </div>
</div>`;
    document.body.appendChild(wrap.firstElementChild);

    /* ── CSS ── */
    if (!document.getElementById("logoutModalStyle")) {
      const style = document.createElement("style");
      style.id = "logoutModalStyle";
      style.textContent = `
.lm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(6px);
  display: none;
  align-items: center;
  justify-content: center;
  z-index: 3000;
  animation: lmFade 0.15s ease;
}
.lm-overlay.active { display: flex; }
.lm-modal {
  width: 380px;
  max-width: 92vw;
  background: #fff;
  border-radius: 16px;
  padding: 32px 28px 24px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.08);
  text-align: center;
  font-family: 'Sarabun', sans-serif;
  animation: lmPop 0.22s cubic-bezier(0.34,1.56,0.64,1);
}
.lm-icon-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 58px;
  height: 58px;
  border-radius: 14px;
  background: linear-gradient(135deg, #e0f2fe, #dbeafe);
  margin-bottom: 16px;
  box-shadow: 0 4px 14px rgba(15,76,117,0.15);
}
.lm-title {
  font-size: 18px;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 8px;
  letter-spacing: 0.2px;
}
.lm-body {
  font-size: 13.5px;
  color: #64748b;
  line-height: 1.65;
  margin-bottom: 24px;
}
.lm-body p { margin: 0; }
.lm-footer {
  display: flex;
  gap: 10px;
}
.lm-btn {
  flex: 1;
  padding: 11px 16px;
  border-radius: 10px;
  border: none;
  cursor: pointer;
  font-size: 14px;
  font-weight: 600;
  font-family: 'Sarabun', sans-serif;
  transition: all 0.15s;
}
.lm-btn.cancel {
  background: #f1f5f9;
  color: #475569;
  border: 1.5px solid #e2e8f0;
}
.lm-btn.cancel:hover {
  background: #e2e8f0;
  border-color: #cbd5e1;
}
.lm-btn.primary {
  background: linear-gradient(135deg, #0f4c75, #1b6ca8);
  color: #fff;
  box-shadow: 0 4px 14px rgba(15,76,117,0.30);
}
.lm-btn.primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(15,76,117,0.42);
}
.lm-btn.primary:active { transform: translateY(0); }
@keyframes lmFade {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes lmPop {
  from { transform: scale(0.92) translateY(12px); opacity: 0; }
  to   { transform: scale(1) translateY(0); opacity: 1; }
}
`;
      document.head.appendChild(style);
    }

    /* ── Events ── */
    const overlay = document.getElementById("logoutModalOverlay");
    document.getElementById("lmCancelBtn").onclick = _closeLogoutModal;
    document.getElementById("lmConfirmBtn").onclick = _doLogout;
    overlay.onclick = (e) => { if (e.target === overlay) _closeLogoutModal(); };
  }

  window.erpLogout = function () {
    _injectLogoutModal();
    document.getElementById("logoutModalOverlay").classList.add("active");
    document.addEventListener("keydown", _logoutKeyHandler);
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
